import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ElementMappingRecord, ElementMappingResult, ElementMappingSource, LDrawCrossReference, LDrawMappingReview, MappingEvidence, MappingIdentitySystem, MappingSourceFingerprint } from './types.js';
import { countMappingStatuses, MAPPING_REVIEW_VERSION, parseLDrawMappingReviewSnapshot } from './review.js';

const MAPPING_BUNDLE_ROOT = fileURLToPath(new URL('../../../data/parts-foundation/mappings/', import.meta.url));
const text = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || !value.length || value.length > 2000) throw new Error(`Invalid mapping ${name}`);
  return value;
};
const integer = (value: unknown, name: string): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`Invalid mapping ${name}`);
  return Number(value);
};
const object = (value: unknown): Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Mapping record must be an object');
  return value as Record<string, unknown>;
};
function indexed(values: unknown, key: string): Map<unknown, Record<string, unknown>> {
  if (!Array.isArray(values) || values.length > 10_000) throw new Error('Mapping table is invalid');
  const result = new Map<unknown, Record<string, unknown>>();
  for (const value of values) {
    const row = object(value);
    if (result.has(row[key])) throw new Error(`Conflicting mapping table key: ${key}`);
    result.set(row[key], row);
  }
  return result;
}

/** Normalize explicit table joins, preserving external part and LEGO design identities. */
export function parseElementMappingSnapshot(payload: unknown): ElementMappingRecord[] {
  const root = object(payload);
  if (root.schemaVersion !== 1) throw new Error('Mapping snapshot version unsupported');
  const tables = object(root.tables);
  const elements = indexed(tables.elements, 'element_id');
  const parts = indexed(tables.parts, 'part_num');
  const colors = indexed(tables.colors, 'id');
  const categories = indexed(tables.part_categories, 'id');
  const records: ElementMappingRecord[] = [];
  for (const row of elements.values()) {
    const elementId = String(integer(row.element_id, 'element_id'));
    const partId = text(row.part_num, 'part_num');
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(partId)) throw new Error('Invalid external part identifier');
    const colorId = integer(row.color_id, 'color_id');
    const designId = row.design_id === null ? null : String(integer(row.design_id, 'design_id'));
    const part = parts.get(partId), color = colors.get(colorId);
    if (!part || !color) throw new Error('Mapping table foreign key is missing');
    const category = categories.get(part.part_cat_id);
    if (!category) throw new Error('Mapping category foreign key is missing');
    const rgb = text(color.rgb, 'color.rgb');
    if (!/^[A-Fa-f0-9]{6}$/.test(rgb)) throw new Error('Invalid source color RGB');
    records.push({
      elementId, partId, designId,
      color: { system: 'rebrickable', id: String(colorId), name: text(color.name, 'color.name'), rgb: rgb.toUpperCase() },
      partName: text(part.name, 'part.name'), category: text(category.name, 'category.name'), material: text(part.part_material, 'part.material'),
      rawElementRow: { element_id: Number(elementId), part_num: partId, color_id: colorId, design_id: designId === null ? null : Number(designId) },
    });
  }
  return records;
}

/** Mapping evidence never certifies geometry, assembly, colours in the PDF, or spare flags. */
export class ElementDesignMapper {
  private readonly records = new Map<string, ElementMappingRecord[]>();
  private readonly crossReferences = new Map<string, LDrawCrossReference[]>();
  private readonly reviews = new Map<string, LDrawMappingReview>();
  private readonly bundleFingerprint?: MappingSourceFingerprint;
  readonly source: ElementMappingSource;
  constructor(records: readonly ElementMappingRecord[], source: ElementMappingSource, crossReferences: readonly LDrawCrossReference[] = [], reviews: readonly LDrawMappingReview[] = [], bundleFingerprint?: MappingSourceFingerprint) {
    if (!/^[a-f0-9]{64}$/.test(source.sha256) || !/^[a-f0-9]{40}$/.test(source.revision) || !['source-observed', 'user-reported'].includes(source.trust)) throw new Error('Mapping source integrity metadata is invalid');
    this.source = Object.freeze(structuredClone({ ...source, independentlyVerifiedOfficial: false as const }));
    this.bundleFingerprint = bundleFingerprint ? Object.freeze(structuredClone(bundleFingerprint)) : undefined;
    for (const record of records) this.records.set(record.elementId, [...(this.records.get(record.elementId) ?? []), structuredClone(record)]);
    for (const reference of crossReferences) {
      if (!['rebrickable', 'lego-design'].includes(reference.partIdSystem) || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(reference.partId) || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(reference.ldrawPartId) || !['explicit-rebrickable-keyword', 'explicit-cross-reference-table'].includes(reference.method) || !/^[a-f0-9]{64}$/.test(reference.source.sha256) || !reference.source.rawText || !/^https:\/\//.test(reference.source.url) || !/^[a-f0-9]{40}$/.test(reference.source.revision)) throw new Error('LDraw cross-reference requires explicit namespaced source evidence');
      const key = this.referenceKey(reference.partIdSystem, reference.partId);
      this.crossReferences.set(key, [...(this.crossReferences.get(key) ?? []), structuredClone(reference)]);
    }
    for (const review of parseLDrawMappingReviewSnapshot({ schemaVersion: 1, reviewVersion: MAPPING_REVIEW_VERSION, entries: reviews })) this.reviews.set(review.elementId, review);
  }
  private referenceKey(system: MappingIdentitySystem, id: string) { return `${system}:${id}`; }
  /** Bundled source bytes are captured by the same factory load that produced these decisions. */
  getSourceFingerprint(): MappingSourceFingerprint | undefined { return this.bundleFingerprint ? structuredClone(this.bundleFingerprint) : undefined; }
  private isVerifiedReference(reference: LDrawCrossReference, row: ElementMappingRecord): boolean {
    const review = reference.identityReview;
    const names = ['printedDecoration', 'moldRevision', 'assemblyComponent', 'materialVariant', 'colorSpecificElement', 'alternateDesignOrReplacement'] as const;
    return this.source.trust === 'source-observed' && review?.status === 'VERIFIED' && review.scope === 'exact-part-and-variant' &&
      Array.isArray(review.elementIds) && review.elementIds.includes(row.elementId) && review.elementIds.every(id => /^\d{1,12}$/.test(id)) &&
      names.every(name => ['matched', 'not-applicable'].includes(review.checks?.[name]?.result) && typeof review.checks?.[name]?.evidence === 'string' && review.checks[name].evidence.trim().length > 0);
  }
  resolve(elementId: string): ElementMappingResult {
    const base: ElementMappingResult = {
      elementId, status: 'unresolved', verificationStatus: 'unresolved', independentlyVerifiedOfficial: false,
      partId: null, partIdSystem: null, designId: null, color: null, partName: null, category: null, material: null,
      ldrawPartId: null, ldrawCrossReference: null, source: null, rawElementRow: null,
      mappingStatus: 'UNRESOLVED', geometryPipelineAllowed: false, ldrawCandidatePartIds: [], evidence: [], reasons: [],
    };
    if (!/^\d{1,12}$/.test(elementId)) return { ...base, reasons: ['invalid-element-id'] };
    const rows = this.records.get(elementId);
    if (!rows?.length) return { ...base, reasons: ['element-not-in-reviewed-mapping-source'] };
    const distinct = new Map(rows.map(row => [JSON.stringify([row.partId, row.designId, row.color]), row]));
    if (distinct.size !== 1) return { ...base, status: 'conflict', verificationStatus: 'conflict', mappingStatus: 'CONFLICT', source: structuredClone(this.source), reasons: ['conflicting-source-element-mappings'] };
    const row = distinct.values().next().value!;
    const references = [...(this.crossReferences.get(this.referenceKey('rebrickable', row.partId)) ?? []), ...(row.designId ? this.crossReferences.get(this.referenceKey('lego-design', row.designId)) ?? [] : [])];
    const review = this.reviews.get(elementId);
    const reviewMatches = !review || review.rebrickablePartId === row.partId && review.designId === row.designId && review.candidates.every(candidate => candidate.sourceIdentity.id === (candidate.sourceIdentity.system === 'lego-design' ? row.designId : row.partId));
    const candidates = reviewMatches ? review?.candidates ?? [] : [];
    const targets = new Set([...references.map(reference => reference.ldrawPartId), ...candidates.map(candidate => candidate.ldrawPartId)]);
    const crossReference = targets.size === 1 ? references.find(reference => this.isVerifiedReference(reference, row)) ?? null : null;
    const mappingStatus = !reviewMatches || targets.size > 1 || review?.mappingStatus === 'CONFLICT' ? 'CONFLICT' : crossReference ? 'VERIFIED' : targets.size ? 'PROBABLE_BUT_UNVERIFIED' : 'UNRESOLVED';
    const evidence: MappingEvidence[] = [
      { stage: 'element-to-external-catalogue', identitySystem: 'lego-element', identityId: elementId, candidateLDrawPartId: null, source: { url: this.source.url, revision: this.source.revision, sha256: this.source.sha256, rawText: JSON.stringify(row.rawElementRow) }, reasons: [`${this.source.trust}-external-identity; not independent official verification`] },
      ...references.map(reference => ({ stage: 'external-catalogue-to-ldraw' as const, identitySystem: reference.partIdSystem, identityId: reference.partId, candidateLDrawPartId: reference.ldrawPartId, source: structuredClone(reference.source), reasons: reference.identityReview?.reasons ?? ['exact-variant-review-missing'] })),
      ...candidates.map(candidate => ({ stage: 'external-catalogue-to-ldraw' as const, identitySystem: candidate.sourceIdentity.system, identityId: candidate.sourceIdentity.id, candidateLDrawPartId: candidate.ldrawPartId, source: structuredClone(candidate.source), reasons: review!.reasonCodes })),
    ];
    const verified = mappingStatus === 'VERIFIED';
    return {
      ...base, ...structuredClone(row), status: 'mapped', verificationStatus: this.source.trust,
      partIdSystem: 'rebrickable', source: structuredClone(this.source),
      ldrawPartId: verified ? crossReference!.ldrawPartId : null, ldrawCrossReference: verified ? structuredClone(crossReference) : null,
      mappingStatus, geometryPipelineAllowed: verified, ldrawCandidatePartIds: [...targets].sort(), evidence,
      reasons: verified ? [] : [...new Set(['ldraw-cross-reference-not-verified', ...(!reviewMatches ? ['mapping-review-identity-chain-mismatch'] : []), ...(targets.size > 1 ? ['conflicting-ldraw-cross-references'] : []), ...(review?.reasonCodes ?? []), ...(targets.size === 1 && !crossReference ? ['exact-variant-identity-not-verified'] : [])])],
    };
  }
  summary() {
    const mappings = [...this.records.keys()].map(id => this.resolve(id));
    return {
      observedElements: mappings.length, mappedBySource: mappings.filter(row => row.status === 'mapped').length,
      conflicts: mappings.filter(row => row.status === 'conflict').length,
      independentlyVerifiedOfficial: 0,
      resolvedLDraw: mappings.filter(row => row.ldrawPartId !== null).length,
      mappingStatusCounts: countMappingStatuses(mappings), mappingStatusBasis: 'complete-element-to-exact-ldraw-identity-chain',
      verifiedMapping: mappings.filter(row => row.mappingStatus === 'VERIFIED').length,
      probableMapping: mappings.filter(row => row.mappingStatus === 'PROBABLE_BUT_UNVERIFIED').length,
      mappingConflicts: mappings.filter(row => row.mappingStatus === 'CONFLICT').length,
      unresolvedLDrawMapping: mappings.filter(row => row.mappingStatus === 'UNRESOLVED').length,
      externalMappingConflicts: mappings.filter(row => row.status === 'conflict').length,
      ...(this.bundleFingerprint ? { sourceFingerprint: this.getSourceFingerprint() } : {}),
      sourceTrust: this.source.trust,
    };
  }
}

export async function createBundledElementDesignMapper(options: { bundleRoot?: string } = {}): Promise<ElementDesignMapper> {
  const bundleRoot = path.resolve(options.bundleRoot ?? MAPPING_BUNDLE_ROOT);
  const manifestBytes = await readFile(path.join(bundleRoot, 'manifest.json'));
  if (manifestBytes.length > 1024 * 1024) throw new Error('Mapping manifest size limit exceeded');
  const manifest = object(JSON.parse(manifestBytes.toString('utf8')));
  if (manifest.schemaVersion !== 1) throw new Error('Mapping manifest version unsupported');
  const raw = object(manifest.rawSnapshot), source = object(manifest.source);
  const filePath = path.resolve(bundleRoot, text(raw.path, 'snapshot.path'));
  if (!filePath.startsWith(bundleRoot + path.sep)) throw new Error('Mapping source path escapes its bundle');
  const bytes = await readFile(filePath);
  if (bytes.length > 6 * 1024 * 1024 || bytes.length !== raw.bytes || createHash('sha256').update(bytes).digest('hex') !== raw.sha256) throw new Error('Mapping source snapshot integrity failed');
  const records = parseElementMappingSnapshot(JSON.parse(bytes.toString('utf8')));
  const references = manifest.ldrawCrossReferences;
  if (!Array.isArray(references)) throw new Error('Mapping cross-reference manifest invalid');
  let reviews: LDrawMappingReview[] = [];
  let reviewSnapshotSha256: string | null = null;
  if (manifest.ldrawMappingReviewSnapshot !== undefined) {
    const descriptor = object(manifest.ldrawMappingReviewSnapshot);
    const reviewPath = path.resolve(bundleRoot, text(descriptor.path, 'review.path'));
    if (!reviewPath.startsWith(bundleRoot + path.sep)) throw new Error('Mapping review path escapes its bundle');
    const reviewBytes = await readFile(reviewPath);
    if (reviewBytes.length > 8 * 1024 * 1024 || reviewBytes.length !== descriptor.bytes || createHash('sha256').update(reviewBytes).digest('hex') !== descriptor.sha256) throw new Error('Mapping review snapshot integrity failed');
    reviewSnapshotSha256 = createHash('sha256').update(reviewBytes).digest('hex');
    reviews = parseLDrawMappingReviewSnapshot(JSON.parse(reviewBytes.toString('utf8')));
    const observed = new Map(records.map(record => [record.elementId, record]));
    if (reviews.length !== observed.size || reviews.some(review => !observed.has(review.elementId))) throw new Error('Mapping review denominator does not match the observed element snapshot');
  }
  return new ElementDesignMapper(records, {
    id: text(source.id, 'source.id'), url: text(source.url, 'source.url'), revision: text(source.revision, 'source.revision'),
    sha256: String(raw.sha256), trust: 'source-observed', dataLicense: text(source.dataLicense, 'source.dataLicense'), independentlyVerifiedOfficial: false,
  }, references as LDrawCrossReference[], reviews, {
    mappingPolicyVersion: MAPPING_REVIEW_VERSION,
    manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'),
    elementSnapshotSha256: createHash('sha256').update(bytes).digest('hex'), reviewSnapshotSha256,
  });
}
