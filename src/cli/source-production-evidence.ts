import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { GrammarAssemblyService } from '../parts/grammar/service.js';
import { exportNativeAssemblyBomCsv, exportNativeAssemblyJson, exportNativeAssemblyLDraw } from '../parts/assembly/documents.js';
import type { NativeModuleRequest } from '../parts/assembly/generator.js';

// Reproduction requests specify structural goals and identities only. The
// production generator/engine choose every port and rigid placement.
const output = path.resolve(process.argv[2] ?? 'artifacts/source-guided-production');
await mkdir(output, { recursive: true });
const service = new GrammarAssemblyService();
await service.ready();
const models = [];
const cases: { name: string; request: NativeModuleRequest }[] = [
  { name: 'tall-brick-support', request: { module: 'interface-assembly', partCount: 5, requiredPartIds: ['2431', '14716'] } },
  { name: 'tall-brick-column', request: { module: 'interface-assembly', partCount: 4, requiredPartIds: ['14716'] } },
  { name: 'bar-clip-control', request: { module: 'bar-clip', requiredPartIds: ['30374', '48729b'] } },
  { name: 'pin-hole-control', request: { module: 'pin-hole', requiredPartIds: ['3673', '32000'] } },
];
for (const item of cases) {
  const result = await service.generate(item.request);
  if (!result.model) throw new Error(`${item.name}: ${JSON.stringify(result.reasons)}`);
  const model = result.model, graph = await service.engine.validateGraph(model);
  const json = exportNativeAssemblyJson(model), reimport = await service.importModel(JSON.parse(json));
  if (!graph.valid || reimport.status !== 'VALID') throw new Error(`${item.name}: whole-model acceptance failed`);
  const directory = path.join(output, 'models', item.name);
  await mkdir(directory, { recursive: true });
  const files = {
    'model.json': json, 'model.ldr': exportNativeAssemblyLDraw(model), 'bom.csv': exportNativeAssemblyBomCsv(model),
    'steps.json': JSON.stringify(model.steps, null, 2), 'sources.json': JSON.stringify(model.sources, null, 2),
    'reimported.json': JSON.stringify(reimport.model, null, 2),
    'validation.json': JSON.stringify({ graph, reimport: reimport.status, search: result.search, sourceSnapshot: model.sourceSnapshot }, null, 2),
  };
  for (const [name, content] of Object.entries(files)) await writeFile(path.join(directory, name), content.endsWith('\n') ? content : content + '\n');
  models.push({ name: item.name, request: item.request, placements: model.placements.length, edges: model.edges.length, bom: model.bom, steps: model.steps.length, reimport: reimport.status,
    used14716Ports: [...new Set(model.edges.flatMap(edge => [[edge.fixedInstanceId, edge.fixedConnectionId], [edge.movingInstanceId, edge.movingConnectionId]])
      .filter(([id]) => model.placements.some(p => p.instanceId === id && p.partId === '14716')).map(([, port]) => port))],
    physicalBuildVerified: false, installationPathVerified: false });
}

// Verify all pre-round source files against the immutable baseline manifests.
// No geometry repair, source write, or download occurs here.
const baseline = 'd3b6299b65bc8bb77c52b989177d3e2b43dc423b';
const preservation = [];
for (const side of ['ldraw', 'shadow']) {
  const root = `data/parts-foundation/${side}`;
  const before = JSON.parse(execFileSync('git', ['show', `${baseline}:${root}/manifest.json`], { encoding: 'utf8', maxBuffer: 5_000_000 }));
  const current = JSON.parse(await readFile(`${root}/manifest.json`, 'utf8'));
  const oldPaths = new Set<string>(before.files.map((f: { path: string }) => f.path));
  const changed = [];
  for (const file of before.files) {
    const bytes = await readFile(path.join(root, 'files', file.path));
    const digest = createHash('sha256').update(bytes).digest('hex');
    const record = current.files.find((f: { path: string }) => f.path === file.path);
    if (digest !== file.sha256 || bytes.length !== file.bytes || record?.sha256 !== file.sha256 || record?.bytes !== file.bytes) changed.push(file.path);
  }
  if (changed.length) throw new Error(`Original source changed: ${JSON.stringify(changed)}`);
  preservation.push({ library: side, originalFiles: before.files.length, changed, addedFiles: current.files.filter((f: { path: string }) => !oldPaths.has(f.path)) });
}
const report = { baseline, sourceSnapshot: service.repository.snapshotDigest, status: await service.status(), models, sourcePreservation: preservation,
  interpretation: 'Current production generation and literal JSON reimport only. No continuous installation path, retention, stability or physical build certification.' };
await writeFile(path.join(output, 'production-evidence.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ models, originalSourceFilesUnchanged: preservation.reduce((n, row) => n + row.originalFiles, 0) }, null, 2));
