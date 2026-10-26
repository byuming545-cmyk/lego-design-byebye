import type { Matrix3, RigidTransform, Vector3 } from './types.js';
import type { ImportedConnectionPoint } from '../connections/types.js';

export const IDENTITY_ROTATION: Matrix3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
export const IDENTITY_TRANSFORM: RigidTransform = { rotation: [...IDENTITY_ROTATION], translation: [0, 0, 0] };

export function add(a: Vector3, b: Vector3): Vector3 { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
export function subtract(a: Vector3, b: Vector3): Vector3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
export function scale(v: Vector3, value: number): Vector3 { return [v[0] * value, v[1] * value, v[2] * value]; }
export function dot(a: Vector3, b: Vector3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
export function cross(a: Vector3, b: Vector3): Vector3 { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
export function length(v: Vector3): number { return Math.hypot(...v); }
export function normalize(v: Vector3): Vector3 | null { const magnitude = length(v); return Number.isFinite(magnitude) && magnitude > 1e-10 ? scale(v, 1 / magnitude) : null; }
export function distance(a: Vector3, b: Vector3): number { return length(subtract(a, b)); }
export function finiteVector(v: unknown): v is Vector3 { return Array.isArray(v) && v.length === 3 && v.every((value) => typeof value === 'number' && Number.isFinite(value)); }

/** Matrices are row-major, matching native LDraw type-1 matrix token order. */
export function rotate(rotation: Matrix3, vector: Vector3): Vector3 {
  return [dot(rotation.slice(0, 3) as Vector3, vector), dot(rotation.slice(3, 6) as Vector3, vector), dot(rotation.slice(6, 9) as Vector3, vector)];
}
export function transformPoint(transform: RigidTransform, vector: Vector3): Vector3 { return add(rotate(transform.rotation, vector), transform.translation); }
/** Argument-order aliases for callers that start from a point/direction. */
export function applyTransform(point: Vector3, transform: RigidTransform): Vector3 { return transformPoint(transform, point); }
export function transformDirection(direction: Vector3, transform: RigidTransform): Vector3 { return rotate(transform.rotation, direction); }
export function transpose(matrix: Matrix3): Matrix3 { return [matrix[0], matrix[3], matrix[6], matrix[1], matrix[4], matrix[7], matrix[2], matrix[5], matrix[8]]; }
export function multiply(a: Matrix3, b: Matrix3): Matrix3 {
  const columns = transpose(b), result: number[] = [];
  for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) result.push(dot(a.slice(row * 3, row * 3 + 3) as Vector3, columns.slice(col * 3, col * 3 + 3) as Vector3));
  return result as Matrix3;
}
export function determinant(matrix: Matrix3): number { return matrix[0] * (matrix[4] * matrix[8] - matrix[5] * matrix[7]) - matrix[1] * (matrix[3] * matrix[8] - matrix[5] * matrix[6]) + matrix[2] * (matrix[3] * matrix[7] - matrix[4] * matrix[6]); }
export function isRotation(matrix: unknown, tolerance = 1e-6): matrix is Matrix3 {
  if (!Array.isArray(matrix) || matrix.length !== 9 || !matrix.every((n) => typeof n === 'number' && Number.isFinite(n))) return false;
  const typed = matrix as Matrix3;
  if (Math.abs(determinant(typed) - 1) > tolerance) return false;
  const product = multiply(typed, transpose(typed));
  return product.every((n, index) => Math.abs(n - IDENTITY_ROTATION[index]) < tolerance);
}
export function isRigidTransform(transform: unknown): transform is RigidTransform {
  return !!transform && typeof transform === 'object' && 'rotation' in transform && 'translation' in transform && isRotation(transform.rotation) && finiteVector(transform.translation);
}
export function composeTransforms(parent: RigidTransform, child: RigidTransform): RigidTransform {
  return { rotation: multiply(parent.rotation, child.rotation), translation: transformPoint(parent, child.translation) };
}
export function inverseTransform(transform: RigidTransform): RigidTransform { const rotation = transpose(transform.rotation); return { rotation, translation: scale(rotate(rotation, transform.translation), -1) }; }
export const multiplyMatrices = multiply;
export const invertRigidTransform = inverseTransform;

export function axisRotation(axis: Vector3, degrees: number): Matrix3 {
  const unit = normalize(axis);
  if (!unit || !Number.isFinite(degrees)) throw new Error('Invalid rotation axis or angle.');
  const [x, y, z] = unit, radians = degrees * Math.PI / 180;
  const quarter = degrees / 90;
  const index = ((quarter % 4) + 4) % 4;
  // Exact symbolic quarter turns, never rounding a near-quarter input angle.
  const cosine = Number.isInteger(quarter) ? [1, 0, -1, 0][index] : Math.cos(radians);
  const sine = Number.isInteger(quarter) ? [0, 1, 0, -1][index] : Math.sin(radians), t = 1 - cosine;
  return [cosine + x * x * t, x * y * t - z * sine, x * z * t + y * sine, y * x * t + z * sine, cosine + y * y * t, y * z * t - x * sine, z * x * t - y * sine, z * y * t + x * sine, cosine + z * z * t];
}

/**
 * Proper frame from the imported source's tangent and actual snap direction.
 * A mirrored LDraw subfile may have determinant -1; placement rotations never do.
 * Circular studs and square underside cavities have the permitted quarter-turn
 * symmetry, so constructing the right-handed equivalent does not deform a part.
 */
export function connectionFrame(point: ImportedConnectionPoint): Matrix3 | null {
  if (!point.dimensionsResolved || !finiteVector(point.direction) || !finiteVector(point.position)) return null;
  const direction = normalize(point.direction);
  if (!direction || !Array.isArray(point.orientation) || point.orientation.length !== 9 || !point.orientation.every(Number.isFinite)) return null;
  const tangent: Vector3 = [point.orientation[0], point.orientation[3], point.orientation[6]];
  const x = normalize(subtract(tangent, scale(direction, dot(tangent, direction))));
  if (!x) return null;
  const y = scale(direction, -1), z = normalize(cross(x, y));
  if (!z) return null;
  const result: Matrix3 = [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];
  return isRotation(result) ? result : null;
}

export function normalizedTwist(degrees: number): number | null {
  if (!Number.isFinite(degrees)) return null;
  const result = ((degrees % 360) + 360) % 360;
  return Math.abs(result - Math.round(result)) < 1e-8 ? Math.round(result) % 360 : result;
}
