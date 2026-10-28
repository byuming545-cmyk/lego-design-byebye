import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { NativePartRepository } from '../assembly/source.js';
import { nativePartSourceHash, PART_LIBRARY_VERSION } from '../assembly/source.js';
import type { Matrix3, NativeAssemblyPart, NativePlacement, RigidTransform, Vector3 } from '../assembly/types.js';
import { checkNativePairCollision } from '../assembly/collision.js';
import { solveAttachment } from '../assembly/solver.js';
import { checkConnectionCompatibility } from '../assembly/compatibility.js';
import { ASSEMBLY_ENGINE_VERSION } from '../assembly/engine.js';
import { COLLISION_VERSION } from '../assembly/collision.js';
import { CONNECTION_RULE_VERSION } from '../assembly/compatibility.js';
import { CONNECTOR_GRAMMAR_RULES } from '../grammar/rules.js';
import { CONNECTOR_GRAMMAR_VERSION, CONNECTOR_SCHEMA_VERSION } from '../grammar/schema.js';
import { GRAMMAR_ADMISSION_VERSION } from '../grammar/admission.js';

export type StudioMode = 'assisted' | 'free';
export type StudioStatus = 'draft' | 'pending-review';
export interface StudioCamera { position: Vector3; target: Vector3; view: 'free' | 'front' | 'side' | 'top'; }
export interface StudioTransform { rotation: Matrix3; translation: Vector3 }
export interface StudioKeyframe { id: string; label: string; transform: StudioTransform; recordedAt: string }
export interface StudioAttachment { kind: 'none' | 'link'; url?: string; note?: string }
export interface StudioUserClaim { connectionNote: string; reason: string; physicallyBuilt: boolean; attachments: StudioAttachment[] }
export interface StudioCandidatePoint { partId: string; localPosition: Vector3; note: string }
export interface StudioBuildInput {
  mode: StudioMode;
  caseId: string | null;
  fixedPartId: string;
  movingPartId: string;
  fixedConnectionId: string | null;
  movingConnectionId: string | null;
  fixedInitial: StudioTransform;
  movingInitial: StudioTransform;
  movingFinal: StudioTransform;
  keyframes: StudioKeyframe[];
  userClaim: StudioUserClaim;
  candidatePoint?: StudioCandidatePoint;
  categoryId?: string;
  fixedInstanceId?: string;
  movingInstanceId?: string;
  camera?: StudioCamera;
  previewDataUrl?: string | null;
  rootId?: string | null;
  status?: StudioStatus;
}
export interface StudioSuggestion { transform: StudioTransform; twistDeg: number; ruleId: string }
export interface StudioPartSnapshot {
  partId: string; name: string; sourceSha256: string; revision: string;
  connections: { id: string; family: string; role: string; sourceId: string | null; sourcePath: string; line: number | null; raw: string | null }[];
}
interface NormalizedBuild extends StudioBuildInput {
  categoryId: string; fixedInstanceId: string; movingInstanceId: string; camera: StudioCamera;
  previewDataUrl: string | null; rootId: string | null; status: StudioStatus;
}
export interface StudioPreparation {
  fixedPartId: string; movingPartId: string;
  fixedConnectionId: string | null; movingConnectionId: string | null;
  fixedInitial: StudioTransform; movingInitial: StudioTransform; movingFinal: StudioTransform;
  axis: Vector3; insertionDepthLdu: number;
  compatibility: { status: 'compatible' | 'incompatible' | 'unknown'; ruleId: string | null; reason: string; reasonCode: string; allowedTwistsDeg: number[] };
  suggestions: StudioSuggestion[];
  notice: string;
}
export interface StudioValidation {
  rule: {
    status: 'compatible' | 'incompatible' | 'unknown'; ruleId: string | null; reason: string; reasonCode: string;
    sourceIds: string[]; allowedTwistsDeg: number[]; poseAngleDeg: number | null; poseDistanceLdu: number | null;
  };
  finalCollision: { status: 'clear' | 'collision' | 'blocked'; reasonCode: string; reason: string; witness: Vector3 | null };
  path: { status: 'checked-clear' | 'checked-collision' | 'not-checked' | 'not-provided'; samples: number; reason: string; scope: string; witness: Vector3 | null };
  userClaim: { connectionNote: string; reason: string; physicallyBuilt: boolean; attachments: StudioAttachment[] };
  suggestions: StudioSuggestion[];
  generationEligible: false;
  physicalBuildVerified: false;
  limitations: string[];
}
export interface StudioExample extends StudioBuildInput {
  id: string; rootId: string; version: number; previousId: string | null;
  createdAt: string; updatedAt: string; status: StudioStatus;
  categoryId: string; fixedInstanceId: string; movingInstanceId: string; camera: StudioCamera; previewDataUrl: string | null;
  relativeTransform: StudioTransform; relativeConvention: 'A-local-to-B-local-rigid-v1';
  fixed: StudioPartSnapshot; moving: StudioPartSnapshot;
  validation: StudioValidation;
  versions: { schema: string; grammar: string; admission: string; partLibrary: string; assemblyEngine: string; connectionRule: string; collision: string };
  stale: boolean;
  history: { at: string; action: string; note: string; validation: StudioValidation }[];
}
export interface StudioExampleSummary {
  id: string; rootId: string; version: number; createdAt: string; updatedAt: string; mode: StudioMode; status: StudioStatus; categoryId: string;
  fixedPartId: string; movingPartId: string; ruleId: string | null; pathStatus: StudioValidation['path']['status']; stale: boolean;
}
export interface StudioExportBundle {
  format: 'bricklab-studio-bundle'; bundleVersion: 1; generatedAt: string;
  storage: { kind: 'server-json'; path: string; note: string };
  schema: string; versions: typeof import('./studio.js').STUDIO_VERSIONS;
  instructions: string[]; examples: StudioExample[]; feedback: unknown[];
  sourceSummary: { parts: number; sources: number; missingSourceModels: string[] };
}
export interface StudioImportResult { imported: number; skipped: number; errors: string[]; }
export class StudioError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400) { super(message); }
}

const VERSIONS = { schema: CONNECTOR_SCHEMA_VERSION, grammar: CONNECTOR_GRAMMAR_VERSION, admission: GRAMMAR_ADMISSION_VERSION, partLibrary: PART_LIBRARY_VERSION, assemblyEngine: ASSEMBLY_ENGINE_VERSION, connectionRule: CONNECTION_RULE_VERSION, collision: COLLISION_VERSION };
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/;
const FEATURE = /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,999}$/;
const MAX_RECORDS = 1000;
const CATEGORY_BY_RULE: Record<string, string> = {
  'ldcad-standard-stud-to-capped-underside-v1': 'C01',
  'ldcad-source-declared-bar-clip-v1': 'BAR_CLIP',
  'ldcad-source-declared-pin-hole-v1': 'PIN_HOLE',
};
const categoryFor = (value: string | null | undefined, fallback = 'uncategorized') => value ? (CATEGORY_BY_RULE[value] ?? value) : fallback;

const zero: StudioTransform = { rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1], translation: [0, 0, 0] };
const DEFAULT_CAMERA: StudioCamera = { position: [0, 0, 120], target: [0, 0, 0], view: 'free' };
const transpose = (m: Matrix3): Matrix3 => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
const matrixVector = (m: Matrix3, v: Vector3): Vector3 => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
const matrixMultiply = (a: Matrix3, b: Matrix3): Matrix3 => { const out = new Array<number>(9).fill(0); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) out[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j]; return out as Matrix3; };
const relativeTransformOf = (fixed: StudioTransform, moving: StudioTransform): StudioTransform => {
  const rotation = transpose(fixed.rotation);
  const delta: Vector3 = [moving.translation[0] - fixed.translation[0], moving.translation[1] - fixed.translation[1], moving.translation[2] - fixed.translation[2]];
  return { rotation: matrixMultiply(rotation, moving.rotation), translation: matrixVector(rotation, delta) };
};
const isCamera = (value: unknown): value is StudioCamera => {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<StudioCamera>;
  return Array.isArray(item.position) && item.position.length === 3 && item.position.every(Number.isFinite)
    && Array.isArray(item.target) && item.target.length === 3 && item.target.every(Number.isFinite)
    && ['free', 'front', 'side', 'top'].includes(String(item.view));
};
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const isTransform = (value: unknown): value is StudioTransform => {
  if (!value || typeof value !== 'object') return false;
  const item = value as { rotation?: unknown; translation?: unknown };
  return Array.isArray(item.rotation) && item.rotation.length === 9 && item.rotation.every(Number.isFinite)
    && Array.isArray(item.translation) && item.translation.length === 3 && item.translation.every(Number.isFinite);
};
const copyTransform = (value: StudioTransform): StudioTransform => ({ rotation: [...value.rotation] as Matrix3, translation: [...value.translation] as Vector3 });
const placement = (instanceId: string, partId: string, transform: StudioTransform): NativePlacement => ({ instanceId, partId, transform: copyTransform(transform) });
const angleOf = (a: Matrix3, b: Matrix3) => {
  const trace = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] + a[4] * b[4] + a[5] * b[5] + a[6] * b[6] + a[7] * b[7] + a[8] * b[8];
  return Math.acos(clamp((trace - 1) / 2, -1, 1)) * 180 / Math.PI;
};
const distanceOf = (a: Vector3, b: Vector3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
function nearestSuggestion(input: StudioBuildInput, part: NativeAssemblyPart, fixed: NativeAssemblyPart): { candidate: Awaited<ReturnType<typeof solveAttachment>>['candidates'][number] | null; angle: number | null; distance: number | null; suggestions: StudioSuggestion[] } {
  if (!input.fixedConnectionId || !input.movingConnectionId) return { candidate: null, angle: null, distance: null, suggestions: [] };
  const solved = solveAttachment({ fixedPart: fixed, fixedPlacement: placement('fixed', fixed.partId, input.fixedInitial), fixedConnectionId: input.fixedConnectionId, movingPart: part, movingConnectionId: input.movingConnectionId });
  if (solved.status !== 'solved' || !solved.candidates.length) return { candidate: null, angle: null, distance: null, suggestions: [] };
  const ranked = solved.candidates.map(candidate => ({ candidate, angle: angleOf(input.movingFinal.rotation, candidate.transform.rotation), distance: distanceOf(input.movingFinal.translation, candidate.transform.translation) }));
  ranked.sort((a, b) => Math.max(a.angle / 3, a.distance / 2) - Math.max(b.angle / 3, b.distance / 2));
  return { candidate: ranked[0].candidate, angle: ranked[0].angle, distance: ranked[0].distance, suggestions: ranked.map(item => ({ transform: copyTransform(item.candidate.transform), twistDeg: item.candidate.twistDeg, ruleId: item.candidate.penetrationZone.ruleId })) };
}
function summary(record: StudioExample): StudioExampleSummary {
  return { id: record.id, rootId: record.rootId, version: record.version, createdAt: record.createdAt, updatedAt: record.updatedAt, mode: record.mode, status: record.status, categoryId: record.categoryId, fixedPartId: record.fixedPartId, movingPartId: record.movingPartId, ruleId: record.validation.rule.ruleId, pathStatus: record.validation.path.status, stale: record.stale };
}
function sampleTransforms(input: StudioBuildInput): StudioTransform[] {
  const frames = input.keyframes.length >= 2 ? input.keyframes.map(frame => frame.transform) : [input.movingInitial, input.movingFinal];
  const out: StudioTransform[] = [copyTransform(frames[0])];
  for (let segment = 0; segment < frames.length - 1; segment++) {
    const a = frames[segment], b = frames[segment + 1];
    const distance = distanceOf(a.translation, b.translation);
    const angle = angleOf(a.rotation, b.rotation);
    const steps = Math.max(2, Math.min(16, Math.ceil(Math.max(distance / 4, angle / 12)) + 1));
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      out.push({ rotation: interpolateMatrix(a.rotation, b.rotation, t), translation: [a.translation[0] + (b.translation[0] - a.translation[0]) * t, a.translation[1] + (b.translation[1] - a.translation[1]) * t, a.translation[2] + (b.translation[2] - a.translation[2]) * t] });
    }
  }
  return out;
}
function matToQuat(m: Matrix3): [number, number, number, number] {
  const trace = m[0] + m[4] + m[8];
  if (trace > 0) { const s = Math.sqrt(trace + 1) * 2; return [(m[7] - m[5]) / s, (m[2] - m[6]) / s, (m[3] - m[1]) / s, 0.25 * s]; }
  if (m[0] > m[4] && m[0] > m[8]) { const s = Math.sqrt(1 + m[0] - m[4] - m[8]) * 2; return [0.25 * s, (m[1] + m[3]) / s, (m[2] + m[6]) / s, (m[7] - m[5]) / s]; }
  if (m[4] > m[8]) { const s = Math.sqrt(1 + m[4] - m[0] - m[8]) * 2; return [(m[1] + m[3]) / s, 0.25 * s, (m[5] + m[7]) / s, (m[2] - m[6]) / s]; }
  const s = Math.sqrt(1 + m[8] - m[0] - m[4]) * 2; return [(m[2] + m[6]) / s, (m[5] + m[7]) / s, 0.25 * s, (m[3] - m[1]) / s];
}
function quatToMat(q: [number, number, number, number]): Matrix3 { const [x, y, z, w] = q; return [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]; }
function interpolateMatrix(a: Matrix3, b: Matrix3, t: number): Matrix3 {
  const qa = matToQuat(a), qb = matToQuat(b); let dot = qa[0] * qb[0] + qa[1] * qb[1] + qa[2] * qb[2] + qa[3] * qb[3]; let sign = 1;
  if (dot < 0) { dot = -dot; sign = -1; }
  if (dot > 0.9995) return quatToMat([qa[0] + (qb[0] * sign - qa[0]) * t, qa[1] + (qb[1] * sign - qa[1]) * t, qa[2] + (qb[2] * sign - qa[2]) * t, qa[3] + (qb[3] * sign - qa[3]) * t]);
  const theta = Math.acos(clamp(dot, -1, 1)), sin = Math.sin(theta), w1 = Math.sin((1 - t) * theta) / sin, w2 = Math.sin(t * theta) / sin * sign;
  return quatToMat([qa[0] * w1 + qb[0] * w2, qa[1] * w1 + qb[1] * w2, qa[2] * w1 + qb[2] * w2, qa[3] * w1 + qb[3] * w2]);
}

/** Source-bound, review-only store. It never imports into production or grants admission. */
export class AssemblyStudioService {
  private records: StudioExample[] | null = null;
  private writeChain: Promise<void> = Promise.resolve();
  constructor(private readonly repository: NativePartRepository, private readonly directory: string) {}
  private get directoryPath() { return path.join(this.directory, 'interface-library'); }
  private get file() { return path.join(this.directoryPath, 'studio-examples.json'); }
  private async load() {
    if (this.records) return this.records;
    try {
      const parsed: unknown = JSON.parse(await readFile(this.file, 'utf8'));
      if (!Array.isArray(parsed) || parsed.length > MAX_RECORDS || !parsed.every(item => item && typeof item === 'object' && typeof (item as StudioExample).id === 'string')) throw new Error('invalid studio store');
      this.records = (parsed as StudioExample[]).map(record => this.upgrade(record));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') this.records = [];
      else throw new StudioError('拼搭示例存储无法读取；已停止写入以保护现有记录。', 'STUDIO_STORE_FAILED', 500);
    }
    return this.records;
  }
  private async persist() { await mkdir(this.directoryPath, { recursive: true }); const temp = `${this.file}.${process.pid}.${randomUUID()}.tmp`; await writeFile(temp, JSON.stringify(this.records, null, 2) + '\n', { mode: 0o600 }); await rename(temp, this.file); }
  private async part(partId: string) { const value = await this.repository.getPart(partId); if (!value) throw new StudioError(`没有真实零件 ${partId}。`, 'STUDIO_PART_NOT_FOUND', 404); return value; }
  private snapshot(part: NativeAssemblyPart): StudioPartSnapshot { return { partId: part.partId, name: part.geometry.name ?? part.partId, sourceSha256: nativePartSourceHash(part), revision: part.geometry.source.revision, connections: part.connections.points.map(point => ({ id: point.id, family: point.family ?? 'unknown', role: point.gender === 'M' ? 'MALE' : point.gender === 'F' ? 'FEMALE' : 'UNKNOWN', sourceId: point.sourceId ?? null, sourcePath: point.source.path, line: point.source.line, raw: point.source.raw })) }; }
  private upgrade(record: StudioExample): StudioExample {
    const camera = isCamera(record.camera) ? record.camera : { ...DEFAULT_CAMERA, position: [...DEFAULT_CAMERA.position] as Vector3, target: [...DEFAULT_CAMERA.target] as Vector3 };
    const previewDataUrl = typeof record.previewDataUrl === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(record.previewDataUrl) ? record.previewDataUrl : null;
    return {
      ...record,
      rootId: typeof record.rootId === 'string' && ID.test(record.rootId) ? record.rootId : record.id,
      version: Number.isInteger(record.version) && record.version > 0 ? record.version : 1,
      previousId: typeof record.previousId === 'string' ? record.previousId : null,
      status: record.status === 'draft' ? 'draft' : 'pending-review',
      categoryId: categoryFor(record.categoryId ?? record.validation?.rule.ruleId),
      fixedInstanceId: typeof record.fixedInstanceId === 'string' && record.fixedInstanceId ? record.fixedInstanceId : 'A',
      movingInstanceId: typeof record.movingInstanceId === 'string' && record.movingInstanceId ? record.movingInstanceId : 'B',
      camera, previewDataUrl,
      relativeTransform: record.relativeTransform ?? relativeTransformOf(record.fixedInitial, record.movingFinal),
      relativeConvention: 'A-local-to-B-local-rigid-v1',
    };
  }

  private normalize(value: unknown): NormalizedBuild {
    if (!value || typeof value !== 'object') throw new StudioError('拼搭提交格式无效。', 'INVALID_STUDIO_BUILD');
    const v = value as Partial<StudioBuildInput>;
    if (v.mode !== 'assisted' && v.mode !== 'free') throw new StudioError('请选择辅助拼搭或自由示范。', 'INVALID_STUDIO_BUILD');
    if (typeof v.fixedPartId !== 'string' || !ID.test(v.fixedPartId) || typeof v.movingPartId !== 'string' || !ID.test(v.movingPartId)) throw new StudioError('零件身份无效。', 'INVALID_STUDIO_BUILD');
    if (v.fixedConnectionId != null && (typeof v.fixedConnectionId !== 'string' || !FEATURE.test(v.fixedConnectionId))) throw new StudioError('固定端连接位置无效。', 'INVALID_STUDIO_BUILD');
    if (v.movingConnectionId != null && (typeof v.movingConnectionId !== 'string' || !FEATURE.test(v.movingConnectionId))) throw new StudioError('移动端连接位置无效。', 'INVALID_STUDIO_BUILD');
    if (!isTransform(v.fixedInitial) || !isTransform(v.movingInitial) || !isTransform(v.movingFinal)) throw new StudioError('姿态必须包含有限刚体变换。', 'INVALID_STUDIO_BUILD');
    const claim = v.userClaim;
    if (!claim || typeof claim !== 'object' || typeof claim.reason !== 'string' || claim.reason.length > 5000 || typeof claim.connectionNote !== 'string' || claim.connectionNote.length > 2000 || typeof claim.physicallyBuilt !== 'boolean') throw new StudioError('请填写说明与实物经历。', 'INVALID_STUDIO_BUILD');
    const attachments = Array.isArray(claim.attachments) ? claim.attachments.slice(0, 4).map(item => {
      if (!item || !['none', 'link'].includes(item.kind)) throw new StudioError('附件格式无效。', 'INVALID_STUDIO_BUILD');
      if (item.kind === 'none') return { kind: 'none' as const, note: typeof item.note === 'string' ? item.note.slice(0, 500) : '' };
      let url: URL; try { url = new URL(String(item.url ?? '')); } catch { throw new StudioError('附件链接不是有效 URL。', 'INVALID_STUDIO_BUILD'); }
      if (!['http:', 'https:'].includes(url.protocol)) throw new StudioError('附件仅支持 http(s) 链接。', 'INVALID_STUDIO_BUILD');
      return { kind: 'link' as const, url: url.href, note: typeof item.note === 'string' ? item.note.slice(0, 500) : '' };
    }) : [];
    const keyframes = Array.isArray(v.keyframes) ? v.keyframes.slice(0, 40).map((frame, index) => {
      if (!frame || !isTransform(frame.transform)) throw new StudioError('关键帧姿态无效。', 'INVALID_STUDIO_BUILD');
      return { id: typeof frame.id === 'string' ? frame.id.slice(0, 80) : `k${index}`, label: typeof frame.label === 'string' ? frame.label.slice(0, 120) : `过程 ${index + 1}`, transform: copyTransform(frame.transform), recordedAt: typeof frame.recordedAt === 'string' ? frame.recordedAt : new Date().toISOString() };
    }) : [];
    const categoryId = categoryFor(typeof v.categoryId === 'string' && v.categoryId.trim() ? v.categoryId.trim().slice(0, 80) : undefined);
    const fixedInstanceId = typeof v.fixedInstanceId === 'string' && ID.test(v.fixedInstanceId) ? v.fixedInstanceId : 'A';
    const movingInstanceId = typeof v.movingInstanceId === 'string' && ID.test(v.movingInstanceId) ? v.movingInstanceId : 'B';
    const camera = isCamera(v.camera) ? { position: [...v.camera.position] as Vector3, target: [...v.camera.target] as Vector3, view: v.camera.view } : { ...DEFAULT_CAMERA, position: [...DEFAULT_CAMERA.position] as Vector3, target: [...DEFAULT_CAMERA.target] as Vector3 };
    const previewDataUrl = typeof v.previewDataUrl === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(v.previewDataUrl) && v.previewDataUrl.length <= 900000 ? v.previewDataUrl : null;
    const rootId = typeof v.rootId === 'string' && ID.test(v.rootId) ? v.rootId : null;
    const status: StudioStatus = v.status === 'draft' ? 'draft' : 'pending-review';
    let candidatePoint: StudioCandidatePoint | undefined;
    if (v.candidatePoint) {
      if (!ID.test(v.candidatePoint.partId) || !Array.isArray(v.candidatePoint.localPosition) || v.candidatePoint.localPosition.length !== 3 || !v.candidatePoint.localPosition.every(Number.isFinite)) throw new StudioError('人工候选点格式无效。', 'INVALID_STUDIO_BUILD');
      candidatePoint = { partId: v.candidatePoint.partId, localPosition: v.candidatePoint.localPosition as Vector3, note: String(v.candidatePoint.note ?? '').slice(0, 500) };
    }
    return { mode: v.mode, caseId: typeof v.caseId === 'string' ? v.caseId.slice(0, 80) : null, fixedPartId: v.fixedPartId, movingPartId: v.movingPartId, fixedConnectionId: v.fixedConnectionId ?? null, movingConnectionId: v.movingConnectionId ?? null, fixedInitial: copyTransform(v.fixedInitial), movingInitial: copyTransform(v.movingInitial), movingFinal: copyTransform(v.movingFinal), keyframes, userClaim: { connectionNote: claim.connectionNote, reason: claim.reason, physicallyBuilt: claim.physicallyBuilt, attachments }, ...(candidatePoint ? { candidatePoint } : {}), categoryId, fixedInstanceId, movingInstanceId, camera, previewDataUrl, rootId, status };
  }
  async prepare(value: unknown): Promise<StudioPreparation> {
    if (!value || typeof value !== 'object') throw new StudioError('拼接准备请求格式无效。', 'INVALID_STUDIO_BUILD');
    const v = value as { fixedPartId?: unknown; movingPartId?: unknown; ruleId?: unknown; fixedConnectionId?: unknown; movingConnectionId?: unknown };
    if (typeof v.fixedPartId !== 'string' || !ID.test(v.fixedPartId) || typeof v.movingPartId !== 'string' || !ID.test(v.movingPartId)) throw new StudioError('零件身份无效。', 'INVALID_STUDIO_BUILD');
    const rule = typeof v.ruleId === 'string' ? CONNECTOR_GRAMMAR_RULES.find(item => item.id === v.ruleId) : null;
    const fixed = await this.part(v.fixedPartId), moving = await this.part(v.movingPartId);
    const byId = (part: NativeAssemblyPart, id: unknown) => typeof id === 'string' ? part.connections.points.find(point => point.id === id) : undefined;
    const rolePoint = (part: NativeAssemblyPart, families: readonly string[], gender: 'M' | 'F') => part.connections.points.find(point => families.includes(point.family ?? '') && point.gender === gender) ?? part.connections.points.find(point => point.gender === gender);
    const fixedPoint = byId(fixed, v.fixedConnectionId) ?? (rule ? rolePoint(fixed, rule.maleFamilies, 'M') : fixed.connections.points.find(point => point.gender === 'M'));
    const movingPoint = byId(moving, v.movingConnectionId) ?? (rule ? rolePoint(moving, rule.femaleFamilies, 'F') : moving.connections.points.find(point => point.gender === 'F'));
    const fixedInitial: StudioTransform = { rotation: [...zero.rotation], translation: [...zero.translation] };
    const compatibility = fixedPoint && movingPoint ? checkConnectionCompatibility(fixedPoint, movingPoint) : null;
    const solved = fixedPoint && movingPoint ? solveAttachment({ fixedPart: fixed, fixedPlacement: placement('A', fixed.partId, fixedInitial), fixedConnectionId: fixedPoint.id, movingPart: moving, movingConnectionId: movingPoint.id }) : null;
    const candidates = solved?.status === 'solved' ? solved.candidates : [];
    const selected = candidates[0];
    const movingFinal = selected ? copyTransform(selected.transform) : copyTransform(zero);
    const axis = selected ? [...selected.penetrationZone.axis] as Vector3 : [0, 1, 0] as Vector3;
    const insertionDepthLdu = selected?.penetrationZone.depth ?? 32;
    const separation = Math.max(32, insertionDepthLdu + 32);
    const movingInitial: StudioTransform = { rotation: [...movingFinal.rotation], translation: [movingFinal.translation[0] + axis[0] * separation, movingFinal.translation[1] + axis[1] * separation, movingFinal.translation[2] + axis[2] * separation] };
    return {
      fixedPartId: fixed.partId, movingPartId: moving.partId, fixedConnectionId: fixedPoint?.id ?? null, movingConnectionId: movingPoint?.id ?? null,
      fixedInitial, movingInitial, movingFinal, axis, insertionDepthLdu,
      compatibility: { status: compatibility?.status ?? 'unknown', ruleId: compatibility?.ruleId ?? null, reason: compatibility?.reason ?? '未找到两端连接位置。', reasonCode: compatibility?.reasonCode ?? 'no-endpoints', allowedTwistsDeg: compatibility?.allowedTwistsDeg ?? [] },
      suggestions: candidates.map(candidate => ({ transform: copyTransform(candidate.transform), twistDeg: candidate.twistDeg, ruleId: candidate.penetrationZone.ruleId })),
      notice: compatibility?.status === 'compatible' ? '来源规则成立；这只建立候选 seat，仍需检查最终碰撞和安装路径。' : '当前没有可用的来源规则姿态；可以继续自由示范，但不能把结果当作规则通过。',
    };
  }

  async validate(value: unknown): Promise<StudioValidation> {
    const input = this.normalize(value); const fixed = await this.part(input.fixedPartId), moving = await this.part(input.movingPartId);
    const fixedPlacement = placement('fixed', fixed.partId, input.fixedInitial), movingPlacement = placement('moving', moving.partId, input.movingFinal);
    const fixedPoint = input.fixedConnectionId ? fixed.connections.points.find(point => point.id === input.fixedConnectionId) : undefined;
    const movingPoint = input.movingConnectionId ? moving.connections.points.find(point => point.id === input.movingConnectionId) : undefined;
    const compatibility = fixedPoint && movingPoint ? checkConnectionCompatibility(fixedPoint, movingPoint) : null;
    const nearest = nearestSuggestion(input, moving, fixed);
    const rule: StudioValidation['rule'] = {
      status: compatibility?.status ?? 'unknown', ruleId: compatibility?.ruleId ?? null, reason: compatibility?.reason ?? '未选择两端来源连接位置。', reasonCode: compatibility?.reasonCode ?? 'no-endpoints',
      sourceIds: compatibility?.sourceEvidence.map(source => source.url) ?? [], allowedTwistsDeg: compatibility?.allowedTwistsDeg ?? [], poseAngleDeg: nearest.angle, poseDistanceLdu: nearest.distance,
    };
    let finalCollision: StudioValidation['finalCollision'];
    if (nearest.candidate) {
      const collision = checkNativePairCollision(fixed, fixedPlacement, moving, movingPlacement, nearest.candidate.penetrationZone);
      finalCollision = { status: collision.status, reasonCode: collision.reasonCode, reason: collision.reason, witness: collision.witness ?? null };
    } else {
      const collision = checkNativePairCollision(fixed, fixedPlacement, moving, movingPlacement);
      finalCollision = { status: collision.status === 'clear' ? 'clear' : collision.status, reasonCode: collision.reasonCode, reason: collision.reason, witness: collision.witness ?? null };
    }
    let path: StudioValidation['path'];
    if (input.keyframes.length < 2) path = { status: 'not-provided', samples: 0, reason: '只提交了最终姿态，没有提供安装过程。', scope: '未检查安装轨迹。', witness: null };
    else if (!nearest.candidate) path = { status: 'not-checked', samples: 0, reason: '没有可用的来源规则姿态，无法建立 seat 范围。', scope: '只有两端规则成立时才检查两件零件的刚体取样路径。', witness: null };
    else {
      const samples = sampleTransforms(input); let tested = 0, pathWitness: Vector3 | null = null, pathStatus: StudioValidation['path']['status'] = 'checked-clear', reason = '两件零件的刚体取样路径未发现 seat 外接触。';
      for (const [index, transform] of samples.entries()) {
        tested++;
        const result = checkNativePairCollision(fixed, fixedPlacement, moving, placement('moving', moving.partId, transform), nearest.candidate.penetrationZone);
        if (result.status !== 'clear') { pathStatus = result.status === 'collision' ? 'checked-collision' : 'not-checked'; reason = result.reason; pathWitness = result.witness ?? null; break; }
        if (index > 80) break;
      }
      path = { status: pathStatus, samples: tested, reason, scope: '两件真实零件的刚体关键帧/插值取样；不包含形变、保持力、环境或实物验证。', witness: pathWitness };
    }
    const limitations = ['自由示范和人工候选点只作为待复核信息，不冒充来源端点。', '路径检查只覆盖两件零件的刚体刚体取样，不验证形变、轮胎/卡扣弹性、保持力或实物。', '最终结果不会获得生产准入，也不会自动修改规则。'];
    if (!input.fixedConnectionId || !input.movingConnectionId) limitations.push('未选择两端来源连接位置，规则检查状态为 unknown。');
    if (nearest.angle !== null && (nearest.angle > 3 || (nearest.distance ?? 0) > 2)) limitations.push('最终姿态与求解候选存在偏差；页面分别显示该偏差，不将用户摆放视为规则通过。');
    return { rule, finalCollision, path, userClaim: input.userClaim, suggestions: nearest.suggestions, generationEligible: false, physicalBuildVerified: false, limitations };
  }
  async save(value: unknown): Promise<StudioExample> {
    const input = this.normalize(value); const validation = await this.validate(input); const fixed = this.snapshot(await this.part(input.fixedPartId)), moving = this.snapshot(await this.part(input.movingPartId));
    const records = await this.load(); if (records.length >= MAX_RECORDS) throw new StudioError('拼搭示例记录已达上限。', 'STUDIO_STORE_FULL', 409);
    const now = new Date().toISOString();
    const rootId = input.rootId ?? `studio-${randomUUID()}`;
    const previous = records.filter(item => item.rootId === rootId).sort((a, b) => b.version - a.version)[0] ?? null;
    const version = previous ? previous.version + 1 : 1;
    const record: StudioExample = {
      ...input, id: `studio-${randomUUID()}`, rootId, version, previousId: previous?.id ?? null,
      createdAt: now, updatedAt: now, status: input.status === 'draft' ? 'draft' : 'pending-review',
      categoryId: input.categoryId, fixedInstanceId: input.fixedInstanceId, movingInstanceId: input.movingInstanceId,
      camera: input.camera, previewDataUrl: input.previewDataUrl,
      relativeTransform: relativeTransformOf(input.fixedInitial, input.movingFinal), relativeConvention: 'A-local-to-B-local-rigid-v1',
      fixed, moving, validation, versions: VERSIONS, stale: false,
      history: [{ at: now, action: input.status === 'draft' ? 'draft' : 'created', note: input.status === 'draft' ? '保存为草稿；尚未提交。' : '保存为待验证人工示例；未获得正式生成资格。', validation }],
    };
    records.unshift(record); this.records = records; this.writeChain = this.writeChain.then(() => this.persist()); await this.writeChain; return structuredClone(record);
  }

  async saveDraft(value: unknown): Promise<StudioExample> { return this.save({ ...(value as Record<string, unknown>), status: 'draft' }); }

  async submit(id: string): Promise<StudioExample> {
    const records = await this.load(); const index = records.findIndex(item => item.id === id);
    if (index < 0) throw new StudioError('没有该拼搭草稿。', 'STUDIO_NOT_FOUND', 404);
    if (records[index].status !== 'draft') return structuredClone(records[index]);
    const validation = await this.validate(records[index]); const now = new Date().toISOString();
    const updated: StudioExample = { ...records[index], status: 'pending-review', validation, updatedAt: now, versions: VERSIONS, history: [...records[index].history, { at: now, action: 'submitted', note: '从草稿提交为待复核人工示例；不改变生产资格。', validation }] };
    records[index] = updated; this.records = records; this.writeChain = this.writeChain.then(() => this.persist()); await this.writeChain; return structuredClone(updated);
  }
  async list(): Promise<StudioExampleSummary[]> { return (await this.load()).map(summary); }
  async get(id: string): Promise<StudioExample | null> { const record = (await this.load()).find(item => item.id === id); if (!record) return null; const fixed = await this.part(record.fixedPartId).catch(() => null), moving = await this.part(record.movingPartId).catch(() => null); return { ...structuredClone(this.upgrade(record)), stale: !fixed || !moving || record.fixed.sourceSha256 !== nativePartSourceHash(fixed) || record.moving.sourceSha256 !== nativePartSourceHash(moving) }; }
  async exportBundle(feedback: unknown[] = []): Promise<StudioExportBundle> {
    const examples = await this.load();
    const partIds = new Set(examples.flatMap(example => [example.fixedPartId, example.movingPartId]));
    const sources = new Set(examples.flatMap(example => [example.fixed, example.moving].flatMap(part => part.connections.map(connection => connection.sourcePath).filter(Boolean))));
    return {
      format: 'bricklab-studio-bundle', bundleVersion: 1, generatedAt: new Date().toISOString(),
      storage: { kind: 'server-json', path: this.file, note: '服务端 JSON 是主存储；导出包用于人工移交或独立复盘，不包含受限源模型。' },
      schema: 'studio-example-2',
      versions: VERSIONS,
      instructions: [
        '本包记录真实零件身份、来源版本、A/B 刚体变换、B 相对 A 的变换、关键帧、相机和人工说明。',
        '复现时按 fixedInitial/movingInitial/movingFinal 和 keyframes 恢复姿态；不得从截图或鼠标位移反推。',
        '规则、碰撞和路径结果均绑定当前版本；来源或版本变化后必须重新检查。',
        '包内不包含 LDraw/LDCad 源模型；请按零件 sourceSha256、sourcePath 和 revision 从项目钉死来源获取。',
        '人工示例不授予正式生成资格，不自动修改全局规则。',
      ],
      examples: structuredClone(examples), feedback,
      sourceSummary: { parts: partIds.size, sources: sources.size, missingSourceModels: [] },
    };
  }

  async importBundle(value: unknown): Promise<StudioImportResult> {
    const raw = Array.isArray(value) ? value : (value && typeof value === 'object' && Array.isArray((value as { examples?: unknown }).examples) ? (value as { examples: unknown[] }).examples : null);
    if (!raw) throw new StudioError('导入包必须包含 examples 数组。', 'STUDIO_IMPORT_INVALID');
    if (!raw.length || raw.length > 200) throw new StudioError('导入包示例数量必须为 1..200。', 'STUDIO_IMPORT_INVALID');
    const result: StudioImportResult = { imported: 0, skipped: 0, errors: [] };
    for (const [index, item] of raw.entries()) {
      try {
        const input = this.normalize(item);
        await this.save({ ...input, rootId: null, status: 'draft' });
        result.imported++;
      } catch (error) {
        result.errors.push(`第 ${index + 1} 条：${error instanceof Error ? error.message : '格式无效'}`);
      }
    }
    return result;
  }

  async revalidate(id: string): Promise<StudioExample> {
    const records = await this.load(); const index = records.findIndex(item => item.id === id); if (index < 0) throw new StudioError('没有该拼搭示例。', 'STUDIO_NOT_FOUND', 404);
    const record = records[index]; const validation = await this.validate(record); const fixed = this.snapshot(await this.part(record.fixedPartId)), moving = this.snapshot(await this.part(record.movingPartId)); const now = new Date().toISOString();
    const updated: StudioExample = { ...record, fixed, moving, validation, stale: false, updatedAt: now, versions: VERSIONS, history: [...record.history, { at: now, action: 'revalidated', note: '按当前来源、规则与碰撞版本重新检查。', validation }] };
    records[index] = updated; this.records = records; this.writeChain = this.writeChain.then(() => this.persist()); await this.writeChain; return structuredClone(updated);
  }
}
export { VERSIONS as STUDIO_VERSIONS, zero as STUDIO_IDENTITY };
