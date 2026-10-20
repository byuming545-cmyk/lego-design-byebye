import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { analyzeReferenceModel, deriveReferenceConnections, referencePartBoundsLdu, referencePartToSpeedPart } from '../src/automotive/references/analyzer.js';
import { internalToLdraw, ldrawToInternal } from '../src/automotive/references/coordinates.js';
import { createReferenceLink, importReferenceModel, ReferenceImportError } from '../src/automotive/references/importer.js';
import { ReferenceLibraryStore } from '../src/automotive/references/store.js';
import type { ReferenceMetadataInput } from '../src/automotive/references/types.js';

/** Original minimal test fixtures; these are not official LEGO/OMR references or learned designs. */
const metadata: ReferenceMetadataInput = { source: 'user-original-test-fixture', modelName: 'Original test assembly', author: 'Bricklab test authors', license: 'user-owned', attribution: 'Original Bricklab test fixture; no official model source.', importedAt: '2026-10-20T10:00:00Z', rightsDeclaration: { ownsRights: true, statement: 'I created this minimal test assembly and hold the rights to provide it.' } };
const placement = (file = '3001.dat', x = 0, y = 0, z = 0, color = 4, matrix = '1 0 0 0 1 0 0 0 1') => `1 ${color} ${x} ${y} ${z} ${matrix} ${file}`;
const parse = (text: string) => importReferenceModel({ text, metadata });
const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });

describe('LDraw reference importer and coordinates', () => {
  it('keeps native affine matrices, hierarchy, and parent current color through MPD expansion', () => {
    const model = parse(['0 FILE root.ldr', placement('body.ldr', 100, 24, 200, 4, '0 0 1 0 1 0 -1 0 0'), '0 FILE body.ldr', placement('3001.dat', 20, 0, 0, 16, '0.70710678 0 -0.70710678 0 1 0 0.70710678 0 0.70710678')].join('\n'));
    expect(model.parts).toHaveLength(1);
    expect(model.parts[0].positionLdu).toEqual({ x: 100, y: 24, z: 180 });
    expect(model.parts[0].position).toEqual({ x: 5, y: 9, z: -3 });
    expect(model.parts[0].color).toBe(4);
    expect(model.parts[0].nativeColor).toBe(16);
    expect(model.parts[0].hierarchy).toEqual(['root.ldr', 'body.ldr@2']);
    expect(model.parts[0].matrixLdu[0]).toBeCloseTo(0.70710678);
    expect(model.submodels[0].placements[0].matrixLdu).toEqual([0, 0, 1, 0, 1, 0, -1, 0, 0]);
  });
  it('converts x,z,-y into studs and plates in one reversible converter', () => {
    expect(ldrawToInternal({ x: 40, y: -24, z: 60 })).toEqual({ x: 2, y: 3, z: 3 });
    expect(internalToLdraw({ x: 2, y: 3, z: 3 })).toEqual({ x: 40, y: -24, z: 60 });
  });
  it('retains unresolved references and inline primitive source without fetching or placeholder geometry', () => {
    const model = parse(`${placement('not-in-catalog.dat')}\n3 4 0 0 0 20 0 0 0 20 0`);
    expect(model.parts[0].resolved).toBe(false);
    expect(model.coverage).toMatchObject({ totalParts: 1, knownGeometryParts: 0, geometryRate: 0, unresolvedPartIds: ['not-in-catalog'] });
    expect(referencePartBoundsLdu(model.parts[0])).toBeNull();
    expect(model.submodels[0].primitives).toHaveLength(1);
  });
  it.each(['../3001.dat', '/3001.dat', 'C:\\3001.dat', 'https://example.com/a.dat', 'safe/../../3001.dat'])('rejects injected file path %s', file => { expect(() => parse(placement(file))).toThrow(ReferenceImportError); });
  it('rejects cyclic, excessive-depth, oversized-expanded, singular and nonfinite models', () => {
    expect(() => parse('0 FILE a.ldr\n' + placement('b.ldr') + '\n0 FILE b.ldr\n' + placement('a.ldr'))).toThrow(/Cyclic/);
    expect(() => importReferenceModel({ text: ['0 FILE a.ldr', placement('b.ldr'), '0 FILE b.ldr', placement('c.ldr'), '0 FILE c.ldr', placement()].join('\n'), metadata, limits: { maxDepth: 1 } })).toThrow(/deep/);
    expect(() => importReferenceModel({ text: `${placement()}\n${placement()}`, metadata, limits: { maxParts: 1 } })).toThrow(/many/);
    expect(() => parse(placement('3001.dat', 0, 0, 0, 4, '0 0 0 0 0 0 0 0 0'))).toThrow(/transform/);
    expect(() => parse(placement('3001.dat', Infinity))).toThrow(/transform/);
  });
  it('bounds repeated submodel expansion even when branches contain no leaf parts', () => {
    const text = Array.from({ length: 12 }, (_, level) => [`0 FILE level-${level}.ldr`, ...(level < 11 ? [placement(`level-${level + 1}.ldr`), placement(`level-${level + 1}.ldr`)] : [])]).flat().join('\n');
    expect(() => importReferenceModel({ text, metadata, limits: { maxParts: 30 } })).toThrow(/Expanded hierarchy/);
  });
  it('requires confirmed permissive license or an explicit user rights declaration', () => {
    expect(() => importReferenceModel({ text: placement(), metadata: { ...metadata, license: 'unknown' } })).toThrow(/link and metadata only/);
    expect(() => importReferenceModel({ text: placement(), metadata: { ...metadata, rightsDeclaration: undefined } })).toThrow(/explicit rights/);
    const open = parse('0 // source text is parsed, never executed\n' + placement());
    expect(open.metadata.attribution).toBe(metadata.attribution);
    expect(() => importReferenceModel({ text: '0 !LICENSE Licensed under CC BY 4.0 : see CAreadme.txt\n' + placement(), metadata })).toThrow(/metadata must retain/);
  });
  it('retains explicit user classification and tags, defaults unclassified metadata to unknown', () => {
    expect(parse(placement()).metadata).toMatchObject({ vehicleType: 'unknown', featureTags: [] });
    const model = importReferenceModel({ text: placement(), metadata: { ...metadata, vehicleType: 'luxury-sedan', featureTags: ['long hood', 'four doors'] } });
    expect(model.metadata).toMatchObject({ vehicleType: 'luxury-sedan', featureTags: ['long hood', 'four doors'] });
    expect(() => importReferenceModel({ text: placement(), metadata: { ...metadata, featureTags: Array(21).fill('tag') } })).toThrow(/at most 20/);
    expect(() => importReferenceModel({ text: placement(), metadata: { ...metadata, featureTags: ['x'.repeat(65)] } })).toThrow(/feature tag/);
  });
});

describe('automotive reference analyzer', () => {
  it('adapts native top-centred brick origins and arbitrary affine AABBs', () => {
    const model = parse(placement('3001.dat', 0, 0, 0, 4, '0.7071067811865476 0 -0.7071067811865476 0 1 0 0.7071067811865476 0 0.7071067811865476'));
    const analysis = analyzeReferenceModel(model);
    expect(analysis.overall.width.value).toBeCloseTo(3 * Math.SQRT2);
    expect(analysis.overall.length.value).toBeCloseTo(3 * Math.SQRT2);
    expect(analysis.overall.height.value).toBe(3);
    expect(analysis.bounds?.min.z).toBe(-3);
    expect(analysis.bounds?.exact).toBe(false);
    expect(analysis.connections.assessedParts).toBe(0);
    expect(referencePartToSpeedPart(model.parts[0])).toBeNull();
  });
  it('reports low-confidence placement bounds and null unavailable automotive semantics', () => {
    const analysis = analyzeReferenceModel(parse(`${placement('unknown.dat', 0, 0, 0)}\n${placement('unknown.dat', 100, 0, 200)}`));
    expect(analysis.bounds?.method).toBe('placement-bounds');
    expect(analysis.overall.width.value).toBe(5);
    expect(analysis.overall.width.confidence).toBeLessThan(0.4);
    expect(analysis.overall.width.evidence.join(' ')).toContain('not exact');
    for (const measure of [analysis.overall.wheelbase, analysis.overall.groundClearance, analysis.cockpit.start, analysis.shape.hoodLength, analysis.shape.frontSlope]) {
      expect(measure.value).toBeNull(); expect(measure.confidence).toBe(0); expect(measure.evidence.length).toBeGreaterThan(0);
    }
    expect(analysis.connections.edges).toEqual([]);
  });
  it('uses only coincident known connectors and excludes arbitrary rotations and unknown parts', () => {
    const model = parse(`${placement('3001.dat', 0, 0, 0)}\n${placement('3001.dat', 0, -24, 0)}\n${placement('unknown.dat', 0, 0, 0)}`);
    expect(deriveReferenceConnections(model.parts)).toHaveLength(8);
    expect(analyzeReferenceModel(model).connections.unassessedParts).toBe(1);
    const converted = referencePartToSpeedPart(model.parts[0]);
    expect(converted?.position).toEqual({ x: -2, y: 1, z: -3 });
    expect(converted?.orientation).toBeDefined();
  });
  it('bounds connector work for adversarial coincident placements', () => {
    const model = parse(Array(600).fill(placement()).join('\n'));
    expect(() => deriveReferenceConnections(model.parts)).toThrow(/comparison limit/);
  });
  it('derives wheelbase/track from known transverse tyres, requires explicit front for overhang', () => {
    const matrix = '0 0 1 0 1 0 -1 0 0';
    const text = [-60, 60].flatMap(x => [-100, 100].map(z => placement('18977.dat', x, 0, z, 0, matrix))).join('\n');
    const model = parse(text), result = analyzeReferenceModel(model);
    expect(result.overall.wheelbase.value).toBe(10);
    expect(result.wheels.diameter.value).toBe(3);
    expect(result.wheels.trackWidth.value).toBe(6);
    expect(result.overall.frontOverhang.value).toBeNull();
    expect(analyzeReferenceModel(model, { frontDirection: 1 }).overall.frontOverhang.value).toBeCloseTo(1.5);
  });
});

describe('atomic reference library storage', () => {
  it('round-trips model sections, metadata and unresolved coverage with no temporary files', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'bricklab-reference-')); temporary.push(directory);
    const store = new ReferenceLibraryStore({ dataDir: directory }), model = parse(placement('unknown.dat'));
    await store.save(model);
    const loaded = await store.get(model.id);
    expect(loaded.kind).toBe('model');
    expect(loaded.metadata).toEqual(model.metadata);
    if (loaded.kind === 'model') expect(loaded.coverage).toEqual(model.coverage);
    expect(await store.list()).toHaveLength(1);
    expect((await readdir(store.directory)).filter(file => file.endsWith('.tmp'))).toEqual([]);
    await expect(store.get('../escape')).rejects.toThrow(/identifier/);
  });
  it('saves unknown-license sources as metadata only and strips extra model text fields', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'bricklab-reference-')); temporary.push(directory);
    const store = new ReferenceLibraryStore({ dataDir: directory }), link = createReferenceLink({ ...metadata, license: 'unknown' });
    await store.save({ ...link, text: placement(), parts: [placement()] } as typeof link);
    const raw = JSON.parse(await readFile(path.join(store.directory, `${link.id}.json`), 'utf8'));
    expect(Object.keys(raw).sort()).toEqual(['id', 'kind', 'metadata', 'schemaVersion']);
    expect(raw.metadata.license).toBe('unknown');
    await writeFile(path.join(store.directory, `${link.id}.json`), '{malformed');
    await expect(store.get(link.id)).rejects.toThrow(/corrupt/);
  });
});
