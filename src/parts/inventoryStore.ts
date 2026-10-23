import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { InventoryError } from '../inventory/index.js';
import { parseFoundationInventory, type FoundationInventory } from './inventory/index.js';

// Serialize writes per directory so document-limit checks and idempotency also hold concurrently.
const writes = new Map<string, Promise<unknown>>();
export async function storeLocalInventory(directory: string, inventory: FoundationInventory, capacity: number) {
  const operation = (writes.get(directory) ?? Promise.resolve()).catch(() => undefined).then(async () => {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    // CSV bytes alone do not identify their set, namespace, or source metadata.
    const semantic = { ...inventory, provenance: { ...inventory.provenance, importedAt: undefined } };
    const key = createHash('sha256').update(JSON.stringify(semantic)).digest('hex');
    const filename = path.join(directory, `${key}.json`);
    try {
      const saved = parseFoundationInventory(JSON.parse(await readFile(filename, 'utf8')));
      return { inventory: saved, alreadyPresent: true };
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const count = (await readdir(directory)).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).length;
    if (count >= capacity) throw new InventoryError('本地清单数量已达到统计上限，请先移除重复清单。', 'FOUNDATION_INVENTORY_LIMIT', 409);
    const temporary = `${filename}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(inventory, null, 2), { flag: 'wx', mode: 0o600 });
      await rename(temporary, filename);
    } finally { await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }); }
    return { inventory, alreadyPresent: false };
  });
  writes.set(directory, operation);
  try { return await operation; }
  finally { if (writes.get(directory) === operation) writes.delete(directory); }
}
