import type { ImportedConnectionPoint } from '../connections/types.js';
import { partDescriptionFor, SHADOW_REVISION, SHADOW_SOURCE_ROOT } from '../connections/importer.js';
import { connectionFrame } from './math.js';
import { adaptImportedConnection, isSourceDeclaredBarEndpoint, isSourceDeclaredClipEndpoint } from '../grammar/sources.js';
import { evaluateConnectorCompatibility } from '../grammar/rules.js';
import { CONNECTOR_GRAMMAR_VERSION } from '../grammar/schema.js';

export const CONNECTION_RULE_VERSION = `source-stud-2.0.0-${CONNECTOR_GRAMMAR_VERSION}`;
export const STANDARD_STUD_RULE_ID = 'ldcad-standard-stud-to-capped-underside-v1';
export const BAR_CLIP_RULE_ID = 'ldcad-source-declared-bar-clip-v1';

export interface CompatibilitySourceEvidence {
  kind: 'source-document' | 'source-directive' | 'implementation-policy';
  url: string;
  revision: string;
  file: string;
  line: number | null;
  sha256: string | null;
  note: string;
}

export interface CompatibilityResult {
  status: 'compatible' | 'incompatible' | 'unknown';
  ruleId: string | null;
  ruleVersion: string;
  reason: string;
  reasonCode: string;
  connectionType: 'standard-stud-underside' | 'bar-clip' | 'unsupported';
  axisRelation: 'same' | null;
  insertionDepthLdu: number | null;
  allowedTwistsDeg: number[];
  permittedTranslation: 'fully-seated' | 'sliding' | null;
  /** Numerical comparison tolerance, not a change to source dimensions. */
  toleranceLdu: number;
  sourceEvidence: CompatibilitySourceEvidence[];
}

const NUMERICAL_TOLERANCE_LDU = 0.0001;
const QUARTER_TURNS = [0, 90, 180, 270];

function pointEvidence(point: ImportedConnectionPoint): CompatibilitySourceEvidence {
  return { kind: 'source-directive', url: point.source.sourceUrl, revision: point.source.revision, file: point.source.path, line: point.source.line, sha256: point.source.sha256, note: point.source.raw };
}

function result(status: CompatibilityResult['status'], reasonCode: string, reason: string, points: ImportedConnectionPoint[]): CompatibilityResult {
  return { status, ruleId: null, ruleVersion: CONNECTION_RULE_VERSION, reason, reasonCode, connectionType: 'unsupported', axisRelation: null, insertionDepthLdu: null, allowedTwistsDeg: [], permittedTranslation: null, toleranceLdu: NUMERICAL_TOLERANCE_LDU, sourceEvidence: points.map(pointEvidence) };
}

function hasPinnedEvidence(point: ImportedConnectionPoint): boolean {
  return point.source.library === 'LDCadShadowLibrary' && point.source.revision === SHADOW_REVISION && point.source.license === 'CC-BY-SA-4.0' && /^[a-f0-9]{64}$/.test(point.source.sha256) && point.source.sourceUrl === `${SHADOW_SOURCE_ROOT}${point.source.path}` && Number.isInteger(point.source.line) && point.source.line > 0;
}

function sectionsAgreeWithSource(point: ImportedConnectionPoint): boolean {
  const sourceSections = /\[secs=([^\]]+)\]/i.exec(point.source.raw)?.[1]?.trim().split(/\s+/);
  if (!sourceSections || sourceSections.length !== point.sections.length * 3) return false;
  return point.sections.every((section, index) => sourceSections[index * 3] === section.profile && Number(sourceSections[index * 3 + 1]) === section.radius && Number(sourceSections[index * 3 + 2]) === section.length);
}


function descriptionEvidence(point: ImportedConnectionPoint): CompatibilitySourceEvidence | null {
  const description = partDescriptionFor(point);
  if (!description) return null;
  return { kind: 'source-document', url: description.source.sourceUrl, revision: description.source.revision,
    file: description.source.path, line: description.line, sha256: description.source.sha256, note: description.raw };
}

/** Native adapter for the source-declared BAR_CLIP rule. The bar identity and
 * the clip seat are both parsed evidence; the four quarter-turns are a
 * conservative discrete subset of the round joint, not a new fit claim. */
function barClipCompatibilityDiagnostics(fixed: ImportedConnectionPoint, moving: ImportedConnectionPoint): CompatibilityResult {
  const points = [fixed, moving];
  if (points.some((point) => !hasPinnedEvidence(point))) return result('unknown', 'source-unverified', 'compatibilityUnknown: connection source is not the pinned, hashed Shadow input.', points);
  if (points.some((point) => !point.dimensionsResolved || !connectionFrame(point))) return result('unknown', 'unresolved-connection-frame', 'compatibilityUnknown: connection frame or inherited section scaling is unresolved.', points);
  const male = fixed.gender === 'M' ? fixed : moving, female = fixed.gender === 'F' ? fixed : moving;
  if (male.gender === female.gender) return result('incompatible', 'same-mating-gender', 'Both connection endpoints have the same source mating gender.', points);
  if (!isSourceDeclaredBarEndpoint(male) || !isSourceDeclaredClipEndpoint(female)) return result('unknown', 'bar-clip-source-identity-unresolved', 'compatibilityUnknown: the male must be an official Bar part with a pinned male R4 SNAP_CYL and the female must be a pinned R4/L8 SNAP_CLP seat.', points);
  const span = (point: ImportedConnectionPoint): [number, number] | null => {
    const length = point.sections.length ? point.sections.reduce((sum, section) => sum + section.length, 0) : point.length;
    if (length === null || !Number.isFinite(length) || length <= 0) return null;
    return point.properties.center === 'true' ? [-length / 2, length / 2] : [0, length];
  };
  const maleSpan = span(male), femaleSpan = span(female);
  if (!maleSpan || !femaleSpan) return result('unknown', 'bar-clip-insertion-range-unresolved', 'compatibilityUnknown: the source axial spans needed for actual clip engagement are unresolved.', points);
  const insertionDepth = Math.max(0, Math.min(maleSpan[1], femaleSpan[1]) - Math.max(maleSpan[0], femaleSpan[0]));
  if (insertionDepth < 1 || insertionDepth > 8) return result('unknown', 'bar-clip-insertion-range-unresolved', 'compatibilityUnknown: the source axial spans do not overlap the declared 1..8 LDU clip seat.', points);
  const description = descriptionEvidence(male);
  return {
    ...result('compatible', 'source-declared-bar-clip', 'Pinned official Bar description and LDCad SNAP_CLP seat establish a round axial candidate; collision, retention, stress and physical build remain separate.', points),
    ruleId: BAR_CLIP_RULE_ID, connectionType: 'bar-clip', axisRelation: 'same', insertionDepthLdu: insertionDepth,
    allowedTwistsDeg: [...QUARTER_TURNS], permittedTranslation: 'sliding',
    sourceEvidence: [
      ...points.map(pointEvidence),
      ...(description ? [description] : []),
      { kind: 'source-document', url: 'https://www.melkert.net/LDCad/tech/meta', revision: 'LDCad-meta-documentation', file: 'LDCad SNAP_CLP semantics', line: null, sha256: null,
        note: 'SNAP_CLIP is female and tested against male cylinder shapes; radius is the clip inner radius and length its partial-hole width. This is source semantics, not physical verification.' },
      { kind: 'implementation-policy', url: 'docs/grammar/BAR_CLIP.md', revision: CONNECTION_RULE_VERSION, file: 'docs/grammar/BAR_CLIP.md', line: null, sha256: null,
        note: 'BAR identity requires the official LDraw Bar description and one male R4 source cylinder; CLIP requires SNAP_CLP R4/L8 center=true. Four quarter-turns are the conservative native graph subset. Friction/retention remain UNKNOWN.' },
    ],
  };
}

/**
 * Conservative first rule: the explicit source's normal LEGO stud, not arbitrary
 * male cylinders of the same radius. Other families need their own sourced
 * seating/deformation rules and currently return compatibilityUnknown.
 */
function sourceCompatibilityDiagnostics(fixed: ImportedConnectionPoint, moving: ImportedConnectionPoint): CompatibilityResult {
  const points = [fixed, moving];
  if (points.some((point) => !hasPinnedEvidence(point))) return result('unknown', 'source-unverified', 'compatibilityUnknown: connection source is not the pinned, hashed Shadow input.', points);
  if (points.some((point) => !point.dimensionsResolved || !connectionFrame(point))) return result('unknown', 'unresolved-connection-frame', 'compatibilityUnknown: connection frame or inherited section scaling is unresolved.', points);
  if (!fixed.gender || !moving.gender) return result('unknown', 'mating-gender-unresolved', 'compatibilityUnknown: the source does not establish both mating genders.', points);
  if (fixed.gender === moving.gender) return result('incompatible', 'same-mating-gender', 'Both connection endpoints have the same source mating gender.', points);
  if (points.some((point) => point.kind === 'clip')) return result('unknown', 'clip-bar-seating-unresolved', 'compatibilityUnknown: clip deformation, bar engagement and insertion path have not been validated.', points);
  if (points.some((point) => point.kind === 'generic' || point.group)) return result('unknown', 'grouped-interface-seating-unresolved', 'compatibilityUnknown: wheel/tyre or other grouped interface requires a verified seating rule beyond its matching group.', points);
  if (points.some((point) => point.kind !== 'cylinder' || !sectionsAgreeWithSource(point))) return result('unknown', 'source-sections-unresolved', 'compatibilityUnknown: supported source cylinder sections are unavailable or inconsistent.', points);
  if (points.some((point) => point.sections.some((section) => section.profile === 'A'))) return result('unknown', 'axle-insertion-unresolved', 'compatibilityUnknown: axle/hole key orientation, scaled length and insertion depth have not been validated.', points);
  const male = fixed.gender === 'M' ? fixed : moving, female = fixed.gender === 'F' ? fixed : moving;
  if (!['studC', 'studO'].includes(male.sourceId ?? '') || !/^p\/stud(?:2|2a)?\.dat$/.test(male.source.path)) return result('unknown', 'standard-stud-identity-unresolved', 'compatibilityUnknown: the male source is not an explicitly identified standard closed/open stud; cylinder radius alone is insufficient.', points);
  const maleSection = male.sections[0], femaleSection = female.sections[0];
  if (male.sections.length !== 1 || maleSection.profile !== 'R' || maleSection.radius !== 6 || maleSection.length !== 4 || male.properties.caps !== 'one' || male.properties.center === 'true' || male.properties.slide === 'true') return result('unknown', 'standard-stud-profile-unresolved', 'compatibilityUnknown: this stud profile, cap or seating origin differs from the validated R 6 4 source standard.', points);
  if (female.sourceId && female.sourceId !== 'aStud') return result('unknown', 'receiver-identity-unresolved', 'compatibilityUnknown: this named receiving interface is not covered by the ordinary underside rule.', points);
  if (female.sections.length !== 1 || !['R', 'S'].includes(femaleSection.profile) || female.properties.caps !== 'one' || female.properties.center === 'true' || female.properties.slide === 'true') return result('unknown', 'receiver-seating-unresolved', 'compatibilityUnknown: only one capped, non-sliding, non-centered underside section is currently supported.', points);
  if (!Number.isFinite(femaleSection.radius) || !Number.isFinite(femaleSection.length) || femaleSection.radius <= 0 || femaleSection.length <= 0) return result('unknown', 'receiver-dimensions-unresolved', 'compatibilityUnknown: receiver dimensions are not finite positive source values.', points);
  if (Math.abs(maleSection.radius - femaleSection.radius) > NUMERICAL_TOLERANCE_LDU) return result('incompatible', 'receiver-size-mismatch', 'The source receiving section does not match the standard stud size.', points);
  if (femaleSection.length + NUMERICAL_TOLERANCE_LDU < maleSection.length) return result('incompatible', 'receiver-depth-insufficient', 'The source receiving section is shorter than the complete standard stud insertion.', points);
  return {
    ...result('compatible', 'standard-stud-source-rule', 'Explicit standard stud and capped underside source sections permit a fully seated candidate; collision and assembly verification are still required.', points),
    ruleId: STANDARD_STUD_RULE_ID, connectionType: 'standard-stud-underside', axisRelation: 'same', insertionDepthLdu: maleSection.length,
    allowedTwistsDeg: [...QUARTER_TURNS], permittedTranslation: 'fully-seated',
    sourceEvidence: [
      ...points.map(pointEvidence),
      { kind: 'source-document', url: `${SHADOW_SOURCE_ROOT}CONTRIBUTING.md`, revision: SHADOW_REVISION, file: 'CONTRIBUTING.md', line: null, sha256: null, note: 'Rotation: all information points into negative Y at rest. IDs: studC/studO are the normal closed/open stud. Source stud and underside sections establish their dimensions and seating planes.' },
      { kind: 'implementation-policy', url: 'docs/ASSEMBLY_CONNECTION_RULES.md', revision: CONNECTION_RULE_VERSION, file: 'docs/ASSEMBLY_CONNECTION_RULES.md', line: null, sha256: null, note: 'Quarter-turn candidates are a conservative grid-preserving subset. No continuous rotation, sliding, deformation allowance or manufactured clearance is granted.' },
    ],
  };
}

/** Bridge the existing native graph format to the family grammar. Historical
 * diagnostics remain useful, but can never promote an UNKNOWN grammar result.
 * Other joint families need a native graph/document adapter before production. */
export function checkConnectionCompatibility(fixed: ImportedConnectionPoint, moving: ImportedConnectionPoint): CompatibilityResult {
  const grammar = evaluateConnectorCompatibility(adaptImportedConnection(fixed), adaptImportedConnection(moving));
  if (grammar.status === 'ILLEGAL') return result('incompatible', grammar.reasonCodes[0], grammar.reasons.join(' '), [fixed, moving]);
  const diagnostic = sourceCompatibilityDiagnostics(fixed, moving);
  if (grammar.status === 'COMPATIBLE' && grammar.ruleId === 'C01') return diagnostic;
  if (grammar.status === 'COMPATIBLE' && grammar.ruleId === 'BAR_CLIP') return barClipCompatibilityDiagnostics(fixed, moving);
  if (diagnostic.status !== 'compatible') return diagnostic;
  return result(grammar.status === 'INCOMPATIBLE' ? 'incompatible' : 'unknown', grammar.reasonCodes[0] ?? 'grammar-unknown', grammar.reasons.join(' '), [fixed, moving]);
}

export class ConnectionCompatibilityEngine {
  readonly version = CONNECTION_RULE_VERSION;
  check(fixed: ImportedConnectionPoint, moving: ImportedConnectionPoint): CompatibilityResult { return checkConnectionCompatibility(fixed, moving); }
}
