import type { Vector3 } from './types.js';
import type { CollisionTriangle } from './proxy.js';
import { polygonArea, splitConvexPolygon } from './proxy.js';
import { cross, distance, dot, normalize, subtract } from './math.js';

export interface CoplanarContact {
  status: 'disjoint' | 'contact' | 'unknown';
  points: Vector3[];
  dimension: 0 | 1 | 2 | null;
  reason: string;
}

/** Intersect actual source triangles, not their bounding boxes or all input
 * vertices. Half-space clipping reuses the project's existing polygon kernel.
 * No tolerance expansion, mesh repair or source-geometry change is performed.
 *
 * Study reference: three-mesh-bvh ExtendedTriangle.intersectsTriangle separates
 * coplanar SAT overlap from noncoplanar intersection segments. Its coplanar
 * output segment is a documented placeholder, unsuitable as a seating witness.
 * This implementation is independent; source/version/licence in the report.
 */
export function intersectCoplanarSourceTriangles(
  a: Pick<CollisionTriangle, 'vertices' | 'normal'>,
  b: Pick<CollisionTriangle, 'vertices' | 'normal'>,
  toleranceLdu: number,
): CoplanarContact {
  const unknown = (reason: string): CoplanarContact => ({ status: 'unknown', points: [], dimension: null, reason });
  if (!Number.isFinite(toleranceLdu) || toleranceLdu <= 0 || [...a.vertices, ...b.vertices, a.normal, b.normal].some(point => point.length !== 3 || !point.every(Number.isFinite))) return unknown('Nonfinite source contact input.');
  const normalA = normalize(a.normal), normalB = normalize(b.normal);
  if (!normalA || !normalB) return unknown('Degenerate source plane.');
  if (Math.abs(dot(normalA, normalB)) < 1 - 1e-6 || b.vertices.some(point => Math.abs(dot(normalA, subtract(point, a.vertices[0]))) > toleranceLdu)) return unknown('Source triangles are not coplanar at the existing comparison tolerance.');
  let polygon: Vector3[] = a.vertices.map(point => [...point]);
  for (let edge = 0; edge < 3; edge++) {
    const start = b.vertices[edge], end = b.vertices[(edge + 1) % 3];
    const inward = normalize(cross(normalB, subtract(end, start)));
    if (!inward) return unknown('Degenerate source edge.');
    // Zero clipping expansion: every output point belongs to the computed
    // intersection. Keep even very close vertices for the later seat test.
    polygon = splitConvexPolygon(polygon, { normal: inward, offset: dot(inward, start) }, 0).positive;
    if (!polygon.length) return { status: 'disjoint', points: [], dimension: null, reason: 'Coplanar source triangles have no common region.' };
    if (polygon.length > 16) return unknown('Source contact polygon exceeded the triangle clipping bound.');
  }
  const area = polygonArea(polygon, normalA), span = Math.max(...polygon.map(p => Math.max(...polygon.map(q => distance(p, q)))));
  return { status: 'contact', points: polygon, dimension: area > toleranceLdu * toleranceLdu ? 2 : span > toleranceLdu ? 1 : 0,
    reason: 'Actual source intersection points retained; seat permission and containment remain separate checks.' };
}
