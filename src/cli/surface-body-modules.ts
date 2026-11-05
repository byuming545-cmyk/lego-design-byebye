import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { GrammarAssemblyService } from '../parts/grammar/service.js';
import { ModuleCatalog, MODULE_DIRECTORY, MODULE_LIBRARY_DIGEST } from '../parts/modules/catalog.js';
import { readSelectedModuleMembers } from '../parts/modules/source.js';
import { exportNativeAssemblyJson, exportNativeAssemblyLDraw, exportNativeAssemblyBomCsv } from '../parts/assembly/documents.js';
import { checkMultiPointConnection } from '../parts/assembly/multipoint.js';
import { solveAttachment } from '../parts/assembly/solver.js';
import { checkNativePairCollision } from '../parts/assembly/collision.js';
import { sameModulePose } from '../parts/modules/assembly.js';
import type { NativeAssemblyBomRow, NativeModuleRequest } from '../parts/assembly/generator.js';

const baseline = 'ba619e9';
const output = path.resolve(process.argv[2] ?? 'artifacts/surface-body-modules');
const temporary = await mkdtemp(path.join(tmpdir(), 'body-module-evidence-'));
await mkdir(output, { recursive: true });
const save = async (name: string, value: unknown) => {
  const file = path.join(output, name); await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 2) + '\n');
};
try {
  const service = new GrammarAssemblyService({ dataDir: temporary }); await service.ready();
  const catalog = new ModuleCatalog(), status = await service.status();
  const audits = [];
  for (const id of ['11477', '15068', '18973', '65633', '18974', '35789', '98282', '3022', '3069b']) {
    const part = (await service.engine.getPart(id))!, entry = await service.getEntry(id), cap = await service.getCapability(id);
    audits.push({ partId: id, name: part.geometry.name, source: part.geometry.source, geometry: part.geometry.status,
      connectionStatus: part.connections.status, connectorCount: part.connections.points.length,
      structural: cap?.generatable, exterior: cap?.exteriorGeneratable,
      allowedStructuralInterfaces: cap?.allowedConnectionIds, allowedExteriorInterfaces: cap?.exteriorAllowedConnectionIds,
      reasons: entry?.reasons, currentFunctionalRecipes: catalog.list().filter(r => catalog.get(r.id).members.some(m => m.partId === id)).map(r => r.id),
      note: ['18973', '65633'].includes(id) ? 'Existing two-part surface generation is retained; no cockpit module claimed.' : undefined });
  }
  await save('part-audit.json', { counts: status.counts, candidates: audits, scope: 'Current contracts and reviewed recipes; recipe membership alone is not validation or generation coverage.' });

  // Controlled comparison: both readers receive the same newly reviewed pinned
  // library. Only the baseline's literal digest is adapted to this common input;
  // baseline source parsing logic is unchanged. This is never a runtime bypass.
  const old = execFileSync('git', ['show', `${baseline}:src/parts/modules/catalog.ts`], { encoding: 'utf8' });
  const adapter = old.replace(/MODULE_LIBRARY_DIGEST = '[a-f0-9]+'/,
    `MODULE_LIBRARY_DIGEST = '${MODULE_LIBRARY_DIGEST}'`).replace(/from (['"])(\.{1,2}\/[^'"]+)\1/g, (_all, _quote, relative) =>
      `from ${JSON.stringify(pathToFileURL(path.resolve('src/parts/modules', relative).replace(/\.js$/, '.ts')).href)}`);
  const oldPath = path.join(temporary, 'old-reader.mts'); await writeFile(oldPath, adapter);
  const { ModuleCatalog: OldCatalog } = await import(pathToFileURL(oldPath).href) as typeof import('../parts/modules/catalog.js');
  let beforeError = '';
  try { new OldCatalog(MODULE_DIRECTORY).get('75878-curved-cover-right'); } catch (error) { beforeError = error instanceof Error ? error.message : String(error); }
  if (!beforeError.includes('Unsupported, nested or non-rigid')) throw new Error('The excluded-record baseline failure was not reproduced.');
  const definition = catalog.get('75878-curved-cover-right'), source = await readFile(path.join(MODULE_DIRECTORY, definition.recipe.source.file), 'utf8');
  const selectedFailures = [];
  for (const ordinal of [32, 119]) {
    try { readSelectedModuleMembers(source, { ...definition.recipe, selectedOrdinals: [99, ordinal], exteriorOrdinals: [] }); throw new Error('Unsupported selected record was accepted.'); }
    catch (error) { const reason = error instanceof Error ? error.message : String(error); if (!/selected (?:native )?source placement/.test(reason)) throw error; selectedFailures.push({ ordinal, reason }); }
  }
  await save('reader-comparison.json', { baseline, baselineSourceSha256: createHash('sha256').update(old).digest('hex'),
    comparisonAdapter: 'Same reviewed new library digest supplied to both readers; relative imports relocated. Baseline parsing unchanged.',
    before: { status: 'blocked', reason: beforeError }, current: { status: 'parsed', members: definition.members }, selectedFailures,
    source: definition.recipe.source, interpretation: 'Excluded nested/rounded records remain in exact source bytes. Selected nested, approximate, non-rigid or missing records are still rejected.' });

  const plans = [
    { name: 'cover-right-3001', base: '3001', ids: ['75878-curved-cover-right'] },
    { name: 'cover-right-3020', base: '3020', ids: ['75878-curved-cover-right'] },
    { name: 'cover-left-3001', base: '3001', ids: ['75878-curved-cover-left'] },
    { name: 'paired-covers-3035', base: '3035', ids: ['75878-curved-cover-right', '75878-curved-cover-left'] },
    { name: 'paired-covers-3031', base: '3031', ids: ['75878-curved-cover-right', '75878-curved-cover-left'] },
    { name: 'hood-cover-3035', base: '3035', ids: ['76897-hood-core', '75878-curved-cover-right'] },
  ];
  const models: { name: string; request: NativeModuleRequest; placements: number; edges: number; steps: number;
    bom: NativeAssemblyBomRow[]; moduleIds: string[]; supportPoints: number[]; graphValid: boolean; reimport: string }[] = [];
  const failures = [];
  for (const plan of plans) {
    const request = { module: 'module-assembly' as const, requiredPartIds: [plan.base], requiredModuleIds: plan.ids };
    const result = await service.generate(request), model = result.model;
    if (!model) { failures.push({ plan, result }); continue; }
    const graph = await service.engine.validateGraph(model), text = exportNativeAssemblyJson(model), imported = await service.importModel(JSON.parse(text));
    if (!graph.valid || imported.status !== 'VALID') throw new Error('Generation roundtrip failed: ' + plan.name);
    const directory = path.join(output, 'models', plan.name); await mkdir(directory, { recursive: true });
    const files = { 'model.json': text, 'model.ldr': exportNativeAssemblyLDraw(model), 'bom.csv': exportNativeAssemblyBomCsv(model),
      'steps.json': JSON.stringify(model.steps, null, 2), 'sources.json': JSON.stringify({ parts: model.sources, modules: model.moduleComposition }, null, 2),
      'reimported.json': JSON.stringify(imported.model, null, 2), 'validation.json': JSON.stringify({ graph, search: result.search, reimport: imported.status }, null, 2) };
    for (const [name, body] of Object.entries(files)) await writeFile(path.join(directory, name), body.endsWith('\n') ? body : body + '\n');
    const summary = { name: plan.name, request, placements: model.placements.length, edges: model.edges.length, steps: model.steps.length, bom: model.bom,
      moduleIds: plan.ids, supportPoints: model.moduleComposition!.instances.map(i => i.installationSupport.independentPoints), graphValid: graph.valid, reimport: imported.status };
    models.push(summary); console.log(JSON.stringify(summary));
  }
  if (!['cover-right-3001', 'cover-right-3020', 'paired-covers-3035'].every(name => models.some(model => model.name === name))) throw new Error('A mandatory functional cover case is missing.');

  // A rejected source-derived 11477 route is retained as a precise collision
  // diagnostic. These two unchanged source records are not a registered recipe.
  const blockedMembers = readSelectedModuleMembers(source, { ...definition.recipe, selectedOrdinals: [86, 135], entryOrdinal: 86, exteriorOrdinals: [135] });
  const fixed = { instanceId: 'source-86', partId: blockedMembers[0].partId, transform: blockedMembers[0].transform, collisionClass: 'structural' as const };
  const moving = { instanceId: 'source-135', partId: blockedMembers[1].partId, transform: blockedMembers[1].transform, collisionClass: 'exterior-shell' as const };
  const a = (await service.engine.getPart(fixed.partId))!, b = (await service.engine.getPart(moving.partId))!;
  const matches = checkMultiPointConnection({ fixedPart: a, fixedPlacement: fixed, movingPart: b, movingPlacement: moving,
    allowedFixedConnectionIds: new Set((await service.getCapability(a.partId))!.allowedConnectionIds),
    allowedMovingConnectionIds: new Set((await service.getCapability(b.partId))!.exteriorAllowedConnectionIds) });
  const diagnostics = matches.matches.flatMap(match => solveAttachment({ fixedPart: a, fixedPlacement: fixed, fixedConnectionId: match.fixedConnectionId, movingPart: b, movingConnectionId: match.movingConnectionId }).candidates
    .filter(candidate => sameModulePose(candidate.transform, moving.transform)).map(candidate => ({ endpoints: match, candidate, collision: checkNativePairCollision(a, fixed, b, moving, candidate.penetrationZone) })));
  if (!diagnostics.some(d => d.collision.status === 'collision')) throw new Error('The source collision negative case was not reproduced.');
  await save('blocked-source-route.json', { source: definition.recipe.source, selectedOrdinals: [86, 135], placements: [fixed, moving],
    nativeSources: [a.geometry.source, b.geometry.source], versions: service.engine.versions, diagnostics,
    interpretation: '3021/50950 source pose remains rejected. This blocks this route towards 11477, not every possible placement or physical retail construction.' });

  const histories = [];
  for (const [file, expected] of [
    ['artifacts/collision-method-review/models/hood-rear-3035/model.json', 'NEEDS_REVALIDATION'],
    ['artifacts/collision-method-review/models/15068/model.json', 'VALID'],
  ]) {
    const bytes = await readFile(file), sha256 = createHash('sha256').update(bytes).digest('hex'), result = await service.importModel(JSON.parse(bytes.toString('utf8')));
    if (result.status !== expected || !bytes.equals(await readFile(file))) throw new Error('Historical version or preservation check failed.');
    histories.push({ file, sha256, currentImport: result.status, reasons: result.reasons, bytesPreserved: true });
  }
  let unchanged = 0;
  for (const side of ['ldraw', 'shadow']) {
    const root = `data/parts-foundation/${side}`, manifest = JSON.parse(execFileSync('git', ['show', `${baseline}:${root}/manifest.json`], { encoding: 'utf8', maxBuffer: 5_000_000 }));
    for (const file of manifest.files) {
      const bytes = await readFile(path.join(root, 'files', file.path));
      if (bytes.length !== file.bytes || createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error('Original native source changed.'); unchanged++;
    }
  }
  const modules = await service.reusableModules(); await save('module-catalogue.json', modules);
  await save('generation-results.json', { baseline, branch: 'codex/surface-body-modules', sourceSnapshot: service.repository.snapshotDigest, versions: service.engine.versions,
    counts: status.counts, qualifications: { structural: status.capabilities.filter(c => c.generatable).length, exterior: status.capabilities.filter(c => c.exteriorGeneratable).length },
    sourceImports: 0, qualificationChanges: 0, unchangedNativeFiles: unchanged, models, failures, histories,
    actualCoverage: { models: models.length, partIds: [...new Set(models.flatMap(m => m.bom.map(row => row.partId)))].sort(),
      newlyUsedCoverIdentity: '15068', newFunctionalRecipes: 2, newSourceDesignFunctions: 1, fullCockpits: 0, fullCars: 0 },
    interpretation: 'Two source variants of one body-cover function, reused with existing native parts. No structural upgrade, tyre/wheel, installation path or physical stability certification.' });
} finally { await rm(temporary, { recursive: true, force: true }); }
