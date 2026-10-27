import type { NativeAssemblyPart } from './assembly/types.js';
import type { PartReadiness } from './trust.js';

/** Source identity is separate from readiness. Catalogue observations never supply solids. */
export type PartSourceSystem = 'LDraw' | 'LDCadShadowLibrary' | 'BrickLinkStudio' | 'Rebrickable' | 'OfficialSetInventory' | 'InventoryObservation' | 'LegacyInstructionDerived' | 'TestFixture';
export interface PartSourceMetadata {
  sourceSystem: PartSourceSystem;
  sourcePartId: string;
  sourceFile: string | null;
  sourceVersion: string | null;
  provenance: 'pinned-digital-source' | 'reference-observation-only';
  geometryStatus: 'ready' | 'unavailable';
  connectionStatus: 'ready' | 'partial' | 'missing';
  assemblyStatus: 'verified-listed-interfaces' | 'not-verified';
  legacyStatus: 'NOT_LEGACY' | 'REFERENCE_ONLY' | 'LEGACY_UNVERIFIED' | 'LEGACY_QUARANTINED';
  verificationEvidence: Array<{ sourceSystem: 'LDraw' | 'LDCadShadowLibrary'; file: string; sha256: string; revision: string }>;
}

export const ACCEPTED_LDRAW_LICENSES = new Set([
  'Licensed under CC BY 4.0 : see CAreadme.txt',
  'Licensed under CC BY 2.0 and CC BY 4.0 : see CAreadme.txt',
]);
const digest = (value: string) => /^[a-f0-9]{64}$/.test(value);

/** Called only after the bundled resolvers check source bytes. Metadata supplied by callers
 * (including a forged sourceMetadata/status field) is never used as import authority. */
export function assertDigitalPartOrigin(part: NativeAssemblyPart): void {
  const geometry = part.geometry, connections = part.connections;
  if (geometry.source.library !== 'LDraw' || geometry.partId !== part.partId ||
      geometry.source.rootFile !== `parts/${part.partId}.dat` || geometry.source.integrity !== 'verified' ||
      geometry.source.licenseStatus !== 'complete' || !geometry.source.files.length ||
      geometry.source.files.some(file => !digest(file.sha256) || !file.license || !ACCEPTED_LDRAW_LICENSES.has(file.license)) ||
      geometry.mesh?.units !== 'LDU' || geometry.mesh.coordinateSystem !== 'ldraw-native') {
    throw new Error('Untrusted digital geometry origin: legacy or unmanifested geometry cannot enter the native repository.');
  }
  if (connections.partId !== part.partId || connections.units !== 'LDU' || connections.coordinateSystem !== 'LDraw-native' ||
      connections.sourceFiles.some(file => !['LDraw', 'LDCadShadowLibrary'].includes(file.library) || !digest(file.sha256) ||
        (file.library === 'LDCadShadowLibrary' ? file.license !== 'CC-BY-SA-4.0' : !ACCEPTED_LDRAW_LICENSES.has(file.license))) ||
      connections.points.some(point => !connections.sourceFiles.some(file =>
        file.library === point.source.library && file.path === point.source.path && file.sha256 === point.source.sha256 && file.revision === point.source.revision))) {
    throw new Error('Untrusted digital connection origin: handwritten or untracked endpoints cannot enter the native repository.');
  }
}

export function nativePartMetadata(part: NativeAssemblyPart, readiness: PartReadiness): PartSourceMetadata {
  return {
    sourceSystem: 'LDraw', sourcePartId: part.partId, sourceFile: part.geometry.source.rootFile,
    sourceVersion: part.geometry.source.revision, provenance: 'pinned-digital-source',
    geometryStatus: readiness.geometryReady ? 'ready' : 'unavailable', connectionStatus: part.connections.status,
    assemblyStatus: readiness.assemblyVerified ? 'verified-listed-interfaces' : 'not-verified', legacyStatus: 'NOT_LEGACY',
    verificationEvidence: [
      ...part.geometry.source.files.map(file => ({ sourceSystem: 'LDraw' as const, file: file.path, sha256: file.sha256, revision: part.geometry.source.revision })),
      ...part.connections.sourceFiles.filter(file => file.library === 'LDCadShadowLibrary').map(file => ({ sourceSystem: file.library, file: file.path, sha256: file.sha256, revision: file.revision })),
    ],
  };
}

export function inventoryReferenceMetadata(elementId: string): PartSourceMetadata {
  return {
    sourceSystem: 'InventoryObservation', sourcePartId: elementId, sourceFile: null, sourceVersion: null,
    provenance: 'reference-observation-only', geometryStatus: 'unavailable', connectionStatus: 'missing',
    assemblyStatus: 'not-verified', legacyStatus: 'REFERENCE_ONLY', verificationEvidence: [],
  };
}
