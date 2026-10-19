import type { LegoModel, PartDimensions, PlacedPart } from '../types/index.js';
import { getPartDefinition } from './catalog.js';

export interface Bounds { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }

export function footprint(part: Pick<PlacedPart, 'dimensions' | 'rotation'>): { x: number; y: number } {
  return part.rotation === 90 || part.rotation === 270
    ? { x: part.dimensions.y, y: part.dimensions.x }
    : { x: part.dimensions.x, y: part.dimensions.y };
}

export function bounds(part: PlacedPart): Bounds {
  const size = footprint(part);
  return { minX: part.position.x, minY: part.position.y, minZ: part.position.z, maxX: part.position.x + size.x, maxY: part.position.y + size.y, maxZ: part.position.z + part.dimensions.z };
}

export function overlaps(a: PlacedPart, b: PlacedPart): boolean {
  const p = bounds(a), q = bounds(b);
  return p.minX < q.maxX && p.maxX > q.minX && p.minY < q.maxY && p.maxY > q.minY && p.minZ < q.maxZ && p.maxZ > q.minZ;
}

/** Conservative box occupancy is intentional for the first slope implementation. */
export function supports(lower: PlacedPart, upper: PlacedPart): boolean {
  if (!getPartDefinition(lower.partId)?.hasStuds) return false;
  const a = bounds(lower), b = bounds(upper);
  return a.maxZ === b.minZ && Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX) >= 1 && Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY) >= 1;
}

export function connectionMap(parts: PlacedPart[]): Map<string, string[]> {
  const result = new Map(parts.map(part => [part.instanceId, [] as string[]]));
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      const a = parts[i], b = parts[j];
      if (supports(a, b) || supports(b, a)) {
        result.get(a.instanceId)!.push(b.instanceId);
        result.get(b.instanceId)!.push(a.instanceId);
      }
    }
  }
  for (const connected of result.values()) connected.sort();
  return result;
}

/** Uses object references, so it also works before instance IDs are assigned. */
export function connectedComponents(parts: PlacedPart[]): PlacedPart[][] {
  const pending = new Set(parts);
  const components: PlacedPart[][] = [];
  while (pending.size) {
    const queue = [pending.values().next().value!];
    const component: PlacedPart[] = [];
    while (queue.length) {
      const current = queue.pop()!;
      if (!pending.delete(current)) continue;
      component.push(current);
      for (const other of pending) if (supports(current, other) || supports(other, current)) queue.push(other);
    }
    components.push(component);
  }
  return components;
}

export function modelDimensions(modelOrParts: Pick<LegoModel, 'parts'> | PlacedPart[]): PartDimensions {
  const parts = Array.isArray(modelOrParts) ? modelOrParts : modelOrParts.parts;
  if (!parts.length) return { x: 0, y: 0, z: 0 };
  const boxes = parts.map(bounds);
  return {
    x: Math.max(...boxes.map(p => p.maxX)) - Math.min(...boxes.map(p => p.minX)),
    y: Math.max(...boxes.map(p => p.maxY)) - Math.min(...boxes.map(p => p.minY)),
    z: Math.max(...boxes.map(p => p.maxZ)) - Math.min(...boxes.map(p => p.minZ)),
  };
}
