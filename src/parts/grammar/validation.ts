import type { RigidTransform, Vector3 } from '../assembly/types.js';
import { isRigidTransform } from '../assembly/math.js';
import type { Connector, ConnectorProvenance, GrammarCompatibility, GrammarEvaluationOptions, GrammarPlacementResult, JointType } from './schema.js';
import { solveConnectorPlacement } from './solver.js';
import { addLdu, exactLdu, multiplyLdu, validateExactClosure, type ExactClosureConstraint, type ExactClosureResult, type LduVectorInput } from './exact.js';

export interface ConnectorPairConstraint {
  fixedInstanceId: string;
  movingInstanceId: string;
  fixed: Connector;
  moving: Connector;
  fixedTransform: RigidTransform;
  angleDeg?: number;
  insertionLdu?: number;
  axialPositionLdu?: number;
}
export interface GrammarMultiPointResult {
  status: 'CONSISTENT' | 'INCONSISTENT' | 'UNKNOWN';
  /** Every pair was checked against this one pose, never separately averaged. */
  sharedMovingTransform: RigidTransform;
  pairCount: number;
  checks: { fixedInstanceId: string; movingInstanceId: string; fixedFeatureId: string; movingFeatureId: string; compatibility: GrammarCompatibility; placementStatus: GrammarPlacementResult['status'] }[];
  closure: ExactClosureResult;
  issues: { code: string; reason: string }[];
  physicalBuildVerified: false;
}

function exactWorld(transform: RigidTransform, point: Vector3, direction = false): LduVectorInput {
  return [0, 1, 2].map(row => {
    let value = exactLdu(direction ? 0 : transform.translation[row]);
    for (let column = 0; column < 3; column++) value = addLdu(value, multiplyLdu(transform.rotation[row * 3 + column], point[column]));
    return value;
  }) as unknown as LduVectorInput;
}
function sameNumericalPose(a: RigidTransform, b: RigidTransform): boolean {
  // This filter chooses the already solved pose. Exact closure below must still
  // pass; this tolerance never turns an almost-coincident endpoint into a mate.
  return a.translation.every((value, axis) => Math.abs(value - b.translation[axis]) < 1e-8)
    && a.rotation.every((value, axis) => Math.abs(value - b.rotation[axis]) < 1e-8);
}

/** Validate explicitly engaged pairs. Callers may discover/index candidates by
 * family first, but a missing/misaligned declared mate cannot silently vanish. */
export function validateGrammarMultiPoint(input: {
  pairs: readonly ConnectorPairConstraint[];
  movingTransform: RigidTransform;
  options?: GrammarEvaluationOptions;
}): GrammarMultiPointResult {
  const result: GrammarMultiPointResult = {
    status: 'UNKNOWN', sharedMovingTransform: input.movingTransform, pairCount: input.pairs.length,
    checks: [], closure: validateExactClosure([]), issues: [], physicalBuildVerified: false,
  };
  if (!input.pairs.length || input.pairs.length > 4096) { result.issues.push({ code: 'invalid-pair-budget', reason: 'A nonempty bounded set of explicit mating pairs is required.' }); return result; }
  if (!isRigidTransform(input.movingTransform)) { result.status = 'INCONSISTENT'; result.issues.push({ code: 'non-rigid-placement', reason: 'A rigid part cannot be stretched, mirrored or bent to close its interfaces.' }); return result; }
  const movingInstance = input.pairs[0].movingInstanceId;
  const occupied = new Set<string>(), closure: ExactClosureConstraint[] = [];
  let unknown = false;
  for (const pair of input.pairs) {
    if (!pair.fixedInstanceId || !pair.movingInstanceId || pair.fixedInstanceId === pair.movingInstanceId || pair.movingInstanceId !== movingInstance || !isRigidTransform(pair.fixedTransform)) {
      result.issues.push({ code: 'invalid-pair-instance', reason: 'All constraints must address one moving instance and valid distinct fixed instances/rigid poses.' }); continue;
    }
    // Family/feature identity, not position, distinguishes co-located features.
    for (const [instance, feature] of [[pair.fixedInstanceId, pair.fixed], [pair.movingInstanceId, pair.moving]] as const) {
      const key = JSON.stringify([instance, feature.featureId]);
      if (occupied.has(key)) result.issues.push({ code: 'endpoint-occupied-twice', reason: `Connector ${instance}/${feature.featureId} is explicitly engaged more than once.` });
      occupied.add(key);
    }
    const solved = solveConnectorPlacement({ fixed: pair.fixed, moving: pair.moving, fixedTransform: pair.fixedTransform,
      ...(pair.angleDeg === undefined ? {} : { anglesDeg: [pair.angleDeg] }),
      ...(pair.insertionLdu === undefined ? {} : { insertionLdu: pair.insertionLdu }),
      ...(pair.axialPositionLdu === undefined ? {} : { axialPositionLdu: pair.axialPositionLdu }), options: input.options });
    result.checks.push({ fixedInstanceId: pair.fixedInstanceId, movingInstanceId: pair.movingInstanceId, fixedFeatureId: pair.fixed.featureId, movingFeatureId: pair.moving.featureId, compatibility: solved.compatibility, placementStatus: solved.status });
    if (solved.compatibility.status === 'UNKNOWN' || solved.status === 'UNKNOWN') {
      unknown = true; result.issues.push({ code: 'pair-needs-verification', reason: solved.reasons.join(' ') || solved.compatibility.reasons.join(' ') }); continue;
    }
    if (solved.compatibility.status !== 'COMPATIBLE' || solved.status !== 'SOLVED') {
      result.issues.push({ code: solved.compatibility.status === 'ILLEGAL' ? 'illegal-interface-pair' : 'pair-not-solvable', reason: solved.reasons.join(' ') || solved.compatibility.reasons.join(' ') }); continue;
    }
    const candidate = solved.candidates.find(candidate => sameNumericalPose(candidate.transform, input.movingTransform));
    if (!candidate) { result.issues.push({ code: 'shared-pose-mismatch', reason: `The shared rigid pose cannot satisfy ${pair.fixed.featureId}/${pair.moving.featureId} with its permitted profile orientation, insertion and motion parameters.` }); continue; }
    // Check endpoint, axis and tangent in exactly the same rigid pose. Decimal
    // source coordinates stay rational; 39.99999999999999 never becomes 40.
    const tangent: Vector3 = [pair.moving.localOrientation[0], pair.moving.localOrientation[3], pair.moving.localOrientation[6]];
    try {
      closure.push({ fixedFeatureId: pair.fixed.featureId, movingFeatureId: pair.moving.featureId,
        fixedPosition: exactWorld(candidate.transform, pair.moving.localPositionLdu), movingPosition: exactWorld(input.movingTransform, pair.moving.localPositionLdu),
        fixedAxis: exactWorld(candidate.transform, pair.moving.axis, true), movingAxis: exactWorld(input.movingTransform, pair.moving.axis, true) });
      closure.push({ fixedFeatureId: `${pair.fixed.featureId}:frame-tangent`, movingFeatureId: `${pair.moving.featureId}:frame-tangent`,
        fixedPosition: exactWorld(candidate.transform, tangent, true), movingPosition: exactWorld(input.movingTransform, tangent, true) });
    } catch (error) {
      unknown = true;
      result.issues.push({ code: 'exact-coordinate-unresolved', reason: error instanceof Error ? error.message : 'Exact source-coordinate arithmetic could not be established.' });
    }
  }
  result.closure = validateExactClosure(closure);
  if (result.closure.status === 'MISALIGNED') result.issues.push({ code: 'exact-closure-mismatch', reason: result.closure.reason });
  if (result.issues.some(issue => !['pair-needs-verification', 'exact-coordinate-unresolved'].includes(issue.code))) result.status = 'INCONSISTENT';
  else if (unknown || result.closure.status !== 'EXACT') result.status = 'UNKNOWN';
  else result.status = 'CONSISTENT';
  return result;
}

export interface GrammarCollisionVerdict {
  status: 'CLEAR' | 'COLLISION' | 'UNKNOWN';
  reason: string;
  /** True only when the actual solid checker used source-bounded contact zones. */
  sourceBoundedContactChecked: boolean;
}
export interface GrammarStressVerdict {
  status: 'CLEAR' | 'FORCED_DEFORMATION' | 'UNKNOWN';
  scope: 'rigid-constraint-consistency-only' | 'verified-assembly-stress-and-fit';
  sources: ConnectorProvenance[];
  reasons: string[];
}
export interface GrammarLegalityResult {
  connectability: 'COMPATIBLE' | 'INCOMPATIBLE' | 'ILLEGAL' | 'UNKNOWN';
  placement: 'SOLVED' | 'BLOCKED' | 'UNKNOWN';
  collision: GrammarCollisionVerdict;
  stress: GrammarStressVerdict;
  legal: 'LEGAL' | 'ILLEGAL' | 'UNKNOWN';
  stable: 'UNKNOWN';
  reasons: string[];
  physicalBuildVerified: false;
}

/** Logical separation is intentional: legal interface alignment is not solid,
 * material-stress, manufacturing-tolerance or stability evidence. Call only
 * with server-resolved evidence; this function never grants library admission. */
export function evaluateGrammarLegality(input: {
  compatibility: GrammarCompatibility;
  placement: GrammarPlacementResult;
  multiPoint?: GrammarMultiPointResult;
  collision?: GrammarCollisionVerdict;
  stress?: GrammarStressVerdict;
  options?: GrammarEvaluationOptions;
}): GrammarLegalityResult {
  const result: GrammarLegalityResult = {
    connectability: input.compatibility.status, placement: input.placement.status,
    collision: input.collision ?? { status: 'UNKNOWN', reason: 'Actual native solid collision has not been checked.', sourceBoundedContactChecked: false },
    stress: input.stress ?? { status: 'UNKNOWN', scope: 'rigid-constraint-consistency-only', sources: [], reasons: ['Material stress, fit and tolerance evidence has not been supplied.'] },
    legal: 'UNKNOWN', stable: 'UNKNOWN', reasons: [], physicalBuildVerified: false,
  };
  if (input.placement.compatibility.status !== input.compatibility.status || input.placement.compatibility.ruleId !== input.compatibility.ruleId
      || input.placement.status === 'SOLVED' && !input.placement.candidates.length) {
    result.reasons.push('The compatibility and placement stages disagree or lack an actual solved candidate.');
    return result;
  }
  if (input.compatibility.status === 'ILLEGAL' || input.compatibility.status === 'INCOMPATIBLE') result.reasons.push(...input.compatibility.reasons);
  if (input.placement.status === 'BLOCKED') result.reasons.push(...input.placement.reasons);
  if (input.multiPoint?.status === 'INCONSISTENT') result.reasons.push(...input.multiPoint.issues.map(issue => issue.reason));
  if (result.collision.status === 'COLLISION') result.reasons.push(result.collision.reason);
  if (result.stress.status === 'FORCED_DEFORMATION') result.reasons.push(...result.stress.reasons);
  if (input.compatibility.status === 'ILLEGAL' || input.compatibility.status === 'INCOMPATIBLE' || input.placement.status === 'BLOCKED'
      || input.multiPoint?.status === 'INCONSISTENT' || result.collision.status === 'COLLISION' || result.stress.status === 'FORCED_DEFORMATION') {
    result.legal = 'ILLEGAL'; return result;
  }
  const sourceBackedStress = result.stress.status === 'CLEAR' && result.stress.scope === 'verified-assembly-stress-and-fit'
    && result.stress.sources.some(source => source.verification === 'VERIFIED'
      && ['VERIFIED_MANUAL', 'REAL_BUILD_VERIFIED', 'OFFICIAL_SHORTCUT', 'KNOWN_PAIRING'].includes(source.kind)
      && !!source.id && !!source.reference && !!source.license && !!source.sha256 && /^[a-f0-9]{64}$/.test(source.sha256)
      && (source.scope === 'PRODUCTION' || input.options?.allowAlgorithmFixtures));
  if (input.compatibility.status === 'COMPATIBLE' && input.placement.status === 'SOLVED'
      && (!input.multiPoint || input.multiPoint.status === 'CONSISTENT')
      && result.collision.status === 'CLEAR' && result.collision.sourceBoundedContactChecked && sourceBackedStress) result.legal = 'LEGAL';
  else {
    if (input.compatibility.status === 'UNKNOWN' || input.placement.status === 'UNKNOWN' || input.multiPoint?.status === 'UNKNOWN') result.reasons.push('At least one interface or shared-pose constraint still needs verification.');
    if (result.collision.status === 'UNKNOWN' || !result.collision.sourceBoundedContactChecked) result.reasons.push('Whole-solid/contact validation remains incomplete; an insertion envelope alone is not permission for solid overlap.');
    if (!sourceBackedStress) result.reasons.push('No verified assembly stress/fit evidence was supplied. Exact rigid closure alone cannot certify material stress or retention.');
  }
  return result;
}

/** The existing native solid checker can be injected here. It is invoked only
 * after compatibility, a solved pose and all explicitly engaged pairs agree. */
export async function assessGrammarAssemblyCandidate(input: {
  placement: GrammarPlacementResult;
  pairs: readonly ConnectorPairConstraint[];
  movingTransform: RigidTransform;
  collisionCheck: (movingTransform: RigidTransform, pairs: readonly ConnectorPairConstraint[]) => GrammarCollisionVerdict | Promise<GrammarCollisionVerdict>;
  stress?: GrammarStressVerdict;
  options?: GrammarEvaluationOptions;
}): Promise<GrammarLegalityResult & { multiPoint: GrammarMultiPointResult }> {
  const multiPoint = validateGrammarMultiPoint(input);
  let collision: GrammarCollisionVerdict = { status: 'UNKNOWN', reason: 'Collision is deferred until a source-compatible shared pose is established.', sourceBoundedContactChecked: false };
  if (input.placement.compatibility.status === 'COMPATIBLE' && input.placement.status === 'SOLVED' && multiPoint.status === 'CONSISTENT') {
    try { collision = await input.collisionCheck(input.movingTransform, input.pairs); }
    catch (error) { collision = { status: 'UNKNOWN', reason: error instanceof Error ? error.message : 'The solid collision checker failed.', sourceBoundedContactChecked: false }; }
  }
  return { ...evaluateGrammarLegality({ compatibility: input.placement.compatibility, placement: input.placement, multiPoint, collision, stress: input.stress, options: input.options }), multiPoint };
}

export interface StabilityConnectionObservation {
  fixedInstanceId: string; fixedFeatureId: string;
  movingInstanceId: string; movingFeatureId: string;
  family: Connector['family']; jointType: JointType;
  friction: Connector['friction'];
  /** Only actual source/measurement values; null means not supplied. */
  contactAreaLdu2: number | null;
  leverArmLdu: number | null;
}
export interface GrammarStabilityScore {
  status: 'HEURISTIC' | 'INSUFFICIENT_EVIDENCE' | 'INVALID';
  heuristicScore: number | null;
  contributions: { factor: string; points: number; reason: string }[];
  missingFactors: string[];
  diagnostics: string[];
  policy: 'structural-ranking-1';
  physicalStability: 'UNKNOWN';
  createsConnections: false;
}

/** A transparent ranking heuristic. It is not a load/friction/material solver,
 * does not manufacture weights or forces, and never adds graph connections. */
export function scoreGrammarStability(input: {
  connections: readonly StabilityConnectionObservation[];
  supportSymmetry?: 'SYMMETRIC' | 'ASYMMETRIC' | 'UNKNOWN';
  measuredWeightNewtons?: number | null;
}): GrammarStabilityScore {
  const result: GrammarStabilityScore = { status: 'INSUFFICIENT_EVIDENCE', heuristicScore: null, contributions: [], missingFactors: [], diagnostics: [], policy: 'structural-ranking-1', physicalStability: 'UNKNOWN', createsConnections: false };
  const keys = new Set<string>();
  if (input.connections.length > 4096) result.diagnostics.push('Connection observations exceed the bounded score budget.');
  for (const connection of input.connections) {
    const endpoints = [[connection.fixedInstanceId, connection.fixedFeatureId], [connection.movingInstanceId, connection.movingFeatureId]].map(value => JSON.stringify(value)).sort();
    const key = JSON.stringify(endpoints);
    if (keys.has(key)) result.diagnostics.push('Duplicate connection observations cannot increase stability.');
    keys.add(key);
    if (connection.contactAreaLdu2 !== null && (!Number.isFinite(connection.contactAreaLdu2) || connection.contactAreaLdu2 < 0)
        || connection.leverArmLdu !== null && (!Number.isFinite(connection.leverArmLdu) || connection.leverArmLdu < 0)) result.diagnostics.push('Contact area and lever arm must be finite nonnegative observations.');
  }
  if (input.measuredWeightNewtons !== undefined && input.measuredWeightNewtons !== null && (!Number.isFinite(input.measuredWeightNewtons) || input.measuredWeightNewtons < 0)) result.diagnostics.push('Measured weight must be finite and nonnegative.');
  if (result.diagnostics.length) { result.status = 'INVALID'; return result; }
  if (!input.connections.length) { result.missingFactors.push('Actual validated connector edges'); return result; }
  const add = (factor: string, points: number, reason: string) => result.contributions.push({ factor, points, reason });
  const rigid = input.connections.filter(connection => connection.jointType === 'RIGID').length;
  const studs = input.connections.filter(connection => ['STUD', 'ANTISTUD', 'HOLLOW_STUD'].includes(connection.family)).length;
  add('observed-rigid-connectors', Math.min(30, rigid * 3), `${rigid} actual rigid connection observations; no invented load capacity.`);
  add('observed-stud-connectors', Math.min(20, studs * 2), `${studs} observed stud-system connections.`);
  if (input.connections.length >= 2) add('multiple-support-edges', 10, 'Multiple actual edges provide a ranking signal; geometry and load path remain separate evidence.');
  const high = input.connections.filter(connection => connection.friction === 'HIGH').length, low = input.connections.filter(connection => connection.friction === 'LOW').length;
  if (high) add('declared-high-friction', Math.min(10, high * 2), 'Uses supplied friction classification only, not a fabricated friction coefficient.');
  if (low) add('declared-low-friction', -Math.min(10, low * 2), 'Low-friction joints receive a lower ranking for rigid support.');
  const area = input.connections.reduce((sum, connection) => sum + (connection.contactAreaLdu2 ?? 0), 0);
  if (area > 0) add('supplied-contact-area', Math.min(10, area / 400), 'Contact-area ranking in 20×20 LDU pitch areas; this is not a stress or retention-force calculation.');
  const observedLevers = input.connections.flatMap(connection => connection.leverArmLdu === null ? [] : [connection.leverArmLdu]);
  if (observedLevers.length) add('supplied-lever-arm', -Math.min(15, observedLevers.reduce((sum, value) => sum + value, 0) / observedLevers.length / 20), 'Longer supplied lever arms lower the relative score; no unstated force or mass is estimated.');
  if (input.measuredWeightNewtons !== undefined && input.measuredWeightNewtons !== null) add('supplied-measured-load', -Math.min(10, input.measuredWeightNewtons), 'Only the explicitly supplied load is used as a ranking penalty; load-bearing capacity remains unknown.');
  if (input.supportSymmetry === 'SYMMETRIC') add('observed-symmetric-support', 5, 'Caller supplied a symmetric-support indicator.');
  if (input.supportSymmetry === 'ASYMMETRIC') add('observed-asymmetric-support', -5, 'Caller supplied an asymmetric-support indicator.');
  if (input.connections.some(connection => connection.friction === 'UNKNOWN')) result.missingFactors.push('Connector friction/retention evidence');
  if (input.connections.some(connection => connection.contactAreaLdu2 === null)) result.missingFactors.push('Source-backed contact area');
  if (input.connections.some(connection => connection.leverArmLdu === null)) result.missingFactors.push('Load path and lever arm');
  if (!input.supportSymmetry || input.supportSymmetry === 'UNKNOWN') result.missingFactors.push('Support symmetry');
  if (input.measuredWeightNewtons === undefined || input.measuredWeightNewtons === null) result.missingFactors.push('Measured weight/load');
  result.missingFactors.push('Material strength, friction forces and physical build verification');
  result.heuristicScore = Math.max(0, Math.min(100, result.contributions.reduce((sum, contribution) => sum + contribution.points, 0)));
  result.status = 'HEURISTIC';
  return result;
}
