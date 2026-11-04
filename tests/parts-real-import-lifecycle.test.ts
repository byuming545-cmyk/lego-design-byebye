import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { PartImportService } from '../src/parts/import/service.js';
import { GrammarAssemblyService } from '../src/parts/grammar/service.js';
import { NativePartRepository } from '../src/parts/assembly/source.js';
import { NativeAssemblyGenerator } from '../src/parts/assembly/generator.js';
import { exportNativeAssemblyJson } from '../src/parts/assembly/documents.js';

// Real, unmodified pinned files. The small catalogue is a test-only source
// subset; it does not fabricate geometry, interfaces, hashes or author names.
describe('real-source staged import, promotion and runtime adoption', () => {
  it.each([
    {partId:'3062b', bundlePath:'artifacts/import-collision/bundles/3062b', parserStatus:'partial', allowed:['p/stud2a.dat:11:0']},
    {partId:'14716', bundlePath:'artifacts/source-guided-production/bundles/14716', parserStatus:'ready', allowed:['p/stud.dat:8:0','parts/14716.dat:8:1']},
  ])('imports $partId through the normal generator, publishes reports and revokes old snapshots', async ({partId,bundlePath,parserStatus,allowed}) => {
    const root=await mkdtemp(path.join(tmpdir(),'real-import-lifecycle-'));
    try {
      const bundleDirectory=path.resolve(bundlePath);
      const bundle=JSON.parse(await readFile(path.join(bundleDirectory,'bundle.json'),'utf8'));
      const roots={ldrawRoot:path.join(root,'ldraw'),shadowRoot:path.join(root,'shadow')};
      for(const [side,field,target] of [['ldraw','geometry',roots.ldrawRoot],['shadow','connections',roots.shadowRoot]] as const){
        const original=new URL(`../data/parts-foundation/${side}/`,import.meta.url);
        await mkdir(target);await cp(new URL('files/',original),path.join(target,'files'),{recursive:true});
        const manifest=JSON.parse(await readFile(new URL('manifest.json',original),'utf8'));
        const added=new Set(bundle[field].files.filter((f:any)=>!f.reuse).map((f:any)=>f.path));
        manifest.files=manifest.files.filter((f:any)=>!added.has(f.path));
        if(side==='ldraw')manifest.roots=manifest.roots.filter((r:any)=>['3001','2431'].includes(r.partId));
        for(const file of added)await rm(path.join(target,'files',file as string),{force:true});
        await writeFile(path.join(target,'manifest.json'),JSON.stringify(manifest,null,2));
      }
      const repository=new NativePartRepository({geometryDirectory:roots.ldrawRoot,shadowDirectory:roots.shadowRoot});
      const oldService=new GrammarAssemblyService({repository});
      const before=await oldService.generate({module:'interface-assembly',partCount:2,requiredPartIds:['3001','2431']});
      expect(before.status).toBe('generated');
      const artifactsDirectory=path.join(root,'artifacts');
      const importer=new PartImportService({...roots,artifactsDirectory});
      const report=await importer.validate(bundleDirectory);
      expect(report.status).toBe('validated');expect(report.stages.source).toBe('IMPORTED_STAGING');
      expect(report.stages.connectors).toBe(parserStatus);expect(report.stages.generation).toBe('COVERED');
      const promotion=await importer.promote(bundleDirectory,report,partId);
      expect(promotion.audit?.before.totalRoots).toBe(2);expect(promotion.audit?.after.totalRoots).toBe(3);
      expect(promotion.audit?.after.newPart?.allowedConnectionIds).toEqual(allowed);
      const active=JSON.parse(await readFile(path.join(artifactsDirectory,'catalogue-current.json'),'utf8'));
      const audit=JSON.parse(await readFile(path.join(active.reportDirectory,'connector-audit.json'),'utf8'));
      expect(audit.summary.totalParts).toBe(3);
      expect(JSON.parse(await readFile(path.join(active.reportDirectory,'coverage.json'),'utf8'))).toHaveLength(3);
      expect(JSON.parse(await readFile(promotion.ledgerPath!,'utf8')).sourceSnapshot).toBe(active.snapshot);
      await expect(repository.listIds()).rejects.toMatchObject({code:'SOURCE_SNAPSHOT_RESTART_REQUIRED'});
      await expect(oldService.getGrammarAdmission('3001')).rejects.toMatchObject({code:'SOURCE_SNAPSHOT_RESTART_REQUIRED'});
      const fresh=new GrammarAssemblyService({repository:new NativePartRepository({geometryDirectory:roots.ldrawRoot,shadowDirectory:roots.shadowRoot})});
      expect((await fresh.importModel(before.model)).status).toBe('NEEDS_REVALIDATION');
      const support=await fresh.generate({module:'interface-assembly',partCount:5,requiredPartIds:['2431',partId]});
      expect(support.status).toBe('generated');
      expect(support.model?.bom.find(r=>r.partId===partId)?.quantity).toBe(4);
      expect((await fresh.engine.validateGraph(support.model!)).valid).toBe(true);
      const bounded = await new NativeAssemblyGenerator(fresh.engine,{partIds:['2431',partId],maxAttempts:1,maxBacktracks:10}).generate({module:'interface-assembly',partCount:3,requiredPartIds:['2431',partId]});
      expect(bounded.status).toBe('blocked');expect(bounded.search.exhausted).toBe(true);expect(bounded.model).toBeNull();
      const model=JSON.parse(await readFile(path.join(artifactsDirectory,partId,'generated/model.json'),'utf8'));
      expect((await fresh.importModel(model)).status).toBe('VALID');
      expect(()=>exportNativeAssemblyJson(model,JSON.parse('{}'))).toThrow();
      const newInstance=model.placements.find((p:any)=>p.partId===partId);
      for(const edge of model.edges){if(edge.fixedInstanceId===newInstance.instanceId)edge.fixedConnectionId=partId==='3062b'?'p/stud4od.dat:8:1':'unknown-source-port';if(edge.movingInstanceId===newInstance.instanceId)edge.movingConnectionId=partId==='3062b'?'p/stud4od.dat:8:1':'unknown-source-port';}
      const {contentSha256:_old,...content}=model;model.contentSha256=createHash('sha256').update(JSON.stringify(content)).digest('hex');
      const rejected=await fresh.importModel(model);expect(rejected.status).toBe('NEEDS_REVALIDATION');
      expect(rejected.reasons.some(r=>/接口|interface|disabled/.test(r))).toBe(true);
    } finally {await rm(root,{recursive:true,force:true});}
  },60000);
});
