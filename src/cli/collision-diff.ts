import { readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import type { AssemblyMigrationReport } from '../parts/assembly/migration.js';

const directory = 'sol-handoff/v0.6-collision';
const beforeBytes = gunzipSync(await readFile(`${directory}/baseline-migration.json.gz`));
const afterBytes = await readFile('data/parts-foundation/assembly/migration.json');
const before = JSON.parse(beforeBytes.toString('utf8')) as AssemblyMigrationReport;
const after = JSON.parse(afterBytes.toString('utf8')) as AssemblyMigrationReport;
const records = JSON.parse(gunzipSync(await readFile('artifacts/assembly-development/interface-tests.json.gz')).toString('utf8')).records;
const decisions = new Map(after.entries.flatMap(entry => entry.interfaceCoverage!.decisions.map(decision => [decision.physicalInterfaceId, decision] as const)));
const changes = before.entries.flatMap(entry => entry.interfaceCoverage!.decisions.flatMap(old => {
  const current = decisions.get(old.physicalInterfaceId);
  if (!current) throw new Error('A native source interface disappeared.');
  if (old.status === current.status) return [];
  const record = records.find((record: { physicalInterfaceId: string }) => record.physicalInterfaceId === old.physicalInterfaceId);
  return [{ partId: entry.partId, physicalInterfaceId: old.physicalInterfaceId, rawConnectionIds: old.rawConnectionIds, before: old.status, after: current.status, reasons: current.reasons, reasonCodes: current.reasonCodes, execution: record?.execution }];
}));
const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), beforeSha256: createHash('sha256').update(beforeBytes).digest('hex'), afterSha256: createHash('sha256').update(afterBytes).digest('hex'), beforeVersion: before.collisionVersion, afterVersion: after.collisionVersion, before: before.interfaceCoverage, after: after.interfaceCoverage, oldPassRegressions: changes.filter(change => change.before === 'PASS'), changes };
await writeFile(`${directory}/interface-diff.json`, JSON.stringify(report, null, 2) + '\n');
console.info(JSON.stringify({ before: report.before, after: report.after, oldPassRegressions: report.oldPassRegressions.length, changes: changes.length }, null, 2));
