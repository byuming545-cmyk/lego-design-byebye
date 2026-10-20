import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { automotiveBenchmarkExitCode, parseAutomotiveBenchmarkArgs, runAutomotiveBenchmark, writeAutomotiveBenchmarkReport } from '../automotive/benchmark.js';

export async function automotiveBenchmarkMain(args = process.argv.slice(2)): Promise<number> {
  const options = parseAutomotiveBenchmarkArgs(args);
  if (options.help) {
    console.log('Usage: npm run benchmark:automotive -- [--estimated] [--candidate-count 5..20] [--output directory] [--data-dir directory]\nRuns S63 at 8/10/12-wide and M4, 911, Roma, Revuelto at 8-wide through the actual local automotive HTTP API. Reads the configured reference/profile stores; makes no external network requests and requires no provider key. Without --estimated, unknown dimensions remain research-pending. Exit codes: 0 all nominal geometry PASS (visual resemblance and physical builds unassessed), 1 quality/execution failure, 2 research pending. Screenshots remain pending until captured in the browser.');
    return 0;
  }
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
