import { mineFoundationInventories } from '../miner.js';
import type { FoundationInventory, InventoryEvidence } from '../inventory/types.js';

/** Historical mappings are lookup hints only. Their independent data rights and
 * exact variant identity have not been established by this demand planner. */
export interface HistoricalDemandMapping {
  elementId: string;
  designId: string | null;
  rebrickablePartId: string | null;
  mappingStatus: 'VERIFIED' | 'PROBABLE_BUT_UNVERIFIED' | 'CONFLICT' | 'UNRESOLVED';
  reasonCodes: string[];
  candidates: Array<{ ldrawPartId: string }>;
}
export type DemandIdentityStatus = 'EXACT' | 'CANDIDATE' | 'CONFLICT' | 'UNRESOLVED';
export interface InstructionPartDemand {
  originalIdentity: { system: 'lego-element'; id: string };
  elementId: string;
  identityStatus: DemandIdentityStatus;
  historicalMappingStatus: HistoricalDemandMapping['mappingStatus'] | null;
  /** External namespace identifiers are retained as search clues, never aliases. */
  externalIdentities: Array<{ system: 'lego-design' | 'rebrickable'; id: string }>;
  ldrawCandidates: Array<{ system: 'ldraw'; id: string; status: 'CANDIDATE'; matchBasis: 'historical-explicit-mapping-candidate'; geometryAdmissionAllowed: false }>;
  distinctObservedSets: number;
  setNumbers: string[];
  observedQuantity: number;
  quantityBasis: 'one-observation-per-set-and-element; incomplete-appendices; spares-unknown';
  sourceIds: string[];
  evidence: InventoryEvidence[];
  reasonCodes: string[];
  historicalMappingReference: {
    path: 'data/parts-foundation/mappings/ldraw-mapping-review.json';
    elementId: string;
    dataReusePermission: 'UNKNOWN';
    authority: 'reference-only-not-geometry-identity';
  } | null;
  geometryAdmissionAllowed: false;
  assemblyPermissionGranted: false;
}
export interface InstructionDemandReport {
  schemaVersion: 1;
  basis: 'instruction-element-observations-reference-only';
  observedSetNumbers: string[];
  completeSetNumbers: string[];
  observedRowCount: number;
  distinctElementCount: number;
  counts: Record<DemandIdentityStatus, number>;
  historicalMappingStatusCounts: Record<HistoricalDemandMapping['mappingStatus'], number>;
  sources: Array<{ sourceId: string; sha256: string; trust: FoundationInventory['provenance']['trust']; fileName?: string; independentOfficialAttestation: boolean }>;
  demands: InstructionPartDemand[];
  limitations: string[];
}

const sorted = (values: string[]) => [...new Set(values)].sort();
const mappingStatuses: HistoricalDemandMapping['mappingStatus'][] = ['VERIFIED', 'PROBABLE_BUT_UNVERIFIED', 'CONFLICT', 'UNRESOLVED'];

/** Editorial coverage targets for a bounded pilot. These are LDraw lookup
 * requests, not a declaration that each part occurs in the observed sets. The
 * source importer must independently verify each requested ID and its header. */
export const PILOT_PART_SELECTION = [
  { partId: '3001', category: 'Brick', purpose: '基础砖与多凸点装配基准' },
  { partId: '3005', category: 'Brick', purpose: '小型基础件和连接夹具基准' },
  { partId: '3020', category: 'Plate', purpose: '底盘板与多点连接' },
  { partId: '3024', category: 'Plate', purpose: '最小板件和接口验证基准' },
  { partId: '3710', category: 'Plate', purpose: '纵向结构与错位搭接' },
  { partId: '3023b', category: 'Plate', purpose: '高频历史候选的独立原生来源核验' },
  { partId: '91988', category: 'Plate', purpose: '长板底盘结构需求' },
  { partId: '3068b', category: 'Tile', purpose: '车身表面平板与底部连接' },
  { partId: '3070b', category: 'Tile', purpose: '小型平板与历史候选检索' },
  { partId: '3069b', category: 'Tile', purpose: '窄平板与历史候选检索' },
  { partId: '99780', category: 'Bracket', purpose: '侧向连接与偏置结构' },
  { partId: '99207', category: 'Bracket', purpose: '车体横向加固与侧面安装' },
  { partId: '15573', category: 'Jumper', purpose: '半格偏置装配需求' },
  { partId: '87087', category: 'SNOT', purpose: '侧凸点与车身外壳安装' },
  { partId: '11477', category: 'Curved Slope', purpose: '车身曲面原生几何与空腔诊断' },
  { partId: '15068', category: 'Curved Slope', purpose: '较宽曲面与连接验证' },
  { partId: '18973', category: 'Windscreen', purpose: '汽车座舱挡风玻璃结构' },
  { partId: '18974', category: 'Mudguard', purpose: '轮拱形态与接口需求' },
  { partId: '18976', category: 'Wheel', purpose: 'Speed 车轮原生几何基准，机械配合仍需验证' },
  { partId: '4624', category: 'Wheel', purpose: '轮毂类别比较与独立来源检查' },
  { partId: '3641', category: 'Tyre', purpose: '轮胎实体与轮毂配合问题记录' },
  { partId: '3700', category: 'Hole', purpose: '带孔砖与未知机械接口状态' },
  { partId: '3705', category: 'Axle', purpose: '新增轴类来源试点，不以相似外形替代' },
  { partId: '2780', category: 'Pin', purpose: '新增销类来源试点与连接资料诊断' },
  { partId: '32000', category: 'Hole', purpose: '新增带孔结构来源试点' },
  { partId: '32054', category: 'Pin', purpose: '新增长销来源试点，机械插入仍需验证' },
] as const;

/** Does not fetch, import geometry, write sources, or authorize mappings. Existing
 * mining semantics prevent duplicate books/exports from inflating set demand. */
export function buildInstructionDemand(
  inventories: readonly FoundationInventory[],
  review: { entries: readonly HistoricalDemandMapping[] },
): InstructionDemandReport {
  const ranking = mineFoundationInventories(inventories, { limit: 5000 });
  const mappings = new Map<string, HistoricalDemandMapping>();
  for (const entry of review.entries) {
    if (!/^[1-9]\d{0,11}$/.test(entry.elementId) || !mappingStatuses.includes(entry.mappingStatus) ||
        !Array.isArray(entry.candidates) || entry.candidates.some(candidate => !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(candidate.ldrawPartId))) {
      throw new Error('Invalid historical demand mapping identity or candidate.');
    }
    if (mappings.has(entry.elementId)) throw new Error(`CONFLICT: duplicate historical demand mapping for Element ${entry.elementId}`);
    mappings.set(entry.elementId, entry);
  }
  const counts: InstructionDemandReport['counts'] = { EXACT: 0, CANDIDATE: 0, CONFLICT: 0, UNRESOLVED: 0 };
  const historicalMappingStatusCounts: InstructionDemandReport['historicalMappingStatusCounts'] = { VERIFIED: 0, PROBABLE_BUT_UNVERIFIED: 0, CONFLICT: 0, UNRESOLVED: 0 };
  const demands = ranking.elementRanking.map(row => {
    const mapping = mappings.get(row.identity.id);
    if (mapping) historicalMappingStatusCounts[mapping.mappingStatus]++;
    const candidates = sorted(mapping?.candidates.map(candidate => candidate.ldrawPartId) ?? []);
    // Even a VERIFIED text label in an old file is not an authorized new identity
    // chain. This reference-only planner has no authority to produce EXACT.
    const identityStatus: DemandIdentityStatus = mapping?.mappingStatus === 'CONFLICT' ? 'CONFLICT' : candidates.length ? 'CANDIDATE' : 'UNRESOLVED';
    counts[identityStatus]++;
    const externalIdentities: InstructionPartDemand['externalIdentities'] = [];
    if (mapping?.designId) externalIdentities.push({ system: 'lego-design', id: mapping.designId });
    if (mapping?.rebrickablePartId) externalIdentities.push({ system: 'rebrickable', id: mapping.rebrickablePartId });
    return {
      originalIdentity: { system: 'lego-element' as const, id: row.identity.id }, elementId: row.identity.id,
      identityStatus, historicalMappingStatus: mapping?.mappingStatus ?? null, externalIdentities,
      ldrawCandidates: candidates.map(id => ({ system: 'ldraw' as const, id, status: 'CANDIDATE' as const, matchBasis: 'historical-explicit-mapping-candidate' as const, geometryAdmissionAllowed: false as const })),
      distinctObservedSets: row.distinctSetCount, setNumbers: [...row.setNumbers], observedQuantity: row.observedQuantity,
      quantityBasis: 'one-observation-per-set-and-element; incomplete-appendices; spares-unknown' as const,
      sourceIds: [...row.sourceIds],
      // Keep page/box provenance, without republishing the upstream mapping XML.
      evidence: row.evidence.map(({ rawText: _rawText, ...evidence }) => structuredClone(evidence)),
      reasonCodes: sorted([...(mapping?.reasonCodes ?? ['no-historical-mapping']), 'historical-mapping-data-rights-unknown', 'inventory-observation-does-not-prove-geometry', ...(mapping?.mappingStatus === 'VERIFIED' ? ['historical-verified-label-is-not-new-source-authorization'] : [])]),
      historicalMappingReference: mapping ? { path: 'data/parts-foundation/mappings/ldraw-mapping-review.json' as const, elementId: row.identity.id, dataReusePermission: 'UNKNOWN' as const, authority: 'reference-only-not-geometry-identity' as const } : null,
      geometryAdmissionAllowed: false as const, assemblyPermissionGranted: false as const,
    };
  });
  const sources = new Map<string, InstructionDemandReport['sources'][number]>();
  for (const inventory of inventories) {
    const source = inventory.provenance;
    sources.set(`${source.sourceId}:${source.sha256}`, {
      sourceId: source.sourceId, sha256: source.sha256, trust: source.trust,
      ...(source.fileName ? { fileName: source.fileName } : {}), independentOfficialAttestation: source.officialOriginIndependentlyVerified === true,
    });
  }
  return {
    schemaVersion: 1, basis: 'instruction-element-observations-reference-only',
    observedSetNumbers: [...ranking.observedSetNumbers], completeSetNumbers: [...ranking.completeSetNumbers],
    observedRowCount: ranking.observedRowCount, distinctElementCount: demands.length, counts, historicalMappingStatusCounts,
    sources: [...sources.values()].sort((a, b) => a.sourceId.localeCompare(b.sourceId) || a.sha256.localeCompare(b.sha256)), demands,
    limitations: [
      ...ranking.warnings,
      'Observed appendices are incomplete inventory observations; spare status is not established.',
      'Historical external mappings have unknown independent data reuse permission and are lookup references only; no raw upstream table or mapping XML is copied here.',
      'Candidates, similar numbers and similar geometry never establish exact identity or set membership.',
      'Native LDraw identity can be checked independently at its own source; that does not resolve the Element-to-LDraw cross-reference.',
      'No demand row grants geometry import or assembly/generator permission.',
    ],
  };
}

/** A request for an explicit native ID may cite these hints, but it must keep its
 * own LDraw identity evidence separate from the inventory cross-reference. */
export function demandEvidenceForNativePart(ldrawPartId: string, report: InstructionDemandReport) {
  return report.demands.filter(row => row.ldrawCandidates.some(candidate => candidate.id === ldrawPartId)).map(row => ({
    originalIdentity: structuredClone(row.originalIdentity), candidateIdentity: { system: 'ldraw' as const, id: ldrawPartId },
    status: row.identityStatus, matchIsExact: false as const, setMembershipProven: false as const,
    setNumbers: [...row.setNumbers], distinctObservedSets: row.distinctObservedSets, observedQuantity: row.observedQuantity,
    evidence: structuredClone(row.evidence), mappingReference: structuredClone(row.historicalMappingReference),
    geometryAdmissionAllowed: false as const,
  }));
}
