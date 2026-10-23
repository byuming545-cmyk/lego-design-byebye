import type { ElementDesignMapper } from './mapper.js';
import type { ElementMappingResult, RecoveryCategory, RecoveryDocumentLike, RecoveryInventoryLike, RecoveryPartState, RecoveryPartStateLookup } from './types.js';

const EXPECTED_REFERENCE_SETS = ['77263', '76924', '77239', '77238', '77254', '77257'];
const setKey = (value: string) => value.replace(/-1$/, '');
const inventoryRows = (inventory: RecoveryInventoryLike) => inventory.items ?? inventory.rows ?? [];
const documentKey = (inventory: RecoveryInventoryLike) => inventory.documentId ?? inventory.id?.replace(/^pdf-/, '') ?? null;
const percent = (count: number, total: number) => total ? Number((100 * count / total).toFixed(2)) : null;
function resolveState(mapping: ElementMappingResult, lookup?: RecoveryPartStateLookup): RecoveryPartState {
  const result = mapping.ldrawPartId ? lookup?.(mapping.ldrawPartId) : undefined;
  if (!result) return { geometryReady: false, connectionReady: false, collisionReady: false, assemblyVerified: false, generatable: false };
  // A caller cannot promote a failed prerequisite by claiming only the final flag.
  const geometryReady = result.geometryReady;
  const connectionReady = geometryReady && result.connectionReady;
  const collisionReady = geometryReady && result.collisionReady === true;
  const assemblyVerified = geometryReady && connectionReady && collisionReady && result.assemblyVerified;
  return { ...result, geometryReady, connectionReady, collisionReady, assemblyVerified, generatable: assemblyVerified && result.generatable };
}
function observations(inventories: readonly RecoveryInventoryLike[]) {
  const result = new Map<string, { setNumbers: Set<string>; documentIds: Set<string>; observedQuantity: number }>();
  for (const inventory of inventories) for (const row of inventoryRows(inventory)) {
    if (!row.elementId) continue;
    const entry = result.get(row.elementId) ?? { setNumbers: new Set<string>(), documentIds: new Set<string>(), observedQuantity: 0 };
    entry.setNumbers.add(setKey(inventory.setNumber));
    const id = documentKey(inventory);
    if (id) entry.documentIds.add(id);
    entry.observedQuantity += row.quantity;
    result.set(row.elementId, entry);
  }
  return result;
}
function recoveryReasons(mapping: ElementMappingResult, state: RecoveryPartState): { category: RecoveryCategory | null; reasonCodes: string[]; reasons: string[]; specialCategories: RecoveryCategory[] } {
  const specialCategories: RecoveryCategory[] = [];
  if (mapping.category === 'Wheels and Tyres') specialCategories.push('wheel-system-special-case');
  if (['Cloth', 'Flexible Plastic', 'Foam'].includes(mapping.material ?? '')) specialCategories.push('flexible-unsupported');
  // Complete-set/composite labels are explicit source descriptions, never a guessed shape.
  if (/\[(?:Complete Set|Assembly)\]/i.test(mapping.partName ?? '')) specialCategories.push('composite-part');
  if (mapping.status !== 'mapped') return { category: 'mapping', reasonCodes: mapping.reasons, reasons: ['Element ID 尚无唯一来源映射，保留 unresolved。'], specialCategories };
  if (!mapping.ldrawPartId) return { category: 'mapping', reasonCodes: [...mapping.reasons], reasons: ['已取得 Element → Rebrickable Part / LEGO Design / 颜色的明确表记录；尚无核定的 LDraw 跨编号映射，禁止按同数字或相似图片替代。'], specialCategories };
  if (!state.geometryReady) return { category: 'geometry', reasonCodes: ['native-geometry-not-ready', ...(state.blockedReasons ?? [])], reasons: ['跨编号已明确，但对应原生几何缺失或未通过源校验。'], specialCategories };
  if (!state.connectionReady) return { category: 'connection', reasonCodes: ['connection-metadata-not-ready', ...(state.blockedReasons ?? [])], reasons: ['原生几何已就绪，连接元数据仍缺失或部分未解析。'], specialCategories };
  if (!state.collisionReady) return { category: 'collision', reasonCodes: ['connection-aware-collision-not-ready', ...(state.blockedReasons ?? [])], reasons: ['已有几何与连接，但未通过适用于该零件的碰撞/插入净空验证。'], specialCategories };
  if (!state.assemblyVerified) {
    const category = specialCategories[0] ?? 'assembly';
    return { category, reasonCodes: ['assembly-tests-not-passed', ...(state.blockedReasons ?? [])], reasons: ['逐件装配验证尚未通过。特殊轮系、组件或柔性件需要对应夹具和测试。'], specialCategories };
  }
  if (!state.generatable) return { category: 'generator', reasonCodes: ['batch-generator-smoke-not-passed', ...(state.blockedReasons ?? [])], reasons: ['装配验证已通过，尚未通过对应批次的生成器 smoke test。'], specialCategories };
  return { category: null, reasonCodes: [], reasons: [], specialCategories };
}

/** Every observed element receives a final, reasoned recovery outcome. */
export function buildFailedPartRecoveryQueue(inventories: readonly RecoveryInventoryLike[], mapper: ElementDesignMapper, lookup?: RecoveryPartStateLookup) {
  const observed = observations(inventories);
  const entries = [...observed].map(([elementId, observation]) => {
    const mapping = mapper.resolve(elementId);
    const state = resolveState(mapping, lookup);
    const reasons = recoveryReasons(mapping, state);
    return {
      elementId, mapping, ...state,
      status: state.generatable ? 'generatable' as const : 'blocked' as const,
      mappedBySource: mapping.status === 'mapped', independentlyVerifiedOfficial: false,
      blockedCategory: reasons.category, reasonCodes: reasons.reasonCodes, reasons: reasons.reasons, specialCategories: reasons.specialCategories,
      setNumbers: [...observation.setNumbers].sort(), documentIds: [...observation.documentIds].sort(),
      distinctObservedSets: observation.setNumbers.size, observedQuantity: observation.observedQuantity,
      quantityBasis: 'printed observations; spare/non-spare unresolved',
    };
  }).sort((a, b) => b.distinctObservedSets - a.distinctObservedSets || b.observedQuantity - a.observedQuantity || a.elementId.localeCompare(b.elementId));
  const blockedReasons: Partial<Record<RecoveryCategory, number>> = {};
  for (const entry of entries) if (entry.blockedCategory) blockedReasons[entry.blockedCategory] = (blockedReasons[entry.blockedCategory] ?? 0) + 1;
  return {
    schemaVersion: 1,
    scope: 'all-unique-observed-instruction-element-ids',
    counts: {
      total: entries.length, mappedBySource: entries.filter(entry => entry.mappedBySource).length,
      mappingUnresolved: entries.filter(entry => !entry.mappedBySource).length,
      independentlyVerifiedOfficial: 0,
      resolvedLDraw: entries.filter(entry => entry.mapping.ldrawPartId !== null).length,
      assemblyVerified: entries.filter(entry => entry.assemblyVerified).length,
      generatable: entries.filter(entry => entry.generatable).length,
      blocked: entries.filter(entry => entry.status === 'blocked').length,
      recoveredToMapping: entries.filter(entry => entry.mappedBySource).length,
      recoveredToGeneratable: entries.filter(entry => entry.generatable).length,
    },
    blockedReasons, entries,
    limitations: [
      '531 observed element IDs are not 531 distinct design parts.',
      'Source-observed mirror mappings are not independent official/API verification.',
      'Mapping recovery and assembly/generator recovery are counted separately.',
      'A numeric match or a similar part image is insufficient LDraw identity evidence.',
    ],
  };
}

function coverageFor(inventories: readonly RecoveryInventoryLike[], mapper: ElementDesignMapper, lookup?: RecoveryPartStateLookup) {
  const ids = [...observations(inventories).keys()];
  const rows = ids.map(id => { const mapping = mapper.resolve(id); return { mapping, state: resolveState(mapping, lookup) }; });
  const mapped = rows.filter(row => row.mapping.status === 'mapped').length;
  const counts = {
    uniqueObservedElements: ids.length, mapped, independentlyVerifiedOfficial: 0,
    resolvedLDraw: rows.filter(row => row.mapping.ldrawPartId !== null).length,
    geometryReady: rows.filter(row => row.state.geometryReady).length,
    connectionReady: rows.filter(row => row.state.connectionReady).length,
    collisionReady: rows.filter(row => row.state.collisionReady).length,
    assemblyVerified: rows.filter(row => row.state.assemblyVerified).length,
    generatable: rows.filter(row => row.state.generatable).length,
    mappingUnresolved: ids.length - mapped,
    unresolved: rows.filter(row => !row.state.generatable).length,
  };
  return {
    counts,
    percentages: Object.fromEntries(Object.entries(counts).filter(([key]) => key !== 'uniqueObservedElements').map(([key, value]) => [key, percent(value, ids.length)])),
    denominator: ids.length,
    denominatorBasis: 'unique observed element IDs in available appendices; not whole-set parts or design IDs',
    inventoryComplete: false,
  };
}

/** Missing appendices have unknown denominators; no 0/0 or 100% success is invented. */
export function buildInstructionCoverage(documents: readonly RecoveryDocumentLike[], inventories: readonly RecoveryInventoryLike[], mapper: ElementDesignMapper, lookup?: RecoveryPartStateLookup, options: { expectedSetNumbers?: readonly string[] } = {}) {
  const documentReports = documents.map(document => {
    const local = inventories.filter(inventory => documentKey(inventory) === document.id);
    return {
      documentId: document.id, fileName: document.fileName, setNumber: document.setNumber,
      sourceStatus: document.status,
      coverageStatus: document.status !== 'ready' ? document.status : local.length ? 'observed-appendix' : 'no-inventory-appendix',
      appendixPages: document.appendixPages ?? [],
      ...coverageFor(local, mapper, lookup),
    };
  });
  const sets = [...new Set([...(options.expectedSetNumbers ?? EXPECTED_REFERENCE_SETS), ...documents.flatMap(document => document.setNumber ? [setKey(document.setNumber)] : [])])];
  const setReports = sets.map(setNumber => {
    const local = inventories.filter(inventory => setKey(inventory.setNumber) === setNumber);
    return {
      setNumber, documentIds: documents.filter(document => document.setNumber && setKey(document.setNumber) === setNumber).map(document => document.id),
      coverageStatus: local.length ? 'observed-appendix' : 'no-observed-inventory',
      ...coverageFor(local, mapper, lookup),
    };
  });
  return {
    schemaVersion: 1, sourceTrust: mapper.source.trust,
    scope: 'observed-elements-only; no claim of complete official inventory',
    overall: coverageFor(inventories, mapper, lookup), documents: documentReports, sets: setReports,
    limitations: [
      'Zero observed rows in an unreadable document or absent appendix means unknown coverage; percentages stay null.',
      'A mapped element can remain unresolved for assembly until a source-backed LDraw cross-reference and all engine checks pass.',
      'The two 77238 books are one set for set-level counting.',
    ],
  };
}
