import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AttachmentEngine, ASSEMBLY_ENGINE_VERSION, type AttachResult } from './engine.js';
import { NativeAssemblyGenerator, type NativeGeneratedAssembly, type NativeGenerationResult, type NativeModuleRequest } from './generator.js';
import { NativePartRepository, nativePartSourceHash, PART_LIBRARY_VERSION } from './source.js';
import { ASSEMBLY_MIGRATION_VERSION, type AssemblyMigrationEntry, type AssemblyMigrationReport } from './migration.js';
import { COLLISION_VERSION } from './collision.js';
import { checkConnectionCompatibility, CONNECTION_RULE_VERSION } from './compatibility.js';
import { solveAttachment } from './solver.js';
import { distance, IDENTITY_TRANSFORM, isRigidTransform } from './math.js';
import type { AssemblyInterfaceCapability, NativeAssemblyPart } from './types.js';
import type { ConnectionFixtureVerification, AssemblyVerificationCheckName } from './verification.js';
import type { ImportedConnectionPoint } from '../connections/types.js';
import type { BundledLDrawManifest } from '../ldraw/types.js';

export const ASSEMBLY_REPORT_DIRECTORY = fileURLToPath(new URL('../../../data/parts-foundation/assembly/', import.meta.url));
const MAX_REPORT_BYTES = 48 * 1024 * 1024;
const MAX_RETAINED_MODELS = 64;
const REQUIRED_FIXTURE_CHECKS: AssemblyVerificationCheckName[] = ['connection', 'transform', 'reverse-connection', 'collision', 'illegal-collision', 'rotation', 'connection-graph', 'generator-smoke'];

export interface AssemblyDefaultPair {
  partA: string;
  connectionA: string;
  partB: string;
  connectionB: string;
  twistDegrees: number;
}
export type AssemblyPairAttachRequest = Omit<AssemblyDefaultPair, 'twistDegrees'> & { twistDegrees?: number };

export type RuntimeAssemblyStatus = Omit<AssemblyMigrationReport, 'generatedAt'> & {
  generatedAt: string | null;
  queue: AssemblyMigrationEntry[];
  capabilities: AssemblyInterfaceCapability[];
  defaultPair?: AssemblyDefaultPair;
  physicalBuildVerified: false;
  runtimeValidation: { status: 'ready' | 'partial' | 'blocked'; issues: string[]; reportLoaded: boolean; checkedAt: string };
};

type RootRecord = BundledLDrawManifest['roots'][number];
const errorMessage = (error: unknown) => error instanceof Error ? error.message.slice(0, 500) : 'Unknown report/source error.';
function listOfStrings(value: unknown): value is string[] { return Array.isArray(value) && value.length <= 20000 && value.every((item) => typeof item === 'string' && item.length <= 1000); }
function pointSignature(point: ImportedConnectionPoint): string { return JSON.stringify([point.kind, point.family, point.gender, point.position, point.direction, point.orientation, point.sections, point.radius, point.length, point.group, point.properties, point.dimensionsResolved]); }
function equalTransforms(a: NonNullable<ConnectionFixtureVerification['transform']>, b: NonNullable<ConnectionFixtureVerification['transform']>) { return distance(a.translation, b.translation) < 1e-5 && a.rotation.every((value, index) => Math.abs(value - b.rotation[index]) < 1e-6); }
function entryShape(value: unknown): value is AssemblyMigrationEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as AssemblyMigrationEntry;
  return typeof entry.partId === 'string' && !!entry.source && typeof entry.source.digest === 'string' && listOfStrings(entry.allowedConnectionIds) && listOfStrings(entry.verifiedConnectionIds) && listOfStrings(entry.ruleIds) && listOfStrings(entry.reasonCodes) && listOfStrings(entry.reasons) && Array.isArray(entry.sourceChecks) && Array.isArray(entry.fixtures) && entry.fixtures.length <= 20000 && entry.fixtures.every((fixture) => !!fixture && typeof fixture.connectionId === 'string' && listOfStrings(fixture.equivalentConnectionIds) && Array.isArray(fixture.checks));
}
function sourceFingerprint(part: NativeAssemblyPart | undefined, root: RootRecord) {
  return part ? {
    digest: nativePartSourceHash(part), geometryRevision: part.geometry.source.revision, geometryRoot: part.geometry.source.rootFile,
    geometryFiles: part.geometry.source.files.map((file) => ({ path: file.path, sha256: file.sha256 })).sort((a, b) => a.path.localeCompare(b.path)),
    connectionFiles: part.connections.sourceFiles.map((file) => ({ library: file.library, path: file.path, revision: file.revision, sha256: file.sha256 })).sort((a, b) => `${a.library}:${a.path}`.localeCompare(`${b.library}:${b.path}`)),
  } : { digest: '', geometryRevision: '', geometryRoot: root.path, geometryFiles: [], connectionFiles: [] };
}

function blockedEntry(root: RootRecord, part: NativeAssemblyPart | undefined, code: string, reason: string): AssemblyMigrationEntry {
  return {
    partId: root.partId, name: part?.geometry.name ?? root.name, source: sourceFingerprint(part, root),
    batch: 'other-source-part', selectionBasis: root.selectionBasis, blockedCategory: part ? 'other' : 'geometry',
    status: 'blocked', geometryReady: part?.geometry.status === 'geometryReady', connectionSourceStatus: part?.connections.status ?? 'missing', scope: 'source-backed-tested-interfaces-only',
    assemblyVerified: false, generatable: false, allowedConnectionIds: [], verifiedConnectionIds: [], disabledConnectionIds: part?.connections.points.map((point) => point.id) ?? [],
    capabilities: [], ruleIds: [], reasonCodes: [code], reasons: [reason], wheelModuleVerified: false, physicalBuildVerified: false,
    sourceChecks: [{ name: 'source-integrity', outcome: 'blocked', reason }], fixtures: [], fixtureTestsPassed: 0, fixtureTestsTotal: 0, generatorSmokePassed: false,
    interfaceBudget: null, physicalInterfaceCount: part ? new Set(part.connections.points.map(pointSignature)).size : 0, testedPhysicalInterfaceCount: 0,
    deferredPhysicalInterfaceCount: part ? new Set(part.connections.points.map(pointSignature)).size : 0, deferredConnectionIds: part?.connections.points.map((point) => point.id) ?? [],
  };
}

/** Runtime admission consumes saved evidence; it never runs the full migration on a page request. */
export class AssemblyService {
  readonly repository: NativePartRepository;
  readonly engine: AttachmentEngine;
  readonly reportDirectory: string;
  private prepared?: Promise<void>;
  private readonly entries = new Map<string, AssemblyMigrationEntry>();
  private readonly models = new Map<string, NativeGeneratedAssembly>();
  private report?: AssemblyMigrationReport;
  private runtimeIssues: string[] = [];
  private reportLoaded = false;
  private envelopeValid = false;
  private checkedAt = '';
  private defaultPair?: AssemblyDefaultPair;
  private readonly sourceParts = new Map<string, NativeAssemblyPart>();
  private generator?: NativeAssemblyGenerator;

  /** dataDir is an explicit trusted-report directory override, used by tests/tools. */
  constructor(options: { repository?: NativePartRepository; dataDir?: string } = {}) {
    this.repository = options.repository ?? new NativePartRepository();
    this.reportDirectory = path.resolve(options.dataDir ?? ASSEMBLY_REPORT_DIRECTORY);
    this.engine = new AttachmentEngine({ mode: 'production', loadPart: (id) => this.repository.getPart(id), getCapability: (id) => this.getCapability(id) });
  }

  ready(): Promise<void> { this.prepared ??= this.initialize(); return this.prepared; }
  getPart(id: string) { return this.repository.getPart(id); }

  private async initialize(): Promise<void> {
    this.checkedAt = new Date().toISOString();
    let roots: RootRecord[];
    try { roots = (await this.repository.getManifest()).roots; }
    catch (error) { this.runtimeIssues.push(`Native source catalogue is unavailable: ${errorMessage(error)}`); return; }
    let reportValue: unknown;
    try {
      const filename = path.join(this.reportDirectory, 'migration.json');
      if ((await stat(filename)).size > MAX_REPORT_BYTES) throw new Error('Assembly migration report exceeds 48 MiB.');
      const bytes = await readFile(filename);
      if (bytes.length > MAX_REPORT_BYTES) throw new Error('Assembly migration report exceeds 48 MiB.');
      reportValue = JSON.parse(bytes.toString('utf8')); this.reportLoaded = true;
    } catch (error) { this.runtimeIssues.push(`Assembly migration report is unavailable or invalid: ${errorMessage(error)} Production interfaces remain disabled.`); }
    if (reportValue && typeof reportValue === 'object') {
      const report = reportValue as AssemblyMigrationReport;
      const expected = { partLibraryVersion: PART_LIBRARY_VERSION, assemblyEngineVersion: ASSEMBLY_ENGINE_VERSION, connectionRuleVersion: CONNECTION_RULE_VERSION, collisionVersion: COLLISION_VERSION };
      if (report.schemaVersion !== 1 || report.migrationVersion !== ASSEMBLY_MIGRATION_VERSION || report.scope !== 'every-pinned-native-root' || report.verificationScope !== 'only-listed-connection-ids; no physical-build claim' || !Array.isArray(report.entries) || report.entries.length > 10000) this.runtimeIssues.push('Assembly report schema, scope or bounded entries are invalid.');
      else if (Object.entries(expected).some(([key, version]) => report[key as keyof typeof expected] !== version)) this.runtimeIssues.push('Assembly report versions differ from the active source, compatibility, transform or collision engine. Re-run migration with the current versions.');
      else { this.report = report; this.envelopeValid = true; }
    }
    const byId = new Map<string, AssemblyMigrationEntry>(), duplicates = new Set<string>();
    if (this.envelopeValid) for (const candidate of this.report!.entries) {
      if (!entryShape(candidate)) { this.runtimeIssues.push('A malformed migration entry was ignored; its source part will remain blocked.'); continue; }
      if (byId.has(candidate.partId)) duplicates.add(candidate.partId);
      byId.set(candidate.partId, candidate);
    }
    const known = new Set(roots.map((root) => root.partId));
    if ([...byId.keys()].some((id) => !known.has(id))) this.runtimeIssues.push('The report contains IDs outside the current pinned native root set; those records are not admitted.');
    for (const root of roots) {
      let part: NativeAssemblyPart | undefined;
      try { part = await this.repository.getPart(root.partId); if (part) this.sourceParts.set(root.partId, part); }
      catch (error) { this.runtimeIssues.push(`${root.partId}: native source could not be loaded: ${errorMessage(error)}`); }
      const raw = byId.get(root.partId);
      if (!this.envelopeValid || !raw || duplicates.has(root.partId) || !part) {
        const reason = !part ? 'Current native source is unavailable.' : duplicates.has(root.partId) ? 'Duplicate migration decisions exist for this part.' : !this.envelopeValid ? 'A current version-matched assembly verification report is unavailable.' : 'This pinned source part is absent from the saved migration report.';
        this.entries.set(root.partId, blockedEntry(root, part, 'runtime-migration-unavailable', reason));
        if (this.envelopeValid && (!raw || duplicates.has(root.partId))) this.runtimeIssues.push(`${root.partId}: ${reason}`);
        continue;
      }
      this.entries.set(root.partId, await this.validateEntry(root, part, raw));
    }
    this.chooseDefaultPair();
  }

  private async fixtureProblem(part: NativeAssemblyPart, fixture: ConnectionFixtureVerification): Promise<string | null> {
    if (!fixture || fixture.status !== 'verified' || !listOfStrings(fixture.equivalentConnectionIds) || !Array.isArray(fixture.checks) || !fixture.checks.length || fixture.checks.some((check) => !check || check.outcome !== 'passed') || REQUIRED_FIXTURE_CHECKS.some((name) => !fixture.checks.some((check) => check.name === name && check.outcome === 'passed'))) return 'The interface fixture lacks a complete passing assembly test suite.';
    const point = part.connections.points.find((candidate) => candidate.id === fixture.connectionId);
    if (!point || fixture.sourceFile !== point.source.path || fixture.sourceLine !== point.source.line || fixture.sourceHash !== point.source.sha256) return 'Fixture connection evidence does not match the current source endpoint.';
    if (!fixture.fixturePartId || !fixture.fixtureConnectionId || !fixture.fixtureSourceDigest || !fixture.ruleId || fixture.acceptedTwistDeg === null || !Number.isFinite(fixture.acceptedTwistDeg) || !Array.isArray(fixture.compatibleTwistsDeg) || !isRigidTransform(fixture.transform)) return 'Fixture source, seating transform or discrete-rotation evidence is incomplete.';
    let matePart = this.sourceParts.get(fixture.fixturePartId);
    if (!matePart) { matePart = await this.repository.getPart(fixture.fixturePartId); if (matePart) this.sourceParts.set(fixture.fixturePartId, matePart); }
    if (!matePart || nativePartSourceHash(matePart) !== fixture.fixtureSourceDigest || matePart.connections.status !== 'ready') return 'Fixture part source changed or is not fully interpreted.';
    const mate = matePart.connections.points.find((candidate) => candidate.id === fixture.fixtureConnectionId);
    if (!mate) return 'The fixture receiving/mating endpoint no longer exists.';
    const compatibility = checkConnectionCompatibility(point, mate);
    if (compatibility.status !== 'compatible' || compatibility.ruleId !== fixture.ruleId || !compatibility.allowedTwistsDeg.includes(fixture.acceptedTwistDeg) || compatibility.allowedTwistsDeg.some((angle) => !fixture.compatibleTwistsDeg.includes(angle)) || fixture.compatibleTwistsDeg.some((angle) => !compatibility.allowedTwistsDeg.includes(angle))) return 'Saved fixture compatibility or permitted rotations disagree with the active source rule.';
    const solved = solveAttachment({ fixedPart: part, fixedPlacement: { instanceId: 'runtime-evidence-check', partId: part.partId, transform: IDENTITY_TRANSFORM }, fixedConnectionId: point.id, movingPart: matePart, movingConnectionId: mate.id, twistsDeg: [fixture.acceptedTwistDeg] });
    if (!solved.candidates.some((candidate) => equalTransforms(candidate.transform, fixture.transform!))) return 'Saved fixture placement differs from the active source transform solver.';
    return null;
  }

  private async validateEntry(root: RootRecord, part: NativeAssemblyPart, raw: AssemblyMigrationEntry): Promise<AssemblyMigrationEntry> {
    if (raw.source.digest !== nativePartSourceHash(part)) {
      this.runtimeIssues.push(`${root.partId}: migration source digest differs from the actual pinned source closure.`);
      return blockedEntry(root, part, 'runtime-source-mismatch', 'The saved assembly proof belongs to a different source closure. This part is revoked until migration is regenerated.');
    }
    const entry: AssemblyMigrationEntry = structuredClone(raw);
    entry.name = part.geometry.name ?? root.name; entry.selectionBasis = root.selectionBasis;
    entry.source = sourceFingerprint(part, root); entry.geometryReady = part.geometry.status === 'geometryReady'; entry.connectionSourceStatus = part.connections.status;
    entry.physicalBuildVerified = false; entry.wheelModuleVerified = false;
    const sourceChecksPassed = entry.sourceChecks.length > 0 && entry.sourceChecks.every((check) => !!check && check.outcome === 'passed') && entry.sourceChecks.some((check) => check.name === 'source-integrity' && check.outcome === 'passed') && entry.sourceChecks.some((check) => check.name === 'collision' && check.outcome === 'passed');
    const nativeReady = part.geometry.status === 'geometryReady' && part.geometry.source.integrity === 'verified' && part.geometry.source.licenseStatus === 'complete' && !!part.geometry.mesh && part.connections.status === 'ready';
    const originalClaim = raw.status === 'assemblyVerified' && raw.assemblyVerified === true && raw.scope === 'source-backed-tested-interfaces-only' && raw.physicalBuildVerified === false && raw.wheelModuleVerified === false;
    const allowed: string[] = [], problems: string[] = [];
    const validFixtures = new Map<ConnectionFixtureVerification, boolean>();
    if (originalClaim && sourceChecksPassed && nativeReady) {
      for (const id of [...new Set(raw.allowedConnectionIds)]) {
        const point = part.connections.points.find((candidate) => candidate.id === id);
        if (!point || !raw.verifiedConnectionIds.includes(id)) { problems.push(`${id}: the allowlisted source endpoint is absent or not present in the verified set.`); continue; }
        const proof = entry.fixtures.find((fixture) => fixture && fixture.status === 'verified' && (fixture.connectionId === id || fixture.equivalentConnectionIds?.includes(id)));
        const primary = proof && part.connections.points.find((candidate) => candidate.id === proof.connectionId);
        if (!proof || !primary || pointSignature(primary) !== pointSignature(point) || !proof.ruleId || !raw.ruleIds.includes(proof.ruleId)) { problems.push(`${id}: no matching source-bound physical interface fixture is retained.`); continue; }
        if (!validFixtures.has(proof)) {
          try {
            const problem = await this.fixtureProblem(part, proof); validFixtures.set(proof, !problem);
            if (problem) problems.push(`${id}: ${problem}`);
          } catch (error) { validFixtures.set(proof, false); problems.push(`${id}: fixture source validation failed: ${errorMessage(error)}`); }
        }
        if (validFixtures.get(proof)) allowed.push(id);
      }
    }
    const assemblyVerified = originalClaim && sourceChecksPassed && nativeReady && allowed.length > 0;
    entry.status = assemblyVerified ? 'assemblyVerified' : 'blocked'; entry.assemblyVerified = assemblyVerified;
    entry.generatable = assemblyVerified && raw.generatable === true && raw.generatorSmokePassed === true;
    entry.generatorSmokePassed = entry.generatable;
    entry.allowedConnectionIds = allowed; entry.verifiedConnectionIds = [...allowed];
    entry.disabledConnectionIds = part.connections.points.filter((point) => !allowed.includes(point.id)).map((point) => point.id);
    entry.physicalInterfaceCount = new Set(part.connections.points.map(pointSignature)).size;
    entry.deferredConnectionIds = listOfStrings(raw.deferredConnectionIds) ? [...new Set(raw.deferredConnectionIds)].filter((id) => entry.disabledConnectionIds.includes(id)) : [];
    entry.deferredPhysicalInterfaceCount = new Set(part.connections.points.filter((point) => entry.deferredConnectionIds.includes(point.id)).map(pointSignature)).size;
    entry.testedPhysicalInterfaceCount = Number.isSafeInteger(raw.testedPhysicalInterfaceCount) && raw.testedPhysicalInterfaceCount >= 0 ? Math.min(entry.physicalInterfaceCount, raw.testedPhysicalInterfaceCount) : 0;
    entry.ruleIds = [...new Set(entry.fixtures.filter((fixture) => validFixtures.get(fixture) && fixture.ruleId).map((fixture) => fixture.ruleId!))];
    entry.capabilities = assemblyVerified ? ['source-stud-interface-assembly'] : [];
    if (problems.length || raw.assemblyVerified && !assemblyVerified) {
      const reason = problems.length ? `Runtime revoked ${raw.allowedConnectionIds.length - allowed.length} unproven interface IDs: ${problems.slice(0, 8).join(' ')}` : 'Saved flags are not backed by complete current source checks and passing per-interface fixture tests.';
      entry.reasonCodes = [...new Set([...entry.reasonCodes, 'runtime-interface-proof-unverified'])]; entry.reasons = [...new Set([...entry.reasons, reason])];
      this.runtimeIssues.push(`${root.partId}: ${reason}`);
    }
    entry.blockedCategory = assemblyVerified ? null : raw.blockedCategory ?? 'other';
    return entry;
  }

  private chooseDefaultPair() {
    for (const entry of this.entries.values()) {
      if (!entry.assemblyVerified || !entry.generatable) continue;
      for (const fixture of entry.fixtures) {
        const a = entry.allowedConnectionIds.find((id) => fixture.connectionId === id || fixture.equivalentConnectionIds?.includes(id));
        const mate = fixture.fixturePartId ? this.entries.get(fixture.fixturePartId) : undefined;
        if (!a || fixture.status !== 'verified' || !mate?.assemblyVerified || !mate.generatable || !fixture.fixtureConnectionId || fixture.acceptedTwistDeg === null) continue;
        const matePart = this.sourceParts.get(mate.partId), originalMate = matePart?.connections.points.find((point) => point.id === fixture.fixtureConnectionId);
        const b = originalMate && mate.allowedConnectionIds.find((id) => {
          const point = matePart!.connections.points.find((candidate) => candidate.id === id);
          return !!point && pointSignature(point) === pointSignature(originalMate);
        });
        if (b) { this.defaultPair = { partA: entry.partId, connectionA: a, partB: mate.partId, connectionB: b, twistDegrees: fixture.acceptedTwistDeg }; return; }
      }
    }
  }

  async getCapability(partId: string): Promise<AssemblyInterfaceCapability | undefined> {
    await this.ready(); const entry = this.entries.get(partId);
    return entry ? { partId: entry.partId, assemblyVerified: entry.assemblyVerified, generatable: entry.generatable, allowedConnectionIds: [...entry.allowedConnectionIds], ruleIds: [...entry.ruleIds], reasonCodes: [...entry.reasonCodes], reasons: [...entry.reasons] } : undefined;
  }
  async getEntry(partId: string): Promise<AssemblyMigrationEntry | undefined> { await this.ready(); const entry = this.entries.get(partId); return entry ? structuredClone(entry) : undefined; }

  async status(): Promise<RuntimeAssemblyStatus> {
    await this.ready(); const entries = [...this.entries.values()];
    const counts: AssemblyMigrationReport['counts'] = { total: entries.length, assemblyVerified: entries.filter((entry) => entry.assemblyVerified).length, generatable: entries.filter((entry) => entry.generatable).length, blocked: entries.filter((entry) => !entry.assemblyVerified).length, verifiedInterfaces: entries.reduce((sum, entry) => sum + entry.allowedConnectionIds.length, 0), disabledInterfaces: entries.reduce((sum, entry) => sum + entry.disabledConnectionIds.length, 0), testedPhysicalInterfaces: entries.reduce((sum, entry) => sum + entry.testedPhysicalInterfaceCount, 0), deferredPhysicalInterfaces: entries.reduce((sum, entry) => sum + entry.deferredPhysicalInterfaceCount, 0), deferredRawConnectionIds: entries.reduce((sum, entry) => sum + entry.deferredConnectionIds.length, 0), wheelModulesVerified: 0, physicalBuildsVerified: 0 };
    const blockedReasons: AssemblyMigrationReport['blockedReasons'] = { geometry: 0, connection: 0, collision: 0, 'special-assembly': 0, other: 0 };
    for (const entry of entries) if (!entry.assemblyVerified) blockedReasons[entry.blockedCategory && Object.hasOwn(blockedReasons, entry.blockedCategory) ? entry.blockedCategory : 'other']++;
    const batches = [...new Set(entries.map((entry) => entry.batch))].sort().map((batch) => { const rows = entries.filter((entry) => entry.batch === batch); return { batch, total: rows.length, assemblyVerified: rows.filter((entry) => entry.assemblyVerified).length, generatable: rows.filter((entry) => entry.generatable).length, blocked: rows.filter((entry) => !entry.assemblyVerified).length }; });
    const capabilities = await Promise.all(entries.map((entry) => this.getCapability(entry.partId)));
    return structuredClone({
      schemaVersion: 1, migrationVersion: ASSEMBLY_MIGRATION_VERSION, partLibraryVersion: PART_LIBRARY_VERSION, assemblyEngineVersion: ASSEMBLY_ENGINE_VERSION, connectionRuleVersion: CONNECTION_RULE_VERSION, collisionVersion: COLLISION_VERSION,
      generatedAt: this.report?.generatedAt ?? null, scope: 'every-pinned-native-root', verificationScope: 'only-listed-connection-ids; no physical-build claim',
      interfaceBudget: this.report?.interfaceBudget ?? null,
      sourceCounts: { totalRoots: entries.length, geometryReady: entries.filter((entry) => entry.geometryReady).length, connectionReady: entries.filter((entry) => entry.connectionSourceStatus === 'ready').length, connectionPartial: entries.filter((entry) => entry.connectionSourceStatus === 'partial').length, connectionMissing: entries.filter((entry) => entry.connectionSourceStatus === 'missing').length },
      counts, blockedReasons, batches, fixtures: this.report?.fixtures ?? [], representativePairs: this.report?.representativePairs ?? [], entries, queue: entries,
      capabilities: capabilities.filter((entry): entry is AssemblyInterfaceCapability => !!entry), ...(this.defaultPair ? { defaultPair: this.defaultPair } : {}), physicalBuildVerified: false,
      limitations: [...(this.report?.limitations ?? []), 'Runtime capabilities require current source hashes, current engine versions and retained passing fixtures for each allowed source endpoint.', 'Insertion paths are source-axis seating candidates; swept whole-part insertion clearance and physical builds are not certified.'],
      runtimeValidation: { status: !this.envelopeValid ? 'blocked' : this.runtimeIssues.length ? 'partial' : 'ready', issues: [...this.runtimeIssues], reportLoaded: this.reportLoaded, checkedAt: this.checkedAt },
    });
  }

  async attach(request: AssemblyPairAttachRequest): Promise<AttachResult> {
    await this.ready();
    const graph = await this.engine.createAssembly(request.partA);
    return this.engine.attachPart(graph, { anchorInstanceId: graph.placements[0].instanceId, anchorConnectionId: request.connectionA, partId: request.partB, candidateConnectionId: request.connectionB, ...(request.twistDegrees === undefined ? {} : { twistDegrees: request.twistDegrees }) });
  }
  async generate(request: NativeModuleRequest): Promise<NativeGenerationResult> {
    await this.ready(); this.generator ??= new NativeAssemblyGenerator(this.engine);
    const result = await this.generator.generate(request);
    if (result.status === 'generated' && result.model) {
      this.models.set(result.model.id, structuredClone(result.model));
      while (this.models.size > MAX_RETAINED_MODELS) this.models.delete(this.models.keys().next().value!);
    }
    return result;
  }
  getModel(id: string): NativeGeneratedAssembly | undefined { const model = this.models.get(id); return model ? structuredClone(model) : undefined; }
}
