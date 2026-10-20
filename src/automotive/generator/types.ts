import type { LegoDesignPattern } from '../patterns.js';
import type { ReferenceAnalysis } from '../references/types.js';
import type { AutomotiveModuleId, VehicleClass, VehicleDesignBrief } from '../research/types.js';
import type { VehicleCandidate, VehicleModel, VehicleModuleId } from '../../speed/types.js';
import type { PartColor } from '../../types/index.js';

export type AutomotiveWidth = 8 | 10 | 12;
/** These dimensions describe separate modular layouts, never scaled part transforms. */
export interface AutomotiveWidthLayout {
  widthStuds: AutomotiveWidth;
  chassisWidthStuds: number;
  hoodWidthStuds: number;
  cabinWidthStuds: number;
  roofWidthStuds: number;
  grilleWidthStuds: number;
  shoulderWidthStuds: number;
  reinforcementRailOffsets: readonly number[];
}
export interface AutomotiveModuleLayout {
  moduleId: AutomotiveModuleId;
  speedModuleId: VehicleModuleId;
  x: number;
  y: number;
  z: number;
  widthStuds: number;
  lengthStuds: number;
  heightPlates: number;
}
export interface AutomotivePatternChoice {
  moduleId: AutomotiveModuleId;
  patternId: string;
  reason: string;
  sourceReferences: string[];
  status: 'recommended' | 'instantiated';
  /** Empty for a recommendation; actual uses refer to emitted canonical parts. */
  instanceIds: string[];
}
export interface AutomotivePlanningEvidence {
  field: string;
  value: number;
  basis: 'brief' | 'reference-measurement' | 'discrete-layout' | 'verified-wheel-registry';
  referenceId?: string;
  confidence?: number;
}
export interface AutomotiveWheelKeepout {
  axle: 'front' | 'rear';
  side: 'left' | 'right';
  axis: 'x';
  center: { x: number; y: number; z: number };
  radiusStuds: number;
  axialWidthStuds: number;
}
export interface AutomotiveCoarsePlan {
  id: string;
  profileId: string;
  vehicleClass: VehicleClass;
  variant: number;
  /** Internal axes: x lateral, y longitudinal, z in plates; vehicle front is y=0. */
  coordinateSystem: 'speed-x-width-y-front-to-rear-z-plates';
  planningMethod: 'discrete-module-replanning';
  layout: AutomotiveWidthLayout;
  lengthStuds: number;
  frontAxleStuds: number;
  rearAxleStuds: number;
  wheelbaseStuds: number;
  trackStuds: number | null;
  wheelAssemblyId: string | null;
  wheelDiameterStuds: number | null;
  /** Source-calibrated rotating tyre volumes reserved before body placement. */
  wheelKeepouts: AutomotiveWheelKeepout[];
  hoodLengthStuds: number;
  cabinStartStuds: number;
  cabinLengthStuds: number;
  roofStartStuds: number;
  roofLengthStuds: number;
  roofHeightPlates: number;
  beltlineHeightPlates: number;
  grilleHeightPlates: number;
  modules: Record<AutomotiveModuleId, AutomotiveModuleLayout>;
  patternChoices: AutomotivePatternChoice[];
  /** Retrieval suggestions remain separate from assemblies actually emitted. */
  recommendedPatternChoices?: AutomotivePatternChoice[];
  evidence: AutomotivePlanningEvidence[];
  /** A blocked plan is useful diagnostics, and must never become a generated candidate. */
  status: 'ready' | 'blocked';
  blockers: string[];
  warnings: string[];
}
export interface AutomotivePlanningOptions {
  candidateCount?: number;
  references?: readonly ReferenceAnalysis[];
  patterns?: readonly LegoDesignPattern[];
}
export interface AutomotivePlanningResult {
  plans: AutomotiveCoarsePlan[];
  warnings: string[];
}
/** Speed compatibility aliases keep existing viewers, BOM, step codec and exports reusable. */
export type AutomotiveVehicleModel = VehicleModel;
export type AutomotiveVehicleCandidate = VehicleCandidate;
export interface AutomotiveGeneratorRequest extends AutomotivePlanningOptions {
  brief: VehicleDesignBrief;
  /** A true palette colour; absence selects the neutral default paint. */
  requestedColor?: PartColor;
  prompt?: string;
}
export interface AutomotiveGenerationDiagnostic {
  planId: string;
  candidateId?: string;
  status: 'blocked' | 'placement-failed' | 'physics-rejected' | 'physics-valid';
  partCount: number;
  errors: string[];
}
export interface AutomotiveGenerationRejection {
  planId: string;
  stage: 'planning' | 'placement' | 'physics';
  errors: string[];
}
export interface AutomotiveGenerationResult {
  plans: AutomotiveCoarsePlan[];
  /** Every physically valid coarse candidate is ranked by the integration.
   * Build steps are generated only after final quality selection. */
  candidates: VehicleCandidate[];
  diagnostics: AutomotiveGenerationDiagnostic[];
  rejections: AutomotiveGenerationRejection[];
  warnings: string[];
}
