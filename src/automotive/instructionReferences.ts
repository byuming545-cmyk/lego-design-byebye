import type { ReferenceMetadata } from './references/types.js';

/** Groundwork for later instruction studies. No PDF is fetched, parsed or
 * redistributed by this module; observations must name their actual evidence. */
export interface InstructionReference {
  id: string;
  metadata: ReferenceMetadata;
  documentUrl: string;
  contentStored: false;
  analysisStatus: 'not-analyzed' | 'manually-annotated';
  observations: InstructionAssemblyObservation[];
}
export interface InstructionAssemblyObservation {
  id: string;
  pageOrStep: string;
  evidence: string;
  source: 'manual-annotation' | 'validated-digital-build-steps';
  assemblyOrder: string[];
  attachStrategy: string | null;
  reinforcementOrder: string[];
  temporarySupport: string | null;
  partGrouping: string[][];
  linkedPatternIds: string[];
  confidence: number;
}
export function createInstructionReference(id: string, metadata: ReferenceMetadata, documentUrl: string): InstructionReference {
  const url = new URL(documentUrl);
  if (!/^[\w-]{1,100}$/.test(id) || !['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid instruction reference.');
  return { id, metadata: structuredClone(metadata), documentUrl: url.href, contentStored: false, analysisStatus: 'not-analyzed', observations: [] };
}
