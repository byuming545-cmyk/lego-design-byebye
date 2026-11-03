import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NativePartRepository } from '../assembly/source.js';
import type { CollisionClass, NativeAssemblyPart } from '../assembly/types.js';
import type { AssemblyPairAttachRequest } from '../assembly/service.js';
import { GrammarAssemblyService } from '../grammar/service.js';
import { adaptNativePartConnectors, type ConnectorIngestion } from '../grammar/sources.js';
import type { GrammarPartAdmission } from '../grammar/admission.js';
import { exportNativeAssemblyJson } from '../assembly/documents.js';
import type { NativeModuleType } from '../assembly/generator.js';
import { BUNDLED_LDRAW_DIRECTORY } from '../ldraw/bundled.js';
import { readPartImportBundle, SHADOW_DIRECTORY, stagePartImport, type PartImportBundle, type PartImportRoots } from './bundle.js';
import { transactionalPromote } from './transaction.js';

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
export interface PartImportServiceOptions extends PartImportRoots { dataDir?: string; artifactsDirectory?: string }
export interface PromotionAuditSnapshot {
  totalRoots: number;
  counts: { total: number; generatable: number; blocked: number; disabledInterfaces: number };
  sourceCounts: { totalRoots: number; geometryReady: number; connectionReady: number; connectionPartial: number; connectionMissing: number };
  blockedReasons: Record<string, number>;
  exteriorGeneratable: number;
  newPart: { partId: string; sourceReady: boolean; generatable: boolean; exteriorGeneratable: boolean; connectionSourceStatus: string; allowedConnectionIds: string[]; exteriorAllowedConnectionIds: string[] } | null;
}
export interface PromotionAudit { before: PromotionAuditSnapshot; after: PromotionAuditSnapshot }
export interface PromotionRecord {
  partId: string;
  promotedAt: string;
  files: string[];
  ldrawRevision: string;
  shadowRevision: string;
  validation: PartImportReport;
  journalId?: string;
  ledgerPath?: string;
  promotionClass?: CollisionClass;
  audit?: PromotionAudit;
  auditArtifact?: string;
}
export class PartImportError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'PartImportError'; }
}

const DECLARED_RULES = new Set(['C01', 'BAR_CLIP', 'PIN_HOLE']);
const GENERATION_MODULES: Record<string, readonly NativeModuleType[]> = {
  C01: ['wall', 'simple-chassis', 'exterior-shell'],
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

async function auditSnapshot(service: GrammarAssemblyService, partId: string): Promise<PromotionAuditSnapshot> {
  const status = await service.status();
  const entry = status.entries.find(item => item.partId === partId);
  return {
    totalRoots: status.sourceCounts.totalRoots,
    counts: { total: status.counts.total, generatable: status.counts.generatable, blocked: status.counts.blocked, disabledInterfaces: status.counts.disabledInterfaces },
    sourceCounts: status.sourceCounts,
    blockedReasons: status.blockedReasons,
    exteriorGeneratable: status.entries.filter(item => item.exteriorGeneratable).length,
    newPart: entry ? {
      partId: entry.partId, sourceReady: entry.sourceReady ?? false, generatable: entry.generatable,
      exteriorGeneratable: entry.exteriorGeneratable ?? false, connectionSourceStatus: entry.connectionSourceStatus,
      allowedConnectionIds: entry.allowedConnectionIds, exteriorAllowedConnectionIds: entry.exteriorAllowedConnectionIds ?? [],
    } : null,
  };
}

function summary(value: PartImportBundle): BundleSummary {
  return {
    partId: value.partId, name: value.name, author: value.author,
    geometry: { revision: value.geometry.revision, license: value.geometry.license, sourceUrl: value.geometry.sourceUrl, files: value.geometry.files },
    connections: { revision: value.connections.revision, license: value.connections.license, sourceUrl: value.connections.sourceUrl, files: value.connections.files },
  };
}

export class PartImportService {
  private readonly options: PartImportServiceOptions;
  constructor(options: string | PartImportServiceOptions = {}) { this.options = typeof options === 'string' ? { dataDir: options } : options; }
  private get roots(): PartImportRoots { return { ldrawRoot: this.options.ldrawRoot ?? BUNDLED_LDRAW_DIRECTORY, shadowRoot: this.options.shadowRoot ?? SHADOW_DIRECTORY }; }

  async validate(directory: string): Promise<PartImportReport> {
    const bundle = await readPartImportBundle(directory, this.roots);
    const staged = await stagePartImport(directory, bundle, this.roots);
    try {
      const repository = new NativePartRepository({ geometryDirectory: staged.ldrawDirectory, shadowDirectory: staged.shadowDirectory });
      const service = new GrammarAssemblyService({ repository, ...(this.options.dataDir ? { dataDir: this.options.dataDir } : {}) });
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
        if (!winning && admission.exteriorGeneratable) {
          // Structural candidates can fail generation; retry the new part as an exterior-shell moving placement.
          const deadline = Date.now() + 45_000;
          const movingFeatures = candidateFeatures(part, admission);
          let attempts = 0;
          for (const fixedId of await repository.listIds()) {
            if (fixedId === part.partId || attempts >= 32 || Date.now() > deadline) continue;
            const fixedPart = await repository.getPart(fixedId);
            const fixedAdmission = fixedPart ? await service.getGrammarAdmission(fixedId) : undefined;
            if (!fixedPart || !fixedAdmission || !fixedAdmission.generationEligible) continue;
            const fixedFeatures = candidateFeatures(fixedPart, fixedAdmission);
            for (const fixedFeature of fixedFeatures) for (const movingFeature of movingFeatures) {
              if (attempts >= 32 || Date.now() > deadline) break;
              if (fixedFeature.role === movingFeature.role || fixedFeature.matchingPolicy?.ruleId !== movingFeature.matchingPolicy?.ruleId) continue;
              attempts++;
              const ruleId = movingFeature.matchingPolicy!.ruleId;
              const result = await service.attach({ partA: fixedId, connectionA: fixedFeature.sourceConnectionId!, partB: part.partId, connectionB: movingFeature.sourceConnectionId!, twistDegrees: 0, collisionClass: 'exterior-shell' });
              const graphValid = result.graph ? (await service.engine.validateGraph(result.graph)).valid : false;
              const candidate: ImportedCandidate = {
                fixedPartId: fixedId, fixedConnectionId: fixedFeature.sourceConnectionId!,
                movingPartId: part.partId, movingConnectionId: movingFeature.sourceConnectionId!,
                direction: 'new-moving', ruleId, collisionClass: 'exterior-shell',
                accepted: result.accepted, code: result.rejections[0]?.code ?? (result.accepted ? 'accepted' : 'unknown'),
                reason: result.rejections[0]?.reason ?? (result.accepted ? 'accepted' : 'no graph'),
                graphValid, placements: result.graph?.placements.length, edges: result.graph?.edges.length,
              };
              candidates.push(candidate);
              if (result.accepted && graphValid && result.graph) {
                const generated = await this.generate(service, fixedId, part.partId, ruleId, 'exterior-shell');
                generation = generated.generation;
                Object.assign(candidate, generated.candidate);
                if (generated.ok) { winning = candidate; break; }
              }
            }
            if (winning) break;
          }
        }
        if (!winning && admission.exteriorGeneratable) {
          // New part as fixed exterior root: attach can be checked, but no production generation module exists for an exterior root yet.
          const deadline = Date.now() + 30_000;
          const newFeatures = candidateFeatures(part, admission);
          let attempts = 0;
          for (const movingId of await repository.listIds()) {
            if (movingId === part.partId || attempts >= 16 || Date.now() > deadline) continue;
            const existing = await repository.getPart(movingId);
            const existingAdmission = existing ? await service.getGrammarAdmission(movingId) : undefined;
            if (!existing || !existingAdmission || !existingAdmission.generationEligible) continue;
            const existingFeatures = candidateFeatures(existing, existingAdmission);
            for (const newFeature of newFeatures) for (const existingFeature of existingFeatures) {
              if (attempts >= 16 || Date.now() > deadline) break;
              if (newFeature.role === existingFeature.role || newFeature.matchingPolicy?.ruleId !== existingFeature.matchingPolicy?.ruleId) continue;
              attempts++;
              const ruleId = newFeature.matchingPolicy!.ruleId;
              const result = await service.attach({ partA: part.partId, connectionA: newFeature.sourceConnectionId!, partB: movingId, connectionB: existingFeature.sourceConnectionId!, twistDegrees: 0, fixedCollisionClass: 'exterior-shell' });
              const graphValid = result.graph ? (await service.engine.validateGraph(result.graph)).valid : false;
              candidates.push({
                fixedPartId: part.partId, fixedConnectionId: newFeature.sourceConnectionId!,
                movingPartId: movingId, movingConnectionId: existingFeature.sourceConnectionId!,
                direction: 'existing-moving', ruleId, collisionClass: 'exterior-shell',
                accepted: result.accepted, code: result.rejections[0]?.code ?? (result.accepted ? 'accepted' : 'unknown'),
                reason: result.rejections[0]?.reason ?? (result.accepted ? 'accepted' : 'no graph'),
                graphValid, placements: result.graph?.placements.length, edges: result.graph?.edges.length,
                generated: false, generationStatus: 'fixed-exterior-generation-unsupported',
              });
            }
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
    const bundle = await readPartImportBundle(directory, this.roots);
    if (bundle.partId !== confirmPartId) throw new PartImportError('promotion-confirm-mismatch', 'Confirmed partId does not match the bundle.');
    const staged = await stagePartImport(directory, bundle, this.roots);
    const roots = this.roots;
    try {
      const winning = fresh.candidates.find(candidate => candidate.generated) ?? fresh.candidates.find(candidate => candidate.accepted);
      const promotionClass: CollisionClass = winning?.collisionClass ?? (fresh.generationEligible ? 'structural' : 'exterior-shell');
      const bundleBytes = await readFile(path.join(directory, 'bundle.json'));
      const bundleHash = createHash('sha256').update(bundleBytes).digest('hex');
      const validationDigest = createHash('sha256').update(JSON.stringify(fresh)).digest('hex');
      const files = [...bundle.geometry.files, ...bundle.connections.files].map(file => ({ path: file.path, sha256: file.sha256, bytes: file.bytes }));
      const beforeRepository = new NativePartRepository({ geometryDirectory: roots.ldrawRoot!, shadowDirectory: roots.shadowRoot! });
      const beforeService = new GrammarAssemblyService({ repository: beforeRepository, ...(this.options.dataDir ? { dataDir: this.options.dataDir } : {}) });
      await beforeService.ready();
      const beforeAudit = await auditSnapshot(beforeService, bundle.partId);
      let postAudit: PromotionAudit | undefined;
      let auditArtifact: string | undefined;
      const ledger = {
        partId: bundle.partId, bundleHash, ldrawRevision: bundle.geometry.revision, shadowRevision: bundle.connections.revision,
        sourceUrl: bundle.geometry.sourceUrl, license: bundle.geometry.license, author: bundle.author, files,
        validationDigest, promotedAt: new Date().toISOString(), promotionClass,
        codeCommit: process.env.GIT_COMMIT ?? null, reportPath: `artifacts/part-import/${bundle.partId}-report.json`,
        validation: fresh,
        audit: { before: beforeAudit } as unknown as Record<string, unknown>,
      };
      const ldrawFiles = bundle.geometry.files.map(file => ({ path: file.path, source: path.join(staged.ldrawDirectory, 'files', file.path), target: path.join(roots.ldrawRoot!, 'files', file.path) }));
      const shadowFiles = bundle.connections.files.map(file => ({ path: file.path, source: path.join(staged.shadowDirectory, 'files', file.path), target: path.join(roots.shadowRoot!, 'files', file.path) }));
      const transaction = await transactionalPromote({
        ldrawRoot: roots.ldrawRoot!, shadowRoot: roots.shadowRoot!, partId: bundle.partId,
        ldrawFiles, shadowFiles,
        ldrawManifest: await readFile(path.join(staged.ldrawDirectory, 'manifest.json'), 'utf8'),
        shadowManifest: await readFile(path.join(staged.shadowDirectory, 'manifest.json'), 'utf8'),
        ledger,
        verify: async () => {
          const repository = new NativePartRepository({ geometryDirectory: roots.ldrawRoot!, shadowDirectory: roots.shadowRoot! });
          const promoted = await repository.getPart(bundle.partId);
          if (!promoted) throw new PartImportError('post-promote-rebuild-failed', 'The promoted part did not load from the refreshed repository.');
          const service = new GrammarAssemblyService({ repository, ...(this.options.dataDir ? { dataDir: this.options.dataDir } : {}) });
          await service.ready();
          const admission = await service.getGrammarAdmission(bundle.partId);
          if (!admission?.sourceReady) throw new PartImportError('post-promote-rebuild-failed', 'The promoted part has no source-ready grammar admission after reload.');
          const after = await auditSnapshot(service, bundle.partId);
          if (after.totalRoots !== beforeAudit.totalRoots + 1) throw new PartImportError('post-promote-rebuild-failed', `Post-promote audit root count ${after.totalRoots} is not ${beforeAudit.totalRoots + 1}.`);
          if (!after.newPart?.sourceReady) throw new PartImportError('post-promote-rebuild-failed', 'Post-promote audit does not contain the new source-ready part.');
          if (!after.newPart.generatable && !after.newPart.exteriorGeneratable) throw new PartImportError('post-promote-rebuild-failed', 'Post-promote audit does not show a production-capable new part.');
          postAudit = { before: beforeAudit, after };
          (ledger.audit as unknown as PromotionAudit) = postAudit;
          const artifacts = this.options.artifactsDirectory ?? 'artifacts/part-import';
          await mkdir(artifacts, { recursive: true });
          auditArtifact = path.join(artifacts, `${bundle.partId}-post-promote.json`);
          await writeFile(auditArtifact, JSON.stringify({ schemaVersion: 'part-import-post-promote-1', generatedAt: new Date().toISOString(), partId: bundle.partId, before: beforeAudit, after }, null, 2));
        },
      });
      return { partId: bundle.partId, promotedAt: ledger.promotedAt, files: transaction.files, ldrawRevision: bundle.geometry.revision, shadowRevision: bundle.connections.revision, validation: fresh, journalId: transaction.journalId, ledgerPath: transaction.ledgerPath, promotionClass, ...(postAudit ? { audit: postAudit } : {}), ...(auditArtifact ? { auditArtifact } : {}) };
    } finally {
      await staged.cleanup();
    }
  }
}
