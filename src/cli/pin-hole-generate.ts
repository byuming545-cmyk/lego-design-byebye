import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { GrammarAssemblyService } from '../parts/grammar/service.js';
import { exportNativeAssemblyBomCsv, exportNativeAssemblyJson, exportNativeAssemblyLDraw } from '../parts/assembly/documents.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const directory = path.join(ROOT, 'artifacts', 'pin-hole');
await mkdir(directory, { recursive: true });

const service = new GrammarAssemblyService();
await service.ready();
const status = await service.status();
const generated = await service.generate({ module: 'pin-hole' });
if (generated.status !== 'generated' || !generated.model) throw new Error(`Pin-Hole generation was blocked: ${generated.reasons.join('; ')}`);
const model = generated.model;
const json = exportNativeAssemblyJson(model);
const imported = await service.importModel(JSON.parse(json));
if (imported.status !== 'VALID') throw new Error(`Pin-Hole reimport failed: ${imported.reasons.join('; ')}`);

await writeFile(path.join(directory, 'model.json'), json);
await writeFile(path.join(directory, 'model.ldr'), exportNativeAssemblyLDraw(model));
await writeFile(path.join(directory, 'bom.csv'), exportNativeAssemblyBomCsv(model));
await writeFile(path.join(directory, 'model-revalidation.json'), JSON.stringify({
  schemaVersion: 'pin-hole-model-revalidation-1',
  generatedAt: new Date().toISOString(),
  exportedBytes: Buffer.byteLength(json),
  exportedSha256: createHash('sha256').update(json).digest('hex'),
  modelContentSha256: model.contentSha256,
  importStatus: imported.status,
  importReasons: imported.reasons,
  importedBom: imported.model?.bom ?? [],
  assemblyValidation: model.assemblyValidation,
  physicalBuildVerified: model.physicalBuildVerified,
}, null, 2));

const pinned = [...new Set(model.placements.map(placement => placement.partId))];
const report = {
  schemaVersion: 'pin-hole-generation-report-1',
  generatedAt: new Date().toISOString(),
  branch: 'codex/pin-pin-hole-source-grammar',
  baseCommit: 'ffd1d6d',
  module: model.module,
  moduleName: model.name,
  status: generated.status,
  reasons: generated.reasons,
  placements: model.placements.map(placement => ({ instanceId: placement.instanceId, partId: placement.partId, transform: placement.transform })),
  edges: model.edges,
  bom: model.bom,
  steps: model.steps,
  sources: model.sources,
  search: generated.search,
  versions: {
    partLibraryVersion: model.partLibraryVersion,
    assemblyEngineVersion: model.assemblyEngineVersion,
    connectionRuleVersion: model.connectionRuleVersion,
    collisionVersion: model.collisionVersion,
  },
  exported: { jsonBytes: Buffer.byteLength(json), jsonSha256: createHash('sha256').update(json).digest('hex'), ldrPath: 'model.ldr', bomPath: 'bom.csv' },
  reimport: { status: imported.status, reasons: imported.reasons, path: 'model-revalidation.json' },
  productionCounts: status.counts,
  admissions: Object.fromEntries(await Promise.all(pinned.map(async (partId) => [partId, await service.getCapability(partId)]))),
  physicalBuildVerified: false,
  limitations: [
    'This is one real two-part Pin-Hole placement, not a physical build or a retention/stress proof.',
    'The pin-bearing part uses a source-scoped open-surface proxy and the full pinned multi-section pin envelope; the connector-hole part remains a closed solid. This is not a closed-solid certificate for the pin, and seat-contained vertex penetration is explicitly not physical clearance.',
    'The 18591 windscreen carries source-declared pins but its body collides outside the seat with the 32000 hole test poses; it is admitted but not used here.',
    'Axial friction, pull-out force and physical fit remain UNKNOWN.',
  ],
};
await writeFile(path.join(directory, 'generation-report.json'), JSON.stringify(report, null, 2));
process.stdout.write(`${JSON.stringify({ status: generated.status, module: model.module, placements: model.placements.map(placement => placement.partId), edges: model.edges.length, steps: model.steps.length, exportBytes: Buffer.byteLength(json), reimport: imported.status, counts: status.counts }, null, 2)}\n`);
