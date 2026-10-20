import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { enrichInventorySnapshot, RebrickableInventoryProvider, type InventorySupportSnapshot } from '../src/inventory/index.js';

const directories: string[] = [];
const metadata = { set_num: '76922-1', name: 'Synthetic inventory contract fixture', year: 2024, num_parts: 6 };
const row = (partId: string, quantity: number, isSpare?: boolean, colorId = 14) => ({
  id: `${partId}-${quantity}-${isSpare}`,
  quantity,
  ...(isSpare === undefined ? {} : { is_spare: isSpare }),
  part: { part_num: partId, name: `Upstream ${partId}`, part_cat_id: 11 },
  color: { id: colorId, name: 'Yellow', rgb: 'F2CD37', is_trans: false },
});
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

async function dataDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'bricklab-inventory-snapshot-'));
  directories.push(directory);
  return directory;
}

async function snapshotFiles(dataDir: string): Promise<string[]> {
  try { return await readdir(join(dataDir, 'inventories')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe('real inventory snapshot contract using synthetic upstream responses', () => {
  it('preserves all upstream pages and spare quantities while excluding spares from usable stock', async () => {
    const dataDir = await dataDirectory();
    const pages = [
      { count: 6, next: 'https://rebrickable.com/api/v3/lego/sets/76922-1/parts/?page=2', previous: null,
        results: [row('3001', 2, false), row('3001', 1, true), row('unmodeled-part', 3, false)] },
      { count: 6, next: null, previous: 'https://rebrickable.com/api/v3/lego/sets/76922-1/parts/?page=1',
        results: [row('3001', 4, false), row('3001', 2, true), row('spare-only-part', 5, true)] },
    ];
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json(metadata))
      .mockResolvedValueOnce(json(pages[0])).mockResolvedValueOnce(json(pages[1]));

    const inventory = await new RebrickableInventoryProvider('snapshot-test-key', { fetch: fetcher, dataDir }).getSetInventory('76922');

    expect(inventory.sparePolicy).toBe('excluded');
    expect(inventory.quantitySummary).toEqual({ regularQuantity: 9, spareQuantity: 8, totalQuantity: 17 });
    expect(inventory.items.find(item => item.partId === '3001')).toMatchObject({
      name: 'Upstream 3001', partCategoryId: 11, quantityAvailable: 6, quantitySpare: 3, quantityTotal: 9,
    });
    expect(inventory.items.find(item => item.partId === 'unmodeled-part')).toMatchObject({ quantityAvailable: 3, supported: false });
    expect(inventory.items.some(item => item.partId === 'spare-only-part')).toBe(false);
    expect(inventory.spareItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ partId: '3001', quantityAvailable: 3 }),
      expect.objectContaining({ partId: 'spare-only-part', quantityAvailable: 5 }),
    ]));
    expect(inventory.rawItems).toHaveLength(6);
    expect(inventory.rawItems?.map(item => [item.partId, item.quantity, item.isSpare])).toEqual([
      ['3001', 2, false], ['3001', 1, true], ['unmodeled-part', 3, false],
      ['3001', 4, false], ['3001', 2, true], ['spare-only-part', 5, true],
    ]);
    expect(inventory.rawItems?.every(item => item.partCategoryId === 11 && item.color.name === 'Yellow')).toBe(true);
    expect(inventory.snapshotId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(Number.isNaN(Date.parse(inventory.fetchedAt!))).toBe(false);

    const files = await snapshotFiles(dataDir);
    expect(files).toEqual([`${inventory.snapshotId}.json`]);
    const persisted = JSON.parse(await readFile(join(dataDir, 'inventories', files[0]), 'utf8'));
    expect(persisted).toMatchObject({
      schema: 'bricklab.inventory-snapshot', schemaVersion: 1,
      snapshotId: inventory.snapshotId, fetchedAt: inventory.fetchedAt,
      setNumber: '76922-1', source: 'rebrickable',
    });
    expect(persisted.raw).toEqual({ metadata, pages });
    expect(persisted.normalized).toEqual(inventory);
    for (const value of [JSON.stringify(inventory), JSON.stringify(persisted)]) {
      expect(value).not.toContain('snapshot-test-key');
      expect(value).not.toContain(dataDir);
      expect(value).not.toContain('Authorization');
    }
  });

  it('keeps omitted upstream spare flags unknown and preserves their legacy usable quantities', async () => {
    const dataDir = await dataDirectory();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json(metadata))
      .mockResolvedValueOnce(json({ count: 1, next: null, results: [row('3001', 2)] }));
    const inventory = await new RebrickableInventoryProvider('fixture-key', { fetch: fetcher, dataDir }).getSetInventory('76922');
    expect(inventory.rawItems?.[0].isSpare).toBeNull();
    expect(inventory.items[0].quantityAvailable).toBe(2);
    expect(inventory.quantitySummary).toEqual({ regularQuantity: 2, spareQuantity: 0, totalQuantity: 2 });
    expect(inventory.spareItems).toEqual([]);
  });

  it('adds independently classified Speed support without changing raw evidence or normalized stock', async () => {
    const dataDir = await dataDirectory();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json(metadata))
      .mockResolvedValueOnce(json({ count: 2, next: null, results: [row('3001', 2, false), row('unknown-part', 3, false)] }));
    const inventory = await new RebrickableInventoryProvider('fixture-key', { fetch: fetcher, dataDir }).getSetInventory('76922');
    const file = join(dataDir, 'inventories', `${inventory.snapshotId}.json`);
    const before = JSON.parse(await readFile(file, 'utf8'));
    const speedSupport: InventorySupportSnapshot = {
      catalogVersion: 'fixture-speed-catalog', totalQuantity: 5, supportedQuantity: 2,
      recognizedOnlyQuantity: 0, unsupportedQuantity: 3, supportRatio: 0.4,
      parts: [
        { partId: '3001', colorId: 14, quantity: 2, status: 'generatable', category: 'Brick' },
        { partId: 'unknown-part', colorId: 14, quantity: 3, status: 'unsupported' },
      ],
    };

    await enrichInventorySnapshot(inventory.snapshotId!, speedSupport, dataDir);

    const after = JSON.parse(await readFile(file, 'utf8'));
    expect(after.speedSupport).toEqual(speedSupport);
    expect(after.raw).toEqual(before.raw);
    expect(after.normalized).toEqual(before.normalized);
    expect(after.basicSupport).toEqual(before.basicSupport);
    expect(after.snapshotId).toBe(inventory.snapshotId);
    expect(after.fetchedAt).toBe(inventory.fetchedAt);
    expect(await snapshotFiles(dataDir)).toEqual([`${inventory.snapshotId}.json`]);
  });

  it('does not persist a partial inventory when a later page fails', async () => {
    const dataDir = await dataDirectory();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json(metadata))
      .mockResolvedValueOnce(json({ count: 2, next: 'https://rebrickable.com/api/v3/lego/sets/76922-1/parts/?page=2', results: [row('3001', 2, false)] }))
      .mockResolvedValueOnce(new Response('private upstream diagnostic', { status: 503 }));
    await expect(new RebrickableInventoryProvider('fixture-key', { fetch: fetcher, dataDir }).getSetInventory('76922'))
      .rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
    expect(await snapshotFiles(dataDir)).toEqual([]);
  });

  it('does not persist truncated or malformed completed inventories', async () => {
    const dataDir = await dataDirectory();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json(metadata))
      .mockResolvedValueOnce(json({ count: 3, next: null, results: [row('3001', 2, false)] }));
    await expect(new RebrickableInventoryProvider('fixture-key', { fetch: fetcher, dataDir }).getSetInventory('76922'))
      .rejects.toMatchObject({ code: 'UPSTREAM_INVALID_DATA' });
    expect(await snapshotFiles(dataDir)).toEqual([]);
  });

  it('fails explicitly and redacts local paths when a completed inventory cannot be saved', async () => {
    const dataDir = await dataDirectory();
    // A regular file blocks the storage directory on every supported OS, even as root.
    await writeFile(join(dataDir, 'inventories'), 'occupied');
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json(metadata))
      .mockResolvedValueOnce(json({ count: 1, next: null, results: [row('3001', 2, false)] }));
    try {
      await new RebrickableInventoryProvider('fixture-key', { fetch: fetcher, dataDir }).getSetInventory('76922');
      expect.fail('Snapshot persistence must complete before inventory success is returned.');
    } catch (error) {
      expect(error).toMatchObject({ code: 'INVENTORY_SNAPSHOT_WRITE_FAILED' });
      expect(String(error)).not.toContain(dataDir);
      expect(String(error)).not.toContain('fixture-key');
    }
    expect(await readFile(join(dataDir, 'inventories'), 'utf8')).toBe('occupied');
  });
});
