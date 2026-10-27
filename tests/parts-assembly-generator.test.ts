import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { NativePartRepository } from '../src/parts/assembly/source.js';
import { NativeAssemblyGenerator, type NativeGeneratedAssembly, type NativeGeneratorEngine } from '../src/parts/assembly/generator.js';
import type { AssemblyInterfaceCapability, NativeAssemblyPart } from '../src/parts/assembly/types.js';
import { AttachmentEngine } from '../src/parts/assembly/engine.js';
import { createAssemblySourceLoader, loadStandardAssemblyFixtures } from '../src/parts/assembly/fixtures.js';
import { verifyNativePartAssembly } from '../src/parts/assembly/verification.js';
import { exportNativeAssemblyBomCsv, exportNativeAssemblyJson, exportNativeAssemblyLDraw } from '../src/parts/assembly/documents.js';
import { isRigidTransform, rotate } from '../src/parts/assembly/math.js';
import { solveAttachment } from '../src/parts/assembly/solver.js';
import { checkMultiPointConnection } from '../src/parts/assembly/multipoint.js';
import { fileURLToPath } from 'node:url';

const repository = new NativePartRepository();
let plate: NativeAssemblyPart;
beforeAll(async () => { plate = (await repository.getPart('3031'))!; expect(plate.geometry.status).toBe('geometryReady'); });

function deniedEngine(capability?: Partial<AssemblyInterfaceCapability>, source: NativeAssemblyPart | undefined = plate): NativeGeneratorEngine {
  return {
    getPart: vi.fn(async () => source),
    getCapability: vi.fn(async partId => ({ partId, assemblyVerified: false, generatable: false, allowedConnectionIds: [], ruleIds: [], reasonCodes: ['unverified'], reasons: ['No source-backed assembly verification.'], ...capability })),
    createAssembly: vi.fn(async () => { throw new Error('An unverified source must never reach root creation.'); }),
    attachPart: vi.fn(async () => { throw new Error('An unverified source must never reach attachment.'); }),
    validateGraph: vi.fn(async () => ({ valid: false, issues: ['No graph should be generated in this denied-source fixture.'] })),
  };
}

describe('real native generator eligibility', () => {
  it('requires both assembly verification and generation admission before calling the assembly engine', async () => {
    for (const flags of [{ assemblyVerified: false, generatable: true }, { assemblyVerified: true, generatable: false }]) {
      const engine = deniedEngine({ ...flags, allowedConnectionIds: plate.connections.points.map(point => point.id) });
      const result = await new NativeAssemblyGenerator(engine, { partIds: ['3031'] }).generate({ module: 'wall' });
      expect(result).toMatchObject({ status: 'blocked', model: null, search: { attempts: 0, testedRoots: 0 } });
      expect(engine.createAssembly).not.toHaveBeenCalled();
      expect(engine.attachPart).not.toHaveBeenCalled();
    }
  });

  it('does not trust admission flags if the actual source closure is not verified', async () => {
    const changed = structuredClone(plate);
    changed.geometry.source.integrity = 'not-manifested';
    const engine = deniedEngine({ assemblyVerified: true, generatable: true, allowedConnectionIds: plate.connections.points.map(point => point.id) }, changed);
    const result = await new NativeAssemblyGenerator(engine, { partIds: ['3031'] }).generate({ module: 'platform' });
    expect(result.status).toBe('blocked');
    expect(engine.createAssembly).not.toHaveBeenCalled();
  });

  it('refuses to manufacture a wheel module from otherwise eligible ordinary stud interfaces', async () => {
    const engine = deniedEngine({ assemblyVerified: true, generatable: true, allowedConnectionIds: plate.connections.points.map(point => point.id), ruleIds: ['source-stud-underside'] });
    const result = await new NativeAssemblyGenerator(engine, { partIds: ['3031'] }).generate({ module: 'wheel-module' });
    expect(result.status).toBe('blocked');
    expect(result.reasons.join(' ')).toContain('轮毂');
    expect(engine.createAssembly).not.toHaveBeenCalled();
  });

  it('rejects unsupported generation parameters and oversized searches before reading source data', async () => {
    const engine = deniedEngine();
    await expect(new NativeAssemblyGenerator(engine).generate({ module: 'invent-a-car' as 'wall' })).rejects.toThrow('支持的基础结构');
    await expect(new NativeAssemblyGenerator(engine).generate({ module: 'wall', partCount: 33 })).rejects.toThrow('3–32');
    await expect(new NativeAssemblyGenerator(engine).generate({ module: 'basic-snot', partCount: 4 })).rejects.toThrow('固定');
    await expect(new NativeAssemblyGenerator(engine).generate({ module: 'bar-clip', partCount: 3 })).rejects.toThrow('固定');
    await expect(new NativeAssemblyGenerator(engine).generate({ module: 'wall', requiredPartIds: ['3001', '3001'] })).rejects.toThrow('不重复');
    await expect(new NativeAssemblyGenerator(engine).generate({ module: 'wall', requiredPartIds: ['../3001'] })).rejects.toThrow('原生编号');
    expect(engine.getCapability).not.toHaveBeenCalled();
    expect(() => new NativeAssemblyGenerator(engine, { maxAttempts: Number.MAX_SAFE_INTEGER })).toThrow('预算');
  });

  it('does not grant a required source part eligibility merely because it was requested', async () => {
    const engine = deniedEngine({ assemblyVerified: false, generatable: false });
    const result = await new NativeAssemblyGenerator(engine, { partIds: ['3031'] }).generate({ module: 'wall', requiredPartIds: ['3031'] });
    expect(result.status).toBe('blocked');
    expect(engine.createAssembly).not.toHaveBeenCalled();
    expect(engine.attachPart).not.toHaveBeenCalled();
  });
});

describe('real source assembly generation and exports', () => {
  const sourceIds = ['3005', '3001', '3024', '3023b', '3022', '3020', '3031', '3070b', '87087', '54200'];
  const capabilities = new Map<string, AssemblyInterfaceCapability>();
  const models = new Map<string, NativeGeneratedAssembly>();
  let generator: NativeAssemblyGenerator, production: AttachmentEngine;
  beforeAll(async () => {
    const fixtures = await loadStandardAssemblyFixtures(await createAssemblySourceLoader(repository));
    const verification = new AttachmentEngine({ loadPart: id => repository.getPart(id), mode: 'verification' });
    for (const id of sourceIds) {
      const part = (await repository.getPart(id))!;
      capabilities.set(id, await verifyNativePartAssembly(part, part.geometry.name ?? id, fixtures, verification));
    }
    production = new AttachmentEngine({ loadPart: id => repository.getPart(id), getCapability: id => capabilities.get(id) });
    generator = new NativeAssemblyGenerator(production, { partIds: sourceIds, maxAttempts: 1200, maxBacktracks: 30 });
  }, 120_000);

  it.each(['wall', 'platform', 'simple-chassis', 'simple-box', 'simple-roof', 'basic-snot'] as const)('builds %s exclusively through real source-backed attachments', async module => {
    const result = await generator.generate({ module });
    expect(result.status, result.reasons.join('\n')).toBe('generated');
    const model = result.model!;
    models.set(module, model);
    expect(model.placements.length).toBe(module === 'simple-box' ? 13 : module === 'basic-snot' ? 3 : 5);
    expect(model.edges.length).toBeGreaterThanOrEqual(model.placements.length - 1);
    expect(model.placements.every(placement => sourceIds.includes(placement.partId) && capabilities.get(placement.partId)?.assemblyVerified && capabilities.get(placement.partId)?.generatable && isRigidTransform(placement.transform))).toBe(true);
    expect(model.assemblyValidation).toEqual({ checked: true, valid: true, issues: [] });
    expect(await production.validateGraph(model)).toEqual({ valid: true, issues: [] });
    expect(model.bom.reduce((sum, row) => sum + row.quantity, 0)).toBe(model.placements.length);
    expect(model.steps).toHaveLength(model.placements.length);
    expect(new Set(model.steps.flatMap(step => step.connectionEdgeIds)).size).toBe(model.edges.length);
    expect(result.search).toMatchObject({ finalPlacements: model.placements.length, finalConnectionEdges: model.edges.length });
    expect(result.search.searchTimeMs).toBeGreaterThanOrEqual(0);
    expect(result.search.attachmentApiCalls).toBeLessThanOrEqual(result.search.attempts);
    expect(result.search.acceptedAttachments + result.search.rejectedAttachments).toBe(result.search.attempts);
    expect(model.physicalBuildVerified).toBe(false);
    if (module === 'basic-snot') expect(model.placements.some(placement => Math.abs(rotate(placement.transform.rotation, [0, -1, 0])[1]) < 1e-6)).toBe(true);
    if (module === 'simple-chassis') {
      expect(result.search.attempts).toBeGreaterThanOrEqual(model.placements.length - 1);
      const root = (await production.getPart(model.placements[0].partId))!;
      const allowed = capabilities.get(root.partId)!.allowedConnectionIds;
      const points = root.connections.points.filter(point => allowed.includes(point.id) && point.gender === 'M' && point.family === 'stud' && point.direction[1] < -0.99);
      const supports = model.edges.map(edge => points.find(point => point.id === edge.fixedConnectionId)!);
      for (const axis of [0, 2]) {
        expect(new Set(points.map(point => point.position[axis])).size).toBeGreaterThanOrEqual(2);
        expect(Math.min(...supports.map(point => point.position[axis]))).toBe(Math.min(...points.map(point => point.position[axis])));
        expect(Math.max(...supports.map(point => point.position[axis]))).toBe(Math.max(...points.map(point => point.position[axis])));
      }
      // A three-part request needs two separated supports, not an exhaustive
      // dense-mesh search on the longest available plate.
      const minimal = await new NativeAssemblyGenerator(production, { partIds: sourceIds, maxAttempts: 16, maxBacktracks: 4 }).generate({ module, partCount: 3 });
      expect(minimal.status, minimal.reasons.join('\n')).toBe('generated');
      expect(minimal.model!.placements).toHaveLength(3);
      expect(minimal.search.attempts).toBeLessThanOrEqual(4);
      expect(await production.validateGraph(minimal.model!)).toEqual({ valid: true, issues: [] });
    }
  }, 60_000);

  it('retains source versions, graph, real DAT references and BOM on export, and rejects edited models', () => {
    const model = models.get('platform')!;
    const json = JSON.parse(exportNativeAssemblyJson(model));
    expect(json).toMatchObject({ partLibraryVersion: model.partLibraryVersion, assemblyEngineVersion: model.assemblyEngineVersion, connectionRuleVersion: model.connectionRuleVersion, collisionVersion: model.collisionVersion });
    const references = exportNativeAssemblyLDraw(model).split(/\r?\n/).filter(line => line.startsWith('1 '));
    expect(references).toHaveLength(model.placements.length);
    expect(references.every(line => sourceIds.some(id => line.endsWith(` ${id}.dat`)))).toBe(true);
    expect(exportNativeAssemblyBomCsv(model)).toContain('not-verified');
    const changed = structuredClone(model);
    changed.placements[0].transform.translation[0] += 1;
    expect(() => exportNativeAssemblyJson(changed)).toThrow('已修改');
    const stretched = structuredClone(model);
    stretched.placements[0].transform.rotation[0] = 2;
    const { contentSha256: _previous, ...document } = stretched;
    stretched.contentSha256 = createHash('sha256').update(JSON.stringify(document)).digest('hex');
    expect(() => exportNativeAssemblyLDraw(stretched)).toThrow('非刚性变换');
    const invented = structuredClone(model);
    invented.placements[0].partId = 'invented-legacy-proxy';
    invented.sourceHashes['invented-legacy-proxy'] = model.sourceHashes[model.placements[0].partId];
    invented.sources.push({ ...model.sources.find(source => source.path === `parts/${model.placements[0].partId}.dat`)!, path: 'parts/invented-legacy-proxy.dat' });
    const { contentSha256: _oldHash, ...inventedDocument } = invented;
    invented.contentSha256 = createHash('sha256').update(JSON.stringify(inventedDocument)).digest('hex');
    expect(() => exportNativeAssemblyJson(invented)).toThrow('不在当前零件库');
    const stale = { ...model, assemblyEngineVersion: 'native-assembly-expired-fixture' };
    const { contentSha256: _staleHash, ...staleContents } = stale;
    stale.contentSha256 = createHash('sha256').update(JSON.stringify(staleContents)).digest('hex');
    expect(() => exportNativeAssemblyJson(stale)).toThrow('版本已失效');
  });

  it('exports a real plate bridging two placed source parts with multiple new edges and one BOM/step addition', async () => {
    const initial = await new NativeAssemblyGenerator(production, { partIds: ['3023b', '3024'], maxAttempts: 12 }).generate({ module: 'platform', partCount: 3 });
    expect(initial.status, initial.reasons.join('\n')).toBe('generated');
    const base = initial.model!;
    const fixedPlacement = base.placements[1], fixed = (await production.getPart(fixedPlacement.partId))!, moving = (await production.getPart('3023b'))!;
    const anchor = fixed.connections.points.find(point => point.gender === 'M' && capabilities.get(fixed.partId)!.allowedConnectionIds.includes(point.id))!;
    const receiver = moving.connections.points.find(point => point.gender === 'F' && point.position[0] === -10 && point.position[2] === 0 && capabilities.get(moving.partId)!.allowedConnectionIds.includes(point.id))!;
    const solved = solveAttachment({ fixedPart: fixed, fixedPlacement, fixedConnectionId: anchor.id, movingPart: moving, movingConnectionId: receiver.id });
    let twistDegrees: number | undefined;
    for (const candidate of solved.candidates) {
      let matches = 0;
      for (const placement of base.placements.slice(1)) matches += checkMultiPointConnection({ fixedPart: (await production.getPart(placement.partId))!, fixedPlacement: placement, movingPart: moving, movingPlacement: { instanceId: 'source-preview', partId: moving.partId, transform: candidate.transform } }).matches.length;
      if (matches >= 2) { twistDegrees = candidate.twistDeg; break; }
    }
    expect(twistDegrees).toBeDefined();
    const attached = await production.attachPart(base, { anchorInstanceId: fixedPlacement.instanceId, anchorConnectionId: anchor.id, partId: moving.partId, candidateConnectionId: receiver.id, twistDegrees });
    expect(attached.accepted, attached.rejections.map(row => row.reason).join('\n')).toBe(true);
    expect(attached.graph.placements).toHaveLength(4);
    expect(attached.graph.edges).toHaveLength(4);
    expect(await production.validateGraph(attached.graph)).toEqual({ valid: true, issues: [] });
    // This fixture document uses the actual engine graph and existing source
    // closures; no extra geometry or placement is constructed in the test.
    const document = {
      ...base, ...attached.graph,
      bom: base.bom.map(row => row.partId === moving.partId ? { ...row, quantity: row.quantity + 1 } : row),
      steps: attached.graph.placements.map((placement, index) => ({ step: index + 1, addedInstanceId: placement.instanceId, partId: placement.partId, connectionEdgeIds: attached.graph.edges.filter(edge => edge.movingInstanceId === placement.instanceId).map(edge => edge.id) })),
    };
    const { contentSha256: _old, ...contents } = document;
    document.contentSha256 = createHash('sha256').update(JSON.stringify(contents)).digest('hex');
    expect(JSON.parse(exportNativeAssemblyJson(document)).steps[3].connectionEdgeIds).toHaveLength(2);
    expect(exportNativeAssemblyLDraw(document).split(/\r?\n/).filter(line => line.startsWith('1 '))).toHaveLength(4);
    expect(exportNativeAssemblyBomCsv(document)).toContain('"3023b","Plate  1 x  2",2');
    const changedSteps = structuredClone(document);
    changedSteps.steps[3].connectionEdgeIds.pop();
    const { contentSha256: _previous, ...badContents } = changedSteps;
    changedSteps.contentSha256 = createHash('sha256').update(JSON.stringify(badContents)).digest('hex');
    expect(() => exportNativeAssemblyJson(changedSteps)).toThrow('多点连接');
  }, 60_000);

  it('backtracks from an actual valid attachment when a later design constraint closes that branch', async () => {
    // A reserved assembly branch models a later design constraint. Every pose
    // that can be accepted still comes from the real production engine below.
    let reservedFirstPort: string | undefined;
    const constrained: NativeGeneratorEngine = {
      getPart: id => production.getPart(id), getCapability: id => production.getCapability(id),
      createAssembly: id => production.createAssembly(id), validateGraph: graph => production.validateGraph(graph),
      async attachPart(graph, request) {
        if (reservedFirstPort && graph.edges[0]?.fixedConnectionId === reservedFirstPort) return { accepted: false, graph, rejections: [{ code: 'reserved-design-branch', reason: 'This valid first placement leads into a reserved design branch.' }] };
        const result = await production.attachPart(graph, request);
        if (!reservedFirstPort && graph.placements.length === 1 && result.accepted) reservedFirstPort = request.anchorConnectionId;
        return result;
      },
    };
    const result = await new NativeAssemblyGenerator(constrained, { partIds: ['3031', '3024'], maxAttempts: 1500, maxBacktracks: 20 }).generate({ module: 'platform' });
    expect(result.status, result.reasons.join('\n')).toBe('generated');
    expect(result.search.backtracks).toBeGreaterThan(0);
    expect(result.search.rejectionCounts['reserved-design-branch']).toBeGreaterThan(0);
    expect(result.model!.edges[0].fixedConnectionId).not.toBe(reservedFirstPort);
    expect(await production.validateGraph(result.model!)).toEqual({ valid: true, issues: [] });
  }, 60_000);

  it('selects geometry and qualified ports independently of source display titles', async () => {
    const renamed: NativeGeneratorEngine = {
      createAssembly: id => production.createAssembly(id), attachPart: (graph, request) => production.attachPart(graph, request),
      getCapability: id => production.getCapability(id), validateGraph: graph => production.validateGraph(graph),
      async getPart(id) {
        const source = await production.getPart(id); if (!source) return undefined;
        // A presentation-only label change leaves all original source bytes,
        // native vertices, connectors and permissions intact.
        const copy = structuredClone(source); copy.geometry.name = '原始数据的本地显示名称'; return copy;
      },
    };
    const renamedGenerator = new NativeAssemblyGenerator(renamed, { partIds: sourceIds });
    for (const module of ['wall', 'platform', 'simple-chassis', 'simple-box', 'simple-roof', 'basic-snot'] as const) {
      const result = await renamedGenerator.generate({ module });
      expect(result.status, `${module}: ${result.reasons.join('\n')}`).toBe('generated');
      expect(await production.validateGraph(result.model!)).toEqual({ valid: true, issues: [] });
    }
  }, 60_000);

  it('fulfils a generic requested source-part goal in real generation and blocks an unknown requested ID', async () => {
    const result = await generator.generate({ module: 'wall', partCount: 3, requiredPartIds: ['3001'] });
    expect(result.status, result.reasons.join('\n')).toBe('generated');
    expect(result.model!.placements.some(placement => placement.partId === '3001')).toBe(true);
    expect(result.model!.bom.some(row => row.partId === '3001')).toBe(true);
    expect(result.model!.steps.some(row => row.partId === '3001')).toBe(true);
    expect(await production.validateGraph(result.model!)).toEqual({ valid: true, issues: [] });
    const missing = await generator.generate({ module: 'wall', requiredPartIds: ['unknown-native-part'] });
    expect(missing).toMatchObject({ status: 'blocked', model: null, search: { attempts: 0 } });
    expect(missing.reasons.join(' ')).toContain('required-source-unavailable');
  }, 60_000);

  it('uses a required large native plate as the normal foundation without repeatedly preferring already-covered copies', async () => {
    const result = await generator.generate({ module: 'platform', partCount: 3, requiredPartIds: ['3031'] });
    expect(result.status, result.reasons.join('\n')).toBe('generated');
    expect(result.model!.placements[0].partId).toBe('3031');
    expect(result.model!.placements.slice(1).every(part => part.partId !== '3031')).toBe(true);
    expect(result.search.attachmentApiCalls).toBeLessThanOrEqual(4);
    expect(await production.validateGraph(result.model!)).toEqual({ valid: true, issues: [] });
  }, 60_000);
});

describe('source-verified multi-stud Technic brick selection', () => {
  let production: AttachmentEngine, requiredGenerator: NativeAssemblyGenerator;
  const capabilities = new Map<string, AssemblyInterfaceCapability>();
  const sources = ['3024', '3023b', '3005', '3031', '32000'];
  // The fixture consumes the actual reviewed source bundle before or after its
  // formal root migration, never a synthetic shape or hand-authored capability.
  const staged = new NativePartRepository({
    geometryDirectory: fileURLToPath(new URL('../data/parts-foundation/pilots/speed-26/ldraw/', import.meta.url)),
    shadowDirectory: fileURLToPath(new URL('../data/parts-foundation/pilots/speed-26/shadow/', import.meta.url)),
  });
  const load = async (id: string) => await repository.getPart(id) ?? await staged.getPart(id);
  beforeAll(async () => {
    const fixtures = await loadStandardAssemblyFixtures(await createAssemblySourceLoader(repository));
    const verifier = new AttachmentEngine({ mode: 'verification', loadPart: load });
    for (const id of sources) {
      const part = (await load(id))!;
      capabilities.set(id, await verifyNativePartAssembly(part, part.geometry.name ?? id, fixtures, verifier, { maxInterfacesPerPart: null }));
    }
    production = new AttachmentEngine({ loadPart: load, getCapability: id => capabilities.get(id) });
    requiredGenerator = new NativeAssemblyGenerator(production, { partIds: sources });
  }, 60_000);

  it('actually generates a complete structure using required 32000 and current native source interfaces', async () => {
    const result = await requiredGenerator.generate({ module: 'wall', partCount: 3, requiredPartIds: ['32000'] });
    expect(result.status, result.reasons.join('\n')).toBe('generated');
    const model = result.model!;
    expect(model.placements.some(part => part.partId === '32000')).toBe(true);
    expect(model.bom.some(row => row.partId === '32000')).toBe(true);
    expect(model.steps.some(row => row.partId === '32000')).toBe(true);
    expect(model.sources.some(row => row.library === 'LDraw' && row.path === 'parts/32000.dat')).toBe(true);
    expect(await production.validateGraph(model)).toEqual({ valid: true, issues: [] });
    expect(result.search.attachmentApiCalls).toBeGreaterThan(0);
  }, 60_000);

  it('keeps a stud block out of a pin hole even when the same brick has ordinary stud qualifications', async () => {
    const part = (await load('32000'))!, hole = part.connections.points.find(point => point.family === 'pinHole')!;
    expect(hole).toBeDefined();
    expect(capabilities.get('32000')!.allowedConnectionIds).toContain(hole.id);
    const plate = (await load('3024'))!;
    const receiver = plate.connections.points.find(point => point.gender === 'F' && capabilities.get('3024')!.allowedConnectionIds.includes(point.id))!;
    const seed = await production.createAssembly('32000');
    const result = await production.attachPart(seed, { anchorInstanceId: 'root', anchorConnectionId: hole.id, partId: '3024', candidateConnectionId: receiver.id });
    expect(result.accepted).toBe(false);
    expect(result.rejections.length).toBeGreaterThan(0);
    expect(result.graph).toEqual(seed);
  });
});
