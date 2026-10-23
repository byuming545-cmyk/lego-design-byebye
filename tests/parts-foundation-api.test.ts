import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../src/api/app.js';
import { MockInventoryProvider } from '../src/inventory/index.js';
import type { FoundationPartDetail } from '../src/parts/registry.js';
import { assessPartReadiness, type PartCheck } from '../src/parts/trust.js';

let server: Server, base: string, directory: string;
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'bricklab-parts-api-'));
  server = createApp({ provider: new MockInventoryProvider(), staticDir: false, partsDataDir: directory }).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test address');
  base = `http://127.0.0.1:${address.port}/api/parts-foundation`;
});
afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  await rm(directory, { recursive: true, force: true });
});

const get = (suffix: string) => fetch(`${base}${suffix}`);
const post = (suffix: string, value: unknown) => fetch(`${base}${suffix}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });

describe('real source foundation HTTP API', () => {
  it('reports actual source observations and keeps unknown design coverage unknown', async () => {
    const response = await get('/status');
    expect(response.status).toBe(200);
    const status = await response.json();
    expect(status.counts).toMatchObject({ readableDocuments: 6, ldrawPartIds: 245, observedElementIds: 531, geometryReady: 245, connectionReady: 195, catalogOnly: 531, generatable: 0, verified: 0 });
    expect(status.instructions).toHaveLength(8);
    expect(status.instructions.filter((item: { status: string }) => item.status === 'transfer-limit')).toHaveLength(2);
    expect(status.referenceSets).toHaveLength(6);
    expect(status.referenceSets.every((set: { supportedPercentage: unknown; pieceCount: unknown }) => set.supportedPercentage === null && set.pieceCount === null)).toBe(true);
    expect(status.mining).toMatchObject({ actualSetDenominator: 4, expectedSetDenominator: 6, observedRowCount: 667, designRanking: [], partRanking: [] });
    expect(status.elementRanking).toHaveLength(531);
    expect(status.nextPriority).toEqual([]);
  }, 30_000);

  it('returns the actual native mesh and source connection evidence without blessing it', async () => {
    const response = await get('/parts/3001');
    expect(response.status).toBe(200);
    const detail = await response.json() as FoundationPartDetail;
    expect(detail.part).toMatchObject({ id: '3001', identitySystem: 'ldraw', designId: null, geometryReady: true, connectionReady: true, generatable: false, verified: false, physicalBuildVerified: false });
    expect(detail.geometry?.source).toMatchObject({ library: 'LDraw', integrity: 'verified', licenseStatus: 'complete' });
    expect(detail.geometry!.mesh!.indices.length).toBeGreaterThan(300);
    expect(detail.geometry!.source.files.some(file => file.path.startsWith('p/'))).toBe(true);
    expect(detail.connections?.points).toHaveLength(16);
    expect(detail.connections!.points.every(point => point.source.sha256.length === 64 && point.source.line > 0 && point.physicalVerified === false)).toBe(true);
    expect(detail.geometry!.collision).toMatchObject({ kind: 'aabb', derivedFrom: 'native-mesh', cavitiesResolved: false });
    expect(detail.part.checks.find(check => check.id === 'attachment')?.outcome).toBe('not-run');
  });

  it('keeps PDF element observations separate and never creates a replacement mesh', async () => {
    const response = await get('/parts/element%3A4666579');
    expect(response.status).toBe(200);
    const detail = await response.json() as FoundationPartDetail;
    expect(detail).toMatchObject({ part: { id: 'element:4666579', elementId: '4666579', designId: null, identitySystem: 'lego-element', status: 'catalogOnly', geometryReady: false, generatable: false }, geometry: null, connections: null });
    expect(detail.part.observedSetNumbers).toHaveLength(4);
    const list = await (await get('/parts?query=4666579')).json();
    expect(list.parts).toHaveLength(1);
    expect((await get('/parts/invented-windscreen-999')).status).toBe(404);
    expect((await get('/parts?query=a&query=b')).status).toBe(400);
    expect((await post('/parts/3001/verify', { generatable: true, verified: true })).status).toBe(404);
  });

  it('stores the same CSV for distinct sets without collisions, and duplicate imports are idempotent', async () => {
    const content = 'elementId,quantity,isSpare\n9999991,2,\n';
    const payload = (setNumber: string) => ({ format: 'csv', content, options: { id: `local-${setNumber}`, setNumber, sourceId: 'manual-observation', inventoryComplete: false } });
    const first = await post('/inventories/import', payload('77263'));
    expect(first.status).toBe(201);
    const saved = await first.json();
    expect(saved.inventory.provenance).toMatchObject({ kind: 'local-csv', trust: 'user-reported' });
    const repeat = await post('/inventories/import', payload('77263'));
    expect(repeat.status).toBe(200);
    expect(await repeat.json()).toMatchObject({ alreadyPresent: true, inventory: { provenance: { importedAt: saved.inventory.provenance.importedAt } } });
    expect((await post('/inventories/import', payload('77254'))).status).toBe(201);
    const all = await (await get('/inventories')).json();
    expect(all.inventories.filter((inventory: { provenance: { kind: string } }) => inventory.provenance.kind === 'local-csv')).toHaveLength(2);
    const detail = await (await get('/parts/element%3A9999991')).json();
    expect(detail.part.observedSetNumbers).toEqual(['77254-1', '77263-1']);
    expect(detail.geometry).toBeNull();
    const status = await (await get('/status')).json();
    expect(status.counts.observedElementIds).toBe(532);
    expect(status.nextPriority).toEqual([]);
    expect(status.referenceSets.find((set: { setId: string }) => set.setId === '77263').mappedPartCount).toBe(0);
  });

  it('rejects invalid quantities and credential-bearing provenance without writing', async () => {
    expect((await post('/inventories/import', { format: 'csv', content: 'elementId,quantity\n9999992,-1\n', options: { id: 'negative', setNumber: '77263', sourceId: 'local' } })).status).toBe(400);
    expect((await post('/inventories/import', { format: 'csv', content: 'elementId,quantity\n9999992,1\n', options: { id: 'secret', setNumber: '77263', sourceId: 'local', sourceUrl: 'https://example.org/export?api_key=private' } })).status).toBe(400);
  });

  it('does not treat user-declared design identities as verified mappings or priorities', async () => {
    const result = await post('/inventories/import', { format: 'csv', content: 'partId,partIdSystem,designId,quantity,isSpare\n3001,ldraw,3001,1,false\n', options: { id: 'declared-mapping', setNumber: '77263', sourceId: 'local-declaration', inventoryComplete: true } });
    expect(result.status).toBe(201);
    const status = await (await get('/status')).json();
    expect(status.userReportedDesignRanking).toHaveLength(1);
    expect(status.userReportedPartRanking).toHaveLength(1);
    expect(status.partRanking).toEqual([]);
    expect(status.nextPriority).toEqual([]);
    expect(status.referenceSets.find((set: { setId: string }) => set.setId === '77263')).toMatchObject({ mappedPartCount: 0, supportedPercentage: null, generatable: 0 });
  });
});

describe('part readiness promotion', () => {
  it('requires actual attachment and clearance checks even for authentic imported geometry', () => {
    const checks: PartCheck[] = ['source-integrity', 'mesh-integrity', 'rotation'].map(id => ({ id, outcome: 'passed', description: id }));
    expect(assessPartReadiness({ geometryReady: true, connectionReady: true, collisionReady: true, checks })).toMatchObject({ generatable: false, verified: false });
    const complete: PartCheck[] = [...checks, ...['attachment', 'collision-clearance'].map(id => ({ id, outcome: 'passed' as const, description: id }))];
    expect(assessPartReadiness({ geometryReady: true, connectionReady: true, collisionReady: true, checks: complete })).toMatchObject({ generatable: true, verified: false });
    expect(assessPartReadiness({ geometryReady: true, connectionReady: false, collisionReady: true, checks: complete }).generatable).toBe(false);
    expect(assessPartReadiness({ geometryReady: true, connectionReady: true, collisionReady: true, checks: [...complete, { id: 'axle-fit', outcome: 'failed', description: 'incompatible actual interface' }] }).generatable).toBe(false);
  });
});
