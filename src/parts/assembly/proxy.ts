import { createHash } from 'node:crypto';
import type { NativeAssemblyPart, NativePlacement, Vector3 } from './types.js';
import { add, cross, dot, IDENTITY_TRANSFORM, isRigidTransform, normalize, rotate, scale, subtract, transformPoint } from './math.js';
import { isSourceDeclaredClipEndpoint, isSourceDeclaredPinEndpoint } from '../grammar/sources.js';

export interface MeshBounds { min: Vector3; max: Vector3 }
export interface CollisionTriangle {
  vertices: [Vector3, Vector3, Vector3]; normal: Vector3; bounds: MeshBounds;
  sourceTriangle: number | null;
  /** A cap is accepted only if its entire area is covered by native coplanar faces. */
  internalCap: boolean;
}
export interface TriangleBvh { bounds: MeshBounds; triangles?: number[]; left?: TriangleBvh; right?: TriangleBvh }
export interface CollisionProxy {
  partId: string; instanceId: string; triangles: CollisionTriangle[]; bvh: TriangleBvh; bounds: MeshBounds;
  topology: {
    status: 'closed-oriented-chain' | 'open-source-surface';
    sourceTriangles: number;
    internalCaps: number;
    sourceCoveredCapArea: number;
    signedVolume: number | null;
    /** Null means the source boundary graph was too branched to count. */
    boundarySegments: number | null;
    boundaryLoops: number | null;
  };
  evidence: { libraryRevision: string; meshSha256: string; sourceFiles: { path: string; sha256: string }[] };
}
export interface ProxyBuildResult { status: 'ready' | 'blocked'; reason: string; reasonCode: string; proxy?: CollisionProxy }
export interface Plane { normal: Vector3; offset: number }
const TOPOLOGY_EPS = 1e-5;
const MAX_PROXY_TRIANGLES = 25_000;

export function polygonArea(polygon: Vector3[], normal: Vector3): number {
  let area = 0;
  for (let i = 1; i + 1 < polygon.length; i++) area += dot(cross(subtract(polygon[i], polygon[0]), subtract(polygon[i + 1], polygon[0])), normal) / 2;
  return Math.abs(area);
}
export function splitConvexPolygon(polygon: Vector3[], plane: Plane, epsilon = 1e-8): { positive: Vector3[]; negative: Vector3[] } {
  const positive: Vector3[] = [], negative: Vector3[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const da = dot(a, plane.normal) - plane.offset, db = dot(b, plane.normal) - plane.offset;
    if (da >= -epsilon) positive.push(a);
    if (da <= epsilon) negative.push(a);
    if ((da > epsilon && db < -epsilon) || (da < -epsilon && db > epsilon)) {
      const point = add(a, scale(subtract(b, a), da / (da - db)));
      positive.push(point); negative.push(point);
    }
  }
  return { positive, negative };
}
export function nativeBounds(points: Vector3[]): MeshBounds {
  const bounds: MeshBounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const point of points) for (let axis = 0; axis < 3; axis++) {
    bounds.min[axis] = Math.min(bounds.min[axis], point[axis]); bounds.max[axis] = Math.max(bounds.max[axis], point[axis]);
  }
  return bounds;
}
export function boundsOverlap(a: MeshBounds, b: MeshBounds, tolerance = 0): boolean {
  return a.min.every((value, axis) => value <= b.max[axis] + tolerance && a.max[axis] >= b.min[axis] - tolerance);
}
function triangle(vertices: [Vector3, Vector3, Vector3], sourceTriangle: number | null, internalCap: boolean): CollisionTriangle | null {
  const normal = normalize(cross(subtract(vertices[1], vertices[0]), subtract(vertices[2], vertices[0])));
  return normal ? { vertices, normal, sourceTriangle, internalCap, bounds: nativeBounds(vertices) } : null;
}
function buildBvh(triangles: CollisionTriangle[], ids: number[]): TriangleBvh {
  const bounds = nativeBounds(ids.flatMap(id => [triangles[id].bounds.min, triangles[id].bounds.max]));
  if (ids.length <= 8) return { bounds, triangles: ids };
  const axis = bounds.max.map((value, i) => value - bounds.min[i]).reduce((best, value, i, extents) => value > extents[best] ? i : best, 0);
  ids.sort((a, b) => triangles[a].bounds.min[axis] + triangles[a].bounds.max[axis] - triangles[b].bounds.min[axis] - triangles[b].bounds.max[axis]);
  const middle = Math.floor(ids.length / 2);
  return { bounds, left: buildBvh(triangles, ids.slice(0, middle)), right: buildBvh(triangles, ids.slice(middle)) };
}
function vertexKey(point: Vector3): string { return point.map(value => Math.round(value / TOPOLOGY_EPS)).join(','); }
interface Edge { a: Vector3; b: Vector3 }

/** Split collinear T-junctions before checking the oriented boundary chain. */
function boundaryEdges(triangles: CollisionTriangle[]): Edge[] | null {
  interface Group { direction: Vector3; intervals: { min: number; max: number; sign: number }[]; endpoints: { t: number; p: Vector3 }[] }
  const groups = new Map<string, Group>();
  for (const face of triangles) for (let edge = 0; edge < 3; edge++) {
    const a = face.vertices[edge], b = face.vertices[(edge + 1) % 3];
    let direction = normalize(subtract(b, a));
    if (!direction) continue;
    const nonzero = direction.find(value => Math.abs(value) > 1e-8) ?? 1;
    if (nonzero < 0) direction = scale(direction, -1);
    const moment = cross(a, direction);
    const key = [...direction.map(value => Math.round(value * 1e7)), ...moment.map(value => Math.round(value / TOPOLOGY_EPS))].join(',');
    let group = groups.get(key);
    if (!group) { group = { direction, intervals: [], endpoints: [] }; groups.set(key, group); }
    const ta = dot(a, group.direction), tb = dot(b, group.direction);
    group.intervals.push({ min: Math.min(ta, tb), max: Math.max(ta, tb), sign: ta < tb ? 1 : -1 });
    group.endpoints.push({ t: ta, p: a }, { t: tb, p: b });
  }
  const edges: Edge[] = [];
  for (const group of groups.values()) {
    const endpoints = group.endpoints.sort((a, b) => a.t - b.t).filter((point, i, list) => i === 0 || point.t - list[i - 1].t > TOPOLOGY_EPS);
    for (let i = 0; i + 1 < endpoints.length; i++) {
      const start = endpoints[i], end = endpoints[i + 1], middle = (start.t + end.t) / 2;
      const balance = group.intervals.filter(interval => middle > interval.min - TOPOLOGY_EPS && middle < interval.max + TOPOLOGY_EPS).reduce((sum, interval) => sum + interval.sign, 0);
      if (Math.abs(balance) > 1) return null;
      if (balance !== 0) edges.push(balance > 0 ? { a: start.p, b: end.p } : { a: end.p, b: start.p });
    }
  }
  return edges;
}
function boundaryLoops(edges: Edge[]): Vector3[][] | null {
  const outgoing = new Map<string, Edge>(), incoming = new Map<string, number>();
  for (const edge of edges) {
    const a = vertexKey(edge.a), b = vertexKey(edge.b);
    if (outgoing.has(a)) return null;
    outgoing.set(a, edge); incoming.set(b, (incoming.get(b) ?? 0) + 1);
  }
  if ([...outgoing.keys()].some(key => incoming.get(key) !== 1)) return null;
  const loops: Vector3[][] = [];
  while (outgoing.size > 0) {
    const start = outgoing.keys().next().value!; let current = start;
    const loop: Vector3[] = [];
    do {
      const edge = outgoing.get(current);
      if (!edge || loop.length > edges.length) return null;
      outgoing.delete(current); loop.push(edge.a); current = vertexKey(edge.b);
    } while (current !== start);
    if (loop.length < 3) return null;
    loops.push(loop);
  }
  return loops;
}

function capIsSourceCovered(cap: CollisionTriangle, source: CollisionTriangle[]): boolean {
  // Subtract the union of coplanar native triangles from the proposed cap. Merely
  // checking a cap's vertices/centroid would miss holes and is not a coverage proof.
  let residual: Vector3[][] = [cap.vertices];
  const offset = dot(cap.normal, cap.vertices[0]);
  for (const face of source) {
    if (!boundsOverlap(face.bounds, cap.bounds, TOPOLOGY_EPS) || Math.abs(Math.abs(dot(face.normal, cap.normal)) - 1) > 1e-6
        || face.vertices.some(point => Math.abs(dot(cap.normal, point) - offset) > TOPOLOGY_EPS)) continue;
    const next: Vector3[][] = [];
    for (const polygon of residual) {
      let inside = polygon;
      for (let edge = 0; edge < 3 && inside.length >= 3; edge++) {
        const a = face.vertices[edge], b = face.vertices[(edge + 1) % 3];
        const normal = cross(face.normal, subtract(b, a));
        const split = splitConvexPolygon(inside, { normal, offset: dot(normal, a) });
        if (split.negative.length >= 3 && polygonArea(split.negative, cap.normal) > 1e-9) next.push(split.negative);
        inside = split.positive;
      }
    }
    residual = next;
    if (residual.length === 0) return true;
    if (residual.length > 512) return false;
  }
  return residual.reduce((sum, polygon) => sum + polygonArea(polygon, cap.normal), 0) <= 1e-7;
}

/**
 * A native rendering mesh often leaves a stud's base open above a complete body
 * face. Only those source-covered INTERNAL seams may be capped for volume tests.
 * Any unsupported external hole, branched boundary or open shell is blocked.
 */
function deriveNativeCollisionProxy(part: NativeAssemblyPart, placement: NativePlacement): ProxyBuildResult {
  const blocked = (reasonCode: string, reason: string): ProxyBuildResult => ({ status: 'blocked', reasonCode, reason });
  const geometry = part.geometry, mesh = geometry.mesh;
  if (part.partId !== placement.partId || geometry.partId !== part.partId) return blocked('identity-mismatch', 'Placement, native part and geometry identity differ.');
  if (!isRigidTransform(placement.transform)) return blocked('non-rigid-transform', 'Only proper rigid rotations and translations are accepted; reflections/scaling cannot alter native parts.');
  if (geometry.status !== 'geometryReady' || !mesh || geometry.source.integrity !== 'verified' || geometry.source.licenseStatus !== 'complete'
      || geometry.source.files.length === 0 || geometry.source.files.some(file => !/^[a-f0-9]{64}$/.test(file.sha256))) return blocked('unverified-geometry-source', 'Native mesh and its complete pinned source closure must pass integrity and license checks.');
  if (mesh.coordinateSystem !== 'ldraw-native' || mesh.units !== 'LDU' || mesh.indices.length % 3 !== 0
      || mesh.positions.some(point => point.length !== 3 || !point.every(Number.isFinite))
      || mesh.indices.some(index => !Number.isSafeInteger(index) || index < 0 || index >= mesh.positions.length)) return blocked('invalid-native-mesh', 'The source mesh has invalid coordinates or indices.');
  if (mesh.doubleSided.some(Boolean)) return blocked('uncertified-surface', 'Uncertified/double-sided native faces cannot establish a reliable solid winding.');
  if (mesh.indices.length / 3 > MAX_PROXY_TRIANGLES) return blocked('proxy-resource-limit', 'The native mesh exceeds the bounded collision-proxy budget.');
  const vertices = mesh.positions.map(point => transformPoint(placement.transform, point));
  const triangles: CollisionTriangle[] = [];
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const face = triangle([vertices[mesh.indices[i]], vertices[mesh.indices[i + 1]], vertices[mesh.indices[i + 2]]], i / 3, false);
    if (face) triangles.push(face);
  }
  if (triangles.length === 0) return blocked('empty-solid-mesh', 'No solid native triangles are available.');
  const sourceTriangleCount = triangles.length;
  const openSurface = part.connections.points.some(point => isSourceDeclaredClipEndpoint(point) || isSourceDeclaredPinEndpoint(point));
  const boundaries = boundaryEdges(triangles);
  const loops = boundaries ? boundaryLoops(boundaries) : null;
  if (openSurface) {
    // A C-clip is an open plastic shell by construction. Its source triangles
    // are retained exactly; no cap, solid volume or winding is invented. The
    // narrow phase below may only classify this as a surface seat interaction.
    const bvh = buildBvh(triangles, triangles.map((_, index) => index));
    const meshSha256 = createHash('sha256').update(JSON.stringify({ positions: mesh.positions, indices: mesh.indices, doubleSided: mesh.doubleSided })).digest('hex');
    return { status: 'ready', reasonCode: 'source-open-surface-clip', reason: 'Source-declared CLIP shell retained as an open surface; collision is resolved by the sourced cylindrical seat, not by inventing a solid cap.', proxy: {
      partId: part.partId, instanceId: placement.instanceId, triangles, bvh, bounds: bvh.bounds,
      topology: { status: 'open-source-surface', sourceTriangles: sourceTriangleCount, internalCaps: 0, sourceCoveredCapArea: 0, signedVolume: null, boundarySegments: boundaries?.length ?? null, boundaryLoops: loops?.length ?? null },
      evidence: { libraryRevision: geometry.source.revision, meshSha256, sourceFiles: geometry.source.files.map(file => ({ path: file.path, sha256: file.sha256 })) },
    } };
  }
  if (boundaries === null) return blocked('non-manifold-boundary', 'Native oriented boundary multiplicity is unresolved.');
  if (!loops) return blocked('branched-native-boundary', 'The source mesh has open/branched boundary chains.');
  let capArea = 0;
  for (const loop of loops) {
    let normal: Vector3 | null = null;
    for (let i = 1; i + 1 < loop.length && !normal; i++) normal = normalize(cross(subtract(loop[i], loop[0]), subtract(loop[i + 1], loop[0])));
    if (!normal || loop.some(point => Math.abs(dot(normal!, subtract(point, loop[0]))) > TOPOLOGY_EPS)) return blocked('open-nonplanar-shell', 'An open native boundary has no source-proven planar internal cap.');
    // Only convex boundary loops are supported; no inferred nonconvex filling.
    if (loop.some((point, i) => dot(cross(subtract(loop[(i + 1) % loop.length], point), subtract(loop[(i + 2) % loop.length], loop[(i + 1) % loop.length])), normal!) < -TOPOLOGY_EPS)) return blocked('unresolved-boundary-cap', 'A nonconvex native boundary needs a more capable source-backed proxy.');
    for (let i = 1; i + 1 < loop.length; i++) {
      const cap = triangle([loop[0], loop[i + 1], loop[i]], null, true);
      if (!cap) continue;
      if (!capIsSourceCovered(cap, triangles.slice(0, sourceTriangleCount))) return blocked('open-external-shell', 'An open native boundary is not fully covered by original coplanar source faces. No missing plastic is invented.');
      triangles.push(cap); capArea += polygonArea(cap.vertices, cap.normal);
    }
  }
  const remaining = boundaryEdges(triangles);
  if (remaining === null || remaining.length > 0) return blocked('proxy-closure-unresolved', 'The derived proxy has an unresolved oriented boundary after source-covered internal caps.');
  const signedVolume = triangles.reduce((sum, face) => sum + dot(face.vertices[0], cross(face.vertices[1], face.vertices[2])) / 6, 0);
  if (!(signedVolume > 1e-6)) return blocked('solid-orientation-unresolved', 'The closed source-derived proxy has no positive oriented solid volume.');
  const bvh = buildBvh(triangles, triangles.map((_, index) => index));
  const meshSha256 = createHash('sha256').update(JSON.stringify({ positions: mesh.positions, indices: mesh.indices, doubleSided: mesh.doubleSided })).digest('hex');
  return { status: 'ready', reasonCode: 'source-closed-proxy', reason: 'Native closed oriented mesh with only fully source-covered internal caps.', proxy: {
    partId: part.partId, instanceId: placement.instanceId, triangles, bvh, bounds: bvh.bounds,
    topology: { status: 'closed-oriented-chain', sourceTriangles: sourceTriangleCount, internalCaps: triangles.length - sourceTriangleCount, sourceCoveredCapArea: capArea, signedVolume, boundarySegments: 0, boundaryLoops: 0 },
    evidence: { libraryRevision: geometry.source.revision, meshSha256, sourceFiles: geometry.source.files.map(file => ({ path: file.path, sha256: file.sha256 })) },
  } };
}

const nativeProxyCache = new WeakMap<NativeAssemblyPart['geometry'], { fingerprint: string; result: ProxyBuildResult }>();

/** Closure is established in native coordinates once; a rigid placement preserves it. */
export function buildNativeCollisionProxy(part: NativeAssemblyPart, placement: NativePlacement): ProxyBuildResult {
  if (part.partId !== placement.partId || part.geometry.partId !== part.partId || !isRigidTransform(placement.transform)) return deriveNativeCollisionProxy(part, placement);
  const mesh = part.geometry.mesh;
  // Hash the current inputs even on a cache hit: callers cannot alter source
  // vertices/metadata and continue using an earlier clearance certificate.
  const fingerprint = createHash('sha256').update(JSON.stringify({ partId: part.partId, status: part.geometry.status, source: part.geometry.source,
    units: mesh?.units, coordinates: mesh?.coordinateSystem, positions: mesh?.positions, indices: mesh?.indices, doubleSided: mesh?.doubleSided })).digest('hex');
  let cached = nativeProxyCache.get(part.geometry);
  if (!cached || cached.fingerprint !== fingerprint) {
    cached = { fingerprint, result: deriveNativeCollisionProxy(part, { instanceId: 'native-proxy', partId: part.partId, transform: IDENTITY_TRANSFORM }) };
    nativeProxyCache.set(part.geometry, cached);
  }
  const base = cached.result;
  if (!base.proxy) return base;
  const source = base.proxy;
  const triangles = source.triangles.map(face => {
    const vertices = face.vertices.map(vertex => transformPoint(placement.transform, vertex)) as [Vector3, Vector3, Vector3];
    return { ...face, vertices, normal: rotate(placement.transform.rotation, face.normal), bounds: nativeBounds(vertices) };
  });
  const bvh = buildBvh(triangles, triangles.map((_, i) => i));
  return { ...base, proxy: { ...source, instanceId: placement.instanceId, triangles, bvh, bounds: bvh.bounds } };
}
