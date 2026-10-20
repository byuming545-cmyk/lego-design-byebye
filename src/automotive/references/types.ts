/** A source is a research link, never an instruction to fetch or execute it. */
export type ReferenceLicense = 'CC0-1.0' | 'CC-BY-4.0' | 'user-owned' | 'unknown';
export type ReferenceVehicleType = 'luxury-sedan' | 'performance-coupe' | 'sports-car' | 'gt' | 'supercar' | 'unknown';
export interface ReferenceMetadata {
  longitudinalAxis?: 'x' | 'y';
  frontDirection?: 1 | -1;
  source: string;
  modelName: string;
  setNumber?: string;
  author: string;
  license: ReferenceLicense;
  attribution: string;
  importedAt: string;
  /** Explicit importer/user annotation; never inferred from the target generation request. */
  vehicleType?: ReferenceVehicleType;
  featureTags?: string[];
  /** Explicit declaration covers the user's model only; it grants no rights to official models. */
  rightsDeclaration?: { ownsRights: true; statement: string };
}
export type ReferenceMetadataInput = Omit<ReferenceMetadata, 'importedAt'> & { importedAt?: string };
export interface ReferenceVector { x: number; y: number; z: number }
/** Row-major 3×3 native LDraw affine linear component; arbitrary non-singular matrices are retained. */
export type ReferenceMatrix = [number, number, number, number, number, number, number, number, number];
export interface ReferencePlacement {
  fileName: string;
  color: number;
  positionLdu: ReferenceVector;
  matrixLdu: ReferenceMatrix;
  sourceLine: number;
}
export interface ReferencePrimitive { type: 2 | 3 | 4 | 5; color: number; vertices: ReferenceVector[]; sourceLine: number }
export interface ReferenceSubmodel { name: string; placements: ReferencePlacement[]; primitives: ReferencePrimitive[] }
export interface ReferencePart {
  instanceId: string;
  partId: string;
  fileName: string;
  color: number;
  nativeColor: number;
  positionLdu: ReferenceVector;
  matrixLdu: ReferenceMatrix;
  /** C:(x,y,z)→(x,z,-y), then x/y ÷20 studs and z ÷8 plates. */
  position: ReferenceVector;
  /** C M C⁻¹ in isotropic LDU, not anisotropically scaled display units. */
  matrixInternalLdu: ReferenceMatrix;
  hierarchy: string[];
  sourceLine: number;
  resolved: boolean;
}
export interface ReferenceCoverage {
  totalParts: number;
  knownGeometryParts: number;
  geometryRate: number;
  unresolvedPartIds: string[];
}
export interface ReferenceVehicleModel {
  schemaVersion: 1;
  kind: 'model';
  id: string;
  metadata: ReferenceMetadata;
  rootModel: string;
  submodels: ReferenceSubmodel[];
  parts: ReferencePart[];
  coverage: ReferenceCoverage;
  warnings: string[];
}
export interface ReferenceLink { schemaVersion: 1; kind: 'link'; id: string; metadata: ReferenceMetadata }
export type ReferenceLibraryEntry = ReferenceVehicleModel | ReferenceLink;
export interface ReferenceImportLimits { maxBytes: number; maxLines: number; maxSubmodels: number; maxParts: number; maxDepth: number }
export interface Measurement<T = number> {
  value: T | null;
  unit: 'stud' | 'plate' | 'ratio' | 'degree' | 'count';
  confidence: number;
  evidence: string[];
}
export interface ReferenceBounds {
  min: ReferenceVector;
  max: ReferenceVector;
  exact: boolean;
  method: 'catalog-envelope' | 'catalog-and-placement-bounds' | 'placement-bounds';
}
export interface ReferenceConnection {
  id: string;
  partA: string;
  partB: string;
  connectionPointA: string;
  connectionPointB: string;
  connectionType: 'stud' | 'side-stud' | 'wheel-axle' | 'tyre-fit';
}
export interface ReferenceAnalysis {
  referenceId: string;
  metadata: ReferenceMetadata;
  coordinateSystem: string;
  longitudinalAxis: 'x' | 'y';
  frontDirection: 1 | -1 | null;
  bounds: ReferenceBounds | null;
  coverage: ReferenceCoverage;
  overall: { width: Measurement; length: Measurement; height: Measurement; wheelbase: Measurement; frontOverhang: Measurement; rearOverhang: Measurement; groundClearance: Measurement };
  wheels: { diameter: Measurement; width: Measurement; trackWidth: Measurement; axlePositions: Measurement<number[]>; count: number; evidence: string[] };
  cockpit: { start: Measurement; end: Measurement; height: Measurement; roofHeight: Measurement };
  shape: { hoodLength: Measurement; hoodHeight: Measurement; roofline: Measurement<number[]>; rearDeck: Measurement; frontSlope: Measurement; rearSlope: Measurement };
  partUsage: { total: number; mostUsed: { partId: string; quantity: number; category: string | null }[]; curvedParts: number; snotParts: number; brackets: number; wedges: number; wheelArches: number; unknownParts: number };
  connections: { edges: ReferenceConnection[]; assessedParts: number; unassessedParts: number; reinforcementPatterns: Measurement; crossLayerConnections: Measurement; snotConnections: Measurement; wheelMounting: Measurement; roofAttachment: Measurement; frontRearAttachment: Measurement; evidence: string[] };
  warnings: string[];
}
