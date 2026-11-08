import {beforeAll,describe,it,expect} from 'vitest';
import {BodyCatalog} from '../src/vehicles/body-catalog.js';
import {auditStructure} from '../src/vehicles/structure-audit.js';
import {checkNativePairCollision,COLLISION_TOLERANCE_LDU} from '../src/parts/assembly/collision.js';
import {IDENTITY_ROTATION,axisRotation} from '../src/parts/assembly/math.js';
import type {NativeAssemblyPart,Vector3} from '../src/parts/assembly/types.js';
import type {BodyPlacement} from '../src/vehicles/body-preview.js';
let parts:Map<string,NativeAssemblyPart>;
beforeAll(async()=>{parts=await new BodyCatalog().load(['3024','3005','15068','18977','6636','3023b']);});
const p=(id:string,partId:string,t:Vector3,role='internal-support'):BodyPlacement=>({instanceId:id,partId,color:'black',role,transform:{rotation:IDENTITY_ROTATION,translation:t},assemblyStatus:'NOT_VERIFIED',decision:{constraints:[],imageIds:[],purpose:'test actual source pose'}});
describe('source-backed structural auditing',()=>{
 it('connects an exactly seated real brick to its actual plate socket',()=>{
  const a=auditStructure([p('floor','3024',[0,0,0],'chassis'),p('post','3005',[0,-24,0])],parts);
  expect(a.edges.length).toBeGreaterThan(0);expect(a.occupancy.valid).toBe(true);expect(a.components).toHaveLength(1);expect(a.finalPoseConnectivity).toBe('PASSED');expect(a.physicalBuildVerified).toBe(false);expect(a.installationPath).toBe('UNKNOWN');
 });
 it('does not pass a floating brick, a wrong axis, or an overlapping placement',()=>{
  for(const kind of ['gap','rotation','intersection']){
   const moving=p('post','3005',kind==='gap'?[0,-32,0]:kind==='intersection'?[0,0,0]:[0,-24,0]);if(kind==='rotation')moving.transform.rotation=axisRotation([0,0,1],90);
   const a=auditStructure([p('floor','3024',[0,0,0],'chassis'),moving],parts);expect(a.finalPoseConnectivity).toBe('BLOCKED');
  }
 });
 it('keeps missing wheel endpoints unknown and out of the connected chassis',()=>{
  const a=auditStructure([p('floor','3024',[0,0,0],'chassis'),p('wheel','18977',[0,0,0],'wheel')],parts);
  expect(a.edges).toEqual([]);expect(a.unconnected[0].reason).toBe('WHEEL_MATING_UNKNOWN');expect(a.blockers[0].status).toBe('UNKNOWN');
 });
 it('rejects reused physical sockets without hiding the occupancy failure',()=>{
  const a=auditStructure([p('floor','3024',[0,0,0],'chassis'),p('a','3005',[0,-24,0]),p('b','3005',[0,-24,0])],parts);
  expect(a.occupancy.valid).toBe(false);expect(a.rejectedOccupancyEdges.length).toBeGreaterThan(0);expect(a.finalPoseConnectivity).toBe('BLOCKED');
 });
 it('catches a panel moved through an earlier bearing plate, even if its adapter could fit',()=>{
  const panel=p('panel','6636',[0,-54,204],'rear-panel');panel.transform.rotation=axisRotation([1,0,0],-90);
  const bearing=p('bearing','3023b',[-60,-48,190],'chassis');
  const invalid=auditStructure([bearing,panel],parts);expect(invalid.blockers.some(p=>p.status==='collision')).toBe(true);
  panel.transform.translation[2]=212;expect(auditStructure([bearing,panel],parts).blockers).toEqual([]);
 });
});
describe('native exterior boundary contact regression',()=>{
 const pair=(x:number)=>checkNativePairCollision(parts.get('15068')!,{...p('a','15068',[0,0,0]),collisionClass:'exterior-shell'},parts.get('15068')!,{...p('b','15068',[x,0,0]),collisionClass:'exterior-shell'});
 it('allows adjacent finite native envelopes at their separating boundary plane',()=>{
  const result=pair(40);expect(result.status).toBe('clear');expect(result.reasonCode).toBe('exterior-separating-contact-plane');expect(result.proof.structuralSupport).toBe(false);expect(result.toleranceLdu).toBe(COLLISION_TOLERANCE_LDU);
 });
 it('still rejects positive overlap and coincident complete source surfaces',()=>{expect(pair(39).status).toBe('collision');expect(pair(0).status).toBe('collision');});
});
