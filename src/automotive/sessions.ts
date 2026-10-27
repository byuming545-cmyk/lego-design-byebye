import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { InventoryError } from '../inventory/index.js';
import { atomicSpeedJsonWrite } from '../speed/storage.js';
import type { AutomotiveDesignResponse } from './contracts.js';

const MAX_BYTES = 24 * 1024 * 1024;
const safeId = (id: string) => {
  if (!/^auto-[a-f0-9-]{36}$/.test(id)) throw new InventoryError('汽车设计会话编号无效。', 'INVALID_AUTOMOTIVE_SESSION', 400);
  return id;
};
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const newAutomotiveSessionId = () => `auto-${randomUUID()}`;

export class AutomotiveSessionStore {
  private directory: string;
  constructor(options: { dataDir?: string } = {}) { this.directory = path.resolve(options.dataDir ?? process.env.BRICKLAB_DATA_DIR ?? 'data', 'automotive', 'sessions'); }
  async save(session: AutomotiveDesignResponse): Promise<void> {
    await atomicSpeedJsonWrite(path.join(this.directory, `${safeId(session.sessionId)}.json`), { digest: digest(session), session }, MAX_BYTES);
  }
  async get(id: string): Promise<AutomotiveDesignResponse> {
    try {
      const filename = path.join(this.directory, `${safeId(id)}.json`), info = await lstat(filename);
      if (!info.isFile() || info.size > MAX_BYTES) throw new Error('corrupt');
      const record = JSON.parse(await readFile(filename, 'utf8')) as { digest: string; session: AutomotiveDesignResponse };
      if (!record.session || record.session.schemaVersion !== 1 || record.session.sessionId !== id || !Array.isArray(record.session.candidates) || record.digest !== digest(record.session)) throw new Error('corrupt');
      return record.session;
    } catch (error) {
      if (error instanceof InventoryError) throw error;
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new InventoryError('找不到此汽车设计会话。', 'AUTOMOTIVE_SESSION_NOT_FOUND', 404);
      throw new InventoryError('汽车设计存档损坏，请保留文件并重新生成。', 'AUTOMOTIVE_SESSION_CORRUPT', 500);
    }
  }
}
