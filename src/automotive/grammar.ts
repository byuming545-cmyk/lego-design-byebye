import type { Measurement, ReferenceAnalysis } from './references/types.js';
import type { VehicleClass } from './research/types.js';

export type GrammarVehicleClass = Exclude<VehicleClass, 'unknown'>;
export type AutomotiveRatio = 'lengthWidth' | 'wheelbaseLength' | 'wheelDiameterBodyHeight' | 'cockpitPosition' | 'hoodProportion' | 'roofProportion' | 'sideSymmetry';
export type RatioRange = [number, number];
export interface GrammarDistribution {
  preferredRange: RatioRange;
  normalRange: RatioRange;
  /** An exploratory outer band. Outside this band deserves closer review. */
  unusualRange: RatioRange;
  source: 'engineer-prior' | 'reference-derived';
  sampleCount: number;
  sourceReferences: string[];
  observations: { sampleCount: number; mean: number | null; standardDeviation: number | null; min: number | null; max: number | null; sourceReferences: string[] };
  note: string;
}
export interface AutomotiveClassGrammar { vehicleType: GrammarVehicleClass; ratios: Record<AutomotiveRatio, GrammarDistribution> }
export interface AutomotiveGrammar {
  schemaVersion: 1;
  assemblyOrder: string[];
  classes: Record<GrammarVehicleClass, AutomotiveClassGrammar>;
  referenceCount: number;
  fallbackPrior: boolean;
  warnings: string[];
}
export interface ClassifiedReferenceSample {
  analysis: ReferenceAnalysis;
  vehicleType: GrammarVehicleClass;
  classificationEvidence: string[];
  /** Synthetic test models must never be reported as learned official-car data. */
  evidenceKind: 'imported-reference' | 'synthetic-fixture';
}
const classes: GrammarVehicleClass[] = ['luxury-sedan', 'performance-coupe', 'sports-car', 'gt', 'supercar'];
const ratioNames: AutomotiveRatio[] = ['lengthWidth', 'wheelbaseLength', 'wheelDiameterBodyHeight', 'cockpitPosition', 'hoodProportion', 'roofProportion', 'sideSymmetry'];
const record = <K extends string, V>(keys: readonly K[], factory: (key: K) => V): Record<K, V> => Object.fromEntries(keys.map(key => [key, factory(key)])) as Record<K, V>;
type PriorRow = [RatioRange, RatioRange, RatioRange];
const sharedSymmetry: PriorRow = [[0.96, 1], [0.88, 1], [0.65, 1]];
/** Explicit design estimates, not measurements of official LEGO sets. */
const priors: Record<GrammarVehicleClass, Record<AutomotiveRatio, PriorRow>> = {
  'luxury-sedan': { lengthWidth: [[2.8, 3.35], [2.5, 3.7], [2.1, 4.2]], wheelbaseLength: [[0.57, 0.66], [0.5, 0.71], [0.42, 0.78]], wheelDiameterBodyHeight: [[0.42, 0.64], [0.32, 0.8], [0.24, 1.05]], cockpitPosition: [[0.3, 0.4], [0.24, 0.46], [0.15, 0.55]], hoodProportion: [[0.25, 0.34], [0.18, 0.42], [0.1, 0.5]], roofProportion: [[0.3, 0.43], [0.24, 0.5], [0.15, 0.6]], sideSymmetry: sharedSymmetry },
  'performance-coupe': { lengthWidth: [[2.55, 3.05], [2.2, 3.5], [1.85, 3.9]], wheelbaseLength: [[0.54, 0.63], [0.46, 0.7], [0.38, 0.78]], wheelDiameterBodyHeight: [[0.48, 0.72], [0.36, 0.88], [0.26, 1.1]], cockpitPosition: [[0.32, 0.43], [0.24, 0.5], [0.16, 0.6]], hoodProportion: [[0.27, 0.37], [0.19, 0.44], [0.1, 0.54]], roofProportion: [[0.24, 0.36], [0.18, 0.44], [0.1, 0.55]], sideSymmetry: sharedSymmetry },
  'sports-car': { lengthWidth: [[2.35, 2.95], [2.05, 3.3], [1.75, 3.8]], wheelbaseLength: [[0.5, 0.61], [0.43, 0.68], [0.35, 0.76]], wheelDiameterBodyHeight: [[0.5, 0.78], [0.38, 0.95], [0.28, 1.2]], cockpitPosition: [[0.28, 0.45], [0.2, 0.53], [0.1, 0.64]], hoodProportion: [[0.2, 0.35], [0.12, 0.44], [0.05, 0.55]], roofProportion: [[0.21, 0.34], [0.15, 0.43], [0.08, 0.55]], sideSymmetry: sharedSymmetry },
  gt: { lengthWidth: [[2.65, 3.2], [2.3, 3.6], [1.95, 4]], wheelbaseLength: [[0.52, 0.63], [0.45, 0.7], [0.37, 0.78]], wheelDiameterBodyHeight: [[0.47, 0.72], [0.35, 0.9], [0.25, 1.15]], cockpitPosition: [[0.36, 0.46], [0.28, 0.54], [0.18, 0.65]], hoodProportion: [[0.3, 0.41], [0.23, 0.48], [0.14, 0.57]], roofProportion: [[0.22, 0.34], [0.16, 0.43], [0.08, 0.55]], sideSymmetry: sharedSymmetry },
  supercar: { lengthWidth: [[2.3, 2.85], [2, 3.2], [1.7, 3.7]], wheelbaseLength: [[0.51, 0.63], [0.44, 0.7], [0.36, 0.78]], wheelDiameterBodyHeight: [[0.6, 0.87], [0.45, 1.05], [0.3, 1.3]], cockpitPosition: [[0.24, 0.37], [0.17, 0.46], [0.08, 0.57]], hoodProportion: [[0.17, 0.28], [0.1, 0.37], [0.04, 0.48]], roofProportion: [[0.2, 0.31], [0.14, 0.4], [0.07, 0.51]], sideSymmetry: sharedSymmetry },
};

export function createPriorAutomotiveGrammar(): AutomotiveGrammar {
  return {
    schemaVersion: 1,
    assemblyOrder: ['chassis', 'wheelModules', 'body', 'cockpit', 'bodyShell', 'details'],
    classes: record(classes, vehicleType => ({ vehicleType, ratios: record<AutomotiveRatio, GrammarDistribution>(ratioNames, name => {
      const [preferredRange, normalRange, unusualRange] = priors[vehicleType][name];
      return { preferredRange: [...preferredRange], normalRange: [...normalRange], unusualRange: [...unusualRange], source: 'engineer-prior', sampleCount: 0, sourceReferences: [], observations: { sampleCount: 0, mean: null, standardDeviation: null, min: null, max: null, sourceReferences: [] }, note: 'Engineering estimate; no reference-model samples have been learned for this distribution.' };
    }) })),
    referenceCount: 0,
    fallbackPrior: true,
    warnings: ['No qualified reference-model samples: automotive proportions use explicit engineering priors.'],
  };
}

export function ratioRangeStatus(distribution: GrammarDistribution, value: number): 'preferred' | 'normal' | 'unusual' | 'outside' {
  const inside = ([min, max]: RatioRange) => Number.isFinite(value) && value >= min && value <= max;
  return inside(distribution.preferredRange) ? 'preferred' : inside(distribution.normalRange) ? 'normal' : inside(distribution.unusualRange) ? 'unusual' : 'outside';
}

function reliable(measurement: Measurement, unit: Measurement['unit'], confidence: number): number | null {
  return measurement.unit === unit && measurement.value !== null && Number.isFinite(measurement.value) && measurement.confidence >= confidence ? measurement.value : null;
}
/** Measurements with unknown semantics or insufficient native geometry stay unknown. */
export function referenceAutomotiveRatios(analysis: ReferenceAnalysis, minimumConfidence = 0.6): Partial<Record<AutomotiveRatio, number>> {
  const width = reliable(analysis.overall.width, 'stud', minimumConfidence), length = reliable(analysis.overall.length, 'stud', minimumConfidence), height = reliable(analysis.overall.height, 'plate', minimumConfidence);
  const wheelbase = reliable(analysis.overall.wheelbase, 'stud', minimumConfidence), wheelDiameter = reliable(analysis.wheels.diameter, 'stud', minimumConfidence);
  const cockpitStart = reliable(analysis.cockpit.start, 'stud', minimumConfidence), hoodLength = reliable(analysis.shape.hoodLength, 'stud', minimumConfidence);
  const ratios: Partial<Record<AutomotiveRatio, number>> = {};
  if (width !== null && width > 0 && length !== null && length > 0) ratios.lengthWidth = length / width;
  if (wheelbase !== null && wheelbase > 0 && length !== null && length > 0) ratios.wheelbaseLength = wheelbase / length;
  if (wheelDiameter !== null && wheelDiameter > 0 && height !== null && height > 0) ratios.wheelDiameterBodyHeight = wheelDiameter / (height * 0.4);
  if (length !== null && length > 0) {
    if (cockpitStart !== null && cockpitStart >= 0) ratios.cockpitPosition = cockpitStart / length;
    if (hoodLength !== null && hoodLength > 0) ratios.hoodProportion = hoodLength / length;
  }
  // Cockpit span includes glass and cannot prove roof length. Neither a confirmed
  // roof-length measurement nor a symmetry measurement is currently available.
  return ratios;
}
function quantile(sorted: number[], q: number): number {
  const index = (sorted.length - 1) * q, low = Math.floor(index), t = index - low;
  return sorted[low] * (1 - t) + sorted[Math.min(sorted.length - 1, low + 1)] * t;
}

/** Classifications must be explicit; model names and brand names are not class evidence. */
export function buildAutomotiveGrammar(input: readonly (ClassifiedReferenceSample | ReferenceAnalysis)[] = [], options: { minimumSamples?: number; minimumConfidence?: number } = {}): AutomotiveGrammar {
  const grammar = createPriorAutomotiveGrammar();
  const samples: ClassifiedReferenceSample[] = input.flatMap(sample => {
    if ('analysis' in sample) return [sample];
    const vehicleType = sample.metadata.vehicleType;
    return vehicleType && vehicleType !== 'unknown' ? [{ analysis: sample, vehicleType, classificationEvidence: ['Explicit user-supplied reference metadata vehicleType annotation.'], evidenceKind: 'imported-reference' as const }] : [];
  });
  const minimumSamples = Math.max(3, Math.floor(options.minimumSamples ?? 3)), minimumConfidence = Math.max(0.5, Math.min(1, options.minimumConfidence ?? 0.6));
  const qualified = samples.filter(sample => sample.evidenceKind === 'imported-reference' && classes.includes(sample.vehicleType) && sample.classificationEvidence.some(value => value.trim()) && sample.analysis.metadata.license !== 'unknown' && sample.analysis.metadata.source.trim() && sample.analysis.coverage.geometryRate >= 0.8);
  const qualifiedIds = [...new Set(qualified.map(sample => sample.analysis.referenceId))];
  grammar.referenceCount = qualifiedIds.length;
  grammar.warnings = [];
  if (samples.some(sample => sample.evidenceKind === 'synthetic-fixture')) grammar.warnings.push('Synthetic fixtures were excluded from reference-derived statistics.');
  let derived = 0;
  for (const vehicleClass of classes) for (const ratioName of ratioNames) {
    const seen = new Set<string>();
    const observations = qualified.filter(sample => sample.vehicleType === vehicleClass).flatMap(sample => {
      if (seen.has(sample.analysis.referenceId)) return [];
      const value = referenceAutomotiveRatios(sample.analysis, minimumConfidence)[ratioName];
      if (value === undefined || !Number.isFinite(value)) return [];
      seen.add(sample.analysis.referenceId);
      return [{ referenceId: sample.analysis.referenceId, value }];
    });
    const distribution = grammar.classes[vehicleClass].ratios[ratioName], values = observations.map(observation => observation.value).sort((a, b) => a - b), n = values.length;
    if (!n) continue;
    const mean = values.reduce((sum, value) => sum + value, 0) / n;
    distribution.observations = { sampleCount: n, mean, standardDeviation: Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / n), min: values[0], max: values[n - 1], sourceReferences: observations.map(observation => observation.referenceId) };
    if (n < minimumSamples) {
      distribution.note = `${n} distinct reference observation(s), below the ${minimumSamples}-sample minimum. Ranges remain engineering priors; observations are reported separately.`;
      continue;
    }
    // Keep a visible minimum band around small/identical samples instead of a zero-width rule.
    const floor = (distribution.normalRange[1] - distribution.normalRange[0]) * 0.075, middle = quantile(values, 0.5);
    distribution.preferredRange = [Math.min(quantile(values, 0.25), middle - floor), Math.max(quantile(values, 0.75), middle + floor)];
    distribution.normalRange = [Math.min(quantile(values, 0.1), distribution.preferredRange[0] - floor), Math.max(quantile(values, 0.9), distribution.preferredRange[1] + floor)];
    const spread = Math.max(floor, (quantile(values, 0.75) - quantile(values, 0.25)) * 0.5);
    distribution.unusualRange = [Math.max(0, Math.min(values[0] - spread, distribution.normalRange[0] - floor)), Math.max(values[n - 1] + spread, distribution.normalRange[1] + floor)];
    distribution.source = 'reference-derived';
    distribution.sampleCount = n;
    distribution.sourceReferences = [...distribution.observations.sourceReferences];
    distribution.note = `Descriptive quantile bands from ${n} distinct classified reference models, with a small minimum band; not an absolute construction constraint.`;
    derived++;
  }
  grammar.fallbackPrior = derived === 0;
  if (!derived) grammar.warnings.push(`No distribution has ${minimumSamples} qualified distinct reference samples: engineering prior ranges remain active.`);
  else grammar.warnings.push('Unmeasured or insufficiently sampled ratios remain explicit engineering priors. Reference-derived bands are descriptive, not hard limits.');
  return grammar;
}

export const learnAutomotiveGrammar = buildAutomotiveGrammar;
