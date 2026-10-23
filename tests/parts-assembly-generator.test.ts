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
    expect(engine.getCapability).not.toHaveBeenCalled();
    expect(() => new NativeAssemblyGenerator(engine, { maxAttempts: Number.MAX_SAFE_INTEGER })).toThrow('预算');
  });
});

describe('real source assembly generation and exports', () => {
  const sourceIds = ['3005', '3001', '3024', '3022', '3020', '3031', '3070b', '87087', '54200'];
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
    expect(model.edges).toHaveLength(model.placements.length - 1);
    expect(model.placements.every(placement => sourceIds.includes(placement.partId) && capabilities.get(placement.partId)?.assemblyVerified && capabilities.get(placement.partId)?.generatable && isRigidTransform(placement.transform))).toBe(true);
    expect(model.assemblyValidation).toEqual({ checked: true, valid: true, issues: [] });
    expect(await production.validateGraph(model)).toEqual({ valid: true, issues: [] });
    expect(model.bom.reduce((sum, row) => sum + row.quantity, 0)).toBe(model.placements.length);
    expect(model.steps).toHaveLength(model.placements.length);
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
  });

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
});
