import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { automotiveBenchmarkExitCode, parseAutomotiveBenchmarkArgs, runAutomotiveBenchmark, writeAutomotiveBenchmarkReport } from '../automotive/benchmark.js';

export async function automotiveBenchmarkMain(args = process.argv.slice(2)): Promise<number> {
  const legacyFixture = args.includes('--legacy-fixture');
  const options = parseAutomotiveBenchmarkArgs(args.filter(argument => argument !== '--legacy-fixture'));
  if (options.help) {
    console.log('Usage: npm run benchmark:automotive -- --legacy-fixture [--estimated] [--candidate-count 5..20] [--output directory] [--data-dir directory]\nHistorical parametric algorithm fixture only; explicit --legacy-fixture acknowledgement is required. Runs the old S63/M4/911/Roma/Revuelto cases through a fixture-only local HTTP API. Results never establish native geometry, source connections or generatable status. No external network requests. Exit codes: 0 nominal fixture PASS, 1 quality/execution failure, 2 research pending, 3 authenticity blocked.');
    return 0;
  }
  if (!legacyFixture) {
    console.error('REAL_PARTS_FOUNDATION_REQUIRED: 旧版参数化 benchmark 已暂停。仅历史算法回归可显式使用 --legacy-fixture；结果不计入真实零件验证。');
    return 3;
  }
  console.log('Historical parametric fixture: no native-geometry or physical verification is established.');
  const run = await runAutomotiveBenchmark({ estimated: options.estimated, candidateCount: options.candidateCount, dataDir: options.dataDir, onCase: test => console.log(`${test.id}\t${test.status}\taccepted=${test.candidates.filter(candidate => candidate.status === 'accepted').length}\t${test.generationTimeMs}ms${test.previewPath ? `\t${test.previewPath}` : ''}`) });
  const paths = await writeAutomotiveBenchmarkReport(run, options.output);
  console.log(`Nominal geometry PASS: ${run.report.summary.nominalGeometryPassed}/${run.report.summary.cases}; quality failed: ${run.report.summary.qualityFailed}; research pending: ${run.report.summary.researchPending}; execution failed: ${run.report.summary.executionFailed}.`);
  console.log('Visual resemblance: not assessed. Physical builds verified: 0. External network requests: 0. Screenshots: pending.');
  console.log(`JSON: ${paths.json}\nCSV: ${paths.csv}\nPacked model artifacts: ${paths.artifactDirectory}`);
  return automotiveBenchmarkExitCode(run.report);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  automotiveBenchmarkMain().then(code => { process.exitCode = code; }).catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
