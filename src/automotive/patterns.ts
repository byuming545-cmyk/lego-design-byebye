import { SPEED_PART_CATALOG, getSpeedPartDefinition } from '../speed/catalog.js';
import { deriveConnections, graphComponents, worldConnectionPoints } from '../speed/connections.js';
import { add, fromLdu, partBoundsLdu, rotatePhysical, toLdu, vehicleDimensions } from '../speed/geometry.js';
import { speedPartsCollide } from '../speed/validators.js';
import type { ConnectorType, SpeedConnection, SpeedOrientation, SpeedPlacedPart, SpeedVector, VehicleModuleId } from '../speed/types.js';
import type { PartColor, PartDimensions } from '../types/index.js';
import { referencePartToSpeedPart } from './references/analyzer.js';
import type { ReferenceAnalysis, ReferenceVehicleModel } from './references/types.js';

export type PatternVehicleType = 'luxury-sedan' | 'performance-coupe' | 'sports-car' | 'gt' | 'supercar' | 'unknown';
export type PatternCategory = 'chassis' | 'reinforcement' | 'hood' | 'front' | 'side' | 'roof' | 'rear' | 'detail';
export interface PatternSubstitution { partId: string; replacementPartIds: string[]; requiresRevalidation: true }
export interface PatternValidation { valid: boolean; errors: string[]; checked: ['catalog', 'geometry', 'connectors', 'graph']; connectionCount: number }
export interface LegoDesignPattern {
  id: string;
  name: string;
  category: PatternCategory;
  applicableVehicleTypes: PatternVehicleType[];
  dimensions: PartDimensions;
  requiredConnectionTypes: ConnectorType[];
  structuralRole: string;
  /** Positions are local stud x/y and plate z, never a whole vehicle template. */
  parts: SpeedPlacedPart[];
  connectionGraph: SpeedConnection[];
  allowedSubstitutions: PatternSubstitution[];
  /** Connector-redundancy heuristic only; null means unassessed. Not a load rating. */
  strengthScore: number | null;
  strengthAssessment: 'connector-heuristic' | 'unassessed';
  styleTags: string[];
  sourceReferences: string[];
  provenance: { kind: 'engineer-prior' | 'reference-extracted'; note: string };
  status: 'candidate' | 'confirmed';
  validation: PatternValidation;
}
const zero: SpeedOrientation = { x: 0, y: 0, z: 0 };
const neutral: PartColor = { id: 0, name: 'Black', hex: '#05131D' };
const allTypes: PatternVehicleType[] = ['luxury-sedan', 'performance-coupe', 'sports-car', 'gt', 'supercar'];
function part(partId: string, instanceId: string, x: number, y: number, z: number, orientation: SpeedOrientation = zero): SpeedPlacedPart {
  const definition = getSpeedPartDefinition(partId);
  if (!definition?.dimensions || !definition.shape || definition.support !== 'supported') throw new Error(`Pattern part ${partId} has no reliable geometry.`);
  return { instanceId, partId, name: definition.name, category: definition.category, dimensions: { ...definition.dimensions }, color: { ...neutral }, position: { x, y, z }, orientation: { ...orientation }, moduleId: 'chassis', connectionPoints: structuredClone(definition.connectionPoints), activeConnections: [], buildStep: 1 };
}
const graphKey = (graph: SpeedConnection[]) => JSON.stringify([...graph].sort((a, b) => a.id.localeCompare(b.id)));
const near = (a: number, b: number) => Math.abs(a - b) < 0.0001;

/** A pattern is usable only after independently checking the catalog and real interfaces. */
export function validatePatternGeometry(pattern: Pick<LegoDesignPattern, 'parts' | 'connectionGraph' | 'dimensions'>): PatternValidation {
  const errors: string[] = [], ids = new Set<string>();
  for (const placed of pattern.parts) {
    const definition = getSpeedPartDefinition(placed.partId);
    if (!placed.instanceId || ids.has(placed.instanceId)) errors.push(`Duplicate or empty instance ID: ${placed.instanceId}`);
    ids.add(placed.instanceId);
    if (definition?.support !== 'supported' || !definition.shape || !definition.dimensions || !definition.connectionPoints.length) errors.push(`Unknown geometry/connectors: ${placed.partId}`);
    if (JSON.stringify(placed.connectionPoints) !== JSON.stringify(definition?.connectionPoints)) errors.push(`Catalog connector mismatch: ${placed.instanceId}`);
    if (JSON.stringify(placed.dimensions) !== JSON.stringify(definition?.dimensions)) errors.push(`Catalog dimension mismatch: ${placed.instanceId}`);
    if (!(['x', 'y', 'z'] as const).every(axis => Number.isFinite(placed.position[axis]) && [0, 90, 180, 270].includes(placed.orientation[axis]))) errors.push(`Invalid pose: ${placed.instanceId}`);
  }
  if (pattern.parts.length < 2) errors.push('A local construction requires at least two connected parts.');
  if (errors.length) return { valid: false, errors, checked: ['catalog', 'geometry', 'connectors', 'graph'], connectionCount: 0 };
  const actual = deriveConnections(pattern.parts);
  if (graphKey(actual) !== graphKey(pattern.connectionGraph)) errors.push('Declared graph does not match real catalog interfaces.');
  if (graphComponents(pattern.parts, actual).length !== 1) errors.push('Pattern contains detached parts.');
  const occupied = new Set<string>();
  for (const edge of actual) for (const point of [`${edge.partA}/${edge.connectionPointA}`, `${edge.partB}/${edge.connectionPointB}`]) {
    if (occupied.has(point)) errors.push(`Connector occupied twice: ${point}`);
    occupied.add(point);
  }
  for (let a = 0; a < pattern.parts.length; a++) for (let b = a + 1; b < pattern.parts.length; b++) if (speedPartsCollide(pattern.parts[a], pattern.parts[b])) errors.push(`Solid overlap: ${pattern.parts[a].instanceId}/${pattern.parts[b].instanceId}`);
  const measured = vehicleDimensions(pattern.parts);
  if (!(['x', 'y', 'z'] as const).every(axis => near(measured[axis], pattern.dimensions[axis]))) errors.push('Dimensions do not match the assembled geometry.');
  return { valid: errors.length === 0, errors, checked: ['catalog', 'geometry', 'connectors', 'graph'], connectionCount: actual.length };
}

/** Confirmation is a programmatic geometry gate, not a claim of physical strength testing. */
export function confirmDesignPattern(pattern: LegoDesignPattern): LegoDesignPattern {
  const copy = structuredClone(pattern), validation = validatePatternGeometry(copy);
  copy.validation = validation;
  copy.status = validation.valid ? 'confirmed' : 'candidate';
  copy.strengthScore = validation.valid ? Math.min(90, Math.round(45 + Math.min(30, validation.connectionCount * 2) + Math.min(15, validation.connectionCount / Math.max(1, copy.parts.length - 1) * 3))) : null;
  copy.strengthAssessment = validation.valid ? 'connector-heuristic' : 'unassessed';
  return copy;
}

function interchangeable(a: string, b: string): boolean {
  const first = getSpeedPartDefinition(a), second = getSpeedPartDefinition(b);
  return Boolean(first?.support === 'supported' && second?.support === 'supported' && second.shape && JSON.stringify(first.dimensions) === JSON.stringify(second.dimensions) && JSON.stringify(first.connectionPoints) === JSON.stringify(second.connectionPoints));
}
function makePattern(id: string, name: string, category: PatternCategory, structuralRole: string, parts: SpeedPlacedPart[], styleTags: string[]): LegoDesignPattern {
  const connectionGraph = deriveConnections(parts);
  for (const placed of parts) placed.activeConnections = connectionGraph.filter(edge => edge.partA === placed.instanceId || edge.partB === placed.instanceId).map(edge => edge.id);
  return confirmDesignPattern({ id, name, category, structuralRole, parts, connectionGraph, dimensions: vehicleDimensions(parts), applicableVehicleTypes: [...allTypes], requiredConnectionTypes: ['stud'], allowedSubstitutions: [...new Set(parts.map(p => p.partId))].map(partId => ({ partId, replacementPartIds: Object.keys(SPEED_PART_CATALOG).filter(candidate => candidate !== partId && interchangeable(partId, candidate)), requiresRevalidation: true })), strengthScore: null, strengthAssessment: 'unassessed', styleTags, sourceReferences: [], provenance: { kind: 'engineer-prior', note: 'Manually designed local assembly, independently checked against modeled catalog geometry and connectors; no official model or physical load test is claimed.' }, status: 'candidate', validation: { valid: false, errors: [], checked: ['catalog', 'geometry', 'connectors', 'graph'], connectionCount: 0 } });
}

/** Small overlapping courses and finish assemblies; none describes a complete car. */
export function createDesignPatternLibrary(): LegoDesignPattern[] {
  return [
    makePattern('staggered-chassis-course', 'Staggered two-layer chassis course', 'chassis', 'Bridge a lower-course seam with overlapping plates.', [part('3020', 'lower-front', 0, 0, 0), part('3020', 'lower-rear', 0, 4, 0), part('3020', 'seam-bridge', 0, 2, 1), part('3022', 'front-cap', 0, 0, 1), part('3022', 'rear-cap', 0, 6, 1)], ['cross-layer', 'staggered-seam', 'chassis']),
    makePattern('longitudinal-lap-beam', 'Long longitudinal lap beam', 'reinforcement', 'Tie a long two-stud-wide beam and its end extension into one upper course.', [part('3832', 'long-base', 0, 0, 0), part('3022', 'extension', 0, 10, 0), part('2445', 'lap', 0, 0, 1)], ['long-wheelbase', 'long-hood', 'chassis', 'cross-layer']),
    makePattern('snot-grille-strips', 'Side-stud grille strip pair', 'front', 'Mount two smooth vertical strips onto a real side-stud brick; repeat across a wider grille.', [part('11211', 'support', 0, 0, 0), part('3070b', 'left-strip', 0, 0, 0.5, { x: 90, y: 0, z: 0 }), part('3070b', 'right-strip', 1, 0, 0.5, { x: 90, y: 0, z: 0 })], ['snot', 'large-grille', 'vertical-grille', 'front']),
    makePattern('snot-headlight-offset', 'Side-stud offset headlight surface', 'detail', 'A small smooth lamp surface attached by the verified 14-LDU side interface.', [part('87087', 'lamp-support', 0, 0, 0), part('3070b', 'lamp-face', 0, 0, 0.5, { x: 90, y: 0, z: 0 })], ['snot', 'headlights', 'front']),
    makePattern('curved-roof-transition', 'Curved roof transition', 'roof', 'Bridge a raised rear underside on a curved slope with a one-plate riser.', [part('3022', 'base', 0, 0, 0), part('3023', 'rear-riser', 2, 1, 1, { x: 0, y: 0, z: 90 }), part('15068', 'curve', 0, 0, 1)], ['roofline', 'curved', 'windshield-to-roof']),
  ];
}

export function getConfirmedPatterns(library: readonly LegoDesignPattern[] = createDesignPatternLibrary()): LegoDesignPattern[] {
  return library.filter(pattern => pattern.status === 'confirmed' && validatePatternGeometry(pattern).valid).map(pattern => structuredClone(pattern));
}

export interface PatternQuery {
  vehicleType?: PatternVehicleType;
  category?: PatternCategory;
  maxDimensions?: Partial<PartDimensions>;
  availableConnectionTypes?: ConnectorType[];
  styleTags?: string[];
}
export interface PatternMatch { pattern: LegoDesignPattern; score: number; reasons: string[] }
export function comparePatterns(pattern: LegoDesignPattern, query: PatternQuery): PatternMatch | null {
  if (pattern.status !== 'confirmed' || !validatePatternGeometry(pattern).valid) return null;
  if (query.category && query.category !== pattern.category) return null;
  if (query.vehicleType && query.vehicleType !== 'unknown' && !pattern.applicableVehicleTypes.includes(query.vehicleType)) return null;
  if (query.maxDimensions && !(['x', 'y', 'z'] as const).every(axis => query.maxDimensions?.[axis] === undefined || pattern.dimensions[axis] <= query.maxDimensions[axis]! + 0.0001)) return null;
  if (query.availableConnectionTypes && !pattern.requiredConnectionTypes.every(type => query.availableConnectionTypes!.includes(type))) return null;
  const hits = (query.styleTags ?? []).filter(tag => pattern.styleTags.includes(tag));
  return { pattern: structuredClone(pattern), score: 50 + Math.min(40, hits.length * 10), reasons: ['Verified local geometry and compatible interfaces.', ...hits.map(tag => `Useful for ${tag}.`)] };
}
export function retrievePatterns(query: PatternQuery, library: readonly LegoDesignPattern[] = createDesignPatternLibrary()): PatternMatch[] {
  return library.map(pattern => comparePatterns(pattern, query)).filter((match): match is PatternMatch => match !== null).sort((a, b) => b.score - a.score || a.pattern.id.localeCompare(b.pattern.id));
}

function composeOrientation(outer: SpeedOrientation, inner: SpeedOrientation): SpeedOrientation {
  const axes: SpeedVector[] = [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }];
  const expected = axes.map(axis => rotatePhysical(rotatePhysical(axis, inner), outer));
  for (const x of [0, 90, 180, 270] as const) for (const y of [0, 90, 180, 270] as const) for (const z of [0, 90, 180, 270] as const) {
    const rotation = { x, y, z };
    if (axes.every((axis, index) => { const v = rotatePhysical(axis, rotation); return near(v.x, expected[index].x) && near(v.y, expected[index].y) && near(v.z, expected[index].z); })) return rotation;
  }
  throw new Error('Unable to compose quarter-turn rotations.');
}
export function instantiatePattern(pattern: LegoDesignPattern, options: { origin?: SpeedVector; orientation?: SpeedOrientation; idPrefix?: string; color?: PartColor; moduleId?: VehicleModuleId } = {}): SpeedPlacedPart[] {
  if (pattern.status !== 'confirmed' || !validatePatternGeometry(pattern).valid) throw new Error(`Pattern ${pattern.id} is not confirmed by geometry and connection checks.`);
  const orientation = options.orientation ?? zero, origin = options.origin ?? { x: 0, y: 0, z: 0 };
  const parts = structuredClone(pattern.parts).map(placed => ({ ...placed, instanceId: `${options.idPrefix ?? pattern.id}:${placed.instanceId}`, position: add(origin, fromLdu(rotatePhysical(toLdu(placed.position), orientation))), orientation: composeOrientation(orientation, placed.orientation), color: { ...(options.color ?? placed.color) }, moduleId: options.moduleId ?? placed.moduleId, activeConnections: [] as string[] }));
  const graph = deriveConnections(parts);
  for (const placed of parts) placed.activeConnections = graph.filter(edge => edge.partA === placed.instanceId || edge.partB === placed.instanceId).map(edge => edge.id);
  return parts;
}

/** A permitted ID change still rebuilds and checks the complete local assembly. */
export function substitutePatternPart(pattern: LegoDesignPattern, instanceId: string, replacementPartId: string): LegoDesignPattern {
  const copy = structuredClone(pattern), placed = copy.parts.find(p => p.instanceId === instanceId);
  if (!placed) throw new Error(`Unknown pattern instance ${instanceId}.`);
  if (!copy.allowedSubstitutions.some(rule => rule.partId === placed.partId && rule.replacementPartIds.includes(replacementPartId)) || !interchangeable(placed.partId, replacementPartId)) throw new Error('Substitution lacks matching dimensions and catalog interfaces.');
  Object.assign(placed, part(replacementPartId, placed.instanceId, placed.position.x, placed.position.y, placed.position.z, placed.orientation), { color: placed.color, moduleId: placed.moduleId });
  copy.connectionGraph = deriveConnections(copy.parts);
  copy.dimensions = vehicleDimensions(copy.parts);
  const checked = confirmDesignPattern(copy);
  if (checked.status !== 'confirmed') throw new Error(`Substitution failed geometry checks: ${checked.validation.errors.join('; ')}`);
  return checked;
}

/** Unoccupied real connectors, for a generator to align and then validate in context. */
export function patternAttachmentPoints(pattern: LegoDesignPattern) {
  if (pattern.status !== 'confirmed' || !validatePatternGeometry(pattern).valid) return [];
  const occupied = new Set(pattern.connectionGraph.flatMap(edge => [`${edge.partA}/${edge.connectionPointA}`, `${edge.partB}/${edge.connectionPointB}`]));
  return pattern.parts.flatMap(worldConnectionPoints).filter(point => !occupied.has(`${point.partId}/${point.id}`));
}

/** Extract bounded connector-connected neighborhoods, preserving their source reference. */
export function extractPatternCandidates(referenceAnalysis: ReferenceAnalysis, model: ReferenceVehicleModel, options: { maxParts?: number; maxExtentStuds?: number; maxCandidates?: number } = {}): LegoDesignPattern[] {
  if (referenceAnalysis.referenceId !== model.id) throw new Error('Reference analysis does not belong to this model.');
  const maxParts = Math.max(2, Math.min(8, Math.floor(options.maxParts ?? 5))), maxExtent = Math.max(2, Math.min(16, options.maxExtentStuds ?? 12));
  const maxCandidates = Math.max(1, Math.min(200, Math.floor(options.maxCandidates ?? 50)));
  const parts = model.parts.filter(placed => placed.resolved).map(referencePartToSpeedPart).filter((placed): placed is SpeedPlacedPart => placed !== null);
  const byId = new Map(parts.map(placed => [placed.instanceId, placed]));
  // Both analyzer and the independently reconstructed Speed graph must prove the interface.
  const edgeKey = (edge: { partA: string; partB: string; connectionPointA: string; connectionPointB: string }) => [`${edge.partA}/${edge.connectionPointA}`, `${edge.partB}/${edge.connectionPointB}`].sort().join('|');
  const pairProof = new Map<string, Set<string>>();
  const edges = referenceAnalysis.connections.edges.filter(edge => {
    const a = byId.get(edge.partA), b = byId.get(edge.partB);
    if (!a || !b) return false;
    const pair = [edge.partA, edge.partB].sort().join('|');
    if (!pairProof.has(pair)) pairProof.set(pair, new Set(deriveConnections([a, b]).map(edgeKey)));
    return pairProof.get(pair)!.has(edgeKey(edge));
  });
  const neighbors = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!neighbors.has(edge.partA)) neighbors.set(edge.partA, new Set());
    if (!neighbors.has(edge.partB)) neighbors.set(edge.partB, new Set());
    neighbors.get(edge.partA)!.add(edge.partB); neighbors.get(edge.partB)!.add(edge.partA);
  }
  const candidates: LegoDesignPattern[] = [], seen = new Set<string>();
  for (const seed of [...neighbors.keys()].sort()) {
    if (candidates.length >= maxCandidates) break;
    const ids: string[] = [], pending = [seed], visited = new Set<string>();
    while (pending.length && ids.length < maxParts) {
      const id = pending.shift()!;
      if (visited.has(id) || !byId.has(id)) continue;
      visited.add(id);
      const proposed = [...ids, id].map(key => byId.get(key)!);
      const dimensions = vehicleDimensions(proposed);
      if (dimensions.x > maxExtent || dimensions.y > maxExtent || dimensions.z * 0.4 > maxExtent) continue;
      ids.push(id);
      pending.push(...[...(neighbors.get(id) ?? [])].sort());
    }
    if (ids.length < 2) continue;
    if (ids.length === model.parts.length && referenceAnalysis.wheels.count >= 2) continue;
    const signature = [...ids].sort().join('|');
    if (seen.has(signature)) continue;
    seen.add(signature);
    const localParts = structuredClone(ids.map(id => byId.get(id)!));
    const bounds = localParts.map(partBoundsLdu), min = fromLdu({ x: Math.min(...bounds.map(box => box.min.x)), y: Math.min(...bounds.map(box => box.min.y)), z: Math.min(...bounds.map(box => box.min.z)) });
    for (const placed of localParts) placed.position = { x: placed.position.x - min.x, y: placed.position.y - min.y, z: placed.position.z - min.z };
    const connectionGraph = deriveConnections(localParts), snot = connectionGraph.some(edge => edge.connectionType === 'side-stud');
    const category: PatternCategory = snot ? 'side' : localParts.every(placed => ['Plate', 'Brick'].includes(placed.category)) ? 'reinforcement' : 'detail';
    const candidate: LegoDesignPattern = { id: `${model.id}:cluster:${candidates.length + 1}`, name: `Local ${category} cluster from ${model.metadata.modelName}`, category, applicableVehicleTypes: [...allTypes], dimensions: vehicleDimensions(localParts), requiredConnectionTypes: [], structuralRole: 'Unconfirmed local assembly candidate; semantic role requires review.', parts: localParts, connectionGraph, allowedSubstitutions: [], strengthScore: null, strengthAssessment: 'unassessed', styleTags: ['reference-candidate', ...(snot ? ['snot'] : [])], sourceReferences: [model.id], provenance: { kind: 'reference-extracted', note: 'Bounded neighborhood extracted only from known native geometry and connector evidence. Not a complete vehicle template or an assessed physical strength claim.' }, status: 'candidate', validation: { valid: false, errors: [], checked: ['catalog', 'geometry', 'connectors', 'graph'], connectionCount: 0 } };
    for (const placed of localParts) placed.activeConnections = connectionGraph.filter(edge => edge.partA === placed.instanceId || edge.partB === placed.instanceId).map(edge => edge.id);
    candidate.validation = validatePatternGeometry(candidate);
    // The declared mounting needs must come from actual free underside interfaces.
    const used = new Set(connectionGraph.flatMap(edge => [`${edge.partA}/${edge.connectionPointA}`, `${edge.partB}/${edge.connectionPointB}`]));
    if (localParts.flatMap(worldConnectionPoints).some(point => !used.has(`${point.partId}/${point.id}`) && point.type === 'antiStud')) candidate.requiredConnectionTypes = ['stud'];
    candidates.push(candidate);
  }
  return candidates;
}
