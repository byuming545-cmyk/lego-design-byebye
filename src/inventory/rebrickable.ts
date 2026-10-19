import { getPartDefinition } from '../lego/catalog.js';
import type { PartInventoryItem, SetInventory } from '../types/index.js';
import { InventoryError, normalizeSetNumber, type SetInventoryProvider } from './provider.js';

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
}

/** Only the server instantiates this class; the API key never enters client JSON. */
export class RebrickableInventoryProvider implements SetInventoryProvider {
  readonly source = 'rebrickable' as const;
  private readonly fetcher: typeof globalThis.fetch;
  private readonly timeoutMs: number;

  constructor(private readonly apiKey: string, options: RebrickableOptions = {}) {
    if (!apiKey.trim()) throw new InventoryError('请在服务端配置 REBRICKABLE_API_KEY。', 'MISSING_API_KEY', 503);
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
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
    let rows = 0;
    let totalQuantity = 0;
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
      for (const row of data.results) {
        if (!object(row) || !object(row.part) || !object(row.color)) invalidData();
        const { part, color } = row;
        if (typeof part.part_num !== 'string' || part.part_num.length > 100 || typeof part.name !== 'string' || typeof color.name !== 'string' || !Number.isSafeInteger(color.id) || !Number.isSafeInteger(row.quantity) || Number(row.quantity) < 1) invalidData();
        rows++;
        totalQuantity += Number(row.quantity);
        if (rows > MAX_ROWS || totalQuantity > MAX_QUANTITY) invalidData();
        const definition = getPartDefinition(part.part_num);
        const key = `${part.part_num}:${color.id}`;
        const existing = inventory.get(key);
        if (existing) existing.quantityAvailable += Number(row.quantity);
        else inventory.set(key, {
          partId: part.part_num, name: part.name.slice(0, 200), category: definition?.category ?? 'Unsupported',
          color: { id: Number(color.id), name: color.name.slice(0, 100), hex: typeof color.rgb === 'string' && /^[a-fA-F0-9]{6}$/.test(color.rgb) ? `#${color.rgb.toUpperCase()}` : '#A0A5A9' },
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
    const items = [...inventory.values()];
    const unsupported = items.filter(item => !item.supported).reduce((sum, item) => sum + item.quantityAvailable, 0);
    return {
      setNumber, name: metadata.name.slice(0, 200), source: this.source, sourceLabel: 'Rebrickable · 实时套装库存', items,
      warnings: unsupported ? [`${unsupported} 个零件暂未收录到 V0.1 几何目录，仅展示且不会用于生成。未支持零件的尺寸为占位值。`] : [],
    };
  }
}
