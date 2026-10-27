import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/api/app.js';
import { RealPartRegistry } from '../src/parts/registry.js';
import { FeedbackStore } from '../src/parts/library/feedback.js';
import { InterfaceLibrary } from '../src/parts/library/interfaceLibrary.js';

let directory: string;
let library: InterfaceLibrary;
let server: Server;
let base: string;

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'bricklab-interface-library-'));
  process.env.BRICKLAB_DATA_DIR = directory;
  library = new InterfaceLibrary(new RealPartRegistry(), { libraryDataDir: directory });
  const app = createApp({ staticDir: false });
  server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test server port.');
  base = `http://127.0.0.1:${address.port}/api/interface-library`;
});
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); delete process.env.BRICKLAB_DATA_DIR; });

describe('real interface and assembly library', () => {
  it('indexes every real connector instance from the source-bound registry', async () => {
    const overview = await library.overview();
    expect(overview.counts).toMatchObject({ parts: 253, interfaces: 5085, types: 25, rules: 15, productionRules: 3, cases: 4, validatedCases: 3, blockedCases: 1 });
    expect(overview.types.find(type => type.id === 'BAR')).toMatchObject({ productionRules: ['BAR_CLIP'] });
    const bar = await library.instance('30374', 'parts/30374.dat:8:0');
    expect(bar).toMatchObject({ partId: '30374', family: 'BAR', role: 'MALE', coverage: 'COMPLETE', enabled: true });
    expect(bar?.connector.matchingPolicy).toMatchObject({ ruleId: 'BAR_CLIP', kind: 'SOURCE_DECLARED_FIT' });
    expect(bar?.sourceFiles.some(file => file.path === 'parts/30374.dat' && file.sha256.length === 64)).toBe(true);
  }, 30000);

  it('keeps blocked cases and formal collision status visible', async () => {
    const cases = await library.cases();
    expect(cases.map(item => [item.id, item.status])).toEqual([
      ['case-c01-standard-studs', 'validated'],
      ['case-bar-clip-30374-48729b', 'validated'],
      ['case-pin-hole-3673-32000', 'validated'],
      ['case-bar-clip-60470b-blocked', 'blocked'],
    ]);
    const blocked = cases.find(item => item.id === 'case-bar-clip-60470b-blocked')!;
    expect(blocked.validation).toMatchObject({ engineAccepted: false, graphValid: true, collisionStatus: 'collision', physicalBuildVerified: false });
    expect(blocked.validation.rejectionCodes.length).toBeGreaterThan(0);
    expect(blocked.placements.length).toBeGreaterThanOrEqual(2);
    expect(blocked.displayNotice).toContain('拒绝');
    const validated = cases.find(item => item.id === 'case-pin-hole-3673-32000')!;
    expect(validated.validation).toMatchObject({ engineAccepted: true, graphValid: true, importStatus: 'VALID', collisionStatus: 'clear', installationPath: 'source-axis-pose-only' });
  });

  it('compares using source rules and never grants generation admission', async () => {
    const exact = await library.compare('30374', '48729b');
    if (!exact) throw new Error('30374→48729b comparison missing.');
    expect(exact.recognition).toMatchObject({ exact: 1, generationAdmission: false, assemblyPass: 'accepted' });
    expect(exact.candidates[0]).toMatchObject({ family: 'BAR', classification: 'exact', formalAssembly: { status: 'accepted' } });
    expect(exact.candidates[0].counterpart).toMatchObject({ partId: '48729b', family: 'CLIP', compatibility: 'compatible' });
    const unexplained = await library.compare('2412b', '48729b');
    if (!unexplained) throw new Error('2412b→48729b comparison missing.');
    expect(unexplained.candidates.every(item => item.classification !== 'exact')).toBe(true);
    expect(unexplained.recognition.generationAdmission).toBe(false);
  });

  it('persists human observations with versions and review history without authorizing rules', async () => {
    const record = await library.addFeedback({ kind: 'position-direction-wrong', message: '观察：夹口方向需要复查。', author: 'builder', view: 'case', target: { kind: 'case', id: 'case-bar-clip-30374-48729b', caseId: 'case-bar-clip-30374-48729b' } });
    expect(record).toMatchObject({ status: 'open', humanObservation: true, canAuthorizeRule: false, target: { kind: 'case', caseId: 'case-bar-clip-30374-48729b' } });
    expect(record.evidence).toMatchObject({ ruleId: 'BAR_CLIP', grammarVersion: 'connector-grammar-2', collisionVersion: 'native-open-surface-seat-2.0.0', interfaceStatus: 'validated' });
    expect(record.evidence.sourceIds.length).toBeGreaterThan(0);
    const reopened = new FeedbackStore(path.join(directory, 'interface-library'));
    const persisted = await reopened.get(record.id);
    expect(persisted).toMatchObject({ message: '观察：夹口方向需要复查。', status: 'open' });
    const patched = await library.patchFeedback(record.id, { status: 'needs-evidence', note: '需要补充照片', reviewer: 'reviewer' });
    expect(patched).toMatchObject({ status: 'needs-evidence', handling: { note: '需要补充照片', reviewer: 'reviewer' } });
    expect(patched.handling.history.length).toBeGreaterThanOrEqual(2);
    await expect(library.addFeedback({ kind: 'reasonable', message: 'x', target: { kind: 'interface', id: '../../etc/passwd' } })).rejects.toThrow();
  });

  it('serves the read/compare/feedback flow over HTTP', async () => {
    const get = async (part: string) => { const response = await fetch(base + part); expect(response.ok, part).toBe(true); return response.json(); };
    const overview = await get('/overview');
    expect(overview.counts.interfaces).toBe(5085);
    const comparison = await (await fetch(`${base}/compare`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ partId: '3673', targetPartId: '32000' }) })).json() as { recognition: { generationAdmission: boolean } };
    expect(comparison.recognition.generationAdmission).toBe(false);
    const created = await (await fetch(`${base}/feedback`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'insufficient-evidence', message: 'HTTP 复核记录', author: 'api', view: 'review', target: { kind: 'rule', id: 'PIN_HOLE', ruleId: 'PIN_HOLE' } }) })).json() as { id: string; status: string; canAuthorizeRule: boolean };
    expect(created).toMatchObject({ status: 'open', canAuthorizeRule: false });
    const listed = await get(`/feedback?targetId=${encodeURIComponent('PIN_HOLE')}`) as unknown[];
    expect(listed.length).toBe(1);
    const flagged = await get(`/rule?id=${encodeURIComponent('PIN_HOLE')}`) as { openFeedback: number; reviewState: string };
    expect(flagged).toMatchObject({ openFeedback: 1, reviewState: 'review-required' });
    const patched = await (await fetch(`${base}/feedback/${created.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'resolved', note: '已验证记录', reviewer: 'api' }) })).json() as { status: string };
    expect(patched.status).toBe('resolved');
    const cleared = await get(`/rule?id=${encodeURIComponent('PIN_HOLE')}`) as { openFeedback: number; reviewState: string };
    expect(cleared).toMatchObject({ openFeedback: 0, reviewState: 'clear' });
  }, 30000);
});
