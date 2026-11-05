import { composeTransforms, inverseTransform, transformPoint } from '../assembly/math.js';
import { checkMultiPointConnection, physicalEndpointKey, sourceEndpointKey } from '../assembly/multipoint.js';
import { solveAttachment } from '../assembly/solver.js';
import { placementCollisionClass, type AssemblyInterfaceCapability, type NativeAssembly, type NativeAssemblyPart, type RigidTransform } from '../assembly/types.js';
import type { NativeGeneratorEngine } from '../assembly/generator.js';
import type { ModuleAttemptBudget, VerifiedModule } from './assembly.js';
import { centeringDistance, measureSupport, moduleGeometryCenter, type InstallationSupport } from './support.js';

export interface ModuleSelection { anchorInstanceId: string; anchorConnectionId: string; localId: string; connectionId: string; twistDegrees?: number }
export interface ModulePose {
  selection: Required<ModuleSelection>;
  transform: RigidTransform;
  support: InstallationSupport;
  centeringDistanceLdu: number;
}
const admitted = (cap: AssemblyInterfaceCapability | undefined, exterior: boolean) => new Set(exterior ? cap?.exteriorAllowedConnectionIds ?? [] : cap?.allowedConnectionIds ?? []);
function connectorBounds(part: NativeAssemblyPart, transform: RigidTransform) {
  const points = part.connections.points.map(point => transformPoint(transform, point.position));
  return { min: [0, 1, 2].map(axis => Math.min(...points.map(point => point[axis]))), max: [0, 1, 2].map(axis => Math.max(...points.map(point => point[axis]))) };
}

/** Finite poses come exclusively from source connector frames. Contact scoring
 * is a precheck; every ranked pose still needs whole-module production replay. */
export async function rankModulePoses(engine: NativeGeneratorEngine, graph: NativeAssembly, module: VerifiedModule,
  budget: ModuleAttemptBudget, selection?: ModuleSelection): Promise<ModulePose[]> {
  const parts = new Map<string, NativeAssemblyPart>(), caps = new Map<string, AssemblyInterfaceCapability | undefined>();
  for (const id of new Set([...graph.placements.map(p => p.partId), ...module.members.map(m => m.partId)])) {
    const part = await engine.getPart(id);
    if (!part) throw new Error('Module candidate source unavailable: ' + id);
    parts.set(id, part); caps.set(id, await engine.getCapability(id));
  }
  const occupied = new Set<string>();
  for (const edge of graph.edges) for (const [id, port] of [[edge.fixedInstanceId, edge.fixedConnectionId], [edge.movingInstanceId, edge.movingConnectionId]]) {
    occupied.add(sourceEndpointKey(id, port, parts.get(graph.placements.find(p => p.instanceId === id)!.partId)));
  }
  const openModule = new Set(module.ports.map(port => physicalEndpointKey(port.localId,
    parts.get(module.members.find(m => m.localId === port.localId)!.partId)!.connections.points.find(p => p.id === port.connectionId)!)));
  const center = moduleGeometryCenter(module.members, parts), seen = new Set<string>(), poses: ModulePose[] = [];
  const baseBounds = new Map(graph.placements.map(base => [base.instanceId, connectorBounds(parts.get(base.partId)!, base.transform)]));
  outer: for (const fixed of graph.placements) {
    if (selection && selection.anchorInstanceId !== fixed.instanceId) continue;
    const fixedPart = parts.get(fixed.partId)!, fixedAllowed = admitted(caps.get(fixed.partId), placementCollisionClass(fixed) === 'exterior-shell');
    const seenAnchors = new Set<string>();
    for (const anchor of fixedPart.connections.points) {
      const key = physicalEndpointKey(fixed.instanceId, anchor);
      if (!fixedAllowed.has(anchor.id) || occupied.has(key) || seenAnchors.has(key) || selection && selection.anchorConnectionId !== anchor.id) continue;
      seenAnchors.add(key);
      for (const port of module.ports) {
        if (selection && (selection.localId !== port.localId || selection.connectionId !== port.connectionId)) continue;
        const entry = module.members.find(m => m.localId === port.localId)!, movingPart = parts.get(entry.partId)!;
        const solved = solveAttachment({ fixedPart, fixedPlacement: fixed, fixedConnectionId: anchor.id, movingPart, movingConnectionId: port.connectionId,
          ...(selection?.twistDegrees === undefined ? {} : { twistsDeg: [selection.twistDegrees] }) });
        for (const pose of solved.candidates) {
          const transform = composeTransforms(pose.transform, inverseTransform(entry.transform));
          const poseKey = [...transform.rotation, ...transform.translation].map(n => Math.round(n * 1e6)).join(',');
          if (seen.has(poseKey)) continue;
          seen.add(poseKey);
          if (budget.consider && !budget.consider()) break outer;
          const endpoints = new Set<string>(), anchors = []; let valid = true;
          for (const member of module.members) {
            const target = { instanceId: member.localId, partId: member.partId, transform: composeTransforms(transform, member.transform) };
            const movingBounds = connectorBounds(parts.get(member.partId)!, target.transform);
            for (const base of graph.placements) {
              const fixedBounds = baseBounds.get(base.instanceId)!;
              // Pure point-position broad phase, including disabled source features.
              // Disjoint endpoint bounds cannot contain a coincident mating pair.
              if (movingBounds.min.some((min, axis) => min > fixedBounds.max[axis] + 1e-5 || movingBounds.max[axis] < fixedBounds.min[axis] - 1e-5)) continue;
              const matches = checkMultiPointConnection({ fixedPart: parts.get(base.partId)!, fixedPlacement: base,
                movingPart: parts.get(member.partId)!, movingPlacement: target,
                allowedFixedConnectionIds: admitted(caps.get(base.partId), placementCollisionClass(base) === 'exterior-shell'),
                allowedMovingConnectionIds: admitted(caps.get(member.partId), member.collisionClass === 'exterior-shell') });
              if (matches.status !== 'consistent') { valid = false; break; }
              for (const match of matches.matches) {
                const baseKey = sourceEndpointKey(base.instanceId, match.fixedConnectionId, parts.get(base.partId));
                const memberKey = sourceEndpointKey(member.localId, match.movingConnectionId, parts.get(member.partId));
                // Prefix each side because real graph instance IDs and source-local IDs are separate namespaces.
                if (occupied.has(baseKey) || !openModule.has(memberKey) || endpoints.has('base:' + baseKey) || endpoints.has('module:' + memberKey)) { valid = false; break; }
                if (!admitted(caps.get(base.partId), placementCollisionClass(base) === 'exterior-shell').has(match.fixedConnectionId) ||
                    !admitted(caps.get(member.partId), member.collisionClass === 'exterior-shell').has(match.movingConnectionId)) { valid = false; break; }
                endpoints.add('base:' + baseKey); endpoints.add('module:' + memberKey); anchors.push(match.candidate.anchor);
              }
              if (!valid) break;
            }
            if (!valid) break;
          }
          if (!valid || !anchors.length) continue;
          const support = measureSupport(anchors);
          poses.push({ selection: { anchorInstanceId: fixed.instanceId, anchorConnectionId: anchor.id, localId: port.localId, connectionId: port.connectionId, twistDegrees: pose.twistDeg },
            transform, support, centeringDistanceLdu: centeringDistance(support, transformPoint(transform, center)) });
        }
      }
    }
  }
  // Stable iteration order is only the final tie breaker, not the support policy.
  return poses.sort((a, b) => b.support.independentPoints - a.support.independentPoints || b.support.spanLdu - a.support.spanLdu || a.centeringDistanceLdu - b.centeringDistanceLdu);
}
