import { NativePartRepository } from '../assembly/source.js';
import type { CollisionClass, NativeAssemblyPart } from '../assembly/types.js';
import type { AssemblyPairAttachRequest } from '../assembly/service.js';
import { GrammarAssemblyService } from '../grammar/service.js';
import { adaptNativePartConnectors, type ConnectorIngestion } from '../grammar/sources.js';
import type { GrammarPartAdmission } from '../grammar/admission.js';
import { readPartImportBundle, stagePartImport, type PartImportBundle } from './bundle.js';

export interface ImportedFeature { featureId: string; connectionId: string; family: string; role: string; supported: boolean; ruleIds: string[]; reasonCodes: string[] }
export interface ImportedCandidate {
  fixedPartId: string;
  fixedConnectionId: string;
  movingPartId: string;
  movingConnectionId: string;
  collisionClass: CollisionClass;
  accepted: boolean;
  code: string;
  reason: string;
  graphValid?: boolean;
  placements?: number;
  edges?: number;
}
export interface PartImportReport {
  partId: string;
  status: 'validated' | 'blocked';
  sourceReady: boolean;
  geometryStatus: string;
  connectionStatus: string;
  generationEligible: boolean;
  exteriorGeneratable: boolean;
  supportedFeatures: ImportedFeature[];
  candidates: ImportedCandidate[];
  generation: { attempted: boolean; status?: string; reasons: string[]; jsonBytes?: number; reimport?: string };
  limitations: string[];
}
export class PartImportError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'PartImportError'; }
}

function supported(ingestion: ConnectorIngestion, admission: GrammarPartAdmission | undefined): ImportedFeature[] {
  const support = new Map((admission?.featureSupport ?? []).map(item => [item.featureId, item]));
  return ingestion.connectors.map(feature => {
    const item = support.get(feature.featureId);
    return {
      featureId: feature.featureId,
      connectionId: feature.sourceConnectionId ?? '',
      family: feature.family,
      role: feature.role,
      supported: item?.supported === true,
      ruleIds: item?.ruleIds ?? [],
      reasonCodes: item?.reasonCodes ?? [],
    };
  });
}

function classFor(part: NativeAssemblyPart, admission: GrammarPartAdmission | undefined): CollisionClass | null {
  if (admission?.generationEligible) return 'structural';
  if (admission?.exteriorGeneratable) return 'exterior-shell';
  return null;
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
      const features = supported(ingestion, admission);
      const candidates = await this.candidates(service, repository, part, admission);
      const accepted = candidates.find(candidate => candidate.accepted && candidate.graphValid);
      const generation: PartImportReport['generation'] = { attempted: false, reasons: [] };
      if (accepted) {
        generation.attempted = true;
        const modules = accepted.collisionClass === 'exterior-shell' ? ['exterior-shell'] as const : ['wall', 'simple-chassis'] as const;
        for (const module of modules) {
          const result = await service.generate({ module, requiredPartIds: [accepted.fixedPartId, accepted.movingPartId] });
          generation.status = result.status;
          generation.reasons = result.reasons;
          if (result.model) {
            const { exportNativeAssemblyJson } = await import('../assembly/documents.js');
            const json = exportNativeAssemblyJson(result.model);
            generation.jsonBytes = json.length;
            generation.reimport = (await service.importModel(JSON.parse(json))).status;
            break;
          }
        }
      }
      const validated = Boolean(accepted && generation.status === 'generated' && generation.reimport === 'VALID');
      return {
        partId: bundle.partId, status: validated ? 'validated' : 'blocked', sourceReady: admission.sourceReady,
        geometryStatus: part.geometry.status, connectionStatus: part.connections.status,
        generationEligible: admission.generationEligible, exteriorGeneratable: admission.exteriorGeneratable,
        supportedFeatures: features, candidates, generation,
        limitations: [
          'This is staging validation only. It does not modify the pinned catalogue or promote the part.',
          'Only explicitly listed source interfaces and the current rules are checked; no appearance-based inference is used.',
          'Final-pose collision is not an installation-path proof, a material/retention proof or a physical-build proof.',
        ],
      };
    } finally {
      await staged.cleanup();
    }
  }

  private async candidates(service: GrammarAssemblyService, repository: NativePartRepository, movingPart: NativeAssemblyPart, movingAdmission: GrammarPartAdmission): Promise<ImportedCandidate[]> {
    const movingClass = classFor(movingPart, movingAdmission);
    if (!movingClass) return [];
    const movingFeatures = adaptNativePartConnectors(movingPart).connectors.filter(feature => feature.matchingPolicy?.ruleId === 'C01' && movingAdmission.featureSupport.some(item => item.featureId === feature.featureId && item.supported));
    if (!movingFeatures.length) return [];
    const results: ImportedCandidate[] = [];
    let attempts = 0;
    for (const fixedId of await repository.listIds()) {
      if (fixedId === movingPart.partId || attempts >= 24) continue;
      const fixedPart = await repository.getPart(fixedId);
      if (!fixedPart) continue;
      const fixedAdmission = await service.getGrammarAdmission(fixedId);
      const fixedClass = classFor(fixedPart, fixedAdmission);
      if (!fixedAdmission || !fixedClass) continue;
      if (fixedClass === 'exterior-shell') continue; // this pilot keeps the existing root structural
      const fixedFeatures = adaptNativePartConnectors(fixedPart).connectors.filter(feature => feature.sourceConnectionId !== null && feature.matchingPolicy?.ruleId === 'C01' && fixedAdmission.featureSupport.some(item => item.featureId === feature.featureId && item.supported));
      for (const fixedFeature of fixedFeatures) for (const movingFeature of movingFeatures) {
        if (fixedFeature.role === movingFeature.role || attempts >= 24) continue;
        if (fixedFeature.sourceConnectionId === null || movingFeature.sourceConnectionId === null) continue;
        attempts++;
        const collisionClass: CollisionClass = movingClass;
        const request: AssemblyPairAttachRequest = {
          partA: fixedId, connectionA: fixedFeature.sourceConnectionId,
          partB: movingPart.partId, connectionB: movingFeature.sourceConnectionId,
          twistDegrees: 0, ...(collisionClass === 'exterior-shell' ? { collisionClass } : {}),
        };
        const result = await service.attach(request);
        const graphValid = result.graph ? (await service.engine.validateGraph(result.graph)).valid : false;
        const reason = result.rejections[0]?.reason ?? (result.graph ? 'accepted' : 'no graph');
        results.push({
          fixedPartId: fixedId, fixedConnectionId: fixedFeature.sourceConnectionId,
          movingPartId: movingPart.partId, movingConnectionId: movingFeature.sourceConnectionId,
          collisionClass, accepted: result.accepted, code: result.rejections[0]?.code ?? (result.accepted ? 'accepted' : 'unknown'),
          reason, graphValid, placements: result.graph?.placements.length, edges: result.graph?.edges.length,
        });
        if (result.accepted && graphValid) return results;
      }
    }
    return results;
  }
}
