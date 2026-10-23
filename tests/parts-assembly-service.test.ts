import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NativePartRepository, PART_LIBRARY_VERSION } from '../src/parts/assembly/source.js';
import { AssemblyService } from '../src/parts/assembly/service.js';
import { AttachmentEngine } from '../src/parts/assembly/engine.js';
import { runAssemblyMigration, type AssemblyMigrationReport } from '../src/parts/assembly/migration.js';

const repository = new NativePartRepository();
const directories: string[] = [];
let actualReport: AssemblyMigrationReport;

async function directory() { const value = await mkdtemp(path.join(tmpdir(), 'bricklab-service-test-')); directories.push(value); return value; }
async function serviceFor(report?: AssemblyMigrationReport) {
  const dataDir = await directory();
  if (report) await writeFile(path.join(dataDir, 'migration.json'), JSON.stringify(report));
  return new AssemblyService({ repository, dataDir });
}

beforeAll(async () => {
  const manifest = await repository.getManifest();
  const roots = manifest.roots.filter((root) => ['3005', '3024'].includes(root.partId));
  // Actual native source and actual verification engine, limited to two fixture
  // roots for this service test. No provisional flags replace physical tests.
  actualReport = await runAssemblyMigration({
    engine: new AttachmentEngine({ loadPart: (id) => repository.getPart(id), mode: 'verification' }),
    sourceLoader: { roots, partLibraryVersion: PART_LIBRARY_VERSION, geometryRevision: manifest.revision, async loadPart(id) { const part = await repository.getPart(id); if (!part) throw new Error('Missing actual native fixture.'); return part; } },
  });
  expect(actualReport.entries).toHaveLength(2);
  expect(actualReport.entries.every((entry) => entry.assemblyVerified && entry.generatable)).toBe(true);
}, 30000);
afterAll(async () => { await Promise.all(directories.map((filename) => rm(filename, { recursive: true, force: true }))); });

describe('runtime assembly service admission', () => {
  it('keeps every native root blocked when the report is missing and never runs migration from ready()', async () => {
    const service = await serviceFor(), spy = vi.spyOn(service.engine, 'attachPart');
    await service.ready();
    const status = await service.status();
    expect(status.counts.total).toBe((await repository.listIds()).length);
    expect(status.counts.assemblyVerified).toBe(0);
    expect(status.counts.generatable).toBe(0);
    expect(status.counts.blocked).toBe(status.counts.total);
    expect(status.runtimeValidation.status).toBe('blocked');
    expect(status.runtimeValidation.issues[0]).toContain('report');
    expect(status.defaultPair).toBeUndefined();
    expect(status.physicalBuildVerified).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    expect(service.getModel('client-supplied-model')).toBeUndefined();
  }, 20000);

  it('admits only retained current native fixture proofs and derives a working default pair', async () => {
    const service = await serviceFor(actualReport), status = await service.status();
    expect(status.counts.assemblyVerified).toBe(2);
    expect(status.counts.generatable).toBe(2);
    // The remainder of the real library is explicitly absent/blocked in this
    // deliberately small test report, rather than disappearing from its queue.
    expect(status.queue).toHaveLength((await repository.listIds()).length);
    expect(status.runtimeValidation.status).toBe('partial');
    expect(status.defaultPair).toBeDefined();
    const attached = await service.attach(status.defaultPair!);
    expect(attached.accepted).toBe(true);
    expect(attached.graph.physicalBuildVerified).toBe(false);
    expect(attached.graph.placements).toHaveLength(2);
    expect((await service.engine.validateGraph(attached.graph)).valid).toBe(true);
    const capability = (await service.getCapability('3005'))!;
    capability.allowedConnectionIds.length = 0;
    expect((await service.getCapability('3005'))!.allowedConnectionIds.length).toBeGreaterThan(0);
    const entry = (await service.getEntry('3005'))!; entry.generatable = false;
    expect((await service.getEntry('3005'))!.generatable).toBe(true);
  }, 20000);

  it('revokes a report with changed engine versions even when it contains passing flags', async () => {
    const report = structuredClone(actualReport); report.collisionVersion = 'old-collision-engine';
    const service = await serviceFor(report), status = await service.status();
    expect(status.counts.generatable).toBe(0);
    expect(status.runtimeValidation.status).toBe('blocked');
    expect(status.runtimeValidation.issues.join(' ')).toContain('versions');
  }, 20000);

  it('revokes only the source-mismatched entry without granting its old interfaces', async () => {
    const report = structuredClone(actualReport); report.entries.find((entry) => entry.partId === '3005')!.source.digest = '0'.repeat(64);
    const service = await serviceFor(report);
    expect((await service.getCapability('3005'))).toMatchObject({ assemblyVerified: false, generatable: false, allowedConnectionIds: [], reasonCodes: ['runtime-source-mismatch'] });
    expect((await service.getCapability('3024'))?.generatable).toBe(true);
    expect((await service.status()).counts.generatable).toBe(1);
  }, 20000);

  it('refuses unproved allowlists while retaining other independently proved parts', async () => {
    const report = structuredClone(actualReport), changed = report.entries.find((entry) => entry.partId === '3005')!;
    changed.fixtures = [];
    expect(changed.assemblyVerified && changed.generatable).toBe(true);
    const service = await serviceFor(report), capability = (await service.getCapability('3005'))!;
    expect(capability).toMatchObject({ assemblyVerified: false, generatable: false, allowedConnectionIds: [] });
    expect(capability.reasonCodes).toContain('runtime-interface-proof-unverified');
    expect((await service.getCapability('3024'))?.generatable).toBe(true);
  }, 20000);

  it('does not promote invented endpoint IDs or changed fixture source evidence', async () => {
    const report = structuredClone(actualReport), changed = report.entries.find((entry) => entry.partId === '3005')!;
    changed.allowedConnectionIds.push('invented-endpoint'); changed.verifiedConnectionIds.push('invented-endpoint');
    const service = await serviceFor(report), capability = (await service.getCapability('3005'))!;
    expect(capability.generatable).toBe(true);
    expect(capability.allowedConnectionIds).not.toContain('invented-endpoint');
    const changedFixtureReport = structuredClone(actualReport);
    for (const fixture of changedFixtureReport.entries.find((entry) => entry.partId === '3005')!.fixtures) if (fixture.status === 'verified') fixture.fixtureSourceDigest = 'f'.repeat(64);
    const rejected = await serviceFor(changedFixtureReport);
    expect((await rejected.getCapability('3005'))).toMatchObject({ assemblyVerified: false, generatable: false, allowedConnectionIds: [] });
  }, 20000);
});
