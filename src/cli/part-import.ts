import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { PartImportService } from '../parts/import/service.js';

const args = process.argv.slice(2);
const value = (name: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const bundle = value('--bundle');
const promote = args.includes('--promote');
const confirm = value('--confirm');
if (!bundle) {
  console.error(JSON.stringify({ status: 'blocked', error: 'Usage: npm run import:part -- --bundle imports/<partId>/bundle.json [--output report.json] [--promote --confirm <partId>]' }, null, 2));
  process.exit(2);
}
if (promote && !confirm) {
  console.error(JSON.stringify({ status: 'blocked', error: '--promote requires --confirm <partId>.' }, null, 2));
  process.exit(2);
}
try {
  const service = new PartImportService();
  const directory = path.dirname(path.resolve(bundle));
  const report = await service.validate(directory);
  const output = value('--output');
  if (promote) {
    const record = await service.promote(directory, report, confirm!);
    const serialized = JSON.stringify({ status: 'promoted', record }, null, 2);
    if (output) { await mkdir(path.dirname(path.resolve(output)), { recursive: true }); await writeFile(output, serialized + '\n'); }
    console.log(serialized);
    process.exit(0);
  }
  const serialized = JSON.stringify(report, null, 2);
  if (output) { await mkdir(path.dirname(path.resolve(output)), { recursive: true }); await writeFile(output, serialized + '\n'); }
  console.log(serialized);
  process.exit(report.status === 'validated' ? 0 : 1);
} catch (error) {
  console.error(JSON.stringify({ status: 'blocked', error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exit(1);
}
