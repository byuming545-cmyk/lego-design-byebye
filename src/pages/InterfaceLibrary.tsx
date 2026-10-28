import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, BookOpen, Box, Boxes, CircleAlert, GitCompareArrows, Layers3, LoaderCircle, MessageSquare, RefreshCw, Search, ShieldQuestion, Wrench } from 'lucide-react';
import NativePartViewer, { type NativeConnectionPoint, type NativeMesh } from '../components/NativePartViewer';
import NativeAssemblyViewer, { type AssemblyAsset, type AssemblyPlacement } from '../components/NativeAssemblyViewer';
import AssemblyCasePlayer from '../components/AssemblyCasePlayer';
import AssemblyStudio from '../components/AssemblyStudio';
import type { ConnectionCaseDetail } from '../parts/library/types.js';
import './interface-library.css';

const API = '/api/interface-library';
const PARTS_API = '/api/parts-foundation';
const feedbackKinds = [
  ['reasonable', '看起来合理'],
  ['position-direction-wrong', '位置/方向可能不对'],
  ['interface-identification-wrong', '接口识别可能不对'],
  ['should-not-mate', '这两个零件不应这样拼接'],
  ['insufficient-evidence', '证据不足'],
] as const;
const feedbackStatuses = ['open', 'triaged', 'needs-evidence', 'accepted-for-review', 'rejected', 'resolved'] as const;
type FeedbackKind = typeof feedbackKinds[number][0];
type FeedbackStatus = typeof feedbackStatuses[number];

interface Counts { parts: number; interfaces: number; types: number; rules: number; productionRules: number; productionInterfaces: number; sourceReadyInterfaces: number; partialInterfaces: number; unresolvedInterfaces: number; cases: number; validatedCases: number; blockedCases: number; openFeedback: number }
interface Versions { schema: string; grammar: string; admission: string; partLibrary: string; assemblyEngine: string; connectionRule: string; collision: string }
interface TypeRow { id: string; label: string; description: string; rules: string[]; productionRules: string[]; instanceCount: number; partCount: number; complete: number; partial: number; unresolved: number; status: string; notes: string[] }
interface RuleRow { id: string; label: string; description: string; maleFamilies: string[]; femaleFamilies: string[]; evidenceRequired: string; nativeRuleId: string | null; production: boolean; status: string; instanceCount: number; partCount: number; caseIds: string[]; conditions: string[]; missingEvidence: string[]; negativeControls: string[]; docs: string[]; openFeedback?: number; reviewState?: 'clear' | 'review-required' }
interface CaseSummary { id: string; label: string; ruleId: string; status: 'validated' | 'blocked' | 'unknown'; fixedPartId: string; movingPartId: string; summary: string; caseType: string; sourceDeclared: boolean; physicalBuildVerified: false }
interface Overview { versions: Versions; counts: Counts; types: TypeRow[]; rules: RuleRow[]; recentCases: CaseSummary[]; limitations: string[]; generatedAt: string }
interface SourceFile { library: string; path: string; revision: string; sha256: string; license: string; sourceUrl: string; line?: number; raw?: string }
interface InterfaceRow {
  id: string; partId: string; partName: string; featureId: string; sourceConnectionId: string | null; family: string; role: string; profile: string; coverage: string;
  status: string; supported: boolean; enabled: boolean; nativeRuleIds: string[]; sourcePath: string | null; sourceLine: number | null; sourceRaw: string | null;
  sourceSha256: string | null; position: number[]; axis: number[]; dimensions: { radiusLdu: number | null; lengthLdu: number | null; widthLdu: number | null; heightLdu: number | null };
  insertionRangeLdu: number[] | null; slideAllowed: boolean | null; rotationAllowed: boolean | null; unknownFields: string[]; diagnostics: { code: string; message: string }[]; issue: string | null;
}
interface InterfaceDetail extends InterfaceRow {
  part: { id: string; name: string; generationEligible: boolean; connectable: boolean; collisionGeometryReady: boolean; sourceReady: boolean; reasons: string[]; allowedConnectionIds: string[]; ruleIds: string[] };
  relatedRules: RuleRow[]; sourceFiles: SourceFile[]; rawPoints: NativeConnectionPoint[]; issues: string[]; feedback: Feedback[];
}
interface RuleDetail extends RuleRow { cases: CaseSummary[]; examples: InterfaceRow[]; sources: string[]; jointTypes: string[] }
interface CaseDetail extends CaseSummary {
  fixed: InterfaceRow; moving: InterfaceRow; edge: { ruleId: string; ruleVersion: string; axis: number[]; anchor: number[]; insertionDepthLdu: number; twistDeg: number } | null;
  placements: { instanceId: string; partId: string; transform: { rotation: number[]; translation: number[] } }[]; allowedTwistsDeg: number[]; jointTypes: string[];
  validation: { engineAccepted: boolean; graphValid: boolean; importStatus: string; collisionStatus: string; reasons: string[]; rejectionCodes: string[]; installationPath: string; physicalBuildVerified: false };
  modelMeta: { bom: { partId: string; name: string; quantity: number }[]; steps: number; sources: number; exportBytes: number | null; contentSha256: string | null } | null;
  displayNotice: string; versions: Versions; feedback: Feedback[];
}
interface Feedback { id: string; createdAt: string; updatedAt: string; kind: FeedbackKind; status: FeedbackStatus; target: { kind: string; id: string; partId?: string; featureId?: string; ruleId?: string; caseId?: string }; message: string; author: string; view: string; attachment: { kind: string; url?: string; note: string }; evidence: { interfaceStatus: string | null; ruleId: string | null; ruleVersion: string | null; grammarVersion: string; partLibraryVersion: string; collisionVersion: string; sourceDigest: string | null; conclusion: string; sourceIds: string[] }; handling: { status: FeedbackStatus; note: string; updatedAt: string; reviewer: string | null; history: { at: string; status: FeedbackStatus; note: string; reviewer: string | null }[] }; softwareConclusion: string; humanObservation: true; canAuthorizeRule: false }
interface ReviewItem { id: string; category: string; severity: string; title: string; detail: string; partId: string | null; featureId: string | null; ruleId: string | null; caseId: string | null; code: string; openFeedback: number }
interface ComparisonCandidate { interfaceId: string; featureId: string; family: string; role: string; classification: 'exact' | 'candidate' | 'conflict' | 'insufficient'; matchedRuleIds: string[]; reasons: string[]; failedConditions: string[]; sourceIds: string[]; counterpart: { partId: string; featureId: string; sourceConnectionId: string | null; family: string; role: string; compatibility: string | null; solver: string | null; collision: string | null } | null; formalAssembly: { status: string; reasons: string[]; modelId: string | null } | null }
interface Comparison { partId: string; partName: string; targetPartId: string | null; recognition: { interfaces: number; exact: number; candidate: number; conflict: number; insufficient: number; typeRecognition: string; ruleMatch: string; assemblyPass: string; generationAdmission: false }; candidates: ComparisonCandidate[]; limitations: string[]; versions: Versions }
interface PartPayload { geometry: { mesh: NativeMesh }; connections: { points: NativeConnectionPoint[] } }

async function get<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { accept: 'application/json' } });
  const body = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(body.error ?? `请求失败 (${response.status})`);
  return body as T;
}
const pct = (value: number, total: number) => total ? `${Math.round(value / total * 100)}%` : '0%';
const shortSource = (value: string | null | undefined) => value ? value.replace(/^https?:\/\/[^ ]+\/(?=(?:parts|p)\/)/, '') : '无';
const caseTone = (status: string) => status === 'validated' ? 'ok' : status === 'blocked' ? 'bad' : 'warn';
const statusLabel = (status: string) => ({ production: '生产', 'source-ready': '来源就绪', partial: '部分', unresolved: '未解决', conditional: '条件规则', 'source-declared': '来源声明', 'specification-only': '仅规格', validated: '已验证', blocked: '已阻止', unknown: '未知' } as Record<string, string>)[status] ?? status;

export default function InterfaceLibrary() {
  const [tab, setTab] = useState<'overview' | 'interfaces' | 'rules' | 'cases' | 'studio' | 'compare' | 'review'>('overview');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [interfaces, setInterfaces] = useState<{ total: number; instances: InterfaceRow[] }>({ total: 0, instances: [] });
  const [filters, setFilters] = useState({ family: '', status: '', coverage: '', q: '' });
  const [selectedInterface, setSelectedInterface] = useState<InterfaceRow | null>(null);
  const [interfaceDetail, setInterfaceDetail] = useState<InterfaceDetail | null>(null);
  const [partPayload, setPartPayload] = useState<PartPayload | null>(null);
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [selectedRule, setSelectedRule] = useState<RuleDetail | null>(null);
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [selectedCase, setSelectedCase] = useState<CaseDetail | null>(null);
  const [casePhase, setCasePhase] = useState<'before' | 'aligned' | 'seated'>('seated');
  const [studioCaseId, setStudioCaseId] = useState<string | null>(null);
  const [caseAssets, setCaseAssets] = useState<Record<string, AssemblyAsset>>({});
  const caseDisplayPlacements = useMemo(() => {
    if (!selectedCase?.edge || casePhase === 'seated') return (selectedCase?.placements ?? []) as AssemblyPlacement[];
    const distance = selectedCase.edge.insertionDepthLdu * (casePhase === 'aligned' ? 1 : 1.8);
    return selectedCase.placements.map(placement => placement.partId !== selectedCase.moving.partId ? placement : ({ ...placement, transform: { ...placement.transform, translation: placement.transform.translation.map((value, index) => value + selectedCase.edge!.axis[index] * distance) } })) as AssemblyPlacement[];
  }, [selectedCase, casePhase]);
  const casePlayerParts = useMemo(() => {
    if (!selectedCase) return null;
    const fixedAsset = caseAssets[selectedCase.fixedPartId], movingAsset = caseAssets[selectedCase.movingPartId];
    if (!fixedAsset || !movingAsset) return null;
    return { fixed: { mesh: fixedAsset.mesh, points: fixedAsset.connections ?? [] }, moving: { mesh: movingAsset.mesh, points: movingAsset.connections ?? [] } };
  }, [selectedCase, caseAssets]);
  const [queue, setQueue] = useState<ReviewItem[]>([]);
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [feedbackTarget, setFeedbackTarget] = useState<{ kind: 'interface' | 'rule' | 'case'; id: string; partId?: string; featureId?: string; ruleId?: string; caseId?: string } | null>(null);
  const [feedbackKind, setFeedbackKind] = useState<FeedbackKind>('reasonable');
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const [feedbackAuthor, setFeedbackAuthor] = useState('local-reviewer');
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [comparePart, setComparePart] = useState('30374');
  const [compareTarget, setCompareTarget] = useState('');
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [compareBusy, setCompareBusy] = useState(false);
  const [focusSection, setFocusSection] = useState(false);
  const [transparent, setTransparent] = useState(false);
  const [focusInterface, setFocusInterface] = useState(true);

  const families = useMemo(() => overview?.types.map(type => type.id) ?? [], [overview]);

  const refreshOverview = useCallback(async () => {
    const [data, ruleRows, caseRows, queueRows, feedbackRows] = await Promise.all([
      get<Overview>(`${API}/overview`), get<RuleRow[]>(`${API}/rules`), get<CaseSummary[]>(`${API}/cases`), get<ReviewItem[]>(`${API}/queue`), get<Feedback[]>(`${API}/feedback`),
    ]);
    setOverview(data); setRules(ruleRows); setCases(caseRows); setQueue(queueRows); setFeedback(feedbackRows);
  }, []);
  useEffect(() => { refreshOverview().catch(reason => setError(reason instanceof Error ? reason.message : '接口库读取失败。')).finally(() => setLoading(false)); }, [refreshOverview]);

  const loadInterfaces = useCallback(async () => {
    const query = new URLSearchParams({ limit: '80' });
    if (filters.family) query.set('family', filters.family);
    if (filters.status) query.set('status', filters.status);
    if (filters.coverage) query.set('coverage', filters.coverage);
    if (filters.q) query.set('q', filters.q);
    setInterfaces(await get(`${API}/interfaces?${query.toString()}`));
  }, [filters]);
  useEffect(() => { if (tab === 'interfaces' || tab === 'overview') loadInterfaces().catch(reason => setError(reason instanceof Error ? reason.message : '接口列表读取失败。')); }, [tab, loadInterfaces]);

  const openInterface = async (row: InterfaceRow) => {
    setSelectedInterface(row); setInterfaceDetail(null); setPartPayload(null); setError('');
    try {
      const [detail, payload] = await Promise.all([get<InterfaceDetail>(`${API}/interface?partId=${encodeURIComponent(row.partId)}&featureId=${encodeURIComponent(row.featureId)}`), get<PartPayload>(`${PARTS_API}/parts/${encodeURIComponent(row.partId)}`)]);
      setInterfaceDetail(detail); setPartPayload(payload);
      setFeedbackTarget({ kind: 'interface', id: row.id, partId: row.partId, featureId: row.featureId });
    } catch (reason) { setError(reason instanceof Error ? reason.message : '接口详情读取失败。'); }
  };
  const openRule = async (id: string) => {
    setError(''); setTab('rules'); setFeedbackTarget({ kind: 'rule', id, ruleId: id });
    try { setSelectedRule(await get<RuleDetail>(`${API}/rule?id=${encodeURIComponent(id)}`)); } catch (reason) { setError(reason instanceof Error ? reason.message : '规则详情读取失败。'); }
  };
  const openCase = async (id: string) => {
    setError(''); setTab('cases');
    try {
      const value = await get<CaseDetail>(`${API}/case?id=${encodeURIComponent(id)}`); setSelectedCase(value); setFeedbackTarget({ kind: 'case', id: value.id, caseId: value.id, ruleId: value.ruleId });
      const parts = [...new Set([value.fixedPartId, value.movingPartId])];
      const assets: Record<string, AssemblyAsset> = {};
      await Promise.all(parts.map(async partId => {
        try { const payload = await get<PartPayload>(`${PARTS_API}/parts/${encodeURIComponent(partId)}`); assets[partId] = { mesh: payload.geometry.mesh, connections: payload.connections.points }; } catch { /* keep the textual case if a mesh is unavailable */ }
      }));
      setCaseAssets(assets);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '案例详情读取失败。'); }
  };
  const submitFeedback = async () => {
    if (!feedbackTarget || !feedbackMessage.trim()) { setError('请选择反馈目标并填写说明。'); return; }
    setFeedbackBusy(true); setError('');
    try {
      await fetch(`${API}/feedback`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: feedbackKind, message: feedbackMessage, author: feedbackAuthor, view: tab, target: feedbackTarget }) });
      const response = await get<Feedback[]>(`${API}/feedback?targetId=${encodeURIComponent(feedbackTarget.id)}`);
      setFeedback(previous => [...response, ...previous.filter(item => item.id !== response[0]?.id)]);
      setFeedbackMessage(''); await refreshOverview();
      if (selectedInterface) await openInterface(selectedInterface);
      if (selectedRule) setSelectedRule(await get<RuleDetail>(`${API}/rule?id=${encodeURIComponent(selectedRule.id)}`));
      if (selectedCase) setSelectedCase(await get<CaseDetail>(`${API}/case?id=${encodeURIComponent(selectedCase.id)}`));
    } catch (reason) { setError(reason instanceof Error ? reason.message : '反馈保存失败。'); }
    finally { setFeedbackBusy(false); }
  };
  const patchFeedback = async (record: Feedback, status: FeedbackStatus) => {
    try { await fetch(`${API}/feedback/${encodeURIComponent(record.id)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status, note: `界面复核标记：${statusLabel(status)}`, reviewer: feedbackAuthor }) }); await refreshOverview(); if (selectedCase) setSelectedCase(await get<CaseDetail>(`${API}/case?id=${encodeURIComponent(selectedCase.id)}`)); if (selectedInterface) await openInterface(selectedInterface); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '反馈处理保存失败。'); }
  };
  const runComparison = async () => {
    setCompareBusy(true); setError(''); setComparison(null);
    try { const response = await fetch(`${API}/compare`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ partId: comparePart.trim(), ...(compareTarget.trim() ? { targetPartId: compareTarget.trim() } : {}) }) }); const body = await response.json() as Comparison | { error?: string }; if (!response.ok) throw new Error((body as { error?: string }).error ?? '比较失败'); setComparison(body as Comparison); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '比较失败。'); }
    finally { setCompareBusy(false); }
  };

  const json = useMemo(() => overview ? JSON.stringify({ versions: overview.versions, counts: overview.counts }, null, 2) : '', [overview]);
  if (loading && !overview) return <main className="interface-library"><div className="il-loading"><LoaderCircle className="spin" /> 正在读取真实来源、规则与案例…</div></main>;

  return <main className="interface-library">
    <header className="il-header">
      <div>
        <div className="eyebrow">REAL INTERFACES · SOURCE-BOUND ASSEMBLY</div>
        <h1>接口与拼接库</h1>
        <p>把真实接口实例、来源参数、正式规则、装配案例和人工复核放在同一处。接口名称只用于组织；能否配合由来源、规则和正式引擎决定。</p>
      </div>
      <div className="il-badges"><span className="il-badge">{overview?.counts.parts ?? 0} 零件</span><span className="il-badge">{overview?.counts.interfaces ?? 0} 接口实例</span><span className="il-badge">{overview?.counts.productionRules ?? 0} 生产规则</span><span className="il-badge weak">无实物验证</span></div>
    </header>
    {error && <div className="il-error"><CircleAlert size={18} /> {error}<button type="button" onClick={() => setError('')}>关闭</button></div>}
    <nav className="il-tabs" aria-label="接口库视图">
      {([['overview', '概览', Layers3], ['interfaces', '接口', Boxes], ['rules', '规则', Wrench], ['cases', '看示范', BookOpen], ['studio', '我来拼搭', Box], ['compare', '新零件对比', GitCompareArrows], ['review', '检查结果', ShieldQuestion]] as const).map(([id, label, Icon]) => <button key={id} type="button" className={tab === id ? 'active' : ''} onClick={() => setTab(id)}><Icon size={16} />{label}</button>)}
      <button type="button" className="il-refresh" onClick={() => refreshOverview().catch(reason => setError(reason instanceof Error ? reason.message : '刷新失败。'))}><RefreshCw size={15} />刷新</button>
    </nav>

    {tab === 'overview' && overview && <section className="il-section">
      <div className="il-counts">
        {[['接口实例', overview.counts.interfaces, `${overview.counts.productionInterfaces} 生产 / ${overview.counts.sourceReadyInterfaces} 来源就绪 / ${overview.counts.partialInterfaces} 部分`], ['规则', overview.counts.rules, `${overview.counts.productionRules} 条进入正式生产图`], ['案例', overview.counts.cases, `${overview.counts.validatedCases} 已通过 / ${overview.counts.blockedCases} 真实阻止`], ['人工反馈', overview.counts.openFeedback, '只进入复核，不自动授权']].map(([label, value, hint]) => <div className="il-stat" key={String(label)}><span>{label}</span><strong>{String(value)}</strong><small>{hint}</small></div>)}
      </div>
      <div className="il-overview-grid">
        <div>
          <h2><Boxes size={19} />接口类型</h2>
          <div className="il-type-grid">{overview.types.map(type => <button type="button" className="il-type-card" key={type.id} onClick={() => { setFilters({ family: type.id, status: '', coverage: '', q: '' }); setTab('interfaces'); }}><div><strong>{type.label}</strong><span>{type.id}</span></div><p>{type.description}</p><div className="il-meter"><i style={{ width: pct(type.complete, type.instanceCount) }} /></div><small>{type.instanceCount} 实例 · {type.partCount} 零件 · {type.productionRules.join(' / ') || '无生产规则'}</small></button>)}</div>
        </div>
        <aside className="il-side">
          <h2><Wrench size={19} />规则状态</h2>
          <div className="il-rule-list">{overview.rules.map(rule => <button type="button" key={rule.id} className="il-rule-row" onClick={() => void openRule(rule.id)}><span className={`il-dot ${rule.production ? 'ok' : 'warn'}`} /><div><strong>{rule.id}</strong><small>{rule.label} · {rule.instanceCount} 实例</small></div>{rule.reviewState === 'review-required' && <span className="il-pill bad">有质疑 · {rule.openFeedback}</span>}<span className={`il-pill ${rule.production ? 'ok' : 'warn'}`}>{statusLabel(rule.status)}</span></button>)}</div>
          <h2><BookOpen size={19} />案例</h2>
          <div className="il-case-list">{cases.map(item => <button type="button" key={item.id} className="il-case-row" onClick={() => void openCase(item.id)}><span className={`il-pill ${caseTone(item.status)}`}>{statusLabel(item.status)}</span><div><strong>{item.fixedPartId} → {item.movingPartId}</strong><small>{item.label}</small></div></button>)}</div>
        </aside>
      </div>
      <details className="il-limits"><summary>版本与限制</summary><pre>{json}</pre><ul>{overview.limitations.map(line => <li key={line}>{line}</li>)}<li>所有案例的 `physicalBuildVerified` 均为 false；开壳 seat 证明不等于闭合实体或实物认证。</li></ul></details>
    </section>}

    {tab === 'interfaces' && <section className="il-section il-split">
      <div className="il-list-panel">
        <div className="il-filters"><label>家族<select value={filters.family} onChange={event => setFilters({ ...filters, family: event.target.value })}><option value="">全部</option>{families.map(family => <option key={family} value={family}>{family}</option>)}</select></label><label>状态<select value={filters.status} onChange={event => setFilters({ ...filters, status: event.target.value })}><option value="">全部</option><option value="production">生产</option><option value="source-ready">来源就绪</option><option value="partial">部分</option><option value="unresolved">未解决</option></select></label><label className="grow"><Search size={14} /><input value={filters.q} placeholder="零件 / 来源 / 家族" onChange={event => setFilters({ ...filters, q: event.target.value })} /></label></div>
        <p className="il-muted">共 {interfaces.total} 个真实接口实例，显示前 {interfaces.instances.length} 个。点击查看来源、方向和规则。</p>
        <div className="il-interface-list">{interfaces.instances.map(row => <button type="button" key={row.id} className={`il-interface-row ${selectedInterface?.id === row.id ? 'active' : ''}`} onClick={() => void openInterface(row)}><div><strong>{row.partId}</strong><span>{row.partName}</span></div><div className="il-tags"><span className="il-pill">{row.family}</span><span className="il-pill weak">{row.role}</span><span className={`il-pill ${row.enabled ? 'ok' : row.supported ? 'warn' : 'weak'}`}>{row.enabled ? '生成准入' : row.supported ? '已识别' : '未支持'}</span></div><small>{row.featureId}{row.sourcePath ? ` · ${shortSource(row.sourcePath)}:${row.sourceLine ?? '?'}` : ''}</small></button>)}</div>
      </div>
      <div className="il-detail-panel">
        {!selectedInterface && <div className="il-empty">选择一个真实接口实例，查看其来源坐标、方向、尺寸、声明字段和关联规则。</div>}
        {selectedInterface && <div className="il-detail">
          <div className="il-detail-head"><div><span className="eyebrow">{selectedInterface.family} · {selectedInterface.role}</span><h2>{selectedInterface.partId} · {selectedInterface.partName}</h2></div><span className={`il-pill ${selectedInterface.enabled ? 'ok' : 'warn'}`}>{selectedInterface.enabled ? '进入生成准入' : '未进入生成准入'}</span></div>
          <div className="il-focus-toolbar"><button type="button" className="il-small-button" onClick={() => setFocusInterface(value => !value)}>{focusInterface ? '显示全零件' : '聚焦当前接口'}</button><label><input type="checkbox" checked={transparent} onChange={event => setTransparent(event.target.checked)} />透明查看</label><label><input type="checkbox" checked={focusSection} onChange={event => setFocusSection(event.target.checked)} />剖面辅助</label><span>参数与剖面只作示意，不是碰撞或实物证据。</span></div>
          <div className="il-view-caption"><span>接口轴 {selectedInterface.axis.map(value => Number(value).toFixed(2)).join(', ')}</span><span>R={selectedInterface.dimensions.radiusLdu ?? '?'} · L={selectedInterface.dimensions.lengthLdu ?? '?'} LDU</span><span>橙色标记 = 当前接口</span><span>真实来源网格</span></div>
          {partPayload ? <NativePartViewer mesh={partPayload.geometry.mesh} points={partPayload.connections.points} focusFeatureId={focusInterface ? selectedInterface.featureId : null} showBounds={true} showConnections={true} opacity={transparent ? 0.32 : 1} section={focusSection} showAxes={true} /> : <div className="il-loading small"><LoaderCircle className="spin" />读取真实网格…</div>}
          <div className="il-detail-grid">
            <section><h3>来源</h3><dl className="il-fields"><dt>来源文件</dt><dd>{shortSource(selectedInterface.sourcePath)}:{selectedInterface.sourceLine ?? '?'}</dd><dt>来源引用</dt><dd><a href={selectedInterface.sourcePath ?? undefined} target="_blank" rel="noreferrer">{shortSource(selectedInterface.sourcePath)}</a></dd><dt>原始指令</dt><dd><code>{selectedInterface.sourceRaw ?? '无'}</code></dd><dt>SHA-256</dt><dd className="mono">{selectedInterface.sourceSha256 ?? '无'}</dd><dt>坐标 LDU</dt><dd>{selectedInterface.position.map(value => Number(value).toFixed(2)).join(', ')}</dd><dt>方向</dt><dd>{selectedInterface.axis.map(value => Number(value).toFixed(3)).join(', ')}</dd><dt>尺寸</dt><dd>{`R=${selectedInterface.dimensions.radiusLdu ?? '?'} L=${selectedInterface.dimensions.lengthLdu ?? '?'}`}</dd><dt>插入范围</dt><dd>{selectedInterface.insertionRangeLdu?.join('..') ?? 'UNKNOWN'}</dd><dt>运动</dt><dd>slide={String(selectedInterface.slideAllowed)} · rotate={String(selectedInterface.rotationAllowed)}</dd><dt>未知字段</dt><dd>{selectedInterface.unknownFields.join(', ') || '无'}</dd></dl></section>
            <section><h3>规则与状态</h3><div className="il-tags">{selectedInterface.nativeRuleIds.map(id => <button type="button" className="il-pill" key={id} onClick={() => void openRule(id)}>{id}</button>)}</div><p><strong>覆盖：</strong>{selectedInterface.coverage} · <strong>状态：</strong>{statusLabel(selectedInterface.status)}</p><p><strong>来源支持：</strong>{String(selectedInterface.supported)} · <strong>能力启用：</strong>{String(selectedInterface.enabled)}</p>{interfaceDetail && <><p><strong>零件准入：</strong>generatable={String(interfaceDetail.part.generationEligible)} · collision={String(interfaceDetail.part.collisionGeometryReady)}</p><ul className="il-issues">{[...interfaceDetail.part.reasons, ...selectedInterface.diagnostics.map(item => `${item.code}: ${item.message}`), ...interfaceDetail.issues].map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}</ul></>}<details><summary>来源文件 ({interfaceDetail?.sourceFiles.length ?? 0})</summary><ul>{interfaceDetail?.sourceFiles.map(file => <li key={`${file.library}-${file.path}`}><code>{file.library}</code> {file.path} · {file.revision} · {file.license}</li>)}</ul></details></section>
          </div>
          <FeedbackComposer target={feedbackTarget} kind={feedbackKind} setKind={setFeedbackKind} message={feedbackMessage} setMessage={setFeedbackMessage} author={feedbackAuthor} setAuthor={setFeedbackAuthor} busy={feedbackBusy} submit={() => void submitFeedback()} />
          <FeedbackList records={feedback.filter(item => item.target.id === selectedInterface.id || item.target.partId === selectedInterface.partId)} patch={patchFeedback} />
        </div>}
      </div>
    </section>}

    {tab === 'rules' && <section className="il-section il-split">
      <div className="il-list-panel"><h2>规则清单</h2><div className="il-rule-list">{rules.map(rule => <button type="button" key={rule.id} className={`il-rule-row ${selectedRule?.id === rule.id ? 'active' : ''}`} onClick={() => void openRule(rule.id)}><span className={`il-dot ${rule.production ? 'ok' : 'warn'}`} /><div><strong>{rule.id}</strong><small>{rule.label} · {rule.maleFamilies.join('/')} → {rule.femaleFamilies.join('/')}</small></div><span className={`il-pill ${rule.production ? 'ok' : 'warn'}`}>{statusLabel(rule.status)}</span></button>)}</div></div>
      <div className="il-detail-panel">{!selectedRule && <div className="il-empty">选择一条规则，查看两端条件、真实案例、负例和证据缺口。</div>}{selectedRule && <div className="il-detail"><div className="il-detail-head"><div><span className="eyebrow">{selectedRule.evidenceRequired}</span><h2>{selectedRule.id} · {selectedRule.label}</h2></div><span className={`il-pill ${selectedRule.production ? 'ok' : 'warn'}`}>{statusLabel(selectedRule.status)}</span></div><p>{selectedRule.description}</p>{selectedRule.reviewState === 'review-required' && <div className="il-warning">存在 {selectedRule.openFeedback} 条未关闭人工质疑。该标记只进入复核流程，不自动撤销生产规则、开放接口或跳过碰撞。</div>}<div className="il-detail-grid"><section><h3>条件</h3><ul>{selectedRule.conditions.map(line => <li key={line}>{line}</li>)}</ul><h3>缺口</h3><ul className="il-issues">{selectedRule.missingEvidence.map(line => <li key={line}>{line}</li>)}</ul><h3>负例</h3><ul>{selectedRule.negativeControls.map(line => <li key={line}>{line}</li>)}</ul></section><section><h3>真实案例</h3>{selectedRule.cases.map(item => <button type="button" key={item.id} className="il-case-row" onClick={() => void openCase(item.id)}><span className={`il-pill ${caseTone(item.status)}`}>{statusLabel(item.status)}</span><div><strong>{item.fixedPartId} → {item.movingPartId}</strong><small>{item.summary}</small></div></button>)}<h3>接口样例</h3><div className="il-tags">{selectedRule.examples.map(item => <button type="button" className="il-pill" key={item.id} onClick={() => { setTab('interfaces'); void openInterface(item); }}>{item.partId} · {item.family}</button>)}</div></section></div><FeedbackComposer target={feedbackTarget?.kind === 'rule' ? feedbackTarget : { kind: 'rule', id: selectedRule.id, ruleId: selectedRule.id }} kind={feedbackKind} setKind={setFeedbackKind} message={feedbackMessage} setMessage={setFeedbackMessage} author={feedbackAuthor} setAuthor={setFeedbackAuthor} busy={feedbackBusy} submit={() => void submitFeedback()} /><FeedbackList records={feedback.filter(item => item.target.ruleId === selectedRule.id || item.target.id === selectedRule.id)} patch={patchFeedback} /></div>}</div>
    </section>}

    {tab === 'cases' && <section className="il-section il-split">
      <div className="il-list-panel"><h2>装配案例</h2><p className="il-muted">成功案例来自正式引擎；阻塞案例保留真实位置和碰撞原因。</p><div className="il-case-list">{cases.map(item => <button type="button" key={item.id} className={`il-case-row ${selectedCase?.id === item.id ? 'active' : ''}`} onClick={() => void openCase(item.id)}><span className={`il-pill ${caseTone(item.status)}`}>{statusLabel(item.status)}</span><div><strong>{item.fixedPartId} → {item.movingPartId}</strong><small>{item.label}</small></div></button>)}</div></div>
      <div className="il-detail-panel">{!selectedCase && <div className="il-empty">选择案例，查看两件真实零件、来源端点、求解姿态、碰撞结果和导出/重导入记录。</div>}{selectedCase && <div className="il-detail"><div className="il-detail-head"><div><span className="eyebrow">{selectedCase.ruleId} · {selectedCase.caseType}</span><h2>{selectedCase.fixedPartId} → {selectedCase.movingPartId}</h2></div><span className={`il-pill ${caseTone(selectedCase.status)}`}>{statusLabel(selectedCase.status)}</span></div><p>{selectedCase.summary}</p><div className="il-case-notice">{selectedCase.displayNotice}</div>{!(selectedCase.status === 'validated' && selectedCase.edge && casePlayerParts) && <div className="il-case-phases"><button type="button" className={casePhase === 'before' ? 'active' : ''} onClick={() => setCasePhase('before')}>分离前</button><button type="button" className={casePhase === 'aligned' ? 'active' : ''} onClick={() => setCasePhase('aligned')}>轴对齐</button><button type="button" className={casePhase === 'seated' ? 'active' : ''} onClick={() => setCasePhase('seated')}>已就位</button><span>只移动示意姿态，不生成安装轨迹，不作为碰撞证明。</span></div>}<div className="il-case-actions"><a className="il-small-button" href="#/part-lab?mode=assembly">在装配台打开正式生成器</a><span>案例由同一装配引擎生成；页面仅查看，不在此处授权新接口。</span></div>{selectedCase.status === 'validated' && selectedCase.edge && casePlayerParts ? <AssemblyCasePlayer detail={selectedCase as unknown as ConnectionCaseDetail} fixed={casePlayerParts.fixed} moving={casePlayerParts.moving} onOpenStudio={() => { setStudioCaseId(selectedCase.id); setTab('studio'); }} /> : Object.keys(caseAssets).length >= 2 ? <NativeAssemblyViewer placements={caseDisplayPlacements} assets={caseAssets} showConnections={true} showProxies={false} showPath={false} showZones={false} /> : <div className="il-loading small"><LoaderCircle className="spin" />读取两件真实网格…</div>}<div className="il-detail-grid"><section><h3>固定端</h3><EndpointSummary row={selectedCase.fixed} /><h3>移动端</h3><EndpointSummary row={selectedCase.moving} /></section><section><h3>验证</h3><dl className="il-fields"><dt>引擎接受</dt><dd>{String(selectedCase.validation.engineAccepted)}</dd><dt>图有效</dt><dd>{String(selectedCase.validation.graphValid)}</dd><dt>重导入</dt><dd>{selectedCase.validation.importStatus}</dd><dt>碰撞</dt><dd>{selectedCase.validation.collisionStatus}</dd><dt>安装路径</dt><dd>{selectedCase.validation.installationPath === 'not-validated' ? '未验证' : '仅来源轴向姿态'}</dd><dt>实物验证</dt><dd>false</dd><dt>版本</dt><dd>grammar {selectedCase.versions.grammar} · rule {selectedCase.versions.connectionRule} · collision {selectedCase.versions.collision}</dd><dt>允许转角</dt><dd>{selectedCase.allowedTwistsDeg.join(', ')}°</dd></dl>{selectedCase.validation.reasons.map(reason => <p className="il-reason" key={reason}>{reason}</p>)}{selectedCase.modelMeta && <p className="il-muted">BOM {selectedCase.modelMeta.bom.length} 行 · {selectedCase.modelMeta.steps} 步 · 导出 {selectedCase.modelMeta.exportBytes ?? '?'} bytes · {selectedCase.modelMeta.contentSha256?.slice(0, 12) ?? ''}</p>}</section></div><FeedbackComposer target={feedbackTarget?.kind === 'case' ? feedbackTarget : { kind: 'case', id: selectedCase.id, ruleId: selectedCase.ruleId, caseId: selectedCase.id }} kind={feedbackKind} setKind={setFeedbackKind} message={feedbackMessage} setMessage={setFeedbackMessage} author={feedbackAuthor} setAuthor={setFeedbackAuthor} busy={feedbackBusy} submit={() => void submitFeedback()} /><FeedbackList records={feedback.filter(item => item.target.caseId === selectedCase.id || item.target.id === selectedCase.id)} patch={patchFeedback} /></div>}</div>
    </section>}

    {tab === 'studio' && <section className="il-section"><AssemblyStudio initialCaseId={studioCaseId} onSaved={() => void refreshOverview()} /></section>}

    {tab === 'compare' && <section className="il-section"><div className="il-compare-head"><div><h2>新零件对比</h2><p>只读取真实接口实例并调用现有规则与求解器。相似名称、外观或半径不构成资格；比较结果不授予生成准入。</p></div><div className="il-compare-form"><label>新零件<input value={comparePart} onChange={event => setComparePart(event.target.value)} placeholder="例如 2412b" /></label><label>目标零件（可选）<input value={compareTarget} onChange={event => setCompareTarget(event.target.value)} placeholder="例如 30374" /></label><button type="button" onClick={() => void runComparison()} disabled={compareBusy}>{compareBusy ? <LoaderCircle className="spin" size={16} /> : <GitCompareArrows size={16} />}运行正式对比</button></div></div>{comparison && <><div className="il-counts compact"><div className="il-stat"><span>识别</span><strong>{comparison.recognition.interfaces}</strong><small>{comparison.recognition.typeRecognition}</small></div><div className="il-stat"><span>精确匹配</span><strong>{comparison.recognition.exact}</strong><small>规则/来源参数完整</small></div><div className="il-stat"><span>候选</span><strong>{comparison.recognition.candidate}</strong><small>需要补条件</small></div><div className="il-stat"><span>冲突 / 不足</span><strong>{comparison.recognition.conflict} / {comparison.recognition.insufficient}</strong><small>不自动准入</small></div><div className="il-stat"><span>正式装配</span><strong>{comparison.recognition.assemblyPass}</strong><small>generationAdmission=false</small></div></div><div className="il-compare-list">{comparison.candidates.map(candidate => <article className="il-candidate" key={candidate.interfaceId}><header><div><span className="eyebrow">{candidate.interfaceId}</span><h3>{candidate.family} · {candidate.role}</h3></div><span className={`il-pill ${candidate.classification === 'exact' ? 'ok' : candidate.classification === 'conflict' ? 'bad' : 'warn'}`}>{candidate.classification}</span></header><p>匹配规则：{candidate.matchedRuleIds.join(', ') || '无'}</p>{candidate.counterpart && <p>真实对端：<strong>{candidate.counterpart.partId}</strong> · {candidate.counterpart.family} · 兼容 {candidate.counterpart.compatibility ?? '未运行'} · 求解 {candidate.counterpart.solver ?? '未运行'} · 碰撞 {candidate.counterpart.collision ?? '未运行'}</p>}{candidate.formalAssembly && <p>正式装配：<strong>{candidate.formalAssembly.status}</strong>{candidate.formalAssembly.reasons.length ? ` · ${candidate.formalAssembly.reasons.join('；')}` : ''}</p>}{candidate.failedConditions.length > 0 && <p className="il-reason">未满足：{candidate.failedConditions.join('；')}</p>}</article>)}</div><div className="il-limits"><strong>限制：</strong><ul>{comparison.limitations.map(line => <li key={line}>{line}</li>)}</ul></div></>}</section>}

    {tab === 'review' && <section className="il-section"><div className="il-review-head"><div><h2>复核队列</h2><p>队列只列出接口层缺口和仍待处理的人工反馈；点击可定位到真实接口或案例。人工作业不会自动开放接口、跳过碰撞或授予生成资格。</p></div><span className="il-badge weak">{queue.length} 项 · {feedback.filter(item => item.status === 'open' || item.status === 'triaged').length} 条开放反馈</span></div><div className="il-review-grid"><div>{['missing-source', 'partial-parse', 'unsupported-rule', 'uncertain-collision', 'assembly-failure', 'human-dispute'].map(category => <section className="il-queue-group" key={category}><h3>{({ 'missing-source': '缺少来源', 'partial-parse': '解析不完整', 'unsupported-rule': '规则未支持', 'uncertain-collision': '碰撞不确定', 'assembly-failure': '装配失败', 'human-dispute': '人工争议' } as Record<string, string>)[category]} <small>{queue.filter(item => item.category === category).length}</small></h3>{queue.filter(item => item.category === category).slice(0, 40).map(item => <button type="button" key={item.id} className="il-queue-row" onClick={() => { if (item.caseId) void openCase(item.caseId); else if (item.partId) { setTab('interfaces'); const row = interfaces.instances.find(value => value.partId === item.partId && value.featureId === item.featureId); if (row) void openInterface(row); } }}><span className={`il-dot ${item.severity === 'blocking' ? 'bad' : 'warn'}`} /><div><strong>{item.title}</strong><small>{item.detail}</small></div></button>)}</section>)}</div><div className="il-feedback-panel"><h3><MessageSquare size={18} />人工反馈</h3>{feedback.length === 0 && <p className="il-empty small">还没有人工反馈。打开接口、规则或案例后可提交观察。</p>}{feedback.map(record => <details className="il-feedback" key={record.id} open={record.status === 'open'}><summary><span className={`il-pill ${record.status === 'open' ? 'warn' : record.status === 'resolved' || record.status === 'accepted-for-review' ? 'ok' : 'weak'}`}>{record.status}</span><strong>{feedbackKinds.find(([id]) => id === record.kind)?.[1] ?? record.kind}</strong><small>{record.target.kind} · {record.target.id}</small></summary><p>{record.message}</p><p className="il-muted">{new Date(record.createdAt).toLocaleString()} · {record.author} · grammar {record.evidence.grammarVersion} · rule {record.evidence.ruleId ?? 'n/a'} · bridge {record.evidence.ruleVersion ?? 'n/a'} · collision {record.evidence.collisionVersion}</p><p className="il-muted">处理：{record.handling.note || '尚未处理'} · 软件结论：{record.softwareConclusion}</p><p className="il-muted">提交时结论快照：{record.evidence.conclusion}</p><div className="il-feedback-actions">{(['triaged', 'needs-evidence', 'accepted-for-review', 'rejected', 'resolved'] as const).map(status => <button type="button" key={status} className="il-small-button" onClick={() => void patchFeedback(record, status)}>{status}</button>)}</div>{record.handling.history.length > 0 && <details><summary>处理历史 ({record.handling.history.length})</summary><ul>{record.handling.history.map((event, index) => <li key={`${event.at}-${index}`}>{new Date(event.at).toLocaleString()} · {event.status} · {event.note}</li>)}</ul></details>}</details>)}</div></div></section>}
  </main>;
}

function EndpointSummary({ row }: { row: InterfaceRow }) {
  return <div className="il-endpoint"><strong>{row.partId} · {row.partName}</strong><span>{row.family} / {row.role} · {row.coverage}</span><code>{row.sourcePath}:{row.sourceLine}</code><small>位置 {row.position.map(value => Number(value).toFixed(1)).join(', ')} · 方向 {row.axis.map(value => Number(value).toFixed(2)).join(', ')}</small></div>;
}

function FeedbackComposer({ target, kind, setKind, message, setMessage, author, setAuthor, busy, submit }: { target: { kind: string; id: string; partId?: string; featureId?: string; ruleId?: string; caseId?: string } | null; kind: FeedbackKind; setKind: (value: FeedbackKind) => void; message: string; setMessage: (value: string) => void; author: string; setAuthor: (value: string) => void; busy: boolean; submit: () => void }) {
  return <section className="il-feedback-composer"><h3><MessageSquare size={18} />提交人工观察</h3>{target ? <p className="il-muted">目标：{target.kind} · {target.id}。反馈会记录当前版本和结论快照，但不会改变软件验证结果。</p> : <p className="il-muted">请先选择一个接口、规则或案例。</p>}<div className="il-feedback-form"><label>类型<select value={kind} onChange={event => setKind(event.target.value as FeedbackKind)}>{feedbackKinds.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><label>署名<input value={author} onChange={event => setAuthor(event.target.value)} maxLength={120} /></label><label className="grow">说明<textarea value={message} onChange={event => setMessage(event.target.value)} maxLength={5000} placeholder="描述你看到的位置、方向、证据或反对理由。附件仅支持来源链接，本页不提供二进制上传。" /></label><button type="button" disabled={!target || busy || !message.trim()} onClick={submit}>{busy ? <LoaderCircle className="spin" size={15} /> : <ArrowRight size={15} />}保存为人工观察</button></div></section>;
}

function FeedbackList({ records, patch }: { records: Feedback[]; patch: (record: Feedback, status: FeedbackStatus) => void }) {
  if (!records.length) return null;
  return <section className="il-feedback-panel inline"><h3>相关人工反馈</h3>{records.map(record => <details className="il-feedback" key={record.id} open={record.status === 'open'}><summary><span className={`il-pill ${record.status === 'open' ? 'warn' : 'ok'}`}>{record.status}</span><strong>{feedbackKinds.find(([id]) => id === record.kind)?.[1] ?? record.kind}</strong><small>{new Date(record.createdAt).toLocaleString()}</small></summary><p>{record.message}</p><p className="il-muted">{record.softwareConclusion}</p><p className="il-muted">提交时结论快照：{record.evidence.conclusion}</p><div className="il-feedback-actions">{(['triaged', 'needs-evidence', 'accepted-for-review', 'rejected', 'resolved'] as const).map(status => <button type="button" key={status} className="il-small-button" onClick={() => patch(record, status)}>{status}</button>)}</div></details>)}</section>;
}
