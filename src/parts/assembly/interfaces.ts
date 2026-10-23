import { createHash } from 'node:crypto';
import type { ImportedConnectionPoint } from '../connections/types.js';
import type { NativeAssemblyPart } from './types.js';

export function physicalConnectionSignature(point: ImportedConnectionPoint): string {
  const properties = Object.fromEntries(Object.entries(point.properties).filter(([key]) => !['pos', 'ori', 'grid'].includes(key)).sort(([a], [b]) => a.localeCompare(b)));
  return JSON.stringify([point.kind, point.family, point.gender, point.position, point.direction, point.orientation, point.sections, point.radius, point.length, point.group, properties, point.dimensionsResolved]);
}
export interface PhysicalConnectionGroup {
  physicalInterfaceId: string;
  points: ImportedConnectionPoint[];
  rawConnectionIds: string[];
}
export function groupPhysicalInterfaces(part: NativeAssemblyPart): PhysicalConnectionGroup[] {
  const groups = new Map<string, ImportedConnectionPoint[]>();
  for (const point of part.connections.points) {
    const signature = physicalConnectionSignature(point), values = groups.get(signature) ?? [];
    values.push(point); groups.set(signature, values);
  }
  return [...groups].map(([signature, points]) => ({ physicalInterfaceId: createHash('sha256').update(JSON.stringify([part.partId, signature])).digest('hex'), points, rawConnectionIds: points.map(point => point.id).sort() }));
}
/** Logical groups mean source directive instances before expanding their grid into physical ports. */
export function logicalConnectionGroupCount(part: NativeAssemblyPart): number {
  return new Set(part.connections.points.map(point => JSON.stringify([point.source.library, point.source.path, point.source.line, point.source.raw, point.source.transforms]))).size;
}
