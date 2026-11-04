import { mkdir, readFile, writeFile, mkdtemp, rm, stat } from 'node:fs/promises';
import path from 'node:path';import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { LDrawLoader } from 'three/addons/loaders/LDrawLoader.js';
import { LDrawConditionalLineMaterial } from 'three/addons/materials/LDrawConditionalLineMaterial.js';
import { Box3, Vector3 } from 'three';
import { NativePartRepository } from '../parts/assembly/source.js';
import { GrammarAssemblyService } from '../parts/grammar/service.js';
import { AssemblyStudioService } from '../parts/library/studio.js';
import { analyzeConnectionImpact } from '../parts/connections/impact.js';
import { checkConnectionCompatibility } from '../parts/assembly/compatibility.js';
import { createBundledLDrawResolver } from '../parts/ldraw/bundled.js';

const output=path.resolve(process.argv[2]??'artifacts/source-study');await mkdir(output,{recursive:true});
const repo=new NativePartRepository(), service=new GrammarAssemblyService({repository:repo});
const resolver=await createBundledLDrawResolver(), manifest=await repo.getManifest();
const ids=['3001','3024','3062b','11477','18975','66727','14716'];
const records=[];
for(const id of ids){
 const part=(await repo.getPart(id))!;const admission=await service.getGrammarAdmission(id);
 const loader=new LDrawLoader();loader.smoothNormals=false;loader.setConditionalLineMaterial(LDrawConditionalLineMaterial);
 // The experimental adapter only seeds the installed loader's private parse cache.
 // There is no network fallback and this API is deliberately not production infrastructure.
 const cache=(loader as unknown as {partsCache:{parseCache:{setData(name:string,text:string):void;fetchData(name:string):Promise<string>}}}).partsCache.parseCache;
 const aliases=new Map<string,string[]>();
 for(const file of part.geometry.source.files){const alias=file.path.replace(/^(parts|p)\//,'');aliases.set(alias,[...(aliases.get(alias)??[]),file.path]);}
 for(const file of part.geometry.source.files){
  const text=await resolver.readText(file.path);if(text===undefined)throw new Error('Missing reviewed file');
  cache.setData(file.path,text);const alias=file.path.replace(/^(parts|p)\//,'');if(aliases.get(alias)!.length===1)cache.setData(alias,text);
 }
 cache.fetchData=async name=>{throw new Error(`Unlisted dependency requested by reference loader: ${name}`);};
 let reference:unknown;
 try{
  const root=await resolver.readText(`parts/${id}.dat`);const group=await new Promise<import('three').Group>((resolve,reject)=>loader.parse(root!,resolve,reject));
  group.updateMatrixWorld(true);const box=new Box3().setFromObject(group);const min=box.min.toArray(), max=box.max.toArray();
  const delta=part.geometry.bounds?Math.max(...min.map((v,i)=>Math.abs(v-part.geometry.bounds!.min[i])),...max.map((v,i)=>Math.abs(v-part.geometry.bounds!.max[i]))):null;
  reference={status:'loaded',min,max,maxBoundsDeltaLdu:delta,scope:'Rendering geometry bounds only; no interface, collision, fit or physical proof.'};
 }catch(error){reference={status:'failed',reason:error instanceof Error?error.message:String(error)};}
 records.push({partId:id,rawParser:part.connections.status,sourceGeometry:part.geometry.status,impact:analyzeConnectionImpact(part.connections),qualification:{structural:admission?.generationEligible,exterior:admission?.exteriorGeneratable,enabled:admission?.capability.allowedConnectionIds,collision:admission?.proxy},threeLDrawLoader:reference});
}
const baseline = JSON.parse(await readFile('artifacts/import-collision/final-catalogue/report.json','utf8'));
const status=await service.status();
const regressions=[];
for(const row of baseline.parts){const a=await service.getGrammarAdmission(row.part_id);if(a?.generationEligible!==row.generation_eligible)regressions.push({partId:row.part_id,before:row.generation_eligible,after:a?.generationEligible});}
const baselineIds=new Set(baseline.parts.map((part:{part_id:string})=>part.part_id));
const addedIdentities=status.entries.filter(part=>!baselineIds.has(part.partId)).map(part=>({partId:part.partId,generationEligible:part.generatable}));
await writeFile(path.join(output,'real-cases.json'),JSON.stringify({cases:records,qualification:{before:baseline.summary.generationEligible,after:status.counts.generatable,changedExistingIdentities:regressions,addedIdentities},sourceSnapshot:repo.snapshotDigest},null,2));
// External comparison uses literal source features placed with coincident anchors.
// It is a rule-level counterexample, not an approved physical placement.
const brick=(await repo.getPart('3001'))!,plate=(await repo.getPart('3024'))!,pinHole=(await repo.getPart('32000'))!;
const stud=brick.connections.points.find(p=>p.gender==='M'&&p.family==='stud')!;
const anti=plate.connections.points.find(p=>p.gender==='F'&&p.dimensionsResolved)!;
const hole=pinHole.connections.points.find(p=>p.family==='pinHole'&&p.gender==='F')!;
const feature=(p:typeof stud)=>({type:p.kind==='cylinder'?'SNAP_CYL':p.kind,gender:p.gender,world_pos:[0,0,0],source:{id:p.id,position:p.position,direction:p.direction,raw:p.source.raw}});
await writeFile(path.join(output,'reference-input.json'),JSON.stringify({shadowDirectory:path.resolve('data/parts-foundation/shadow/files'),parts:ids,connections:[{case:'real stud/antistud source features at coincident anchors',a:feature(stud),b:feature(anti),ourResult:checkConnectionCompatibility(stud,anti).status},{case:'real Stud/Technic pin-hole features at coincident anchors (illegal counterexample)',a:feature(stud),b:feature(hole),ourResult:checkConnectionCompatibility(stud,hole).status}]},null,2));
// Never read or publish a private observation implicitly. Record its presence only;
// the CLI accepts an explicit exported bundle for authorised user reproduction.
const privateFile=path.resolve('data/interface-library/studio-examples.json');
const privatePresent=await stat(privateFile).then(()=>true,()=>false);
const temp=await mkdtemp(path.join(tmpdir(),'source-study-example-'));
try{
 const studio=new AssemblyStudioService(repo,temp);const prep=await studio.prepare({fixedPartId:'3001',movingPartId:'3024'});
 await studio.save({...prep,mode:'assisted',keyframes:[],userClaim:{connectionNote:'明确标注的开发测试示例，不是用户记录或实物证据。',reason:'Read-only replay experiment',physicallyBuilt:false,attachments:[]}});
 const bundle=await studio.exportBundle();const before=await readFile(path.join(temp,'interface-library/studio-examples.json'));
 await writeFile(path.join(output,'development-example.json'),JSON.stringify({...bundle,studyOrigin:'DEVELOPMENT_TEST_EXAMPLE',storage:{kind:'temporary-test-store',path:'not-user-data',note:'Generated solely for this experiment.'}},null,2));
 const fresh=await studio.replayBundle(bundle);const stale=structuredClone(bundle);stale.examples[0].versions.collision='previous-review-fixture';
 await writeFile(path.join(output,'replay-comparison.json'),JSON.stringify({privatePresent,origin:'DEVELOPMENT_TEST_EXAMPLE',current:fresh,changedVersion:await studio.replayBundle(stale),storeUnchanged:before.equals(await readFile(path.join(temp,'interface-library/studio-examples.json')))},null,2));
}finally{await rm(temp,{recursive:true,force:true});}
console.log(JSON.stringify({output,parts:ids,qualificationChanged:regressions,addedIdentities,scope:'Comparison only; any added identity follows the separate production import workflow.'}));
