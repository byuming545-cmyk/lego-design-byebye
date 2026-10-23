import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { AttachmentEngine, ASSEMBLY_ENGINE_VERSION } from '../src/parts/assembly/engine.js';
import { NativePartRepository, nativePartSourceHash, PART_LIBRARY_VERSION } from '../src/parts/assembly/source.js';
import { createAssemblySourceLoader, loadStandardAssemblyFixtures } from '../src/parts/assembly/fixtures.js';
import { fingerprintAssemblyPart, prioritizePhysicalInterfaceIds, verifyNativePartAssembly } from '../src/parts/assembly/verification.js';
import { groupPhysicalInterfaces } from '../src/parts/assembly/interfaces.js';
import type { LoadedAssemblyFixture } from '../src/parts/assembly/fixtures.js';
import type { AssemblyMigrationReport } from '../src/parts/assembly/migration.js';
import { CONNECTION_RULE_VERSION } from '../src/parts/assembly/compatibility.js';
import { COLLISION_VERSION } from '../src/parts/assembly/collision.js';

describe('all-native-root assembly migration', () => {
  let repository: NativePartRepository;
  let engine: AttachmentEngine;
  let fixtures: LoadedAssemblyFixture[];
  let report: AssemblyMigrationReport;
  let fullReport: AssemblyMigrationReport;
  beforeAll(async () => {
    repository = new NativePartRepository();
    const loader = await createAssemblySourceLoader(repository);
    fixtures = await loadStandardAssemblyFixtures(loader);
    engine = new AttachmentEngine({ loadPart: id => repository.getPart(id), mode: 'verification' });
    const bundled = JSON.parse(readFileSync(new URL('../data/parts-foundation/assembly/migration.json', import.meta.url), 'utf8'));
    report = bundled;
    const fullText = gunzipSync(readFileSync(new URL('../artifacts/assembly-development/migration-full.json.gz', import.meta.url))).toString('utf8');
    expect(createHash('sha256').update(fullText).digest('hex')).toBe(bundled.fullReportArtifact.uncompressedSha256);
    fullReport = JSON.parse(fullText);
  }, 30_000);

  it('includes every pinned root with an explicit source-bound verified or blocked result', async () => {
    const ids = await repository.listIds();
    expect(ids).toHaveLength(245);
    expect(report.entries.map(entry => entry.partId).sort()).toEqual([...ids].sort());
    expect(report.sourceCounts).toEqual({ totalRoots: 245, geometryReady: 245, connectionReady: 197, connectionPartial: 44, connectionMissing: 4 });
    expect(report.counts.total).toBe(245);
    expect(report.counts.assemblyVerified + report.counts.blocked).toBe(245);
    expect(report.counts.assemblyVerified).toBeGreaterThan(0);
    expect(report.counts.generatable).toBe(report.counts.assemblyVerified);
    expect(Object.values(report.blockedReasons).reduce((sum, count) => sum + count, 0)).toBe(report.counts.blocked);
    expect(report.entries.every(entry => ['assemblyVerified', 'blocked'].includes(entry.status) && entry.source.digest.match(/^[a-f0-9]{64}$/))).toBe(true);
    expect(report.entries.filter(entry => !entry.assemblyVerified).every(entry => entry.reasonCodes.length > 0 && entry.reasons.length > 0 && !entry.allowedConnectionIds.length)).toBe(true);
  });

  it('binds the snapshot to current engine versions and every actual geometry / connector closure', async () => {
    expect(report).toMatchObject({ partLibraryVersion: PART_LIBRARY_VERSION, assemblyEngineVersion: ASSEMBLY_ENGINE_VERSION, connectionRuleVersion: CONNECTION_RULE_VERSION, collisionVersion: COLLISION_VERSION });
    for (const entry of report.entries) {
      const part = await repository.getPart(entry.partId);
      expect(part).toBeDefined();
      expect(entry.source.digest).toBe(nativePartSourceHash(part!));
      expect(entry.source.digest).toBe(fingerprintAssemblyPart(part!).digest);
      expect(entry.source.geometryFiles).toHaveLength(part!.geometry.source.files.length);
      expect(entry.source.connectionFiles).toHaveLength(part!.connections.sourceFiles.length);
    }
  }, 30_000);

  it('retains all tested interface decisions when detailed runtime cases are compacted', () => {
    for (const entry of report.entries) {
      const full = fullReport.entries.find(row => row.partId === entry.partId)!;
      expect(entry.allowedConnectionIds).toEqual(full.allowedConnectionIds);
      expect(entry.disabledConnectionIds).toEqual(full.disabledConnectionIds);
      expect(entry.fixtureTestsPassed).toBe(full.fixtureTestsPassed);
      expect(entry.fixtureTestsTotal).toBe(full.fixtureTestsTotal);
      expect(entry.fixtures.length).toBeLessThanOrEqual(Math.max(16, full.fixtures.filter(fixture => fixture.status === 'verified').length));
      expect(entry.allowedConnectionIds.some(id => entry.disabledConnectionIds.includes(id))).toBe(false);
      if (!entry.assemblyVerified) continue;
      const proofs = full.fixtures.filter(fixture => fixture.status === 'verified');
      expect(new Set(proofs.flatMap(proof => proof.equivalentConnectionIds))).toEqual(new Set(entry.allowedConnectionIds));
      for (const proof of proofs) {
        expect(proof.checks).toHaveLength(8);
        expect(proof.checks.every(check => check.outcome === 'passed')).toBe(true);
        expect(proof.fixtureSourceDigest).toMatch(/^[a-f0-9]{64}$/);
        expect(proof.sourceHash).toMatch(/^[a-f0-9]{64}$/);
      }
    }
  });

  it('gives every former deferred port a source-bound terminal decision and preserves representative source prioritization', async () => {
    expect(report.interfaceBudget).toBeNull();
    expect(report.counts.deferredPhysicalInterfaces).toBe(0);
    expect(report.deferredRun).toMatchObject({ targetCount: 978, pending: 0, interrupted: false });
    const baseline = JSON.parse(gunzipSync(readFileSync(new URL('../artifacts/assembly-development/v05-physical-index.json.gz', import.meta.url))).toString('utf8')) as {
      counts: { pending: number };
      entries: { partId: string; groups: { physicalInterfaceId: string; status: string }[] }[];
    };
    expect(baseline.counts.pending).toBe(978);
    let targets = 0;
    for (const before of baseline.entries) {
      const current = report.entries.find(entry => entry.partId === before.partId)!;
      for (const group of before.groups.filter(group => group.status === 'PENDING')) {
        targets++;
        const decision = current.interfaceCoverage!.decisions.find(decision => decision.physicalInterfaceId === group.physicalInterfaceId);
        expect(decision, `${before.partId}/${group.physicalInterfaceId}`).toBeDefined();
        expect(['PASS', 'BLOCKED', 'REQUIRES_ASTRA_REVIEW']).toContain(decision!.status);
        if (decision!.status === 'PASS') expect(decision!.rawConnectionIds.every(id => current.allowedConnectionIds.includes(id))).toBe(true);
        else expect(decision!.rawConnectionIds.every(id => current.disabledConnectionIds.includes(id) && !current.allowedConnectionIds.includes(id))).toBe(true);
      }
    }
    expect(targets).toBe(978);
    for (const entry of report.entries) {
      expect(entry.interfaceCoverage?.pending).toBe(0);
      expect(entry.deferredConnectionIds).toEqual([]);
      for (const decision of entry.interfaceCoverage!.decisions) if (decision.status !== 'PASS') {
        expect(decision.rawConnectionIds.every(id => entry.disabledConnectionIds.includes(id) && !entry.allowedConnectionIds.includes(id))).toBe(true);
      }
    }
    const part = (await repository.getPart('3026'))!;
    const ordinaryStuds = part.connections.points.filter(point => point.gender === 'M' && point.sections.length === 1 && point.sections[0].radius === 6);
    const groups = groupPhysicalInterfaces(part), byId = new Map(groups.map(group => [group.physicalInterfaceId, group]));
    const priority = prioritizePhysicalInterfaceIds(part);
    expect(new Set(priority).size).toBe(groups.length);
    const initialStuds = priority.slice(0, 32).map(id => byId.get(id)!.points[0]).filter(point => ordinaryStuds.includes(point));
    expect(initialStuds.length).toBeGreaterThan(4);
    for (const axis of [0, 2]) {
      expect(Math.min(...initialStuds.map(point => point.position[axis]))).toBe(Math.min(...ordinaryStuds.map(point => point.position[axis])));
      expect(Math.max(...initialStuds.map(point => point.position[axis]))).toBe(Math.max(...ordinaryStuds.map(point => point.position[axis])));
    }
    const min = [0, 2].map(axis => Math.min(...ordinaryStuds.map(point => point.position[axis])));
    const max = [0, 2].map(axis => Math.max(...ordinaryStuds.map(point => point.position[axis])));
    expect(initialStuds.some(point => point.position[0] > min[0] && point.position[0] < max[0] && point.position[2] > min[1] && point.position[2] < max[1])).toBe(true);
  });

  it('executes real source stud fixtures through transform, reverse, native collision, rotation and graph checks', async () => {
    for (const id of ['3005', '3024', '3070b']) {
      const part = (await repository.getPart(id))!;
      const verified = await verifyNativePartAssembly(part, part.geometry.name ?? id, fixtures, engine);
      expect(verified.assemblyVerified).toBe(true);
      expect(verified.generatable).toBe(true);
      expect(verified.allowedConnectionIds.length).toBeGreaterThan(0);
      expect(verified.fixtures.filter(fixture => fixture.status === 'verified').every(fixture => fixture.checks.length === 8 && fixture.checks.every(check => check.outcome === 'passed'))).toBe(true);
      expect(verified.physicalBuildVerified).toBe(false);
    }
  }, 30_000);

  it('keeps source-partial, missing and open-topology parts blocked with specific failures', async () => {
    const partial = await verifyNativePartAssembly((await repository.getPart('3004'))!, 'Brick 1x2', fixtures, engine);
    expect(partial).toMatchObject({ assemblyVerified: false, generatable: false, connectionSourceStatus: 'partial', allowedConnectionIds: [] });
    expect(partial.reasons.some(reason => reason.includes('unsupported-scaling'))).toBe(true);
    const missing = await verifyNativePartAssembly((await repository.getPart('18977'))!, 'Tyre', fixtures, engine);
    expect(missing.reasonCodes).toContain('connection-missing');
    const open = await verifyNativePartAssembly((await repository.getPart('18973'))!, 'Windscreen', fixtures, engine);
    expect(open.assemblyVerified).toBe(false);
    expect(open.reasonCodes.some(reason => reason.startsWith('collision-proxy-'))).toBe(true);
    expect(open.reasons.some(reason => /open|branched/.test(reason))).toBe(true);
  }, 30_000);

  it('restricts SNOT qualification to tested ports and never reports untested wheel / tyre, clip or axle modules as verified', async () => {
    const part = (await repository.getPart('87087'))!;
    const verified = await verifyNativePartAssembly(part, part.geometry.name!, fixtures, engine);
    const sideStud = part.connections.points.find(point => point.gender === 'M' && Math.abs(point.direction[1]) < 1e-6)!;
    const smallBore = part.connections.points.find(point => point.gender === 'F' && point.sections[0]?.radius === 4)!;
    expect(verified.allowedConnectionIds).toContain(sideStud.id);
    expect(verified.disabledConnectionIds).toContain(smallBore.id);
    expect(report.entries.every(entry => entry.wheelModuleVerified === false)).toBe(true);
    for (const id of ['wheel-tyre', 'wheel-holder', 'axle-compatible-hole', 'bar-clip', 'pin-hole']) {
      const pair = report.representativePairs.find(pair => pair.id === id)!;
      expect(pair.status).toBe('blocked');
      expect(pair.reason.length).toBeGreaterThan(10);
    }
  }, 30_000);

  it('rejects loss of source integrity instead of promoting a plausible fixture pose', async () => {
    const original = (await repository.getPart('3005'))!;
    const changed = structuredClone(original);
    changed.geometry.source.integrity = 'not-manifested';
    const result = await verifyNativePartAssembly(changed, 'Brick', fixtures, engine);
    expect(result).toMatchObject({ assemblyVerified: false, generatable: false, allowedConnectionIds: [] });
    expect(result.reasonCodes).toContain('source-integrity-unresolved');
  });
});
