import type { ImportedConnectionPoint } from '../connections/types.js';
import type { AssemblyInterfaceCapability, NativeAssembly, NativeAssemblyPart, NativePlacement, RigidTransform } from './types.js';
import type { LoadedAssemblyFixture } from './fixtures.js';
import { IDENTITY_TRANSFORM, isRigidTransform, distance, rotate, transformPoint } from './math.js';
import { checkConnectionCompatibility } from './compatibility.js';
import { solveAttachment } from './solver.js';
import { checkNativePairCollision } from './collision.js';
import { nativePartSourceHash } from './source.js';
import { buildNativeCollisionProxy } from './proxy.js';

export type AssemblyVerificationCheckName = 'source-integrity' | 'connection' | 'transform' | 'reverse-connection' | 'collision' | 'illegal-collision' | 'rotation' | 'connection-graph' | 'generator-smoke';
export interface AssemblyVerificationCheck { name: AssemblyVerificationCheckName; outcome: 'passed' | 'blocked'; reason: string }
export interface AssemblySourceFingerprint {
  digest: string;
  geometryRevision: string;
  geometryRoot: string;
  geometryFiles: { path: string; sha256: string }[];
  connectionFiles: { library: string; path: string; revision: string; sha256: string }[];
}
export interface ConnectionFixtureVerification {
  connectionId: string;
  connectionFamily: string;
  sourceFile: string;
  sourceLine: number;
  sourceHash: string;
  status: 'verified' | 'blocked';
  fixturePartId: string | null;
  fixtureRole: string | null;
  fixtureConnectionId: string | null;
  fixtureSourceDigest: string | null;
  ruleId: string | null;
  compatibleTwistsDeg: number[];
  acceptedTwistDeg: number | null;
  transform: RigidTransform | null;
  checks: AssemblyVerificationCheck[];
  reasonCodes: string[];
  reasons: string[];
  /** Another raw source record at the exact same physical interface can share this proof. */
  equivalentConnectionIds: string[];
}
export interface NativePartAssemblyVerification extends AssemblyInterfaceCapability {
  status: 'assemblyVerified' | 'blocked';
  name: string;
  geometryReady: boolean;
  connectionSourceStatus: 'ready' | 'partial' | 'missing';
  source: AssemblySourceFingerprint;
  scope: 'source-backed-tested-interfaces-only';
  verifiedConnectionIds: string[];
  disabledConnectionIds: string[];
  capabilities: string[];
  wheelModuleVerified: false;
  physicalBuildVerified: false;
  sourceChecks: AssemblyVerificationCheck[];
  fixtures: ConnectionFixtureVerification[];
  fixtureTestsPassed: number;
  fixtureTestsTotal: number;
  generatorSmokePassed: boolean;
  interfaceBudget: number | null;
  physicalInterfaceCount: number;
  testedPhysicalInterfaceCount: number;
  deferredPhysicalInterfaceCount: number;
  deferredConnectionIds: string[];
}
export interface PartAssemblyVerificationOptions { maxInterfacesPerPart?: number | null }

/** Structural subset shared with the actual AttachmentEngine, not a test double in production. */
export interface AssemblyVerificationEngine {
  createAssembly(partId: string): Promise<NativeAssembly>;
  attachPart(assembly: NativeAssembly, request: { anchorInstanceId: string; anchorConnectionId: string; partId: string; candidateConnectionId: string; twistDegrees?: number }): Promise<{
    accepted: boolean; graph: NativeAssembly; assembly: NativeAssembly; rejections: { code: string; reason: string }[];
  }>;
  validateGraph(assembly: NativeAssembly): Promise<{ valid: boolean; issues: string[] }>;
}

const fingerprintCache = new WeakMap<NativeAssemblyPart, AssemblySourceFingerprint>();
const illegalCoincidenceCache = new WeakMap<NativeAssemblyPart, ReturnType<typeof checkNativePairCollision>>();

export function fingerprintAssemblyPart(part: NativeAssemblyPart): AssemblySourceFingerprint {
  const cached = fingerprintCache.get(part);
  if (cached) return cached;
  const geometryFiles = part.geometry.source.files.map(file => ({ path: file.path, sha256: file.sha256 })).sort((a, b) => a.path.localeCompare(b.path));
  const connectionFiles = part.connections.sourceFiles.map(file => ({ library: file.library, path: file.path, revision: file.revision, sha256: file.sha256 })).sort((a, b) => `${a.library}:${a.path}`.localeCompare(`${b.library}:${b.path}`));
  const payload = { geometryRevision: part.geometry.source.revision, geometryRoot: part.geometry.source.rootFile, geometryFiles, connectionFiles };
  const result = { ...payload, digest: nativePartSourceHash(part) };
  if (Object.isFrozen(part)) fingerprintCache.set(part, result);
  return result;
}
function physicalSignature(point: ImportedConnectionPoint): string {
  const semanticProperties = Object.fromEntries(Object.entries(point.properties).filter(([key]) => !['pos', 'ori', 'grid'].includes(key)).sort(([a], [b]) => a.localeCompare(b)));
  return JSON.stringify([point.kind, point.family, point.gender, point.position, point.direction, point.orientation, point.sections, point.radius, point.length, point.group, semanticProperties, point.dimensionsResolved]);
}
function interfaceStratum(point: ImportedConnectionPoint): string {
  return JSON.stringify([point.kind, point.family, point.gender, point.direction.map(value => Math.round(value * 1e6)), point.sections, point.radius, point.length, point.group]);
}
/** Round-robin profiles and axes; within each stratum include interior, spatial extrema and farthest uncovered ports. */
function selectInterfaceGroups(groups: ImportedConnectionPoint[][], budget: number | null): Set<ImportedConnectionPoint[]> {
  if (budget === null || groups.length <= budget) return new Set(groups);
  const strata = new Map<string, ImportedConnectionPoint[][]>();
  for (const group of groups) { const key = interfaceStratum(group[0]); const list = strata.get(key) ?? []; list.push(group); strata.set(key, list); }
  const ordered = [...strata.values()].map(list => {
    const min = [0, 1, 2].map(axis => Math.min(...list.map(group => group[0].position[axis])));
    const max = [0, 1, 2].map(axis => Math.max(...list.map(group => group[0].position[axis])));
    const center = min.map((value, axis) => (value + max[axis]) / 2);
    const normalizedDistance = (a: number[], b: number[]) => a.reduce((sum, value, axis) => sum + ((value - b[axis]) / Math.max(max[axis] - min[axis], 1)) ** 2, 0);
    const chosen: ImportedConnectionPoint[][] = [];
    const add = (group: ImportedConnectionPoint[]) => { if (!chosen.includes(group)) chosen.push(group); };
    add([...list].sort((a, b) => normalizedDistance(a[0].position, center) - normalizedDistance(b[0].position, center) || a[0].id.localeCompare(b[0].id))[0]);
    for (const axis of [0, 1, 2]) for (const sign of [-1, 1]) add([...list].sort((a, b) => sign * (a[0].position[axis] - b[0].position[axis]) || a[0].id.localeCompare(b[0].id))[0]);
    while (chosen.length < Math.min(list.length, budget)) {
      const remaining = list.filter(group => !chosen.includes(group));
      remaining.sort((a, b) => Math.min(...chosen.map(other => normalizedDistance(b[0].position, other[0].position))) - Math.min(...chosen.map(other => normalizedDistance(a[0].position, other[0].position))) || a[0].id.localeCompare(b[0].id));
      add(remaining[0]);
    }
    return chosen;
  });
  const selected = new Set<ImportedConnectionPoint[]>();
  for (let offset = 0; selected.size < budget; offset++) {
    let added = false;
    for (const list of ordered) if (list[offset] && selected.size < budget) { selected.add(list[offset]); added = true; }
    if (!added) break;
  }
  return selected;
}
function check(name: AssemblyVerificationCheckName, passed: boolean, reason: string): AssemblyVerificationCheck { return { name, outcome: passed ? 'passed' : 'blocked', reason }; }
function transformsNear(a: RigidTransform, b: RigidTransform): boolean {
  return distance(a.translation, b.translation) < 1e-5 && a.rotation.every((value, index) => Math.abs(value - b.rotation[index]) < 1e-5);
}
function sourceIsVerified(part: NativeAssemblyPart): boolean {
  const geometry = part.geometry;
  if (geometry.status !== 'geometryReady' || geometry.source.integrity !== 'verified' || geometry.source.licenseStatus !== 'complete' || !geometry.mesh || !geometry.bounds || !geometry.source.files.length) return false;
  const geometryHashed = geometry.source.files.every(file => /^[a-f0-9]{64}$/.test(file.sha256) && file.license);
  return geometryHashed && part.connections.sourceFiles.length > 0 && part.connections.sourceFiles.every(file => /^[a-f0-9]{64}$/.test(file.sha256) && file.license) && part.connections.points.every(point => part.connections.sourceFiles.some(file => file.path === point.source.path && file.library === point.source.library && file.sha256 === point.source.sha256));
}
function fixtureOrder(point: ImportedConnectionPoint, fixtures: LoadedAssemblyFixture[]): LoadedAssemblyFixture[] {
  const roles = point.gender === 'M' ? ['tile-1x1', 'plate-1x1', 'brick-1x1', 'plate-1x2', 'brick-2x2'] : ['brick-1x1', 'plate-1x1', 'brick-2x2', 'plate-1x2', 'tile-1x1'];
  return [...fixtures].sort((a, b) => {
    const index = (role: string) => { const i = roles.indexOf(role); return i < 0 ? roles.length : i; };
    return index(a.definition.role) - index(b.definition.role);
  });
}

export async function verifyAssemblyConnectionWithFixtures(part: NativeAssemblyPart, point: ImportedConnectionPoint, aliases: string[], fixtures: LoadedAssemblyFixture[], engine: AssemblyVerificationEngine): Promise<ConnectionFixtureVerification> {
  const result: ConnectionFixtureVerification = {
    connectionId: point.id, connectionFamily: point.family, sourceFile: point.source.path, sourceLine: point.source.line, sourceHash: point.source.sha256,
    status: 'blocked', fixturePartId: null, fixtureRole: null, fixtureConnectionId: null, fixtureSourceDigest: null, ruleId: null,
    compatibleTwistsDeg: [], acceptedTwistDeg: null, transform: null, checks: [], reasonCodes: [], reasons: [], equivalentConnectionIds: aliases,
  };
  if (!point.dimensionsResolved) {
    result.reasonCodes.push('connection-dimensions-unresolved'); result.reasons.push('Imported connection dimensions include unresolved inherited scaling.'); return result;
  }
  const fixed: NativePlacement = { instanceId: `verification-${part.partId}`, partId: part.partId, transform: structuredClone(IDENTITY_TRANSFORM) };
  const candidates: { fixture: LoadedAssemblyFixture; point: ImportedConnectionPoint }[] = [];
  let hasUnknown = false;
  for (const fixture of fixtureOrder(point, fixtures)) {
    if (!fixture.part || fixture.part.connections.status !== 'ready' || !sourceIsVerified(fixture.part)) continue;
    const seen = new Set<string>();
    for (const mate of fixture.part.connections.points) {
      const signature = physicalSignature(mate);
      if (seen.has(signature)) continue;
      seen.add(signature);
      const compatibility = checkConnectionCompatibility(point, mate);
      hasUnknown ||= compatibility.status === 'unknown';
      if (compatibility.status === 'compatible') candidates.push({ fixture, point: mate });
    }
  }
  if (!candidates.length) {
    result.checks.push(check('connection', false, 'No source-ready standard fixture has a supported, source-backed mating rule for this interface.'));
    result.reasonCodes.push(hasUnknown ? 'compatibility-unknown' : 'fixture-unavailable');
    result.reasons.push(hasUnknown ? 'Profile, insertion depth, retention or interface-specific mating semantics are not supported by the current rule set.' : 'No pinned standard fixture provides a known compatible mating interface.');
    return result;
  }
  let lastFailure = 'No collision-safe discrete fixture placement was accepted.';
  // Source-ready small fixtures are first. Bound fallback work while retaining the exact blocked reason.
  for (const candidate of candidates.slice(0, 8)) {
    const fixturePart = candidate.fixture.part!;
    const solved = solveAttachment({ fixedPart: part, fixedPlacement: fixed, fixedConnectionId: point.id, movingPart: fixturePart, movingConnectionId: candidate.point.id });
    if (solved.status !== 'solved' || !solved.candidates.length) { lastFailure = solved.reason; continue; }
    const validTransforms = solved.candidates.every(value => isRigidTransform(value.transform));
    const rotations = solved.candidates.map(value => value.twistDeg);
    const rotationsValid = solved.compatibility.allowedTwistsDeg.length > 0 && rotations.every(angle => solved.compatibility.allowedTwistsDeg.includes(angle)) && solved.compatibility.allowedTwistsDeg.every(angle => rotations.includes(angle));
    if (!validTransforms || !rotationsValid) { lastFailure = 'Solver returned an invalid rigid transform or did not enumerate the source-rule discrete rotations.'; continue; }
    for (const placement of solved.candidates) {
      const moving: NativePlacement = { instanceId: `fixture-${fixturePart.partId}`, partId: fixturePart.partId, transform: placement.transform };
      const collided = checkNativePairCollision(part, fixed, fixturePart, moving, placement.penetrationZone);
      if (collided.status !== 'clear') { lastFailure = collided.reason; continue; }
      const reverse = solveAttachment({ fixedPart: fixturePart, fixedPlacement: moving, fixedConnectionId: candidate.point.id, movingPart: part, movingConnectionId: point.id });
      const reverseValid = reverse.status === 'solved' && reverse.candidates.some(value => transformsNear(value.transform, fixed.transform));
      // Position and axis are independently checked against the solver's world-space seam.
      const fixedAnchor = transformPoint(fixed.transform, point.position), movingAnchor = transformPoint(moving.transform, candidate.point.position);
      const fixedAxis = rotate(fixed.transform.rotation, point.direction), movingAxis = rotate(moving.transform.rotation, candidate.point.direction);
      const alignmentValid = distance(fixedAnchor, movingAnchor) < 1e-5 && distance(fixedAxis, movingAxis) < 1e-5;
      let illegal = Object.isFrozen(part) ? illegalCoincidenceCache.get(part) : undefined;
      if (!illegal) {
        illegal = checkNativePairCollision(part, fixed, part, { ...fixed, instanceId: `${fixed.instanceId}-illegal-duplicate` });
        if (Object.isFrozen(part)) illegalCoincidenceCache.set(part, illegal);
      }
      const illegalRejected = illegal.status === 'collision';
      const graph = await engine.createAssembly(part.partId);
      const anchorInstanceId = graph.placements[0]?.instanceId;
      if (!anchorInstanceId) { lastFailure = 'Verification graph did not contain its root placement.'; continue; }
      const attached = await engine.attachPart(graph, { anchorInstanceId, anchorConnectionId: point.id, partId: fixturePart.partId, candidateConnectionId: candidate.point.id, twistDegrees: placement.twistDeg });
      const graphValidation = attached.accepted ? await engine.validateGraph(attached.graph) : { valid: false, issues: attached.rejections.map(rejection => rejection.reason) };
      const duplicate = attached.accepted ? await engine.attachPart(attached.graph, { anchorInstanceId, anchorConnectionId: point.id, partId: fixturePart.partId, candidateConnectionId: candidate.point.id, twistDegrees: placement.twistDeg }) : null;
      const occupiedRejected = duplicate !== null && !duplicate.accepted && duplicate.graph.placements.length === 2 && duplicate.graph.edges.length === 1;
      const graphValid = attached.accepted && attached.graph.placements.length === 2 && attached.graph.edges.length === 1 && graphValidation.valid && occupiedRejected;
      const checks: AssemblyVerificationCheck[] = [
        check('connection', true, 'Real source profiles passed the named compatibility rule.'),
        check('transform', validTransforms && alignmentValid, 'Source connection anchors and axes agree in the solved rigid world frame.'),
        check('reverse-connection', reverseValid, 'Swapping fixed and moving parts recovers the original rigid placement within numerical tolerance.'),
        check('collision', true, 'The native mesh collision validator accepted the source-rule connection pose.'),
        check('illegal-collision', illegalRejected, `Coincident duplicate source geometry must be rejected; result: ${illegal.status}.`),
        check('rotation', rotationsValid, 'Solver enumerated every allowed discrete source-rule twist and no extra rotation.'),
        check('connection-graph', graphValid, graphValid ? 'Actual attachment engine created two source-bound nodes and one valid edge, then rejected reuse of the occupied connection without adding nodes.' : graphValidation.issues.join('; ') || 'Attachment engine did not accept the fixture or reject occupied endpoint reuse.'),
        check('generator-smoke', graphValid, 'The actual attachment path placed the fixture through compatibility, transform, collision and graph update.'),
      ];
      result.fixturePartId = fixturePart.partId; result.fixtureRole = candidate.fixture.definition.role;
      result.fixtureConnectionId = candidate.point.id; result.fixtureSourceDigest = fingerprintAssemblyPart(fixturePart).digest;
      result.ruleId = solved.compatibility.ruleId; result.compatibleTwistsDeg = rotations; result.acceptedTwistDeg = placement.twistDeg; result.transform = placement.transform; result.checks = checks;
      if (checks.every(value => value.outcome === 'passed')) { result.status = 'verified'; return result; }
      result.reasonCodes.push(...checks.filter(value => value.outcome !== 'passed').map(value => `${value.name}-unresolved`));
      result.reasons.push(...checks.filter(value => value.outcome !== 'passed').map(value => value.reason));
      return result;
    }
  }
  result.reasonCodes.push('collision-or-transform-blocked'); result.reasons.push(lastFailure);
  result.checks.push(check('collision', false, lastFailure));
  return result;
}

/** No interface is enabled just because its metadata parsed. Unknown ports remain disabled. */
export async function verifyNativePartAssembly(part: NativeAssemblyPart, name: string, fixtures: LoadedAssemblyFixture[], engine: AssemblyVerificationEngine, options: PartAssemblyVerificationOptions = {}): Promise<NativePartAssemblyVerification> {
  const budget = options.maxInterfacesPerPart === undefined ? 32 : options.maxInterfacesPerPart;
  if (budget !== null && (!Number.isSafeInteger(budget) || budget < 1 || budget > 512)) throw new Error('Interface budget must be between 1 and 512, or null for exhaustive verification.');
  const source = fingerprintAssemblyPart(part), sourceVerified = sourceIsVerified(part);
  const geometryReady = part.geometry.status === 'geometryReady';
  const sourceChecks = [check('source-integrity', sourceVerified, sourceVerified ? 'Pinned native geometry and every source-backed connection file are hashed and licensed.' : 'Geometry or connection source integrity / licensing is incomplete.')];
  const reasonCodes: string[] = [], reasons: string[] = [];
  if (!geometryReady) { reasonCodes.push('geometry-unavailable'); reasons.push(...part.geometry.issues.map(issue => `${issue.code}: ${issue.message}`)); }
  if (!sourceVerified) { reasonCodes.push('source-integrity-unresolved'); reasons.push('Required source integrity, hashes or license evidence is incomplete.'); }
  if (part.connections.status !== 'ready') {
    reasonCodes.push(part.connections.status === 'missing' ? 'connection-missing' : 'connection-source-partial');
    reasons.push(...part.connections.issues.map(issue => `${issue.code}: ${issue.file}${issue.line ? `:${issue.line}` : ''}: ${issue.message}`));
  }
  const results: ConnectionFixtureVerification[] = [];
  const groups = new Map<string, ImportedConnectionPoint[]>();
  for (const point of part.connections.points) { const key = physicalSignature(point); const group = groups.get(key) ?? []; group.push(point); groups.set(key, group); }
  let testedPhysicalInterfaceCount = 0, deferredPhysicalInterfaceCount = 0;
  const deferredConnectionIds: string[] = [];
  let proxyReady = false;
  if (geometryReady && sourceVerified && part.connections.status === 'ready') {
    const proxy = buildNativeCollisionProxy(part, { instanceId: `source-proxy-${part.partId}`, partId: part.partId, transform: structuredClone(IDENTITY_TRANSFORM) });
    proxyReady = proxy.status === 'ready' && !!proxy.proxy;
    sourceChecks.push(check('collision', proxyReady, proxyReady ? 'Native source mesh yields a source-bound closed solid proxy; actual mating clearance still requires fixture tests.' : proxy.reason));
    if (!proxyReady) { reasonCodes.push(`collision-proxy-${proxy.reasonCode}`); reasons.push(proxy.reason); }
  }
  if (geometryReady && sourceVerified && part.connections.status === 'ready' && proxyReady) {
    const selected = selectInterfaceGroups([...groups.values()], budget);
    for (const points of groups.values()) {
      if (selected.has(points)) { testedPhysicalInterfaceCount++; results.push(await verifyAssemblyConnectionWithFixtures(part, points[0], points.map(value => value.id), fixtures, engine)); }
      else {
        const point = points[0]; deferredPhysicalInterfaceCount++; deferredConnectionIds.push(...points.map(point => point.id));
        results.push({ connectionId: point.id, connectionFamily: point.family, sourceFile: point.source.path, sourceLine: point.source.line, sourceHash: point.source.sha256, status: 'blocked', fixturePartId: null, fixtureRole: null, fixtureConnectionId: null, fixtureSourceDigest: null, ruleId: null, compatibleTwistsDeg: [], acceptedTwistDeg: null, transform: null, checks: [], reasonCodes: ['deferred-interface-budget'], reasons: ['This physical source interface was not selected in the current bounded verification scope and remains disabled.'], equivalentConnectionIds: points.map(point => point.id) });
      }
    }
  }
  const verifiedConnectionIds = results.filter(result => result.status === 'verified').flatMap(result => result.equivalentConnectionIds);
  const disabledConnectionIds = part.connections.points.filter(point => !verifiedConnectionIds.includes(point.id)).map(point => point.id);
  const assemblyVerified = verifiedConnectionIds.length > 0 && sourceChecks.every(value => value.outcome === 'passed') && part.connections.status === 'ready';
  const generatorSmokePassed = assemblyVerified && results.filter(result => result.status === 'verified').every(result => result.checks.some(check => check.name === 'generator-smoke' && check.outcome === 'passed'));
  const ruleIds = [...new Set(results.filter(result => result.status === 'verified' && result.ruleId).map(result => result.ruleId!))];
  if (deferredPhysicalInterfaceCount) { reasonCodes.push('deferred-interface-budget'); reasons.push(`${deferredPhysicalInterfaceCount} physical interfaces (${deferredConnectionIds.length} raw source IDs) remain disabled because they were outside this verification pass's per-part budget.`); }
  if (!assemblyVerified && !reasonCodes.length) { reasonCodes.push('no-verified-interface'); reasons.push('Every imported interface is blocked by its recorded fixture / compatibility / collision result.'); }
  for (const result of results.filter(result => result.status === 'blocked')) {
    reasonCodes.push(...result.reasonCodes); reasons.push(...result.reasons.map(reason => `${result.connectionId}: ${reason}`));
  }
  const capabilities = assemblyVerified ? ['source-stud-interface-assembly'] : [];
  return {
    partId: part.partId, name, status: assemblyVerified ? 'assemblyVerified' : 'blocked', geometryReady, connectionSourceStatus: part.connections.status, source,
    scope: 'source-backed-tested-interfaces-only', assemblyVerified, generatable: assemblyVerified && generatorSmokePassed,
    allowedConnectionIds: [...verifiedConnectionIds], verifiedConnectionIds, disabledConnectionIds, capabilities, wheelModuleVerified: false, physicalBuildVerified: false,
    sourceChecks, fixtures: results, ruleIds, reasonCodes: [...new Set(reasonCodes)], reasons: [...new Set(reasons)],
    fixtureTestsPassed: results.flatMap(result => result.checks).filter(check => check.outcome === 'passed').length,
    fixtureTestsTotal: results.reduce((sum, result) => sum + result.checks.length, 0), generatorSmokePassed,
    interfaceBudget: budget, physicalInterfaceCount: groups.size, testedPhysicalInterfaceCount, deferredPhysicalInterfaceCount, deferredConnectionIds,
  };
}
