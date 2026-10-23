import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/api/app.js';
import { MockInventoryProvider } from '../src/inventory/index.js';
import { NativePartRepository, PART_LIBRARY_VERSION } from '../src/parts/assembly/source.js';
import { ASSEMBLY_ENGINE_VERSION } from '../src/parts/assembly/engine.js';
import { CONNECTION_RULE_VERSION } from '../src/parts/assembly/compatibility.js';
import { COLLISION_VERSION } from '../src/parts/assembly/collision.js';
import type { RuntimeAssemblyStatus } from '../src/parts/assembly/service.js';
import type { NativeGenerationResult, NativeGeneratedAssembly } from '../src/parts/assembly/generator.js';

let server: Server;
let base: string;
let directory: string;
let status: RuntimeAssemblyStatus;
const sourceRepository = new NativePartRepository();
const prefix = '/api/parts-foundation';
const versions = { partLibraryVersion: PART_LIBRARY_VERSION, assemblyEngineVersion: ASSEMBLY_ENGINE_VERSION, connectionRuleVersion: CONNECTION_RULE_VERSION, collisionVersion: COLLISION_VERSION };
function post(endpoint: string, body: unknown) { return fetch(`${base}${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'bricklab-native-api-'));
  // Actual production report and admission path. Mock only the unused external
  // stock provider, never native source parts, assembly proof or capabilities.
  server = createApp({ provider: new MockInventoryProvider(), staticDir: false, partsDataDir: directory }).listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No HTTP test address.');
  base = `http://127.0.0.1:${address.port}`;
  const response = await fetch(`${base}${prefix}/assembly/status`);
  expect(response.status).toBe(200);
  status = await response.json() as RuntimeAssemblyStatus;
  expect(status.runtimeValidation.status).toBe('ready');
}, 45000);
afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe('native assembly production HTTP boundaries', () => {
  it('reports every actual source root and only counts runtime-validated admission decisions', async () => {
    expect(status.counts.total).toBe(245);
    expect(status.queue).toHaveLength(245);
    expect(status.counts.assemblyVerified).toBe(status.queue.filter((entry) => entry.assemblyVerified).length);
    expect(status.counts.generatable).toBe(status.queue.filter((entry) => entry.generatable).length);
    expect(status.counts.blocked + status.counts.assemblyVerified).toBe(245);
    expect(status.counts.generatable).toBeGreaterThan(0);
    expect(status.counts.verifiedInterfaces).toBe(status.queue.reduce((sum, entry) => sum + entry.allowedConnectionIds.length, 0));
    expect(status.runtimeValidation.issues).toEqual([]);
    expect(status).toMatchObject({ ...versions, physicalBuildVerified: false, counts: { wheelModulesVerified: 0, physicalBuildsVerified: 0 } });
  });

  it('attaches the evidence-derived default pair with complete source hashes and four version bindings', async () => {
    expect(status.defaultPair).toBeDefined();
    const response = await post(`${prefix}/assembly/attach`, status.defaultPair);
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({ accepted: true, graph: { ...versions, physicalBuildVerified: false }, collision: { status: 'clear', proof: { wholePairExempted: false } }, debug: { insertionPathVerification: 'source-axis-seating-path' } });
    expect(result.graph.placements).toHaveLength(2);
    expect(result.graph.edges).toHaveLength(1);
    for (const placement of result.graph.placements) expect(result.graph.sourceHashes[placement.partId]).toMatch(/^[a-f0-9]{64}$/);
    expect(result.compatibility.sourceEvidence.filter((evidence: { kind: string }) => evidence.kind === 'source-directive')).toHaveLength(2);
  }, 15000);

  it('rejects a same-gender pair even when both source ports were separately admitted', async () => {
    const brick = await sourceRepository.getPart('3005');
    const admitted = status.capabilities.find((entry) => entry.partId === '3005')!;
    const male = brick!.connections.points.find((point) => point.gender === 'M' && admitted.allowedConnectionIds.includes(point.id))!;
    expect(male).toBeDefined();
    const response = await post(`${prefix}/assembly/attach`, { partA: '3005', connectionA: male.id, partB: '3005', connectionB: male.id });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ accepted: false, compatibility: { status: 'incompatible', reasonCode: 'same-mating-gender' } });
  });

  it('rejects client coordinates, trust flags, modes, unknown keys and invalid search parameters with 400', async () => {
    for (const extra of [{ translation: [0, 0, 0] }, { rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1] }, { mode: 'verification' }, { capabilities: [] }, { assemblyVerified: true }]) {
      expect((await post(`${prefix}/assembly/attach`, { ...status.defaultPair, ...extra })).status).toBe(400);
    }
    for (const body of [
      { module: 'wall', partCount: 2 }, { module: 'wall', partCount: 33 }, { module: 'basic-snot', partCount: 4 },
      { module: 'invent-a-car' }, { module: 'wall', kind: 'wall' }, { module: 'wall', mode: 'verification' }, { module: 'wall', placements: [] },
    ]) expect((await post(`${prefix}/assembly/generate`, body)).status).toBe(400);
    expect((await post(`${prefix}/assembly/attach`, { ...status.defaultPair, twistDegrees: 45 })).status).toBe(400);
  });

  it('returns 404 for unknown source IDs and 400 for invalid model export formats', async () => {
    for (const key of ['partA', 'partB']) {
      const response = await post(`${prefix}/assembly/attach`, { ...status.defaultPair, [key]: 'unknown-native-source' });
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ code: 'FOUNDATION_PART_NOT_FOUND' });
    }
    expect((await fetch(`${base}${prefix}/parts/unknown-native-source`)).status).toBe(404);
    expect((await fetch(`${base}${prefix}/assembly/models/arbitrary-client-model/export?format=json`)).status).toBe(404);
    expect((await fetch(`${base}${prefix}/assembly/models/arbitrary-client-model/export?format=stl`)).status).toBe(400);
  }, 20000);

  it('keeps wheel generation explicitly blocked when no wheel assembly rule is verified', async () => {
    const response = await post(`${prefix}/assembly/generate`, { module: 'wheel-module' });
    expect(response.status).toBe(200);
    const result = await response.json() as NativeGenerationResult;
    expect(result).toMatchObject({ status: 'blocked', model: null });
    expect(result.reasons.join(' ')).toContain('轮');
  }, 15000);

  it('generates actual wall and simple chassis models and exports only server-retained source-bound documents', async () => {
    for (const module of ['wall', 'simple-chassis'] as const) {
      const response = await post(`${prefix}/assembly/generate`, { module, partCount: 3 });
      expect(response.status).toBe(200);
      const generated = await response.json() as NativeGenerationResult;
      expect(generated.status, generated.reasons.join('; ')).toBe('generated');
      const model = generated.model!;
      expect(model).toMatchObject({ ...versions, module, physicalBuildVerified: false, assemblyValidation: { checked: true, valid: true }, ownership: 'virtual-design-not-owned', colorAvailability: 'not-verified' });
      expect(model.placements).toHaveLength(3);
      expect(model.edges).toHaveLength(2);
      for (const placement of model.placements) {
        const capability = status.capabilities.find((entry) => entry.partId === placement.partId);
        expect(capability?.assemblyVerified && capability?.generatable).toBe(true);
      }
      const jsonResponse = await fetch(`${base}${prefix}/assembly/models/${model.id}/export?format=json`);
      expect(jsonResponse.status).toBe(200);
      const exported = await jsonResponse.json() as NativeGeneratedAssembly;
      expect(exported.id).toBe(model.id);
      expect(exported.contentSha256).toBe(model.contentSha256);
      const ldrawResponse = await fetch(`${base}${prefix}/assembly/models/${model.id}/export?format=ldr`);
      expect(ldrawResponse.status).toBe(200);
      const ldraw = await ldrawResponse.text();
      expect(ldraw).toContain(`partLibraryVersion: ${PART_LIBRARY_VERSION}`);
      expect(ldraw.split(/\r?\n/).filter((line) => line.startsWith('1 16 '))).toHaveLength(3);
      for (const placement of model.placements) expect(ldraw).toContain(`${placement.partId}.dat`);
      const csvResponse = await fetch(`${base}${prefix}/assembly/models/${model.id}/export?format=csv`);
      expect(csvResponse.status).toBe(200);
      const csv = await csvResponse.text();
      expect(csv).toContain('partId,name,quantity,ldrawColor,colorAvailability');
      expect(csv).toContain('not-verified');
    }
  }, 45000);

  it('keeps observed instruction mapping coverage separate from native assembly admission', async () => {
    const recoveryResponse = await fetch(`${base}${prefix}/recovery`);
    expect(recoveryResponse.status).toBe(200);
    expect(await recoveryResponse.json()).toMatchObject({ counts: { total: 531, mappedBySource: 531, independentlyVerifiedOfficial: 0, resolvedLDraw: 0, assemblyVerified: 0, generatable: 0 } });
    const coverageResponse = await fetch(`${base}${prefix}/instructions/coverage`);
    expect(coverageResponse.status).toBe(200);
    const coverage = await coverageResponse.json();
    expect(coverage.documents).toHaveLength(8);
    expect(coverage.sets).toHaveLength(6);
    expect(coverage.overall.counts).toMatchObject({ uniqueObservedElements: 531, mapped: 531, resolvedLDraw: 0, assemblyVerified: 0, generatable: 0, unresolved: 531 });
    expect(coverage.overall.inventoryComplete).toBe(false);
  }, 30000);

  it('preserves production rejection of legacy parametric generation and export', async () => {
    for (const endpoint of ['/api/generate', '/api/speed/generate', '/api/automotive/design']) {
      const response = await post(endpoint, {});
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: 'REAL_PARTS_FOUNDATION_REQUIRED', authenticity: { generatable: false, verified: false, nativeMeshImported: false } });
    }
    expect((await fetch(`${base}/api/speed/models/saved-legacy-model/export?format=ldr`)).status).toBe(409);
  });
});
