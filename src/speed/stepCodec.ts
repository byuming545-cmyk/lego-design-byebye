import { getSpeedPartDefinition } from './catalog.js';
import { deriveConnections } from './connections.js';
import { SpeedGenerationError } from './errors.js';
import type { SpeedBuildStep, SpeedConnection, SpeedPlacedPart, VehicleCandidate } from './types.js';

export const SPEED_STEP_ENCODING = 'part-ids-v1' as const;
export const MAX_PACKED_SPEED_PARTS = 300;
export const MAX_PACKED_SPEED_STEPS = MAX_PACKED_SPEED_PARTS * 4 + 20;
const MAX_CONNECTION_POINTS = 4000;

export interface PartIdBuildStep extends Omit<SpeedBuildStep, 'addedParts' | 'totalModelState'> {
  addedPartIds: string[];
  statePartIds: string[];
}
export interface PackedVehicleCandidate extends Omit<VehicleCandidate, 'steps'> {
  stepEncoding: typeof SPEED_STEP_ENCODING;
  steps: PartIdBuildStep[];
}

// The public step retains its original JSON shape. IDs stay private so repeated
// cloning and persistence never have to materialize its part snapshots.
const partIds = new WeakMap<SpeedBuildStep, { added: readonly string[]; state: readonly string[] }>();

function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function recordsFromSteps(steps: readonly SpeedBuildStep[]): PartIdBuildStep[] {
  return steps.map(step => {
    const known = partIds.get(step);
    return {
      stepNumber: step.stepNumber, title: step.title, description: step.description,
      type: step.type, parentAssembly: step.parentAssembly,
      ...(step.subAssemblyId === undefined ? {} : { subAssemblyId: step.subAssemblyId }),
      addedPartIds: known ? [...known.added] : step.addedParts.map(part => part.instanceId),
      statePartIds: known ? [...known.state] : step.totalModelState.map(part => part.instanceId),
      orientation: { ...step.orientation }, cameraHint: step.cameraHint,
    };
  });
}

function hydrateSteps(canonicalParts: SpeedPlacedPart[], records: readonly PartIdBuildStep[], graph: SpeedConnection[]): SpeedBuildStep[] {
  const byId = new Map(canonicalParts.map(part => [part.instanceId, part]));
  const adjacency = new Map<string, SpeedConnection[]>();
  for (const edge of graph) {
    for (const id of [edge.partA, edge.partB]) {
      const edges = adjacency.get(id) ?? [];
      edges.push(edge); adjacency.set(id, edges);
    }
  }
  const snapshot = (ids: readonly string[]): SpeedPlacedPart[] => {
    const included = new Set(ids);
    return ids.map(id => {
      const part = structuredClone(byId.get(id)!);
      part.activeConnections = (adjacency.get(id) ?? []).filter(edge => included.has(edge.partA) && included.has(edge.partB)).map(edge => edge.id);
      return part;
    });
  };
  return records.map(record => {
    const { addedPartIds, statePartIds, ...metadata } = record;
    const added = Object.freeze([...addedPartIds]), state = Object.freeze([...statePartIds]);
    const step = structuredClone(metadata) as SpeedBuildStep;
    Object.defineProperties(step, {
      addedParts: { enumerable: true, configurable: true, get: () => snapshot(added) },
      totalModelState: { enumerable: true, configurable: true, get: () => snapshot(state) },
    });
    partIds.set(step, { added, state });
    return step;
  });
}

/** Capture the completed model once; later model edits cannot alter old steps. */
export function createPartIdBuildSteps(parts: readonly SpeedPlacedPart[], records: readonly PartIdBuildStep[], connections?: readonly SpeedConnection[]): SpeedBuildStep[] {
  const canonical = freeze(structuredClone(parts)) as SpeedPlacedPart[];
  const graph = freeze(connections ? structuredClone(connections) : deriveConnections(canonical)) as SpeedConnection[];
  return hydrateSteps(canonical, records, graph);
}

/** Clone model/validation once and share its immutable parts with lazy snapshots. */
export function compactVehicleCandidate(candidate: VehicleCandidate): VehicleCandidate {
  const records = recordsFromSteps(candidate.steps);
  const copy = structuredClone({ model: candidate.model, validation: candidate.validation });
  freeze(copy.model.parts);
  return { ...copy, steps: hydrateSteps(copy.model.parts, records, freeze(deriveConnections(copy.model.parts))) };
}

/** Disk representation only; JSON.stringify of a public candidate stays unchanged. */
export function packCandidateSteps(candidate: VehicleCandidate): PackedVehicleCandidate {
  return { ...structuredClone({ model: candidate.model, validation: candidate.validation }), stepEncoding: SPEED_STEP_ENCODING, steps: recordsFromSteps(candidate.steps) };
}

function invalid(): never {
  throw new SpeedGenerationError('模型拼搭步骤编码无效或超过安全上限。', 'INVALID_SPEED_STEP_ENCODING');
}
type InputObject = Record<string, unknown>;
function object(input: unknown): InputObject {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid();
  return input as InputObject;
}
function text(input: unknown, max: number): string {
  if (typeof input !== 'string' || !input.trim() || input.length > max) invalid();
  return input;
}
function orientation(input: unknown): SpeedBuildStep['orientation'] {
  const value = object(input);
  if (Object.keys(value).length !== 3 || !['x', 'y', 'z'].every(axis => [0, 90, 180, 270].includes(value[axis] as number))) invalid();
  return { x: value.x, y: value.y, z: value.z } as SpeedBuildStep['orientation'];
}
function ids(input: unknown, known: Set<string>): string[] {
  if (!Array.isArray(input) || input.length > known.size) invalid();
  const result = input.map(value => text(value, 120));
  if (new Set(result).size !== result.length || result.some(id => !known.has(id))) invalid();
  return result;
}
const modules = ['chassis', 'front', 'rear', 'cockpit', 'roof', 'leftWheelModule', 'rightWheelModule', 'bodyShell', 'aero', 'details'];

/**
 * Decode references before expensive geometry or snapshot expansion. This is a
 * bounded format decoder; imported models still require full catalog/stock validation.
 */
export function unpackCandidateSteps(input: unknown): VehicleCandidate {
  const candidate = object(input), model = object(candidate.model);
  if (Object.keys(candidate).some(key => !['model', 'validation', 'steps', 'stepEncoding'].includes(key)) ||
      candidate.stepEncoding !== undefined && candidate.stepEncoding !== SPEED_STEP_ENCODING) invalid();
  if (!Array.isArray(model.parts) || !model.parts.length || model.parts.length > MAX_PACKED_SPEED_PARTS ||
      !Array.isArray(candidate.steps) || !candidate.steps.length || candidate.steps.length > MAX_PACKED_SPEED_STEPS) invalid();
  object(candidate.validation);
  const known = new Set<string>();
  let pointCount = 0;
  for (const entry of model.parts) {
    const part = object(entry), id = text(part.instanceId, 120), definition = getSpeedPartDefinition(text(part.partId, 80));
    if (known.has(id) || !definition || !Array.isArray(part.connectionPoints) || !modules.includes(part.moduleId as string)) invalid();
    known.add(id);
    pointCount += Math.max(part.connectionPoints.length, definition.connectionPoints.length);
    if (pointCount > MAX_CONNECTION_POINTS) invalid();
    orientation(part.orientation);
    const position = object(part.position), dimensions = object(part.dimensions);
    for (const axis of ['x', 'y', 'z']) {
      if (typeof position[axis] !== 'number' || !Number.isFinite(position[axis]) || Math.abs(position[axis] as number) > 1024 ||
          typeof dimensions[axis] !== 'number' || !Number.isFinite(dimensions[axis]) || (dimensions[axis] as number) <= 0 || (dimensions[axis] as number) > 1024) invalid();
    }
    if (!Number.isSafeInteger(part.buildStep) || Number(part.buildStep) < 1 || Number(part.buildStep) > candidate.steps.length) invalid();
  }
  const packed = candidate.stepEncoding === SPEED_STEP_ENCODING;
  const records = candidate.steps.map((entry, index): PartIdBuildStep => {
    const step = object(entry);
    const allowed = ['stepNumber', 'title', 'description', 'type', 'parentAssembly', 'subAssemblyId', 'orientation', 'cameraHint', ...(packed ? ['addedPartIds', 'statePartIds'] : ['addedParts', 'totalModelState'])];
    if (Object.keys(step).some(key => !allowed.includes(key)) || step.stepNumber !== index + 1 ||
        !['build', 'subassembly', 'attach', 'rotate'].includes(step.type as string) ||
        !['vehicle', ...modules].includes(step.parentAssembly as string) ||
        !['isometric', 'bottom', 'front', 'rear', 'side'].includes(step.cameraHint as string)) invalid();
    const getIds = (value: unknown): string[] => {
      if (packed) return ids(value, known);
      if (!Array.isArray(value) || value.length > known.size) invalid();
      return ids(value.map(part => object(part).instanceId), known);
    };
    const addedPartIds = getIds(step[packed ? 'addedPartIds' : 'addedParts']);
    const statePartIds = getIds(step[packed ? 'statePartIds' : 'totalModelState']);
    if (!statePartIds.length || addedPartIds.some(id => !statePartIds.includes(id)) ||
        (step.type === 'rotate' ? addedPartIds.length !== 0 : addedPartIds.length === 0) ||
        (['build', 'subassembly'].includes(step.type as string) && addedPartIds.length > 4) ||
        (step.type === 'subassembly' ? step.parentAssembly === 'vehicle' : step.parentAssembly !== 'vehicle') ||
        (['subassembly', 'attach'].includes(step.type as string) ? typeof step.subAssemblyId !== 'string' : step.subAssemblyId !== undefined)) invalid();
    return {
      stepNumber: index + 1, title: text(step.title, 1000), description: text(step.description, 4000),
      type: step.type as SpeedBuildStep['type'], parentAssembly: step.parentAssembly as SpeedBuildStep['parentAssembly'],
      ...(step.subAssemblyId === undefined ? {} : { subAssemblyId: text(step.subAssemblyId, 200) }),
      addedPartIds, statePartIds, orientation: orientation(step.orientation), cameraHint: step.cameraHint as SpeedBuildStep['cameraHint'],
    };
  });
  const picked = new Map<string, number>(), installed = new Set<string>(), independent = new Map<string, Set<string>>();
  const attached = new Set<string>(), assemblyModules = new Map<string, string>();
  const modelParts = new Map(model.parts.map(entry => [(entry as SpeedPlacedPart).instanceId, entry as SpeedPlacedPart]));
  const sameMembers = (actual: readonly string[], expected: Set<string>): boolean => actual.length === expected.size && actual.every(id => expected.has(id));
  for (const step of records) {
    if (step.type === 'build' || step.type === 'subassembly') {
      for (const id of step.addedPartIds) {
        if (picked.has(id)) invalid();
        picked.set(id, step.stepNumber);
      }
    }
    if (step.type === 'subassembly') {
      if (attached.has(step.subAssemblyId!) ||
          assemblyModules.has(step.subAssemblyId!) && assemblyModules.get(step.subAssemblyId!) !== step.parentAssembly ||
          step.statePartIds.some(id => modelParts.get(id)!.moduleId !== step.parentAssembly)) invalid();
      assemblyModules.set(step.subAssemblyId!, step.parentAssembly);
      const members = independent.get(step.subAssemblyId!) ?? new Set<string>();
      for (const id of step.addedPartIds) members.add(id);
      if (!sameMembers(step.statePartIds, members)) invalid();
      independent.set(step.subAssemblyId!, members);
      continue;
    }
    if (step.type === 'attach') {
      const members = independent.get(step.subAssemblyId!);
      if (!members || !sameMembers(step.addedPartIds, members)) invalid();
      independent.delete(step.subAssemblyId!);
      attached.add(step.subAssemblyId!);
    }
    for (const id of step.addedPartIds) {
      if (installed.has(id)) invalid();
      installed.add(id);
    }
    if (!sameMembers(step.statePartIds, installed)) invalid();
  }
  if (installed.size !== known.size || picked.size !== known.size || independent.size ||
      model.parts.some(entry => picked.get((entry as SpeedPlacedPart).instanceId) !== (entry as SpeedPlacedPart).buildStep)) invalid();
  const copy = structuredClone({ model, validation: candidate.validation }) as unknown as Pick<VehicleCandidate, 'model' | 'validation'>;
  freeze(copy.model.parts);
  return { ...copy, steps: hydrateSteps(copy.model.parts, records, freeze(deriveConnections(copy.model.parts))) };
}
