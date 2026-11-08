import {useEffect,useMemo,useState} from "react";
import type {AssemblyAsset} from "./NativeAssemblyViewer.js";
import type {BodyPreview} from "../vehicles/body-preview.js";
import {appearanceSequence,sequencePresentation,sequenceStepBom,createSequenceDocument,validateSequenceDocument,SEQUENCE_NOTICE} from "../vehicles/appearance-sequence.js";
import {PAINT_PALETTE,type PaintOptions} from "../vehicles/appearance-design.js";

type Presentation={visibleInstanceIds?:string[];highlightInstanceIds?:string[]};
export default function VehicleSequencePanel({base,assets,options,onPresentation,onImportOptions}:{
  base:BodyPreview;assets:Record<string,AssemblyAsset>;options:PaintOptions;
  onPresentation:(value:Presentation)=>void;onImportOptions:(value:PaintOptions)=>void;
}){
  const result=useMemo(()=>{try{return {plan:appearanceSequence(base,assets),error:""};}catch(e){return {plan:undefined,error:String(e)};}},[base,assets]);
  const plan=result.plan;
  const[index,setIndex]=useState<number|null>(null),[playing,setPlaying]=useState(false),[speed,setSpeed]=useState(1),[status,setStatus]=useState("");
  const presentation=useMemo(()=>plan?sequencePresentation(plan,index):{},[plan,index]);
  useEffect(()=>onPresentation(presentation),[onPresentation,presentation]);
  useEffect(()=>{setIndex(null);setPlaying(false);},[base.contentSha256]);
  useEffect(()=>{
    if(!playing||!plan)return;
    if(index===plan.steps.length-1){setPlaying(false);return;}
    const timer=setTimeout(()=>setIndex((index??-1)+1),1600/speed);
    return()=>clearTimeout(timer);
  },[playing,plan,index,speed]);
  const step=index===null?undefined:plan?.steps[index];
  const bom=useMemo(()=>step?sequenceStepBom(base,options,step):[],[base,options,step]);
  function select(next:number|null){setPlaying(false);setIndex(next);}
  async function exportSequence(){try{
    const d=await createSequenceDocument(base,assets,options),url=URL.createObjectURL(new Blob([JSON.stringify(d,null,2)],{type:"application/json"})),a=document.createElement("a");a.href=url;a.download="vehicle-sequence-demo.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setStatus("已导出完整模型、当前配色与草稿顺序；后续隐藏零件均保留。");
  }catch{setStatus("顺序导出未通过模型或网格绑定检查，未导出。");}}
  async function importSequence(file:File){try{if(file.size>8e6)throw Error();const d=await validateSequenceDocument(JSON.parse(await file.text()),base,assets);onImportOptions(d.designDraft.designOptions);select(null);setStatus("已重开完整演示草稿与配色，播放位置已重置；原始验证状态保留。");}catch{setStatus("无法导入：车型、版本、顺序、网格或完整模型与当前示例不匹配。");}}
  return <section className="vehicle-groups vehicle-sequence" aria-label="拼搭顺序演示（草稿）" data-step-index={index??"all"} data-playing={playing} data-total-steps={plan?.steps.length??0}>
    <div className="vehicle-paint-heading"><strong>拼搭顺序演示（草稿）</strong><span>{plan?`${plan.steps.length} 步 · ${plan.totalParts} 件`:"顺序暂不可用"}</span></div>
    <p className="vehicle-group-notice">{SEQUENCE_NOTICE}</p>
    {plan?<>
      <div className="vehicle-group-controls"><button type="button" onClick={()=>select(0)}>开始演示</button><button type="button" disabled={index===null||index===0} onClick={()=>select(Math.max(0,index!-1))}>上一步</button><button type="button" disabled={index===plan.steps.length-1} onClick={()=>select(Math.min(plan.steps.length-1,(index??-1)+1))}>下一步</button><button type="button" onClick={()=>{if(playing)setPlaying(false);else{if(index===null||index===plan.steps.length-1)setIndex(0);setPlaying(true);}}}>{playing?"暂停":"播放"}</button><button type="button" onClick={()=>select(null)}>显示全部</button><span>{step?`${step.step} / ${plan.steps.length}`:"完整模型"}</span></div>
      <div className="vehicle-sequence-options"><label>播放速度<select aria-label="顺序播放速度" value={speed} onChange={e=>setSpeed(Number(e.target.value))}>{[.5,1,2,4].map(s=><option key={s} value={s}>{s}×</option>)}</select></label><label>跳转阶段<select aria-label="跳转演示阶段" value={step?.stage??""} onChange={e=>{const stage=plan.stages.find(s=>s.id===e.target.value);if(stage)select(stage.startStep-1);}}><option value="" disabled>选择实际阶段</option>{plan.stages.map(s=><option value={s.id} key={s.id}>{s.name} · {s.startStep}–{s.endStep}</option>)}</select></label></div>
      <input className="vehicle-group-slider" aria-label="拼搭演示进度" type="range" min={1} max={plan.steps.length} value={index===null?plan.steps.length:index+1} onChange={e=>select(Number(e.target.value)-1)}/>
      <div className="vehicle-group-summary" aria-live="polite"><strong>{step?`第 ${step.step} 步 · ${step.name}`:"完整模型"}</strong><span>{step?`本步新增 ${step.members.length} 件 · 累计 ${step.cumulativeCount} / ${plan.totalParts} 件`:"点击开始演示，从底部零件逐步展开。"}</span>{index===plan.steps.length-1&&<b className="vehicle-sequence-finished">演示结束</b>}</div>
      {step&&<>
        <table className="vehicle-step-bom"><caption>本步零件与当前设计颜色</caption><thead><tr><th>编号</th><th>设计颜色</th><th>数量</th><th>用途</th></tr></thead><tbody>{bom.map(b=><tr key={b.partId+b.color}><td title={b.name}>{b.partId}</td><td>{PAINT_PALETTE[b.color].label}</td><td>{b.quantity}</td><td>{step.name.split(" · ")[0]}</td></tr>)}</tbody></table>
        <p className="vehicle-sequence-reason">顺序依据{base.structure?"（局部接口证据与展示启发式）":"（启发式）"}：{step.reason}</p><p className="vehicle-sequence-unknown">{step.warnings.join(" ")}</p>
        <details className="vehicle-group-members"><summary>本步来源与未验证事项</summary><p>来源布局与展示排序分开；没有使用原说明书页码或步骤证据。</p>{step.members.map(p=><p key={p.instanceId}>{p.instanceId} · {p.partId} · {p.craft?`${p.craft.caseId} / ${p.craft.localId} · 源色 ${p.craft.sourceColor}`:`原外观分组 ${p.sourceGroup}`} · 原设计色 {p.originalDesignColor}</p>)}<pre>{JSON.stringify({orderEvidence:step.orderEvidence,originalInstructionStep:step.originalInstructionStep,connection:step.connection,support:step.support,installationPath:step.installationPath,priorNeighbourHints:step.priorNeighbourHints,purpose:step.purpose},null,2)}</pre></details>
      </>}
      <div className="vehicle-sequence-files"><button type="button" onClick={()=>void exportSequence()}>导出演示顺序 JSON</button><label>导入演示顺序 JSON<input type="file" accept=".json,application/json" onChange={e=>{if(e.target.files?.[0])void importSequence(e.target.files[0]);}}/></label><button type="button" onClick={()=>select(null)}>退出演示</button></div><p className="vehicle-sequence-status" role="status">{status}</p>
    </>:<p role="status">原始分组或原生几何检查未通过，未规划顺序；完整模型保持不变。<small>{result.error}</small></p>}
  </section>;
}
