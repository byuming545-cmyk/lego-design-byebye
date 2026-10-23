import type { ImportedConnectionPoint } from '../connections/types.js';
import type { Matrix3, NativeAssemblyPart, NativePlacement, RigidTransform, Vector3 } from './types.js';
import { checkConnectionCompatibility, CONNECTION_RULE_VERSION } from './compatibility.js';
import type { CompatibilityResult, CompatibilitySourceEvidence } from './compatibility.js';
import { add, axisRotation, connectionFrame, distance, isRigidTransform, isRotation, multiply, normalize, normalizedTwist, rotate, scale, subtract, transformPoint, transpose } from './math.js';

export interface ConnectionPenetrationZone {
  kind: 'cylinder';
  center: Vector3;
  axis: Vector3;
  radius: number;
  depth: number;
  ruleId: string;
  sourceEvidence: CompatibilitySourceEvidence[];
  /** Numerical surface contact tolerance only; never an exemption for solid crossing. */
  toleranceLdu: number;
}

export interface AttachmentCandidate {
  transform: RigidTransform;
  twistDeg: number;
  axis: Vector3;
  anchor: Vector3;
  insertionPath: [Vector3, Vector3];
  insertionDirection: Vector3;
  penetrationZone: ConnectionPenetrationZone;
}

export interface AttachmentSolveRequest {
  fixedPart: NativeAssemblyPart;
  fixedPlacement: NativePlacement;
  fixedConnectionId: string;
  movingPart: NativeAssemblyPart;
  movingConnectionId: string;
  twistsDeg?: number[];
}

export interface AttachmentSolveResult {
  status: 'solved' | 'incompatible' | 'unknown' | 'blocked';
  compatibility: CompatibilityResult;
  candidates: AttachmentCandidate[];
  reason: string;
}

function unavailable(reason: string): CompatibilityResult {
  return { status: 'unknown', ruleId: null, ruleVersion: CONNECTION_RULE_VERSION, reason: `compatibilityUnknown: ${reason}`, reasonCode: 'missing-attachment-source', connectionType: 'unsupported', axisRelation: null, insertionDepthLdu: null, allowedTwistsDeg: [], permittedTranslation: null, toleranceLdu: 0.0001, sourceEvidence: [] };
}

/**
 * Solve native placements solely from source endpoints and the supported rule.
 * Collision, graph occupancy and batch eligibility are checked by attachPart;
 * producing a mathematical candidate never grants assemblyVerified.
 */
export function solveAttachment(request: AttachmentSolveRequest): AttachmentSolveResult {
  const { fixedPart, fixedPlacement, movingPart } = request;
  const block = (reason: string, compatibility = unavailable(reason), status: AttachmentSolveResult['status'] = 'blocked'): AttachmentSolveResult => ({ status, compatibility, candidates: [], reason });
  if (fixedPlacement.partId !== fixedPart.partId || fixedPart.geometry.partId !== fixedPart.partId || movingPart.geometry.partId !== movingPart.partId || fixedPart.connections.partId !== fixedPart.partId || movingPart.connections.partId !== movingPart.partId) return block('Part identifiers do not match the source records and fixed placement.');
  if (!isRigidTransform(fixedPlacement.transform)) return block('The fixed placement is not a finite proper rigid transform.');
  if ([fixedPart, movingPart].some((part) => part.geometry.status !== 'geometryReady' || !part.geometry.mesh || part.geometry.source.integrity !== 'verified' || part.geometry.source.licenseStatus !== 'complete')) return block('Native, hash-verified, licensed geometry is required for both parts.');
  const fixed = fixedPart.connections.points.find((point) => point.id === request.fixedConnectionId), moving = movingPart.connections.points.find((point) => point.id === request.movingConnectionId);
  if (!fixed || !moving) return block('The requested source connection endpoint is not available.', unavailable('The requested source connection endpoint is not available.'), 'unknown');
  const compatibility = checkConnectionCompatibility(fixed, moving);
  if (compatibility.status !== 'compatible') return block(compatibility.reason, compatibility, compatibility.status === 'incompatible' ? 'incompatible' : 'unknown');
  if (!compatibility.ruleId || compatibility.axisRelation !== 'same' || compatibility.insertionDepthLdu === null) return block('No supported seating solver is registered for this rule.', compatibility, 'unknown');
  const fixedFrame = connectionFrame(fixed), movingFrame = connectionFrame(moving);
  if (!fixedFrame || !movingFrame) return block('A proper source connection frame could not be constructed.', compatibility);
  const fixedWorldFrame = multiply(fixedPlacement.transform.rotation, fixedFrame);
  const anchor = transformPoint(fixedPlacement.transform, fixed.position), axis = normalize(rotate(fixedPlacement.transform.rotation, fixed.direction));
  if (!axis) return block('The fixed connection direction is singular.', compatibility);
  const inputTwists = request.twistsDeg ?? compatibility.allowedTwistsDeg;
  if (!Array.isArray(inputTwists) || inputTwists.length === 0 || inputTwists.length > 16) return block('A nonempty bounded set of discrete rotations is required.', compatibility);
  const twists: number[] = [];
  for (const input of inputTwists) {
    const twist = normalizedTwist(input);
    if (twist === null || !compatibility.allowedTwistsDeg.includes(twist)) return block('Requested rotation is not permitted by the source-backed connection rule.', compatibility);
    if (!twists.includes(twist)) twists.push(twist);
  }
  const candidates: AttachmentCandidate[] = [];
  for (const twist of twists) {
    const rotation: Matrix3 = multiply(multiply(axisRotation(axis, twist), fixedWorldFrame), transpose(movingFrame));
    const translation = subtract(anchor, rotate(rotation, moving.position)), transform = { rotation, translation };
    if (!isRigidTransform(transform) || !isRotation(rotation)) continue;
    const movingAnchor = transformPoint(transform, moving.position), movingAxis = normalize(rotate(rotation, moving.direction));
    if (!movingAxis || distance(movingAnchor, anchor) > compatibility.toleranceLdu || distance(movingAxis, axis) > 1e-6) continue;
    const depth = compatibility.insertionDepthLdu;
    // Both source snap axes point along the protruding stud / into its receiver.
    // The approaching part moves oppositely when the moving endpoint is female.
    const insertionDirection = moving.gender === 'M' ? axis : scale(axis, -1);
    const insertionPath: [Vector3, Vector3] = [subtract(anchor, scale(insertionDirection, depth)), [...anchor]];
    const male = fixed.gender === 'M' ? fixed : moving;
    candidates.push({ transform, twistDeg: twist, axis: [...axis], anchor: [...anchor], insertionDirection, insertionPath,
      penetrationZone: { kind: 'cylinder', center: add(anchor, scale(axis, depth / 2)), axis: [...axis], radius: male.sections[0].radius, depth, ruleId: compatibility.ruleId, sourceEvidence: compatibility.sourceEvidence.map((source) => ({ ...source })), toleranceLdu: compatibility.toleranceLdu },
    });
  }
  return candidates.length ? { status: 'solved', compatibility, candidates, reason: 'Source connection anchors and permitted discrete orientations are solved; collision and graph checks remain required.' } : block('No finite proper transform satisfies the source connection constraints.', compatibility);
}

export class AssemblyTransformSolver {
  solve(request: AttachmentSolveRequest): AttachmentSolveResult { return solveAttachment(request); }
}

export function worldConnection(point: ImportedConnectionPoint, transform: RigidTransform): { position: Vector3; direction: Vector3 } {
  return { position: transformPoint(transform, point.position), direction: rotate(transform.rotation, point.direction) };
}
