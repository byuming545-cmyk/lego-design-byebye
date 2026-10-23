export type LDrawVector = [number, number, number];

export interface LDrawSourceFile {
  path: string;
  sha256: string;
  bytes: number;
  license: string | null;
  author: string | null;
  sourceUrl: string;
}

export interface LDrawResolver {
  revision: string;
  sourceRoot: string;
  /** Canonical paths relative to the library, e.g. parts/3001.dat or p/stud.dat. */
  readText(path: string): Promise<string | undefined>;
  expectedHashes?: Readonly<Record<string, string>>;
  paths?: readonly string[];
}

export interface LDrawIssue {
  code: string;
  message: string;
  severity: 'error' | 'warning';
  file?: string;
  line?: number;
}

export interface LDrawMesh {
  units: 'LDU';
  coordinateSystem: 'ldraw-native';
  positions: LDrawVector[];
  indices: number[];
  /** LDraw colour tokens; 16 remains the caller's current colour. */
  triangleColors: number[];
  doubleSided: boolean[];
  /** Type 2 lines and type 5 conditional lines are edges, never solid faces. */
  edges: Array<{ vertices: [LDrawVector, LDrawVector]; color: number }>;
  conditionalEdges: Array<{ vertices: [LDrawVector, LDrawVector]; controls: [LDrawVector, LDrawVector]; color: number }>;
}

export interface LDrawBounds {
  min: LDrawVector;
  max: LDrawVector;
}

export interface LDrawPartResult {
  status: 'geometryReady' | 'failed';
  partId: string;
  name: string | null;
  source: {
    library: 'LDraw';
    revision: string;
    rootFile: string;
    files: LDrawSourceFile[];
    licenseStatus: 'complete' | 'unknown';
    integrity: 'verified' | 'not-manifested';
  };
  mesh?: LDrawMesh;
  bounds?: LDrawBounds;
  collision?: {
    kind: 'aabb';
    bounds: LDrawBounds;
    derivedFrom: 'native-mesh';
    /** A whole-part AABB cannot prove clearance for studs, clips, pins or tyres. */
    cavitiesResolved: false;
  };
  issues: LDrawIssue[];
}

export interface LDrawImportLimits {
  maxDepth: number;
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxReferences: number;
  maxTriangles: number;
  maxEdges: number;
}

export interface BundledLDrawManifest {
  schemaVersion: number;
  library: 'LDraw';
  revision: string;
  sourceRoot: string;
  archive: { sourceUrl: string; sha256: string };
  roots: Array<{ partId: string; path: string; name: string; selectionBasis: string }>;
  files: LDrawSourceFile[];
}
