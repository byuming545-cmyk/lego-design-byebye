import type { ElementMappingStatus, LDrawMappingReview, MappingStatusCounts } from './types.js';

export const MAPPING_REVIEW_VERSION = 'exact-identity-chain-1';
export const MAPPING_STATUSES: readonly ElementMappingStatus[] = ['VERIFIED', 'PROBABLE_BUT_UNVERIFIED', 'CONFLICT', 'UNRESOLVED'];

export function countMappingStatuses(rows: readonly { mappingStatus: ElementMappingStatus }[]): MappingStatusCounts {
  const counts: MappingStatusCounts = { VERIFIED: 0, PROBABLE_BUT_UNVERIFIED: 0, CONFLICT: 0, UNRESOLVED: 0 };
  for (const row of rows) counts[row.mappingStatus]++;
  return counts;
}

/** The review bundle contains evidence candidates; it cannot grant VERIFIED admission. */
export function parseLDrawMappingReviewSnapshot(value: unknown): LDrawMappingReview[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('LDraw mapping review must be an object.');
  const root = value as { schemaVersion?: unknown; reviewVersion?: unknown; entries?: unknown };
  if (root.schemaVersion !== 1 || root.reviewVersion !== MAPPING_REVIEW_VERSION || !Array.isArray(root.entries) || root.entries.length > 10_000) throw new Error('LDraw mapping review schema is invalid.');
  const ids = new Set<string>();
  for (const value of root.entries) {
    const row = value as LDrawMappingReview;
    if (!row || !/^\d{1,12}$/.test(row.elementId) || ids.has(row.elementId) || row.designId !== null && !/^\d{1,12}$/.test(row.designId) || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(row.rebrickablePartId) ||
        !['PROBABLE_BUT_UNVERIFIED', 'CONFLICT', 'UNRESOLVED'].includes(row.mappingStatus) || !Array.isArray(row.reasonCodes) || row.reasonCodes.some(code => typeof code !== 'string') || !Array.isArray(row.reasons) || row.reasons.some(reason => typeof reason !== 'string') || !Array.isArray(row.candidates) || row.candidates.length > 1000) throw new Error('LDraw mapping review identity or decision is invalid.');
    ids.add(row.elementId);
    for (const candidate of row.candidates) {
      if (!candidate || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(candidate.ldrawPartId) || !candidate.sourceIdentity || !['lego-design', 'rebrickable'].includes(candidate.sourceIdentity.system) || typeof candidate.sourceIdentity.id !== 'string' || !candidate.sourceIdentity.id ||
          !candidate.source || !/^[a-f0-9]{64}$/.test(candidate.source.sha256) || !/^[a-f0-9]{40}$/.test(candidate.source.revision) || !/^https:\/\//.test(candidate.source.url) || !Number.isSafeInteger(candidate.source.line) || Number(candidate.source.line) < 1 || typeof candidate.source.rawText !== 'string' || !candidate.source.rawText || typeof candidate.inPinnedLibrary !== 'boolean' ||
          !candidate.context || typeof candidate.context.section !== 'string' || !Number.isSafeInteger(candidate.context.sectionLine) || !Array.isArray(candidate.context.precedingComments)) throw new Error('LDraw mapping review candidate evidence is invalid.');
    }
    const targets = new Set(row.candidates.map(candidate => candidate.ldrawPartId));
    if (row.mappingStatus === 'CONFLICT' && targets.size < 2 || row.mappingStatus === 'PROBABLE_BUT_UNVERIFIED' && targets.size !== 1 || row.mappingStatus === 'UNRESOLVED' && targets.size !== 0) throw new Error('LDraw mapping review decision disagrees with its candidate targets.');
  }
  return structuredClone(root.entries) as LDrawMappingReview[];
}
