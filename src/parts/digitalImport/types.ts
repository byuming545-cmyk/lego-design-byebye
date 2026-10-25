import type { NativeAssemblyPart, AssemblyInterfaceCapability } from '../assembly/types.js';
import type { NativePartAssemblyVerification } from '../assembly/verification.js';
import type { LDrawSourceFile } from '../ldraw/types.js';
import type { ConnectionSourceFile } from '../connections/types.js';

/** An exact native ID is independent of any unresolved Element/Design cross-reference. */
export type DigitalIdentityStatus = 'EXACT_NATIVE_ID' | 'CANDIDATE' | 'CONFLICT' | 'UNRESOLVED';
export interface DigitalImportRequest {
  requestId: string;
  originalIdentity: { system: string; id: string };
  nativePartId: string;
  identityStatus: DigitalIdentityStatus;
  identityEvidence: string[];
  /** Reference hints only. These fields cannot authorize identity, geometry or connections. */
  demandEvidence: unknown[];
}

export interface DigitalSourceDecision {
  sourceSystem: string;
  access: 'available' | 'denied' | 'unavailable';
  license: 'approved' | 'unknown' | 'restricted';
  evidence: string[];
  reason?: string;
  /** Asserted by the source adapter only after checking retained source/notice files. */
  attributionPreserved: boolean;
  licenseCopiesPresent: boolean;
}

/** Trusted server/tool adapters, never properties accepted from an HTTP request. */
export interface DigitalImportAdapters {
  resolveSource(request: DigitalImportRequest): Promise<DigitalSourceDecision>;
  loadPart(nativePartId: string): Promise<NativeAssemblyPart | undefined>;
  getAssemblyEvidence(partId: string, part: NativeAssemblyPart): Promise<NativePartAssemblyVerification | undefined>;
  /** Must come from the existing production AssemblyService, not fresh trial success flags. */
  getCapability(partId: string): Promise<AssemblyInterfaceCapability | undefined>;
  assemblyEvidenceOrigin?: 'fresh-verification' | 'current-runtime';
}

export const DIGITAL_IMPORT_STAGES = ['demand', 'source', 'license', 'identity', 'geometry', 'connections', 'integrity', 'assembly', 'library', 'generator'] as const;
export type DigitalImportStageName = typeof DIGITAL_IMPORT_STAGES[number];
export interface DigitalImportStage {
  stage: DigitalImportStageName;
  status: 'passed' | 'blocked' | 'skipped';
  reasonCodes: string[];
  reasons: string[];
}

export interface DigitalImportResult {
  requestId: string;
  originalIdentity: DigitalImportRequest['originalIdentity'];
  nativePartId: string;
  identityStatus: DigitalIdentityStatus;
  identityEvidence: string[];
  demandEvidence: unknown[];
  stages: DigitalImportStage[];
  source: DigitalSourceDecision | null;
  geometry: {
    status: 'not-imported' | 'geometryReady' | 'failed';
    rootFile: string | null;
    sourceVersion: string | null;
    files: LDrawSourceFile[];
    dependencies: string[];
    triangleCount: number;
  };
  connections: {
    status: 'not-imported' | 'ready' | 'partial' | 'missing';
    pointCount: number;
    sourceFiles: ConnectionSourceFile[];
    issues: Array<{ code: string; file: string; message: string }>;
  };
  nativeSourceHash: string | null;
  assembly: {
    status: 'not-run' | 'verified-listed-interfaces' | 'blocked';
    evidenceOrigin: 'fresh-verification' | 'current-runtime' | null;
    sourceDigest: string | null;
    verifiedConnectionIds: string[];
    fixtureTestsPassed: number;
    fixtureTestsTotal: number;
    reasonCodes: string[];
    reasons: string[];
  };
  /** Means source-backed geometry may be retained in the separate staging library. */
  stagingLibraryAllowed: boolean;
  /** Existing production permissions are never created or persisted by this pipeline. */
  productionGeneratorAllowed: boolean;
  productionConnectionIds: string[];
  physicalBuildVerified: false;
}

export interface DigitalImportPilotReport {
  schemaVersion: 1;
  pipelineVersion: string;
  results: DigitalImportResult[];
  counts: {
    requested: number;
    identity: Record<DigitalIdentityStatus, number>;
    geometryReady: number;
    connectionReady: number;
    connectionPartial: number;
    connectionMissing: number;
    assemblyVerified: number;
    stagingLibraryAllowed: number;
    productionGeneratorAllowed: number;
  };
  qualificationWritesPerformed: false;
  physicalBuildVerified: false;
}
