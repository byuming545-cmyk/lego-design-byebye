import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';import { tmpdir } from 'node:os';
import { describe, it, expect } from 'vitest';
import { AssemblyStudioService, STUDIO_VERSIONS } from '../src/parts/library/studio.js';
import { NativePartRepository } from '../src/parts/assembly/source.js';

describe('read-only source-bound manual feedback replay', () => {
  it('replays literal real poses and detects stale sources, versions and off-grid observations without saving', async () => {
    const directory=await mkdtemp(path.join(tmpdir(),'studio-replay-'));
    try {
      const studio=new AssemblyStudioService(new NativePartRepository(),directory);
      const prep=await studio.prepare({fixedPartId:'3001',movingPartId:'3024'});
      const saved=await studio.save({...prep,mode:'assisted',keyframes:[],userClaim:{connectionNote:'Development test example, not a user or physical build.',reason:'Real source replay regression',physicallyBuilt:false,attachments:[]}});
      const file=path.join(directory,'interface-library/studio-examples.json'), before=await readFile(file);
      const bundle=await studio.exportBundle();
      const result=await studio.replayBundle(bundle);
      expect(result.examples[0]).toMatchObject({status:'CURRENT_MATCH',sourceMatch:true,relativeMatch:true,versionMatch:true,formal:{status:'accepted',graphValid:true},generationAdmission:false});
      expect(result.writesPerformed).toBe(false);expect(await readFile(file)).toEqual(before);
      const stale=structuredClone(bundle);stale.examples[0].fixed.sourceSha256='0'.repeat(64);
      expect((await studio.replayBundle(stale)).examples[0]).toMatchObject({status:'NEEDS_REVIEW',sourceMatch:false});
      const old=structuredClone(bundle);old.examples[0].versions.admission='historical-fixture-version';
      expect((await studio.replayBundle(old)).examples[0]).toMatchObject({status:'NEEDS_REVIEW',versionMatch:false});
      const identity=structuredClone(bundle);identity.examples[0].fixed.partId='3024';
      expect((await studio.replayBundle(identity)).examples[0]).toMatchObject({status:'NEEDS_REVIEW',sourceMatch:false});
      const shifted=structuredClone(bundle);shifted.examples[0].movingFinal.translation[0]+=1;
      const replay=(await studio.replayBundle(shifted)).examples[0];
      expect(replay).toMatchObject({status:'NEEDS_REVIEW',relativeMatch:false,formal:{status:'rejected',matchingPose:false}});
      expect(await readFile(file)).toEqual(before);
      // Old version markers must also be visible when simply reopening an example.
      expect(saved.versions).toEqual(STUDIO_VERSIONS);
      await expect(studio.replayBundle({format:'wrong',examples:[]})).rejects.toThrow();
    } finally { await rm(directory,{recursive:true,force:true}); }
  },45000);

  it('marks missing versions, changed rules and changed sources stale consistently without rewriting history', async () => {
    const directory=await mkdtemp(path.join(tmpdir(),'studio-stale-'));
    try {
      const repository=new NativePartRepository(), studio=new AssemblyStudioService(repository,directory);
      const prep=await studio.prepare({fixedPartId:'3001',movingPartId:'3024'});
      const record=await studio.save({...prep,mode:'assisted',keyframes:[],userClaim:{connectionNote:'Development fixture',reason:'Version invalidation',physicallyBuilt:false,attachments:[]}});
      const file=path.join(directory,'interface-library/studio-examples.json');
      for(const kind of ['missing-version','old-rule','source-hash'] as const){
        const fixture=structuredClone(record);
        if(kind==='missing-version')Reflect.deleteProperty(fixture,'versions');
        if(kind==='old-rule')fixture.versions.connectionRule='development-old-rule';
        if(kind==='source-hash')fixture.fixed.sourceSha256='0'.repeat(64);
        await writeFile(file,JSON.stringify([fixture]));
        const before=await readFile(file), reopened=new AssemblyStudioService(repository,directory);
        expect(await reopened.get(record.id)).toMatchObject({stale:true});
        expect(await reopened.list()).toEqual([expect.objectContaining({id:record.id,stale:true})]);
        expect(await readFile(file)).toEqual(before);
      }
      await writeFile(file,JSON.stringify([record]));
      const current=new AssemblyStudioService(repository,directory);
      expect(await current.get(record.id)).toMatchObject({stale:false});
      expect(await current.list()).toEqual([expect.objectContaining({stale:false})]);
    }finally{await rm(directory,{recursive:true,force:true});}
  });

  it('does not grant formal acceptance to disabled source features or forged rigid poses', async () => {
    const directory=await mkdtemp(path.join(tmpdir(),'studio-disabled-'));
    try {
      const studio=new AssemblyStudioService(new NativePartRepository(),directory);
      const prep=await studio.prepare({fixedPartId:'3001',movingPartId:'3062b'});
      await studio.save({...prep,mode:'assisted',keyframes:[],userClaim:{connectionNote:'Development negative fixture',reason:'Disabled port replay',physicallyBuilt:false,attachments:[]}});
      const bundle=await studio.exportBundle(), disabled=structuredClone(bundle);
      disabled.examples[0].movingConnectionId='p/stud4od.dat:8:1';
      const result=(await studio.replayBundle(disabled)).examples[0];
      expect(result.formal?.status).not.toBe('accepted');
      expect(result.generationAdmission).toBe(false);
      const scaled=structuredClone(bundle);scaled.examples[0].movingFinal.rotation[0]=2;
      expect((await studio.replayBundle(scaled)).examples[0].status).toBe('INVALID');
      for(const field of ['fixedInitial','movingInitial','movingFinal'] as const){
        const input=structuredClone(prep);input[field].rotation=[-1,0,0,0,1,0,0,0,1];
        await expect(studio.validate({...input,mode:'assisted',keyframes:[],userClaim:bundle.examples[0].userClaim})).rejects.toThrow('刚体');
      }
      await expect(studio.validate({...prep,mode:'assisted',userClaim:bundle.examples[0].userClaim,keyframes:[{id:'negative',transform:scaled.examples[0].movingFinal}]})).rejects.toThrow('关键帧');
    }finally{await rm(directory,{recursive:true,force:true});}
  },45000);
});
