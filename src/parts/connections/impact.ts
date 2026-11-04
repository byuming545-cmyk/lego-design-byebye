import type { ConnectionImportIssue, ConnectionImportResult, ConnectionTransformEvidence, ImportedConnectionPoint } from './types.js';

export const CONNECTION_IMPACT_VERSION = 'connection-impact-1';
const context = (transforms: ConnectionTransformEvidence[] = []) => JSON.stringify(transforms.map(t => [t.file, t.line, t.directive, t.position, t.matrix]));
function sameOccurrence(issue: ConnectionImportIssue, point: ImportedConnectionPoint) {
  return !!issue.source && !!issue.directive && issue.line !== undefined &&
    issue.file === point.source.path && issue.line === point.source.line && issue.directive === point.source.raw &&
    issue.source.sha256 === point.source.sha256 && issue.source.revision === point.source.revision &&
    issue.source.sourceUrl === point.source.sourceUrl && context(issue.transforms) === context(point.source.transforms);
}

/** Explain existing evidence. Missing context never implies a harmless error.
 * A diagnostic does not validate a connector, a fit, or a complete assembly. */
export function analyzeConnectionImpact(result: ConnectionImportResult) {
  const issues = result.issues.map(issue => {
    const points = issue.code === 'unsupported-scaling' ? result.points.filter(point => sameOccurrence(issue, point)) : [];
    const isolated = points.length > 0 && points.every(point => point.dimensionsResolved === false);
    return {
      code: issue.code, file: issue.file, line: issue.line ?? null, raw: issue.directive ?? null,
      scope: isolated ? 'SOURCE_FEATURES' as const : 'WHOLE_PART_UNKNOWN' as const,
      affectedConnectionIds: isolated ? points.map(point => point.id) : [],
      source: issue.source ?? null, transforms: issue.transforms ?? [],
      reason: isolated ? 'The exact source line, digest and inherited occurrence identify these unresolved features.'
        : 'This issue lacks safely isolatable feature evidence or may change inheritance, clearing, completeness or source integrity; the part remains blocked.',
    };
  });
  const isolatedIds = [...new Set(issues.filter(issue => issue.scope === 'SOURCE_FEATURES').flatMap(issue => issue.affectedConnectionIds))];
  const wholePartUnknown = issues.some(issue => issue.scope === 'WHOLE_PART_UNKNOWN') || result.status === 'missing'
    || result.status === 'partial' && issues.length === 0;
  return {
    version: CONNECTION_IMPACT_VERSION, partId: result.partId, parserVersion: result.parserVersion ?? null,
    parserStatus: result.status, wholePartUnknown, issues, isolatedConnectionIds: isolatedIds,
    locallyUnaffectedConnectionIds: wholePartUnknown ? [] : result.points.filter(point => point.dimensionsResolved && !isolatedIds.includes(point.id)).map(point => point.id),
    canIsolateDimensionFailures: result.status === 'partial' && issues.length > 0 && !wholePartUnknown,
    discardedBySourceClear: result.discardedIssues ?? [],
    scope: 'Diagnostic scope only. Unaffected features still require source, grammar, collision and whole-model checks.',
  };
}

export type ConnectionImpact = ReturnType<typeof analyzeConnectionImpact>;
