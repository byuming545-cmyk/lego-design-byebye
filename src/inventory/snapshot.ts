import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { SetInventory } from '../types/index.js';
import { InventoryError } from './provider.js';

export const INVENTORY_SNAPSHOT_SCHEMA = 'bricklab.inventory-snapshot';
export const INVENTORY_SNAPSHOT_SCHEMA_VERSION = 1;

/** Supplied by the Speed layer; the provider never imports a generation catalog. */
export interface InventorySupportSnapshot {
  catalogVersion: string;
  totalQuantity: number;
  supportedQuantity: number;
  recognizedOnlyQuantity: number;
  unsupportedQuantity: number;
  supportRatio: number;
  parts: Array<{
    partId: string;
    colorId: number;
    quantity: number;
    status: 'generatable' | 'recognizedOnly' | 'unsupported';
    category?: string;
  }>;
}

export interface RawSetInventorySnapshot {
  schema: typeof INVENTORY_SNAPSHOT_SCHEMA;
  schemaVersion: typeof INVENTORY_SNAPSHOT_SCHEMA_VERSION;
  snapshotId: string;
  fetchedAt: string;
  setNumber: string;
  source: 'rebrickable';
  raw: { metadata: Record<string, unknown>; pages: Record<string, unknown>[] };
  normalized: SetInventory;
  /** Explicitly the V0.1 geometry catalog, not Speed support. */
  basicSupport: { totalQuantity: number; supportedQuantity: number; unsupportedQuantity: number; supportRatio: number };
  speedSupport?: InventorySupportSnapshot;
}

function snapshotDirectory(dataDir?: string): string {
  return path.join(dataDir || process.env.BRICKLAB_DATA_DIR || 'data', 'inventories');
}

function snapshotFile(snapshotId: string, dataDir?: string): string {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(snapshotId)) {
    throw new InventoryError('库存快照编号无效。', 'INVALID_SNAPSHOT_ID', 400);
  }
  return path.join(snapshotDirectory(dataDir), `${snapshotId}.json`);
}

async function writeAtomically(snapshot: RawSetInventorySnapshot, dataDir?: string): Promise<void> {
  const target = snapshotFile(snapshot.snapshotId, dataDir);
  const temporary = `${target}.tmp-${randomUUID()}`;
  try {
    await mkdir(snapshotDirectory(dataDir), { recursive: true, mode: 0o700 });
    const file = await open(temporary, 'wx', 0o600);
    try {
      await file.writeFile(`${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
      await file.sync();
    } finally { await file.close(); }
    await rename(temporary, target);
  } catch {
    await unlink(temporary).catch(() => undefined);
    // Never pass filesystem paths or operating-system diagnostics through the API.
    throw new InventoryError('真实库存已读取，但库存快照保存失败；请检查服务端数据目录后重试。', 'INVENTORY_SNAPSHOT_WRITE_FAILED', 503);
  }
}

/** Persist after every page is validated, retaining response bodies and never request headers or keys. */
export async function saveInventorySnapshot(
  inventory: SetInventory,
  raw: RawSetInventorySnapshot['raw'],
  dataDir?: string,
): Promise<void> {
  if (inventory.source !== 'rebrickable' || !inventory.snapshotId || !inventory.fetchedAt) {
    throw new InventoryError('库存快照缺少真实来源或读取时间。', 'INVALID_SNAPSHOT_METADATA', 500);
  }
  const totalQuantity = inventory.items.reduce((sum, item) => sum + item.quantityAvailable, 0);
  const supportedQuantity = inventory.items.filter(item => item.supported).reduce((sum, item) => sum + item.quantityAvailable, 0);
  await writeAtomically({
    schema: INVENTORY_SNAPSHOT_SCHEMA, schemaVersion: INVENTORY_SNAPSHOT_SCHEMA_VERSION,
    snapshotId: inventory.snapshotId, fetchedAt: inventory.fetchedAt, setNumber: inventory.setNumber,
    source: 'rebrickable', raw: structuredClone(raw), normalized: structuredClone(inventory),
    basicSupport: { totalQuantity, supportedQuantity, unsupportedQuantity: totalQuantity - supportedQuantity, supportRatio: totalQuantity ? supportedQuantity / totalQuantity : 0 },
  }, dataDir);
}

/** Add Speed's independently classified support report to an existing raw snapshot. */
export async function enrichInventorySnapshot(snapshotId: string, support: InventorySupportSnapshot, dataDir?: string): Promise<void> {
  const target = snapshotFile(snapshotId, dataDir);
  let snapshot: RawSetInventorySnapshot;
  try {
    snapshot = JSON.parse(await readFile(target, 'utf8')) as RawSetInventorySnapshot;
    if (snapshot.schema !== INVENTORY_SNAPSHOT_SCHEMA || snapshot.schemaVersion !== INVENTORY_SNAPSHOT_SCHEMA_VERSION || snapshot.snapshotId !== snapshotId) throw new Error('Invalid schema');
  } catch {
    throw new InventoryError('无法读取待扩充的库存快照，请重新读取套装库存。', 'INVENTORY_SNAPSHOT_READ_FAILED', 503);
  }
  snapshot.speedSupport = structuredClone(support);
  await writeAtomically(snapshot, dataDir);
}
