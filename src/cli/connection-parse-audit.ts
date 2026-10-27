import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createBundledLDrawResolver, loadBundledLDrawManifest } from '../parts/ldraw/index.js';
import { createBundledConnectionImporter } from '../parts/connections/index.js';
import { buildConnectionParseAudit, type ParseAuditInput } from '../parts/connections/audit.js';

async function main() {
  const args = process.argv.slice(2);
  let output = 'artifacts/connection-parse-audit', partId: string | undefined;
  for (let index = 0; index < args.length; index += 2) {
    if (args[index] === '--output' && args[index + 1]) output = args[index + 1];
    else if (args[index] === '--part' && args[index + 1] && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(args[index + 1])) partId = args[index + 1];
    else throw new Error('Usage: audit:connections [--part nativePartId] [--output directory]');
  }
  const manifest = await loadBundledLDrawManifest();
  const roots = manifest.roots.filter(root => !partId || root.partId === partId);
  if (!roots.length) throw new Error('The requested part is not a pinned native root. No synthetic source is created.');
  const importer = createBundledConnectionImporter(await createBundledLDrawResolver());
  const inputs: ParseAuditInput[] = [];
  for (const root of roots) inputs.push({ partId: root.partId, name: root.name, result: await importer.importPart(root.partId) });
  const report = await buildConnectionParseAudit(inputs, {
    async readSourceLine(source, line) {
      const text = await (source.library === 'LDraw' ? importer.library.getGeometryFile(source.path) : importer.library.getShadowFile(source.path));
      return text?.split(/\r?\n/)[line - 1]?.trim() ?? null;
    },
  });
  let baselineComparison: unknown = null;
  try {
    const baseline = JSON.parse(await readFile('artifacts/connection-parse-audit/before.json', 'utf8'));
    if (baseline.schemaVersion === 1 && Array.isArray(baseline.parts)) baselineComparison = {
      baselineParserVersion: baseline.parserVersion ?? 'unversioned-before-clear-scope',
      parts: report.parts.map(part => {
        const before = baseline.parts.find((row: { partId: string }) => row.partId === part.partId);
        return { partId: part.partId, beforeStatus: before?.status ?? null, afterStatus: part.status, beforePointCount: before?.points ?? null, afterPointCount: part.pointCount, unchangedPointRecords: typeof before?.pointSha256 === 'string' ? before.pointSha256 === part.pointSha256 : null, unchangedSourceClosure: typeof before?.sourceClosureSha256 === 'string' ? before.sourceClosureSha256 === part.sourceClosureSha256 : null };
      }),
    };
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ ...report, baselineComparison }, null, 2) + '\n');
  const quote = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const rows = [['caseId', 'partId', 'partStatus', 'sourceFile', 'sourceLine', 'instructionType', 'instruction', 'parserError', 'category', 'disposition', 'expectedInterpretation', 'sourceSha256', 'reproductionCommand'], ...report.failures.map(failure => [failure.caseId, failure.partId, failure.partParseStatus, failure.sourceFile, failure.sourceLine, failure.instructionType, failure.instruction, failure.parserError.message, failure.category, failure.disposition, failure.expectedInterpretation.status, failure.source?.sha256, failure.reproductionCommand])];
  await writeFile(path.join(output, 'failures.csv'), rows.map(row => row.map(quote).join(',')).join('\r\n') + '\r\n');
  console.info(JSON.stringify({ output: path.resolve(output), parserVersion: report.parserVersion, counts: report.counts, categories: report.categories }, null, 2));
}

main().catch(error => { console.error(error instanceof Error ? error.message : 'Connection parse audit failed.'); process.exitCode = 1; });
