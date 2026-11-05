import { beforeAll, describe, expect, it } from 'vitest';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { GrammarAssemblyService } from '../src/parts/grammar/service.js';
import { ModuleCatalog, MODULE_DIRECTORY } from '../src/parts/modules/catalog.js';
import { readSelectedModuleMembers } from '../src/parts/modules/source.js';
import { ModuleAssembler } from '../src/parts/modules/assembly.js';
import { AttachmentEngine } from '../src/parts/assembly/engine.js';
import { exportNativeAssemblyJson, exportNativeAssemblyLDraw } from '../src/parts/assembly/documents.js';
import { isRigidTransform } from '../src/parts/assembly/math.js';
import type { NativeGeneratedAssembly } from '../src/parts/assembly/generator.js';

const service = new GrammarAssemblyService();
const catalog = new ModuleCatalog();
const ids = ['75878-curved-cover-right', '75878-curved-cover-left'];
let paired: NativeGeneratedAssembly;
beforeAll(async () => {
  await service.ready();
  const result = await service.generate({ module: 'module-assembly', requiredPartIds: ['3035'], requiredModuleIds: ids });
  expect(result.status, result.reasons.join(' ')).toBe('generated'); paired = result.model!;
}, 60000);

describe('literal licensed body extraction', () => {
  it('retains the three source identities and role contracts without claiming the entire parent', () => {
    const definition = catalog.get(ids[0]);
    expect(definition.recipe.source).toMatchObject({ setNumber: '75878', author: 'Magnus Forsberg [MagFors]', license: 'CC-BY-2.0' });
    expect(definition.members.map(m => [m.ordinal, m.sourcePartId, m.partId, m.collisionClass])).toEqual([
      [99, '3022', '3022', 'structural'], [100, '15068', '15068', 'exterior-shell'], [101, '3069b', '3069b', 'structural'],
    ]);
    expect(definition.members.every(m => isRigidTransform(m.transform))).toBe(true);
    expect(definition.members[0].transform.translation).toEqual([0, 0, 0]);
    expect(catalog.get(ids[1]).recipe.selectedOrdinals).toEqual([102, 103, 104]);
  });
  it.each([32, 119, 999, -1])('continues rejecting unsupported, non-rigid or missing SELECTED record %s', async ordinal => {
    const recipe = catalog.get(ids[0]).recipe, text = await readFile(path.join(MODULE_DIRECTORY, recipe.source.file), 'utf8');
    expect(() => readSelectedModuleMembers(text, { ...recipe, selectedOrdinals: [99, ordinal], exteriorOrdinals: [] })).toThrow();
  });
  it('rejects source changes even when only an excluded record was changed', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'body-source-integrity-'));
    try {
      await cp(MODULE_DIRECTORY, dir, { recursive: true });
      const file = path.join(dir, 'source/75878-body.ldr');
      await writeFile(file, (await readFile(file, 'utf8')).replace('30029.dat', 'not-a-reviewed-part.dat'));
      expect(() => new ModuleCatalog(dir).get(ids[0])).toThrow('MODULE_SOURCE_CHANGED');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('rejects inconsistent selection metadata instead of inheriting excluded declarations', async () => {
    const recipe = catalog.get(ids[0]).recipe, text = await readFile(path.join(MODULE_DIRECTORY, recipe.source.file), 'utf8');
    for (const alteration of [{ selectedOrdinals: [99, 99] }, { exteriorOrdinals: [32] }, { replacements: { '32': '3001' } }, { entryOrdinal: 0 }]) {
      expect(() => readSelectedModuleMembers(text, { ...recipe, ...alteration })).toThrow();
    }
  });
});

describe('surface covers through the ordinary module generator', () => {
  it.each(['3001', '3020'])('installs the multi-piece functional core on %s with current roundtrip', async base => {
    const result = await service.generate({ module: 'module-assembly', requiredPartIds: [base], requiredModuleIds: [ids[0]] });
    expect(result.status, result.reasons.join(' ')).toBe('generated');
    const model = result.model!;
    expect(model.placements).toHaveLength(4); expect(model.steps).toHaveLength(4);
    expect(model.bom.map(row => row.partId).sort()).toEqual([base, '3022', '3069b', '15068'].sort());
    expect(model.placements.find(p => p.partId === '15068')!.collisionClass).toBe('exterior-shell');
    expect(model.moduleComposition!.instances[0].installationSupport.independentPoints).toBe(6);
    expect((await service.importModel(JSON.parse(exportNativeAssemblyJson(model)))).status).toBe('VALID');
  }, 30000);
  it('composes both reviewed variants with current permissions, exact graph and honest source credit', async () => {
    expect(paired.placements).toHaveLength(7); expect(paired.steps).toHaveLength(7); expect(paired.edges).toHaveLength(20);
    expect(paired.placements.filter(p => p.collisionClass === 'exterior-shell').map(p => p.partId)).toEqual(['15068', '15068']);
    expect(paired.moduleComposition!.instances.map(m => m.moduleId)).toEqual(ids);
    expect(paired.moduleComposition!.instances.map(m => m.installationSupport.independentPoints)).toEqual([6, 6]);
    expect((await service.engine.validateGraph(paired)).valid).toBe(true);
    expect((await service.getCapability('15068'))!.generatable).toBe(false);
    const restored = await service.importModel(JSON.parse(exportNativeAssemblyJson(paired)));
    expect(restored.status).toBe('VALID'); expect(restored.model?.bom).toEqual(paired.bom);
    const text = exportNativeAssemblyLDraw(paired);
    expect(text).toContain('Magnus Forsberg'); expect(text).toContain('75878'); expect(text).toContain('https://creativecommons.org/licenses/by/2.0/');
  });
  it.each(['class', 'pose', 'duplicate-edge', 'source', 'policy', 'support'])('rejects or rebuilds resigned %s claims without granting authority', async kind => {
    const model = structuredClone(paired), cover = model.placements.find(p => p.partId === '15068')!;
    if (kind === 'class') cover.collisionClass = 'structural';
    if (kind === 'pose') cover.transform.translation[0] += 1;
    if (kind === 'duplicate-edge') model.edges.push(structuredClone(model.edges[0]));
    if (kind === 'source') model.moduleComposition!.instances[0].source.sha256 = '0'.repeat(64);
    if (kind === 'policy') model.moduleComposition!.policy.module = 'source-module-assembly-2-ranked-support';
    if (kind === 'support') model.moduleComposition!.instances[0].installationSupport.independentPoints = 999;
    const { contentSha256: _old, ...content } = model;
    model.contentSha256 = createHash('sha256').update(JSON.stringify(content)).digest('hex');
    const imported = await service.importModel(model);
    if (kind === 'support') {
      expect(imported.status).toBe('VALID'); expect(imported.model?.moduleComposition?.instances[0].installationSupport.independentPoints).toBe(6);
    } else expect(imported).toMatchObject({ status: 'NEEDS_REVALIDATION', model: null });
  });
  it('revokes a compiled module when the current exterior endpoint authority is withdrawn', async () => {
    let revoked = false;
    const engine = new AttachmentEngine({ mode: 'production', getSourceSnapshot: () => service.repository.snapshotDigest,
      loadPart: id => service.repository.getPart(id), getCapability: async id => {
        const cap = await service.getCapability(id);
        return revoked && id === '15068' && cap ? { ...cap, exteriorGeneratable: false, exteriorAllowedConnectionIds: [] } : cap;
      } });
    const assembler = new ModuleAssembler(engine);
    expect((await assembler.compile(ids[0])).members).toHaveLength(3);
    revoked = true;
    await expect(assembler.compile(ids[0])).rejects.toThrow();
  });
});
