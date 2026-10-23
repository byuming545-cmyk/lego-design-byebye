import { canonicalSetNumber, parseFoundationInventory } from './inventory/index.js';
import type { FoundationInventory, FoundationInventoryItem, InventoryEvidence } from './inventory/index.js';

export interface FoundationMiningOptions {
  expectedSetNumbers?: string[];
  /** Explicit editorial priority by a source-provided category. Never invent a category from appearance. */
  categoryPriorities?: Record<string, number>;
  limit?: number;
}
export interface MinedPartFrequency {
  rank: number;
  identity: { system: 'lego-design' | 'lego-element' | 'ldraw' | 'rebrickable' | 'bricklink'; id: string };
  distinctSetCount: number;
  setNumbers: string[];
  observedQuantity: number;
  knownNonSpareQuantity: number;
  knownSpareQuantity: number;
  spareUnknownQuantity: number;
  categoryPriority: number;
  categories: string[];
  sourceIds: string[];
  evidence: InventoryEvidence[];
}
export interface FoundationMiningReport {
  schemaVersion: 1;
  basis: 'source-backed-observations';
  quantityPolicy: 'one-observation-per-set-and-identity';
  selectionPolicy: 'source-trust-then-complete-then-largest-observation';
  rankingCriteria: ['distinctSetCount', 'knownNonSpareQuantity', 'categoryPriority', 'observedQuantity', 'identity'];
  expectedSetNumbers: string[];
  observedSetNumbers: string[];
  completeSetNumbers: string[];
  missingSetNumbers: string[];
  actualSetDenominator: number;
  expectedSetDenominator: number | null;
  uniqueSourceDocuments: number;
  observedRowCount: number;
  designMappedRowCount: number;
  elementObservedRowCount: number;
  designRanking: MinedPartFrequency[];
  partRanking: MinedPartFrequency[];
  elementRanking: MinedPartFrequency[];
  warnings: string[];
}
interface Observation {
  identity: MinedPartFrequency['identity'];
  setNumber: string;
  complete: boolean;
  trust: number;
  quantity: number;
  regular: number;
  spare: number;
  unknown: number;
  categories: Set<string>;
  evidence: InventoryEvidence[];
  sourceId: string;
  sourceHash: string;
}
const TRUST = { 'user-reported': 0, 'source-observed': 1, 'verified-export': 2, 'verified-upstream': 3 } as const;
const sortText = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const uniqueSorted = (values: string[]): string[] => [...new Set(values)].sort(sortText);

/**
 * Frequency counts real observed sets. A LEGO element number never enters the design ranking.
 * Different books / duplicate exports for the same set are not added together: a source may
 * contain the whole-set appendix even when the book describes only half of the assembly.
 */
export function mineFoundationInventories(input: readonly FoundationInventory[], options: FoundationMiningOptions = {}): FoundationMiningReport {
  if (input.length > 500) throw new Error('Mining source document limit exceeded');
  const limit = options.limit ?? 500;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 5000) throw new Error('Mining limit must be between 1 and 5000');
  const priorities = options.categoryPriorities ?? {};
  if (Object.values(priorities).some(value => !Number.isSafeInteger(value) || value < 0 || value > 1000)) throw new Error('Category priorities must be bounded non-negative integers');
  const inventories = input.map(value => parseFoundationInventory(value));
  const expectedSetNumbers = uniqueSorted((options.expectedSetNumbers ?? []).map(canonicalSetNumber));
  const uniqueDocuments = new Map<string, FoundationInventory>();
  for (const inventory of inventories) {
    // Re-importing a document under another local ID must not double its rows or its frequency.
    // Metadata revisions can share the same source bytes. Prefer established trust before a
    // completeness claim, then use a stable identity so input ordering cannot choose the source.
    const key = `${inventory.setNumber}:${inventory.provenance.sha256}`;
    const previous = uniqueDocuments.get(key);
    const stableId = (value: FoundationInventory): string => `${value.id}\u0000${value.provenance.sourceId}\u0000${value.provenance.sourceUrl ?? ''}`;
    if (!previous || TRUST[inventory.provenance.trust] > TRUST[previous.provenance.trust] ||
      TRUST[inventory.provenance.trust] === TRUST[previous.provenance.trust] && (
        Number(inventory.inventoryComplete) > Number(previous.inventoryComplete) ||
        inventory.inventoryComplete === previous.inventoryComplete && sortText(stableId(inventory), stableId(previous)) < 0
      )) uniqueDocuments.set(key, inventory);
  }
  const documents = [...uniqueDocuments.values()];
  const observed = documents.filter(inventory => inventory.items.length > 0);
  const observedSetNumbers = uniqueSorted(observed.map(inventory => inventory.setNumber));
  const completeSetNumbers = uniqueSorted(observed.filter(inventory => inventory.inventoryComplete).map(inventory => inventory.setNumber));
  const rows = observed.flatMap(inventory => inventory.items);
  let conflictingObservations = 0;

  function rank(kind: 'design' | 'part' | 'element'): MinedPartFrequency[] {
    const bySetAndIdentity = new Map<string, Observation>();
    function getIdentity(item: FoundationInventoryItem): MinedPartFrequency['identity'] | null {
      if (kind === 'design') return item.designId === null ? null : { system: 'lego-design', id: item.designId };
      if (kind === 'element') return item.elementId === null ? null : { system: 'lego-element', id: item.elementId };
      return item.partId && item.partIdSystem ? { system: item.partIdSystem, id: item.partId } : null;
    }
    for (const inventory of observed) {
      const perSource = new Map<string, Observation>();
      const rowSignatures = new Set<string>();
      for (const item of inventory.items) {
        const identity = getIdentity(item);
        if (!identity) continue;
        // Exact repeated extraction at the same page/box is one observation. Different boxes
        // remain distinct and are summed within their source document.
        const rowSignature = JSON.stringify([identity, item.color, item.quantity, item.isSpare, item.evidence]);
        if (rowSignatures.has(rowSignature)) continue;
        rowSignatures.add(rowSignature);
        const key = `${identity.system}:${identity.id}`;
        let observation = perSource.get(key);
        if (!observation) {
          observation = { identity, setNumber: inventory.setNumber, complete: inventory.inventoryComplete, trust: TRUST[inventory.provenance.trust], quantity: 0, regular: 0, spare: 0, unknown: 0, categories: new Set(), evidence: [], sourceId: inventory.provenance.sourceId, sourceHash: inventory.provenance.sha256 };
          perSource.set(key, observation);
        }
        observation.quantity += item.quantity;
        if (item.isSpare === false) observation.regular += item.quantity;
        else if (item.isSpare === true) observation.spare += item.quantity;
        else observation.unknown += item.quantity;
        if (item.category !== null) observation.categories.add(item.category);
        observation.evidence.push(...item.evidence);
      }
      for (const [identityKey, observation] of perSource) {
        const key = `${inventory.setNumber}:${identityKey}`;
        const previous = bySetAndIdentity.get(key);
        if (!previous) bySetAndIdentity.set(key, observation);
        else {
          if (previous.quantity !== observation.quantity || previous.regular !== observation.regular || previous.spare !== observation.spare || previous.unknown !== observation.unknown) conflictingObservations++;
          const score = (item: Observation): [number, number, number] => [item.trust, Number(item.complete), item.quantity];
          const a = score(observation), b = score(previous);
          const better = a[0] > b[0] || a[0] === b[0] && (a[1] > b[1] || a[1] === b[1] && (a[2] > b[2] || a[2] === b[2] && sortText(observation.sourceHash, previous.sourceHash) < 0));
          if (better) bySetAndIdentity.set(key, observation);
        }
      }
    }
    const byIdentity = new Map<string, MinedPartFrequency>();
    for (const observation of bySetAndIdentity.values()) {
      const key = `${observation.identity.system}:${observation.identity.id}`;
      let frequency = byIdentity.get(key);
      if (!frequency) {
        frequency = { rank: 0, identity: observation.identity, distinctSetCount: 0, setNumbers: [], observedQuantity: 0, knownNonSpareQuantity: 0, knownSpareQuantity: 0, spareUnknownQuantity: 0, categoryPriority: 0, categories: [], sourceIds: [], evidence: [] };
        byIdentity.set(key, frequency);
      }
      frequency.setNumbers.push(observation.setNumber);
      frequency.observedQuantity += observation.quantity;
      frequency.knownNonSpareQuantity += observation.regular;
      frequency.knownSpareQuantity += observation.spare;
      frequency.spareUnknownQuantity += observation.unknown;
      frequency.categories.push(...observation.categories);
      frequency.sourceIds.push(observation.sourceId);
      frequency.evidence.push(...observation.evidence);
    }
    for (const frequency of byIdentity.values()) {
      frequency.setNumbers = uniqueSorted(frequency.setNumbers);
      frequency.distinctSetCount = frequency.setNumbers.length;
      frequency.categories = uniqueSorted(frequency.categories);
      frequency.categoryPriority = Math.max(0, ...frequency.categories.map(category => Object.hasOwn(priorities, category) ? priorities[category] : 0));
      frequency.sourceIds = uniqueSorted(frequency.sourceIds);
    }
    return [...byIdentity.values()].sort((a, b) => b.distinctSetCount - a.distinctSetCount || b.knownNonSpareQuantity - a.knownNonSpareQuantity || b.categoryPriority - a.categoryPriority || b.observedQuantity - a.observedQuantity || sortText(`${a.identity.system}:${a.identity.id}`, `${b.identity.system}:${b.identity.id}`))
      .slice(0, limit).map((frequency, index) => ({ ...frequency, rank: index + 1 }));
  }
  const designRanking = rank('design'), partRanking = rank('part'), elementRanking = rank('element');
  const warnings: string[] = [];
  if (!observedSetNumbers.length) warnings.push('No source-backed inventory rows are available; all frequency rankings are empty.');
  if (rows.some(row => row.isSpare === null)) warnings.push('Unknown spare status is reported separately and excluded from known non-spare quantities.');
  if (rows.some(row => !row.designId)) warnings.push('Element-only observations do not establish a design-ID or LDraw mapping and cannot enter design-part ranking.');
  if (observed.some(inventory => !inventory.inventoryComplete)) warnings.push('Some source inventories are incomplete; frequencies describe available observations, not full-set coverage.');
  if (conflictingObservations) warnings.push('Overlapping sources disagree on quantities; the documented per-set source selection policy was applied. Sources were not added together.');
  if (observed.some(inventory => inventory.provenance.trust === 'user-reported')) warnings.push('User-reported imports retain their trust label; importing does not verify source authenticity, geometry or connections.');
  return {
    schemaVersion: 1, basis: 'source-backed-observations', quantityPolicy: 'one-observation-per-set-and-identity', selectionPolicy: 'source-trust-then-complete-then-largest-observation',
    rankingCriteria: ['distinctSetCount', 'knownNonSpareQuantity', 'categoryPriority', 'observedQuantity', 'identity'], expectedSetNumbers, observedSetNumbers, completeSetNumbers,
    missingSetNumbers: expectedSetNumbers.filter(set => !observedSetNumbers.includes(set)), actualSetDenominator: observedSetNumbers.length, expectedSetDenominator: expectedSetNumbers.length || null,
    uniqueSourceDocuments: documents.length, observedRowCount: rows.length, designMappedRowCount: rows.filter(row => row.designId !== null).length, elementObservedRowCount: rows.filter(row => row.elementId !== null).length,
    designRanking, partRanking, elementRanking, warnings,
  };
}
