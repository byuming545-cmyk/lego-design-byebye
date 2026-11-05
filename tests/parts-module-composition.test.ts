import { beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { GrammarAssemblyService } from '../src/parts/grammar/service.js';
import { NativeAssemblyGenerator, type NativeGeneratedAssembly, type NativeGeneratorEngine } from '../src/parts/assembly/generator.js';
import { exportNativeAssemblyJson, exportNativeAssemblyLDraw } from '../src/parts/assembly/documents.js';
import { ModuleAssembler, moduleAssemblerFor, sameModulePose, type ModuleComposition } from '../src/parts/modules/assembly.js';
import { measureSupport, moduleSupport } from '../src/parts/modules/support.js';
import { ModuleCatalog } from '../src/parts/modules/catalog.js';

const service = new GrammarAssemblyService();
const ids = ['76897-hood-core', '76897-rear-panel-core'];
let single: NativeGeneratedAssembly, paired: NativeGeneratedAssembly;
function resign(model: NativeGeneratedAssembly) {
  const { contentSha256: _old, ...content } = model;
  model.contentSha256 = createHash('sha256').update(JSON.stringify(content)).digest('hex');
  return model;
}
beforeAll(async () => {
  await service.ready();
  const one = await service.generate({ module: 'module-assembly', requiredPartIds: ['3001'] });
  expect(one.status, one.reasons.join(' ')).toBe('generated'); single = one.model!;
  const two = await service.generate({ module: 'module-assembly', requiredPartIds: ['3035'], requiredModuleIds: ids });
  expect(two.status, two.reasons.join(' ')).toBe('generated'); paired = two.model!;
}, 90000);

describe('ranked real module installation and two-function composition', () => {
  it('improves the recorded single-point baseline to four source mounting positions', async () => {
    const historical = JSON.parse(await readFile('artifacts/module-reuse/models/76897-hood-core-3001/model.json', 'utf8'));
    const oldIds = new Set<string>(historical.moduleComposition.instances[0].members.map((m: { instanceId: string }) => m.instanceId));
    expect(moduleSupport(historical, oldIds).independentPoints).toBe(1);
    expect(single.moduleComposition!.instances[0].installationSupport).toMatchObject({ independentPoints: 4, spanLdu: 60, physicalStability: 'not-verified' });
    expect((await service.engine.validateGraph(single)).valid).toBe(true);
  });
  it('keeps a legal forced single-point installation separate from multi-point coverage', async () => {
    const base = await service.engine.createAssembly('3001');
    const result = await moduleAssemblerFor(service.engine).attach(base, ids[0], { take: () => true },
      { anchorInstanceId: 'root', anchorConnectionId: 'p/stud.dat:8:0', localId: 'source-0', connectionId: 'parts/3460.dat:8:15', twistDegrees: 0 });
    expect(result.accepted, result.reasons.join(' ')).toBe(true);
    expect(result.composition!.instances[0].installationSupport).toMatchObject({ independentPoints: 1, status: 'single-point', spanLdu: 0 });
  });
  it('retains exact rear-panel identities and layout as a different source function', () => {
    const rear = new ModuleCatalog().get(ids[1]);
    expect(rear.recipe.role).toBe('rear-panel'); expect(rear.members.map(m => m.partId)).toEqual(['3666', '3666', '6636']);
    expect(rear.members.every(m => m.sourcePartId === m.partId)).toBe(true);
    expect(rear.recipe.selectedOrdinals).toEqual([5, 6, 7]); expect(rear.recipe.source.section).toBe('76897 - Back trunk.ldr');
  });
  it('generates and reimports a nine-part assembly with both source credits and all mounting edges', async () => {
    expect(paired.placements).toHaveLength(9); expect(paired.steps).toHaveLength(9); expect(paired.edges).toHaveLength(36);
    expect(paired.bom.find(row => row.partId === '3666')?.quantity).toBe(3);
    expect(paired.bom.find(row => row.partId === '6636')?.quantity).toBe(1);
    expect(paired.moduleComposition!.instances.map(instance => instance.moduleId)).toEqual(ids);
    expect(paired.moduleComposition!.instances.map(instance => instance.installationSupport.independentPoints)).toEqual([8, 6]);
    const ldraw = exportNativeAssemblyLDraw(paired);
    for (const id of ids) expect(ldraw).toContain(id);
    expect(ldraw).toContain('Adrien Pennamen');
    const imported = await service.importModel(JSON.parse(exportNativeAssemblyJson(paired)));
    expect(imported.status).toBe('VALID'); expect(imported.model?.moduleComposition).toEqual(paired.moduleComposition);
    expect(imported.model?.bom).toEqual(paired.bom); expect(imported.model?.steps).toEqual(paired.steps);
  });
  it('reuses the two functions on another native base without namespace collisions', async () => {
    const result = await service.generate({ module: 'module-assembly', requiredPartIds: ['3031'], requiredModuleIds: ids });
    expect(result.status, result.reasons.join(' ')).toBe('generated');
    expect(result.model!.moduleComposition!.instances.map(instance => instance.installationSupport.independentPoints)).toEqual([4, 4]);
    expect(new Set(result.model!.placements.map(p => p.instanceId)).size).toBe(9);
    expect(new Set(result.model!.moduleComposition!.instances.map(instance => instance.id)).size).toBe(2);
    expect((await service.importModel(result.model)).status).toBe('VALID');
  }, 20000);
  it('does not count duplicate edges, source aliases or colocated features as extra support locations', async () => {
    expect(measureSupport([[0, 0, 0], [0, 0, 0], [20, 0, 0], [20, 0, 0]])).toMatchObject({ independentPoints: 2, spanLdu: 20 });
    const copy = structuredClone(paired), instance = copy.moduleComposition!.instances[0];
    const members = new Set(instance.members.map(member => member.instanceId));
    const crossing = copy.edges.find(edge => members.has(edge.fixedInstanceId) !== members.has(edge.movingInstanceId))!;
    copy.edges.push({ ...crossing, id: 'duplicated-contact-evidence' });
    expect(moduleSupport(copy, members).independentPoints).toBe(8);
    expect((await service.importModel(resign(copy))).status).toBe('NEEDS_REVALIDATION');
  });
  it('rebuilds uploaded support claims rather than authorizing a forged stability score', async () => {
    const copy = structuredClone(paired);
    Object.assign(copy.moduleComposition!.instances[0].installationSupport, { independentPoints: 999, physicalStability: 'certified', holdingForce: 1000 });
    const result = await service.importModel(resign(copy));
    expect(result.status).toBe('VALID');
    expect(result.model!.moduleComposition!.instances[0].installationSupport).toEqual(paired.moduleComposition!.instances[0].installationSupport);
  });
  it('rejects one wrong mounting anchor even after the uploader recalculates the checksum', async () => {
    const copy = structuredClone(paired); copy.edges[0].anchor[0] += 1;
    expect((await service.importModel(resign(copy))).status).toBe('NEEDS_REVALIDATION');
  });
  it('leaves the original graph and earlier module provenance untouched when a mount is occupied', async () => {
    const before = JSON.stringify(single), instance = single.moduleComposition!.instances[0], members = new Set(instance.members.map(m => m.instanceId));
    const edge = single.edges.find(e => e.fixedInstanceId === 'root' && members.has(e.movingInstanceId))!;
    const assembler = moduleAssemblerFor(service.engine), rear = await assembler.compile(ids[1]);
    const port = rear.ports.find(p => p.localId === 'source-5')!;
    const result = await assembler.attach(single, ids[1], { take: () => true }, { anchorInstanceId: 'root', anchorConnectionId: edge.fixedConnectionId, ...port });
    expect(result.accepted).toBe(false); expect(JSON.stringify(single)).toBe(before); expect(result.graph).toEqual(single);
  });
  it('refreshes unused cached ports after an interface permission is revoked', async () => {
    let revoked: { partId: string; connectionId: string } | undefined;
    const port: NativeGeneratorEngine = {
      createAssembly: (id, cl) => service.engine.createAssembly(id, cl), attachPart: (graph, request) => service.engine.attachPart(graph, request),
      getPart: id => service.engine.getPart(id), validateGraph: graph => service.engine.validateGraph(graph),
      getCapability: async id => {
        const cap = await service.engine.getCapability(id);
        return cap && revoked?.partId === id ? { ...cap, allowedConnectionIds: cap.allowedConnectionIds.filter(endpoint => endpoint !== revoked!.connectionId) } : cap;
      },
    };
    const assembler = new ModuleAssembler(port), compiled = await assembler.compile(ids[0]);
    const unused = compiled.ports[0], member = compiled.members.find(m => m.localId === unused.localId)!;
    revoked = { partId: member.partId, connectionId: unused.connectionId };
    const refreshed = await assembler.compile(ids[0]);
    expect((await service.engine.validateGraph(refreshed.graph)).valid).toBe(true);
    expect(refreshed.ports.some(p => p.localId === unused.localId && p.connectionId === unused.connectionId)).toBe(false);
  });
  it('backtracks after an explicitly injected test-only slot rejection, keeping all accepted geometry real', async () => {
    // A deterministic rejection policy exercises search control, not LEGO truth.
    // Only rejections are injected. All accepted attachments use the production engine.
    const firstPose = single.moduleComposition!.instances[0].transform;
    const port: NativeGeneratorEngine = {
      createAssembly: (id, cl) => service.engine.createAssembly(id, cl),
      getPart: id => service.engine.getPart(id), getCapability: id => service.engine.getCapability(id),
      validateGraph: graph => service.engine.validateGraph(graph),
      attachPart: async (graph, request) => {
        const previous = (graph as typeof graph & { moduleComposition?: ModuleComposition }).moduleComposition;
        if (previous?.instances.length === 1 && sameModulePose(previous.instances[0].transform, firstPose)) {
          return { accepted: false, graph, rejections: [{ code: 'development-slot-rejection', reason: 'Test-only rejection of the initial placement branch.' }] };
        }
        return service.engine.attachPart(graph, request);
      },
    };
    const generator = new NativeAssemblyGenerator(port, { partIds: await service.repository.listIds() });
    const result = await generator.generate({ module: 'module-assembly', requiredPartIds: ['3001'], requiredModuleIds: ids });
    expect(result.status, result.reasons.join(' ')).toBe('generated'); expect(result.search.backtracks).toBeGreaterThan(0);
    expect((await service.engine.validateGraph(result.model!)).valid).toBe(true);
    expect(sameModulePose(result.model!.moduleComposition!.instances[0].transform, firstPose)).toBe(false);
  }, 20000);
  it('returns no partial model when the shared multi-module search budget is exhausted', async () => {
    const generator = new NativeAssemblyGenerator(service.engine, { partIds: await service.repository.listIds(), maxAttempts: 1 });
    const result = await generator.generate({ module: 'module-assembly', requiredPartIds: ['3035'], requiredModuleIds: ids });
    expect(result.status).toBe('blocked'); expect(result.model).toBeNull(); expect(result.search.exhausted).toBe(true);
  });
  it('requires revalidation of the previous catalogue and module-policy evidence without rewriting it', async () => {
    const path = 'artifacts/module-reuse/models/76897-hood-core-3001/model.json', before = await readFile(path, 'utf8');
    expect((await service.importModel(JSON.parse(before))).status).toBe('NEEDS_REVALIDATION');
    expect(await readFile(path, 'utf8')).toBe(before);
  });
});
