import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { GrammarAssemblyService } from '../parts/grammar/service.js';
import { exportNativeAssemblyJson, exportNativeAssemblyLDraw, exportNativeAssemblyBomCsv } from '../parts/assembly/documents.js';
import { ModuleCatalog } from '../parts/modules/catalog.js';
import { moduleAssemblerFor } from '../parts/modules/assembly.js';
import { moduleSupport } from '../parts/modules/support.js';
import { diagnoseSpoiler } from './module-diagnostics.js';

const output = path.resolve(process.argv[2] ?? 'artifacts/module-composition');
await mkdir(output, { recursive: true });
const service = new GrammarAssemblyService(); await service.ready();
const catalogue = await service.reusableModules();
await writeFile(path.join(output, 'module-catalogue.json'), JSON.stringify(catalogue, null, 2) + '\n');
const cases = [
  ...['76897-hood-core', '76897-hood-adapted'].flatMap(moduleId => ['3001', '3020'].map(base => ({ name: `${moduleId}-${base}`, base, ids: [moduleId] }))),
  ...['3035', '3031'].map(base => ({ name: `hood-rear-${base}`, base, ids: ['76897-hood-core', '76897-rear-panel-core'] })),
];
const models = [], failures = [], beforeAfter = [];
for (const plan of cases) {
  const request = { module: 'module-assembly' as const, requiredPartIds: [plan.base], requiredModuleIds: plan.ids };
  const result = await service.generate(request), model = result.model;
  if (!model) { failures.push({ plan, result }); continue; }
  const graph = await service.engine.validateGraph(model), json = exportNativeAssemblyJson(model), imported = await service.importModel(JSON.parse(json));
  if (!graph.valid || imported.status !== 'VALID') { failures.push({ plan, graph, imported }); continue; }
  const directory = path.join(output, 'models', plan.name); await mkdir(directory, { recursive: true });
  const support = model.moduleComposition!.instances.map(instance => ({ moduleId: instance.moduleId, instanceId: instance.id,
    ...moduleSupport(model, new Set(instance.members.map(member => member.instanceId))) }));
  const files = { 'model.json': json, 'model.ldr': exportNativeAssemblyLDraw(model), 'bom.csv': exportNativeAssemblyBomCsv(model),
    'steps.json': JSON.stringify(model.steps, null, 2), 'sources.json': JSON.stringify({ parts: model.sources, modules: model.moduleComposition }, null, 2),
    'reimported.json': JSON.stringify(imported.model, null, 2), 'support.json': JSON.stringify(support, null, 2),
    'validation.json': JSON.stringify({ graph, reimport: imported.status, search: result.search }, null, 2) };
  for (const [name, content] of Object.entries(files)) await writeFile(path.join(directory, name), content.endsWith('\n') ? content : content + '\n');
  const summary = { name: plan.name, request, placements: model.placements.length, edges: model.edges.length, steps: model.steps.length, support, bom: model.bom, reimport: imported.status, search: result.search };
  models.push(summary);
  if (plan.ids.length === 1) {
    const historical = JSON.parse(await readFile(path.join('artifacts/module-reuse/models', plan.name, 'model.json'), 'utf8'));
    beforeAfter.push({ name: plan.name, previous: moduleSupport(historical, new Set<string>(historical.moduleComposition.instances[0].members.map((m: { instanceId: string }) => m.instanceId))), current: support[0] });
  }
  console.log(JSON.stringify({ name: plan.name, placements: model.placements.length, edges: model.edges.length,
    supportPoints: support.map(record => record.independentPoints), reimport: imported.status, searchTimeMs: result.search.searchTimeMs }));
}

const obstacleBase = await service.engine.createAssembly('3001');
const obstruction = await service.engine.attachPart(obstacleBase, { anchorInstanceId: 'root', anchorConnectionId: 'p/stud.dat:8:4', partId: '11211', candidateConnectionId: 'parts/s/3004s01.dat:8:5', twistDegrees: 180 });
if (!obstruction.accepted) throw new Error('Source-backed obstruction fixture cannot be reproduced.');
const original = JSON.stringify(obstruction.graph), selection = { anchorInstanceId: 'root', anchorConnectionId: 'p/stud.dat:8:0', localId: 'source-0', connectionId: 'parts/3460.dat:8:15', twistDegrees: 0 };
let attempts = 0;
const denied = await moduleAssemblerFor(service.engine).attach(obstruction.graph, '76897-hood-core', { take: () => ++attempts <= 50 }, selection);
if (denied.accepted || JSON.stringify(obstruction.graph) !== original || !denied.reasons.some(reason => reason.includes('native-plastic-collision'))) throw new Error('The real collision/unchanged-input negative case failed.');
await writeFile(path.join(output, 'negative-cases.json'), JSON.stringify({ graph: obstruction.graph, selection, moduleId: '76897-hood-core', result: { accepted: denied.accepted, reasons: denied.reasons, attempts, inputUnchanged: true } }, null, 2) + '\n');
await diagnoseSpoiler(service, output);

const unchanged: string[] = [];
for (const side of ['ldraw', 'shadow']) {
  const root = `data/parts-foundation/${side}`;
  const prior = JSON.parse(execFileSync('git', ['show', `3fb3f03:${root}/manifest.json`], { encoding: 'utf8', maxBuffer: 5_000_000 }));
  for (const file of prior.files) {
    const raw = await readFile(path.join(root, 'files', file.path));
    if (raw.length !== file.bytes || createHash('sha256').update(raw).digest('hex') !== file.sha256) throw new Error('Original native source changed: ' + file.path);
    unchanged.push(side + '/' + file.path);
  }
}
const priorModules = JSON.parse(execFileSync('git', ['show', '3fb3f03:data/parts-foundation/modules/library.json'], { encoding: 'utf8' }));
const catalog = new ModuleCatalog();
for (const recipe of priorModules.modules) if (JSON.stringify(recipe) !== JSON.stringify(catalog.get(recipe.id).recipe)) throw new Error('An original module recipe was silently changed.');
const status = await service.status();
await writeFile(path.join(output, 'generation-results.json'), JSON.stringify({ baseline: '3fb3f03', sourceSnapshot: service.repository.snapshotDigest,
  counts: status.counts, sourceCounts: status.sourceCounts, blockedReasons: status.blockedReasons,
  qualificationCounts: { structural: status.capabilities.filter(c => c.generatable).length, exteriorShell: status.capabilities.filter(c => c.exteriorGeneratable).length },
  models, failures, beforeAfter, originalSources: { unchanged: unchanged.length, changed: [] }, originalModuleRecipesUnchanged: priorModules.modules.length,
  newSourceParts: 0, newQualifications: 0, newModuleRecipes: 1, usableRecipes: catalogue.modules.filter(module => module.status === 'VALIDATED').length,
  actualCoverage: { uniquePartIds: [...new Set(models.flatMap(model => model.bom.map(row => row.partId)))].sort(),
    differentDesignFunctions: [...new Set(catalogue.modules.filter(module => module.status === 'VALIDATED').map(module => module.role))],
    allModulesMultiPoint: models.every(model => model.support.every(support => support.independentPoints >= 2)) },
  interpretation: 'Two small source design functions on real bases, not a complete car or physical stability certificate.' }, null, 2) + '\n');
if (failures.length) { console.error('Failed generation cases retained:', failures.length); process.exitCode = 2; }
