import type { ImportedConnectionPoint, ConnectionImportIssue, ConnectionSourceFile, ConnectionTransformEvidence } from '../connections/types.js';
import { partDescriptionFor, SHADOW_REVISION, SHADOW_SOURCE_ROOT } from '../connections/importer.js';
import { connectionFrame, finiteVector } from '../assembly/math.js';
import type { NativeAssemblyPart, Matrix3, Vector3 } from '../assembly/types.js';
import type { Connector, ConnectorCoverage, ConnectorDiagnostic, ConnectorFamily, ConnectorProvenance, ConnectorRole, ConnectorSourceKind } from './schema.js';

export const CONNECTOR_INGESTION_VERSION = 'native-connector-adapter-2-source-declared-bar-clip';
const STANDARD_PROFILE = 'ldcad-standard-stud-to-capped-underside-v1';
/** Official LDraw bar descriptions are length-denominated, e.g. "Bar  4L ...". */
export const OFFICIAL_BAR_DESCRIPTION = /^Bar\s+\d+(?:\.\d+)?L\b/i;
export function barClipProfileId(radius: number): string {
  return `ldcad-source-declared-round-bar-clip-r${radius}-v1`;
}

export interface UnknownConnectorInterface {
  code: string; message: string; featureId: string | null; sourceFile: string | null;
  sourceLine: number | null; raw: string | null; originalTypeId?: string;
  /** A literal directive type can identify a family without supplying its pose or fit. */
  familyHint?: ConnectorFamily;
  source?: ConnectionSourceFile;
  inheritedTransforms?: ConnectionTransformEvidence[];
  literalProperties?: { key: string; value: string }[];
}
export interface NativeConnectorEvidence {
  originalSourceId: string | null; originalKind: ImportedConnectionPoint['kind'];
  originalFamily: ImportedConnectionPoint['family']; properties: Record<string, string>;
  dimensionsFrame: 'source-local'; dimensionsResolved: boolean;
  source: ImportedConnectionPoint['source'];
}
export interface ConnectorIngestion {
  partId: string; connectors: Connector[]; coverage: ConnectorCoverage;
  diagnostics: ConnectorDiagnostic[]; unknownInterfaces: UnknownConnectorInterface[];
  /** Raw IDs, dimensions and full recursive affine evidence are never discarded. */
  rawEvidence: Record<string, NativeConnectorEvidence | { originalTypeId: string; raw: string } | {
    unparsed: true; raw: string | null; familyHint: ConnectorFamily | null;
    source: ConnectionSourceFile | null; inheritedTransforms: ConnectionTransformEvidence[];
    literalProperties: { key: string; value: string }[];
  }>;
  sourceSummary: Record<'LDCAD_SHADOW' | 'LDRAW_PRIMITIVE' | 'STUDIO_CONNECTIVITY' | 'VERIFIED_MANUAL', { sourceFiles: number; features: number }>;
}

function sourceId(point: ImportedConnectionPoint) { return `shadow:${point.source.path}:${point.source.line}:${point.source.sha256}`; }
function pinned(point: ImportedConnectionPoint) {
  return point.source.library === 'LDCadShadowLibrary' && point.source.revision === SHADOW_REVISION &&
    point.source.license === 'CC-BY-SA-4.0' && /^[a-f0-9]{64}$/.test(point.source.sha256) &&
    point.source.sourceUrl === `${SHADOW_SOURCE_ROOT}${point.source.path}` &&
    Number.isSafeInteger(point.source.line) && point.source.line > 0;
}
function sourceSectionsAgree(point: ImportedConnectionPoint) {
  const tokens = /\[secs=([^\]]+)\]/i.exec(point.source.raw)?.[1]?.trim().split(/\s+/);
  return !!tokens && tokens.length === point.sections.length * 3 && point.sections.every((section, index) =>
    section.profile === tokens[index * 3] && section.radius === Number(tokens[index * 3 + 1]) && section.length === Number(tokens[index * 3 + 2]));
}
function literalProperties(raw: string) {
  return [...raw.matchAll(/\[([a-zA-Z][a-zA-Z0-9]*)=([^\]]*)\]/g)].map(match => ({ key: match[1], value: match[2] }));
}
function sourceProperties(point: ImportedConnectionPoint): Record<string, string> {
  return Object.fromEntries(literalProperties(point.source.raw).map(property => [property.key.toLowerCase(), property.value.trim()]));
}
function descriptionPinned(point: ImportedConnectionPoint): boolean {
  const description = partDescriptionFor(point);
  return !!description && description.source.library === 'LDraw' && /^[a-f0-9]{64}$/.test(description.source.sha256) &&
    !!description.source.license &&
    Number.isSafeInteger(description.line) && description.line > 0 && !!description.text.trim() &&
    description.source.sourceUrl.endsWith(`/${description.source.path}`);
}
/** A BAR identity exists only where the pinned root LDraw description declares
 * a length-denominated Bar and one explicit male round source cylinder exists.
 * A radius, a title keyword or a mesh silhouette alone is never sufficient. */
export function isSourceDeclaredBarEndpoint(point: ImportedConnectionPoint): boolean {
  if (!pinned(point) || !descriptionPinned(point) || point.kind !== 'cylinder' || point.gender !== 'M' ||
      !point.dimensionsResolved || point.sections.length !== 1 || !!point.group || point.sourceId !== null) return false;
  const section = point.sections[0], props = sourceProperties(point);
  return OFFICIAL_BAR_DESCRIPTION.test(partDescriptionFor(point)!.text.trim()) &&
    /^0\s+!LDCAD\s+SNAP_CYL\b/i.test(point.source.raw) && sourceSectionsAgree(point) &&
    props.gender === 'M' && props.id === undefined && props.group === undefined &&
    section.profile === 'R' && section.radius === 4 && Number.isFinite(section.length) && section.length > 0 &&
    (props.caps === 'none' || props.caps === 'one') &&
    (props.scale === undefined || ['none', 'yonly'].includes(props.scale.toLowerCase()));
}
/** CLIP comes only from an explicit LDCad SNAP_CLP seat whose radius, length and
 * centered origin agree with the parsed source directive. */
export function isSourceDeclaredClipEndpoint(point: ImportedConnectionPoint): boolean {
  if (!pinned(point) || point.kind !== 'clip' || point.gender !== 'F' || !point.dimensionsResolved ||
      !!point.group || point.sourceId !== null || point.radius !== 4 || point.length !== 8) return false;
  const props = sourceProperties(point);
  return /^0\s+!LDCAD\s+SNAP_CLP\b/i.test(point.source.raw) &&
    props.radius === '4' && props.length === '8' && props.center === 'true' &&
    (props.slide === undefined || props.slide === 'true' || props.slide === 'false') &&
    (props.scale === undefined || ['none', 'yonly'].includes(props.scale.toLowerCase()));
}
function descriptionSource(point: ImportedConnectionPoint): ConnectorProvenance | null {
  if (!descriptionPinned(point)) return null;
  const description = partDescriptionFor(point)!;
  return { id: `ldraw:${description.source.path}:${description.line}:${description.source.sha256}`, kind: 'LDRAW_PRIMITIVE',
    reference: description.source.sourceUrl, revision: description.source.revision, sha256: description.source.sha256,
    license: description.source.license, line: description.line, raw: description.raw, verification: 'SOURCE_DECLARED',
    scope: 'PRODUCTION', notes: ['Top-level official LDraw part description retained as interface-identity evidence; it is not a mesh-derived connector or a physical-fit certificate.'] };
}
/** The conservative already implemented C01 interface rule, never a part-ID list. */
export function supportsStandardStudEndpoint(point: ImportedConnectionPoint): boolean {
  if (!pinned(point) || point.kind !== 'cylinder' || !point.dimensionsResolved || !connectionFrame(point) ||
      !sourceSectionsAgree(point) || point.sections.length !== 1 || point.group ||
      point.properties.caps !== 'one' || point.properties.center === 'true' || point.properties.slide === 'true') return false;
  const props = Object.fromEntries(literalProperties(point.source.raw).map(property => [property.key.toLowerCase(), property.value.trim()]));
  if (!/^0\s+!LDCAD\s+SNAP_CYL\b/i.test(point.source.raw) || props.gender !== point.gender || (props.id ?? null) !== point.sourceId ||
      props.caps !== 'one' || props.center === 'true' || props.slide === 'true' || props.group ||
      props.scale && !['none', 'yonly'].includes(props.scale.toLowerCase()) ||
      point.properties.scale && !['none', 'yonly'].includes(point.properties.scale.toLowerCase())) return false;
  const section = point.sections[0];
  if (!Number.isFinite(section.radius) || !Number.isFinite(section.length)) return false;
  if (point.gender === 'M') return ['studC', 'studO'].includes(point.sourceId ?? '') &&
    /^p\/stud(?:2|2a)?\.dat$/.test(point.source.path) && section.profile === 'R' && section.radius === 6 && section.length === 4;
  return point.gender === 'F' && (!point.sourceId || point.sourceId === 'aStud') &&
    ['R', 'S'].includes(section.profile) && section.radius === 6 && section.length >= 4;
}

function family(point: ImportedConnectionPoint): ConnectorFamily {
  if (isSourceDeclaredBarEndpoint(point)) return 'BAR';
  if (isSourceDeclaredClipEndpoint(point)) return 'CLIP';
  if (point.kind === 'clip') return 'CLIP';
  // A group is retained as a group; it does not establish a wheel seat or fit.
  if (point.kind === 'generic') return 'GENERIC_SPECIAL';
  const id = point.sourceId;
  if (point.sections.some(section => section.profile === 'A')) return point.gender === 'M' ? 'AXLE' : point.gender === 'F' ? 'AXLE_HOLE' : 'GENERIC_SPECIAL';
  if (point.gender === 'M' && id === 'studO') return 'HOLLOW_STUD';
  if (point.gender === 'M' && ['studC', 'stud2', 'stud3'].includes(id ?? '')) return 'STUD';
  if (point.gender === 'F' && (id === 'aStud' || supportsStandardStudEndpoint(point))) return 'ANTISTUD';
  if (['connhole', 'connhol3'].includes(id ?? '') && point.gender === 'F') return 'PIN_HOLE';
  if (['conn4', 'fpin10', 'fpin11', 'pin8'].includes(id ?? '') && point.gender === 'M') return 'PIN';
  if (id === 'wpAxHole' && point.gender === 'F') return 'WHEEL_HOLE';
  if (id && /^axleHole(?:2|3)?$/.test(id) && point.gender === 'F') return 'AXLE_HOLE';
  if (id === 'axle' && point.gender === 'M') return 'AXLE';
  // R4 is not evidence of BAR, and an anonymous round cavity is not automatically
  // a bar receptacle, axle bearing, pin hole, rim seat or friction connection.
  return 'GENERIC_SPECIAL';
}
function profile(point: ImportedConnectionPoint): Connector['profile'] {
  if (point.kind === 'clip') return 'ROUND';
  const profiles = new Set(point.sections.map(section => section.profile));
  if (profiles.size === 1 && profiles.has('A')) return 'CROSS';
  if (profiles.size === 1 && profiles.has('R')) return 'ROUND';
  if (profiles.size === 1 && profiles.has('S')) return 'SQUARE';
  return point.kind === 'generic' ? 'GENERIC' : 'UNKNOWN';
}
function source(point: ImportedConnectionPoint): ConnectorProvenance {
  return { id: sourceId(point), kind: 'LDCAD_SHADOW', reference: point.source.sourceUrl,
    revision: point.source.revision, sha256: point.source.sha256, license: point.source.license,
    line: point.source.line, raw: point.source.raw, verification: 'SOURCE_DECLARED', scope: 'PRODUCTION',
    notes: ['Original source ID: ' + (point.sourceId ?? '(unnamed)'), 'Source-local dimensions; inherited transforms remain in ingestion.rawEvidence.', 'Parsed source metadata is not a physical-fit or build certificate.'] };
}
const standardEvidence = (): ConnectorProvenance => ({ id: 'policy:' + STANDARD_PROFILE, kind: 'KNOWN_PAIRING',
  reference: 'docs/ASSEMBLY_CONNECTION_RULES.md', revision: 'source-stud-1.0.0', sha256: null,
  license: null, line: null, raw: null, verification: 'SOURCE_DECLARED', scope: 'PRODUCTION',
  notes: ['Existing interface-level C01 seating policy, not a part-pair whitelist or physical build claim.', 'Normal-stud fully seated connections use zero mechanical DOF and conservative quarter-turn candidates.'] });

export function adaptImportedConnection(point: ImportedConnectionPoint): Connector {
  const bar = isSourceDeclaredBarEndpoint(point), clip = isSourceDeclaredClipEndpoint(point);
  const sourceDeclaredFit = bar || clip;
  const supported = supportsStandardStudEndpoint(point) || sourceDeclaredFit;
  const canonicalFamily = family(point), canonicalProfile = profile(point);
  const diagnostics: ConnectorDiagnostic[] = [], unknownFields: string[] = [];
  const totalLength = point.sections.length ? point.sections.reduce((sum, section) => sum + section.length, 0) : point.length;
  const radius = point.sections.length === 1 ? point.sections[0].radius : point.radius;
  if (!point.dimensionsResolved) { unknownFields.push('effectiveDimensions'); diagnostics.push({ code: 'INHERITED_DIMENSIONS_UNRESOLVED', message: 'The native importer did not resolve the inherited physical section dimensions.', featureId: point.id }); }
  if (!pinned(point)) { unknownFields.push('sourceIntegrity'); diagnostics.push({ code: 'SOURCE_NOT_PINNED', message: 'Endpoint provenance does not match the pinned licensed Shadow input.', featureId: point.id }); }
  if (canonicalFamily === 'GENERIC_SPECIAL' && !point.group) { unknownFields.push('canonicalFamily'); diagnostics.push({ code: 'CANONICAL_FAMILY_UNRESOLVED', message: 'A shape/radius alone does not identify this source interface family.', featureId: point.id }); }
  if (!supported) unknownFields.push('matingPolicy', 'insertionRange', 'rotationLimits', 'friction');
  else if (sourceDeclaredFit) unknownFields.push('friction', 'retention');
  const centered = point.properties.center === 'true';
  const axialSpan = point.dimensionsResolved && totalLength !== null && Number.isFinite(totalLength)
    ? (centered ? [-totalLength / 2, totalLength / 2] : [0, totalLength]) as [number, number] : null;
  const coverage: ConnectorCoverage = supported ? 'COMPLETE' : 'PARTIAL';
  const description = bar ? descriptionSource(point) : null;
  const policy = supportsStandardStudEndpoint(point)
    ? { ruleId: 'C01' as const, kind: 'STANDARD_STUD' as const, profileId: STANDARD_PROFILE,
        evidenceSourceIds: [sourceId(point)], axisRelation: 'SAME' as const, seatingOffsetLdu: 0 }
    : sourceDeclaredFit
      ? { ruleId: 'BAR_CLIP' as const, kind: 'SOURCE_DECLARED_FIT' as const, profileId: barClipProfileId(radius ?? 4),
          evidenceSourceIds: [sourceId(point), ...(description ? [description.id] : [])], axisRelation: 'SAME' as const, seatingOffsetLdu: 0 }
      : null;
  return {
    featureId: point.id, sourceConnectionId: point.id, family: canonicalFamily,
    role: point.gender === 'M' ? 'MALE' : point.gender === 'F' ? 'FEMALE' : 'UNKNOWN', units: 'LDU',
    localPositionLdu: [...point.position], localOrientation: [...point.orientation], axis: [...point.direction],
    profile: canonicalProfile,
    dimensions: { radiusLdu: radius, lengthLdu: totalLength, widthLdu: null, heightLdu: null,
      sections: point.sections.map(section => ({ profile: section.profile, radiusLdu: section.radius, lengthLdu: section.length })) },
    axialSpanLdu: axialSpan,
    // caps=one does not, by itself, identify a physical cap end for every family.
    capStart: point.properties.caps === 'none' ? false : null,
    capEnd: point.properties.caps === 'none' ? false : null,
    insertionRangeLdu: !supported ? null : sourceDeclaredFit ? [1, 8] : [4, 4],
    slideAllowed: sourceDeclaredFit ? (point.properties.slide === 'true' ? true : point.properties.slide === 'false' ? false : null) : supported ? false : point.properties.slide === 'true' ? true : point.properties.slide === 'false' ? false : null,
    rotationAllowed: sourceDeclaredFit ? true : supported ? false : null,
    symmetryOrder: canonicalProfile === 'CROSS' || canonicalProfile === 'SQUARE' ? 4 : null,
    friction: 'UNKNOWN', angleLimitsDeg: sourceDeclaredFit ? [0, 360] : null, detentsDeg: null, compatibilityGroup: point.group,
    occupied: false, contactSurface: null, entryFace: null,
    matchingPolicy: policy,
    sources: [source(point), ...(description ? [description] : []), ...(supportsStandardStudEndpoint(point) ? [standardEvidence()] : [])],
    confidence: pinned(point) ? 'SOURCE_BACKED' : 'UNKNOWN', coverage, unknownFields,
    diagnostics, notes: ['Native source-local sections are retained without guessed clearance, effective scaling or physical friction.',
      ...(sourceDeclaredFit ? ['BAR identity comes from the pinned top-level official LDraw description; the fit seat comes from the explicit LDCad source directive. Motion/friction remain separate from physical verification.'] : [])],
  };
}

function issueDiagnostic(issue: ConnectionImportIssue): ConnectorDiagnostic {
  return { code: 'LDCAD_' + issue.code.toUpperCase().replaceAll('-', '_'), message: `${issue.file}${issue.line ? ':' + issue.line : ''}: ${issue.message}` };
}
export function adaptNativePartConnectors(part: NativeAssemblyPart): ConnectorIngestion {
  const connectors = part.connections.points.map(adaptImportedConnection);
  const diagnostics = [...part.connections.issues.map(issueDiagnostic), ...connectors.flatMap(connector => connector.diagnostics)];
  const unknownInterfaces: UnknownConnectorInterface[] = part.connections.issues.map(issue => ({ code: issue.code,
    message: issue.message, featureId: null, sourceFile: issue.file, sourceLine: issue.line ?? null, raw: issue.directive ?? null,
    ...(/^0\s+!LDCAD\s+SNAP_FGR\b/i.test(issue.directive ?? '') ? { familyHint: 'HINGE_FINGER' as const } : {}),
    ...(issue.source ? { source: structuredClone(issue.source) } : {}),
    inheritedTransforms: structuredClone(issue.transforms ?? []), literalProperties: literalProperties(issue.directive ?? '') }));
  for (const connector of connectors) if (connector.coverage !== 'COMPLETE') unknownInterfaces.push({ code: 'CONNECTOR_SEMANTICS_PARTIAL',
    message: connector.unknownFields.join(', '), featureId: connector.featureId, sourceFile: connector.sources[0]?.reference ?? null,
    sourceLine: connector.sources[0]?.line ?? null, raw: connector.sources[0]?.raw ?? null });
  return { partId: part.partId, connectors,
    coverage: !connectors.length ? 'NONE' : part.connections.status === 'ready' && connectors.every(connector => connector.coverage === 'COMPLETE') ? 'COMPLETE' : 'PARTIAL',
    diagnostics, unknownInterfaces,
    rawEvidence: { ...Object.fromEntries(part.connections.points.map(point => [point.id, {
      originalSourceId: point.sourceId, originalKind: point.kind, originalFamily: point.family,
      properties: { ...point.properties }, dimensionsFrame: point.dimensionsFrame, dimensionsResolved: point.dimensionsResolved,
      source: structuredClone(point.source),
    }])), ...Object.fromEntries(part.connections.issues.map((issue, index) => [`unparsed:${issue.file}:${issue.line ?? 0}:${index}`, {
      unparsed: true as const, raw: issue.directive ?? null,
      familyHint: /^0\s+!LDCAD\s+SNAP_FGR\b/i.test(issue.directive ?? '') ? 'HINGE_FINGER' as const : null,
      source: issue.source ? structuredClone(issue.source) : null,
      inheritedTransforms: structuredClone(issue.transforms ?? []), literalProperties: literalProperties(issue.directive ?? ''),
    }])) },
    sourceSummary: {
      LDCAD_SHADOW: { sourceFiles: part.connections.sourceFiles.filter(source => source.library === 'LDCadShadowLibrary').length, features: connectors.length },
      LDRAW_PRIMITIVE: { sourceFiles: part.geometry.source.files.length, features: 0 },
      STUDIO_CONNECTIVITY: { sourceFiles: 0, features: 0 }, VERIFIED_MANUAL: { sourceFiles: 0, features: 0 },
    },
  };
}

export const CONNECTOR_SOURCE_PRIORITY: Readonly<Record<ConnectorSourceKind, number>> = Object.freeze({
  REAL_BUILD_VERIFIED: 100, VERIFIED_MANUAL: 95, STUDIO_CONNECTIVITY: 80, LDCAD_SHADOW: 80,
  LDRAW_PRIMITIVE: 60, OFFICIAL_SHORTCUT: 60, KNOWN_PAIRING: 60, CONSERVATIVE_GEOMETRY_INFERENCE: 20, HEURISTIC: 10,
});
function semanticSignature(connector: Connector) {
  const { sources: _sources, notes: _notes, diagnostics: _diagnostics, confidence: _confidence, ...semantics } = connector;
  const policy = semantics.matchingPolicy ? { ...semantics.matchingPolicy, evidenceSourceIds: [] } : null;
  return JSON.stringify({ ...semantics, matchingPolicy: policy });
}
export interface ConnectorSourceMerge {
  connectors: Connector[]; diagnostics: ConnectorDiagnostic[];
  conflicts: { featureId: string; retained: Connector; candidate: Connector; resolution: 'QUARANTINED' | 'EXPLICIT_VERIFIED_OVERRIDE' }[];
}
/** Only trusted, reviewed server-side override source IDs may resolve a conflict.
 * This option is not wired to request bodies or environment variables. */
export function mergeConnectorSources(base: readonly Connector[], additions: readonly Connector[], options: { approvedOverrideSourceIds?: ReadonlySet<string> } = {}): ConnectorSourceMerge {
  const output = new Map<string, Connector>(), diagnostics: ConnectorDiagnostic[] = [], conflicts: ConnectorSourceMerge['conflicts'] = [];
  for (const connector of [...base, ...additions]) {
    const previous = output.get(connector.featureId);
    if (!previous) { output.set(connector.featureId, structuredClone(connector)); continue; }
    if (semanticSignature(previous) === semanticSignature(connector)) {
      const combined = new Map([...previous.sources, ...connector.sources].map(source => [source.id, source]));
      output.set(connector.featureId, { ...previous, sources: [...combined.values()] }); continue;
    }
    const previousPriority = Math.max(...previous.sources.map(source => CONNECTOR_SOURCE_PRIORITY[source.kind]), 0);
    const approved = connector.sources.find(source => ['VERIFIED_MANUAL', 'REAL_BUILD_VERIFIED'].includes(source.kind) &&
      source.verification === 'VERIFIED' && source.scope === 'PRODUCTION' && source.sha256 && /^[a-f0-9]{64}$/.test(source.sha256) &&
      options.approvedOverrideSourceIds?.has(source.id) && CONNECTOR_SOURCE_PRIORITY[source.kind] > previousPriority);
    const resolution = approved ? 'EXPLICIT_VERIFIED_OVERRIDE' : 'QUARANTINED';
    conflicts.push({ featureId: connector.featureId, retained: structuredClone(previous), candidate: structuredClone(connector), resolution });
    diagnostics.push({ code: approved ? 'EXPLICIT_SOURCE_OVERRIDE' : 'CONNECTOR_SOURCE_CONFLICT', featureId: connector.featureId,
      message: approved ? 'A trusted reviewed override resolves this conflict; both original assertions remain recorded.' : 'Conflicting source semantics were retained and quarantined; no silent priority overwrite.',
      sourceIds: [...previous.sources, ...connector.sources].map(source => source.id) });
    output.set(connector.featureId, approved ? structuredClone(connector) : { ...previous, coverage: 'PARTIAL', matchingPolicy: null,
      sources: [...previous.sources, ...connector.sources], unknownFields: [...new Set([...previous.unknownFields, 'sourceConflict'])] });
  }
  return { connectors: [...output.values()], diagnostics, conflicts };
}

export interface StudioMetadataRecord {
  featureId: string; originalTypeId: string | number; localPositionLdu: Vector3; localOrientation: Matrix3; axis: Vector3;
  raw: string; dimensions?: Partial<Connector['dimensions']>; axialSpanLdu?: [number, number];
  properties?: Record<string, string>;
}
export interface StudioAccessGrant {
  permissionConfirmed: boolean; redistributionAllowed: boolean; license: string | null;
  reference: string; revision: string | null; artifactSha256: string;
}
export interface ReviewedStudioTypeMapping {
  originalTypeId: string; family: ConnectorFamily; role: ConnectorRole; profile: Connector['profile'];
  evidence: ConnectorProvenance;
}
/** Adapter for legally obtained, already decoded Studio metadata. This is NOT an
 * undocumented .conn binary parser or a built-in community numeric-ID mapping. */
export function adaptStudioConnectivity(records: readonly StudioMetadataRecord[], grant: StudioAccessGrant, mappings: readonly ReviewedStudioTypeMapping[] = []): ConnectorIngestion {
  const diagnostics: ConnectorDiagnostic[] = [], unknownInterfaces: UnknownConnectorInterface[] = [], connectors: Connector[] = [], rawEvidence: ConnectorIngestion['rawEvidence'] = {};
  const allowed = grant.permissionConfirmed && grant.redistributionAllowed && !!grant.license && /^[a-f0-9]{64}$/.test(grant.artifactSha256);
  const featureIds = new Set<string>();
  for (const [index, record] of records.entries()) {
    const typeId = String(record.originalTypeId);
    const duplicate = featureIds.has(record.featureId);
    // Without permission, retain identity/diagnostics only, not proprietary bytes.
    rawEvidence[duplicate ? `duplicate:${record.featureId}:${index}` : record.featureId] = { originalTypeId: typeId, raw: allowed ? record.raw : '' };
    featureIds.add(record.featureId);
    if (!allowed) { unknownInterfaces.push({ code: 'STUDIO_PERMISSION_UNCONFIRMED', message: 'No confirmed reusable Studio resource grant.', featureId: record.featureId, originalTypeId: typeId, sourceFile: grant.reference, sourceLine: null, raw: null }); continue; }
    if (duplicate) {
      diagnostics.push({ code: 'STUDIO_DUPLICATE_FEATURE_ID', featureId: record.featureId, message: 'Duplicate decoded feature identity was retained for review, not silently overwritten.' });
      unknownInterfaces.push({ code: 'STUDIO_DUPLICATE_FEATURE_ID', message: 'Decoded source repeats a feature ID.', featureId: record.featureId, originalTypeId: typeId, sourceFile: grant.reference, sourceLine: null, raw: record.raw });
      continue;
    }
    if (!finiteVector(record.localPositionLdu) || !finiteVector(record.axis) || record.localOrientation.length !== 9 || !record.localOrientation.every(Number.isFinite)) {
      diagnostics.push({ code: 'STUDIO_INVALID_FRAME', featureId: record.featureId, message: 'Decoded Studio frame is invalid; no replacement connector was emitted.' }); continue;
    }
    const mapping = mappings.find(mapping => mapping.originalTypeId === typeId && mapping.evidence.verification === 'VERIFIED' &&
      mapping.evidence.scope === 'PRODUCTION' && !!mapping.evidence.sha256 && /^[a-f0-9]{64}$/.test(mapping.evidence.sha256));
    const provenance: ConnectorProvenance = { id: `studio:${grant.artifactSha256}:${record.featureId}`, kind: 'STUDIO_CONNECTIVITY',
      reference: grant.reference, revision: grant.revision, sha256: grant.artifactSha256, license: grant.license,
      line: null, raw: record.raw, verification: 'SOURCE_DECLARED', scope: 'PRODUCTION', notes: ['Original Studio type ID: ' + typeId, 'Decoded metadata supplied by a permitted source workflow; no unverified numeric mapping is treated as standard.'] };
    connectors.push({ featureId: record.featureId, sourceConnectionId: null, family: mapping?.family ?? 'GENERIC_SPECIAL',
      role: mapping?.role ?? 'UNKNOWN', units: 'LDU', localPositionLdu: [...record.localPositionLdu], localOrientation: [...record.localOrientation], axis: [...record.axis],
      profile: mapping?.profile ?? 'UNKNOWN', dimensions: { radiusLdu: null, lengthLdu: null, widthLdu: null, heightLdu: null, sections: [], ...record.dimensions },
      axialSpanLdu: record.axialSpanLdu ? [...record.axialSpanLdu] : null, capStart: null, capEnd: null,
      insertionRangeLdu: null, slideAllowed: null, rotationAllowed: null, symmetryOrder: null, friction: 'UNKNOWN',
      angleLimitsDeg: null, detentsDeg: null, compatibilityGroup: record.properties?.group ?? null, occupied: false,
      contactSurface: null, entryFace: null, matchingPolicy: null, sources: mapping ? [provenance, mapping.evidence] : [provenance],
      confidence: mapping ? 'SOURCE_BACKED' : 'UNKNOWN', coverage: 'PARTIAL', unknownFields: mapping ? ['matingPolicy'] : ['canonicalFamily', 'matingPolicy'], diagnostics: [],
      notes: ['Raw type identity is retained. Identifying a Studio type does not establish its complete mating, insertion or motion semantics.'] });
    if (!mapping) unknownInterfaces.push({ code: 'STUDIO_TYPE_MAPPING_UNRESOLVED', message: 'No reviewed mapping for the raw Studio type.', featureId: record.featureId, originalTypeId: typeId, sourceFile: grant.reference, sourceLine: null, raw: record.raw });
  }
  if (!allowed) diagnostics.push({ code: 'STUDIO_PERMISSION_UNCONFIRMED', message: 'Studio resources cannot be copied, interpreted as trusted production connectors or redistributed without confirmed rights.' });
  return { partId: 'decoded-studio-metadata', connectors, coverage: connectors.length ? 'PARTIAL' : 'NONE', diagnostics, unknownInterfaces, rawEvidence,
    sourceSummary: { LDCAD_SHADOW: { sourceFiles: 0, features: 0 }, LDRAW_PRIMITIVE: { sourceFiles: 0, features: 0 }, STUDIO_CONNECTIVITY: { sourceFiles: allowed ? 1 : 0, features: connectors.length }, VERIFIED_MANUAL: { sourceFiles: 0, features: 0 } } };
}
