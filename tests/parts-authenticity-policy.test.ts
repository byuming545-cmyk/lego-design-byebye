import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/api/app.js';
import { MockInventoryProvider, saveInventorySnapshot } from '../src/inventory/index.js';
import { LEGACY_PART_AUTHENTICITY, isLegacyPartGeneratable } from '../src/parts/legacyPolicy.js';
import { recordSpeedSupport } from '../src/speed/snapshotSupport.js';
import { speedBenchmarkMain } from '../src/cli/speed-benchmark.js';
import { automotiveBenchmarkMain } from '../src/cli/automotive-benchmark.js';

let server: Server;
let base: string;
const provider = new MockInventoryProvider();
const readInventory = vi.spyOn(provider, 'getSetInventory');

beforeAll(async () => {
  server = createApp({ provider, staticDir: false }).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing policy test address.');
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });

describe('production authenticity boundary for legacy parametric engines', () => {
  it('blocks all generation, mutation and export entry points before legacy inventory or archive access', async () => {
    readInventory.mockClear();
    const routes: [string, string][] = [
      ['POST', '/api/generate'],
      ['POST', '/API/SPEED/GENERATE/'],
      ['POST', '/api/automotive/design'],
      ['PATCH', '/api/speed/designs/unknown/modules/chassis'],
      ['POST', '/api/speed/designs/unknown/redesign'],
      ['POST', '/api/speed/designs/unknown/undo'],
      ['GET', '/api/speed/models/unknown/export'],
      ['GET', '/api/automotive/sessions/unknown/candidates/unknown/bom'],
      ['HEAD', '/api/automotive/sessions/unknown/candidates/unknown/model.json'],
    ];
    for (const [method, route] of routes) {
      const response = await fetch(`${base}${route}`, { method });
      expect(response.status, `${method} ${route}`).toBe(409);
      if (method !== 'HEAD') expect(await response.json()).toMatchObject({ code: 'REAL_PARTS_FOUNDATION_REQUIRED', authenticity: { generatable: false, verified: false } });
    }
    expect(readInventory).not.toHaveBeenCalled();
  });

  it('does not accept a request-controlled fixture bypass', async () => {
    const response = await fetch(`${base}/api/speed/generate?legacyGenerationPolicy=test-fixture`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bricklab-Legacy-Fixture': 'true' },
      body: JSON.stringify({ legacyGenerationPolicy: 'test-fixture', authenticity: { verified: true } }),
    });
    expect(response.status).toBe(409);
    expect(response.headers.get('X-Bricklab-Legacy-Fixture')).toBeNull();
  });

  it('preserves health and catalog reading while explicitly identifying legacy data', async () => {
    expect((await fetch(`${base}/api/health`)).status).toBe(200);
    const catalog = await fetch(`${base}/api/speed/catalog`);
    expect(catalog.status).toBe(200);
    expect(catalog.headers.get('X-Bricklab-Part-Authenticity')).toBe('legacy-parametric-unverified');
    expect(LEGACY_PART_AUTHENTICITY).toMatchObject({ nativeMeshImported: false, sourceConnectionsImported: false, generatable: false });
    expect(isLegacyPartGeneratable('3001')).toBe(false);
    expect(isLegacyPartGeneratable('invented-or-unknown')).toBe(false);
  });

  it('does not promote hand-calibrated support when persisting an inventory classification', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'bricklab-legacy-support-policy-'));
    try {
      const inventory = await new MockInventoryProvider().getSetInventory('10696');
      // Synthetic provider-format fixture, not a downloaded real set inventory.
      inventory.source = 'rebrickable';
      inventory.snapshotId = randomUUID();
      inventory.fetchedAt = '2026-10-23T00:00:00Z';
      await saveInventorySnapshot(inventory, { metadata: { fixture: true }, pages: [] }, directory);
      await recordSpeedSupport(inventory, directory);
      const saved = JSON.parse(await readFile(path.join(directory, 'inventories', `${inventory.snapshotId}.json`), 'utf8'));
      expect(saved.speedSupport).toMatchObject({ supportedQuantity: 0, supportRatio: 0 });
      expect(saved.speedSupport.recognizedOnlyQuantity).toBeGreaterThan(0);
      expect(saved.speedSupport.parts.every((entry: { status: string }) => entry.status !== 'generatable')).toBe(true);
      expect(saved.speedSupport.catalogVersion).toContain('legacy-parametric-unverified');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('requires an explicit historical-fixture acknowledgement for both generation benchmark CLIs', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(await speedBenchmarkMain(['--mock'])).toBe(3);
      expect(await automotiveBenchmarkMain([])).toBe(3);
      expect(error.mock.calls.flat().join(' ')).toContain('REAL_PARTS_FOUNDATION_REQUIRED');
    } finally { error.mockRestore(); }
  });
});
