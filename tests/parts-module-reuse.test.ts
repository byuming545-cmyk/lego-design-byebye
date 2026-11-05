import { beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { GrammarAssemblyService } from '../src/parts/grammar/service.js';
import { ModuleCatalog, MODULE_DIRECTORY } from '../src/parts/modules/catalog.js';
import { moduleAssemblerFor, inspectModuleComposition } from '../src/parts/modules/assembly.js';
import { sourceEndpointKey } from '../src/parts/assembly/multipoint.js';
import { exportNativeAssemblyJson, exportNativeAssemblyLDraw } from '../src/parts/assembly/documents.js';
import { composeTransforms, transformPoint, rotate } from '../src/parts/assembly/math.js';
import type { NativeGeneratedAssembly } from '../src/parts/assembly/generator.js';

const service = new GrammarAssemblyService();
const catalogue = new ModuleCatalog();
const resign = (model: NativeGeneratedAssembly) => { const { contentSha256: _old, ...content } = model; model.contentSha256 = createHash('sha256').update(JSON.stringify(content)).digest('hex'); return model; };
let model: NativeGeneratedAssembly;
beforeAll(async () => {
  await service.ready();
  const result = await service.generate({ module: 'module-assembly', requiredModuleIds: ['76897-hood-core'], requiredPartIds: ['3001'] });
  expect(result.status, result.reasons.join(' ')).toBe('generated'); model = result.model!;
}, 60000);

describe('reviewed source module compilation and normal generation', () => {
  it('retains original IDs/poses and declares real replacements separately', () => {
    const core = catalogue.get('76897-hood-core'), adapted = catalogue.get('76897-hood-adapted');
    expect(core.members).toHaveLength(5);expect(core.members.every(m=>m.sourcePartId===m.partId)).toBe(true);
    expect(adapted.members.filter(m=>m.sourcePartId==='3069a')).toEqual([
      expect.objectContaining({partId:'3069b',ordinal:5}),expect.objectContaining({partId:'3069b',ordinal:6}),
    ]);
    expect(core.recipe.source).toMatchObject({license:'CC-BY-2.0',setNumber:'76897',kind:'licensed-set-reconstruction'});
    expect(()=>catalogue.get('invented-official-wing')).toThrow('Unknown');
  });
  it('exposes only current unoccupied physical source ports and returns isolated copies', async () => {
    const assembler=moduleAssemblerFor(service.engine), compiled=await assembler.compile('76897-hood-core');
    expect(compiled.graph.placements).toHaveLength(5);expect((await service.engine.validateGraph(compiled.graph)).valid).toBe(true);
    const occupied=new Set<string>();
    for(const edge of compiled.graph.edges)for(const [id,port]of [[edge.fixedInstanceId,edge.fixedConnectionId],[edge.movingInstanceId,edge.movingConnectionId]]){
      const part=(await service.engine.getPart(compiled.graph.placements.find(p=>p.instanceId===id)!.partId))!;
      occupied.add(sourceEndpointKey(id,port,part));
    }
    for(const port of compiled.ports){const member=compiled.members.find(m=>m.localId===port.localId)!;
      const part=(await service.engine.getPart(member.partId))!, cap=await service.engine.getCapability(member.partId);
      expect(cap!.allowedConnectionIds).toContain(port.connectionId);
      expect(occupied.has(sourceEndpointKey(compiled.memberInstances.get(port.localId)!,port.connectionId,part))).toBe(false);
    }
    compiled.ports.length=0;expect((await assembler.compile('76897-hood-core')).ports.length).toBeGreaterThan(0);
  });
  it.each(['3001','3020'])('reuses the same source module on %s with full outputs and reimport', async base => {
    const generated=await service.generate({module:'module-assembly',requiredModuleIds:['76897-hood-core'],requiredPartIds:[base]});
    expect(generated.status,generated.reasons.join(' ')).toBe('generated');
    const result=generated.model!;expect(result.placements).toHaveLength(6);expect(result.steps).toHaveLength(6);
    expect(result.bom.find(r=>r.partId===base)?.quantity).toBe(1);
    const ldraw=exportNativeAssemblyLDraw(result);
    expect(ldraw).toContain('Design reconstruction author: Adrien Pennamen');
    expect(ldraw).toContain(result.moduleComposition!.instances[0].source.sourceUrl);
    expect(ldraw).toContain('https://creativecommons.org/licenses/by/2.0/');
    expect(ldraw).toContain('Adaptation: Extracted unchanged source subassembly');
    const imported=await service.importModel(JSON.parse(exportNativeAssemblyJson(result)));
    expect(imported.status).toBe('VALID');expect(imported.model?.moduleComposition).toEqual(result.moduleComposition);
    expect(result.moduleComposition!.instances[0].members).toHaveLength(5);
  });
  it('reuses the declared adapted recipe without misidentifying its source tiles',async()=>{
    const result=await service.generate({module:'module-assembly',requiredModuleIds:['76897-hood-adapted'],requiredPartIds:['3020']});
    expect(result.status,result.reasons.join(' ')).toBe('generated');expect(result.model!.placements).toHaveLength(8);
    expect(result.model!.bom.find(r=>r.partId==='3069b')?.quantity).toBe(2);
    expect(result.model!.bom.some(r=>r.partId==='3069a')).toBe(false);
    expect((await service.importModel(result.model)).status).toBe('VALID');
  });
  it('keeps the original-source spoiler blocked and never inherits official design authority', async()=>{
    const result=await service.generate({module:'module-assembly',requiredModuleIds:['76897-spoiler-blade'],requiredPartIds:['3001']});
    expect(result.status).toBe('blocked');expect(result.model).toBeNull();expect(result.reasons.join(' ')).toContain('collision');
    const list=await service.reusableModules();expect(list.modules.find(m=>m.id==='76897-spoiler-blade')).toMatchObject({status:'BLOCKED',ports:[]});
  });
  it('rejects unsupported goals, unknown sources and exhausted search without returning a partial model',async()=>{
    for(const request of [
      {module:'module-assembly' as const,requiredModuleIds:['unknown-module']},
      {module:'module-assembly' as const,requiredModuleIds:['76897-hood-core'],requiredPartIds:['unknown-native']},
      {module:'module-assembly' as const,requiredModuleIds:['76897-hood-core'],requiredPartIds:['103918']},
      {module:'module-assembly' as const,requiredModuleIds:['76897-hood-core'],partCount:4},
    ])expect(await service.generate(request)).toMatchObject({status:'blocked',model:null});
    const {NativeAssemblyGenerator}=await import('../src/parts/assembly/generator.js');
    const bounded=new NativeAssemblyGenerator(service.engine,{partIds:await service.repository.listIds(),maxAttempts:1});
    expect(await bounded.generate({module:'module-assembly',requiredPartIds:['3001']})).toMatchObject({status:'blocked',model:null,search:{exhausted:true}});
    await expect(service.generate({module:'wall',requiredModuleIds:['76897-hood-core']})).rejects.toThrow();
  });
  it('keeps input immutable on invalid/occupied module installation ports',async()=>{
    const assembler=moduleAssemblerFor(service.engine), compiled=await assembler.compile('76897-hood-core');
    const graph=await service.engine.createAssembly('3001'), base=JSON.stringify(graph);
    const failed=await assembler.attach(graph,'76897-hood-core',{take:()=>true},{anchorInstanceId:'root',anchorConnectionId:'p/stud.dat:8:0',localId:'source-0',connectionId:'disabled-or-fabricated-port'});
    expect(failed.accepted).toBe(false);expect(failed.graph).toEqual(graph);expect(JSON.stringify(graph)).toBe(base);
    const fixed=(await service.engine.getPart('3001'))!, moving=(await service.engine.getPart('3024'))!;
    const filled=await service.engine.attachPart(graph,{anchorInstanceId:'root',anchorConnectionId:'p/stud.dat:8:0',partId:'3024',candidateConnectionId:moving.connections.points.find(p=>p.gender==='F')!.id});
    expect(filled.accepted).toBe(true);const before=JSON.stringify(filled.graph);
    const female=compiled.ports.find(port=>{
      const member=compiled.members.find(m=>m.localId===port.localId)!;
      return member.partId==='3460' && port.connectionId.startsWith('parts/');
    })!;
    expect(female).toBeDefined();expect(fixed.partId).toBe('3001');
    const occupied=await assembler.attach(filled.graph,'76897-hood-core',{take:()=>true},{anchorInstanceId:'root',anchorConnectionId:'p/stud.dat:8:0',...female});
    expect(occupied.accepted).toBe(false);expect(occupied.reasons.join(' ')).toContain('occupied');expect(JSON.stringify(filled.graph)).toBe(before);
  });
  it('rejects changed catalogue and extracted source bytes even when other parts remain intact',async()=>{
    const dir=await mkdtemp(path.join(tmpdir(),'module-source-'));
    try{
      await cp(MODULE_DIRECTORY,dir,{recursive:true});
      const rawFile=path.join(dir,'source/76897-hood.ldr');await writeFile(rawFile,Buffer.concat([await readFile(rawFile),Buffer.from('0 changed\n')]));
      expect(()=>new ModuleCatalog(dir).get('76897-hood-core')).toThrow('SOURCE_CHANGED');
      await writeFile(path.join(dir,'library.json'),'{}');expect(()=>new ModuleCatalog(dir).list()).toThrow('SOURCE_CHANGED');
    }finally{await rm(dir,{recursive:true,force:true});}
  });
  it('rejects a real out-of-seat side-stud obstruction and keeps the original base graph intact',async()=>{
    const base=await service.engine.createAssembly('3001');
    const obstacle=await service.engine.attachPart(base,{anchorInstanceId:'root',anchorConnectionId:'p/stud.dat:8:4',partId:'11211',candidateConnectionId:'parts/s/3004s01.dat:8:5',twistDegrees:180});
    expect(obstacle.accepted).toBe(true);
    const before=JSON.stringify(obstacle.graph);let attempts=0;
    const rejected=await moduleAssemblerFor(service.engine).attach(obstacle.graph,'76897-hood-core',{take:()=>++attempts<=50},
      {anchorInstanceId:'root',anchorConnectionId:'p/stud.dat:8:0',localId:'source-0',connectionId:'parts/3460.dat:8:15',twistDegrees:0});
    expect(rejected.accepted).toBe(false);expect(rejected.reasons.join(' ')).toContain('native-plastic-collision');
    expect(JSON.stringify(obstacle.graph)).toBe(before);
  });
  it('namespaces repeated module instances and preserves earlier module provenance',async()=>{
    const assembler=moduleAssemblerFor(service.engine), base=await service.engine.createAssembly('3031');
    const native=(await service.engine.getPart('3031'))!, cap=(await service.engine.getCapability('3031'))!;
    const studs=native.connections.points.filter(p=>p.gender==='M'&&cap.allowedConnectionIds.includes(p.id));
    const options={localId:'source-0',connectionId:'parts/3460.dat:8:15',twistDegrees:0};
    const first=await assembler.attach(base,'76897-hood-core',{take:()=>true},{anchorInstanceId:'root',anchorConnectionId:studs[0].id,...options});
    expect(first.accepted,first.reasons.join(' ')).toBe(true);
    const second=await assembler.attach(first.graph,'76897-hood-core',{take:()=>true},{anchorInstanceId:'root',anchorConnectionId:studs.at(-1)!.id,...options});
    expect(second.accepted,second.reasons.join(' ')).toBe(true);
    expect(second.composition?.instances).toHaveLength(2);expect(second.graph.placements).toHaveLength(11);
    expect(new Set(second.graph.placements.map(p=>p.instanceId)).size).toBe(11);
    expect((await service.engine.validateGraph(second.graph)).valid).toBe(true);
    expect((await inspectModuleComposition(second.graph,service.engine)).valid).toBe(true);
  });
});

describe('module model integrity and current authority',()=>{
  it.each(['missing','recipe','policy','parser','grammar','ingestion','suite','source','duplicate-member','part-id','pose','mirror','disabled-port','duplicate-edge','floating','hash'])(
    'rejects a resigned model with %s tampering',async kind=>{
      const bad=structuredClone(model), instance=bad.moduleComposition!.instances[0];
      if(kind==='missing')delete bad.moduleComposition;
      if(kind==='recipe')instance.recipeDigest='0'.repeat(64);
      if(kind==='policy')bad.moduleComposition!.policy.admission='old-admission';
      if(kind==='parser')bad.moduleComposition!.policy.parser='old-parser';
      if(kind==='grammar')bad.moduleComposition!.policy.grammar='old-grammar';
      if(kind==='ingestion')bad.moduleComposition!.policy.ingestion='old-ingestion';
      if(kind==='suite')bad.moduleComposition!.policy.validationSuite='old-suite';
      if(kind==='source')instance.source.originalSha256='0'.repeat(64);
      if(kind==='duplicate-member')instance.members[1].instanceId=instance.members[0].instanceId;
      if(kind==='part-id')instance.members[0].actualPartId='3001';
      if(kind==='pose')bad.placements[1].transform.translation[0]+=1;
      if(kind==='mirror')instance.transform.rotation=[-1,0,0,0,1,0,0,0,1];
      if(kind==='disabled-port')bad.edges[0].fixedConnectionId='not-an-open-port';
      if(kind==='duplicate-edge')bad.edges.push({...bad.edges[0],id:'duplicate-source-physical-endpoint'});
      if(kind==='floating')bad.edges=bad.edges.filter(e=>e.fixedInstanceId!=='root'&&e.movingInstanceId!=='root');
      if(kind==='hash')bad.sourceHashes['3460']='0'.repeat(64);
      const result=await service.importModel(resign(bad));expect(result.status).toBe('NEEDS_REVALIDATION');expect(result.model).toBeNull();
    });
  it('rejects outdated edges after a whole-graph rotation and accepts fully transformed source frames',async()=>{
    const copy=structuredClone(model);const transform={rotation:[0,0,1,0,1,0,-1,0,0] as [number,number,number,number,number,number,number,number,number],translation:[20,0,40] as [number,number,number]};
    copy.moduleComposition!.instances[0].transform=composeTransforms(transform,copy.moduleComposition!.instances[0].transform);
    // The edges are deliberately not transformed: an unchanged certificate must not authorize a new pose.
    for(const p of copy.placements)p.transform=composeTransforms(transform,p.transform);
    expect((await service.importModel(resign(copy))).status).toBe('NEEDS_REVALIDATION');
    for(const edge of copy.edges){edge.anchor=transformPoint(transform,edge.anchor);edge.axis=rotate(transform.rotation,edge.axis);}
    expect((await service.importModel(resign(copy))).status).toBe('VALID');
  });
  it('does not preserve untrusted upload claims in accepted module provenance',async()=>{
    const copy=structuredClone(model);
    Object.assign(copy.moduleComposition!.instances[0],{generatable:true,physicalBuildVerified:true,canAuthorizeRule:true});
    const result=await service.importModel(resign(copy));expect(result.status).toBe('VALID');
    expect(result.model!.moduleComposition!.instances[0]).not.toHaveProperty('generatable');
    expect(result.model!.moduleComposition!.instances[0]).not.toHaveProperty('physicalBuildVerified');
  });
});
