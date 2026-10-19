import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from '../src/api/app.js';
import { MockInventoryProvider, type SetInventoryProvider } from '../src/inventory/index.js';
import type { GenerationResult } from '../src/types/index.js';

const options = { prompt: '生成一个小机器人', size: 'balanced', colorStrategy: 'substitute', maximizeUsage: false };
let server: Server;
let base: string;
const provider = new MockInventoryProvider();
const inventorySpy = vi.spyOn(provider, 'getSetInventory');

async function post(body: unknown) {
  return fetch(`${base}/api/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

beforeAll(async () => {
  server = createApp({ provider, staticDir: false }).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test address');
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });

describe('HTTP API', () => {
  it('reports the active provider and loads a labeled inventory', async () => {
    expect(await (await fetch(`${base}/api/health`)).json()).toMatchObject({ status: 'ok', provider: 'mock', demo: true });
    const response = await fetch(`${base}/api/sets/10696`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ setNumber: '10696-1', source: 'mock' });
    expect((await fetch(`${base}/api/sets/99999`)).status).toBe(404);
    expect((await fetch(`${base}/api/sets/no-number`)).status).toBe(400);
  });

  it('generates a valid model from server-read inventory and reports actual usage', async () => {
    inventorySpy.mockClear();
    const response = await post({ setNumber: '10696', options });
    expect(response.status).toBe(200);
    const result = await response.json() as GenerationResult;
    expect(inventorySpy).toHaveBeenCalledExactlyOnceWith('10696-1');
    expect(result.validation.valid).toBe(true);
    expect(result.model.parts.length).toBeGreaterThan(0);
    expect(result.steps.at(-1)?.totalModelState).toHaveLength(result.model.parts.length);
    expect(result.inventory.items.reduce((sum, item) => sum + item.quantityUsed, 0)).toBe(result.model.parts.length);
    expect(result.inventory.items.every(item => item.quantityUsed <= item.quantityAvailable)).toBe(true);
    expect(result.inventory.items.filter(item => !item.supported).every(item => item.quantityUsed === 0)).toBe(true);
    const untouched = await provider.getSetInventory('10696');
    expect(untouched.items.every(item => item.quantityUsed === 0)).toBe(true);
  });

  it.each([
    { options: { ...options, size: 'enormous' } },
    { options: { ...options, colorStrategy: 'invent-colors' } },
    { options: { ...options, maximizeUsage: 'yes' } },
    { options: { ...options, prompt: 'x'.repeat(501) } },
    { options: { ...options, prompt: '' } },
    { options: { ...options, inventory: [] } },
    { inventory: [], options },
    { options: null },
    { options: {} },
  ])('rejects invalid or untrusted generation input without reading inventory', async changes => {
    inventorySpy.mockClear();
    const response = await post({ setNumber: '10696', ...changes });
    expect(response.status).toBe(400);
    expect(inventorySpy).not.toHaveBeenCalled();
  });

  it('rejects reserved missing-parts strategy explicitly', async () => {
    const response = await post({ setNumber: '10696', options: { ...options, colorStrategy: 'missing-parts' } });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'MISSING_PARTS_NOT_IMPLEMENTED' });
  });

  it('returns an actionable unsupported-template error without claiming a stock shortage', async () => {
    const response = await post({ setNumber: '10696', options: { ...options, prompt: '生成一艘宇宙飞船' } });
    expect(response.status).toBe(422);
    const body = await response.json() as { error: string };
    expect(body.error).toContain('机器人');
    expect(body.error).toContain('汽车');
    expect(body.error).toContain('动物');
    expect(body.error).not.toContain('当前库存无法构建');
  });

  it('rejects malformed or oversized JSON and unknown APIs', async () => {
    const malformed = await fetch(`${base}/api/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
    expect(malformed.status).toBe(400);
    const oversized = await post({ setNumber: '10696', options: { ...options, prompt: 'x'.repeat(40_000) } });
    expect(oversized.status).toBe(413);
    expect((await fetch(`${base}/api/not-real`)).status).toBe(404);
  });

  it('treats unsupported request encodings as a client error', async () => {
    const response = await fetch(`${base}/api/generate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json; charset=iso-8859-1' }, body: '{}',
    });
    expect(response.status).toBe(415);
    expect(await response.json()).toMatchObject({ code: 'UNSUPPORTED_ENCODING' });
  });

  it('returns a safe error when a provider throws private internal details', async () => {
    const failing: SetInventoryProvider = { source: 'mock', getSetInventory: async () => { throw new Error('secret-key-private'); } };
    const isolated = createApp({ provider: failing, staticDir: false }).listen(0, '127.0.0.1');
    await new Promise<void>(resolve => isolated.once('listening', resolve));
    const address = isolated.address();
    if (!address || typeof address === 'string') throw new Error('Missing test address');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/sets/10696`);
      expect(response.status).toBe(500);
      expect(await response.text()).not.toContain('secret-key-private');
    } finally { await new Promise<void>(resolve => isolated.close(() => resolve())); }
  });
});
