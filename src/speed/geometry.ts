import type { PartDimensions } from '../types/index.js';
import { getSpeedPartDefinition } from './catalog.js';
import type { SpeedBox, SpeedCylinder, SpeedOrientation, SpeedPlacedPart, SpeedVector } from './types.js';

/** All internal geometry calculations use isotropic LDraw units (0.4 mm). */
export const SPEED_EPSILON = 0.0001;
export const toLdu = (v: SpeedVector): SpeedVector => ({ x: v.x * 20, y: v.y * 20, z: v.z * 8 });
export const fromLdu = (v: SpeedVector): SpeedVector => ({ x: v.x / 20, y: v.y / 20, z: v.z / 8 });
export const add = (a: SpeedVector, b: SpeedVector): SpeedVector => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const distance = (a: SpeedVector, b: SpeedVector): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** Euler X → Y → Z, about the canonical part origin, in physical space. */
export function rotatePhysical(v: SpeedVector, orientation: SpeedOrientation): SpeedVector {
  if (!['x', 'y', 'z'].every(axis => [0, 90, 180, 270].includes(orientation[axis as keyof SpeedOrientation]))) throw new RangeError('Speed orientation must use finite quarter turns.');
  let { x, y, z } = v;
  for (let step = 0; step < orientation.x / 90; step++) [y, z] = [-z, y];
  for (let step = 0; step < orientation.y / 90; step++) [x, z] = [z, -x];
  for (let step = 0; step < orientation.z / 90; step++) [x, y] = [-y, x];
  return { x, y, z };
}

export function transformPointLdu(part: Pick<SpeedPlacedPart, 'position' | 'orientation'>, local: SpeedVector): SpeedVector {
  return add(toLdu(part.position), rotatePhysical(toLdu(local), part.orientation));
}
export function transformPoint(part: Pick<SpeedPlacedPart, 'position' | 'orientation'>, local: SpeedVector): SpeedVector {
  return fromLdu(transformPointLdu(part, local));
}
export const transformDirection = (part: Pick<SpeedPlacedPart, 'orientation'>, direction: SpeedVector): SpeedVector => rotatePhysical(direction, part.orientation);

export interface WorldCylinder { kind: 'cylinder'; axis: 'x' | 'y' | 'z'; center: SpeedVector; radius: number; innerRadius: number; halfWidth: number }
export interface WorldBox { kind: 'box'; min: SpeedVector; max: SpeedVector }
export type WorldPrimitive = WorldCylinder | WorldBox;

function transformedCylinder(part: SpeedPlacedPart, shape: SpeedCylinder): WorldCylinder {
  const direction = transformDirection(part, { x: Number(shape.axis === 'x'), y: Number(shape.axis === 'y'), z: Number(shape.axis === 'z') });
  const axis = Math.abs(direction.x) > 0.5 ? 'x' : Math.abs(direction.y) > 0.5 ? 'y' : 'z';
  return { kind: 'cylinder', axis, center: transformPointLdu(part, shape.center), radius: shape.radius * 20, innerRadius: (shape.innerRadius ?? 0) * 20, halfWidth: shape.width * 10 };
}

function transformedBox(part: SpeedPlacedPart, box: SpeedBox): WorldBox {
  const vertices: SpeedVector[] = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) vertices.push(transformPointLdu(part, { x, y, z }));
  return { kind: 'box', min: { x: Math.min(...vertices.map(v => v.x)), y: Math.min(...vertices.map(v => v.y)), z: Math.min(...vertices.map(v => v.z)) }, max: { x: Math.max(...vertices.map(v => v.x)), y: Math.max(...vertices.map(v => v.y)), z: Math.max(...vertices.map(v => v.z)) } };
}

export function worldPrimitives(part: SpeedPlacedPart): WorldPrimitive[] {
  const definition = getSpeedPartDefinition(part.partId);
  if (!definition?.shape) return [];
  const shape = definition.shape;
  const primitives: WorldPrimitive[] = (shape.boxes ?? []).map(box => transformedBox(part, box));
  if (shape.radius !== undefined && shape.width !== undefined && shape.axis) {
    primitives.push(transformedCylinder(part, { axis: shape.axis, center: shape.center ?? { x: 0, y: 0, z: 0 }, radius: shape.radius, innerRadius: shape.innerRadius, width: shape.width }));
  }
  primitives.push(...(shape.cylinders ?? []).map(cylinder => transformedCylinder(part, cylinder)));
  return primitives;
}

export const worldHoles = (part: SpeedPlacedPart): WorldCylinder[] => (getSpeedPartDefinition(part.partId)?.shape?.holes ?? []).map(hole => transformedCylinder(part, hole));

export function primitiveBounds(shape: WorldPrimitive): WorldBox {
  if (shape.kind === 'box') return shape;
  const extent = { x: shape.radius, y: shape.radius, z: shape.radius };
  extent[shape.axis] = shape.halfWidth;
  return { kind: 'box', min: { x: shape.center.x - extent.x, y: shape.center.y - extent.y, z: shape.center.z - extent.z }, max: add(shape.center, extent) };
}

export function partBoundsLdu(part: SpeedPlacedPart): WorldBox {
  const boxes = worldPrimitives(part).map(primitiveBounds);
  if (!boxes.length) return transformedBox(part, { min: { x: 0, y: 0, z: 0 }, max: part.dimensions });
  return { kind: 'box', min: { x: Math.min(...boxes.map(b => b.min.x)), y: Math.min(...boxes.map(b => b.min.y)), z: Math.min(...boxes.map(b => b.min.z)) }, max: { x: Math.max(...boxes.map(b => b.max.x)), y: Math.max(...boxes.map(b => b.max.y)), z: Math.max(...boxes.map(b => b.max.z)) } };
}

export function vehicleDimensions(parts: SpeedPlacedPart[]): PartDimensions {
  if (!parts.length) return { x: 0, y: 0, z: 0 };
  const boxes = parts.map(partBoundsLdu);
  return fromLdu({ x: Math.max(...boxes.map(b => b.max.x)) - Math.min(...boxes.map(b => b.min.x)), y: Math.max(...boxes.map(b => b.max.y)) - Math.min(...boxes.map(b => b.min.y)), z: Math.max(...boxes.map(b => b.max.z)) - Math.min(...boxes.map(b => b.min.z)) });
}

export function boxesIntersect(a: WorldBox, b: WorldBox): boolean {
  return (['x', 'y', 'z'] as const).every(axis => Math.min(a.max[axis], b.max[axis]) - Math.max(a.min[axis], b.min[axis]) > SPEED_EPSILON);
}

function cylinderBoxIntersect(cylinder: WorldCylinder, box: WorldBox): boolean {
  if (Math.min(cylinder.center[cylinder.axis] + cylinder.halfWidth, box.max[cylinder.axis]) - Math.max(cylinder.center[cylinder.axis] - cylinder.halfWidth, box.min[cylinder.axis]) <= SPEED_EPSILON) return false;
  const perpendicular = (['x', 'y', 'z'] as const).filter(axis => axis !== cylinder.axis);
  let nearestSquared = 0, farthestSquared = 0;
  for (const axis of perpendicular) {
    const near = Math.max(box.min[axis] - cylinder.center[axis], 0, cylinder.center[axis] - box.max[axis]);
    const far = Math.max(Math.abs(box.min[axis] - cylinder.center[axis]), Math.abs(box.max[axis] - cylinder.center[axis]));
    nearestSquared += near * near; farthestSquared += far * far;
  }
  return Math.sqrt(nearestSquared) < cylinder.radius - SPEED_EPSILON && Math.sqrt(farthestSquared) > cylinder.innerRadius + SPEED_EPSILON;
}

export function primitivesIntersect(a: WorldPrimitive, b: WorldPrimitive): boolean {
  if (!boxesIntersect(primitiveBounds(a), primitiveBounds(b))) return false;
  if (a.kind === 'box') return b.kind === 'box' ? true : cylinderBoxIntersect(b, a);
  if (b.kind === 'box') return cylinderBoxIntersect(a, b);
  if (a.axis !== b.axis) return true; // Conservative for currently ungenerated crossing-cylinder parts.
  const perpendicular = (['x', 'y', 'z'] as const).filter(axis => axis !== a.axis);
  const separation = Math.hypot(...perpendicular.map(axis => a.center[axis] - b.center[axis]));
  if (separation < SPEED_EPSILON) return Math.min(a.radius, b.radius) - Math.max(a.innerRadius, b.innerRadius) > SPEED_EPSILON;
  return separation < a.radius + b.radius - SPEED_EPSILON && separation + a.radius > b.innerRadius + SPEED_EPSILON && separation + b.radius > a.innerRadius + SPEED_EPSILON;
}
