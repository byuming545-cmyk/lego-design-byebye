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
import { CONNECTOR_GRAMMAR_VERSION, CONNECTOR_SCHEMA_VERSION } from '../grammar/schema.js';
import { GRAMMAR_ADMISSION_VERSION } from '../grammar/admission.js';

export type StudioMode = 'assisted' | 'free';
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
}
export interface StudioSuggestion { transform: StudioTransform; twistDeg: number; ruleId: string }
export interface StudioPartSnapshot {
  partId: string; name: string; sourceSha256: string; revision: string;
  connections: { id: string; family: string; role: string; sourceId: string | null; sourcePath: string; line: number | null; raw: string | null }[];
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
  id: string; createdAt: string; updatedAt: string; status: 'pending-review';
  fixed: StudioPartSnapshot; moving: StudioPartSnapshot;
  validation: StudioValidation;
  versions: { schema: string; grammar: string; admission: string; partLibrary: string; assemblyEngine: string; connectionRule: string; collision: string };
  stale: boolean;
  history: { at: string; action: string; note: string; validation: StudioValidation }[];
}
export interface StudioExampleSummary {
  id: string; createdAt: string; updatedAt: string; mode: StudioMode; status: 'pending-review';
  fixedPartId: string; movingPartId: string; ruleId: string | null; pathStatus: StudioValidation['path']['status']; stale: boolean;
}
export class StudioError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400) { super(message); }
}

const VERSIONS = { schema: CONNECTOR_SCHEMA_VERSION, grammar: CONNECTOR_GRAMMAR_VERSION, admission: GRAMMAR_ADMISSION_VERSION, partLibrary: PART_LIBRARY_VERSION, assemblyEngine: ASSEMBLY_ENGINE_VERSION, connectionRule: CONNECTION_RULE_VERSION, collision: COLLISION_VERSION };
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/;
const FEATURE = /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,999}$/;
const MAX_RECORDS = 1000;
const zero: StudioTransform = { rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1], translation: [0, 0, 0] };
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
  return { id: record.id, createdAt: record.createdAt, updatedAt: record.updatedAt, mode: record.mode, status: record.status, fixedPartId: record.fixedPartId, movingPartId: record.movingPartId, ruleId: record.validation.rule.ruleId, pathStatus: record.validation.path.status, stale: record.stale };
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
      this.records = parsed as StudioExample[];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') this.records = [];
      else throw new StudioError('拼搭示例存储无法读取；已停止写入以保护现有记录。', 'STUDIO_STORE_FAILED', 500);
    }
    return this.records;
  }
  private async persist() { await mkdir(this.directoryPath, { recursive: true }); const temp = `${this.file}.${process.pid}.${randomUUID()}.tmp`; await writeFile(temp, JSON.stringify(this.records, null, 2) + '\n', { mode: 0o600 }); await rename(temp, this.file); }
  private async part(partId: string) { const value = await this.repository.getPart(partId); if (!value) throw new StudioError(`没有真实零件 ${partId}。`, 'STUDIO_PART_NOT_FOUND', 404); return value; }
  private snapshot(part: NativeAssemblyPart): StudioPartSnapshot { return { partId: part.partId, name: part.geometry.name ?? part.partId, sourceSha256: nativePartSourceHash(part), revision: part.geometry.source.revision, connections: part.connections.points.map(point => ({ id: point.id, family: point.family ?? 'unknown', role: point.gender === 'M' ? 'MALE' : point.gender === 'F' ? 'FEMALE' : 'UNKNOWN', sourceId: point.sourceId ?? null, sourcePath: point.source.path, line: point.source.line, raw: point.source.raw })) }; }
  private normalize(value: unknown): StudioBuildInput {
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
    let candidatePoint: StudioCandidatePoint | undefined;
    if (v.candidatePoint) {
      if (!ID.test(v.candidatePoint.partId) || !Array.isArray(v.candidatePoint.localPosition) || v.candidatePoint.localPosition.length !== 3 || !v.candidatePoint.localPosition.every(Number.isFinite)) throw new StudioError('人工候选点格式无效。', 'INVALID_STUDIO_BUILD');
      candidatePoint = { partId: v.candidatePoint.partId, localPosition: v.candidatePoint.localPosition as Vector3, note: String(v.candidatePoint.note ?? '').slice(0, 500) };
    }
    return { mode: v.mode, caseId: typeof v.caseId === 'string' ? v.caseId.slice(0, 80) : null, fixedPartId: v.fixedPartId, movingPartId: v.movingPartId, fixedConnectionId: v.fixedConnectionId ?? null, movingConnectionId: v.movingConnectionId ?? null, fixedInitial: copyTransform(v.fixedInitial), movingInitial: copyTransform(v.movingInitial), movingFinal: copyTransform(v.movingFinal), keyframes, userClaim: { connectionNote: claim.connectionNote, reason: claim.reason, physicallyBuilt: claim.physicallyBuilt, attachments }, ...(candidatePoint ? { candidatePoint } : {}) };
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
    const now = new Date().toISOString();
    const record: StudioExample = { ...input, id: `studio-${randomUUID()}`, createdAt: now, updatedAt: now, status: 'pending-review', fixed, moving, validation, versions: VERSIONS, stale: false, history: [{ at: now, action: 'created', note: '保存为待验证人工示例；未获得正式生成资格。', validation }] };
    const records = await this.load(); if (records.length >= MAX_RECORDS) throw new StudioError('拼搭示例记录已达上限。', 'STUDIO_STORE_FULL', 409);
    records.unshift(record); this.records = records; this.writeChain = this.writeChain.then(() => this.persist()); await this.writeChain; return structuredClone(record);
  }
  async list(): Promise<StudioExampleSummary[]> { return (await this.load()).map(summary); }
  async get(id: string): Promise<StudioExample | null> { const record = (await this.load()).find(item => item.id === id); if (!record) return null; const fixed = await this.part(record.fixedPartId).catch(() => null), moving = await this.part(record.movingPartId).catch(() => null); return { ...structuredClone(record), stale: !fixed || !moving || record.fixed.sourceSha256 !== nativePartSourceHash(fixed) || record.moving.sourceSha256 !== nativePartSourceHash(moving) }; }
  async revalidate(id: string): Promise<StudioExample> {
    const records = await this.load(); const index = records.findIndex(item => item.id === id); if (index < 0) throw new StudioError('没有该拼搭示例。', 'STUDIO_NOT_FOUND', 404);
    const record = records[index]; const validation = await this.validate(record); const fixed = this.snapshot(await this.part(record.fixedPartId)), moving = this.snapshot(await this.part(record.movingPartId)); const now = new Date().toISOString();
    const updated: StudioExample = { ...record, fixed, moving, validation, stale: false, updatedAt: now, versions: VERSIONS, history: [...record.history, { at: now, action: 'revalidated', note: '按当前来源、规则与碰撞版本重新检查。', validation }] };
    records[index] = updated; this.records = records; this.writeChain = this.writeChain.then(() => this.persist()); await this.writeChain; return structuredClone(updated);
  }
}
export { VERSIONS as STUDIO_VERSIONS, zero as STUDIO_IDENTITY };
