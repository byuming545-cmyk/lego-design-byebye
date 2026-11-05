import { distance, transformPoint } from '../assembly/math.js';
import type { NativeAssembly, NativeAssemblyPart, Vector3 } from '../assembly/types.js';
import type { ModuleMember } from './catalog.js';

const COINCIDENT_LDU = 1e-5; // Same numerical closure scale as the source matcher.
export interface InstallationSupport {
  independentPoints: number;
  anchorsLdu: Vector3[];
  spanLdu: number;
  status: 'none' | 'single-point' | 'multi-point';
  scope: 'current-final-pose-interfaces-only';
  physicalStability: 'not-verified';
}

/** Count distinct geometric mounting locations, not raw source aliases or
 * colocated features. This describes validated contacts, never retention force. */
export function measureSupport(points: readonly Vector3[]): InstallationSupport {
  const anchors: Vector3[] = [];
  for (const point of points) {
    if (point.length !== 3 || !point.every(Number.isFinite)) throw new Error('Invalid source support anchor.');
    if (!anchors.some(other => distance(point, other) <= COINCIDENT_LDU)) anchors.push([...point]);
  }
  let spanLdu = 0;
  for (let i = 0; i < anchors.length; i++) for (let j = i + 1; j < anchors.length; j++) spanLdu = Math.max(spanLdu, distance(anchors[i], anchors[j]));
  return { independentPoints: anchors.length, anchorsLdu: anchors, spanLdu,
    status: anchors.length > 1 ? 'multi-point' : anchors.length ? 'single-point' : 'none',
    scope: 'current-final-pose-interfaces-only', physicalStability: 'not-verified' };
}

/** Only call this as evidence after the graph has passed the production engine.
 * Extra forged/alias edges cannot create additional noncoincident locations. */
export function moduleSupport(graph: NativeAssembly, memberIds: ReadonlySet<string>): InstallationSupport {
  return measureSupport(graph.edges.filter(edge => memberIds.has(edge.fixedInstanceId) !== memberIds.has(edge.movingInstanceId)).map(edge => edge.anchor));
}

/** A source bounding-box centre for tie-breaking, explicitly not centre of mass. */
export function moduleGeometryCenter(members: readonly ModuleMember[], parts: ReadonlyMap<string, NativeAssemblyPart>): Vector3 {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const member of members) {
    const bounds = parts.get(member.partId)?.geometry.bounds;
    if (!bounds) throw new Error('Native source bounds unavailable.');
    for (let corner = 0; corner < 8; corner++) {
      const point = transformPoint(member.transform, bounds.min.map((value, axis) => corner & (1 << axis) ? bounds.max[axis] : value) as Vector3);
      for (let axis = 0; axis < 3; axis++) { min[axis] = Math.min(min[axis], point[axis]); max[axis] = Math.max(max[axis], point[axis]); }
    }
  }
  return min.map((value, axis) => (value + max[axis]) / 2) as Vector3;
}

export function centeringDistance(support: InstallationSupport, center: Vector3): number {
  if (!support.anchorsLdu.length) return Infinity;
  const average = [0, 0, 0] as Vector3;
  for (const point of support.anchorsLdu) for (let axis = 0; axis < 3; axis++) average[axis] += point[axis] / support.anchorsLdu.length;
  return distance(average, center);
}
