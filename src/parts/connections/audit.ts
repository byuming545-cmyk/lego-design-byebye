import { createHash } from 'node:crypto';
import type { ConnectionImportIssue, ConnectionImportResult, ConnectionSourceFile, ConnectionTransformEvidence, ImportedConnectionPoint } from './types.js';
import { CONNECTION_PARSER_VERSION } from './importer.js';

export type ParseAuditCategory = 'INHERITED_SCALING' | 'CYLINDER_PROFILE' | 'GRID_GRAMMAR' | 'INCLUDE_OVERRIDE' | 'FINGER_JOINT_GRAMMAR' | 'CONNECTION_EVIDENCE_MISSING' | 'OTHER_PARSE_FAILURE';
export interface ParseAuditInput {
  partId: string;
  name: string;
  result: ConnectionImportResult;
}
export interface ParseAuditFailure {
  caseId: string;
  partId: string;
  partName: string;
  partParseStatus: ConnectionImportResult['status'];
  category: ParseAuditCategory;
  disposition: 'REQUIRES_ASTRA_REVIEW' | 'EVIDENCE_MISSING';
  sourceFile: string;
  sourceLine: number | null;
  instructionType: string;
  instruction: string | null;
  parserError: { code: ConnectionImportIssue['code']; message: string };
  expectedInterpretation: { status: 'EXPECTED_UNKNOWN'; description: string };
  source: ConnectionSourceFile | null;
  inheritedTransforms: ConnectionTransformEvidence[];
  retainedPointWitnesses: { id: string; sourceId: string | null; position: [number, number, number]; normal: [number, number, number]; sections: ImportedConnectionPoint['sections']; dimensionsResolved: boolean }[];
  sourceClosureSha256: string;
  reproductionCommand: string;
  relevantSourceFiles: string[];
  whySolStopped: string;
}

export function parseAuditSourceDigest(result: ConnectionImportResult) {
  return createHash('sha256').update(JSON.stringify(result.sourceFiles.map(source => [source.library, source.path, source.revision, source.sha256]).sort((a, b) => a.join(':').localeCompare(b.join(':'))))).digest('hex');
}
export function parseAuditPointDigest(result: ConnectionImportResult) {
  return createHash('sha256').update(JSON.stringify(result.points)).digest('hex');
}

function classify(issue: ConnectionImportIssue, instruction: string | null): { category: ParseAuditCategory; description: string; stop: string } {
  if (issue.code === 'no-connections' || issue.code === 'missing-shadow-include' || issue.code === 'missing-geometry') return { category: 'CONNECTION_EVIDENCE_MISSING', description: 'No usable source connection declaration was imported. No expected endpoint, type, depth or compatibility is invented.', stop: 'EVIDENCE_MISSING: a trustworthy connection definition or referenced source is required.' };
  if (issue.code === 'unsupported-scaling') return { category: 'INHERITED_SCALING', description: 'The source declares an affine inherited frame. Its physical section scaling, caps and effective dimensions are not established by the current supported subset.', stop: 'Requires source-specification review of inherited section scaling; no radius, length, insertion depth or tolerance is guessed.' };
  if (instruction?.includes('SNAP_FGR')) return { category: 'FINGER_JOINT_GRAMMAR', description: 'The source contains a finger-joint declaration. The full grammar, mating semantics and mechanical freedoms are not established.', stop: 'Finger-joint interpretation and mechanical mating require Astra review.' };
  if (/section profile/.test(issue.message)) return { category: 'CYLINDER_PROFILE', description: 'The source uses an unsupported cylinder profile (for example L_). No shoulder, engagement length or mechanical interpretation is assumed.', stop: 'Nonstandard sections and insertion semantics require Astra review.' };
  if (/grid dimensions/.test(issue.message)) return { category: 'GRID_GRAMMAR', description: 'The literal grid has more counts/distances than the implemented X/Z subset. No axis ordering or expansion is inferred without a normative source.', stop: 'The 3D grid grammar needs a pinned specification or a reviewed upstream reference implementation.' };
  if (instruction?.includes('SNAP_INCL') && /property/.test(issue.message)) return { category: 'INCLUDE_OVERRIDE', description: 'The include contains an unsupported override such as slide=true. Its propagation and replacement rules are not inferred.', stop: 'Include override precedence requires documented source semantics; no sliding or insertion freedom is added.' };
  return { category: 'OTHER_PARSE_FAILURE', description: 'The importer retained an explicit failure. No unsupported interpretation is substituted.', stop: 'Resolve the exact source/parser evidence before changing production eligibility.' };
}

/** Read-only audit: no parser result is promoted to assembly/generator eligibility. */
export async function buildConnectionParseAudit(inputs: readonly ParseAuditInput[], options: {
  readSourceLine?: (source: ConnectionSourceFile, line: number) => Promise<string | null>;
} = {}) {
  const failures: ParseAuditFailure[] = [];
  const discarded = inputs.flatMap(({ partId, result }) => (result.discardedIssues ?? []).map(issue => ({ partId, ...structuredClone(issue), interpretation: 'Only an explicit source SNAP_CLEAR removed every emitted point affected by this diagnostic. No surviving source dimensions were repaired.', expectedStatus: 'SOURCE_CLEAR_SUPPORTED', disposition: 'SOL_FIXED' })));
  for (const { partId, name, result } of inputs) for (const [index, issue] of result.issues.entries()) {
    const candidates = result.sourceFiles.filter(source => source.path === issue.file);
    const source = issue.source ?? candidates.find(value => value.library === 'LDCadShadowLibrary') ?? candidates[0] ?? null;
    const instruction = issue.directive ?? (source && issue.line && options.readSourceLine ? await options.readSourceLine(source, issue.line) : null);
    const classification = classify(issue, instruction);
    const witnesses = result.points.filter(point => point.source.path === issue.file && point.source.line === issue.line && (!issue.transforms || JSON.stringify(point.source.transforms) === JSON.stringify(issue.transforms)));
    failures.push({
      caseId: `PARSE-${partId}-${index + 1}`, partId, partName: name, partParseStatus: result.status,
      category: classification.category, disposition: classification.category === 'CONNECTION_EVIDENCE_MISSING' ? 'EVIDENCE_MISSING' : 'REQUIRES_ASTRA_REVIEW',
      sourceFile: source?.path ?? (issue.file.includes('/') ? issue.file : `parts/${issue.file.replace(/\.dat$/, '')}.dat`), sourceLine: issue.line ?? null,
      instructionType: /!LDCAD\s+(SNAP_[A-Z_]+)/i.exec(instruction ?? '')?.[1]?.toUpperCase() ?? (/^1\s/.test(instruction ?? '') ? 'NATIVE_TYPE_1' : 'NONE'),
      instruction, parserError: { code: issue.code, message: issue.message },
      expectedInterpretation: { status: 'EXPECTED_UNKNOWN', description: classification.description },
      source: source ? structuredClone(source) : null,
      inheritedTransforms: structuredClone(issue.transforms ?? witnesses[0]?.source.transforms ?? []),
      retainedPointWitnesses: witnesses.map(point => ({ id: point.id, sourceId: point.sourceId, position: [...point.position], normal: [...point.direction], sections: structuredClone(point.sections), dimensionsResolved: point.dimensionsResolved })),
      sourceClosureSha256: parseAuditSourceDigest(result),
      reproductionCommand: `npm run audit:connections -- --part ${partId} --output /tmp/bricklab-parse-${partId}`,
      relevantSourceFiles: [...new Set([source?.path ?? issue.file, ...(issue.transforms ?? []).map(transform => transform.file)])],
      whySolStopped: classification.stop,
    });
  }
  const categories = Object.fromEntries([...new Set(failures.map(failure => failure.category))].sort().map(category => [category, failures.filter(failure => failure.category === category).length]));
  const counts = { roots: inputs.length, ready: inputs.filter(input => input.result.status === 'ready').length, partial: inputs.filter(input => input.result.status === 'partial').length, missing: inputs.filter(input => input.result.status === 'missing').length, retainedRawConnectionRecords: inputs.reduce((sum, input) => sum + input.result.points.length, 0), activeFailureInstances: failures.length, distinctFailureSourceLocations: new Set(failures.map(failure => JSON.stringify([failure.sourceFile, failure.sourceLine, failure.parserError.code]))).size, discardedDimensionWarnings: discarded.length, astraReviewInstances: failures.filter(failure => failure.disposition === 'REQUIRES_ASTRA_REVIEW').length, missingEvidenceInstances: failures.filter(failure => failure.disposition === 'EVIDENCE_MISSING').length };
  return {
    schemaVersion: 1, generatedAt: new Date().toISOString(), parserVersion: CONNECTION_PARSER_VERSION,
    scope: 'every-requested-pinned-native-root; parser-audit-only', counts, categories,
    parts: inputs.map(({ partId, name, result }) => ({ partId, name, status: result.status, pointCount: result.points.length, activeIssueCount: result.issues.length, discardedIssueCount: result.discardedIssues?.length ?? 0, pointSha256: parseAuditPointDigest(result), sourceClosureSha256: parseAuditSourceDigest(result), sourceFiles: structuredClone(result.sourceFiles) })),
    failures, discarded,
    limitations: [
      'ready means supported source syntax, not compatibility, collision, assembly or generatable qualification.',
      'Every remaining unknown physical interpretation is EXPECTED_UNKNOWN, not an assertion of a physically valid connection.',
      'Missing connection evidence is not replaced by synthetic endpoints.',
      'L_/S_ profiles, nonrigid inherited section scaling, include overrides, finger joints and undocumented 3D grids were not guessed.',
      'Parser semantic changes invalidate previous assembly evidence through the active source/parser version even when source bytes are unchanged.',
    ],
  };
}
