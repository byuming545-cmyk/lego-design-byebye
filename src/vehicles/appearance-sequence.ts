import type { BodyPreview, BodyPlacement } from "./body-preview.js";
import type { AssemblyAsset } from "../components/NativeAssemblyViewer.js";
import { isRigidTransform } from "../parts/assembly/math.js";
import { appearanceGroups } from "./appearance-groups.js";
import { canonicalJson, createDesignDraft, designDigest, paintAppearance, type PaintOptions } from "./appearance-design.js";

export const SEQUENCE_VERSION = "native-role-spatial-sequence-1";
export const SEQUENCE_SCHEMA = "bricklab-vehicle-sequence-demo-1";
export const SEQUENCE_NOTICE = "建议顺序演示，连接、安装路径与实物拼搭尚未完整验证。";
const phases = [
  { id:"base", name:"底部承托", roles:["chassis"], reason:"先展示模型中实际存在的底部承托，建立整车位置参照。" },
  { id:"lower", name:"车身下部", roles:["side-skirt"], reason:"先展示低位侧裙，随后再展示上方侧面覆盖。" },
  { id:"arches", name:"轮拱区域", roles:["wheel-arch"], reason:"用原轮拱位置标明车轮包围区域；轮胎净空和接口仍未知。" },
  { id:"body", name:"侧面与腰线", roles:["side","belt"], reason:"按实际几何高度由下向上展开侧面，邻近的同用途零件可小组展示。" },
  { id:"front", name:"前脸与保险杠", roles:["front-bumper","front-apron","grille","grille-divider","headlamp"], reason:"先展示前脸层次，机盖覆盖稍后出现，避免过早遮挡观察。" },
  { id:"rear", name:"尾部面板与灯区", roles:["rear-bumper","rear-panel","taillamp"], reason:"先展示尾部面板与灯区，随后展示上方覆盖。" },
  { id:"cover", name:"机盖与前后覆盖", roles:["hood","tail","shoulder"], reason:"下部和饰件展示之后，再按原生几何高度展开上方覆盖；不证明安装路径可行。" },
  { id:"pillars", name:"窗柱", roles:["window-pillar"], reason:"窗柱单独展示，便于观察其与后续窗区、车顶的位置关系。" },
  { id:"cabin", name:"窗区", roles:["windshield","side-window","rear-window"], reason:"前挡、侧窗与后窗分别呈现；黑色积木仅表达玻璃外观。" },
  { id:"roof", name:"车顶封盖", roles:["roof"], reason:"车顶较晚展示，让座舱内部和窗柱在此前保持可见。" },
  { id:"wheels", name:"轮胎与轮毂", roles:["wheel"], reason:"轮组放在最后逐件展示，单独强调轮胎/轮毂配合与底盘安装未知；这不是已证实的安装时机。" },
  { id:"other", name:"其他实际零件", roles:[], reason:"未映射用途的实际成员保留显示，顺序缺少专门证据。" },
] as const;
const uses:Record<string,string>={chassis:"底部承托",'side-skirt':"侧裙",'wheel-arch':"轮拱",side:"侧面覆盖",belt:"腰线",hood:"机盖",tail:"尾部覆盖",shoulder:"翼子板收边",'front-bumper':"前保险杠",'front-apron':"前部下沿",grille:"格栅",'grille-divider':"格栅分隔",headlamp:"头灯",'rear-bumper':"后保险杠",'rear-panel':"尾部面板",taillamp:"尾灯",'window-pillar':"窗柱",windshield:"前挡",'side-window':"侧窗",'rear-window':"后窗",roof:"车顶",wheel:"轮胎或轮毂"};
type Bounds = { min:number[]; max:number[]; center:number[] };
function nativeBounds(p:BodyPlacement,asset:AssemblyAsset|undefined):Bounds {
  if(!isRigidTransform(p.transform))throw Error("SEQUENCE_NON_RIGID_POSE");
  if(!asset?.mesh.positions.length||!asset.mesh.indices.length)throw Error("SEQUENCE_NATIVE_MESH_MISSING");
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity],r=p.transform.rotation,t=p.transform.translation;
  for(const point of asset.mesh.positions){
    if(point.length!==3||!point.every(Number.isFinite))throw Error("SEQUENCE_NATIVE_MESH_INVALID");
    for(let axis=0;axis<3;axis++){const v=r[axis*3]*point[0]+r[axis*3+1]*point[1]+r[axis*3+2]*point[2]+t[axis];min[axis]=Math.min(min[axis],v);max[axis]=Math.max(max[axis],v);}
  }
  return {min,max,center:min.map((v,i)=>(v+max[i])/2)};
}
/** Native bounds and semantic roles supply presentation heuristics only.
 * No model identity, source file line order, fit permission or pose is changed. */
export function appearanceSequence(base:BodyPreview,assets:Record<string,AssemblyAsset>){
  const grouped=appearanceGroups(base),sourceGroups=new Map(grouped.groups.flatMap(g=>g.members.map(m=>[m.instanceId,m] as const)));
  if(base.units!=="LDU"||base.state!=="APPEARANCE_DRAFT"||base.checks.formalConnections!=="NOT_VERIFIED"||base.checks.physicalBuildVerified!==false)throw Error("SEQUENCE_SOURCE_STATUS");
  const all=base.placements.map(p=>({p,bounds:nativeBounds(p,assets[p.partId])}));
  const steps:SequenceStep[]=[],previous:typeof all=[];
  for(const phase of phases){
    const pending=all.filter(({p})=>(phases.find(q=>(q.roles as readonly string[]).includes(p.role))?.id??"other")===phase.id)
      .sort((a,b)=>b.bounds.max[1]-a.bounds.max[1]||a.p.role.localeCompare(b.p.role)||a.bounds.center[2]-b.bounds.center[2]||a.bounds.center[0]-b.bounds.center[0]||a.p.instanceId.localeCompare(b.p.instanceId));
    while(pending.length){
      const first=pending.shift()!,batch=[first];
      // At most two actual nearby members of the same role. Same digital-module
      // group may pair adjacent height levels; it supplies layout, never steps.
      if(phase.id!=="wheels"){
        const i=pending.findIndex(q=>q.p.role===first.p.role&&Math.abs(q.bounds.center[2]-first.bounds.center[2])<=Math.max(first.bounds.max[2]-first.bounds.min[2],q.bounds.max[2]-q.bounds.min[2])&&(
          Math.abs(q.bounds.max[1]-first.bounds.max[1])<1e-8||!!first.p.craft&&q.p.craft?.groupId===first.p.craft.groupId));
        if(i>=0)batch.push(...pending.splice(i,1));
      }
      const hints=batch.map(({p,bounds})=>{
        const nearest=previous.filter(q=>[0,2].every(a=>Math.min(q.bounds.max[a],bounds.max[a])>Math.max(q.bounds.min[a],bounds.min[a])))
          .sort((a,b)=>Math.abs(a.bounds.min[1]-bounds.max[1])-Math.abs(b.bounds.min[1]-bounds.max[1])||a.p.instanceId.localeCompare(b.p.instanceId))[0];
        return {instanceId:p.instanceId,candidatePriorInstanceId:nearest?.p.instanceId??null,signedNativeYGapLdu:nearest?nearest.bounds.min[1]-bounds.max[1]:null,scope:"BOUNDING_BOX_PROXIMITY_ONLY_NOT_CONNECTION" as const};
      });
      const warnings=["连接、承托、安装路径及实物稳定性未验证；几何邻近不授予装配资格。"];
      if(hints.some(h=>h.candidatePriorInstanceId===null))warnings.push("存在未找到此前投影邻件的成员，悬空或支承缺口仍待核实。");
      if(hints.some(h=>h.signedNativeYGapLdu!==null&&h.signedNativeYGapLdu>0))warnings.push("原生包围盒存在竖向间隔；没有自动补件或修改姿态。");
      if(phase.id==="wheels")warnings.push("轮胎/轮毂配合、底盘接口及安装时机未知；本步仅展示一个现有轮组成员。");
      if(phase.id==="other")warnings.push("该用途尚无专门的顺序规划规则。");
      const number=steps.length+1;
      steps.push({step:number,stage:phase.id,name:`${uses[first.p.role]??first.p.role} · ${batch.length} 件`,purpose:batch.map(q=>q.p.decision.purpose).filter((v,i,a)=>a.indexOf(v)===i),
        members:batch.map(({p,bounds})=>({instanceId:p.instanceId,partId:p.partId,role:p.role,originalDesignColor:p.color,craft:p.craft?{...p.craft}:null,sourceGroup:sourceGroups.get(p.instanceId)!.sourceGroup,bounds})),
        cumulativeCount:previous.length+batch.length,orderEvidence:"HEURISTIC_NOT_INSTRUCTION_EVIDENCE",reason:phase.reason+" 同阶段按原生 LDraw 的下方高度优先，邻近同用途成员最多两件一组。",displayAfterStep:number>1?number-1:null,
        originalInstructionStep:null,connection:"NOT_VERIFIED",support:"UNKNOWN",installationPath:"UNKNOWN",priorNeighbourHints:hints,warnings});
      previous.push(...batch);
    }
  }
  return {version:SEQUENCE_VERSION,status:"DRAFT_NOT_BUILD_INSTRUCTIONS" as const,notice:SEQUENCE_NOTICE,scope:"PRESENTATION_ORDER_ONLY_NOT_BUILD_INSTRUCTIONS" as const,parentContentSha256:base.contentSha256,
    boundsEvidence:"TRANSFORMED_NATIVE_MESH_VERTICES" as const,sourceBindings:base.sources.map(s=>({partId:s.partId,meshSha256:s.meshSha256})),
    stages:phases.flatMap(p=>{const items=steps.filter(s=>s.stage===p.id);return items.length?[{id:p.id,name:p.name,startStep:items[0].step,endStep:items.at(-1)!.step,reason:p.reason}]:[];}),
    steps,totalParts:base.placements.length,validation:structuredClone(base.checks)};
}
interface SequenceStep {
  step:number;stage:string;name:string;purpose:string[];
  members:{instanceId:string;partId:string;role:string;originalDesignColor:BodyPlacement["color"];craft:BodyPlacement["craft"]|null;sourceGroup:number;bounds:Bounds}[];
  cumulativeCount:number;orderEvidence:"HEURISTIC_NOT_INSTRUCTION_EVIDENCE";reason:string;displayAfterStep:number|null;originalInstructionStep:null;
  connection:"NOT_VERIFIED";support:"UNKNOWN";installationPath:"UNKNOWN";
  priorNeighbourHints:{instanceId:string;candidatePriorInstanceId:string|null;signedNativeYGapLdu:number|null;scope:"BOUNDING_BOX_PROXIMITY_ONLY_NOT_CONNECTION"}[];warnings:string[];
}
export type AppearanceSequence=ReturnType<typeof appearanceSequence>;
export function sequencePresentation(plan:AppearanceSequence,index:number|null){
  if(index===null)return {visibleInstanceIds:undefined,highlightInstanceIds:undefined};
  if(!Number.isInteger(index)||index<0||index>=plan.steps.length)throw Error("SEQUENCE_INDEX_INVALID");
  return {visibleInstanceIds:plan.steps.slice(0,index+1).flatMap(s=>s.members.map(p=>p.instanceId)),highlightInstanceIds:plan.steps[index].members.map(p=>p.instanceId)};
}
export function sequenceStepBom(base:BodyPreview,options:PaintOptions,step:SequenceStep){
  const painted=paintAppearance(base,options),ids=new Set(step.members.map(p=>p.instanceId)),rows=new Map<string,{partId:string;name:string;color:keyof typeof import('./appearance-design.js').PAINT_PALETTE;quantity:number}>();
  for(const p of painted.placements.filter(p=>ids.has(p.instanceId))){const key=p.partId+":"+p.color,row=rows.get(key);if(row)row.quantity++;else rows.set(key,{partId:p.partId,name:base.sources.find(s=>s.partId===p.partId)!.name,color:p.color,quantity:1});}
  return [...rows.values()];
}
export async function createSequenceDocument(base:BodyPreview,assets:Record<string,AssemblyAsset>,options:PaintOptions){
  for(const source of base.sources)if(!assets[source.partId]?.mesh||await designDigest(assets[source.partId].mesh)!==source.meshSha256)throw Error("SEQUENCE_MESH_BINDING");
  const value={schema:SEQUENCE_SCHEMA,scope:"PRESENTATION_ORDER_ONLY_NOT_BUILD_INSTRUCTIONS" as const,sequence:appearanceSequence(base,assets),designDraft:await createDesignDraft(base,options)};
  return {...value,contentSha256:await designDigest(value)};
}
export async function validateSequenceDocument(value:unknown,base:BodyPreview,assets:Record<string,AssemblyAsset>){
  const v=value as Awaited<ReturnType<typeof createSequenceDocument>>;
  if(v?.schema!==SEQUENCE_SCHEMA||v.sequence?.version!==SEQUENCE_VERSION||v.sequence?.parentContentSha256!==base.contentSha256)throw Error("SEQUENCE_SCHEMA_OR_PARENT");
  const expected=await createSequenceDocument(base,assets,v.designDraft?.designOptions);
  if(canonicalJson(value)!==canonicalJson(expected))throw Error("SEQUENCE_CONTENT_OR_ORDER_CHANGED");
  return expected;
}
