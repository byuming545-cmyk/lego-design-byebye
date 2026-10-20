import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AUTOMOTIVE_BENCHMARK_CASES, automotiveBenchmarkCsv, automotiveBenchmarkExitCode, parseAutomotiveBenchmarkArgs, summarizeAutomotiveBenchmark, summarizeAutomotiveBenchmarkCase, writeAutomotiveBenchmarkReport, type AutomotiveBenchmarkReport, type AutomotiveBenchmarkRun } from '../src/automotive/benchmark.js';
import type { AutomotiveDesignResponse } from '../src/automotive/contracts.js';
import { getCatalogVehicleProfile } from '../src/automotive/research/profiles.js';

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });
const testCase = AUTOMOTIVE_BENCHMARK_CASES[0];
const profile = getCatalogVehicleProfile(testCase.profileId)!;
/** Small transport/report fixture only: no geometry or kernel result is fabricated in a run. */
function responseFixture(): AutomotiveDesignResponse {
  return { schemaVersion: 1, sessionId: 'auto-00000000-0000-0000-0000-000000000000', status: 'accepted', message: 'Report fixture', profile, brief: { dimensionBasis: 'estimated' }, references: { references: [] }, warnings: ['Fixture only'], candidates: [{ id: 'candidate-a', name: 'Report fixture', candidate: { stepEncoding: 'part-ids-v1', model: { parts: [{ partId: '3001' }, { partId: '3001' }] }, steps: [] }, scores: { legoStyle: 72, referenceSimilarity: 69, structure: 83, buildability: 100, overall: 74, method: 'geometric-heuristic' }, exportable: true, warnings: [], designValidation: { valid: true, physicalValid: true, designAccepted: true, hardErrors: [], designErrors: [] } }], debug: { grammar: { referenceCount: 0 }, realModelCount: 0, diagnostics: [{ planId: 'plan-a', candidateId: 'candidate-a', status: 'physics-valid', partCount: 2, errors: [] }, { planId: 'plan-b', candidateId: 'candidate-b', status: 'physics-valid', partCount: 3, errors: [] }, { planId: 'plan-c', status: 'physics-rejected', partCount: 4, errors: ['Actual reported collision'] }], rejections: [{ candidateId: 'candidate-b', hardErrors: [], designErrors: ['Reported low style'] }, { candidateId: 'plan-c', hardErrors: ['Actual reported collision'], designErrors: [] }] } } as unknown as AutomotiveDesignResponse;
}
function reportFixture(): AutomotiveBenchmarkReport {
  const result = summarizeAutomotiveBenchmarkCase(testCase, 200, responseFixture(), { elapsedMs: 23.7, estimated: true });
  return { schemaVersion: 1, generatedAt: '2026-10-20T00:00:00Z', mode: 'estimated-concept', candidateCount: 8, dataDir: '/test-only', externalNetworkRequests: 0, physicalBuildsVerified: 0, visualResemblance: 'not-assessed', cases: [result], summary: summarizeAutomotiveBenchmark([result]), notes: ['Unit-test report fixture only.'] };
}

describe('automotive benchmark CLI and honest report states', () => {
  it('defaults to source-required and needs an explicit estimated flag', () => {
    expect(parseAutomotiveBenchmarkArgs([])).toMatchObject({ estimated: false, candidateCount: 8, help: false });
    expect(parseAutomotiveBenchmarkArgs(['--estimated', '--candidate-count', '5', '--output', '/tmp/report folder', '--data-dir', '/tmp/reference-library'])).toMatchObject({ estimated: true, candidateCount: 5, output: '/tmp/report folder', dataDir: '/tmp/reference-library' });
    expect(parseAutomotiveBenchmarkArgs(['--help']).help).toBe(true);
    expect(AUTOMOTIVE_BENCHMARK_CASES.map(test => `${test.profileId}:${test.widthStuds}`)).toEqual(['mercedes-amg-s63-w223:8', 'mercedes-amg-s63-w223:10', 'mercedes-amg-s63-w223:12', 'bmw-m4-g82:8', 'porsche-911-992:8', 'ferrari-roma:8', 'lamborghini-revuelto:8']);
  });
  it.each([['--candidate-count', '4'], ['--candidate-count', '21'], ['--candidate-count', '5.5'], ['--candidate-count', 'NaN'], ['--candidate-count'], ['--output'], ['--estimated', '--estimated'], ['--network'], ['--output', 'a', '--output', 'b']])('rejects invalid or ambiguous CLI arguments %j', (...args) => { expect(() => parseAutomotiveBenchmarkArgs(args)).toThrow(); });

  it('records research pending as exit 2 without inventing a session, model, or zero score', () => {
    const pending = summarizeAutomotiveBenchmarkCase(testCase, 422, { code: 'UNKNOWN_DIMENSIONS', error: 'Official dimensions remain unknown.' }, { elapsedMs: 4, estimated: false, profile, libraryReferenceCount: 0 });
    expect(pending).toMatchObject({ status: 'research_pending', sessionId: null, previewPath: null, bestCandidateId: null, candidates: [], dimensionBasis: null, images: { status: 'pending', paths: [] } });
    expect(pending.unknownDimensionFields).toHaveLength(4);
    expect(pending.sources.some(source => source.accessStatus === 'blocked')).toBe(true);
    expect(automotiveBenchmarkExitCode({ cases: [pending] })).toBe(2);
  });

  it('keeps accepted scores and failed-candidate reasons while leaving unavailable scores null', () => {
    const report = reportFixture(), result = report.cases[0];
    expect(result.status).toBe('nominal_geometry_pass');
    expect(result.generationTimeMs).toBe(24);
    expect(result.dimensionBasis).toBe('estimated');
    expect(result.previewPath).toBe('#/automotive-lab?session=auto-00000000-0000-0000-0000-000000000000');
    expect(result.candidates).toHaveLength(3);
    expect(result.candidates[0]).toMatchObject({ status: 'accepted', planId: 'plan-a', scores: { automotiveDesignScore: null, legoStyle: 72, vehicleSimilarity: 69, weightedTotal: 74 } });
    expect(result.candidates[1]).toMatchObject({ status: 'rejected', physicalValid: true, designAccepted: false, scores: { legoStyle: null }, designErrors: ['Reported low style'] });
    expect(result.candidates[2]).toMatchObject({ status: 'rejected', physicalValid: false, hardErrors: ['Actual reported collision'] });
    expect(report.summary).toMatchObject({ acceptedCandidates: 1, generatedSessions: 1 });
    expect(automotiveBenchmarkExitCode(report)).toBe(0);
  });

  it('does not accept a contradictory API success or an empty accepted result', () => {
    const response = responseFixture(); response.candidates[0].designValidation.physicalValid = false;
    const result = summarizeAutomotiveBenchmarkCase(testCase, 200, response, { elapsedMs: 1, estimated: true });
    expect(result.status).toBe('quality_failed');
    expect(result.candidates[0].status).toBe('rejected');
    expect(result.bestCandidateId).toBeNull();
    expect(automotiveBenchmarkExitCode({ cases: [result] })).toBe(1);
    response.candidates = [];
    expect(summarizeAutomotiveBenchmarkCase(testCase, 200, response, { elapsedMs: 1, estimated: true }).status).toBe('quality_failed');
    expect(automotiveBenchmarkExitCode({ cases: [] })).toBe(1);
  });

  it('preserves a passed physical diagnostic when later instruction validation rejects the candidate', () => {
    const response = responseFixture();
    response.debug.rejections[0] = { candidateId: 'candidate-b', hardErrors: ['No complete instruction sequence could be constructed.'], designErrors: [] };
    const result = summarizeAutomotiveBenchmarkCase(testCase, 200, response, { elapsedMs: 1, estimated: true });
    expect(result.candidates[1]).toMatchObject({ status: 'rejected', physicalValid: true, hardErrors: ['No complete instruction sequence could be constructed.'] });
  });

  it('records an independently exposed automotive score without copying the style score', () => {
    const response = responseFixture(); Object.assign(response.candidates[0].scores, { automotiveDesign: 86 });
    const result = summarizeAutomotiveBenchmarkCase(testCase, 200, response, { elapsedMs: 1, estimated: true });
    expect(result.candidates[0].scores).toMatchObject({ automotiveDesignScore: 86, legoStyle: 72 });
  });

  it('retains scores and rank for evaluated candidates outside the published top selection', () => {
    const response = responseFixture();
    response.debug.rejections = response.debug.rejections.filter(rejection => rejection.candidateId !== 'candidate-b');
    response.debug.candidateAssessments = [{ candidateId: 'candidate-b', rank: 4, designValidation: { ...response.candidates[0].designValidation, scores: { automotiveDesign: 86, legoStyle: 75, referenceSimilarity: 80, structure: 90, buildability: 100 }, overallScore: 82, warnings: [] } }];
    const result = summarizeAutomotiveBenchmarkCase(testCase, 200, response, { elapsedMs: 1, estimated: true });
    expect(result.candidates[1]).toMatchObject({ status: 'not-selected', rank: 4, physicalValid: true, designAccepted: true, scores: { automotiveDesignScore: 86, legoStyle: 75, weightedTotal: 82 }, modelArtifact: null });
    expect(result.candidates[2].scores.legoStyle).toBeNull();
  });

  it('distinguishes request failures from research pending', () => {
    const result = summarizeAutomotiveBenchmarkCase(testCase, 500, { code: 'INTERNAL_ERROR', error: 'Local generation failed.' }, { elapsedMs: 2, estimated: true });
    expect(result.status).toBe('execution_failed');
    expect(automotiveBenchmarkExitCode({ cases: [result] })).toBe(1);
  });

  it('writes JSON, CSV and packed transport artifacts, never fake screenshots', async () => {
    const output = await mkdtemp(path.join(os.tmpdir(), 'bricklab-auto-benchmark-')); temporary.push(output);
    const report = reportFixture(); report.cases[0].targetVehicle = 'Quoted "car", with comma';
    const run: AutomotiveBenchmarkRun = { report, sessions: [{ caseId: testCase.id, response: responseFixture() }] };
    const paths = await writeAutomotiveBenchmarkReport(run, output);
    const json = JSON.parse(await readFile(paths.json, 'utf8')) as AutomotiveBenchmarkReport;
    expect(json.cases[0].sessionArtifact).toMatch(/\.session\.json$/);
    expect(json.cases[0].candidates[0].modelArtifact).toMatch(/\.packed\.json$/);
    expect(json.cases[0].images.status).toBe('pending');
    expect(await readdir(paths.artifactDirectory)).toHaveLength(2);
    const packed = JSON.parse(await readFile(path.join(output, json.cases[0].candidates[0].modelArtifact!), 'utf8'));
    expect(packed.stepEncoding).toBe('part-ids-v1');
    expect(await readFile(paths.csv, 'utf8')).toContain('"Quoted ""car"", with comma"');
    expect(automotiveBenchmarkCsv(report).split('\r\n')).toHaveLength(5);
    expect(automotiveBenchmarkCsv(report)).toContain('"automotiveDesignScore"');
  });
});
