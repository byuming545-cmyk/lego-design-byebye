import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createApp } from '../src/api/app.js';
import { MockInventoryProvider } from '../src/inventory/mock.js';
import { PART_CATALOG } from '../src/lego/catalog.js';
import { SPEED_PART_CATALOG } from '../src/speed/catalog.js';
import { LEGACY_QUARANTINE } from '../src/parts/legacyStatus.js';

let server: Server;
let base: string;
beforeAll(async () => {
  server = createApp({ provider: new MockInventoryProvider(), staticDir: false }).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing local test address.');
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });

describe('legacy archive and cache isolation', () => {
  it('rejects legacy imports and restored sessions before any old document can be admitted', async () => {
    for (const route of ['/api/speed/models/import', '/API/SPEED/MODELS/IMPORT/', '/api/speed/models/old-model/open', '/api/speed/models/old%2Dmodel/open/']) {
      const response = await fetch(`${base}${route}?legacyGenerationPolicy=test-fixture`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bricklab-Legacy-Fixture': 'true' },
        body: JSON.stringify({ geometry: { source: 'LegacyInstructionDerived' }, authenticity: { verified: true } }),
      });
      expect(response.status, route).toBe(409);
      expect(await response.json()).toMatchObject({ code: 'REAL_PARTS_FOUNDATION_REQUIRED', authenticity: LEGACY_QUARANTINE });
      expect(response.headers.get('X-Bricklab-Legacy-Status')).toBe('LEGACY_QUARANTINED');
      expect(response.headers.get('X-Bricklab-Legacy-Fixture')).toBeNull();
    }
  });

  it('keeps historical definitions inspectable with per-record quarantine metadata', async () => {
    for (const catalog of [PART_CATALOG, SPEED_PART_CATALOG]) {
      expect(Object.keys(catalog).length).toBeGreaterThan(0);
      for (const part of Object.values(catalog)) expect(part).toMatchObject(LEGACY_QUARANTINE);
    }
    const response = await fetch(`${base}/api/speed/catalog`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject(LEGACY_QUARANTINE);
    expect(await (await fetch(`${base}/api/health`)).json()).toMatchObject({ legacyGenerationEnabled: false, legacyData: LEGACY_QUARANTINE });
  });

  it('leaves old module paths as compatibility exports rather than duplicate active constructors', async () => {
    for (const family of ['lego', 'speed']) {
      const source = await readFile(new URL(`../src/${family}/catalog.ts`, import.meta.url), 'utf8');
      expect(source).toContain('@deprecated');
      expect(source).toContain(`export * from '../legacy/${family}/catalog.js'`);
      expect(source).not.toContain('function ');
    }
  });
});
