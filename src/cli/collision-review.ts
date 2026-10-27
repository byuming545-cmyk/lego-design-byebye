import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { loadAstraCase, replayAstraOperation, currentHandoffVersions, handoffPartFingerprint } from '../parts/handoff/cases.js';
import { NativePartRepository } from '../parts/assembly/source.js';

const directory = path.resolve('sol-handoff/v0.6-collision');
await mkdir(directory, { recursive: true });
const manifestBytes = await readFile('astra-handoff/manifest.json');
const manifest = JSON.parse(manifestBytes.toString('utf8'));
if (manifest.versions?.collisionVersion !== 'native-closed-bvh-partition-1.0.0') throw new Error('The original V0.6 case baseline was replaced; restore its manifest and cases before this comparison.');
const requestedId = process.argv[2];
if (process.argv.length > 3 || requestedId && !manifest.cases.some((entry: { caseId: string }) => entry.caseId === requestedId)) throw new Error('Usage: npm run collision:review -- [existing CASE_ID]');
const repository = new NativePartRepository();
const results: { caseId: string; rootCause: string; disposition: string; before: string; after: string | null; beforeReasons?: string[]; afterReasons?: string[]; elapsedMs?: number; actual?: unknown }[] = [];
for (const entry of manifest.cases) {
  if (requestedId && entry.caseId !== requestedId) continue;
  const record = await loadAstraCase(entry.caseId);
  const serialized = JSON.stringify(record);
  const excluded = record.replay.kind === 'mapping' || ['WHEEL_ASSEMBLY', 'CLIP_BAR', 'AXLE_HOLE'].includes(record.category);
  const rootCause = excluded ? 'OUT_OF_SCOPE' : record.category === 'CONNECTION_PARSE' ? 'SOURCE_SEMANTICS' : /surface-partition/.test(serialized) ? 'SURFACE_PARTITION' : record.replay.kind === 'proxy' ? 'HOLLOW_GEOMETRY' : record.category === 'VERIFICATION_BUDGET' ? 'VERIFICATION_BUDGET' : 'UNKNOWN_COMPLEX_GEOMETRY';
  if (excluded || record.replay.kind === 'parse') {
    results.push({ caseId: record.caseId, rootCause, disposition: 'unchanged-outside-collision-algorithm', before: record.actualBehavior.status, after: null });
    continue;
  }
  for (const source of record.affectedParts.filter(part => part.identitySystem === 'ldraw')) {
    const part = await repository.getPart(source.partId);
    if (!part || JSON.stringify(handoffPartFingerprint(part)) !== JSON.stringify(source)) throw new Error(`Source drift in ${record.caseId}`);
  }
  const start = performance.now();
  // Explicit cross-version experiment. The archived original case is never retagged.
  const actual = await replayAstraOperation(record.replay, repository);
  if (requestedId) console.info(JSON.stringify({ baseline: record.actualBehavior, currentVersions: currentHandoffVersions(), actual, diagnosticOnly: true }, null, 2));
  const wasClear = ['clear', 'PASS'].includes(record.actualBehavior.status), isClear = ['clear', 'PASS'].includes(actual.status);
  const disposition = !wasClear && isClear ? 'resolved-clearance' : wasClear && !isClear ? 'diagnostic-regression' : 'remaining';
  results.push({ caseId: record.caseId, rootCause, disposition, before: record.actualBehavior.status, beforeReasons: record.actualBehavior.reasonCodes, after: actual.status, afterReasons: actual.reasonCodes, elapsedMs: performance.now() - start, actual });
  console.info(`${record.caseId}: ${record.actualBehavior.status} -> ${actual.status}`);
}
const common = { schemaVersion: 1, generatedAt: new Date().toISOString(), baselineManifestSha256: createHash('sha256').update(manifestBytes).digest('hex'), baselineVersions: manifest.versions, currentVersions: currentHandoffVersions(), diagnosticOnly: true, physicalBuildVerified: false };
if (!requestedId) {
  await writeFile(path.join(directory, 'resolved-astra-cases.json'), JSON.stringify({ ...common, cases: results.filter(result => result.disposition === 'resolved-clearance') }, null, 2) + '\n');
  await writeFile(path.join(directory, 'remaining-astra-cases.json'), JSON.stringify({ ...common, cases: results.filter(result => result.disposition !== 'resolved-clearance') }, null, 2) + '\n');
}
console.info(JSON.stringify({ total: results.length, resolved: results.filter(result => result.disposition === 'resolved-clearance').length, diagnosticRegressions: results.filter(result => result.disposition === 'diagnostic-regression').length, classes: Object.fromEntries([...new Set(results.map(result => result.rootCause))].map(key => [key, results.filter(result => result.rootCause === key).length])) }));
