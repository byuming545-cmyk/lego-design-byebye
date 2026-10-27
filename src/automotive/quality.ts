import { getSpeedPartDefinition } from '../speed/catalog.js';
import { deriveConnections, graphComponents } from '../speed/connections.js';
import { partBoundsLdu, SPEED_EPSILON, worldPrimitives } from '../speed/geometry.js';
import { packCandidateSteps, unpackCandidateSteps } from '../speed/stepCodec.js';
import { SpeedCollisionValidator, SpeedConnectionValidator, SpeedInventoryValidator, StructuralValidator, validationResult, WheelValidator } from '../speed/validators.js';
import type { SpeedBuildStep, SpeedInventory, SpeedPlacedPart, VehicleCandidate, VehicleModel, VehicleValidation } from '../speed/types.js';
import type { VehicleClass, VehicleDesignBrief } from './research/types.js';
import type { ReferenceAnalysis } from './references/types.js';

export interface AutomotiveDesignMeasurements {
  widthStuds: number;
  lengthStuds: number;
  heightPlates: number;
  wheelbaseStuds: number;
  trackStuds: number;
  wheelDiameterStuds: number;
  wheelCount: number;
  tyreCount: number;
  rectangularWheelLayout: number;
  frontOverhangStuds: number;
  rearOverhangStuds: number;
  hoodLengthStuds: number;
  hoodHeightPlates: number;
  cockpitStartStuds: number;
  cockpitLengthStuds: number;
  cockpitWidthStuds: number;
  cockpitHeightPlates: number;
  roofLengthStuds: number;
  roofStartStuds: number;
  roofHeightPlates: number;
  rearHeightPlates: number;
  leftRightSymmetry: number;
  smoothBodyPartRatio: number;
  longitudinalBodyCoverage: number;
  presentModules: string[];
}

export interface AutomotiveQualityMetric {
  id: string;
  label: string;
  value: number;
  target: number | [number, number];
  unit: 'ratio' | 'stud' | 'plate' | 'count';
  score: number;
  weight: number;
  confidence: number;
  evidence: string;
}

export interface AutomotiveQualityScore {
  score: number;
  method: 'geometric-heuristic';
  basis: 'engineering-class-priors' | 'catalog-construction-heuristic' | 'design-brief' | 'reference-analysis';
  metrics: AutomotiveQualityMetric[];
  explanation: string;
  warnings: string[];
}

export interface AutomotiveQualityThresholds {
  minAutomotiveDesignScore: number;
  minLegoStyleScore: number;
  minReferenceSimilarityScore: number;
  minOverallScore: number;
  maxCandidates: number;
}
export const DEFAULT_AUTOMOTIVE_QUALITY_THRESHOLDS: Readonly<AutomotiveQualityThresholds> = Object.freeze({ minAutomotiveDesignScore: 64, minLegoStyleScore: 64, minReferenceSimilarityScore: 60, minOverallScore: 67, maxCandidates: 3 });
export interface AutomotiveRankingWeights { automotiveDesign: number; legoStyle: number; referenceSimilarity: number; structure: number; buildability: number }
export interface AutomotiveRankingOptions extends Partial<AutomotiveQualityThresholds> {
  /** Nonnegative weights are normalized; all physical and minimum design gates still apply. */
  weights?: Partial<AutomotiveRankingWeights>;
  /** Required for publication/export; buildStep annotations alone do not prove an instruction plan exists. */
  steps?: readonly SpeedBuildStep[];
}
export const DEFAULT_AUTOMOTIVE_RANKING_WEIGHTS: Readonly<AutomotiveRankingWeights> = Object.freeze({ automotiveDesign: 0.2, legoStyle: 0.2, referenceSimilarity: 0.35, structure: 0.2, buildability: 0.05 });
export interface AutomotiveInstructionAssessment {
  status: 'unassessed' | 'passed' | 'failed';
  score: number | null;
  errors: string[];
  assessedSteps: number;
  explanation: string;
}

export interface AutomotiveDesignValidation {
  valid: boolean;
  status: 'accepted' | 'rejected';
  physicalValid: boolean;
  designAccepted: boolean;
  /** Recomputed from catalog geometry and actual inventory; submitted candidate reports are ignored. */
  physical: VehicleValidation;
  hardErrors: string[];
  designErrors: string[];
  warnings: string[];
  automotiveDesignScore: AutomotiveQualityScore;
  legoStyleScore: AutomotiveQualityScore;
  referenceSimilarityScore: AutomotiveQualityScore;
  scores: AutomotiveRankingWeights;
  weights: AutomotiveRankingWeights;
  buildabilityExplanation: string;
  instructions: AutomotiveInstructionAssessment;
  overallScore: number;
  measurements: AutomotiveDesignMeasurements;
}

export interface RankedAutomotiveCandidate extends VehicleCandidate {
  designValidation: AutomotiveDesignValidation;
  qualityScore: number;
}
export interface AutomotiveCandidateRejection {
  candidateId: string;
  hardErrors: string[];
  designErrors: string[];
  designValidation: AutomotiveDesignValidation;
}
export interface AutomotiveCandidateAssessment {
  candidateId: string;
  /** Rank among every candidate that passed all gates, including candidates outside the output limit. */
  rank: number | null;
  designValidation: AutomotiveDesignValidation;
}
export interface AutomotiveRankingResult {
  status: 'accepted' | 'rejected';
  candidates: RankedAutomotiveCandidate[];
  rejections: AutomotiveCandidateRejection[];
  assessments: AutomotiveCandidateAssessment[];
  message: string;
}

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
const ratio = (numerator: number, denominator: number) => denominator > 0 ? numerator / denominator : 0;
const rounded = (value: number) => Math.round(value * 100) / 100;
const validPose = (part: SpeedPlacedPart) => (['x', 'y', 'z'] as const).every(axis => Number.isFinite(part.position?.[axis]) && [0, 90, 180, 270].includes(part.orientation?.[axis]));
const catalogCategory = (part: SpeedPlacedPart) => getSpeedPartDefinition(part.partId)?.category;

interface Bounds { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number }
function bounds(parts: readonly SpeedPlacedPart[]): Bounds {
  const boxes = parts.filter(validPose).map(partBoundsLdu);
  if (!boxes.length) return { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };
  return { minX: Math.min(...boxes.map(b => b.min.x)) / 20, maxX: Math.max(...boxes.map(b => b.max.x)) / 20, minY: Math.min(...boxes.map(b => b.min.y)) / 20, maxY: Math.max(...boxes.map(b => b.max.y)) / 20, minZ: Math.min(...boxes.map(b => b.min.z)) / 8, maxZ: Math.max(...boxes.map(b => b.max.z)) / 8 };
}

/** Measurements use assembled catalog envelopes, never the model's self-reported parameters. */
export function measureAutomotiveDesign(model: VehicleModel): AutomotiveDesignMeasurements {
  const safe = model.parts.filter(validPose), full = bounds(safe);
  const body = safe.filter(part => !['Wheel', 'Tyre', 'WheelHolder'].includes(catalogCategory(part) ?? '') && !['leftWheelModule', 'rightWheelModule'].includes(part.moduleId));
  const hood = bounds(body.filter(p => p.moduleId === 'front'));
  const cabin = bounds(body.filter(p => p.moduleId === 'cockpit'));
  const roof = bounds(body.filter(p => p.moduleId === 'roof'));
  const rear = bounds(body.filter(p => p.moduleId === 'rear'));
  const tyreCylinders = safe.filter(p => catalogCategory(p) === 'Tyre').flatMap(worldPrimitives).filter(shape => shape.kind === 'cylinder');
  const stations = tyreCylinders.map(shape => shape.center.y / 20), tracks = tyreCylinders.map(shape => shape.center.x / 20);
  const unique = (values: number[]) => [...new Set(values.map(value => Math.round(value * 1000) / 1000))];
  const wheelRectangle = tyreCylinders.length === 4 && unique(tracks).length === 2 && unique(stations).length === 2 && unique(tyreCylinders.map(shape => shape.center.z)).length === 1 && tyreCylinders.every(shape => shape.axis === 'x') && new Set(tyreCylinders.map(shape => `${rounded(shape.center.x)}:${rounded(shape.center.y)}`)).size === 4;
  const width = full.maxX - full.minX, length = full.maxY - full.minY;
  const bodyBoxes = body.map(part => ({ part, box: bounds([part]) }));
  // Mirror the occupied one-stud envelope cells. This is envelope symmetry,
  // not a rendered-image assessment or a claim about curved surface continuity.
  const occupied = new Set<string>();
  const gridWidth = Math.max(1, Math.min(128, Math.ceil(width))), gridLength = Math.max(1, Math.min(256, Math.ceil(length)));
  for (let x = 0; x < gridWidth; x++) for (let y = 0; y < gridLength; y++) {
    const px = full.minX + (x + 0.5) * width / gridWidth, py = full.minY + (y + 0.5) * length / gridLength;
    const top = bodyBoxes.filter(({ box }) => px >= box.minX && px < box.maxX && py >= box.minY && py < box.maxY).reduce((maximum, { box }) => Math.max(maximum, box.maxZ), 0);
    if (top > 0) occupied.add(`${x}:${y}:${Math.round(top)}`);
  }
  let mirrored = 0;
  for (const key of occupied) {
    const [x, y, z] = key.split(':').map(Number);
    if (occupied.has(`${gridWidth - 1 - x}:${y}:${z}`)) mirrored++;
  }
  const smoothCategories = new Set(['Tile', 'CurvedTile', 'Slope', 'CurvedSlope', 'Wedge', 'Windscreen', 'Grille', 'Panel']);
  const finishParts = body.filter(part => part.moduleId !== 'chassis');
  const longitudinalBins = gridLength;
  let coveredBins = 0;
  for (let y = 0; y < longitudinalBins; y++) {
    const py = full.minY + (y + 0.5) * length / longitudinalBins;
    if (bodyBoxes.some(({ part, box }) => part.moduleId !== 'chassis' && py >= box.minY && py < box.maxY)) coveredBins++;
  }
  return {
    widthStuds: width, lengthStuds: length, heightPlates: full.maxZ - full.minZ,
    wheelbaseStuds: stations.length ? Math.max(...stations) - Math.min(...stations) : 0,
    trackStuds: tracks.length ? Math.max(...tracks) - Math.min(...tracks) : 0,
    wheelDiameterStuds: tyreCylinders.length ? tyreCylinders.reduce((sum, shape) => sum + shape.radius / 10, 0) / tyreCylinders.length : 0,
    wheelCount: safe.filter(part => catalogCategory(part) === 'Wheel').length,
    tyreCount: tyreCylinders.length, rectangularWheelLayout: wheelRectangle ? 1 : 0,
    frontOverhangStuds: stations.length ? Math.min(...stations) - full.minY : 0,
    rearOverhangStuds: stations.length ? full.maxY - Math.max(...stations) : 0,
    hoodLengthStuds: hood.maxY - hood.minY, hoodHeightPlates: hood.maxZ - full.minZ,
    cockpitStartStuds: cabin.maxY > cabin.minY ? cabin.minY - full.minY : 0,
    cockpitLengthStuds: cabin.maxY - cabin.minY, cockpitWidthStuds: cabin.maxX - cabin.minX,
    cockpitHeightPlates: cabin.maxZ - full.minZ,
    roofLengthStuds: roof.maxY - roof.minY, roofStartStuds: roof.maxY > roof.minY ? roof.minY - full.minY : 0,
    roofHeightPlates: roof.maxZ - full.minZ, rearHeightPlates: rear.maxZ - full.minZ,
    leftRightSymmetry: ratio(mirrored, occupied.size), smoothBodyPartRatio: ratio(finishParts.filter(p => smoothCategories.has(catalogCategory(p) ?? '')).length, finishParts.length),
    longitudinalBodyCoverage: coveredBins / longitudinalBins,
    presentModules: [...new Set(safe.map(p => p.moduleId))],
  };
}

interface ClassPrior { lengthWidth: [number, number]; heightWidth: [number, number]; hood: [number, number]; cabin: [number, number]; roof: [number, number] }
/** Broad engineering proportions; these are neither manufacturer facts nor vehicle templates. */
const CLASS_PRIORS: Record<VehicleClass, ClassPrior> = {
  'luxury-sedan': { lengthWidth: [2.65, 3.4], heightWidth: [0.65, 0.95], hood: [0.2, 0.37], cabin: [0.35, 0.58], roof: [0.28, 0.52] },
  'performance-coupe': { lengthWidth: [2.3, 3], heightWidth: [0.5, 0.78], hood: [0.25, 0.43], cabin: [0.28, 0.49], roof: [0.2, 0.42] },
  'sports-car': { lengthWidth: [2.05, 2.85], heightWidth: [0.43, 0.74], hood: [0.18, 0.4], cabin: [0.25, 0.5], roof: [0.18, 0.42] },
  gt: { lengthWidth: [2.35, 3.15], heightWidth: [0.5, 0.8], hood: [0.26, 0.45], cabin: [0.28, 0.5], roof: [0.22, 0.44] },
  supercar: { lengthWidth: [2.05, 2.85], heightWidth: [0.4, 0.7], hood: [0.12, 0.31], cabin: [0.24, 0.48], roof: [0.18, 0.4] },
  unknown: { lengthWidth: [2, 3.5], heightWidth: [0.4, 1], hood: [0.1, 0.45], cabin: [0.2, 0.62], roof: [0.15, 0.55] },
};

function metric(id: string, label: string, value: number, target: number | [number, number], tolerance: number, weight: number, evidence: string, unit: AutomotiveQualityMetric['unit'] = 'ratio', confidence = 1): AutomotiveQualityMetric {
  const distance = Array.isArray(target) ? value < target[0] ? target[0] - value : value > target[1] ? value - target[1] : 0 : Math.abs(value - target);
  return { id, label, value: rounded(value), target, unit, score: rounded(100 * clamp(1 - ratio(distance, Math.max(tolerance, 0.0001)))), weight, confidence, evidence };
}
function score(metrics: AutomotiveQualityMetric[], basis: AutomotiveQualityScore['basis'], explanation: string, warnings: string[] = []): AutomotiveQualityScore {
  const weight = metrics.reduce((sum, item) => sum + item.weight * item.confidence, 0);
  return { score: rounded(weight ? metrics.reduce((sum, item) => sum + item.score * item.weight * item.confidence, 0) / weight : 0), method: 'geometric-heuristic', basis, metrics, explanation, warnings };
}

/** Automotive silhouette and wheel placement, separate from LEGO construction language. */
export class AutomotiveDesignScore {
  score(model: VehicleModel, brief: VehicleDesignBrief): AutomotiveQualityScore {
    const m = measureAutomotiveDesign(model), prior = CLASS_PRIORS[brief.vehicleClass];
    const metrics = [
      metric('class-length-width', 'Class length / width', ratio(m.lengthStuds, m.widthStuds), prior.lengthWidth, 0.9, 12, `${brief.vehicleClass} engineering interval; actual catalog envelopes.`),
      metric('class-height-width', 'Class physical height / width', ratio(m.heightPlates * 0.4, m.widthStuds), prior.heightWidth, 0.35, 10, 'Plate heights converted to studs before comparing physical proportions.'),
      metric('class-hood', 'Class hood / length', ratio(m.hoodLengthStuds, m.lengthStuds), prior.hood, 0.2, 8, 'Longitudinal extent of actual front-module parts, including the bumper.'),
      metric('class-cabin', 'Class cabin / length', ratio(m.cockpitLengthStuds, m.lengthStuds), prior.cabin, 0.22, 7, 'Actual cockpit module extent.'),
      metric('class-roof', 'Class roof / length', ratio(m.roofLengthStuds, m.lengthStuds), prior.roof, 0.22, 5, 'Actual roof module extent.'),
      metric('four-wheel-layout', 'Four wheels on a rectangular dual-axle layout', m.rectangularWheelLayout * Number(m.wheelCount === 4 && m.tyreCount === 4), 1, 1, 10, 'Four catalog wheel rims and four tyre cylinders, with two lateral centers, two axle stations, one height and transverse axes.'),
      metric('wheelbase', 'Wheelbase / length', ratio(m.wheelbaseStuds, m.lengthStuds), [0.5, 0.7], 0.25, 7, 'Derived from actual tyre cylinder centers.'),
      metric('track-width', 'Track / width', ratio(m.trackStuds, m.widthStuds), [0.64, 0.9], 0.28, 5, 'Derived from actual tyre cylinder centers and overall width.'),
      metric('wheel-body-scale', 'Wheel diameter / width', ratio(m.wheelDiameterStuds, m.widthStuds), [0.24, 0.45], 0.22, 4, 'Actual catalog tyre outer diameter relative to assembled body width.'),
      metric('front-overhang', 'Front overhang / length', ratio(m.frontOverhangStuds, m.lengthStuds), [0.08, 0.23], 0.18, 5, 'Distance from the actual front envelope to the first tyre center, normalized by actual length.'),
      metric('rear-overhang', 'Rear overhang / length', ratio(m.rearOverhangStuds, m.lengthStuds), [0.1, 0.28], 0.2, 5, 'Distance from the last tyre center to the actual rear envelope, normalized by actual length.'),
      metric('cabin-rise', 'Cabin rise over hood', m.cockpitHeightPlates - m.hoodHeightPlates, [1.5, 7], 1.5, 8, 'Actual envelope height difference between cockpit and hood; a label alone cannot raise a flat body.', 'plate'),
      metric('roof-hood-rise', 'Roof rise over hood', m.roofHeightPlates - m.hoodHeightPlates, [2, 9], 2, 6, 'Actual roof top minus the front-module top, in plate units.', 'plate'),
      metric('rear-deck-drop', 'Cabin rise over rear deck', m.cockpitHeightPlates - m.rearHeightPlates, [1.5, 8], 1.5, 6, 'Actual rear deck must sit below the raised cabin envelope.', 'plate'),
      metric('roof-cabin-step', 'Roof top relative to cabin', m.roofHeightPlates - m.cockpitHeightPlates, [-1, 4], 4, 2, 'Roof and cabin envelopes form a modest top transition rather than an isolated tall tower.', 'plate'),
    ];
    return score(metrics, 'engineering-class-priors', 'Automotive form compares actual vehicle-class proportions, four-wheel placement, front/rear overhang and hood/cabin/roof/deck height changes. It is a numeric geometry heuristic, independent of paint and model identity; no rendered image or manufacturer-specific visual recognition is assessed.');
  }
}

/** LEGO surface treatment and local construction language; car proportions have a separate score. */
export class LegoStyleScore {
  score(model: VehicleModel, brief: VehicleDesignBrief): AutomotiveQualityScore {
    const m = measureAutomotiveDesign(model), parts = model.parts.filter(validPose), edges = deriveConnections(parts);
    const body = parts.filter(part => !['chassis', 'leftWheelModule', 'rightWheelModule'].includes(part.moduleId) && !['Wheel', 'Tyre', 'WheelHolder'].includes(catalogCategory(part) ?? ''));
    const shaped = body.filter(part => ['Slope', 'CurvedSlope', 'Wedge', 'CurvedTile', 'Windscreen'].includes(catalogCategory(part) ?? ''));
    const sideMounted = new Set(edges.filter(edge => edge.connectionType === 'side-stud').flatMap(edge => [edge.partA, edge.partB]).filter(id => body.some(part => part.instanceId === id)));
    const courseParts = parts.filter(part => ['Plate', 'Brick', 'ModifiedPlate', 'ModifiedBrick'].includes(catalogCategory(part) ?? ''));
    const coursesBonded = courseParts.filter(part => edges.filter(edge => edge.connectionType === 'stud' && (edge.partA === part.instanceId || edge.partB === part.instanceId)).length >= 2).length;
    const finishFamilies = new Set(body.map(catalogCategory).filter(category => ['Tile', 'CurvedTile', 'Slope', 'CurvedSlope', 'Wedge', 'Windscreen', 'Grille', 'Panel'].includes(category ?? ''))).size;
    const requiredModules = ['chassis', 'front', 'rear', 'cockpit', 'bodyShell', ...(brief.proportions.roofLengthStuds > 0 ? ['roof'] : [])];
    const metrics = [
      metric('symmetry', 'Envelope mirror symmetry', m.leftRightSymmetry, 1, 0.55, 15, 'Mirrored occupied envelope cells with matching top heights.'),
      metric('surface-finish', 'Smooth body part share', m.smoothBodyPartRatio, [0.35, 0.85], 0.4, 20, 'Catalog share of slopes, curves, windscreens, tiles, grilles and panels; not a rendered finish score.'),
      metric('body-coverage', 'Continuous body module coverage', m.longitudinalBodyCoverage, [0.8, 1], 0.5, 15, 'Occupied length bins above the chassis, independent of the class aspect ratio.'),
      metric('modules', 'Required local construction module coverage', requiredModules.filter(id => m.presentModules.includes(id)).length / requiredModules.length, 1, 0.5, 10, `Actual nonempty module occupancy: ${requiredModules.join(', ')}.`),
      metric('shaped-finish', 'Curved and sloped body part share', ratio(shaped.length, body.length), [0.05, 0.5], 0.15, 15, 'Actual catalog slopes, curved parts, wedges and windscreens used in the body.'),
      metric('side-mounted-finish', 'Real side-mounted body treatment', ratio(sideMounted.size, body.length), [0.03, 0.4], 0.15, 10, 'Unique body parts participating in rederived side-stud interfaces; declared connection metadata is not used.'),
      metric('bonded-courses', 'Plate and brick bond coverage', ratio(coursesBonded, courseParts.length), [0.7, 1], 0.7, 10, 'Fraction of catalog plate/brick courses with two or more actual stud connections. This is local bond coverage, not a load rating.'),
      metric('finish-vocabulary', 'Surface treatment families', finishFamilies, [2, 5], 3, 5, 'Count of distinct supported finishing categories used by actual body parts.', 'count'),
    ];
    return score(metrics, 'catalog-construction-heuristic', 'LEGO style compares catalog finish families, curved/sloped treatment, real side-stud construction, plate/brick bonds, symmetry and occupied local modules. Automotive proportions and reference likeness are scored separately; there is no image analysis or physical strength claim.');
  }
}

export class ReferenceSimilarityScore {
  score(model: VehicleModel, brief: VehicleDesignBrief, reference?: ReferenceAnalysis): AutomotiveQualityScore {
    const m = measureAutomotiveDesign(model), p = brief.proportions;
    const metrics = [
      metric('brief-width', 'Planned width', m.widthStuds, brief.targetWidthStuds, 2.5, 8, 'Actual overall envelope versus the selected discrete width.', 'stud'),
      metric('brief-length', 'Length / width', ratio(m.lengthStuds, m.widthStuds), ratio(p.lengthStuds, brief.targetWidthStuds), 0.85, 18, 'Geometry compared with the research-derived or explicitly estimated design brief.'),
      metric('brief-height', 'Physical height / width', ratio(m.heightPlates * 0.4, m.widthStuds), ratio(p.heightPlates * 0.4, brief.targetWidthStuds), 0.3, 12, 'Both targets and geometry use physical aspect ratio.'),
      metric('brief-wheelbase', 'Wheelbase / length', ratio(m.wheelbaseStuds, m.lengthStuds), ratio(p.wheelbaseStuds, p.lengthStuds), 0.2, 12, 'Tyre-center spacing compared with the design brief.'),
      metric('brief-wheel-diameter', 'Wheel diameter / width', ratio(m.wheelDiameterStuds, m.widthStuds), ratio(p.wheelDiameterStuds, brief.targetWidthStuds), 0.18, 5, 'Actual catalog tyre cylinder diameter.'),
      metric('brief-hood', 'Hood / length', ratio(m.hoodLengthStuds, m.lengthStuds), ratio(p.hoodLengthStuds, p.lengthStuds), 0.2, 12, 'Front-module envelope including bumper, compared with planned hood extent.'),
      metric('brief-cabin-start', 'Cabin start / length', ratio(m.cockpitStartStuds, m.lengthStuds), ratio(p.cockpitStartStuds, p.lengthStuds), 0.2, 10, 'Actual cabin leading edge relative to actual front envelope.'),
      metric('brief-cabin-length', 'Cabin / length', ratio(m.cockpitLengthStuds, m.lengthStuds), ratio(p.cockpitLengthStuds, p.lengthStuds), 0.22, 9, 'Actual cockpit geometry compared with planned cabin extent.'),
      metric('brief-roof-length', 'Roof / length', ratio(m.roofLengthStuds, m.lengthStuds), ratio(p.roofLengthStuds, p.lengthStuds), 0.2, 8, 'Actual roof geometry compared with planned roof extent.'),
      metric('brief-cabin-width', 'Cabin / body width', ratio(m.cockpitWidthStuds, m.widthStuds), ratio(brief.modules.cockpit.widthStuds, brief.targetWidthStuds), 0.35, 6, 'Actual cockpit envelope compared with the discrete cockpit module target.'),
    ];
    const warnings = ['Reference image links are not analyzed; this score does not measure visual resemblance.'];
    if (brief.dimensionBasis !== 'source-backed') warnings.push('Some proportion targets are explicit engineering assumptions, not verified vehicle measurements.');
    if (reference) {
      const w = reference.overall.width, l = reference.overall.length, h = reference.overall.height;
      const referenceRatio = (id: string, label: string, actual: number, a: typeof w, b: typeof w, tolerance: number, weight: number, height = false) => {
        if (a.value === null || b.value === null || !Number.isFinite(a.value) || !Number.isFinite(b.value) || b.value <= 0) return;
        const confidence = clamp(Math.min(a.confidence, b.confidence));
        if (confidence <= 0) return;
        const normalized = a.value * (height && a.unit === 'plate' ? 0.4 : 1) / b.value;
        metrics.push(metric(id, label, actual, normalized, tolerance, weight, `Reference ${reference.referenceId}; ${[...a.evidence, ...b.evidence].join(' ')}`, 'ratio', confidence));
      };
      referenceRatio('reference-length', 'Reference length / width', ratio(m.lengthStuds, m.widthStuds), l, w, 0.85, 10);
      referenceRatio('reference-height', 'Reference physical height / width', ratio(m.heightPlates * 0.4, m.widthStuds), h, w, 0.3, 8, true);
      referenceRatio('reference-wheelbase', 'Reference wheelbase / length', ratio(m.wheelbaseStuds, m.lengthStuds), reference.overall.wheelbase, l, 0.2, 8);
      referenceRatio('reference-hood', 'Reference hood / length', ratio(m.hoodLengthStuds, m.lengthStuds), reference.shape.hoodLength, l, 0.2, 7);
      if (reference.coverage.geometryRate < 1) warnings.push('Reference geometry is incomplete; confidence weights apply only to available numeric measurements.');
      if (!metrics.some(item => item.id.startsWith('reference-'))) warnings.push('The reference contains no usable numeric proportions; only the design brief is scored.');
    }
    const usesReference = metrics.some(item => item.id.startsWith('reference-'));
    return score(metrics, usesReference ? 'reference-analysis' : 'design-brief', 'Similarity compares measured numeric proportions and module targets. Scores are geometry heuristics; brand identity, grille graphics and reference photographs are not visually assessed.', warnings);
  }
}

function thresholds(options: AutomotiveRankingOptions = {}): AutomotiveQualityThresholds {
  const result = { ...DEFAULT_AUTOMOTIVE_QUALITY_THRESHOLDS, ...options };
  for (const field of ['minAutomotiveDesignScore', 'minLegoStyleScore', 'minReferenceSimilarityScore', 'minOverallScore'] as const) {
    if (!Number.isFinite(result[field]) || result[field] < 0 || result[field] > 100) throw new RangeError(`Invalid automotive quality threshold: ${field}.`);
    // A caller may tighten quality gates. Ranking preferences cannot disable them.
    result[field] = Math.max(DEFAULT_AUTOMOTIVE_QUALITY_THRESHOLDS[field], result[field]);
  }
  if (!Number.isSafeInteger(result.maxCandidates) || result.maxCandidates < 1 || result.maxCandidates > 20) throw new RangeError('maxCandidates must be an integer from 1 to 20.');
  return result;
}

function rankingWeights(options: AutomotiveRankingOptions): AutomotiveRankingWeights {
  const weights = { ...DEFAULT_AUTOMOTIVE_RANKING_WEIGHTS, ...options.weights };
  for (const value of Object.values(weights)) if (!Number.isFinite(value) || value < 0) throw new RangeError('Automotive ranking weights must be finite and nonnegative.');
  const sum = Object.values(weights).reduce((total, value) => total + value, 0);
  if (!Number.isFinite(sum) || sum <= 0) throw new RangeError('Automotive ranking weights must have a finite positive total.');
  return Object.fromEntries(Object.entries(weights).map(([key, value]) => [key, value / sum])) as unknown as AutomotiveRankingWeights;
}

function assessInstructions(model: VehicleModel, steps: readonly SpeedBuildStep[] | undefined, physical: VehicleValidation): AutomotiveInstructionAssessment {
  const explanation = 'Instruction rule compliance checks complete part picking, subassembly attachment, final coverage, canonical part poses and real connection continuity at every step. It does not assess insertion access, hand clearance or physical assembly difficulty.';
  if (!steps?.length) return { status: 'unassessed', score: null, errors: ['No instruction plan was supplied; buildStep annotations alone are not an assessment.'], assessedSteps: 0, explanation };
  if (!physical.valid) return { status: 'failed', score: 0, errors: ['Instruction assessment requires passing independent physical validation.'], assessedSteps: 0, explanation };
  try {
    // Reuse the bounded codec's exact picking / state / subassembly / buildStep
    // checks. It is a format check; real connectivity is checked independently below.
    const canonical = unpackCandidateSteps(packCandidateSteps({ model, validation: physical, steps: [...steps] }));
    const byId = new Map(model.parts.map(part => [part.instanceId, part])), edges = deriveConnections(model.parts);
    const errors: string[] = [];
    const poseKey = (part: SpeedPlacedPart) => JSON.stringify([part.partId, part.category, part.color, part.dimensions, part.position, part.orientation, part.moduleId, part.connectionPoints, part.buildStep]);
    for (const [index, step] of steps.entries()) {
      // A full legacy snapshot must describe the same assembly as the canonical
      // model. Active-connection lists are subset-specific and checked by geometry.
      for (const part of [...step.addedParts, ...step.totalModelState]) {
        const original = byId.get(part.instanceId);
        if (!original || poseKey(part) !== poseKey(original)) errors.push(`Instruction step ${index + 1} contains a part pose or catalog identity inconsistent with the model.`);
      }
      const state = canonical.steps[index].totalModelState, ids = new Set(state.map(part => part.instanceId));
      if (graphComponents(state, edges.filter(edge => ids.has(edge.partA) && ids.has(edge.partB))).length !== 1) errors.push(`Instruction step ${index + 1} contains parts without a continuous real connection graph.`);
    }
    return { status: errors.length ? 'failed' : 'passed', score: errors.length ? 0 : 100, errors: [...new Set(errors)], assessedSteps: steps.length, explanation };
  } catch {
    return { status: 'failed', score: 0, errors: ['Instruction steps do not form a complete, bounded, internally consistent build sequence.'], assessedSteps: 0, explanation };
  }
}

/** Independent physics gate, including wheel assemblies, at 8/10/12-stud design scales. */
export function validateAutomotivePhysics(model: VehicleModel, inventory: SpeedInventory, brief: VehicleDesignBrief): VehicleValidation {
  const connection = new SpeedConnectionValidator().validate(model);
  if (!model.parts.every(validPose)) {
    const invalid = validationResult(['Invalid part pose; stopped before geometry evaluation.']);
    return { ...invalid, connection, inventory: invalid, collision: invalid, wheels: { ...invalid, wheelCount: 0, groundedWheels: 0, axleConnections: 0, rotationalClearance: false, collisions: [] }, structure: { ...invalid, structuralScore: 0, moduleScores: [] } };
  }
  const checkedInventory = new SpeedInventoryValidator().validate(model, inventory);
  const collision = new SpeedCollisionValidator().validate(model);
  const wheels = new WheelValidator().validate(model, { trackStuds: { min: Math.max(4.5, brief.targetWidthStuds * 0.5), max: brief.targetWidthStuds + 0.5 }, wheelbaseStuds: { min: 6, max: 40 } });
  const structure = new StructuralValidator().validate(model);
  const results = [connection, checkedInventory, collision, wheels, structure];
  const errors = results.flatMap(result => result.errors);
  if (![8, 10, 12].includes(brief.targetWidthStuds)) errors.push('Automotive design width must be 8, 10 or 12 studs.');
  if (!Number.isFinite(model.parameters.width) || Math.abs(model.parameters.width - brief.targetWidthStuds) > SPEED_EPSILON) errors.push('Model width parameter does not match the selected automotive design width.');
  return { ...validationResult(errors, results.flatMap(result => result.warnings)), connection, inventory: checkedInventory, collision, wheels, structure };
}

export class AutomotiveDesignValidator {
  validate(model: VehicleModel, inventory: SpeedInventory, brief: VehicleDesignBrief, reference?: ReferenceAnalysis, options: AutomotiveRankingOptions = {}): AutomotiveDesignValidation {
    const minimum = thresholds(options), physical = validateAutomotivePhysics(model, inventory, brief);
    const measurements = measureAutomotiveDesign(model), automotiveDesignScore = new AutomotiveDesignScore().score(model, brief), legoStyleScore = new LegoStyleScore().score(model, brief), referenceSimilarityScore = new ReferenceSimilarityScore().score(model, brief, reference);
    const instructions = assessInstructions(model, options.steps, physical);
    const weights = rankingWeights(options), scores: AutomotiveRankingWeights = { automotiveDesign: automotiveDesignScore.score, legoStyle: legoStyleScore.score, referenceSimilarity: referenceSimilarityScore.score, structure: physical.structure.structuralScore, buildability: instructions.score ?? 0 };
    const overallScore = rounded((Object.keys(weights) as (keyof AutomotiveRankingWeights)[]).reduce((sum, key) => sum + weights[key] * scores[key], 0));
    const designErrors: string[] = [];
    if (automotiveDesignScore.score < minimum.minAutomotiveDesignScore) designErrors.push(`Automotive form geometry score ${automotiveDesignScore.score} is below ${minimum.minAutomotiveDesignScore}.`);
    if (legoStyleScore.score < minimum.minLegoStyleScore) designErrors.push(`LEGO style geometry score ${legoStyleScore.score} is below ${minimum.minLegoStyleScore}.`);
    if (referenceSimilarityScore.score < minimum.minReferenceSimilarityScore) designErrors.push(`Reference proportion score ${referenceSimilarityScore.score} is below ${minimum.minReferenceSimilarityScore}.`);
    if (overallScore < minimum.minOverallScore) designErrors.push(`Combined design quality ${overallScore} is below ${minimum.minOverallScore}.`);
    if (measurements.cockpitLengthStuds <= 0 || measurements.cockpitHeightPlates - measurements.hoodHeightPlates < 1 - SPEED_EPSILON) designErrors.push('The assembled silhouette lacks a distinct raised cabin above the hood.');
    if (brief.proportions.roofLengthStuds > 0 && measurements.roofLengthStuds <= 0) designErrors.push('The planned roof is missing from the assembled model.');
    if (measurements.roofLengthStuds > 0 && (measurements.roofStartStuds + measurements.roofLengthStuds < measurements.cockpitStartStuds || measurements.roofStartStuds > measurements.cockpitStartStuds + measurements.cockpitLengthStuds)) designErrors.push('The roof does not overlap the assembled cabin.');
    if (measurements.leftRightSymmetry < 0.6) designErrors.push('The body envelope has excessive left/right asymmetry.');
    if (measurements.longitudinalBodyCoverage < 0.6) designErrors.push('The assembled body leaves excessive open length above the chassis.');
    if (instructions.status !== 'passed') designErrors.push(...instructions.errors);
    const designAccepted = designErrors.length === 0, valid = physical.valid && designAccepted;
    return { valid, status: valid ? 'accepted' : 'rejected', physicalValid: physical.valid, designAccepted, physical, hardErrors: [...physical.errors], designErrors, warnings: [...new Set([...physical.warnings, ...automotiveDesignScore.warnings, ...legoStyleScore.warnings, ...referenceSimilarityScore.warnings])], automotiveDesignScore, legoStyleScore, referenceSimilarityScore, scores, weights, instructions, buildabilityExplanation: instructions.explanation, overallScore, measurements };
  }
}

export class Ranking {
  rank(candidates: readonly VehicleCandidate[], inventory: SpeedInventory, brief: VehicleDesignBrief, reference?: ReferenceAnalysis, options: AutomotiveRankingOptions = {}): AutomotiveRankingResult {
    const minimum = thresholds(options), accepted: RankedAutomotiveCandidate[] = [], rejections: AutomotiveCandidateRejection[] = [];
    rankingWeights(options);
    for (const candidate of candidates) {
      const designValidation = new AutomotiveDesignValidator().validate(candidate.model, inventory, brief, reference, { ...minimum, weights: options.weights, steps: candidate.steps });
      if (!designValidation.valid) rejections.push({ candidateId: candidate.model.id, hardErrors: designValidation.hardErrors, designErrors: designValidation.designErrors, designValidation });
      else accepted.push({ ...candidate, validation: designValidation.physical, designValidation, qualityScore: designValidation.overallScore });
    }
    accepted.sort((a, b) => b.qualityScore - a.qualityScore || a.model.id.localeCompare(b.model.id));
    const assessments: AutomotiveCandidateAssessment[] = [
      ...accepted.map((candidate, index) => ({ candidateId: candidate.model.id, rank: index + 1, designValidation: candidate.designValidation })),
      ...rejections.map(candidate => ({ candidateId: candidate.candidateId, rank: null, designValidation: candidate.designValidation })),
    ];
    return { status: accepted.length ? 'accepted' : 'rejected', candidates: accepted.slice(0, minimum.maxCandidates), rejections, assessments, message: accepted.length ? `${accepted.length} candidate${accepted.length === 1 ? '' : 's'} met design quality and physical validation thresholds.` : 'No candidate met design quality threshold.' };
  }
}
