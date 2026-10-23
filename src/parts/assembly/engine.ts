import { createHash, randomUUID } from 'node:crypto';
import { checkConnectionCompatibility, CONNECTION_RULE_VERSION, type CompatibilityResult } from './compatibility.js';
import { solveAttachment, type AttachmentCandidate } from './solver.js';
import { checkNativePairCollision, COLLISION_VERSION } from './collision.js';
import { distance, finiteVector, IDENTITY_TRANSFORM, isRigidTransform } from './math.js';
import { nativePartSourceHash, PART_LIBRARY_VERSION } from './source.js';
import type { AssemblyAttachRequest, AssemblyGraphEdge, AssemblyInterfaceCapability, NativeAssembly, NativeAssemblyPart, NativePlacement } from './types.js';

export const ASSEMBLY_ENGINE_VERSION = 'native-assembly-0.5.0';
type PairCollision = Awaited<ReturnType<typeof checkNativePairCollision>>;
export interface AttachResult {
  accepted: boolean;
  graph: NativeAssembly;
  assembly: NativeAssembly;
  candidate?: AttachmentCandidate;
  compatibility?: CompatibilityResult;
  collision?: PairCollision;
  rejections: { code: string; reason: string }[];
  debug?: AttachmentCandidate & { coordinateSystem: 'ldraw-native'; insertionPathVerification: 'source-axis-seating-path' };
}
export interface AttachmentEngineOptions {
  loadPart(partId: string): Promise<NativeAssemblyPart | undefined>;
  getCapability?(partId: string): Promise<AssemblyInterfaceCapability | undefined> | AssemblyInterfaceCapability | undefined;
  /** Internal verification harness only; this is never read from requests or environment. */
  mode?: 'production' | 'verification';
}

function graphDigest(graph: NativeAssembly) { return createHash('sha256').update(JSON.stringify(graph)).digest('hex'); }
function endpointKey(instanceId: string, connectionId: string, part?: NativeAssemblyPart) {
  const point = part?.connections.points.find(point => point.id === connectionId);
  // Shadow inheritance can repeat the very same physical socket under two
  // source-line IDs. Its occupancy belongs to the physical endpoint, not its alias.
  return point ? JSON.stringify([instanceId, point.gender, point.position.map(value => Math.round(value * 1e7)), point.direction.map(value => Math.round(value * 1e7))]) : JSON.stringify([instanceId, connectionId]);
}
function sameTransform(a: NativePlacement['transform'], b: NativePlacement['transform']) {
  return distance(a.translation, b.translation) < 1e-5 && a.rotation.every((value, index) => Math.abs(value - b.rotation[index]) < 1e-6);
}
function sourceProblems(part: NativeAssemblyPart): string[] {
  const problems: string[] = [];
  if (part.geometry.partId !== part.partId || part.connections.partId !== part.partId) problems.push('Source part identifiers do not agree.');
  if (part.geometry.status !== 'geometryReady' || !part.geometry.mesh || !part.geometry.bounds || part.geometry.source.integrity !== 'verified' || part.geometry.source.licenseStatus !== 'complete') problems.push('Native hash-verified licensed geometry is required.');
  if (part.connections.status !== 'ready' || !part.connections.points.length) problems.push('Complete source connection interpretation is required.');
  return problems;
}

/** Each accepted placement is solver-derived, checked against the whole graph,
 * and source-bound. The generator cannot place or resize a source part itself. */
export class AttachmentEngine {
  readonly mode: 'production' | 'verification';
  readonly versions = { partLibraryVersion: PART_LIBRARY_VERSION, assemblyEngineVersion: ASSEMBLY_ENGINE_VERSION, connectionRuleVersion: CONNECTION_RULE_VERSION, collisionVersion: COLLISION_VERSION };
  private readonly acceptedGraphs = new Set<string>();
  constructor(private readonly options: AttachmentEngineOptions) {
    this.mode = options.mode ?? 'production';
    if (this.mode !== 'production' && this.mode !== 'verification') throw new Error('Invalid assembly mode.');
    if (this.mode === 'production' && !options.getCapability) throw new Error('Production assembly requires a verified interface capability provider.');
  }
  getPart(id: string) { return this.options.loadPart(id); }
  async getCapability(id: string) { return await this.options.getCapability?.(id); }
  private remember(graph: NativeAssembly) {
    this.acceptedGraphs.add(graphDigest(graph));
    if (this.acceptedGraphs.size > 2048) this.acceptedGraphs.delete(this.acceptedGraphs.values().next().value!);
  }
  private async eligibility(part: NativeAssemblyPart, connectionId?: string, ruleId?: string): Promise<string[]> {
    const problems = sourceProblems(part);
    if (this.mode === 'verification') return problems;
    const capability = await this.getCapability(part.partId);
    if (capability && capability.partId !== part.partId) problems.push('The capability record belongs to a different source part.');
    if (!capability?.assemblyVerified || !capability.generatable) problems.push('The part has not passed assembly verification and generator smoke tests.');
    if (!capability?.allowedConnectionIds.length) problems.push('No tested assembly interface is enabled for this part.');
    if (connectionId && !capability?.allowedConnectionIds.includes(connectionId)) problems.push('This particular source interface is disabled or untested.');
    if (ruleId && !capability?.ruleIds.includes(ruleId)) problems.push('This connection rule is not in the verified part scope.');
    return problems;
  }
  async createAssembly(partId: string): Promise<NativeAssembly> {
    const part = await this.getPart(partId);
    if (!part) throw new Error('Unknown source part; no placeholder can seed an assembly.');
    const problems = await this.eligibility(part);
    if (problems.length) throw new Error(problems.join(' '));
    const graph: NativeAssembly = { schemaVersion: 1, id: `assembly-${randomUUID()}`, ...this.versions,
      placements: [{ instanceId: 'root', partId, transform: structuredClone(IDENTITY_TRANSFORM) }], edges: [],
      sourceHashes: { [partId]: nativePartSourceHash(part) }, physicalBuildVerified: false };
    this.remember(graph);
    return graph;
  }

  /** Checks both structural/source constraints and actual native pair collisions.
   * A copied or edited graph is never blessed merely because it has edges. */
  async validateGraph(graph: NativeAssembly): Promise<{ valid: boolean; issues: string[] }> {
    const issues: string[] = [];
    if (!graph || graph.schemaVersion !== 1 || !Array.isArray(graph.placements) || !Array.isArray(graph.edges) || !graph.sourceHashes || graph.placements.length < 1 || graph.placements.length > 64 || graph.edges.length > 4096 || graph.physicalBuildVerified !== false) return { valid: false, issues: ['Invalid or unbounded assembly graph, or unsupported physical verification claim.'] };
    if (Object.entries(this.versions).some(([key, value]) => graph[key as keyof typeof this.versions] !== value)) issues.push('Assembly version dependencies do not match the active engine.');
    const nodes = new Map<string, NativePlacement>(), parts = new Map<string, NativeAssemblyPart>();
    for (const placement of graph.placements) {
      if (!placement || typeof placement.instanceId !== 'string' || nodes.has(placement.instanceId) || !isRigidTransform(placement.transform)) { issues.push('Duplicate instance or invalid rigid placement.'); continue; }
      nodes.set(placement.instanceId, placement);
      const part = await this.getPart(placement.partId);
      if (!part) { issues.push(`Unknown source part: ${placement.partId}`); continue; }
      parts.set(placement.instanceId, part);
      issues.push(...await this.eligibility(part));
      if (nativePartSourceHash(part) !== graph.sourceHashes[part.partId]) issues.push(`Source hash changed for ${part.partId}.`);
    }
    if (issues.length) return { valid: false, issues: [...new Set(issues)] };
    const occupied = new Set<string>(), adjacency = new Map(graph.placements.map(placement => [placement.instanceId, new Set<string>()]));
    const edgeCandidates = new Map<string, AttachmentCandidate>();
    const edgeIds = new Set<string>();
    for (const edge of graph.edges) {
      if (!edge || typeof edge.id !== 'string' || edgeIds.has(edge.id) || !finiteVector(edge.anchor) || !finiteVector(edge.axis) || !Number.isFinite(edge.insertionDepthLdu) || edge.insertionDepthLdu <= 0 || !Number.isFinite(edge.twistDeg)) { issues.push('Invalid, duplicate or non-finite graph edge metadata.'); continue; }
      edgeIds.add(edge.id);
      const fixed = nodes.get(edge.fixedInstanceId), moving = nodes.get(edge.movingInstanceId);
      if (!fixed || !moving || fixed === moving) { issues.push('Graph edge refers to a missing or identical instance.'); continue; }
      const fixedPart = parts.get(fixed.instanceId)!, movingPart = parts.get(moving.instanceId)!;
      issues.push(...await this.eligibility(fixedPart, edge.fixedConnectionId, edge.ruleId), ...await this.eligibility(movingPart, edge.movingConnectionId, edge.ruleId));
      const solved = solveAttachment({ fixedPart, fixedPlacement: fixed, fixedConnectionId: edge.fixedConnectionId, movingPart, movingConnectionId: edge.movingConnectionId, twistsDeg: [edge.twistDeg] });
      const candidate = solved.candidates.find(candidate => sameTransform(candidate.transform, moving.transform));
      if (!candidate || solved.compatibility.ruleId !== edge.ruleId || solved.compatibility.ruleVersion !== edge.ruleVersion || distance(candidate.anchor, edge.anchor) > 1e-5 || distance(candidate.axis, edge.axis) > 1e-5 || Math.abs((solved.compatibility.insertionDepthLdu ?? 0) - edge.insertionDepthLdu) > 1e-5) { issues.push('Graph edge is inconsistent with the source compatibility and transform solution.'); continue; }
      edgeCandidates.set(edge.id, candidate);
      for (const key of [endpointKey(fixed.instanceId, edge.fixedConnectionId, fixedPart), endpointKey(moving.instanceId, edge.movingConnectionId, movingPart)]) {
        if (occupied.has(key)) issues.push('A connection endpoint is occupied more than once.');
        occupied.add(key);
      }
      adjacency.get(fixed.instanceId)!.add(moving.instanceId); adjacency.get(moving.instanceId)!.add(fixed.instanceId);
    }
    const visited = new Set<string>(), pending = [graph.placements[0].instanceId];
    while (pending.length) { const id = pending.pop()!; if (visited.has(id)) continue; visited.add(id); pending.push(...(adjacency.get(id) ?? [])); }
    if (visited.size !== graph.placements.length) issues.push('Floating/disconnected source parts are forbidden.');
    if (issues.length) return { valid: false, issues: [...new Set(issues)] };
    for (let i = 0; i < graph.placements.length; i++) for (let j = i + 1; j < graph.placements.length; j++) {
      const a = graph.placements[i], b = graph.placements[j];
      const edge = graph.edges.find(edge => edge.fixedInstanceId === a.instanceId && edge.movingInstanceId === b.instanceId || edge.fixedInstanceId === b.instanceId && edge.movingInstanceId === a.instanceId);
      const collision = await checkNativePairCollision(parts.get(a.instanceId)!, a, parts.get(b.instanceId)!, b, edge ? edgeCandidates.get(edge.id)?.penetrationZone : undefined);
      if (collision.status !== 'clear') issues.push(`Native pair ${a.instanceId}/${b.instanceId}: ${collision.reason}`);
    }
    return { valid: issues.length === 0, issues: [...new Set(issues)] };
  }

  async attachPart(graph: NativeAssembly, request: AssemblyAttachRequest): Promise<AttachResult> {
    const rejections: AttachResult['rejections'] = [];
    const reject = (code: string, reason: string, extra: Partial<AttachResult> = {}): AttachResult => ({ accepted: false, graph, assembly: graph, rejections: [...rejections, { code, reason }], ...extra });
    if (!this.acceptedGraphs.has(graphDigest(graph))) {
      const validation = await this.validateGraph(graph);
      if (!validation.valid) return reject('invalid-graph', validation.issues.join(' '));
      this.remember(graph);
    }
    // Eligibility can be revoked independently of a graph's coordinates. A
    // cached geometric proof never freezes a previous production permission.
    const existingParts = new Map<string, NativeAssemblyPart>();
    for (const placement of graph.placements) {
      const part = await this.getPart(placement.partId);
      if (!part || nativePartSourceHash(part) !== graph.sourceHashes[placement.partId]) return reject('graph-source-changed', 'An existing part source is unavailable or has changed.');
      existingParts.set(placement.instanceId, part);
      const currentProblems = await this.eligibility(part);
      for (const edge of graph.edges) {
        if (edge.fixedInstanceId === placement.instanceId) currentProblems.push(...await this.eligibility(part, edge.fixedConnectionId, edge.ruleId));
        if (edge.movingInstanceId === placement.instanceId) currentProblems.push(...await this.eligibility(part, edge.movingConnectionId, edge.ruleId));
      }
      if (currentProblems.length) return reject('existing-part-eligibility-revoked', [...new Set(currentProblems)].join(' '));
    }
    if (graph.placements.length >= 64) return reject('assembly-limit', 'The assembly reached its 64 part limit.');
    const fixedPlacement = graph.placements.find(placement => placement.instanceId === request.anchorInstanceId);
    if (!fixedPlacement) return reject('missing-anchor', 'The selected anchor instance does not exist.');
    const fixedPart = await this.getPart(fixedPlacement.partId), movingPart = await this.getPart(request.partId);
    if (!fixedPart || !movingPart) return reject('unknown-part', 'Unknown source part; no fallback geometry will be created.');
    const problems = [...await this.eligibility(fixedPart, request.anchorConnectionId), ...await this.eligibility(movingPart, request.candidateConnectionId)];
    if (problems.length) return reject('part-or-interface-blocked', [...new Set(problems)].join(' '));
    const occupied = new Set(graph.edges.flatMap(edge => [endpointKey(edge.fixedInstanceId, edge.fixedConnectionId, existingParts.get(edge.fixedInstanceId)), endpointKey(edge.movingInstanceId, edge.movingConnectionId, existingParts.get(edge.movingInstanceId))]));
    if (occupied.has(endpointKey(fixedPlacement.instanceId, request.anchorConnectionId, fixedPart))) return reject('endpoint-occupied', 'The selected physical anchor connection, including its source aliases, is already occupied.');
    const solved = solveAttachment({ fixedPart, fixedPlacement, fixedConnectionId: request.anchorConnectionId, movingPart, movingConnectionId: request.candidateConnectionId, ...(request.twistDegrees === undefined ? {} : { twistsDeg: [request.twistDegrees] }) });
    if (solved.status !== 'solved') return reject(solved.compatibility.reasonCode, solved.reason, { compatibility: solved.compatibility });
    const ruleId = solved.compatibility.ruleId!;
    const ruleProblems = [...await this.eligibility(fixedPart, request.anchorConnectionId, ruleId), ...await this.eligibility(movingPart, request.candidateConnectionId, ruleId)];
    if (ruleProblems.length) return reject('rule-scope-blocked', [...new Set(ruleProblems)].join(' '), { compatibility: solved.compatibility });
    for (const candidate of solved.candidates) {
      let instanceId = `p-${graph.placements.length}`;
      while (graph.placements.some(part => part.instanceId === instanceId)) instanceId += '-new';
      const movingPlacement: NativePlacement = { instanceId, partId: movingPart.partId, transform: structuredClone(candidate.transform) };
      let failed: PairCollision | undefined;
      let anchorCollision: PairCollision | undefined;
      for (const existing of graph.placements) {
        const part = await this.getPart(existing.partId);
        if (!part) return reject('source-unavailable', 'An existing source part is no longer available.');
        const collision = await checkNativePairCollision(part, existing, movingPart, movingPlacement, existing.instanceId === fixedPlacement.instanceId ? candidate.penetrationZone : undefined);
        if (existing.instanceId === fixedPlacement.instanceId) anchorCollision = collision;
        if (collision.status !== 'clear') { failed = collision; rejections.push({ code: collision.status === 'collision' ? 'native-plastic-collision' : 'collision-unresolved', reason: `${existing.instanceId}: ${collision.reason}` }); break; }
      }
      if (failed) continue;
      const next: NativeAssembly = structuredClone(graph);
      next.placements.push(movingPlacement); next.sourceHashes[movingPart.partId] = nativePartSourceHash(movingPart);
      const edge: AssemblyGraphEdge = { id: `edge-${next.edges.length + 1}`, fixedInstanceId: fixedPlacement.instanceId, fixedConnectionId: request.anchorConnectionId,
        movingInstanceId: instanceId, movingConnectionId: request.candidateConnectionId, ruleId, ruleVersion: CONNECTION_RULE_VERSION, twistDeg: candidate.twistDeg,
        axis: [...candidate.axis], anchor: [...candidate.anchor], insertionDepthLdu: solved.compatibility.insertionDepthLdu! };
      next.edges.push(edge);
      this.remember(next);
      return { accepted: true, graph: next, assembly: next, candidate, compatibility: solved.compatibility, collision: anchorCollision, rejections,
        debug: { ...structuredClone(candidate), coordinateSystem: 'ldraw-native', insertionPathVerification: 'source-axis-seating-path' } };
    }
    return reject('no-collision-free-transform', 'Every permitted source-derived placement was rejected by native collision checks.', { compatibility: solved.compatibility });
  }
}

export async function attachPart(engine: AttachmentEngine, graph: NativeAssembly, request: AssemblyAttachRequest) { return engine.attachPart(graph, request); }
