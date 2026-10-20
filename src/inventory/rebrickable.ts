import { randomUUID } from 'node:crypto';
import { getPartDefinition } from '../lego/catalog.js';
import type { PartInventoryItem, RawInventoryItem, SetInventory } from '../types/index.js';
import { InventoryError, normalizeSetNumber, type SetInventoryProvider } from './provider.js';
import { saveInventorySnapshot } from './snapshot.js';

type JsonObject = Record<string, unknown>;
const BASE = 'https://rebrickable.com';
const MAX_PAGES = 20;
const MAX_ROWS = 20_000;
const MAX_QUANTITY = 100_000;

function object(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function invalidData(): never {
  throw new InventoryError('Rebrickable 返回的数据不完整或格式不受支持，请稍后重试。', 'UPSTREAM_INVALID_DATA', 502);
}

interface RebrickableOptions {
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  /** Server-only snapshot root; never included in returned inventories. */
  dataDir?: string;
}

/** Only the server instantiates this class; the API key never enters client JSON. */
export class RebrickableInventoryProvider implements SetInventoryProvider {
  readonly source = 'rebrickable' as const;
  private readonly fetcher: typeof globalThis.fetch;
  private readonly timeoutMs: number;
  private readonly dataDir?: string;

  constructor(private readonly apiKey: string, options: RebrickableOptions = {}) {
    if (!apiKey.trim()) throw new InventoryError('Rebrickable API Key 未配置。', 'MISSING_API_KEY', 503);
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.dataDir = options.dataDir;
  }

  private async request(url: URL): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      // A redirect must not forward the authorization header to a different origin.
      const response = await this.fetcher(url, {
        headers: { Authorization: `key ${this.apiKey}`, Accept: 'application/json' },
        signal: controller.signal, redirect: 'error',
      });
      if (!response.ok) {
        const code = response.status === 404 ? 'SET_NOT_FOUND' : response.status === 401 || response.status === 403 ? 'UPSTREAM_AUTH_FAILED' : response.status === 429 ? 'UPSTREAM_RATE_LIMIT' : 'UPSTREAM_ERROR';
        const message = response.status === 404 ? 'Rebrickable 中未找到此套装，请检查编号。' : response.status === 401 || response.status === 403 ? 'Rebrickable 授权失败，请检查服务端 API Key 及网络设置。' : response.status === 429 ? 'Rebrickable 请求过于频繁，请稍后重试。' : 'Rebrickable 服务暂时不可用，请稍后重试。';
        throw new InventoryError(message, code, response.status === 404 ? 404 : response.status === 429 ? 429 : 502);
      }
      try { return await response.json(); }
      catch {
        if (controller.signal.aborted) throw new Error('Response deadline exceeded');
        return invalidData();
      }
    } catch (error) {
      if (error instanceof InventoryError) throw error;
      throw new InventoryError(controller.signal.aborted ? 'Rebrickable 请求超时，请稍后重试。' : '无法连接 Rebrickable，请检查网络是否允许 rebrickable.com。', controller.signal.aborted ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_NETWORK_ERROR', 502);
    } finally { clearTimeout(timer); }
  }

  async getSetInventory(input: string): Promise<SetInventory> {
    const setNumber = normalizeSetNumber(input);
    const rootPath = `/api/v3/lego/sets/${setNumber}/`;
    const metadata = await this.request(new URL(rootPath, BASE));
    if (!object(metadata) || metadata.set_num !== setNumber || typeof metadata.name !== 'string') invalidData();
    const partsPath = `${rootPath}parts/`;
    let next: URL | null = new URL(`${partsPath}?page_size=1000&inc_minifig_parts=1`, BASE);
    const visited = new Set<string>();
    const inventory = new Map<string, PartInventoryItem>();
    const spareInventory = new Map<string, PartInventoryItem>();
    const rawItems: RawInventoryItem[] = [];
    const pages: JsonObject[] = [];
    let rows = 0;
    let totalQuantity = 0;
    let spareQuantity = 0;
    let expectedCount: number | undefined;
    for (let page = 0; next !== null; page++) {
      if (page >= MAX_PAGES || visited.has(next.href)) {
        throw new InventoryError('Rebrickable 库存分页超出安全限制，未返回部分库存。', 'UPSTREAM_PAGINATION_LIMIT', 502);
      }
      visited.add(next.href);
      const data = await this.request(next);
      if (!object(data) || !Array.isArray(data.results) || (data.next !== null && typeof data.next !== 'string') || !Number.isSafeInteger(data.count) || Number(data.count) < 0) invalidData();
      if (expectedCount === undefined) expectedCount = Number(data.count);
      if (expectedCount !== data.count || expectedCount > MAX_ROWS) invalidData();
      pages.push(data);
      for (const [rowIndex, row] of data.results.entries()) {
        if (!object(row) || !object(row.part) || !object(row.color)) invalidData();
        const { part, color } = row;
        if (typeof part.part_num !== 'string' || !part.part_num.length || part.part_num.length > 100 || typeof part.name !== 'string' || typeof color.name !== 'string' || !Number.isSafeInteger(color.id) || Number(color.id) < 0 || !Number.isSafeInteger(row.quantity) || Number(row.quantity) < 1) invalidData();
        if (part.part_cat_id !== undefined && part.part_cat_id !== null && (!Number.isSafeInteger(part.part_cat_id) || Number(part.part_cat_id) < 0)) invalidData();
        if (row.is_spare !== undefined && row.is_spare !== null && typeof row.is_spare !== 'boolean') invalidData();
        const isSpare = typeof row.is_spare === 'boolean' ? row.is_spare : null;
        const partCategoryId = typeof part.part_cat_id === 'number' ? part.part_cat_id : null;
        const normalizedColor = { id: Number(color.id), name: color.name.slice(0, 100), hex: typeof color.rgb === 'string' && /^[a-fA-F0-9]{6}$/.test(color.rgb) ? `#${color.rgb.toUpperCase()}` : '#A0A5A9' };
        rows++;
        totalQuantity += Number(row.quantity);
        if (isSpare) spareQuantity += Number(row.quantity);
        if (rows > MAX_ROWS || totalQuantity > MAX_QUANTITY) invalidData();
        rawItems.push({ partId: part.part_num, name: part.name, partCategoryId, color: { ...normalizedColor, name: color.name }, quantity: Number(row.quantity), isSpare, page: page + 1, row: rowIndex + 1 });
        const definition = getPartDefinition(part.part_num);
        const key = `${part.part_num}:${color.id}`;
        const destination = isSpare ? spareInventory : inventory;
        const existing = destination.get(key);
        if (existing) existing.quantityAvailable += Number(row.quantity);
        else destination.set(key, {
          partId: part.part_num, name: part.name.slice(0, 200), category: definition?.category ?? 'Unsupported',
          color: normalizedColor, partCategoryId,
          quantityAvailable: Number(row.quantity), quantityUsed: 0,
          supported: Boolean(definition), dimensions: definition ? { ...definition.dimensions } : { x: 1, y: 1, z: 1 },
        });
      }
      if (data.next === null) next = null;
      else {
        let candidate: URL;
        try { candidate = new URL(data.next as string, BASE); } catch { invalidData(); }
        if (candidate.origin !== BASE || candidate.username || candidate.password || candidate.pathname !== partsPath || candidate.hash) {
          throw new InventoryError('Rebrickable 返回了不安全的分页地址，已停止读取。', 'UPSTREAM_UNSAFE_PAGINATION', 502);
        }
        next = candidate;
      }
    }
    if (rows !== expectedCount) invalidData();
    for (const [key, item] of inventory) {
      item.quantitySpare = spareInventory.get(key)?.quantityAvailable ?? 0;
      item.quantityTotal = item.quantityAvailable + item.quantitySpare;
    }
    for (const [key, item] of spareInventory) {
      item.quantitySpare = item.quantityAvailable;
      item.quantityTotal = item.quantityAvailable + (inventory.get(key)?.quantityAvailable ?? 0);
    }
    const items = [...inventory.values()];
    const unsupported = items.filter(item => !item.supported).reduce((sum, item) => sum + item.quantityAvailable, 0);
    const warnings = unsupported ? [`${unsupported} 个零件暂未收录到 V0.1 几何目录，仅展示且不会用于生成。未支持零件的尺寸为占位值。`] : [];
    warnings.push(`生成库存不包含备用零件（spares）；另行保留 ${spareQuantity} 件备用零件供溯源。`);
    if (rawItems.some(item => item.isSpare === null)) warnings.push('部分上游库存行未提供 spare 标记，已按非备用库存保留；原始快照中标记为未知。');
    const result: SetInventory = {
      setNumber, name: metadata.name.slice(0, 200), source: this.source, sourceLabel: 'Rebrickable · 实时套装库存', items,
      warnings, snapshotId: randomUUID(), fetchedAt: new Date().toISOString(), sparePolicy: 'excluded',
      rawItems, spareItems: [...spareInventory.values()],
      quantitySummary: { regularQuantity: totalQuantity - spareQuantity, spareQuantity, totalQuantity },
      ...(Number.isSafeInteger(metadata.theme_id) && Number(metadata.theme_id) >= 0 ? { themeId: Number(metadata.theme_id) } : {}),
    };
    await saveInventorySnapshot(result, { metadata, pages }, this.dataDir);
    return result;
  }
}
