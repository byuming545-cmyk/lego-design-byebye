import type { PackedVehicleCandidate } from '../speed/stepCodec.js';
import type { LegoDesignPattern } from './patterns.js';
import type { AutomotiveGrammar } from './grammar.js';
import type { AutomotiveDesignValidation } from './quality.js';
import type { ReferenceAnalysis, ReferenceLink, ReferenceVehicleModel } from './references/types.js';
import type { RealVehicleProfile, VehicleDesignBrief } from './research/types.js';
import type { ReferenceSet } from './retrieval.js';
import type { AutomotiveCoarsePlan } from './generator/types.js';
import type { resolveAutomotiveColor } from './palette.js';

export interface AutomotiveCandidateResponse {
  id: string;
  name: string;
  candidate: PackedVehicleCandidate;
  scores: { automotiveDesign: number; legoStyle: number; referenceSimilarity: number; overall: number; structure: number; buildability: number; method: 'geometric-heuristic' };
  reasons: string[];
  exportable: boolean;
  warnings: string[];
  designValidation: AutomotiveDesignValidation;
}
export interface AutomotiveDesignResponse {
  schemaVersion: 1;
  sessionId: string;
  createdAt: string;
  status: 'accepted' | 'rejected' | 'unsupported';
  message: string;
  profile: RealVehicleProfile;
  brief: VehicleDesignBrief;
  color: ReturnType<typeof resolveAutomotiveColor>;
  references: ReferenceSet;
  referenceAnalyses: ReferenceAnalysis[];
  patterns: LegoDesignPattern[];
  candidates: AutomotiveCandidateResponse[];
  debug: {
    grammar: AutomotiveGrammar;
    plans: AutomotiveCoarsePlan[];
    diagnostics: { planId: string; status: string; partCount: number; errors: string[] }[];
    rejections: { candidateId: string; hardErrors: string[]; designErrors: string[]; scores?: AutomotiveCandidateResponse['scores'] }[];
    candidateAssessments: { candidateId: string; rank: number | null; designValidation: AutomotiveDesignValidation }[];
    physicalBuildsVerified: 0;
    imageAnalysis: 'not-configured';
    realModelCount: number;
  };
  warnings: string[];
}
export interface AutomotiveReferenceResponse {
  models: ReferenceVehicleModel[];
  links: ReferenceLink[];
  analyses: ReferenceAnalysis[];
}
