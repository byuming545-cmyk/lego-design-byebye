import { getSpeedPartDefinition } from './catalog.js';
import { distance, SPEED_EPSILON, transformDirection, transformPointLdu } from './geometry.js';
import type { ConnectionPoint, ConnectorType, SpeedConnection, SpeedPlacedPart, SpeedVector, VehicleModel } from './types.js';

export interface WorldConnectionPoint extends ConnectionPoint { partId: string; positionLdu: SpeedVector; worldDirection: SpeedVector }
const connectorFamily = (type: ConnectorType) => type === 'sideStud' ? 'stud' : type === 'sideAntiStud' ? 'antiStud' : type;

export function worldConnectionPoints(part: SpeedPlacedPart): WorldConnectionPoint[] {
  // Catalog definitions are authoritative; copied client metadata cannot add studs.
  return (getSpeedPartDefinition(part.partId)?.connectionPoints ?? []).map(point => ({ ...point, partId: part.instanceId, positionLdu: transformPointLdu(part, point.localPosition), worldDirection: transformDirection(part, point.direction) }));
}

export function canConnect(a: WorldConnectionPoint, b: WorldConnectionPoint): boolean {
  if (a.partId === b.partId || distance(a.positionLdu, b.positionLdu) > SPEED_EPSILON) return false;
  const dot = a.worldDirection.x * b.worldDirection.x + a.worldDirection.y * b.worldDirection.y + a.worldDirection.z * b.worldDirection.z;
  if (Math.abs(dot + 1) > SPEED_EPSILON) return false;
  if (!a.compatibleTypes.some(type => connectorFamily(type) === connectorFamily(b.type)) || !b.compatibleTypes.some(type => connectorFamily(type) === connectorFamily(a.type))) return false;
  if ((a.fitFamily || b.fitFamily) && (!a.fitFamily || a.fitFamily !== b.fitFamily)) return false;
  return true;
}

export function deriveConnections(parts: SpeedPlacedPart[]): SpeedConnection[] {
  const points = [...parts].sort((a, b) => a.instanceId.localeCompare(b.instanceId)).flatMap(worldConnectionPoints);
  const connections: SpeedConnection[] = [];
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
    const a = points[i], b = points[j];
    if (!canConnect(a, b)) continue;
    const pair = [a.type, b.type];
    const connectionType = pair.includes('wheelPin') ? 'wheel-axle' : pair.includes('rim') ? 'tyre-fit' : Math.abs(a.worldDirection.z) < 0.5 || pair.includes('sideStud') || pair.includes('sideAntiStud') ? 'side-stud' : 'stud';
    connections.push({ id: `connection:${a.partId}/${a.id}|${b.partId}/${b.id}`, partA: a.partId, connectionPointA: a.id, partB: b.partId, connectionPointB: b.id, connectionType, allowsRotation: connectionType === 'wheel-axle' && Boolean(a.allowsRotation && b.allowsRotation) });
  }
  return connections;
}

export function graphComponents(parts: SpeedPlacedPart[], connections = deriveConnections(parts)): string[][] {
  const pending = new Set(parts.map(part => part.instanceId));
  const components: string[][] = [];
  while (pending.size) {
    const queue = [pending.values().next().value!], component: string[] = [];
    while (queue.length) {
      const id = queue.pop()!;
      if (!pending.delete(id)) continue;
      component.push(id);
      for (const edge of connections) {
        if (edge.partA === id) queue.push(edge.partB);
        else if (edge.partB === id) queue.push(edge.partA);
      }
    }
    components.push(component);
  }
  return components;
}

export function applyVehicleConnections(model: VehicleModel): void {
  model.connections = deriveConnections(model.parts);
  for (const part of model.parts) part.activeConnections = model.connections.filter(edge => edge.partA === part.instanceId || edge.partB === part.instanceId).map(edge => edge.id);
  for (const module of model.modules) module.connectionIds = model.connections.filter(edge => module.partIds.includes(edge.partA) || module.partIds.includes(edge.partB)).map(edge => edge.id);
}
