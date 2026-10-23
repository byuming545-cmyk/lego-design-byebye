import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { adaptPdfInventories, importFoundationInventoryCsv, importFoundationInventoryJson, parseFoundationInventory, parseInventoryCsv } from '../src/parts/inventory/index.js';
import type { FoundationInventory, FoundationInventoryItem } from '../src/parts/inventory/index.js';
import { mineFoundationInventories } from '../src/parts/miner.js';

const sha = 'a'.repeat(64);
const item = (overrides: Partial<FoundationInventoryItem> = {}): FoundationInventoryItem => ({
  partId: null, partIdSystem: null, designId: null, elementId: '6194304', color: null,
  quantity: 4, isSpare: null, category: null, evidence: [{ sourceId: 'book1', page: 102, row: 1 }], ...overrides,
});
const inventory = (items: FoundationInventoryItem[] = [item()], overrides: Partial<FoundationInventory> = {}): FoundationInventory => ({
  schemaVersion: 1, id: 'pdf-book1', setNumber: '77257', inventoryComplete: false,
  provenance: { kind: 'official-pdf', sourceId: 'book1', sourceUrl: null, sha256: sha, importedAt: '2026-10-23T00:00:00.000Z', trust: 'source-observed' },
  items, ...overrides,
});
const csvOptions = { id: 'csv-import', setNumber: '77257', sourceId: 'my-export' };

describe('source-backed foundation inventory imports', () => {
  it('keeps element identity, unknown color and unknown spare status separate from design/part IDs', () => {
    const parsed = parseFoundationInventory(inventory());
    expect(parsed.setNumber).toBe('77257-1');
    expect(parsed.items[0]).toMatchObject({ elementId: '6194304', designId: null, partId: null, color: null, isSpare: null });
    expect(parsed.items[0]).not.toHaveProperty('dimensions');
    expect(parsed).not.toHaveProperty('generatable');
  });

  it.each([0, -1, 1.2, Infinity, 100_001, '4'])('rejects invalid quantities %s', quantity => {
    expect(() => parseFoundationInventory(inventory([item({ quantity: quantity as number })]))).toThrow('quantity');
  });

  it('rejects missing provenance, missing per-row evidence, ambiguous part IDs and unqualified colors', () => {
    expect(() => parseFoundationInventory({ ...inventory(), provenance: null })).toThrow('provenance');
    expect(() => parseFoundationInventory(inventory([item({ evidence: [] })]))).toThrow('evidence');
    expect(() => parseFoundationInventory(inventory([item({ partId: '3001' })]))).toThrow('partIdSystem');
    expect(() => parseFoundationInventory(inventory([item({ color: { id: '4' } as FoundationInventoryItem['color'] })]))).toThrow('color system');
    expect(() => parseFoundationInventory(inventory([item({ evidence: [{ sourceId: 'other-source', page: 2 }] })]))).toThrow('inventory source');
  });

  it('does not fetch source URLs or accept URLs containing credentials', () => {
    for (const sourceUrl of ['http://source.test/file.pdf', 'https://user:password@source.test/file.pdf', 'https://source.test/?api_key=secret']) {
      expect(() => parseFoundationInventory(inventory([], { provenance: { ...inventory().provenance, sourceUrl } }))).toThrow('sourceUrl');
    }
  });

  it('hashes local JSON bytes and downgrades caller claims of verified trust', () => {
    const raw = inventory([], { provenance: { ...inventory().provenance, kind: 'rebrickable', trust: 'verified-upstream' } });
    const parsed = importFoundationInventoryJson(JSON.stringify(raw));
    expect(parsed.provenance).toMatchObject({ kind: 'local-json', trust: 'user-reported' });
    expect(parsed.provenance.sha256).not.toBe(sha);
    expect(parsed.provenance.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('reads explicit CSV IDs, zero color ID, quantities and spare flags without guessing unknown values', () => {
    const csv = 'elementId,designId,partId,partIdSystem,colorSystem,colorId,colorName,quantity,isSpare,sourcePage\r\n6194304,,,,,,"Unknown, printed",4,unknown,102';
    expect(() => importFoundationInventoryCsv(csv, csvOptions)).toThrow('color');
    const parsed = importFoundationInventoryCsv('elementId,designId,partId,partIdSystem,colorSystem,colorId,colorName,quantity,isSpare,sourcePage\r\n6194304,3001,3001,ldraw,ldraw,0,"Black, opaque",4,false,102', csvOptions);
    expect(parsed.items[0]).toMatchObject({ elementId: '6194304', designId: '3001', partId: '3001', partIdSystem: 'ldraw', color: { system: 'ldraw', id: '0', name: 'Black, opaque' }, quantity: 4, isSpare: false, evidence: [{ sourceId: 'my-export', page: 102, row: 2 }] });
    expect(parsed.provenance.trust).toBe('user-reported');
    expect(importFoundationInventoryCsv('elementId,quantity\n6194304,4', csvOptions).items[0].isSpare).toBeNull();
  });

  it('supports quoted newlines and escaped quotes but rejects malformed CSV, ambiguous columns and spare coercion', () => {
    expect(parseInventoryCsv('a,b\r\n"one\ntwo","a""b"')).toEqual([['a', 'b'], ['one\ntwo', 'a"b']]);
    for (const csv of ['a,b\n"unterminated,b', 'a,b\n"closed"x,b', 'a,b\na"b,c']) expect(() => parseInventoryCsv(csv)).toThrow('CSV');
    for (const csv of ['id,quantity\n6194304,4', 'elementId,quantity,quantity\n6194304,4,4', 'elementId,quantity,isSpare\n6194304,4,no', 'elementId,quantity\n6194304,4,5', 'partId,quantity\n3001,4']) expect(() => importFoundationInventoryCsv(csv, csvOptions)).toThrow();
  });

  it('adapts PDF evidence without promoting element IDs, visual spot checks or spare status', () => {
    const payload = { schemaVersion: 1, inventories: [{ documentId: 'book1', setNumber: '77257', source: { kind: 'user-uploaded-lego-pdf', sha256: sha, sourceUrl: null }, inventoryComplete: false, sparesDistinguished: false, rows: [{ rowId: 'r1', elementId: '6194304', designId: null, partId: null, color: null, quantity: 4, isSpare: null, evidence: { documentId: 'book1', pdfPage: 102, bbox: [1, 2, 30, 40], rawText: '4x\n6194304', method: 'native-pdf-text-block', reviewStatus: 'visual-spot-checked' } }] }] };
    const parsed = adaptPdfInventories(payload, '2026-10-23T00:00:00.000Z');
    expect(parsed[0].items[0]).toMatchObject({ elementId: '6194304', designId: null, color: null, isSpare: null, evidence: [{ sourceId: 'book1', page: 102, bbox: [1, 2, 30, 40] }] });
    expect(parsed[0].provenance.trust).toBe('source-observed');
    const bad = structuredClone(payload); bad.inventories[0].inventoryComplete = true;
    expect(() => adaptPdfInventories(bad)).toThrow('complete');
    const guessed = structuredClone(payload); guessed.inventories[0].rows[0].designId = '3001' as unknown as null;
    expect(() => adaptPdfInventories(guessed)).toThrow('mapping');
  });
});

describe('real inventory frequency mining', () => {
  it('imports the actual uploaded appendix observations without inventing design mappings or regular stock', () => {
    const payload: unknown = JSON.parse(readFileSync(new URL('../data/parts-foundation/instructions/inventories.json', import.meta.url), 'utf8'));
    const inventories = adaptPdfInventories(payload, '2026-10-23T00:00:00.000Z');
    const report = mineFoundationInventories(inventories, { expectedSetNumbers: ['77263', '76924', '77239', '77238', '77254', '77257'], limit: 1000 });
    expect(report).toMatchObject({ observedRowCount: 667, actualSetDenominator: 4, expectedSetDenominator: 6, designRanking: [], partRanking: [], missingSetNumbers: ['76924-1', '77239-1'] });
    expect(report.elementRanking).toHaveLength(531);
    expect(report.elementRanking.reduce((sum, row) => sum + row.observedQuantity, 0)).toBe(1586);
    expect(report.elementRanking.reduce((sum, row) => sum + row.knownNonSpareQuantity, 0)).toBe(0);
    expect(report.elementRanking.reduce((sum, row) => sum + row.spareUnknownQuantity, 0)).toBe(1586);
    expect(inventories.every(inventory => inventory.provenance.officialOriginIndependentlyVerified === false && !inventory.inventoryComplete)).toBe(true);
    const evidence = inventories.flatMap(inventory => inventory.items.flatMap(item => item.evidence));
    expect(evidence.filter(evidence => evidence.reviewStatus === 'visual-spot-checked')).toHaveLength(54);
    expect(evidence.every(evidence => evidence.page && evidence.bbox && evidence.quantityBbox && evidence.elementIdBbox)).toBe(true);
  });

  it('returns empty rankings and null unknown denominator when no actual inventories exist', () => {
    expect(mineFoundationInventories([])).toMatchObject({ actualSetDenominator: 0, expectedSetDenominator: null, designRanking: [], partRanking: [], elementRanking: [] });
    const report = mineFoundationInventories([], { expectedSetNumbers: ['77257', '77263'] });
    expect(report.missingSetNumbers).toEqual(['77257-1', '77263-1']);
    expect(report.actualSetDenominator).toBe(0);
    expect(report.expectedSetDenominator).toBe(2);
  });

  it('keeps PDF element ranking separate and excludes unknown spares from non-spare counts', () => {
    const report = mineFoundationInventories([inventory()]);
    expect(report.designRanking).toEqual([]);
    expect(report.partRanking).toEqual([]);
    expect(report.elementRanking[0]).toMatchObject({ identity: { system: 'lego-element', id: '6194304' }, observedQuantity: 4, knownNonSpareQuantity: 0, knownSpareQuantity: 0, spareUnknownQuantity: 4, distinctSetCount: 1 });
  });

  it('counts distinct actual sets, deduplicates imported copies and never adds overlapping whole-set appendices', () => {
    const first = inventory();
    const duplicate = inventory(undefined, { id: 'local-copy' });
    const otherBook = inventory([item({ quantity: 3, evidence: [{ sourceId: 'book2', page: 100 }] })], { id: 'book2', provenance: { ...first.provenance, sourceId: 'book2', sha256: 'b'.repeat(64) } });
    const secondSet = inventory([item({ quantity: 2 })], { setNumber: '77263' });
    const report = mineFoundationInventories([first, duplicate, otherBook, secondSet]);
    expect(report.actualSetDenominator).toBe(2);
    expect(report.uniqueSourceDocuments).toBe(3);
    expect(report.elementRanking[0]).toMatchObject({ distinctSetCount: 2, observedQuantity: 6, spareUnknownQuantity: 6 });
    expect(report.warnings.some(w => w.includes('Overlapping'))).toBe(true);
  });

  it('resolves metadata revisions of identical source bytes by trust, completeness and stable identity without adding quantities', () => {
    const source = inventory();
    const claimedComplete = inventory(undefined, { id: 'a-claimed-complete', inventoryComplete: true, provenance: { ...source.provenance, trust: 'user-reported' } });
    const verifiedPartial = inventory(undefined, { id: 'z-verified-partial', provenance: { ...source.provenance, trust: 'verified-export' } });
    for (const input of [[claimedComplete, verifiedPartial], [verifiedPartial, claimedComplete]]) {
      const report = mineFoundationInventories(input);
      expect(report.uniqueSourceDocuments).toBe(1);
      expect(report.completeSetNumbers).toEqual([]);
      expect(report.elementRanking[0].observedQuantity).toBe(4);
      expect(report.warnings.some(warning => warning.includes('User-reported'))).toBe(false);
    }
    const verifiedComplete = inventory(undefined, { id: 'z-verified-complete', inventoryComplete: true, provenance: { ...source.provenance, trust: 'verified-export' } });
    expect(mineFoundationInventories([verifiedPartial, verifiedComplete]).completeSetNumbers).toEqual(['77257-1']);
    expect(mineFoundationInventories([verifiedComplete, verifiedPartial]).elementRanking[0].observedQuantity).toBe(4);

    const sourceA = inventory([item({ evidence: [{ sourceId: 'source-a', page: 102 }] })], { id: 'a-stable', provenance: { ...source.provenance, sourceId: 'source-a' } });
    const sourceB = inventory([item({ evidence: [{ sourceId: 'source-b', page: 102 }] })], { id: 'b-stable', provenance: { ...source.provenance, sourceId: 'source-b' } });
    for (const input of [[sourceA, sourceB], [sourceB, sourceA]]) expect(mineFoundationInventories(input).elementRanking[0].sourceIds).toEqual(['source-a']);
  });

  it('does not let a complete user claim replace a verified partial observation from a different source', () => {
    const source = inventory();
    const verified = inventory([item({ quantity: 4, isSpare: false })], { provenance: { ...source.provenance, trust: 'verified-upstream' } });
    const claimed = inventory([item({ quantity: 100, isSpare: false, evidence: [{ sourceId: 'claimed-source', page: 1 }] })], { id: 'claimed-complete', inventoryComplete: true, provenance: { ...source.provenance, sourceId: 'claimed-source', sha256: 'c'.repeat(64), trust: 'user-reported' } });
    for (const input of [[claimed, verified], [verified, claimed]]) {
      const report = mineFoundationInventories(input);
      expect(report.elementRanking[0]).toMatchObject({ observedQuantity: 4, knownNonSpareQuantity: 4, distinctSetCount: 1, sourceIds: ['book1'] });
      expect(report.selectionPolicy).toBe('source-trust-then-complete-then-largest-observation');
    }
  });

  it('sums different colors within one source and uses explicit categories for priority only', () => {
    const a = item({ designId: '3001', elementId: '6194304', quantity: 2, isSpare: false, color: { system: 'ldraw', id: '0' }, category: 'Brick' });
    const b = item({ designId: '3001', elementId: '6194305', quantity: 3, isSpare: true, color: { system: 'ldraw', id: '4' }, category: 'Brick', evidence: [{ sourceId: 'book1', row: 2 }] });
    const report = mineFoundationInventories([inventory([a, b])], { categoryPriorities: { Brick: 7 } });
    expect(report.designRanking[0]).toMatchObject({ observedQuantity: 5, knownNonSpareQuantity: 2, knownSpareQuantity: 3, spareUnknownQuantity: 0, categoryPriority: 7 });
    expect(report.elementRanking).toHaveLength(2);
    expect(mineFoundationInventories([inventory([item({ category: 'constructor' })])]).elementRanking[0].categoryPriority).toBe(0);
  });

  it('prioritizes frequency across sets, then known regular quantity, and does not mistake two books for two sets', () => {
    const one = inventory([item({ designId: '3001', quantity: 1, isSpare: false }), item({ designId: '3002', elementId: '6194305', quantity: 100, isSpare: false, evidence: [{ sourceId: 'book1', row: 2 }] })]);
    const two = inventory([item({ designId: '3001', quantity: 1, isSpare: false })], { setNumber: '77263' });
    const report = mineFoundationInventories([one, two]);
    expect(report.designRanking[0].identity.id).toBe('3001');
    expect(report.designRanking[0].distinctSetCount).toBe(2);
    expect(report.designRanking[1].identity.id).toBe('3002');
  });
});
