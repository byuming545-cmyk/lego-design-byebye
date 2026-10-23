import { useEffect, useState } from 'react';
import { ArrowUpRight, BookOpen, Box, Check, CircleHelp, Database, FileText, Layers3, LoaderCircle, Search, ShieldCheck } from 'lucide-react';
import NativePartViewer, { type NativeConnectionPoint, type NativeMesh, type NativeVector } from '../components/NativePartViewer.js';
import './part-lab.css';

interface PartSummary {
  id: string;
  name?: string;
  status: string;
  geometryReady: boolean;
  connectionReady: boolean;
  collisionReady: boolean;
  generatable: boolean;
  verified: boolean;
  issues: string[];
  elementIds?: string[];
  identitySystem?: 'ldraw' | 'lego-element';
  elementId?: string | null;
  sourcePartId?: string | null;
  checks?: { id: string; outcome: string; description: string }[];
  evidence?: { sourceId?: string; documentId?: string; page?: number; pdfPage?: number; rawText?: string; reviewStatus?: string }[];
  selectionBasis?: string;
}
interface SourceFile {
  path: string;
  sha256?: string;
  sourceUrl?: string;
  license?: string;
  library?: string;
  revision?: string;
}
interface Source {
  library?: string;
  revision?: string;
  licenseStatus?: string;
  files?: SourceFile[];
}
interface PartDetail {
  part: PartSummary;
  geometry?: { mesh?: NativeMesh; bounds?: { min: NativeVector; max: NativeVector }; source?: Source; issues?: { code: string; message: string }[] } | null;
  connections?: { points: NativeConnectionPoint[]; source?: Source; sourceFiles?: SourceFile[]; license?: string; issues?: { code: string; message: string }[] } | null;
  tests?: { name: string; status: string; message?: string }[];
}
interface Instruction {
  fileName: string;
  setId?: string | null;
  pageCount?: number | null;
  status: string;
  inventoryPages?: number[];
  sha256?: string | null;
}
interface ReferenceSet {
  setId: string;
  name?: string | null;
  requestedName?: string;
  nameBasis?: string;
  status?: string;
  instructionCount?: number;
  inventoryComplete?: boolean;
  elementCount?: number;
  mappedPartCount?: number;
  notes?: string[] | string;
}
interface RankingItem {
  identity: { system: string; id: string };
  distinctSetCount: number;
  observedQuantity: number;
  knownNonSpareQuantity: number;
  spareUnknownQuantity: number;
}
interface FoundationStatus {
  counts: Record<string, number>;
  referenceSets: ReferenceSet[];
  instructions: Instruction[];
  limitations: string[];
  elementRanking?: RankingItem[];
  partRanking?: RankingItem[];
  mining?: { actualSetDenominator: number; observedSetNumbers: string[]; expectedSetDenominator: number | null };
}

const stageLabels: Record<string, string> = {
  catalogOnly: '仅目录', geometryReady: '几何已导入', connectionReady: '连接已导入', collisionReady: '碰撞数据就绪', generatable: '可用于生成', verified: '已验证', failed: '导入失败',
};
const instructionLabels: Record<string, string> = {
  imported: '已读取', read: '已读取', ready: '已读取', 'user-supplied': '用户提供', user_supplied: '用户提供', 'transfer-limit': '超过传输上限', transfer_limit: '超过传输上限', blocked: '访问受阻', missing: '待补充', pending: '待补充',
};

function errorMessage(value: unknown) { return value instanceof Error ? value.message : '请求失败，请检查服务后重试。'; }
function safeUrl(value?: string) {
  try { const url = new URL(value ?? ''); return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined; } catch { return undefined; }
}
async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/parts-foundation${path}`, { signal: signal ?? AbortSignal.timeout(120_000) });
  const result = await response.json().catch(() => ({ error: '服务响应无法读取。' }));
  if (!response.ok) throw new Error(result.error || '数据暂不可用，请重试。');
  return result as T;
}
function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return <div className="part-empty"><Box size={25} strokeWidth={1.4} /><strong>{title}</strong>{children && <p>{children}</p>}</div>;
}
function Badge({ children, ready = false }: { children: React.ReactNode; ready?: boolean }) {
  return <span className={`part-badge${ready ? ' ready' : ''}`}>{children}</span>;
}
function SourceList({ title, source, files = [] }: { title: string; source?: Source; files?: SourceFile[] }) {
  const entries = source?.files ?? files;
  return <section className="part-source-block">
    <h3>{title}</h3>
    {source?.library && <p>{source.library}{source.licenseStatus ? ` · ${source.licenseStatus}` : ''}</p>}
    {source?.revision && <p className="part-mono part-wrap">固定版本 {source.revision}</p>}
    {entries.length ? <details><summary>{entries.length} 个源文件与哈希</summary><ul>{entries.map((file) => <li key={`${file.sourceUrl ?? ''}:${file.path}:${file.sha256 ?? ''}`}>
      {safeUrl(file.sourceUrl) ? <a href={safeUrl(file.sourceUrl)} target="_blank" rel="noreferrer">{file.path}<ArrowUpRight size={12} /></a> : <span className="part-mono">{file.path}</span>}
      {file.license && <small>{file.license}</small>}
      {file.revision && <small className="part-mono part-wrap">版本 {file.revision}</small>}
      {file.sha256 && <small className="part-mono part-wrap">SHA-256 {file.sha256}</small>}
    </li>)}</ul></details> : <p className="part-muted">尚无可用来源记录。</p>}
  </section>;
}

export default function PartLab() {
  const [status, setStatus] = useState<FoundationStatus | null>(null);
  const [parts, setParts] = useState<PartSummary[]>([]);
  const [query, setQuery] = useState('');
  const [onlyGeneratable, setOnlyGeneratable] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<PartDetail | null>(null);
  const [statusError, setStatusError] = useState('');
  const [listError, setListError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [listLoading, setListLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showBounds, setShowBounds] = useState(false);
  const [showConnections, setShowConnections] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [tab, setTab] = useState<'parts' | 'references'>('parts');

  useEffect(() => {
    const controller = new AbortController();
    setStatusError('');
    void get<FoundationStatus>('/status', controller.signal).then(setStatus).catch((error) => { if (!controller.signal.aborted) setStatusError(errorMessage(error)); });
    return () => controller.abort();
  }, [refresh]);

  useEffect(() => {
    const controller = new AbortController();
    setListLoading(true);
    setListError('');
    const timer = window.setTimeout(() => {
      void get<{ parts: PartSummary[] }>(`/parts?query=${encodeURIComponent(query.trim())}`, controller.signal).then((result) => {
        if (controller.signal.aborted) return;
        setParts(result.parts);
        const visible = onlyGeneratable ? result.parts.filter((part) => part.generatable) : result.parts;
        setSelectedId((current) => visible.some((part) => part.id === current) ? current : (visible.find((part) => part.geometryReady)?.id ?? visible[0]?.id ?? ''));
      }).catch((error) => { if (!controller.signal.aborted) { setParts([]); setSelectedId(''); setListError(errorMessage(error)); } }).finally(() => { if (!controller.signal.aborted) setListLoading(false); });
    }, query ? 250 : 0);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [query, onlyGeneratable, refresh]);

  useEffect(() => {
    setDetail(null);
    setDetailError('');
    if (!selectedId) { setDetailLoading(false); return; }
    const controller = new AbortController();
    setDetailLoading(true);
    void get<PartDetail>(`/parts/${encodeURIComponent(selectedId)}`, controller.signal).then((result) => { if (!controller.signal.aborted) setDetail(result); }).catch((error) => { if (!controller.signal.aborted) setDetailError(errorMessage(error)); }).finally(() => { if (!controller.signal.aborted) setDetailLoading(false); });
    return () => controller.abort();
  }, [selectedId, refresh]);

  const visibleParts = onlyGeneratable ? parts.filter((part) => part.generatable) : parts;
  const points = detail?.connections?.points ?? [];
  const connectionSource: Source | undefined = detail?.connections?.source ?? (detail?.connections ? { library: 'LDCad Shadow Library / LDraw', licenseStatus: detail.connections.license, files: detail.connections.sourceFiles } : undefined);
  const observationEvidence = detail?.part.evidence?.filter((item) => item.sourceId || item.documentId) ?? [];
  const bounds = detail?.geometry?.bounds;
  const dimensions = bounds ? bounds.max.map((value, axis) => value - bounds.min[axis]) : null;
  const checks = detail ? [
    { name: '真实几何', ready: detail.part.geometryReady },
    { name: '来源连接', ready: detail.part.connectionReady },
    { name: '碰撞数据', ready: detail.part.collisionReady },
    { name: '生成准入', ready: detail.part.generatable },
    { name: '完整验证', ready: detail.part.verified },
  ] : [];

  return <main className="part-lab">
    <section className="part-intro">
      <div><div className="eyebrow"><span /> PART LAB · REAL PARTS FOUNDATION</div><h1>从真实零件，开始拼搭。</h1><p>逐项查看说明书证据、原生几何和连接来源，让每个进入生成器的零件都有依据。</p></div>
      <span className="part-intro-seal"><Database size={21} /><span>真实资料库<small>来源可追溯 · 分阶段验证</small></span></span>
    </section>

    {statusError && <div className="part-alert" role="alert"><CircleHelp size={16} /><span>{statusError}</span><button onClick={() => setRefresh((value) => value + 1)}>重新加载</button></div>}

    <div className="part-counts" aria-label="零件可信状态统计">
      {[
        ['catalogOnly', '仅目录'], ['geometryReady', '已有真实几何'], ['connectionReady', '已有来源连接'], ['collisionReady', '已有碰撞数据'], ['generatable', '允许用于生成'], ['verified', '完成验证'],
      ].map(([key, label]) => <div key={key}><strong>{status ? (status.counts[key] ?? 0) : '—'}</strong><span>{label}</span></div>)}
    </div>
    <p className="part-count-basis">状态统计可重叠。LDraw 编号与 Element ID 分开登记，数量相加不代表真实设计零件总数。</p>
    <div className="part-context-note"><ShieldCheck size={16} /><p>说明书中的 Element ID 用于识别具体零件与颜色组合；它与 Design ID、LDraw 编号需要逐项映射。已有网格或连接数据，也不表示已完成装配验证。</p></div>

    <div className="part-tabs" role="tablist" aria-label="零件工作台视图">
      <button role="tab" aria-selected={tab === 'parts'} onClick={() => setTab('parts')}><Box size={16} />零件检查</button>
      <button role="tab" aria-selected={tab === 'references'} onClick={() => setTab('references')}><BookOpen size={16} />说明书与套装</button>
      <button className="part-refresh" onClick={() => setRefresh((value) => value + 1)}>刷新资料</button>
    </div>

    {tab === 'parts' ? <section className="part-workspace" aria-label="零件检查">
      <aside className="part-browser">
        <label className="part-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索零件、Design / Element ID" aria-label="搜索真实零件" /></label>
        <label className="part-filter"><input type="checkbox" checked={onlyGeneratable} onChange={(event) => setOnlyGeneratable(event.target.checked)} />只看允许用于生成的零件</label>
        <div className="part-list-caption"><span>{listLoading ? '正在检索…' : `${visibleParts.length} 个条目`}</span><span>按来源检查</span></div>
        {listLoading ? <div className="part-loading" role="status"><LoaderCircle size={20} className="part-spin" />加载零件目录</div> : listError ? <div className="part-list-error" role="alert">{listError}<button onClick={() => setRefresh((value) => value + 1)}>重试</button></div> : visibleParts.length ? <div className="part-list">{visibleParts.map((part) => <button key={part.id} aria-pressed={selectedId === part.id} onClick={() => setSelectedId(part.id)}>
          <span className="part-list-icon"><Box size={20} strokeWidth={1.4} /></span><span className="part-list-text"><strong>{part.id}</strong><small>{part.name || '名称待核对'}</small><Badge ready={part.generatable}>{stageLabels[part.status] ?? part.status}</Badge></span>
        </button>)}</div> : <Empty title={onlyGeneratable ? '暂无通过生成准入的零件' : '没有匹配的零件'}>{onlyGeneratable ? '完成真实来源与装配验证后，零件才会出现在这里。' : '尝试完整编号；尚未完成编号映射的 Element ID 会保留在说明书清单中。'}</Empty>}
      </aside>

      <div className="part-detail" aria-busy={detailLoading}>
        {detailLoading ? <div className="part-loading"><LoaderCircle size={22} className="part-spin" />读取原生网格与来源</div> : detailError ? <div className="part-list-error" role="alert">{detailError}<button onClick={() => setRefresh((value) => value + 1)}>重试</button></div> : !detail ? <Empty title="选择一个零件查看依据">可检查真实几何、连接位置和进入生成器所需的验证条件。</Empty> : <>
          <div className="part-detail-heading"><div><span className="part-overline">{detail.part.identitySystem === 'lego-element' ? 'LEGO Element ID' : 'LDraw ID'} · {detail.part.elementId ?? detail.part.id}</span><h2>{detail.part.name || `零件 ${detail.part.id}`}</h2></div><Badge ready={detail.part.generatable}>{stageLabels[detail.part.status] ?? detail.part.status}</Badge></div>
          <div className="part-stage-controls"><label><input type="checkbox" checked={showBounds} onChange={(event) => setShowBounds(event.target.checked)} />显示网格包围盒</label><label><input type="checkbox" checked={showConnections} onChange={(event) => setShowConnections(event.target.checked)} />显示来源连接点</label></div>
          {detail.geometry?.mesh ? <NativePartViewer mesh={detail.geometry.mesh} points={points} showBounds={showBounds} showConnections={showConnections} /> : <div className="part-missing-mesh"><Empty title="暂无经过来源确认的原生几何">该条目保留在目录中，等待真实几何文件和编号映射。</Empty></div>}
          <div className="part-view-legend"><span>网格采用统一展示色，实际颜色以清单为准</span><span><i className="male" />公连接<i className="female" />母连接<i className="other" />其他 / 未分类</span></div>
          <div className="part-checks">{checks.map((check) => <div key={check.name} className={check.ready ? 'ready' : ''}>{check.ready ? <Check size={15} /> : <span className="part-check-dot" />}<span>{check.name}</span><small>{check.ready ? '已就绪' : '待完成'}</small></div>)}</div>
          <div className="part-metrics"><div><span>网格三角形</span><strong>{detail.geometry?.mesh ? Math.floor(detail.geometry.mesh.indices.length / 3).toLocaleString() : '—'}</strong></div><div><span>来源连接点</span><strong>{points.length}</strong></div><div><span>网格尺寸 X × Y × Z</span><strong>{dimensions ? dimensions.map((value) => Number(value.toFixed(2))).join(' × ') : '—'}{dimensions && <small> LDU</small>}</strong></div></div>
          <p className="part-proxy-note">包围盒根据真实网格计算，用于保守碰撞检查；它不能证明空腔、孔洞或轮轴已经正确配合。</p>
          {!!detail.part.elementIds?.length && <p className="part-mapped-elements">已确认 Element ID：{detail.part.elementIds.join('、')}</p>}
          {!!observationEvidence.length && <section className="part-observation-evidence"><h3>说明书观测证据</h3><p>保留原始文字与 PDF 页码，编号映射和实际颜色另行核对。</p><div className="part-table-wrap"><table className="part-table"><thead><tr><th>文件</th><th>PDF 页码</th><th>原始标签</th><th>复核范围</th></tr></thead><tbody>{observationEvidence.map((evidence, index) => <tr key={index}><td>{evidence.sourceId ?? evidence.documentId}.pdf</td><td>{evidence.page ?? evidence.pdfPage ?? '—'}</td><td className="part-mono">{evidence.rawText ?? '—'}</td><td>{evidence.reviewStatus === 'visual-spot-checked' ? '图像抽查' : '文本层抽取'}</td></tr>)}</tbody></table></div></section>}
          {!!detail.part.issues.length && <div className="part-issues"><h3><CircleHelp size={15} />尚待完成</h3><ul>{detail.part.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul></div>}
          {!!detail.part.checks?.length && <section className="part-tests"><h3>验证记录</h3>{detail.part.checks.map((test) => <div key={test.id}><span>{test.id}</span><Badge ready={test.outcome === 'passed'}>{test.outcome === 'passed' ? '通过' : test.outcome === 'failed' ? '未通过' : test.outcome === 'not-applicable' ? '不适用' : '未执行'}</Badge><small>{test.description}</small></div>)}</section>}
          {!!points.length && <details className="part-connection-records"><summary>查看 {points.length} 个来源连接点</summary><p>连接方向与位置来自源指令；展示不构成配合成功的证明。</p><div className="part-table-wrap"><table className="part-table"><thead><tr><th>源类型</th><th>性别</th><th>位置 LDU</th><th>来源行</th></tr></thead><tbody>{points.slice(0, 100).map((point, index) => <tr key={point.id ?? index}><td>{point.family ?? point.type ?? '未分类'}</td><td>{point.gender === 'M' ? '公' : point.gender === 'F' ? '母' : '未指定'}</td><td className="part-mono">{point.position.map((value) => Number(value.toFixed(2))).join(', ')}</td><td><span title={point.source?.raw}>{point.source?.path ?? '—'}{point.source?.line ? `:${point.source.line}` : ''}</span></td></tr>)}</tbody></table></div>{points.length > 100 && <p>表格显示前 100 个连接点；三维视图保留全部点。</p>}</details>}
          <div className="part-sources"><SourceList title="原生几何来源" source={detail.geometry?.source} /><SourceList title="连接数据来源" source={connectionSource} /></div>
        </>}
      </div>
    </section> : <section className="part-reference-view" aria-label="说明书与套装">
      <div className="part-section-heading"><BookOpen size={19} /><div><h2>套装资料覆盖</h2><p>同一套装的不同册合并统计；缺册、缺零件表或未映射的编号会保留为待补充。</p></div></div>
      {status?.referenceSets.length ? <div className="part-reference-grid">{status.referenceSets.map((set) => <article key={set.setId} className="part-reference-card"><div><span className="part-mono">{set.setId}</span><Badge ready={set.inventoryComplete}>{set.inventoryComplete ? '清单完整' : '资料待补全'}</Badge></div><h3>{set.name || set.requestedName || '名称待核对'}</h3>{(!set.name || set.nameBasis?.includes('user-requested')) && set.requestedName && <small className="part-muted">需求中的名称，官方名称待核对</small>}<dl><div><dt>已读取说明书</dt><dd>{set.instructionCount ?? 0} 册</dd></div><div><dt>清单 Element ID</dt><dd>{set.elementCount ?? 0}</dd></div><div><dt>已映射零件编号</dt><dd>{set.mappedPartCount ?? 0}</dd></div></dl>{(typeof set.notes === 'string' ? [set.notes] : set.notes)?.map((note, index) => <p key={index} className="part-reference-note">{note}</p>)}</article>)}</div> : <Empty title="套装资料尚未加载">资料会在实际读取、核对后加入。</Empty>}
      <div className="part-section-heading"><FileText size={19} /><div><h2>说明书来源</h2><p>记录文件哈希、PDF 页码和读取结果；原始说明书保持为本地参考资料。</p></div></div>
      {status?.instructions.length ? <div className="part-table-wrap"><table className="part-table"><thead><tr><th>文件</th><th>套装</th><th>页数</th><th>零件表 PDF 页码</th><th>状态</th></tr></thead><tbody>{status.instructions.map((instruction) => <tr key={instruction.fileName}><td><strong>{instruction.fileName}</strong>{instruction.sha256 && <details><summary>SHA-256</summary><span className="part-mono part-wrap">{instruction.sha256}</span></details>}</td><td>{instruction.setId || '待读取'}</td><td>{instruction.pageCount ?? '—'}</td><td>{instruction.inventoryPages?.join('、') || '未确认 / 本册无表'}</td><td><Badge ready={['imported', 'read', 'ready'].includes(instruction.status)}>{instructionLabels[instruction.status] ?? instruction.status}</Badge></td></tr>)}</tbody></table></div> : <Empty title="暂无已登记的说明书" />}
      <div className="part-section-heading"><Layers3 size={19} /><div><h2>基于真实清单的零件频次</h2><p>Element ID 与 Design / LDraw 编号分别统计。未确认备件属性的数量仅表示说明书观察数量。</p></div></div>
      <div className="part-ranking-columns"><Ranking title="观测 Element ID" items={status?.elementRanking ?? []} kind="element" setCount={status?.mining?.actualSetDenominator} /><Ranking title="已确认编号映射的零件" items={status?.partRanking ?? []} kind="part" setCount={status?.mining?.actualSetDenominator} /></div>
    </section>}

    <section className="part-limitations"><h2><CircleHelp size={16} />当前资料与验证范围</h2><p>这里整理的是可追溯的资料和零件数据。PDF 的拼搭步骤可用于人工观察与核对，目前不自动还原整车三维模型，也不代表已经训练了生成模型。</p>{status?.limitations.length ? <ul>{status.limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul> : null}</section>
  </main>;
}

function Ranking({ title, items, kind, setCount }: { title: string; items: RankingItem[]; kind: 'element' | 'part'; setCount?: number }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? items : items.slice(0, 15);
  return <section className="part-ranking"><h3>{title}</h3>{items.length ? <><div className="part-table-wrap"><table className="part-table"><thead><tr><th>编号</th><th>出现套装数{setCount != null ? ` / ${setCount}` : ''}</th><th>观察数量</th></tr></thead><tbody>{shown.map((item) => <tr key={`${item.identity.system}:${item.identity.id}`}><td className="part-mono">{item.identity.id}{kind === 'part' && <small className="part-ranking-system">{item.identity.system}</small>}</td><td>{item.distinctSetCount}</td><td>{item.observedQuantity}</td></tr>)}</tbody></table></div>{items.length > 15 && <button className="part-show-more" onClick={() => setExpanded((value) => !value)}>{expanded ? '收起' : `查看全部 ${items.length} 条`}</button>}</> : <Empty title={kind === 'part' ? '暂无完成来源映射的排名' : '暂无可统计的真实清单'}>{kind === 'part' ? '不会把 Element ID 直接当作零件设计编号。' : '读取真实清单后才会计算频次。'}</Empty>}</section>;
}
