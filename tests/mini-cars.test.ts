import { beforeAll, describe, expect, it } from 'vitest';
import { cp, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MiniCatalog, miniDigest } from '../src/mini-cars/catalog.js';
import { generateMiniCar, placementBounds, parseMiniOptions } from '../src/mini-cars/generator.js';
import { MiniCarService } from '../src/mini-cars/service.js';
import { MINI_COLORS, MINI_MAX_PARTS, type MiniModel } from '../src/mini-cars/types.js';
import { isRigidTransform } from '../src/parts/assembly/math.js';
import { NativePartRepository } from '../src/parts/assembly/source.js';
import { BUNDLED_LDRAW_DIRECTORY, createBundledLDrawResolver } from '../src/parts/ldraw/index.js';

const catalog = new MiniCatalog();
const options = { style: 'sprint', color: 'red', seed: 'mini-01', spoiler: true } as const;
let model: MiniModel;
beforeAll(async () => { model = await generateMiniCar(catalog, options); });
const resign = (value: unknown) => { const m = value as MiniModel; const { contentSha256: _old, ...body } = m; m.contentSha256 = miniDigest(body); return m; };

describe('bounded native appearance layout', () => {
  it('reproduces exactly with the same parameters and original source snapshot', async () => {
    expect(await generateMiniCar(catalog, options)).toEqual(model);
    expect(model.placements.length).toBeGreaterThan(32); expect(model.placements.length).toBeLessThanOrEqual(MINI_MAX_PARTS);
    expect(model.placements.every(p => isRigidTransform(p.transform))).toBe(true);
  });
  it('changes actual wheelbase and roof layout and supports seed-dependent cover geometry', async () => {
    const gt = await generateMiniCar(catalog, { ...options, style: 'gt' });
    expect(gt.layout.wheelbaseLdu).toBe(200); expect(model.layout.wheelbaseLdu).toBe(160);
    expect(gt.layout.roofLengthLdu).toBeGreaterThan(model.layout.roofLengthLdu);
    const alternatives = await Promise.all(['a','b','c','d'].map(seed => generateMiniCar(catalog, { ...options, seed })));
    expect(new Set(alternatives.map(m => m.layout.cover)).size).toBe(2);
    for (const m of alternatives) expect(m.placements.some(p => p.partId === '15068')).toBe(m.layout.cover === 'rounded');
  });
  it.each(['sprint','gt'] as const)('has six-wide body, four aligned wheels and unbroken side-panel layout for %s', async style => {
    const m = await generateMiniCar(catalog, { ...options, style }), parts = await catalog.load(m.sources.map(s => s.partId));
    expect(m.checks.bodyWidthLdu).toBeCloseTo(120); expect(m.wheels).toHaveLength(4);
    expect(new Set(m.wheels.map(w => w.id)).size).toBe(4);
    for (const w of m.wheels) { expect(w.fit).toBe('UNKNOWN'); expect(w.chassisMount).toBe('UNKNOWN'); expect(m.placements.find(p => p.instanceId === w.tyreInstanceId)?.partId).toBe('18977'); }
    for (const side of [-1,1]) {
      const panels = m.placements.filter(p => p.role === 'body' && p.partId === '3004' && Math.abs(p.transform.translation[0] - side*50) < 1e-5).map(p => placementBounds(parts.get(p.partId)!, p)).sort((a,b) => a.min[2]-b.min[2]);
      const end = m.layout.wheelbaseLdu/2-40;
      expect(panels[0].min[2]).toBeCloseTo(-end); expect(panels.at(-1)!.max[2]).toBeCloseTo(end);
      for (let i=1;i<panels.length;i++) expect(panels[i].min[2]).toBeCloseTo(panels[i-1].max[2]);
      expect(panels.every(b => Math.abs(b.max[1]) < 1e-5)).toBe(true);
    }
    expect(m.placements.filter(p => p.role === 'window').every(p => p.color === 'black')).toBe(true);
    expect(m.checks).toMatchObject({ collision:'UNKNOWN', connections:'NOT_VERIFIED', physicalBuildVerified:false });
  });
  it('derives colour-aware BOM and wheel part quantities from actual placements', () => {
    expect(model.bom.reduce((n,r)=>n+r.quantity,0)).toBe(model.placements.length);
    for (const row of model.bom) {
      expect(row.quantity).toBe(model.placements.filter(p=>p.partId===row.partId&&p.color===row.color).length);
      expect(row.ldrawColor).toBe(MINI_COLORS[row.color].ldraw); expect(row.assemblyStatus).toBe('NOT_VERIFIED');
    }
    expect(model.bom.find(r=>r.partId==='18977')?.quantity).toBe(4);expect(model.bom.find(r=>r.partId==='66727')?.quantity).toBe(4);
    expect(model.sources.every(s=>s.files.length>0&&s.files.every(f=>f.sha256.length===64&&f.license))).toBe(true);
  });
  it('omits optional wing instances and dependencies without changing source eligibility', async () => {
    const without=await generateMiniCar(catalog,{...options,spoiler:false});
    expect(without.placements.some(p=>p.role==='spoiler')).toBe(false);
    expect(without.sources.some(s=>s.partId==='3005'||s.partId==='3710')).toBe(false);
    expect(model.placements.length-without.placements.length).toBe(3);
  });
  it.each([{}, { ...options, seed:'bad seed' }, { ...options, width:8 }, { ...options, spoiler:'true' }, { ...options, generatable:true }])('rejects invalid or permission-like request fields', value => { expect(()=>parseMiniOptions(value)).toThrow(); });
});

describe('strict current appearance import and isolated storage', () => {
  it.each(['pose','scale','mirror','part-id','colour','source','snapshot','bom','wheel-fit','authority','extra-graph','version'])(
    'rejects resigned %s tampering', async kind => {
      // Deliberately malformed upload; not a source or production connector fixture.
      const value = structuredClone(model) as any;
      if(kind==='pose')value.placements[0].transform.translation[0]+=20;
      if(kind==='scale')value.placements[0].transform.rotation[0]=2;
      if(kind==='mirror')value.placements[0].transform.rotation[0]=-1;
      if(kind==='part-id')value.placements[0].partId='invented-native-part';
      if(kind==='colour')value.placements[0].color='blue';
      if(kind==='source')value.sources[0].files[0].sha256='0'.repeat(64);
      if(kind==='snapshot')value.sourceSnapshot='0'.repeat(64);
      if(kind==='bom')value.bom[0].quantity+=1;
      if(kind==='wheel-fit')value.wheels[0].fit='VERIFIED';
      if(kind==='authority')value.checks.physicalBuildVerified=true;
      if(kind==='extra-graph')value.edges=[{ruleId:'C01',verified:true}];
      if(kind==='version')value.generatorVersion='old-generator';
      await expect(new MiniCarService(catalog).validate(resign(value))).rejects.toThrow();
    });
  it('preserves full poses, colours and BOM across save/reopen and a new service instance', async () => {
    const dir=await mkdtemp(path.join(tmpdir(),'mini-save-'));
    try {
      const marker=path.join(dir,'interface-library','studio-examples.json');await mkdir(path.dirname(marker),{recursive:true});await writeFile(marker,'development-only-preservation-sentinel');
      const first=new MiniCarService(catalog,dir);await first.save(model);
      expect(await first.save(model)).toMatchObject({id:model.id,state:'APPEARANCE_DRAFT'});
      const second=new MiniCarService(new MiniCatalog(),dir), reopened=await second.open(model.id);
      expect(reopened).toEqual(model);expect(await readFile(marker,'utf8')).toBe('development-only-preservation-sentinel');
      expect(second.bomCsv(reopened)).toContain('NOT_VERIFIED');expect((await second.list())[0].id).toBe(model.id);
      const damaged=structuredClone(model);damaged.placements[0].transform.translation[0]+=1;
      await expect(second.save(resign(damaged))).rejects.toThrow();expect(await second.open(model.id)).toEqual(model);
      await expect(second.open('../studio-examples')).rejects.toThrow();
    } finally { await rm(dir,{recursive:true,force:true}); }
  });
  it('accepts reordered object keys without trusting edited content', async () => {
    const reordered=Object.fromEntries(Object.entries(model).reverse());expect(await new MiniCarService(catalog).validate(reordered)).toEqual(model);
  });
  it('preserves a conflicting saved record instead of overwriting user edits', async () => {
    const dir=await mkdtemp(path.join(tmpdir(),'mini-save-conflict-'));
    try {
      const service=new MiniCarService(catalog,dir);await service.save(model);
      const file=path.join(service.directory,model.id+'.json');await writeFile(file,'development-only edited record');
      await expect(service.save(model)).rejects.toThrow('原文件已保留');
      expect(await readFile(file,'utf8')).toBe('development-only edited record');
    } finally { await rm(dir,{recursive:true,force:true}); }
  });
  it('rejects an oversized appearance document before accepting extra placements', async () => {
    const value=structuredClone(model);while(value.placements.length<=MINI_MAX_PARTS)value.placements.push(structuredClone(model.placements[0]));
    await expect(new MiniCarService(catalog).validate(resign(value))).rejects.toThrow();
  });
});

describe('original geometry integrity remains mandatory for appearance',()=>{
  it('rejects unknown native IDs',async()=>{await expect(catalog.load(['not-a-native-source'])).rejects.toThrow();});
  it.each(['hash','missing'] as const)('rejects %s on an already cached real dependency',async kind=>{
    const dir=await mkdtemp(path.join(tmpdir(),'mini-native-source-'));
    try{
      const original=(await catalog.repository.getPart('3022'))!;
      await cp(path.join(BUNDLED_LDRAW_DIRECTORY,'manifest.json'),path.join(dir,'manifest.json'));
      for(const f of original.geometry.source.files){const target=path.join(dir,'files',f.path);await mkdir(path.dirname(target),{recursive:true});await cp(path.join(BUNDLED_LDRAW_DIRECTORY,'files',f.path),target);}
      const custom=new MiniCatalog(new NativePartRepository({geometryDirectory:dir}),()=>createBundledLDrawResolver(dir));
      await custom.load(['3022']);
      const target=path.join(dir,'files','parts/3022.dat');
      if(kind==='hash')await writeFile(target,(await readFile(target,'utf8'))+'0 changed\n');else await unlink(target);
      await expect(custom.load(['3022'])).rejects.toThrow('原始依赖');
    }finally{await rm(dir,{recursive:true,force:true});}
  });
  it.each(['geometry','author','nonfinite'] as const)('rejects invalid %s supplied by a loader',async kind=>{
    class FaultyRepository extends NativePartRepository {
      override async getPart(id:string){const original=await super.getPart(id);if(!original)return original;const part=structuredClone(original);
        if(kind==='geometry')part.geometry.status='failed';
        if(kind==='author')part.geometry.source.files[0].author='unverified-replacement-author';
        if(kind==='nonfinite')part.geometry.mesh!.positions[0][0]=Number.NaN;
        return part;}
    }
    await expect(new MiniCatalog(new FaultyRepository()).load(['3022'])).rejects.toThrow();
  });
});
