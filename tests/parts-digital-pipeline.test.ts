import { beforeAll, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { NativePartRepository, nativePartSourceHash } from '../src/parts/assembly/source.js';
import type { NativeAssemblyPart } from '../src/parts/assembly/types.js';
import type { AssemblyMigrationReport } from '../src/parts/assembly/migration.js';
import { runDigitalImportPilot, runDigitalImportRequest } from '../src/parts/digitalImport/pipeline.js';
import type { DigitalImportAdapters, DigitalImportRequest, DigitalSourceDecision } from '../src/parts/digitalImport/types.js';

const request: DigitalImportRequest = {
  requestId: 'native-3005', originalIdentity: { system: 'ldraw', id: '3005' }, nativePartId: '3005',
  identityStatus: 'EXACT_NATIVE_ID', identityEvidence: ['Pinned parts/3005.dat source-native identity'],
  demandEvidence: [{ basis: 'Basic brick structural trial; not exact PDF Element membership', geometryAdmissionAllowed: false }],
};
const available: DigitalSourceDecision = {
  sourceSystem: 'LDraw', access: 'available', license: 'approved', evidence: ['Original source files and attribution/notice copies retained'],
  attributionPreserved: true, licenseCopiesPresent: true,
};
let part: NativeAssemblyPart;
let entry: AssemblyMigrationReport['entries'][number];
beforeAll(async () => {
  part = (await new NativePartRepository().getPart('3005'))!;
  const report = JSON.parse(await readFile(new URL('../data/parts-foundation/assembly/migration.json', import.meta.url), 'utf8')) as AssemblyMigrationReport;
  entry = report.entries.find(row => row.partId === '3005')!;
  expect(entry.source.digest).toBe(nativePartSourceHash(part));
});
function adapters(overrides: Partial<DigitalImportAdapters> = {}): DigitalImportAdapters {
  return {
    resolveSource: async () => available,
    loadPart: async () => part,
    getAssemblyEvidence: async () => entry,
    // Existing matching production evidence, not synthetic success flags.
    getCapability: async () => ({ partId: entry.partId, assemblyVerified: entry.assemblyVerified, generatable: entry.generatable,
      allowedConnectionIds: [...entry.allowedConnectionIds], ruleIds: [...entry.ruleIds], reasonCodes: [...entry.reasonCodes], reasons: [...entry.reasons] }),
    assemblyEvidenceOrigin: 'current-runtime', ...overrides,
  };
}

describe('auditable source-backed digital import pipeline', () => {
  it('records all stages for an actual pinned native part without changing geometry, source data or permissions', async () => {
    const beforeHash = nativePartSourceHash(part), beforeProof = structuredClone(entry);
    const report = await runDigitalImportPilot([request], adapters());
    expect(report.counts).toMatchObject({ requested: 1, identity: { EXACT_NATIVE_ID: 1 }, geometryReady: 1, connectionReady: 1, assemblyVerified: 1, stagingLibraryAllowed: 1, productionGeneratorAllowed: 1 });
    const result = report.results[0];
    expect(result.stages).toHaveLength(10); expect(result.stages.every(stage => stage.status === 'passed')).toBe(true);
    expect(result.geometry.dependencies.length).toBeGreaterThan(0);
    expect(result.geometry.files.every(file => file.sha256.length === 64 && !!file.license && !!file.author)).toBe(true);
    expect(result.connections.sourceFiles.some(file => file.library === 'LDCadShadowLibrary')).toBe(true);
    expect(result.physicalBuildVerified).toBe(false); expect(report.qualificationWritesPerformed).toBe(false);
    expect(nativePartSourceHash(part)).toBe(beforeHash); expect(entry).toEqual(beforeProof);
  });

  it.each(['denied', 'unavailable'] as const)('stops on %s access without attempting a fallback or source import', async access => {
    const loadPart = vi.fn(async () => part);
    const result = await runDigitalImportRequest(request, adapters({ resolveSource: async () => ({ ...available, access, reason: 'Actual access response retained by caller' }), loadPart }));
    expect(loadPart).not.toHaveBeenCalled();
    expect(result.stages.find(stage => stage.stage === 'source')?.status).toBe('blocked');
    expect(result.stages.find(stage => stage.stage === 'geometry')?.status).toBe('skipped');
    expect(result.productionGeneratorAllowed).toBe(false);
  });

  it('requires source permission and actual retained notice copies before reading geometry', async () => {
    for (const change of [{ license: 'unknown' as const }, { licenseCopiesPresent: false }, { attributionPreserved: false }]) {
      const loadPart = vi.fn(async () => part);
      const result = await runDigitalImportRequest(request, adapters({ resolveSource: async () => ({ ...available, ...change }), loadPart }));
      expect(loadPart).not.toHaveBeenCalled();
      expect(result.stages.find(stage => stage.stage === 'license')?.status).toBe('blocked');
    }
  });

  it('does not attach a similar native model to an Element identity, even if an exact label is forged', async () => {
    for (const identityStatus of ['EXACT_NATIVE_ID', 'CANDIDATE', 'CONFLICT', 'UNRESOLVED'] as const) {
      const loadPart = vi.fn(async () => part);
      const result = await runDigitalImportRequest({ ...request, originalIdentity: { system: 'lego-element', id: '3005' }, identityStatus }, adapters({ loadPart }));
      expect(loadPart).not.toHaveBeenCalled(); expect(result.stagingLibraryAllowed).toBe(false);
      expect(result.stages.find(stage => stage.stage === 'identity')?.reasonCodes).toContain('identity-not-exact-native-id');
    }
  });

  it('checks each actual dependency instead of trusting the adapter approved flag', async () => {
    for (const mutate of [
      (changed: NativeAssemblyPart) => { changed.geometry.source.files[0].sourceUrl = 'https://unreviewed.example/parts/3005.dat'; },
      (changed: NativeAssemblyPart) => { changed.geometry.source.files[0].license = 'UNKNOWN'; },
      (changed: NativeAssemblyPart) => { changed.geometry.source.files[0].author = null; },
      (changed: NativeAssemblyPart) => { changed.connections.sourceFiles[0].sourceUrl = 'https://unreviewed.example/connection.dat'; },
    ]) {
      const changed = structuredClone(part); mutate(changed);
      const result = await runDigitalImportRequest(request, adapters({ loadPart: async () => changed }));
      expect(result.stages.find(stage => stage.stage === 'license')?.status).toBe('blocked');
      expect(result.stagingLibraryAllowed).toBe(false); expect(result.productionGeneratorAllowed).toBe(false);
    }
  });

  it('retains successfully imported geometry with partial connections while keeping assembly/generation blocked', async () => {
    const partial = structuredClone(part); partial.connections.status = 'partial';
    const result = await runDigitalImportRequest(request, adapters({ loadPart: async () => partial }));
    expect(result.geometry.status).toBe('geometryReady'); expect(result.connections.status).toBe('partial');
    expect(result.stagingLibraryAllowed).toBe(true); expect(result.assembly.status).toBe('blocked'); expect(result.productionGeneratorAllowed).toBe(false);
    expect(result.stages.find(stage => stage.stage === 'connections')?.status).toBe('blocked');
  });

  it('cannot turn fresh staging assembly checks into production permissions', async () => {
    const result = await runDigitalImportRequest(request, adapters({ assemblyEvidenceOrigin: 'fresh-verification', getCapability: async () => undefined }));
    expect(result.assembly.status).toBe('verified-listed-interfaces'); expect(result.assembly.evidenceOrigin).toBe('fresh-verification');
    expect(result.stagingLibraryAllowed).toBe(true); expect(result.productionGeneratorAllowed).toBe(false); expect(result.productionConnectionIds).toEqual([]);
  });

  it('rejects stale source proofs and unproved old success flags', async () => {
    for (const change of ['source', 'fixtures'] as const) {
      const changed = structuredClone(entry);
      if (change === 'source') changed.source.digest = '0'.repeat(64); else changed.fixtures = [];
      const result = await runDigitalImportRequest(request, adapters({ getAssemblyEvidence: async () => changed }));
      expect(result.assembly.status).toBe('blocked'); expect(result.productionGeneratorAllowed).toBe(false);
    }
  });

  it('reports an importer failure and an assembly error without fabricating a successful downstream stage', async () => {
    const importer = await runDigitalImportRequest(request, adapters({ loadPart: async () => { throw new Error('Pinned source digest failed'); } }));
    expect(importer.geometry.status).toBe('failed'); expect(importer.stagingLibraryAllowed).toBe(false);
    const assembly = await runDigitalImportRequest(request, adapters({ getAssemblyEvidence: async () => { throw new Error('Actual fixture exhausted'); } }));
    expect(assembly.stagingLibraryAllowed).toBe(true); expect(assembly.assembly.status).toBe('blocked');
    expect(assembly.assembly.reasons).toEqual(['Actual fixture exhausted']); expect(assembly.productionGeneratorAllowed).toBe(false);
  });

  it('rejects duplicate request IDs before processing', async () => {
    const resolveSource = vi.fn(async () => available);
    await expect(runDigitalImportPilot([request, request], adapters({ resolveSource }))).rejects.toThrow('unique');
    expect(resolveSource).not.toHaveBeenCalled();
  });
});
