import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { GrammarAssemblyService } from '../parts/grammar/service.js';
import { checkNativePairCollision } from '../parts/assembly/collision.js';
import { solveAttachment } from '../parts/assembly/solver.js';
import { IDENTITY_TRANSFORM } from '../parts/assembly/math.js';
import { exportNativeAssemblyJson, exportNativeAssemblyLDraw, exportNativeAssemblyBomCsv } from '../parts/assembly/documents.js';
import type { NativeModuleRequest } from '../parts/assembly/generator.js';

const output=path.resolve(process.argv[2]??'artifacts/import-collision');
await mkdir(output,{recursive:true});
const service=new GrammarAssemblyService();await service.ready();
const cases: {name:string;request:NativeModuleRequest}[]=[
  {name:'round-brick-support',request:{module:'interface-assembly',partCount:5,requiredPartIds:['2431','3062b']}},
  {name:'brick-panel-control',request:{module:'exterior-shell',requiredPartIds:['3001','11477']}},
  {name:'plate-panel-contact',request:{module:'exterior-shell',requiredPartIds:['3024','11477']}},
  {name:'brick-windscreen-contact',request:{module:'exterior-shell',requiredPartIds:['3001','18973']}},
];
const models=[];
for(const item of cases){
  const result=await service.generate(item.request);if(!result.model)throw new Error(`${item.name}: ${JSON.stringify(result.reasons)}`);
  const dir=path.join(output,'models',item.name);await mkdir(dir,{recursive:true});
  const model=result.model,json=exportNativeAssemblyJson(model),reimport=await service.importModel(JSON.parse(json));
  const graph=await service.engine.validateGraph(model);if(reimport.status!=='VALID'||!graph.valid)throw new Error('Whole-model revalidation failed');
  for(const [name,data] of [['model.json',json],['model.ldr',exportNativeAssemblyLDraw(model)],['bom.csv',exportNativeAssemblyBomCsv(model)],['steps.json',JSON.stringify(model.steps,null,2)],['sources.json',JSON.stringify(model.sources,null,2)],['validation.json',JSON.stringify({graph,reimport:reimport.status,sourceSnapshot:model.sourceSnapshot,search:result.search},null,2)],['reimported.json',JSON.stringify(reimport.model,null,2)]])await writeFile(path.join(dir,name),data);
  models.push({name:item.name,module:model.module,placements:model.placements.length,bom:model.bom.map(r=>({partId:r.partId,quantity:r.quantity})),edges:model.edges.length,reimport:reimport.status,physicalBuildVerified:false});
}
const diagnostics=[];
for(const [fixedId,movingId,index] of [['3001','11477',0],['3024','11477',0],['3001','18973',0],['3001','11477',4]] as const){
  const fixed=(await service.repository.getPart(fixedId))!,moving=(await service.repository.getPart(movingId))!;
  const port=moving.connections.points.find(p=>p.gender==='F'&&p.dimensionsResolved)!;
  const a={instanceId:'fixed',partId:fixedId,transform:IDENTITY_TRANSFORM};
  const solve=solveAttachment({fixedPart:fixed,fixedPlacement:a,fixedConnectionId:`p/stud.dat:8:${index}`,movingPart:moving,movingConnectionId:port.id});
  const c=solve.candidates[0];const b={instanceId:'moving',partId:movingId,transform:c.transform,collisionClass:'exterior-shell' as const};
  const result=checkNativePairCollision(fixed,a,moving,b,c.penetrationZone);
  diagnostics.push({fixed:a,moving:b,ports:[`p/stud.dat:8:${index}`,port.id],zone:c.penetrationZone,result});
  if(fixedId==='3001'&&movingId==='11477'&&index===0){
    const crossing={...b,transform:{...b.transform,translation:b.transform.translation.map((v,i)=>v+(i===1?8:0)) as [number,number,number]}};
    const rejected=checkNativePairCollision(fixed,a,moving,crossing);
    if(rejected.status!=='collision')throw new Error('Real source panel penetration was not rejected');
    diagnostics.push({fixed:a,moving:crossing,ports:[],zone:undefined,result:rejected});
  }
}
await writeFile(path.join(output,'collision-current.json'),JSON.stringify(diagnostics,null,2));
const summary={sourceSnapshot:service.repository.snapshotDigest,status:await service.status(),models,limitations:['Surface-only models do not certify closed solids or physical builds.','Installation path, friction, retention and stability remain unverified.']};
await writeFile(path.join(output,'generation-results.json'),JSON.stringify(summary,null,2));
console.log(JSON.stringify({models,sourceSnapshot:summary.sourceSnapshot},null,2));
