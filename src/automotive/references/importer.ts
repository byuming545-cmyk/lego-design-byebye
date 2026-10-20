import { createHash } from 'node:crypto';
import { addVectors, determinant, IDENTITY_MATRIX, ldrawMatrixToInternal, ldrawToInternal, multiplyMatrices, referenceCatalogAdapter, transformVector } from './coordinates.js';
import type { ReferenceImportLimits, ReferenceLibraryEntry, ReferenceLink, ReferenceMatrix, ReferenceMetadata, ReferenceMetadataInput, ReferencePlacement, ReferencePrimitive, ReferenceSubmodel, ReferenceVector, ReferenceVehicleModel } from './types.js';

export class ReferenceImportError extends Error {
  constructor(message: string, readonly code = 'INVALID_REFERENCE_MODEL', readonly status = 400) { super(message); this.name = 'ReferenceImportError'; }
}
export const REFERENCE_IMPORT_LIMITS: Readonly<ReferenceImportLimits> = Object.freeze({ maxBytes: 8 * 1024 * 1024, maxLines: 200_000, maxSubmodels: 1000, maxParts: 20_000, maxDepth: 32 });
const vector = (numbers: number[]): ReferenceVector => ({ x: numbers[0], y: numbers[1], z: numbers[2] });
function fail(message: string, code?: string): never { throw new ReferenceImportError(message, code); }
export function normalizeReferenceFilename(value: string): string {
  const normalized = value.trim().replaceAll('\\', '/').toLowerCase();
  if (!normalized || normalized.length > 240 || /[\x00-\x1f:%?#<>|"*]/.test(normalized) || normalized.startsWith('/') || normalized.split('/').some(segment => !segment || segment === '.' || segment === '..') || !/\.(dat|ldr|mpd)$/.test(normalized)) fail('Unsafe or unsupported LDraw file name.', 'UNSAFE_REFERENCE_PATH');
  return normalized;
}
function textField(value: unknown, label: string, max = 4000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x08\x0b-\x1f]/.test(value)) fail(`Reference ${label} is required and must be plain text.`);
  return value.trim();
}
export function normalizeReferenceMetadata(input: ReferenceMetadataInput): ReferenceMetadata {
  if (!input || typeof input !== 'object') fail('Reference metadata is required.');
  const source = textField(input.source, 'source', 2000);
  // A source may be a local/user provenance label; a URL must be a safe research link.
  if (/^[a-z][a-z\d+.-]*:/i.test(source)) {
    let url: URL; try { url = new URL(source); } catch { return fail('Invalid reference source URL.'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) fail('Reference source URL must use HTTP(S) without credentials.');
  }
  if (!['CC0-1.0', 'CC-BY-4.0', 'user-owned', 'unknown'].includes(input.license)) fail('Unsupported reference license.', 'REFERENCE_LICENSE_UNCONFIRMED');
  const importedAt = input.importedAt ?? new Date().toISOString();
  if (typeof importedAt !== 'string' || !Number.isFinite(Date.parse(importedAt))) fail('Invalid importedAt timestamp.');
  const metadata: ReferenceMetadata = { source, modelName: textField(input.modelName, 'modelName', 500), author: textField(input.author, 'author', 500), license: input.license, attribution: textField(input.attribution, 'attribution'), importedAt: new Date(importedAt).toISOString() };
  if (input.longitudinalAxis !== undefined) {
    if (input.longitudinalAxis !== 'x' && input.longitudinalAxis !== 'y') fail('Invalid reference longitudinal axis.');
    metadata.longitudinalAxis = input.longitudinalAxis;
  }
  if (input.frontDirection !== undefined) {
    if (input.frontDirection !== 1 && input.frontDirection !== -1) fail('Invalid reference front direction.');
    metadata.frontDirection = input.frontDirection;
  }
  if (input.vehicleType !== undefined && !['luxury-sedan', 'performance-coupe', 'sports-car', 'gt', 'supercar', 'unknown'].includes(input.vehicleType)) fail('Invalid reference vehicle classification.');
  metadata.vehicleType = input.vehicleType ?? 'unknown';
  if (input.featureTags !== undefined && (!Array.isArray(input.featureTags) || input.featureTags.length > 20)) fail('Reference featureTags must be an array of at most 20 plain-text tags.');
  metadata.featureTags = [...new Set((input.featureTags ?? []).map(tag => textField(tag, 'feature tag', 64)))];
  if (input.setNumber !== undefined) metadata.setNumber = textField(input.setNumber, 'setNumber', 100);
  if (input.license === 'user-owned') {
    if (!input.rightsDeclaration || input.rightsDeclaration.ownsRights !== true) fail('User-owned model import requires an explicit rights declaration; it does not establish rights to official LEGO models.', 'REFERENCE_RIGHTS_DECLARATION_REQUIRED');
    metadata.rightsDeclaration = { ownsRights: true, statement: textField(input.rightsDeclaration.statement, 'rights declaration') };
  }
  return metadata;
}
function stableId(value: unknown): string { return `ref-${createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24)}`; }
export function createReferenceLink(input: ReferenceMetadataInput): ReferenceLink {
  const metadata = normalizeReferenceMetadata(input);
  return { schemaVersion: 1, kind: 'link', id: stableId([metadata.source, metadata.modelName]), metadata };
}
function checkedTransform(position: ReferenceVector, matrix: ReferenceMatrix, line: number, composed = false): void {
  if (Object.values(position).some(n => !Number.isFinite(n) || Math.abs(n) > (composed ? 1e9 : 1e6)) || matrix.some(n => !Number.isFinite(n) || Math.abs(n) > (composed ? 1e6 : 1e3)) || !Number.isFinite(determinant(matrix)) || Math.abs(determinant(matrix)) < 1e-10) fail(`Invalid or singular transform at line ${line}.`, 'INVALID_REFERENCE_TRANSFORM');
}
function color(value: string, line: number): number {
  const n = /^0x2[\da-f]{6}$/i.test(value) ? Number.parseInt(value.slice(2), 16) : /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(n) || n < 0 || n > 0x2ffffff) fail(`Invalid LDraw color at line ${line}.`);
  return n;
}
export interface ImportReferenceOptions { text: string; metadata: ReferenceMetadataInput; filename?: string; limits?: Partial<ReferenceImportLimits> }
/** Pure text parsing: does not follow links, load external files or execute metadata. */
export function importReferenceModel(options: ImportReferenceOptions): ReferenceVehicleModel {
  const filename = options.filename === undefined ? 'model.ldr' : normalizeReferenceFilename(options.filename);
  const metadata = normalizeReferenceMetadata(options.metadata);
  if (metadata.license === 'unknown') fail('Unconfirmed license: save a link and metadata only; model text is not accepted.', 'REFERENCE_LICENSE_UNCONFIRMED');
  const limits = { ...REFERENCE_IMPORT_LIMITS, ...options.limits };
  for (const key of Object.keys(limits) as (keyof ReferenceImportLimits)[]) if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > REFERENCE_IMPORT_LIMITS[key]) fail('Import limits must be positive and cannot exceed hard safety limits.');
  if (typeof options.text !== 'string' || !options.text.trim()) fail('LDraw text is required.');
  if (Buffer.byteLength(options.text) > limits.maxBytes) fail('LDraw model exceeds the byte limit.', 'REFERENCE_IMPORT_LIMIT');
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(options.text)) fail('LDraw source contains invalid control characters.');
  const lines = options.text.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines.length > limits.maxLines) fail('LDraw model exceeds the line limit.', 'REFERENCE_IMPORT_LIMIT');
  const hasFiles = lines.some(line => /^\s*0\s+FILE\s+/i.test(line));
  const submodels: ReferenceSubmodel[] = [];
  const byName = new Map<string, ReferenceSubmodel>();
  const warnings: string[] = [];
  const makeSubmodel = (name: string): ReferenceSubmodel => {
    name = normalizeReferenceFilename(name);
    if (byName.has(name)) fail(`Duplicate MPD submodel: ${name}.`);
    if (submodels.length >= limits.maxSubmodels) fail('Too many MPD submodels.', 'REFERENCE_IMPORT_LIMIT');
    const model: ReferenceSubmodel = { name, placements: [], primitives: [] }; submodels.push(model); byName.set(name, model); return model;
  };
  let current: ReferenceSubmodel | null = hasFiles ? null : makeSubmodel(filename);
  let placementCount = 0;
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim(), lineNumber = index + 1;
    if (!line) continue;
    const file = /^0\s+FILE\s+(.+)$/i.exec(line);
    if (file) { current = makeSubmodel(file[1]); continue; }
    if (/^0\s+NOFILE(?:\s|$)/i.test(line)) { current = null; continue; }
    if (/^0(?:\s|$)/.test(line)) {
      const license = /^0\s+!LICENSE\s+(.+)$/i.exec(line)?.[1];
      if (license && !/CC BY 4\.0|CC0(?: 1\.0)?|CC0-1\.0/i.test(license) && metadata.license !== 'user-owned') fail(`Unsupported embedded license at line ${lineNumber}; keep link metadata only.`, 'REFERENCE_LICENSE_UNCONFIRMED');
      if (license && /CC BY 4\.0/i.test(license) && metadata.license !== 'CC-BY-4.0') fail('Model header requires CC BY 4.0 attribution; metadata must retain that license.', 'REFERENCE_LICENSE_MISMATCH');
      continue;
    }
    if (!current) fail(`Geometry outside MPD FILE section at line ${lineNumber}.`);
    const tokens = line.split(/\s+/), type = tokens[0];
    if (type === '1') {
      if (tokens.length < 15) fail(`Malformed type 1 record at line ${lineNumber}.`);
      const n = tokens.slice(2, 14).map(Number), positionLdu = vector(n), matrixLdu = n.slice(3) as ReferenceMatrix;
      checkedTransform(positionLdu, matrixLdu, lineNumber);
      current.placements.push({ fileName: normalizeReferenceFilename(tokens.slice(14).join(' ')), color: color(tokens[1], lineNumber), positionLdu, matrixLdu, sourceLine: lineNumber });
      if (++placementCount > limits.maxParts) fail('Too many part/submodel placements.', 'REFERENCE_IMPORT_LIMIT');
    } else if (['2', '3', '4', '5'].includes(type)) {
      const count = type === '2' ? 2 : type === '3' ? 3 : 4;
      const n = tokens.slice(2).map(Number);
      if (n.length !== count * 3 || n.some(value => !Number.isFinite(value) || Math.abs(value) > 1e6)) fail(`Invalid primitive at line ${lineNumber}.`);
      current.primitives.push({ type: Number(type) as ReferencePrimitive['type'], color: color(tokens[1], lineNumber), vertices: Array.from({ length: count }, (_, i) => vector(n.slice(i * 3, i * 3 + 3))), sourceLine: lineNumber });
    } else fail(`Unsupported LDraw record type at line ${lineNumber}.`);
  }
  if (!submodels.length) fail('No LDraw model section was found.');
  // Validate every section, including unreachable submodels, before expansion.
  const heights = new Map<string, number>(), active = new Set<string>();
  const validateTree = (model: ReferenceSubmodel, depth: number): number => {
    if (active.has(model.name)) fail(`Cyclic MPD hierarchy at ${model.name}.`, 'REFERENCE_MODEL_CYCLE');
    if (depth > limits.maxDepth) fail('MPD hierarchy is too deep.', 'REFERENCE_IMPORT_LIMIT');
    const cachedHeight = heights.get(model.name);
    if (cachedHeight !== undefined) {
      if (depth + cachedHeight > limits.maxDepth) fail('MPD hierarchy is too deep.', 'REFERENCE_IMPORT_LIMIT');
      return cachedHeight;
    }
    active.add(model.name);
    let height = 0;
    for (const p of model.placements) { const sub = byName.get(p.fileName); if (sub) height = Math.max(height, 1 + validateTree(sub, depth + 1)); }
    active.delete(model.name); heights.set(model.name, height); return height;
  };
  for (const submodel of submodels) validateTree(submodel, 0);
  const parts: ReferenceVehicleModel['parts'] = [];
  let expandedPlacements = 0;
  const expand = (model: ReferenceSubmodel, position: ReferenceVector, matrix: ReferenceMatrix, inheritedColor: number, hierarchy: string[], depth: number): void => {
    if (depth > limits.maxDepth) fail('Expanded hierarchy is too deep.', 'REFERENCE_IMPORT_LIMIT');
    for (const p of model.placements) {
      if (++expandedPlacements > limits.maxParts) fail('Expanded hierarchy has too many placements.', 'REFERENCE_IMPORT_LIMIT');
      const positionLdu = addVectors(position, transformVector(matrix, p.positionLdu));
      const matrixLdu = multiplyMatrices(matrix, p.matrixLdu), resolvedColor = p.color === 16 ? inheritedColor : p.color;
      checkedTransform(positionLdu, matrixLdu, p.sourceLine, true);
      const submodel = byName.get(p.fileName);
      if (submodel) { expand(submodel, positionLdu, matrixLdu, resolvedColor, [...hierarchy, `${p.fileName}@${p.sourceLine}`], depth + 1); continue; }
      if (parts.length >= limits.maxParts) fail('Expanded model has too many parts.', 'REFERENCE_IMPORT_LIMIT');
      const partId = p.fileName.replace(/\.dat$/, '');
      parts.push({ instanceId: `part-${parts.length + 1}`, partId, fileName: p.fileName, color: resolvedColor, nativeColor: p.color, positionLdu, matrixLdu, position: ldrawToInternal(positionLdu), matrixInternalLdu: ldrawMatrixToInternal(matrixLdu), hierarchy: [...hierarchy], sourceLine: p.sourceLine, resolved: referenceCatalogAdapter(partId) !== null });
    }
  };
  const rootModel = submodels[0].name;
  expand(submodels[0], { x: 0, y: 0, z: 0 }, [...IDENTITY_MATRIX], 16, [rootModel], 0);
  const knownGeometryParts = parts.filter(part => part.resolved).length;
  const primitiveCount = submodels.reduce((total, model) => total + model.primitives.length, 0);
  if (primitiveCount) warnings.push(`${primitiveCount} inline primitive records retained in submodels; automotive part analysis excludes inline geometry.`);
  if (knownGeometryParts < parts.length) warnings.push('Unknown external parts are retained unresolved; no external files are fetched and no placeholder geometry is created.');
  if (parts.some(part => part.color === 16)) warnings.push('Root current-color 16 has no explicit parent color and remains 16.');
  const model: ReferenceVehicleModel = { schemaVersion: 1, kind: 'model', id: stableId([metadata.source, metadata.modelName, options.text]), metadata, rootModel, submodels, parts, coverage: { totalParts: parts.length, knownGeometryParts, geometryRate: parts.length ? knownGeometryParts / parts.length : 0, unresolvedPartIds: [...new Set(parts.filter(part => !part.resolved).map(part => part.partId))].sort() }, warnings };
  return model;
}

/** Stored model documents carry their source sections, so parsing can be repeated at the trust boundary. */
export function assertReferenceEntry(value: unknown): asserts value is ReferenceLibraryEntry {
  if (!value || typeof value !== 'object') fail('Invalid reference document.');
  const entry = value as ReferenceLibraryEntry;
  if (entry.schemaVersion !== 1 || !/^ref-[a-f0-9]{24}$/.test(entry.id) || !['link', 'model'].includes(entry.kind)) fail('Invalid reference document schema.');
  normalizeReferenceMetadata(entry.metadata);
  if (entry.kind === 'model') {
    if (entry.metadata.license === 'unknown') fail('Unknown-license model text cannot be stored.', 'REFERENCE_LICENSE_UNCONFIRMED');
    if (!Array.isArray(entry.parts) || entry.parts.length > REFERENCE_IMPORT_LIMITS.maxParts || !Array.isArray(entry.submodels) || entry.submodels.length > REFERENCE_IMPORT_LIMITS.maxSubmodels || !entry.coverage || !Array.isArray(entry.warnings)) fail('Invalid reference model structure.');
    for (const part of entry.parts) { normalizeReferenceFilename(part.fileName); if (!part.positionLdu || !Array.isArray(part.matrixLdu) || part.matrixLdu.length !== 9) fail('Invalid stored reference transform.'); checkedTransform(part.positionLdu, part.matrixLdu, part.sourceLine, true); }
  }
}

export class ReferenceModelImporter {
  import(options: ImportReferenceOptions): ReferenceVehicleModel { return importReferenceModel(options); }
  link(metadata: ReferenceMetadataInput): ReferenceLink { return createReferenceLink(metadata); }
}
