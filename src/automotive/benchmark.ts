import express, { type ErrorRequestHandler } from 'express';
import type { Server } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { InventoryError } from '../inventory/index.js';
import type { AutomotiveCandidateResponse, AutomotiveDesignResponse } from './contracts.js';
import type { RealVehicleProfile } from './research/types.js';
import type { AutomotiveDesignValidation } from './quality.js';

export interface AutomotiveBenchmarkCase { id: string; profileId: string; targetVehicle: string; widthStuds: 8 | 10 | 12 }
export const AUTOMOTIVE_BENCHMARK_CASES: readonly AutomotiveBenchmarkCase[] = Object.freeze([
  { id: 's63-8-wide', profileId: 'mercedes-amg-s63-w223', targetVehicle: 'Mercedes-AMG S 63 W223', widthStuds: 8 },
  { id: 's63-10-wide', profileId: 'mercedes-amg-s63-w223', targetVehicle: 'Mercedes-AMG S 63 W223', widthStuds: 10 },
  { id: 's63-12-wide', profileId: 'mercedes-amg-s63-w223', targetVehicle: 'Mercedes-AMG S 63 W223', widthStuds: 12 },
  { id: 'm4-8-wide', profileId: 'bmw-m4-g82', targetVehicle: 'BMW M4 G82', widthStuds: 8 },
  { id: '911-8-wide', profileId: 'porsche-911-992', targetVehicle: 'Porsche 911 992', widthStuds: 8 },
  { id: 'roma-8-wide', profileId: 'ferrari-roma', targetVehicle: 'Ferrari Roma', widthStuds: 8 },
  { id: 'revuelto-8-wide', profileId: 'lamborghini-revuelto', targetVehicle: 'Lamborghini Revuelto', widthStuds: 8 },
]);
export interface AutomotiveBenchmarkCliOptions {
  estimated: boolean;
  candidateCount: number;
  output: string;
  dataDir?: string;
  help: boolean;
}
export function parseAutomotiveBenchmarkArgs(args: readonly string[]): AutomotiveBenchmarkCliOptions {
  const result: AutomotiveBenchmarkCliOptions = { estimated: false, candidateCount: 8, output: 'artifacts/automotive-benchmark', help: false };
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index++) {
    const option = args[index];
    if (option === '--help' || option === '-h') { result.help = true; continue; }
    if (!['--estimated', '--candidate-count', '--output', '--data-dir'].includes(option)) throw new Error(`Unknown automotive benchmark option: ${option}`);
    if (seen.has(option)) throw new Error(`${option} may be provided only once.`);
    seen.add(option);
    if (option === '--estimated') { result.estimated = true; continue; }
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${option}.`);
    if (option === '--candidate-count') {
      if (!/^\d+$/.test(value) || Number(value) < 5 || Number(value) > 20) throw new Error('--candidate-count must be an integer from 5 to 20.');
      result.candidateCount = Number(value);
    } else if (option === '--output') result.output = value;
    else result.dataDir = value;
  }
  return result;
}

export type AutomotiveBenchmarkCaseStatus = 'nominal_geometry_pass' | 'quality_failed' | 'research_pending' | 'execution_failed';
export interface AutomotiveBenchmarkScores {
  automotiveDesignScore: number | null;
  legoStyle: number | null;
  vehicleSimilarity: number | null;
  structure: number | null;
  buildability: number | null;
  weightedTotal: number | null;
  method: 'geometric-heuristic';
}
const unavailableScores = (): AutomotiveBenchmarkScores => ({ automotiveDesignScore: null, legoStyle: null, vehicleSimilarity: null, structure: null, buildability: null, weightedTotal: null, method: 'geometric-heuristic' });
export interface AutomotiveBenchmarkCandidate {
  candidateId: string;
  planId: string | null;
  status: 'accepted' | 'rejected' | 'not-selected';
  rank: number | null;
  partCount: number | null;
  scores: AutomotiveBenchmarkScores;
  physicalValid: boolean | null;
  designAccepted: boolean | null;
  hardErrors: string[];
  designErrors: string[];
  warnings: string[];
  modelArtifact: string | null;
}
export interface AutomotiveBenchmarkCaseResult extends AutomotiveBenchmarkCase {
  status: AutomotiveBenchmarkCaseStatus;
  httpStatus: number;
  message: string;
  errorCode: string | null;
  generationTimeMs: number;
  estimated: boolean;
  dimensionBasis: 'source-backed' | 'mixed' | 'estimated' | null;
  unknownDimensionFields: string[];
  researchStatus: RealVehicleProfile['researchStatus'] | null;
  sources: { id: string; kind: string; url: string | null; accessStatus: string }[];
  blockedSourceCount: number;
  libraryReferenceCount: number;
  selectedReferenceCount: number;
  grammarReferenceCount: number;
  sessionId: string | null;
  previewPath: string | null;
  sessionArtifact: string | null;
  bestCandidateId: string | null;
  candidates: AutomotiveBenchmarkCandidate[];
  failures: { candidateId: string; hardErrors: string[]; designErrors: string[] }[];
  /** Captured paths may be attached after an actual browser screenshot run. */
  images: { status: 'pending' | 'captured'; paths: string[] };
  warnings: string[];
}
export interface AutomotiveBenchmarkReport {
  schemaVersion: 1;
  generatedAt: string;
  mode: 'estimated-concept' | 'source-required';
  candidateCount: number;
  dataDir: string;
  externalNetworkRequests: 0;
  physicalBuildsVerified: 0;
  visualResemblance: 'not-assessed';
  cases: AutomotiveBenchmarkCaseResult[];
  summary: { cases: number; nominalGeometryPassed: number; qualityFailed: number; researchPending: number; executionFailed: number; generatedSessions: number; acceptedCandidates: number };
  notes: string[];
}
export interface AutomotiveBenchmarkRun { report: AutomotiveBenchmarkReport; sessions: { caseId: string; response: AutomotiveDesignResponse }[] }
export interface AutomotiveBenchmarkOptions {
  estimated?: boolean;
  candidateCount?: number;
  dataDir?: string;
  /** The published benchmark uses the seven standard cases. Narrow lists aid focused runs. */
  cases?: readonly AutomotiveBenchmarkCase[];
  onCase?: (result: AutomotiveBenchmarkCaseResult) => void;
}
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
function automotiveScore(scores: AutomotiveCandidateResponse['scores']): number | null {
  return Number.isFinite(scores.automotiveDesign) ? scores.automotiveDesign : null;
}
function acceptedScores(candidate: AutomotiveCandidateResponse): AutomotiveBenchmarkScores {
  return { automotiveDesignScore: automotiveScore(candidate.scores), legoStyle: candidate.scores.legoStyle, vehicleSimilarity: candidate.scores.referenceSimilarity, structure: candidate.scores.structure, buildability: candidate.scores.buildability, weightedTotal: candidate.scores.overall, method: 'geometric-heuristic' };
}
function assessmentScores(validation: AutomotiveDesignValidation): AutomotiveBenchmarkScores {
  return { automotiveDesignScore: Number.isFinite(validation.scores.automotiveDesign) ? validation.scores.automotiveDesign : null, legoStyle: validation.scores.legoStyle, vehicleSimilarity: validation.scores.referenceSimilarity, structure: validation.scores.structure, buildability: validation.scores.buildability, weightedTotal: validation.overallScore, method: 'geometric-heuristic' };
}
const acceptedCandidate = (candidate: AutomotiveCandidateResponse) => candidate.designValidation.valid && candidate.designValidation.physicalValid && candidate.designValidation.designAccepted && candidate.exportable;

/** Pure reporting of API decisions; this never upgrades a failed or unassessed candidate. */
export function summarizeAutomotiveBenchmarkCase(test: AutomotiveBenchmarkCase, httpStatus: number, payload: unknown, options: { elapsedMs: number; estimated: boolean; profile?: RealVehicleProfile; libraryReferenceCount?: number }): AutomotiveBenchmarkCaseResult {
  const result: AutomotiveBenchmarkCaseResult = { ...test, status: 'execution_failed', httpStatus, message: 'Automotive API did not return a design response.', errorCode: null, generationTimeMs: Math.round(options.elapsedMs), estimated: options.estimated, dimensionBasis: null, unknownDimensionFields: [], researchStatus: options.profile?.researchStatus ?? null, sources: [], blockedSourceCount: 0, libraryReferenceCount: options.libraryReferenceCount ?? 0, selectedReferenceCount: 0, grammarReferenceCount: 0, sessionId: null, previewPath: null, sessionArtifact: null, bestCandidateId: null, candidates: [], failures: [], images: { status: 'pending', paths: [] }, warnings: [] };
  let profile = options.profile;
  if (httpStatus >= 200 && httpStatus < 300 && object(payload) && ['accepted', 'rejected', 'unsupported'].includes(String(payload.status)) && typeof payload.sessionId === 'string' && Array.isArray(payload.candidates) && object(payload.debug)) {
    const response = payload as unknown as AutomotiveDesignResponse;
    profile = response.profile;
    result.status = response.status === 'accepted' && response.candidates.length > 0 && response.candidates.every(acceptedCandidate) ? 'nominal_geometry_pass' : 'quality_failed';
    result.message = response.message;
    result.dimensionBasis = response.brief.dimensionBasis;
    result.estimated = response.brief.dimensionBasis !== 'source-backed';
    result.sessionId = response.sessionId;
    result.previewPath = `#/automotive-lab?session=${encodeURIComponent(response.sessionId)}`;
    result.selectedReferenceCount = response.references.references.length;
    result.libraryReferenceCount = response.debug.realModelCount;
    result.grammarReferenceCount = response.debug.grammar.referenceCount;
    result.bestCandidateId = response.candidates.find(acceptedCandidate)?.id ?? null;
    result.warnings = [...response.warnings];
    for (const [index, candidate] of response.candidates.entries()) result.candidates.push({ candidateId: candidate.id, planId: null, status: acceptedCandidate(candidate) ? 'accepted' : 'rejected', rank: index + 1, partCount: candidate.candidate.model.parts.length, scores: acceptedScores(candidate), physicalValid: candidate.designValidation.physicalValid, designAccepted: candidate.designValidation.designAccepted, hardErrors: [...candidate.designValidation.hardErrors], designErrors: [...candidate.designValidation.designErrors], warnings: [...candidate.warnings], modelArtifact: null });
    for (const diagnostic of response.debug.diagnostics) {
      const candidateId = (diagnostic as typeof diagnostic & { candidateId?: string }).candidateId ?? diagnostic.planId;
      const candidate = result.candidates.find(entry => entry.candidateId === candidateId);
      if (candidate) { candidate.planId = diagnostic.planId; continue; }
      result.candidates.push({ candidateId, planId: diagnostic.planId, status: diagnostic.status === 'physics-valid' ? 'not-selected' : 'rejected', rank: null, partCount: diagnostic.partCount, scores: unavailableScores(), physicalValid: diagnostic.status === 'physics-valid' ? true : diagnostic.status === 'physics-rejected' ? false : null, designAccepted: null, hardErrors: [...diagnostic.errors], designErrors: [], warnings: ['The API did not expose score records for this attempted candidate. Missing scores remain null.'], modelArtifact: null });
    }
    result.failures = response.debug.rejections.map(rejection => ({ candidateId: rejection.candidateId, hardErrors: [...rejection.hardErrors], designErrors: [...rejection.designErrors] }));
    for (const rejection of response.debug.rejections) {
      let candidate = result.candidates.find(entry => entry.candidateId === rejection.candidateId || entry.planId === rejection.candidateId);
      if (!candidate) {
        candidate = { candidateId: rejection.candidateId, planId: null, status: 'rejected', rank: null, partCount: null, scores: unavailableScores(), physicalValid: null, designAccepted: null, hardErrors: [], designErrors: [], warnings: ['Rejected candidate geometry or scores were not included in the API response.'], modelArtifact: null };
        result.candidates.push(candidate);
      }
      candidate.status = 'rejected';
      candidate.hardErrors = [...new Set([...candidate.hardErrors, ...rejection.hardErrors])];
      candidate.designErrors = [...new Set([...candidate.designErrors, ...rejection.designErrors])];
      // hardErrors also contains instruction/buildability failures. Preserve the
      // explicit physics diagnostic instead of mislabeling every hard failure as collision/structure failure.
      if (candidate.designErrors.length) candidate.designAccepted = false;
      if (rejection.scores) candidate.scores = { automotiveDesignScore: automotiveScore(rejection.scores), legoStyle: rejection.scores.legoStyle, vehicleSimilarity: rejection.scores.referenceSimilarity, structure: rejection.scores.structure, buildability: rejection.scores.buildability, weightedTotal: rejection.scores.overall, method: 'geometric-heuristic' };
    }
    for (const assessment of response.debug.candidateAssessments ?? []) {
      let candidate = result.candidates.find(entry => entry.candidateId === assessment.candidateId);
      if (!candidate) {
        candidate = { candidateId: assessment.candidateId, planId: null, status: 'not-selected', rank: assessment.rank, partCount: null, scores: unavailableScores(), physicalValid: null, designAccepted: null, hardErrors: [], designErrors: [], warnings: [], modelArtifact: null };
        result.candidates.push(candidate);
      }
      candidate.rank = assessment.rank;
      if (candidate.status === 'accepted') continue; // Final API validation is authoritative for published candidates.
      const validation = assessment.designValidation;
      candidate.scores = assessmentScores(validation);
      candidate.physicalValid = validation.physicalValid;
      candidate.hardErrors = [...new Set([...candidate.hardErrors, ...validation.hardErrors])];
      candidate.designErrors = [...new Set([...candidate.designErrors, ...validation.designErrors])];
      candidate.designAccepted = candidate.designErrors.length ? false : validation.designAccepted;
      candidate.status = candidate.hardErrors.length || candidate.designErrors.length || !validation.valid ? 'rejected' : 'not-selected';
      candidate.warnings = [...new Set([...validation.warnings, 'This candidate was evaluated during ranking; only published candidates have packed model artifacts.'])];
    }
  } else if (object(payload)) {
    result.errorCode = typeof payload.code === 'string' ? payload.code : null;
    result.message = typeof payload.error === 'string' ? payload.error : result.message;
    if (result.errorCode === 'UNKNOWN_DIMENSIONS') result.status = 'research_pending';
  }
  if (profile) {
    result.researchStatus = profile.researchStatus;
    result.unknownDimensionFields = Object.entries(profile.dimensions).filter(([, fact]) => fact.value === null || !['manual', 'live_verified'].includes(fact.status)).map(([field]) => field);
    result.sources = profile.sources.map(source => ({ id: source.id, kind: source.kind, url: source.url, accessStatus: source.accessStatus }));
    result.blockedSourceCount = result.sources.filter(source => source.accessStatus === 'blocked').length;
  }
  return result;
}

export function summarizeAutomotiveBenchmark(results: readonly AutomotiveBenchmarkCaseResult[]): AutomotiveBenchmarkReport['summary'] {
  return { cases: results.length, nominalGeometryPassed: results.filter(result => result.status === 'nominal_geometry_pass').length, qualityFailed: results.filter(result => result.status === 'quality_failed').length, researchPending: results.filter(result => result.status === 'research_pending').length, executionFailed: results.filter(result => result.status === 'execution_failed').length, generatedSessions: results.filter(result => result.sessionId !== null).length, acceptedCandidates: results.reduce((sum, result) => sum + result.candidates.filter(candidate => candidate.status === 'accepted').length, 0) };
}
export function automotiveBenchmarkExitCode(report: Pick<AutomotiveBenchmarkReport, 'cases'>): 0 | 1 | 2 {
  if (!report.cases.length || report.cases.some(result => result.status === 'quality_failed' || result.status === 'execution_failed')) return 1;
  return report.cases.some(result => result.status === 'research_pending') ? 2 : 0;
}

/** Exercise the actual HTTP router and stores. No provider key or mocked kernel is used. */
export async function runAutomotiveBenchmark(options: AutomotiveBenchmarkOptions = {}): Promise<AutomotiveBenchmarkRun> {
  const candidateCount = options.candidateCount ?? 8;
  if (!Number.isInteger(candidateCount) || candidateCount < 5 || candidateCount > 20) throw new Error('Automotive candidate count must be an integer from 5 to 20.');
  const dataDir = path.resolve(options.dataDir ?? process.env.BRICKLAB_DATA_DIR ?? 'data');
  const { createAutomotiveRouter } = await import('./api.js');
  const app = express();
  app.use(express.json({ limit: '32kb' }));
  app.use('/api/automotive', createAutomotiveRouter({ dataDir }));
  const errors: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
    if (error instanceof InventoryError) response.status(error.status).json({ error: error.message, code: error.code });
    else response.status(500).json({ error: error instanceof Error ? error.message : 'Automotive benchmark API failed.', code: 'INTERNAL_ERROR' });
  };
  app.use(errors);
  const server = await new Promise<Server>((resolve, reject) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    listening.once('error', reject);
  });
  const report: AutomotiveBenchmarkReport = { schemaVersion: 1, generatedAt: new Date().toISOString(), mode: options.estimated ? 'estimated-concept' : 'source-required', candidateCount, dataDir, externalNetworkRequests: 0, physicalBuildsVerified: 0, visualResemblance: 'not-assessed', cases: [], summary: summarizeAutomotiveBenchmark([]), notes: ['Nominal geometry PASS means the API accepted catalog geometry, connection, wheel, structure, instruction and rule-based design gates. It does not demonstrate real-vehicle visual resemblance or a physical build.', 'No live research request is made. Source access statuses are recorded profile metadata, not fresh network checks.', 'Independent AutomotiveDesignScore is recorded only when exposed by the API. Missing independent or rejected-candidate score records remain null.', 'Screenshots are pending until actual browser captures are attached. Preview paths refer to saved UI sessions; packed JSON artifacts are not screenshots.'] };
  const sessions: AutomotiveBenchmarkRun['sessions'] = [];
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Automotive benchmark server has no TCP address.');
    const base = `http://127.0.0.1:${address.port}/api/automotive`;
    const statusResponse = await fetch(`${base}/status`);
    if (!statusResponse.ok) throw new Error(`Automotive status returned HTTP ${statusResponse.status}.`);
    const status = await statusResponse.json() as { profiles: RealVehicleProfile[]; capabilities: { referenceModels: number } };
    for (const test of options.cases ?? AUTOMOTIVE_BENCHMARK_CASES) {
      const started = performance.now();
      let result: AutomotiveBenchmarkCaseResult;
      try {
        const response = await fetch(`${base}/design`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profileId: test.profileId, widthStuds: test.widthStuds, candidateCount, allowEstimatedProportions: options.estimated === true }), signal: AbortSignal.timeout(180_000) });
        const payload: unknown = await response.json();
        result = summarizeAutomotiveBenchmarkCase(test, response.status, payload, { elapsedMs: performance.now() - started, estimated: options.estimated === true, profile: status.profiles.find(profile => profile.id === test.profileId), libraryReferenceCount: status.capabilities.referenceModels });
        if (result.sessionId) sessions.push({ caseId: test.id, response: payload as AutomotiveDesignResponse });
      } catch (error) {
        result = summarizeAutomotiveBenchmarkCase(test, 0, { code: 'BENCHMARK_REQUEST_FAILED', error: error instanceof Error ? error.message : 'Automotive API request failed.' }, { elapsedMs: performance.now() - started, estimated: options.estimated === true, profile: status.profiles.find(profile => profile.id === test.profileId), libraryReferenceCount: status.capabilities.referenceModels });
      }
      report.cases.push(result);
      options.onCase?.(result);
    }
    report.summary = summarizeAutomotiveBenchmark(report.cases);
    return { report, sessions };
  } finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

const csvCell = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
export function automotiveBenchmarkCsv(report: AutomotiveBenchmarkReport): string {
  const rows: unknown[][] = [['case', 'targetVehicle', 'widthStuds', 'status', 'dimensionBasis', 'unknownDimensionFields', 'blockedSources', 'libraryReferences', 'selectedReferences', 'grammarReferences', 'sessionId', 'previewPath', 'candidateId', 'candidateStatus', 'rank', 'automotiveDesignScore', 'legoStyle', 'vehicleSimilarity', 'structure', 'buildability', 'weightedTotal', 'partCount', 'generationTimeMs', 'hardErrors', 'designErrors', 'modelArtifact', 'screenshotStatus']];
  for (const test of report.cases) for (const candidate of test.candidates.length ? test.candidates : [null]) rows.push([test.id, test.targetVehicle, test.widthStuds, test.status, test.dimensionBasis, JSON.stringify(test.unknownDimensionFields), test.blockedSourceCount, test.libraryReferenceCount, test.selectedReferenceCount, test.grammarReferenceCount, test.sessionId, test.previewPath, candidate?.candidateId, candidate?.status, candidate?.rank, candidate?.scores.automotiveDesignScore, candidate?.scores.legoStyle, candidate?.scores.vehicleSimilarity, candidate?.scores.structure, candidate?.scores.buildability, candidate?.scores.weightedTotal, candidate?.partCount, test.generationTimeMs, JSON.stringify(candidate?.hardErrors ?? (test.errorCode ? [`${test.errorCode}: ${test.message}`] : [])), JSON.stringify(candidate?.designErrors ?? []), candidate?.modelArtifact, test.images.status]);
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
export async function writeAutomotiveBenchmarkReport(run: AutomotiveBenchmarkRun, output = 'artifacts/automotive-benchmark'): Promise<{ json: string; csv: string; artifactDirectory: string }> {
  const directory = path.resolve(output), artifactDirectory = path.join(directory, 'models');
  await mkdir(artifactDirectory, { recursive: true });
  const safeName = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 120);
  for (const session of run.sessions) {
    const test = run.report.cases.find(entry => entry.id === session.caseId);
    if (!test) continue;
    test.sessionArtifact = `models/${safeName(test.id)}.session.json`;
    await writeFile(path.join(directory, test.sessionArtifact), JSON.stringify(session.response, null, 2) + '\n', 'utf8');
    for (const [index, candidate] of session.response.candidates.entries()) {
      const summary = test.candidates.find(entry => entry.candidateId === candidate.id);
      if (!summary) continue;
      summary.modelArtifact = `models/${safeName(test.id)}.${index + 1}.${safeName(candidate.id)}.packed.json`;
      await writeFile(path.join(directory, summary.modelArtifact), JSON.stringify(candidate.candidate, null, 2) + '\n', 'utf8');
    }
  }
  const json = path.join(directory, 'report.json'), csv = path.join(directory, 'report.csv');
  await writeFile(json, JSON.stringify(run.report, null, 2) + '\n', 'utf8');
  await writeFile(csv, automotiveBenchmarkCsv(run.report), 'utf8');
  return { json, csv, artifactDirectory };
}
