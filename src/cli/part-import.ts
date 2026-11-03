import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { PartImportService } from '../parts/import/service.js';

const args = process.argv.slice(2);
const value = (name: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const bundle = value('--bundle');
if (!bundle) {
  console.error('Usage: npm run import:part -- --bundle imports/<partId>/bundle.json [--output report.json]');
  process.exit(2);
}
try {
  const service = new PartImportService();
  const report = await service.validate(path.dirname(path.resolve(bundle)));
  const output = value('--output');
  const serialized = JSON.stringify(report, null, 2);
  if (output) await writeFile(output, serialized + '\n');
  console.log(serialized);
  process.exit(report.status === 'validated' ? 0 : 1);
} catch (error) {
  console.error(JSON.stringify({ status: 'blocked', error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exit(1);
}
