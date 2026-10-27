import { describe, expect, it } from 'vitest';
import { automotiveWidthLayout, planAutomotiveCandidates } from '../src/automotive/generator/planner.js';
import type { AutomotiveModuleId, VehicleClass, VehicleDesignBrief } from '../src/automotive/research/types.js';
import { generatableWheelAssemblies } from '../src/speed/wheelAssemblies.js';
import { AutomotivePartBuilder, addAutomotiveChassis } from '../src/automotive/generator/chassis.js';
import { applyVehicleConnections } from '../src/speed/connections.js';
import { vehicleDimensions } from '../src/speed/geometry.js';
import { evaluateChassisContinuity, SpeedCollisionValidator, SpeedConnectionValidator, WheelValidator } from '../src/speed/validators.js';
import type { VehicleModel } from '../src/speed/types.js';
import { getCatalogVehicleProfile } from '../src/automotive/research/profiles.js';
import { toVehicleDesignBrief } from '../src/automotive/research/brief.js';
import { assembleAutomotiveModel, generateAutomotiveCandidates } from '../src/automotive/generator/pipeline.js';
import { createVirtualPaletteInventory } from '../src/automotive/palette.js';
import { validateAutomotivePhysics } from '../src/automotive/quality.js';
import { buildVehicleSteps } from '../src/speed/steps.js';
import { packCandidateSteps, unpackCandidateSteps } from '../src/speed/stepCodec.js';

function brief(width = 8, vehicleClass: VehicleClass = 'luxury-sedan'): VehicleDesignBrief {
  return {
    profileId: 'source-profile', targetVehicle: 'Generic source-backed vehicle', vehicleClass, targetWidthStuds: width,
    widthSelection: 'user', identityPriorities: ['long hood'], secondaryFeatures: [], featureTags: ['long-wheelbase', 'large-grille'],
    proportions: { lengthStuds: width * 2.6, wheelbaseStuds: width * 1.5, heightPlates: 15, wheelDiameterStuds: 3, frontOverhangStuds: 3, rearOverhangStuds: 3, cockpitStartStuds: Math.round(width * 0.8), cockpitLengthStuds: Math.round(width), hoodLengthStuds: Math.round(width * 0.8), roofLengthStuds: Math.round(width * 0.7) },
    modules: Object.fromEntries(['chassis', 'front', 'hood', 'cockpit', 'roof', 'leftSide', 'rightSide', 'rear', 'wheelModules', 'aero', 'details'].map(id => [id, { widthStuds: width, lengthStuds: 4, heightPlates: 3, startStuds: 0 }])) as Record<AutomotiveModuleId, { widthStuds: number; lengthStuds: number; heightPlates: number; startStuds: number }>,
    dimensionBasis: 'source-backed', assumptions: [], sourceIds: ['manual-source'], warnings: [], planningMethod: 'discrete-module-replanning',
  };
}

describe('generic automotive coarse planning', () => {
  it('replans modular widths with discrete cabin and roof choices', () => {
    const narrow = automotiveWidthLayout(8), medium = automotiveWidthLayout(10), wide = automotiveWidthLayout(12);
    expect([narrow.cabinWidthStuds, medium.cabinWidthStuds, wide.cabinWidthStuds]).toEqual([6, 6, 8]);
    expect([narrow.roofWidthStuds, medium.roofWidthStuds, wide.roofWidthStuds]).toEqual([4, 6, 6]);
    expect(medium.roofWidthStuds / narrow.roofWidthStuds).not.toBe(10 / 8);
    expect(wide.reinforcementRailOffsets).toEqual([2, 8]);
    expect(() => automotiveWidthLayout(9)).toThrow(/8, 10 or 12/);
  });

  it('produces 5–20 discrete candidates, and rejects unbounded search requests', () => {
    for (const count of [5, 8, 20]) {
      const result = planAutomotiveCandidates(brief(), { candidateCount: count });
      expect(result.plans).toHaveLength(count);
      expect(new Set(result.plans.map(plan => JSON.stringify([plan.lengthStuds, plan.wheelbaseStuds, plan.cabinStartStuds, plan.cabinLengthStuds, plan.roofLengthStuds, plan.roofHeightPlates]))).size).toBe(count);
      expect(result.plans.every(plan => plan.coordinateSystem === 'speed-x-width-y-front-to-rear-z-plates')).toBe(true);
    }
    expect(() => planAutomotiveCandidates(brief(), { candidateCount: 4 })).toThrow(/5 to 20/);
    expect(() => planAutomotiveCandidates(brief(), { candidateCount: 21 })).toThrow(/5 to 20/);
  });

  it('uses only a registered width-specific wheel assembly, or blocks the plan', () => {
    for (const width of [8, 10, 12]) {
      const plan = planAutomotiveCandidates(brief(width)).plans[0];
      const definition = generatableWheelAssemblies().find(row => row.id === plan.wheelAssemblyId);
      if (definition) {
        expect(definition.supportedVehicleWidths).toContain(width);
        expect(plan.trackStuds).toBe(definition.track + (definition.holderPart === '3700' ? width - 8 : 0));
        expect(plan.status).toBe('ready');
      } else {
        expect(plan.status).toBe('blocked');
        expect(plan.trackStuds).toBeNull();
        expect(plan.blockers.join(' ')).toMatch(/not stretched/);
      }
    }
  });

  it('derives a generic class layout without inspecting the model identity', () => {
    for (const vehicleClass of ['luxury-sedan', 'performance-coupe', 'sports-car', 'gt', 'supercar'] as const) {
      const first = brief(8, vehicleClass), second = { ...first, profileId: 'unrelated', targetVehicle: 'Another manufacturer and model' };
      const a = planAutomotiveCandidates(first).plans[0], b = planAutomotiveCandidates(second).plans[0];
      expect(a.modules).toEqual(b.modules);
      expect(a.patternChoices).toEqual(b.patternChoices);
      expect(a.modules.hood.y + a.modules.hood.lengthStuds).toBe(a.cabinStartStuds);
      expect(a.rearAxleStuds - a.frontAxleStuds).toBe(a.wheelbaseStuds);
      expect(a.modules.roof.x + a.modules.roof.widthStuds).toBeLessThanOrEqual(a.layout.widthStuds);
    }
  });

  it('does not mutate a brief or caller-provided pattern list', () => {
    const input = brief(), snapshot = structuredClone(input), patterns: [] = [];
    planAutomotiveCandidates(input, { patterns });
    expect(input).toEqual(snapshot);
    expect(patterns).toEqual([]);
  });
});

describe('generic module assembly pipeline', () => {
  const examples = ['S63', 'M4', '911', 'Roma', 'Revuelto'].flatMap(query => [8, 10, 12].map(width => ({ query, width })));
  it.each(examples)('assembles $query at $width studs with real physics and bounded instructions', ({ query, width }) => {
    const target = toVehicleDesignBrief(getCatalogVehicleProfile(query)!, { widthStuds: width, allowEstimatedProportions: true });
    const plan = planAutomotiveCandidates(target, { candidateCount: 5 }).plans[0];
    const model = assembleAutomotiveModel({ brief: target }, plan), inventory = createVirtualPaletteInventory();
    const validation = validateAutomotivePhysics(model, inventory, target);
    expect(validation.errors).toEqual([]);
    expect(model.parts.length).toBeLessThanOrEqual(300);
    expect(model.parts.filter(part => part.category === 'CurvedSlope').length).toBeGreaterThan(0);
    expect(model.parts.filter(part => part.color.id === 40 && part.category === 'Slope').length).toBeGreaterThan(0);
    expect(model.connections.some(edge => edge.connectionType === 'side-stud')).toBe(true);
    expect(plan.patternChoices.every(use => use.status === 'instantiated' && use.instanceIds.length > 0 && use.instanceIds.every(id => model.parts.some(part => part.instanceId === id)))).toBe(true);
    expect(plan.patternChoices.every(use => ['snot-grille-strips', 'snot-headlight-offset'].includes(use.patternId))).toBe(true);
    expect(plan.recommendedPatternChoices?.every(choice => choice.status === 'recommended' && !choice.instanceIds.length)).toBe(true);
    const steps = buildVehicleSteps(model);
    expect(steps.length).toBeGreaterThan(1);
    const restored = unpackCandidateSteps(packCandidateSteps({ model, validation, steps }));
    expect(restored.steps.at(-1)!.totalModelState).toHaveLength(model.parts.length);
    expect(restored.model.parts).toEqual(model.parts);
  }, 30_000);

  it('returns all physically valid alternatives before quality selection', () => {
    const target = toVehicleDesignBrief(getCatalogVehicleProfile('S63')!, { widthStuds: 8, allowEstimatedProportions: true });
    const result = generateAutomotiveCandidates({ brief: target, candidateCount: 5 });
    expect(result.plans).toHaveLength(5);
    expect(result.diagnostics).toHaveLength(5);
    expect(result.candidates).toHaveLength(5);
    expect(result.candidates.every(candidate => candidate.validation.valid && !candidate.steps.length)).toBe(true);
    expect(result.warnings.join(' ')).toMatch(/质量排名/);
  }, 30_000);

  it('preserves placement diagnostics and returns no substitute when local patterns are unavailable', () => {
    const target = toVehicleDesignBrief(getCatalogVehicleProfile('S63')!, { widthStuds: 8, allowEstimatedProportions: true });
    const result = generateAutomotiveCandidates({ brief: target, candidateCount: 5, patterns: [] });
    expect(result.candidates).toEqual([]);
    expect(result.rejections).toHaveLength(5);
    expect(result.rejections.every(rejection => rejection.stage === 'placement')).toBe(true);
    expect(result.diagnostics.every(diagnostic => diagnostic.status === 'placement-failed')).toBe(true);
    expect(result.warnings.join(' ')).toMatch(/未生成成品/);
  });

  it('still plans twenty genuinely different low-roof supercar alternatives', () => {
    const target = toVehicleDesignBrief(getCatalogVehicleProfile('Revuelto')!, { widthStuds: 8, allowEstimatedProportions: true });
    expect(planAutomotiveCandidates(target, { candidateCount: 20 }).plans).toHaveLength(20);
  });
});

describe('independent calibrated wheel mounts', () => {
  it.each([8, 10, 12])('supports a %i-stud chassis with legal unscaled wheel chains', width => {
    const plan = planAutomotiveCandidates(brief(width)).plans[0];
    const builder = new AutomotivePartBuilder(`test-${width}`);
    addAutomotiveChassis(builder, plan);
    const model: VehicleModel = {
      id: 'test', name: 'Wheel mount verification', description: '', vehicleType: 'gt', style: 'modern',
      options: { prompt: '', vehicleType: 'gt', style: 'modern', minifigure: false, priority: 'structure', maximizeUsage: false },
      parameters: { width, length: plan.lengthStuds, wheelbase: plan.wheelbaseStuds, track: plan.trackStuds!, cockpitPosition: plan.cabinStartStuds, hoodLength: plan.hoodLengthStuds, roofHeight: plan.roofHeightPlates },
      parts: builder.parts, connections: [], modules: [], dimensions: vehicleDimensions(builder.parts), inventoryUsage: [], designNotes: [], version: 1,
    };
    applyVehicleConnections(model);
    expect(new SpeedConnectionValidator().validate(model).errors).toEqual([]);
    expect(new SpeedCollisionValidator().validate(model).errors).toEqual([]);
    expect(evaluateChassisContinuity(model.parts.filter(part => part.moduleId === 'chassis')).errors).toEqual([]);
    const wheels = new WheelValidator().validate(model, { trackStuds: { min: 4.5, max: width + 0.5 }, wheelbaseStuds: { min: 6, max: 30 } });
    expect(wheels.errors).toEqual([]);
    expect(wheels.axleConnections).toBe(4);
    expect(wheels.groundedWheels).toBe(4);
    expect(model.parts.filter(part => part.partId === '3700')).toHaveLength(4);
    expect(model.parts.filter(part => part.partId === '3673').every(part => part.dimensions.x === 2)).toBe(true);
    // Moving an otherwise valid holder by a fraction of a stud invalidates
    // the exact interface; a plausible visual contact is not a connector.
    model.parts.find(part => part.partId === '3700')!.position.y += 0.1;
    applyVehicleConnections(model);
    expect(new SpeedConnectionValidator().validate(model).valid).toBe(false);
    expect(new WheelValidator().validate(model).valid).toBe(false);
  });
});
