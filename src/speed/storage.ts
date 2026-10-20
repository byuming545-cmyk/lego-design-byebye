import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { InventoryError } from '../inventory/index.js';
import { assertStoredSpeedDocument, MAX_SPEED_DOCUMENT_BYTES, packSpeedDocument, safeSpeedModelId, summarizeSpeedDocument, unpackStoredSpeedDocument, type SpeedModelDocument, type SpeedModelSummary } from './documents.js';

function storageError(error: unknown): never {
  if (error instanceof InventoryError) throw error;
  throw new InventoryError('无法读写本地模型存档，请检查 BRICKLAB_DATA_DIR 的目录权限及可用空间。', 'SPEED_MODEL_STORAGE_UNAVAILABLE', 503);
}

/** One process may have several design sessions / store objects for the same file. */
const pendingWrites = new Map<string, Promise<void>>();
export interface SpeedModelRevision { revision: number; modelDigest: string }

/** Same-directory rename ensures readers see either the previous complete JSON or the new one. */
export async function atomicSpeedJsonWrite(filename: string, value: unknown, maxBytes = MAX_SPEED_DOCUMENT_BYTES): Promise<void> {
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json) > maxBytes) throw new InventoryError('模型 JSON 超过 40 MB 安全上限。', 'SPEED_MODEL_TOO_LARGE', 413);
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, json, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await rename(temporary, filename);
  } finally {
    await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
  }
}

export class SpeedModelDiskStore {
  readonly directory: string;

  constructor(options: { dataDir?: string } = {}) {
    this.directory = path.resolve(options.dataDir ?? process.env.BRICKLAB_DATA_DIR ?? 'data', 'models');
  }

  private filename(id: string): string { return path.join(this.directory, `${safeSpeedModelId(id)}.json`); }

  private revisionFilename(document: SpeedModelDocument): string {
    const { modelId, revision, modelDigest } = document.metadata;
    return path.join(this.directory, 'revisions', `${safeSpeedModelId(modelId)}-${revision}-${modelDigest}.json`);
  }

  async save(document: SpeedModelDocument, expectedPrevious?: SpeedModelRevision): Promise<void> {
    assertStoredSpeedDocument(document);
    const filename = this.filename(document.metadata.modelId);
    const previous = pendingWrites.get(filename) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(async () => {
      let current: SpeedModelDocument | undefined;
      try { current = await this.load(document.metadata.modelId); }
      catch (error) { if (!(error instanceof InventoryError) || error.code !== 'SPEED_MODEL_NOT_FOUND') throw error; }
      if (expectedPrevious ? !current || current.metadata.revision !== expectedPrevious.revision || current.metadata.modelDigest !== expectedPrevious.modelDigest || document.metadata.revision !== expectedPrevious.revision + 1 : current !== undefined) {
        throw new InventoryError('此模型已有较新的存档；请重新打开最新版本后修改。', 'SPEED_MODEL_REVISION_CONFLICT', 409);
      }
      // Save the exact build first; feedback can always resolve its immutable revision.
      const packed = packSpeedDocument(document);
      await atomicSpeedJsonWrite(this.revisionFilename(document), packed);
      await atomicSpeedJsonWrite(filename, packed);
    });
    pendingWrites.set(filename, operation);
    try {
      await operation;
    } catch (error) { storageError(error); }
    finally { if (pendingWrites.get(filename) === operation) pendingWrites.delete(filename); }
  }

  private async read(filename: string): Promise<SpeedModelDocument> {
    const details = await stat(filename);
    if (!details.isFile() || details.size > MAX_SPEED_DOCUMENT_BYTES) throw new InventoryError('模型存档超过安全大小或不是普通文件。', 'SPEED_MODEL_STORAGE_CORRUPT', 500);
    let document: unknown;
    try { document = JSON.parse(await readFile(filename, 'utf8')); }
    catch (error) {
      if (error instanceof SyntaxError) throw new InventoryError('模型存档 JSON 损坏，请保留文件并重新导入有效副本。', 'SPEED_MODEL_STORAGE_CORRUPT', 500);
      throw error;
    }
    return unpackStoredSpeedDocument(document);
  }

  async load(id: string): Promise<SpeedModelDocument> {
    const filename = this.filename(id);
    try {
      const document = await this.read(filename);
      if (document.metadata.modelId !== id) throw new InventoryError('模型存档编号不匹配。', 'SPEED_MODEL_STORAGE_CORRUPT', 500);
      return document;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new InventoryError('找不到此模型存档。', 'SPEED_MODEL_NOT_FOUND', 404);
      storageError(error);
    }
  }

  async loadRevision(id: string, revision: number, digest: string): Promise<SpeedModelDocument> {
    safeSpeedModelId(id);
    if (!Number.isSafeInteger(revision) || revision < 1 || !/^[a-f0-9]{64}$/.test(digest)) throw new InventoryError('模型版本或摘要无效。', 'INVALID_SPEED_MODEL_REVISION', 400);
    try {
      const document = await this.read(path.join(this.directory, 'revisions', `${id}-${revision}-${digest}.json`));
      if (document.metadata.modelId !== id || document.metadata.revision !== revision || document.metadata.modelDigest !== digest) throw new InventoryError('模型版本存档不匹配。', 'SPEED_MODEL_STORAGE_CORRUPT', 500);
      return document;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new InventoryError('找不到反馈所引用的模型版本。', 'SPEED_MODEL_REVISION_NOT_FOUND', 404);
      storageError(error);
    }
  }

  async list(limit = 30): Promise<SpeedModelSummary[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new InventoryError('模型列表数量须为 1–100。', 'INVALID_SPEED_MODEL_LIMIT', 400);
    try {
      const entries = (await readdir(this.directory, { withFileTypes: true })).filter(entry => entry.isFile() && /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}\.json$/.test(entry.name));
      const files = await Promise.all(entries.map(async entry => ({ name: entry.name, modified: (await stat(path.join(this.directory, entry.name))).mtimeMs })));
      files.sort((a, b) => b.modified - a.modified || a.name.localeCompare(b.name));
      const models: SpeedModelSummary[] = [];
      for (const file of files.slice(0, limit)) models.push(summarizeSpeedDocument(await this.load(file.name.slice(0, -5))));
      return models;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      storageError(error);
    }
  }
}
