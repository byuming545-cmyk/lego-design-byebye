import { randomUUID } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { InventoryError } from '../inventory/index.js';
import { safeSpeedModelId, type SpeedModelDocument } from './documents.js';
import { atomicSpeedJsonWrite } from './storage.js';

export const PHYSICAL_ISSUE_TYPES = ['cannot_connect', 'collision', 'too_weak', 'wheel_blocked', 'impossible_step', 'wrong_part', 'unclear_instruction', 'other'] as const;
export interface PhysicalBuildProblem {
  stepNumber?: number;
  partId?: string;
  issueType: typeof PHYSICAL_ISSUE_TYPES[number];
  text: string;
}
export interface PhysicalBuildFeedbackInput {
  modelId: string;
  revision: number;
  modelDigest: string;
  actuallyBuilt: true;
  buildResult: 'success' | 'partial' | 'failure';
  wheel: 'normal' | 'friction' | 'blocked';
  stability: 'strong' | 'stable' | 'weak' | 'impossible';
  instructions: 'clear' | 'difficult' | 'impossible';
  problems: PhysicalBuildProblem[];
}
export interface PhysicalBuildFeedback extends PhysicalBuildFeedbackInput {
  schemaVersion: 1;
  feedbackId: string;
  submittedAt: string;
  userReported: true;
  physicalValidation: 'untested' | 'passed';
  modelVersion: number;
  generatorVersion: string;
  validatorVersion: string;
  partLibraryVersion: string;
}

function invalid(message: string): never { throw new InventoryError(message, 'INVALID_PHYSICAL_BUILD_FEEDBACK', 400); }
function object(value: unknown, allowed: string[], required = allowed): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key))) invalid('实拼反馈包含缺失或未允许的字段。');
  return value as Record<string, unknown>;
}
function parseInput(value: unknown): PhysicalBuildFeedbackInput {
  const input = object(value, ['modelId', 'revision', 'modelDigest', 'actuallyBuilt', 'buildResult', 'wheel', 'stability', 'instructions', 'problems']);
  const modelId = safeSpeedModelId(input.modelId);
  if (!Number.isSafeInteger(input.revision) || Number(input.revision) < 1 ||
      typeof input.modelDigest !== 'string' || !/^[a-f0-9]{64}$/.test(input.modelDigest) || input.actuallyBuilt !== true ||
      !['success', 'partial', 'failure'].includes(input.buildResult as string) ||
      !['normal', 'friction', 'blocked'].includes(input.wheel as string) ||
      !['strong', 'stable', 'weak', 'impossible'].includes(input.stability as string) ||
      !['clear', 'difficult', 'impossible'].includes(input.instructions as string) ||
      !Array.isArray(input.problems) || input.problems.length > 100) invalid('请明确确认实际动手拼搭，并填写完整的模型版本、结果、轮组、稳定性及说明书反馈。');
  const problems = input.problems.map(value => {
    const problem = object(value, ['stepNumber', 'partId', 'issueType', 'text'], ['issueType', 'text']);
    if (problem.stepNumber !== undefined && (!Number.isSafeInteger(problem.stepNumber) || Number(problem.stepNumber) < 1) ||
        problem.partId !== undefined && (typeof problem.partId !== 'string' || !problem.partId.length || problem.partId.length > 120) ||
        !PHYSICAL_ISSUE_TYPES.includes(problem.issueType as PhysicalBuildProblem['issueType']) || typeof problem.text !== 'string' || problem.text.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(problem.text)) invalid('问题类型、步骤、零件编号或描述无效；每项描述最多 2000 字。');
    return {
      ...(problem.stepNumber !== undefined ? { stepNumber: Number(problem.stepNumber) } : {}),
      ...(problem.partId !== undefined ? { partId: problem.partId as string } : {}),
      issueType: problem.issueType as PhysicalBuildProblem['issueType'], text: problem.text,
    };
  });
  return { modelId, revision: Number(input.revision), modelDigest: input.modelDigest, actuallyBuilt: true, buildResult: input.buildResult as PhysicalBuildFeedbackInput['buildResult'], wheel: input.wheel as PhysicalBuildFeedbackInput['wheel'], stability: input.stability as PhysicalBuildFeedbackInput['stability'], instructions: input.instructions as PhysicalBuildFeedbackInput['instructions'], problems };
}

function status(input: PhysicalBuildFeedbackInput): PhysicalBuildFeedback['physicalValidation'] {
  return input.buildResult === 'success' && input.wheel === 'normal' && ['strong', 'stable'].includes(input.stability) && input.instructions === 'clear' && input.problems.length === 0 ? 'passed' : 'untested';
}

/** A successful record is an explicit user's physical report, never an automated proof. */
export function parsePhysicalBuildFeedback(value: unknown, document: SpeedModelDocument): PhysicalBuildFeedback {
  const input = parseInput(value), metadata = document.metadata;
  if (input.modelId !== metadata.modelId || input.revision !== metadata.revision || input.modelDigest !== metadata.modelDigest) throw new InventoryError('反馈引用的模型版本不一致，请重新打开要实拼的具体版本。', 'PHYSICAL_FEEDBACK_MODEL_MISMATCH', 409);
  for (const problem of input.problems) {
    if (problem.stepNumber !== undefined && !document.candidate.steps.some(step => step.stepNumber === problem.stepNumber)) invalid(`模型中不存在步骤 ${problem.stepNumber}。`);
    if (problem.partId !== undefined && !document.candidate.model.parts.some(part => part.partId === problem.partId || part.instanceId === problem.partId)) invalid(`模型中不存在零件 ${problem.partId}。`);
  }
  return { ...input, schemaVersion: 1, feedbackId: randomUUID(), submittedAt: new Date().toISOString(), userReported: true, physicalValidation: status(input), modelVersion: document.candidate.model.version, generatorVersion: metadata.generatorVersion, validatorVersion: metadata.validatorVersion, partLibraryVersion: metadata.partLibraryVersion };
}

function parseStoredFeedback(value: unknown): PhysicalBuildFeedback {
  const raw = object(value, ['schemaVersion', 'feedbackId', 'submittedAt', 'userReported', 'physicalValidation', 'modelVersion', 'generatorVersion', 'validatorVersion', 'partLibraryVersion', 'modelId', 'revision', 'modelDigest', 'actuallyBuilt', 'buildResult', 'wheel', 'stability', 'instructions', 'problems']);
  const input = parseInput(Object.fromEntries(['modelId', 'revision', 'modelDigest', 'actuallyBuilt', 'buildResult', 'wheel', 'stability', 'instructions', 'problems'].map(key => [key, raw[key]])));
  if (raw.schemaVersion !== 1 || raw.userReported !== true || raw.physicalValidation !== status(input) || typeof raw.feedbackId !== 'string' || !/^[a-f0-9-]{36}$/i.test(raw.feedbackId) || typeof raw.submittedAt !== 'string' || !Number.isFinite(Date.parse(raw.submittedAt)) || !Number.isSafeInteger(raw.modelVersion) || Number(raw.modelVersion) < 1 || ['generatorVersion', 'validatorVersion', 'partLibraryVersion'].some(key => typeof raw[key] !== 'string' || (raw[key] as string).length > 80)) invalid('实拼反馈存档内容无效。');
  return { ...raw, ...input } as unknown as PhysicalBuildFeedback;
}

export class SpeedPhysicalFeedbackDiskStore {
  readonly directory: string;
  constructor(options: { dataDir?: string } = {}) { this.directory = path.resolve(options.dataDir ?? process.env.BRICKLAB_DATA_DIR ?? 'data', 'feedback'); }

  async save(feedback: PhysicalBuildFeedback): Promise<void> {
    parseStoredFeedback(feedback);
    try { await atomicSpeedJsonWrite(path.join(this.directory, safeSpeedModelId(feedback.modelId), `${feedback.feedbackId}.json`), feedback, 1024 * 1024); }
    catch { throw new InventoryError('无法保存实拼反馈，请检查本地数据目录权限及可用空间。', 'PHYSICAL_FEEDBACK_STORAGE_UNAVAILABLE', 503); }
  }

  async list(modelId: string, revision?: number, digest?: string): Promise<PhysicalBuildFeedback[]> {
    const directory = path.join(this.directory, safeSpeedModelId(modelId));
    if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 1) || digest !== undefined && !/^[a-f0-9]{64}$/.test(digest)) invalid('反馈查询的版本或摘要无效。');
    try {
      const files = (await readdir(directory)).filter(file => /^[a-f0-9-]{36}\.json$/i.test(file));
      if (files.length > 10000) throw new InventoryError('此模型的反馈记录超过安全读取上限。', 'PHYSICAL_FEEDBACK_STORAGE_LIMIT', 503);
      const feedback: PhysicalBuildFeedback[] = [];
      for (const file of files) {
        const filename = path.join(directory, file), info = await stat(filename);
        if (!info.isFile() || info.size > 1024 * 1024) throw new Error('Invalid feedback file size');
        const item = parseStoredFeedback(JSON.parse(await readFile(filename, 'utf8')));
        if (item.modelId !== modelId || `${item.feedbackId}.json` !== file) throw new Error('Feedback identity mismatch');
        if ((revision === undefined || item.revision === revision) && (digest === undefined || item.modelDigest === digest)) feedback.push(item);
      }
      return feedback.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      if (error instanceof InventoryError && error.code === 'PHYSICAL_FEEDBACK_STORAGE_LIMIT') throw error;
      throw new InventoryError('实拼反馈存档损坏或无法读取，请保留原文件后检查数据目录。', 'PHYSICAL_FEEDBACK_STORAGE_CORRUPT', 500);
    }
  }
}
