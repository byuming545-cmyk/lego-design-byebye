export type MappingTrust = 'source-observed' | 'user-reported';
/** Status of the complete Element → catalogue identity → exact LDraw identity chain. */
export type ElementMappingStatus = 'VERIFIED' | 'PROBABLE_BUT_UNVERIFIED' | 'CONFLICT' | 'UNRESOLVED';
export type MappingStatusCounts = Record<ElementMappingStatus, number>;
export type MappingIdentitySystem = 'rebrickable' | 'lego-design';
export interface MappingSourceFingerprint {
  mappingPolicyVersion: string;
  manifestSha256: string;
  elementSnapshotSha256: string;
  reviewSnapshotSha256: string | null;
}
export interface ElementMappingSource {
  id: string;
  url: string;
  revision: string;
  sha256: string;
  trust: MappingTrust;
  dataLicense: string;
  independentlyVerifiedOfficial: false;
}
export interface ElementMappingRecord {
  elementId: string;
  partId: string;
  designId: string | null;
  color: { id: string; name: string; rgb: string; system: 'rebrickable' };
  partName: string;
  category: string;
  material: string;
  rawElementRow: { element_id: number; part_num: string; color_id: number; design_id: number | null };
}
/** Only explicit cross-reference declarations can bind external catalogues to geometry. */
export interface LDrawCrossReference {
  /** Source identity in partIdSystem; a LEGO design must never be keyed as Rebrickable. */
  partId: string;
  partIdSystem: MappingIdentitySystem;
  ldrawPartId: string;
  method: 'explicit-rebrickable-keyword' | 'explicit-cross-reference-table';
  source: { url: string; revision: string; sha256: string; line?: number; rawText: string };
  /** Missing review retains the declaration as a candidate, never a geometry permission. */
  identityReview?: {
    status: 'VERIFIED' | 'PROBABLE_BUT_UNVERIFIED';
    scope: 'exact-part-and-variant' | 'catalog-conversion-candidate';
    /** Admission is limited to reviewed colour/material-specific elements, never every shared part key. */
    elementIds: string[];
    checks: Record<'printedDecoration' | 'moldRevision' | 'assemblyComponent' | 'materialVariant' | 'colorSpecificElement' | 'alternateDesignOrReplacement', { result: 'matched' | 'not-applicable' | 'unresolved'; evidence: string }>;
    reasons: string[];
  };
}
export interface MappingEvidence {
  stage: 'element-to-external-catalogue' | 'external-catalogue-to-ldraw';
  identitySystem: 'lego-element' | MappingIdentitySystem;
  identityId: string;
  candidateLDrawPartId: string | null;
  source: { url: string; revision: string; sha256: string; line?: number; rawText?: string };
  reasons: string[];
}
/** Audited candidates retain the exact element, design, external part and source namespaces. */
export interface LDrawMappingReview {
  elementId: string;
  designId: string | null;
  rebrickablePartId: string;
  mappingStatus: Exclude<ElementMappingStatus, 'VERIFIED'>;
  reasonCodes: string[];
  reasons: string[];
  candidates: Array<{
    ldrawPartId: string;
    sourceIdentity: { system: MappingIdentitySystem; id: string };
    source: LDrawCrossReference['source'];
    inPinnedLibrary: boolean;
    context: { section: string; sectionLine: number; precedingComments: Array<{ line: number; text: string }>; followingTransformation: { line: number; ldrawFile: string; rawText: string } | null };
  }>;
}
export interface ElementMappingResult {
  elementId: string;
  status: 'mapped' | 'unresolved' | 'conflict';
  verificationStatus: 'source-observed' | 'user-reported' | 'unresolved' | 'conflict';
  independentlyVerifiedOfficial: false;
  partId: string | null;
  partIdSystem: 'rebrickable' | null;
  designId: string | null;
  color: ElementMappingRecord['color'] | null;
  partName: string | null;
  category: string | null;
  material: string | null;
  ldrawPartId: string | null;
  ldrawCrossReference: LDrawCrossReference | null;
  source: ElementMappingSource | null;
  rawElementRow: ElementMappingRecord['rawElementRow'] | null;
  mappingStatus: ElementMappingStatus;
  geometryPipelineAllowed: boolean;
  ldrawCandidatePartIds: string[];
  evidence: MappingEvidence[];
  reasons: string[];
}
export interface RecoveryPartState {
  geometryReady: boolean;
  connectionReady: boolean;
  collisionReady?: boolean;
  assemblyVerified: boolean;
  generatable: boolean;
  blockedReasons?: string[];
}
export type RecoveryPartStateLookup = (ldrawPartId: string) => RecoveryPartState | undefined;
export interface RecoveryInventoryLike {
  id?: string;
  documentId?: string;
  setNumber: string;
  items?: readonly { elementId: string | null; quantity: number }[];
  rows?: readonly { elementId: string | null; quantity: number }[];
}
export interface RecoveryDocumentLike {
  id: string;
  fileName: string;
  status: string;
  setNumber: string | null;
  appendixPages?: number[];
}
export type RecoveryCategory = 'mapping' | 'geometry' | 'connection' | 'collision' | 'composite-part' | 'wheel-system-special-case' | 'flexible-unsupported' | 'assembly' | 'generator';
