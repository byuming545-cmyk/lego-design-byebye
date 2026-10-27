import type { Matrix3, RigidTransform, Vector3 } from '../assembly/types.js';

export const CONNECTOR_SCHEMA_VERSION = 'connector-schema-2';
export const CONNECTOR_GRAMMAR_VERSION = 'connector-grammar-2';
export const CONNECTOR_FAMILIES = [
  'STUD', 'ANTISTUD', 'HOLLOW_STUD', 'BAR', 'BAR_HOLE', 'CLIP', 'PIN', 'PIN_HOLE',
  'AXLE', 'AXLE_HOLE', 'ROUND_HOLE', 'HINGE_FINGER', 'CLICK_HINGE', 'TURNTABLE',
  'BALL', 'BALL_SOCKET', 'TOWBALL', 'TOWBALL_SOCKET', 'WHEEL_PIN', 'WHEEL_HOLE',
  'RIM_SEAT', 'TYRE_SEAT', 'RAIL', 'GROOVE', 'GENERIC_SPECIAL',
] as const;
export type ConnectorFamily = typeof CONNECTOR_FAMILIES[number];
export type ConnectorRole = 'MALE' | 'FEMALE' | 'NEUTRAL' | 'UNKNOWN';
export type ConnectorCoverage = 'COMPLETE' | 'PARTIAL' | 'NONE';
export type ConnectorConfidence = 'SOURCE_BACKED' | 'VERIFIED' | 'HEURISTIC' | 'UNKNOWN';
export type ConnectorSourceKind = 'VERIFIED_MANUAL' | 'REAL_BUILD_VERIFIED' | 'STUDIO_CONNECTIVITY' | 'LDCAD_SHADOW' | 'LDRAW_PRIMITIVE' | 'OFFICIAL_SHORTCUT' | 'KNOWN_PAIRING' | 'CONSERVATIVE_GEOMETRY_INFERENCE' | 'HEURISTIC';
export interface ConnectorProvenance {
  id: string; kind: ConnectorSourceKind; reference: string; revision: string | null;
  sha256: string | null; license: string | null; line: number | null; raw: string | null;
  /** A parser/source assertion is not a physical-fit certificate. */
  verification: 'SOURCE_DECLARED' | 'VERIFIED' | 'UNVERIFIED';
  scope: 'PRODUCTION' | 'ALGORITHM_FIXTURE';
  notes: string[];
}
export interface ConnectorDiagnostic { code: string; message: string; featureId?: string; sourceIds?: string[] }
export type JointType = 'RIGID' | 'REVOLUTE' | 'PRISMATIC' | 'CYLINDRICAL' | 'SPHERICAL';
export type GrammarRuleId = 'C01' | 'BAR_CLIP' | 'BAR_RECEPTACLE' | 'PIN_HOLE' | 'AXLE_KEYED' | 'AXLE_ROUND' | 'HINGE' | 'CLICK_HINGE' | 'TURNTABLE' | 'BALL_SOCKET' | 'TOWBALL_SOCKET' | 'WHEEL_MOUNT' | 'TYRE_RIM' | 'RAIL_GROOVE' | 'GENERIC_GROUP';
export interface ConnectorMatchPolicy {
  /** This is structured mating evidence, not an ID-based part-pair allowlist. */
  ruleId: GrammarRuleId;
  kind: 'STANDARD_STUD' | 'VERIFIED_FIT' | 'SOURCE_DECLARED_FIT';
  /** A sourced profile/seat identity; equal radii or raw SNAP_GEN groups are insufficient. */
  profileId: string;
  evidenceSourceIds: string[];
  axisRelation: 'SAME' | 'OPPOSITE';
  seatingOffsetLdu: number;
}
export interface Connector {
  featureId: string;
  /** Optional original endpoint identity for the existing native graph adapter. */
  sourceConnectionId: string | null;
  family: ConnectorFamily; role: ConnectorRole; units: 'LDU';
  localPositionLdu: Vector3;
  localOrientation: Matrix3;
  axis: Vector3;
  profile: 'ROUND' | 'CROSS' | 'SQUARE' | 'FINGER' | 'BALL' | 'SEAT' | 'RAIL' | 'GENERIC' | 'UNKNOWN';
  dimensions: { radiusLdu: number | null; lengthLdu: number | null; widthLdu: number | null; heightLdu: number | null; sections: { profile: string; radiusLdu: number; lengthLdu: number }[] };
  /** Optional source-declared envelope; absence never becomes an inferred fit. */
  boundingShape?: { kind: 'SPHERE' | 'CYLINDER' | 'BOX'; dimensionsLdu: number[] } | null;
  axialSpanLdu: [number, number] | null;
  capStart: boolean | null; capEnd: boolean | null;
  insertionRangeLdu: [number, number] | null;
  slideAllowed: boolean | null; rotationAllowed: boolean | null;
  symmetryOrder: number | null;
  friction: 'HIGH' | 'LOW' | 'UNKNOWN';
  angleLimitsDeg: [number, number] | null;
  detentsDeg: number[] | null;
  compatibilityGroup: string | null;
  occupied: boolean;
  contactSurface: string | null; entryFace: string | null;
  matchingPolicy: ConnectorMatchPolicy | null;
  sources: ConnectorProvenance[];
  confidence: ConnectorConfidence;
  coverage: ConnectorCoverage;
  unknownFields: string[];
  diagnostics: ConnectorDiagnostic[];
  notes: string[];
}
export interface JointModel {
  type: JointType; translationDof: 0 | 1; rotationDof: 0 | 1 | 3;
  axis: Vector3; pivotLdu: Vector3;
  /** Extra receiver displacement along the male axis, relative to sourced seatingOffsetLdu. */
  translationRangeLdu: [number, number] | null;
  angleLimitsDeg: [number, number] | null;
  detentsDeg: number[] | null;
  /** Contact/winding verification is a separate stage from a joint solution. */
  collisionEnvelope: { sourceIds: string[]; status: 'UNKNOWN' | 'SOURCE_BACKED' };
  physicalBuildVerified: false;
}
export interface GrammarCompatibility {
  status: 'COMPATIBLE' | 'INCOMPATIBLE' | 'ILLEGAL' | 'UNKNOWN';
  ruleId: GrammarRuleId | null; reasonCodes: string[]; reasons: string[];
  joint: JointModel | null;
  axisRelation: 'SAME' | 'OPPOSITE' | null;
  insertionRangeLdu: [number, number] | null;
  allowedAnglesDeg: number[] | null;
  sourceIds: string[];
  /** Compatibility is not a claim of collision freedom, stability or physical fit. */
  physicalBuildVerified: false;
}
export interface GrammarEvaluationOptions { allowAlgorithmFixtures?: boolean }
export interface GrammarPoseCandidate {
  transform: RigidTransform; twistDeg: number; insertionLdu: number;
  joint: JointModel; fixedFeatureId: string; movingFeatureId: string;
}
export interface GrammarPlacementResult {
  status: 'SOLVED' | 'BLOCKED' | 'UNKNOWN';
  compatibility: GrammarCompatibility;
  candidates: GrammarPoseCandidate[];
  /** Continuous freedoms stay symbolic; this is never a random rotation search. */
  poseFamily: JointModel | null;
  reasons: string[];
}
