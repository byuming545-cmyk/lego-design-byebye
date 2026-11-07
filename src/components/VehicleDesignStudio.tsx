import { useEffect, useMemo, useState } from "react";
import NativeAssemblyViewer, { type AssemblyAsset } from "./NativeAssemblyViewer.js";
import type { BodyPreview } from "../vehicles/body-preview.js";
import { appearanceGroups, groupPresentation, GROUP_NOTICE } from "../vehicles/appearance-groups.js";
import { PAINT_PALETTE, PAINT_CHANNELS, PAINT_PRESETS, PAINT_VERSION, paintAppearance, parsePaintOptions, createDesignDraft, validateDesignDraft, paintBomCsv, type PaintChannel, type PaintColor, type PaintOptions, type DesignDraft } from "../vehicles/appearance-design.js";
import "./vehicle-design-studio.css";
const views = [["perspective", "斜侧"], ["side", "侧面"], ["front", "正面"], ["rear", "背面"], ["top", "俯视"]] as const;
export function downloadDesignText(value: string, name: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([value], { type })); const a = document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export default function VehicleDesignStudio({ base, assets, initialDraft, onChange, onSave, stageTestId="vehicle-preview-stage" }: {
  base: BodyPreview; assets: Record<string,AssemblyAsset>; initialDraft?: DesignDraft;
  onChange?: (options:PaintOptions)=>void; onSave?: (draft:DesignDraft)=>Promise<void>; stageTestId?: string;
}) {
  const storageKey=PAINT_VERSION+":"+base.contentSha256;
  const [options,setOptions]=useState<PaintOptions>(()=>{try{const saved=localStorage.getItem(storageKey);return saved?parsePaintOptions(JSON.parse(saved)):parsePaintOptions();}catch{return parsePaintOptions();}});
  const [channel,setChannel]=useState<PaintChannel>("body"),[view,setView]=useState<typeof views[number][0]>("perspective"),[status,setStatus]=useState(""),[busy,setBusy]=useState(false);
  const painted=useMemo(()=>paintAppearance(base,options),[base,options]);
  const grouping=useMemo(()=>{try{return appearanceGroups(base);}catch{return undefined;}},[base]);
  const [groupIndex,setGroupIndex]=useState<number|null>(null),[playing,setPlaying]=useState(false);
  const presentation=useMemo(()=>grouping?groupPresentation(grouping,groupIndex):{},[grouping,groupIndex]);
  const group=groupIndex===null?undefined:grouping?.groups[groupIndex];
  useEffect(()=>{setPlaying(false);setGroupIndex(null);},[base.contentSha256]);
  useEffect(()=>{
    if(!playing||!grouping)return;
    if(groupIndex===grouping.groups.length-1){setPlaying(false);return;}
    const timer=setTimeout(()=>setGroupIndex((groupIndex??-1)+1),1600);
    return()=>clearTimeout(timer);
  },[playing,grouping,groupIndex]);
  function selectGroup(index:number|null){setPlaying(false);setGroupIndex(index);}
  useEffect(()=>{onChange?.(options);try{localStorage.setItem(storageKey,JSON.stringify(options));}catch{/* explicit save/export below remains available */}},[options,onChange,storageKey]);
  useEffect(()=>{if(initialDraft)void validateDesignDraft(initialDraft,base).then(d=>{setOptions(d.designOptions);setStatus("已重开保存的配色草稿；原始模型保持不变");}).catch(()=>setStatus("配色草稿与当前模型不匹配，未应用"));},[initialDraft,base]);
  const regionColours=new Set(painted.assignments.filter(a=>a.channel===channel).map(a=>a.designColor));
  const current=regionColours.size===1?[...regionColours][0]:undefined;
  async function exportDraft(){try{const draft=await createDesignDraft(base,options);downloadDesignText(JSON.stringify(draft,null,2),"vehicle-colour-draft.json");setStatus("已导出完整配色草稿，含原模型引用和完整BOM");}catch{setStatus("配色草稿导出失败，原始模型保持不变");}}
  async function save(){setBusy(true);try{const draft=await createDesignDraft(base,options);if(onSave)await onSave(draft);localStorage.setItem(storageKey,JSON.stringify(options));setStatus(onSave?"配色草稿已保存到当前任务，可通过保存链接重开":"配色已保存在此浏览器；建议同时导出草稿文件");}catch{setStatus("保存未完成，请导出配色草稿文件保留修改");}finally{setBusy(false);}}
  async function importDraft(file:File){try{if(file.size>8e6)throw Error();const draft=await validateDesignDraft(JSON.parse(await file.text()),base);setOptions(draft.designOptions);setStatus("配色草稿已重开；完整零件和原始验证状态保留");}catch{setStatus("无法导入：文件与当前车型、配色版本或原始几何不匹配");}}
  return <div className="vehicle-design-studio">
    <section className="vehicle-paint" aria-label="设计配色">
      <div className="vehicle-paint-heading"><strong>设计配色</strong><button type="button" className="vehicle-text-button" onClick={()=>{setOptions(parsePaintOptions());setStatus("已恢复原始配色");}}>恢复默认配色</button></div>
      <label className="vehicle-paint-target">配色区域<select value={channel} onChange={e=>setChannel(e.target.value as PaintChannel)}>{PAINT_CHANNELS.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}</select><span>{current?`当前：${PAINT_PALETTE[current].label}`:regionColours.size?"保留原配色（多色）":"此模型无此区域"}</span></label>
      <div className="vehicle-swatches" role="radiogroup" aria-label="设计颜色">{Object.entries(PAINT_PALETTE).map(([id,c])=><button type="button" role="radio" aria-checked={current===id} aria-label={c.label} title={c.label} key={id} onClick={()=>setOptions({...options,[channel]:id as PaintColor})}><i style={{background:c.hex}}/><span>{c.label}</span></button>)}</div>
      <div className="vehicle-paint-presets">{PAINT_PRESETS.map(p=><button type="button" key={p.id} onClick={()=>setOptions({...p.options})}>{p.label}</button>)}</div>
      <p className="vehicle-design-note">设计颜色预览；对应实物颜色和库存未验证。玻璃、轮胎和灯区保留用途颜色。</p>
    </section>
    <div className="vehicle-views" aria-label="模型视角">{views.map(([id,label])=><button type="button" key={id} aria-pressed={view===id} onClick={()=>setView(id)}>{label}</button>)}</div>
    <div data-testid={stageTestId} data-model-hash={base.contentSha256} data-paint-options={JSON.stringify(options)} className="vehicle-render-stage"><NativeAssemblyViewer placements={base.placements} assets={assets} designColors={painted.designColors} {...presentation} view={view} fitToModel showConnections={false} showProxies={false} showPath={false} showZones={false}/></div>
    <section className="vehicle-groups" aria-label="步骤分组演示" data-group-index={groupIndex??"all"} data-playing={playing}>
      <div className="vehicle-paint-heading"><strong>步骤分组演示</strong><span>外观分组草稿</span></div>
      <p className="vehicle-group-notice">{GROUP_NOTICE}</p>
      {grouping?<><div className="vehicle-group-controls"><button type="button" disabled={groupIndex===0} onClick={()=>selectGroup(Math.max(0,(groupIndex??1)-1))}>上一步</button><button type="button" disabled={groupIndex===grouping.groups.length-1} onClick={()=>selectGroup(Math.min(grouping.groups.length-1,(groupIndex??-1)+1))}>下一步</button><button type="button" onClick={()=>{if(playing)setPlaying(false);else{if(groupIndex===null||groupIndex===grouping.groups.length-1)setGroupIndex(0);setPlaying(true);}}}>{playing?"暂停":"播放"}</button><button type="button" onClick={()=>selectGroup(null)}>显示全部</button><span>{group?`${groupIndex!+1} / ${grouping.groups.length}`:`全部 ${base.placements.length} 件`}</span></div>
      <input className="vehicle-group-slider" aria-label="分组进度" type="range" min={1} max={grouping.groups.length} value={groupIndex===null?grouping.groups.length:groupIndex+1} onChange={e=>selectGroup(Number(e.target.value)-1)}/>
      <div className="vehicle-group-summary" aria-live="polite"><strong>{group?group.name:"完整模型"}</strong><span>{group?`${group.members.length} 件 · 当前组发光高亮，后续组隐藏`:"所有零件显示，设计配色完整恢复"}</span><p>{group?.use??"选择下一步或播放，逐组查看模型组成；保存和导出始终包含完整模型。"}</p></div>
      {group&&<details className="vehicle-group-members"><summary>当前组编号、用途与来源（{group.members.length} 件）</summary><table><thead><tr><th>实例 / 编号</th><th>用途 / 设计颜色</th><th>来源</th></tr></thead><tbody>{group.members.map(p=><tr key={p.instanceId}><td>{p.instanceId}<br/>{p.partId} × 1</td><td>{p.role}<br/>{PAINT_PALETTE[painted.placements.find(q=>q.instanceId===p.instanceId)!.color].label}</td><td>{p.craft?`${p.craft.caseId} / ${p.craft.localId}`:`原外观分组 ${p.sourceGroup}`}<br/>外部装配未验证</td></tr>)}</tbody></table><p>来源模块的原色、源文件与局部姿态随完整草稿保留；分组编号不代表原说明书步骤。</p></details>}</>:<p role="status">原始分组与模型成员不一致，未开启演示；完整模型和验证状态保持不变。</p>}
    </section>
    <div className="vehicle-design-actions"><button type="button" disabled={busy} onClick={()=>void save()}>{busy?"正在保存配色":"保存配色草稿"}</button><button type="button" onClick={()=>void exportDraft()}>导出配色草稿 JSON</button><button type="button" onClick={()=>downloadDesignText(paintBomCsv(painted.bom),"vehicle-colour-bom.csv","text/csv")}>当前配色 BOM</button><label>导入配色草稿 JSON<input type="file" accept="application/json,.json" onChange={e=>{if(e.target.files?.[0])void importDraft(e.target.files[0]);}}/></label></div>
    <p className="vehicle-design-status" role="status">{status}</p>
    <details className="vehicle-paint-bom"><summary>当前配色零件清单（{painted.placements.length} 件）</summary><table><thead><tr><th>编号</th><th>设计颜色</th><th>数量</th><th>实物颜色供应</th></tr></thead><tbody>{painted.bom.map(b=><tr key={b.partId+b.color}><td>{b.partId}</td><td>{PAINT_PALETTE[b.color].label}</td><td>{b.quantity}</td><td>未验证</td></tr>)}</tbody></table></details>
  </div>;
}
