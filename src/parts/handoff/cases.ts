import { createHash } from 'node:crypto';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { NativePartRepository, nativePartSourceHash, PART_LIBRARY_VERSION } from '../assembly/source.js';
import { ASSEMBLY_ENGINE_VERSION } from '../assembly/engine.js';
import { CONNECTION_RULE_VERSION, checkConnectionCompatibility } from '../assembly/compatibility.js';
import { COLLISION_VERSION, checkNativePairCollision } from '../assembly/collision.js';
import { buildNativeCollisionProxy } from '../assembly/proxy.js';
import { IDENTITY_TRANSFORM } from '../assembly/math.js';
import { solveAttachment } from '../assembly/solver.js';
import { createBundledElementDesignMapper } from '../recovery/mapper.js';
import type { MappingSourceFingerprint } from '../recovery/types.js';
import type { AssemblyVersions, NativeAssemblyPart, RigidTransform } from '../assembly/types.js';
import { runDeferredInterfaces } from '../assembly/deferredRunner.js';
import { createAssemblySourceLoader, loadStandardAssemblyFixtures } from '../assembly/fixtures.js';
import { createInterfaceTestContext } from '../assembly/testContext.js';
import type { InterfaceTestContext } from '../assembly/deferredTypes.js';

export const HANDOFF_ROOT = fileURLToPath(new URL('../../../astra-handoff/', import.meta.url));
export type AstraCategory = 'COMPLEX_COLLISION' | 'HOLLOW_GEOMETRY' | 'SPECIAL_MATING' | 'WHEEL_ASSEMBLY' | 'CLIP_BAR' | 'AXLE_HOLE' | 'MAPPING_CONFLICT' | 'MAPPING_EVIDENCE_MISSING' | 'CONNECTION_PARSE' | 'VERIFICATION_BUDGET';
export interface AstraReplay {
  kind: 'proxy' | 'interface' | 'parse' | 'mapping' | 'fixture';
  partId?: string;
  connectionId?: string;
  fixturePartId?: string;
  fixtureConnectionId?: string;
  twistDegrees?: number;
  elementId?: string;
  physicalInterfaceId?: string;
  timeoutMs?: number;
}
export interface AstraCase {
  schemaVersion: 1;
  caseId: string;
  category: AstraCategory;
  versions: AssemblyVersions;
  affectedParts: { partId: string; ldrawId: string | null; identitySystem: 'ldraw' | 'rebrickable'; sourceDigest: string | null; geometryHash: string | null; connectionMetadataHash: string | null }[];
  affectedElements?: string[];
  mappingSourceFingerprint?: MappingSourceFingerprint;
  fixtureTestContext?: InterfaceTestContext;
  affectedPhysicalInterfaces?: string[];
  connections: unknown[];
  currentTransform: RigidTransform | null;
  transformStatus: 'SOURCE_IDENTITY' | 'SOLVED_CANDIDATE' | 'UNRESOLVED' | 'NOT_APPLICABLE';
  expectedBehavior: { status: 'EXPECTED_UNKNOWN'; explanation: string };
  actualBehavior: { status: string; reasonCodes: string[]; details: unknown };
  replay: AstraReplay;
  reproductionCommand: string;
  relevantSourceFiles: string[];
  relevantTests: string[];
  evidence: unknown[];
  attemptsAlreadyMade: string[];
  whySolStopped: string;
  diagnosticOnly: true;
}
export const currentHandoffVersions = (): AssemblyVersions => ({ partLibraryVersion: PART_LIBRARY_VERSION, assemblyEngineVersion: ASSEMBLY_ENGINE_VERSION, connectionRuleVersion: CONNECTION_RULE_VERSION, collisionVersion: COLLISION_VERSION });
export function handoffPartFingerprint(part: NativeAssemblyPart): AstraCase['affectedParts'][number] {
  return { partId: part.partId, ldrawId: part.partId, identitySystem: 'ldraw', sourceDigest: nativePartSourceHash(part),
    geometryHash: createHash('sha256').update(JSON.stringify(part.geometry.source.files.map(file => [file.path, file.sha256]).sort())).digest('hex'),
    connectionMetadataHash: createHash('sha256').update(JSON.stringify(part.connections)).digest('hex') };
}

/** Diagnostic replay never supplies provisional production permissions or returns a generatable model. */
export async function replayAstraOperation(replay: AstraReplay, repository = new NativePartRepository()) {
  if (replay.kind === 'mapping') {
    const mapping = (await createBundledElementDesignMapper()).resolve(replay.elementId ?? '');
    return { status: mapping.mappingStatus, reasonCodes: mapping.reasons, details: mapping, transform: null, connections: [] };
  }
  const part = replay.partId ? await repository.getPart(replay.partId) : undefined;
  if (!part) throw new Error('The case references an unavailable pinned native part.');
  if (replay.kind === 'fixture') {
    if (!replay.physicalInterfaceId || !/^[a-f0-9]{64}$/.test(replay.physicalInterfaceId)) throw new Error('A fixture replay requires an exact physical interface ID.');
    const directory = await mkdtemp(path.join(tmpdir(), 'bricklab-astra-fixture-'));
    try {
      const result = await runDeferredInterfaces({ repository, checkpointDirectory: directory, partIds: [part.partId], physicalInterfaceIds: [replay.physicalInterfaceId], concurrency: 1, batchSize: 1, timeoutMs: replay.timeoutMs ?? 8000, partBudgetMs: 0, maxRetries: 0 });
      const record = result.parts[0]?.records[0];
      if (!record) throw new Error('The exact diagnostic fixture produced no outcome.');
      return { status: record.status, reasonCodes: record.reasonCodes, details: record, transform: record.proof?.transform ?? null, connections: part.connections.points.filter(point => record.rawConnectionIds.includes(point.id)).slice(0, 2) };
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
  if (replay.kind === 'parse') return { status: part.connections.status, reasonCodes: [...new Set(part.connections.issues.map(issue => issue.code))], details: { status: part.connections.status, pointCount: part.connections.points.length, issues: part.connections.issues, sourceFiles: part.connections.sourceFiles }, transform: null, connections: part.connections.points.slice(0, 2) };
  const fixed = { instanceId: 'case-fixed', partId: part.partId, transform: IDENTITY_TRANSFORM };
  if (replay.kind === 'proxy') {
    const proxy = buildNativeCollisionProxy(part, fixed);
    return { status: proxy.status, reasonCodes: [proxy.reasonCode], details: { reason: proxy.reason, topology: proxy.proxy?.topology, evidence: proxy.proxy?.evidence }, transform: IDENTITY_TRANSFORM, connections: part.connections.points.slice(0, 2) };
  }
  const mate = replay.fixturePartId ? await repository.getPart(replay.fixturePartId) : undefined;
  const a = part.connections.points.find(point => point.id === replay.connectionId), b = mate?.connections.points.find(point => point.id === replay.fixtureConnectionId);
  if (!mate || !a || !b) throw new Error('The exact source endpoints required by this case are unavailable.');
  const compatibility = checkConnectionCompatibility(a, b);
  const solved = solveAttachment({ fixedPart: part, fixedPlacement: fixed, fixedConnectionId: a.id, movingPart: mate, movingConnectionId: b.id, ...(replay.twistDegrees === undefined ? {} : { twistsDeg: [replay.twistDegrees] }) });
  const candidate = solved.candidates[0];
  if (!candidate) return { status: compatibility.status, reasonCodes: [compatibility.reasonCode], details: { compatibility, solver: solved }, transform: null, connections: [a, b] };
  const collision = checkNativePairCollision(part, fixed, mate, { instanceId: 'case-moving', partId: mate.partId, transform: candidate.transform }, candidate.penetrationZone);
  return { status: collision.status, reasonCodes: [collision.reasonCode], details: { compatibility, candidate, collision }, transform: candidate.transform, connections: [a, b] };
}

export async function loadAstraCase(caseId: string, root = HANDOFF_ROOT): Promise<AstraCase> {
  if (!/^[A-Z0-9][A-Z0-9_.-]{0,99}$/.test(caseId)) throw new Error('Invalid Astra case ID.');
  const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8')) as { cases: { caseId: string; path: string; sha256: string }[] };
  const entry = manifest.cases.find(value => value.caseId === caseId);
  if (!entry) throw new Error('Unknown Astra case ID.');
  const filename = path.resolve(root, entry.path);
  if (!filename.startsWith(path.resolve(root) + path.sep)) throw new Error('Case path escapes its manifest directory.');
  const bytes = await readFile(filename);
  if (bytes.length > 2 * 1024 * 1024 || createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error('Case evidence integrity verification failed.');
  const result = JSON.parse(bytes.toString('utf8')) as AstraCase;
  if (result.schemaVersion !== 1 || result.caseId !== caseId || result.diagnosticOnly !== true || !result.replay || !Array.isArray(result.affectedParts) || result.expectedBehavior?.status !== 'EXPECTED_UNKNOWN') throw new Error('Invalid case schema or unsupported physical expectation.');
  return result;
}

export async function reproduceAstraCase(record: AstraCase, repository = new NativePartRepository()) {
  if (!record.replay || !['proxy', 'interface', 'parse', 'mapping', 'fixture'].includes(record.replay.kind) || record.diagnosticOnly !== true || record.expectedBehavior?.status !== 'EXPECTED_UNKNOWN') throw new Error('Unsupported diagnostic case or physical expectation.');
  if (JSON.stringify(record.versions) !== JSON.stringify(currentHandoffVersions())) throw new Error('Case engine/source versions differ. Regenerate the handoff pack before reproducing.');
  if (record.replay.kind === 'mapping') {
    const fingerprint = (await createBundledElementDesignMapper()).getSourceFingerprint();
    if (!record.mappingSourceFingerprint || JSON.stringify(record.mappingSourceFingerprint) !== JSON.stringify(fingerprint)) throw new Error('Mapping source changed: NEEDS_REVALIDATION.');
    if (!record.replay.elementId || !record.affectedElements?.includes(record.replay.elementId)) throw new Error('Mapping replay is not bound to its affected Element IDs.');
  } else {
    const required = [...new Set([record.replay.partId, ...(record.replay.kind === 'interface' ? [record.replay.fixturePartId] : [])])];
    const affected = record.affectedParts.filter(part => part.identitySystem === 'ldraw');
    if (required.some(id => !id) || affected.length !== required.length || new Set(affected.map(part => part.partId)).size !== affected.length || required.some(id => !affected.some(part => part.partId === id && part.ldrawId === id))) throw new Error('Native replay parts lack exact, unique source fingerprints.');
  }
  for (const affected of record.affectedParts) if (affected.identitySystem === 'ldraw') {
    const part = await repository.getPart(affected.partId);
    const current = part && handoffPartFingerprint(part);
    if (!current || current.sourceDigest !== affected.sourceDigest || current.geometryHash !== affected.geometryHash || current.connectionMetadataHash !== affected.connectionMetadataHash) throw new Error(`Case source fingerprint changed: ${affected.partId}`);
  }
  if (record.replay.kind === 'fixture') {
    const fixtures = await loadStandardAssemblyFixtures(await createAssemblySourceLoader(repository));
    const part = (await repository.getPart(record.replay.partId!))!;
    if (!record.fixtureTestContext || JSON.stringify(createInterfaceTestContext(part, fixtures)) !== JSON.stringify(record.fixtureTestContext)) throw new Error('Fixture source or test context changed: NEEDS_REVALIDATION.');
  }
  const actual = await replayAstraOperation(record.replay, repository);
  const sameTransform = record.currentTransform === null ? actual.transform === null : actual.transform !== null && [...record.currentTransform.rotation, ...record.currentTransform.translation].every((value, index) => Math.abs(value - [...actual.transform!.rotation, ...actual.transform!.translation][index]) < 1e-5);
  return { caseId: record.caseId, category: record.category, diagnosticOnly: true, expected: record.expectedBehavior, recordedActual: record.actualBehavior,
    actual: { status: actual.status, reasonCodes: actual.reasonCodes, details: actual.details },
    reproduced: sameTransform && actual.status === record.actualBehavior.status && record.actualBehavior.reasonCodes.every(code => (actual.reasonCodes as string[]).includes(code)), physicalBuildVerified: false };
}
