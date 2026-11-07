import { useEffect, useState } from "react";
import type { AssemblyAsset } from "../components/NativeAssemblyViewer.js";
import VehicleDesignStudio from "../components/VehicleDesignStudio.js";
import type { BodyPreview } from "../vehicles/body-preview.js";
import type { Job } from "../vehicles/types.js";
import { verifySavedExample } from "../vehicles/saved-example.js";
import "../styles.css";
import "./vehicle-generator.css";
import "./vehicle-offline-review.css";
type Saved = { scope:string; preview:{model:BodyPreview;assets:Record<string,AssemblyAsset>;designColors:Record<string,string>};job:Job };
export default function VehicleOfflineReview({ examples,covers }:{examples:Record<string,Saved>;covers:Record<string,string>}){
  const[id,setId]=useState("charger"),[verified,setVerified]=useState("");const value=examples[id],m=value.preview.model;
  useEffect(()=>{let active=true;setVerified("");void verifySavedExample(value).then(()=>{if(active)setVerified(m.contentSha256);}).catch(()=>{if(active)setVerified("failed");});return()=>{active=false;};},[value,m.contentSha256]);
  return <div className="app-shell"><header className="review-header"><strong>bricklab<span>.</span></strong><span>汽车设计原型 / 离线查看版</span></header><main className="vehicle-generator">
    <div className="review-notice" role="status">离线查看版 · 已保存示例 · 本次不执行生成</div>
    <section className="vehicle-hero"><div><p className="vehicle-eyebrow">BRICKLAB / AUTOMOTIVE STUDIO</p><h1>把喜欢的车，<br/><em>变成积木。</em></h1><p className="vehicle-lead">查看实际模型，选择配色，按建议顺序逐步展示。所有网格、图片和脚本均在本文件内。</p></div><div className="vehicle-hero-note"><strong>真实零件 · 顺序演示草稿</strong><span>拖动旋转 / 滚轮缩放 / 五视图</span><small>本次不运行新车型生成或完整装配引擎。</small></div></section>
    <section className="vehicle-demo-cards" aria-label="已保存车型">{[["charger","Dodge Charger R/T","1969 · 长机盖硬顶"],["golf","Volkswagen Golf GTI Mk1","1976 · 紧凑两厢"]].map(([key,label,tag])=><article className={"vehicle-demo-card "+(id===key?"selected":"")} key={key}><div className="vehicle-card-art"><img src={covers[key]} alt={label+" 实际模型截图"}/></div><div className="vehicle-card-copy"><span className="vehicle-card-tag">{tag}</span><h2>{label}</h2><p>实际保存模型；配色修改不会改变原始文件。</p><button className="vehicle-card-generate" onClick={()=>setId(key)}>查看已保存的 {key==="charger"?"Charger":"Golf"}</button></div></article>)}</section>
    <section className="vehicle-workspace"><aside className="vehicle-control-panel"><p className="vehicle-eyebrow">SAVED MODEL / 已保存模型</p><h2>{m.input.make} {m.input.model}</h2><p className="vehicle-muted">{m.input.year} · {m.input.variant}</p><div className="vehicle-data-note"><span>{m.observation?.label}</span></div><p className="vehicle-muted">外观草稿。整车装配、轮组配合、稳定性和实物可拼未验证。</p><p className="vehicle-muted">配色可保存在此浏览器，也可导出、导入完整派生草稿。对应实物颜色供应仍未验证。</p><p className="vehicle-muted">原生零件来自固定LDraw来源。复用模块保留 Adrien Pennamen、Magnus Forsberg / CC BY2.0 署名，完整来源随草稿导出。</p></aside>
    <div className="vehicle-preview-panel"><div className="vehicle-preview-heading"><div><p className="vehicle-eyebrow">REAL PARTS / 已保存示例</p><h2>完整汽车外观预览</h2></div><span className="vehicle-draft-badge">外观草稿</span></div><div className="vehicle-model-label"><strong>{m.input.year} {m.input.make} {m.input.model} {m.input.variant}</strong><span>本次未重新生成</span></div>{verified===m.contentSha256?<VehicleDesignStudio key={m.contentSha256} base={m} assets={value.preview.assets} stageTestId="offline-model"/>:<div className="vehicle-empty">{verified==="failed"?"文件校验未完成，请用电脑Chrome或Edge打开。":"正在校验保存模型与原生网格…"}</div>}<div className="vehicle-metrics"><div><strong>{m.placements.length}</strong><span>真实零件实例</span></div><div><strong>{m.sources.length}</strong><span>原生零件种类</span></div><div><strong>{new Set(m.layout.craft.selections.map(s=>s.familyId)).size}</strong><span>采用的工艺家族</span></div><div><strong>{m.plan.widthStuds}</strong><span>格车身宽度</span></div></div><p className="vehicle-boundary">完整模型和原始验证状态始终保留，步骤仍是外观分组草稿。</p></div></section><footer className="vehicle-footer"><span>BRICKLAB · 单文件离线查看</span><span>本次不执行生成 / 不产生模型调用费用</span></footer>
  </main></div>;
}
