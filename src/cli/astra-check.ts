import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { loadAstraCase, reproduceAstraCase, HANDOFF_ROOT } from '../parts/handoff/cases.js';
import { NativePartRepository } from '../parts/assembly/source.js';

const manifestBytes = await readFile(path.join(HANDOFF_ROOT, 'manifest.json'));
const manifest = JSON.parse(manifestBytes.toString('utf8'));
const repository = new NativePartRepository(), started = Date.now();
const results: unknown[] = [];
let failed = 0;
for (const entry of manifest.cases) {
  try {
    const result = await reproduceAstraCase(await loadAstraCase(entry.caseId), repository);
    results.push({ caseId: entry.caseId, reproduced: result.reproduced, recordedStatus: result.recordedActual.status, actualStatus: result.actual.status, reasonCodes: result.actual.reasonCodes, physicalBuildVerified: false });
    if (!result.reproduced) failed++;
  } catch (error) {
    failed++;
    results.push({ caseId: entry.caseId, reproduced: false, error: error instanceof Error ? error.message : String(error) });
  }
  if (results.length % 25 === 0) console.info(`${results.length}/${manifest.cases.length}; failed=${failed}; ${Math.round((Date.now() - started) / 1000)}s`);
}
const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), versions: manifest.versions, manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'), cases: results.length, reproduced: results.length - failed, failed, diagnosticOnly: true, physicalBuildVerified: false, elapsedMs: Date.now() - started, results };
await writeFile(new URL('../../artifacts/assembly-development/astra-replay-validation.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.info(JSON.stringify({ cases: report.cases, reproduced: report.reproduced, failed, elapsedMs: report.elapsedMs }));
process.exitCode = failed ? 2 : 0;
