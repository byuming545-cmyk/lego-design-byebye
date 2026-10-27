import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { InterfaceTestRecord } from '../src/parts/assembly/deferredTypes.js';
import { groupPhysicalInterfaces } from '../src/parts/assembly/interfaces.js';
import { NativePartRepository } from '../src/parts/assembly/source.js';
import type { AssemblyVersions, NativeAssemblyPart } from '../src/parts/assembly/types.js';
import {
  currentHandoffVersions, handoffPartFingerprint, loadAstraCase, replayAstraOperation, reproduceAstraCase,
  type AstraCase, type AstraReplay,
} from '../src/parts/handoff/cases.js';
import { createBundledElementDesignMapper } from '../src/parts/recovery/mapper.js';

// Every diagnostic below is built by the production replay against the pinned source.
// The only altered native data are explicit stale-source simulations, never successful meshes or mates.
const repository = new NativePartRepository();
const temporaryRoots: string[] = [];
let mapper: Awaited<ReturnType<typeof createBundledElementDesignMapper>>;
let nativeCase: AstraCase, wheelCase: AstraCase;
let mappingCases: AstraCase[];
let fixtureCase: AstraCase | undefined;

async function actualCase(caseId: string, replay: AstraReplay): Promise<AstraCase> {
  const actual = await replayAstraOperation(replay, repository);
  const partIds = [...new Set([replay.partId, replay.fixturePartId].filter((id): id is string => !!id))];
  const parts = await Promise.all(partIds.map(id => repository.getPart(id)));
  if (parts.some(part => !part)) throw new Error('The real pinned test source is unavailable.');
  const mapping = replay.kind === 'mapping' ? mapper.resolve(replay.elementId!) : undefined;
  return {
    schemaVersion: 1, caseId,
    category: replay.kind === 'mapping' ? mapping!.mappingStatus === 'CONFLICT' ? 'MAPPING_CONFLICT' : 'MAPPING_EVIDENCE_MISSING'
      : replay.kind === 'parse' ? 'CONNECTION_PARSE' : 'WHEEL_ASSEMBLY',
    versions: currentHandoffVersions(),
    affectedParts: mapping ? [{ partId: mapping.partId!, identitySystem: 'rebrickable', ldrawId: null, sourceDigest: mapping.source!.sha256, geometryHash: null, connectionMetadataHash: null }]
      : parts.map(part => handoffPartFingerprint(part!)),
    ...(mapping ? { affectedElements: [mapping.elementId], mappingSourceFingerprint: mapper.getSourceFingerprint() } : {}),
    ...(replay.kind === 'fixture' ? { fixtureTestContext: (actual.details as InterfaceTestRecord).context } : {}),
    connections: actual.connections, currentTransform: actual.transform,
    transformStatus: mapping ? 'NOT_APPLICABLE' : actual.transform ? 'SOLVED_CANDIDATE' : 'UNRESOLVED',
    expectedBehavior: { status: 'EXPECTED_UNKNOWN', explanation: 'This diagnostic has no independently established physical mating expectation.' },
    actualBehavior: { status: actual.status, reasonCodes: actual.reasonCodes, details: actual.details }, replay,
    reproductionCommand: `npm run astra:case -- ${caseId}`, relevantSourceFiles: [], relevantTests: ['tests/parts-astra-handoff.test.ts'],
    evidence: [], attemptsAlreadyMade: ['Replayed the actual pinned native or catalogue source without production permissions.'],
    whySolStopped: 'The missing semantic or identity evidence is preserved for review.', diagnosticOnly: true,
  };
}

async function actualFixtureCase(): Promise<AstraCase> {
  if (fixtureCase) return fixtureCase;
  const part = await repository.getPart('3005');
  const physicalInterface = part && groupPhysicalInterfaces(part)[0];
  if (!physicalInterface) throw new Error('The real 3005 physical interface is unavailable.');
  fixtureCase = await actualCase('FIXTURE-3005', {
    kind: 'fixture', partId: '3005', physicalInterfaceId: physicalInterface.physicalInterfaceId, timeoutMs: 8_000,
  });
  return fixtureCase;
}

async function saveManifest(record: AstraCase) {
  const root = await mkdtemp(path.join(tmpdir(), 'bricklab-astra-handoff-'));
  temporaryRoots.push(root);
  const relative = `cases/${record.caseId}/case.json`, filename = path.join(root, relative);
  const bytes = JSON.stringify(record, null, 2) + '\n';
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, bytes);
  const manifest = { schemaVersion: 1, cases: [{ caseId: record.caseId, path: relative, sha256: createHash('sha256').update(bytes).digest('hex') }] };
  await writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest));
  return { root, filename, manifest };
}

beforeAll(async () => {
  mapper = await createBundledElementDesignMapper();
  const snapshot = JSON.parse(await readFile(new URL('../data/parts-foundation/mappings/element-rows.json', import.meta.url), 'utf8')) as { requestedElementIds: string[] };
  mappingCases = [];
  for (const status of ['CONFLICT', 'PROBABLE_BUT_UNVERIFIED'] as const) {
    const elementId = snapshot.requestedElementIds.find(id => mapper.resolve(id).mappingStatus === status);
    if (!elementId) throw new Error(`The real mapping review no longer contains a ${status} example.`);
    mappingCases.push(await actualCase(`MAP-${status.replaceAll('_', '-')}`, { kind: 'mapping', elementId }));
  }
  nativeCase = await actualCase('PARSE-3673', { kind: 'parse', partId: '3673' });
  const wheel = await repository.getPart('4624'), tyre = await repository.getPart('3641');
  const male = wheel?.connections.points.find(point => point.family === 'wheelMount' && point.gender === 'M');
  const female = tyre?.connections.points.find(point => point.family === 'wheelMount' && point.gender === 'F' && point.group === male?.group);
  if (!male || !female) throw new Error('The real wheel/tyre source endpoints are unavailable.');
  wheelCase = await actualCase('WHEEL-TYRE', { kind: 'interface', partId: '4624', connectionId: male.id, fixturePartId: '3641', fixtureConnectionId: female.id });
});

afterAll(async () => { await Promise.all(temporaryRoots.map(root => rm(root, { recursive: true, force: true }))); });

describe('source-bound Astra diagnostic handoff', () => {
  it('replays real conflicting and probable mappings without converting either into a geometry permission', async () => {
    expect(mappingCases.map(record => record.actualBehavior.status)).toEqual(['CONFLICT', 'PROBABLE_BUT_UNVERIFIED']);
    for (const record of mappingCases) {
      const result = await reproduceAstraCase(record, repository);
      expect(result.reproduced).toBe(true);
      expect(result.actual.status).toBe(record.actualBehavior.status);
      expect(result.actual.details).toMatchObject({ independentlyVerifiedOfficial: false, geometryPipelineAllowed: false, ldrawPartId: null });
      expect(result).toMatchObject({ diagnosticOnly: true, physicalBuildVerified: false, expected: { status: 'EXPECTED_UNKNOWN' } });
      expect(result).not.toHaveProperty('generatable');
      expect(result).not.toHaveProperty('model');
    }
  });

  it('keeps the real wheel/tyre result unknown and distinguishes reproduced diagnostics from physical PASS', async () => {
    const result = await reproduceAstraCase(wheelCase, repository);
    expect(wheelCase.connections).toHaveLength(2);
    expect(wheelCase.currentTransform).toBeNull();
    expect(result).toMatchObject({ reproduced: true, diagnosticOnly: true, physicalBuildVerified: false, expected: { status: 'EXPECTED_UNKNOWN' }, actual: { status: 'unknown', reasonCodes: ['grouped-interface-seating-unresolved'] } });
    expect(result).not.toHaveProperty('assemblyVerified');
    expect(result).not.toHaveProperty('generatable');
  });

  it('replays one real source-bound 3005 fixture PASS as a diagnostic without promoting a model or production permission', async () => {
    const record = await actualFixtureCase();
    const result = await reproduceAstraCase(record, repository);
    expect(record.fixtureTestContext?.partId).toBe('3005');
    expect(record.fixtureTestContext?.fixtureSetHash).toMatch(/^[a-f0-9]{64}$/);
    expect(record.actualBehavior).toMatchObject({
      status: 'PASS', details: { physicalInterfaceId: record.replay.physicalInterfaceId, context: record.fixtureTestContext },
    });
    expect(result).toMatchObject({
      reproduced: true, diagnosticOnly: true, physicalBuildVerified: false,
      expected: { status: 'EXPECTED_UNKNOWN' }, actual: { status: 'PASS' },
    });
    expect(result).not.toHaveProperty('model');
    expect(result).not.toHaveProperty('assemblyVerified');
    expect(result).not.toHaveProperty('generatable');
  }, 20_000);

  it.each(['fixtureSetHash', 'testVersion', 'missingContext'] as const)('requires revalidation before replay when the exact fixture context has changed: %s', async change => {
    const stale = structuredClone(await actualFixtureCase());
    if (change === 'missingContext') delete stale.fixtureTestContext;
    else if (change === 'fixtureSetHash') stale.fixtureTestContext!.fixtureSetHash = '0'.repeat(64);
    else stale.fixtureTestContext!.testVersion += '-changed';
    await expect(reproduceAstraCase(stale, repository)).rejects.toThrow(/Fixture source or test context changed: NEEDS_REVALIDATION/);
  }, 12_000);

  it.each(Object.keys(currentHandoffVersions()) as (keyof AssemblyVersions)[])('rejects replay when %s changes', async version => {
    const stale = structuredClone(nativeCase);
    stale.versions[version] += '-changed';
    await expect(reproduceAstraCase(stale, repository)).rejects.toThrow(/versions differ/);
  });

  it.each(['geometry', 'connection'] as const)('rejects changed native %s source fingerprints while retaining the actual source geometry', async source => {
    class ChangedSourceRepository extends NativePartRepository {
      override async getPart(partId: string): Promise<NativeAssemblyPart | undefined> {
        const original = await repository.getPart(partId);
        if (!original) return undefined;
        const changed = structuredClone(original);
        const file = source === 'geometry' ? changed.geometry.source.files[0] : changed.connections.sourceFiles[0];
        file.sha256 = '0'.repeat(64);
        expect(changed.geometry.mesh).toEqual(original.geometry.mesh);
        return changed;
      }
    }
    await expect(reproduceAstraCase(nativeCase, new ChangedSourceRepository())).rejects.toThrow(/source fingerprint changed/);
  });

  it('binds replay to both exact native endpoint sources and rejects missing or duplicated declarations', async () => {
    for (const affectedParts of [[], wheelCase.affectedParts.slice(0, 1), [wheelCase.affectedParts[0], wheelCase.affectedParts[0]]]) {
      await expect(reproduceAstraCase({ ...wheelCase, affectedParts }, repository)).rejects.toThrow(/exact, unique source fingerprints/);
    }
    const wrongIdentity = structuredClone(wheelCase);
    wrongIdentity.affectedParts[1].ldrawId = wrongIdentity.affectedParts[0].ldrawId;
    await expect(reproduceAstraCase(wrongIdentity, repository)).rejects.toThrow(/exact, unique source fingerprints/);
  });

  it('rejects stale mapping evidence or an Element ID detached from the declared affected elements', async () => {
    const stale = structuredClone(mappingCases[0]);
    stale.mappingSourceFingerprint!.reviewSnapshotSha256 = '0'.repeat(64);
    await expect(reproduceAstraCase(stale, repository)).rejects.toThrow(/Mapping source changed/);
    await expect(reproduceAstraCase({ ...mappingCases[0], affectedElements: [] }, repository)).rejects.toThrow(/bound to its affected Element IDs/);
  });

  it('loads and replays a temporary manifest containing an actual pinned-source diagnostic', async () => {
    const { root } = await saveManifest(nativeCase);
    const loaded = await loadAstraCase(nativeCase.caseId, root);
    expect(loaded.affectedParts).toEqual(nativeCase.affectedParts);
    expect(await reproduceAstraCase(loaded, repository)).toMatchObject({ reproduced: true, physicalBuildVerified: false, actual: { status: 'ready' } });
  });

  it('rejects case-byte tampering and a tampered manifest case SHA', async () => {
    const changedBytes = await saveManifest(nativeCase);
    await writeFile(changedBytes.filename, JSON.stringify({ ...nativeCase, whySolStopped: 'Changed after manifest hashing.' }));
    await expect(loadAstraCase(nativeCase.caseId, changedBytes.root)).rejects.toThrow(/integrity verification failed/);
    const changedHash = await saveManifest(nativeCase);
    changedHash.manifest.cases[0].sha256 = '0'.repeat(64);
    await writeFile(path.join(changedHash.root, 'manifest.json'), JSON.stringify(changedHash.manifest));
    await expect(loadAstraCase(nativeCase.caseId, changedHash.root)).rejects.toThrow(/integrity verification failed/);
  });

  it.each(['../PARSE-3673', '/PARSE-3673', 'A/B', '%2E%2E', 'A\\B'])('rejects the unsafe case ID %s before file access', async id => {
    await expect(loadAstraCase(id, '/does-not-exist')).rejects.toThrow(/Invalid Astra case ID/);
  });

  it('rejects a manifest path that escapes the case directory', async () => {
    const { root, manifest } = await saveManifest(nativeCase);
    manifest.cases[0].path = '../outside.json';
    await writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest));
    await expect(loadAstraCase(nativeCase.caseId, root)).rejects.toThrow(/escapes its manifest directory/);
  });

  it('rejects a physical PASS expectation even if the modified case has a valid manifest hash', async () => {
    const physicalExpectation = structuredClone(wheelCase);
    Object.assign(physicalExpectation.expectedBehavior, { status: 'PASS' });
    await expect(reproduceAstraCase(physicalExpectation, repository)).rejects.toThrow(/physical expectation/);
    const { root } = await saveManifest(physicalExpectation);
    await expect(loadAstraCase(physicalExpectation.caseId, root)).rejects.toThrow(/unsupported physical expectation/);
  });

  it('rejects unsupported replay kinds and does not treat changed recorded results as reproduced', async () => {
    const unknownKind = structuredClone(nativeCase);
    Object.assign(unknownKind.replay, { kind: 'invented-physical-pass' });
    await expect(reproduceAstraCase(unknownKind, repository)).rejects.toThrow(/Unsupported diagnostic case/);
    const different = structuredClone(nativeCase);
    different.actualBehavior.status = 'invented-physical-pass';
    const result = await reproduceAstraCase(different, repository);
    expect(result).toMatchObject({ reproduced: false, physicalBuildVerified: false, actual: { status: 'ready' } });
  });
});
