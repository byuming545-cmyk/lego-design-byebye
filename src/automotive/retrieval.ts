import type { ReferenceAnalysis } from './references/types.js';
import type { AutomotiveModuleId, VehicleClass, VehicleDesignBrief } from './research/types.js';
import { referenceAutomotiveRatios } from './grammar.js';

/** Tags supplement measurable shape; manufacturer names are never retrieval criteria. */
export interface ReferenceRetrievalEntry {
  analysis: ReferenceAnalysis;
  vehicleType?: VehicleClass;
  featureTags?: string[];
  structuralUses?: string[];
}
export interface RetrievedReference {
  referenceId: string;
  modelName: string;
  rank: number;
  score: number;
  reasons: string[];
  uses: AutomotiveModuleId[];
}
export interface ReferenceSet {
  targetVehicle: string;
  references: RetrievedReference[];
  fallbackPrior: boolean;
  notes: string[];
}

const round = (value: number) => Math.round(value * 1000) / 1000;
const normalizeTag = (value: string) => value.trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/^four-doors$/, 'four-door').replace(/^longwheelbase$/, 'long-wheelbase').replace(/^cabin$/, 'cockpit');
function moduleUse(tag: string): AutomotiveModuleId | null {
  return /grille|headlight|^front/.test(tag) ? 'front' : /hood/.test(tag) ? 'hood' : /roof|windshield/.test(tag) ? 'roof' : /cockpit|cabin|four-door/.test(tag) ? 'cockpit' : /chassis|wheelbase|reinforcement|beam/.test(tag) ? 'chassis' : /side/.test(tag) ? 'leftSide' : /rear|diffuser/.test(tag) ? 'rear' : null;
}
/** Shape and structural-purpose retrieval; no brand-name bonus is applied. */
export function retrieveReferences(brief: VehicleDesignBrief, library: readonly (ReferenceAnalysis | ReferenceRetrievalEntry)[], options: { limit?: number } = {}): ReferenceSet {
  if (!library.length) return { targetVehicle: brief.targetVehicle, references: [], fallbackPrior: true, notes: ['Reference library is empty. No official reference was selected; generation must use explicitly labeled engineering priors.'] };
  const targets = {
    lengthWidth: brief.proportions.lengthStuds / brief.targetWidthStuds,
    wheelbaseLength: brief.proportions.wheelbaseStuds / brief.proportions.lengthStuds,
    wheelDiameterBodyHeight: brief.proportions.wheelDiameterStuds / (brief.proportions.heightPlates * 0.4),
    cockpitPosition: brief.proportions.cockpitStartStuds / brief.proportions.lengthStuds,
    hoodProportion: brief.proportions.hoodLengthStuds / brief.proportions.lengthStuds,
  };
  const weights = { lengthWidth: 22, wheelbaseLength: 25, wheelDiameterBodyHeight: 8, cockpitPosition: 16, hoodProportion: 19 };
  const targetTags = new Set(brief.featureTags.map(normalizeTag));
  const unique = new Map<string, RetrievedReference>();
  for (const item of library) {
    const entry: ReferenceRetrievalEntry = 'analysis' in item ? item : { analysis: item };
    const analysis = entry.analysis, ratios = referenceAutomotiveRatios(analysis), reasons: string[] = [], uses = new Set<AutomotiveModuleId>();
    const tags = new Set([...(analysis.metadata.featureTags ?? []), ...(entry.featureTags ?? [])].map(normalizeTag));
    let score = 0;
    for (const ratioName of Object.keys(weights) as (keyof typeof weights)[]) {
      const observed = ratios[ratioName], target = targets[ratioName];
      if (observed === undefined || !Number.isFinite(target) || target <= 0) continue;
      const closeness = Math.max(0, 1 - Math.abs(observed - target) / Math.max(0.15, Math.abs(target) * 0.4));
      if (closeness <= 0) continue;
      score += weights[ratioName] * closeness;
      reasons.push(`${ratioName}: measured ${round(observed)}, target ${round(target)} (${Math.round(closeness * 100)}% proximity).`);
      if (ratioName === 'wheelbaseLength' || ratioName === 'lengthWidth') uses.add('chassis');
      if (ratioName === 'cockpitPosition') { uses.add('cockpit'); uses.add('roof'); }
      if (ratioName === 'hoodProportion') uses.add('hood');
    }
    // Measurable design problems are useful even without matching vehicle classes.
    if (ratios.wheelbaseLength !== undefined && ratios.wheelbaseLength >= 0.57) tags.add('long-wheelbase');
    if (ratios.hoodProportion !== undefined && ratios.hoodProportion >= 0.27) tags.add('long-hood');
    for (const tag of targetTags) if (tags.has(tag)) {
      score += 7;
      const measured = tag === 'long-wheelbase' && ratios.wheelbaseLength !== undefined && ratios.wheelbaseLength >= 0.57 || tag === 'long-hood' && ratios.hoodProportion !== undefined && ratios.hoodProportion >= 0.27;
      reasons.push(`${tag}: relevant ${measured ? 'measured proportion' : 'explicit reference annotation'}.`);
      const module = moduleUse(tag);
      if (module) uses.add(module);
      if (tag === 'four-door') { uses.add('leftSide'); uses.add('rightSide'); }
    }
    if (analysis.connections.reinforcementPatterns.value !== null && analysis.connections.reinforcementPatterns.confidence >= 0.6 && analysis.connections.reinforcementPatterns.value > 0) {
      score += 6; uses.add('chassis'); reasons.push('Verified connector graph contains local reinforcement evidence useful for chassis planning.');
    }
    if (analysis.connections.snotConnections.value !== null && analysis.connections.snotConnections.confidence >= 0.6 && analysis.connections.snotConnections.value > 0 && (targetTags.has('large-grille') || targetTags.has('snot'))) {
      score += 6; uses.add('front'); reasons.push('Measured side-stud connections may inform a grille or side surface; semantic placement still needs review.');
    }
    for (const use of new Set((entry.structuralUses ?? []).map(normalizeTag))) {
      const module = moduleUse(use);
      if (module && brief.modules[module].lengthStuds > 0) { score += 5; uses.add(module); reasons.push(`Explicit structural-use annotation: ${use}.`); }
    }
    const vehicleClass = entry.vehicleType ?? analysis.metadata.vehicleType;
    if (vehicleClass && vehicleClass !== 'unknown' && vehicleClass === brief.vehicleClass && score > 0) { score += 3; reasons.push(`Same annotated vehicle class: ${vehicleClass}.`); }
    if (!reasons.length || score <= 0 || !analysis.metadata.source.trim()) continue;
    const match: RetrievedReference = { referenceId: analysis.referenceId, modelName: analysis.metadata.modelName, rank: 0, score: round(score), reasons, uses: [...uses] };
    if (!unique.has(match.referenceId) || unique.get(match.referenceId)!.score < match.score) unique.set(match.referenceId, match);
  }
  const limit = Math.max(1, Math.min(20, Math.floor(options.limit ?? 5)));
  const references = [...unique.values()].sort((a, b) => b.score - a.score || a.referenceId.localeCompare(b.referenceId)).slice(0, limit).map((reference, index) => ({ ...reference, rank: index + 1 }));
  return { targetVehicle: brief.targetVehicle, references, fallbackPrior: references.length === 0, notes: references.length ? ['References were ranked by measured proportions, explicit feature annotations, and available connector evidence. No manufacturer-name match is used; local design problems may use different reference models.'] : ['No reference had relevant supported measurements or explicit design-use annotations. No official reference was selected; fall back to explicit engineering priors.'] };
}

export { retrieveReferences as retrieveAutomotiveReferences };
