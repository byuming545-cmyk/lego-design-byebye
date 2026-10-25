import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowDownToLine, Box, Check, CircleHelp, Layers3, Link2, LoaderCircle, Play, Upload } from 'lucide-react';
import NativePartViewer, { type NativeConnectionPoint, type NativeMesh, type NativeVector } from '../components/NativePartViewer.js';
import NativeAssemblyViewer, { type AssemblyAsset, type AssemblyCollisionProxy, type AssemblyDebugView, type AssemblyPlacement, type AssemblyTransform } from '../components/NativeAssemblyViewer.js';
import InterfaceCoverage, { type AggregateInterfaceCoverageData, type InterfaceCoverageData } from '../components/InterfaceCoverage.js';
import './assembly-lab.css';

interface SelectablePart { id: string; name: string; identitySystem: string; geometryReady: boolean; connectionReady: boolean; assemblyVerified?: boolean; generatable: boolean; enabledConnectionIds?: string[]; interfaceCoverage?: InterfaceCoverageData }
interface PartSourceDetail {
  part: SelectablePart;
  geometry?: { mesh?: NativeMesh; bounds?: { min: NativeVector; max: NativeVector } } | null;
  connections?: { points: NativeConnectionPoint[] } | null;
}
interface MigrationEntry {
  partId: string;
  status?: string;
  assemblyVerified: boolean;
  generatable: boolean;
  reasons?: string[];
  reasonCodes?: string[];
  interfaceCoverage?: InterfaceCoverageData;
  fullyAssemblyVerified?: boolean;
  partiallyGeneratable?: boolean;
  interfaceVerificationComplete?: boolean;
}
interface AssemblyStatus {
  counts: Record<string, number>;
  queue?: MigrationEntry[];
  entries?: MigrationEntry[];
  capabilities?: unknown;
  limitations?: string[];
  defaultPair?: { partA: string; connectionA: string; partB: string; connectionB: string; twistDegrees?: number } | null;
  interfaceCoverage?: AggregateInterfaceCoverageData;
}
interface NativeAssemblyModel {
  id?: string;
  placements: AssemblyPlacement[];
  edges?: { id: string; fixedInstanceId: string; movingInstanceId: string; ruleId: string; axis: NativeVector; anchor: NativeVector }[];
  partLibraryVersion?: string;
  assemblyEngineVersion?: string;
  connectionRuleVersion?: string;
  collisionVersion?: string;
  physicalBuildVerified?: boolean;
}
interface AssemblyResponse {
  accepted?: boolean;
  status?: string;
  reasons?: string[];
  reason?: string;
  rejections?: { code: string; reason: string }[];
  compatibility?: { compatible?: boolean; status?: string; ruleId?: string; ruleVersion?: string; reason?: string; reasons?: string[]; [key: string]: unknown };
  transform?: AssemblyTransform;
  candidate?: { transform: AssemblyTransform };
  collision?: { accepted?: boolean; status?: string; reason?: string; reasons?: string[]; [key: string]: unknown };
  assembly?: NativeAssemblyModel;
  model?: NativeAssemblyModel | null;
  assets?: Record<string, AssemblyAsset>;
  debug?: ApiDebug;
  [key: string]: unknown;
}
interface ApiDebug {
  transform?: AssemblyTransform;
  insertionPath?: NativeVector[];
  insertionAxis?: AssemblyDebugView['insertionAxis'];
  axis?: NativeVector;
  anchor?: NativeVector;
  proxies?: AssemblyDebugView['proxies'];
  collisionProxies?: AssemblyDebugView['proxies'];
  penetrationZone?: { center: NativeVector; axis: NativeVector; radius: number; depth: number };
  penetrationZones?: { origin?: NativeVector; center?: NativeVector; axis: NativeVector; radius: number; length?: number; depth?: number }[];
}
interface LoadedModel { assembly: NativeAssemblyModel; assets: Record<string, AssemblyAsset>; debug?: AssemblyDebugView }
interface ImportedModelResult extends AssemblyResponse { status: 'VALID' | 'NEEDS_REVALIDATION'; reasons: string[]; originalModelId: string | null; model: NativeAssemblyModel | null; physicalBuildVerified: false }

const modules = [
  { id: 'wall', label: '墙体' }, { id: 'platform', label: '平台' }, { id: 'simple-chassis', label: '简单车架' }, { id: 'simple-box', label: '箱体' }, { id: 'simple-roof', label: '屋顶' }, { id: 'basic-snot', label: 'SNOT 模块' }, { id: 'wheel-module', label: '轮组模块' },
];

function message(error: unknown) { return error instanceof Error ? error.message : '操作未完成，请重试。'; }
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/parts-foundation${path}`, { ...init, signal: init?.signal ?? AbortSignal.timeout(180_000), headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const body = await response.json().catch(() => ({ error: '服务返回了无法读取的响应。' }));
  if (!response.ok) throw new Error(body.error ?? body.message ?? `请求失败（${response.status}）`);
  return body as T;
}
function post<T>(path: string, data: unknown) { return request<T>(path, { method: 'POST', body: JSON.stringify(data) }); }
function ResultData({ title, value }: { title: string; value: unknown }) {
  return value === undefined || value === null ? null : <details className="assembly-result-data"><summary>{title}</summary><pre>{JSON.stringify(value, null, 2)}</pre></details>;
}
function ConnectionSelect({ label, points, selected, enabledIds, onChange, disabled }: { label: string; points: NativeConnectionPoint[]; selected: string; enabledIds?: string[]; onChange: (value: string) => void; disabled: boolean }) {
  return <label className="assembly-field"><span>{label}</span><select aria-label={label} value={selected} disabled={disabled || !points.length} onChange={(event) => onChange(event.target.value)}>{!points.length && <option value="">暂无来源连接点</option>}{points.map((point, index) => <option key={point.id ?? index} value={point.id ?? ''}>{point.id && enabledIds?.includes(point.id) ? '已开放' : '未开放'} · {point.id} · {point.family ?? '未分类'} · {point.gender ?? '未指定'} · ({point.position.map((value) => Number(value.toFixed(1))).join(', ')})</option>)}</select></label>;
}
function partQualification(row: MigrationEntry) {
  if (row.fullyAssemblyVerified ?? row.interfaceCoverage?.fullyAssemblyVerified) return 'fullyAssemblyVerified';
  if (row.partiallyGeneratable ?? row.interfaceCoverage?.partiallyGeneratable) return 'partiallyGeneratable';
  return row.assemblyVerified ? '限定接口已验证' : 'BLOCKED';
}

export default function AssemblyLab() {
  const [status, setStatus] = useState<AssemblyStatus | null>(null);
  const [parts, setParts] = useState<SelectablePart[]>([]);
  const [partA, setPartA] = useState('3001');
  const [partB, setPartB] = useState('3020');
  const [detailA, setDetailA] = useState<PartSourceDetail | null>(null);
  const [detailB, setDetailB] = useState<PartSourceDetail | null>(null);
  const [connectionA, setConnectionA] = useState('');
  const [connectionB, setConnectionB] = useState('');
  const [twist, setTwist] = useState('0');
  const [loading, setLoading] = useState(true);
  const [partsLoading, setPartsLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [statusError, setStatusError] = useState('');
  const [response, setResponse] = useState<AssemblyResponse | null>(null);
  const [model, setModel] = useState<LoadedModel | null>(null);
  const [showConnections, setShowConnections] = useState(true);
  const [showProxies, setShowProxies] = useState(false);
  const [showPath, setShowPath] = useState(true);
  const [showZones, setShowZones] = useState(false);
  const [queueQuery, setQueueQuery] = useState('');
  const [queueFilter, setQueueFilter] = useState('all');
  const [queueExpanded, setQueueExpanded] = useState(false);
  const [revision, setRevision] = useState(0);
  const [initialPair, setInitialPair] = useState<AssemblyStatus['defaultPair']>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<ImportedModelResult | null>(null);
  const [requiredPartId, setRequiredPartId] = useState('');
  const [generationPartCount, setGenerationPartCount] = useState('');
  const userSelected = useRef(false);
  const defaultApplied = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setStatusError('');
    void Promise.all([
      request<AssemblyStatus>('/assembly/status', { signal: controller.signal }).then((value) => {
        setStatus(value);
        if (value.defaultPair && !defaultApplied.current && !userSelected.current) {
          defaultApplied.current = true;
          setInitialPair(value.defaultPair); setPartA(value.defaultPair.partA); setPartB(value.defaultPair.partB); setTwist(String(value.defaultPair.twistDegrees ?? 0));
        }
      }),
      request<{ parts: SelectablePart[] }>('/parts', { signal: controller.signal }).then((data) => {
        const native = data.parts.filter((part) => part.identitySystem === 'ldraw' && part.geometryReady);
        setParts(native);
        setPartA((current) => native.some((part) => part.id === current) ? current : native[0]?.id ?? '');
        setPartB((current) => native.some((part) => part.id === current) ? current : native[1]?.id ?? native[0]?.id ?? '');
      }),
    ]).catch((reason) => { if (!controller.signal.aborted) setStatusError(message(reason)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);

  useEffect(() => {
    if (!partA || !partB) return;
    const controller = new AbortController();
    setPartsLoading(true); setDetailA(null); setDetailB(null); setConnectionA(''); setConnectionB(''); setResponse(null); setModel(null); setError('');
    void Promise.all([
      request<PartSourceDetail>(`/parts/${encodeURIComponent(partA)}`, { signal: controller.signal }),
      request<PartSourceDetail>(`/parts/${encodeURIComponent(partB)}`, { signal: controller.signal }),
    ]).then(([a, b]) => {
      if (controller.signal.aborted) return;
      setDetailA(a); setDetailB(b);
      const ap = a.connections?.points ?? [], bp = b.connections?.points ?? [];
      const preferredA = initialPair?.partA === partA ? ap.find((point) => point.id === initialPair.connectionA)?.id : undefined;
      const preferredB = initialPair?.partB === partB ? bp.find((point) => point.id === initialPair.connectionB)?.id : undefined;
      setConnectionA(preferredA ?? ap.find((point) => point.family === 'stud' && point.gender === 'M')?.id ?? ap[0]?.id ?? '');
      setConnectionB(preferredB ?? bp.find((point) => point.family === 'antiStud' && point.gender === 'F')?.id ?? bp.find((point) => point.gender === 'F')?.id ?? bp[0]?.id ?? '');
    }).catch((reason) => { if (!controller.signal.aborted) setError(message(reason)); }).finally(() => { if (!controller.signal.aborted) setPartsLoading(false); });
    return () => controller.abort();
  }, [partA, partB, initialPair]);

  async function loadModel(result: AssemblyResponse) {
    const assembly = result.assembly ?? result.model;
    if (!assembly?.placements?.length) { setModel(null); return; }
    const ids = [...new Set(assembly.placements.map((placement) => placement.partId))];
    if (ids.length > 250) throw new Error('装配结果包含过多不同零件，暂不显示三维视图。');
    const assets: Record<string, AssemblyAsset> = {};
    // Source assets may be supplied by the API; otherwise use the same immutable Part Lab endpoint.
    await Promise.all(ids.map(async (id) => {
      const collisionProxy = await request<AssemblyCollisionProxy>(`/parts/${encodeURIComponent(id)}/collision-proxy`).catch((reason) => ({ status: 'blocked' as const, reason: message(reason), reasonCode: 'proxy-request-unavailable' }));
      if (result.assets?.[id]?.mesh) { assets[id] = { ...result.assets[id], collisionProxy }; return; }
      const cached = [detailA, detailB].find((detail) => detail?.part.id === id);
      const detail = cached ?? await request<PartSourceDetail>(`/parts/${encodeURIComponent(id)}`);
      if (!detail.geometry?.mesh) throw new Error(`零件 ${id} 缺少真实网格，不能创建替代外形。`);
      assets[id] = { mesh: detail.geometry.mesh, connections: detail.connections?.points ?? [], collisionProxy };
    }));
    const edge = assembly.edges?.[0];
    const raw = result.debug;
    const zones = raw?.penetrationZones ?? (raw?.penetrationZone ? [raw.penetrationZone] : []);
    const penetrationZones = zones.flatMap((zone) => {
      const length = 'length' in zone ? zone.length ?? zone.depth : zone.depth;
      if (!length || (!('origin' in zone && zone.origin) && !zone.center)) return [];
      const origin = 'origin' in zone && zone.origin ? zone.origin : zone.center!.map((value, axis) => value - zone.axis[axis] * length / 2) as NativeVector;
      return [{ origin, axis: zone.axis, radius: zone.radius, length }];
    });
    const proxies = assembly.placements.flatMap((placement) => {
      const proxy = assets[placement.partId]?.collisionProxy;
      return proxy?.status === 'ready' && proxy.mesh ? [{ mesh: proxy.mesh, transform: placement.transform }] : [];
    });
    const debug: AssemblyDebugView = {
      insertionPath: raw?.insertionPath,
      insertionAxis: raw?.insertionAxis ?? (raw?.axis && raw.anchor ? { origin: raw.anchor, direction: raw.axis } : edge ? { origin: edge.anchor, direction: edge.axis } : undefined),
      proxies,
      penetrationZones,
    };
    setModel({ assembly, assets, debug });
  }

  async function autoAttach(event: FormEvent) {
    event.preventDefault();
    if (!connectionA || !connectionB) return;
    setBusy('attach'); setError(''); setResponse(null); setModel(null); setImportResult(null);
    try {
      const result = await post<AssemblyResponse>('/assembly/attach', { partA, connectionA, partB, connectionB, twistDegrees: Number(twist) });
      setResponse(result);
      await loadModel(result);
    } catch (reason) { setError(message(reason)); }
    finally { setBusy(''); }
  }
  async function generate(kind: string) {
    setBusy(kind); setError(''); setResponse(null); setModel(null); setImportResult(null);
    try {
      const result = await post<AssemblyResponse>('/assembly/generate', { kind, ...(requiredPartId ? { requiredPartIds: [requiredPartId] } : {}), ...(generationPartCount ? { partCount: Number(generationPartCount) } : {}) });
      setResponse(result);
      await loadModel(result);
    } catch (reason) { setError(message(reason)); }
    finally { setBusy(''); }
  }

  async function importModel(event: FormEvent) {
    event.preventDefault();
    if (!importFile) return;
    setBusy('import'); setError(''); setResponse(null); setModel(null); setImportResult(null);
    try {
      if (importFile.size > 5 * 1024 * 1024) throw new Error('模型文件应不超过 5 MiB。');
      const result = await post<ImportedModelResult>('/assembly/models/import', { content: await importFile.text() });
      setImportResult(result); setResponse(result);
      if (result.status === 'VALID' && result.model) await loadModel(result);
    } catch (reason) { setError(message(reason)); }
    finally { setBusy(''); }
  }
  async function exportModel(format: 'json' | 'ldr' | 'csv') {
    if (!model?.assembly.id || !['generated', 'VALID'].includes(response?.status ?? '')) return;
    setBusy(`export-${format}`); setError('');
    try {
      const result = await fetch(`/api/parts-foundation/assembly/models/${encodeURIComponent(model.assembly.id)}/export?format=${format}`, { signal: AbortSignal.timeout(120_000) });
      if (!result.ok) { const body = await result.json().catch(() => ({})); throw new Error(body.error ?? '模型当前不可导出，请重新验证。'); }
      const url = URL.createObjectURL(await result.blob()), anchor = document.createElement('a');
      anchor.href = url; anchor.download = `bricklab-real-assembly.${format}`; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (reason) { setError(message(reason)); }
    finally { setBusy(''); }
  }

  const queue = status?.queue ?? status?.entries ?? [];
  const filteredQueue = queue.filter((row) => (!queueQuery.trim() || row.partId.toLowerCase().includes(queueQuery.trim().toLowerCase())) && (queueFilter === 'all' || queueFilter === 'verified' && row.assemblyVerified || queueFilter === 'blocked' && !row.assemblyVerified || queueFilter === 'full' && partQualification(row) === 'fullyAssemblyVerified' || queueFilter === 'partial' && partQualification(row) === 'partiallyGeneratable' || queueFilter === 'astra' && (row.interfaceCoverage?.requiresAstraReview ?? 0) > 0 || queueFilter === 'pending' && (row.interfaceCoverage?.pending ?? 0) > 0));
  const displayedQueue = queueExpanded ? filteredQueue : filteredQueue.slice(0, 20);
  const accepted = response?.accepted === true || response?.status === 'generated' || response?.status === 'VALID';
  const resultTransform = response?.transform ?? response?.candidate?.transform ?? response?.debug?.transform;
  const resultReasons = [...new Set([...(response?.reasons ?? []), ...(response?.rejections?.map((rejection) => `${rejection.code}: ${rejection.reason}`) ?? []), ...(response?.reason ? [response.reason] : []), ...(response?.compatibility?.reasons ?? []), ...(response?.collision?.reasons ?? []), ...(response?.compatibility?.reason ? [response.compatibility.reason] : []), ...(response?.collision?.reason ? [response.collision.reason] : [])])];
  const selectedPoints = [detailA?.connections?.points.find((point) => point.id === connectionA), detailB?.connections?.points.find((point) => point.id === connectionB)];
  const proxiesReady = !!model && model.debug?.proxies?.length === model.assembly.placements.length;
  const proxyFailures = model ? Object.entries(model.assets).filter(([, asset]) => asset.collisionProxy?.status !== 'ready').map(([id, asset]) => `${id}: ${asset.collisionProxy?.reason ?? '尚未取得实际碰撞代理。'}`) : [];

  return <section className="assembly-lab" aria-label="真实零件装配模式">
    <div className="assembly-intro"><div><h2><Link2 size={20} />真实装配验证</h2><p>选择真实来源连接，由兼容规则、变换求解和碰撞检查决定拼接结果。</p></div><button className="assembly-secondary" onClick={() => setRevision((value) => value + 1)} disabled={loading || !!busy}>刷新验证报告</button></div>
    {statusError && <div className="part-alert" role="alert"><CircleHelp size={16} /><span>{statusError}</span><button onClick={() => setRevision((value) => value + 1)}>重试</button></div>}
    <div className="assembly-counts" aria-label="装配迁移统计">{[
      ['total', '纳入迁移队列'], ['assemblyVerified', '有已验证接口'], ['generatable', '可用于真实生成'], ['blocked', '有明确阻塞原因'],
    ].map(([key, label]) => <div key={key}><strong>{status ? (status.counts[key] ?? (key === 'total' ? queue.length : '—')) : '—'}</strong><span>{label}</span></div>)}</div>
    <p className="assembly-scope-note">数字装配验证与实体实拼分别记录。未解决的连接、公差和碰撞问题会保留为阻塞，不能用猜测提高通过数。</p>
    <InterfaceCoverage value={status?.interfaceCoverage} />
    <dl className="assembly-part-qualifications"><div><dt>fullyAssemblyVerified 零件</dt><dd>{status?.interfaceCoverage?.fullyAssemblyVerified ?? '—'}</dd></div><div><dt>partiallyGeneratable 零件</dt><dd>{status?.interfaceCoverage?.partiallyGeneratable ?? '—'}</dd></div><div><dt>接口已全部处理的零件</dt><dd>{status?.interfaceCoverage?.interfaceVerificationComplete ?? '—'}</dd></div></dl>

    <form className="assembly-controls" onSubmit={autoAttach}>
      <div className="assembly-part-column"><label className="assembly-field"><span>Part A · 固定零件</span><select aria-label="选择固定零件 A" value={partA} onChange={(event) => { userSelected.current = true; setPartA(event.target.value); }} disabled={!!busy || !parts.length}>{parts.map((part) => <option key={part.id} value={part.id}>{part.id} · {part.name}</option>)}</select></label><ConnectionSelect label="Connection A" selected={connectionA} points={detailA?.connections?.points ?? []} enabledIds={detailA?.part.enabledConnectionIds} onChange={setConnectionA} disabled={partsLoading || !!busy} /></div>
      <Link2 className="assembly-pair-icon" size={21} />
      <div className="assembly-part-column"><label className="assembly-field"><span>Part B · 待装配零件</span><select aria-label="选择待装配零件 B" value={partB} onChange={(event) => { userSelected.current = true; setPartB(event.target.value); }} disabled={!!busy || !parts.length}>{parts.map((part) => <option key={part.id} value={part.id}>{part.id} · {part.name}</option>)}</select></label><ConnectionSelect label="Connection B" selected={connectionB} points={detailB?.connections?.points ?? []} enabledIds={detailB?.part.enabledConnectionIds} onChange={setConnectionB} disabled={partsLoading || !!busy} /></div>
      <div className="assembly-attach-column"><label className="assembly-field"><span>连接轴上的离散旋转</span><select value={twist} onChange={(event) => setTwist(event.target.value)} disabled={!!busy} aria-label="选择装配旋转"><option value="0">0°</option><option value="90">90°</option><option value="180">180°</option><option value="270">270°</option></select></label><button className="assembly-primary" type="submit" disabled={loading || !!busy || partsLoading || !connectionA || !connectionB}>{busy === 'attach' ? <LoaderCircle size={16} className="part-spin" /> : <Link2 size={16} />}Auto Attach</button></div>
    </form>
    {(partsLoading || loading) && <div className="assembly-loading" role="status"><LoaderCircle size={17} className="part-spin" />{partsLoading ? '读取真实网格与来源连接…' : '执行并读取逐件装配验证…'}</div>}
    {error && <div className="part-alert" role="alert"><CircleHelp size={16} /><span>{error}</span></div>}

    <div className="assembly-result">
      <div className="assembly-result-heading"><h3>{model ? accepted ? '装配结果' : '装配检查视图' : '待装配零件'}</h3>{response && <span className={`assembly-result-badge ${accepted ? 'passed' : 'blocked'}`}>{accepted ? <Check size={13} /> : <CircleHelp size={13} />}{accepted ? '通过当前装配检查' : '本次未通过'}</span>}</div>
      <div className="assembly-view-options"><label><input type="checkbox" checked={showConnections} onChange={(event) => setShowConnections(event.target.checked)} />连接点与法线</label><label title={proxiesReady ? '显示后端闭合源网格碰撞代理的实际三角线框。' : '取得装配结果及实际碰撞代理后可显示。'}><input type="checkbox" checked={showProxies} onChange={(event) => setShowProxies(event.target.checked)} disabled={!proxiesReady} />碰撞代理</label><label><input type="checkbox" checked={showPath} onChange={(event) => setShowPath(event.target.checked)} />连接轴与插入路径</label><label><input type="checkbox" checked={showZones} onChange={(event) => setShowZones(event.target.checked)} />合法插入区</label></div>
      {model ? <NativeAssemblyViewer placements={model.assembly.placements} assets={model.assets} debug={model.debug} showConnections={showConnections} showProxies={showProxies && proxiesReady} showPath={showPath} showZones={showZones} /> : <div className="assembly-source-previews">{[{ label: 'A · 固定零件原始坐标', detail: detailA }, { label: 'B · 待装配零件原始坐标', detail: detailB }].map(({ label, detail }) => <div key={label}><span>{label}</span>{detail?.geometry?.mesh ? <NativePartViewer mesh={detail.geometry.mesh} points={detail.connections?.points ?? []} showBounds={false} showConnections={showConnections} /> : <div className="assembly-source-empty"><Box size={24} /><span>等待真实源几何</span></div>}</div>)}</div>}
      <p className="assembly-view-note">展示颜色用于区分实例。装配前分别以原始坐标预览；橙色线框来自后端实际闭合碰撞代理。插入路径显示求解器给出的方向，具体验证范围以检查记录为准。</p>
      {response && <div className="assembly-result-info">
        {model?.assembly.id && ['generated', 'VALID'].includes(response.status ?? '') && <div className="assembly-export-buttons"><span>已通过当前规则与来源核验</span>{(['json', 'ldr', 'csv'] as const).map((format) => <button key={format} disabled={!!busy} onClick={() => void exportModel(format)}><ArrowDownToLine size={13} />{format === 'ldr' ? 'LDraw' : format === 'csv' ? 'BOM CSV' : '模型 JSON'}</button>)}</div>}
        {!!resultReasons.length && <div className="assembly-reasons"><strong>检查说明</strong><ul>{resultReasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul></div>}
        {!!proxyFailures.length && <div className="assembly-reasons"><strong>碰撞代理暂不可显示</strong><ul>{proxyFailures.map((reason, index) => <li key={index}>{reason}</li>)}</ul></div>}
        {resultTransform && <div className="assembly-transform"><h4>Part B 最终变换 · LDraw LDU</h4><div><span>平移</span><code>{resultTransform.translation.map((value) => Number(value.toFixed(4))).join(', ')}</code></div><div><span>旋转矩阵</span><pre>{[0, 1, 2].map((row) => resultTransform.rotation.slice(row * 3, row * 3 + 3).map((value) => Number(value.toFixed(4))).join('   ')).join('\n')}</pre></div></div>}
        <ResultData title="兼容规则与来源" value={response.compatibility} /><ResultData title="碰撞检查与局部合法插入区域" value={response.collision} /><ResultData title="插入路径与可视化调试数据" value={response.debug} />
        <ResultData title="真实生成运行记录" value={response.search} />
        {model && <ResultData title="实际碰撞代理的闭合性与来源" value={Object.entries(model.assets).map(([partId, asset]) => ({ partId, status: asset.collisionProxy?.status, reason: asset.collisionProxy?.reason, topology: asset.collisionProxy?.topology, evidence: asset.collisionProxy?.evidence }))} />}
        {model && <><ResultData title={`连接图 · ${model.assembly.edges?.length ?? 0} 条边`} value={model.assembly.edges} /><p className="assembly-versions">零件库 {model.assembly.partLibraryVersion ?? '未返回'} · 装配引擎 {model.assembly.assemblyEngineVersion ?? '未返回'} · 规则 {model.assembly.connectionRuleVersion ?? '未返回'} · 碰撞 {model.assembly.collisionVersion ?? '未返回'}</p></>}
      </div>}
      {!response && !!selectedPoints.filter(Boolean).length && <div className="assembly-selected-connections">{selectedPoints.map((point, index) => point && <p key={index}><strong>{index === 0 ? 'A' : 'B'} 来源连接</strong><span>{point.family} · {point.gender ?? '未指定'} · 位置 [{point.position.join(', ')}]</span>{point.source?.path && <small>{point.source.path}:{point.source.line}</small>}</p>)}</div>}
    </div>

    <section className="assembly-smoke-tests"><div className="part-section-heading"><Layers3 size={18} /><div><h2>真实基础结构生成</h2><p>只使用当前获得生成准入的零件与连接；信息不足时返回具体阻塞原因。</p></div></div><label className="assembly-field"><span>生成时包含的零件（可选）</span><select aria-label="生成时包含的零件" value={requiredPartId} disabled={!!busy || loading} onChange={event => setRequiredPartId(event.target.value)}><option value="">自动选件</option>{parts.filter(part => part.identitySystem === 'ldraw' && part.generatable).map(part => <option key={part.id} value={part.id}>{part.id} · {part.name}</option>)}</select></label><label className="assembly-field"><span>零件数量（可选，3–32）</span><input aria-label="生成零件数量" type="number" min="3" max="32" placeholder="按结构默认数量" value={generationPartCount} disabled={!!busy || loading} onChange={event => setGenerationPartCount(event.target.value)} /></label><div className="assembly-module-buttons">{modules.map((module) => <button key={module.id} onClick={() => void generate(module.id)} disabled={!!busy || loading}>{busy === module.id ? <LoaderCircle size={14} className="part-spin" /> : <Play size={13} />}{module.label}</button>)}</div></section>

    <section className="assembly-model-import"><div className="part-section-heading"><Upload size={18} /><div><h2>重新导入真实装配模型</h2><p>检查当前来源、规则版本、连接口与连接图。旧资格失效时返回 NEEDS_REVALIDATION。</p></div></div><form onSubmit={importModel}><label className="assembly-import-file"><span>已导出的模型 JSON（最多 5 MiB）</span><input type="file" accept="application/json,.json" aria-label="选择真实装配模型 JSON" disabled={!!busy} onChange={(event) => { setImportFile(event.target.files?.[0] ?? null); setImportResult(null); }} /></label><button className="assembly-secondary" type="submit" disabled={!importFile || !!busy}>{busy === 'import' ? <LoaderCircle size={13} className="part-spin" /> : <Upload size={13} />}验证导入模型</button></form>{importResult && <div className={`assembly-import-status ${importResult.status === 'VALID' ? 'passed' : 'blocked'}`} role="status"><strong>{importResult.status}</strong><p>{importResult.status === 'VALID' ? '已按当前来源与接口规则重新核验，可查看并导出。' : '模型依赖的来源、版本或接口资格需要重新验证；当前不可导出。'}</p>{importResult.reasons.length > 0 && <ul>{importResult.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>}</div>}</section>

    <section className="assembly-migration"><div className="part-section-heading"><Check size={18} /><div><h2>逐件迁移结果</h2><p>完整装配验证、部分接口可生成与队列处理完成分别记录。</p></div></div><div className="assembly-queue-filters"><input aria-label="搜索装配迁移零件" placeholder="按零件编号筛选" value={queueQuery} onChange={(event) => setQueueQuery(event.target.value)} /><select aria-label="筛选装配验证状态" value={queueFilter} onChange={(event) => setQueueFilter(event.target.value)}><option value="all">全部结果</option><option value="verified">有已验证接口</option><option value="full">fullyAssemblyVerified</option><option value="partial">partiallyGeneratable</option><option value="blocked">有阻塞原因</option><option value="astra">需要 Astra 审阅</option><option value="pending">存在 Pending 接口</option></select><span>{filteredQueue.length} 个零件</span></div><div className="part-table-wrap"><table className="part-table"><thead><tr><th>零件编号</th><th>零件资格</th><th>物理接口 PASS / 已发现</th><th>接口队列处理</th><th>生成准入</th><th>原因 / 当前范围</th></tr></thead><tbody>{displayedQueue.map((row) => <tr key={row.partId}><td className="part-mono">{row.partId}</td><td><span className={`assembly-result-badge ${row.assemblyVerified ? 'passed' : 'blocked'}`}>{partQualification(row)}</span></td><td>{row.interfaceCoverage ? `${row.interfaceCoverage.verifiedPass} / ${row.interfaceCoverage.physicalInterfacesDiscovered}` : '—'}{row.interfaceCoverage && <small className="assembly-interface-breakdown">BLOCKED {row.interfaceCoverage.verifiedBlocked} · Astra {row.interfaceCoverage.requiresAstraReview} · PENDING {row.interfaceCoverage.pending}</small>}</td><td>{(row.interfaceVerificationComplete ?? row.interfaceCoverage?.interfaceVerificationComplete) === true ? '已处理（含阻塞 / 待审）' : (row.interfaceVerificationComplete ?? row.interfaceCoverage?.interfaceVerificationComplete) === false ? '尚有待处理' : '—'}</td><td>{row.generatable ? '已开放' : '未开放'}</td><td>{row.reasons?.join('；') || (row.assemblyVerified ? '仅限已验证的连接与测试范围' : '等待后端具体原因')}</td></tr>)}{!displayedQueue.length && <tr><td colSpan={6}>{loading ? '正在读取逐件验证结果…' : '没有匹配的迁移记录。'}</td></tr>}</tbody></table></div>{filteredQueue.length > 20 && <button className="part-show-more" onClick={() => setQueueExpanded((value) => !value)}>{queueExpanded ? '收起结果' : `查看全部 ${filteredQueue.length} 个结果`}</button>}</section>
    <ResultData title="当前连接能力与限制" value={status?.capabilities} />
    {!!status?.limitations?.length && <div className="assembly-reasons"><strong>当前限制</strong><ul>{status.limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul></div>}
  </section>;
}
