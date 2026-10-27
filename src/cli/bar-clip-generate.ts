import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { GrammarAssemblyService } from '../parts/grammar/service.js';
import { exportNativeAssemblyBomCsv, exportNativeAssemblyJson, exportNativeAssemblyLDraw } from '../parts/assembly/documents.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const directory = path.join(ROOT, 'artifacts', 'bar-clip');
await mkdir(directory, { recursive: true });

const service = new GrammarAssemblyService();
await service.ready();
const status = await service.status();
const generated = await service.generate({ module: 'bar-clip' });
if (generated.status !== 'generated' || !generated.model) throw new Error(`Bar-Clip generation was blocked: ${generated.reasons.join('; ')}`);
const model = generated.model;
const json = exportNativeAssemblyJson(model);
const imported = await service.importModel(JSON.parse(json));
if (imported.status !== 'VALID') throw new Error(`Bar-Clip reimport failed: ${imported.reasons.join('; ')}`);

await writeFile(path.join(directory, 'model.json'), json);
await writeFile(path.join(directory, 'model.ldr'), exportNativeAssemblyLDraw(model));
await writeFile(path.join(directory, 'bom.csv'), exportNativeAssemblyBomCsv(model));
await writeFile(path.join(directory, 'model-revalidation.json'), JSON.stringify({
  schemaVersion: 'bar-clip-model-revalidation-1',
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

const report = {
  schemaVersion: 'bar-clip-generation-report-1',
  generatedAt: new Date().toISOString(),
  branch: 'codex/bar-clip-source-grammar',
  baseCommit: 'fe74141de5870547d71d0874a39c4ca69c707487',
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
  admissions: {
    '30374': await service.getCapability('30374'),
    '48729b': await service.getCapability('48729b'),
    '60470b': await service.getCapability('60470b'),
  },
  physicalBuildVerified: false,
  limitations: [
    'This is one real two-part Bar-Clip placement, not a physical build or a full-seat/friction proof.',
    'The 60470b plate remains unusable for the current module because its body collides with the 80-LDU bar at every tested quarter turn; axial sliding is not admitted by the native solver.',
    'No source-backed Bar Receptacle exists in the pinned 253-root library.',
  ],
};
await writeFile(path.join(directory, 'generation-report.json'), JSON.stringify(report, null, 2));
process.stdout.write(`${JSON.stringify({ status: generated.status, module: model.module, placements: model.placements.map(placement => placement.partId), edges: model.edges.length, steps: model.steps.length, exportBytes: Buffer.byteLength(json), reimport: imported.status, counts: status.counts }, null, 2)}\n`);
