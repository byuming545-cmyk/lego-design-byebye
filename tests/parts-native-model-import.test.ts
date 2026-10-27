import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import express from 'express';
import { NativePartRepository, PART_LIBRARY_VERSION } from '../src/parts/assembly/source.js';
import { AttachmentEngine } from '../src/parts/assembly/engine.js';
import { runAssemblyMigration, capabilityFromMigration, type AssemblyMigrationReport } from '../src/parts/assembly/migration.js';
import { AssemblyService } from '../src/parts/assembly/service.js';
import { inspectNativeModelImport, NativeModelImportError } from '../src/parts/assembly/modelImport.js';
import { exportNativeAssemblyJson } from '../src/parts/assembly/documents.js';
import type { NativeGeneratedAssembly } from '../src/parts/assembly/generator.js';
import type { AssemblyInterfaceCapability } from '../src/parts/assembly/types.js';
import { RealPartRegistry } from '../src/parts/registry.js';
import { createPartsFoundationRouter } from '../src/parts/api.js';
import { InventoryError } from '../src/inventory/index.js';

const repository = new NativePartRepository();
let production: AttachmentEngine;
let incoming: NativeGeneratedAssembly;
let migration: AssemblyMigrationReport;
let capabilities: Map<string, AssemblyInterfaceCapability>;
let service: AssemblyService;
let directory: string;
let server: Server;
let base: string;
const prefix = '/api/parts-foundation';

function seal<T extends object>(value: T): T & { contentSha256: string } {
  const { contentSha256: _old, ...data } = value as T & { contentSha256?: string };
  return { ...data, contentSha256: createHash('sha256').update(JSON.stringify(data)).digest('hex') } as T & { contentSha256: string };
}
function changed(change: (value: NativeGeneratedAssembly) => void) { const value = structuredClone(incoming); change(value); return seal(value); }
function post(body: unknown) { return fetch(`${base}${prefix}/assembly/models/import`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }

beforeAll(async () => {
  const manifest = await repository.getManifest();
  migration = await runAssemblyMigration({
    engine: new AttachmentEngine({ mode: 'verification', loadPart: (id) => repository.getPart(id) }), maxInterfacesPerPart: null,
    sourceLoader: { roots: manifest.roots.filter((root) => ['3023b', '3005', '3024'].includes(root.partId)), partLibraryVersion: PART_LIBRARY_VERSION, geometryRevision: manifest.revision,
      async loadPart(id) { const part = await repository.getPart(id); if (!part) throw new Error('Actual source fixture is missing.'); return part; },
    },
  });
  expect(migration.entries.every((entry) => entry.assemblyVerified && entry.generatable)).toBe(true);
  // Production permissions come from real current-version source/physics tests,
  // rather than hand-authored success flags or fabricated parts.
  capabilities = new Map(migration.entries.map((entry) => [entry.partId, capabilityFromMigration(entry)]));
  production = new AttachmentEngine({ mode: 'production', loadPart: (id) => repository.getPart(id), getCapability: (id) => capabilities.get(id) });
  const source = (await repository.getPart('3023b'))!;
  const male = source.connections.points.find((point) => point.gender === 'M' && point.sourceId === 'studC' && point.position[0] === -10)!;
  const female = source.connections.points.find((point) => point.gender === 'F' && point.sections[0]?.radius === 6 && point.position[0] === -10)!;
  const seed = await production.createAssembly('3023b');
  const attached = await production.attachPart(seed, { anchorInstanceId: 'root', anchorConnectionId: male.id, partId: '3023b', candidateConnectionId: female.id, twistDegrees: 0 });
  expect(attached.accepted).toBe(true); expect(attached.graph.edges).toHaveLength(2);
  expect((await production.validateGraph(attached.graph)).valid).toBe(true);
  // Untrusted import metadata is intentionally empty. The geometry, graph and
  // actual native collision proof above are genuine; the importer must rebuild
  // every BOM/step/source claim from current server state.
  incoming = seal({ ...attached.graph, module: 'platform', name: 'Untrusted incoming presentation metadata', bom: [], steps: [], sources: [], ownership: 'virtual-design-not-owned', colorAvailability: 'not-verified', warnings: [], assemblyValidation: { checked: true, valid: true, issues: [] } }) as NativeGeneratedAssembly;
  directory = await mkdtemp(path.join(tmpdir(), 'bricklab-model-import-'));
  await writeFile(path.join(directory, 'migration.json'), JSON.stringify(migration));
  service = new AssemblyService({ repository, dataDir: directory }); await service.ready();
  const registry = new RealPartRegistry({ repository, assemblyService: service, dataDir: directory });
  const app = express(); app.use(express.json({ limit: '10mb' })); app.use(prefix, createPartsFoundationRouter({ registry }));
  app.use(((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    if (error instanceof InventoryError) response.status(error.status).json({ code: error.code, error: error.message });
    else response.status(500).json({ code: 'UNEXPECTED_IMPORT_TEST_ERROR' });
  }) as express.ErrorRequestHandler);
  server = app.listen(0, '127.0.0.1'); await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing HTTP fixture address.'); base = `http://127.0.0.1:${address.port}`;
}, 45000);
afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe('current native model revalidation and import', () => {
  it('revalidates a real multi-edge assembly and rebuilds trusted BOM, steps and native source references', async () => {
    const result = await inspectNativeModelImport(incoming, production);
    expect(result).toMatchObject({ status: 'VALID', reasons: [], originalModelId: incoming.id, physicalBuildVerified: false });
    const model = result.model!;
    expect(model.id).not.toBe(incoming.id); expect(model.placements).toHaveLength(2); expect(model.edges).toHaveLength(2);
    expect(model.bom).toMatchObject([{ partId: '3023b', quantity: 2, ldrawColor: 16, colorAvailability: 'not-verified' }]);
    expect(model.steps).toHaveLength(2); expect(model.steps[0].connectionEdgeIds).toEqual([]); expect(model.steps[1].connectionEdgeIds).toHaveLength(2);
    expect(model.sources.some((source) => source.library === 'LDraw' && source.path === 'parts/3023b.dat')).toBe(true);
    expect(() => exportNativeAssemblyJson(model)).not.toThrow();
    expect((await production.validateGraph(model)).valid).toBe(true);
  });

  it('assigns rebuilt multi-point steps to the later placement even when an uploaded node order is reversed', async () => {
    const result = await inspectNativeModelImport(changed((value) => { value.placements.reverse(); }), production);
    expect(result.status).toBe('VALID');
    expect(result.model!.steps[0].connectionEdgeIds).toEqual([]);
    expect(result.model!.steps[1].connectionEdgeIds).toHaveLength(2);
    expect(() => exportNativeAssemblyJson(result.model!)).not.toThrow();
  });

  it('strips arbitrary uploaded placement, transform, edge and source-hash metadata from adopted output', async () => {
    const value = structuredClone(incoming) as NativeGeneratedAssembly & Record<string, unknown>;
    (value.placements[0] as unknown as Record<string, unknown>).clientGeometry = { counterfeit: true };
    (value.placements[0].transform as unknown as Record<string, unknown>).userScale = 100;
    (value.edges[0] as unknown as Record<string, unknown>).clientVerified = true;
    (value.sourceHashes as unknown as Record<string, unknown>).unrelatedUploadedClaim = { bogus: true };
    value.clientCapabilities = { generatable: true };
    const result = await inspectNativeModelImport(seal(value), production);
    expect(result.status).toBe('VALID');
    expect(result.model!.placements[0]).not.toHaveProperty('clientGeometry');
    expect(result.model!.placements[0].transform).not.toHaveProperty('userScale');
    expect(result.model!.edges[0]).not.toHaveProperty('clientVerified');
    expect(result.model!.sourceHashes).not.toHaveProperty('unrelatedUploadedClaim');
    expect(result.model).not.toHaveProperty('clientCapabilities');
  });

  it('marks old versions, changed source hashes and omitted physical mating edges as NEEDS_REVALIDATION', async () => {
    for (const mutate of [
      (value: NativeGeneratedAssembly) => { value.assemblyEngineVersion = 'native-assembly-0.5.0'; },
      (value: NativeGeneratedAssembly) => { value.sourceHashes['3023b'] = '0'.repeat(64); },
      (value: NativeGeneratedAssembly) => { value.edges.pop(); },
    ]) {
      const result = await inspectNativeModelImport(changed(mutate), production);
      expect(result.status).toBe('NEEDS_REVALIDATION'); expect(result.model).toBeNull(); expect(result.reasons.length).toBeGreaterThan(0);
    }
  });

  it('rejects missing source parts and source endpoints rather than substituting another part', async () => {
    const missingPart = changed((value) => { value.placements[1].partId = 'unknown-native-source'; });
    expect(await inspectNativeModelImport(missingPart, production)).toMatchObject({ status: 'NEEDS_REVALIDATION', model: null });
    const missingPort = changed((value) => { value.edges[0].movingConnectionId = 'nonexistent-source-connection'; });
    expect(await inspectNativeModelImport(missingPort, production)).toMatchObject({ status: 'NEEDS_REVALIDATION', model: null });
  });

  it('honors current interface revocation even when uploaded flags claim success', async () => {
    const capability = capabilities.get('3023b')!, previous = [...capability.allowedConnectionIds];
    capability.allowedConnectionIds = capability.allowedConnectionIds.filter((id) => id !== incoming.edges[0].fixedConnectionId);
    try {
      const uploaded = structuredClone(incoming) as NativeGeneratedAssembly & Record<string, unknown>;
      uploaded.assemblyVerified = true; uploaded.generatable = true; uploaded.currentCapabilities = { allowedConnectionIds: previous };
      expect(await inspectNativeModelImport(seal(uploaded), production)).toMatchObject({ status: 'NEEDS_REVALIDATION', model: null });
    } finally { capability.allowedConnectionIds = previous; }
  });

  it('raises NativeModelImportError for checksum changes, nonrigid transforms and physical-build claims', async () => {
    const checksum = structuredClone(incoming); checksum.name = 'Changed without updating integrity';
    await expect(inspectNativeModelImport(checksum, production)).rejects.toBeInstanceOf(NativeModelImportError);
    for (const mutate of [
      (value: NativeGeneratedAssembly) => { value.placements[0].transform.rotation[0] = 2; },
      (value: NativeGeneratedAssembly) => { (value as unknown as Record<string, unknown>).physicalBuildVerified = true; },
      (value: NativeGeneratedAssembly) => { (value as unknown as Record<string, unknown>).ownership = 'owned'; },
    ]) await expect(inspectNativeModelImport(changed(mutate), production)).rejects.toBeInstanceOf(NativeModelImportError);
  });

  it('retains only VALID adopted models in the actual runtime service and keeps returned copies isolated', async () => {
    const result = await service.importModel(incoming);
    expect(result.status).toBe('VALID'); const saved = service.getModel(result.model!.id)!;
    expect(saved).toBeDefined(); expect(saved.id).not.toBe(incoming.id); expect(() => exportNativeAssemblyJson(saved)).not.toThrow();
    saved.placements[0].partId = 'edited-client-copy';
    expect(service.getModel(result.model!.id)!.placements[0].partId).toBe('3023b');
    const old = changed((value) => { value.assemblyEngineVersion = 'native-assembly-0.5.0'; });
    const blocked = await service.importModel(old);
    expect(blocked).toMatchObject({ status: 'NEEDS_REVALIDATION', model: null });
    expect(service.getModel(old.id)).toBeUndefined();
  });

  it('exposes revalidation through HTTP and exports the retained adopted model, never the uploaded original', async () => {
    const response = await post({ content: JSON.stringify(incoming) });
    expect(response.status).toBe(200); const result = await response.json(); expect(result.status).toBe('VALID');
    const exported = await fetch(`${base}${prefix}/assembly/models/${result.model.id}/export?format=json`);
    expect(exported.status).toBe(200); expect((await exported.json()).contentSha256).toBe(result.model.contentSha256);
    expect((await fetch(`${base}${prefix}/assembly/models/${incoming.id}/export?format=json`)).status).toBe(404);
    const invalidated = await post({ content: JSON.stringify(changed((value) => { value.edges.pop(); })) });
    expect(invalidated.status).toBe(200); expect(await invalidated.json()).toMatchObject({ status: 'NEEDS_REVALIDATION', model: null });
  });

  it('returns HTTP 400 for malformed file content, trust controls and nonrigid or false physical claims', async () => {
    for (const body of [
      { content: '{' }, { content: JSON.stringify(incoming), mode: 'verification' }, { content: JSON.stringify(incoming), capabilities: [] },
      { content: JSON.stringify(changed((value) => { value.placements[0].transform.rotation[0] = 2; })) },
      { content: JSON.stringify(changed((value) => { (value as unknown as Record<string, unknown>).physicalBuildVerified = true; })) },
    ]) expect((await post(body)).status).toBe(400);
  });
});
