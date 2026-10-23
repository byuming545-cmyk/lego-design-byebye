import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { gzipSync, gunzipSync } from 'node:zlib';
import { NativePartRepository } from '../parts/assembly/source.js';
import { atomicWriteJson, runDeferredInterfaces } from '../parts/assembly/deferredRunner.js';
import { buildDeferredMigrationReport, type DeferredBaselineIndex } from '../parts/assembly/deferredReport.js';
import { compactAssemblyMigrationReport } from '../parts/assembly/migration.js';
import { contentHash } from '../parts/assembly/testContext.js';
import { createHash } from 'node:crypto';

const argumentsList = process.argv.slice(2), values = new Map<string, string>(), flags = new Set<string>();
for (let i = 0; i < argumentsList.length; i++) {
  const flag = argumentsList[i];
  if (['--retry-failed'].includes(flag)) flags.add(flag);
  else if (['--checkpoint-dir', '--concurrency', '--batch-size', '--timeout-ms', '--part-budget-ms', '--max-retries', '--part', '--baseline-index'].includes(flag) && argumentsList[i + 1]) values.set(flag, argumentsList[++i]);
  else throw new Error(`Unsupported deferred runner argument: ${flag}`);
}
const numberOption = (name: string, fallback: number) => { const value = values.get(name); if (value !== undefined && !/^\d+$/.test(value)) throw new Error(`Invalid integer for ${name}.`); return value === undefined ? fallback : Number(value); };
const baselineArtifact = path.resolve('artifacts/assembly-development/v05-physical-index.json.gz');
let baselineBytes: Buffer;
try { baselineBytes = await readFile(values.get('--baseline-index') ?? '/tmp/bricklab-v05-baseline/physical-index.json'); }
catch { baselineBytes = gunzipSync(await readFile(baselineArtifact)); }
const baseline = JSON.parse(baselineBytes.toString('utf8')) as DeferredBaselineIndex;
if (baseline.schemaVersion !== 1 || baseline.counts.pending !== 978 || baseline.entries.length !== 245) throw new Error('A source-backed 245-part / 978-target baseline is required.');
await mkdir(path.dirname(baselineArtifact), { recursive: true });
await writeFile(baselineArtifact, gzipSync(baselineBytes, { level: 9 }));
const controller = new AbortController();
process.once('SIGINT', () => controller.abort()); process.once('SIGTERM', () => controller.abort());
const repository = new NativePartRepository(), started = Date.now();
let lastUpdate = started;
const checkpointDirectory = path.resolve(values.get('--checkpoint-dir') ?? path.join(os.tmpdir(), 'bricklab-v06-interface-checkpoints'));
const result = await runDeferredInterfaces({
  repository, checkpointDirectory, concurrency: numberOption('--concurrency', 2), batchSize: numberOption('--batch-size', 8), timeoutMs: numberOption('--timeout-ms', 8000), partBudgetMs: numberOption('--part-budget-ms', 60000), maxRetries: numberOption('--max-retries', 1),
  retryFailed: flags.has('--retry-failed'), signal: controller.signal,
  ...(values.has('--part') ? { partIds: values.get('--part')!.split(',') } : {}),
  onProgress(event) {
    if (Date.now() - lastUpdate > 5000 || event.completed === event.total) {
      process.stdout.write(`${event.completed}/${event.total} physical groups: ${event.partId} ${event.status}${event.cached ? ' checkpoint' : ''}; ${Math.round((Date.now() - started) / 1000)}s\n`); lastUpdate = Date.now();
    }
  },
});
if (values.has('--part')) {
  process.stdout.write(`${JSON.stringify({ checkpointOnly: true, parts: result.parts.map(part => ({ partId: part.partId, pass: part.records.filter(record => record.status === 'PASS').length, blocked: part.records.filter(record => record.status === 'BLOCKED').length, requiresAstraReview: part.records.filter(record => record.status === 'REQUIRES_ASTRA_REVIEW').length, pending: part.records.filter(record => record.status === 'PENDING').length })), resumedRecords: result.resumedRecords, interrupted: result.interrupted, checkpointDirectory }, null, 2)}\n`);
} else {
  const report = await buildDeferredMigrationReport(result, baseline, repository);
  const artifactDir = path.resolve('artifacts/assembly-development'), runtimeDir = path.resolve('data/parts-foundation/assembly');
  await mkdir(artifactDir, { recursive: true }); await mkdir(runtimeDir, { recursive: true });
  const records = result.parts.flatMap(part => part.records), recordText = JSON.stringify({ schemaVersion: 1, testVersion: report.testVersion, records });
  await writeFile(path.join(artifactDir, 'interface-tests.json.gz'), gzipSync(recordText, { level: 9 }));
  const enriched = { ...report, interfaceTestArtifact: { file: 'artifacts/assembly-development/interface-tests.json.gz', uncompressedSha256: createHash('sha256').update(recordText).digest('hex'), records: records.length }, baselineArtifact: { file: 'artifacts/assembly-development/v05-physical-index.json.gz', uncompressedSha256: createHash('sha256').update(baselineBytes).digest('hex') }, executionCounts: { directTests: records.filter(record => record.execution === 'direct-test').length, sharedSourcePrecondition: records.filter(record => record.execution === 'shared-source-precondition').length, reviewDependency: records.filter(record => record.execution === 'review-dependency').length }, runId: contentHash([report.testVersion, report.generatedAt, report.partLibraryVersion]) };
  const fullText = JSON.stringify(enriched);
  await writeFile(path.join(artifactDir, 'migration-full.json.gz'), gzipSync(fullText, { level: 9 }));
  const output = { ...compactAssemblyMigrationReport(enriched), ...enriched, fullReportArtifact: { file: 'artifacts/assembly-development/migration-full.json.gz', uncompressedSha256: createHash('sha256').update(fullText).digest('hex'), uncompressedBytes: Buffer.byteLength(fullText) } };
  // Preserve every PASS proof; only blocked duplicate case details may be compacted.
  output.entries = compactAssemblyMigrationReport(enriched).entries;
  if (Buffer.byteLength(JSON.stringify(output)) > 48 * 1024 * 1024) throw new Error('Migration report exceeds the runtime 48 MiB limit; no passing evidence was truncated.');
  await atomicWriteJson(path.join(runtimeDir, 'migration.json'), output);
  process.stdout.write(`${JSON.stringify({ counts: report.counts, before: report.beforeInterfaceCoverage, after: report.interfaceCoverage, deferred: report.deferredRun, executionCounts: enriched.executionCounts, resumedRecords: result.resumedRecords, elapsedSeconds: Math.round(result.elapsedMs / 1000) }, null, 2)}\n`);
}
if (result.interrupted) process.exitCode = 130;
