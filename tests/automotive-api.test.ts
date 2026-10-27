import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../src/api/app.js';
import { MissingRebrickableInventoryProvider } from '../src/inventory/index.js';
import type { AutomotiveDesignResponse, AutomotiveReferenceResponse } from '../src/automotive/contracts.js';
import type { ReferenceMetadataInput } from '../src/automotive/references/types.js';
import type { LegoDesignPattern } from '../src/automotive/patterns.js';

let server: Server | undefined;
let base: string;
let directory: string;
const previousDataDir = process.env.BRICKLAB_DATA_DIR;
const metadata: ReferenceMetadataInput = {
  source: 'user-original-api-test-fixture', modelName: 'Original HTTP test assembly', author: 'Bricklab test authors',
  license: 'user-owned', attribution: 'Original minimal API fixture; not an official LEGO model or learned reference.',
  rightsDeclaration: { ownsRights: true, statement: 'I created this minimal test assembly and hold the rights to provide it.' },
  vehicleType: 'luxury-sedan', featureTags: ['long-hood', 'four-door'],
};
const mpd = ['0 FILE original.ldr', '1 4 40 0 0 1 0 0 0 1 0 0 0 1 body.ldr', '0 FILE body.ldr', '1 16 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat', '1 16 0 -24 0 1 0 0 0 1 0 0 0 1 3001.dat'].join('\n');
const manual = {
  manufacturer: 'Example API Fixture', model: 'Unknown Sedan', generation: 'Test generation', vehicleType: 'luxury-sedan',
  dimensions: { lengthMm: 5300, widthMm: 1950, heightMm: 1500, wheelbaseMm: 3200 },
  visualFeatures: { doorCount: 4, hoodLengthRatio: 0.27, roofline: 'Synthetic test sedan roofline' },
  signatureFeatures: ['Long sedan silhouette'], featureTags: ['long-hood', 'four-door'],
  sourceLabel: 'Synthetic user measurement sheet', sourceUrl: 'https://example.org/synthetic-specifications',
  referenceImages: [{ angle: 'side', url: 'https://example.org/synthetic-side.jpg' }, { angle: 'front', url: 'https://example.org/synthetic-front.jpg' }],
};
async function start() {
  server = createApp({ legacyGenerationPolicy: 'test-fixture', provider: new MissingRebrickableInventoryProvider(), staticDir: false }).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server!.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing automotive API test address');
  base = `http://127.0.0.1:${address.port}/api/automotive`;
}
async function stop() { if (server) { const current = server; server = undefined; await new Promise<void>(resolve => current.close(() => resolve())); } }
async function post(route: string, body: unknown): Promise<Response> { return fetch(`${base}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
async function saveManual() {
  const response = await post('/profiles/manual', manual);
  expect(response.status, await response.clone().text()).toBe(201);
  return (await response.json()).profile;
}
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'bricklab-automotive-api-'));
  process.env.BRICKLAB_DATA_DIR = directory;
  await start();
});
afterEach(async () => {
  await stop();
  if (previousDataDir === undefined) delete process.env.BRICKLAB_DATA_DIR;
  else process.env.BRICKLAB_DATA_DIR = previousDataDir;
  await rm(directory, { recursive: true, force: true });
});

describe('independent automotive HTTP research and persistence', () => {
  it('serves free-design status with no Rebrickable key while reporting real limits honestly', async () => {
    const response = await fetch(`${base}/status`);
    expect(response.status, await response.clone().text()).toBe(200);
    const status = await response.json();
    expect(status).toMatchObject({ version: '0.3.0', capabilities: { neuralTraining: false, imageAnalysis: false, pdfParsing: false, ldrawImport: true, referenceModels: 0, physicalBuildsVerified: 0, generatableWidths: [8, 10, 12], customWidthPlanning: true }, palette: { quantityMode: 'unlimited-design', ownership: 'virtual-not-owned', partColorAvailability: 'not-verified' } });
    expect(status.palette.parts.length).toBeGreaterThan(0);
    expect(status.profiles.some((profile: { generation: string }) => profile.generation === 'W223')).toBe(true);
    const inventory = await fetch(`${base.replace('/api/automotive', '')}/api/sets/76922`);
    expect(inventory.status).toBe(503);
    expect(await inventory.json()).toMatchObject({ code: 'MISSING_API_KEY' });
  });

  it('returns unknown research explicitly and preserves manual dimensions, sources and image limitations after restart', async () => {
    const researched = await post('/research', { query: 'Example API Fixture Unknown Sedan', live: false });
    expect(researched.status).toBe(200);
    expect(await researched.json()).toMatchObject({ status: 'not_found', profile: null, attempts: [] });
    const profile = await saveManual();
    expect(profile).toMatchObject({ researchStatus: 'manual', dimensions: { lengthMm: { value: 5300, status: 'manual' } }, sources: [{ kind: 'user', title: manual.sourceLabel, url: manual.sourceUrl, accessStatus: 'user_supplied' }] });
    expect(profile.dimensions.lengthMm.sourceIds).toEqual([profile.sources[0].id]);
    expect(profile.referenceImages.every((image: { analysisStatus: string }) => image.analysisStatus === 'not_analyzed')).toBe(true);
    await stop(); await start();
    const status = await (await fetch(`${base}/status`)).json();
    expect(status.profiles.find((entry: { id: string }) => entry.id === profile.id)).toEqual(profile);
  });

  it('keeps catalogue-only S63 research dimensions unknown and blocks an unlabelled estimate', async () => {
    const response = await post('/research', { query: 'Mercedes-AMG S63', live: false });
    expect(response.status).toBe(200);
    const research = await response.json();
    expect(research).toMatchObject({ status: 'catalog_seed', profile: { generation: 'W223', researchStatus: 'pending' }, attempts: [] });
    expect(research.profile.dimensions.lengthMm).toMatchObject({ value: null, status: 'unknown' });
    const design = await post('/design', { profileId: research.profile.id, widthStuds: 9, candidateCount: 5 });
    expect(design.status).toBe(422);
    expect(await design.json()).toMatchObject({ code: 'UNKNOWN_DIMENSIONS' });
  });
});

describe('reference HTTP boundaries using original fixtures', () => {
  it('accepts MPD above the ordinary JSON limit and persists hierarchy, current color and explicit classification', async () => {
    const content = `0 ${'Original harmless comment '.repeat(1500)}\n${mpd}`;
    expect(Buffer.byteLength(JSON.stringify({ content, metadata }))).toBeGreaterThan(32768);
    const response = await post('/references/import', { content, filename: 'original.mpd', metadata, longitudinalAxis: 'x', frontDirection: -1 });
    expect(response.status, await response.clone().text()).toBe(201);
    const imported = await response.json();
    expect(imported.model.metadata).toMatchObject({ vehicleType: 'luxury-sedan', featureTags: ['long-hood', 'four-door'], license: 'user-owned', author: metadata.author, attribution: metadata.attribution });
    expect(imported.model.parts).toHaveLength(2);
    expect(imported.model.parts.every((part: { color: number }) => part.color === 4)).toBe(true);
    expect(imported.model.submodels.map((model: { name: string }) => model.name)).toEqual(['original.ldr', 'body.ldr']);
    expect(imported.analysis).toMatchObject({ longitudinalAxis: 'x', frontDirection: -1, coverage: { totalParts: 2, knownGeometryParts: 2 }, bounds: { exact: false } });
    await stop(); await start();
    const listed = await (await fetch(`${base}/references`)).json() as AutomotiveReferenceResponse;
    expect(listed.models).toHaveLength(1);
    expect(listed.models[0].id).toBe(imported.model.id);
    expect(listed.models[0].metadata).toEqual(imported.model.metadata);
    expect(listed.models[0].metadata).toMatchObject({ longitudinalAxis: 'x', frontDirection: -1 });
    expect(listed.models[0].parts.map(part => part.color)).toEqual([4, 4]);
    expect(listed.analyses[0].coverage).toEqual(imported.analysis.coverage);
    expect(listed.analyses[0]).toMatchObject({ longitudinalAxis: 'x', frontDirection: -1 });
    expect(listed.analyses[0].overall).toEqual(imported.analysis.overall);
    expect((await (await fetch(`${base}/status`)).json()).capabilities.referenceModels).toBe(1);
  });

  it('stores unconfirmed-license links without model content and rejects attempts to import their geometry', async () => {
    const unknown = { ...metadata, source: 'https://example.org/unconfirmed-model', modelName: 'Unconfirmed model link', license: 'unknown', rightsDeclaration: undefined };
    const rejected = await post('/references/import', { metadata: unknown, content: mpd });
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toMatchObject({ code: 'INVALID_AUTOMOTIVE_REQUEST' });
    const response = await post('/references/import', { metadata: unknown });
    expect(response.status).toBe(201);
    const saved = await response.json();
    expect(saved).toMatchObject({ link: { kind: 'link', metadata: { license: 'unknown', source: unknown.source } }, analysis: null });
    const listed = await (await fetch(`${base}/references`)).json() as AutomotiveReferenceResponse;
    expect(listed.models).toEqual([]); expect(listed.analyses).toEqual([]); expect(listed.links).toHaveLength(1);
    const filename = path.join(directory, 'automotive', 'references', `${saved.link.id}.json`);
    const stored = JSON.parse(await readFile(filename, 'utf8'));
    expect(Object.keys(stored).sort()).toEqual(['id', 'kind', 'metadata', 'schemaVersion']);
    expect(stored.parts).toBeUndefined(); expect(stored.content).toBeUndefined();
  });

  it('rejects malformed, unsafe, unlicensed and misclassified imports without creating stored models', async () => {
    const badRequests = [
      {}, { content: mpd }, { metadata, content: '' }, { metadata: { ...metadata, rightsDeclaration: undefined }, content: mpd },
      { metadata, content: mpd, filename: '../escape.mpd' },
      { metadata, content: '0 FILE cycle.ldr\n1 4 0 0 0 1 0 0 0 1 0 0 0 1 cycle.ldr' },
      { metadata, content: '1 4 0 0 0 0 0 0 0 0 0 0 0 0 3001.dat' },
      { metadata: { ...metadata, vehicleType: 'invented-class' }, content: mpd },
      { metadata: { ...metadata, featureTags: Array(21).fill('tag') }, content: mpd },
      { metadata, content: mpd, frontDirection: 0 }, { metadata, content: mpd, longitudinalAxis: 'z' },
    ];
    for (const request of badRequests) {
      const response = await post('/references/import', request);
      expect(response.status, JSON.stringify(request)).toBe(400);
      expect((await response.json()).code).toBeTypeOf('string');
    }
    expect(await (await fetch(`${base}/references`)).json()).toEqual({ models: [], links: [], analyses: [] });
  });

  it('enforces the dedicated reference JSON body limit without saving oversized content', async () => {
    const response = await post('/references/import', { metadata, content: `0 ${'x'.repeat(10 * 1024 * 1024)}` });
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ code: 'REQUEST_TOO_LARGE' });
    expect(await (await fetch(`${base}/references`)).json()).toEqual({ models: [], links: [], analyses: [] });
  });
});

describe('reference-derived local pattern HTTP boundaries', () => {
  it('exposes proven local MPD components with source provenance while keeping extraction unconfirmed', async () => {
    const emptyResponse = await fetch(`${base}/patterns`);
    expect(emptyResponse.status, await emptyResponse.clone().text()).toBe(200);
    const empty = await emptyResponse.json() as { confirmed: LegoDesignPattern[]; candidates: LegoDesignPattern[] };
    expect(empty.confirmed).toHaveLength(5); expect(empty.candidates).toEqual([]);
    expect(empty.confirmed.every(pattern => pattern.status === 'confirmed' && pattern.provenance.kind === 'engineer-prior')).toBe(true);
    // Original text fixture has two separate connected subassemblies, one unknown
    // external part and one arbitrary-angle placement. It is not an official model.
    const content = [
      '0 FILE local-studies.ldr',
      '1 4 40 0 0 1 0 0 0 1 0 0 0 1 component.ldr',
      '1 15 400 0 0 1 0 0 0 1 0 0 0 1 component.ldr',
      '1 4 800 0 0 1 0 0 0 1 0 0 0 1 unknown-part.dat',
      '1 4 1000 0 0 0.70710678 0 -0.70710678 0 1 0 0.70710678 0 0.70710678 3001.dat',
      '0 FILE component.ldr',
      '1 16 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat',
      '1 16 0 -24 0 1 0 0 0 1 0 0 0 1 3001.dat',
    ].join('\n');
    const response = await post('/references/import', { metadata: { ...metadata, modelName: 'Original separated local assembly studies' }, content, filename: 'local-studies.mpd' });
    expect(response.status, await response.clone().text()).toBe(201);
    const imported = await response.json();
    const candidates = imported.patternCandidates as LegoDesignPattern[];
    expect(imported.model.parts).toHaveLength(6);
    expect(candidates).toHaveLength(2);
    for (const pattern of candidates) {
      expect(pattern).toMatchObject({ status: 'candidate', strengthScore: null, strengthAssessment: 'unassessed', provenance: { kind: 'reference-extracted' }, validation: { valid: true, connectionCount: 8 } });
      expect(pattern.sourceReferences).toEqual([imported.model.id]);
      expect(pattern.parts).toHaveLength(2);
      expect(pattern.parts.every(part => part.partId === '3001')).toBe(true);
      expect(pattern.connectionGraph).toHaveLength(8);
      expect(pattern.parts.length).toBeLessThan(imported.model.parts.length);
    }
    const selected = await fetch(`${base}/references/${imported.model.id}/patterns`);
    expect(selected.status).toBe(200);
    expect((await selected.json()).candidates).toEqual(candidates);
    await stop(); await start();
    const listed = await (await fetch(`${base}/patterns`)).json() as { confirmed: LegoDesignPattern[]; candidates: LegoDesignPattern[] };
    expect(listed.confirmed).toEqual(empty.confirmed);
    expect(listed.candidates).toEqual(candidates);
    expect(listed.confirmed.some(pattern => candidates.some(candidate => candidate.id === pattern.id))).toBe(false);
    const profile = await saveManual();
    const design = await post('/design', { profileId: profile.id, widthStuds: 9, candidateCount: 5 });
    expect(design.status).toBe(200);
    const planned = await design.json() as AutomotiveDesignResponse;
    expect(planned.patterns.map(pattern => pattern.id).sort()).toEqual(empty.confirmed.map(pattern => pattern.id).sort());
    expect(planned.patterns.every(pattern => pattern.status === 'confirmed')).toBe(true);
  });

  it('returns 404 for an unknown reference and refuses pattern extraction from a link-only entry', async () => {
    const missing = await fetch(`${base}/references/ref-${'0'.repeat(24)}/patterns`);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ code: 'REFERENCE_NOT_FOUND' });
    const linkResponse = await post('/references/import', { metadata: { ...metadata, source: 'https://example.org/pattern-license-unknown', license: 'unknown', rightsDeclaration: undefined } });
    expect(linkResponse.status).toBe(201);
    const { link } = await linkResponse.json();
    const extraction = await fetch(`${base}/references/${link.id}/patterns`);
    expect(extraction.status).toBe(422);
    const error = await extraction.json();
    expect(error.code).toBeTypeOf('string');
    expect(error.candidates).toBeUndefined();
    const listed = await (await fetch(`${base}/patterns`)).json();
    expect(listed.confirmed).toHaveLength(5); expect(listed.candidates).toEqual([]);
  });
});

describe('automotive request validation and failed-design export gates', () => {
  it('rejects malformed JSON, oversized ordinary requests, invalid manual data and invalid design controls', async () => {
    const malformed = await fetch(`${base}/research`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad-json' });
    expect(malformed.status).toBe(400); expect(await malformed.json()).toMatchObject({ code: 'INVALID_JSON' });
    const oversized = await post('/research', { query: 'x'.repeat(40_000), live: false });
    expect(oversized.status).toBe(413); expect(await oversized.json()).toMatchObject({ code: 'REQUEST_TOO_LARGE' });
    for (const request of [{ query: '', live: false }, { query: 'S63', live: 'false' }, []]) expect((await post('/research', request)).status).toBe(400);
    for (const request of [{ ...manual, sourceUrl: 'javascript:alert(1)' }, { ...manual, dimensions: { lengthMm: 4000, wheelbaseMm: 5000 } }, { ...manual, referenceImages: [{ angle: 'side', url: 'http://127.0.0.1/private' }] }]) expect((await post('/profiles/manual', request)).status).toBe(400);
    const profile = await saveManual();
    const valid = { profileId: profile.id, widthStuds: 9, candidateCount: 5 };
    for (const patch of [{ widthStuds: 5 }, { widthStuds: 25 }, { widthStuds: 8.5 }, { candidateCount: 4 }, { candidateCount: 21 }, { allowEstimatedProportions: 'true' }, { referenceIds: ['missing-reference'] }, { bodyColor: {} }, { weights: { unrecognised: 1 } }, { weights: { legoStyle: -1 } }]) {
      const response = await post('/design', { ...valid, ...patch });
      expect(response.status, JSON.stringify(patch)).toBe(400);
    }
  });

  it('returns actionable 404s for unknown profiles and sessions without exposing server details', async () => {
    const unknownProfile = await post('/design', { profileId: 'missing-profile', widthStuds: 9, candidateCount: 5 });
    expect(unknownProfile.status).toBe(404); expect(await unknownProfile.json()).toMatchObject({ code: 'VEHICLE_PROFILE_NOT_FOUND' });
    const missing = await fetch(`${base}/sessions/auto-${randomUUID()}`);
    expect(missing.status).toBe(404); expect(await missing.json()).toMatchObject({ code: 'AUTOMOTIVE_SESSION_NOT_FOUND' });
    const invalid = await fetch(`${base}/sessions/not-a-session`);
    expect(invalid.status).toBe(400);
    const error = await invalid.json();
    expect(error).toMatchObject({ code: 'INVALID_AUTOMOTIVE_SESSION' });
    expect(error.stack).toBeUndefined(); expect(error.path).toBeUndefined();
  });

  it('persists a custom-width brief with no candidates and prevents every export path', async () => {
    const profile = await saveManual();
    const response = await post('/design', { profileId: profile.id, widthStuds: 9, candidateCount: 5 });
    expect(response.status, await response.clone().text()).toBe(200);
    const design = await response.json() as AutomotiveDesignResponse;
    expect(design).toMatchObject({ status: 'unsupported', candidates: [], brief: { profileId: profile.id, targetWidthStuds: 9, dimensionBasis: 'source-backed', planningMethod: 'discrete-module-replanning' }, debug: { plans: [], physicalBuildsVerified: 0, imageAnalysis: 'not-configured', realModelCount: 0 } });
    expect(design.brief.proportions.lengthStuds).toBeGreaterThan(9);
    expect(design.references.references).toEqual([]);
    const files = await readdir(path.join(directory, 'automotive', 'sessions'));
    expect(files).toEqual([`${design.sessionId}.json`]);
    await stop(); await start();
    const restored = await fetch(`${base}/sessions/${design.sessionId}`);
    expect(restored.status).toBe(200); expect(await restored.json()).toEqual(design);
    for (const route of ['bom', 'instructions', 'bom?format=csv']) {
      const exported = await fetch(`${base}/sessions/${design.sessionId}/candidates/missing-candidate/${route}`);
      expect(exported.status).toBe(422);
      expect(await exported.json()).toMatchObject({ code: 'AUTOMOTIVE_EXPORT_BLOCKED' });
    }
  });
});
