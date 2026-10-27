import type { Connector, GrammarRuleId, JointModel, JointType } from './schema.js';

export interface JointDerivation { joint: JointModel | null; reasons: string[] }
function finiteRange(value: [number, number] | null): value is [number, number] {
  return !!value && value.every(Number.isFinite) && value[0] <= value[1];
}
export function intersectRanges(a: [number, number] | null, b: [number, number] | null): [number, number] | null {
  if (!finiteRange(a) || !finiteRange(b)) return null;
  const result: [number, number] = [Math.max(a[0], b[0]), Math.min(a[1], b[1])];
  return result[0] <= result[1] ? result : null;
}

/** Extra receiver-origin displacement, along the MALE axis, relative to the
 * sourced seatingOffsetLdu. The whole receiver span must remain inside the
 * shaft span. OPPOSITE reverses its interval before taking containment bounds.
 * This is not a tolerance, a guessed stopper or an invented clearance. */
export function axialSeatingRange(male: Connector, female: Connector): [number, number] | null {
  if (!finiteRange(male.axialSpanLdu) || !finiteRange(female.axialSpanLdu)) return null;
  const policy = male.matchingPolicy;
  if (!policy || !Number.isFinite(policy.seatingOffsetLdu)) return null;
  const [a, b] = male.axialSpanLdu;
  const [c, d] = policy.axisRelation === 'OPPOSITE' ? [-female.axialSpanLdu[1], -female.axialSpanLdu[0]] : female.axialSpanLdu;
  const result: [number, number] = [a - c - policy.seatingOffsetLdu, b - d - policy.seatingOffsetLdu];
  return result[0] <= result[1] ? result : null;
}

/** Kinematics are derived only after family/profile compatibility evidence.
 * A family label by itself cannot determine friction, detents or motion. */
export function deriveJointModel(ruleId: GrammarRuleId, male: Connector, female: Connector): JointDerivation {
  const missing = (reason: string): JointDerivation => ({ joint: null, reasons: [reason] });
  const sourceIds = [...new Set([...male.sources, ...female.sources].map(source => source.id))];
  const base = {
    axis: [...male.axis] as Connector['axis'], pivotLdu: [...male.localPositionLdu] as Connector['localPositionLdu'],
    collisionEnvelope: { sourceIds, status: 'UNKNOWN' as const }, physicalBuildVerified: false as const,
  };
  const model = (type: JointType, translationDof: 0 | 1, rotationDof: 0 | 1 | 3,
    translationRangeLdu: [number, number] | null = null, angleLimitsDeg: [number, number] | null = null, detentsDeg: number[] | null = null): JointDerivation => ({
      joint: { ...base, type, translationDof, rotationDof, translationRangeLdu, angleLimitsDeg, detentsDeg }, reasons: [],
    });
  if (ruleId === 'C01' || ruleId === 'TYRE_RIM') return model('RIGID', 0, 0);
  if (ruleId === 'BALL_SOCKET' || ruleId === 'TOWBALL_SOCKET') {
    if (male.rotationAllowed !== true || female.rotationAllowed !== true || male.slideAllowed !== false || female.slideAllowed !== false) return missing('Ball/socket motion and locked translation need explicit evidence.');
    const limits = intersectRanges(male.angleLimitsDeg, female.angleLimitsDeg);
    return limits ? model('SPHERICAL', 0, 3, null, limits) : missing('Spherical angular limits are unknown or contradictory.');
  }
  const sourceDeclaredBarClip = ruleId === 'BAR_CLIP';
  if (!sourceDeclaredBarClip && (male.slideAllowed === null || female.slideAllowed === null || male.rotationAllowed === null || female.rotationAllowed === null)) return missing('Sliding and rotation permissions are not established by the source.');
  if (sourceDeclaredBarClip && (male.rotationAllowed !== true || female.rotationAllowed !== true)) return missing('Round bar/clip roll is not established by both source endpoints.');
  if (ruleId === 'PIN_HOLE' && male.friction === 'UNKNOWN') return missing('Pin friction/retention is UNKNOWN; no rigid/revolute behaviour is inferred.');
  // LDCad clip semantics permit the declared male cylinder to slide when either
  // side declares slide=true; an omitted clip slide property is the documented
  // default false, not an unknown permission. Rotation is round-profile roll.
  const slide = sourceDeclaredBarClip ? male.slideAllowed === true || female.slideAllowed === true : male.slideAllowed === true && female.slideAllowed === true;
  const roll = male.rotationAllowed === true && female.rotationAllowed === true;
  if (ruleId === 'AXLE_KEYED') {
    if (roll || male.profile !== 'CROSS' || female.profile !== 'CROSS' || !male.symmetryOrder || !female.symmetryOrder) return missing('Keyed axle requires locked roll and an explicit CROSS symmetry.');
  }
  if (ruleId === 'WHEEL_MOUNT' && (slide || !roll)) return missing('A wheel mount requires evidenced axial retention and free axial rotation.');
  if (ruleId === 'RAIL_GROOVE' && (!slide || roll)) return missing('A slider must have evidenced axial sliding and locked rotation.');
  const hinge = ['HINGE', 'CLICK_HINGE', 'TURNTABLE'].includes(ruleId);
  if (hinge && (slide || !roll)) return missing('A hinge/turntable must lock translation and establish rotational motion.');
  const translations = slide ? axialSeatingRange(male, female) : null;
  if (slide && !translations) return missing('Axial spans do not establish a finite sliding range.');
  let angles: [number, number] | null = null, detents: number[] | null = null;
  if (roll) {
    angles = intersectRanges(male.angleLimitsDeg, female.angleLimitsDeg);
    if (!angles) return missing('Allowed angular range is unknown or contradictory.');
    if (ruleId === 'CLICK_HINGE') {
      if (!male.detentsDeg?.length || !female.detentsDeg?.length) return missing('Click-hinge detents must be explicitly sourced.');
      detents = [...new Set(male.detentsDeg)].filter(angle => female.detentsDeg!.includes(angle) && angle >= angles![0] && angle <= angles![1]).sort((a, b) => a - b);
      if (!detents.length) return missing('Click-hinge detent tables do not intersect.');
    }
  }
  return model(slide ? (roll ? 'CYLINDRICAL' : 'PRISMATIC') : (roll ? 'REVOLUTE' : 'RIGID'), slide ? 1 : 0, roll ? 1 : 0, translations, angles, detents);
}
