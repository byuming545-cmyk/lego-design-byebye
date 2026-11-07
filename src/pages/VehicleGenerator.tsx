import { useEffect, useRef, useState } from "react";
import { ArrowDownToLine, ArrowRight, Blocks, Box, Check, ChevronDown, CircleHelp, Database, FolderOpen, Layers3, LoaderCircle, RefreshCw, WifiOff } from "lucide-react";
import { type AssemblyAsset } from "../components/NativeAssemblyViewer.js";
import type { BodyPreview } from "../vehicles/body-preview.js";
import type { Job, VehicleInput } from "../vehicles/types.js";
import { DEMO_CARS } from "../vehicles/demo-catalog.js";
import { bodyLayoutSvg } from "../vehicles/body-layout.js";
import { verifySavedExample } from "../vehicles/saved-example.js";
import VehicleDesignStudio from "../components/VehicleDesignStudio.js";
import { createDesignDraft, validateDesignDraft, paintAppearance, paintBomCsv, parsePaintOptions, PAINT_PALETTE, DESIGN_SCHEMA, type PaintOptions, type DesignDraft } from "../vehicles/appearance-design.js";
import "./vehicle-generator.css";

type Preview = { model: BodyPreview; assets: Record<string, AssemblyAsset>; designColors: Record<string, string> };
type Result = { preview: Preview; job: Job; mode: "generated" | "saved-example" };
const steps = [["research", "车型资料"], ["planning", "比例规划"], ["craft", "工艺检索"], ["selection", "真实选件"], ["generation", "生成与检查"]] as const;
const title = (input: VehicleInput) => `${input.year} ${input.make} ${input.model} ${input.variant}`;
const message = (error: unknown) => {
  const value = String(error);
  if (/fetch|Network|offline/i.test(value)) return "暂时无法连接服务。上次结果仍保留，也可以打开下方已保存示例。";
  if (/JOB_NOT_FOUND|INVALID_JOB_ID/.test(value)) return "没有找到这个保存任务。可以重新生成，或打开已保存示例。";
  if (/BODY_|DIMENSION|INSUFFICIENT|OBSERVATION_MISSING/.test(value)) return "当前资料或真实零件不能支持这次布局。上次结果仍保留，请使用已准备的车型或打开已保存示例。";
  if (/INVALID_VEHICLE_INPUT/.test(value)) return "请检查品牌、型号和年份后重试。";
  if (/CAPACITY/.test(value)) return "生成服务正在处理任务，请稍后重试。";
  if (/SCHEMA_OR_VERSION|SOURCE_LAYOUT_OR_HASH/.test(value)) return "这个历史模型需要原版本查看。请重新生成，历史文件保持不变。";
  if (/INTEGRITY|BINDING/.test(value)) return "资料或模型校验未通过。请检查来源文件后重试。";
  if (/BUDGET|CREDENTIAL/.test(value)) return "当前没有可用的分析调用授权。请使用已准备的两款车型或已保存示例。";
  return "本次操作未完成：" + value.replace(/^Error:\s*/, "");
};
async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(180000) });
  const data = await response.json();
  if (!response.ok) throw Error(data.error ?? "REQUEST_FAILED");
  return data as T;
}
function download(value: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([value], { type }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function VehicleGenerator() {
  const [input, setInput] = useState<VehicleInput>({ ...DEMO_CARS[0].input });
  const [useCraft, setUseCraft] = useState(true), [job, setJob] = useState<Job>(), [result, setResult] = useState<Result>();
  const [paintOptions,setPaintOptions]=useState<PaintOptions>(parsePaintOptions);
  const [importedDesign,setImportedDesign]=useState<DesignDraft>();
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [importStatus, setImportStatus] = useState("");
  const [tracking,setTracking]=useState(true);
  const [offline, setOffline] = useState(!navigator.onLine), [cacheState, setCacheState] = useState("备用结果正在准备");
  const [saved, setSaved] = useState<string[]>(() => { try { const v = JSON.parse(localStorage.getItem("bricklab-vehicle-jobs") ?? "[]"); return Array.isArray(v) ? v.filter(x => typeof x === "string" && /^[a-f0-9-]{36}$/.test(x)) : []; } catch { return []; } });
  const lock = useRef(false), latest = useRef(0), resultRef = useRef<Result | undefined>(undefined);
  const pending = busy || job?.state === "running"&&tracking;
  const displayed = result?.preview.model;
  const painted=displayed?paintAppearance(displayed,paintOptions):undefined;
  const observation=job?.research?.observation??displayed?.observation;
  const setLocation = (key: "job" | "example", value: string) => { const u = new URL(location.href); u.searchParams.delete("job"); u.searchParams.delete("example");u.searchParams.delete("design"); u.searchParams.set(key, value); history.replaceState({}, "", u); };
  async function openExample(id: string) {
    if (lock.current || pending) return;
    lock.current = true; setBusy(true); setError(""); ++latest.current;
    try {
      const payload = await verifySavedExample(await json(`/vehicle-demos/${id}.json`));
      const next: Result = { ...payload, mode: "saved-example" };
      setResult(next); resultRef.current = next;setImportedDesign(undefined); setJob(undefined); setInput(payload.job.input); setLocation("example", id);
    } catch (e) { setError(message(e)); } finally { lock.current = false; setBusy(false); }
  }
  useEffect(() => {
    const url = new URL(location.href), id = url.searchParams.get("job"), example = url.searchParams.get("example");
    if (example && DEMO_CARS.some(d => d.id === example)) { void openExample(example); return; }
    if (!id) return;
    const c = new AbortController();
    json<Job>("/api/vehicles/jobs/" + encodeURIComponent(id), { signal: c.signal }).then(j => { setJob(j); setInput(j.input); }).catch(e => { if (!c.signal.aborted) setError(message(e)); });
    return () => c.abort();
  }, []);
  useEffect(() => {
    const online = () => setOffline(!navigator.onLine);
    window.addEventListener("online", online); window.addEventListener("offline", online);
    if (import.meta.env.PROD && "serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/vehicle-demo-sw.js").then(async registration => {
        await navigator.serviceWorker.ready;
        const manifest = await json<{ version: string; files: string[] }>("/vehicle-demos/offline-files.json");
        const assets = performance.getEntriesByType("resource").map(e => e.name).filter(u => new URL(u).origin === location.origin && /\/assets\//.test(u));
        const channel = new MessageChannel();
        channel.port1.onmessage = e => setCacheState(e.data.ok ? "离线示例已准备" : "部分备用资源未缓存，可重载重试");
        registration.active?.postMessage({ type: "CACHE_PRESENTATION", urls: ["/vehicle-generator", "/", "/vehicle-demos/offline-files.json", ...manifest.files, ...assets] }, [channel.port2]);
      }).catch(() => setCacheState("备用结果可在线打开"));
    } else setCacheState("开发模式 · 备用结果可本地打开");
    return () => { window.removeEventListener("online", online); window.removeEventListener("offline", online); };
  }, []);
  useEffect(() => {
    if (!job || job.state !== "running"||!tracking) return;
    const c = new AbortController(); let running = false,failures=0;
    const timer = setInterval(async () => {
      if (running) return; running = true;
      try { setJob(await json<Job>("/api/vehicles/jobs/" + job.id, { signal: c.signal })); setError("");failures=0; }
      catch (e) { if (!c.signal.aborted) {setError(message(e));if(++failures>=3){setTracking(false);setError("任务状态暂时无法查询，后台可能仍在运行。上次结果已保留，可以恢复查询或打开已保存示例。");}} }
      finally { running = false; }
    }, 900);
    return () => { c.abort(); clearInterval(timer); };
  }, [job?.id, job?.state,tracking]);
  useEffect(() => {
    if (!job || job.state === "running") return;
    if (!job.preview) { setError(message(job.error ?? job.events.filter(e => ["blocked", "failed"].includes(e.state)).at(-1)?.detail ?? "没有可用的外观结果，请检查资料或打开已保存示例")); return; }
    const c = new AbortController(), token = ++latest.current;
    json<Preview>(`/api/vehicles/jobs/${job.id}/preview`, { signal: c.signal }).then(preview => {
      if (token !== latest.current) return;
      const next: Result = { preview, job, mode: "generated" }; setResult(next); resultRef.current = next;setImportedDesign(undefined); setImportStatus("");
      const digest=new URL(location.href).searchParams.get("design");
      if(digest)void json<{draft:DesignDraft}>(`/api/vehicles/jobs/${job.id}/designs/${encodeURIComponent(digest)}`,{signal:c.signal}).then(async({draft})=>{const checked=await validateDesignDraft(draft,preview.model);if(token===latest.current)setImportedDesign(checked);}).catch(e=>{if(!c.signal.aborted)setError(message(e));});
    }).catch(e => { if (!c.signal.aborted) setError(message(e)); });
    return () => c.abort();
  }, [job?.id, job?.state]);
  async function generate(value = input) {
    if (lock.current || job?.state === "running"&&tracking) return;
    lock.current = true; setBusy(true); setError(""); setImportStatus(""); setInput(value); ++latest.current;
    try {
      const created = await json<Job>("/api/vehicles/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...value, ...(!useCraft ? { craftOptions: { enabled: false, excludedSourceSets: [] } } : {}) }) });
      setTracking(true);setJob(created); setLocation("job", created.id);
    } catch (e) { setError(message(e)); } finally { lock.current = false; setBusy(false); }
  }
  async function importAppearance(file: File) {
    if (!result || result.mode !== "generated" || file.size > 8e6) { setImportStatus("请先生成一个当前任务；文件上限 8 MB"); return; }
    try {
      const content=await file.text(),value=JSON.parse(content);
      if(value.schema===DESIGN_SCHEMA){const draft=await validateDesignDraft(value,result.preview.model);await persistDesign(draft);setImportedDesign(draft);setImportStatus("COLOUR_DRAFT_REOPENED_NOT_FORMAL");return;}
      const data = await json<{ status: string }>(`/api/vehicles/jobs/${result.job.id}/preview/import`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }) }); setImportStatus(data.status); }
    catch (e) { setImportStatus(message(e)); }
  }
  async function persistDesign(draft:DesignDraft){
    const current=resultRef.current;if(!current||current.mode!=="generated")throw Error("DESIGN_TASK_REQUIRED");
    const value=await json<{draft:DesignDraft}>(`/api/vehicles/jobs/${current.job.id}/designs`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({content:JSON.stringify(draft)})});
    if(value.draft.contentSha256!==draft.contentSha256)throw Error("DESIGN_SAVE_BINDING");
    const url=new URL(location.href);if(url.searchParams.get("job")===current.job.id){url.searchParams.set("design",draft.contentSha256);history.replaceState({},"",url);}
    const refs=JSON.parse(localStorage.getItem("bricklab-vehicle-design-links")??"[]") as {job:string;digest:string}[];
    const next=[{job:current.job.id,digest:draft.contentSha256},...refs.filter(r=>r.job!==current.job.id)].slice(0,10);localStorage.setItem("bricklab-vehicle-design-links",JSON.stringify(next));
  }
  async function saveCurrent() {
    if (!result || result.mode === "saved-example") return;
    const next = [result.job.id, ...saved.filter(id => id !== result.job.id)].slice(0, 10);
    localStorage.setItem("bricklab-vehicle-jobs", JSON.stringify(next)); setSaved(next);
    try{await persistDesign(await createDesignDraft(result.preview.model,paintOptions));setImportStatus("配色草稿已保存到当前任务");}catch(e){setError(message(e));}
  }
  const selections = displayed?.layout.craft.selections ?? [];
  const familyCount = new Set(selections.map(s => s.familyId)).size;
  const currentStage = job?.events.filter(e => e.state === "running").at(-1)?.stage;
  return <main className="vehicle-generator">
    <section className="vehicle-hero">
      <div><p className="vehicle-eyebrow"><span /> BRICKLAB / AUTOMOTIVE STUDIO</p><h1>把喜欢的车，<br /><em>变成积木。</em></h1><p className="vehicle-lead">从车型资料到真实零件，让比例、轮廓与拼搭工艺一起参与设计。</p></div>
      <div className="vehicle-hero-note"><Blocks size={24} strokeWidth={1.4} /><strong>两款车型 · 一个生成流程</strong><span>课堂演示版本 / 外观设计原型</span><small>资料驱动 · 原生几何 · 可追溯工艺</small></div>
    </section>
    <div className="vehicle-section-label"><span>01 / 选择一辆车开始</span><span>已准备资料的演示车型</span></div>
    <section className="vehicle-demo-cards" aria-label="演示车型">
      {DEMO_CARS.map((car, i) => <article className={`vehicle-demo-card ${input.model === car.input.model ? "selected" : ""}`} key={car.id}>
        <div className="vehicle-card-art"><span className="vehicle-card-number">0{i + 1}</span><img src={`/vehicle-demos/${car.id}.png`} alt={`${car.label} 实际积木模型截图`} /></div>
        <div className="vehicle-card-copy"><span className="vehicle-card-tag">{car.tagline}</span><h2>{car.label}</h2><p>{car.id === "charger" ? "长机盖、宽前脸与后置硬顶座舱。" : "短机盖、较高座舱与紧凑两厢车尾。"}</p><div className="vehicle-card-actions"><button className="vehicle-card-generate" disabled={pending || offline} onClick={() => void generate(car.input)}>生成这款车 <ArrowRight size={15} /></button><button className="vehicle-text-button" disabled={pending} onClick={() => void openExample(car.id)}><FolderOpen size={14} />打开已保存示例</button></div></div>
      </article>)}
    </section>
    <section className="vehicle-workspace">
      <aside className="vehicle-control-panel">
        <p className="vehicle-eyebrow">02 / 车型输入</p><h2>设计工作台</h2><p className="vehicle-muted">两款演示车复用已缓存资料，点击后重新选件与生成。</p>
        <form onSubmit={e => { e.preventDefault(); void generate(); }}>
          {([['make', '品牌'], ['model', '型号'], ['year', '年份'], ['variant', '版本']] as const).map(([key, label]) => <label key={key}>{label}<input required={key !== 'variant'} maxLength={100} type={key === 'year' ? 'number' : 'text'} min={key === 'year' ? 1886 : undefined} max={key === 'year' ? new Date().getFullYear() + 1 : undefined} value={input[key]} disabled={pending} onChange={e => setInput({ ...input, [key]: key === 'year' ? Number(e.target.value) : e.target.value })} /></label>)}
          <label className="vehicle-checkbox"><input type="checkbox" checked={useCraft} disabled={pending} onChange={e => setUseCraft(e.target.checked)} />使用已有拼搭工艺</label>
          <button className="vehicle-primary" disabled={pending || offline}>{pending ? <><LoaderCircle size={17} className="vehicle-spin" />正在生成</> : <><Blocks size={17} />生成</>}</button>
        </form>
        <div className="vehicle-data-note"><Database size={16} /><span>{observation ? "使用已缓存资料" : "两款资料已准备"}<small>{observation?.method === "local-photo-review" ? "Golf：本地照片审阅估计，非千问响应" : observation ? "Charger：复用此前真实照片分析" : "来源与审阅方式随结果展示"}</small></span></div>
        <p className="vehicle-cache-state">{offline ? <WifiOff size={13} /> : <Check size={13} />}{cacheState}</p>
        <details className="vehicle-scope"><summary><CircleHelp size={14} />演示范围</summary><p>目前重点验证以上两款车型。其他车型可能缺少资料或可用组合；当前不承诺任意车型都达到相同外观水平。</p><p>外观草稿；整车装配、轮组配合和实物可拼未验证。本功能未训练或微调模型。</p></details>
      </aside>
      <div className="vehicle-preview-panel">
        <div className="vehicle-preview-heading"><div><p className="vehicle-eyebrow">03 / REAL PARTS, REAL GEOMETRY</p><h2>完整汽车外观预览</h2></div><span className="vehicle-draft-badge">外观草稿</span></div>
        <div className="vehicle-process" aria-label="实际生成流程" aria-live="polite">{steps.map(([stage, label], index) => {
          const events = job?.events.filter(e => stage === "generation" ? ["generation", "validation", "output"].includes(e.stage) : e.stage === stage) ?? [];
          const done = events.some(e => ["passed", "partial"].includes(e.state));
          const failed = events.some(e => ["failed", "blocked"].includes(e.state));
          const active = tracking&&job?.state === "running" && (currentStage === stage || stage === "generation" && ["validation", "output", "assembly"].includes(currentStage ?? ""));
          return <div key={stage} className={failed ? "failed" : active ? "active" : done ? "done" : ""}><i>{active ? <LoaderCircle size={13} className="vehicle-spin" /> : done ? <Check size={13} /> : index + 1}</i><span>{label}</span></div>;
        })}</div>
        {error && <div className="vehicle-error" role="alert"><span>{error}</span><button className="vehicle-text-button" disabled={pending || offline} onClick={() => {if(job?.state==="running"&&!tracking){setError("");setTracking(true);}else void generate();}}><RefreshCw size={14} />{job?.state==="running"&&!tracking?"恢复查询":"重试生成"}</button></div>}
        {job && job.state!=="running" && (!job.preview||job.error) && <details className="vehicle-failure-details"><summary>本次任务诊断</summary><p>任务 {job.id}</p><ol>{job.events.map((e,i)=><li key={i}>{e.stage} · {e.state}：{e.detail}</li>)}</ol></details>}
        {result && displayed ? <>
          <div className="vehicle-model-label"><strong>{title(displayed.input)}</strong><span>{result.mode === "saved-example" ? "已保存示例 · 本次未重新生成" : "当前引擎实际生成"}{pending ? " · 新任务处理中，保留上次结果" : ""}</span></div>
          <VehicleDesignStudio key={displayed.contentSha256} base={displayed} assets={result.preview.assets} initialDraft={importedDesign} onChange={setPaintOptions} onSave={result.mode==="generated"?persistDesign:undefined}/>
          <div className="vehicle-metrics"><div><Box size={17} /><strong>{displayed.placements.length}</strong><span>真实零件实例</span></div><div><Layers3 size={17} /><strong>{displayed.sources.length}</strong><span>原生零件种类</span></div><div><Blocks size={17} /><strong>{familyCount}</strong><span>采用的工艺家族</span></div><div><strong>{displayed.plan.widthStuds}</strong><span>格车身宽度</span></div></div>
          <p className="vehicle-boundary">整车连接未验证 · 轮组与稳定性未知 · 步骤为外观分组草稿</p>
          <div className="vehicle-downloads"><button className="vehicle-secondary" onClick={saveCurrent} disabled={result.mode === "saved-example"}><FolderOpen size={14} />保存当前任务</button><button className="vehicle-text-button" onClick={() => void createDesignDraft(displayed,paintOptions).then(d=>download(JSON.stringify(d,null,2),'vehicle-colour-draft.json','application/json')).catch(e=>setError(message(e)))}><ArrowDownToLine size={14} />模型 JSON</button><button className="vehicle-text-button" onClick={() => download(paintBomCsv(painted!.bom), 'vehicle-colour-bom.csv', 'text/csv')}>零件清单</button></div>
        </> : <div className="vehicle-empty"><div className="vehicle-empty-grid"><Blocks size={52} strokeWidth={1} /></div><h3>{pending ? "正在把资料转成积木设计" : "你的下一辆积木车，从这里开始"}</h3><p>{pending ? "执行阶段来自真实任务事件，完成后自动显示模型。" : "选择上方车型，或直接点击生成。"}</p><span>原生零件 / 刚体姿态 / 来源可追溯</span></div>}
      </div>
    </section>
    {saved.length > 0 && <nav className="vehicle-saved" aria-label="保存的车型任务"><FolderOpen size={15} /><span>保存的任务</span>{saved.map(id => <a key={id} href={(()=>{try{const refs=JSON.parse(localStorage.getItem("bricklab-vehicle-design-links")??"[]") as {job:string;digest:string}[];const d=refs.find(r=>r.job===id);return `/vehicle-generator?job=${id}${d?"&design="+d.digest:""}`;}catch{return `/vehicle-generator?job=${id}`;}})()}>重开 {id.slice(0, 8)}</a>)}</nav>}
    {result && displayed && <section className="vehicle-evidence">
      <div className="vehicle-section-label"><span>04 / 设计依据与验证详情</span><span>模型、来源与实际 BOM 一致</span></div>
      <details><summary>本次使用的拼搭工艺 <ChevronDown size={15} /></summary><p>资料库 {displayed.layout.craft.summary.designFamilies} 个设计家族 / {displayed.layout.craft.summary.sourceSets} 个来源；实际采用 {familyCount} 个家族、{selections.length} 次组合。本功能未训练或微调模型。</p>{selections.map(s => <p key={s.groupId}>{s.region} · {s.caseId} · {s.members.length} 个成员 · {s.source.author} / {s.source.license} · 外部安装未验证</p>)}<pre>{JSON.stringify(displayed.layout.craft.queries, null, 2)}</pre></details>
      <details><summary>比例规划与来源证据 <ChevronDown size={15} /></summary><p>{displayed.observation?.label ?? "使用已保存的研究与视觉估计"}</p><p>年款、配置与透视误差保留；原始区间没有为适配模型而修改。</p><div className="vehicle-layout-svg" dangerouslySetInnerHTML={{ __html: bodyLayoutSvg(displayed.plan) }} />{result.job.research?.sources.map(s => <p key={s.id}><a href={s.url} target="_blank" rel="noreferrer">{s.scope}</a> · SHA256 {s.sha256}</p>)}{result.job.research?.images.map(i => <p key={i.id}><a href={i.page} target="_blank" rel="noreferrer">{i.title}</a> · {i.author} · {i.license}</p>)}<pre>{JSON.stringify(displayed.checks, null, 2)}</pre></details>
      <details><summary>零件、草稿步骤与重新导入 <ChevronDown size={15} /></summary><p>步骤状态：外观分组草稿，非可实拼说明书</p><table><thead><tr><th>编号</th><th>真实零件名称</th><th>数量</th></tr></thead><tbody>{painted!.bom.map(b => <tr key={b.partId + b.color}><td>{b.partId}</td><td>{b.name} · {PAINT_PALETTE[b.color].label}</td><td>{b.quantity}</td></tr>)}</tbody></table><label>重新导入外观模型 JSON<input type="file" accept="application/json,.json" onChange={e => { const f = e.target.files?.[0]; if (f) void importAppearance(f); }} /></label><p role="status">{importStatus}</p><pre>{JSON.stringify(displayed.steps, null, 2)}</pre></details>
      <details><summary>实际任务日志与装配范围 <ChevronDown size={15} /></summary><p>{result.mode === "saved-example" ? "以下为已保存任务记录，本次没有执行生成。" : "本次真实后端任务记录。"}</p><ol>{result.job.events.map((e, i) => <li key={i}>{e.stage} · {e.state}：{e.detail}</li>)}</ol><p>独立局部支撑验证与整车分开；源模块内部验证不代表已经安装到新车。BLOCKED 和 UNKNOWN 保持原状态。</p><pre>{JSON.stringify(result.job.assembly, null, 2)}</pre></details>
    </section>}
    <footer className="vehicle-footer"><span>BRICKLAB · 从资料到积木的设计实验</span><span>两款案例验证 / 非任意车型质量保证</span></footer>
  </main>;
}
