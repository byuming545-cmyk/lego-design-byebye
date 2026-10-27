import { checkConnectionCompatibility } from './compatibility.js';
import { buildNativeCollisionProxy } from './proxy.js';
import { IDENTITY_TRANSFORM } from './math.js';
import { nativePartSourceHash } from './source.js';
import type { NativeAssemblyPart } from './types.js';
import type { ImportedConnectionPoint } from '../connections/types.js';

/** Reviewed source requests, not a wheel-fit table. IDs/roles confer no authority. */
export const WHEEL_REVIEW_PARTS = [
  { partId: '18975', role: 'holder' },
  { partId: '3673', role: 'pin' },
  { partId: '66727', role: 'rim' },
  { partId: '18977', role: 'tyre' },
] as const;

/** Distinguish ordinary stud compatibility from a mechanically certified fit.
 * Current compatibility rules do not implement pin retention or tyre/rim seating.
 * Source labels, radius similarity and group equality cannot supply that proof. */
export function inspectWheelMatingCandidate(fixed: ImportedConnectionPoint, moving: ImportedConnectionPoint) {
  const compatibility = checkConnectionCompatibility(fixed, moving);
  return {
    fixedConnectionId: fixed.id, movingConnectionId: moving.id,
    compatibilityStatus: compatibility.status,
    compatibilityReasonCode: compatibility.reasonCode,
    compatibilityRuleId: compatibility.ruleId,
    mechanicalRuleAccepted: false as const,
    reasonCode: compatibility.status === 'compatible' ? 'ordinary-stud-rule-does-not-prove-wheel-fit' : compatibility.reasonCode,
    reason: compatibility.status === 'compatible'
      ? 'An ordinary stud seating rule does not establish pin retention, tyre/rim seating, continuous rotation or installation clearance.'
      : compatibility.reason,
    sourceEvidence: compatibility.sourceEvidence,
  };
}

export interface WheelAssemblySourceAssessment {
  schemaVersion: 1;
  status: 'blocked';
  assessmentOnly: true;
  productionGeneratorEnabled: false;
  scope: 'source-interpretation-and-current-rule-preconditions';
  parts: Array<{
    partId: string; role: string; sourcePresent: boolean; sourceVerified: boolean; name: string | null;
    nativeSourceHash: string | null; geometryStatus: string; connectionStatus: string;
    geometryFiles: NativeAssemblyPart['geometry']['source']['files'];
    connectionFiles: NativeAssemblyPart['connections']['sourceFiles'];
    connectionPoints: NativeAssemblyPart['connections']['points'];
    connectionIssues: NativeAssemblyPart['connections']['issues'];
    collisionProxy: { status: 'ready' | 'blocked'; reasonCode: string; reason: string };
  }>;
  pairs: Array<{
    fixedPartId: string; movingPartId: string; endpointPairsChecked: number;
    ordinaryCompatiblePairs: number; mechanicallyCertifiedPairs: 0;
    reasonCounts: Record<string, number>; reasonCodes: string[];
    sourceMetadataEstablishesFit: false;
  }>;
  stages: Array<{ stage: string; status: 'passed' | 'blocked' | 'not-run'; reasonCodes: string[]; reason: string }>;
  reasonCodes: string[];
  reasons: string[];
  artifacts: { modelProduced: false; bomProduced: false; stepsProduced: false; exportReimportVerified: false };
  claims: { finalPoseVerified: false; rotationClearanceVerified: false; installationPathVerified: false; physicalBuildVerified: false };
  dataLicence: 'Connection-derived records retain CC-BY-SA-4.0; original LDraw file declarations remain applicable.';
}

/** No source edits, poses, collision exemptions or permissions are created here.
 * Actual mechanical candidates must first exist before pair clearance, rotation
 * sweeps or installation trajectories can be meaningfully tested. */
export async function assessWheelAssemblySources(
  loadPart: (partId: string) => Promise<NativeAssemblyPart | undefined>,
): Promise<WheelAssemblySourceAssessment> {
  const parts: WheelAssemblySourceAssessment['parts'] = [];
  const available = new Map<string, NativeAssemblyPart>();
  const reasonCodes = new Set<string>();
  const reasons = new Set<string>();
  for (const request of WHEEL_REVIEW_PARTS) {
    let part: NativeAssemblyPart | undefined;
    try { part = await loadPart(request.partId); }
    catch (error) {
      reasonCodes.add('wheel-source-load-failed');
      reasons.add(`${request.partId}: ${error instanceof Error ? error.message.slice(0, 500) : 'Native source loading failed.'}`);
    }
    if (!part) {
      reasonCodes.add('wheel-source-missing'); reasons.add(`${request.partId}: no pinned native source is available.`);
      parts.push({ ...request, sourcePresent: false, sourceVerified: false, name: null, nativeSourceHash: null, geometryStatus: 'missing', connectionStatus: 'missing',
        geometryFiles: [], connectionFiles: [], connectionPoints: [], connectionIssues: [],
        collisionProxy: { status: 'blocked', reasonCode: 'source-missing', reason: 'No substitute or similar part is loaded.' } });
      continue;
    }
    available.set(request.partId, part);
    const sourceVerified = part.partId === request.partId && part.geometry.partId === request.partId && part.connections.partId === request.partId &&
      part.geometry.source.rootFile === `parts/${request.partId}.dat` && part.geometry.source.integrity === 'verified' &&
      part.geometry.source.licenseStatus === 'complete' && part.geometry.source.files.length > 0 &&
      part.geometry.source.files.every(file => !!file.license && /^[a-f0-9]{64}$/.test(file.sha256));
    const proxy = buildNativeCollisionProxy(part, { instanceId: `wheel-source-${request.partId}`, partId: request.partId, transform: structuredClone(IDENTITY_TRANSFORM) });
    parts.push({ ...request, sourcePresent: true, sourceVerified, name: part.geometry.name, nativeSourceHash: nativePartSourceHash(part),
      geometryStatus: part.geometry.status, connectionStatus: part.connections.status,
      geometryFiles: structuredClone(part.geometry.source.files), connectionFiles: structuredClone(part.connections.sourceFiles),
      connectionPoints: structuredClone(part.connections.points), connectionIssues: structuredClone(part.connections.issues),
      collisionProxy: { status: proxy.status, reasonCode: proxy.reasonCode, reason: proxy.reason } });
    if (part.geometry.status !== 'geometryReady' || !sourceVerified) {
      reasonCodes.add('wheel-geometry-unverified'); reasons.add(`${request.partId}: native geometry is not verified.`);
    }
    if (part.connections.status !== 'ready') {
      reasonCodes.add(`wheel-connections-${part.connections.status}`);
      reasons.add(`${request.partId}: source connections are ${part.connections.status}; unsupported source syntax is not replaced with inferred endpoints.`);
    }
    if (proxy.status !== 'ready') {
      reasonCodes.add(`wheel-proxy-${proxy.reasonCode}`); reasons.add(`${request.partId}: ${proxy.reason}`);
    }
  }
  const pairs: WheelAssemblySourceAssessment['pairs'] = [];
  for (const [fixedPartId, movingPartId] of [['18975', '3673'], ['3673', '66727'], ['66727', '18977']]) {
    const fixed = available.get(fixedPartId), moving = available.get(movingPartId);
    const counts: Record<string, number> = {};
    let endpointPairsChecked = 0, ordinaryCompatiblePairs = 0;
    for (const a of fixed?.connections.points ?? []) for (const b of moving?.connections.points ?? []) {
      const inspected = inspectWheelMatingCandidate(a, b);
      endpointPairsChecked++;
      if (inspected.compatibilityStatus === 'compatible') ordinaryCompatiblePairs++;
      counts[inspected.reasonCode] = (counts[inspected.reasonCode] ?? 0) + 1;
    }
    if (!endpointPairsChecked) counts['wheel-mating-endpoint-missing'] = 1;
    pairs.push({ fixedPartId, movingPartId, endpointPairsChecked, ordinaryCompatiblePairs, mechanicallyCertifiedPairs: 0,
      reasonCounts: counts, reasonCodes: Object.keys(counts).sort(), sourceMetadataEstablishesFit: false });
  }
  reasonCodes.add('wheel-mechanical-rule-not-verified');
  reasonCodes.add('wheel-retention-tolerance-not-evidenced');
  reasonCodes.add('wheel-rotation-clearance-not-verified');
  reasonCodes.add('wheel-installation-path-not-verified');
  reasons.add('Current source-stud rules do not establish pin/hole insertion, pin retention or tyre/rim engagement. Shared groups, matching radii and visual contact are insufficient.');
  reasons.add('No source-backed manufactured tolerance, elastic deformation, interference allowance or complete wheel seating rule has been validated.');
  const sourcesReady = parts.every(part => part.sourcePresent && part.sourceVerified && part.geometryStatus === 'geometryReady');
  const connectorsReady = parts.every(part => part.connectionStatus === 'ready');
  const proxiesReady = parts.every(part => part.collisionProxy.status === 'ready');
  return {
    schemaVersion: 1, status: 'blocked', assessmentOnly: true, productionGeneratorEnabled: false,
    scope: 'source-interpretation-and-current-rule-preconditions', parts, pairs,
    stages: [
      { stage: 'native-source-import', status: sourcesReady ? 'passed' : 'blocked', reasonCodes: sourcesReady ? [] : ['wheel-source-missing-or-unverified'], reason: 'Checks actual named source geometry only; category names do not establish mechanical compatibility.' },
      { stage: 'connection-interpretation', status: connectorsReady ? 'passed' : 'blocked', reasonCodes: connectorsReady ? [] : ['wheel-connection-precondition-incomplete'], reason: 'All required mechanical endpoint syntax must be interpreted without invented profiles, grids or offsets.' },
      { stage: 'source-solid-proxies', status: proxiesReady ? 'passed' : 'blocked', reasonCodes: proxiesReady ? [] : ['wheel-solid-evidence-incomplete'], reason: 'An unresolved native shell cannot certify plastic clearance or justify filling a cavity.' },
      { stage: 'mechanical-mating-rule', status: 'blocked', reasonCodes: ['wheel-mechanical-rule-not-verified'], reason: 'No implemented source-backed wheel rule provides the required seating transform, insertion depth and occupancy semantics.' },
      { stage: 'final-pose-and-chassis-attachment', status: 'not-run', reasonCodes: ['wheel-legal-seating-candidate-unavailable'], reason: 'No complete mechanically valid wheel candidate exists for production attachment and graph validation.' },
      { stage: 'rotation-clearance', status: 'not-run', reasonCodes: ['wheel-rotation-clearance-not-verified'], reason: 'Static source geometry or a displayed wheel does not certify clearance over a rotation range.' },
      { stage: 'installation-trajectory', status: 'not-run', reasonCodes: ['wheel-installation-path-not-verified'], reason: 'A final pose cannot establish a swept whole-part insertion path or an elastic assembly process.' },
      { stage: 'model-bom-steps-export-reimport', status: 'not-run', reasonCodes: ['wheel-model-not-produced'], reason: 'No completed wheel module is counted, exported or represented as production-qualified.' },
      { stage: 'physical-construction', status: 'not-run', reasonCodes: ['physical-build-not-tested'], reason: 'No physical wheel module, manufacturing tolerance or retention test has been performed.' },
    ],
    reasonCodes: [...reasonCodes].sort(), reasons: [...reasons],
    artifacts: { modelProduced: false, bomProduced: false, stepsProduced: false, exportReimportVerified: false },
    claims: { finalPoseVerified: false, rotationClearanceVerified: false, installationPathVerified: false, physicalBuildVerified: false },
    dataLicence: 'Connection-derived records retain CC-BY-SA-4.0; original LDraw file declarations remain applicable.',
  };
}
