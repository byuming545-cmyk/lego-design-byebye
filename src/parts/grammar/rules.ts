import { finiteVector, isRotation, normalize, dot, cross, scale, subtract } from '../assembly/math.js';
import type { Matrix3 } from '../assembly/types.js';
import { SHADOW_REVISION, SHADOW_SOURCE_ROOT } from '../connections/importer.js';
import { deriveJointModel, intersectRanges } from './joints.js';
import type { Connector, ConnectorFamily, ConnectorProvenance, GrammarCompatibility, GrammarEvaluationOptions, GrammarRuleId } from './schema.js';

export interface ConnectorGrammarRule {
  id: GrammarRuleId; maleFamilies: readonly ConnectorFamily[]; femaleFamilies: readonly ConnectorFamily[];
  evidenceRequired: 'STANDARD_STUD_SOURCE' | 'VERIFIED_FIT';
}
/** Rules scale with connection families, never with part-pair count. */
export const CONNECTOR_GRAMMAR_RULES: readonly ConnectorGrammarRule[] = [
  { id: 'C01', maleFamilies: ['STUD', 'HOLLOW_STUD'], femaleFamilies: ['ANTISTUD'], evidenceRequired: 'STANDARD_STUD_SOURCE' },
  { id: 'BAR_CLIP', maleFamilies: ['BAR'], femaleFamilies: ['CLIP'], evidenceRequired: 'VERIFIED_FIT' },
  { id: 'BAR_RECEPTACLE', maleFamilies: ['BAR'], femaleFamilies: ['BAR_HOLE', 'ROUND_HOLE'], evidenceRequired: 'VERIFIED_FIT' },
  { id: 'PIN_HOLE', maleFamilies: ['PIN'], femaleFamilies: ['PIN_HOLE'], evidenceRequired: 'VERIFIED_FIT' },
  { id: 'AXLE_KEYED', maleFamilies: ['AXLE'], femaleFamilies: ['AXLE_HOLE'], evidenceRequired: 'VERIFIED_FIT' },
  { id: 'AXLE_ROUND', maleFamilies: ['AXLE'], femaleFamilies: ['ROUND_HOLE'], evidenceRequired: 'VERIFIED_FIT' },
  { id: 'HINGE', maleFamilies: ['HINGE_FINGER'], femaleFamilies: ['HINGE_FINGER'], evidenceRequired: 'VERIFIED_FIT' },
  { id: 'CLICK_HINGE', maleFamilies: ['CLICK_HINGE'], femaleFamilies: ['CLICK_HINGE'], evidenceRequired: 'VERIFIED_FIT' },
  { id: 'TURNTABLE', maleFamilies: ['TURNTABLE'], femaleFamilies: ['TURNTABLE'], evidenceRequired: 'VERIFIED_FIT' },
  { id: 'BALL_SOCKET', maleFamilies: ['BALL'], femaleFamilies: ['BALL_SOCKET'], evidenceRequired: 'VERIFIED_FIT' },
  { id: 'TOWBALL_SOCKET', maleFamilies: ['TOWBALL'], femaleFamilies: ['TOWBALL_SOCKET'], evidenceRequired: 'VERIFIED_FIT' },
  { id: 'WHEEL_MOUNT', maleFamilies: ['WHEEL_PIN'], femaleFamilies: ['WHEEL_HOLE'], evidenceRequired: 'VERIFIED_FIT' },
  { id: 'TYRE_RIM', maleFamilies: ['RIM_SEAT'], femaleFamilies: ['TYRE_SEAT'], evidenceRequired: 'VERIFIED_FIT' },
  { id: 'RAIL_GROOVE', maleFamilies: ['RAIL'], femaleFamilies: ['GROOVE'], evidenceRequired: 'VERIFIED_FIT' },
  { id: 'GENERIC_GROUP', maleFamilies: ['GENERIC_SPECIAL'], femaleFamilies: ['GENERIC_SPECIAL'], evidenceRequired: 'VERIFIED_FIT' },
] as const;

const FIT_AUTHORITIES: readonly ConnectorProvenance['kind'][] = ['VERIFIED_MANUAL', 'REAL_BUILD_VERIFIED', 'KNOWN_PAIRING', 'OFFICIAL_SHORTCUT', 'STUDIO_CONNECTIVITY'];
export function connectorFrame(feature: Connector): Matrix3 | null {
  if (!finiteVector(feature.axis) || !finiteVector(feature.localPositionLdu) || !Array.isArray(feature.localOrientation) || feature.localOrientation.length !== 9 || !feature.localOrientation.every(Number.isFinite)) return null;
  const direction = normalize(feature.axis);
  if (!direction) return null;
  // Do not use Gram-Schmidt to hide inherited stretching/shear. A reflected
  // source frame is permitted, but its physical dimensions must be unchanged.
  const m = feature.localOrientation, columns = [[m[0], m[3], m[6]], [m[1], m[4], m[7]], [m[2], m[5], m[8]]];
  if (columns.some(column => Math.abs(Math.hypot(...column) - 1) > 1e-5)
      || columns.some((column, i) => columns.some((other, j) => i !== j && Math.abs(column.reduce((sum, value, k) => sum + value * other[k], 0)) > 1e-5))
      || direction.some((value, i) => Math.abs(value + columns[1][i]) > 1e-5)) return null;
  const tangent: Connector['axis'] = [feature.localOrientation[0], feature.localOrientation[3], feature.localOrientation[6]];
  const x = normalize(subtract(tangent, scale(direction, dot(tangent, direction))));
  if (!x) return null;
  const y = scale(direction, -1), z = normalize(cross(x, y));
  if (!z) return null;
  const frame: Matrix3 = [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];
  return isRotation(frame) ? frame : null;
}
function evidenceValid(source: ConnectorProvenance, options: GrammarEvaluationOptions, verifiedFit: boolean): boolean {
  if (source.scope === 'ALGORITHM_FIXTURE' && !options.allowAlgorithmFixtures) return false;
  if (!source.id || !source.reference || !source.license || !source.sha256 || !/^[a-f0-9]{64}$/.test(source.sha256) || source.verification === 'UNVERIFIED') return false;
  if (source.kind === 'HEURISTIC' || source.kind === 'CONSERVATIVE_GEOMETRY_INFERENCE') return false;
  return !verifiedFit || source.verification === 'VERIFIED' && FIT_AUTHORITIES.includes(source.kind);
}
function policyEvidence(feature: Connector, options: GrammarEvaluationOptions, verifiedFit: boolean): boolean {
  const policy = feature.matchingPolicy;
  if (!policy?.evidenceSourceIds.length) return false;
  return policy.evidenceSourceIds.every(id => feature.sources.some(source => source.id === id && evidenceValid(source, options, verifiedFit)));
}
function numericDimensions(feature: Connector): boolean {
  return [feature.dimensions.radiusLdu, feature.dimensions.lengthLdu].every(value => value !== null && Number.isFinite(value) && value > 0);
}
function fitDimensions(feature: Connector, ruleId: GrammarRuleId): boolean {
  const positive = (value: number | null) => value !== null && Number.isFinite(value) && value > 0;
  const { radiusLdu, lengthLdu, widthLdu, heightLdu } = feature.dimensions;
  if ([radiusLdu, lengthLdu, widthLdu, heightLdu].some(value => value !== null && !positive(value))) return false;
  if (ruleId === 'BALL_SOCKET' || ruleId === 'TOWBALL_SOCKET') return positive(radiusLdu);
  if (ruleId === 'RAIL_GROOVE') return positive(lengthLdu) && positive(widthLdu) && positive(heightLdu);
  if (ruleId === 'GENERIC_GROUP') return !!feature.boundingShape && feature.boundingShape.dimensionsLdu.length > 0 && feature.boundingShape.dimensionsLdu.every(positive);
  if (ruleId === 'TYRE_RIM') return positive(radiusLdu) && positive(widthLdu);
  return numericDimensions(feature);
}
function standardStudSource(feature: Connector, options: GrammarEvaluationOptions): boolean {
  const policy = feature.matchingPolicy;
  if (!policy || policy.ruleId !== 'C01' || policy.kind !== 'STANDARD_STUD' || policy.profileId !== 'ldcad-standard-stud-to-capped-underside-v1'
      || policy.axisRelation !== 'SAME' || policy.seatingOffsetLdu !== 0 || !policyEvidence(feature, options, false)) return false;
  // A native reflected subfile can establish an ordinary circular source frame;
  // inherited stretching/shear may not masquerade as resolved dimensions.
  const frame = feature.localOrientation;
  const columns = [[frame[0], frame[3], frame[6]], [frame[1], frame[4], frame[7]], [frame[2], frame[5], frame[8]]];
  if (columns.some(column => Math.abs(Math.hypot(...column) - 1) > 1e-5)
      || columns.some((column, i) => columns.some((other, j) => i !== j && Math.abs(column.reduce((sum, value, k) => sum + value * other[k], 0)) > 1e-5))) return false;
  const axis = normalize(feature.axis);
  if (!axis || axis.some((value, i) => Math.abs(value + columns[1][i]) > 1e-5)) return false;
  return feature.sources.some(source => {
    if (source.kind !== 'LDCAD_SHADOW' || source.revision !== SHADOW_REVISION || !source.raw || !source.line || source.line < 1 || !source.reference.startsWith(SHADOW_SOURCE_ROOT)
        || !evidenceValid(source, options, false)) return false;
    const props = Object.fromEntries([...source.raw.matchAll(/\[([a-zA-Z][a-zA-Z0-9]*)=([^\]]*)\]/g)].map(match => [match[1].toLowerCase(), match[2].trim()]));
    const tokens = props.secs?.split(/\s+/) ?? [];
    if (!/^0\s+!LDCAD\s+SNAP_CYL\b/i.test(source.raw) || props.caps !== 'one' || props.center === 'true' || props.slide === 'true' || props.group
        || props.scale !== undefined && !['none', 'yonly'].includes(props.scale.toLowerCase())
        || props.center !== undefined && !['true', 'false'].includes(props.center)
        || props.slide !== undefined && !['true', 'false'].includes(props.slide)
        || tokens.length !== 3 || feature.dimensions.sections.length !== 1 || !numericDimensions(feature)) return false;
    const section = feature.dimensions.sections[0];
    if (tokens[0] !== section.profile || Number(tokens[1]) !== section.radiusLdu || Number(tokens[2]) !== section.lengthLdu
        || feature.dimensions.radiusLdu !== section.radiusLdu || feature.dimensions.lengthLdu !== section.lengthLdu) return false;
    if (feature.role === 'MALE') {
      return ['STUD', 'HOLLOW_STUD'].includes(feature.family) && feature.profile === 'ROUND' && props.gender === 'M' && ['studC', 'studO'].includes(props.id)
        && /^p\/stud(?:2|2a)?\.dat$/.test(source.reference.slice(SHADOW_SOURCE_ROOT.length)) && section.profile === 'R' && section.radiusLdu === 6 && section.lengthLdu === 4;
    }
    return feature.role === 'FEMALE' && feature.family === 'ANTISTUD' && ['ROUND', 'SQUARE'].includes(feature.profile) && props.gender === 'F'
      && (!props.id || props.id === 'aStud') && ['R', 'S'].includes(section.profile) && section.radiusLdu === 6 && section.lengthLdu >= 4;
  });
}

/** Single-feature recognition certifies a known grammar premise, not a trial
 * against a fabricated mate, and not a collision or physical-build result. */
export function inspectConnectorSupport(feature: Connector, options: GrammarEvaluationOptions = {}): { supported: boolean; ruleIds: GrammarRuleId[]; reasonCodes: string[] } {
  if (feature.coverage === 'NONE' || feature.confidence === 'UNKNOWN' || feature.confidence === 'HEURISTIC' || !connectorFrame(feature)) return { supported: false, ruleIds: [], reasonCodes: ['connector-evidence-incomplete'] };
  if (feature.matchingPolicy?.ruleId === 'C01' && standardStudSource(feature, options)) return { supported: true, ruleIds: ['C01'], reasonCodes: [] };
  return { supported: false, ruleIds: [], reasonCodes: [feature.matchingPolicy?.ruleId === 'C01' ? 'standard-stud-source-unverified' : 'family-rule-needs-verified-fit'] };
}
function status(a: Connector, b: Connector, outcome: GrammarCompatibility['status'], code: string, reason: string, ruleId: GrammarRuleId | null = null): GrammarCompatibility {
  return { status: outcome, ruleId, reasonCodes: [code], reasons: [reason], joint: null, axisRelation: null, insertionRangeLdu: null, allowedAnglesDeg: null,
    sourceIds: [...new Set([...a.sources, ...b.sources].map(source => source.id))], physicalBuildVerified: false };
}
function permittedFamilyPair(a: Connector, b: Connector): ConnectorGrammarRule | undefined {
  return CONNECTOR_GRAMMAR_RULES.find(rule => rule.maleFamilies.includes(a.family) && rule.femaleFamilies.includes(b.family));
}
/** Connector matching is independent of any part ID, native mesh or collision
 * search. Incomplete source semantics stay UNKNOWN, including equal radii/groups. */
export function evaluateConnectorCompatibility(a: Connector, b: Connector, options: GrammarEvaluationOptions = {}): GrammarCompatibility {
  const families = [a.family, b.family];
  if ((families.includes('STUD') || families.includes('HOLLOW_STUD')) && families.includes('PIN_HOLE')) return status(a, b, 'ILLEGAL', 'stud-to-technic-pin-hole-forbidden', 'Stud insertion into a Technic pin hole is explicitly forbidden.');
  if (a.units !== 'LDU' || b.units !== 'LDU') return status(a, b, 'UNKNOWN', 'units-unresolved', 'Canonical connector geometry must be expressed in LDU.');
  if (a.occupied || b.occupied) return status(a, b, 'INCOMPATIBLE', 'connector-occupied', 'An occupied feature cannot be mated again.');
  if ([a, b].some(feature => feature.confidence === 'HEURISTIC' || feature.confidence === 'UNKNOWN' || feature.coverage === 'NONE' || !connectorFrame(feature))) return status(a, b, 'UNKNOWN', 'connector-evidence-incomplete', 'A source-backed feature, finite position and resolved proper connection frame are required.');
  if (a.role === 'UNKNOWN' || b.role === 'UNKNOWN' || a.role === 'NEUTRAL' || b.role === 'NEUTRAL') return status(a, b, 'UNKNOWN', 'mating-role-unresolved', 'This rule requires explicit male/female mating roles.');
  if (a.role === b.role) return status(a, b, 'INCOMPATIBLE', 'same-mating-role', 'Both features have the same mating role.');
  const male = a.role === 'MALE' ? a : b, female = a.role === 'FEMALE' ? a : b;
  const rule = permittedFamilyPair(male, female);
  if (!rule) return status(a, b, 'UNKNOWN', 'family-pair-not-registered', 'There is no registered family rule for this pair; nominal size does not establish either fit or physical incompatibility.');
  const pa = male.matchingPolicy, pb = female.matchingPolicy;
  const fit = rule.evidenceRequired === 'VERIFIED_FIT';
  if (!pa || !pb || pa.ruleId !== rule.id || pb.ruleId !== rule.id || !policyEvidence(male, options, fit) || !policyEvidence(female, options, fit)) return status(a, b, 'UNKNOWN', 'mating-policy-unverified', 'The family is recognised, but its sourced seating/profile policy is not established.', rule.id);
  if (fit && (pa.kind !== 'VERIFIED_FIT' || pb.kind !== 'VERIFIED_FIT')) return status(a, b, 'UNKNOWN', 'fit-evidence-required', 'This family requires explicit verified fit evidence beyond a source group or radius.', rule.id);
  if (!pa.profileId || pa.profileId !== pb.profileId) return status(a, b, 'INCOMPATIBLE', 'mating-profile-mismatch', 'The evidenced interface profile/seat identities differ.', rule.id);
  if (pa.axisRelation !== pb.axisRelation || pa.seatingOffsetLdu !== pb.seatingOffsetLdu || !Number.isFinite(pa.seatingOffsetLdu)) return status(a, b, 'UNKNOWN', 'seating-policy-conflict', 'Sources disagree on axial relation or seating origin.', rule.id);
  if (rule.id === 'GENERIC_GROUP' && (!male.compatibilityGroup || male.compatibilityGroup !== female.compatibilityGroup)) return status(a, b, 'INCOMPATIBLE', 'generic-group-mismatch', 'A verified generic fit additionally requires the same compatible group.', rule.id);
  if (rule.id === 'C01') {
    if (!standardStudSource(male, options) || !standardStudSource(female, options) || male.profile !== 'ROUND' || !['ROUND', 'SQUARE'].includes(female.profile)
        || !numericDimensions(male) || !numericDimensions(female) || male.dimensions.radiusLdu !== 6 || male.dimensions.lengthLdu !== 4 || female.dimensions.radiusLdu !== 6 || female.dimensions.lengthLdu! < 4
        || male.slideAllowed === true || female.slideAllowed === true || pa.axisRelation !== 'SAME' || pa.seatingOffsetLdu !== 0) return status(a, b, 'UNKNOWN', 'standard-stud-semantics-unresolved', 'C01 is limited to the sourced ordinary R6×4 stud and capped R/S6 underside seating semantics.', rule.id);
  } else {
    if (!fitDimensions(male, rule.id) || !fitDimensions(female, rule.id)) return status(a, b, 'UNKNOWN', 'fit-dimensions-unresolved', 'Applicable source profile/envelope dimensions must remain explicit, finite and positive.', rule.id);
    if (['BAR_CLIP', 'BAR_RECEPTACLE', 'PIN_HOLE', 'WHEEL_MOUNT'].includes(rule.id) && (male.profile !== 'ROUND' || female.profile !== 'ROUND')) return status(a, b, 'INCOMPATIBLE', 'round-profile-mismatch', 'This axial fit rule requires sourced round profiles on both features.', rule.id);
    if (rule.id === 'HINGE' && (male.profile !== 'FINGER' || female.profile !== 'FINGER')) return status(a, b, 'INCOMPATIBLE', 'finger-profile-mismatch', 'The finger-hinge rule requires a sourced matching finger profile.', rule.id);
    if (rule.id === 'RAIL_GROOVE' && (male.profile !== 'RAIL' || female.profile !== 'RAIL')) return status(a, b, 'INCOMPATIBLE', 'rail-profile-mismatch', 'The prismatic rail rule requires a sourced matching rail/groove profile.', rule.id);
    if (rule.id === 'TYRE_RIM' && (male.profile !== 'SEAT' || female.profile !== 'SEAT')) return status(a, b, 'INCOMPATIBLE', 'seat-profile-mismatch', 'Tyre/rim fit requires the declared seat profile, not a pair of nearby cylindrical radii.', rule.id);
    if (['BALL_SOCKET', 'TOWBALL_SOCKET', 'BAR_CLIP', 'BAR_RECEPTACLE', 'PIN_HOLE', 'WHEEL_MOUNT', 'TYRE_RIM'].includes(rule.id)
        && male.dimensions.radiusLdu !== female.dimensions.radiusLdu) return status(a, b, 'UNKNOWN', 'fit-dimensions-conflict', 'Nominal fit radii disagree; no source-specific clearance/elastic allowance is registered.', rule.id);
    if (rule.id === 'AXLE_KEYED' && (male.profile !== 'CROSS' || female.profile !== 'CROSS')) return status(a, b, 'INCOMPATIBLE', 'keyed-profile-mismatch', 'An axle/keyed hole requires matching CROSS profiles.', rule.id);
    if (rule.id === 'AXLE_ROUND' && (male.profile !== 'CROSS' || female.profile !== 'ROUND')) return status(a, b, 'INCOMPATIBLE', 'bearing-profile-mismatch', 'The cylindrical bearing rule is separate from a keyed CROSS hole.', rule.id);
    if (['BALL_SOCKET', 'TOWBALL_SOCKET'].includes(rule.id) && (male.profile !== 'BALL' || female.profile !== 'BALL')) return status(a, b, 'INCOMPATIBLE', 'spherical-profile-mismatch', 'A ball/socket rule requires sourced spherical profiles.', rule.id);
  }
  const insertion = rule.id === 'C01' ? [4, 4] as [number, number] : intersectRanges(male.insertionRangeLdu, female.insertionRangeLdu);
  if (!insertion || insertion[0] <= 0) return status(a, b, 'UNKNOWN', 'insertion-range-unresolved', 'No positive finite engagement interval is established by both sources.', rule.id);
  const { joint, reasons } = deriveJointModel(rule.id, male, female);
  if (!joint) return { ...status(a, b, 'UNKNOWN', 'joint-semantics-unresolved', reasons.join(' '), rule.id), reasons };
  const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
  const symmetry = Number.isSafeInteger(male.symmetryOrder) && Number.isSafeInteger(female.symmetryOrder) && male.symmetryOrder! > 0 && female.symmetryOrder! > 0 ? gcd(male.symmetryOrder!, female.symmetryOrder!) : null;
  if (rule.id === 'AXLE_KEYED' && (!Number.isSafeInteger(symmetry) || symmetry! < 1 || symmetry! > 64)) return status(a, b, 'UNKNOWN', 'keyed-symmetry-unresolved', 'Keyed profile symmetry must be explicitly established.', rule.id);
  if (symmetry !== null && symmetry > 64) return status(a, b, 'UNKNOWN', 'profile-symmetry-budget', 'Source symmetry exceeds the bounded discrete pose budget.', rule.id);
  const allowedAnglesDeg = rule.id === 'C01' ? [0, 90, 180, 270] : joint.detentsDeg ?? (joint.rotationDof ? null : symmetry ? Array.from({ length: symmetry }, (_, i) => i * 360 / symmetry) : [0]);
  return { ...status(a, b, 'COMPATIBLE', 'family-rule-source-backed', 'Family/profile semantics produce a candidate pose family; collision, stress and stability remain separate.', rule.id),
    joint, axisRelation: pa.axisRelation, insertionRangeLdu: insertion, allowedAnglesDeg };
}

export class ConnectorGrammar {
  readonly rules = CONNECTOR_GRAMMAR_RULES;
  match(a: Connector, b: Connector, options?: GrammarEvaluationOptions) { return evaluateConnectorCompatibility(a, b, options); }
  /** Family index, not a library-wide part-pair trial table. */
  compatibleFamilies(family: ConnectorFamily): ConnectorFamily[] {
    return [...new Set(this.rules.flatMap(rule => rule.maleFamilies.includes(family) ? [...rule.femaleFamilies] : rule.femaleFamilies.includes(family) ? [...rule.maleFamilies] : []))];
  }
}
