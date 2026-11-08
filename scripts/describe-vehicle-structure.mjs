import {readFile,writeFile} from 'node:fs/promises';
import {BodyCatalog} from '../src/vehicles/body-catalog.ts';
import {assessGrammarAdmission} from '../src/parts/grammar/admission.ts';
import {AttachmentEngine} from '../src/parts/assembly/engine.ts';
import {transformPoint,rotate} from '../src/parts/assembly/math.ts';
import {miniDigest} from '../src/mini-cars/catalog.ts';
import {checkConnectionCompatibility} from '../src/parts/assembly/compatibility.ts';
const root=process.argv[2];if(!root)throw Error('Usage: node --import tsx scripts/describe-vehicle-structure.mjs checked-directory');
const catalog=new BodyCatalog();
for(const id of ['charger','golf']){
 const model=JSON.parse(await readFile(`${root}/${id}/model.json`,'utf8')),base=JSON.parse(await readFile(`public/vehicle-demos/${id}.json`,'utf8')).preview.model;
 const {contentSha256,...raw}=model;if(miniDigest(raw)!==contentSha256)throw Error('STRUCTURE_DOCUMENT_HASH');
 const parts=await catalog.load(model.sources.map(s=>s.partId));
 const unresolved=model.structure.audit.unconnected.map(row=>{
  const p=model.placements.find(p=>p.instanceId===row.instanceId),part=parts.get(p.partId),a=assessGrammarAdmission(part);
  return {...row,sourceConnectionStatus:part.connections.status,permission:a.capability,
   actualWorldEndpoints:part.connections.points.map(c=>({id:c.id,gender:c.gender,position:transformPoint(p.transform,c.position),direction:rotate(p.transform.rotation,c.direction),source:c.source})),
   attemptedSupportRejections:model.structure.rejected.filter(r=>r.instanceId===p.instanceId),
   currentPairIssues:model.structure.audit.blockers.filter(q=>q.a===p.instanceId||q.b===p.instanceId),
   currentMathematicalCandidates:model.layout.mountCandidates.find(q=>q.instanceId===p.instanceId)??null};
 });
 const deltas={parent:base.contentSha256,model:contentSha256,added:model.placements.filter(p=>!base.placements.some(q=>q.instanceId===p.instanceId)),removed:base.placements.filter(p=>!model.placements.some(q=>q.instanceId===p.instanceId)),changed:model.placements.flatMap(p=>{const original=base.placements.find(q=>q.instanceId===p.instanceId);return original&&JSON.stringify(original)!==JSON.stringify(p)?[{original,current:p}]:[];})};
 const adaptations=[...new Set(base.placements.flatMap(p=>p.craft?[p.craft.groupId]:[]))].map(groupId=>{
  const original=base.placements.filter(p=>p.craft?.groupId===groupId),current=original.map(p=>model.placements.find(q=>q.instanceId===p.instanceId)),delta=current[0].transform.translation.map((v,i)=>v-original[0].transform.translation[i]);
  return {groupId,source:base.layout.craft.selections.find(s=>s.groupId===groupId)?.source,
   layoutRetained:current.every((p,i)=>p.partId===original[i].partId&&p.transform.rotation.every((v,j)=>Math.abs(v-original[i].transform.rotation[j])<1e-8)&&p.transform.translation.every((v,j)=>Math.abs(v-original[i].transform.translation[j]-delta[j])<1e-8)),
   translation:delta,members:current.map(p=>({instanceId:p.instanceId,partId:p.partId,source:p.craft,actualPose:p.transform})),
   installedWholeModule:'NOT_VERIFIED',originalInstructionStep:null};
 });
 const engine=new AttachmentEngine({mode:'production',getSourceSnapshot:()=>catalog.snapshot,loadPart:async id=>parts.get(id),getCapability:async id=>parts.has(id)?assessGrammarAdmission(parts.get(id)).capability:undefined});
 const reloaded=JSON.parse(JSON.stringify(model.structure.floorGraph)),floorReplay=await engine.validateGraph(reloaded);
 const floorIds=new Set(model.structure.floorInstanceIds),floorRows=new Map();for(const p of model.placements.filter(p=>floorIds.has(p.instanceId))){const key=p.partId+':'+p.color,old=floorRows.get(key);if(old)old.quantity++;else floorRows.set(key,{...model.bom.find(b=>b.partId===p.partId&&b.color===p.color),quantity:1});}
 await writeFile(`${root}/${id}/floor-bom.json`,JSON.stringify({scope:'DIGITAL_FLOOR_ONLY_NOT_WHOLE_CAR',parentModel:contentSha256,parts:[...floorRows.values()],physicalBuildVerified:false},null,2));
 const joints={schema:'bricklab-local-joint-evidence-1',model:contentSha256,sourceSnapshot:model.sourceSnapshot,versions:model.structure.audit.versions,licence:'LDraw declarations retained; connection-derived source records CC-BY-SA-4.0',scope:'LOCAL_SOURCE_PAIR_FINAL_POSE_ONLY',items:model.structure.audit.edges.map(edge=>{
  const fixed=model.placements.find(p=>p.instanceId===edge.fixedInstanceId),moving=model.placements.find(p=>p.instanceId===edge.movingInstanceId),a=parts.get(fixed.partId).connections.points.find(p=>p.id===edge.fixedConnectionId),b=parts.get(moving.partId).connections.points.find(p=>p.id===edge.movingConnectionId);
  return {edge,fixed:{instanceId:fixed.instanceId,partId:fixed.partId,pose:fixed.transform,endpoint:a},moving:{instanceId:moving.instanceId,partId:moving.partId,pose:moving.transform,endpoint:b},rule:checkConnectionCompatibility(a,b),pair:model.structure.audit.pairs.find(p=>p.a===fixed.instanceId&&p.b===moving.instanceId||p.b===fixed.instanceId&&p.a===moving.instanceId),occupancy:'UNIQUE_CURRENT_PHYSICAL_ENDPOINTS',installationPath:'UNKNOWN',physicalBuildVerified:false};
 })};
 for(const[file,value]of Object.entries({'accepted-joints':joints,'unresolved-details':unresolved,'changes':deltas,'module-adaptations':adaptations,'floor-reopen':{scope:'FLOOR_GRAPH_ONLY_NOT_WHOLE_CAR',model:contentSha256,floorReplay,physicalBuildVerified:false}}))await writeFile(`${root}/${id}/${file}.json`,JSON.stringify(value,null,2));
 console.log(id,{parts:model.placements.length,rooted:model.structure.audit.connectedToChassis.length,unresolved:unresolved.length,floorReplay});
}
