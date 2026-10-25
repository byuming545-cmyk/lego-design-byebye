import { assertDigitalPartOrigin } from '../provenance.js';
import { nativePartSourceHash } from '../assembly/source.js';
import { physicalConnectionSignature } from '../assembly/interfaces.js';
import type { NativeAssemblyPart } from '../assembly/types.js';
import { DIGITAL_IMPORT_STAGES, type DigitalImportAdapters, type DigitalImportPilotReport, type DigitalImportRequest, type DigitalImportResult, type DigitalImportStageName } from './types.js';
import { checkDigitalSourceAdmission } from './sources.js';

export const DIGITAL_IMPORT_PIPELINE_VERSION = 'source-backed-digital-import-1';
const errorMessage = (error: unknown) => error instanceof Error ? error.message.slice(0, 600) : 'Unknown digital source failure.';

function initialResult(request: DigitalImportRequest): DigitalImportResult {
  return {
    requestId: request.requestId, originalIdentity: structuredClone(request.originalIdentity), nativePartId: request.nativePartId,
    identityStatus: request.identityStatus, identityEvidence: [...request.identityEvidence], demandEvidence: structuredClone(request.demandEvidence),
    stages: DIGITAL_IMPORT_STAGES.map(stage => ({ stage, status: 'skipped', reasonCodes: ['prerequisite-not-completed'], reasons: ['An earlier stage has not established the required evidence.'] })),
    source: null,
    geometry: { status: 'not-imported', rootFile: null, sourceVersion: null, files: [], dependencies: [], triangleCount: 0 },
    connections: { status: 'not-imported', pointCount: 0, sourceFiles: [], issues: [] },
    nativeSourceHash: null,
    assembly: { status: 'not-run', evidenceOrigin: null, sourceDigest: null, verifiedConnectionIds: [], fixtureTestsPassed: 0, fixtureTestsTotal: 0, reasonCodes: [], reasons: [] },
    stagingLibraryAllowed: false, productionGeneratorAllowed: false, productionConnectionIds: [], physicalBuildVerified: false,
  };
}

function stage(result: DigitalImportResult, name: DigitalImportStageName, status: 'passed' | 'blocked', code: string, reason: string) {
  Object.assign(result.stages.find(item => item.stage === name)!, { status, reasonCodes: [code], reasons: [reason] });
}

function finiteNativeGeometry(part: NativeAssemblyPart): boolean {
  const { mesh, bounds } = part.geometry;
  return !!mesh && !!bounds && mesh.positions.length > 0 && mesh.indices.length >= 3 && mesh.indices.length % 3 === 0 &&
    mesh.positions.every(point => point.length === 3 && point.every(Number.isFinite) && point.every((n, axis) => n >= bounds.min[axis] - 1e-7 && n <= bounds.max[axis] + 1e-7)) &&
    mesh.indices.every(index => Number.isSafeInteger(index) && index >= 0 && index < mesh.positions.length) &&
    bounds.min.every(Number.isFinite) && bounds.max.every(Number.isFinite);
}

/** No filesystem writes, source downloads, geometry constructors, exception tables or
 * qualification promotions occur here. Adapters supply actual pinned-source results. */
export async function runDigitalImportRequest(request: DigitalImportRequest, adapters: DigitalImportAdapters): Promise<DigitalImportResult> {
  const result = initialResult(request);
  stage(result, 'demand', 'passed', 'explicit-native-demand', 'An explicit native part request was selected; inventory hints remain reference-only and do not authorize a cross-system identity.');
  let source;
  try { source = await adapters.resolveSource(request); result.source = structuredClone(source); }
  catch (error) { stage(result, 'source', 'blocked', 'source-query-failed', errorMessage(error)); return result; }
  if (source.sourceSystem !== 'LDraw' || source.access !== 'available') {
    stage(result, 'source', 'blocked', source.sourceSystem !== 'LDraw' ? 'source-adapter-not-approved' : source.access === 'denied' ? 'source-access-denied' : 'source-unavailable', source.reason ?? 'Only the reviewed, accessible LDraw native source adapter is enabled.');
    return result;
  }
  stage(result, 'source', 'passed', 'source-available', source.evidence.join('; ') || 'Reviewed digital source is available.');
  if (source.license !== 'approved' || !source.attributionPreserved || !source.licenseCopiesPresent) {
    stage(result, 'license', 'blocked', 'source-license-not-approved', source.reason ?? 'Source permission, retained attribution and license copies are all required before importing.');
    return result;
  }
  stage(result, 'license', 'passed', 'source-permission-prechecked', 'Source permission and retained attribution/license copies were checked; every imported dependency is checked again below.');
  if (request.identityStatus !== 'EXACT_NATIVE_ID' || request.originalIdentity.system !== 'ldraw' || request.originalIdentity.id !== request.nativePartId ||
      !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(request.nativePartId) || !request.identityEvidence.length) {
    stage(result, 'identity', 'blocked', 'identity-not-exact-native-id', 'Candidate/conflicting/unresolved inventory mappings cannot name a formal native part. An exact source-native ID and its own identity evidence are required.');
    return result;
  }
  stage(result, 'identity', 'passed', 'exact-native-source-id', 'The requested identity is the exact LDraw source ID; no Element/Design/Rebrickable cross-reference is promoted.');
  let part: NativeAssemblyPart | undefined;
  try { part = await adapters.loadPart(request.nativePartId); }
  catch (error) { stage(result, 'geometry', 'blocked', 'native-source-import-failed', errorMessage(error)); result.geometry.status = 'failed'; return result; }
  if (!part) { stage(result, 'geometry', 'blocked', 'native-source-part-unavailable', 'No original source part exists in the reviewed bundle; no similar model or placeholder is substituted.'); return result; }
  const geometry = part.geometry;
  result.geometry = {
    status: geometry.status, rootFile: geometry.source.rootFile, sourceVersion: geometry.source.revision,
    files: structuredClone(geometry.source.files), dependencies: geometry.source.files.filter(file => file.path !== geometry.source.rootFile).map(file => file.path),
    triangleCount: (geometry.mesh?.indices.length ?? 0) / 3,
  };
  result.connections = { status: part.connections.status, pointCount: part.connections.points.length,
    sourceFiles: structuredClone(part.connections.sourceFiles), issues: part.connections.issues.map(issue => ({ code: issue.code, file: issue.file, message: issue.message })) };
  if (part.partId !== request.nativePartId || geometry.partId !== request.nativePartId || geometry.source.rootFile !== `parts/${request.nativePartId}.dat`) {
    stage(result, 'identity', 'blocked', 'source-id-conflict', 'Imported root, geometry ID and requested LDraw identity disagree.'); return result;
  }
  if (geometry.status !== 'geometryReady' || !finiteNativeGeometry(part)) {
    stage(result, 'geometry', 'blocked', 'native-geometry-invalid', geometry.issues.map(issue => `${issue.code}: ${issue.message}`).join('; ') || 'The imported native mesh or its actual bounds is invalid.'); return result;
  }
  stage(result, 'geometry', 'passed', 'native-geometry-imported', 'Finite original vertices, valid triangle indices and source-derived bounds were checked without resizing or rebuilding the part.');
  stage(result, 'connections', part.connections.status === 'ready' ? 'passed' : 'blocked', `source-connections-${part.connections.status}`,
    part.connections.status === 'ready' ? 'The source connection syntax is completely parsed; this does not establish legal mating or assembly.' : 'Source connections are partial/missing. No inferred connector is added, and parsing alone cannot authorize generation.');
  try {
    const decisions = [
      ...geometry.source.files.map(file => checkDigitalSourceAdmission({ sourceId: 'ldraw-pinned', role: 'geometry', sourceUrl: file.sourceUrl,
        revision: geometry.source.revision, license: file.license ?? '', sha256: file.sha256,
        attributionPresent: !!file.author && source.attributionPreserved, licenseCopyPresent: source.licenseCopiesPresent })),
      ...part.connections.sourceFiles.map(file => checkDigitalSourceAdmission({ sourceId: file.library === 'LDraw' ? 'ldraw-pinned' : 'ldcad-shadow-pinned', role: file.library === 'LDraw' ? 'geometry' : 'connections', sourceUrl: file.sourceUrl,
        revision: file.revision, license: file.license, sha256: file.sha256,
        attributionPresent: source.attributionPreserved, licenseCopyPresent: source.licenseCopiesPresent })),
    ];
    const denied = decisions.filter(decision => !decision.allowed);
    if (denied.length) {
      stage(result, 'license', 'blocked', 'dependency-license-or-source-rejected', denied.flatMap(decision => decision.reasonCodes).join('; '));
      stage(result, 'integrity', 'blocked', 'unapproved-dependency', 'At least one actual dependency failed the reviewed per-file source policy.');
      return result;
    }
    assertDigitalPartOrigin(part);
    result.nativeSourceHash = nativePartSourceHash(part);
  } catch (error) { stage(result, 'integrity', 'blocked', 'native-origin-invalid', errorMessage(error)); return result; }
  stage(result, 'license', 'passed', 'dependency-source-policy-approved', 'Every actual geometry and connector source file satisfies its reviewed source URL, version, license, attribution and license-copy policy.');
  stage(result, 'integrity', 'passed', 'source-closure-integrity-checked', 'Actual imported native source evidence and all connector source references were checked; source resolvers verify file bytes against pinned hashes.');
  // This stage records a staging-library decision only, never publication or production admission.
  result.stagingLibraryAllowed = true;
  stage(result, 'library', 'passed', 'source-backed-staging-record', 'The exact licensed native geometry may be retained in the separate staging library. Assembly and production permissions remain independent.');
  let proof: Awaited<ReturnType<DigitalImportAdapters['getAssemblyEvidence']>>;
  try { proof = await adapters.getAssemblyEvidence(request.nativePartId, part); }
  catch (error) {
    result.assembly.status = 'blocked'; result.assembly.reasonCodes = ['assembly-verification-failed']; result.assembly.reasons = [errorMessage(error)];
    stage(result, 'assembly', 'blocked', 'assembly-verification-failed', errorMessage(error));
    stage(result, 'generator', 'blocked', 'assembly-evidence-required', 'Fresh source-backed assembly evidence is unavailable.'); return result;
  }
  if (proof) {
    result.assembly = { status: 'blocked', evidenceOrigin: adapters.assemblyEvidenceOrigin ?? 'current-runtime', sourceDigest: proof.source.digest,
      verifiedConnectionIds: [], fixtureTestsPassed: proof.fixtureTestsPassed, fixtureTestsTotal: proof.fixtureTestsTotal,
      reasonCodes: [...proof.reasonCodes], reasons: [...proof.reasons] };
  }
  const points = new Set(part.connections.points.map(point => point.id));
  const proofPassed = !!proof && proof.partId === request.nativePartId && proof.source.digest === result.nativeSourceHash &&
    proof.scope === 'source-backed-tested-interfaces-only' && proof.status === 'assemblyVerified' && proof.assemblyVerified === true &&
    proof.physicalBuildVerified === false && part.connections.status === 'ready' &&
    ['source-integrity', 'collision'].every(name => proof.sourceChecks.some(check => check.name === name && check.outcome === 'passed')) && proof.sourceChecks.every(check => check.outcome === 'passed') &&
    proof.allowedConnectionIds.length > 0 && proof.allowedConnectionIds.every(id => {
      const currentProof = proof!;
      const point = part!.connections.points.find(point => point.id === id);
      if (!point || !currentProof.verifiedConnectionIds.includes(id)) return false;
      return currentProof.fixtures.some(fixture => {
        if (fixture.status !== 'verified' || !(fixture.connectionId === id || fixture.equivalentConnectionIds.includes(id))) return false;
        const primary = part!.connections.points.find(point => point.id === fixture.connectionId);
        return !!primary && physicalConnectionSignature(point) === physicalConnectionSignature(primary) && fixture.sourceFile === primary.source.path &&
          fixture.sourceLine === primary.source.line && fixture.sourceHash === primary.source.sha256 && !!fixture.ruleId && currentProof.ruleIds.includes(fixture.ruleId) &&
          !!fixture.fixturePartId && !!fixture.fixtureConnectionId && /^[a-f0-9]{64}$/.test(fixture.fixtureSourceDigest ?? '') &&
          fixture.checks.every(check => check.outcome === 'passed') && ['connection', 'transform', 'reverse-connection', 'collision', 'illegal-collision', 'rotation', 'connection-graph', 'generator-smoke'].every(name => fixture.checks.some(check => check.name === name && check.outcome === 'passed'));
      });
    });
  if (!proofPassed || !proof) {
    result.assembly.status = proof ? 'blocked' : 'not-run';
    stage(result, 'assembly', 'blocked', proof && proof.source.digest !== result.nativeSourceHash ? 'assembly-source-mismatch' : 'assembly-not-verified', proof?.reasons.join('; ') || 'No current source-bound passing assembly evidence exists.');
    stage(result, 'generator', 'blocked', 'assembly-evidence-required', 'Geometry or parsed connectors alone do not authorize the formal Generator.'); return result;
  }
  result.assembly.status = 'verified-listed-interfaces'; result.assembly.verifiedConnectionIds = [...proof.allowedConnectionIds];
  stage(result, 'assembly', 'passed', 'verified-listed-source-interfaces', 'Assembly checks passed only for the listed source interfaces; physical construction remains unverified.');
  let capability;
  try { capability = await adapters.getCapability(request.nativePartId); }
  catch (error) { stage(result, 'generator', 'blocked', 'production-capability-unavailable', errorMessage(error)); return result; }
  if (capability?.partId === request.nativePartId && capability.assemblyVerified && capability.generatable && capability.ruleIds.length) {
    result.productionConnectionIds = capability.allowedConnectionIds.filter(id => proof!.allowedConnectionIds.includes(id) && points.has(id));
    result.productionGeneratorAllowed = result.productionConnectionIds.length > 0;
  }
  stage(result, 'generator', result.productionGeneratorAllowed ? 'passed' : 'blocked', result.productionGeneratorAllowed ? 'existing-production-capability' : 'production-qualification-required',
    result.productionGeneratorAllowed ? 'Existing production-service permissions overlap the actual source-backed verified interfaces. The pipeline did not create these permissions.' : 'The separate staging/fresh verification result cannot create production qualification. A current formal source-bound qualification record is still required.');
  return result;
}

/** Sequential import bounds mesh memory and preserves deterministic audit order. */
export async function runDigitalImportPilot(requests: readonly DigitalImportRequest[], adapters: DigitalImportAdapters): Promise<DigitalImportPilotReport> {
  if (requests.length > 100 || new Set(requests.map(request => request.requestId)).size !== requests.length) throw new Error('Digital pilot requests must be bounded and have unique request IDs.');
  const results: DigitalImportResult[] = [];
  for (const request of requests) results.push(await runDigitalImportRequest(request, adapters));
  const identity = { EXACT_NATIVE_ID: 0, CANDIDATE: 0, CONFLICT: 0, UNRESOLVED: 0 };
  for (const result of results) identity[result.identityStatus]++;
  return { schemaVersion: 1, pipelineVersion: DIGITAL_IMPORT_PIPELINE_VERSION, results,
    counts: { requested: results.length, identity, geometryReady: results.filter(result => result.geometry.status === 'geometryReady').length,
      connectionReady: results.filter(result => result.connections.status === 'ready').length, connectionPartial: results.filter(result => result.connections.status === 'partial').length,
      connectionMissing: results.filter(result => result.connections.status === 'missing').length, assemblyVerified: results.filter(result => result.assembly.status === 'verified-listed-interfaces').length,
      stagingLibraryAllowed: results.filter(result => result.stagingLibraryAllowed).length, productionGeneratorAllowed: results.filter(result => result.productionGeneratorAllowed).length },
    qualificationWritesPerformed: false, physicalBuildVerified: false };
}
