/** Research facts never acquire confidence simply because a catalogue entry exists. */
export type VehicleFactStatus = 'unknown' | 'catalog_seed' | 'manual' | 'live_verified';
export type VehicleClass = 'luxury-sedan' | 'performance-coupe' | 'sports-car' | 'gt' | 'supercar' | 'unknown';
export interface VehicleFact<T> {
  value: T | null;
  status: VehicleFactStatus;
  sourceIds: string[];
  note?: string;
}
export interface ResearchSource {
  id: string;
  kind: 'official' | 'catalog_seed' | 'user';
  title: string;
  url: string | null;
  /** A target URL is not evidence that its contents were retrieved. */
  accessStatus: 'not_fetched' | 'blocked' | 'fetched' | 'failed' | 'user_supplied';
  accessedAt: string | null;
  attribution: string;
  notes: string[];
}
export type VehicleImageAngle = 'front' | 'front-three-quarter' | 'side' | 'rear-three-quarter' | 'rear' | 'unknown';
export interface VehicleReferenceImage {
  angle: VehicleImageAngle;
  url: string;
  source: string;
  /** No vision system is configured in V0.3. Image links are metadata only. */
  analysisStatus: 'not_analyzed';
}
export interface RealVehicleProfile {
  id: string;
  manufacturer: string;
  model: string;
  generation: string | null;
  vehicleType: VehicleClass;
  identitySourceIds: string[];
  aliases: string[];
  dimensions: {
    lengthMm: VehicleFact<number>;
    /** Body width excluding mirrors; ambiguous upstream widths remain unknown. */
    widthMm: VehicleFact<number>;
    heightMm: VehicleFact<number>;
    wheelbaseMm: VehicleFact<number>;
  };
  visualFeatures: {
    hoodLengthRatio: VehicleFact<number>;
    roofline: VehicleFact<string>;
    cabinPositionRatio: VehicleFact<number>;
    doorCount: VehicleFact<number>;
    frontDesign: VehicleFact<string>;
    grille: VehicleFact<string>;
    headlights: VehicleFact<string>;
    rearDesign: VehicleFact<string>;
    wheelArchCharacter: VehicleFact<string>;
  };
  signatureFeatures: VehicleFact<string>[];
  featureTags: string[];
  referenceImages: VehicleReferenceImage[];
  sources: ResearchSource[];
  researchStatus: 'pending' | 'partial' | 'verified' | 'manual';
  warnings: string[];
}
export interface VehicleResearchAttempt {
  sourceId: string;
  url: string;
  status: 'fetched' | 'failed';
  errorCode?: string;
  message?: string;
}
export interface VehicleResearchResult {
  status: 'catalog_seed' | 'live_verified' | 'partial' | 'failed' | 'not_found';
  profile: RealVehicleProfile | null;
  attempts: VehicleResearchAttempt[];
  warnings: string[];
}
export type AutomotiveModuleId = 'chassis' | 'front' | 'hood' | 'cockpit' | 'roof' | 'leftSide' | 'rightSide' | 'rear' | 'wheelModules' | 'aero' | 'details';
export interface VehicleModuleTarget {
  widthStuds: number;
  lengthStuds: number;
  heightPlates: number;
  startStuds: number;
}
export interface BriefAssumption { field: string; reason: string; sourceIds: string[] }
export interface VehicleDesignBrief {
  profileId: string;
  targetVehicle: string;
  vehicleClass: VehicleClass;
  targetWidthStuds: number;
  widthSelection: 'user' | 'recommended';
  identityPriorities: string[];
  secondaryFeatures: string[];
  featureTags: string[];
  proportions: {
    lengthStuds: number;
    wheelbaseStuds: number;
    heightPlates: number;
    wheelDiameterStuds: number;
    frontOverhangStuds: number;
    rearOverhangStuds: number;
    cockpitStartStuds: number;
    cockpitLengthStuds: number;
    hoodLengthStuds: number;
    roofLengthStuds: number;
  };
  modules: Record<AutomotiveModuleId, VehicleModuleTarget>;
  dimensionBasis: 'source-backed' | 'mixed' | 'estimated';
  assumptions: BriefAssumption[];
  sourceIds: string[];
  warnings: string[];
  planningMethod: 'discrete-module-replanning';
}
export interface VehicleBriefOptions {
  /** Omitting a width explicitly records a recommended design choice. */
  widthStuds?: number;
  /** Opt in to engineering class priors when real dimensions are unavailable. */
  allowEstimatedProportions?: boolean;
}
