import type { ReferenceMatrix, ReferenceVector } from './types.js';
import { getSpeedPartDefinition } from '../../speed/catalog.js';
import type { SpeedPartDefinition } from '../../speed/types.js';

export const IDENTITY_MATRIX: ReferenceMatrix = [1, 0, 0, 0, 1, 0, 0, 0, 1];
/** Axis conversion is kept separate from the anisotropic stud/plate display scale. */
export const LDRAW_TO_INTERNAL: ReferenceMatrix = [1, 0, 0, 0, 0, 1, 0, -1, 0];
const INTERNAL_TO_LDRAW: ReferenceMatrix = [1, 0, 0, 0, 0, -1, 0, 1, 0];
export function multiplyMatrices(a: ReferenceMatrix, b: ReferenceMatrix): ReferenceMatrix {
  const result = Array<number>(9).fill(0);
  for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) for (let k = 0; k < 3; k++) result[row * 3 + col] += a[row * 3 + k] * b[k * 3 + col];
  return result as ReferenceMatrix;
}
export function transformVector(matrix: ReferenceMatrix, v: ReferenceVector): ReferenceVector {
  return { x: matrix[0] * v.x + matrix[1] * v.y + matrix[2] * v.z, y: matrix[3] * v.x + matrix[4] * v.y + matrix[5] * v.z, z: matrix[6] * v.x + matrix[7] * v.y + matrix[8] * v.z };
}
export const addVectors = (a: ReferenceVector, b: ReferenceVector): ReferenceVector => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const ldrawToInternalLdu = (v: ReferenceVector): ReferenceVector => transformVector(LDRAW_TO_INTERNAL, v);
export const internalLduToDisplay = (v: ReferenceVector): ReferenceVector => ({ x: v.x / 20, y: v.y / 20, z: v.z / 8 });
export const ldrawToInternal = (v: ReferenceVector): ReferenceVector => internalLduToDisplay(ldrawToInternalLdu(v));
export const internalToLdraw = (v: ReferenceVector): ReferenceVector => transformVector(INTERNAL_TO_LDRAW, { x: v.x * 20, y: v.y * 20, z: v.z * 8 });
export const ldrawMatrixToInternal = (m: ReferenceMatrix): ReferenceMatrix => multiplyMatrices(multiplyMatrices(LDRAW_TO_INTERNAL, m), INTERNAL_TO_LDRAW);
export function determinant(m: ReferenceMatrix): number { return m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]); }
/** Includes quarter-turn reflections. Scaling and arbitrary angles are not connector evidence. */
export function isOrthogonalAxisMatrix(m: ReferenceMatrix): boolean {
  return m.every(n => Math.abs(n) < 1e-5 || Math.abs(Math.abs(n) - 1) < 1e-5) && [0, 1, 2].every(row => Math.abs(m.slice(row * 3, row * 3 + 3).reduce((sum, n) => sum + n * n, 0) - 1) < 1e-5) && Math.abs(Math.abs(determinant(m)) - 1) < 1e-5;
}

export interface ReferenceCatalogAdapter { definition: SpeedPartDefinition; matrix: ReferenceMatrix; offsetLdu: ReferenceVector }
/**
 * Explicit origin adapters, checked against the pinned LDraw part geometry in the
 * Speed catalog. A catalog entry alone does not establish its native origin.
 * Standard bricks/plates/tiles are top-centred; wheel axes are native +z.
 * Slopes, brackets and holders remain unresolved until their origins are checked.
 */
export function referenceCatalogAdapter(partId: string): ReferenceCatalogAdapter | null {
  const definition = getSpeedPartDefinition(partId);
  if (!definition?.dimensions || !definition.shape || definition.support !== 'supported') return null;
  if (['Brick', 'Plate', 'Tile'].includes(definition.category) && definition.shape.kind === 'box') {
    const d = definition.dimensions;
    return { definition, matrix: [0, 1, 0, -1, 0, 0, 0, 0, 1], offsetLdu: { x: -d.y * 10, y: d.x * 10, z: -d.z * 8 } };
  }
  if (partId === '66727' || partId === '18977') return { definition, matrix: [0, -1, 0, 1, 0, 0, 0, 0, 1], offsetLdu: { x: 0, y: 0, z: 0 } };
  if (partId === '3673') return { definition, matrix: [...IDENTITY_MATRIX], offsetLdu: { x: 0, y: 0, z: 0 } };
  return null;
}
