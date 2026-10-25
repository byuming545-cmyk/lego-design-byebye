import { getSpeedPartDefinition } from '../../speed/catalog.js';
import { canConnect, type WorldConnectionPoint } from '../../speed/connections.js';
import { rotatePhysical } from '../../speed/geometry.js';
import type { SpeedOrientation, SpeedPlacedPart } from '../../speed/types.js';
import { ReferenceImportError } from './importer.js';
import { addVectors, determinant, internalLduToDisplay, isOrthogonalAxisMatrix, ldrawToInternalLdu, multiplyMatrices, referenceCatalogAdapter, transformVector } from './coordinates.js';
import type { Measurement, ReferenceAnalysis, ReferenceBounds, ReferenceConnection, ReferenceMatrix, ReferencePart, ReferenceVector, ReferenceVehicleModel } from './types.js';

const axes = ['x', 'y', 'z'] as const;
const metric = <T = number>(value: T | null, unit: Measurement['unit'], confidence: number, ...evidence: string[]): Measurement<T> => ({ value, unit, confidence: value === null ? 0 : confidence, evidence });
const unknown = (reason: string, unit: Measurement['unit'] = 'stud'): Measurement => metric<number>(null, unit, 0, reason);
const scale = (v: ReferenceVector): ReferenceVector => ({ x: v.x * 20, y: v.y * 20, z: v.z * 8 });
export function referencePartWorldTransform(part: ReferencePart): { matrix: ReferenceMatrix; positionLdu: ReferenceVector } | null {
  const adapter = referenceCatalogAdapter(part.partId);
  if (!adapter) return null;
  return { matrix: multiplyMatrices(part.matrixInternalLdu, adapter.matrix), positionLdu: addVectors(ldrawToInternalLdu(part.positionLdu), transformVector(part.matrixInternalLdu, adapter.offsetLdu)) };
}
const transformPoint = (t: { matrix: ReferenceMatrix; positionLdu: ReferenceVector }, point: ReferenceVector): ReferenceVector => addVectors(t.positionLdu, transformVector(t.matrix, point));
export function referencePartBoundsLdu(part: ReferencePart): { min: ReferenceVector; max: ReferenceVector } | null {
  const adapter = referenceCatalogAdapter(part.partId), t = referencePartWorldTransform(part);
  if (!adapter || !t) return null;
  const shape = adapter.definition.shape!, points: ReferenceVector[] = [];
  for (const box of shape.boxes ?? []) for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) points.push(transformPoint(t, scale({ x, y, z })));
  const cylinders = [...(shape.cylinders ?? [])];
  if (shape.axis && shape.radius !== undefined && shape.width !== undefined) cylinders.push({ axis: shape.axis, radius: shape.radius, width: shape.width, center: shape.center ?? { x: 0, y: 0, z: 0 } });
  // Analytic affine-cylinder envelope, including arbitrary rotations/shear/scale.
  for (const cylinder of cylinders) {
    const center = transformPoint(t, scale(cylinder.center)), axial = axes.indexOf(cylinder.axis), radial = [0, 1, 2].filter(i => i !== axial);
    const extent = Object.fromEntries(axes.map((axis, row) => [axis, Math.abs(t.matrix[row * 3 + axial]) * cylinder.width * 10 + cylinder.radius * 20 * Math.hypot(...radial.map(i => t.matrix[row * 3 + i]))])) as unknown as ReferenceVector;
    points.push({ x: center.x - extent.x, y: center.y - extent.y, z: center.z - extent.z }, addVectors(center, extent));
  }
  if (!points.length) return null;
  return { min: Object.fromEntries(axes.map(axis => [axis, Math.min(...points.map(point => point[axis]))])) as unknown as ReferenceVector, max: Object.fromEntries(axes.map(axis => [axis, Math.max(...points.map(point => point[axis]))])) as unknown as ReferenceVector };
}
export function referencePartConnectionPoints(part: ReferencePart): WorldConnectionPoint[] {
  const adapter = referenceCatalogAdapter(part.partId), t = referencePartWorldTransform(part);
  if (!adapter || !t || !isOrthogonalAxisMatrix(t.matrix) || determinant(t.matrix) < 0) return [];
  return adapter.definition.connectionPoints.map(point => ({ ...point, partId: part.instanceId, positionLdu: transformPoint(t, scale(point.localPosition)), worldDirection: transformVector(t.matrix, point.direction) }));
}
export function deriveReferenceConnections(parts: ReferencePart[]): ReferenceConnection[] {
  const buckets = new Map<string, WorldConnectionPoint[]>(), edges: ReferenceConnection[] = [];
  // Nearby-cell lookup preserves the existing connector tolerance without O(n²) all-pairs.
  const cell = 0.001;
  let comparisons = 0, pointCount = 0;
  for (const part of parts) for (const point of referencePartConnectionPoints(part)) {
    if (++pointCount > 250_000) throw new ReferenceImportError('Reference connector analysis exceeds the point limit.', 'REFERENCE_ANALYSIS_LIMIT', 422);
    const p = point.positionLdu, base = [Math.floor(p.x / cell), Math.floor(p.y / cell), Math.floor(p.z / cell)];
    for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) for (const dz of [-1, 0, 1]) for (const other of buckets.get(`${base[0] + dx},${base[1] + dy},${base[2] + dz}`) ?? []) {
      if (++comparisons > 1_000_000 || edges.length >= 100_000) throw new ReferenceImportError('Reference connector analysis exceeds the comparison limit; overlapping parts may be excessive.', 'REFERENCE_ANALYSIS_LIMIT', 422);
      if (!canConnect(other, point)) continue;
      const pair = [point.type, other.type];
      const connectionType = pair.includes('wheelPin') ? 'wheel-axle' : pair.includes('rim') ? 'tyre-fit' : pair.includes('sideStud') || pair.includes('sideAntiStud') || Math.abs(point.worldDirection.z) < 0.5 ? 'side-stud' : 'stud';
      edges.push({ id: `reference-connection:${other.partId}/${other.id}|${point.partId}/${point.id}`, partA: other.partId, partB: point.partId, connectionPointA: other.id, connectionPointB: point.id, connectionType });
    }
    const key = base.join(','); const bucket = buckets.get(key); if (bucket) bucket.push(point); else buckets.set(key, [point]);
  }
  return edges;
}
/** Only verified native origins and proper quarter-turn rotations can enter Speed operations. */
export function referencePartToSpeedPart(part: ReferencePart): SpeedPlacedPart | null {
  const adapter = referenceCatalogAdapter(part.partId), t = referencePartWorldTransform(part);
  if (!adapter || !t || !isOrthogonalAxisMatrix(t.matrix) || determinant(t.matrix) < 0) return null;
  let orientation: SpeedOrientation | undefined;
  const turns = [0, 90, 180, 270] as const;
  for (const x of turns) for (const y of turns) for (const z of turns) {
    const candidate = { x, y, z };
    if (axes.every((axis, column) => { const v = rotatePhysical({ x: Number(column === 0), y: Number(column === 1), z: Number(column === 2) }, candidate); return axes.every((a, row) => Math.abs(v[a] - t.matrix[row * 3 + column]) < 1e-5); })) orientation ??= candidate;
  }
  if (!orientation) return null;
  const d = adapter.definition;
  return { instanceId: part.instanceId, partId: part.partId, name: d.name, category: d.category, color: { id: part.color, name: `LDraw ${part.color}`, hex: '#808080' }, dimensions: d.dimensions!, position: internalLduToDisplay(t.positionLdu), orientation, moduleId: 'details', connectionPoints: d.connectionPoints, activeConnections: [], buildStep: 1 };
}

export function analyzeReferenceModel(model: ReferenceVehicleModel, options: { longitudinalAxis?: 'x' | 'y'; frontDirection?: 1 | -1 } = {}): ReferenceAnalysis {
  const longitudinalAxis = options.longitudinalAxis ?? 'y', transverseAxis = longitudinalAxis === 'y' ? 'x' : 'y';
  if (!['x', 'y'].includes(longitudinalAxis) || options.frontDirection !== undefined && options.frontDirection !== 1 && options.frontDirection !== -1) throw new RangeError('Invalid reference vehicle axes.');
  const known = model.parts.map(part => ({ part, box: referencePartBoundsLdu(part) }));
  const knownGeometryParts = known.filter(p => p.box).length;
  const coverage = { totalParts: model.parts.length, knownGeometryParts, geometryRate: model.parts.length ? knownGeometryParts / model.parts.length : 0, unresolvedPartIds: [...new Set(known.filter(p => !p.box).map(p => p.part.partId))].sort() };
  const boundsPoints = known.flatMap(({ part, box }) => box ? [box.min, box.max] : [ldrawToInternalLdu(part.positionLdu)]);
  const hasInline = model.submodels.some(submodel => submodel.primitives.length > 0);
  const bounds: ReferenceBounds | null = boundsPoints.length ? {
    min: internalLduToDisplay(Object.fromEntries(axes.map(axis => [axis, Math.min(...boundsPoints.map(p => p[axis]))])) as unknown as ReferenceVector),
    max: internalLduToDisplay(Object.fromEntries(axes.map(axis => [axis, Math.max(...boundsPoints.map(p => p[axis]))])) as unknown as ReferenceVector),
    exact: false,
    method: knownGeometryParts === model.parts.length ? 'catalog-envelope' : knownGeometryParts ? 'catalog-and-placement-bounds' : 'placement-bounds',
  } : null;
  const boundsConfidence = hasInline ? 0.15 : knownGeometryParts === model.parts.length && model.parts.length ? 0.8 : Math.min(0.35, 0.1 + coverage.geometryRate * 0.25);
  const boundsEvidence = coverage.geometryRate < 1 ? `Known native geometry ${knownGeometryParts}/${model.parts.length}; unresolved parts contribute placement points only, not their dimensions. Bounds are not exact.` : 'Verified native-origin catalog body envelopes; not an exact surface mesh; projecting studs and manufacturing details are excluded.';
  const dimension = (axis: 'x' | 'y' | 'z', unit: Measurement['unit']): Measurement => bounds ? metric(bounds.max[axis] - bounds.min[axis], unit, boundsConfidence, boundsEvidence) : unknown('No supported part or placement bounds.', unit);
  const wheelParts = known.filter(({ part }) => part.partId === '18977');
  const wheels = wheelParts.length ? wheelParts : known.filter(({ part }) => part.partId === '66727');
  const wheelData = wheels.flatMap(({ part, box }) => {
    const adapter = referenceCatalogAdapter(part.partId), t = referencePartWorldTransform(part);
    if (!adapter || !t || !box || !isOrthogonalAxisMatrix(t.matrix)) return [];
    const shape = adapter.definition.shape!, axis = transformVector(t.matrix, { x: 1, y: 0, z: 0 });
    if (Math.abs(axis[transverseAxis]) < 0.999) return [];
    return [{ center: internalLduToDisplay(transformPoint(t, scale(shape.center ?? { x: 0, y: 0, z: 0 }))), diameter: shape.radius! * 2, width: shape.width!, box }];
  });
  const axlePositions = [...new Set(wheelData.map(wheel => Math.round(wheel.center[longitudinalAxis] * 1000) / 1000))].sort((a, b) => a - b);
  const hasAxles = axlePositions.length >= 2;
  const wheelConfidence = wheelData.length ? 0.8 : 0;
  const wheelEvidence = wheelData.length ? `${wheelData.length} catalog ${wheelParts.length ? 'tyres' : 'rims (tyres unresolved)'} with orthogonal transverse axes; vehicle axes are an explicit analysis assumption.` : 'No known wheel geometry with a transverse orthogonal axle; unknown wheel-like names do not establish dimensions.';
  const wheelbase = hasAxles ? metric(axlePositions.at(-1)! - axlePositions[0], 'stud', 0.8, wheelEvidence) : unknown('Fewer than two distinct verified axle positions.');
  const overhang = (front: boolean): Measurement => {
    if (!hasAxles || !bounds || !options.frontDirection) return unknown('Front direction and two verified axle positions are required.');
    const positive = (options.frontDirection === 1) === front;
    return metric(positive ? bounds.max[longitudinalAxis] - axlePositions.at(-1)! : axlePositions[0] - bounds.min[longitudinalAxis], 'stud', boundsConfidence, boundsEvidence, 'Front direction explicitly supplied by caller.');
  };
  const bodyBoxes = known.filter(({ part, box }) => box && !['Wheel', 'Tyre'].includes(getSpeedPartDefinition(part.partId)?.category ?? '')).map(p => p.box!);
  const groundClearance = wheelData.length && bodyBoxes.length ? metric((Math.min(...bodyBoxes.map(box => box.min.z)) - Math.min(...wheelData.map(wheel => wheel.box.min.z))) / 8, 'plate', Math.min(boundsConfidence, 0.7), 'Nominal lowest known body envelope above lowest known tyre/rim; not a physical ground-contact simulation.', boundsEvidence) : unknown('Known tyre/rim ground envelope and known body geometry are required.', 'plate');
  const partCounts = new Map<string, number>();
  for (const part of model.parts) partCounts.set(part.partId, (partCounts.get(part.partId) ?? 0) + 1);
  const countCategory = (categories: string[]) => model.parts.filter(part => categories.includes(getSpeedPartDefinition(part.partId)?.category ?? '')).length;
  const edges = deriveReferenceConnections(model.parts), byId = new Map(model.parts.map(part => [part.instanceId, part]));
  const assessedParts = model.parts.filter(part => referencePartConnectionPoints(part).length).length;
  const connectorEvidence = `Only ${assessedParts}/${model.parts.length} parts have legacy hand-authored connector estimates and proper orthogonal transforms; these are not source-verified native connectors or assembly evidence.`;
  const semanticUnknown = 'Automatic semantic module boundaries are unconfirmed; supply reviewed module classification before deriving this measure.';
  const commonUnknown = unknown(semanticUnknown);
  return {
    sourceGovernance: { status: 'LEGACY_UNVERIFIED', geometrySource: 'legacy-parametric-catalog', connectionSource: 'legacy-hand-authored', nativeAdmissionAllowed: false, revalidationRequired: true },
    referenceId: model.id, metadata: model.metadata, coordinateSystem: 'C:(LDraw x,y,z)→(x,z,-y); internal x/y studs, z plates; matrix calculations use isotropic LDU.', longitudinalAxis, frontDirection: options.frontDirection ?? null, bounds, coverage,
    overall: { width: dimension(transverseAxis, 'stud'), length: dimension(longitudinalAxis, 'stud'), height: dimension('z', 'plate'), wheelbase, frontOverhang: overhang(true), rearOverhang: overhang(false), groundClearance },
    wheels: { diameter: wheelData.length ? metric(Math.max(...wheelData.map(w => w.diameter)), 'stud', wheelConfidence, wheelEvidence) : unknown(wheelEvidence), width: wheelData.length ? metric(Math.max(...wheelData.map(w => w.width)), 'stud', wheelConfidence, wheelEvidence) : unknown(wheelEvidence), trackWidth: wheelData.length >= 2 && wheelData.some(a => wheelData.some(b => Math.abs(a.center[longitudinalAxis] - b.center[longitudinalAxis]) < 0.001 && Math.abs(a.center[transverseAxis] - b.center[transverseAxis]) > 0.001)) ? metric(Math.max(...wheelData.map(w => w.center[transverseAxis])) - Math.min(...wheelData.map(w => w.center[transverseAxis])), 'stud', wheelConfidence, 'Transverse centre-to-centre span of verified wheels.') : unknown('A left/right wheel pair on a shared axle is required.'), axlePositions: metric(axlePositions.length ? axlePositions : null, 'stud', wheelConfidence, wheelEvidence), count: wheels.length, evidence: [wheelEvidence] },
    cockpit: { start: commonUnknown, end: commonUnknown, height: unknown(semanticUnknown, 'plate'), roofHeight: unknown(semanticUnknown, 'plate') },
    shape: { hoodLength: commonUnknown, hoodHeight: unknown(semanticUnknown, 'plate'), roofline: metric<number[]>(null, 'plate', 0, semanticUnknown), rearDeck: commonUnknown, frontSlope: unknown(semanticUnknown, 'degree'), rearSlope: unknown(semanticUnknown, 'degree') },
    partUsage: { total: model.parts.length, mostUsed: [...partCounts].map(([partId, quantity]) => ({ partId, quantity, category: getSpeedPartDefinition(partId)?.category ?? null })).sort((a, b) => b.quantity - a.quantity || a.partId.localeCompare(b.partId)), curvedParts: countCategory(['CurvedSlope', 'CurvedTile']), snotParts: countCategory(['Bracket', 'ModifiedBrick', 'ModifiedPlate']), brackets: countCategory(['Bracket']), wedges: countCategory(['Wedge', 'Wing']), wheelArches: countCategory(['WheelArch', 'Mudguard']), unknownParts: model.parts.filter(part => !getSpeedPartDefinition(part.partId)).length },
    connections: { edges, assessedParts, unassessedParts: model.parts.length - assessedParts, reinforcementPatterns: unknown('Connector topology alone does not establish reinforcement strength.', 'count'), crossLayerConnections: assessedParts ? metric(edges.filter(edge => Math.abs(byId.get(edge.partA)!.position.z - byId.get(edge.partB)!.position.z) > 0.001).length, 'count', 0.7, connectorEvidence, 'Edges between different native part-origin heights.') : unknown(connectorEvidence, 'count'), snotConnections: assessedParts ? metric(edges.filter(edge => edge.connectionType === 'side-stud').length, 'count', 0.8, connectorEvidence) : unknown(connectorEvidence, 'count'), wheelMounting: assessedParts ? metric(edges.filter(edge => edge.connectionType === 'wheel-axle').length, 'count', 0.8, connectorEvidence) : unknown(connectorEvidence, 'count'), roofAttachment: unknown(semanticUnknown, 'count'), frontRearAttachment: unknown(semanticUnknown, 'count'), evidence: [connectorEvidence] },
    warnings: [...model.warnings, 'LEGACY_UNVERIFIED: catalog-derived dimensions and connections are reference estimates; they cannot authorize native geometry, connection rules or generation.', 'Automotive semantics are not inferred from the requested vehicle name; unknown measurements remain null.', ...(coverage.geometryRate < 1 ? ['Incomplete geometry: dimensions are placement/catalog bounds, not exact model measurements.'] : [])],
  };
}

export class AutomotiveReferenceAnalyzer { analyze(model: ReferenceVehicleModel, options?: Parameters<typeof analyzeReferenceModel>[1]): ReferenceAnalysis { return analyzeReferenceModel(model, options); } }
