import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { exportNativeAssemblyBomCsv, exportNativeAssemblyJson, exportNativeAssemblyLDraw } from '../parts/assembly/documents.js';
import { NATIVE_MODULE_TYPES, type NativeGeneratorSearch, type NativeModuleType } from '../parts/assembly/generator.js';
import { AssemblyService } from '../parts/assembly/service.js';

const args = process.argv.slice(2);
let outputDirectory = path.resolve('artifacts', 'assembly-development');
let reportDirectory: string | undefined;
for (let index = 0; index < args.length; index += 2) {
  if ((args[index] !== '--output' && args[index] !== '--report-dir') || !args[index + 1]) throw new Error('Usage: assembly-smoke [--output directory] [--report-dir trusted-migration-directory]');
  if (args[index] === '--output') outputDirectory = path.resolve(args[index + 1]);
  else reportDirectory = path.resolve(args[index + 1]);
}

interface ModuleSmokeResult {
  module: NativeModuleType;
  status: 'generated' | 'blocked' | 'failed';
  reasons: string[];
  elapsedMilliseconds: number;
  search?: NativeGeneratorSearch;
  modelId?: string;
  partCount?: number;
  graphEdges?: number;
  contentSha256?: string;
  sourceHashes?: Record<string, string>;
  artifacts?: { json: string; ldraw: string; bom: string };
}

const started = Date.now();
const service = new AssemblyService(reportDirectory ? { dataDir: reportDirectory } : {});
const runtime = await service.status();
const versions = {
  partLibraryVersion: runtime.partLibraryVersion,
  assemblyEngineVersion: runtime.assemblyEngineVersion,
  connectionRuleVersion: runtime.connectionRuleVersion,
  collisionVersion: runtime.collisionVersion,
};
const results: ModuleSmokeResult[] = [];
let reportSha256: string | null = null;
if (runtime.runtimeValidation.reportLoaded) {
  reportSha256 = createHash('sha256').update(await readFile(path.join(service.reportDirectory, 'migration.json'))).digest('hex');
}
const ready = runtime.runtimeValidation.reportLoaded && runtime.runtimeValidation.status !== 'blocked' && runtime.generatedAt !== null && runtime.counts.generatable > 0;
await mkdir(outputDirectory, { recursive: true });
for (const module of NATIVE_MODULE_TYPES) {
  const moduleStarted = Date.now();
  if (!ready) {
    results.push({ module, status: 'blocked', reasons: ['A current source-verified production migration cache is required. No verification-mode or fallback catalogue was used.', ...runtime.runtimeValidation.issues], elapsedMilliseconds: 0 });
    continue;
  }
  process.stdout.write(`${module}: generating from ${runtime.counts.generatable} production-admitted native parts...\n`);
  try {
    const result = await service.generate({ module });
    const row: ModuleSmokeResult = { module, status: result.status, reasons: result.reasons, search: result.search, elapsedMilliseconds: Date.now() - moduleStarted };
    if (result.status === 'generated' && result.model) {
      const model = result.model;
      const modelDirectory = path.join(outputDirectory, 'models', module);
      const artifacts = { json: `models/${module}/model.json`, ldraw: `models/${module}/model.ldr`, bom: `models/${module}/bom.csv` };
      // Serialize all three before writing: unsupported or modified models produce no new export.
      const documents = { json: exportNativeAssemblyJson(model), ldraw: exportNativeAssemblyLDraw(model), bom: exportNativeAssemblyBomCsv(model) };
      await mkdir(modelDirectory, { recursive: true });
      for (const format of ['json', 'ldraw', 'bom'] as const) await writeFile(path.join(outputDirectory, artifacts[format]), documents[format]);
      Object.assign(row, { modelId: model.id, partCount: model.placements.length, graphEdges: model.edges.length, contentSha256: model.contentSha256, sourceHashes: model.sourceHashes, artifacts });
    }
    results.push(row);
    process.stdout.write(`${module}: ${row.status}; ${row.partCount ?? 0} parts; ${row.search?.attempts ?? 0} attachment attempts; ${row.elapsedMilliseconds} ms\n`);
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 2000) : 'Unknown native generator error.';
    results.push({ module, status: 'failed', reasons: [reason], elapsedMilliseconds: Date.now() - moduleStarted });
    process.stdout.write(`${module}: failed; ${reason}\n`);
  }
}

const sourceHashes: Record<string, string> = {};
for (const result of results) for (const [partId, hash] of Object.entries(result.sourceHashes ?? {})) {
  if (sourceHashes[partId] && sourceHashes[partId] !== hash) throw new Error(`Source changed between smoke modules for native part ${partId}.`);
  sourceHashes[partId] = hash;
}
const summary = {
  requested: NATIVE_MODULE_TYPES.length,
  generated: results.filter(result => result.status === 'generated').length,
  blocked: results.filter(result => result.status === 'blocked').length,
  failed: results.filter(result => result.status === 'failed').length,
  physicalBuildsVerified: 0,
};
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  scope: 'production-engine-and-current-saved-per-interface-migration-evidence',
  summary,
  modules: results,
  limitations: ['A passing result verifies source-backed virtual seating and final native mesh collision checks; it does not certify physical construction or swept insertion clearance.', 'LDraw current colour 16 is unspecified; official colour and owned inventory availability are unverified.', 'Wheel modules remain blocked until rim, tyre and axle interfaces have complete passing native assembly fixtures.'],
  elapsedMilliseconds: Date.now() - started,
  versions,
  runtime: { migrationVersion: runtime.migrationVersion, migrationGeneratedAt: runtime.generatedAt, interfaceBudget: runtime.interfaceBudget, validation: runtime.runtimeValidation, counts: runtime.counts, sourceCounts: runtime.sourceCounts },
  sourceHashes,
  migrationReportSha256: reportSha256,
};
await writeFile(path.join(outputDirectory, 'generator-smoke.json'), JSON.stringify(report, null, 2) + '\n');
process.stdout.write(`${JSON.stringify({ summary, versions, runtimeCounts: runtime.counts, runtimeSourceCounts: runtime.sourceCounts, sourceHashes, migrationReportSha256: reportSha256, report: path.relative(process.cwd(), path.join(outputDirectory, 'generator-smoke.json')) }, null, 2)}\n`);
if (!ready || results.some(result => result.module !== 'wheel-module' && result.status !== 'generated') || results.some(result => result.status === 'failed')) process.exitCode = 2;
