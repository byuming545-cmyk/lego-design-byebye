import { comparePatterns, createDesignPatternLibrary, type LegoDesignPattern, type PatternCategory } from '../patterns.js';
import type { ReferenceAnalysis } from '../references/types.js';
import type { AutomotiveModuleId, VehicleDesignBrief } from '../research/types.js';
import { generatableWheelAssemblies } from '../../speed/wheelAssemblies.js';
import type { VehicleModuleId } from '../../speed/types.js';
import type { AutomotiveCoarsePlan, AutomotiveModuleLayout, AutomotivePatternChoice, AutomotivePlanningEvidence, AutomotivePlanningOptions, AutomotivePlanningResult, AutomotiveWidth, AutomotiveWidthLayout } from './types.js';

export const AUTOMOTIVE_WIDTH_LAYOUTS: Readonly<Record<AutomotiveWidth, Readonly<AutomotiveWidthLayout>>> = Object.freeze({
  8: Object.freeze({ widthStuds: 8, chassisWidthStuds: 4, hoodWidthStuds: 6, cabinWidthStuds: 6, roofWidthStuds: 4, grilleWidthStuds: 4, shoulderWidthStuds: 1, reinforcementRailOffsets: Object.freeze([2, 4]) }),
  10: Object.freeze({ widthStuds: 10, chassisWidthStuds: 6, hoodWidthStuds: 8, cabinWidthStuds: 6, roofWidthStuds: 6, grilleWidthStuds: 6, shoulderWidthStuds: 2, reinforcementRailOffsets: Object.freeze([2, 6]) }),
  12: Object.freeze({ widthStuds: 12, chassisWidthStuds: 8, hoodWidthStuds: 10, cabinWidthStuds: 8, roofWidthStuds: 6, grilleWidthStuds: 8, shoulderWidthStuds: 2, reinforcementRailOffsets: Object.freeze([2, 8]) }),
});
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const nearestEven = (value: number) => Math.round(value / 2) * 2;
const speedModules: Record<AutomotiveModuleId, VehicleModuleId> = { chassis: 'chassis', front: 'front', hood: 'front', cockpit: 'cockpit', roof: 'roof', leftSide: 'bodyShell', rightSide: 'bodyShell', rear: 'rear', wheelModules: 'leftWheelModule', aero: 'aero', details: 'details' };
const patternCategories: Partial<Record<AutomotiveModuleId, PatternCategory>> = { chassis: 'chassis', front: 'front', hood: 'hood', roof: 'roof', leftSide: 'side', rear: 'rear', details: 'detail' };

export function automotiveWidthLayout(width: number): AutomotiveWidthLayout {
  if (![8, 10, 12].includes(width)) throw new RangeError('Automotive V0.3 supports independently planned widths of 8, 10 or 12 studs.');
  return structuredClone(AUTOMOTIVE_WIDTH_LAYOUTS[width as AutomotiveWidth]);
}
function validateBrief(brief: VehicleDesignBrief): void {
  automotiveWidthLayout(brief.targetWidthStuds);
  const p = brief.proportions;
  if (!p || !['lengthStuds', 'wheelbaseStuds', 'heightPlates', 'frontOverhangStuds', 'rearOverhangStuds', 'cockpitStartStuds', 'cockpitLengthStuds', 'hoodLengthStuds', 'roofLengthStuds'].every(field => Number.isFinite(p[field as keyof typeof p]) && p[field as keyof typeof p] > 0)) throw new RangeError('The automotive brief must contain finite, positive module proportions.');
  if (p.wheelbaseStuds >= p.lengthStuds || p.cockpitStartStuds + p.cockpitLengthStuds > p.lengthStuds + 1) throw new RangeError('The automotive brief has inconsistent axle or cabin positions.');
}
function referenceRatio(references: readonly ReferenceAnalysis[], numerator: 'length' | 'wheelbase' | 'height'): { value: number; referenceId: string; confidence: number } | null {
  const candidates = references.flatMap(reference => {
    const top = reference.overall[numerator], width = reference.overall.width;
    if (top.value === null || width.value === null || top.value <= 0 || width.value <= 0 || top.confidence < 0.65 || width.confidence < 0.65 || !top.evidence.length || !width.evidence.length || reference.coverage.geometryRate < 0.6) return [];
    // z is already measured in plates: only lateral/longitudinal ratios share units.
    if (numerator === 'height') return [];
    return [{ value: top.value / width.value, referenceId: reference.referenceId, confidence: Math.min(top.confidence, width.confidence) }];
  });
  return candidates.sort((a, b) => b.confidence - a.confidence || a.referenceId.localeCompare(b.referenceId))[0] ?? null;
}
function choosePatterns(brief: VehicleDesignBrief, modules: Record<AutomotiveModuleId, AutomotiveModuleLayout>, library: readonly LegoDesignPattern[], variant: number): AutomotivePatternChoice[] {
  const choices: AutomotivePatternChoice[] = [];
  for (const [moduleId, category] of Object.entries(patternCategories) as Array<[AutomotiveModuleId, PatternCategory]>) {
    const area = modules[moduleId];
    const matches = library.flatMap(pattern => {
      const match = comparePatterns(pattern, { category, vehicleType: brief.vehicleClass, maxDimensions: { x: area.widthStuds, y: area.lengthStuds, z: Math.max(area.heightPlates, 4) }, styleTags: brief.featureTags });
      return match ? [match] : [];
    }).sort((a, b) => b.score - a.score || a.pattern.id.localeCompare(b.pattern.id));
    if (!matches.length) continue;
    const match = matches[variant % Math.min(2, matches.length)];
    choices.push({ moduleId, patternId: match.pattern.id, reason: match.reasons.join('; ') || 'Confirmed local geometry fits this module.', sourceReferences: [...match.pattern.sourceReferences], status: 'recommended', instanceIds: [] });
  }
  return choices;
}

/** Plan 5–20 modest discrete alternatives before committing legal LEGO parts. */
export function planAutomotiveCandidates(brief: VehicleDesignBrief, options: AutomotivePlanningOptions = {}): AutomotivePlanningResult {
  validateBrief(brief);
  const requested = options.candidateCount ?? 8;
  if (!Number.isInteger(requested) || requested < 5 || requested > 20) throw new RangeError('Automotive candidateCount must be an integer from 5 to 20.');
  const layout = automotiveWidthLayout(brief.targetWidthStuds), references = options.references ?? [], library = options.patterns ?? createDesignPatternLibrary();
  const lengthReference = referenceRatio(references, 'length'), wheelbaseReference = referenceRatio(references, 'wheelbase');
  const width = layout.widthStuds, p = brief.proportions;
  const baseLength = nearestEven(clamp(lengthReference ? p.lengthStuds * 0.85 + lengthReference.value * width * 0.15 : p.lengthStuds, width * 1.8, width * 3.2));
  const preferredTrack = width * 0.74;
  // A registry entry must explicitly support this width. Geometric transforms
  // are never scaled and recognition-only wheel combinations stay excluded.
  const wheels = generatableWheelAssemblies().filter(assembly => assembly.supportedVehicleWidths.includes(width)).sort((a, b) => Math.abs(a.track - preferredTrack) - Math.abs(b.track - preferredTrack) || a.id.localeCompare(b.id));
  const wheelAssembly = wheels[0];
  const plans: AutomotiveCoarsePlan[] = [], signatures = new Set<string>();
  for (let variant = 0; variant < 240 && plans.length < requested; variant++) {
    const lengthDelta = [0, 0, 2, -2, 0][variant % 5];
    const cabinDelta = [0, 1, -1, 0, 0][variant % 5];
    const length = clamp(baseLength + lengthDelta, Math.ceil(width * 1.8 / 2) * 2, Math.floor(width * 3.2 / 2) * 2);
    const baseWheelbase = wheelbaseReference ? p.wheelbaseStuds * 0.85 + wheelbaseReference.value * width * 0.15 : p.wheelbaseStuds;
    const wheelbase = clamp(Math.round(baseWheelbase + (variant % 3 === 2 ? 1 : 0)), 8, length - 6);
    const frontAxle = clamp(Math.round(p.frontOverhangStuds), 3, length - wheelbase - 3), rearAxle = frontAxle + wheelbase;
    const cabinLength = clamp(Math.round(p.cockpitLengthStuds + (variant % 4 === 3 ? 1 : 0) + Math.floor(variant / 20) % 2), 5, length - 8);
    const cabinStart = clamp(Math.round(p.cockpitStartStuds) + cabinDelta, 5, length - cabinLength - 2);
    const roofLength = clamp(Math.round(p.roofLengthStuds) + (variant % 4 === 1 ? 1 : 0), 3, cabinLength - 2);
    const roofStart = cabinStart + 1;
    const roofHeight = clamp(Math.round(p.heightPlates) + [0, -1, 1][Math.floor(variant / 5) % 3], 14, 26);
    const beltline = clamp(roofHeight - (brief.vehicleClass === 'luxury-sedan' ? 6 : 5), 8, 12);
    const grilleHeight = brief.featureTags.some(tag => /large.grille|vertical.grille|luxury/.test(tag)) ? 3 : 2;
    const signature = JSON.stringify([length, wheelbase, cabinStart, cabinLength, roofLength, roofHeight]);
    if (signatures.has(signature)) continue;
    signatures.add(signature);
    const makeModule = (id: AutomotiveModuleId, x: number, y: number, z: number, w: number, d: number, h: number): AutomotiveModuleLayout => ({ moduleId: id, speedModuleId: speedModules[id], x, y, z, widthStuds: w, lengthStuds: Math.max(0, d), heightPlates: h });
    const modules: Record<AutomotiveModuleId, AutomotiveModuleLayout> = {
      chassis: makeModule('chassis', (width - layout.chassisWidthStuds) / 2, 0, 5, layout.chassisWidthStuds, length, 2),
      front: makeModule('front', (width - layout.hoodWidthStuds) / 2, 0, 7, layout.hoodWidthStuds, 2, grilleHeight + 1),
      hood: makeModule('hood', (width - layout.hoodWidthStuds) / 2, 2, 7, layout.hoodWidthStuds, cabinStart - 2, beltline - 6),
      cockpit: makeModule('cockpit', (width - layout.cabinWidthStuds) / 2, cabinStart, beltline, layout.cabinWidthStuds, cabinLength, roofHeight - beltline),
      roof: makeModule('roof', (width - layout.roofWidthStuds) / 2, roofStart, roofHeight - 1, layout.roofWidthStuds, roofLength, 1),
      leftSide: makeModule('leftSide', 0, frontAxle + 2, 7, layout.shoulderWidthStuds, rearAxle - frontAxle - 4, beltline - 6),
      rightSide: makeModule('rightSide', width - layout.shoulderWidthStuds, frontAxle + 2, 7, layout.shoulderWidthStuds, rearAxle - frontAxle - 4, beltline - 6),
      rear: makeModule('rear', (width - layout.hoodWidthStuds) / 2, cabinStart + cabinLength, 7, layout.hoodWidthStuds, length - cabinStart - cabinLength, beltline - 6),
      wheelModules: makeModule('wheelModules', 0, frontAxle - 1.5, 0, width, rearAxle - frontAxle + 3, 8),
      aero: makeModule('aero', (width - layout.roofWidthStuds) / 2, length - 2, 9, layout.roofWidthStuds, 1, 1),
      details: makeModule('details', 0, 0, 7, width, length, roofHeight - 7),
    };
    const evidence: AutomotivePlanningEvidence[] = [
      { field: 'width-layout', value: width, basis: 'discrete-layout' },
      { field: 'lengthStuds', value: p.lengthStuds, basis: 'brief' },
      { field: 'wheelbaseStuds', value: p.wheelbaseStuds, basis: 'brief' },
    ];
    if (lengthReference) evidence.push({ field: 'length-width-ratio', ...lengthReference, basis: 'reference-measurement' });
    if (wheelbaseReference) evidence.push({ field: 'wheelbase-width-ratio', ...wheelbaseReference, basis: 'reference-measurement' });
    const track = wheelAssembly ? wheelAssembly.track + (wheelAssembly.holderPart === '3700' ? width - 8 : 0) : null;
    if (track !== null) evidence.push({ field: 'trackStuds', value: track, basis: 'verified-wheel-registry' });
    const blockers = wheelAssembly ? [] : [`No independently calibrated wheel assembly supports ${width}-stud width; a fixed narrower axle is not stretched.`];
    const wheelKeepouts = wheelAssembly && track !== null ? (['front', 'rear'] as const).flatMap(axle => (['left', 'right'] as const).map(side => ({ axle, side, axis: 'x' as const, center: { x: width / 2 + (side === 'left' ? -track / 2 : track / 2), y: axle === 'front' ? frontAxle : rearAxle, z: wheelAssembly.wheelRadius * 2.5 }, radiusStuds: wheelAssembly.wheelRadius, axialWidthStuds: wheelAssembly.wheelWidth }))) : [];
    plans.push({ id: `automotive-plan-${width}-${plans.length + 1}`, profileId: brief.profileId, vehicleClass: brief.vehicleClass, variant, coordinateSystem: 'speed-x-width-y-front-to-rear-z-plates', planningMethod: 'discrete-module-replanning', layout: structuredClone(layout), lengthStuds: length, frontAxleStuds: frontAxle, rearAxleStuds: rearAxle, wheelbaseStuds: wheelbase, trackStuds: track, wheelAssemblyId: wheelAssembly?.id ?? null, wheelDiameterStuds: wheelAssembly ? wheelAssembly.wheelRadius * 2 : null, wheelKeepouts, hoodLengthStuds: cabinStart, cabinStartStuds: cabinStart, cabinLengthStuds: cabinLength, roofStartStuds: roofStart, roofLengthStuds: roofLength, roofHeightPlates: roofHeight, beltlineHeightPlates: beltline, grilleHeightPlates: grilleHeight, modules, patternChoices: choosePatterns(brief, modules, library, variant), evidence, status: blockers.length ? 'blocked' : 'ready', blockers, warnings: ['Reference measurements guide proportions only; no complete reference car is copied.', 'A coarse plan has not passed part placement, physical validation, or appearance ranking.'] });
  }
  return { plans, warnings: [...new Set(plans.flatMap(plan => plan.blockers))] };
}
