import { describe, expect, it, vi } from 'vitest';
import { createInventoryProvider, MockInventoryProvider, normalizeSetNumber, RebrickableInventoryProvider } from '../src/inventory/index.js';

const metadata = { set_num: '10696-1', name: 'Test set' };
const part = (id = '3001', quantity = 2, colorId = 14) => ({
  quantity, part: { part_num: id, name: `Part ${id}`, part_cat_id: 11 },
  color: { id: colorId, name: 'Yellow', rgb: 'F2CD37' },
});
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

describe('inventory providers', () => {
  it('normalizes valid numbers and rejects paths, query strings and malformed input', () => {
    expect(normalizeSetNumber(' 10696 ')).toBe('10696-1');
    expect(normalizeSetNumber('11013-2')).toBe('11013-2');
    for (const input of ['../10696', '10696?key=leak', '10696/parts', '', '00123', '10696-0', 10696, null]) {
      expect(() => normalizeSetNumber(input)).toThrow();
    }
  });

  it('uses an explicit synthetic demo, includes unsupported parts, and returns fresh objects', async () => {
    const provider = new MockInventoryProvider();
    const inventory = await provider.getSetInventory('10696');
    expect(inventory.source).toBe('mock');
    expect(inventory.sourceLabel).toContain('非官方');
    expect(inventory.warnings.join(' ')).toContain('不代表');
    expect(inventory.items.filter(item => item.supported).reduce((sum, item) => sum + item.quantityAvailable, 0)).toBe(84);
    expect(inventory.items.filter(item => !item.supported).reduce((sum, item) => sum + item.quantityAvailable, 0)).toBe(6);
    inventory.items[0].quantityUsed = 100;
    inventory.items[0].color.hex = '000000';
    const next = await provider.getSetInventory('10696');
    expect(next.items[0].quantityUsed).toBe(0);
    expect(next.items[0].color.hex).toBe('#F2CD37');
    expect(next.items.every(item => /^#[A-F0-9]{6}$/.test(item.color.hex))).toBe(true);
    expect((await provider.getSetInventory('11013')).setNumber).toBe('11013-1');
    await expect(provider.getSetInventory('99999')).rejects.toMatchObject({ code: 'DEMO_SET_NOT_FOUND', status: 404 });
  });

  it('selects real data when a key is configured and never silently falls back from explicit real mode', () => {
    expect(createInventoryProvider({}).source).toBe('mock');
    expect(createInventoryProvider({ INVENTORY_PROVIDER: 'mock', REBRICKABLE_API_KEY: 'server-secret' }).source).toBe('mock');
    expect(createInventoryProvider({ REBRICKABLE_API_KEY: 'server-secret' }).source).toBe('rebrickable');
    expect(() => createInventoryProvider({ INVENTORY_PROVIDER: 'rebrickable' })).toThrow(/REBRICKABLE_API_KEY/);
    expect(() => createInventoryProvider({ INVENTORY_PROVIDER: 'typo' })).toThrow();
  });

  it('reads every real page, aggregates duplicate color identities, and does not infer unsupported geometry', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json(metadata))
      .mockResolvedValueOnce(json({ count: 4, next: 'https://rebrickable.com/api/v3/lego/sets/10696-1/parts/?page=2', results: [part(), part('not-in-catalog', 3)] }))
      .mockResolvedValueOnce(json({ count: 4, next: null, results: [part('3001', 4), part('3001', 1, 4)] }));
    const inventory = await new RebrickableInventoryProvider('server-secret', { fetch: fetcher }).getSetInventory('10696');
    expect(inventory.source).toBe('rebrickable');
    expect(inventory.items).toHaveLength(3);
    expect(inventory.items.find(item => item.partId === '3001' && item.color.id === 14)?.quantityAvailable).toBe(6);
    expect(inventory.items.find(item => item.partId === '3001')?.dimensions).toEqual({ x: 2, y: 4, z: 3 });
    expect(inventory.items.every(item => /^#[A-F0-9]{6}$/.test(item.color.hex))).toBe(true);
    expect(inventory.items.find(item => item.partId === 'not-in-catalog')).toMatchObject({ supported: false, category: 'Unsupported', quantityAvailable: 3 });
    expect(JSON.stringify(inventory)).not.toContain('server-secret');
    for (const [, init] of fetcher.mock.calls) {
      expect(init?.headers).toMatchObject({ Authorization: 'key server-secret' });
      expect(init?.redirect).toBe('error');
    }
  });

  it.each([
    'https://evil.example/api/v3/lego/sets/10696-1/parts/',
    'https://rebrickable.com.evil.example/api/v3/lego/sets/10696-1/parts/',
    'http://rebrickable.com/api/v3/lego/sets/10696-1/parts/',
    'https://user:password@rebrickable.com/api/v3/lego/sets/10696-1/parts/',
    'https://rebrickable.com/api/v3/other/',
  ])('never forwards API credentials to an unsafe pagination URL: %s', async next => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json(metadata))
      .mockResolvedValueOnce(json({ count: 2, next, results: [part()] }));
    await expect(new RebrickableInventoryProvider('server-secret', { fetch: fetcher }).getSetInventory('10696')).rejects.toMatchObject({ code: 'UPSTREAM_UNSAFE_PAGINATION' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('rejects incomplete inventory and never returns a partial success', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json(metadata))
      .mockResolvedValueOnce(json({ count: 8, next: null, results: [part()] }));
    await expect(new RebrickableInventoryProvider('test', { fetch: fetcher }).getSetInventory('10696')).rejects.toMatchObject({ code: 'UPSTREAM_INVALID_DATA' });
  });

  it('stops cyclic pagination before following it twice', async () => {
    const next = 'https://rebrickable.com/api/v3/lego/sets/10696-1/parts/?page=2';
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json(metadata))
      .mockImplementation(async () => json({ count: 3, next, results: [part()] }));
    await expect(new RebrickableInventoryProvider('test', { fetch: fetcher }).getSetInventory('10696')).rejects.toMatchObject({ code: 'UPSTREAM_PAGINATION_LIMIT' });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('caps noncyclic pagination without returning partial inventory', async () => {
    let page = 0;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json(metadata))
      .mockImplementation(async () => json({ count: 21, next: `https://rebrickable.com/api/v3/lego/sets/10696-1/parts/?page=${++page}`, results: [part()] }));
    await expect(new RebrickableInventoryProvider('test', { fetch: fetcher }).getSetInventory('10696')).rejects.toMatchObject({ code: 'UPSTREAM_PAGINATION_LIMIT' });
    expect(fetcher).toHaveBeenCalledTimes(21);
  });

  it('redacts upstream error bodies and transport messages', async () => {
    const failure = vi.fn<typeof fetch>().mockResolvedValue(new Response('server-secret internal diagnostics', { status: 401 }));
    await expect(new RebrickableInventoryProvider('server-secret', { fetch: failure }).getSetInventory('10696')).rejects.toMatchObject({ code: 'UPSTREAM_AUTH_FAILED' });
    const transport = vi.fn<typeof fetch>().mockRejectedValue(new Error('server-secret request detail'));
    try { await new RebrickableInventoryProvider('server-secret', { fetch: transport }).getSetInventory('10696'); }
    catch (error) { expect(String(error)).not.toContain('server-secret'); }
  });

  it('enforces an abort deadline', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
    }));
    await expect(new RebrickableInventoryProvider('test', { fetch: fetcher, timeoutMs: 5 }).getSetInventory('10696')).rejects.toMatchObject({ code: 'UPSTREAM_TIMEOUT' });
  });
});
