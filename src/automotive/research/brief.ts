import type { AutomotiveModuleId, BriefAssumption, RealVehicleProfile, VehicleBriefOptions, VehicleClass, VehicleDesignBrief, VehicleFact, VehicleModuleTarget } from './types.js';

/** Engineering priors for planning, never presented as measured facts about a car. */
const CLASS_PRIORS: Record<VehicleClass, { lengthWidth: number; heightWidth: number; wheelbaseLength: number; hoodLength: number; cabinStart: number; cabinLength: number; roofLength: number; frontShare: number }> = {
  'luxury-sedan': { lengthWidth: 2.7, heightWidth: 0.76, wheelbaseLength: 0.61, hoodLength: 0.27, cabinStart: 0.32, cabinLength: 0.49, roofLength: 0.36, frontShare: 0.50 },
  'performance-coupe': { lengthWidth: 2.55, heightWidth: 0.72, wheelbaseLength: 0.59, hoodLength: 0.29, cabinStart: 0.35, cabinLength: 0.42, roofLength: 0.31, frontShare: 0.51 },
  'sports-car': { lengthWidth: 2.43, heightWidth: 0.69, wheelbaseLength: 0.54, hoodLength: 0.25, cabinStart: 0.34, cabinLength: 0.40, roofLength: 0.30, frontShare: 0.48 },
  gt: { lengthWidth: 2.35, heightWidth: 0.65, wheelbaseLength: 0.57, hoodLength: 0.32, cabinStart: 0.39, cabinLength: 0.39, roofLength: 0.28, frontShare: 0.54 },
  supercar: { lengthWidth: 2.43, heightWidth: 0.58, wheelbaseLength: 0.55, hoodLength: 0.21, cabinStart: 0.30, cabinLength: 0.35, roofLength: 0.24, frontShare: 0.48 },
  unknown: { lengthWidth: 2.5, heightWidth: 0.72, wheelbaseLength: 0.58, hoodLength: 0.26, cabinStart: 0.33, cabinLength: 0.43, roofLength: 0.32, frontShare: 0.5 },
};
export class VehicleBriefError extends Error {
  constructor(message: string, readonly code: 'INVALID_WIDTH' | 'UNKNOWN_DIMENSIONS' | 'INVALID_DIMENSIONS') { super(message); this.name = 'VehicleBriefError'; }
}
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const rounded = (value: number) => Math.round(value);
function sourceBacked(fact: VehicleFact<number>, sourceIds: Set<string>): number | null {
  return fact.value !== null && Number.isFinite(fact.value) && fact.value > 0 && (fact.status === 'manual' || fact.status === 'live_verified') && fact.sourceIds.length > 0 && fact.sourceIds.every(id => sourceIds.has(id)) ? fact.value : null;
}

export function toVehicleDesignBrief(profile: RealVehicleProfile, input: VehicleBriefOptions | number = {}): VehicleDesignBrief {
  const options = typeof input === 'number' ? { widthStuds: input } : input;
  const width = options.widthStuds ?? (profile.vehicleType === 'luxury-sedan' ? 10 : 8);
  if (!Number.isInteger(width) || width < 6 || width > 24) throw new VehicleBriefError('Choose an integer LEGO width from 6 to 24 studs (including 8, 10, or 12).', 'INVALID_WIDTH');
  const prior = CLASS_PRIORS[profile.vehicleType] ?? CLASS_PRIORS.unknown, sourceIds = new Set(profile.sources.map(source => source.id));
  const known = {
    length: sourceBacked(profile.dimensions.lengthMm, sourceIds), width: sourceBacked(profile.dimensions.widthMm, sourceIds),
    height: sourceBacked(profile.dimensions.heightMm, sourceIds), wheelbase: sourceBacked(profile.dimensions.wheelbaseMm, sourceIds),
  };
  const missing = Object.entries(known).filter(([, value]) => value === null).map(([key]) => key);
  if (missing.length && !options.allowEstimatedProportions) throw new VehicleBriefError(`Vehicle dimensions are unknown or unverified: ${missing.join(', ')}. Complete official research or supply a sourced manual profile. Explicitly enable estimated proportions for a labelled conceptual study.`, 'UNKNOWN_DIMENSIONS');
  if (known.length !== null && known.width !== null && (known.length <= known.width || known.length / known.width > 5 || known.length / known.width < 1.5) || known.length !== null && known.wheelbase !== null && (known.wheelbase >= known.length || known.wheelbase / known.length < 0.35)) throw new VehicleBriefError('Vehicle dimensions do not form a plausible car proportion.', 'INVALID_DIMENSIONS');
  const assumptions: BriefAssumption[] = [];
  const ratio = (field: string, numerator: number | null, denominator: number | null, fallback: number): number => {
    if (numerator !== null && denominator !== null) return numerator / denominator;
    assumptions.push({ field, reason: `Estimated from the ${profile.vehicleType} engineering prior because source-backed dimensions are incomplete.`, sourceIds: [] });
    return fallback;
  };
  const length = Math.max(width + 4, rounded(width * ratio('lengthStuds', known.length, known.width, prior.lengthWidth)));
  const wheelbaseRatio = ratio('wheelbaseStuds', known.wheelbase, known.length, prior.wheelbaseLength);
  const wheelbase = clamp(rounded(length * wheelbaseRatio), 6, length - 4);
  const heightPlates = Math.max(5, rounded(width * ratio('heightPlates', known.height, known.width, prior.heightWidth) * 2.5));
  const actualHood = sourceBacked(profile.visualFeatures.hoodLengthRatio, sourceIds);
  const actualCabin = sourceBacked(profile.visualFeatures.cabinPositionRatio, sourceIds);
  const semanticRatio = (field: string, value: number | null, fallback: number): number => {
    if (value !== null) return value;
    assumptions.push({ field, reason: `Estimated ${profile.vehicleType} module proportion; not measured from a photograph.`, sourceIds: [] });
    return fallback;
  };
  const hood = clamp(rounded(length * semanticRatio('hoodLengthStuds', actualHood, prior.hoodLength)), 2, length - 8);
  const cockpitStart = clamp(rounded(length * semanticRatio('cockpitStartStuds', actualCabin, prior.cabinStart)), hood, length - 6);
  const cockpitLength = clamp(rounded(length * semanticRatio('cockpitLengthStuds', null, prior.cabinLength)), 4, length - cockpitStart - 1);
  const roofLength = clamp(rounded(length * semanticRatio('roofLengthStuds', null, prior.roofLength)), 2, cockpitLength);
  const overhang = length - wheelbase;
  const frontOverhang = clamp(rounded(overhang * semanticRatio('frontOverhangStuds', null, prior.frontShare)), 2, overhang - 2);
  const rearOverhang = overhang - frontOverhang;
  const wheelDiameter = Math.max(2, Math.round((heightPlates / 2.5) * 0.48 * 2) / 2);
  assumptions.push({ field: 'wheelDiameterStuds', reason: 'Target diameter is quantized to half-stud planning increments. A compatible calibrated wheel assembly must be selected later; this is not a tyre part claim.', sourceIds: [] });
  if (options.widthStuds === undefined) assumptions.push({ field: 'targetWidthStuds', reason: `Recommended ${width}-wide design choice; the user has not selected a scale.`, sourceIds: [] });
  const cabinWidth = Math.max(4, width - (width >= 10 ? 4 : 2));
  const bodyHeight = Math.max(3, heightPlates - Math.max(3, rounded(heightPlates * 0.36)));
  const module = (widthStuds: number, lengthStuds: number, height: number, startStuds = 0): VehicleModuleTarget => ({ widthStuds, lengthStuds, heightPlates: height, startStuds });
  const modules: Record<AutomotiveModuleId, VehicleModuleTarget> = {
    chassis: module(width, length - 2, 2, 1), front: module(width, Math.max(2, frontOverhang), bodyHeight), hood: module(width - 2, hood, Math.max(2, bodyHeight - 1)),
    cockpit: module(cabinWidth, cockpitLength, heightPlates - bodyHeight, cockpitStart), roof: module(cabinWidth, roofLength, 1, cockpitStart + rounded((cockpitLength - roofLength) / 2)),
    leftSide: module(1, length - 2, bodyHeight, 1), rightSide: module(1, length - 2, bodyHeight, 1), rear: module(width, Math.max(2, rearOverhang), bodyHeight, length - rearOverhang),
    wheelModules: module(width, wheelbase + wheelDiameter, Math.max(2, rounded(wheelDiameter * 2.5)), frontOverhang - wheelDiameter / 2),
    aero: module(width, 2, 1, length - 2), details: module(width, length, 1),
  };
  const identity = profile.signatureFeatures.filter(fact => fact.value !== null && fact.sourceIds.length && fact.sourceIds.every(id => sourceIds.has(id))).map(fact => fact.value!);
  const secondary = [profile.visualFeatures.headlights, profile.visualFeatures.rearDesign, profile.visualFeatures.wheelArchCharacter].filter(fact => fact.value !== null).map(fact => fact.value!);
  const knownCount = Object.values(known).filter(value => value !== null).length;
  const warnings = [...profile.warnings];
  warnings.push('Module shape and wheel targets include documented engineering assumptions; dimension provenance does not imply photographic shape analysis.');
  if (knownCount < 4) warnings.push('Dimension targets include explicitly enabled engineering estimates. These are not measured specifications for the named vehicle.');
  if (Object.values(profile.dimensions).some(fact => fact.status === 'manual')) warnings.push('Dimensions include user-supplied measurements; they are not independently verified.');
  if (profile.signatureFeatures.some(fact => fact.status === 'catalog_seed')) warnings.push('Identity priorities include editorial catalogue tags that have not been confirmed by live research.');
  return {
    profileId: profile.id, targetVehicle: `${profile.manufacturer} ${profile.model}${profile.generation ? ` (${profile.generation})` : ''}`, vehicleClass: profile.vehicleType, targetWidthStuds: width, widthSelection: options.widthStuds === undefined ? 'recommended' : 'user',
    identityPriorities: identity, secondaryFeatures: secondary, featureTags: [...profile.featureTags],
    proportions: { lengthStuds: length, wheelbaseStuds: wheelbase, heightPlates, wheelDiameterStuds: wheelDiameter, frontOverhangStuds: frontOverhang, rearOverhangStuds: rearOverhang, cockpitStartStuds: cockpitStart, cockpitLengthStuds: cockpitLength, hoodLengthStuds: hood, roofLengthStuds: roofLength },
    modules, dimensionBasis: knownCount === 4 ? 'source-backed' : knownCount === 0 ? 'estimated' : 'mixed', assumptions,
    sourceIds: [...new Set([...profile.identitySourceIds, ...Object.values(profile.dimensions).flatMap(fact => fact.sourceIds), ...profile.signatureFeatures.flatMap(fact => fact.sourceIds)])], warnings, planningMethod: 'discrete-module-replanning',
  };
}
