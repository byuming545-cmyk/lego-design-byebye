import 'dotenv/config';
import { setGlobalProxyFromEnv } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { InventoryError, RebrickableInventoryProvider, enrichInventorySnapshot, type SetInventoryProvider } from '../inventory/index.js';
import { benchmarkExitCode, parseBenchmarkConfig, runSpeedBenchmark, writeBenchmarkReport, type BenchmarkSet } from '../speed/benchmark.js';
import { createSpeedDemoInventory, SPEED_DEMO_SET_NUMBER } from '../speed/inventory.js';
import { VERSION_METADATA } from '../speed/versions.js';

export async function speedBenchmarkMain(args = process.argv.slice(2)): Promise<number> {
  setGlobalProxyFromEnv();
  let setsInput: string | undefined, config: string | undefined, output: string | undefined, mock = false;
  for (let index = 0; index < args.length; index++) {
    const option = args[index];
    if (option === '--help' || option === '-h') {
      console.log('Usage: npm run benchmark:speed -- [--sets 76900,76901 | --config speed-benchmark.json] [--output directory-or-file.json] [--mock]\nReal mode requires REBRICKABLE_API_KEY from .env. Mock mode accepts only DEMO-SPEED. Exit codes: 0 all PASS, 1 failed/partial, 2 real online validation pending.');
      return 0;
    }
    if (option === '--mock') { mock = true; continue; }
    if (!['--sets', '--config', '--output'].includes(option)) throw new Error(`Unknown option: ${option}`);
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${option}`);
    if (option === '--sets') { if (setsInput !== undefined) throw new Error('--sets may be provided once.'); setsInput = value; }
    if (option === '--config') { if (config !== undefined) throw new Error('--config may be provided once.'); config = value; }
    if (option === '--output') { if (output !== undefined) throw new Error('--output may be provided once.'); output = value; }
  }
  if (setsInput && config) throw new Error('Use either --sets or --config.');
  let sets: BenchmarkSet[];
  if (setsInput) sets = parseBenchmarkConfig(setsInput.split(/[,;+\s]+/).filter(Boolean));
  else if (mock && !config) sets = [{ setNumber: SPEED_DEMO_SET_NUMBER }];
  else sets = parseBenchmarkConfig(JSON.parse(await readFile(resolve(config || 'speed-benchmark.json'), 'utf8')));

  let provider: SetInventoryProvider | undefined;
  let unavailableReason: Error | undefined;
  if (mock) provider = { source: 'mock', getSetInventory: async () => createSpeedDemoInventory() };
  else if (!process.env.REBRICKABLE_API_KEY?.trim()) unavailableReason = new InventoryError('Rebrickable API Key 未配置。 Real online validation pending.', 'MISSING_API_KEY', 503);
  else provider = new RebrickableInventoryProvider(process.env.REBRICKABLE_API_KEY);
  const report = await runSpeedBenchmark({
    sets, mode: mock ? 'mock' : 'real', provider, unavailableReason,
    onInventoryAnalyzed: async (raw, inventory) => {
      if (raw.source !== 'rebrickable' || !raw.snapshotId) return;
      await enrichInventorySnapshot(raw.snapshotId, {
        catalogVersion: VERSION_METADATA.partLibraryVersion,
        totalQuantity: inventory.analysis.totalQuantity, supportedQuantity: inventory.analysis.supportedQuantity,
        recognizedOnlyQuantity: inventory.analysis.partiallySupportedQuantity, unsupportedQuantity: inventory.analysis.unsupportedQuantity,
        supportRatio: inventory.analysis.supportRate,
        parts: inventory.items.map(item => ({ partId: item.partId, colorId: item.color.id, quantity: item.quantityAvailable, status: item.supported ? 'generatable' as const : item.support === 'partiallySupported' ? 'recognizedOnly' as const : 'unsupported' as const, category: item.category })),
      });
    },
  });
  const paths = await writeBenchmarkReport(report, output);
  console.log(report.onlineValidation);
  for (const set of report.sets) console.log(`${set.setNumber}\t${set.executionState}\t${set.result}\tsupport=${set.support ? `${set.support.quantityWeightedSupportedPercentage.toFixed(2)}%` : 'unrun'}\tgeneration=${set.generation.status}${set.errors.length ? `\t${set.errors.map(error => `${error.stage}:${error.code}: ${error.message}`).join(' | ')}` : ''}`);
  console.log(`Real inventories read: ${report.summary.realInventoriesRead}; real validator runs completed: ${report.summary.realValidated}; real PASS: ${report.summary.realPassed}; pending: ${report.summary.pending}; physical builds validated: 0.`);
  console.log(`Missing-part frequency denominator: ${report.missingFrequency.realSetsRead} real inventories. ${report.missingFrequency.realSetsRead ? `${report.missingFrequency.parts.length} unsupported/recognized-only IDs.` : 'No real frequency evidence available.'}`);
  console.log(`JSON: ${paths.json}\nCSV: ${paths.csv}\nMissing frequency JSON: ${paths.missingJson}\nMissing frequency CSV: ${paths.missingCsv}`);
  return benchmarkExitCode(report);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  speedBenchmarkMain().then(code => { process.exitCode = code; }).catch(error => {
    console.error(error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : String(error));
    process.exitCode = 1;
  });
}
