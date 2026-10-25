import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NativePartRepository, PART_LIBRARY_VERSION } from '../src/parts/assembly/source.js';
import { AssemblyService } from '../src/parts/assembly/service.js';
import { AttachmentEngine } from '../src/parts/assembly/engine.js';
import { runAssemblyMigration, type AssemblyMigrationReport } from '../src/parts/assembly/migration.js';
import { groupPhysicalInterfaces } from '../src/parts/assembly/interfaces.js';
import { INTERFACE_TEST_VERSION } from '../src/parts/assembly/deferredTypes.js';

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
  expect(actualReport.testVersion).toBe(INTERFACE_TEST_VERSION);
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
    expect(status.testVersion).toBe(INTERFACE_TEST_VERSION);
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

  it.each(['partLibraryVersion', 'assemblyEngineVersion', 'connectionRuleVersion', 'collisionVersion'] as const)('revokes a report with changed %s even when it contains passing flags', async (version) => {
    const report = structuredClone(actualReport); report[version] = `old-${version}`;
    const service = await serviceFor(report), status = await service.status();
    expect(status.counts.generatable).toBe(0);
    expect(status.runtimeValidation.status).toBe('blocked');
    expect(status.runtimeValidation.issues.join(' ')).toContain('versions');
    expect(status.interfaceCoverage).toMatchObject({ verifiedPass: 0, enabledPhysicalInterfaces: 0, enabledRawConnectionIds: 0 });
  }, 20000);

  it.each(['missing', 'stale'] as const)('revokes %s verification suite evidence instead of inheriting passing flags', async (mode) => {
    const report = structuredClone(actualReport);
    if (mode === 'missing') delete (report as Partial<AssemblyMigrationReport>).testVersion;
    else report.testVersion = 'old-interface-suite';
    expect(report.entries.every(entry => entry.assemblyVerified && entry.generatable)).toBe(true);
    const service = await serviceFor(report), status = await service.status();
    expect(status.counts.generatable).toBe(0);
    expect(status.runtimeValidation.status).toBe('blocked');
    expect(status.runtimeValidation.issues.join(' ')).toContain('verification suite versions');
    expect(status.interfaceCoverage).toMatchObject({ verifiedPass: 0, enabledPhysicalInterfaces: 0 });
    await expect(service.engine.createAssembly('3005')).rejects.toThrow();
  }, 20000);

  it.each(['stale-deferred', 'missing-deferred-version', 'stale-top-current-deferred'] as const)('revokes contradictory verification evidence: %s', async (mode) => {
    const report = structuredClone(actualReport);
    report.deferredRun = { targetCount: 0, pass: 0, blocked: 0, requiresAstraReview: 0, pending: 0, directTests: 0, sharedPrecondition: 0, reviewDependency: 0, interrupted: false, checkpointDirectory: 'test-report-metadata-only', testVersion: INTERFACE_TEST_VERSION };
    if (mode === 'stale-deferred') report.deferredRun.testVersion = 'old-interface-suite';
    else if (mode === 'missing-deferred-version') delete (report.deferredRun as Partial<NonNullable<AssemblyMigrationReport['deferredRun']>>).testVersion;
    else report.testVersion = 'old-interface-suite';
    const status = await (await serviceFor(report)).status();
    expect(status.counts.generatable).toBe(0);
    expect(status.runtimeValidation.status).toBe('blocked');
    expect(status.runtimeValidation.issues.join(' ')).toContain('verification suite versions');
  }, 20000);

  it('revokes only the source-mismatched entry without granting its old interfaces', async () => {
    const report = structuredClone(actualReport); report.entries.find((entry) => entry.partId === '3005')!.source.digest = '0'.repeat(64);
    const service = await serviceFor(report);
    expect((await service.getCapability('3005'))).toMatchObject({ assemblyVerified: false, generatable: false, allowedConnectionIds: [], reasonCodes: ['runtime-source-mismatch'] });
    expect((await service.getCapability('3024'))?.generatable).toBe(true);
    const status = await service.status();
    expect(status.counts.generatable).toBe(1);
    expect((await service.getEntry('3005'))!.interfaceCoverage).toMatchObject({ verifiedPass: 0, enabledPhysicalInterfaces: 0, enabledRawConnectionIds: 0 });
  }, 20000);

  it('revokes source evidence produced under an older connector parser even when its native bytes are unchanged', async () => {
    const part = (await repository.getPart('3005'))!;
    let olderParserDigest: string;
    // Exercise the real digest function under a different parser dependency,
    // rather than replacing source bytes or fabricating a physical PASS.
    vi.resetModules();
    vi.doMock('../src/parts/connections/importer.js', async (importOriginal) => ({
      ...await importOriginal<typeof import('../src/parts/connections/importer.js')>(),
      CONNECTION_PARSER_VERSION: 'older-connector-parser',
    }));
    try {
      const oldSource = await import('../src/parts/assembly/source.js');
      olderParserDigest = oldSource.nativePartSourceHash(part);
    } finally {
      vi.doUnmock('../src/parts/connections/importer.js');
      vi.resetModules();
    }
    const report = structuredClone(actualReport), entry = report.entries.find(value => value.partId === '3005')!;
    expect(olderParserDigest).not.toBe(entry.source.digest);
    entry.source.digest = olderParserDigest;
    expect(entry.assemblyVerified && entry.generatable).toBe(true);
    const service = await serviceFor(report);
    expect(await service.getCapability('3005')).toMatchObject({ assemblyVerified: false, generatable: false, allowedConnectionIds: [], reasonCodes: ['runtime-source-mismatch'] });
    expect((await service.getCapability('3024'))!.generatable).toBe(true);
  }, 20000);

  it('revokes source evidence produced under an older geometry parser even when its native bytes are unchanged', async () => {
    const part = (await repository.getPart('3005'))!;
    let olderParserDigest: string;
    vi.resetModules();
    vi.doMock('../src/parts/ldraw/importer.js', async (importOriginal) => ({
      ...await importOriginal<typeof import('../src/parts/ldraw/importer.js')>(),
      LDRAW_GEOMETRY_PARSER_VERSION: 'older-geometry-parser',
    }));
    try {
      const oldSource = await import('../src/parts/assembly/source.js');
      olderParserDigest = oldSource.nativePartSourceHash(part);
    } finally {
      vi.doUnmock('../src/parts/ldraw/importer.js');
      vi.resetModules();
    }
    const report = structuredClone(actualReport), entry = report.entries.find(value => value.partId === '3005')!;
    expect(olderParserDigest).not.toBe(entry.source.digest);
    entry.source.digest = olderParserDigest;
    expect(entry.assemblyVerified && entry.generatable).toBe(true);
    const service = await serviceFor(report);
    expect(await service.getCapability('3005')).toMatchObject({ assemblyVerified: false, generatable: false, allowedConnectionIds: [], reasonCodes: ['runtime-source-mismatch'] });
    expect((await service.getCapability('3024'))!.generatable).toBe(true);
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

  it('deduplicates actual physical interfaces and ignores forged cached coverage totals', async () => {
    const baseline = await serviceFor(actualReport), trusted = (await baseline.getEntry('3024'))!;
    const native = (await repository.getPart('3024'))!, groups = groupPhysicalInterfaces(native);
    expect(native.connections.points).toHaveLength(3); expect(groups).toHaveLength(2);
    expect(trusted.interfaceCoverage).toMatchObject({ rawSourceConnectionRecords: 3, physicalInterfacesDiscovered: 2, verifiedPass: 2, enabledPhysicalInterfaces: 2, enabledRawConnectionIds: 3 });
    const report = structuredClone(actualReport), row = report.entries.find((entry) => entry.partId === '3024')!;
    row.interfaceCoverage = structuredClone(trusted.interfaceCoverage!);
    Object.assign(row.interfaceCoverage, { rawSourceConnectionRecords: 999999, physicalInterfacesDiscovered: 999999, verifiedPass: 999999, enabledPhysicalInterfaces: 999999, enabledRawConnectionIds: 999999, verifiedCoveragePercent: 100 });
    Object.assign(report.counts, { total: 999999, generatable: 999999, verifiedInterfaces: 999999 });
    (report as unknown as Record<string, unknown>).interfaceCoverage = { physicalInterfacesDiscovered: 999999, verifiedPass: 999999, enabledRawConnectionIds: 999999 };
    const service = await serviceFor(report), current = (await service.getEntry('3024'))!, status = await service.status();
    expect(current.interfaceCoverage).toMatchObject({ rawSourceConnectionRecords: 3, physicalInterfacesDiscovered: 2, verifiedPass: 2, enabledPhysicalInterfaces: 2, enabledRawConnectionIds: 3 });
    expect(status.counts.total).toBe((await repository.listIds()).length); expect(status.counts.generatable).toBe(2);
    expect(status.interfaceCoverage).toMatchObject({ verifiedPass: 4, enabledPhysicalInterfaces: 4, enabledRawConnectionIds: 5 });
    expect(status.interfaceCoverage!.physicalInterfacesDiscovered).not.toBe(999999);
  }, 20000);

  it('fails closed for malformed, duplicated or source-mismatched coverage decisions without breaking status()', async () => {
    const baseline = await serviceFor(actualReport), coverage = (await baseline.getEntry('3024'))!.interfaceCoverage!;
    const variants: unknown[][] = [
      [null],
      [structuredClone(coverage.decisions[0]), structuredClone(coverage.decisions[0])],
      [{ ...structuredClone(coverage.decisions[0]), rawConnectionIds: ['wrong-source-alias'] }],
    ];
    for (const decisions of variants) {
      const report = structuredClone(actualReport), row = report.entries.find((entry) => entry.partId === '3024')!;
      row.interfaceCoverage = { ...structuredClone(coverage), decisions } as typeof row.interfaceCoverage;
      const service = await serviceFor(report);
      await expect(service.status()).resolves.toMatchObject({ counts: { generatable: 1 } });
      expect(await service.getCapability('3024')).toMatchObject({ assemblyVerified: false, generatable: false, allowedConnectionIds: [] });
      expect((await service.getEntry('3024'))!.interfaceCoverage).toMatchObject({ verifiedPass: 0, enabledPhysicalInterfaces: 0, enabledRawConnectionIds: 0 });
      expect((await service.getCapability('3005'))!.generatable).toBe(true);
    }
  }, 20000);

  it('downgrades cached PASS decisions when their fixture proof is absent or revoked', async () => {
    const baseline = await serviceFor(actualReport), coverage = (await baseline.getEntry('3024'))!.interfaceCoverage!;
    expect(coverage.decisions.every((decision) => decision.status === 'PASS')).toBe(true);
    for (const mode of ['missing-fixture', 'changed-fixture-source'] as const) {
      const report = structuredClone(actualReport), row = report.entries.find((entry) => entry.partId === '3024')!;
      row.interfaceCoverage = structuredClone(coverage);
      if (mode === 'missing-fixture') row.fixtures = [];
      else for (const fixture of row.fixtures) fixture.fixtureSourceDigest = '0'.repeat(64);
      // The cached decisions and flags still claim PASS. They are insufficient
      // without current native fixture evidence and current runtime admission.
      expect(row.assemblyVerified && row.generatable).toBe(true);
      const service = await serviceFor(report), current = (await service.getEntry('3024'))!;
      expect(current).toMatchObject({ assemblyVerified: false, generatable: false, allowedConnectionIds: [] });
      expect(current.interfaceCoverage).toMatchObject({ verifiedPass: 0, verifiedBlocked: 2, enabledPhysicalInterfaces: 0, enabledRawConnectionIds: 0 });
      expect(current.interfaceCoverage!.decisions.every((decision) => decision.status === 'BLOCKED' && decision.reasonCodes.includes('runtime-interface-proof-revoked'))).toBe(true);
      await expect(service.status()).resolves.toMatchObject({ interfaceCoverage: { verifiedPass: 2, enabledPhysicalInterfaces: 2, enabledRawConnectionIds: 2 } });
    }
  }, 20000);
});
