import { assessGrammarAdmission } from '../parts/grammar/admission.js';
import { checkMultiPointConnection, validateConnectionOccupancy, sourceEndpointKey } from '../parts/assembly/multipoint.js';
import { checkNativePairCollision, COLLISION_VERSION } from '../parts/assembly/collision.js';
import { ASSEMBLY_ENGINE_VERSION } from '../parts/assembly/engine.js';
import { CONNECTION_RULE_VERSION } from '../parts/assembly/compatibility.js';
import { transformPoint, isRigidTransform } from '../parts/assembly/math.js';
import type { AssemblyGraphEdge, NativeAssemblyPart, Vector3 } from '../parts/assembly/types.js';
import type { BodyPlacement } from './body-preview.js';

export const STRUCTURE_AUDIT_VERSION = 'source-pose-occupancy-collision-1';
export function worldBounds(p: BodyPlacement, part: NativeAssemblyPart) {
  const b = part.geometry.bounds!;
  const corners = Array.from({length:8}, (_,i)=>transformPoint(p.transform,b.min.map((v,a)=>i&(1<<a)?b.max[a]:v) as Vector3));
  return {min:[0,1,2].map(a=>Math.min(...corners.map(v=>v[a]))),max:[0,1,2].map(a=>Math.max(...corners.map(v=>v[a])))};
}
/** This audits the complete placement set, without splitting away inconvenient
 * members. An edge requires current admission, exact source closure, collision
 * clearance and unoccupied physical endpoints. It never certifies a trajectory. */
export function auditStructure(placements: BodyPlacement[], parts: Map<string,NativeAssemblyPart>) {
  if (!placements.length || placements.length>700 || new Set(placements.map(p=>p.instanceId)).size!==placements.length || placements.some(p=>!isRigidTransform(p.transform)||!parts.has(p.partId))) throw Error('STRUCTURE_INVALID_MEMBERS');
  const admissions=new Map([...parts].map(([id,p])=>[id,assessGrammarAdmission(p)]));
  const rows=placements.map(p=>({p,part:parts.get(p.partId)!,b:worldBounds(p,parts.get(p.partId)!)}));
  const permission=(p:BodyPlacement)=>{
    const a=admissions.get(p.partId)!;
    return {collisionClass:a.generationEligible?'structural' as const:'exterior-shell' as const,
      ids:new Set(a.generationEligible?a.capability.allowedConnectionIds:a.capability.exteriorAllowedConnectionIds??[]),
      rules:new Set(a.generationEligible?a.capability.ruleIds:a.capability.exteriorRuleIds??[])};
  };
  const edges:AssemblyGraphEdge[]=[],pairs:{a:string;b:string;status:string;reasonCode:string;sourcePoseMatches:number;collisionClassA:string;collisionClassB:string}[]=[];
  let disjointPairs=0;
  for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){
    const a=rows[i],b=rows[j];
    if(a.b.min.some((v,k)=>v>b.b.max[k]+.0001||b.b.min[k]>a.b.max[k]+.0001)){disjointPairs++;continue;}
    const pa=permission(a.p),pb=permission(b.p);
    if(a.p.role==='wheel'||b.p.role==='wheel'){
      pairs.push({a:a.p.instanceId,b:b.p.instanceId,status:'UNKNOWN',reasonCode:'WHEEL_MATING_NOT_EVIDENCED',sourcePoseMatches:0,collisionClassA:pa.collisionClass,collisionClassB:pb.collisionClass});continue;
    }
    const matched=checkMultiPointConnection({fixedPart:a.part,fixedPlacement:a.p,movingPart:b.part,movingPlacement:b.p,allowedFixedConnectionIds:pa.ids,allowedMovingConnectionIds:pb.ids});
    const matches=matched.matches.filter(m=>pa.ids.has(m.fixedConnectionId)&&pb.ids.has(m.movingConnectionId)&&pa.rules.has(m.compatibility.ruleId!)&&pb.rules.has(m.compatibility.ruleId!));
    const forward=checkNativePairCollision(a.part,{...a.p,collisionClass:pa.collisionClass},b.part,{...b.p,collisionClass:pb.collisionClass},matches[0]?.candidate.penetrationZone);
    const reverse=forward.status==='clear'?checkNativePairCollision(b.part,{...b.p,collisionClass:pb.collisionClass},a.part,{...a.p,collisionClass:pa.collisionClass},matches[0]?.candidate.penetrationZone):forward;
    const result=reverse.status==='clear'?forward:reverse;
    pairs.push({a:a.p.instanceId,b:b.p.instanceId,status:matched.status==='blocked'?'blocked':result.status,reasonCode:matched.status==='blocked'?'MULTIPOINT_CLOSURE_BLOCKED':result.reasonCode,sourcePoseMatches:matches.length,collisionClassA:pa.collisionClass,collisionClassB:pb.collisionClass});
    if(result.status!=='clear'||matched.status!=='consistent')continue;
    for(const m of matches)edges.push({id:'joint-'+edges.length,fixedInstanceId:a.p.instanceId,movingInstanceId:b.p.instanceId,fixedConnectionId:m.fixedConnectionId,movingConnectionId:m.movingConnectionId,ruleId:m.compatibility.ruleId!,ruleVersion:m.compatibility.ruleVersion,twistDeg:m.candidate.twistDeg,axis:m.candidate.axis,anchor:m.candidate.anchor,insertionDepthLdu:m.compatibility.insertionDepthLdu!});
  }
  const occupancy=validateConnectionOccupancy(edges,new Map(rows.map(r=>[r.p.instanceId,r.part])));
  // No partial occupied graph is promoted if a third member reuses a socket.
  const endpointCounts=new Map<string,number>();
  const key=(id:string,c:string)=>sourceEndpointKey(id,c,parts.get(placements.find(p=>p.instanceId===id)!.partId));
  for(const e of edges)for(const k of [key(e.fixedInstanceId,e.fixedConnectionId),key(e.movingInstanceId,e.movingConnectionId)])endpointCounts.set(k,(endpointCounts.get(k)??0)+1);
  const usableEdges=edges.filter(e=>endpointCounts.get(key(e.fixedInstanceId,e.fixedConnectionId))===1&&endpointCounts.get(key(e.movingInstanceId,e.movingConnectionId))===1);
  const adjacency=new Map(placements.map(p=>[p.instanceId,new Set<string>()]));
  for(const e of usableEdges){adjacency.get(e.fixedInstanceId)!.add(e.movingInstanceId);adjacency.get(e.movingInstanceId)!.add(e.fixedInstanceId);}
  const components:string[][]=[],seen=new Set<string>();
  for(const p of placements){if(seen.has(p.instanceId))continue;const component:string[]=[],todo=[p.instanceId];while(todo.length){const id=todo.pop()!;if(seen.has(id))continue;seen.add(id);component.push(id);todo.push(...adjacency.get(id)!);}components.push(component.sort());}
  components.sort((a,b)=>b.length-a.length||a[0].localeCompare(b[0]));
  const chassis=new Set(placements.filter(p=>p.role==='chassis').map(p=>p.instanceId));
  const rooted=new Set(components.find(c=>c.some(id=>chassis.has(id)))??[]);
  const blockers=pairs.filter(p=>p.status!=='clear');
  return {version:STRUCTURE_AUDIT_VERSION,versions:{assembly:ASSEMBLY_ENGINE_VERSION,collision:COLLISION_VERSION,connection:CONNECTION_RULE_VERSION},
    scope:'WHOLE_MODEL_FINAL_POSE_AUDIT_NOT_PHYSICAL_CERTIFICATE' as const,edges:usableEdges,rejectedOccupancyEdges:edges.filter(e=>!usableEdges.includes(e)),occupancy,
    components,connectedToChassis:placements.filter(p=>rooted.has(p.instanceId)).map(p=>p.instanceId),
    unconnected:placements.filter(p=>!rooted.has(p.instanceId)).map(p=>({instanceId:p.instanceId,partId:p.partId,role:p.role,reason:p.role==='wheel'?'WHEEL_MATING_UNKNOWN':permission(p).ids.size?'NO_CLEAR_SOURCE_CONNECTION_CHAIN':'CURRENT_INTERFACE_PERMISSION_UNAVAILABLE'})),
    pairs,disjointPairs,blockers,roles:[...new Set(placements.map(p=>p.role))].map(role=>{const members=placements.filter(p=>p.role===role);return {role,total:members.length,connectedToChassis:members.filter(p=>rooted.has(p.instanceId)).length};}),
    finalPoseConnectivity:components.length===1&&occupancy.valid&&blockers.length===0?'PASSED':'BLOCKED',installationPath:'UNKNOWN',stability:'UNKNOWN',physicalBuildVerified:false};
}
export type StructureAudit=ReturnType<typeof auditStructure>;
