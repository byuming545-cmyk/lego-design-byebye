import { add, axisRotation, IDENTITY_TRANSFORM, isRigidTransform, multiply, normalize, rotate, scale, subtract, transpose } from '../assembly/math.js';
import type { RigidTransform } from '../assembly/types.js';
import { connectorFrame, evaluateConnectorCompatibility } from './rules.js';
import type { Connector, GrammarEvaluationOptions, GrammarPlacementResult } from './schema.js';
import { isMultipleLdu, subtractLdu } from './exact.js';

export interface ConnectorPlacementRequest {
  fixed: Connector; moving: Connector; fixedTransform?: RigidTransform;
  /** Finite source-allowed evaluations; omitted continuous freedoms remain symbolic. */
  anglesDeg?: number[];
  insertionLdu?: number;
  /** Extra receiver displacement along the male axis, beyond sourced seatingOffsetLdu. */
  axialPositionLdu?: number;
  options?: GrammarEvaluationOptions;
}
function angleIn(angle: number, allowed: readonly number[]): boolean {
  // Reuse exact decimal arithmetic for angular multiples. A near detent is not
  // a detent; large floating-point modulo additions must not erase residuals.
  try { return allowed.some(value => isMultipleLdu(subtractLdu(angle, value), 360)); }
  catch { return false; }
}
function exactQuarterTurn(axis: Connector['axis'], degrees: number) {
  if (degrees % 90 !== 0) return axisRotation(axis, degrees);
  const normalized = normalize(axis)!;
  const [x, y, z] = normalized, quarter = ((degrees / 90) % 4 + 4) % 4;
  const cosine = [1, 0, -1, 0][quarter], sine = [0, 1, 0, -1][quarter], t = 1 - cosine;
  return [cosine + x * x * t, x * y * t - z * sine, x * z * t + y * sine,
    y * x * t + z * sine, cosine + y * y * t, y * z * t - x * sine,
    z * x * t - y * sine, z * y * t + x * sine, cosine + z * z * t] as Connector['localOrientation'];
}

/** Connector frames calculate one rigid relation directly. The engine never
 * scans arbitrary 3D rotations or uses collision to discover a mating rule. */
export function solveConnectorPlacement(request: ConnectorPlacementRequest): GrammarPlacementResult {
  const { fixed, moving } = request, fixedTransform = request.fixedTransform ?? IDENTITY_TRANSFORM;
  const compatibility = evaluateConnectorCompatibility(fixed, moving, request.options);
  const block = (reason: string, status: GrammarPlacementResult['status'] = 'BLOCKED'): GrammarPlacementResult => ({ status, compatibility, candidates: [], poseFamily: compatibility.joint, reasons: [reason] });
  if (compatibility.status !== 'COMPATIBLE' || !compatibility.joint) return block(compatibility.reasons.join(' '), compatibility.status === 'UNKNOWN' ? 'UNKNOWN' : 'BLOCKED');
  if (!isRigidTransform(fixedTransform)) return block('A source part may only receive a proper rigid placement.');
  const a = connectorFrame(fixed), b = connectorFrame(moving), range = compatibility.insertionRangeLdu;
  if (!a || !b || !range) return block('The matched feature frames/insertion range remain unresolved.', 'UNKNOWN');
  const joint = compatibility.joint;
  const explicitAngles = request.anglesDeg;
  if (explicitAngles && (!Array.isArray(explicitAngles) || explicitAngles.length < 1 || explicitAngles.length > 64 || explicitAngles.some(angle => !Number.isFinite(angle)))) return block('A finite bounded angle set is required.');
  // A spherical joint needs an explicit pose, not one angle about a shaft. This
  // first solver returns its family without inventing a full orientation.
  if (joint.type === 'SPHERICAL') return block('Spherical compatibility is established, but a full orientation within its sourced cone must be supplied to a spherical constraint solver.', 'UNKNOWN');
  const neutralAngle = joint.angleLimitsDeg && (joint.angleLimitsDeg[0] > 0 || joint.angleLimitsDeg[1] < 0) ? joint.angleLimitsDeg[0] : 0;
  const angles = explicitAngles ?? compatibility.allowedAnglesDeg ?? [neutralAngle];
  if (angles.some(angle => compatibility.allowedAnglesDeg && !angleIn(angle, compatibility.allowedAnglesDeg)
      || joint.rotationDof && joint.angleLimitsDeg && (angle < joint.angleLimitsDeg[0] || angle > joint.angleLimitsDeg[1]))) return block('Requested roll violates a keyed symmetry, detent table or angular limit.');
  const neutralAxial = joint.translationRangeLdu && (joint.translationRangeLdu[0] > 0 || joint.translationRangeLdu[1] < 0) ? joint.translationRangeLdu[0] : 0;
  const axial = request.axialPositionLdu ?? neutralAxial;
  if (!Number.isFinite(axial) || joint.translationDof === 0 && axial !== 0 || joint.translationDof && (!joint.translationRangeLdu || axial < joint.translationRangeLdu[0] || axial > joint.translationRangeLdu[1])) return block('Requested axial position violates the sourced span or locked translation.');
  const worldFrame = multiply(fixedTransform.rotation, a), axis = normalize(rotate(fixedTransform.rotation, fixed.axis));
  if (!axis) return block('Singular connector axis.');
  const policy = fixed.matchingPolicy!;
  // The SAME convention is the LDCad stud convention: protruding male and
  // receiver inward axis align. OPPOSITE rotates the local frame by 180°.
  const relation = compatibility.axisRelation === 'OPPOSITE' ? exactQuarterTurn([1, 0, 0], 180) : IDENTITY_TRANSFORM.rotation;
  const anchor = add(rotate(fixedTransform.rotation, fixed.localPositionLdu), fixedTransform.translation);
  const sign = fixed.role === 'MALE' || compatibility.axisRelation === 'OPPOSITE' ? 1 : -1;
  const shift = policy.seatingOffsetLdu + axial;
  const male = fixed.role === 'MALE' ? fixed : moving, female = fixed.role === 'FEMALE' ? fixed : moving;
  if (!male.axialSpanLdu || !female.axialSpanLdu || ![...male.axialSpanLdu, ...female.axialSpanLdu].every(Number.isFinite)) return block('Source axial spans are required to verify actual engagement, not just an anchor point.', 'UNKNOWN');
  const receivingSpan = compatibility.axisRelation === 'OPPOSITE'
    ? [shift - female.axialSpanLdu[1], shift - female.axialSpanLdu[0]]
    : [shift + female.axialSpanLdu[0], shift + female.axialSpanLdu[1]];
  const depth = Math.max(0, Math.min(male.axialSpanLdu[1], receivingSpan[1]) - Math.max(male.axialSpanLdu[0], receivingSpan[0]));
  if (depth < range[0] || depth > range[1]) return block('Actual overlap of the sourced axial spans violates the verified insertion range.');
  if (request.insertionLdu !== undefined && (!Number.isFinite(request.insertionLdu) || Math.abs(request.insertionLdu - depth) > 1e-9)) return block('Requested insertion depth does not equal the actual axial overlap at this pose.');
  const seated = add(anchor, scale(axis, sign * shift));
  const candidates = [...new Set(angles)].flatMap(twistDeg => {
    const rotation = multiply(multiply(multiply(exactQuarterTurn(axis, twistDeg), worldFrame), relation), transpose(b));
    const transform = { rotation, translation: subtract(seated, rotate(rotation, moving.localPositionLdu)) };
    if (!isRigidTransform(transform)) return [];
    return [{ transform, twistDeg, insertionLdu: depth, seatedAnchor: [...seated] as [number, number, number], joint: { ...joint, axis, pivotLdu: anchor }, fixedFeatureId: fixed.featureId, movingFeatureId: moving.featureId }];
  });
  return candidates.length ? { status: 'SOLVED', compatibility, candidates, poseFamily: { ...joint, axis, pivotLdu: anchor }, reasons: [] } : block('No proper rigid frame solution exists.');
}
