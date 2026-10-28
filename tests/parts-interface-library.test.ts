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

  it('validates and persists a manual example through the formal engine without granting admission', async () => {
    const caseResponse = await fetch(`${base}/case?id=${encodeURIComponent('case-c01-standard-studs')}`);
    expect(caseResponse.ok).toBe(true);
    const detail = await caseResponse.json() as {
      id: string; fixedPartId: string; movingPartId: string;
      edge: { fixedConnectionId: string; movingConnectionId: string } | null;
      placements: { partId: string; transform: { rotation: number[]; translation: number[] } }[];
    };
    if (!detail.edge) throw new Error('C01 case has no edge.');
    const fixed = detail.placements.find(item => item.partId === detail.fixedPartId)!.transform;
    const seated = detail.placements.find(item => item.partId === detail.movingPartId)!.transform;
    const start = { rotation: seated.rotation, translation: [seated.translation[0], seated.translation[1] + 40, seated.translation[2]] };
    const claim = { connectionNote: '四个凸点全部进入凹槽', reason: '人工工作台回归：只调用同一装配规则和碰撞检查。', physicallyBuilt: false, attachments: [] };
    const input = { mode: 'assisted', caseId: detail.id, fixedPartId: detail.fixedPartId, movingPartId: detail.movingPartId, fixedConnectionId: detail.edge.fixedConnectionId, movingConnectionId: detail.edge.movingConnectionId, fixedInitial: fixed, movingInitial: start, movingFinal: seated, keyframes: [], userClaim: claim };
    const validationResponse = await fetch(`${base}/studio/validate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
    expect(validationResponse.ok).toBe(true);
    const validation = await validationResponse.json() as { rule: { status: string; ruleId: string }; finalCollision: { status: string }; path: { status: string }; generationEligible: boolean; physicalBuildVerified: boolean };
    expect(validation.rule).toMatchObject({ status: 'compatible', ruleId: 'ldcad-standard-stud-to-capped-underside-v1' });
    expect(validation.finalCollision.status).toBe('clear');
    expect(validation.path.status).toBe('not-provided');
    expect(validation).toMatchObject({ generationEligible: false, physicalBuildVerified: false });
    const savedResponse = await fetch(`${base}/studio/examples`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
    expect(savedResponse.ok).toBe(true);
    const saved = await savedResponse.json() as { id: string; status: string; keyframes: unknown[]; validation: { path: { status: string } } };
    expect(saved).toMatchObject({ status: 'pending-review', keyframes: [], validation: { path: { status: 'not-provided' } } });
    const reopened = await (await fetch(`${base}/studio/examples/${saved.id}`)).json() as { id: string; stale: boolean; fixedPartId: string; movingPartId: string };
    expect(reopened).toMatchObject({ id: saved.id, stale: false, fixedPartId: detail.fixedPartId, movingPartId: detail.movingPartId });
    const listed = await (await fetch(`${base}/studio/examples`)).json() as { id: string }[];
    expect(listed.some(item => item.id === saved.id)).toBe(true);
  }, 30000);

  it('derives a data-driven catalog with real examples and explicit gaps', async () => {
    const catalog = await library.studioCatalog();
    expect(catalog.rules).toHaveLength(15);
    expect(catalog.rules.find(item => item.id === 'C01')).toMatchObject({ examples: expect.any(Array), parts: expect.any(Array) });
    expect(catalog.rules.find(item => item.id === 'C01')!.examples.length).toBeGreaterThanOrEqual(2);
    expect(catalog.rules.find(item => item.id === 'C01')!.parts.length).toBeGreaterThan(200);
    expect(catalog.rules.find(item => item.id === 'BAR_CLIP')!.examples.length).toBeGreaterThanOrEqual(3);
    expect(catalog.rules.find(item => item.id === 'PIN_HOLE')!.examples.length).toBeGreaterThanOrEqual(3);
    expect(catalog.rules.find(item => item.id === 'BALL_SOCKET')).toMatchObject({ parts: [], examples: [], gap: expect.any(String) });
    expect(catalog.families.find(item => item.id === 'STUD')!.partCount).toBe(194);
    expect(catalog.families.reduce((sum, family) => sum + family.partCount, 0)).toBeGreaterThan(0);
  }, 30000);

  it('prepares same-part dual instances and versions drafts/export bundles over HTTP', async () => {
    const prepare = async (fixedPartId: string, movingPartId: string) => {
      const response = await fetch(`${base}/studio/prepare`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fixedPartId, movingPartId, ruleId: 'C01' }) });
      expect(response.ok).toBe(true);
      return response.json() as Promise<{ fixedPartId: string; movingPartId: string; fixedConnectionId: string; movingConnectionId: string; fixedInitial: unknown; movingInitial: unknown; movingFinal: unknown; axis: number[]; insertionDepthLdu: number; compatibility: { status: string }; suggestions: unknown[] }>;
    };
    const same = await prepare('3024', '3024');
    expect(same).toMatchObject({ fixedPartId: '3024', movingPartId: '3024', compatibility: { status: 'compatible' } });
    expect(same.suggestions.length).toBeGreaterThan(0);
    const pair = await prepare('3024', '3070b');
    const input = { mode: 'assisted', categoryId: 'C01', caseId: null, fixedPartId: '3024', movingPartId: '3070b', fixedInstanceId: 'A', movingInstanceId: 'B', fixedConnectionId: pair.fixedConnectionId, movingConnectionId: pair.movingConnectionId, fixedInitial: pair.fixedInitial, movingInitial: pair.movingInitial, movingFinal: pair.movingFinal, keyframes: [], camera: { position: [20, 25, 30], target: [0, 0, 0], view: 'side' }, previewDataUrl: null, userClaim: { connectionNote: '版本测试', reason: '验证草稿版本与反馈包', physicallyBuilt: false, attachments: [] } };
    const firstResponse = await fetch(`${base}/studio/drafts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
    expect(firstResponse.ok).toBe(true);
    const first = await firstResponse.json() as { id: string; rootId: string; version: number; status: string };
    expect(first).toMatchObject({ version: 1, status: 'draft' });
    const secondResponse = await fetch(`${base}/studio/drafts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...input, rootId: first.rootId }) });
    expect(secondResponse.ok).toBe(true);
    const second = await secondResponse.json() as { id: string; rootId: string; version: number; previousId: string };
    expect(second).toMatchObject({ rootId: first.rootId, version: 2, previousId: first.id });
    const listed = await (await fetch(`${base}/studio/examples`)).json() as { rootId: string; version: number }[];
    expect(listed.filter(item => item.rootId === first.rootId).map(item => item.version).sort()).toEqual([1, 2]);
    const bundle = await (await fetch(`${base}/studio/export`)).json() as { format: string; bundleVersion: number; examples: unknown[]; feedback: unknown[]; sourceSummary: { parts: number } };
    expect(bundle).toMatchObject({ format: 'bricklab-studio-bundle', bundleVersion: 1 });
    expect(bundle.examples.length).toBeGreaterThanOrEqual(2);
    expect(bundle.sourceSummary.parts).toBeGreaterThan(0);
    const imported = await (await fetch(`${base}/studio/import`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ examples: [bundle.examples[0]] }) })).json() as { imported: number; skipped: number };
    expect(imported).toMatchObject({ imported: 1, skipped: 0 });
    const rechecked = await (await fetch(`${base}/studio/examples/${first.id}/revalidate`, { method: 'POST' })).json() as { stale: boolean; history: unknown[] };
    expect(rechecked.stale).toBe(false);
    expect(rechecked.history.length).toBeGreaterThan(1);
    const thumb = await fetch(`${base.replace('/api/interface-library', '/api/parts-foundation')}/parts/3024/thumbnail`);
    expect(thumb.status).toBe(200);
    expect(thumb.headers.get('content-type')).toContain('image/svg+xml');
  }, 60000);

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
