import type { LDrawPartResult } from '../ldraw/types.js';
import type { ConnectionImportResult } from '../connections/types.js';
import { CONNECTOR_GRAMMAR_VERSION } from '../grammar/schema.js';

export type Vector3 = [number, number, number];
export type Matrix3 = [number, number, number, number, number, number, number, number, number];
/** Native LDraw coordinates and LDU. Only placement transforms change, never source vertices. */
export interface RigidTransform { rotation: Matrix3; translation: Vector3 }
export interface NativeAssemblyPart {
  partId: string;
  geometry: LDrawPartResult;
  connections: ConnectionImportResult;
}
export interface NativePlacement {
  instanceId: string;
  partId: string;
  transform: RigidTransform;
}
export interface AssemblyVersions {
  partLibraryVersion: string;
  assemblyEngineVersion: string;
  connectionRuleVersion: string;
  collisionVersion: string;
}
export interface AssemblyGraphEdge {
  /** One source-supported physical mating pair; a single attachment can add many edges. */
  id: string;
  fixedInstanceId: string;
  fixedConnectionId: string;
  movingInstanceId: string;
  movingConnectionId: string;
  ruleId: string;
  ruleVersion: string;
  twistDeg: number;
  axis: Vector3;
  anchor: Vector3;
  insertionDepthLdu: number;
}
export interface NativeAssembly extends AssemblyVersions {
  schemaVersion: 1;
  id: string;
  placements: NativePlacement[];
  /** Every coincident supported mating pair is recorded, including multi-part bridges. */
  edges: AssemblyGraphEdge[];
  sourceHashes: Record<string, string>;
  physicalBuildVerified: false;
}
export interface AssemblyAttachRequest {
  anchorInstanceId: string;
  anchorConnectionId: string;
  partId: string;
  candidateConnectionId: string;
  twistDegrees?: number;
}
export interface AssemblyInterfaceCapability {
  partId: string;
  assemblyVerified: boolean;
  generatable: boolean;
  allowedConnectionIds: string[];
  ruleIds: string[];
  reasonCodes: string[];
  reasons: string[];
  /** Grammar eligibility describes source/rule readiness, never a completed build. */
  admissionBasis?: 'interface-grammar';
  grammarVersion?: string;
  sourceReady?: boolean;
  collisionGeometryReady?: boolean;
  connectable?: boolean;
}

export function isGeneratableCapability(capability: AssemblyInterfaceCapability | undefined): boolean {
  if (!capability?.generatable || !capability.allowedConnectionIds.length) return false;
  if (capability.admissionBasis === 'interface-grammar') return capability.grammarVersion === CONNECTOR_GRAMMAR_VERSION &&
    capability.sourceReady === true && capability.collisionGeometryReady === true && capability.connectable === true;
  return capability.assemblyVerified === true;
}

/** Only unresolved dimensions on other endpoints can be isolated. Structural
 * include/clear, integrity or syntax failures still invalidate the whole scope. */
export function hasIsolatedUnknownDimensions(part: NativeAssemblyPart): boolean {
  return part.connections.status === 'partial' && part.connections.issues.length > 0 &&
    part.connections.issues.every(issue => issue.code === 'unsupported-scaling');
}
