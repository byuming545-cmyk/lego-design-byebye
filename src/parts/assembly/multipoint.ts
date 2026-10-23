import type { ImportedConnectionPoint } from '../connections/types.js';
import type { AssemblyGraphEdge, NativeAssemblyPart, NativePlacement } from './types.js';
import { checkConnectionCompatibility } from './compatibility.js';
import type { CompatibilityResult } from './compatibility.js';
import { solveAttachment, type AttachmentCandidate } from './solver.js';
import { distance, normalize, rotate, transformPoint } from './math.js';

const ANCHOR_TOLERANCE = 1e-5;
const AXIS_TOLERANCE = 1e-6;
const PHYSICAL_KEY_SCALE = 1e7;

export interface PhysicalConnectionGroup { readonly key: string; readonly points: readonly ImportedConnectionPoint[] }
export interface MultiPointConnectionMatch {
  fixedConnectionId: string;
  movingConnectionId: string;
  fixedPhysicalKey: string;
  movingPhysicalKey: string;
  compatibility: CompatibilityResult;
  candidate: AttachmentCandidate;
}
export interface MultiPointResult {
  status: 'consistent' | 'blocked';
  matches: MultiPointConnectionMatch[];
  issues: { code: 'rotation-disagreement' | 'ambiguous-physical-mate' | 'missing-requested-mate'; reason: string }[];
}

/** Native physical identity intentionally excludes raw source-line aliases. */
export function physicalConnectionKey(point: ImportedConnectionPoint): string {
  const direction = normalize(point.direction) ?? point.direction;
  return JSON.stringify([point.gender, point.position.map((value) => Math.round(value * PHYSICAL_KEY_SCALE)), direction.map((value) => Math.round(value * PHYSICAL_KEY_SCALE))]);
}
export function physicalEndpointKey(instanceId: string, point: ImportedConnectionPoint): string { return JSON.stringify([instanceId, physicalConnectionKey(point)]); }
export function sourceEndpointKey(instanceId: string, connectionId: string, part?: NativeAssemblyPart): string {
  const point = part?.connections.points.find((candidate) => candidate.id === connectionId);
  return point ? physicalEndpointKey(instanceId, point) : JSON.stringify([instanceId, 'unresolved-source-endpoint', connectionId]);
}
const groupCache = new WeakMap<NativeAssemblyPart, readonly PhysicalConnectionGroup[]>();
export function physicalConnectionGroups(part: NativeAssemblyPart): readonly PhysicalConnectionGroup[] {
  const cached = groupCache.get(part);
  if (cached) return cached;
  const groups = new Map<string, ImportedConnectionPoint[]>();
  for (const point of part.connections.points) { const key = physicalConnectionKey(point), group = groups.get(key) ?? []; group.push(point); groups.set(key, group); }
  const result = [...groups].map(([key, points]) => ({ key, points }));
  if (Object.isFrozen(part)) groupCache.set(part, result);
  return result;
}

function sameTransform(a: NativePlacement['transform'], b: NativePlacement['transform']) { return distance(a.translation, b.translation) < ANCHOR_TOLERANCE && a.rotation.every((value, index) => Math.abs(value - b.rotation[index]) < AXIS_TOLERANCE); }
function bucketKey(position: number[]): string { return position.map((value) => Math.round(value / ANCHOR_TOLERANCE)).join(','); }
function aliases(group: PhysicalConnectionGroup, preferred: string | undefined, allowed: ReadonlySet<string> | undefined): ImportedConnectionPoint[] {
  return [...group.points].sort((a, b) => Number(b.id === preferred) - Number(a.id === preferred) || Number(allowed?.has(b.id) ?? false) - Number(allowed?.has(a.id) ?? false));
}

/**
 * At an already solved rigid placement, discover every supported physical mate.
 * Every source endpoint pair must recover this very same transform, including
 * its quarter-turn relation. Coincidence never adds an unsupported mating rule.
 */
export function checkMultiPointConnection(input: {
  fixedPart: NativeAssemblyPart;
  fixedPlacement: NativePlacement;
  movingPart: NativeAssemblyPart;
  movingPlacement: NativePlacement;
  preferredFixedConnectionId?: string;
  preferredMovingConnectionId?: string;
  allowedFixedConnectionIds?: ReadonlySet<string>;
  allowedMovingConnectionIds?: ReadonlySet<string>;
  requirePreferredPair?: boolean;
}): MultiPointResult {
  const issues: MultiPointResult['issues'] = [], matches: MultiPointConnectionMatch[] = [];
  const { fixedPart, fixedPlacement, movingPart, movingPlacement } = input;
  const fixedGroups = physicalConnectionGroups(fixedPart), movingGroups = physicalConnectionGroups(movingPart);
  const buckets = new Map<string, { group: PhysicalConnectionGroup; position: [number, number, number]; direction: [number, number, number] }[]>();
  for (const group of fixedGroups) {
    const point = group.points[0], position = transformPoint(fixedPlacement.transform, point.position), direction = normalize(rotate(fixedPlacement.transform.rotation, point.direction));
    if (!direction) continue;
    const key = bucketKey(position), list = buckets.get(key) ?? []; list.push({ group, position, direction }); buckets.set(key, list);
  }
  const usedFixed = new Set<string>(), usedMoving = new Set<string>();
  for (const movingGroup of movingGroups) {
    const movingPoint = movingGroup.points[0], position = transformPoint(movingPlacement.transform, movingPoint.position), direction = normalize(rotate(movingPlacement.transform.rotation, movingPoint.direction));
    if (!direction) continue;
    const coordinate = position.map((value) => Math.round(value / ANCHOR_TOLERANCE));
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
      const candidates = buckets.get([coordinate[0] + x, coordinate[1] + y, coordinate[2] + z].join(',')) ?? [];
      for (const fixed of candidates) {
        if (distance(position, fixed.position) > ANCHOR_TOLERANCE || distance(direction, fixed.direction) > AXIS_TOLERANCE) continue;
        let matched: MultiPointConnectionMatch | undefined;
        let sourceCompatible = false;
        for (const a of aliases(fixed.group, input.preferredFixedConnectionId, input.allowedFixedConnectionIds)) {
          for (const b of aliases(movingGroup, input.preferredMovingConnectionId, input.allowedMovingConnectionIds)) {
            const compatibility = checkConnectionCompatibility(a, b);
            if (compatibility.status !== 'compatible') continue;
            sourceCompatible = true;
            const solved = solveAttachment({ fixedPart, fixedPlacement, fixedConnectionId: a.id, movingPart, movingConnectionId: b.id });
            const candidate = solved.candidates.find((candidate) => sameTransform(candidate.transform, movingPlacement.transform));
            if (candidate) { matched = { fixedConnectionId: a.id, movingConnectionId: b.id, fixedPhysicalKey: fixed.group.key, movingPhysicalKey: movingGroup.key, compatibility, candidate }; break; }
          }
          if (matched) break;
        }
        if (!matched) {
          if (sourceCompatible) issues.push({ code: 'rotation-disagreement', reason: `Source-compatible coincident endpoints ${fixed.group.points[0].id} / ${movingPoint.id} do not permit the candidate's shared rigid rotation.` });
          continue;
        }
        if (usedFixed.has(fixed.group.key) || usedMoving.has(movingGroup.key)) { issues.push({ code: 'ambiguous-physical-mate', reason: 'One physical endpoint would be mated more than once by the same placement.' }); continue; }
        usedFixed.add(fixed.group.key); usedMoving.add(movingGroup.key); matches.push(matched);
      }
    }
  }
  if (input.requirePreferredPair && !matches.some((match) => {
    const a = fixedPart.connections.points.find((point) => point.id === input.preferredFixedConnectionId), b = movingPart.connections.points.find((point) => point.id === input.preferredMovingConnectionId);
    return !!a && !!b && match.fixedPhysicalKey === physicalConnectionKey(a) && match.movingPhysicalKey === physicalConnectionKey(b);
  })) issues.push({ code: 'missing-requested-mate', reason: 'The selected source mating endpoints do not share the candidate placement.' });
  return { status: issues.length ? 'blocked' : 'consistent', matches, issues };
}

export function physicalMatingPairKey(aInstance: string, a: ImportedConnectionPoint, bInstance: string, b: ImportedConnectionPoint): string {
  return JSON.stringify([physicalEndpointKey(aInstance, a), physicalEndpointKey(bInstance, b)].sort());
}

export function validateConnectionOccupancy(edges: readonly AssemblyGraphEdge[], parts: ReadonlyMap<string, NativeAssemblyPart>): { valid: boolean; issues: string[] } {
  const occupied = new Set<string>(), pairKeys = new Set<string>(), issues: string[] = [];
  for (const edge of edges) {
    const a = parts.get(edge.fixedInstanceId)?.connections.points.find((point) => point.id === edge.fixedConnectionId), b = parts.get(edge.movingInstanceId)?.connections.points.find((point) => point.id === edge.movingConnectionId);
    if (!a || !b) { issues.push('An occupancy edge has no actual source endpoint.'); continue; }
    const pair = physicalMatingPairKey(edge.fixedInstanceId, a, edge.movingInstanceId, b);
    if (pairKeys.has(pair)) issues.push('A physical mating pair is recorded more than once, including source aliases or reversed edges.');
    pairKeys.add(pair);
    for (const endpoint of [physicalEndpointKey(edge.fixedInstanceId, a), physicalEndpointKey(edge.movingInstanceId, b)]) {
      if (occupied.has(endpoint)) issues.push('A physical connection endpoint is occupied more than once.');
      occupied.add(endpoint);
    }
  }
  return { valid: issues.length === 0, issues: [...new Set(issues)] };
}

export class MultiPointConnectionTest { check(input: Parameters<typeof checkMultiPointConnection>[0]) { return checkMultiPointConnection(input); } }
export class ConnectionOccupancyValidator { validate(edges: readonly AssemblyGraphEdge[], parts: ReadonlyMap<string, NativeAssemblyPart>) { return validateConnectionOccupancy(edges, parts); } }
