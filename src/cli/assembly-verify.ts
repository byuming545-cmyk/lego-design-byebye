import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { AttachmentEngine } from '../parts/assembly/engine.js';
import { NativePartRepository } from '../parts/assembly/source.js';
import { createAssemblySourceLoader } from '../parts/assembly/fixtures.js';
import { compactAssemblyMigrationReport, runAssemblyMigration } from '../parts/assembly/migration.js';

const repository = new NativePartRepository();
const args = process.argv.slice(2);
let maxInterfacesPerPart: number | null = 32;
if (args.length) {
  if (args.length === 1 && args[0] === '--all-interfaces') maxInterfacesPerPart = null;
  else if (args.length === 2 && args[0] === '--max-interfaces-per-part' && /^[1-9]\d*$/.test(args[1]) && Number(args[1]) <= 512) maxInterfacesPerPart = Number(args[1]);
  else throw new Error('Usage: assembly-verify [--max-interfaces-per-part 32 | --all-interfaces]');
}
const loader = await createAssemblySourceLoader(repository);
const engine = new AttachmentEngine({ loadPart: id => repository.getPart(id), mode: 'verification' });
const started = Date.now();
const report = await runAssemblyMigration({
  sourceLoader: loader, engine, maxInterfacesPerPart,
  onProgress(entry, completed, total) {
    if (completed % 10 === 0 || completed === total) process.stdout.write(`${completed}/${total} ${entry.partId} ${entry.status} ${entry.allowedConnectionIds.length} enabled interfaces; ${Math.round((Date.now() - started) / 1000)}s\n`);
  },
});
const artifactDir = path.resolve('artifacts', 'assembly-development');
const runtimeDir = path.resolve('data', 'parts-foundation', 'assembly');
await mkdir(artifactDir, { recursive: true });
await mkdir(runtimeDir, { recursive: true });
const fullText = JSON.stringify(report);
const fullArtifactName = 'migration-full.json.gz';
await writeFile(path.join(artifactDir, fullArtifactName), gzipSync(fullText, { level: 9 }));
const compact = compactAssemblyMigrationReport(report);
const output = { ...compact, fullReportArtifact: { file: `artifacts/assembly-development/${fullArtifactName}`, uncompressedSha256: createHash('sha256').update(fullText).digest('hex'), uncompressedBytes: Buffer.byteLength(fullText) } };
const runtimeText = JSON.stringify(output, null, 2);
if (Buffer.byteLength(runtimeText) > 10 * 1024 * 1024) throw new Error('Compact migration report exceeds the 10 MiB runtime bundle limit.');
await writeFile(path.join(runtimeDir, 'migration.json'), runtimeText);
process.stdout.write(`${JSON.stringify({ counts: report.counts, sourceCounts: report.sourceCounts, blockedReasons: report.blockedReasons, representativePairs: report.representativePairs.map(pair => ({ id: pair.id, status: pair.status, reason: pair.reason })), runtimeBytes: Buffer.byteLength(runtimeText), elapsedSeconds: Math.round((Date.now() - started) / 1000) }, null, 2)}\n`);
