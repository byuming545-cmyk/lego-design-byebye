import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { FeedbackInput, FeedbackKind, FeedbackPatch, FeedbackRecord, FeedbackStatus, FeedbackTarget } from './types.js';

const KINDS: FeedbackKind[] = ['reasonable', 'position-direction-wrong', 'interface-identification-wrong', 'should-not-mate', 'insufficient-evidence'];
const STATUSES: FeedbackStatus[] = ['open', 'triaged', 'needs-evidence', 'accepted-for-review', 'rejected', 'resolved'];
const MAX_RECORDS = 5000;
const MAX_MESSAGE = 5000;
const MAX_NOTE = 2000;
const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9_.:/ -]{0,999}$/;

export class FeedbackError extends Error {
  constructor(message: string, readonly code: 'INVALID_FEEDBACK' | 'FEEDBACK_NOT_FOUND' | 'FEEDBACK_STORE_FAILED' = 'INVALID_FEEDBACK', readonly status = 400) { super(message); }
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max = MAX_MESSAGE) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const iso = (value: unknown): value is string => typeof value === 'string' && !Number.isNaN(Date.parse(value));

function target(value: unknown): FeedbackTarget {
  if (!object(value) || !['interface', 'rule', 'case', 'comparison'].includes(String(value.kind)) || !text(value.id, 1100) || !idPattern.test(String(value.id))) throw new FeedbackError('反馈目标必须是已知的接口、规则或案例。');
  const optional = (key: string) => value[key] === undefined ? undefined : text(value[key], 1000) ? String(value[key]) : (() => { throw new FeedbackError('反馈目标字段格式无效。'); })();
  return { kind: value.kind as FeedbackTarget['kind'], id: String(value.id), ...(optional('partId') ? { partId: optional('partId') } : {}), ...(optional('featureId') ? { featureId: optional('featureId') } : {}), ...(optional('ruleId') ? { ruleId: optional('ruleId') } : {}), ...(optional('caseId') ? { caseId: optional('caseId') } : {}) };
}

function normalizeInput(value: unknown): FeedbackInput {
  if (!object(value) || !KINDS.includes(value.kind as FeedbackKind) || !text(value.message, MAX_MESSAGE)) throw new FeedbackError('请选择反馈类型并填写不超过 5000 字的说明。');
  const attachment = value.attachment === undefined ? { kind: 'none' as const, note: '' } : (() => {
    if (!object(value.attachment) || !['link', 'none'].includes(String(value.attachment.kind))) throw new FeedbackError('附件只支持来源链接，不支持上传二进制文件。');
    if (value.attachment.kind === 'link') {
      const url = String(value.attachment.url ?? '');
      let parsed: URL; try { parsed = new URL(url); } catch { throw new FeedbackError('附件链接不是有效 URL。'); }
      if (!['http:', 'https:'].includes(parsed.protocol) || url.length > 2000 || (value.attachment.note !== undefined && String(value.attachment.note).length > 500)) throw new FeedbackError('附件链接仅允许 http(s)，且说明不超过 500 字。');
      return { kind: 'link' as const, url: parsed.href, note: String(value.attachment.note ?? '') };
    }
    if (value.attachment.note !== undefined && String(value.attachment.note).length > 500) throw new FeedbackError('附件说明不超过 500 字。');
    return { kind: 'none' as const, note: String(value.attachment.note ?? '') };
  })();
  const author = value.author === undefined ? 'local-reviewer' : String(value.author);
  if (!text(author, 120) || value.view !== undefined && (!text(value.view, 500))) throw new FeedbackError('反馈作者或视图说明格式无效。');
  return { kind: value.kind as FeedbackKind, target: target(value.target), message: String(value.message).trim(), author, view: String(value.view ?? 'interface-library'), attachment, ...(value.evidence === undefined ? {} : { evidence: value.evidence as FeedbackInput['evidence'] }) };
}

function snapshot(input: FeedbackInput, existing?: FeedbackRecord): FeedbackRecord['evidence'] {
  const e = input.evidence ?? {};
  return {
    interfaceStatus: typeof e.interfaceStatus === 'string' ? e.interfaceStatus.slice(0, 200) : existing?.evidence.interfaceStatus ?? null,
    ruleId: typeof e.ruleId === 'string' ? e.ruleId.slice(0, 200) : existing?.evidence.ruleId ?? null,
    ruleVersion: typeof e.ruleVersion === 'string' ? e.ruleVersion.slice(0, 200) : existing?.evidence.ruleVersion ?? null,
    grammarVersion: typeof e.grammarVersion === 'string' ? e.grammarVersion.slice(0, 200) : existing?.evidence.grammarVersion ?? 'unknown',
    partLibraryVersion: typeof e.partLibraryVersion === 'string' ? e.partLibraryVersion.slice(0, 200) : existing?.evidence.partLibraryVersion ?? 'unknown',
    collisionVersion: typeof e.collisionVersion === 'string' ? e.collisionVersion.slice(0, 200) : existing?.evidence.collisionVersion ?? 'unknown',
    sourceDigest: typeof e.sourceDigest === 'string' ? e.sourceDigest.slice(0, 200) : existing?.evidence.sourceDigest ?? null,
    conclusion: typeof e.conclusion === 'string' ? e.conclusion.slice(0, 1000) : existing?.evidence.conclusion ?? '观察记录，不改变软件结论。',
    sourceIds: Array.isArray(e.sourceIds) ? e.sourceIds.filter(item => typeof item === 'string').slice(0, 50).map(item => item.slice(0, 500)) : existing?.evidence.sourceIds ?? [],
  };
}

function recordShape(value: unknown): value is FeedbackRecord {
  if (!object(value) || !text(value.id, 100) || !iso(value.createdAt) || !iso(value.updatedAt) || !KINDS.includes(value.kind as FeedbackKind) || !STATUSES.includes(value.status as FeedbackStatus) || !text(value.message, MAX_MESSAGE) || !text(value.author, 120) || !text(value.view, 500) || !object(value.evidence) || !object(value.handling) || !Array.isArray((value.handling as Record<string, unknown>).history)) return false;
  try { target((value as Record<string, unknown>).target); return true; } catch { return false; }
}

export class FeedbackStore {
  private records: FeedbackRecord[] | null = null;
  private writeChain: Promise<void> = Promise.resolve();
  constructor(readonly directory: string) {}
  private get file() { return path.join(this.directory, 'feedback.json'); }
  private async load() {
    if (this.records) return this.records;
    try {
      const parsed: unknown = JSON.parse(await readFile(this.file, 'utf8'));
      if (!Array.isArray(parsed) || parsed.length > MAX_RECORDS || !parsed.every(recordShape)) throw new Error('feedback store shape');
      this.records = parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') this.records = [];
      else throw new FeedbackError('反馈存储无法读取，已停止写入以保护现有记录。', 'FEEDBACK_STORE_FAILED', 500);
    }
    return this.records;
  }
  private async persist() {
    await mkdir(this.directory, { recursive: true });
    const temp = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(this.records, null, 2) + '\n', { mode: 0o600 });
    await rename(temp, this.file);
  }
  async list(filter: { status?: FeedbackStatus; targetId?: string; kind?: FeedbackKind } = {}) {
    const records = await this.load();
    return records.filter(record => (!filter.status || record.status === filter.status) && (!filter.targetId || record.target.id === filter.targetId) && (!filter.kind || record.kind === filter.kind)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async get(id: string) { return (await this.load()).find(record => record.id === id) ?? null; }
  async add(value: unknown) {
    const input = normalizeInput(value);
    const records = await this.load();
    if (records.length >= MAX_RECORDS) throw new FeedbackError('本地反馈记录已达上限。', 'INVALID_FEEDBACK', 409);
    const now = new Date().toISOString();
    const record: FeedbackRecord = {
      id: `fb-${randomUUID()}`, createdAt: now, updatedAt: now, kind: input.kind, status: 'open', target: input.target,
      message: input.message, author: input.author ?? 'local-reviewer', view: input.view ?? 'interface-library', attachment: input.attachment?.kind === 'link' ? { kind: 'link', url: input.attachment.url, note: input.attachment.note ?? '' } : { kind: 'none', note: input.attachment?.note ?? '' },
      evidence: snapshot(input), handling: { status: 'open', note: '', updatedAt: now, reviewer: null, history: [{ at: now, status: 'open', note: '已保存为人工观察，未改变软件验证结论。', reviewer: null }] },
      softwareConclusion: '人工反馈只进入复核流程；不会自动开放接口、跳过碰撞或授予生成资格。',
      humanObservation: true, canAuthorizeRule: false,
    };
    records.unshift(record);
    this.records = records;
    this.writeChain = this.writeChain.then(() => this.persist());
    await this.writeChain;
    return structuredClone(record);
  }
  async patch(id: string, value: unknown) {
    const records = await this.load();
    const index = records.findIndex(record => record.id === id);
    if (index < 0) throw new FeedbackError('没有该反馈记录。', 'FEEDBACK_NOT_FOUND', 404);
    if (!object(value) || Object.keys(value).some(key => !['status', 'note', 'reviewer'].includes(key))) throw new FeedbackError('反馈处理字段无效。');
    if (value.status !== undefined && !STATUSES.includes(value.status as FeedbackStatus)) throw new FeedbackError('反馈处理状态无效。');
    if (value.note !== undefined && (!text(value.note, MAX_NOTE))) throw new FeedbackError('处理说明不能为空且不超过 2000 字。');
    if (value.reviewer !== undefined && value.reviewer !== null && !text(value.reviewer, 120)) throw new FeedbackError('处理人格式无效。');
    const now = new Date().toISOString();
    const status = (value.status as FeedbackStatus | undefined) ?? records[index].status;
    const note = value.note === undefined ? records[index].handling.note : String(value.note).trim();
    const reviewer = value.reviewer === undefined ? records[index].handling.reviewer : (value.reviewer as string | null);
    const updated: FeedbackRecord = {
      ...records[index], status, updatedAt: now,
      handling: { status, note, updatedAt: now, reviewer, history: [...records[index].handling.history, { at: now, status, note, reviewer }] },
    };
    records[index] = updated; this.records = records;
    this.writeChain = this.writeChain.then(() => this.persist());
    await this.writeChain;
    return structuredClone(updated);
  }
}
