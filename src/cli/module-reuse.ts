import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { GrammarAssemblyService } from '../parts/grammar/service.js';
import { exportNativeAssemblyJson, exportNativeAssemblyLDraw, exportNativeAssemblyBomCsv } from '../parts/assembly/documents.js';
import { ModuleCatalog } from '../parts/modules/catalog.js';
import { moduleAssemblerFor, sameModulePose } from '../parts/modules/assembly.js';
import { checkMultiPointConnection } from '../parts/assembly/multipoint.js';
import { solveAttachment } from '../parts/assembly/solver.js';
import { checkNativePairCollision } from '../parts/assembly/collision.js';

const output = path.resolve(process.argv[2] ?? 'artifacts/module-reuse');
await mkdir(output, { recursive: true });
const service = new GrammarAssemblyService();
await service.ready();
const catalogue = await service.reusableModules(), models = [];
await writeFile(path.join(output, 'module-catalogue.json'), JSON.stringify(catalogue, null, 2));
for (const moduleId of ['76897-hood-core', '76897-hood-adapted']) for (const base of ['3001', '3020']) {
  const request = { module: 'module-assembly' as const, requiredModuleIds: [moduleId], requiredPartIds: [base] };
  const result = await service.generate(request);
  if (!result.model) throw new Error(`${moduleId}/${base}: ${result.reasons.join(' ')}`);
  const model = result.model, json = exportNativeAssemblyJson(model), graph = await service.engine.validateGraph(model);
  const reimport = await service.importModel(JSON.parse(json));
  if (!graph.valid || reimport.status !== 'VALID' || !reimport.model?.moduleComposition) throw new Error('Module whole-model revalidation or provenance preservation failed.');
  const directory = path.join(output, 'models', `${moduleId}-${base}`);
  await mkdir(directory, { recursive: true });
  const files = { 'model.json': json, 'model.ldr': exportNativeAssemblyLDraw(model), 'bom.csv': exportNativeAssemblyBomCsv(model),
    'steps.json': JSON.stringify(model.steps, null, 2), 'sources.json': JSON.stringify({ parts: model.sources, modules: model.moduleComposition }, null, 2),
    'reimported.json': JSON.stringify(reimport.model, null, 2), 'validation.json': JSON.stringify({ graph, reimport: reimport.status, search: result.search }, null, 2) };
  for (const [name, content] of Object.entries(files)) await writeFile(path.join(directory, name), content.endsWith('\n') ? content : content + '\n');
  const summary = { moduleId, base, placements: model.placements.length, edges: model.edges.length, steps: model.steps.length, bom: model.bom, reimport: reimport.status };
  models.push(summary); console.log(JSON.stringify(summary));
}

// Preserve exact rejected source poses as evidence, without rewriting the source
// recipe or certifying an otherwise blocked original design.
const spoiler = new ModuleCatalog().get('76897-spoiler-blade');
const wingBase = await service.engine.createAssembly(spoiler.members[0].partId);
const fixedPart = (await service.engine.getPart(spoiler.members[0].partId))!;
const moving = spoiler.members[1], movingPart = (await service.engine.getPart(moving.partId))!;
const fixedCap = (await service.engine.getCapability(fixedPart.partId))!;
const movingCap = (await service.engine.getCapability(moving.partId))!;
const matches = checkMultiPointConnection({ fixedPart, fixedPlacement: wingBase.placements[0], movingPart,
  movingPlacement: { instanceId: 'source-1', partId: moving.partId, transform: moving.transform },
  allowedFixedConnectionIds: new Set(fixedCap.allowedConnectionIds), allowedMovingConnectionIds: new Set(movingCap.allowedConnectionIds) });
const wingAttempts = [];
for (const match of matches.matches) {
  const solved = solveAttachment({ fixedPart, fixedPlacement: wingBase.placements[0], fixedConnectionId: match.fixedConnectionId,
    movingPart, movingConnectionId: match.movingConnectionId });
  const exact = solved.candidates.find(candidate => sameModulePose(candidate.transform, moving.transform));
  if (!exact) continue;
  const result = await service.engine.attachPart(wingBase, { anchorInstanceId: 'root', anchorConnectionId: match.fixedConnectionId,
    partId: moving.partId, candidateConnectionId: match.movingConnectionId, twistDegrees: exact.twistDeg });
  wingAttempts.push({ match, sourceTarget: moving.transform, solved: exact, accepted: result.accepted,
    rejections: result.rejections, collision: checkNativePairCollision(fixedPart, wingBase.placements[0], movingPart,
      { instanceId: 'source-1', partId: moving.partId, transform: moving.transform }, exact.penetrationZone) });
}
if (!wingAttempts.length || wingAttempts.some(attempt => attempt.accepted)) throw new Error('Blocked wing regression changed; inspect the source poses and current rules.');

const obstacleBase = await service.engine.createAssembly('3001');
const obstacleRequest = { anchorInstanceId: 'root', anchorConnectionId: 'p/stud.dat:8:4', partId: '11211',
  candidateConnectionId: 'parts/s/3004s01.dat:8:5', twistDegrees: 180 };
const obstacle = await service.engine.attachPart(obstacleBase, obstacleRequest);
if (!obstacle.accepted) throw new Error('The real obstruction fixture could not be assembled.');
const before = JSON.stringify(obstacle.graph), selection = { anchorInstanceId: 'root', anchorConnectionId: 'p/stud.dat:8:0',
  localId: 'source-0', connectionId: 'parts/3460.dat:8:15', twistDegrees: 0 };
let rejectedAttempts = 0;
const rejected = await moduleAssemblerFor(service.engine).attach(obstacle.graph, '76897-hood-core',
  { take: () => ++rejectedAttempts <= 50 }, selection);
const unchanged = JSON.stringify(obstacle.graph) === before;
if (rejected.accepted || !unchanged || !rejected.reasons.some(reason => reason.includes('native-plastic-collision'))) throw new Error('Real collision/atomic rollback regression failed.');
await writeFile(path.join(output, 'negative-cases.json'), JSON.stringify({ versions: service.engine.versions,
  sourceSnapshot: service.repository.snapshotDigest,
  spoiler: { recipe: spoiler.recipe, root: wingBase, moving, matches, attempts: wingAttempts,
    interpretation: 'Rejected source reconstruction pose, not a finding that the physical retail set is impossible.' },
  obstruction: { obstacleRequest, graph: obstacle.graph, moduleId: '76897-hood-core', selection,
    accepted: rejected.accepted, reasons: rejected.reasons, attempts: rejectedAttempts, inputUnchanged: unchanged } }, null, 2));
const changed = [], preserved = [];
for (const side of ['ldraw', 'shadow']) {
  const root = `data/parts-foundation/${side}`;
  const previous = JSON.parse(execFileSync('git', ['show', `fb250f3:${root}/manifest.json`], { encoding: 'utf8', maxBuffer: 5_000_000 }));
  for (const file of previous.files) {
    const bytes = await readFile(path.join(root, 'files', file.path));
    if (bytes.length !== file.bytes || createHash('sha256').update(bytes).digest('hex') !== file.sha256) changed.push(`${side}/${file.path}`);
    else preserved.push(`${side}/${file.path}`);
  }
}
if (changed.length) throw new Error('Original native source bytes changed.');
const status = await service.status();
await writeFile(path.join(output, 'generation-results.json'), JSON.stringify({ baseline: 'fb250f3', sourceSnapshot: service.repository.snapshotDigest,
  counts: status.counts, sourceCounts: status.sourceCounts, blockedReasons: status.blockedReasons, models,
  qualificationCounts: { structural: status.capabilities.filter(capability => capability.generatable).length,
    exteriorShell: status.capabilities.filter(capability => capability.exteriorGeneratable).length },
  originalSources: { unchanged: preserved.length, changed }, sourceImports: 0, qualificationChanges: 0,
  actualGenerationCoverage: { models: models.length, uniquePartIds: [...new Set(models.flatMap(model => model.bom.map(row => row.partId)))].sort(),
    reviewedDesigns: 1, usableRecipes: 2, blockedRecipes: 1, newPartIdentityCoverage: 0 },
  interpretation: 'One set-source hood design, two reviewed extraction/adaptation recipes, four generated installations. Spoiler remains blocked. No physical or full-car claim.' }, null, 2));
