import { beforeAll, describe, expect, it } from 'vitest';
import { AutomotiveDesignScore, AutomotiveDesignValidator, LegoStyleScore, measureAutomotiveDesign, Ranking, ReferenceSimilarityScore, validateAutomotivePhysics } from '../src/automotive/quality.js';
import type { ReferenceAnalysis, Measurement } from '../src/automotive/references/types.js';
import type { AutomotiveModuleId, VehicleClass, VehicleDesignBrief } from '../src/automotive/research/types.js';
import { applyVehicleConnections } from '../src/speed/connections.js';
import { SPEED_PART_CATALOG } from '../src/speed/catalog.js';
import { generateVehicleModel } from '../src/speed/generator.js';
import { vehicleDimensions } from '../src/speed/geometry.js';
import { analyzeSpeedInventories, createSpeedDemoInventory } from '../src/speed/inventory.js';
import { buildVehicleSteps } from '../src/speed/steps.js';
import { packCandidateSteps, unpackCandidateSteps } from '../src/speed/stepCodec.js';
import type { SpeedInventory, VehicleCandidate, VehicleModel } from '../src/speed/types.js';
import { validateVehicle } from '../src/speed/validators.js';

let stock: SpeedInventory;
let baseline: VehicleModel;
let brief: VehicleDesignBrief;

function briefFor(model: VehicleModel, vehicleClass: VehicleClass = 'sports-car'): VehicleDesignBrief {
  const m = measureAutomotiveDesign(model);
  const moduleIds: AutomotiveModuleId[] = ['chassis', 'front', 'hood', 'cockpit', 'roof', 'leftSide', 'rightSide', 'rear', 'wheelModules', 'aero', 'details'];
  const modules = Object.fromEntries(moduleIds.map(id => [id, { widthStuds: id === 'cockpit' ? m.cockpitWidthStuds : m.widthStuds, lengthStuds: id === 'roof' ? m.roofLengthStuds : 4, heightPlates: 3, startStuds: id === 'roof' ? m.roofStartStuds : 0 }])) as VehicleDesignBrief['modules'];
  return { profileId: 'independent-quality-fixture', targetVehicle: 'Test vehicle', vehicleClass, targetWidthStuds: 8, widthSelection: 'user', identityPriorities: ['numeric proportions'], secondaryFeatures: [], featureTags: [], proportions: { lengthStuds: m.lengthStuds, wheelbaseStuds: m.wheelbaseStuds, heightPlates: m.heightPlates, wheelDiameterStuds: m.wheelDiameterStuds, frontOverhangStuds: 2, rearOverhangStuds: 4, cockpitStartStuds: m.cockpitStartStuds, cockpitLengthStuds: m.cockpitLengthStuds, hoodLengthStuds: m.hoodLengthStuds, roofLengthStuds: m.roofLengthStuds }, modules, dimensionBasis: 'estimated', assumptions: [{ field: 'fixture', reason: 'Explicit engineering test fixture; not manufacturer research.', sourceIds: [] }], sourceIds: [], warnings: [], planningMethod: 'discrete-module-replanning' };
}

function candidate(model: VehicleModel): VehicleCandidate {
  const copy = structuredClone(model);
  let steps: VehicleCandidate['steps'] = [];
  try { steps = buildVehicleSteps(copy); } catch { /* Deliberately invalid candidates may have no coherent instruction sequence. */ }
  return { model: copy, validation: validateVehicle(baseline, stock), steps };
}

beforeAll(() => {
  stock = analyzeSpeedInventories([createSpeedDemoInventory()]);
  baseline = generateVehicleModel(stock, { prompt: 'Independent automotive validator fixture', vehicleType: 'sports-car', style: 'modern', minifigure: false, priority: 'structure', maximizeUsage: false });
  brief = briefFor(baseline);
});

describe('Automotive independent physical gate', () => {
  it('recomputes all five physical components for a catalog-backed assembly', () => {
    const before = structuredClone(baseline);
    const physical = validateAutomotivePhysics(baseline, stock, brief);
    expect(physical.valid).toBe(true);
    for (const name of ['inventory', 'connection', 'collision', 'wheels', 'structure'] as const) expect(physical[name].valid).toBe(true);
    expect(physical.wheels).toMatchObject({ wheelCount: 4, groundedWheels: 4, axleConnections: 4, rotationalClearance: true });
    expect(baseline).toEqual(before);
  });

  it('rejects a missing wheel despite a forged passing candidate report', () => {
    const model = structuredClone(baseline);
    model.parts = model.parts.filter(part => part.instanceId !== model.parts.find(part => part.category === 'Wheel')!.instanceId);
    applyVehicleConnections(model);
    const ranked = new Ranking().rank([candidate(model)], stock, brief, undefined, { minLegoStyleScore: 0, minReferenceSimilarityScore: 0, minOverallScore: 0 });
    expect(ranked.status).toBe('rejected');
    expect(ranked.candidates).toHaveLength(0);
    expect(ranked.rejections[0].hardErrors.length).toBeGreaterThan(0);
    expect(ranked.rejections[0].designValidation.physical.wheels.valid).toBe(false);
    expect(ranked.message).toBe('No candidate met design quality threshold.');
  });

  it('rejects a real solid collision, stale graph, inventory overrun and unsupported pose independently', () => {
    const collision = structuredClone(baseline);
    const duplicate = structuredClone(collision.parts.find(part => part.moduleId === 'front')!);
    duplicate.instanceId = 'extra-colliding-solid';
    collision.parts.push(duplicate);
    applyVehicleConnections(collision);
    expect(validateAutomotivePhysics(collision, stock, brief).collision.valid).toBe(false);
    const graph = structuredClone(baseline);
    graph.connections = [];
    expect(validateAutomotivePhysics(graph, stock, brief).connection.valid).toBe(false);
    const structure = structuredClone(baseline);
    structure.modules = structure.modules.filter(module => module.id !== 'chassis');
    expect(validateAutomotivePhysics(structure, stock, brief).structure.valid).toBe(false);
    const emptyStock = structuredClone(stock);
    emptyStock.items = [];
    expect(validateAutomotivePhysics(baseline, emptyStock, brief).inventory.valid).toBe(false);
    const pose = structuredClone(baseline);
    pose.parts[0].orientation.x = 45 as 0;
    expect(() => validateAutomotivePhysics(pose, stock, brief)).not.toThrow();
    expect(validateAutomotivePhysics(pose, stock, brief).valid).toBe(false);
  });

  it('cannot widen safe ranges by lying about the automotive width', () => {
    const wideBrief = { ...brief, targetWidthStuds: 12 };
    const checked = validateAutomotivePhysics(baseline, stock, wideBrief);
    expect(checked.valid).toBe(false);
    expect(checked.wheels.errors.join(' ')).toMatch(/轮距/);
    expect(checked.errors.join(' ')).toMatch(/selected automotive design width/);
    expect(validateAutomotivePhysics(baseline, stock, { ...brief, targetWidthStuds: 9 }).errors.join(' ')).toMatch(/8, 10 or 12/);
  });
});

describe('Automotive transparent design scoring', () => {
  it('measures geometry independently from all self-reported shape parameters', () => {
    const changed = structuredClone(baseline);
    Object.assign(changed.parameters, { length: 100, width: 12, wheelbase: 60, hoodLength: 0, cockpitPosition: -20, roofHeight: 100 });
    changed.dimensions = { x: 200, y: 200, z: 200 };
    expect(measureAutomotiveDesign(changed)).toEqual(measureAutomotiveDesign(baseline));
    expect(new LegoStyleScore().score(changed, brief).score).toBe(new LegoStyleScore().score(baseline, brief).score);
  });

  it('uses class proportions rather than a model-name special case', () => {
    const sedan = { ...brief, vehicleClass: 'luxury-sedan' as const };
    const supercar = { ...brief, vehicleClass: 'supercar' as const };
    const sedanScore = new AutomotiveDesignScore().score(baseline, sedan);
    const supercarScore = new AutomotiveDesignScore().score(baseline, supercar);
    expect(sedanScore.metrics.find(metric => metric.id === 'class-height-width')!.score).toBeGreaterThan(supercarScore.metrics.find(metric => metric.id === 'class-height-width')!.score);
    const renamed = { ...sedan, targetVehicle: 'Mercedes-AMG S63', profileId: 'mercedes-amg-s63' };
    expect(new AutomotiveDesignScore().score(baseline, renamed)).toEqual(sedanScore);
    expect(new LegoStyleScore().score(baseline, sedan)).toEqual(new LegoStyleScore().score(baseline, supercar));
  });

  it('scores actual automotive wheel placement and silhouette independently of paint or vehicle labels', () => {
    const original = new AutomotiveDesignScore().score(baseline, brief);
    const repainted = structuredClone(baseline);
    for (const part of repainted.parts) part.color = { id: 4, name: 'Red', hex: '#C91A09' };
    repainted.name = 'A visually perfect imaginary supercar';
    repainted.vehicleType = 'supercar';
    expect(new AutomotiveDesignScore().score(repainted, brief)).toEqual(original);
    const distorted = structuredClone(baseline), m = measureAutomotiveDesign(baseline);
    for (const part of distorted.parts) {
      if (['Wheel', 'Tyre'].includes(part.category)) part.position.y = m.lengthStuds / 2;
      if (part.moduleId === 'cockpit') part.position.z -= m.cockpitHeightPlates - m.hoodHeightPlates;
      if (part.moduleId === 'roof') part.position.z -= m.roofHeightPlates - m.hoodHeightPlates;
    }
    const malformed = new AutomotiveDesignScore().score(distorted, brief);
    expect(malformed.score).toBeLessThan(original.score - 20);
    for (const id of ['four-wheel-layout', 'wheelbase', 'cabin-rise', 'roof-hood-rise']) expect(malformed.metrics.find(item => item.id === id)!.score).toBe(0);
    const rejected = new AutomotiveDesignValidator().validate(distorted, stock, brief, undefined, { minAutomotiveDesignScore: 0, weights: { automotiveDesign: 0, legoStyle: 0, referenceSimilarity: 0, structure: 1, buildability: 0 } });
    expect(rejected.designErrors.join(' ')).toMatch(/Automotive form geometry score .* is below 64/);
  });

  it('distinguishes LEGO finish changes from the automotive silhouette score', () => {
    const untrimmed = structuredClone(baseline);
    for (const part of untrimmed.parts.filter(part => part.category === 'Tile' && part.moduleId !== 'chassis')) {
      const plate = Object.values(SPEED_PART_CATALOG).find(definition => definition.category === 'Plate' && definition.support === 'supported' && definition.dimensions && JSON.stringify(definition.dimensions) === JSON.stringify(part.dimensions));
      if (plate) Object.assign(part, { partId: plate.partId, name: plate.name, category: plate.category, connectionPoints: structuredClone(plate.connectionPoints) });
    }
    expect(new AutomotiveDesignScore().score(untrimmed, brief)).toEqual(new AutomotiveDesignScore().score(baseline, brief));
    expect(new LegoStyleScore().score(untrimmed, brief).score).toBeLessThan(new LegoStyleScore().score(baseline, brief).score);
    const styleMetricIds = new Set(new LegoStyleScore().score(baseline, brief).metrics.map(item => item.id));
    expect(new AutomotiveDesignScore().score(baseline, brief).metrics.every(item => !styleMetricIds.has(item.id))).toBe(true);
  });

  it('responds to target length, hood, cabin, roof and cockpit module width', () => {
    const matching = new ReferenceSimilarityScore().score(baseline, brief);
    const different = structuredClone(brief);
    different.proportions.lengthStuds *= 1.8;
    different.proportions.hoodLengthStuds = 1;
    different.proportions.cockpitStartStuds = 2;
    different.proportions.cockpitLengthStuds *= 2;
    different.proportions.roofLengthStuds *= 2;
    different.modules.cockpit.widthStuds = 8;
    const result = new ReferenceSimilarityScore().score(baseline, different);
    expect(matching.score).toBe(100);
    expect(result.score).toBeLessThan(matching.score - 20);
    for (const id of ['brief-length', 'brief-hood', 'brief-cabin-start', 'brief-roof-length', 'brief-cabin-width']) expect(result.metrics.find(item => item.id === id)!.score).toBeLessThan(100);
    expect(result.method).toBe('geometric-heuristic');
    expect(result.basis).toBe('design-brief');
    expect(result.warnings.join(' ')).toMatch(/image links are not analyzed/);
  });

  it('keeps design rejection separate from passing physical validation', () => {
    const unrealistic = structuredClone(brief);
    unrealistic.proportions.lengthStuds = 40;
    unrealistic.proportions.heightPlates = 8;
    unrealistic.proportions.hoodLengthStuds = 12;
    unrealistic.proportions.cockpitStartStuds = 12;
    unrealistic.proportions.cockpitLengthStuds = 18;
    unrealistic.proportions.roofLengthStuds = 16;
    const result = new AutomotiveDesignValidator().validate(baseline, stock, unrealistic);
    expect(result.physicalValid).toBe(true);
    expect(result.hardErrors).toEqual([]);
    expect(result.designAccepted).toBe(false);
    expect(result.designErrors.length).toBeGreaterThan(0);
    expect(result.status).toBe('rejected');
  });

  it('rejects a missing roof as design quality even with permissive numeric thresholds', () => {
    const model = structuredClone(baseline);
    for (const part of model.parts.filter(part => part.moduleId === 'roof')) part.moduleId = 'cockpit';
    model.modules = model.modules.filter(module => module.id !== 'roof');
    for (const module of model.modules) module.partIds = model.parts.filter(part => part.moduleId === module.id).map(part => part.instanceId);
    applyVehicleConnections(model);
    model.dimensions = vehicleDimensions(model.parts);
    const result = new AutomotiveDesignValidator().validate(model, stock, brief, undefined, { minLegoStyleScore: 0, minReferenceSimilarityScore: 0, minOverallScore: 0 });
    expect(result.designErrors).toContain('The planned roof is missing from the assembled model.');
    expect(result.designAccepted).toBe(false);
  });

  it('uses available reference numbers with their confidence and never invents absent measurements', () => {
    const measurement = (value: number | null, unit: Measurement['unit'] = 'stud'): Measurement => ({ value, unit, confidence: value === null ? 0 : 0.8, evidence: ['Test numeric catalog envelope'] });
    const reference = {
      referenceId: 'numeric-reference', overall: { width: measurement(8), length: measurement(24), height: measurement(null, 'plate'), wheelbase: measurement(null) },
      shape: { hoodLength: measurement(null) }, coverage: { geometryRate: 0.5 },
    } as ReferenceAnalysis;
    const result = new ReferenceSimilarityScore().score(baseline, brief, reference);
    expect(result.basis).toBe('reference-analysis');
    expect(result.metrics.filter(item => item.id.startsWith('reference-')).map(item => item.id)).toEqual(['reference-length']);
    expect(result.metrics.find(item => item.id === 'reference-length')).toMatchObject({ target: 3, confidence: 0.8 });
    expect(result.warnings.join(' ')).toMatch(/incomplete/);
  });

  it('ranks accepted models deterministically with recomputed reports and rejects an empty pool', () => {
    const a = structuredClone(baseline), b = structuredClone(baseline);
    a.id = 'a'; b.id = 'b';
    const ranked = new Ranking().rank([candidate(b), candidate(a)], stock, brief);
    expect(ranked.status).toBe('accepted');
    expect(ranked.candidates.map(item => item.model.id)).toEqual(['a', 'b']);
    expect(ranked.candidates.every(item => item.validation === item.designValidation.physical && item.validation.valid)).toBe(true);
    expect(new Ranking().rank([], stock, brief)).toMatchObject({ status: 'rejected', candidates: [], message: 'No candidate met design quality threshold.' });
    expect(() => new Ranking().rank([], stock, brief, undefined, { minOverallScore: Number.NaN })).toThrow(/threshold/);
  });

  it('retains all candidate assessments beyond the selected output limit without copying model or step payloads', () => {
    const a = structuredClone(baseline), b = structuredClone(baseline), invalid = structuredClone(baseline);
    a.id = 'a'; b.id = 'b'; invalid.id = 'invalid';
    invalid.parts = invalid.parts.filter(part => part.category !== 'Tyre');
    applyVehicleConnections(invalid);
    const ranked = new Ranking().rank([candidate(b), candidate(invalid), candidate(a)], stock, brief, undefined, { maxCandidates: 1 });
    expect(ranked.candidates.map(item => item.model.id)).toEqual(['a']);
    expect(ranked.assessments.map(item => [item.candidateId, item.rank])).toEqual([['a', 1], ['b', 2], ['invalid', null]]);
    expect(ranked.assessments[0].designValidation).toBe(ranked.candidates[0].designValidation);
    expect(ranked.assessments[2].designValidation).toBe(ranked.rejections[0].designValidation);
    expect(ranked.assessments.every(item => !('model' in item) && !('steps' in item))).toBe(true);
    expect(ranked.assessments.every(item => Number.isFinite(item.designValidation.scores.automotiveDesign))).toBe(true);
  });

  it('supports explicit normalized ranking weights without allowing quality gates to be disabled', () => {
    const result = new AutomotiveDesignValidator().validate(baseline, stock, brief, undefined, { weights: { automotiveDesign: 0, legoStyle: 0, referenceSimilarity: 2, structure: 0, buildability: 0 } });
    expect(result.weights).toEqual({ automotiveDesign: 0, legoStyle: 0, referenceSimilarity: 1, structure: 0, buildability: 0 });
    expect(result.overallScore).toBe(result.referenceSimilarityScore.score);
    expect(result.scores).toMatchObject({ automotiveDesign: result.automotiveDesignScore.score, legoStyle: result.legoStyleScore.score, referenceSimilarity: 100, structure: result.physical.structure.structuralScore });
    expect(result.buildabilityExplanation).toMatch(/real connection continuity/);
    const wrongBrief = structuredClone(brief);
    wrongBrief.proportions.lengthStuds = 48;
    wrongBrief.proportions.heightPlates = 4;
    wrongBrief.proportions.cockpitLengthStuds = 20;
    wrongBrief.proportions.roofLengthStuds = 20;
    const bypass = new Ranking().rank([candidate(baseline)], stock, wrongBrief, undefined, { minAutomotiveDesignScore: 0, minLegoStyleScore: 0, minReferenceSimilarityScore: 0, minOverallScore: 0, weights: { automotiveDesign: 0, legoStyle: 0, referenceSimilarity: 0, structure: 1, buildability: 0 } });
    expect(bypass.status).toBe('rejected');
    expect(bypass.rejections[0].designValidation.overallScore).toBe(bypass.rejections[0].designValidation.physical.structure.structuralScore);
    expect(bypass.rejections[0].designErrors.join(' ')).toMatch(/Reference proportion score/);
    expect(() => new Ranking().rank([], stock, brief, undefined, { weights: { automotiveDesign: 0, legoStyle: 0, referenceSimilarity: 0, structure: 0, buildability: 0 } })).toThrow(/positive total/);
    expect(() => new Ranking().rank([], stock, brief, undefined, { weights: { legoStyle: -1 } })).toThrow(/nonnegative/);
  });

  it('does not award buildability to unplanned buildStep annotations or publish a candidate without instructions', () => {
    const model = structuredClone(baseline);
    for (const part of model.parts) part.buildStep = 1;
    const report = new AutomotiveDesignValidator().validate(model, stock, brief);
    expect(report.physicalValid).toBe(true);
    expect(report.instructions).toMatchObject({ status: 'unassessed', score: null, assessedSteps: 0 });
    expect(report.scores.buildability).toBe(0);
    expect(report.valid).toBe(false);
    expect(new Ranking().rank([{ model, validation: validateVehicle(model, stock), steps: [] }], stock, brief).status).toBe('rejected');
  });

  it('checks complete real instruction plans and blocks incomplete or altered snapshots', () => {
    const planned = candidate(baseline);
    const checked = new AutomotiveDesignValidator().validate(planned.model, stock, brief, undefined, { steps: planned.steps });
    expect(checked.instructions).toMatchObject({ status: 'passed', score: 100, assessedSteps: planned.steps.length });
    expect(checked.valid).toBe(true);
    const incomplete = new AutomotiveDesignValidator().validate(planned.model, stock, brief, undefined, { steps: planned.steps.slice(0, -2) });
    expect(incomplete.instructions.status).toBe('failed');
    expect(incomplete.valid).toBe(false);
    const wrongPose = JSON.parse(JSON.stringify(planned.steps)) as VehicleCandidate['steps'];
    wrongPose[0].totalModelState[0].position.x += 1;
    const altered = new AutomotiveDesignValidator().validate(planned.model, stock, brief, undefined, { steps: wrongPose });
    expect(altered.instructions.status).toBe('failed');
    expect(altered.instructions.errors.join(' ')).toMatch(/pose or catalog identity/);
  });

  it('rejects disconnected intermediate assemblies even when the bounded step format is internally consistent', () => {
    const packed = packCandidateSteps(candidate(baseline));
    const first = packed.steps[0].addedPartIds[0], late = packed.model.parts.find(part => part.moduleId === 'roof')!.instanceId;
    const firstPart = packed.model.parts.find(part => part.instanceId === first)!, latePart = packed.model.parts.find(part => part.instanceId === late)!;
    [firstPart.buildStep, latePart.buildStep] = [latePart.buildStep, firstPart.buildStep];
    const swap = (id: string) => id === first ? late : id === late ? first : id;
    for (const step of packed.steps) {
      step.addedPartIds = step.addedPartIds.map(swap);
      step.statePartIds = step.statePartIds.map(swap);
    }
    // The complete part counts, states and pick order remain a valid disk format.
    const decoded = unpackCandidateSteps(packed);
    const checked = new AutomotiveDesignValidator().validate(decoded.model, stock, brief, undefined, { steps: decoded.steps });
    expect(checked.physicalValid).toBe(true);
    expect(checked.instructions.status).toBe('failed');
    expect(checked.instructions.errors.join(' ')).toMatch(/continuous real connection graph/);
    expect(checked.valid).toBe(false);
  });
});
