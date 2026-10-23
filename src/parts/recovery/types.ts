export type MappingTrust = 'source-observed' | 'user-reported';
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
  partId: string;
  partIdSystem: 'rebrickable';
  ldrawPartId: string;
  method: 'explicit-rebrickable-keyword' | 'explicit-cross-reference-table';
  source: { url: string; revision: string; sha256: string; line?: number; rawText: string };
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
