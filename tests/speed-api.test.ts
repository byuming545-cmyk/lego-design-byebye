import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from '../src/api/app.js';
import { MockInventoryProvider } from '../src/inventory/index.js';
import type { SetInventoryProvider } from '../src/inventory/index.js';

let server: Server;
let base: string;
beforeAll(async () => {
  server = createApp({ provider: new MockInventoryProvider(), staticDir: false }).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test address');
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });

describe('independent Speed API', () => {
  it('classifies the independent demo and preserves V0.1 inventory behavior', async () => {
    const response = await fetch(`${base}/api/speed/inventory?sets=DEMO-SPEED`);
    expect(response.status).toBe(200);
    const inventory = await response.json();
    expect(inventory.source).toBe('mock');
    expect(inventory.setNumber).toBe('DEMO-SPEED');
    expect(inventory.analysis.supportedQuantity + inventory.analysis.partiallySupportedQuantity + inventory.analysis.unsupportedQuantity).toBe(inventory.analysis.totalQuantity);
    expect(inventory.items.some((item: { support: string }) => item.support === 'partiallySupported')).toBe(true);
    expect((await fetch(`${base}/api/sets/10696`)).status).toBe(200);
  });

  it('reports catalog coverage honestly and refuses fake official-set inventories', async () => {
    const catalog = await (await fetch(`${base}/api/speed/catalog`)).json();
    expect(catalog.total).toBeGreaterThanOrEqual(50);
    expect(catalog.supported).toBeGreaterThanOrEqual(50);
    const real = await fetch(`${base}/api/speed/inventory?sets=76922`);
    expect(real.status).toBe(503);
    expect(await real.json()).toMatchObject({ code: 'SPEED_REAL_PROVIDER_REQUIRED' });
  });

  it('rejects invalid set syntax and deduplicates repeated boxes', async () => {
    expect((await fetch(`${base}/api/speed/inventory?sets=invalid`)).status).toBe(400);
    const single = await (await fetch(`${base}/api/speed/inventory?sets=DEMO-SPEED`)).json();
    const repeated = await (await fetch(`${base}/api/speed/inventory?sets=DEMO-SPEED%2BDEMO-SPEED`)).json();
    expect(repeated.analysis.totalQuantity).toBe(single.analysis.totalQuantity);
    expect(repeated.inventorySources).toHaveLength(1);
  });

  it('merges self-declared extras with traceable quantities while keeping default inventory unchanged', async () => {
    const original = await (await fetch(`${base}/api/speed/inventory?sets=DEMO-SPEED`)).json();
    const empty = await (await postSpeed('/inventory', { setNumbers: ['DEMO-SPEED'], extraParts: [] })).json();
    expect(empty).toEqual(original);
    const color = { id: 0, name: '黑色', hex: '#171717' };
    const extraParts = [{ partId: '3034', color, quantity: 2 }, { partId: '3034', color, quantity: 3 }, { partId: 'unknown-extra', color, quantity: 1 }];
    const response = await postSpeed('/inventory', { setNumbers: ['DEMO-SPEED'], extraParts });
    expect(response.status).toBe(200);
    const merged = await response.json();
    expect(merged.source).toBe('mixed');
    expect(merged.sourceLabel).toContain('用户自报散件');
    expect(merged.sourceLabel).toContain('DEMO-SPEED');
    expect(merged.setNumber).toBe('DEMO-SPEED');
    expect(merged.analysis.totalQuantity).toBe(original.analysis.totalQuantity + 6);
    const plate = merged.items.find((item: { partId: string; color: { id: number } }) => item.partId === '3034' && item.color.id === 0);
    const originalPlate = original.items.find((item: { partId: string; color: { id: number } }) => item.partId === '3034' && item.color.id === 0);
    expect(plate.quantityAvailable).toBe(originalPlate.quantityAvailable + 5);
    expect(plate.sources.filter((source: { sourceId: string }) => source.sourceId === 'custom:extra-parts')).toEqual([expect.objectContaining({ quantity: 5 })]);
    expect(merged.items.find((item: { partId: string }) => item.partId === 'unknown-extra')).toMatchObject({ support: 'unsupported', dimensions: null, supported: false });
    expect(await (await fetch(`${base}/api/speed/inventory?sets=DEMO-SPEED`)).json()).toEqual(original);
  });

  it('rejects invented extra geometry and invalid quantities without bypassing real-set requirements', async () => {
    const color = { id: 0, name: '黑色', hex: '#171717' };
    for (const extra of [
      { partId: '3034', color, quantity: 0 },
      { partId: '3034', color, quantity: 2, dimensions: { x: 9, y: 9, z: 9 } },
      { partId: '3034', color, quantity: 2, supported: true },
    ]) {
      expect((await postSpeed('/inventory', { setNumbers: ['DEMO-SPEED'], extraParts: [extra] })).status).toBe(400);
      expect((await postSpeed('/generate', { setNumbers: ['DEMO-SPEED'], options: speedOptions, extraParts: [extra] })).status).toBe(400);
    }
    expect((await postSpeed('/inventory', { setNumbers: ['76922'], extraParts: [{ partId: '3034', color, quantity: 100 }] })).status).toBe(503);
  });

  it('negotiates compressed Speed responses without changing decoded inventory', async () => {
    const response = await fetch(`${base}/api/speed/inventory?sets=DEMO-SPEED`, { headers: { 'Accept-Encoding': 'gzip' } });
    expect(response.headers.get('content-encoding')).toBe('gzip');
    expect(response.headers.get('vary')).toContain('Accept-Encoding');
    expect(await response.json()).toMatchObject({ setNumber: 'DEMO-SPEED', source: 'mock' });
  });

  it('uses the same provider path for ten set IDs; fixture quantities are not real set inventories', async () => {
    const requested: string[] = [];
    const provider: SetInventoryProvider = {
      source: 'rebrickable',
      async getSetInventory(setNumber) {
        requested.push(setNumber);
        return {
          setNumber, name: 'HTTP contract fixture — not an actual set inventory', source: 'rebrickable',
          sourceLabel: 'Injected test response', warnings: [],
          items: [{ partId: '3034', name: 'Fixture plate', category: 'Unsupported', color: { id: 0, name: '黑色', hex: '#171717' }, quantityAvailable: 2, quantityUsed: 0, supported: false, dimensions: { x: 1, y: 1, z: 1 } }],
        };
      },
    };
    const isolated = createApp({ provider, staticDir: false }).listen(0, '127.0.0.1');
    await new Promise<void>(resolve => isolated.once('listening', resolve));
    const address = isolated.address();
    if (!address || typeof address === 'string') throw new Error('Missing test address');
    const ids = Array.from({ length: 10 }, (_, index) => String(76900 + index));
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/speed/inventory?sets=${encodeURIComponent(ids.join('+'))}`);
      expect(response.status).toBe(200);
      const inventory = await response.json();
      expect(requested.sort()).toEqual(ids.map(id => `${id}-1`).sort());
      expect(inventory.inventorySources).toHaveLength(10);
      expect(inventory.items).toHaveLength(1);
      expect(inventory.items[0]).toMatchObject({ partId: '3034', quantityAvailable: 20 });
      expect(inventory.items[0].sources).toHaveLength(10);
      expect(inventory.analysis.canGenerate).toBe(false);
      const rejected = await fetch(`http://127.0.0.1:${address.port}/api/speed/generate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setNumbers: ids, options: speedOptions }),
      });
      expect(rejected.status).toBe(422);
      expect(await rejected.json()).toMatchObject({ code: 'SPEED_REQUIRED_PARTS_MISSING' });
    } finally { await new Promise<void>(resolve => isolated.close(() => resolve())); }
  });
});

const speedOptions = { prompt: '未来感低矮超级跑车', vehicleType: 'supercar', style: 'futuristic', minifigure: false, priority: 'structure', maximizeUsage: false };
async function postSpeed(path: string, body: unknown, method = 'POST') {
  return fetch(`${base}/api/speed${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

describe('trusted Speed generation and design sessions', () => {
  it('generates from server-reconstructed extra stock and keeps unknown extras out of the car', async () => {
    const color = { id: 0, name: '黑色', hex: '#171717' };
    const response = await postSpeed('/generate', { setNumbers: ['DEMO-SPEED'], options: speedOptions, extraParts: [{ partId: '3034', color, quantity: 2 }, { partId: 'unknown-extra', color, quantity: 1 }] });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.inventory.source).toBe('mixed');
    expect(result.inventory.inventorySources.some((source: { source: string }) => source.source === 'custom')).toBe(true);
    expect(result.candidates).toHaveLength(3);
    for (const candidate of result.candidates) {
      expect(candidate.validation.valid).toBe(true);
      expect(candidate.model.parts.some((part: { partId: string }) => part.partId === 'unknown-extra')).toBe(false);
    }
    const redesigned = await (await postSpeed(`/designs/${result.sessionId}/redesign`, { candidateId: result.candidates[0].model.id, prompt: '车头太高了' })).json();
    expect(redesigned.success, redesigned.message).toBe(true);
    expect(redesigned.candidate.validation.valid).toBe(true);
  }, 20000);

  it('independently validates generated cars and records a server-owned session', async () => {
    const response = await postSpeed('/generate', { setNumbers: ['DEMO-SPEED'], options: speedOptions });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.candidates.length).toBeGreaterThanOrEqual(1);
    const inventory = new Map<string, number>(result.inventory.items.map((row: { partId: string; color: { id: number }; quantityAvailable: number }) => [`${row.partId}:${row.color.id}`, row.quantityAvailable]));
    for (const candidate of result.candidates) {
      expect(candidate.validation.valid).toBe(true);
      for (const key of ['inventory', 'collision', 'connection', 'wheels', 'structure']) expect(candidate.validation[key].valid).toBe(true);
      expect(candidate.validation.wheels).toMatchObject({ wheelCount: 4, groundedWheels: 4, axleConnections: 4, rotationalClearance: true });
      const usage = new Map<string, number>();
      for (const part of candidate.model.parts) {
        const key = `${part.partId}:${part.color.id}`;
        usage.set(key, (usage.get(key) ?? 0) + 1);
      }
      for (const [key, count] of usage) expect(count).toBeLessThanOrEqual(inventory.get(key) ?? 0);
      expect(candidate.model.connections.length).toBeGreaterThan(candidate.model.parts.length - 2);
    }
  });

  it('rejects client-supplied inventories and unsupported requests without creating a fake car', async () => {
    const injected = await postSpeed('/generate', { setNumbers: ['DEMO-SPEED'], options: speedOptions, inventory: { anything: 'client cannot increase stock' } });
    expect(injected.status).toBe(400);
    const invalid = await postSpeed('/generate', { setNumbers: ['DEMO-SPEED'], options: { ...speedOptions, vehicleType: 'F1' } });
    expect(invalid.status).toBe(400);
    const minifigure = await postSpeed('/generate', { setNumbers: ['DEMO-SPEED'], options: { ...speedOptions, minifigure: true } });
    expect(minifigure.status).toBe(422);
    expect(await minifigure.json()).toMatchObject({ code: 'MINIFIGURE_CONFIGURATION_UNSUPPORTED' });
    const real = await postSpeed('/generate', { setNumbers: ['76922'], options: speedOptions });
    expect(real.status).toBe(503);
  });

});

describe('Speed module locking and atomic design history', () => {
  it('enforces candidate ownership and strict module locks at the session boundary', async () => {
    const result = await (await postSpeed('/generate', { setNumbers: ['DEMO-SPEED'], options: speedOptions })).json();
    const candidate = result.candidates[0];
    const path = `/designs/${result.sessionId}`;
    expect((await postSpeed(`${path}/modules/cockpit`, { candidateId: 'not-owned', locked: true }, 'PATCH')).status).toBe(404);
    expect((await postSpeed(`${path}/modules/unknown`, { candidateId: candidate.model.id, locked: true }, 'PATCH')).status).toBe(400);
    const lock = await postSpeed(`${path}/modules/cockpit`, { candidateId: candidate.model.id, locked: true }, 'PATCH');
    expect(lock.status).toBe(200);
    const locked = await lock.json();
    expect(locked.candidate.model.modules.find((item: { id: string }) => item.id === 'cockpit').locked).toBe(true);
    expect((await postSpeed(`${path}/undo`, { candidateId: candidate.model.id })).status).toBe(409);
    expect((await postSpeed(`${path}/redesign`, { candidateId: candidate.model.id, prompt: '车头太高了', model: { parts: [] } })).status).toBe(400);
  });

  it('commits only valid local changes, keeps locked geometry, rolls back failures and restores undo', async () => {
    const generated = await postSpeed('/generate', { setNumbers: ['DEMO-SPEED'], options: speedOptions });
    expect(generated.status).toBe(200);
    const result = await generated.json();
    const original = result.candidates[0];
    const path = `/designs/${result.sessionId}`;
    const locked = await (await postSpeed(`${path}/modules/cockpit`, { candidateId: original.model.id, locked: true }, 'PATCH')).json();
    const physical = (candidate: typeof original, moduleId?: string) => candidate.model.parts.filter((part: { moduleId: string }) => !moduleId || part.moduleId === moduleId)
      .map(({ activeConnections: _connections, buildStep: _step, ...part }: Record<string, unknown>) => part)
      .sort((a: { instanceId: string }, b: { instanceId: string }) => a.instanceId.localeCompare(b.instanceId));
    const changed = await (await postSpeed(`${path}/redesign`, { candidateId: original.model.id, prompt: '车头太高了' })).json();
    expect(changed.success, changed.message).toBe(true);
    expect(changed.candidate.validation.valid).toBe(true);
    expect(changed.candidate.model.id).toBe(original.model.id);
    expect(changed.candidate.model.version).toBe(original.model.version + 1);
    expect(changed.changedModules).toEqual(['front']);
    expect(physical(changed.candidate, 'front')).not.toEqual(physical(original, 'front'));
    for (const module of original.model.modules.filter((item: { id: string }) => item.id !== 'front')) expect(physical(changed.candidate, module.id)).toEqual(physical(original, module.id));
    expect(changed.undoDepth).toBe(1);
    const failed = await (await postSpeed(`${path}/redesign`, { candidateId: original.model.id, prompt: '驾驶舱降低一点' })).json();
    expect(failed).toMatchObject({ success: false, rolledBack: true, undoDepth: 1 });
    expect(failed.candidate).toEqual(changed.candidate);
    const unknown = await (await postSpeed(`${path}/redesign`, { candidateId: original.model.id, prompt: '为这辆车添加量子传送门' })).json();
    expect(unknown).toMatchObject({ success: false, rolledBack: true, undoDepth: 1 });
    expect(unknown.candidate).toEqual(changed.candidate);
    const restored = await (await postSpeed(`${path}/undo`, { candidateId: original.model.id })).json();
    expect(restored.undoDepth).toBe(0);
    expect(restored.candidate.model.version).toBe(original.model.version);
    expect(physical(restored.candidate)).toEqual(physical(original));
    expect(restored.candidate.model.modules.find((item: { id: string }) => item.id === 'cockpit').locked).toBe(true);
    expect(restored.candidate).toEqual(locked.candidate);
    expect((await postSpeed(`${path}/undo`, { candidateId: original.model.id })).status).toBe(409);
  }, 20000);

  it('treats text-only lock changes as configuration, keeping structure version and undo depth', async () => {
    const result = await (await postSpeed('/generate', { setNumbers: ['DEMO-SPEED'], options: speedOptions })).json();
    const original = result.candidates[0];
    const path = `/designs/${result.sessionId}`;
    const locked = await (await postSpeed(`${path}/redesign`, { candidateId: original.model.id, prompt: '驾驶舱不要改' })).json();
    expect(locked).toMatchObject({ success: true, undoDepth: 0 });
    expect(locked.candidate.model.version).toBe(original.model.version);
    expect(locked.candidate.model.parts).toEqual(original.model.parts);
    expect(locked.candidate.model.modules.find((item: { id: string }) => item.id === 'cockpit').locked).toBe(true);
    const unlocked = await (await postSpeed(`${path}/redesign`, { candidateId: original.model.id, prompt: '解锁驾驶舱' })).json();
    expect(unlocked).toMatchObject({ success: true, undoDepth: 0 });
    expect(unlocked.candidate.model.version).toBe(original.model.version);
    expect(unlocked.candidate.model.parts).toEqual(original.model.parts);
    expect(unlocked.candidate.model.modules.find((item: { id: string }) => item.id === 'cockpit').locked).toBe(false);
    const unsupported = await (await postSpeed(`${path}/redesign`, { candidateId: original.model.id, prompt: '车头变成黄色，驾驶舱不要改' })).json();
    expect(unsupported).toMatchObject({ success: false, rolledBack: true, undoDepth: 0 });
    expect(unsupported.candidate).toEqual(unlocked.candidate);
  }, 20000);
});
