import { ModuleCatalog, MODULE_LIBRARY_DIGEST, checkModuleEnvelope, type ModuleDefinition, type ModuleMember, type ModuleRecipe } from './catalog.js';
import { MODULE_ASSEMBLY_VERSION, modulePolicy as policy } from './policy.js';
import { composeTransforms, inverseTransform } from '../assembly/math.js';
import { solveAttachment } from '../assembly/solver.js';
import { checkMultiPointConnection, physicalEndpointKey, sourceEndpointKey } from '../assembly/multipoint.js';
import { isGeneratableCapabilityFor, placementCollisionClass, type AssemblyInterfaceCapability, type NativeAssembly, type NativePlacement, type RigidTransform } from '../assembly/types.js';
import type { NativeGeneratorEngine } from '../assembly/generator.js';
import { rankModulePoses, type ModuleSelection } from './candidates.js';
import { moduleSupport, type InstallationSupport } from './support.js';

export function sameModulePose(a: RigidTransform, b: RigidTransform): boolean {
  return a.rotation.every((v, i) => Math.abs(v - b.rotation[i]) <= 1e-6) && a.translation.every((v, i) => Math.abs(v - b.translation[i]) <= 1e-5);
}
const allowed = (capability: AssemblyInterfaceCapability | undefined, member: Pick<ModuleMember, 'collisionClass'>) => new Set(
  member.collisionClass === 'exterior-shell' ? capability?.exteriorAllowedConnectionIds ?? [] : capability?.allowedConnectionIds ?? []);
export interface ModuleInstance {
  id: string; moduleId: string; version: string; recipeDigest: string; source: ModuleRecipe['source']; adaptation: string;
  transform: RigidTransform; members: { localId: string; instanceId: string; sourcePartId: string; actualPartId: string; sourceColor: string }[];
  installationSupport: InstallationSupport;
}
export interface ModuleComposition {
  schema: 'native-module-composition-1'; libraryDigest: string; policy: ReturnType<typeof policy>; instances: ModuleInstance[];
}
export interface VerifiedModule extends ModuleDefinition {
  graph: NativeAssembly; memberInstances: Map<string, string>;
  ports: { localId: string; connectionId: string }[];
}
export interface ModuleAttemptBudget {
  take(): boolean;
  /** Ranked pose evaluation shares the generator's existing attempt/time budget. */
  consider?(): boolean;
  record?(accepted: boolean, rejections: { code: string; reason: string }[]): void;
}
export interface ModuleInstallationResult {
  accepted: boolean;
  graph: NativeAssembly & { moduleComposition?: ModuleComposition };
  composition?: ModuleComposition;
  reasons: string[];
}
interface ReplayResult { graph: NativeAssembly; map: Map<string, string>; reasons: string[]; complete: boolean; }

/** Replays a source layout, never searches arbitrary coordinates or moves a
 * member independently. Every insertion uses the ordinary production engine. */
async function replay(engine: NativeGeneratorEngine, graph: NativeAssembly, members: ModuleMember[], seeds: Map<string, string>, budget: ModuleAttemptBudget): Promise<ReplayResult> {
  const map = new Map(seeds), reasons: string[] = [];
  let pending = members.filter(member => !map.has(member.localId));
  while (pending.length) {
    let placed = false;
    for (const member of pending) {
      const movingPart = await engine.getPart(member.partId), movingCap = await engine.getCapability(member.partId);
      if (!movingPart || !isGeneratableCapabilityFor(movingCap, member.collisionClass)) return { graph, map, reasons: [`Source/class admission unavailable: ${member.partId}`], complete: false };
      for (const instanceId of map.values()) {
        const fixed = graph.placements.find(p => p.instanceId === instanceId)!, fixedPart = (await engine.getPart(fixed.partId))!;
        const fixedCap = await engine.getCapability(fixed.partId);
        const target: NativePlacement = { instanceId: 'module-source-candidate', partId: member.partId, transform: member.transform, collisionClass: member.collisionClass };
        const matches = checkMultiPointConnection({ fixedPart, fixedPlacement: fixed, movingPart, movingPlacement: target,
          allowedFixedConnectionIds: allowed(fixedCap, { collisionClass: placementCollisionClass(fixed) }), allowedMovingConnectionIds: allowed(movingCap, member) });
        if (matches.status !== 'consistent') { reasons.push(...matches.issues.map(x => x.reason)); continue; }
        for (const match of matches.matches) {
          const solved = solveAttachment({ fixedPart, fixedPlacement: fixed, fixedConnectionId: match.fixedConnectionId, movingPart, movingConnectionId: match.movingConnectionId });
          const exact = solved.candidates.find(candidate => sameModulePose(candidate.transform, member.transform));
          if (!exact) continue;
          if (!budget.take()) return { graph, map, reasons: ['Module attachment search budget exhausted.'], complete: false };
          const result = await engine.attachPart(graph, { anchorInstanceId: instanceId, anchorConnectionId: match.fixedConnectionId, partId: member.partId,
            candidateConnectionId: match.movingConnectionId, twistDegrees: exact.twistDeg, collisionClass: member.collisionClass });
          budget.record?.(result.accepted, result.rejections);
          if (!result.accepted) { reasons.push(...result.rejections.map(x => `${x.code}: ${x.reason}`)); continue; }
          const added = result.graph.placements.find(p => !graph.placements.some(q => q.instanceId === p.instanceId));
          if (!added || !sameModulePose(added.transform, member.transform)) return { graph, map, reasons: ['Engine pose differs from the single rigid module transform.'], complete: false };
          graph = result.graph; map.set(member.localId, added.instanceId); pending = pending.filter(m => m !== member); placed = true; break;
        }
        if (placed) break;
      }
      if (placed) break;
    }
    if (!placed) return { graph, map, complete: false, reasons: [...new Set(reasons)].slice(0, 20).concat('No current legal attachment reproduces the remaining source placements.') };
  }
  return { graph, map, complete: true, reasons: [] };
}

export class ModuleAssembler {
  private readonly verified = new Map<string, VerifiedModule>();
  constructor(readonly engine: NativeGeneratorEngine, readonly catalog = new ModuleCatalog()) {}
  async compile(id: string): Promise<VerifiedModule> {
    const definition = this.catalog.get(id); // Source bytes are checked even on cache hits.
    const cached = this.verified.get(id);
    if (cached) {
      if (!(await this.engine.validateGraph(cached.graph)).valid) { this.verified.delete(id); throw new Error('Cached module admission is no longer current.'); }
      // An unused port can be revoked while the internal graph remains valid.
      // Recompute published ports against current permissions on every hit.
      cached.ports = await this.availablePorts(cached, cached.graph, cached.memberInstances);
      return structuredClone(cached);
    }
    const root = definition.members[0];
    let graph = await this.engine.createAssembly(root.partId, root.collisionClass);
    const started = performance.now(); let attempts = 0;
    const result = await replay(this.engine, graph, definition.members, new Map([[root.localId, graph.placements[0].instanceId]]),
      { take: () => ++attempts <= 512 && performance.now() - started < 10_000 });
    if (!result.complete) throw new Error(result.reasons.join(' '));
    graph = result.graph;
    const validation = await this.engine.validateGraph(graph);
    if (!validation.valid) throw new Error(validation.issues.join(' '));
    const ports = await this.availablePorts(definition, graph, result.map);
    const verified = { ...definition, graph, memberInstances: result.map, ports };
    this.verified.set(id, structuredClone(verified));
    return verified;
  }
  private async availablePorts(definition: ModuleDefinition, graph: NativeAssembly, instances: Map<string, string>) {
    const occupied = new Set<string>(), ports: VerifiedModule['ports'] = [], seen = new Set<string>();
    for (const edge of graph.edges) for (const [instance, port] of [[edge.fixedInstanceId, edge.fixedConnectionId], [edge.movingInstanceId, edge.movingConnectionId]]) {
      const p = graph.placements.find(p => p.instanceId === instance)!;
      occupied.add(sourceEndpointKey(instance, port, (await this.engine.getPart(p.partId))!));
    }
    for (const member of definition.members) {
      const instance = instances.get(member.localId)!, part = (await this.engine.getPart(member.partId))!, cap = await this.engine.getCapability(member.partId);
      for (const point of part.connections.points) {
        if (!allowed(cap, member).has(point.id)) continue;
        const key = physicalEndpointKey(instance, point);
        if (occupied.has(key) || seen.has(key)) continue;
        seen.add(key); ports.push({ localId: member.localId, connectionId: point.id });
      }
    }
    if (!ports.length) throw new Error('Module has no unoccupied current source interface.');
    return ports;
  }
  async list() {
    const rows = [];
    for (const recipe of this.catalog.list()) {
      try { const module = await this.compile(recipe.id); rows.push({ id: recipe.id, name: recipe.name, role: recipe.role, status: 'VALIDATED', parts: module.members.length, ports: module.ports, reasons: [], source: recipe.source, adaptation: recipe.adaptation }); }
      catch (error) { rows.push({ id: recipe.id, name: recipe.name, role: recipe.role, status: 'BLOCKED', parts: recipe.selectedOrdinals.length, ports: [], reasons: [error instanceof Error ? error.message : String(error)], source: recipe.source, adaptation: recipe.adaptation }); }
    }
    return { schema: MODULE_ASSEMBLY_VERSION, libraryDigest: MODULE_LIBRARY_DIGEST, policy: policy(), modules: rows, physicalBuildVerified: false };
  }
  /** Yield ranked, fully validated alternatives so multi-module search can
   * backtrack without mutating the accepted input graph or publishing partials. */
  async *installations(graph: NativeAssembly, id: string, budget: ModuleAttemptBudget, selection?: ModuleSelection): AsyncGenerator<ModuleInstallationResult, ModuleInstallationResult> {
    const module = await this.compile(id), reasons: string[] = [];
    const blocked = (reason: string): ModuleInstallationResult => ({ accepted: false, graph, reasons: [...new Set([...reasons, reason])].slice(0, 20) });
    let prior: ModuleComposition | undefined;
    try { prior = checkModuleEnvelope(graph); }
    catch (error) { return blocked(error instanceof Error ? error.message : String(error)); }
    if ((prior?.instances.length ?? 0) >= 3) return blocked('Module provenance instance limit reached.');
    if (graph.placements.length + module.members.length > 32) return blocked('Module composition exceeds the unchanged 32-placement document limit.');
    const inputValidation = await this.engine.validateGraph(graph);
    if (!inputValidation.valid) { reasons.push(...inputValidation.issues); return blocked('Input graph is not currently valid.'); }
    const poses = await rankModulePoses(this.engine, graph, module, budget, selection);
    for (const pose of poses) {
      if (!budget.take()) return blocked('Module attachment search budget exhausted.');
      const port = pose.selection, entry = module.members.find(m => m.localId === port.localId)!;
      const attached = await this.engine.attachPart(graph, { anchorInstanceId: port.anchorInstanceId, anchorConnectionId: port.anchorConnectionId,
        partId: entry.partId, candidateConnectionId: port.connectionId, twistDegrees: port.twistDegrees, collisionClass: entry.collisionClass });
      budget.record?.(attached.accepted, attached.rejections);
      if (!attached.accepted) { reasons.push(...attached.rejections.map(r => `${r.code}: ${r.reason}`)); continue; }
      const added = attached.graph.placements.find(p => !graph.placements.some(q => q.instanceId === p.instanceId))!;
      const targets = module.members.map(member => ({ ...member, transform: composeTransforms(pose.transform, member.transform) }));
      if (!sameModulePose(added.transform, targets.find(m => m.localId === entry.localId)!.transform)) throw new Error('Engine and source solver disagree about module entry pose.');
      const assembled = await replay(this.engine, attached.graph, targets, new Map([[entry.localId, added.instanceId]]), budget);
      if (!assembled.complete) { reasons.push(...assembled.reasons); continue; }
      const validation = await this.engine.validateGraph(assembled.graph);
      if (!validation.valid) { reasons.push(...validation.issues); continue; }
      const support = moduleSupport(assembled.graph, new Set(assembled.map.values()));
      if (support.independentPoints !== pose.support.independentPoints) { reasons.push('Actual production contacts differ from predicted source-interface support.'); continue; }
      let instanceId = `module-${graph.placements.length}`;
      while (prior?.instances.some(instance => instance.id === instanceId)) instanceId += '-new';
      const instance: ModuleInstance = { id: instanceId, moduleId: id, version: module.recipe.version,
        recipeDigest: module.recipeDigest, source: structuredClone(module.recipe.source), adaptation: module.recipe.adaptation, transform: pose.transform,
        members: module.members.map(m => ({ localId: m.localId, instanceId: assembled.map.get(m.localId)!, sourcePartId: m.sourcePartId, actualPartId: m.partId, sourceColor: m.sourceColor })),
        installationSupport: support };
      const instances = [...(prior?.instances ?? []), instance].map(record => ({ ...record,
        installationSupport: moduleSupport(assembled.graph, new Set(record.members.map(member => member.instanceId))) }));
      const composition: ModuleComposition = { schema: 'native-module-composition-1', libraryDigest: MODULE_LIBRARY_DIGEST, policy: policy(), instances };
      yield { accepted: true, graph: { ...assembled.graph, moduleComposition: composition }, composition, reasons: [] };
    }
    return blocked('No further unoccupied admissible source-interface placement for this module.');
  }

  async attach(graph: NativeAssembly, id: string, budget: ModuleAttemptBudget, selection?: ModuleSelection): Promise<ModuleInstallationResult> {
    const alternatives = this.installations(graph, id, budget, selection);
    const first = await alternatives.next();
    await alternatives.return(first.value);
    return first.value;
  }

}

const assemblers = new WeakMap<NativeGeneratorEngine, ModuleAssembler>();
export function moduleAssemblerFor(engine: NativeGeneratorEngine) {
  let assembler = assemblers.get(engine);
  if (!assembler) { assembler = new ModuleAssembler(engine); assemblers.set(engine, assembler); }
  return assembler;
}

/** Uploads cannot authorize modules. Rebuild against reviewed local recipes,
 * current part permissions and exact single-rigid-transform membership. */
export async function inspectModuleComposition(model: NativeAssembly & { module?: string; moduleComposition?: ModuleComposition }, engine: NativeGeneratorEngine) {
  const reasons: string[] = [];
  try {
    const composition = checkModuleEnvelope(model);
    if (!composition) return {valid:true,reasons,composition:undefined};
    for(const instance of composition.instances) await moduleAssemblerFor(engine).compile(instance.moduleId);
    return {valid:true,reasons,composition};
  } catch(error) {
    reasons.push(error instanceof Error ? error.message : String(error));
    return {valid:false,reasons,composition:undefined};
  }
}
