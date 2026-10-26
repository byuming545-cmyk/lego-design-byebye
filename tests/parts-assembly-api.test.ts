import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/api/app.js';
import { MockInventoryProvider } from '../src/inventory/index.js';
import { NativePartRepository, nativePartSourceHash, PART_LIBRARY_VERSION } from '../src/parts/assembly/source.js';
import { ASSEMBLY_ENGINE_VERSION } from '../src/parts/assembly/engine.js';
import { CONNECTION_RULE_VERSION } from '../src/parts/assembly/compatibility.js';
import { COLLISION_VERSION } from '../src/parts/assembly/collision.js';
import type { RuntimeAssemblyStatus } from '../src/parts/assembly/service.js';
import type { GrammarRuntimeStatus } from '../src/parts/grammar/service.js';
import type { NativeGenerationResult, NativeGeneratedAssembly } from '../src/parts/assembly/generator.js';
import type { AssemblyMigrationReport } from '../src/parts/assembly/migration.js';
import type { NativeAssembly, NativeAssemblyPart } from '../src/parts/assembly/types.js';
import { validateConnectionOccupancy } from '../src/parts/assembly/multipoint.js';

let server: Server;
let base: string;
let directory: string;
let status: GrammarRuntimeStatus;
let report: AssemblyMigrationReport;
const sourceRepository = new NativePartRepository();
const prefix = '/api/parts-foundation';
const versions = { partLibraryVersion: PART_LIBRARY_VERSION, assemblyEngineVersion: ASSEMBLY_ENGINE_VERSION, connectionRuleVersion: CONNECTION_RULE_VERSION, collisionVersion: COLLISION_VERSION };
function post(endpoint: string, body: unknown) { return fetch(`${base}${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }

/** A source attachment may add several mates; cycles do not imply floating or duplicate sockets. */
async function expectConnectedSourceGraph(graph: NativeAssembly) {
  expect(graph).toMatchObject({ ...versions, physicalBuildVerified: false });
  expect(graph.placements.length).toBeGreaterThan(0);
  expect(graph.edges.length).toBeGreaterThanOrEqual(graph.placements.length - 1);
  const nodes = new Map(graph.placements.map(placement => [placement.instanceId, placement]));
  expect(nodes.size).toBe(graph.placements.length);
  expect(new Set(graph.edges.map(edge => edge.id)).size).toBe(graph.edges.length);
  const parts = new Map<string, NativeAssemblyPart>();
  for (const placement of graph.placements) {
    const native = await sourceRepository.getPart(placement.partId);
    expect(native, placement.partId).toBeDefined();
    parts.set(placement.instanceId, native!);
    expect(graph.sourceHashes[placement.partId]).toBe(nativePartSourceHash(native!));
    const capability = status.capabilities.find(entry => entry.partId === placement.partId);
    expect(capability).toMatchObject({ admissionBasis: 'interface-grammar', assemblyVerified: false, generatable: true, sourceReady: true, collisionGeometryReady: true, connectable: true });
  }
  const adjacency = new Map(graph.placements.map(placement => [placement.instanceId, new Set<string>()]));
  for (const edge of graph.edges) {
    expect(nodes.has(edge.fixedInstanceId) && nodes.has(edge.movingInstanceId)).toBe(true);
    expect(edge.fixedInstanceId).not.toBe(edge.movingInstanceId);
    for (const [instanceId, connectionId] of [[edge.fixedInstanceId, edge.fixedConnectionId], [edge.movingInstanceId, edge.movingConnectionId]]) {
      const native = parts.get(instanceId)!;
      expect(native.connections.points.some(point => point.id === connectionId)).toBe(true);
      expect(status.capabilities.find(entry => entry.partId === native.partId)?.allowedConnectionIds).toContain(connectionId);
    }
    expect(edge.ruleVersion).toBe(CONNECTION_RULE_VERSION);
    adjacency.get(edge.fixedInstanceId)!.add(edge.movingInstanceId);
    adjacency.get(edge.movingInstanceId)!.add(edge.fixedInstanceId);
  }
  const visited = new Set<string>(), pending = [graph.placements[0].instanceId];
  while (pending.length) {
    const id = pending.pop()!;
    if (visited.has(id)) continue;
    visited.add(id); pending.push(...adjacency.get(id)!);
  }
  expect(visited.size).toBe(graph.placements.length);
  expect(validateConnectionOccupancy(graph.edges, parts)).toEqual({ valid: true, issues: [] });
}

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
  status = await response.json() as GrammarRuntimeStatus;
  expect(status.runtimeValidation.status).toBe('ready');
  report = JSON.parse(await readFile(new URL('../data/parts-foundation/assembly/migration.json', import.meta.url), 'utf8')) as AssemblyMigrationReport;
}, 45000);
afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe('native assembly production HTTP boundaries', () => {
  it('reports every actual source root and only counts runtime-validated admission decisions', async () => {
    expect(status.counts.total).toBe(253);
    expect(status.queue).toHaveLength(253);
    expect(new Set(status.queue.map(entry => entry.partId)).size).toBe(253);
    expect(status.admissionBasis).toBe('interface-grammar');
    expect(status.counts).toMatchObject({ assemblyVerified: 0, generatable: 99, blocked: 154, verifiedInterfaces: 0, testedPhysicalInterfaces: 0 });
    expect(report.counts.generatable).toBe(87); // Retained historical evidence, not current admission authority.
    expect(status.sourceCounts).toEqual(report.sourceCounts);
    expect(status.sourceCounts).toEqual({ totalRoots: 253, geometryReady: 253, connectionReady: 205, connectionPartial: 44, connectionMissing: 4 });
    expect(status.counts.assemblyVerified).toBe(status.queue.filter((entry) => entry.assemblyVerified).length);
    expect(status.counts.generatable).toBe(status.queue.filter((entry) => entry.generatable).length);
    expect(status.counts.blocked + status.counts.generatable).toBe(253);
    expect(status.counts.generatable).toBeGreaterThan(0);
    expect(status.grammar.counts.enabledNativeEndpoints).toBe(status.queue.reduce((sum, entry) => sum + entry.allowedConnectionIds.length, 0));
    expect(status.runtimeValidation.issues).toEqual([]);
    const coverage = status.interfaceCoverage!;
    expect(coverage).toBeDefined();
    expect(coverage).toMatchObject({ verifiedPass: 0, verifiedBlocked: 0, requiresAstraReview: 0 });
    expect(coverage.physicalInterfacesDiscovered).toBe(5019);
    expect(coverage.physicalInterfacesDiscovered).toBe(coverage.verifiedPass + coverage.verifiedBlocked + coverage.requiresAstraReview + coverage.pending);
    expect(coverage.verifiedPhysicalInterfaces).toBe(coverage.verifiedPass);
    expect(coverage.enabledPhysicalInterfaces).toBeLessThanOrEqual(coverage.verifiedPass);
    expect(coverage.enabledRawConnectionIds).toBe(status.counts.verifiedInterfaces);
    expect(coverage.pending).toBe(5019);
    expect(coverage.processedCoveragePercent).toBe(0);
    expect(coverage.verifiedCoveragePercent).toBe(Number((100 * coverage.verifiedPass / coverage.physicalInterfacesDiscovered).toFixed(4)));
    expect(coverage.fullyAssemblyVerified + coverage.partiallyGeneratable + coverage.blockedParts + coverage.unresolvedParts).toBe(253);
    expect(status.deferredRun).toBeUndefined();
    expect(status.grammar.counts).toMatchObject({ historicalFixtureProofsRequired: 0, executedPartFixtureTests: 0 });
    expect(status.runtimeValidation.reportLoaded).toBe(false);
    const byId = new Map(report.entries.map(entry => [entry.partId, entry]));
    for (const entry of status.entries) {
      const saved = byId.get(entry.partId)!;
      expect(entry.source.digest).toBe(saved.source.digest);
      expect(saved.allowedConnectionIds.every(id => entry.allowedConnectionIds.includes(id))).toBe(true);
      expect(entry.assemblyVerified).toBe(false);
      expect(entry.fixtureTestsTotal).toBe(0);
      expect(entry.interfaceCoverage?.decisions.every(decision => decision.status === 'PENDING')).toBe(true);
    }
    expect(status).toMatchObject({ ...versions, physicalBuildVerified: false, counts: { wheelModulesVerified: 0, physicalBuildsVerified: 0 } });
  });

  it('attaches the evidence-derived default pair with complete source hashes and four version bindings', async () => {
    expect(status.defaultPair).toBeDefined();
    const response = await post(`${prefix}/assembly/attach`, status.defaultPair);
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({ accepted: true, graph: { ...versions, physicalBuildVerified: false }, collision: { status: 'clear', proof: { wholePairExempted: false } }, debug: { insertionPathVerification: 'source-axis-seating-path' } });
    expect(result.graph.placements).toHaveLength(2);
    await expectConnectedSourceGraph(result.graph);
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
      await expectConnectedSourceGraph(model);
      expect(generated.search.finalPlacements).toBe(model.placements.length);
      expect(generated.search.finalConnectionEdges).toBe(model.edges.length);
      expect(generated.search.attachmentApiCalls).toBeGreaterThanOrEqual(model.placements.length - 1);
      expect(generated.search.attachmentApiCalls).toBeLessThanOrEqual(generated.search.attempts);
      expect(generated.search.acceptedAttachments).toBeGreaterThanOrEqual(model.placements.length - 1);
      expect(generated.search.acceptedAttachments + generated.search.rejectedAttachments).toBeLessThanOrEqual(generated.search.attempts);
      for (const count of [generated.search.transformFailures, generated.search.compatibilityFailures, generated.search.collisionFailures, generated.search.occupancyFailures, generated.search.designGoalFailures]) expect(count).toBeLessThanOrEqual(generated.search.rejectedAttachments);
      for (const duration of [generated.search.catalogTimeMs, generated.search.searchTimeMs]) expect(Number.isFinite(duration) && duration >= 0).toBe(true);
      for (const rejection of generated.search.rejectionReasons) expect(generated.search.rejectionCounts[rejection.code]).toBeGreaterThanOrEqual(rejection.count);
      for (const placement of model.placements) {
        const capability = status.capabilities.find((entry) => entry.partId === placement.partId);
        expect(capability).toMatchObject({ admissionBasis: 'interface-grammar', assemblyVerified: false, generatable: true });
      }
      const jsonResponse = await fetch(`${base}${prefix}/assembly/models/${model.id}/export?format=json`);
      expect(jsonResponse.status).toBe(200);
      const exported = await jsonResponse.json() as NativeGeneratedAssembly;
      expect(exported.id).toBe(model.id);
      expect(exported.contentSha256).toBe(model.contentSha256);
      expect(exported.placements).toEqual(model.placements);
      expect(exported.edges).toEqual(model.edges);
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
    const recovery = await recoveryResponse.json();
    const mappingStatusCounts = { VERIFIED: 0, PROBABLE_BUT_UNVERIFIED: 14, CONFLICT: 88, UNRESOLVED: 429 };
    expect(recovery).toMatchObject({ counts: { total: 531, mappedBySource: 531, independentlyVerifiedOfficial: 0, resolvedLDraw: 0, assemblyVerified: 0, generatable: 0 }, mappingStatusCounts, mappingStatusDenominator: 531 });
    expect(recovery.entries.every((entry: { mapping: { mappingStatus: string; geometryPipelineAllowed: boolean; ldrawPartId: string | null } }) => entry.mapping.mappingStatus !== 'VERIFIED' && !entry.mapping.geometryPipelineAllowed && entry.mapping.ldrawPartId === null)).toBe(true);
    const coverageResponse = await fetch(`${base}${prefix}/instructions/coverage`);
    expect(coverageResponse.status).toBe(200);
    const coverage = await coverageResponse.json();
    expect(coverage.documents).toHaveLength(8);
    expect(coverage.sets).toHaveLength(6);
    expect(coverage.overall.counts).toMatchObject({ uniqueObservedElements: 531, mapped: 531, resolvedLDraw: 0, assemblyVerified: 0, generatable: 0, unresolved: 531 });
    expect(coverage.overall.mappingStatusCounts).toEqual(mappingStatusCounts);
    for (const row of [coverage.overall, ...coverage.documents, ...coverage.sets]) expect(Object.values(row.mappingStatusCounts).reduce<number>((sum, count) => sum + Number(count), 0)).toBe(row.denominator);
    expect(coverage.overall.inventoryComplete).toBe(false);
  }, 30000);

  it('uses production-qualified 32000 through the public generation API and revalidates its exported model', async () => {
    const response = await post(`${prefix}/assembly/generate`, { module: 'wall', partCount: 3, requiredPartIds: ['32000'] });
    expect(response.status).toBe(200);
    const generated = await response.json() as NativeGenerationResult;
    expect(generated.status, generated.reasons.join('; ')).toBe('generated');
    const model = generated.model!;
    await expectConnectedSourceGraph(model);
    expect(model.placements.some(placement => placement.partId === '32000')).toBe(true);
    expect(model.bom.some(row => row.partId === '32000' && row.quantity > 0)).toBe(true);
    expect(model.steps.some(step => step.partId === '32000')).toBe(true);
    expect(model.sources.some(source => source.library === 'LDraw' && source.path === 'parts/32000.dat')).toBe(true);
    const exported = await fetch(`${base}${prefix}/assembly/models/${model.id}/export?format=json`);
    expect(exported.status).toBe(200);
    const content = await exported.text();
    const imported = await post(`${prefix}/assembly/models/import`, { content });
    expect(imported.status).toBe(200);
    const adopted = await imported.json();
    expect(adopted.status, adopted.reasons.join('; ')).toBe('VALID');
    expect(adopted.model.placements.some((placement: NativeAssembly['placements'][number]) => placement.partId === '32000')).toBe(true);
    const source = (await sourceRepository.getPart('32000'))!;
    const holes = source.connections.points.filter(point => point.family === 'pinHole');
    const capability = status.capabilities.find(entry => entry.partId === '32000')!;
    expect(holes.length).toBeGreaterThan(0);
    expect(holes.every(point => !capability.allowedConnectionIds.includes(point.id))).toBe(true);
    const tampered = structuredClone(model);
    const node = tampered.placements.find(placement => placement.partId === '32000')!;
    const edge = tampered.edges.find(edge => edge.fixedInstanceId === node.instanceId || edge.movingInstanceId === node.instanceId)!;
    if (edge.fixedInstanceId === node.instanceId) edge.fixedConnectionId = holes[0].id; else edge.movingConnectionId = holes[0].id;
    const { contentSha256: _old, ...body } = tampered;
    const sealed = { ...body, contentSha256: createHash('sha256').update(JSON.stringify(body)).digest('hex') };
    const denied = await post(`${prefix}/assembly/models/import`, { content: JSON.stringify(sealed) });
    expect(await denied.json()).toMatchObject({ status: 'NEEDS_REVALIDATION', model: null });
  }, 45000);

  it('rejects malformed required-part goals and never substitutes unknown or blocked native IDs', async () => {
    for (const requiredPartIds of ['32000', null, ['32000', '32000'], ['../32000'], ['element:32000'], ['3001', '3005', '3024', '3020']]) {
      const response = await post(`${prefix}/assembly/generate`, { module: 'wall', partCount: 3, requiredPartIds });
      expect(response.status).toBe(400);
    }
    for (const id of ['unknown-native-source', '18977']) {
      const response = await post(`${prefix}/assembly/generate`, { module: 'wall', partCount: 3, requiredPartIds: [id] });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ status: 'blocked', model: null });
    }
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
