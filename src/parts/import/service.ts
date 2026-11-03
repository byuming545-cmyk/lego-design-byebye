import { access, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NativePartRepository } from '../assembly/source.js';
import type { CollisionClass, NativeAssemblyPart } from '../assembly/types.js';
import type { AssemblyPairAttachRequest } from '../assembly/service.js';
import { GrammarAssemblyService } from '../grammar/service.js';
import { adaptNativePartConnectors, type ConnectorIngestion } from '../grammar/sources.js';
import type { GrammarPartAdmission } from '../grammar/admission.js';
import { BUNDLED_LDRAW_DIRECTORY } from '../ldraw/bundled.js';
import { exportNativeAssemblyJson } from '../assembly/documents.js';
import type { NativeModuleType } from '../assembly/generator.js';
import { readPartImportBundle, SHADOW_DIRECTORY, stagePartImport, type PartImportBundle } from './bundle.js';

export interface ImportedFeature { featureId: string; connectionId: string; family: string; role: string; ruleId: string | null; supported: boolean; ruleIds: string[]; reasonCodes: string[] }
export interface ImportedCandidate {
  fixedPartId: string;
  fixedConnectionId: string;
  movingPartId: string;
  movingConnectionId: string;
  direction: 'new-moving' | 'existing-moving';
  ruleId: string;
  collisionClass: CollisionClass;
  accepted: boolean;
  code: string;
  reason: string;
  graphValid?: boolean;
  placements?: number;
  edges?: number;
  generated?: boolean;
  generationStatus?: string;
  reimport?: string;
}
export interface BundleSummary {
  partId: string;
  name: string;
  author: string;
  geometry: { revision: string; license: string; sourceUrl: string; files: { path: string; sha256: string; bytes: number }[] };
  connections: { revision: string; license: string; sourceUrl: string; files: { path: string; sha256: string; bytes: number }[] };
}
export interface PartImportReport {
  partId: string;
  status: 'validated' | 'blocked';
  sourceReady: boolean;
  geometryStatus: string;
  connectionStatus: string;
  generationEligible: boolean;
  exteriorGeneratable: boolean;
  bundle: BundleSummary;
  supportedFeatures: ImportedFeature[];
  candidates: ImportedCandidate[];
  generation: { attempted: boolean; status?: string; reasons: string[]; jsonBytes?: number; reimport?: string };
  limitations: string[];
}
export interface PromotionRecord {
  partId: string;
  promotedAt: string;
  files: string[];
  ldrawRevision: string;
  shadowRevision: string;
  validation: PartImportReport;
}
export class PartImportError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'PartImportError'; }
}

const DECLARED_RULES = new Set(['C01', 'BAR_CLIP', 'PIN_HOLE']);
const GENERATION_MODULES: Record<string, readonly NativeModuleType[]> = {
  C01: ['wall', 'simple-chassis'],
  BAR_CLIP: ['bar-clip'],
  PIN_HOLE: ['pin-hole'],
};

function features(ingestion: ConnectorIngestion, admission: GrammarPartAdmission | undefined): ImportedFeature[] {
  const support = new Map((admission?.featureSupport ?? []).map(item => [item.featureId, item]));
  return ingestion.connectors.map(feature => {
    const item = support.get(feature.featureId);
    return {
      featureId: feature.featureId,
      connectionId: feature.sourceConnectionId ?? '',
      family: feature.family,
      role: feature.role,
      ruleId: feature.matchingPolicy?.ruleId ?? null,
      supported: item?.supported === true,
      ruleIds: item?.ruleIds ?? [],
      reasonCodes: item?.reasonCodes ?? [],
    };
  });
}

function candidateFeatures(part: NativeAssemblyPart, admission: GrammarPartAdmission | undefined) {
  return adaptNativePartConnectors(part).connectors.filter(feature =>
    feature.sourceConnectionId !== null &&
    feature.matchingPolicy !== null &&
    DECLARED_RULES.has(feature.matchingPolicy.ruleId) &&
    (admission?.featureSupport ?? []).some(item => item.featureId === feature.featureId && item.supported));
}

function classFor(admission: GrammarPartAdmission | undefined): CollisionClass | null {
  if (admission?.generationEligible) return 'structural';
  if (admission?.exteriorGeneratable) return 'exterior-shell';
  return null;
}

function summary(value: PartImportBundle): BundleSummary {
  return {
    partId: value.partId, name: value.name, author: value.author,
    geometry: { revision: value.geometry.revision, license: value.geometry.license, sourceUrl: value.geometry.sourceUrl, files: value.geometry.files },
    connections: { revision: value.connections.revision, license: value.connections.license, sourceUrl: value.connections.sourceUrl, files: value.connections.files },
  };
}

export class PartImportService {
  constructor(private readonly dataDir?: string) {}

  async validate(directory: string): Promise<PartImportReport> {
    const bundle = await readPartImportBundle(directory);
    const staged = await stagePartImport(directory, bundle);
    try {
      const repository = new NativePartRepository({ geometryDirectory: staged.ldrawDirectory, shadowDirectory: staged.shadowDirectory });
      const service = new GrammarAssemblyService({ repository, ...(this.dataDir ? { dataDir: this.dataDir } : {}) });
      await service.ready();
      const part = await repository.getPart(bundle.partId);
      if (!part) throw new PartImportError('part-not-loaded', 'The staged part could not be loaded by the native repository.');
      const admission = await service.getGrammarAdmission(bundle.partId);
      if (!admission) throw new PartImportError('part-not-admitted', 'The staged part has no grammar admission record.');
      const ingestion = adaptNativePartConnectors(part);
      const supportedFeatures = features(ingestion, admission);
      const movingClass = classFor(admission);
      const candidates: ImportedCandidate[] = [];
      let winning: ImportedCandidate | undefined;
      let generation: PartImportReport['generation'] = { attempted: false, reasons: [] };
      if (movingClass) {
        const deadline = Date.now() + 45_000;
        const movingFeatures = candidateFeatures(part, admission);
        let attempts = 0;
        for (const fixedId of await repository.listIds()) {
          if (fixedId === part.partId || attempts >= 64 || Date.now() > deadline) continue;
          const fixedPart = await repository.getPart(fixedId);
          const fixedAdmission = fixedPart ? await service.getGrammarAdmission(fixedId) : undefined;
          const fixedClass = classFor(fixedAdmission);
          if (!fixedPart || !fixedAdmission || fixedClass !== 'structural') continue;
          const fixedFeatures = candidateFeatures(fixedPart, fixedAdmission);
          for (const fixedFeature of fixedFeatures) for (const movingFeature of movingFeatures) {
            if (attempts >= 64 || Date.now() > deadline) break;
            if (fixedFeature.role === movingFeature.role || fixedFeature.matchingPolicy?.ruleId !== movingFeature.matchingPolicy?.ruleId) continue;
            attempts++;
            const ruleId = movingFeature.matchingPolicy!.ruleId;
            const request: AssemblyPairAttachRequest = {
              partA: fixedId, connectionA: fixedFeature.sourceConnectionId!,
              partB: part.partId, connectionB: movingFeature.sourceConnectionId!,
              twistDegrees: 0, ...(movingClass === 'exterior-shell' ? { collisionClass: movingClass } : {}),
            };
            const result = await service.attach(request);
            const graphValid = result.graph ? (await service.engine.validateGraph(result.graph)).valid : false;
            const candidate: ImportedCandidate = {
              fixedPartId: fixedId, fixedConnectionId: fixedFeature.sourceConnectionId!,
              movingPartId: part.partId, movingConnectionId: movingFeature.sourceConnectionId!,
              direction: 'new-moving', ruleId, collisionClass: movingClass,
              accepted: result.accepted, code: result.rejections[0]?.code ?? (result.accepted ? 'accepted' : 'unknown'),
              reason: result.rejections[0]?.reason ?? (result.accepted ? 'accepted' : 'no graph'),
              graphValid, placements: result.graph?.placements.length, edges: result.graph?.edges.length,
            };
            candidates.push(candidate);
            if (result.accepted && graphValid && result.graph) {
              const generated = await this.generate(service, fixedId, part.partId, ruleId, movingClass);
              generation = generated.generation;
              Object.assign(candidate, generated.candidate);
              if (generated.ok) { winning = candidate; break; }
            }
          }
          if (winning) break;
        }
        if (!winning && movingClass === 'structural') {
          // The new part can also be the fixed root; existing structural parts become the moving side.
          for (const movingId of await repository.listIds()) {
            if (movingId === part.partId || attempts >= 64 || Date.now() > deadline) continue;
            const existing = await repository.getPart(movingId);
            const existingAdmission = existing ? await service.getGrammarAdmission(movingId) : undefined;
            if (!existing || classFor(existingAdmission) !== 'structural') continue;
            const newFeatures = candidateFeatures(part, admission);
            const existingFeatures = candidateFeatures(existing, existingAdmission);
            for (const newFeature of newFeatures) for (const existingFeature of existingFeatures) {
              if (attempts >= 64 || Date.now() > deadline) break;
              if (newFeature.role === existingFeature.role || newFeature.matchingPolicy?.ruleId !== existingFeature.matchingPolicy?.ruleId) continue;
              attempts++;
              const ruleId = newFeature.matchingPolicy!.ruleId;
              const result = await service.attach({ partA: part.partId, connectionA: newFeature.sourceConnectionId!, partB: movingId, connectionB: existingFeature.sourceConnectionId!, twistDegrees: 0 });
              const graphValid = result.graph ? (await service.engine.validateGraph(result.graph)).valid : false;
              const candidate: ImportedCandidate = {
                fixedPartId: part.partId, fixedConnectionId: newFeature.sourceConnectionId!,
                movingPartId: movingId, movingConnectionId: existingFeature.sourceConnectionId!,
                direction: 'existing-moving', ruleId, collisionClass: 'structural',
                accepted: result.accepted, code: result.rejections[0]?.code ?? (result.accepted ? 'accepted' : 'unknown'),
                reason: result.rejections[0]?.reason ?? (result.accepted ? 'accepted' : 'no graph'),
                graphValid, placements: result.graph?.placements.length, edges: result.graph?.edges.length,
              };
              candidates.push(candidate);
              if (result.accepted && graphValid) {
                const generated = await this.generate(service, part.partId, movingId, ruleId, 'structural');
                generation = generated.generation;
                Object.assign(candidate, generated.candidate);
                if (generated.ok) { winning = candidate; break; }
              }
            }
            if (winning) break;
          }
        }
      }
      return {
        partId: bundle.partId, status: winning ? 'validated' : 'blocked', sourceReady: admission.sourceReady,
        geometryStatus: part.geometry.status, connectionStatus: part.connections.status,
        generationEligible: admission.generationEligible, exteriorGeneratable: admission.exteriorGeneratable,
        bundle: summary(bundle), supportedFeatures, candidates, generation,
        limitations: [
          'This is staging validation only. It does not modify the pinned catalogue or promote the part.',
          'Only explicitly declared source interfaces and the current rules are checked; no appearance-based inference is used.',
          'Final-pose collision is not an installation-path proof, a material/retention proof or a physical-build proof.',
          'A blocked report is not evidence that the part cannot connect; it means no fully validated two-part model was found under the current rules, source and collision contracts.',
        ],
      };
    } finally {
      await staged.cleanup();
    }
  }

  private async generate(service: GrammarAssemblyService, fixedId: string, movingId: string, ruleId: string, collisionClass: CollisionClass): Promise<{ ok: boolean; generation: PartImportReport['generation']; candidate: Partial<ImportedCandidate> }> {
    const generation: PartImportReport['generation'] = { attempted: true, reasons: [] };
    const modules = GENERATION_MODULES[ruleId] ?? [];
    for (const module of modules) {
      try {
        const result = await service.generate({ module, requiredPartIds: [fixedId, movingId] });
        generation.status = result.status;
        generation.reasons = result.reasons;
        if (result.model) {
          const json = exportNativeAssemblyJson(result.model);
          generation.jsonBytes = json.length;
          generation.reimport = (await service.importModel(JSON.parse(json))).status;
          if (generation.reimport === 'VALID') return { ok: true, generation, candidate: { generated: true, generationStatus: result.status, reimport: generation.reimport } };
        }
      } catch (error) {
        generation.status = 'error';
        generation.reasons = [error instanceof Error ? error.message : String(error)];
      }
    }
    return { ok: false, generation, candidate: { generated: false, generationStatus: generation.status, reimport: generation.reimport } };
  }

  async promote(directory: string, report: PartImportReport, confirmPartId: string): Promise<PromotionRecord> {
    if (report.partId !== confirmPartId) throw new PartImportError('promotion-confirm-mismatch', 'Confirmed partId does not match the validation report.');
    if (report.status !== 'validated') throw new PartImportError('promotion-blocked', 'Only a fully validated report can be promoted.');
    const fresh = await this.validate(directory);
    if (fresh.status !== 'validated') throw new PartImportError('promotion-revalidation-failed', 'Fresh validation did not pass.');
    const bundle = await readPartImportBundle(directory);
    if (bundle.partId !== confirmPartId) throw new PartImportError('promotion-confirm-mismatch', 'Confirmed partId does not match the bundle.');
    const staged = await stagePartImport(directory, bundle);
    const ldrawManifestPath = path.join(BUNDLED_LDRAW_DIRECTORY, 'manifest.json');
    const shadowManifestPath = path.join(SHADOW_DIRECTORY, 'manifest.json');
    const ldrawBackup = await readFile(ldrawManifestPath);
    const shadowBackup = await readFile(shadowManifestPath);
    const copied: string[] = [];
    try {
      for (const file of bundle.geometry.files) {
        const target = path.join(BUNDLED_LDRAW_DIRECTORY, 'files', file.path);
        if (await access(target).then(() => true, () => false)) throw new PartImportError('promotion-target-exists', `Refusing to overwrite existing LDraw source: ${file.path}`);
      }
      for (const file of bundle.connections.files) {
        const target = path.join(SHADOW_DIRECTORY, 'files', file.path);
        if (await access(target).then(() => true, () => false)) throw new PartImportError('promotion-target-exists', `Refusing to overwrite existing Shadow source: ${file.path}`);
      }
      for (const file of bundle.geometry.files) {
        const target = path.join(BUNDLED_LDRAW_DIRECTORY, 'files', file.path);
        await mkdir(path.dirname(target), { recursive: true });
        await copyFile(path.join(directory, 'ldraw', file.path), target);
        copied.push(target);
      }
      for (const file of bundle.connections.files) {
        const target = path.join(SHADOW_DIRECTORY, 'files', file.path);
        await mkdir(path.dirname(target), { recursive: true });
        await copyFile(path.join(directory, 'shadow', file.path), target);
        copied.push(target);
      }
      await writeFile(ldrawManifestPath, await readFile(path.join(staged.ldrawDirectory, 'manifest.json')));
      await writeFile(shadowManifestPath, await readFile(path.join(staged.shadowDirectory, 'manifest.json')));
      return { partId: bundle.partId, promotedAt: new Date().toISOString(), files: copied, ldrawRevision: bundle.geometry.revision, shadowRevision: bundle.connections.revision, validation: fresh };
    } catch (error) {
      await writeFile(ldrawManifestPath, ldrawBackup).catch(() => undefined);
      await writeFile(shadowManifestPath, shadowBackup).catch(() => undefined);
      await Promise.all(copied.map(target => rm(target, { force: true }).catch(() => undefined)));
      throw error;
    } finally {
      await staged.cleanup();
    }
  }
}
