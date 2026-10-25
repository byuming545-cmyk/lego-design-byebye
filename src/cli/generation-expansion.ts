import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createApp } from '../api/app.js';
import type { RuntimeAssemblyStatus } from '../parts/assembly/service.js';
import type { NativeGeneratedAssembly, NativeGenerationResult, NativeModuleType } from '../parts/assembly/generator.js';
import type { NativeModelImportResult } from '../parts/assembly/modelImport.js';
import type { FoundationPartDetail } from '../parts/registry.js';
import { isRigidTransform } from '../parts/assembly/math.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
function requireTrue(condition: unknown, reason: string): asserts condition { if (!condition) throw new Error(reason); }
interface Candidate { partId: string; candidateKind: string; purpose: string; source: { sha256: string; path: string; name: string } }
interface Attempt { request: { module: NativeModuleType; partCount: number; requiredPartIds: string[] }; status: string; reasons: string[]; search?: NativeGenerationResult['search'] }

/** Coverage goals use the ordinary production HTTP endpoints, including export
 * and upload revalidation. No capability injection, verification mode or poses. */
export async function generationExpansionMain(args = process.argv.slice(2)) {
  let output = path.join(ROOT, 'artifacts/generation-expansion');
  if (args.length) {
    if (args.length !== 2 || args[0] !== '--output') throw new Error('Usage: npm run coverage:expansion -- [--output directory]');
    output = path.resolve(args[1]);
  }
  const plan = JSON.parse(await readFile(path.join(ROOT, 'docs/generation-expansion/candidates.json'), 'utf8')) as { baselineCommit: string; candidates: Candidate[]; [key: string]: unknown };
  const server = createApp({ staticDir: false, provider: { source: 'rebrickable', async getSetInventory() { throw new Error('This native coverage run must not request online inventory.'); } } }).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing native coverage address.');
  const base = `http://127.0.0.1:${address.port}/api/parts-foundation`;
  async function call<T>(url: string, method = 'GET', data?: unknown): Promise<T> {
    const response = await fetch(`${base}${url}`, { method, signal: AbortSignal.timeout(180_000), ...(data === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }) });
    const body = await response.json();
    if (!response.ok) throw new Error(`${method} ${url}: ${response.status} ${JSON.stringify(body).slice(0, 700)}`);
    return body as T;
  }
  const results: Record<string, unknown>[] = [], models = new Map<string, NativeGeneratedAssembly>();
  const allCovered = new Set<string>();
  try {
    const status = await call<RuntimeAssemblyStatus>('/assembly/status');
    requireTrue(status.runtimeValidation.status === 'ready', `Production qualification is not ready: ${status.runtimeValidation.issues.join('; ')}`);
    const saveGenerated = async (label: string, generated: NativeGenerationResult, requiredIds: string[]) => {
      requireTrue(generated.status === 'generated' && generated.model, 'No generated model to preserve.');
      const model = generated.model;
      for (const id of requiredIds) requireTrue(model.placements.some(placement => placement.partId === id), `Required ${id} is absent.`);
      requireTrue(model.assemblyValidation.valid && model.placements.every(placement => isRigidTransform(placement.transform)), 'Whole-model or rigid-placement validation failed.');
      const counts = new Map<string, number>();
      for (const placement of model.placements) counts.set(placement.partId, (counts.get(placement.partId) ?? 0) + 1);
      requireTrue(model.bom.length === counts.size && model.bom.every(row => row.quantity === counts.get(row.partId)), 'BOM does not agree with generated instances.');
      requireTrue(model.steps.length === model.placements.length && model.steps.every(step => model.placements.some(placement => placement.instanceId === step.addedInstanceId && placement.partId === step.partId)), 'Steps omit or misidentify actual instances.');
      const fetched: Record<string, string> = {};
      for (const format of ['json', 'ldr', 'csv']) {
        const response = await fetch(`${base}/assembly/models/${encodeURIComponent(model.id)}/export?format=${format}`);
        requireTrue(response.ok, `Production ${format} export failed: ${response.status}`);
        fetched[format] = await response.text();
      }
      const reimport = await call<NativeModelImportResult>('/assembly/models/import', 'POST', { content: fetched.json });
      requireTrue(reimport.status === 'VALID' && reimport.model, `Exported model failed current upload validation: ${reimport.reasons.join('; ')}`);
      requireTrue(reimport.model.bom.length === counts.size && reimport.model.bom.every(row => row.quantity === counts.get(row.partId)), 'Reimported BOM differs.');
      for (const id of requiredIds) {
        requireTrue(model.sources.some(source => source.library === 'LDraw' && source.path === `parts/${id}.dat`), `Missing source evidence for ${id}.`);
        requireTrue(reimport.model.placements.some(placement => placement.partId === id) && reimport.model.steps.some(step => step.partId === id), `Reimport lost ${id}.`);
        requireTrue(fetched.ldr.includes(`${id}.dat`) && model.bom.some(row => row.partId === id), `Export omits ${id}.`);
      }
      const directory = path.join(output, 'models', label); await mkdir(directory, { recursive: true });
      await Promise.all([
        writeFile(path.join(directory, 'model.json'), fetched.json), writeFile(path.join(directory, 'model.ldr'), fetched.ldr), writeFile(path.join(directory, 'bom.csv'), fetched.csv),
        writeFile(path.join(directory, 'steps.json'), JSON.stringify(model.steps, null, 2) + '\n'), writeFile(path.join(directory, 'sources.json'), JSON.stringify(model.sources, null, 2) + '\n'),
        writeFile(path.join(directory, 'reimported.json'), JSON.stringify(reimport, null, 2) + '\n'),
      ]);
      const witness = { status: 'passed', requestRequiredPartIds: requiredIds, modelId: model.id, placements: model.placements.length, edges: model.edges.length,
        actualPartIds: [...counts.keys()].sort(), bomMatches: true, stepsMatch: true, currentSourceEvidencePresent: true, sourceHashes: model.sourceHashes,
        finalModelValidation: model.assemblyValidation, exportReimportStatus: reimport.status, validationScope: reimport.validationScope, physicalBuildVerified: false,
        files: ['model.json', 'model.ldr', 'bom.csv', 'steps.json', 'sources.json', 'reimported.json'], exportedJsonSha256: hash(fetched.json) };
      await writeFile(path.join(directory, 'validation.json'), JSON.stringify(witness, null, 2) + '\n');
      for (const id of counts.keys()) allCovered.add(id);
      models.set(label, model);
      return { ...witness, directory: path.relative(ROOT, directory) };
    };
    for (const candidate of plan.candidates) {
      const entry = status.entries.find(entry => entry.partId === candidate.partId);
      const detail = await call<FoundationPartDetail>(`/parts/${candidate.partId}`);
      const attempts: Attempt[] = [];
      const result: Record<string, unknown> = { ...candidate, source: { ...candidate.source, currentFiles: detail.geometry?.source.files, sourceHash: entry?.source.digest },
        geometryReady: detail.part.geometryReady, connectionStatus: detail.connections?.status, qualified: entry?.generatable === true,
        allowedConnectionIds: entry?.allowedConnectionIds ?? [], disabledConnectionIds: entry?.disabledConnectionIds ?? [], actualGenerationCoverage: false, attempts,
        reasonCodes: entry?.reasonCodes ?? ['missing-current-qualification'], reasons: entry?.reasons ?? [] };
      if (entry?.generatable) {
        const bounds = detail.geometry!.bounds!, height = bounds.max[1] - bounds.min[1];
        const modules: NativeModuleType[] = height <= 12.00001 ? ['platform', 'simple-chassis', 'wall', 'basic-snot', 'simple-roof'] : ['wall', 'simple-chassis', 'basic-snot', 'simple-roof', 'platform'];
        for (const module of modules) {
          const request = { module, partCount: 3, requiredPartIds: [candidate.partId] };
          const generated = await call<NativeGenerationResult>('/assembly/generate', 'POST', request);
          attempts.push({ request, status: generated.status, reasons: generated.reasons, search: generated.search });
          if (generated.status !== 'generated') continue;
          result.witness = await saveGenerated(`${candidate.partId}-${module}`, generated, request.requiredPartIds);
          result.actualGenerationCoverage = true; break;
        }
      }
      results.push(result);
      console.log(`${results.length}/${plan.candidates.length}\t${candidate.partId}\tqualified=${result.qualified}\tgenerated=${result.actualGenerationCoverage}\t${attempts.map(attempt => `${attempt.request.module}:${attempt.status}`).join(',')}`);
    }
    // A combined structural goal, using the exact same normal production API.
    const structureGoals = [
      { name: 'reinforced-native-chassis', module: 'simple-chassis' as const, partCount: 5, requiredPartIds: ['3456', '32000', '69729'] },
      { name: 'native-side-structure', module: 'basic-snot' as const, partCount: 3, requiredPartIds: ['87087'] },
    ];
    const structures: Record<string, unknown>[] = [];
    for (const goal of structureGoals) {
      const generated = await call<NativeGenerationResult>('/assembly/generate', 'POST', { module: goal.module, partCount: goal.partCount, requiredPartIds: goal.requiredPartIds });
      structures.push({ goal, status: generated.status, reasons: generated.reasons, search: generated.search,
        ...(generated.status === 'generated' ? { witness: await saveGenerated(goal.name, generated, goal.requiredPartIds) } : {}) });
    }
    const sample = [...models.values()].find(model => model.placements.some(placement => placement.partId === '32000'));
    requireTrue(sample, '32000 has no actual generated and reimported production witness.');
    const d32000 = await call<FoundationPartDetail>('/parts/32000');
    const pinHoles = d32000.connections!.points.filter(point => point.family === 'pinHole');
    requireTrue(pinHoles.length > 0 && pinHoles.every(point => !d32000.part.enabledConnectionIds?.includes(point.id)), 'A 32000 pin-hole interface was accidentally enabled.');
    const standard = await call<FoundationPartDetail>('/parts/3005');
    const stud = standard.connections!.points.find(point => point.gender === 'M' && standard.part.enabledConnectionIds?.includes(point.id))!;
    const disabledAttachment = await call<{ accepted: boolean; rejections: unknown[] }>('/assembly/attach', 'POST', { partA: '32000', connectionA: pinHoles[0].id, partB: '3005', connectionB: stud.id });
    requireTrue(!disabledAttachment.accepted, 'Disabled 32000 hole was accepted.');
    const negative: Record<string, unknown>[] = [{ name: '32000-pin-hole-direct-attachment', passed: !disabledAttachment.accepted, result: disabledAttachment }];
    async function rejectUpload(name: string, edit: (model: NativeGeneratedAssembly) => void) {
      const changed = structuredClone(sample!); edit(changed);
      const { contentSha256: _old, ...body } = changed;
      const sealed = { ...body, contentSha256: hash(JSON.stringify(body)) };
      const rejected = await call<NativeModelImportResult>('/assembly/models/import', 'POST', { content: JSON.stringify(sealed) });
      requireTrue(rejected.status === 'NEEDS_REVALIDATION' && rejected.model === null, `Tampered upload was accepted: ${name}`);
      negative.push({ name, recomputedChecksum: true, passed: true, status: rejected.status, reasons: rejected.reasons });
    }
    await rejectUpload('32000-disabled-hole-resealed-upload', model => {
      const node = model.placements.find(placement => placement.partId === '32000')!;
      const edge = model.edges.find(edge => edge.fixedInstanceId === node.instanceId || edge.movingInstanceId === node.instanceId)!;
      if (edge.fixedInstanceId === node.instanceId) edge.fixedConnectionId = pinHoles[0].id; else edge.movingConnectionId = pinHoles[0].id;
    });
    await rejectUpload('forged-extra-edge-and-duplicate-port', model => { model.edges.push({ ...model.edges[0], id: 'forged-extra-edge' }); });
    await rejectUpload('floating-placement', model => { model.placements.at(-1)!.transform.translation[0] += 10000; });
    await rejectUpload('source-hash-change', model => { model.sourceHashes['32000'] = '0'.repeat(64); });
    await rejectUpload('stale-library-version', model => { model.partLibraryVersion = 'obsolete-native-library'; });
    await rejectUpload('unknown-source-part', model => { model.placements.at(-1)!.partId = 'unknown-native-source'; });
    const wheel = await call<NativeGenerationResult>('/assembly/generate', 'POST', { module: 'wheel-module' });
    requireTrue(wheel.status === 'blocked' && wheel.model === null, 'Wheel module was enabled without mechanical evidence.');
    negative.push({ name: 'uncertified-wheel-module', passed: true, status: wheel.status, reasons: wheel.reasons });
    const successful = results.filter(result => result.actualGenerationCoverage);
    const countKind = (kind: string) => successful.filter(result => result.candidateKind === kind).length;
    const summary = { candidateCount: results.length, qualifiedCandidates: results.filter(result => result.qualified).length, actualCandidateGenerationCoverage: successful.length,
      newlyQualifiedAndGenerated: countKind('new-source-root-and-qualification') + countKind('staged-source-to-production-qualification') + countKind('existing-source-blocked-topology-assessment'),
      newSourcesQualifiedAndGenerated: countKind('new-source-root-and-qualification'), stagedPartsQualifiedAndGenerated: countKind('staged-source-to-production-qualification'),
      existingSourcesRecoveredAndGenerated: countKind('existing-source-blocked-topology-assessment'), existingQualifiedNewUses: countKind('existing-qualified-new-generator-use'),
      allActualGeneratedPartIds: [...allCovered].sort(), allActualGeneratedPartCount: allCovered.size, structuralExamplesPassed: structures.filter(result => result.status === 'generated').length,
      wheelCountedAsSuccess: false, negativeChecksPassed: negative.length };
    await mkdir(output, { recursive: true });
    await writeFile(path.join(output, 'generation-coverage.json'), JSON.stringify({ schemaVersion: 1, baselineCommit: plan.baselineCommit, generatedAt: new Date().toISOString(),
      api: 'ordinary production /api/parts-foundation/assembly endpoints; no synthetic capabilities or hand-authored placements',
      versions: { partLibraryVersion: status.partLibraryVersion, assemblyEngineVersion: status.assemblyEngineVersion, connectionRuleVersion: status.connectionRuleVersion, collisionVersion: status.collisionVersion, testVersion: status.testVersion },
      productionCounts: status.counts, productionInterfaceCoverage: status.interfaceCoverage, summary, candidates: results, structures, physicalBuildVerified: false }, null, 2) + '\n');
    await writeFile(path.join(output, 'negative-probes.json'), JSON.stringify({ schemaVersion: 1, checks: negative, status: 'passed' }, null, 2) + '\n');
    console.log(JSON.stringify(summary));
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  generationExpansionMain().catch(error => { console.error(error instanceof Error ? error.message : 'Generation expansion coverage failed.'); process.exitCode = 1; });
}
