import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NativePartRepository } from '../src/parts/assembly/source.js';
import { runDeferredInterfaces, validInterfaceCheckpoint, type DeferredRunnerResult } from '../src/parts/assembly/deferredRunner.js';
import { groupPhysicalInterfaces, type PhysicalConnectionGroup } from '../src/parts/assembly/interfaces.js';
import { buildPhysicalInterfaceCoverage } from '../src/parts/assembly/coverage.js';
import { INTERFACE_TEST_VERSION } from '../src/parts/assembly/deferredTypes.js';
import type { NativeAssemblyPart } from '../src/parts/assembly/types.js';

const repository = new NativePartRepository();
const directories: string[] = [];
let brick: NativeAssemblyPart;
let plate: NativeAssemblyPart;
let group: PhysicalConnectionGroup;
let checkpointDirectory: string;
let firstRun: DeferredRunnerResult;

async function directory() { const value = await mkdtemp(path.join(tmpdir(), 'bricklab-deferred-test-')); directories.push(value); return value; }
function options(root: string) {
  return { repository, checkpointDirectory: root, concurrency: 1, batchSize: 1, timeoutMs: 8000, startupTimeoutMs: 30000, partBudgetMs: 0, maxRetries: 0,
    partIds: ['3005'], physicalInterfaceIds: [group.physicalInterfaceId] };
}
beforeAll(async () => {
  brick = (await repository.getPart('3005'))!;
  plate = (await repository.getPart('3024'))!;
  group = groupPhysicalInterfaces(brick).find(value => value.points[0].gender === 'M')!;
  expect(group).toBeDefined();
  checkpointDirectory = await directory();
  firstRun = await runDeferredInterfaces(options(checkpointDirectory));
}, 40000);
afterAll(async () => { await Promise.all(directories.map(root => rm(root, { recursive: true, force: true }))); });

describe('source-bound deferred interface runner', () => {
  it('runs one actual native interface through the isolated fixture and retains complete current evidence', () => {
    expect(firstRun.interrupted).toBe(false);
    expect(firstRun.parts).toHaveLength(1);
    const result = firstRun.parts[0];
    expect(result.records).toHaveLength(1);
    const record = result.records[0];
    expect(record.status, record.reasons.join(' ')).toBe('PASS');
    expect(record.execution).toBe('direct-test');
    expect(record.physicalInterfaceId).toBe(group.physicalInterfaceId);
    expect(record.rawConnectionIds).toEqual(group.rawConnectionIds);
    expect(record.testVersion).toBe(INTERFACE_TEST_VERSION);
    expect(record.context).toMatchObject(result.context);
    for (const field of ['partSourceHash', 'geometryHash', 'connectionMetadataHash', 'fixtureSetHash', 'contextId'] as const) expect(record.context[field]).toMatch(/^[a-f0-9]{64}$/);
    expect(record.fixtureSourceHash).toBe(record.proof?.fixtureSourceDigest);
    expect(record.proof?.checks.every(check => check.outcome === 'passed')).toBe(true);
    expect(validInterfaceCheckpoint(record, result.context, group)).toBe(true);
  });

  it('resumes only the exact tested source and fixture context', async () => {
    const events: { cached: boolean }[] = [];
    const resumed = await runDeferredInterfaces({ ...options(checkpointDirectory), onProgress: event => { events.push(event); } });
    expect(resumed.resumedRecords).toBe(1);
    expect(resumed.parts[0].records).toHaveLength(1);
    expect(resumed.parts[0].records[0]).toEqual(firstRun.parts[0].records[0]);
    expect(events).toHaveLength(1);
    expect(events[0].cached).toBe(true);
  }, 30000);

  it('rejects changed geometry, metadata, fixture and test provenance instead of reusing a PASS', () => {
    const result = firstRun.parts[0], original = result.records[0];
    const changes = [
      (record: typeof original) => { record.context.geometryHash = '1'.repeat(64); },
      (record: typeof original) => { record.context.connectionMetadataHash = '2'.repeat(64); },
      (record: typeof original) => { record.context.fixtureSetHash = '3'.repeat(64); },
      (record: typeof original) => { record.testVersion = 'old-test-suite'; },
      (record: typeof original) => { record.fixtureSourceHash = '4'.repeat(64); },
      (record: typeof original) => { record.proof!.fixtureSourceDigest = '5'.repeat(64); },
      (record: typeof original) => { record.context.assemblyEngineVersion = 'old-engine'; },
      (record: typeof original) => { record.rawConnectionIds = ['invented-source-port']; },
    ];
    for (const change of changes) {
      const modified = structuredClone(original); change(modified);
      expect(validInterfaceCheckpoint(modified, result.context, group)).toBe(false);
    }
  });

  it('rejects malformed proof arrays instead of trusting or crashing on a cached PASS', () => {
    const result = firstRun.parts[0], original = result.records[0];
    for (const property of ['checks', 'equivalentConnectionIds']) for (const value of [null, {}, 'not-an-array']) {
      const malformed = structuredClone(original);
      Object.assign(malformed.proof!, { [property]: value });
      expect(validInterfaceCheckpoint(malformed, result.context, group)).toBe(false);
    }
  });

  it('retests a tampered persisted PASS and replaces it with actual fresh evidence', async () => {
    const result = firstRun.parts[0], filename = path.join(checkpointDirectory, result.context.contextId, `${group.physicalInterfaceId}.json`);
    const modified = JSON.parse(await readFile(filename, 'utf8')) as typeof result.records[number];
    modified.proof!.fixtureSourceDigest = 'f'.repeat(64);
    await writeFile(filename, JSON.stringify(modified));
    const rerun = await runDeferredInterfaces(options(checkpointDirectory));
    expect(rerun.resumedRecords).toBe(0);
    expect(rerun.parts[0].records[0].status).toBe('PASS');
    expect(rerun.parts[0].records[0].fixtureSourceHash).toBe(rerun.parts[0].records[0].proof!.fixtureSourceDigest);
    expect(validInterfaceCheckpoint(rerun.parts[0].records[0], rerun.parts[0].context, group)).toBe(true);
  }, 30000);

  it('rejects invalid scheduling and unknown source targets', async () => {
    const root = await directory();
    await expect(runDeferredInterfaces({ ...options(root), concurrency: 0 })).rejects.toThrow(/settings/);
    await expect(runDeferredInterfaces({ ...options(root), partIds: ['invented-source-part'] })).rejects.toThrow(/unknown native/);
    await expect(runDeferredInterfaces({ ...options(root), physicalInterfaceIds: ['a'.repeat(64)] })).rejects.toThrow(/physical|interface|source/i);
  }, 30000);

  it('leaves a target pending only when the run is explicitly interrupted', async () => {
    const controller = new AbortController(); controller.abort();
    const interrupted = await runDeferredInterfaces({ ...options(await directory()), signal: controller.signal });
    expect(interrupted.interrupted).toBe(true);
    expect(interrupted.parts[0].records).toHaveLength(1);
    expect(interrupted.parts[0].records[0]).toMatchObject({ status: 'PENDING', interrupted: true, reasonCodes: ['explicitly-interrupted'] });
    expect(interrupted.resumedRecords).toBe(0);
  }, 30000);

  it('keeps source aliases, processed results and verified coverage separate', () => {
    const groups = groupPhysicalInterfaces(plate);
    expect(plate.connections.points).toHaveLength(3);
    expect(groups).toHaveLength(2);
    const decisions = groups.map((value, index) => ({ physicalInterfaceId: value.physicalInterfaceId, rawConnectionIds: value.rawConnectionIds,
      status: index === 0 ? 'BLOCKED' as const : 'REQUIRES_ASTRA_REVIEW' as const, reasonCodes: ['test-only-nonpass-coverage'], reasons: ['Testing terminal accounting only; no production assembly approval.'] }));
    const coverage = buildPhysicalInterfaceCoverage(plate, decisions);
    expect(coverage).toMatchObject({ rawSourceConnectionRecords: 3, physicalInterfacesDiscovered: 2, verifiedPass: 0, verifiedBlocked: 1, requiresAstraReview: 1, pending: 0,
      verifiedCoveragePercent: 0, processedCoveragePercent: 100, fullyAssemblyVerified: false, interfaceVerificationComplete: true, partiallyGeneratable: false, enabledPhysicalInterfaces: 0, enabledRawConnectionIds: 0 });
    const partial = buildPhysicalInterfaceCoverage(brick, [firstRun.parts[0].records[0]], group.rawConnectionIds);
    expect(partial).toMatchObject({ verifiedPass: 1, pending: 1, verifiedCoveragePercent: 50, processedCoveragePercent: 50, fullyAssemblyVerified: false, interfaceVerificationComplete: false, partiallyGeneratable: true });
  });
});
