import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildInstructionDemand, demandEvidenceForNativePart, PILOT_PART_SELECTION, type HistoricalDemandMapping } from '../src/parts/digitalImport/demand.js';
import { adaptPdfInventories } from '../src/parts/inventory/index.js';
import type { FoundationInventory } from '../src/parts/inventory/types.js';

function inventory(elementId = '1234567', quantity = 4): FoundationInventory {
  return { schemaVersion: 1, id: 'test-book', setNumber: '77257', inventoryComplete: false,
    provenance: { kind: 'official-pdf', sourceId: 'test-book', sourceUrl: null, sha256: 'a'.repeat(64), importedAt: '2026-10-25T00:00:00.000Z', trust: 'source-observed' },
    items: [{ partId: null, partIdSystem: null, designId: null, elementId, color: null, quantity, isSpare: null, category: null, evidence: [{ sourceId: 'test-book', page: 42, row: 1 }] }],
  };
}
function mapping(overrides: Partial<HistoricalDemandMapping> = {}): HistoricalDemandMapping {
  return { elementId: '1234567', designId: '3001', rebrickablePartId: '3001', mappingStatus: 'PROBABLE_BUT_UNVERIFIED', reasonCodes: ['variant-not-established'], candidates: [{ ldrawPartId: '3001' }], ...overrides };
}

describe('instruction demand is a reference-only side channel', () => {
  it('keeps representative coverage requests separate from verified set inventory identity', () => {
    expect(PILOT_PART_SELECTION).toHaveLength(26);
    expect(new Set(PILOT_PART_SELECTION.map(row => row.partId)).size).toBe(26);
    expect(new Set(PILOT_PART_SELECTION.map(row => row.category))).toEqual(new Set(['Brick', 'Plate', 'Tile', 'Bracket', 'Jumper', 'SNOT', 'Curved Slope', 'Windscreen', 'Mudguard', 'Wheel', 'Tyre', 'Hole', 'Axle', 'Pin']));
  });
  it('ranks all actual appendix observations without promoting the 531 unresolved identity chains', () => {
    const payload = JSON.parse(readFileSync(new URL('../data/parts-foundation/instructions/inventories.json', import.meta.url), 'utf8'));
    const review = JSON.parse(readFileSync(new URL('../data/parts-foundation/mappings/ldraw-mapping-review.json', import.meta.url), 'utf8'));
    const report = buildInstructionDemand(adaptPdfInventories(payload), review);
    expect(report.distinctElementCount).toBe(531);
    expect(report.observedRowCount).toBe(667);
    expect(report.observedSetNumbers).toHaveLength(4);
    expect(report.completeSetNumbers).toEqual([]);
    expect(report.counts).toEqual({ EXACT: 0, CANDIDATE: 14, CONFLICT: 88, UNRESOLVED: 429 });
    expect(report.demands.every(row => row.geometryAdmissionAllowed === false && row.assemblyPermissionGranted === false)).toBe(true);
    expect(report.demands.every(row => row.evidence.length > 0 && row.evidence.every(evidence => evidence.page! > 0))).toBe(true);
  });
  it('does not use equal-looking element, design or native numbers as exact identity', () => {
    const report = buildInstructionDemand([inventory('3001')], { entries: [mapping({ elementId: '3001' })] });
    expect(report.demands[0]).toMatchObject({ originalIdentity: { system: 'lego-element', id: '3001' }, identityStatus: 'CANDIDATE', geometryAdmissionAllowed: false });
    expect(demandEvidenceForNativePart('3001', report)[0]).toMatchObject({ matchIsExact: false, setMembershipProven: false, geometryAdmissionAllowed: false });
  });
  it('keeps a conflicting mapping conflicting even when only one candidate is available locally', () => {
    const report = buildInstructionDemand([inventory()], { entries: [mapping({ mappingStatus: 'CONFLICT', candidates: [{ ldrawPartId: '3001' }, { ldrawPartId: '3001a' }] })] });
    expect(report.demands[0].identityStatus).toBe('CONFLICT');
    expect(report.demands[0].ldrawCandidates.map(candidate => candidate.id)).toEqual(['3001', '3001a']);
    expect(demandEvidenceForNativePart('3001', report)[0].status).toBe('CONFLICT');
  });
  it('does not trust a VERIFIED label inside a historical file as new source authorization', () => {
    const report = buildInstructionDemand([inventory()], { entries: [mapping({ mappingStatus: 'VERIFIED' })] });
    expect(report.counts.EXACT).toBe(0);
    expect(report.demands[0]).toMatchObject({ identityStatus: 'CANDIDATE', historicalMappingStatus: 'VERIFIED', geometryAdmissionAllowed: false });
    expect(report.demands[0].reasonCodes).toContain('historical-verified-label-is-not-new-source-authorization');
  });
  it('does not double count duplicate exports and keeps raw PDF observation data unchanged', () => {
    const source = inventory(), original = structuredClone(source);
    const report = buildInstructionDemand([source, structuredClone(source)], { entries: [mapping()] });
    expect(report.demands[0].observedQuantity).toBe(4);
    expect(report.demands[0].distinctObservedSets).toBe(1);
    expect(source).toEqual(original);
  });
  it('rejects duplicate historical mapping decisions rather than selecting a last writer', () => {
    expect(() => buildInstructionDemand([inventory()], { entries: [mapping(), mapping({ mappingStatus: 'CONFLICT' })] })).toThrow('CONFLICT');
  });
  it('does not infer a target from an unreviewed same-number observation', () => {
    const report = buildInstructionDemand([inventory('3001')], { entries: [] });
    expect(report.demands[0]).toMatchObject({ identityStatus: 'UNRESOLVED', ldrawCandidates: [], historicalMappingReference: null });
    expect(demandEvidenceForNativePart('3001', report)).toEqual([]);
  });
});
