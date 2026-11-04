import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AssemblyStudioService } from '../parts/library/studio.js';
import { NativePartRepository } from '../parts/assembly/source.js';
const args = process.argv.slice(2);
const option = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const input = option('--input'), output = option('--output');
if (!input || !output) throw new Error('Usage: npm run replay:studio -- --input <exported-bundle.json> --output <report.json>');
const outputPath = path.resolve(output);
const storePath = path.resolve(process.env.BRICKLAB_DATA_DIR ?? 'data', 'interface-library/studio-examples.json');
if (outputPath === path.resolve(input) || outputPath === storePath || outputPath === path.resolve('data/interface-library/studio-examples.json')) {
  throw new Error('Replay report must not overwrite the input bundle or user example store.');
}
const bytes = await readFile(path.resolve(input));
if (bytes.length > 3_000_000) throw new Error('Replay input exceeds 3 MB.');
// Does not load or create the user observation store. replayBundle only reads native sources.
const studio = new AssemblyStudioService(new NativePartRepository(), path.resolve('data'));
const report = await studio.replayBundle(JSON.parse(bytes.toString('utf8')));
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ output, examples: report.examples.map(e => ({ id: e.id, status: e.status })), writesToUserStore: false, generationAdmission: false }));
