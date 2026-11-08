import { BodyCatalog } from './body-catalog.js';
import type { BodyPlacement, BodyPreview } from './body-preview.js';
import { auditStructure, worldBounds } from './structure-audit.js';
import { checkNativePairCollision } from '../parts/assembly/collision.js';
import { checkMultiPointConnection } from '../parts/assembly/multipoint.js';
import { solveAttachment } from '../parts/assembly/solver.js';
import { assessGrammarAdmission } from '../parts/grammar/admission.js';
import { axisRotation, IDENTITY_ROTATION, transformPoint, rotate, distance } from '../parts/assembly/math.js';
import type { Matrix3, NativeAssemblyPart, Vector3 } from '../parts/assembly/types.js';
import { MINI_COLORS, type MiniColor } from '../mini-cars/types.js';
import { miniDigest } from '../mini-cars/catalog.js';
import { inspectWheelEnvelope, inspectMountCandidates } from './body-inspection.js';
import { AttachmentEngine } from '../parts/assembly/engine.js';
import { nativePartSourceHash } from '../parts/assembly/source.js';
import type { NativeAssembly } from '../parts/assembly/types.js';

export const STRUCTURE_VERSION='native-floor-post-snot-revision-8';
/** A new derivative. The appearance generator and its historic files remain
 * untouched. Native source sockets determine all new support locations. */
export async function reviseVehicleStructure(base:BodyPreview,catalog:BodyCatalog,progress?:(detail:string)=>void) {
  const parts=await catalog.palette();
  for(const[id,p]of await catalog.load([...base.sources.map(s=>s.partId),'4070','87087','99207','99780','3005','3024']))parts.set(id,p);
  const admissions=new Map([...parts].map(([id,p])=>[id,assessGrammarAdmission(p)]));
  const permission=(id:string)=>{const a=admissions.get(id)!;return {collisionClass:a.generationEligible?'structural' as const:'exterior-shell' as const,ids:new Set(a.generationEligible?a.capability.allowedConnectionIds:a.capability.exteriorAllowedConnectionIds??[])};};
  const {width:W,length:L}=base.plan, floorTop=-base.layout.ground-8;
  let serial=0;
  const changes:NonNullable<BodyPreview['structure']>['changes']=[],rejected:NonNullable<BodyPreview['structure']>['rejected']=[];
  const internal=new Set<string>(),floorIds=new Set<string>(),supportedCovers=new Set<string>();
  let placements:BodyPlacement[]=structuredClone(base.placements.filter(p=>!['chassis','windshield','rear-window','side-window','window-pillar','roof'].includes(p.role)));
  const exactGridNumber=(v:number)=>Math.abs(v-Math.round(v))<1e-8?Math.round(v):v;
  for(const p of placements){const before=structuredClone(p);p.transform.translation=p.transform.translation.map(exactGridNumber) as Vector3;if(p.transform.translation.some((v,i)=>v!==before.transform.translation[i]))changes.push({instanceId:p.instanceId,action:'explicit-numerical-grid-placement',reason:'Replace inherited binary arithmetic residue with the intended exact integer native grid pose, rather than loosening rational closure checks',original:before,replacement:structuredClone(p)});}
  const tyres=base.placements.filter(p=>p.partId==='18977');
  const wheelSafe=(p:BodyPlacement)=>inspectWheelEnvelope([p,...tyres],parts,base.plan.wheelRadiusLdu,14).conflicts.length===0;
  const archSeats=base.placements.filter(p=>p.role==='wheel-arch').map(p=>{const q=structuredClone(p);q.transform.translation[1]=Math.ceil(q.transform.translation[1]/8)*8;return wheelSafe(q)?q.transform.translation[1]:Math.floor(p.transform.translation[1]/8)*8;});
  const bodyLift=Math.max(0,-base.layout.hoodHeight+16-Math.min(...archSeats));
  for(const p of placements.filter(p=>!['wheel','wheel-arch','side-skirt'].includes(p.role))){if(bodyLift){const original=structuredClone(p);p.transform.translation[1]-=bodyLift;changes.push({instanceId:p.instanceId,action:'native-bearing-layer-clearance',reason:'Reserve one real plate between arch upper studs and cover underside while retaining static tyre clearance; target observations unchanged',original,replacement:structuredClone(p)});}}
  for(const p of base.placements.filter(p=>!placements.some(q=>q.instanceId===p.instanceId)))changes.push({instanceId:p.instanceId,action:'removed-for-structural-replacement',reason:p.role==='chassis'?'Replace coplanar unjoined spine with crossed native floor layers':'Replace unsupported / half-stud cabin layout with native stud-grid slopes and hardtop',original:p});
  function make(id:string,role:string,color:MiniColor,t:Vector3,r:Matrix3=IDENTITY_ROTATION,purpose='source-derived structural support'):BodyPlacement{
    return {instanceId:'structure-'+(++serial),partId:id,role,color,transform:{rotation:r,translation:t.map(exactGridNumber) as Vector3},assemblyStatus:'NOT_VERIFIED',decision:{constraints:['native-source-endpoints','unchanged-collision-tolerance','actual-wheel-envelope'],imageIds:base.plan.imageIds,purpose}};
  }
  // The legacy horizontal bumper and vertical apron occupied the same low
  // region once seated on the native height lattice. Consolidate that trim
  // into one upright native bumper with a real side-stud mounting direction.
  // This is a recorded part removal / rigid redesign, never collision hiding.
  const bumper=placements.find(p=>p.role==='front-bumper');
  if(bumper&&placements.some(p=>p.role==='front-apron')&&distance(rotate(bumper.transform.rotation,[0,-1,0]),[0,-1,0])<1e-6){
    const original=structuredClone(bumper),bounds=worldBounds(bumper,parts.get(bumper.partId)!);
    bumper.transform={rotation:axisRotation([1,0,0],90),translation:[bumper.transform.translation[0],bumper.transform.translation[1]+10,bounds.min[2]]};
    changes.push({instanceId:bumper.instanceId,action:'functional-bumper-consolidation',reason:'Use the native tile as an upright lower fascia with side-stud sockets, replacing the overlapping horizontal bumper / apron arrangement',original,replacement:structuredClone(bumper)});
    for(const p of placements.filter(p=>p.role==='front-apron'))changes.push({instanceId:p.instanceId,action:'removed-redundant-apron',reason:'Its lower-front trim function is consolidated into the upright bumper; removed from the actual model and BOM',original:p});
    placements=placements.filter(p=>p.role!=='front-apron');
  }
  const cell=(x:number,z:number)=>`${Math.round(x*1e5)},${Math.round(z*1e5)}`;
  const sameGrid=(x:number,z:number)=>Math.abs((x+W/2-10)/20-Math.round((x+W/2-10)/20))<1e-5&&Math.abs((z+L/2-10)/20-Math.round((z+L/2-10)/20))<1e-5;
  const snapX=(v:number)=>Math.round((v+W/2-10)/20)*20-W/2+10;
  const snapZ=(v:number)=>Math.round((v+L/2-10)/20)*20-L/2+10;
  const flat=[...parts.values()].filter(p=>/^(?:Plate|Tile|Brick)\s+\d+ x\s*\d+(?:$| with Groove$)/.test(p.geometry.name??''))
    .flatMap(p=>[0,90].map(angle=>{const b=p.geometry.bounds!,w=Math.round((b.max[angle?2:0]-b.min[angle?2:0])/20),d=Math.round((b.max[angle?0:2]-b.min[angle?0:2])/20);return {id:p.partId,w,d,r:axisRotation([0,1,0],angle),kind:p.geometry.name!.trim().split(/\s/)[0]};}));
  function sheet(role:string,color:MiniColor,x0:number,z0:number,nx:number,nz:number,top:number,mask:(x:number,z:number)=>boolean,kind='Plate',cross=false){
    const cells=new Set<string>();for(let z=0;z<nz;z++)for(let x=0;x<nx;x++)if(mask(x0+x*20+10,z0+z*20+10))cells.add(`${x},${z}`);
    const candidates=flat.filter(c=>c.kind===kind&&permission(c.id).ids.size&&(role!=='chassis'||c.w*c.d<=8)).sort((a,b)=>(role==='chassis'&&!cross?Math.min(b.w,b.d)-Math.min(a.w,a.d):0)||b.w*b.d-a.w*a.d||(cross?b.d-a.d:b.w-a.w)||a.id.localeCompare(b.id));
    for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){
      if(!cells.has(`${x},${z}`))continue;
      const f=candidates.find(c=>Array.from({length:c.w},(_,dx)=>Array.from({length:c.d},(_,dz)=>cells.has(`${x+dx},${z+dz}`))).flat().every(Boolean));
      if(!f)throw Error('STRUCTURE_NATIVE_SHEET_FIT');
      const b=parts.get(f.id)!.geometry.bounds!,mid=rotate(f.r,[(b.min[0]+b.max[0])/2,0,(b.min[2]+b.max[2])/2]);
      const p=make(f.id,role,color,[x0+(x+f.w/2)*20-mid[0],top,z0+(z+f.d/2)*20-mid[2]],f.r,role==='chassis'?'Crossed plate floor; wheel zones reserved; joins must pass current native kernel':role==='roof'?'Stud-grid hardtop cover resting on actual native cabin endpoints':'Native cabin landing closes the remaining observed run beside the unscaled 45-degree slope; actual studs and underside sockets, not a freely tilted face');placements.push(p);
      if(role==='chassis'){internal.add(p.instanceId);floorIds.add(p.instanceId);}
      for(let dx=0;dx<f.w;dx++)for(let dz=0;dz<f.d;dz++)cells.delete(`${x+dx},${z+dz}`);
    }
  }
  // A central four-stud floor continues through axle zones. Outboard cells
  // exist only outside the conservative wheel span; the second layer crosses
  // first-layer seams instead of repeating the same strip layout.
  const wheelZ=[base.plan.axleFront-L/2,base.plan.axleRear-L/2];
  sheet('chassis','black',-W/2,-L/2,W/20,L/20,floorTop,(x,z)=>Math.abs(z)<L/2-20&&(Math.abs(x)<W/2-40||wheelZ.every(a=>Math.abs(z-a)>=50)));
  sheet('chassis','black',-W/2,-L/2+20,W/20,1,floorTop-8,(x)=>Math.abs(x)<W/2-40,'Plate',true);
  sheet('chassis','black',-W/2,-L/2+40,W/20,L/20-3,floorTop-8,(x)=>Math.abs(x)<W/2-40,'Plate',true);
  progress?.(`Crossed floor: ${floorIds.size} native members`);
  // Old belt tiles cannot carry the layer above. Replace only these actual
  // stacked covers with native studded plates, preserving their pose/colour.
  for(const p of placements){
    if(p.role==='belt'||p.role==='side-skirt'){
      const original=structuredClone(p);p.partId='3024';changes.push({instanceId:p.instanceId,action:'real-part-replacement',reason:'A smooth tile has no upper System studs; replace a stacked belt / sill landing with a real 1x1 plate',original,replacement:structuredClone(p)});
    }
    if(p.role==='side-skirt'&&p.transform.translation[1]+8>floorTop+.0001){const original=structuredClone(p);p.transform.translation[1]=floorTop-8;changes.push({instanceId:p.instanceId,action:'rigid-pose-adjustment',reason:'Sill underside must seat on the actual floor, not occupy the same volume',original,replacement:structuredClone(p)});}
    if(p.role==='wheel-arch'){
      const original=structuredClone(p);
      const candidate=structuredClone(p);candidate.transform.translation[1]=Math.ceil(p.transform.translation[1]/8)*8;
      p.transform.translation[1]=wheelSafe(candidate)?candidate.transform.translation[1]:Math.floor(p.transform.translation[1]/8)*8;
      changes.push({instanceId:p.instanceId,action:'upper-stud-seating',reason:'Retain original wheel-clearing native arch; align its interpreted upper male studs to overlying cover sockets. Its unknown underside is NOT invented or enabled',original,replacement:structuredClone(p)});
    }
  }
  const roofWidth=Math.floor(base.layout.roofWidth/40)*40,roofStart=Math.round(base.plan.roofStart*L/20)*20-L/2,roofEnd=Math.round(base.plan.roofEnd*L/20)*20-L/2,roofY=-base.layout.roofHeight-bodyLift;
  sheet('roof','black',-roofWidth/2,roofStart,roofWidth/20,(roofEnd-roofStart)/20,roofY,()=>true,'Tile');
  for(const rear of [false,true])for(let x=-roofWidth/2+10;x<roofWidth/2;){
    const outer=x===-roofWidth/2+10||x===roofWidth/2-10;
    const width=outer?20:40;
    placements.push(make(outer?'3040b':'3039',rear?'rear-window':'windshield',rear&&outer?'white':'black',[x+(width-20)/2,roofY+8,rear?roofEnd-10:roofStart+10],axisRotation([0,1,0],rear?180:0),'Native 45-degree slope seats on vertical support and presents a real top stud to the hardtop; slope differs from the former free-angle glass draft'));
    x+=width;
  }
  for(const side of [-1,1])for(let z=roofStart+30;z<roofEnd-20;z+=20)placements.push(make('3005','side-window','black',[side*(roofWidth/2-10),roofY+8,z],IDENTITY_ROTATION,'Native black cabin side brick: real underside and roof-facing studs; not a tilted unsupported tile'));
  // The accepted 45-degree sources have a one-stud ramp. Longer observed
  // screen runs need actual landings as well; otherwise replacing a tilted
  // tile leaves an open cowl or hatch (seen in the rendered intermediate).
  const screenLow=roofY+32,frontGap=roofStart-20-(base.plan.cabinStart*L-L/2),rearGap=base.plan.cabinEnd*L-L/2-(roofEnd+20);
  if(frontGap>=20-.0001){
    const depth=Math.round(frontGap/20);const z0=roofStart-20-depth*20;
    sheet('windshield','black',-roofWidth/2,z0,roofWidth/20,depth,screenLow+8,()=>true,'Plate');
    sheet('windshield','black',-roofWidth/2,z0,roofWidth/20,depth,screenLow,()=>true,'Tile');
  }
  if(rearGap>=20-.0001){
    const depth=Math.round(rearGap/20),z0=roofEnd+20;
    for(const [x0,nx,color]of [[-roofWidth/2,1,'white'],[-roofWidth/2+20,roofWidth/20-2,'black'],[roofWidth/2-20,1,'white']] as const){
      sheet('rear-window',color,x0,z0,nx,depth,screenLow+8,()=>true,'Brick');
      sheet('rear-window',color,x0,z0,nx,depth,screenLow,()=>true,'Tile');
    }
  }
  function collisionClass(p:BodyPlacement){return {...p,collisionClass:permission(p.partId).collisionClass};}
  function clear(a:BodyPlacement,b:BodyPlacement){
    const ba=worldBounds(a,parts.get(a.partId)!),bb=worldBounds(b,parts.get(b.partId)!);
    if(ba.min.some((v,k)=>v>bb.max[k]+.0001||bb.min[k]>ba.max[k]+.0001))return true;
    const pa=permission(a.partId),pb=permission(b.partId),m=checkMultiPointConnection({fixedPart:parts.get(a.partId)!,fixedPlacement:a,movingPart:parts.get(b.partId)!,movingPlacement:b,allowedFixedConnectionIds:pa.ids,allowedMovingConnectionIds:pb.ids});
    const matches=m.matches.filter(q=>pa.ids.has(q.fixedConnectionId)&&pb.ids.has(q.movingConnectionId));
    if(m.status!=='consistent')return false;
    const zone=matches[0]?.candidate.penetrationZone;
    return checkNativePairCollision(parts.get(a.partId)!,collisionClass(a),parts.get(b.partId)!,collisionClass(b),zone).status==='clear'
      &&checkNativePairCollision(parts.get(b.partId)!,collisionClass(b),parts.get(a.partId)!,collisionClass(a),zone).status==='clear';
  }
  const maleAt=(p:BodyPlacement)=>parts.get(p.partId)!.connections.points.filter(c=>c.gender==='M'&&permission(p.partId).ids.has(c.id)&&distance(rotate(p.transform.rotation,c.direction),[0,-1,0])<1e-6).map(c=>transformPoint(p.transform,c.position));
  function addSupport(p:BodyPlacement){
    if(placements.length>=700)return false;
    if(!wheelSafe(p)||placements.filter(q=>q.role!=='wheel').some(q=>!clear(p,q)))return false;
    placements.push(p);internal.add(p.instanceId);return true;
  }
  const round=(v:number)=>Math.round(v/8)*8;
  function column(x:number,y:number,z:number,owner:string):boolean{
    if(!sameGrid(x,z))return false;
    const below=placements.filter(p=>internal.has(p.instanceId)||supportedCovers.has(p.instanceId)).flatMap(p=>maleAt(p).map(v=>({p,v})))
      .filter(({p,v})=>p.instanceId!==owner&&Math.abs(v[0]-x)<1e-5&&Math.abs(v[2]-z)<1e-5&&v[1]>=y-.0001&&Math.abs((v[1]-y)/8-Math.round((v[1]-y)/8))<1e-5)
      .sort((a,b)=>a.v[1]-b.v[1]);
    for(const anchor of below){
      const checkpoint=placements.length;let level=anchor.v[1],ok=true;
      while(level>y+.0001){const h=level-y>=24-.0001?24:8,id=h===24?'3005':'3024';const p=make(id,'internal-support',owner.includes('cabin')?'black':'graphite',[x,level-h,z],IDENTITY_ROTATION,`Vertical support for ${owner}; closes source endpoint gap ${level-y} LDU without scaling`);if(!addSupport(p)){ok=false;break;}level-=h;}
      if(ok)return true;
      for(const p of placements.splice(checkpoint))internal.delete(p.instanceId);
    }
    return false;
  }
  function supportAt(x:number,y:number,z:number,owner:string){
    if(column(x,y,z,owner))return true;
    // A horizontal plate can transfer an outboard landing to an inboard
    // column above the wheel. Its real mesh must clear the complete tyre.
    const target:Vector3=[x,y,z];
    for(const f of flat.filter(f=>f.kind==='Plate'&&(f.d===1||f.w===1)&&f.w*f.d>=2&&f.w*f.d<=4).sort((a,b)=>a.w*a.d-b.w*b.d)){
      const part=parts.get(f.id)!,points=part.connections.points.filter(c=>c.gender==='M'&&permission(f.id).ids.has(c.id)&&distance(rotate(f.r,c.direction),[0,-1,0])<1e-6);
      for(const end of points){const offset=rotate(f.r,end.position),beam=make(f.id,'internal-support','graphite',target.map((v,i)=>v-offset[i]) as Vector3,f.r,`Native horizontal bearing plate for ${owner}; transfers load to an inboard source socket`);
        if(!wheelSafe(beam)||placements.filter(p=>p.role!=='wheel').some(p=>!clear(beam,p)))continue;
        const sockets=part.connections.points.filter(c=>c.gender==='F'&&permission(f.id).ids.has(c.id)).map(c=>transformPoint(beam.transform,c.position)).filter(v=>Math.abs(v[0])<Math.abs(x)-1||Math.abs(v[2])<Math.abs(z)-1);
        for(const v of sockets){const checkpoint=placements.length;if(column(v[0],v[1],v[2],owner)&&addSupport(beam))return true;for(const p of placements.splice(checkpoint))internal.delete(p.instanceId);}
      }
    }
    return false;
  }
  // Source module members share one rigid correction; individual members are
  // never snapped apart. This also removes retained sub-tolerance source-pose
  // rounding (about 0.000061 LDU) without changing the closure tolerance.
  for(const group of new Set(placements.flatMap(p=>p.craft?[p.craft.groupId]:[]))){
    const members=placements.filter(p=>p.craft?.groupId===group),entry=members[0],socket=parts.get(entry.partId)!.connections.points.find(c=>c.gender==='F'&&permission(entry.partId).ids.has(c.id));
    if(!socket)continue;const v=transformPoint(entry.transform,socket.position),dir=rotate(entry.transform.rotation,socket.direction),dy=Math.abs(dir[1])>.9?round(v[1])-v[1]:Math.round((v[1]-10)/8)*8+10-v[1];
    for(const p of members){const original=structuredClone(p);p.transform.translation[1]+=dy;if(Math.abs(dy)>1e-8)changes.push({instanceId:p.instanceId,action:'rigid-module-seating',reason:'One shared source-module translation; relative source layout preserved',original,replacement:structuredClone(p)});}
  }
  // Re-seat upright parts by a small rigid grid correction, recording every
  // source pose. No tilted mating endpoint is silently treated as vertical.
  for(const p of placements.filter(p=>!internal.has(p.instanceId)&&p.role!=='wheel'&&!p.craft)){
    const part=parts.get(p.partId)!,sockets=part.connections.points.filter(c=>c.gender==='F'&&permission(p.partId).ids.has(c.id)&&distance(rotate(p.transform.rotation,c.direction),[0,-1,0])<1e-6);
    if(!sockets.length)continue;
    const v=transformPoint(p.transform,sockets[0].position),delta:Vector3=[snapX(v[0])-v[0],round(v[1])-v[1],snapZ(v[2])-v[2]];
    if(Math.hypot(...delta)>1e-9){const original=structuredClone(p);p.transform.translation=p.transform.translation.map((v,i)=>v+delta[i]) as Vector3;changes.push({instanceId:p.instanceId,action:'rigid-grid-seating',reason:'Align actual underside socket to the floor stud lattice; original pose retained',original,replacement:structuredClone(p)});}
  }
  // Lateral panels receive real headlight/SNOT bricks. Solve the panel pose
  // from the chosen source side stud, rather than estimating a contact offset.
  let inspectedPanels=0;
  for(const p of placements.filter(p=>!internal.has(p.instanceId)&&p.role!=='wheel'&&(!p.craft||placements.find(q=>q.craft?.groupId===p.craft!.groupId)===p))){
    if(++inspectedPanels%20===0)progress?.(`Inspected ${inspectedPanels} source cover / panel records`);
    const part=parts.get(p.partId)!,sockets=part.connections.points.filter(c=>c.gender==='F'&&permission(p.partId).ids.has(c.id));
    if(sockets.some(c=>distance(rotate(p.transform.rotation,c.direction),[0,-1,0])<1e-6))continue;
    let done=false;
    for(const socket of sockets){
      const world=transformPoint(p.transform,socket.position),dir=rotate(p.transform.rotation,socket.direction);
      if(Math.abs(dir[1])>1e-6)continue;
      for(const adapter of ['87087','99207','99780','4070'])for(const angle of [0,90,180,270]){
        if(done)break;
        const r=axisRotation([0,1,0],angle),adapterPart=parts.get(adapter)!;
        const stud=adapterPart.connections.points.find(c=>c.gender==='M'&&permission(adapter).ids.has(c.id)&&Math.abs(c.direction[1])<.1);
        const bottom=adapterPart.connections.points.find(c=>c.gender==='F'&&permission(adapter).ids.has(c.id)&&distance(rotate(r,c.direction),[0,-1,0])<1e-6);
        if(!stud||!bottom)continue;
        if(distance(rotate(r,stud.direction),dir)>1e-6)continue;
        const offset=rotate(r,stud.position),socketOffset=rotate(r,bottom.position),raw=world.map((v,i)=>v-offset[i]) as Vector3,landing=raw.map((v,i)=>v+socketOffset[i]) as Vector3;
        const t:Vector3=[raw[0]+snapX(landing[0])-landing[0],raw[1]+round(landing[1])-landing[1],raw[2]+snapZ(landing[2])-landing[2]],mount=make(adapter,'internal-mount','graphite',t,r,`Real ${adapter} adapter for ${p.instanceId}; side stud and underside both solved from native source`);
        const solved=solveAttachment({fixedPart:parts.get(adapter)!,fixedPlacement:mount,fixedConnectionId:stud.id,movingPart:part,movingConnectionId:socket.id});
        const candidate=solved.candidates.find(c=>distance(c.transform.translation,p.transform.translation)<=12&&c.transform.rotation.every((v,i)=>Math.abs(v-p.transform.rotation[i])<1e-6));if(!candidate)continue;
        const affected=p.craft?placements.filter(q=>q.craft?.groupId===p.craft!.groupId):[p],originals=affected.map(q=>structuredClone(q));
        const original=structuredClone(p),delta=candidate.transform.translation.map((v,i)=>v-p.transform.translation[i]);
        for(const q of affected)q.transform.translation=q.transform.translation.map((v,i)=>v+delta[i]) as Vector3;
        // An adapter fitting its socket does not permit the panel itself to
        // move through an earlier bearing plate. Recheck every translated
        // member against the complete existing model before committing it.
        const movingClear=affected.every(q=>wheelSafe(q)&&placements.filter(other=>other.role!=='wheel'&&!affected.includes(other)).every(other=>clear(q,other)));
        if(!movingClear){for(let i=0;i<affected.length;i++)affected[i].transform=originals[i].transform;continue;}
        const checkpoint=placements.length;
        const foot=transformPoint(mount.transform,bottom.position);
        if(supportAt(foot[0],foot[1],foot[2],p.instanceId)&&addSupport(mount)){
          for(let i=0;i<affected.length;i++){const q=affected[i];supportedCovers.add(q.instanceId);changes.push({instanceId:q.instanceId,action:'source-solved-snot-seating',reason:`Panel / rigid source module seated on a real ${adapter} side stud; path remains unknown`,original:originals[i],replacement:structuredClone(q)});}done=true;break;
        }
        for(let i=0;i<affected.length;i++)affected[i].transform=originals[i].transform;for(const q of placements.splice(checkpoint))internal.delete(q.instanceId);
      }
      if(done)break;
    }
    if(!done)rejected.push({instanceId:p.instanceId,reason:'NO_CLEAR_SOURCE_BACKED_SIDE_MOUNT'});
  }
  // Seat the low parts before high covers, allowing one real upright to carry
  // another. At most two separated landings are added for each wide cover.
  const covers=placements.filter(p=>!internal.has(p.instanceId)&&p.role!=='wheel').sort((a,b)=>worldBounds(b,parts.get(b.partId)!).max[1]-worldBounds(a,parts.get(a.partId)!).max[1]);
  let inspectedCovers=0;
  for(const p of covers){
    if(++inspectedCovers%20===0)progress?.(`Bearing search ${inspectedCovers}/${covers.length}; ${internal.size} retained internal members`);
    const sockets=parts.get(p.partId)!.connections.points.filter(c=>c.gender==='F'&&permission(p.partId).ids.has(c.id)&&distance(rotate(p.transform.rotation,c.direction),[0,-1,0])<1e-6).map(c=>transformPoint(p.transform,c.position));
    if(!sockets.length)continue;
    const unique=[...new Map(sockets.map(v=>[cell(v[0],v[2])+','+v[1],v])).values()];
    const ordered=unique.sort((a,b)=>Math.abs(a[0])-Math.abs(b[0])||a[2]-b[2]);
    let supported=false;const used:Vector3[]=[];
    for(const v of ordered){if(used.length&&distance(v,used[0])<30)continue;if(supportAt(v[0],v[1],v[2],p.instanceId)){supported=true;used.push(v);if(used.length===2)break;}}
    if(supported)supportedCovers.add(p.instanceId);
    else rejected.push({instanceId:p.instanceId,reason:'NO_CLEAR_VERTICAL_OR_BEARING_PLATE_SUPPORT'});
  }
  progress?.(`Support search complete: ${internal.size} internal members; final complete-model audit`);
  for(const p of placements)p.transform.translation=p.transform.translation.map(exactGridNumber) as Vector3;
  // Each retained internal member is a real BOM member with a purpose. No
  // visual hide or success flag suppresses a collision in the final audit.
  const audit=auditStructure(placements,parts);
  const engine=new AttachmentEngine({mode:'production',getSourceSnapshot:()=>catalog.snapshot,loadPart:async id=>parts.get(id),getCapability:async id=>admissions.get(id)?.capability});
  const floorGraph:NativeAssembly={schemaVersion:1,id:'floor-'+base.contentSha256.slice(0,24),...engine.versions,sourceSnapshot:catalog.snapshot,
    placements:placements.filter(p=>floorIds.has(p.instanceId)).map(p=>({instanceId:p.instanceId,partId:p.partId,transform:p.transform})),
    edges:audit.edges.filter(e=>floorIds.has(e.fixedInstanceId)&&floorIds.has(e.movingInstanceId)),
    sourceHashes:Object.fromEntries([...floorIds].map(id=>placements.find(p=>p.instanceId===id)!).map(p=>[p.partId,nativePartSourceHash(parts.get(p.partId)!)])),physicalBuildVerified:false};
  progress?.('Replaying the entire floor graph through the unchanged production engine');
  const floorValidation=await engine.validateGraph(floorGraph);
  for(const p of placements.filter(p=>!base.placements.some(b=>b.instanceId===p.instanceId)))changes.push({instanceId:p.instanceId,action:'added-native-member',reason:p.decision.purpose,replacement:p});
  const model=structuredClone(base);
  model.generatorVersion=STRUCTURE_VERSION;model.placements=placements;
  model.sources=[...new Set(placements.map(p=>p.partId))].sort().map(id=>catalog.source(parts.get(id)!));
  const bom=new Map<string,BodyPreview['bom'][number]>();for(const p of placements){const key=p.partId+':'+p.color,old=bom.get(key);if(old)old.quantity++;else bom.set(key,{partId:p.partId,name:parts.get(p.partId)!.geometry.name!,ldrawColor:MINI_COLORS[p.color].ldraw,color:p.color,quantity:1,colorAvailability:'NOT_VERIFIED'});}model.bom=[...bom.values()].sort((a,b)=>a.partId.localeCompare(b.partId)||a.color.localeCompare(b.color));
  model.steps.items=[...new Set(placements.map(p=>p.role))].map((role,i)=>({step:i+1,role,instanceIds:placements.filter(p=>p.role===role).map(p=>p.instanceId)}));
  model.structure={schema:'bricklab-vehicle-structure-revision-1',version:STRUCTURE_VERSION,parentContentSha256:base.contentSha256,audit,changes,rejected,internalInstanceIds:[...internal],floorInstanceIds:[...floorIds],floorGraph,floorValidation};
  model.checks.partCount=placements.length;model.checks.nativePartKinds=model.sources.length;
  model.checks.rejectionReasons=[...base.checks.rejectionReasons,'STRUCTURAL_REVISION_IS_NOT_WHOLE_CAR_OR_PHYSICAL_CERTIFICATION'];
  model.layout.wheelEnvelope=inspectWheelEnvelope(placements,parts,base.plan.wheelRadiusLdu,14);
  model.layout.roofWidth=roofWidth;
  model.layout.roofHeight=-roofY;model.layout.hoodHeight=base.layout.hoodHeight+bodyLift;model.layout.tailHeight=base.layout.tailHeight+bodyLift;model.layout.glassBase=-roofY-32;
  model.layout.glassFits=['windshield','rear-window'].map(role=>{const targetRise=-roofY-8-(role==='windshield'?model.layout.hoodHeight:model.layout.tailHeight);return {role,kind:'native-45-slope-with-source-landings',run:20,targetRise,actualRise:20,angle:45,partId:'3039',gapLdu:20-targetRise};});
  model.layout.angularConflicts=base.plan.constraints.filter(c=>/WindowAngle|windshieldAngle/.test(c.name)).map(c=>({name:c.name,observed:[c.min,c.max],sourceFaceDegrees:45,errorDegrees:45-(c.min+c.max)/2}));
  model.layout.regions=[...new Set(placements.map(p=>p.role))].map(role=>({role,purpose:placements.find(p=>p.role===role)!.decision.purpose,instanceIds:placements.filter(p=>p.role===role).map(p=>p.instanceId)}));
  model.layout.mountCandidates=inspectMountCandidates(placements,parts);
  model.layout.selection=model.sources.map(s=>{const part=parts.get(s.partId)!,a=admissions.get(s.partId)!,b=part.geometry.bounds!;return {partId:s.partId,name:part.geometry.name,nativeSize:b.max.map((v,i)=>v-b.min[i]),instances:placements.filter(p=>p.partId===s.partId).map(p=>({instanceId:p.instanceId,role:p.role,rotation:p.transform.rotation,purpose:p.decision.purpose,evidence:p.decision.imageIds})),permission:{structural:a.generationEligible,surface:a.exteriorGeneratable,reasonCodes:a.reasonCodes},placementVerification:'NOT_VERIFIED' as const};});
  const bodyPairs=audit.pairs.filter(p=>placements.find(q=>q.instanceId===p.a)!.role!=='wheel'&&placements.find(q=>q.instanceId===p.b)!.role!=='wheel');
  model.layout.surfacePairs={...model.layout.surfacePairs,scope:'ALL_NON_WHEEL_OVERLAPPING_OR_TOUCHING_NATIVE_ENVELOPES',results:bodyPairs.map(p=>({a:p.a,b:p.b,roleA:placements.find(q=>q.instanceId===p.a)!.role,roleB:placements.find(q=>q.instanceId===p.b)!.role,status:p.status as 'clear'|'collision'|'blocked',reasonCode:p.reasonCode,sourceJoint:undefined})),broadPhaseDisjoint:0};
  const body=placements.filter(p=>p.role!=='wheel').map(p=>worldBounds(p,parts.get(p.partId)!));
  for(let i=0;i<body.length;i++)for(let j=i+1;j<body.length;j++)if(body[i].min.some((v,k)=>v>body[j].max[k]+.0001||body[j].min[k]>body[i].max[k]+.0001))model.layout.surfacePairs.broadPhaseDisjoint++;
  const allBounds=placements.map(p=>({p,b:worldBounds(p,parts.get(p.partId)!)}));
  const min=(axis:number,role?:string)=>Math.min(...allBounds.filter(q=>!role||q.p.role===role).map(q=>q.b.min[axis]));
  const max=(axis:number,role?:string)=>Math.max(...allBounds.filter(q=>!role||q.p.role===role).map(q=>q.b.max[axis]));
  Object.assign(model.checks.measured,{length:max(2)-min(2),width:Math.max(...body.map(b=>b.max[0]))-Math.min(...body.map(b=>b.min[0])),overallWidth:max(0)-min(0),height:-min(1),hoodLength:max(2,'hood')-min(2),cabinStart:min(2,'windshield')-min(2),cabinEnd:max(2,'rear-window')-min(2),roofStart:min(2,'roof')-min(2),roofEnd:max(2,'roof')-min(2),frontOverhang:base.plan.axleFront-L/2-min(2),rearOverhang:max(2)-(base.plan.axleRear-L/2),bodyGroundClearance:-Math.max(...body.map(b=>b.max[1])),sideWindowHeight:max(1,'side-window')-min(1,'side-window')});
  model.checks.errors=Object.fromEntries(Object.entries(model.checks.target).map(([key,value])=>[key,model.checks.measured[key]-value]));
  model.checks.metricPass=Object.entries(model.checks.errors).every(([key,error])=>Math.abs(error)<=(base.plan.quantization.comparisonToleranceLdu as Record<string,number>)[key]);
  const {contentSha256:_,id:__,...raw}=model;model.id='vehicle-structure-'+miniDigest(raw).slice(0,24);const {contentSha256:___,...withId}=model;model.contentSha256=miniDigest(withId);
  return {model,parts};
}
