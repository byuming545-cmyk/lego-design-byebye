import type { Connector, ConnectorCoverage, ConnectorFamily, ConnectorRole, JointType } from '../grammar/schema.js';
import type { ConnectionImportIssue, ImportedConnectionPoint } from '../connections/types.js';

export type InterfaceUseStatus = 'production' | 'source-ready' | 'partial' | 'unresolved';
export type RuleUseStatus = 'production' | 'conditional' | 'source-declared' | 'specification-only';
export type CaseStatus = 'validated' | 'blocked' | 'unknown';
export type FeedbackKind = 'reasonable' | 'position-direction-wrong' | 'interface-identification-wrong' | 'should-not-mate' | 'insufficient-evidence';
export type FeedbackStatus = 'open' | 'triaged' | 'needs-evidence' | 'accepted-for-review' | 'rejected' | 'resolved';

export interface LibraryVersions {
  schema: string; grammar: string; admission: string; partLibrary: string;
  assemblyEngine: string; connectionRule: string; collision: string;
}

export interface InterfaceTypeRecord {
  id: ConnectorFamily;
  label: string;
  description: string;
  organizationalOnly: true;
  rules: string[];
  productionRules: string[];
  instanceCount: number;
  partCount: number;
  complete: number;
  partial: number;
  unresolved: number;
  status: InterfaceUseStatus;
  notes: string[];
}

export interface InterfaceInstanceSummary {
  id: string;
  partId: string;
  partName: string;
  featureId: string;
  sourceConnectionId: string | null;
  family: ConnectorFamily;
  role: ConnectorRole;
  profile: Connector['profile'];
  coverage: ConnectorCoverage;
  status: InterfaceUseStatus;
  supported: boolean;
  enabled: boolean;
  nativeRuleIds: string[];
  sourcePath: string | null;
  sourceLine: number | null;
  sourceRaw: string | null;
  sourceSha256: string | null;
  position: [number, number, number];
  axis: [number, number, number];
  dimensions: Connector['dimensions'];
  insertionRangeLdu: [number, number] | null;
  slideAllowed: boolean | null;
  rotationAllowed: boolean | null;
  unknownFields: string[];
  diagnostics: { code: string; message: string }[];
  issue: string | null;
  caseIds: string[];
}

export interface InterfaceInstanceDetail extends InterfaceInstanceSummary {
  connector: Connector;
  part: {
    id: string; name: string; bounds: { min: [number, number, number]; max: [number, number, number] } | null;
    generationEligible: boolean; connectable: boolean; collisionGeometryReady: boolean; sourceReady: boolean;
    reasons: string[]; allowedConnectionIds: string[]; ruleIds: string[];
  };
  relatedRules: JointRuleDetail[];
  sourceFiles: { library: string; path: string; revision: string; sha256: string; license: string; sourceUrl: string; line?: number; raw?: string }[];
  rawPoints: ImportedConnectionPoint[];
  issues: ConnectionImportIssue[];
  feedback: FeedbackRecord[];
}

export interface JointRuleRecord {
  id: string;
  label: string;
  description: string;
  maleFamilies: string[];
  femaleFamilies: string[];
  evidenceRequired: string;
  nativeRuleId: string | null;
  production: boolean;
  status: RuleUseStatus;
  instanceCount: number;
  partCount: number;
  caseIds: string[];
  conditions: string[];
  missingEvidence: string[];
  negativeControls: string[];
  docs: string[];
  versions: { grammar: string; connectionRule: string | null };
}

export interface JointRuleDetail extends JointRuleRecord {
  cases: ConnectionCaseSummary[];
  examples: InterfaceInstanceSummary[];
  sources: string[];
  jointTypes: JointType[];
}

export interface ConnectionCaseSummary {
  id: string;
  label: string;
  ruleId: string;
  status: CaseStatus;
  fixedPartId: string;
  movingPartId: string;
  summary: string;
  caseType: 'production' | 'blocked' | 'specification';
  sourceDeclared: boolean;
  physicalBuildVerified: false;
}

export interface CaseTransform { rotation: [number, number, number, number, number, number, number, number, number]; translation: [number, number, number] }
export interface CasePlacement { instanceId: string; partId: string; transform: CaseTransform }
export interface ConnectionCaseDetail extends ConnectionCaseSummary {
  fixed: InterfaceInstanceSummary;
  moving: InterfaceInstanceSummary;
  edge: {
    fixedInstanceId: string; fixedConnectionId: string; movingInstanceId: string; movingConnectionId: string;
    ruleId: string; ruleVersion: string; axis: [number, number, number]; anchor: [number, number, number];
    insertionDepthLdu: number; twistDeg: number;
  } | null;
  placements: CasePlacement[];
  allowedTwistsDeg: number[];
  allowedRelativeOrientations: string[];
  jointTypes: JointType[];
  validation: {
    engineAccepted: boolean;
    graphValid: boolean;
    importStatus: 'VALID' | 'NEEDS_REVALIDATION' | 'NOT_RUN';
    collisionStatus: 'clear' | 'collision' | 'blocked' | 'not-run';
    reasons: string[];
    rejectionCodes: string[];
    installationPath: 'source-axis-pose-only' | 'not-validated';
    physicalBuildVerified: false;
  };
  modelMeta: { bom: { partId: string; name: string; quantity: number }[]; steps: number; sources: number; exportBytes: number | null; contentSha256: string | null } | null;
  displayNotice: string;
  versions: LibraryVersions;
  feedback: FeedbackRecord[];
}

export interface ReviewItem {
  id: string;
  category: 'missing-source' | 'partial-parse' | 'unsupported-rule' | 'uncertain-collision' | 'assembly-failure' | 'human-dispute';
  severity: 'info' | 'warning' | 'blocking';
  title: string;
  detail: string;
  partId: string | null;
  featureId: string | null;
  ruleId: string | null;
  caseId: string | null;
  code: string;
  openFeedback: number;
}

export interface LibraryOverview {
  versions: LibraryVersions;
  generatedAt: string;
  counts: {
    parts: number; interfaces: number; types: number; rules: number; productionRules: number;
    productionInterfaces: number; sourceReadyInterfaces: number; partialInterfaces: number; unresolvedInterfaces: number;
    cases: number; validatedCases: number; blockedCases: number; openFeedback: number;
  };
  types: InterfaceTypeRecord[];
  rules: JointRuleRecord[];
  recentCases: ConnectionCaseSummary[];
  limitations: string[];
}

export interface FeedbackEvidenceSnapshot {
  interfaceStatus: string | null;
  ruleId: string | null;
  ruleVersion: string | null;
  grammarVersion: string;
  partLibraryVersion: string;
  collisionVersion: string;
  sourceDigest: string | null;
  conclusion: string;
  sourceIds: string[];
}

export interface FeedbackTarget {
  kind: 'interface' | 'rule' | 'case' | 'comparison';
  id: string;
  partId?: string;
  featureId?: string;
  ruleId?: string;
  caseId?: string;
}

export interface FeedbackRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  kind: FeedbackKind;
  status: FeedbackStatus;
  target: FeedbackTarget;
  message: string;
  author: string;
  view: string;
  attachment: { kind: 'link'; url: string; note: string } | { kind: 'none'; note: string };
  evidence: FeedbackEvidenceSnapshot;
  handling: { status: FeedbackStatus; note: string; updatedAt: string; reviewer: string | null; history: { at: string; status: FeedbackStatus; note: string; reviewer: string | null }[] };
  softwareConclusion: string;
  humanObservation: true;
  canAuthorizeRule: false;
}

export interface FeedbackInput {
  kind: FeedbackKind;
  target: FeedbackTarget;
  message: string;
  author?: string;
  view?: string;
  attachment?: { kind: 'link'; url: string; note?: string } | { kind: 'none'; note?: string };
  evidence?: Partial<FeedbackEvidenceSnapshot>;
}

export interface FeedbackPatch {
  status?: FeedbackStatus;
  note?: string;
  reviewer?: string;
}

export type ComparisonClass = 'exact' | 'candidate' | 'conflict' | 'insufficient';
export interface ComparisonCandidate {
  interfaceId: string;
  featureId: string;
  family: ConnectorFamily;
  role: ConnectorRole;
  classification: ComparisonClass;
  matchedRuleIds: string[];
  reasons: string[];
  failedConditions: string[];
  sourceIds: string[];
  counterpart: {
    partId: string; featureId: string; sourceConnectionId: string | null; family: ConnectorFamily; role: ConnectorRole;
    compatibility: string | null; solver: string | null; collision: string | null;
  } | null;
  formalAssembly: { status: 'accepted' | 'rejected' | 'not-run'; reasons: string[]; modelId: string | null } | null;
}

export interface PartComparison {
  partId: string;
  partName: string;
  targetPartId: string | null;
  generatedAt: string;
  versions: LibraryVersions;
  recognition: {
    interfaces: number; exact: number; candidate: number; conflict: number; insufficient: number;
    typeRecognition: 'source-declared' | 'partial' | 'unresolved';
    ruleMatch: 'matched' | 'candidate' | 'none';
    assemblyPass: 'accepted' | 'rejected' | 'not-run';
    generationAdmission: false;
  };
  candidates: ComparisonCandidate[];
  limitations: string[];
}

export interface LibraryIndexSnapshot {
  overview: LibraryOverview;
  instances: InterfaceInstanceSummary[];
  cases: ConnectionCaseSummary[];
  rules: JointRuleRecord[];
  queue: ReviewItem[];
  connectors: Map<string, { connector: Connector; point: ImportedConnectionPoint; partId: string; partName: string }>;
}

