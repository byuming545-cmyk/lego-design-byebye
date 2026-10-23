import type { AssemblyVersions } from './types.js';
import type { AssemblyVerificationCheck, NativePartAssemblyVerification } from './verification.js';
import type { PhysicalInterfaceDecision } from './coverage.js';

export const INTERFACE_TEST_VERSION = 'native-interface-suite-0.6.0-worker-2';
export interface FixtureSourceBinding { role: string; partId: string | null; sourceHash: string | null; geometryHash: string | null; connectionMetadataHash: string | null }
export interface InterfaceTestContext extends AssemblyVersions {
  contextId: string;
  testVersion: string;
  partId: string;
  partSourceHash: string;
  geometryHash: string;
  connectionMetadataHash: string;
  fixtureSetHash: string;
  fixtures: FixtureSourceBinding[];
}
export interface InterfaceTestRecord extends PhysicalInterfaceDecision {
  schemaVersion: 1;
  testVersion: string;
  partId: string;
  context: InterfaceTestContext;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  attempts: number;
  sourceChecks: AssemblyVerificationCheck[];
  execution: 'direct-test' | 'shared-source-precondition' | 'review-dependency';
  relatedCaseIds: string[];
  caseId: string;
  fixturePartId: string | null;
  fixtureSourceHash: string | null;
}
export interface DeferredWorkerRequest {
  partId: string;
  physicalInterfaceIds: string[];
  context: InterfaceTestContext;
}
export type DeferredWorkerMessage =
  | { type: 'ready'; context: InterfaceTestContext; base: NativePartAssemblyVerification; terminalPrecondition: boolean }
  | { type: 'start'; physicalInterfaceId: string }
  | { type: 'record'; record: InterfaceTestRecord }
  | { type: 'complete' }
  | { type: 'fatal'; reason: string };
