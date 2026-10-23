import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { adaptPdfInventories } from '../src/parts/inventory/index.js';
import { buildFailedPartRecoveryQueue, buildInstructionCoverage, createBundledElementDesignMapper, ElementDesignMapper, parseElementMappingSnapshot, type ElementMappingSource, type LDrawCrossReference } from '../src/parts/recovery/index.js';

const bundleRoot = fileURLToPath(new URL('../data/parts-foundation/mappings/', import.meta.url));
const readJson = async (file: string) => JSON.parse(await readFile(file, 'utf8'));
const snapshot = () => readJson(path.join(bundleRoot, 'element-rows.json'));
const source: ElementMappingSource = { id: 'synthetic-test-source', url: 'https://example.invalid/test-fixture', revision: 'b'.repeat(40), sha256: 'a'.repeat(64), trust: 'user-reported', dataLicense: 'test-only', independentlyVerifiedOfficial: false };

describe('source-backed ElementDesignMapper', () => {
  it('resolves all 531 documentary elements without inferring LDraw identities or official verification', async () => {
    const mapper = await createBundledElementDesignMapper();
    expect(mapper.summary()).toMatchObject({ observedElements: 531, mappedBySource: 531, conflicts: 0, resolvedLDraw: 0, independentlyVerifiedOfficial: 0, sourceTrust: 'source-observed' });
    expect(mapper.resolve('302401')).toMatchObject({ status: 'mapped', partId: '3024', designId: '3024', color: { system: 'rebrickable', id: '15', name: 'White' }, ldrawPartId: null, independentlyVerifiedOfficial: false });
    // The real raw table explicitly distinguishes the two cataloguing identities.
    expect(mapper.resolve('4666579')).toMatchObject({ partId: '3749', designId: '6562', color: { name: 'Tan' } });
    expect(mapper.resolve('6585400')).toMatchObject({ partId: '3383pr0003', designId: '115809', color: { name: 'Trans-Black' } });
  });
  it('does not guess a mapping from identifier formatting or repeated lookup', async () => {
    const mapper = await createBundledElementDesignMapper();
    expect(mapper.resolve('302400')).toMatchObject({ status: 'unresolved', partId: null, designId: null, color: null });
    expect(mapper.resolve('element:302401')).toMatchObject({ status: 'unresolved', partId: null });
    const result = mapper.resolve('302401');
    result.color!.name = 'changed by caller';
    result.rawElementRow!.part_num = 'changed by caller';
    expect(mapper.resolve('302401').color!.name).toBe('White');
    expect(mapper.resolve('302401').rawElementRow!.part_num).toBe('3024');
  });
  it('keeps conflicting source declarations unresolved and never chooses the convenient one', async () => {
    const records = parseElementMappingSnapshot(await snapshot());
    const row = records.find(record => record.elementId === '302401')!;
    // Deliberately contradictory assertions are test-only and never enter the source bundle.
    const mapper = new ElementDesignMapper([row, { ...row, partId: '3001', designId: '3001' }], source);
    expect(mapper.resolve('302401')).toMatchObject({ status: 'conflict', partId: null, designId: null, color: null });
  });
  it('rejects missing table foreign keys and a tampered source snapshot', async () => {
    const data = await snapshot();
    data.tables.colors = [];
    expect(() => parseElementMappingSnapshot(data)).toThrow(/foreign key/);
    const directory = await mkdtemp(path.join(tmpdir(), 'bricklab-element-integrity-'));
    try {
      const manifest = await readFile(path.join(bundleRoot, 'manifest.json'));
      const rows = await readFile(path.join(bundleRoot, 'element-rows.json'), 'utf8');
      await writeFile(path.join(directory, 'manifest.json'), manifest);
      await writeFile(path.join(directory, 'element-rows.json'), rows.replace('302401', '302400'));
      await expect(createBundledElementDesignMapper({ bundleRoot: directory })).rejects.toThrow(/integrity/);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});

describe('failed-part recovery and instruction coverage', () => {
  it('accounts for every observed element, separates mapping recovery from assembly, and retains special reasons', async () => {
    const mapper = await createBundledElementDesignMapper();
    const inventories = adaptPdfInventories(await readJson(fileURLToPath(new URL('../data/parts-foundation/instructions/inventories.json', import.meta.url))));
    let geometryLookups = 0;
    const queue = buildFailedPartRecoveryQueue(inventories, mapper, () => { geometryLookups += 1; return { geometryReady: true, connectionReady: true, collisionReady: true, assemblyVerified: true, generatable: true }; });
    expect(queue.counts).toMatchObject({ total: 531, mappedBySource: 531, mappingUnresolved: 0, recoveredToMapping: 531, resolvedLDraw: 0, assemblyVerified: 0, generatable: 0, blocked: 531 });
    expect(geometryLookups).toBe(0);
    expect(queue.entries.every(entry => entry.reasonCodes.includes('ldraw-cross-reference-not-verified'))).toBe(true);
    expect(queue.entries.find(entry => entry.elementId === '6575731')!.specialCategories).toContain('wheel-system-special-case');
    expect(queue.entries.find(entry => entry.elementId === '6508995')!.specialCategories).toContain('composite-part');
  });
  it('keeps unread documents and absent appendices unknown while reporting all eight files and six reference sets', async () => {
    const mapper = await createBundledElementDesignMapper();
    const manifest = await readJson(fileURLToPath(new URL('../data/parts-foundation/instructions/manifest.json', import.meta.url)));
    const inventories = adaptPdfInventories(await readJson(fileURLToPath(new URL('../data/parts-foundation/instructions/inventories.json', import.meta.url))));
    const report = buildInstructionCoverage(manifest.documents, inventories, mapper);
    expect(report.documents).toHaveLength(8);
    expect(report.sets).toHaveLength(6);
    expect(report.overall.counts).toMatchObject({ uniqueObservedElements: 531, mapped: 531, geometryReady: 0, assemblyVerified: 0, generatable: 0, mappingUnresolved: 0, unresolved: 531 });
    expect(report.overall.percentages).toMatchObject({ mapped: 100, assemblyVerified: 0, generatable: 0, unresolved: 100 });
    expect(report.documents.find(row => row.documentId === '6572269')).toMatchObject({ sourceStatus: 'transfer-limit', denominator: 0, percentages: { mapped: null, generatable: null } });
    expect(report.documents.find(row => row.documentId === '6522905')).toMatchObject({ coverageStatus: 'no-inventory-appendix', denominator: 0, percentages: { mapped: null, generatable: null } });
    expect(report.sets.find(row => row.setNumber === '77238')!.documentIds).toEqual(['6592556', '6592612']);
    expect(report.sets.find(row => row.setNumber === '77239')).toMatchObject({ denominator: 0, percentages: { mapped: null } });
  });
  it('requires an explicit source-backed cross-reference and all assembly prerequisites before counting generator coverage', async () => {
    const records = parseElementMappingSnapshot(await snapshot());
    const row = records.find(record => record.elementId === '302401')!;
    const reference: LDrawCrossReference = { partId: '3024', partIdSystem: 'rebrickable', ldrawPartId: '3024', method: 'explicit-cross-reference-table', source: { url: 'https://example.invalid/synthetic-cross-reference', revision: 'c'.repeat(40), sha256: 'd'.repeat(64), rawText: 'test-only explicit table row' } };
    const mapper = new ElementDesignMapper([row], source, [reference]);
    const inventory = [{ documentId: 'test-doc', setNumber: '77263', rows: [{ elementId: '302401', quantity: 1 }] }];
    const valid = buildFailedPartRecoveryQueue(inventory, mapper, () => ({ geometryReady: true, connectionReady: true, collisionReady: true, assemblyVerified: true, generatable: true }));
    expect(valid.counts.generatable).toBe(1);
    const invalid = buildFailedPartRecoveryQueue(inventory, mapper, () => ({ geometryReady: false, connectionReady: true, collisionReady: true, assemblyVerified: true, generatable: true }));
    expect(invalid.counts.generatable).toBe(0);
    expect(invalid.entries[0].blockedCategory).toBe('geometry');
  });
});
