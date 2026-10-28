import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Box, CheckCircle2, CircleAlert, RotateCcw, RotateCw, Save, Undo2, Redo2, Camera } from 'lucide-react';
import AnimatedPairViewer, { type PairTool, type PairTransform, type PairView, type PairViewerHandle } from './AnimatedPairViewer.js';
import type { NativeConnectionPoint, NativeMesh } from './NativePartViewer.js';

type StudioTool = 'move' | 'rotate' | 'orbit';
type StudioSuggestion = StudioValidation['suggestions'][number];
type Vec = [number, number, number];
type Mat = [number, number, number, number, number, number, number, number, number];
interface CaseSummary { id: string; label: string; ruleId: string; status: string; fixedPartId: string; movingPartId: string; summary: string; caseType: string }
interface CaseDetail extends CaseSummary {
  edge: { fixedConnectionId: string; movingConnectionId: string; ruleId: string; axis: Vec; insertionDepthLdu: number } | null;
  placements: { instanceId: string; partId: string; transform: { rotation: Mat; translation: Vec } }[];
  validation: { engineAccepted: boolean; graphValid: boolean; collisionStatus: string; installationPath: string; reasons: string[] };
  displayNotice: string;
}
interface PartPayload { geometry: { mesh: NativeMesh }; connections: { points: NativeConnectionPoint[] } }
interface StudioValidation {
  rule: { status: string; ruleId: string | null; reason: string; reasonCode: string; sourceIds: string[]; allowedTwistsDeg: number[]; poseAngleDeg: number | null; poseDistanceLdu: number | null };
  finalCollision: { status: string; reasonCode: string; reason: string; witness: Vec | null };
  path: { status: string; samples: number; reason: string; scope: string; witness: Vec | null };
  suggestions: { transform: { rotation: Mat; translation: Vec }; twistDeg: number; ruleId: string }[];
  generationEligible: false; physicalBuildVerified: false; limitations: string[];
}
interface StudioExample {
  id: string; status: string; createdAt: string; fixedPartId: string; movingPartId: string;
  fixedInitial: { rotation: Mat; translation: Vec }; movingInitial: { rotation: Mat; translation: Vec }; movingFinal: { rotation: Mat; translation: Vec };
  keyframes: { id: string; label: string; transform: { rotation: Mat; translation: Vec } }[];
  fixedConnectionId: string | null; movingConnectionId: string | null; mode: string;
  validation: StudioValidation; stale: boolean;
  userClaim: { connectionNote: string; reason: string; physicallyBuilt: boolean };
}
interface StudioExampleSummary { id: string; createdAt: string; fixedPartId: string; movingPartId: string; ruleId: string | null; pathStatus: string; stale: boolean; status: string }

const identity: Mat = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const identityTransform = (translation: Vec = [0, 0, 0]): PairTransform => ({ rotation: identity, translation });
const clone = (value: PairTransform): PairTransform => ({ rotation: [...value.rotation] as Mat, translation: [...value.translation] as Vec });
const multiply = (a: Mat, b: Mat): Mat => { const out = new Array<number>(9).fill(0); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) out[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j]; return out as Mat; };
const rotateMatrix = (axis: 0 | 1 | 2, degrees: number): Mat => {
  const angle = degrees * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  if (axis === 0) return [1, 0, 0, 0, c, -s, 0, s, c];
  if (axis === 1) return [c, 0, s, 0, 1, 0, -s, 0, c];
  return [c, -s, 0, s, c, 0, 0, 0, 1];
};
const translate = (value: PairTransform, axis: 0 | 1 | 2, amount: number): PairTransform => { const translation = [...value.translation] as Vec; translation[axis] += amount; return { rotation: value.rotation, translation }; };
const rotate = (value: PairTransform, axis: 0 | 1 | 2, degrees: number): PairTransform => ({ rotation: multiply(rotateMatrix(axis, degrees), value.rotation), translation: value.translation });
const distance = (a: Vec, b: Vec) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const angle = (a: Mat, b: Mat) => { const trace = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] + a[4] * b[4] + a[5] * b[5] + a[6] * b[6] + a[7] * b[7] + a[8] * b[8]; return Math.acos(Math.max(-1, Math.min(1, (trace - 1) / 2))) * 180 / Math.PI; };
const fmt = (value: number) => Number.isFinite(value) ? value.toFixed(1) : '—';

async function partRequest<T>(partId: string): Promise<T> {
  const response = await fetch(`/api/parts-foundation/parts/${encodeURIComponent(partId)}`);
  const body = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(body.error || `零件读取失败 (${response.status})`);
  return body as T;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/interface-library${path}`, { headers: { 'Content-Type': 'application/json' }, ...init });
  const body = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(body.error || `请求失败 (${response.status})`);
  return body as T;
}

export default function AssemblyStudio({ onSaved, initialCaseId }: { onSaved?: () => void; initialCaseId?: string | null }) {
  const viewer = useRef<PairViewerHandle>(null);
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [caseDetail, setCaseDetail] = useState<CaseDetail | null>(null);
  const [fixed, setFixed] = useState<PartPayload | null>(null);
  const [moving, setMoving] = useState<PartPayload | null>(null);
  const [fixedTransform, setFixedTransform] = useState<PairTransform>(identityTransform());
  const [startTransform, setStartTransform] = useState<PairTransform>(identityTransform());
  const [movingTransform, setMovingTransform] = useState<PairTransform>(identityTransform());
  const [mode, setMode] = useState<'assisted' | 'free'>('assisted');
  const [tool, setTool] = useState<StudioTool>('move');
  const [view, setView] = useState<PairView>('side');
  const [step, setStep] = useState(1);
  const [history, setHistory] = useState<PairTransform[]>([]);
  const [redo, setRedo] = useState<PairTransform[]>([]);
  const [keyframes, setKeyframes] = useState<{ id: string; label: string; transform: PairTransform }[]>([]);
  const [pathProvided, setPathProvided] = useState(false);
  const [validation, setValidation] = useState<StudioValidation | null>(null);
  const [saved, setSaved] = useState<StudioExample | null>(null);
  const [examples, setExamples] = useState<StudioExampleSummary[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [connectionNote, setConnectionNote] = useState('');
  const [reason, setReason] = useState('');
  const [physicallyBuilt, setPhysicallyBuilt] = useState(false);
  const [snap, setSnap] = useState<PairTransform | null>(null);
  const [suggestions, setSuggestions] = useState<StudioSuggestion[]>([]);
  useEffect(() => { viewer.current?.setView(view); }, [view, fixed, moving]);
  const [showConnections, setShowConnections] = useState(true);
  const [fixedRoleId, setFixedRoleId] = useState<string | null>(null);
  const [movingRoleId, setMovingRoleId] = useState<string | null>(null);

  const loadExampleList = async () => { try { setExamples(await request<StudioExampleSummary[]>('/studio/examples')); } catch { /* list is optional */ } };
  useEffect(() => { void loadExampleList(); void (async () => {
    try {
      const list = await request<CaseSummary[]>('/cases');
      setCases(list);
      const first = list.find(item => item.status === 'validated' && item.ruleId === 'C01') ?? list.find(item => item.status === 'validated') ?? list[0];
      const preferred = initialCaseId ? cases.find(item => item.id === initialCaseId && item.status === 'validated') : null;
      if (preferred) await loadCase(preferred.id); else if (first) await loadCase(first.id);
    } catch (failure) { setError(failure instanceof Error ? failure.message : '无法加载案例。'); }
  })(); }, []);

  const loadCase = async (id: string) => {
    setBusy(true); setError(''); setValidation(null); setSaved(null); setKeyframes([]); setPathProvided(false);
    try {
      const detail = await request<CaseDetail>(`/case?id=${encodeURIComponent(id)}`);
      if (!detail.edge) throw new Error('该案例没有可用的正式连接边，无法进入手动拼搭。');
      setCaseDetail(detail);
      setFixedRoleId(detail.edge.fixedConnectionId); setMovingRoleId(detail.edge.movingConnectionId);
      const [fixedPart, movingPart] = await Promise.all([
        partRequest<PartPayload>(detail.fixedPartId),
        partRequest<PartPayload>(detail.movingPartId),
      ]);
      const fixedPlacement = detail.placements.find(item => item.partId === detail.fixedPartId);
      const movingPlacement = detail.placements.find(item => item.partId === detail.movingPartId);
      const fixedTransform = fixedPlacement ? { rotation: fixedPlacement.transform.rotation, translation: fixedPlacement.transform.translation } : identityTransform();
      const movingTransform = movingPlacement ? { rotation: movingPlacement.transform.rotation, translation: movingPlacement.transform.translation } : identityTransform();
      const edge = detail.edge;
      const separation = Math.max(32, edge.insertionDepthLdu + 32);
      const separated: PairTransform = { rotation: movingTransform.rotation, translation: movingTransform.translation.map((value, index) => value + edge.axis[index] * separation) as Vec };
      setFixed(fixedPart); setMoving(movingPart); setFixedTransform(fixedTransform); setStartTransform(separated); setMovingTransform(separated);
      setHistory([]); setRedo([]); setSnap(null); setSuggestions([]);
      try {
        const preview = await request<StudioValidation>('/studio/validate', { method: 'POST', body: JSON.stringify({ mode: 'assisted', caseId: detail.id, fixedPartId: detail.fixedPartId, movingPartId: detail.movingPartId, fixedConnectionId: edge.fixedConnectionId, movingConnectionId: edge.movingConnectionId, fixedInitial: fixedTransform, movingInitial: separated, movingFinal: movingTransform, keyframes: [], userClaim: { connectionNote: '辅助模式来源候选', reason: '准备手动拼搭', physicallyBuilt: false, attachments: [] } }) });
        setSuggestions(preview.suggestions);
      } catch { setSuggestions([]); }
    } catch (failure) { setError(failure instanceof Error ? failure.message : '加载失败。'); }
    setBusy(false);
  };

  const swap = async () => {
    if (!caseDetail || !fixed || !moving) return;
    const fixedPoint = fixed.connections.points.find(point => point.id === fixedRoleId);
    const movingPoint = moving.connections.points.find(point => point.id === movingRoleId);
    if (!fixedPoint || !movingPoint) return;
    const nextFixed = fixedTransform, nextMoving = movingTransform;
    setSuggestions([]);
    setFixed(moving); setMoving(fixed);
    setCaseDetail({ ...caseDetail, fixedPartId: caseDetail.movingPartId, movingPartId: caseDetail.fixedPartId, edge: caseDetail.edge ? { ...caseDetail.edge, fixedConnectionId: caseDetail.edge.movingConnectionId, movingConnectionId: caseDetail.edge.fixedConnectionId } : null });
    setFixedTransform(nextMoving); setMovingTransform(nextFixed); setStartTransform(nextFixed);
    setFixedRoleId(movingRoleId); setMovingRoleId(fixedRoleId); setValidation(null); setSnap(null); setHistory([]); setRedo([]);
  };

  const push = (next: PairTransform) => { setHistory(value => [...value.slice(-30), clone(movingTransform)]); setRedo([]); setMovingTransform(next); setSnap(null); };
  const change = (next: PairTransform) => { setMovingTransform(next); const nearest = suggestions.map(item => ({ transform: item.transform, distance: distance(item.transform.translation, next.translation), angle: angle(item.transform.rotation, next.rotation) })).sort((a, b) => Math.max(a.distance / 4, a.angle / 8) - Math.max(b.distance / 4, b.angle / 8))[0]; setSnap(mode === 'assisted' && nearest && nearest.distance <= 18 && nearest.angle <= 35 ? nearest.transform : null); };
  const undo = () => { const previous = history.at(-1); if (!previous) return; setRedo(value => [...value, clone(movingTransform)]); setHistory(value => value.slice(0, -1)); setMovingTransform(previous); setSnap(null); };
  const redoAction = () => { const next = redo.at(-1); if (!next) return; setHistory(value => [...value, clone(movingTransform)]); setRedo(value => value.slice(0, -1)); setMovingTransform(next); setSnap(null); };
  const reset = () => { setMovingTransform(clone(startTransform)); setHistory([]); setRedo([]); setSnap(null); };
  const apply = (axis: 0 | 1 | 2, direction: 1 | -1, rotation = false) => { push(rotation ? rotate(movingTransform, axis, direction * step * 5) : translate(movingTransform, axis, direction * step)); };
  const snapNow = () => { if (snap) { push(clone(snap)); setSnap(null); } };

  const input = (keyframesOverride?: typeof keyframes) => {
    if (!caseDetail) throw new Error('未选择案例。');
    const frames = keyframesOverride ?? keyframes;
    return {
      mode, caseId: caseDetail.id, fixedPartId: caseDetail.fixedPartId, movingPartId: caseDetail.movingPartId,
      fixedConnectionId: mode === 'assisted' ? fixedRoleId : null, movingConnectionId: mode === 'assisted' ? movingRoleId : null,
      fixedInitial: fixedTransform, movingInitial: startTransform, movingFinal: movingTransform,
      keyframes: pathProvided ? frames.map((frame, index) => ({ ...frame, id: `${index}`, recordedAt: new Date().toISOString() })) : [],
      userClaim: { connectionNote: connectionNote || '手工摆放', reason: reason || '我希望提交这个拼接示例', physicallyBuilt, attachments: [] },
    };
  };

  const preview = async () => {
    if (!caseDetail) return;
    setBusy(true); setError('');
    try { const result = await request<StudioValidation>('/studio/validate', { method: 'POST', body: JSON.stringify(input()) }); setValidation(result); }
    catch (failure) { setError(failure instanceof Error ? failure.message : '检查失败。'); }
    setBusy(false);
  };

  const saveExample = async () => {
    if (!caseDetail) return;
    setBusy(true); setError('');
    try {
      const result = await request<StudioExample>('/studio/examples', { method: 'POST', body: JSON.stringify(input()) });
      setSaved(result); setValidation(result.validation); await loadExampleList(); onSaved?.();
    } catch (failure) { setError(failure instanceof Error ? failure.message : '保存失败。'); }
    setBusy(false);
  };

  const loadExample = async (id: string) => {
    setBusy(true); setError('');
    try {
      const example = await request<StudioExample>(`/studio/examples/${encodeURIComponent(id)}`);
      const [fixedPart, movingPart] = await Promise.all([
        partRequest<PartPayload>(example.fixedPartId),
        partRequest<PartPayload>(example.movingPartId),
      ]);
      setFixed(fixedPart); setMoving(movingPart); setCaseDetail({ id: 'saved-example', label: '保存的拼搭示例', ruleId: example.validation.rule.ruleId ?? '', status: 'saved', fixedPartId: example.fixedPartId, movingPartId: example.movingPartId, summary: '从待验证示例重新打开', caseType: 'specification', edge: example.fixedConnectionId && example.movingConnectionId ? { fixedConnectionId: example.fixedConnectionId, movingConnectionId: example.movingConnectionId, ruleId: example.validation.rule.ruleId ?? '', axis: [0, 1, 0], insertionDepthLdu: 4 } : null, placements: [], validation: { engineAccepted: false, graphValid: false, collisionStatus: 'not-run', installationPath: 'not-validated', reasons: [] }, displayNotice: '这是人工保存的待验证示例，不是正式生产案例。' });
      setFixedRoleId(example.fixedConnectionId); setMovingRoleId(example.movingConnectionId); setFixedTransform(example.fixedInitial); setStartTransform(example.movingInitial); setMovingTransform(example.movingFinal); setKeyframes(example.keyframes.map(frame => ({ id: frame.id, label: frame.label, transform: frame.transform }))); setPathProvided(example.keyframes.length > 0); setValidation(example.validation); setSaved(example); setMode(example.mode === 'free' ? 'free' : 'assisted'); setHistory([]); setRedo([]); setSnap(null); setReason(example.userClaim.reason); setConnectionNote(example.userClaim.connectionNote); setPhysicallyBuilt(example.userClaim.physicallyBuilt);
    } catch (failure) { setError(failure instanceof Error ? failure.message : '打开示例失败。'); }
    setBusy(false);
  };

  const currentCase = useMemo(() => cases.find(item => item.id === caseDetail?.id), [cases, caseDetail?.id]);
  if (!fixed || !moving || !caseDetail) return <section className="studio"><p className="studio-loading">{busy ? '正在加载真实零件与规则…' : error || '正在准备案例…'}</p></section>;
  const nearest = snap ? { distance: distance(snap.translation, movingTransform.translation), angle: angle(snap.rotation, movingTransform.rotation) } : null;

  return (
    <section className="studio">
      <header className="studio-heading"><div><p className="eyebrow">MANUAL ASSEMBLY STUDIO</p><h2>我来拼搭</h2><p>固定一件真实零件，移动另一件；记录关键帧后提交为待验证人工示例。不会获得正式生成资格。</p></div><div className="studio-case-picker"><label>案例<select value={caseDetail.id} onChange={event => void loadCase(event.target.value)}>{cases.filter(item => item.status === 'validated').map(item => <option key={item.id} value={item.id}>{item.fixedPartId} + {item.movingPartId} · {item.ruleId}</option>)}</select></label><button type="button" className="ghost" onClick={() => void swap()}>切换固定/移动</button></div></header>
      {error ? <p className="studio-error">{error}</p> : null}
      <div className="studio-mode-row"><div className="segmented"><button type="button" className={mode === 'assisted' ? 'active' : ''} onClick={() => setMode('assisted')}>辅助拼搭</button><button type="button" className={mode === 'free' ? 'active' : ''} onClick={() => setMode('free')}>自由示范</button></div><span className="studio-hint">{mode === 'assisted' ? '辅助拼搭只在来源规则成立时提示；吸附不等于完整验证。' : '自由示范不吸附、不纠正；重叠只警告，结果只能保存为待验证示例。'}</span></div>
      <div className="studio-workbench">
        <div className="studio-stage"><AnimatedPairViewer ref={viewer} fixedMesh={fixed.geometry.mesh} movingMesh={moving.geometry.mesh} fixedPoints={fixed.connections.points} movingPoints={moving.connections.points} fixedTransform={fixedTransform} movingTransform={movingTransform} fixedConnectionId={fixedRoleId} movingConnectionId={movingRoleId} interactive={tool !== 'orbit'} tool={tool === 'rotate' ? 'rotate' : 'move'} showConnections={showConnections} snapTransform={mode === 'assisted' ? snap : null} onTransformChange={change} onTransformCommit={() => void preview()} />
          <div className="studio-stage-legend"><span><i className="dot fixed" />固定件 A · {caseDetail.fixedPartId}</span><span><i className="dot moving" />移动件 B · {caseDetail.movingPartId}</span><span>辅助显示色</span></div>
          <div className="studio-view-row">{(['free', 'front', 'side', 'top'] as PairView[]).map(item => <button type="button" key={item} className={view === item ? 'active' : ''} onClick={() => { setView(item); viewer.current?.setView(item); }}>{item === 'free' ? '自由' : item === 'front' ? '正视' : item === 'side' ? '侧视' : '俯视'}</button>)}<label><input type="checkbox" checked={showConnections} onChange={event => setShowConnections(event.target.checked)} />连接位置</label></div>
        </div>
        <aside className="studio-controls">
          <div className="studio-tool-tabs"><button type="button" className={tool === 'move' ? 'active' : ''} onClick={() => setTool('move')}><ArrowUp size={16} />移动这个零件</button><button type="button" className={tool === 'rotate' ? 'active' : ''} onClick={() => setTool('rotate')}><RotateCw size={16} />旋转这个零件</button><button type="button" className={tool === 'orbit' ? 'active' : ''} onClick={() => setTool('orbit')}><Camera size={16} />转动视角</button></div>
          <div className="studio-step-row"><label>步长 <input type="number" min="0.1" max="20" step="0.5" value={step} onChange={event => setStep(Math.max(0.1, Math.min(20, Number(event.target.value) || 1)))} /></label><span>{tool === 'rotate' ? '角度 = 步长 × 5°' : '单位：LDU'}</span></div>
          <div className="studio-axis-grid">{([0, 1, 2] as const).map(axis => <div key={axis}><strong>{['X', 'Y', 'Z'][axis]}</strong><button type="button" onClick={() => apply(axis, -1, tool === 'rotate')}>{tool === 'rotate' ? '↺' : '−'}</button><button type="button" onClick={() => apply(axis, 1, tool === 'rotate')}>{tool === 'rotate' ? '↻' : '+'}</button></div>)}</div>
          <div className="studio-actions"><button type="button" onClick={undo} disabled={!history.length}><Undo2 size={15} />撤销</button><button type="button" onClick={redoAction} disabled={!redo.length}><Redo2 size={15} />重做</button><button type="button" onClick={reset}><RotateCcw size={15} />恢复原始位置</button></div>
          <div className={`studio-snap ${mode === 'free' ? 'free' : snap ? 'ready' : ''}`}>{mode === 'free' ? '自由示范：不吸附，不自动判断为通过。' : snap ? `接近候选位置，偏差约 ${fmt(nearest?.distance ?? 0)} LDU / ${fmt(nearest?.angle ?? 0)}°。吸附只表示姿态接近，仍需检查碰撞。` : suggestions.length ? '已有来源候选姿态；可以慢慢移动，或先吸附到候选后再检查。' : '移动零件靠近候选连接位置时会出现吸附预览。'}{snap ? <button type="button" onClick={snapNow}>吸附到最近候选</button> : suggestions.length ? <button type="button" onClick={() => { setMovingTransform(clone(suggestions[0].transform)); setSnap(null); }}>吸附到来源候选姿态</button> : null}</div>
          <div className="studio-keyframes"><h3>记录关键帧</h3><div><button type="button" onClick={() => { const frame = { id: 'start', label: '起始位置', transform: clone(movingTransform) }; setStartTransform(clone(movingTransform)); setKeyframes([frame]); setPathProvided(true); }}>记录起始位置</button><button type="button" onClick={() => { setKeyframes(frames => [...frames, { id: `p${frames.length}`, label: `过程 ${frames.length + 1}`, transform: clone(movingTransform) }]); setPathProvided(true); }}>添加过程位置</button><button type="button" onClick={() => { setKeyframes(frames => [...frames, { id: 'final', label: '连接完成位置', transform: clone(movingTransform) }]); setPathProvided(true); }}>记录连接完成位置</button></div><ol>{keyframes.map((frame, index) => <li key={`${frame.id}-${index}`}>{frame.label}<span>{fmt(frame.transform.translation[0])}, {fmt(frame.transform.translation[1])}, {fmt(frame.transform.translation[2])}</span></li>)}</ol><p>{pathProvided ? `已记录 ${keyframes.length} 个关键帧；插值只是候选路径，未经检查不标记为验证通过。` : '未提供安装过程；提交时会明确标注。'}</p></div>
          <details className="studio-technical"><summary>技术详情（矩阵 / 原始状态）</summary><pre>{JSON.stringify({ fixed: fixedTransform, moving: movingTransform, keyframes }, null, 2)}</pre></details>
        </aside>
      </div>
      <div className="studio-submit"><div className="studio-claim"><h3>提交我的拼搭示例</h3><label>我认为连接在哪里<input value={connectionNote} onChange={event => setConnectionNote(event.target.value)} placeholder="例如：四个凸点全部进入凹槽" maxLength={2000} /></label><label>为什么可以这样连接<textarea value={reason} onChange={event => setReason(event.target.value)} placeholder="写下你的判断；人工说明不会自动生成全局规则。" maxLength={5000} rows={3} /></label><label className="inline"><input type="checkbox" checked={physicallyBuilt} onChange={event => setPhysicallyBuilt(event.target.checked)} />我亲自用实物拼过</label><p className="studio-hint">附件本轮只支持链接；未实现二进制上传，因此不展示上传按钮。</p></div><div className="studio-run"><button type="button" className="primary large" onClick={() => void preview()} disabled={busy}>{busy ? '检查中…' : '运行检查'}</button><button type="button" className="large" onClick={() => void saveExample()} disabled={busy}><Save size={16} />保存为待验证示例</button><p>保存的是人工示例，不改变生产资格、规则或碰撞检查。</p></div></div>
      {validation ? <StudioResult validation={validation} /> : null}
      {saved ? <p className="studio-saved"><CheckCircle2 size={16} />已保存 {saved.id}；刷新后可在下方重新打开。 <button type="button" onClick={() => void loadExample(saved.id)}>重新打开</button></p> : null}
      <section className="studio-examples"><h3>我的待验证示例</h3>{examples.length ? <div className="studio-example-list">{examples.map(item => <button type="button" key={item.id} onClick={() => void loadExample(item.id)} className={saved?.id === item.id ? 'active' : ''}><strong>{item.fixedPartId} + {item.movingPartId}</strong><span>{item.ruleId ?? '无规则'} · {{ 'checked-clear': '路径取样通过', 'checked-collision': '路径取样碰撞', 'not-checked': '路径暂时无法判断', 'not-provided': '未提供过程' }[item.pathStatus] ?? item.pathStatus} {item.stale ? '· 来源已变化，需重新检查' : ''}</span><small>{new Date(item.createdAt).toLocaleString()}</small></button>)}</div> : <p className="studio-hint">还没有保存的示例。先完成一次摆放并保存。</p>}</section>
      <div className="studio-current"><Box size={15} />当前案例：{currentCase?.summary ?? caseDetail.summary ?? '人工示例'} <span>生成资格：不允许</span></div>
    </section>
  );
}

function StudioResult({ validation }: { validation: StudioValidation }) {
  const tone = (status: string) => status === 'compatible' || status === 'clear' || status === 'checked-clear' ? 'ok' : status === 'unknown' || status === 'blocked' || status === 'not-checked' || status === 'not-provided' ? 'warn' : 'bad';
  const summary = (kind: 'rule' | 'collision' | 'path', status: string, fallback: string) => kind === 'rule' ? (status === 'compatible' ? '来源接口参数满足当前规则；这不等同于碰撞或安装路径通过。' : status === 'unknown' ? '当前资料不足，暂时无法判断这条连接规则。' : fallback) : kind === 'collision' ? (status === 'clear' ? '最终姿态未发现实体穿透；表面接触是允许的。' : status === 'collision' ? '最终姿态存在不允许的实体重叠。' : '当前资料不足，暂时无法判断最终碰撞。') : (status === 'checked-clear' ? '按两件真实零件的刚体取样未发现碰撞；不包含形变、保持力或实物验证。' : status === 'checked-collision' ? '按两件真实零件的刚体取样发现碰撞。' : status === 'not-checked' ? '当前取样姿态无法绑定到合法 seat，暂时无法判断安装路径。' : status === 'not-provided' ? '只保存了最终位置，没有提供安装过程。' : fallback);
  const labels: Record<string, string> = { compatible: '规则成立', unknown: '暂时无法判断', incompatible: '规则不成立', clear: '未发现实体碰撞', collision: '发现实体碰撞', blocked: '暂时无法判断', 'checked-clear': '已检查：取样未发现碰撞', 'checked-collision': '已检查：取样发现碰撞', 'not-checked': '暂时无法判断', 'not-provided': '未提供安装过程' };
  return <section className="studio-result"><h3>检查结果 <span className="studio-result-tag">人工示例 · 未进入正式生成</span></h3><div className="studio-result-grid">
    <article><h4>用户认为可行</h4><strong>已提交（人工判断）</strong><p>这是你的判断，不是软件验证结论。</p></article>
    <article className={tone(validation.rule.status)}><h4>规则检查</h4><strong>{labels[validation.rule.status] ?? '暂时无法判断'}</strong><p>{summary('rule', validation.rule.status, validation.rule.reason)}</p><details className="studio-reason"><summary>规则原始诊断</summary><p>{validation.rule.reason}</p></details><small>{validation.rule.ruleId ?? '无规则'} · 姿态偏差 {fmt(validation.rule.poseAngleDeg ?? 0)}° / {fmt(validation.rule.poseDistanceLdu ?? 0)} LDU</small></article>
    <article className={tone(validation.finalCollision.status)}><h4>最终碰撞</h4><strong>{labels[validation.finalCollision.status] ?? '暂时无法判断'}</strong><p>{summary('collision', validation.finalCollision.status, validation.finalCollision.reason)}</p><details className="studio-reason"><summary>碰撞原始诊断</summary><p>{validation.finalCollision.reason}</p></details>{validation.finalCollision.witness ? <small>位置 {validation.finalCollision.witness.map(fmt).join(', ')}</small> : null}</article>
    <article className={tone(validation.path.status)}><h4>安装路径</h4><strong>{labels[validation.path.status] ?? '暂时无法判断'}</strong><p>{summary('path', validation.path.status, validation.path.reason)}</p><details className="studio-reason"><summary>路径原始诊断</summary><p>{validation.path.reason}</p></details><small>{validation.path.samples} 个取样 · {validation.path.scope}</small>{validation.path.status === 'not-checked' ? <small>当前取样姿态没有绑定到合法 seat，不能断言路径通过；这不是失败，也不是通过。</small> : null}</article>
  </div><p className="studio-warning"><CircleAlert size={15} />{validation.limitations.join(' ')}</p><p className="studio-generation">正式生成资格：禁止（人工示例不会自动授权）。</p></section>;
}
