/** Connection information is imported from the named source, never inferred from a mesh. */
export type ConnectionVector = [number, number, number];
export type ConnectionMatrix = [number, number, number, number, number, number, number, number, number];

export interface ConnectionSourceFile {
  library: 'LDraw' | 'LDCadShadowLibrary';
  path: string;
  revision: string;
  sha256: string;
  license: string;
  sourceUrl: string;
}

export interface ConnectionTransformEvidence {
  file: string;
  line: number;
  directive: string;
  position: ConnectionVector;
  matrix: ConnectionMatrix;
}

export interface ImportedConnectionPoint {
  id: string;
  sourceId: string | null;
  kind: 'cylinder' | 'clip' | 'generic';
  /** A source ID/profile-based label, not a new compatibility rule. */
  family: 'stud' | 'antiStud' | 'axle' | 'axleHole' | 'pin' | 'pinHole' | 'bar' | 'clip' | 'wheelMount' | 'cylinder' | 'generic';
  gender: 'M' | 'F' | null;
  position: ConnectionVector;
  direction: ConnectionVector;
  /** Full transformed source frame. It can contain inherited scaling. */
  orientation: ConnectionMatrix;
  units: 'LDU';
  sections: { profile: string; radius: number; length: number }[];
  /** Dimensions above stay in the original directive's frame. */
  dimensionsFrame: 'source-local';
  dimensionsResolved: boolean;
  radius: number | null;
  length: number | null;
  group: string | null;
  properties: Record<string, string>;
  source: ConnectionSourceFile & {
    line: number;
    raw: string;
    transforms: ConnectionTransformEvidence[];
  };
  physicalVerified: false;
}

export interface ConnectionImportIssue {
  code: 'invalid-path' | 'missing-geometry' | 'missing-shadow-include' | 'invalid-directive' | 'unsupported-directive' | 'unsupported-scaling' | 'cycle' | 'resource-limit' | 'no-connections' | 'integrity-failure';
  file: string;
  line?: number;
  message: string;
  /** Exact imported context, when the diagnostic belongs to a Shadow directive. */
  directive?: string;
  source?: ConnectionSourceFile;
  transforms?: ConnectionTransformEvidence[];
}

export interface DiscardedConnectionIssue extends ConnectionImportIssue {
  affectedConnectionIds: string[];
  discardedBy: { file: string; line: number; directive: string };
  reason: 'source-clear-removed-all-affected-points';
}

export interface ConnectionImportResult {
  partId: string;
  /** ready means parsed supported source syntax; it does not mean physically verified. */
  status: 'ready' | 'partial' | 'missing';
  units: 'LDU';
  coordinateSystem: 'LDraw-native';
  physicalVerified: false;
  points: ImportedConnectionPoint[];
  issues: ConnectionImportIssue[];
  sourceFiles: ConnectionSourceFile[];
  license: 'CC-BY-SA-4.0';
  /** Parser semantics have their own version even when the source bytes are unchanged. */
  parserVersion?: string;
  /** Retained audit evidence; these diagnostics concern source points explicitly cleared later. */
  discardedIssues?: DiscardedConnectionIssue[];
}

export interface ConnectionLibrary {
  getGeometryFile(path: string): Promise<string | undefined>;
  getShadowFile(path: string): Promise<string | undefined>;
  geometryRevision?: string;
  geometrySourceRoot?: string;
  shadowRevision?: string;
  shadowSourceRoot?: string;
}

export interface ConnectionImportOptions {
  maxDepth?: number;
  maxPoints?: number;
  maxFiles?: number;
  maxVisits?: number;
}
