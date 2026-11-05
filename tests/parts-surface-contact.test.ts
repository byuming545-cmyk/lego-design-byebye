import { describe, expect, it } from 'vitest';
import { intersectCoplanarSourceTriangles } from '../src/parts/assembly/surfaceContact.js';
import { assessSourceSurfaceCell, COLLISION_TOLERANCE_LDU } from '../src/parts/assembly/collision.js';
import { boundsOverlap, nativeBounds } from '../src/parts/assembly/proxy.js';
import { axisRotation, cross, distance, normalize, subtract, transformPoint } from '../src/parts/assembly/math.js';
import type { Vector3 } from '../src/parts/assembly/types.js';

// Mathematical triangles only: these fixtures declare no LEGO identities,
// connectors, dimensions or production eligibility.
const triangle = (...vertices: [Vector3, Vector3, Vector3]) => ({ vertices, normal: normalize(cross(subtract(vertices[1], vertices[0]), subtract(vertices[2], vertices[0]))) ?? [0, 0, 0] as Vector3 });
const contact = (a: ReturnType<typeof triangle>, b: ReturnType<typeof triangle>) => intersectCoplanarSourceTriangles(a, b, COLLISION_TOLERANCE_LDU);

describe('actual coplanar contact regions', () => {
  it('separates disjoint coplanar triangles even when their AABBs overlap', () => {
    const a = triangle([0, 0, 0], [2, 0, 0], [0, 2, 0]), b = triangle([2, 2, 0], [0.8, 2, 0], [2, 0.8, 0]);
    expect(boundsOverlap(nativeBounds(a.vertices), nativeBounds(b.vertices))).toBe(true);
    expect(contact(a, b)).toMatchObject({ status: 'disjoint', points: [] });
  });
  it('tests only the shared polygon rather than unrelated vertices outside the seat', () => {
    const a = triangle([-2, -2, 0], [2, -2, 0], [-2, 2, 0]), b = triangle([-1, -1, 0], [3, -1, 0], [-1, 3, 0]);
    const inSeat = (point: Vector3) => Math.hypot(point[0], point[1]) <= 1.5;
    expect([...a.vertices, ...b.vertices].some(point => !inSeat(point))).toBe(true);
    const result = contact(a, b);
    expect(result.status).toBe('contact'); expect(result.dimension).toBe(2);
    expect(result.points.every(inSeat)).toBe(true);
    expect(result.points).toEqual(expect.arrayContaining([[-1, -1, 0], [1, -1, 0], [-1, 1, 0]]));
  });
  it('retains an actual out-of-seat contact rather than exempting the whole pair', () => {
    const a = triangle([-2, -2, 0], [2, -2, 0], [-2, 2, 0]), b = triangle([-1, -1, 0], [3, -1, 0], [-1, 3, 0]);
    expect(contact(a, b).points.some(point => Math.hypot(point[0], point[1]) > 1)).toBe(true);
  });
  it('retains point and edge contact with no positive-area overlap', () => {
    const a = triangle([0, 0, 0], [2, 0, 0], [0, 2, 0]);
    expect(contact(a, triangle([2, 0, 0], [3, 0, 0], [2, 1, 0]))).toMatchObject({ status: 'contact', dimension: 0 });
    expect(contact(a, triangle([0, 0, 0], [0, -2, 0], [2, 0, 0]))).toMatchObject({ status: 'contact', dimension: 1 });
  });
  it('keeps the contact region under reversed winding and a common rigid transform', () => {
    const a = triangle([-2, -2, 0], [2, -2, 0], [-2, 2, 0]), b = triangle([-1, -1, 0], [3, -1, 0], [-1, 3, 0]);
    expect(contact(a, triangle(b.vertices[2], b.vertices[1], b.vertices[0])).points).toHaveLength(3);
    const world = { rotation: axisRotation([0.3, 0.7, 0.2], 33), translation: [53, -17, 21] as Vector3 };
    const transform = (t: ReturnType<typeof triangle>) => triangle(...t.vertices.map(point => transformPoint(world, point)) as [Vector3, Vector3, Vector3]);
    const result = contact(transform(a), transform(b)); expect(result.status).toBe('contact');
    const expected = contact(a, b).points.map(point => transformPoint(world, point));
    for (const point of result.points) expect(expected.some(reference => distance(point, reference) < 1e-7)).toBe(true);
    for (const point of expected) expect(result.points.some(reference => distance(point, reference) < 1e-7)).toBe(true);
  });
  it('does not discard a close vertex just because another vertex is within numerical tolerance', () => {
    const a = triangle([0, 0, 0], [1, 0, 0], [0, 1, 0]), b = triangle([0, 0, 0], [0.00005, 0, 0], [0, 0.00005, 0]);
    const result = contact(a, b);
    expect(result.status).toBe('contact'); expect(result.points.some(point => point[0] > 0.00004)).toBe(true);
  });
  it('returns unresolved for degenerate and noncoplanar inputs', () => {
    const a = triangle([0, 0, 0], [1, 0, 0], [0, 1, 0]);
    expect(contact(a, triangle([0, 0, 0], [0, 0, 0], [0, 0, 0])).status).toBe('unknown');
    expect(contact(a, triangle([0, 0, 1], [1, 0, 1], [0, 1, 1])).status).toBe('unknown');
  });
});

describe('open-source vertex decisions', () => {
  it.each([true, false])('blocks UNKNOWN even when the seat exception is %s', exception => {
    expect(assessSourceSurfaceCell([[0, 0, 0]], () => 'unknown', () => exception).status).toBe('blocked');
  });
  it('preserves the distinction between an allowed seat and out-of-seat solid intrusion', () => {
    expect(assessSourceSurfaceCell([[0, 0, 0]], () => 'inside', () => false).status).toBe('collision');
    expect(assessSourceSurfaceCell([[0, 0, 0]], () => 'inside', () => true).status).toBe('clear');
    expect(assessSourceSurfaceCell([[0, 0, 0]], () => 'outside', () => false).status).toBe('clear');
  });
});
