import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUp, Box, Camera, CheckCircle2, CircleAlert, Download, FileDown, Play, Redo2,
  RotateCcw, RotateCw, Save, Search, Undo2, Upload, X,
} from 'lucide-react';
import AnimatedPairViewer, {
  type PairCamera, type PairTool, type PairTransform, type PairView, type PairViewerHandle,
} from './AnimatedPairViewer.js';
import AssemblyCasePlayer from './AssemblyCasePlayer.js';
import type { NativeConnectionPoint, NativeMesh } from './NativePartViewer.js';

type StudioTool = 'move' | 'rotate' | 'orbit';
type Vec = [number, number, number];
type Mat = [number, number, number, number, number, number, number, number, number];
type PairViewer = PairView;

interface CatalogPart { partId: string; name: string; tags: string[]; featureCount: number; maleCount: number; femaleCount: number; productionCount: number }
interface CatalogExample {
  id: string; ruleId: string; label: string; status: 'validated' | 'source-candidate' | 'blocked' | 'unverified';
  fixedPartId: string; movingPartId: string; fixedConnectionId: string | null; movingConnectionId: string | null;
  caseId: string | null; summary: string; reason: string | null;
}
interface CatalogRule {
  id: string; label: string; description: string; status: string; production: boolean;
  maleFamilies: string[]; femaleFamilies: string[]; instanceCount: number; partCount: number;
  parts: CatalogPart[]; examples: CatalogExample[]; gap: string | null;
}
interface CatalogFamily { id: string; label: string; description: string; status: string; instanceCount: number; partCount: number; parts: CatalogPart[]; rules: string[] }
interface StudioCatalog { generatedAt: string; rules: CatalogRule[]; families: CatalogFamily[]; partTags: { id: string; label: string; partCount: number }[]; limitations: string[] }
interface PartPayload { geometry: { mesh: NativeMesh }; connections: { points: NativeConnectionPoint[] } }
interface StudioPreparation {
  fixedPartId: string; movingPartId: string; fixedConnectionId: string | null; movingConnectionId: string | null;
  fixedInitial: { rotation: Mat; translation: Vec }; movingInitial: { rotation: Mat; translation: Vec }; movingFinal: { rotation: Mat; translation: Vec };
  axis: Vec; insertionDepthLdu: number;
  compatibility: { status: 'compatible' | 'incompatible' | 'unknown'; ruleId: string | null; reason: string; reasonCode: string; allowedTwistsDeg: number[] };
  suggestions: { transform: { rotation: Mat; translation: Vec }; twistDeg: number; ruleId: string }[];
  notice: string;
}
interface StudioValidation {
  rule: { status: string; ruleId: string | null; reason: string; reasonCode: string; sourceIds: string[]; allowedTwistsDeg: number[]; poseAngleDeg: number | null; poseDistanceLdu: number | null };
  finalCollision: { status: string; reasonCode: string; reason: string; witness: Vec | null };
  path: { status: string; samples: number; reason: string; scope: string; witness: Vec | null };
  suggestions: { transform: { rotation: Mat; translation: Vec }; twistDeg: number; ruleId: string }[];
  generationEligible: false; physicalBuildVerified: false; limitations: string[];
}
interface StudioExample {
  id: string; rootId: string; version: number; previousId: string | null; status: 'draft' | 'pending-review';
  categoryId: string; fixedPartId: string; movingPartId: string; mode: string;
  fixedInstanceId: string; movingInstanceId: string;
  fixedInitial: { rotation: Mat; translation: Vec }; movingInitial: { rotation: Mat; translation: Vec }; movingFinal: { rotation: Mat; translation: Vec };
  keyframes: { id: string; label: string; transform: { rotation: Mat; translation: Vec } }[];
  fixedConnectionId: string | null; movingConnectionId: string | null;
  camera: PairCamera; previewDataUrl: string | null;
  relativeTransform: { rotation: Mat; translation: Vec };
  candidatePoint?: { partId: string; localPosition: Vec; note: string };
  userClaim: { connectionNote: string; reason: string; physicallyBuilt: boolean; attachments: { kind: string; url?: string; note?: string }[] };
  validation: StudioValidation; stale: boolean; createdAt: string; updatedAt: string;
}
interface StudioExampleSummary {
  id: string; rootId: string; version: number; createdAt: string; updatedAt: string; mode: string; status: 'draft' | 'pending-review'; categoryId: string;
  fixedPartId: string; movingPartId: string; ruleId: string | null; pathStatus: string; stale: boolean;
}

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
const thumb = (partId: string) => `/api/parts-foundation/parts/${encodeURIComponent(partId)}/thumbnail`;
const defaultCamera: PairCamera = { position: [0, 0, 200], target: [0, 0, 0], view: 'side' };

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
  const [catalog, setCatalog] = useState<StudioCatalog | null>(null);
  const [categoryId, setCategoryId] = useState('C01');
  const [exampleId, setExampleId] = useState<string | null>(null);
  const [fixedPartId, setFixedPartId] = useState('');
  const [movingPartId, setMovingPartId] = useState('');
  const [fixed, setFixed] = useState<PartPayload | null>(null);
  const [moving, setMoving] = useState<PartPayload | null>(null);
  const [fixedTransform, setFixedTransform] = useState<PairTransform>(identityTransform());
  const [startTransform, setStartTransform] = useState<PairTransform>(identityTransform());
  const [movingTransform, setMovingTransform] = useState<PairTransform>(identityTransform());
  const [fixedRoleId, setFixedRoleId] = useState<string | null>(null);
  const [movingRoleId, setMovingRoleId] = useState<string | null>(null);
  const [prep, setPrep] = useState<StudioPreparation | null>(null);
  const [edgeAxis, setEdgeAxis] = useState<Vec>([0, -1, 0]);
  const [edgeDepth, setEdgeDepth] = useState(4);
  const [mode, setMode] = useState<'assisted' | 'free'>('assisted');
  const [tool, setTool] = useState<StudioTool>('move');
  const [view, setView] = useState<PairViewer>('side');
  const [step, setStep] = useState(1);
  const [angleStep, setAngleStep] = useState(5);
  const [history, setHistory] = useState<PairTransform[]>([]);
  const [redo, setRedo] = useState<PairTransform[]>([]);
  const [keyframes, setKeyframes] = useState<{ id: string; label: string; transform: PairTransform }[]>([]);
  const [pathProvided, setPathProvided] = useState(false);
  const [validation, setValidation] = useState<StudioValidation | null>(null);
  const [saved, setSaved] = useState<StudioExample | null>(null);
  const [examples, setExamples] = useState<StudioExampleSummary[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [connectionNote, setConnectionNote] = useState('');
  const [reason, setReason] = useState('');
  const [physicallyBuilt, setPhysicallyBuilt] = useState(false);
  const [attachmentLink, setAttachmentLink] = useState('');
  const [candidateEnabled, setCandidateEnabled] = useState(false);
  const [candidatePart, setCandidatePart] = useState<'A' | 'B'>('A');
  const [candidatePosition, setCandidatePosition] = useState<[string, string, string]>(['0', '0', '0']);
  const [candidateNote, setCandidateNote] = useState('');
  const [snap, setSnap] = useState<PairTransform | null>(null);
  const [suggestions, setSuggestions] = useState<StudioPreparation['suggestions']>([]);
  const [showConnections, setShowConnections] = useState(true);
  const [picking, setPicking] = useState<'A' | 'B' | null>(null);
  const [partSearch, setPartSearch] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [cameraRestore, setCameraRestore] = useState<PairCamera | null>(null);
  const [viewerReady, setViewerReady] = useState(0);
  const [rootId, setRootId] = useState<string | null>(null);

  const rule = catalog?.rules.find(item => item.id === categoryId) ?? null;
  const allParts = useMemo(() => {
    const seen = new Map<string, CatalogPart>();
    for (const family of catalog?.families ?? []) for (const part of family.parts) if (!seen.has(part.partId)) seen.set(part.partId, part);
    return [...seen.values()].sort((a, b) => a.partId.localeCompare(b.partId));
  }, [catalog]);
  const parts = rule?.parts.length ? rule.parts : allParts;
  const filteredParts = useMemo(() => {
    const query = partSearch.trim().toLowerCase();
    return query ? parts.filter(part => `${part.partId} ${part.name} ${part.tags.join(' ')}`.toLowerCase().includes(query)) : parts;
  }, [parts, partSearch]);

  const loadExampleList = async () => { try { setExamples(await request<StudioExampleSummary[]>('/studio/examples')); } catch { /* optional */ } };

  useEffect(() => { void (async () => {
    try {
      const [nextCatalog] = await Promise.all([request<StudioCatalog>('/studio/catalog')]);
      setCatalog(nextCatalog);
      const preferredRule = (initialCaseId ? nextCatalog.rules.find(item => item.examples.some(example => example.caseId === initialCaseId)) : null)
        ?? nextCatalog.rules.find(item => item.examples.length > 0) ?? nextCatalog.rules[0];
      setCategoryId(preferredRule.id);
      const preferredExample = (initialCaseId ? preferredRule.examples.find(example => example.caseId === initialCaseId) : null) ?? preferredRule.examples[0];
      if (preferredExample) await openCatalogExample(preferredRule, preferredExample);
      else await preparePair(preferredRule, preferredRule.parts[0]?.partId ?? '', preferredRule.parts[1]?.partId ?? '', true);
    } catch (failure) { setError(failure instanceof Error ? failure.message : '无法加载接口目录。'); }
  })(); void loadExampleList(); }, []);

  useEffect(() => { viewer.current?.setView(view); }, [view, fixed, moving]);
  useEffect(() => {
    if (!cameraRestore || !viewerReady) return;
    const timer = window.setTimeout(() => viewer.current?.setCamera(cameraRestore), 40);
    return () => window.clearTimeout(timer);
  }, [cameraRestore, viewerReady]);

  useEffect(() => {
    if (!picking && !previewOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [picking, previewOpen]);

  const loadPair = async (fixedId: string, movingId: string, category: CatalogRule | null): Promise<boolean> => {
    const [fixedPart, movingPart] = await Promise.all([partRequest<PartPayload>(fixedId), partRequest<PartPayload>(movingId)]);
    setFixed(fixedPart); setMoving(movingPart);
    setFixedPartId(fixedId); setMovingPartId(movingId);
    setFixedRoleId(null); setMovingRoleId(null); setPrep(null);
    setSuggestions([]); setSnap(null); setHistory([]); setRedo([]);
    setFixedTransform(identityTransform()); setStartTransform(identityTransform()); setMovingTransform(identityTransform());
    setEdgeAxis(category?.id === 'C01' ? [0, -1, 0] : [0, 1, 0]); setEdgeDepth(16);
    setValidation(null); setSaved(null); setRootId(null); setCameraRestore(null); setKeyframes([]); setPathProvided(false);
    return true;
  };

  const preparePair = async (category: CatalogRule, fixedId: string, movingId: string, initial = false) => {
    if (!fixedId || !movingId) { setFixedPartId(fixedId); setMovingPartId(movingId); return; }
    setBusy(true); setError('');
    try {
      const preparation = await request<StudioPreparation>('/studio/prepare', {
        method: 'POST', body: JSON.stringify({ fixedPartId: fixedId, movingPartId: movingId, ruleId: category.production || category.examples.length ? category.id : null }),
      });
      await loadPair(preparation.fixedPartId, preparation.movingPartId, category);
      setPrep(preparation);
      setFixedTransform(preparation.fixedInitial); setStartTransform(preparation.movingInitial); setMovingTransform(preparation.movingInitial);
      setFixedRoleId(preparation.fixedConnectionId); setMovingRoleId(preparation.movingConnectionId);
      setEdgeAxis(preparation.axis); setEdgeDepth(preparation.insertionDepthLdu);
      setSuggestions(preparation.suggestions); setView('side');
      if (!initial) setExampleId(null);
    } catch (failure) {
      await loadPair(fixedId, movingId, category).catch(() => undefined);
      setPrep(null); setSuggestions([]); setFixedRoleId(null); setMovingRoleId(null); setEdgeAxis([0, -1, 0]); setEdgeDepth(0); setValidation(null); setSnap(null);
      setError(`当前门类资料不足，已进入自由示范：${failure instanceof Error ? failure.message : '无法计算来源姿态'}`);
    }
    setBusy(false);
  };

  const openCatalogExample = async (category: CatalogRule, example: CatalogExample) => {
    setCategoryId(category.id); setExampleId(example.id);
    await preparePair(category, example.fixedPartId, example.movingPartId, true);
    setConnectionNote(example.summary); setReason(example.reason ?? ''); setPhysicallyBuilt(false); setAttachmentLink('');
  };

  const chooseCategory = async (id: string) => {
    const next = catalog?.rules.find(item => item.id === id); if (!next) return;
    setCategoryId(id); setExampleId(null); setPreviewOpen(false);
    if (next.examples[0]) await openCatalogExample(next, next.examples[0]);
    else if (next.parts.length) await preparePair(next, next.parts[0].partId, next.parts[1]?.partId ?? next.parts[0].partId, true);
    else { setFixed(null); setMoving(null); setFixedPartId(''); setMovingPartId(''); setPrep(null); setValidation(null); }
  };

  const pickPart = async (partId: string) => {
    if (!picking) return;
    const nextFixed = picking === 'A' ? partId : fixedPartId;
    const nextMoving = picking === 'B' ? partId : movingPartId;
    setPicking(null); setPartSearch('');
    if (!rule) return;
    await preparePair(rule, nextFixed, nextMoving);
  };

  const swap = () => {
    if (!fixed || !moving) return;
    const previousFixed = fixedTransform;
    setFixed(moving); setMoving(fixed);
    setFixedPartId(movingPartId); setMovingPartId(fixedPartId);
    setFixedTransform(movingTransform); setMovingTransform(previousFixed); setStartTransform(previousFixed);
    setFixedRoleId(movingRoleId); setMovingRoleId(fixedRoleId);
    setValidation(null); setSaved(null); setRootId(null); setSnap(null); setHistory([]); setRedo([]);
  };

  const push = (next: PairTransform) => { setHistory(value => [...value.slice(-30), clone(movingTransform)]); setRedo([]); setMovingTransform(next); setSnap(null); };
  const change = (next: PairTransform) => {
    setMovingTransform(next);
    const nearest = suggestions.map(item => ({ transform: item.transform, distance: distance(item.transform.translation, next.translation), angle: angle(item.transform.rotation, next.rotation) })).sort((a, b) => Math.max(a.distance / 4, a.angle / 8) - Math.max(b.distance / 4, b.angle / 8))[0];
    setSnap(mode === 'assisted' && nearest && nearest.distance <= 18 && nearest.angle <= 35 ? nearest.transform : null);
  };
  const undo = () => { const previous = history.at(-1); if (!previous) return; setRedo(value => [...value, clone(movingTransform)]); setHistory(value => value.slice(0, -1)); setMovingTransform(previous); setSnap(null); };
  const redoAction = () => { const next = redo.at(-1); if (!next) return; setHistory(value => [...value, clone(movingTransform)]); setRedo(value => value.slice(0, -1)); setMovingTransform(next); setSnap(null); };
  const reset = () => { setMovingTransform(clone(startTransform)); setHistory([]); setRedo([]); setSnap(null); };
  const apply = (axis: 0 | 1 | 2, direction: 1 | -1, rotation = false) => { push(rotation ? rotate(movingTransform, axis, direction * angleStep) : translate(movingTransform, axis, direction * step)); };
  const snapNow = () => { if (snap) { push(clone(snap)); setSnap(null); } };

  const buildInput = (status: 'draft' | 'pending-review') => {
    if (!fixedPartId || !movingPartId) throw new Error('请先选择两件真实零件。');
    const camera = viewer.current?.getCamera() ?? defaultCamera;
    const previewDataUrl = viewer.current?.capture() ?? null;
    const frames = pathProvided && keyframes.length >= 2 ? keyframes.map((frame, index) => ({ ...frame, id: `frame-${index}`, recordedAt: new Date().toISOString() })) : [];
    return {
      mode, caseId: null, categoryId, fixedPartId, movingPartId,
      fixedInstanceId: 'A', movingInstanceId: 'B',
      fixedConnectionId: mode === 'assisted' ? fixedRoleId : null,
      movingConnectionId: mode === 'assisted' ? movingRoleId : null,
      fixedInitial: fixedTransform, movingInitial: startTransform, movingFinal: movingTransform,
      keyframes: frames, camera, previewDataUrl, rootId, status,
      ...(candidateEnabled ? { candidatePoint: { partId: candidatePart === 'A' ? fixedPartId : movingPartId, localPosition: candidatePosition.map(value => Number(value) || 0) as [number, number, number], note: candidateNote } } : {}),
      userClaim: {
        connectionNote: connectionNote || '手工摆放', reason: reason || '我希望提交这个拼接示例', physicallyBuilt,
        attachments: attachmentLink ? [{ kind: 'link' as const, url: attachmentLink, note: '用户提供的辅助证据链接' }] : [],
      },
    };
  };

  const preview = async () => {
    if (!fixedPartId || !movingPartId) return;
    setBusy(true); setError('');
    try { setValidation(await request<StudioValidation>('/studio/validate', { method: 'POST', body: JSON.stringify(buildInput('pending-review')) })); }
    catch (failure) { setError(failure instanceof Error ? failure.message : '检查失败。'); }
    setBusy(false);
  };

  const save = async (status: 'draft' | 'pending-review') => {
    if (!fixedPartId || !movingPartId) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await request<StudioExample>(status === 'draft' ? '/studio/drafts' : '/studio/examples', { method: 'POST', body: JSON.stringify(buildInput(status)) });
      setSaved(result); setValidation(result.validation); setRootId(result.rootId); setNotice(`${status === 'draft' ? '草稿' : '待复核示例'}已保存；版本 ${result.version}。`); await loadExampleList(); onSaved?.();
    } catch (failure) { setError(`保存失败，当前编辑内容仍保留：${failure instanceof Error ? failure.message : '未知错误'}`); }
    setBusy(false);
  };

  const loadSaved = async (id: string) => {
    setBusy(true); setError(''); setNotice('');
    try {
      const example = await request<StudioExample>(`/studio/examples/${encodeURIComponent(id)}`);
      const [fixedPart, movingPart] = await Promise.all([partRequest<PartPayload>(example.fixedPartId), partRequest<PartPayload>(example.movingPartId)]);
      setFixed(fixedPart); setMoving(movingPart);
      setFixedPartId(example.fixedPartId); setMovingPartId(example.movingPartId);
      setCategoryId(catalog?.rules.some(item => item.id === example.categoryId) ? example.categoryId : (example.validation.rule.ruleId ?? 'C01'));
      setFixedTransform(example.fixedInitial); setStartTransform(example.movingInitial); setMovingTransform(example.movingFinal);
      setFixedRoleId(example.fixedConnectionId); setMovingRoleId(example.movingConnectionId);
      setKeyframes(example.keyframes.map(frame => ({ id: frame.id, label: frame.label, transform: frame.transform })));
      setPathProvided(example.keyframes.length > 0);
      setValidation(example.validation); setSaved(example); setRootId(example.rootId);
      setConnectionNote(example.userClaim.connectionNote); setReason(example.userClaim.reason); setPhysicallyBuilt(example.userClaim.physicallyBuilt);
      setAttachmentLink(example.userClaim.attachments.find(item => item.url)?.url ?? '');
      setCandidateEnabled(Boolean(example.candidatePoint));
      setCandidatePart(example.candidatePoint?.partId === example.movingPartId ? 'B' : 'A');
      setCandidatePosition(example.candidatePoint ? example.candidatePoint.localPosition.map((value: number) => String(value)) as [string, string, string] : ['0', '0', '0']);
      setCandidateNote(example.candidatePoint?.note ?? '');
      setMode(example.mode === 'free' ? 'free' : 'assisted'); setView(example.camera.view as PairViewer); setCameraRestore(example.camera);
      setHistory([]); setRedo([]); setSnap(null); setSuggestions([]); setPrep(null); setEdgeAxis([0, -1, 0]); setEdgeDepth(32); setPreviewOpen(false);
      if (catalog && example.categoryId) { try { const axisPrep = await request<StudioPreparation>('/studio/prepare', { method: 'POST', body: JSON.stringify({ fixedPartId: example.fixedPartId, movingPartId: example.movingPartId, ruleId: example.categoryId }) }); setEdgeAxis(axisPrep.axis); setEdgeDepth(axisPrep.insertionDepthLdu); setSuggestions(axisPrep.suggestions); } catch { /* saved pose remains authoritative */ } }
      setNotice(`已打开 ${example.rootId} · 版本 ${example.version}${example.stale ? ' · 来源已变化，需重新检查' : ''}`);
    } catch (failure) { setError(failure instanceof Error ? failure.message : '打开示例失败。'); }
    setBusy(false);
  };

  const revalidateSaved = async () => {
    if (!saved) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await request<StudioExample>(`/studio/examples/${encodeURIComponent(saved.id)}/revalidate`, { method: 'POST' });
      setSaved(result); setValidation(result.validation); setNotice(`已按当前来源与规则重新检查；版本 ${result.version}，处理历史已追加。`); await loadExampleList(); onSaved?.();
    } catch (failure) { setError(`重新检查失败：${failure instanceof Error ? failure.message : '未知错误'}`); }
    setBusy(false);
  };

  const exportBundle = async () => {
    try {
      const response = await fetch('/api/interface-library/studio/export');
      if (!response.ok) throw new Error(`导出失败 (${response.status})`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `bricklab-studio-bundle-${new Date().toISOString().slice(0, 10)}.json`; anchor.click();
      URL.revokeObjectURL(url);
      setNotice('反馈包已下载。请在下一轮 DeepSeek 对话中上传该 JSON；它不会自动被读取。');
    } catch (failure) { setError(failure instanceof Error ? failure.message : '导出失败。'); }
  };

  const importBundle = async (file: File) => {
    setBusy(true); setError(''); setNotice('');
    try {
      const value: unknown = JSON.parse(await file.text());
      const result = await request<{ imported: number; skipped: number; errors: string[] }>('/studio/import', { method: 'POST', body: JSON.stringify(value) });
      setNotice(`已导入 ${result.imported} 条草稿；跳过 ${result.skipped} 条${result.errors.length ? `；${result.errors.length} 条错误` : ''}。`);
      await loadExampleList();
    } catch (failure) { setError(failure instanceof Error ? failure.message : '导入失败。'); }
    setBusy(false);
  };

  const previewDetail = useMemo(() => {
    if (!fixedPartId || !movingPartId) return null;
    return {
      id: `studio-preview-${fixedPartId}-${movingPartId}`, label: '工作台动作示意', ruleId: rule?.id ?? '', status: 'validated', caseType: 'specification',
      fixedPartId, movingPartId,
      edge: { fixedConnectionId: fixedRoleId, movingConnectionId: movingRoleId, ruleId: rule?.id ?? '', axis: edgeAxis, insertionDepthLdu: edgeDepth },
      placements: [
        { instanceId: 'A', partId: fixedPartId, transform: fixedTransform },
        { instanceId: 'B', partId: movingPartId, transform: movingTransform },
      ],
      validation: { engineAccepted: validation?.rule.status === 'compatible', graphValid: false, collisionStatus: validation?.finalCollision.status ?? 'not-run', installationPath: 'not-validated', reasons: validation ? [validation.path.reason] : [] },
      displayNotice: '动作示意：只演示姿态变化；安装路径尚未验证，不是撞击或实物认证。',
    } as unknown as Parameters<typeof AssemblyCasePlayer>[0]['detail'];
  }, [fixedPartId, movingPartId, fixedRoleId, movingRoleId, rule?.id, edgeAxis, edgeDepth, fixedTransform, movingTransform, validation]);

  if (!catalog) return <section className="studio"><p className="studio-loading">{error || '正在读取真实接口目录与零件…'}</p></section>;
  if ((!fixed || !moving) && busy) return <section className="studio"><p className="studio-loading">正在准备真实零件与来源姿态…</p></section>;
  if (!fixed || !moving) return <section className="studio"><header className="studio-heading"><div><p className="eyebrow">MANUAL ASSEMBLY STUDIO</p><h2>我来拼搭</h2><p>按门类选择真实零件；当前门类没有可用零件时，会明确显示资料缺口。</p></div></header>{error ? <p className="studio-error">{error}</p> : null}<div className="studio-category-row"><label>拼接门类<select value={categoryId} onChange={event => void chooseCategory(event.target.value)}>{catalog.rules.map(item => <option key={item.id} value={item.id}>{item.label} · {item.examples.length} 示例 / {item.parts.length} 零件</option>)}</select></label></div><section className="studio-gap"><CircleAlert size={18} /><div><strong>{rule?.label ?? '未选择门类'}</strong><p>{rule?.gap ?? '该门类没有可选的来源零件。'}</p></div></section></section>;

  const nearest = snap ? { distance: distance(snap.translation, movingTransform.translation), angle: angle(snap.rotation, movingTransform.rotation) } : null;
  const statusText = saved ? `${saved.status === 'draft' ? '草稿' : '待复核'} · 版本 ${saved.version} · ${new Date(saved.updatedAt).toLocaleString()}` : null;
  const selectedExample = rule?.examples.find(item => item.id === exampleId) ?? null;

  return (
    <section className="studio">
      <header className="studio-heading">
        <div><p className="eyebrow">MANUAL ASSEMBLY STUDIO</p><h2>我来拼搭</h2><p>选择拼接门类与两件真实零件，查看动作示意后亲手摆放；保存的是带来源、姿态、相机和关键帧的版本化示例。</p></div>
        <div className="studio-header-actions">
          <button type="button" onClick={() => void exportBundle()}><FileDown size={15} />导出给 DeepSeek</button>
          <label className="studio-file"><Upload size={15} />导入反馈包<input type="file" accept="application/json,.json" onChange={event => { const file = event.target.files?.[0]; if (file) void importBundle(file); event.currentTarget.value = ''; }} /></label>
        </div>
      </header>
      {error ? <p className="studio-error">{error}</p> : null}
      {notice ? <p className="studio-notice">{notice}</p> : null}
      <div className="studio-category-row">
        <label>拼接门类<select value={categoryId} onChange={event => void chooseCategory(event.target.value)}>{(catalog.rules).map(item => <option key={item.id} value={item.id}>{item.label} · {item.examples.length} 示例 / {item.parts.length} 零件{item.gap ? ' · 有缺口' : ''}</option>)}</select></label>
        <div className="studio-category-note"><strong>{rule?.label}</strong><span>{rule?.production ? '正式生产规则' : rule?.status === 'conditional' ? '条件规则 / 自由示范' : '目录条目'}</span>{rule?.gap ? <p>{rule.gap}</p> : null}</div>
      </div>
      {rule?.examples.length ? <div className="studio-example-strip"><span>真实示例</span>{rule.examples.map(example => <button type="button" key={example.id} className={`${selectedExample?.id === example.id ? 'active' : ''} ${example.status}`} onClick={() => void openCatalogExample(rule, example)}><strong>{example.status === 'blocked' ? '已阻止' : example.status === 'validated' ? '已验证' : example.status === 'source-candidate' ? '来源候选' : '未验证'}</strong><span>{example.fixedPartId} → {example.movingPartId}</span><small>{example.summary}</small></button>)}</div> : <p className="studio-gap-inline"><CircleAlert size={15} />{rule?.gap ?? '该门类还没有可播放的真实示例；可在下方选择零件自由示范。'}</p>}

      <div className="studio-parts-row">
        <button type="button" className="studio-part-card" onClick={() => { setPicking('A'); setPartSearch(''); }}>
          <span className="studio-part-label">固定 A</span><img src={thumb(fixedPartId)} alt={`${fixedPartId} 真实几何缩略图`} onError={event => { event.currentTarget.style.visibility = 'hidden'; }} />
          <span><strong>{fixedPartId}</strong><small>{parts.find(item => item.partId === fixedPartId)?.name ?? '真实来源零件'}</small></span>
        </button>
        <button type="button" className="studio-swap" onClick={swap} title="交换固定与移动对象">⇄<span>交换</span></button>
        <button type="button" className="studio-part-card" onClick={() => { setPicking('B'); setPartSearch(''); }}>
          <span className="studio-part-label">移动 B</span><img src={thumb(movingPartId)} alt={`${movingPartId} 真实几何缩略图`} onError={event => { event.currentTarget.style.visibility = 'hidden'; }} />
          <span><strong>{movingPartId}</strong><small>{parts.find(item => item.partId === movingPartId)?.name ?? '真实来源零件'}</small></span>
        </button>
        <div className="studio-pair-actions"><button type="button" onClick={() => setPreviewOpen(true)} disabled={!previewDetail}><Play size={15} />看动作示意</button><span>{mode === 'assisted' ? '辅助拼搭' : '自由示范'} · {rule?.production ? '生产规则' : '待验证'}</span></div>
      </div>

      <div className="studio-mode-row"><div className="segmented"><button type="button" className={mode === 'assisted' ? 'active' : ''} onClick={() => setMode('assisted')}>辅助拼搭</button><button type="button" className={mode === 'free' ? 'active' : ''} onClick={() => setMode('free')}>自由示范</button></div><span className="studio-hint">{mode === 'assisted' ? '辅助拼搭只在来源规则成立时提示；吸附不等于完整验证。' : '自由示范不吸附、不纠正；重叠只警告，结果只能保存为待验证示例。'}</span></div>

      <div className="studio-workbench">
        <div className="studio-stage">
          <AnimatedPairViewer ref={viewer} fixedMesh={fixed.geometry.mesh} movingMesh={moving.geometry.mesh} fixedPoints={fixed.connections.points} movingPoints={moving.connections.points} fixedTransform={fixedTransform} movingTransform={movingTransform} fixedConnectionId={fixedRoleId} movingConnectionId={movingRoleId} interactive={tool !== 'orbit'} tool={tool === 'rotate' ? 'rotate' : 'move'} showConnections={showConnections} snapTransform={mode === 'assisted' ? snap : null} onTransformChange={change} onTransformCommit={() => void preview()} onReady={() => setViewerReady(value => value + 1)} />
          <div className="studio-stage-legend"><span><i className="dot fixed" />固定件 A · {fixedPartId}</span><span><i className="dot moving" />移动件 B · {movingPartId}</span><span>辅助显示色，不代表真实颜色</span></div>
          <div className="studio-view-row">{(['free', 'front', 'side', 'top'] as PairView[]).map(item => <button type="button" key={item} className={view === item ? 'active' : ''} onClick={() => { setView(item); viewer.current?.setView(item); }}>{item === 'free' ? '自由' : item === 'front' ? '正视' : item === 'side' ? '侧视' : '俯视'}</button>)}<label><input type="checkbox" checked={showConnections} onChange={event => setShowConnections(event.target.checked)} />连接位置</label></div>
        </div>
        <aside className="studio-controls">
          <div className="studio-tool-tabs"><button type="button" className={tool === 'move' ? 'active' : ''} onClick={() => setTool('move')}><ArrowUp size={16} />移动这个零件</button><button type="button" className={tool === 'rotate' ? 'active' : ''} onClick={() => setTool('rotate')}><RotateCw size={16} />旋转这个零件</button><button type="button" className={tool === 'orbit' ? 'active' : ''} onClick={() => setTool('orbit')}><Camera size={16} />转动视角</button></div>
          <div className="studio-step-row"><label>移动步长 <input type="number" min="0.1" max="20" step="0.5" value={step} onChange={event => setStep(Math.max(0.1, Math.min(20, Number(event.target.value) || 1)))} /></label><label>角度步长 <input type="number" min="1" max="90" step="1" value={angleStep} onChange={event => setAngleStep(Math.max(1, Math.min(90, Number(event.target.value) || 5)))} /></label><span>单位：LDU / °</span></div>
          <div className="studio-axis-grid">{([0, 1, 2] as const).map(axis => <div key={axis}><strong>{['X', 'Y', 'Z'][axis]}</strong><button type="button" onClick={() => apply(axis, -1, tool === 'rotate')}>{tool === 'rotate' ? '↺' : '−'}</button><button type="button" onClick={() => apply(axis, 1, tool === 'rotate')}>{tool === 'rotate' ? '↻' : '+'}</button></div>)}</div>
          <div className="studio-actions"><button type="button" onClick={undo} disabled={!history.length}><Undo2 size={15} />撤销</button><button type="button" onClick={redoAction} disabled={!redo.length}><Redo2 size={15} />重做</button><button type="button" onClick={reset}><RotateCcw size={15} />恢复原始位置</button></div>
          <div className={`studio-snap ${mode === 'free' ? 'free' : snap ? 'ready' : ''}`}>{mode === 'free' ? '自由示范：不吸附，不自动判断为通过。' : snap ? `接近候选位置，偏差约 ${fmt(nearest?.distance ?? 0)} LDU / ${fmt(nearest?.angle ?? 0)}°。吸附只表示姿态接近，仍需检查碰撞。` : suggestions.length ? '已有来源候选姿态；可以慢慢移动，或先吸附到候选后再检查。' : prep?.compatibility.status === 'unknown' ? '当前资料不足，暂时无法判断；可以在自由示范中继续摆放。' : '移动零件靠近候选连接位置时会出现吸附预览。'}{snap ? <button type="button" onClick={snapNow}>吸附到最近候选</button> : suggestions.length && mode === 'assisted' ? <button type="button" onClick={() => { setMovingTransform(clone(suggestions[0].transform)); setSnap(null); }}>吸附到来源候选姿态</button> : null}</div>
          <div className="studio-keyframes"><h3>记录关键帧</h3><div><button type="button" onClick={() => { const frame = { id: 'start', label: '起始位置', transform: clone(movingTransform) }; setStartTransform(clone(movingTransform)); setKeyframes([frame]); setPathProvided(true); }}>记录起始位置</button><button type="button" onClick={() => { setKeyframes(frames => [...frames, { id: `p${frames.length}`, label: `过程 ${frames.length + 1}`, transform: clone(movingTransform) }]); setPathProvided(true); }}>添加过程位置</button><button type="button" onClick={() => { setKeyframes(frames => [...frames, { id: 'final', label: '连接完成位置', transform: clone(movingTransform) }]); setPathProvided(true); }}>记录连接完成位置</button></div><ol>{keyframes.map((frame, index) => <li key={`${frame.id}-${index}`}>{frame.label}<span>{fmt(frame.transform.translation[0])}, {fmt(frame.transform.translation[1])}, {fmt(frame.transform.translation[2])}</span></li>)}</ol><p>{pathProvided ? `已记录 ${keyframes.length} 个关键帧；插值只是候选路径，未经检查不标记为验证通过。` : '未提供安装过程；提交时会明确标注。'}</p></div>
          <details className="studio-technical"><summary>技术详情（矩阵 / 原始状态）</summary><pre>{JSON.stringify({ fixedInstance: 'A', movingInstance: 'B', convention: 'A-local-to-B-local-rigid-v1', fixed: fixedTransform, moving: movingTransform, relative: prep?.fixedPartId ? '服务端保存时计算' : '待保存', keyframes }, null, 2)}</pre></details>
        </aside>
      </div>

      <div className="studio-submit">
        <div className="studio-claim">
          <h3>提交我的拼搭示例</h3>
          <p className="studio-summary">门类：{rule?.label ?? '—'} · 固定 A {fixedPartId} · 移动 B {movingPartId} · 当前姿态 {fmt(movingTransform.translation[0])}, {fmt(movingTransform.translation[1])}, {fmt(movingTransform.translation[2])}</p>
          <label>你认为这两个零件应该怎样连接？<input value={connectionNote} onChange={event => setConnectionNote(event.target.value)} placeholder="例如：四个凸点全部进入凹槽" maxLength={2000} /></label>
          <label>当前程序哪里判断不对？<textarea value={reason} onChange={event => setReason(event.target.value)} placeholder="写下你的判断；人工说明不会自动生成全局规则。" maxLength={5000} rows={3} /></label>
          <label>你是否亲自用实物这样拼过？<span className="inline"><input type="checkbox" checked={physicallyBuilt} onChange={event => setPhysicallyBuilt(event.target.checked)} />是，我亲自拼过</span></label>
          <label>还有什么需要说明？<input value={attachmentLink} onChange={event => setAttachmentLink(event.target.value)} placeholder="可填写截图/视频链接；本轮不接收二进制上传" maxLength={1000} /></label>
          <p className="studio-hint">附件只保存链接；未实现二进制上传，因此不展示上传按钮。说明、勾选和姿态会作为同一版本保存。</p>
          <div className="studio-candidate"><label className="inline"><input type="checkbox" checked={candidateEnabled} onChange={event => setCandidateEnabled(event.target.checked)} />标记一个候选连接位置（可选，人工信息，不是来源端点）</label>{candidateEnabled ? <div className="studio-candidate-grid"><label>所在零件<select value={candidatePart} onChange={event => setCandidatePart(event.target.value as 'A' | 'B')}><option value="A">A {fixedPartId}</option><option value="B">B {movingPartId}</option></select></label>{([0, 1, 2] as const).map(axis => <label key={axis}>{['X', 'Y', 'Z'][axis]}<input type="number" value={candidatePosition[axis]} onChange={event => setCandidatePosition(value => value.map((item, index) => index === axis ? event.target.value : item) as [string, string, string])} /></label>)}<label className="wide">说明<input value={candidateNote} onChange={event => setCandidateNote(event.target.value)} placeholder="例如：我认为夹口应卡在杆的中段" maxLength={500} /></label></div> : null}</div>
        </div>
        <div className="studio-run">
          <button type="button" className="primary large" onClick={() => void preview()} disabled={busy}>{busy ? '处理中…' : '运行检查'}</button>
          <button type="button" className="large" onClick={() => void save('draft')} disabled={busy}><Save size={16} />保存草稿</button>
          <button type="button" className="large" onClick={() => void save('pending-review')} disabled={busy}><CheckCircle2 size={16} />提交待复核</button>
          <p>保存的是人工示例，不改变生产资格、规则或碰撞检查。保存失败会保留当前编辑内容。</p>
          {saved ? <div className="studio-save-status"><strong>已保存 {saved.id}</strong><span>{statusText}</span>{saved.previewDataUrl ? <img src={saved.previewDataUrl} alt="保存时的真实零件画面" /> : null}<button type="button" onClick={() => void loadSaved(saved.id)}>重新打开</button>{saved.stale ? <button type="button" onClick={() => void revalidateSaved()}>来源已变化，重新检查</button> : null}</div> : null}
        </div>
      </div>
      {validation ? <StudioResult validation={validation} /> : null}
      <section className="studio-examples"><h3>我的示例 <span>{examples.length} 条记录 · 多条版本不会互相覆盖</span></h3>{examples.length ? <div className="studio-example-list">{examples.map(item => <button type="button" key={item.id} onClick={() => void loadSaved(item.id)} className={saved?.id === item.id ? 'active' : ''}><strong>{item.fixedPartId} + {item.movingPartId}</strong><span>{item.categoryId} · 版本 {item.version} · {item.status === 'draft' ? '草稿' : '待复核'} · {item.pathStatus === 'not-provided' ? '未提供过程' : item.pathStatus === 'not-checked' ? '路径暂时无法判断' : item.pathStatus} {item.stale ? '· 来源已变化' : ''}</span><small>{new Date(item.updatedAt).toLocaleString()}</small></button>)}</div> : <p className="studio-hint">还没有保存的示例。先选择门类和真实零件，完成一次摆放并保存。</p>}</section>
      <div className="studio-current"><Box size={15} />数据保存在服务端 <code>data/interface-library/studio-examples.json</code>（不在 Git 中）；同一 `rootId` 的后续保存会生成新版本。反馈包不会自动被下一轮读取，请手动上传。</div>

      {picking ? <div className="studio-picker-overlay" role="dialog" aria-modal="true" aria-label="选择真实零件" onClick={() => setPicking(null)}><div className="studio-picker" onClick={event => event.stopPropagation()}><header><div><strong>选择零件 {picking}</strong><span>{rule?.label} · 显示当前门类有来源接口的零件；可搜索编号、名称或标签。标签只用于检索，不代表兼容资格。</span></div><button type="button" onClick={() => setPicking(null)}><X size={18} /></button></header><label className="studio-search"><Search size={15} /><input autoFocus value={partSearch} onChange={event => setPartSearch(event.target.value)} placeholder="搜索编号、名称或标签" /></label><div className="studio-part-grid">{filteredParts.map(part => <button type="button" key={part.partId} onClick={() => void pickPart(part.partId)} className={part.partId === (picking === 'A' ? fixedPartId : movingPartId) ? 'active' : ''}><img src={thumb(part.partId)} alt={`${part.partId} 缩略图`} loading="lazy" onError={event => { event.currentTarget.style.visibility = 'hidden'; }} /><span><strong>{part.partId}</strong><small>{part.name}</small><em>{part.tags.slice(0, 3).join(' · ') || '无标签'} · {part.featureCount} 接口</em></span></button>)}</div>{!filteredParts.length ? <p className="studio-hint">没有匹配的真实零件。</p> : null}</div></div> : null}

      {previewOpen && previewDetail ? <div className="studio-preview-overlay" onClick={() => setPreviewOpen(false)}><div className="studio-preview" onClick={event => event.stopPropagation()}><header><div><strong>动作示意</strong><span>只演示姿态变化；安装路径尚未验证。</span></div><button type="button" onClick={() => setPreviewOpen(false)}><X size={18} /></button></header><AssemblyCasePlayer detail={previewDetail} fixed={{ mesh: fixed.geometry.mesh, points: fixed.connections.points }} moving={{ mesh: moving.geometry.mesh, points: moving.connections.points }} onOpenStudio={() => setPreviewOpen(false)} /></div></div> : null}
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
