import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { exportNativeAssemblyBomCsv, exportNativeAssemblyJson, exportNativeAssemblyLDraw } from '../parts/assembly/documents.js';
import { NATIVE_MODULE_TYPES, type NativeGeneratorSearch, type NativeModuleType } from '../parts/assembly/generator.js';
import { AssemblyService } from '../parts/assembly/service.js';
import { checkMultiPointConnection, physicalConnectionKey } from '../parts/assembly/multipoint.js';
import { solveAttachment } from '../parts/assembly/solver.js';
import type { AssemblyInterfaceCapability, NativeAssembly, NativeAssemblyPart } from '../parts/assembly/types.js';
import type { ImportedConnectionPoint } from '../parts/connections/types.js';

/** A separate production witness; it does not change the seven module results. */
async function productionBridgeProbe(service: AssemblyService, cacheReady: boolean) {
  const partIds = ['3023b', '3005'] as const;
  const capabilities: AssemblyInterfaceCapability[] = [], sources: { partId: string; geometry: NativeAssemblyPart['geometry']['source']; connections: NativeAssemblyPart['connections']['sourceFiles'] }[] = [];
  const reasons: string[] = [], stages: { name: string; nodes: number; edges: number }[] = [];
  let graph: NativeAssembly | null = null, attachmentApiCalls = 0;
  const result = (status: 'passed' | 'blocked' | 'failed', extra: Record<string, unknown> = {}) => ({
    status, scope: 'production-whitelist-source-solver-native-collision-and-complete-graph',
    purpose: 'A real 3023b floor, two 3005 posts, and one 3023b plate seated across both posts.',
    physicalBuildVerified: false, versions: service.engine.versions, capabilities, sources, stages,
    nodes: graph?.placements.length ?? 0, edges: graph?.edges.length ?? 0, attachmentApiCalls,
    sourceHashes: graph?.sourceHashes ?? {}, reasons: [...new Set(reasons)].slice(0, 16), graph, ...extra,
  });
  if (!cacheReady) { reasons.push('A current production migration cache is required; the probe did not use provisional capabilities.'); return result('blocked'); }
  try {
    const parts = new Map<string, NativeAssemblyPart>(), byCapability = new Map<string, AssemblyInterfaceCapability>();
    for (const id of partIds) {
      const part = await service.engine.getPart(id), capability = await service.engine.getCapability(id);
      if (part) { parts.set(id, part); sources.push({ partId: id, geometry: part.geometry.source, connections: part.connections.sourceFiles }); }
      if (capability) { capabilities.push(capability); byCapability.set(id, capability); }
      if (!part || !capability?.assemblyVerified || !capability.generatable || !capability.allowedConnectionIds.length || part.connections.status !== 'ready') reasons.push(`${id}: current native source and production interface admission are required.`);
    }
    if (reasons.length) return result('blocked');
    const points = (id: string, gender: 'M' | 'F') => {
      const seen = new Set<string>();
      return parts.get(id)!.connections.points.filter(point => {
        if (point.gender !== gender || !point.dimensionsResolved || !byCapability.get(id)!.allowedConnectionIds.includes(point.id)) return false;
        const key = physicalConnectionKey(point); if (seen.has(key)) return false; seen.add(key); return true;
      });
    };
    const floorStuds = points('3023b', 'M').filter(point => point.family === 'stud').sort((a, b) => a.position[0] - b.position[0] || a.position[2] - b.position[2]);
    if (floorStuds.length !== 2) { reasons.push('The actual 3023b source needs two distinct production-enabled floor studs for this witness.'); return result('blocked'); }
    graph = await service.engine.createAssembly('3023b');
    stages.push({ name: 'floor', nodes: graph.placements.length, edges: graph.edges.length });
    const attach = async (assembly: NativeAssembly, fixedInstanceId: string, anchor: ImportedConnectionPoint, movingPartId: string, supportIds: string[] = []) => {
      const fixedPlacement = assembly.placements.find(placement => placement.instanceId === fixedInstanceId)!, fixedPart = parts.get(fixedPlacement.partId)!, movingPart = parts.get(movingPartId)!;
      for (const receiver of points(movingPartId, 'F')) {
        const solved = solveAttachment({ fixedPart, fixedPlacement, fixedConnectionId: anchor.id, movingPart, movingConnectionId: receiver.id });
        if (solved.status !== 'solved') { reasons.push(solved.reason); continue; }
        for (const candidate of solved.candidates) {
          if (supportIds.length) {
            const neighbors = new Set<string>();
            for (const id of supportIds) {
              const placement = assembly.placements.find(item => item.instanceId === id)!;
              const matches = checkMultiPointConnection({ fixedPart: parts.get(placement.partId)!, fixedPlacement: placement, movingPart, movingPlacement: { instanceId: 'source-preview', partId: movingPartId, transform: candidate.transform }, allowedFixedConnectionIds: new Set(byCapability.get(placement.partId)!.allowedConnectionIds), allowedMovingConnectionIds: new Set(byCapability.get(movingPartId)!.allowedConnectionIds) }).matches;
              if (matches.some(match => byCapability.get(placement.partId)!.allowedConnectionIds.includes(match.fixedConnectionId) && byCapability.get(movingPartId)!.allowedConnectionIds.includes(match.movingConnectionId))) neighbors.add(id);
            }
            if (neighbors.size < supportIds.length) continue;
          }
          attachmentApiCalls++;
          const attached = await service.engine.attachPart(assembly, { anchorInstanceId: fixedInstanceId, anchorConnectionId: anchor.id, partId: movingPartId, candidateConnectionId: receiver.id, twistDegrees: candidate.twistDeg });
          if (attached.accepted) return attached.graph;
          reasons.push(...attached.rejections.map(rejection => `${rejection.code}: ${rejection.reason}`));
        }
      }
      return null;
    };
    const postIds: string[] = [];
    for (const [index, stud] of floorStuds.entries()) {
      const next = await attach(graph, graph.placements[0].instanceId, stud, '3005');
      if (!next) { reasons.push(`Post ${index + 1}: no permitted source pose passed production attachment.`); return result('blocked'); }
      graph = next; postIds.push(graph.placements.at(-1)!.instanceId);
      stages.push({ name: `post-${index + 1}`, nodes: graph.placements.length, edges: graph.edges.length });
    }
    const anchor = points('3005', 'M').find(point => point.family === 'stud');
    if (!anchor) { reasons.push('The source 3005 upper stud is not production enabled.'); return result('blocked'); }
    const beforeEdges = graph.edges.length, next = await attach(graph, postIds[0], anchor, '3023b', postIds);
    if (!next) { reasons.push('The top plate has no source-solved pose that passes current permissions and native collision against both posts.'); return result('blocked'); }
    graph = next;
    const newInstance = graph.placements.at(-1)!.instanceId, newEdges = graph.edges.filter(edge => edge.movingInstanceId === newInstance), supportingNeighbors = new Set(newEdges.map(edge => edge.fixedInstanceId));
    const validation = await service.engine.validateGraph(graph);
    stages.push({ name: 'bridge', nodes: graph.placements.length, edges: graph.edges.length });
    if (!validation.valid || graph.placements.length !== 4 || graph.edges.length - beforeEdges < 2 || !postIds.every(id => supportingNeighbors.has(id))) {
      reasons.push(...validation.issues, 'The final source graph did not prove a four-part bridge with two new edges to two existing posts.');
      return result('blocked', { validation, newEdges: newEdges.length, supportingNeighbors: [...supportingNeighbors] });
    }
    reasons.length = 0;
    return result('passed', { validation, newEdges: newEdges.length, supportingNeighbors: [...supportingNeighbors] });
  } catch (error) {
    reasons.push(error instanceof Error ? error.message.slice(0, 2000) : 'Unknown production bridge probe error.');
    return result('failed');
  }
}

const args = process.argv.slice(2);
let outputDirectory = path.resolve('artifacts', 'assembly-development');
let reportDirectory: string | undefined;
for (let index = 0; index < args.length; index += 2) {
  if ((args[index] !== '--output' && args[index] !== '--report-dir') || !args[index + 1]) throw new Error('Usage: assembly-smoke [--output directory] [--report-dir trusted-migration-directory]');
  if (args[index] === '--output') outputDirectory = path.resolve(args[index + 1]);
  else reportDirectory = path.resolve(args[index + 1]);
}

interface ModuleSmokeResult {
  module: NativeModuleType;
  status: 'generated' | 'blocked' | 'failed';
  reasons: string[];
  elapsedMilliseconds: number;
  search?: NativeGeneratorSearch;
  modelId?: string;
  partCount?: number;
  graphEdges?: number;
  multiPointPlacements?: number;
  contentSha256?: string;
  sourceHashes?: Record<string, string>;
  artifacts?: { json: string; ldraw: string; bom: string };
}

const started = Date.now();
const service = new AssemblyService(reportDirectory ? { dataDir: reportDirectory } : {});
const runtime = await service.status();
const versions = {
  partLibraryVersion: runtime.partLibraryVersion,
  assemblyEngineVersion: runtime.assemblyEngineVersion,
  connectionRuleVersion: runtime.connectionRuleVersion,
  collisionVersion: runtime.collisionVersion,
};
const results: ModuleSmokeResult[] = [];
let reportSha256: string | null = null;
if (runtime.runtimeValidation.reportLoaded) {
  reportSha256 = createHash('sha256').update(await readFile(path.join(service.reportDirectory, 'migration.json'))).digest('hex');
}
const ready = runtime.runtimeValidation.reportLoaded && runtime.runtimeValidation.status !== 'blocked' && runtime.generatedAt !== null && runtime.counts.generatable > 0;
await mkdir(outputDirectory, { recursive: true });
for (const module of NATIVE_MODULE_TYPES) {
  const moduleStarted = Date.now();
  if (!ready) {
    results.push({ module, status: 'blocked', reasons: ['A current source-verified production migration cache is required. No verification-mode or fallback catalogue was used.', ...runtime.runtimeValidation.issues], elapsedMilliseconds: 0 });
    continue;
  }
  process.stdout.write(`${module}: generating from ${runtime.counts.generatable} production-admitted native parts...\n`);
  try {
    const result = await service.generate({ module });
    const row: ModuleSmokeResult = { module, status: result.status, reasons: result.reasons, search: result.search, elapsedMilliseconds: Date.now() - moduleStarted };
    if (result.status === 'generated' && result.model) {
      const model = result.model;
      const modelDirectory = path.join(outputDirectory, 'models', module);
      const artifacts = { json: `models/${module}/model.json`, ldraw: `models/${module}/model.ldr`, bom: `models/${module}/bom.csv` };
      // Serialize all three before writing: unsupported or modified models produce no new export.
      const documents = { json: exportNativeAssemblyJson(model), ldraw: exportNativeAssemblyLDraw(model), bom: exportNativeAssemblyBomCsv(model) };
      await mkdir(modelDirectory, { recursive: true });
      for (const format of ['json', 'ldraw', 'bom'] as const) await writeFile(path.join(outputDirectory, artifacts[format]), documents[format]);
      const connectionCounts = new Map<string, number>();
      for (const edge of model.edges) connectionCounts.set(edge.movingInstanceId, (connectionCounts.get(edge.movingInstanceId) ?? 0) + 1);
      Object.assign(row, { modelId: model.id, partCount: model.placements.length, graphEdges: model.edges.length, multiPointPlacements: [...connectionCounts.values()].filter(count => count > 1).length, contentSha256: model.contentSha256, sourceHashes: model.sourceHashes, artifacts });
    }
    results.push(row);
    process.stdout.write(`${module}: ${row.status}; ${row.partCount ?? 0} parts; ${row.search?.attempts ?? 0} attachment attempts; ${row.elapsedMilliseconds} ms\n`);
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 2000) : 'Unknown native generator error.';
    results.push({ module, status: 'failed', reasons: [reason], elapsedMilliseconds: Date.now() - moduleStarted });
    process.stdout.write(`${module}: failed; ${reason}\n`);
  }
}

const sourceHashes: Record<string, string> = {};
for (const result of results) for (const [partId, hash] of Object.entries(result.sourceHashes ?? {})) {
  if (sourceHashes[partId] && sourceHashes[partId] !== hash) throw new Error(`Source changed between smoke modules for native part ${partId}.`);
  sourceHashes[partId] = hash;
}
const summary = {
  requested: NATIVE_MODULE_TYPES.length,
  generated: results.filter(result => result.status === 'generated').length,
  blocked: results.filter(result => result.status === 'blocked').length,
  failed: results.filter(result => result.status === 'failed').length,
  physicalBuildsVerified: 0,
};
const runtimeAudit = {
  candidateAttempts: results.reduce((sum, result) => sum + (result.search?.attempts ?? 0), 0),
  attachmentApiCalls: results.reduce((sum, result) => sum + (result.search?.attachmentApiCalls ?? 0), 0),
  acceptedBranchPlacements: results.reduce((sum, result) => sum + (result.search?.acceptedAttachments ?? 0), 0),
  rejectedCandidates: results.reduce((sum, result) => sum + (result.search?.rejectedAttachments ?? 0), 0),
  transformFailureCandidates: results.reduce((sum, result) => sum + (result.search?.transformFailures ?? 0), 0),
  compatibilityFailureCandidates: results.reduce((sum, result) => sum + (result.search?.compatibilityFailures ?? 0), 0),
  collisionFailureCandidates: results.reduce((sum, result) => sum + (result.search?.collisionFailures ?? 0), 0),
  occupancyFailureCandidates: results.reduce((sum, result) => sum + (result.search?.occupancyFailures ?? 0), 0),
  designGoalFailureCandidates: results.reduce((sum, result) => sum + (result.search?.designGoalFailures ?? 0), 0),
  searchTimeMs: results.reduce((sum, result) => sum + (result.search?.searchTimeMs ?? 0), 0),
  catalogTimeMs: results.reduce((sum, result) => sum + (result.search?.catalogTimeMs ?? 0), 0),
  multiPointPlacements: results.reduce((sum, result) => sum + (result.multiPointPlacements ?? 0), 0),
};
const bridgeProbe = await productionBridgeProbe(service, ready);
const bridgeArtifact = 'regression-probes/production-bridge.json';
await mkdir(path.join(outputDirectory, 'regression-probes'), { recursive: true });
await writeFile(path.join(outputDirectory, bridgeArtifact), JSON.stringify(bridgeProbe, null, 2) + '\n');
process.stdout.write(`production-bridge: ${bridgeProbe.status}; ${bridgeProbe.nodes} nodes; ${bridgeProbe.edges} edges; ${bridgeProbe.attachmentApiCalls} production attachment calls\n`);
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  scope: 'production-engine-and-current-saved-per-interface-migration-evidence',
  summary,
  runtimeAudit,
  bridgeProbe: { status: bridgeProbe.status, nodes: bridgeProbe.nodes, edges: bridgeProbe.edges, attachmentApiCalls: bridgeProbe.attachmentApiCalls, reasons: bridgeProbe.reasons, artifact: bridgeArtifact },
  modules: results,
  limitations: ['A passing result verifies source-backed virtual seating and final native mesh collision checks; it does not certify physical construction or swept insertion clearance.', 'Search time budgets are checked between bounded native operations; one in-flight source/collision verification is not interrupted.', 'LDraw current colour 16 is unspecified; official colour and owned inventory availability are unverified.', 'Wheel modules remain blocked until rim, tyre and axle interfaces have complete passing native assembly fixtures.'],
  elapsedMilliseconds: Date.now() - started,
  versions,
  runtime: { migrationVersion: runtime.migrationVersion, migrationGeneratedAt: runtime.generatedAt, interfaceBudget: runtime.interfaceBudget, validation: runtime.runtimeValidation, counts: runtime.counts, sourceCounts: runtime.sourceCounts, ...('interfaceCoverage' in runtime ? { interfaceCoverage: runtime.interfaceCoverage } : {}) },
  sourceHashes,
  migrationReportSha256: reportSha256,
};
await writeFile(path.join(outputDirectory, 'generator-smoke.json'), JSON.stringify(report, null, 2) + '\n');
process.stdout.write(`${JSON.stringify({ summary, runtimeAudit, versions, runtimeCounts: runtime.counts, runtimeSourceCounts: runtime.sourceCounts, sourceHashes, migrationReportSha256: reportSha256, report: path.relative(process.cwd(), path.join(outputDirectory, 'generator-smoke.json')) }, null, 2)}\n`);
if (!ready || results.some(result => result.module !== 'wheel-module' && result.status !== 'generated') || results.some(result => result.status === 'failed') || bridgeProbe.status === 'failed') process.exitCode = 2;
