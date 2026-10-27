import type { NativeAssemblyPart, NativePlacement, Vector3 } from './types.js';
import type { ConnectionPenetrationZone } from './solver.js';
import { createHash } from 'node:crypto';
import { BAR_CLIP_RULE_ID, checkConnectionCompatibility, PIN_HOLE_RULE_ID, STANDARD_STUD_RULE_ID } from './compatibility.js';
import { add, cross, distance, dot, isRigidTransform, length, normalize, rotate, scale, subtract, transformPoint } from './math.js';
import { boundsOverlap, buildNativeCollisionProxy, polygonArea, splitConvexPolygon, nativeBounds } from './proxy.js';
import type { CollisionProxy, CollisionTriangle, MeshBounds, Plane, TriangleBvh } from './proxy.js';

export const COLLISION_VERSION = 'native-open-surface-seat-2.0.0';
/** A numerical surface-comparison tolerance, not modified LEGO geometry. */
export const COLLISION_TOLERANCE_LDU = 0.0001;
const EPS = COLLISION_TOLERANCE_LDU;
const MAX_TRIANGLE_TESTS = 1_000_000;
const MAX_PATCHES_PER_TRIANGLE = 256;
const MAX_TOTAL_PATCHES = 120_000;
/** A synchronous query must yield a conservative result within a bounded budget. */
export const COLLISION_COMPUTATION_BUDGET_MS = 5_000;

export interface PairCollisionResult {
  status: 'clear' | 'collision' | 'blocked';
  reason: string;
  reasonCode: string;
  collisionVersion: string;
  toleranceLdu: number;
  triangleTests: number;
  checkedSurfacePatches: number;
  spatialPartitionFallbacks: number;
  classification: string;
  witness?: Vector3;
  proof: {
    broadPhaseOnly: boolean;
    closedSourceProxies: boolean;
    openSourceSurfaces: boolean;
    openSurfaceSeatChecked: boolean;
    completeSurfacePartition: boolean;
    containmentChecked: boolean;
    sourceEvidence: Array<CollisionProxy['evidence']>;
    topology: Array<CollisionProxy['topology']>;
    penetrationZone: ConnectionPenetrationZone | null;
    penetrationZoneValidated: boolean;
    wholePairExempted: false;
    certificateKey?: string;
    reusedCertificate?: boolean;
  };
}
type Classification = 'inside' | 'outside' | 'boundary' | 'unknown';

function centroid(polygon: Vector3[]): Vector3 { return scale(polygon.reduce((sum, point) => add(sum, point), [0, 0, 0] as Vector3), 1 / polygon.length); }
function pointInBounds(point: Vector3, bounds: MeshBounds, margin = EPS): boolean {
  return point.every((value, axis) => value >= bounds.min[axis] - margin && value <= bounds.max[axis] + margin);
}
function rayBounds(origin: Vector3, direction: Vector3, bounds: MeshBounds, tolerance = EPS): boolean {
  let start = 0, end = Infinity;
  for (let axis = 0; axis < 3; axis++) {
    let a = (bounds.min[axis] - origin[axis]) / direction[axis], b = (bounds.max[axis] - origin[axis]) / direction[axis];
    if (a > b) [a, b] = [b, a];
    start = Math.max(start, a); end = Math.min(end, b);
    if (end < start) return false;
  }
  return end > tolerance;
}
function pointTriangleDistanceSquared(point: Vector3, face: CollisionTriangle): number {
  // Ericson closest-point regions; includes vertices/edges rather than relying
  // on a face-plane distance that would falsely classify points beyond a face.
  const [a, b, c] = face.vertices, ab = subtract(b, a), ac = subtract(c, a), ap = subtract(point, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return dot(ap, ap);
  const bp = subtract(point, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return dot(bp, bp);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const delta = subtract(point, add(a, scale(ab, d1 / (d1 - d3)))); return dot(delta, delta); }
  const cp = subtract(point, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return dot(cp, cp);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const delta = subtract(point, add(a, scale(ac, d2 / (d2 - d6)))); return dot(delta, delta); }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const delta = subtract(point, add(b, scale(subtract(c, b), (d4 - d3) / (d4 - d3 + d5 - d6)))); return dot(delta, delta); }
  const inverse = 1 / (va + vb + vc), v = vb * inverse, w = vc * inverse;
  const delta = subtract(point, add(a, add(scale(ab, v), scale(ac, w))));
  return dot(delta, delta);
}
function onSurface(proxy: CollisionProxy, point: Vector3, node = proxy.bvh, tolerance = EPS): boolean {
  if (!pointInBounds(point, node.bounds, tolerance)) return false;
  if (node.triangles) return node.triangles.some(id => pointTriangleDistanceSquared(point, proxy.triangles[id]) <= tolerance * tolerance);
  return (!!node.left && onSurface(proxy, point, node.left, tolerance)) || (!!node.right && onSurface(proxy, point, node.right, tolerance));
}
function rayFace(origin: Vector3, direction: Vector3, face: CollisionTriangle, tolerance = EPS): { distance: number; sign: number; edge: boolean } | null {
  const [a, b, c] = face.vertices, e1 = subtract(b, a), e2 = subtract(c, a), p = cross(direction, e2), determinant = dot(e1, p);
  if (Math.abs(determinant) < 1e-10) return null;
  const inverse = 1 / determinant, t = subtract(origin, a), u = dot(t, p) * inverse;
  if (u < -1e-9 || u > 1 + 1e-9) return null;
  const q = cross(t, e1), v = dot(direction, q) * inverse;
  if (v < -1e-9 || u + v > 1 + 1e-9) return null;
  const distance = dot(e2, q) * inverse;
  if (distance <= tolerance) return null;
  return { distance, sign: dot(face.normal, direction) > 0 ? 1 : -1, edge: Math.min(u, v, 1 - u - v) < 1e-8 };
}
function rayWinding(proxy: CollisionProxy, origin: Vector3, direction: Vector3, tolerance = EPS): number | null {
  let winding = 0, grazing = false;
  const visit = (node: TriangleBvh) => {
    if (!rayBounds(origin, direction, node.bounds, tolerance)) return;
    if (node.triangles) for (const id of node.triangles) {
      const hit = rayFace(origin, direction, proxy.triangles[id], tolerance);
      if (hit) { winding += hit.sign; if (hit.edge) grazing = true; }
    }
    else { if (node.left) visit(node.left); if (node.right) visit(node.right); }
  };
  visit(proxy.bvh);
  return grazing || winding < 0 ? null : winding;
}
const RAY_DIRECTIONS = [[1, 0.371390676, 0.217613642], [-0.4931837, 1, 0.299171], [0.173219, -0.619107, 1], [-1, -0.23731, -0.413113], [0.347157, -1, -0.71931], [0.76173, 0.123777, -1]].map(value => normalize(value as Vector3)!);

function classifyPoint(proxy: CollisionProxy, point: Vector3, tolerance = EPS): Classification {
  if (!pointInBounds(point, proxy.bounds, tolerance)) return 'outside';
  if (onSurface(proxy, point, proxy.bvh, tolerance)) return 'boundary';
  let inside: boolean | undefined; let accepted = 0;
  for (const direction of RAY_DIRECTIONS) {
    const winding = rayWinding(proxy, point, direction, tolerance);
    if (winding === null) continue;
    const value = winding > 0;
    if (inside !== undefined && inside !== value) return 'unknown';
    inside = value; accepted++;
    if (accepted >= 3) return value ? 'inside' : 'outside';
  }
  return 'unknown';
}

function planeCut(face: CollisionTriangle, plane: Plane): Vector3[] {
  const points: Vector3[] = [];
  for (let i = 0; i < 3; i++) {
    const a = face.vertices[i], b = face.vertices[(i + 1) % 3], da = dot(a, plane.normal) - plane.offset, db = dot(b, plane.normal) - plane.offset;
    if (Math.abs(da) <= EPS) points.push(a);
    if ((da > EPS && db < -EPS) || (da < -EPS && db > EPS)) points.push(add(a, scale(subtract(b, a), da / (da - db))));
  }
  return points;
}
function coplanarOverlap(a: CollisionTriangle, b: CollisionTriangle): boolean {
  let polygon: Vector3[] = a.vertices;
  for (let i = 0; i < 3 && polygon.length >= 3; i++) {
    const start = b.vertices[i], end = b.vertices[(i + 1) % 3], normal = cross(b.normal, subtract(end, start));
    polygon = splitConvexPolygon(polygon, { normal, offset: dot(normal, start) }, EPS).positive;
  }
  return polygon.length >= 3 && polygonArea(polygon, a.normal) > EPS * EPS;
}
function intersectionPlanes(a: CollisionTriangle, b: CollisionTriangle): { a: Plane[]; b: Plane[] } | null {
  const planeA = { normal: a.normal, offset: dot(a.normal, a.vertices[0]) }, planeB = { normal: b.normal, offset: dot(b.normal, b.vertices[0]) };
  const line = cross(a.normal, b.normal), magnitude = length(line);
  if (magnitude < 1e-8) {
    if (Math.abs(dot(a.normal, b.vertices[0]) - planeA.offset) > EPS || !coplanarOverlap(a, b)) return null;
    const edges = (face: CollisionTriangle) => face.vertices.map((start, i) => {
      const normal = normalize(cross(face.normal, subtract(face.vertices[(i + 1) % 3], start)))!;
      return { normal, offset: dot(normal, start) };
    });
    return { a: edges(b), b: edges(a) };
  }
  const cutA = planeCut(a, planeB), cutB = planeCut(b, planeA);
  if (cutA.length === 0 || cutB.length === 0) return null;
  const direction = scale(line, 1 / magnitude), valuesA = cutA.map(point => dot(point, direction)), valuesB = cutB.map(point => dot(point, direction));
  if (Math.min(Math.max(...valuesA), Math.max(...valuesB)) < Math.max(Math.min(...valuesA), Math.min(...valuesB)) - EPS) return null;
  return { a: [planeB], b: [planeA] };
}
function partitionFace(face: CollisionTriangle, planes: Plane[], retainSlivers = false): Vector3[][] | null {
  let patches: Vector3[][] = [face.vertices];
  const used = new Set<string>();
  for (const plane of planes) {
    const sign = (plane.normal.find(value => Math.abs(value) > 1e-8) ?? 1) < 0 ? -1 : 1;
    const key = [...plane.normal.map(value => Math.round(value * sign * 1e6)), Math.round(plane.offset * sign / EPS)].join(',');
    if (used.has(key)) continue;
    used.add(key);
    const next: Vector3[][] = [];
    for (const patch of patches) {
      const distances = patch.map(point => dot(point, plane.normal) - plane.offset);
      if (Math.min(...distances) >= -EPS || Math.max(...distances) <= EPS) { next.push(patch); continue; }
      const split = splitConvexPolygon(patch, plane, 1e-9);
      if (split.positive.length >= 3 && polygonArea(split.positive, face.normal) > (retainSlivers ? 0 : EPS * EPS)) next.push(split.positive);
      if (split.negative.length >= 3 && polygonArea(split.negative, face.normal) > (retainSlivers ? 0 : EPS * EPS)) next.push(split.negative);
    }
    patches = next;
    if (patches.length > MAX_PATCHES_PER_TRIANGLE) return null;
  }
  return patches;
}
/** Spatially local complete partitions of the unchanged source triangle. */
function adaptivePartition(face: CollisionTriangle, other: CollisionProxy, deadline: number, consumeTest: () => boolean): Vector3[][] | null {
  const pending = [{ face, depth: 0 }], output: Vector3[][] = [];
  while (pending.length) {
    if (performance.now() > deadline) return null;
    const current = pending.pop()!;
    const planes: Plane[] = [];
    let exhausted = false;
    const visit = (node: TriangleBvh) => {
      if (exhausted || !boundsOverlap(current.face.bounds, node.bounds, EPS)) return;
      if (node.triangles) for (const id of node.triangles) {
        const opponent = other.triangles[id];
        if (!boundsOverlap(current.face.bounds, opponent.bounds, EPS)) continue;
        if (!consumeTest()) { exhausted = true; return; }
        const intersection = intersectionPlanes(current.face, opponent);
        if (intersection) planes.push(...intersection.a);
      }
      else { if (node.left) visit(node.left); if (node.right) visit(node.right); }
    };
    visit(other.bvh);
    if (exhausted) return null;
    const cells = partitionFace(current.face, planes, true);
    if (cells) {
      output.push(...cells);
      if (output.length > MAX_TOTAL_PATCHES) return null;
      continue;
    }
    if (current.depth >= 8) return null;
    const [a, b, c] = current.face.vertices;
    const ab = scale(add(a, b), 0.5), bc = scale(add(b, c), 0.5), ca = scale(add(c, a), 0.5);
    for (const vertices of [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]] as [Vector3, Vector3, Vector3][]) {
      pending.push({ face: { ...current.face, vertices, bounds: nativeBounds(vertices) }, depth: current.depth + 1 });
    }
  }
  const area = polygonArea(face.vertices, face.normal);
  const delta = Math.abs(output.reduce((sum, cell) => sum + polygonArea(cell, face.normal), 0) - area); return delta <= EPS * EPS ? output : null;
}

function validateZone(zone: ConnectionPenetrationZone, parts: NativeAssemblyPart[], placements: NativePlacement[]): { source: boolean; spatial: boolean } {
  const invalid = { source: false, spatial: false };
  const expected = zone.ruleId === STANDARD_STUD_RULE_ID ? { radius: 6, minDepth: 4, maxDepth: 4 }
    : zone.ruleId === BAR_CLIP_RULE_ID ? { radius: 4, minDepth: 1, maxDepth: 8 }
    : zone.ruleId === PIN_HOLE_RULE_ID ? { radius: 8, minDepth: 1, maxDepth: 40 } : null;
  if (!expected || zone.kind !== 'cylinder' || !Array.isArray(zone.center) || zone.center.length !== 3 || !zone.center.every(Number.isFinite)
      || !Array.isArray(zone.axis) || zone.axis.length !== 3 || !zone.axis.every(Number.isFinite) || !Array.isArray(zone.sourceEvidence)
      || Math.abs(length(zone.axis) - 1) > 1e-6 || zone.radius !== expected.radius || zone.depth < expected.minDepth || zone.depth > expected.maxDepth
      || !(zone.toleranceLdu > 0 && zone.toleranceLdu <= 0.001)) return invalid;
  const directives = zone.sourceEvidence.filter(evidence => evidence.kind === 'source-directive');
  const matches = (point: NativeAssemblyPart['connections']['points'][number], evidence: typeof directives[number]) => point.source.sha256 === evidence.sha256
    && point.source.path === evidence.file && point.source.revision === evidence.revision && point.source.line === evidence.line && point.source.sourceUrl === evidence.url;
  if (directives.length < 2 || !directives.every(evidence => parts.some(part => part.connections.points.some(point => matches(point, evidence))))) return invalid;
  const endpoints = parts.map(part => part.connections.points.filter(point => directives.some(evidence => matches(point, evidence))));
  let compatibleSource = false;
  for (const a of endpoints[0]) for (const b of endpoints[1]) {
    const rule = checkConnectionCompatibility(a, b);
    if (rule.status !== 'compatible' || rule.ruleId !== zone.ruleId || (zone.ruleId === PIN_HOLE_RULE_ID ? rule.insertionDepthLdu !== null && zone.depth < rule.insertionDepthLdu : rule.insertionDepthLdu !== zone.depth)) continue;
    compatibleSource = true;
    const anchorA = transformPoint(placements[0].transform, a.position), anchorB = transformPoint(placements[1].transform, b.position);
    const axisA = normalize(rotate(placements[0].transform.rotation, a.direction)), axisB = normalize(rotate(placements[1].transform.rotation, b.direction));
    if (!axisA || !axisB) continue;
    if (zone.ruleId === PIN_HOLE_RULE_ID) {
      // A pin may be source-slid through its connector hole; the seat center is
      // the seated receiver origin, not necessarily the male anchor.
      const centerDelta = subtract(zone.center, anchorA);
      const centerRadial = subtract(centerDelta, scale(axisA, dot(centerDelta, axisA)));
      if (distance(axisA, axisB) < 1e-6 && distance(axisA, zone.axis) < 1e-6
          && length(centerRadial) <= zone.toleranceLdu
          && Math.abs(dot(centerDelta, axisA)) <= zone.depth / 2 + zone.toleranceLdu
          && distance(anchorB, zone.center) <= zone.toleranceLdu) return { source: true, spatial: true };
      continue;
    }
    const center = zone.ruleId === BAR_CLIP_RULE_ID ? anchorA : add(anchorA, scale(axisA, zone.depth / 2));
    if (distance(anchorA, anchorB) <= zone.toleranceLdu && distance(axisA, axisB) < 1e-6 && distance(axisA, zone.axis) < 1e-6 && distance(center, zone.center) <= zone.toleranceLdu) return { source: true, spatial: true };
  }
  return { source: compatibleSource, spatial: false };
}


/** The validated seat is the only place an open clip surface may contact the
 * closed bar. It comes from the matched SNAP_CLP/SNAP_CYL endpoints, not from
 * a guessed envelope around the part. */
function pointInSeat(point: Vector3, zone: ConnectionPenetrationZone): boolean {
  const delta = subtract(point, zone.center);
  const along = dot(delta, zone.axis);
  const radial = subtract(delta, scale(zone.axis, along));
  // LDraw stores 4-decimal coordinates, so a nominal R4 polygon can measure
  // R4.0001 at a vertex. This is coordinate quantization, not extra clearance.
  const quantization = 0.002;
  return Math.abs(along) <= zone.depth / 2 + quantization && length(radial) <= zone.radius + quantization;
}

/** Double-sided segment/triangle crossing. Contact (t on either endpoint) is
 * deliberately included so a coplanar seat is checked rather than skipped. */
function segmentFace(start: Vector3, end: Vector3, face: CollisionTriangle): Vector3 | null {
  const direction = subtract(end, start), e1 = subtract(face.vertices[1], face.vertices[0]), e2 = subtract(face.vertices[2], face.vertices[0]);
  const p = cross(direction, e2), determinant = dot(e1, p);
  if (Math.abs(determinant) < 1e-10) return null;
  const inverse = 1 / determinant, t = subtract(start, face.vertices[0]);
  const u = dot(t, p) * inverse;
  if (u < -1e-9 || u > 1 + 1e-9) return null;
  const q = cross(t, e1), v = dot(direction, q) * inverse;
  if (v < -1e-9 || u + v > 1 + 1e-9) return null;
  const distance = dot(e2, q) * inverse;
  if (distance < -EPS || distance > 1 + EPS) return null;
  return add(start, scale(direction, distance));
}

function coplanarFaces(a: CollisionTriangle, b: CollisionTriangle): boolean {
  if (Math.abs(dot(a.normal, b.normal)) < 1 - 1e-6) return false;
  return b.vertices.every(vertex => Math.abs(dot(a.normal, subtract(vertex, a.vertices[0]))) <= EPS);
}

/**
 * Closed-source mesh narrow phase. Every triangle is partitioned by all actual
 * pairwise face intersections; every resulting surface cell is checked on both
 * sides using signed winding. This also handles complete containment/coincident
 * parts, unlike triangle intersection alone or a few sampled source vertices.
 * Penetration zones annotate a source interface; they never exempt solid volume.
 */
function deriveNativePairCollision(fixedPart: NativeAssemblyPart, fixedPlacement: NativePlacement, movingPart: NativeAssemblyPart, movingPlacement: NativePlacement, penetrationZone?: ConnectionPenetrationZone): PairCollisionResult {
  let triangleTests = 0, checkedSurfacePatches = 0, spatialPartitionFallbacks = 0;
  const deadline = performance.now() + COLLISION_COMPUTATION_BUDGET_MS;
  const proof: PairCollisionResult['proof'] = { broadPhaseOnly: false, closedSourceProxies: false, openSourceSurfaces: false, openSurfaceSeatChecked: false, completeSurfacePartition: false, containmentChecked: false, sourceEvidence: [], topology: [], penetrationZone: penetrationZone ?? null, penetrationZoneValidated: false, wholePairExempted: false };
  const result = (status: PairCollisionResult['status'], reasonCode: string, reason: string, witness?: Vector3): PairCollisionResult => ({ status, reasonCode, reason, collisionVersion: COLLISION_VERSION, toleranceLdu: EPS, triangleTests, checkedSurfacePatches, spatialPartitionFallbacks, classification: status === 'collision' ? (proof.openSourceSurfaces ? 'OPEN_SURFACE_SEAT_OVERLAP' : 'SOLID_SOLID_OVERLAP') : status === 'clear' ? (proof.openSourceSurfaces ? (proof.broadPhaseOnly ? 'OPEN_SURFACE_SEAT_BROADPHASE' : 'OPEN_SURFACE_SEAT_CLEARANCE') : (proof.broadPhaseOnly ? 'BROAD_PHASE_SEPARATED' : 'NATIVE_SOLID_CLEARANCE')) : /limit|budget/.test(reasonCode) ? 'REQUIRES_HIGHER_RESOLUTION' : 'UNKNOWN_COMPLEX_GEOMETRY', proof, ...(witness ? { witness } : {}) });
  if (!isRigidTransform(fixedPlacement.transform) || !isRigidTransform(movingPlacement.transform)) return result('blocked', 'non-rigid-transform', 'Only finite proper rigid placements are accepted.');
  const zone = penetrationZone ? validateZone(penetrationZone, [fixedPart, movingPart], [fixedPlacement, movingPlacement]) : { source: true, spatial: true };
  if (!zone.source) return result('blocked', 'unverified-penetration-zone', 'The local penetration zone is not backed by a compatible source endpoint from each of the two parts.');
  proof.penetrationZoneValidated = !!penetrationZone && zone.spatial;
  const fixed = buildNativeCollisionProxy(fixedPart, fixedPlacement), moving = buildNativeCollisionProxy(movingPart, movingPlacement);
  if (performance.now() > deadline) return result('blocked', 'collision-computation-budget', 'The native collision computation budget was reached; no clearance certificate is granted.');
  if (!fixed.proxy || !moving.proxy) {
    const failure = !fixed.proxy ? fixed : moving;
    return result('blocked', failure.reasonCode, failure.reason);
  }
  const a = fixed.proxy, b = moving.proxy;
  const openA = a.topology.status === 'open-source-surface', openB = b.topology.status === 'open-source-surface';
  proof.openSourceSurfaces = openA || openB;
  proof.closedSourceProxies = !proof.openSourceSurfaces;
  proof.sourceEvidence = [a.evidence, b.evidence]; proof.topology = [a.topology, b.topology];
  if (openA || openB) {
    if (openA && openB && penetrationZone?.ruleId !== PIN_HOLE_RULE_ID) return result('blocked', 'open-surface-pair-unresolved', 'Two open source shells cannot establish a surface-only clearance without a closed counterpart.');
    if (openA && openB && (!penetrationZone || !zone.spatial)) return result('blocked', 'open-surface-zone-required', 'An open pin/hole pair requires a validated cylindrical pin seat bound to both placed endpoints.');
    if (!penetrationZone || !zone.spatial) return result('blocked', 'open-surface-zone-required', 'An open source shell requires a validated cylindrical seat bound to both placed endpoints; no generic open-surface exemption is granted.');
    const open = openA ? a : b, closed = openA ? b : a;
    if (!boundsOverlap(open.bounds, closed.bounds, EPS)) {
      proof.broadPhaseOnly = true; proof.openSurfaceSeatChecked = true;
      return result('clear', 'open-surface-seat-broadphase', 'The open source shell and its closed counterpart have disjoint bounds.');
    }
    let outsideSeat: Vector3 | null = null, openVertexInsideClosed: Vector3 | null = null;
    const consider = (point: Vector3): boolean => {
      if (pointInSeat(point, penetrationZone)) { checkedSurfacePatches++; return false; }
      outsideSeat = point; return true;
    };
    outer: for (const openFace of open.triangles) {
      for (const closedFace of closed.triangles) {
        if (!boundsOverlap(openFace.bounds, closedFace.bounds, EPS)) continue;
        if (++triangleTests > MAX_TRIANGLE_TESTS || triangleTests % 128 === 0 && performance.now() > deadline) return result('blocked', 'collision-resource-limit', 'The open-surface face-pair budget was exceeded; no clearance certificate is granted.');
        if (coplanarFaces(openFace, closedFace)) {
          for (const vertex of [...openFace.vertices, ...closedFace.vertices]) if (consider(vertex)) break outer;
          continue;
        }
        for (let edge = 0; edge < 3; edge++) {
          const hit = segmentFace(openFace.vertices[edge], openFace.vertices[(edge + 1) % 3], closedFace);
          if (hit && consider(hit)) break outer;
        }
        for (let edge = 0; edge < 3; edge++) {
          const hit = segmentFace(closedFace.vertices[edge], closedFace.vertices[(edge + 1) % 3], openFace);
          if (hit && consider(hit)) break outer;
        }
      }
    }
    if (outsideSeat) return result('collision', 'open-surface-contact-outside-seat', 'An open source shell intersects its closed counterpart outside the source-declared cylindrical seat; the local connection zone grants no exemption.', outsideSeat);
    for (const face of open.triangles) for (const vertex of face.vertices) {
      if (++triangleTests > MAX_TRIANGLE_TESTS) return result('blocked', 'collision-resource-limit', 'The open-surface containment budget was exceeded; no clearance certificate is granted.');
      const seatExceptions = zone.spatial && penetrationZone && penetrationZone.ruleId === PIN_HOLE_RULE_ID && pointInSeat(vertex, penetrationZone);
      if (classifyPoint(closed, vertex) === 'inside' && !seatExceptions) { openVertexInsideClosed = vertex; break; }
    }
    if (openVertexInsideClosed) return result('collision', 'open-surface-vertex-inside-solid', 'An open source shell has a vertex strictly inside the closed counterpart; surface contact inside the seat cannot justify solid penetration.', openVertexInsideClosed);
    proof.openSurfaceSeatChecked = true; proof.completeSurfacePartition = false; proof.containmentChecked = false;
    return result('clear', 'open-surface-seat-clearance', 'All actual open-shell/closed-solid intersections lie inside the source-declared cylindrical seat; no other overlap was found. This is surface clearance, not a closed-solid certificate.');
  }
  proof.closedSourceProxies = true;
  if (a.evidence.meshSha256 === b.evidence.meshSha256
      && fixedPlacement.transform.rotation.every((value, index) => value === movingPlacement.transform.rotation[index])
      && fixedPlacement.transform.translation.every((value, index) => value === movingPlacement.transform.translation[index])) {
    // A closed, positively oriented solid has positive volume. The exact same
    // native mesh under the exact same rigid placement therefore intersects in
    // that whole volume. This is a content/transform proof, never a part-ID rule.
    proof.containmentChecked = true;
    return result('collision', 'identical-positive-volume-solids', 'The two source-closed positive-volume solids have identical mesh content and the exact same rigid placement; their solid volumes coincide.');
  }
  if (!boundsOverlap(a.bounds, b.bounds, EPS)) { proof.broadPhaseOnly = true; proof.completeSurfacePartition = true; proof.containmentChecked = true;
    return !zone.spatial ? result('blocked', 'penetration-zone-transform-mismatch', 'The claimed connection zone is not bound to the two placed source endpoints.') : result('clear', 'disjoint-native-bounds', 'Native solid bounds are disjoint.'); }
  const planesA = new Map<number, Plane[]>(), planesB = new Map<number, Plane[]>();
  let exceeded = false;
  const visit = (nodeA: TriangleBvh, nodeB: TriangleBvh) => {
    if (exceeded || !boundsOverlap(nodeA.bounds, nodeB.bounds, EPS)) return;
    if (nodeA.triangles && nodeB.triangles) {
      for (const ia of nodeA.triangles) for (const ib of nodeB.triangles) {
        const faceA = a.triangles[ia], faceB = b.triangles[ib];
        if (!boundsOverlap(faceA.bounds, faceB.bounds, EPS)) continue;
        if (++triangleTests > MAX_TRIANGLE_TESTS) { exceeded = true; return; }
        if (triangleTests % 128 === 0 && performance.now() > deadline) { exceeded = true; return; }
        const planes = intersectionPlanes(faceA, faceB);
        if (planes) { planesA.set(ia, [...(planesA.get(ia) ?? []), ...planes.a]); planesB.set(ib, [...(planesB.get(ib) ?? []), ...planes.b]); }
      }
    } else if (nodeA.triangles) {
      if (nodeB.left) visit(nodeA, nodeB.left); if (nodeB.right) visit(nodeA, nodeB.right);
    } else if (nodeB.triangles) {
      if (nodeA.left) visit(nodeA.left, nodeB); if (nodeA.right) visit(nodeA.right, nodeB);
    } else {
      if (nodeA.left && nodeB.left) visit(nodeA.left, nodeB.left); if (nodeA.left && nodeB.right) visit(nodeA.left, nodeB.right);
      if (nodeA.right && nodeB.left) visit(nodeA.right, nodeB.left); if (nodeA.right && nodeB.right) visit(nodeA.right, nodeB.right);
    }
  };
  visit(a.bvh, b.bvh);
  if (exceeded) return performance.now() > deadline
    ? result('blocked', 'collision-computation-budget', 'The native collision computation budget was reached; no clearance certificate is granted.')
    : result('blocked', 'collision-resource-limit', 'The complete native face-pair budget was exceeded; collision clearance is unresolved.');
  for (const [own, other, planes] of [[a, b, planesA], [b, a, planesB]] as const) {
    for (let index = 0; index < own.triangles.length; index++) {
      const face = own.triangles[index];
      if (performance.now() > deadline) return result('blocked', 'collision-computation-budget', 'The complete solid-surface computation exceeded its time budget; no clearance certificate is granted.');
      if (!boundsOverlap(face.bounds, other.bounds, EPS)) continue;
      let patches = partitionFace(face, planes.get(index) ?? []);
      if (!patches) {
        spatialPartitionFallbacks++;
        patches = adaptivePartition(face, other, deadline, () => ++triangleTests <= MAX_TRIANGLE_TESTS && performance.now() <= deadline);
      }
      if (!patches) return result('blocked', 'surface-partition-limit', 'A native surface requires more cells than the bounded complete partition can certify.');
      for (const patch of patches) {
        if (++checkedSurfacePatches > MAX_TOTAL_PATCHES) return result('blocked', 'surface-partition-limit', 'The complete surface-partition budget was exceeded.');
        if (checkedSurfacePatches % 16 === 0 && performance.now() > deadline) return result('blocked', 'collision-computation-budget', 'The complete solid-surface computation exceeded its time budget; no clearance certificate is granted.');
        const point = centroid(patch);
        const centerClass = classifyPoint(other, point);
        if (centerClass === 'unknown') return result('blocked', 'solid-winding-unresolved', 'The source occupancy of a complete surface cell is unresolved.');
        if (centerClass === 'inside') {
          // A full cell lies strictly inside the other closed solid. Use a much
          // smaller own-surface probe so a thin but real overlap is not skipped
          // by a fixed normal offset that jumps through the overlap interval.
          for (const sign of [-1, 1]) {
            const near = add(point, scale(face.normal, EPS / 16 * sign));
            const ownClass = classifyPoint(own, near, EPS / 128), otherClass = classifyPoint(other, near, EPS / 128);
            if (ownClass === 'inside' && otherClass === 'inside') return result('collision', 'solid-volume-intersection', 'A closed native surface cell lies strictly inside both source solids; the local connection zone grants no solid exemption.', near);
            if (ownClass === 'unknown' || otherClass === 'unknown') return result('blocked', 'solid-winding-unresolved', 'A thin intersecting native solid interval cannot be reliably resolved.');
          }
        }
        for (const sign of [-1, 1]) {
          const probe = add(point, scale(face.normal, EPS * 4 * sign));
          const otherClass = classifyPoint(other, probe);
          if (otherClass === 'outside' || otherClass === 'boundary') continue;
          if (otherClass === 'unknown') return result('blocked', 'solid-winding-unresolved', 'Independent rays disagree or graze unresolved topology; no collision clearance is granted.');
          const ownClass = classifyPoint(own, probe);
          if (ownClass === 'inside') return result('collision', 'solid-volume-intersection', 'Source-derived closed solids overlap beyond the numerical surface tolerance, including inside any connection zone.', probe);
          if (ownClass === 'unknown') return result('blocked', 'solid-winding-unresolved', 'The native solid occupancy of an intersecting surface cell is unresolved.');
        }
      }
    }
  }
  proof.completeSurfacePartition = true; proof.containmentChecked = true;
  if (!zone.spatial) return result('blocked', 'penetration-zone-transform-mismatch', 'Native geometry is clear, but the claimed connection zone is not bound to the two placed source endpoints and insertion axis.');
  return result('clear', 'native-solid-clearance', 'All native face intersections and resulting surface cells passed closed-solid containment tests. Contact is allowed; solid penetration is not.');
}

const certificateCache = new Map<string, PairCollisionResult>();
const MAX_CERTIFICATES = 512;

/** Reuse a complete certificate only when all geometric/source/placement inputs match. */
export function checkNativePairCollision(fixedPart: NativeAssemblyPart, fixedPlacement: NativePlacement, movingPart: NativeAssemblyPart, movingPlacement: NativePlacement, penetrationZone?: ConnectionPenetrationZone): PairCollisionResult {
  const record = (part: NativeAssemblyPart, placement: NativePlacement) => ({
    partId: part.partId, placedPartId: placement.partId, transform: placement.transform,
    geometryPartId: part.geometry.partId, status: part.geometry.status, source: part.geometry.source,
    mesh: part.geometry.mesh,
    // Connection metadata cannot change beneath a cached zone certificate.
    connections: penetrationZone ? part.connections : undefined,
  });
  const key = createHash('sha256').update(JSON.stringify({ version: COLLISION_VERSION, fixed: record(fixedPart, fixedPlacement), moving: record(movingPart, movingPlacement), penetrationZone })).digest('hex');
  const cached = certificateCache.get(key);
  if (cached) {
    certificateCache.delete(key); certificateCache.set(key, cached);
    const copy = structuredClone(cached); copy.proof.reusedCertificate = true;
    return copy;
  }
  const result = deriveNativePairCollision(fixedPart, fixedPlacement, movingPart, movingPlacement, penetrationZone);
  result.proof.certificateKey = key; result.proof.reusedCertificate = false;
  certificateCache.set(key, structuredClone(result));
  if (certificateCache.size > MAX_CERTIFICATES) certificateCache.delete(certificateCache.keys().next().value!);
  return result;
}

export function validateAssemblyCollision(input: { fixed: { part: NativeAssemblyPart; placement: NativePlacement }; moving: { part: NativeAssemblyPart; placement: NativePlacement }; penetrationZone?: ConnectionPenetrationZone }): PairCollisionResult {
  return checkNativePairCollision(input.fixed.part, input.fixed.placement, input.moving.part, input.moving.placement, input.penetrationZone);
}
