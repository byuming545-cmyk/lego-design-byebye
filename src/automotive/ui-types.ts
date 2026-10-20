import type {
  VehicleDesignBrief,
  RealVehicleProfile,
  VehicleResearchResult,
} from './research/types.js';
import type { ReferenceLibraryEntry, ReferenceAnalysis } from './references/types.js';
import type { LegoDesignPattern } from './patterns.js';
import type {
  SpeedBuildStep,
  SpeedPartDefinition,
  SpeedPlacedPart,
  VehicleValidation,
} from '../speed/types.js';
import type { AutomotiveDesignValidation } from './quality.js';
import type { ReferenceSet } from './retrieval.js';
import type { PartColor } from '../types/index.js';

/** Browser view models. Quantities are requirements, never claims of ownership. */
export interface AutomotiveScores {
  overall: number;
  legoStyle: number;
  automotiveDesign?: number;
  referenceSimilarity: number;
  structure: number;
  buildability: number;
}
export interface AutomotiveCandidateView {
  id: string;
  name: string;
  description: string;
  parts: SpeedPlacedPart[];
  steps: SpeedBuildStep[];
  scores: AutomotiveScores;
  reasons: string[];
  warnings: string[];
  validation: VehicleValidation;
  exportable: boolean;
  rejectionReasons: string[];
  patternIds: string[];
  dimensions: { x: number; y: number; z: number };
  designValidation: AutomotiveDesignValidation;
}
export interface AutomotiveStatusView {
  version: string;
  palette: SpeedPartDefinition[];
  profiles: RealVehicleProfile[];
  warnings: string[];
  rankingWeights?: Record<string, number>;
}
export interface AutomotivePatternLibraryView {
  confirmed: LegoDesignPattern[];
  candidates: LegoDesignPattern[];
  sourceModelsAssessed: number;
  remainingModels: number;
  warnings: string[];
}
export interface AutomotiveSessionView {
  sessionId: string;
  profile: RealVehicleProfile;
  research?: VehicleResearchResult;
  brief: VehicleDesignBrief;
  color: { actual: PartColor; substituted: boolean; reason: string };
  candidates: AutomotiveCandidateView[];
  references: ReferenceLibraryEntry[];
  referenceSet: ReferenceSet;
  referenceAnalyses: ReferenceAnalysis[];
  patterns: LegoDesignPattern[];
  warnings: string[];
  debug: unknown;
  message: string;
  status: 'accepted' | 'rejected' | 'unsupported';
}
export interface AutomotiveDesignInput {
  profileId: string;
  widthStuds: number;
  allowEstimatedProportions: boolean;
  candidateCount: number;
  referenceIds: string[];
  bodyColor: { id: number; name: string; hex: string };
  weights?: Record<string, number>;
}
