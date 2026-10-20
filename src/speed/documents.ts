import { createHash } from 'node:crypto';
import { InventoryError } from '../inventory/index.js';
import type { SpeedInventory, VehicleCandidate } from './types.js';
import { SPEED_ARCHIVE_SCHEMA_VERSION, VERSION_METADATA } from './versions.js';
import { compactVehicleCandidate, packCandidateSteps, unpackCandidateSteps, type PackedVehicleCandidate } from './stepCodec.js';

export const MAX_SPEED_DOCUMENT_BYTES = 40 * 1024 * 1024;
export const MAX_IMPORTED_SPEED_PARTS = 300;

export interface SpeedModelMetadata {
  modelId: string;
  generatedAt: string;
  updatedAt: string;
  generatorVersion: string;
  validatorVersion: string;
  partLibraryVersion: string;
  /** A server revision includes configuration changes and undo operations. */
  revision: number;
  modelDigest: string;
  physicalValidation: 'untested';
  origin: 'generated' | 'imported';
  sourceSets: string[];
  snapshotIds: string[];
  importedFrom?: {
    modelId: string;
    generatedAt: string;
    generatorVersion: string;
    validatorVersion: string;
    partLibraryVersion: string;
    sourceSets?: string[];
    snapshotIds?: string[];
  };
}

export { parseImportedSpeedDocument } from './import.js';

/** Top-level candidate / inventory remain compatible with V0.2 exports. */
export interface SpeedModelDocument {
  schemaVersion: typeof SPEED_ARCHIVE_SCHEMA_VERSION;
  metadata: SpeedModelMetadata;
  candidate: VehicleCandidate;
  inventory: SpeedInventory;
}
export interface PackedSpeedModelDocument extends Omit<SpeedModelDocument, 'candidate'> { candidate: PackedVehicleCandidate }

export interface SpeedModelSummary {
  id: string;
  metadata: SpeedModelMetadata;
  name: string;
  version: number;
  dataSource: SpeedInventory['source'];
  physicalValidation: 'untested' | 'passed';
  partCount: number;
  sourceLabel: string;
}

export function safeSpeedModelId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(value)) {
    throw new InventoryError('模型编号无效。', 'INVALID_SPEED_MODEL_ID', 400);
  }
  return value;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(',')}}`;
}

/** Includes the exact instructions and stock, so feedback cannot move to another build. */
export function speedModelDigest(candidate: VehicleCandidate, inventory: SpeedInventory): string {
  return createHash('sha256').update(stableJson({ candidate: packCandidateSteps(candidate), inventory })).digest('hex');
}

export function cloneSpeedDocument(document: SpeedModelDocument): SpeedModelDocument {
  return { schemaVersion: document.schemaVersion, metadata: structuredClone(document.metadata), candidate: compactVehicleCandidate(document.candidate), inventory: structuredClone(document.inventory) };
}

export function packSpeedDocument(document: SpeedModelDocument): PackedSpeedModelDocument {
  return { schemaVersion: document.schemaVersion, metadata: structuredClone(document.metadata), candidate: packCandidateSteps(document.candidate), inventory: structuredClone(document.inventory) };
}

export function unpackStoredSpeedDocument(value: unknown): SpeedModelDocument {
  try {
    const raw = value as SpeedModelDocument;
    if (!raw || raw.schemaVersion !== SPEED_ARCHIVE_SCHEMA_VERSION) throw new Error('Unsupported schema');
    const document = { ...raw, candidate: unpackCandidateSteps(raw.candidate) };
    assertStoredSpeedDocument(document);
    return document;
  } catch {
    throw new InventoryError('模型存档损坏或版本不受支持，请保留原文件并从有效 JSON 重新导入。', 'SPEED_MODEL_STORAGE_CORRUPT', 500);
  }
}

export function createSpeedDocument(candidate: VehicleCandidate, inventory: SpeedInventory, options: { snapshotIds?: string[]; origin?: 'generated' | 'imported'; importedFrom?: SpeedModelMetadata['importedFrom'] } = {}): SpeedModelDocument {
  const now = new Date().toISOString();
  return {
    schemaVersion: SPEED_ARCHIVE_SCHEMA_VERSION,
    metadata: {
      modelId: safeSpeedModelId(candidate.model.id), generatedAt: now, updatedAt: now,
      ...VERSION_METADATA, revision: 1, modelDigest: speedModelDigest(candidate, inventory),
      physicalValidation: 'untested', origin: options.origin ?? 'generated',
      sourceSets: inventory.inventorySources.filter(source => source.source !== 'custom').map(source => source.setNumber),
      snapshotIds: [...new Set(options.snapshotIds ?? inventory.inventorySources.flatMap(source => source.snapshotId ? [source.snapshotId] : []))],
      ...(options.importedFrom ? { importedFrom: { ...options.importedFrom } } : {}),
    },
    candidate: compactVehicleCandidate(candidate), inventory: structuredClone(inventory),
  };
}

export function updateSpeedDocument(previous: SpeedModelDocument, candidate: VehicleCandidate, inventory: SpeedInventory): SpeedModelDocument {
  if (candidate.model.id !== previous.metadata.modelId) throw new InventoryError('模型编号发生变化，无法更新存档。', 'SPEED_MODEL_ID_CHANGED', 409);
  return {
    schemaVersion: SPEED_ARCHIVE_SCHEMA_VERSION,
    metadata: {
      ...previous.metadata, updatedAt: new Date().toISOString(),
      revision: previous.metadata.revision + 1, modelDigest: speedModelDigest(candidate, inventory), physicalValidation: 'untested',
    },
    candidate: compactVehicleCandidate(candidate), inventory: structuredClone(inventory),
  };
}

/** Local archives must retain their exact digest; external imports use a stricter parser. */
export function assertStoredSpeedDocument(value: unknown): asserts value is SpeedModelDocument {
  const archive = value as SpeedModelDocument | null;
  const metadata = archive?.metadata;
  if (!archive || archive.schemaVersion !== SPEED_ARCHIVE_SCHEMA_VERSION || !metadata ||
      typeof metadata.modelId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(metadata.modelId) ||
      !Number.isSafeInteger(metadata.revision) || metadata.revision < 1 ||
      typeof metadata.modelDigest !== 'string' || !/^[a-f0-9]{64}$/.test(metadata.modelDigest) ||
      typeof metadata.generatedAt !== 'string' || !Number.isFinite(Date.parse(metadata.generatedAt)) ||
      typeof metadata.updatedAt !== 'string' || !Number.isFinite(Date.parse(metadata.updatedAt)) ||
      !['generatorVersion', 'validatorVersion', 'partLibraryVersion'].every(key => typeof metadata[key as keyof SpeedModelMetadata] === 'string') ||
      !['generated', 'imported'].includes(metadata.origin) || metadata.physicalValidation !== 'untested' ||
      !Array.isArray(metadata.sourceSets) || metadata.sourceSets.some(id => typeof id !== 'string') ||
      !Array.isArray(metadata.snapshotIds) || metadata.snapshotIds.some(id => typeof id !== 'string') ||
      !archive.candidate?.model || archive.candidate.model.id !== metadata.modelId ||
      !Array.isArray(archive.candidate.model.parts) || !Array.isArray(archive.candidate.steps) ||
      !archive.candidate.validation || !Array.isArray(archive.inventory?.items) ||
      !Array.isArray(archive.inventory.inventorySources) ||
      speedModelDigest(archive.candidate, archive.inventory) !== metadata.modelDigest) {
    throw new InventoryError('模型存档损坏或版本不受支持，请保留原文件并从有效 JSON 重新导入。', 'SPEED_MODEL_STORAGE_CORRUPT', 500);
  }
}

export function summarizeSpeedDocument(document: SpeedModelDocument): SpeedModelSummary {
  return { id: document.metadata.modelId, metadata: structuredClone(document.metadata), name: document.candidate.model.name, version: document.candidate.model.version, dataSource: document.inventory.source, physicalValidation: 'untested', partCount: document.candidate.model.parts.length, sourceLabel: document.inventory.sourceLabel };
}
