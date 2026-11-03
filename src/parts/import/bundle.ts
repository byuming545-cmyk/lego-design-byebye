import { createHash } from 'node:crypto';
import { cp, lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUNDLED_LDRAW_DIRECTORY, loadBundledLDrawManifest, validateBundledLDrawManifest } from '../ldraw/bundled.js';
import { validateBundledShadowManifest, type ShadowManifest } from '../connections/bundled.js';
import { SHADOW_REVISION } from '../connections/importer.js';
import { canonicalLDrawPath } from '../ldraw/importer.js';
import { ACCEPTED_LDRAW_LICENSES } from '../provenance.js';

export const PART_IMPORT_SCHEMA = 'bricklab-part-import-bundle-1';
export const SHADOW_DIRECTORY = fileURLToPath(new URL('../../../data/parts-foundation/shadow/', import.meta.url));
const MAX_BUNDLE_JSON = 1_000_000;
const MAX_FILES = 500;
const MAX_FILE_BYTES = 4_000_000;
const MAX_TOTAL_BYTES = 50_000_000;

export type ImportLibraryName = 'LDraw' | 'LDCadShadowLibrary';
export interface ImportSourceFile { path: string; sha256: string; bytes: number }
export interface ImportLibrary {
  library: ImportLibraryName;
  revision: string;
  license: string;
  sourceUrl: string;
  root: string;
  files: ImportSourceFile[];
}
export interface PartImportBundle {
  schemaVersion: typeof PART_IMPORT_SCHEMA;
  partId: string;
  name: string;
  author: string;
  geometry: ImportLibrary;
  connections: ImportLibrary;
  selectionBasis: string;
  importBasis: string;
  reviewer: string;
  allowStagingValidation: boolean;
}
export interface StagedPartImport {
  partId: string;
  ldrawDirectory: string;
  shadowDirectory: string;
  cleanup: () => Promise<void>;
}
export class PartImportError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'PartImportError'; }
}
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PartImportError('invalid-bundle', 'Bundle metadata must be an object.');
  return value as Record<string, unknown>;
};
const text = (value: unknown, field: string, max = 500): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new PartImportError('invalid-bundle', `Missing or invalid ${field}.`);
  return value.trim();
};
const hash = (value: unknown, field: string): string => {
  const result = text(value, field, 64);
  if (!/^[a-f0-9]{64}$/.test(result)) throw new PartImportError('invalid-bundle', `${field} must be a lowercase SHA-256.`);
  return result;
};
const integer = (value: unknown, field: string, min: number, max: number): number => {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) throw new PartImportError('invalid-bundle', `${field} is outside its allowed range.`);
  return value as number;
};
const https = (value: unknown, field: string): string => {
  const result = text(value, field, 2_000);
  if (!/^https:\/\//.test(result)) throw new PartImportError('invalid-bundle', `${field} must be an https source URL.`);
  return result;
};

function validateLibrary(value: unknown, expected: ImportLibraryName, partId: string): ImportLibrary {
  const raw = object(value);
  const library = text(raw.library, 'library', 40) as ImportLibraryName;
  if (library !== expected) throw new PartImportError('invalid-bundle', `Expected ${expected} source library.`);
  const revision = text(raw.revision, 'revision', 64);
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new PartImportError('invalid-bundle', 'Source revision must be a pinned 40-character commit.');
  const license = text(raw.license, 'license', 80);
  if (expected === 'LDraw' && !ACCEPTED_LDRAW_LICENSES.has(license)) throw new PartImportError('invalid-license', `Unreviewed LDraw license: ${license}`);
  if (expected === 'LDCadShadowLibrary' && license !== 'CC-BY-SA-4.0') throw new PartImportError('invalid-license', `Unreviewed Shadow license: ${license}`);
  const sourceUrl = https(raw.sourceUrl, 'sourceUrl');
  if (!sourceUrl.endsWith(`/${revision}/`)) throw new PartImportError('invalid-bundle', 'sourceUrl must end with the pinned revision.');
  const root = text(raw.root, 'root', 200);
  if (canonicalLDrawPath(root) !== root || root !== `parts/${partId}.dat`) throw new PartImportError('invalid-bundle', 'Root must be parts/<partId>.dat.');
  if (!Array.isArray(raw.files) || raw.files.length < 1 || raw.files.length > MAX_FILES) throw new PartImportError('invalid-bundle', 'Source files must be a non-empty bounded list.');
  const files: ImportSourceFile[] = [], seen = new Set<string>();
  let total = 0;
  for (const [index, item] of raw.files.entries()) {
    const file = object(item);
    const filePath = text(file.path, `files[${index}].path`, 200);
    if (canonicalLDrawPath(filePath) !== filePath || !/^(?:parts|p)\//.test(filePath) || seen.has(filePath)) throw new PartImportError('invalid-bundle', `Invalid or duplicate source path: ${filePath}`);
    const sha256 = hash(file.sha256, `files[${index}].sha256`);
    const bytes = integer(file.bytes, `files[${index}].bytes`, 1, MAX_FILE_BYTES);
    total += bytes;
    if (total > MAX_TOTAL_BYTES) throw new PartImportError('bundle-too-large', 'Bundle exceeds the source byte limit.');
    seen.add(filePath);
    files.push({ path: filePath, sha256, bytes });
  }
  if (!seen.has(root)) throw new PartImportError('invalid-bundle', 'Root file is not listed in files.');
  return { library, revision, license, sourceUrl, root, files };
}

export function validatePartImportMetadata(value: unknown): PartImportBundle {
  const raw = object(value);
  if (raw.schemaVersion !== PART_IMPORT_SCHEMA) throw new PartImportError('invalid-bundle', 'Unsupported bundle schema.');
  const partId = text(raw.partId, 'partId', 80).toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(partId) || partId !== text(raw.partId, 'partId', 80).toLowerCase()) throw new PartImportError('invalid-part-id', 'partId must be a lowercase native ID.');
  const geometry = validateLibrary(raw.geometry, 'LDraw', partId);
  const connections = validateLibrary(raw.connections, 'LDCadShadowLibrary', partId);
  return {
    schemaVersion: PART_IMPORT_SCHEMA, partId,
    name: text(raw.name, 'name', 200), author: text(raw.author, 'author', 200),
    geometry, connections,
    selectionBasis: text(raw.selectionBasis, 'selectionBasis', 500),
    importBasis: text(raw.importBasis, 'importBasis', 500),
    reviewer: text(raw.reviewer, 'reviewer', 200),
    allowStagingValidation: raw.allowStagingValidation === true,
  };
}

async function checkedFile(root: string, file: ImportSourceFile, side: 'ldraw' | 'shadow'): Promise<string> {
  const target = path.join(root, side, file.path);
  const stat = await lstat(target).catch(() => undefined);
  if (!stat || !stat.isFile() || stat.isSymbolicLink()) throw new PartImportError('missing-source-file', `Missing regular source file: ${side}/${file.path}`);
  const bytes = await readFile(target);
  if (bytes.length !== file.bytes) throw new PartImportError('source-integrity', `Byte count differs for ${side}/${file.path}.`);
  if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new PartImportError('source-integrity', `SHA-256 differs for ${side}/${file.path}.`);
  return target;
}

export async function readPartImportBundle(directory: string): Promise<PartImportBundle> {
  const metadataPath = path.join(directory, 'bundle.json');
  const metadata = await readFile(metadataPath).catch(() => { throw new PartImportError('missing-bundle', 'bundle.json is missing.'); });
  if (metadata.length > MAX_BUNDLE_JSON) throw new PartImportError('bundle-too-large', 'bundle.json exceeds the metadata limit.');
  let parsed: unknown;
  try { parsed = JSON.parse(metadata.toString('utf8')); } catch { throw new PartImportError('invalid-bundle', 'bundle.json is not valid JSON.'); }
  const bundle = validatePartImportMetadata(parsed);
  const base = await loadBundledLDrawManifest();
  if (base.revision !== bundle.geometry.revision) throw new PartImportError('source-revision-mismatch', 'LDraw bundle revision must equal the pinned repository revision.');
  if (SHADOW_REVISION !== bundle.connections.revision) throw new PartImportError('source-revision-mismatch', 'Shadow bundle revision must equal the pinned repository revision.');
  if (base.roots.some(root => root.partId === bundle.partId)) throw new PartImportError('part-already-exists', `Part ${bundle.partId} is already in the pinned catalogue; use a new native ID.`);
  for (const file of bundle.geometry.files) await checkedFile(directory, file, 'ldraw');
  for (const file of bundle.connections.files) await checkedFile(directory, file, 'shadow');
  return bundle;
}

export async function stagePartImport(directory: string, bundle: PartImportBundle): Promise<StagedPartImport> {
  const base = await loadBundledLDrawManifest();
  const shadowText = await readFile(path.join(SHADOW_DIRECTORY, 'manifest.json'), 'utf8');
  const shadowBase = validateBundledShadowManifest(JSON.parse(shadowText));
  const temp = await mkdtemp(path.join(tmpdir(), `bricklab-part-import-${bundle.partId}-`));
  const ldrawDirectory = path.join(temp, 'ldraw'), shadowDirectory = path.join(temp, 'shadow');
  try {
    await cp(path.join(BUNDLED_LDRAW_DIRECTORY, 'files'), path.join(ldrawDirectory, 'files'), { recursive: true });
    await cp(path.join(SHADOW_DIRECTORY, 'files'), path.join(shadowDirectory, 'files'), { recursive: true });
    await cp(path.join(directory, 'ldraw'), path.join(ldrawDirectory, 'files'), { recursive: true });
    await cp(path.join(directory, 'shadow'), path.join(shadowDirectory, 'files'), { recursive: true });
    const ldraw = structuredClone(base);
    ldraw.files.push(...bundle.geometry.files.map(file => ({ ...file, author: bundle.author, license: bundle.geometry.license, sourceUrl: `${ldraw.sourceRoot}${file.path}` })));
    ldraw.roots.push({ partId: bundle.partId, path: bundle.geometry.root, name: bundle.name, selectionBasis: `part-import: ${bundle.selectionBasis}` });
    validateBundledLDrawManifest(ldraw);
    await writeFile(path.join(ldrawDirectory, 'manifest.json'), JSON.stringify(ldraw, null, 2));
    const shadow: ShadowManifest = structuredClone(shadowBase);
    shadow.files.push(...bundle.connections.files.map(file => ({ ...file, license: bundle.connections.license, sourceUrl: `${shadow.sourceRoot}${file.path}` })));
    validateBundledShadowManifest(shadow);
    await writeFile(path.join(shadowDirectory, 'manifest.json'), JSON.stringify(shadow, null, 2));
  } catch (error) {
    await rm(temp, { recursive: true, force: true });
    throw error;
  }
  return { partId: bundle.partId, ldrawDirectory, shadowDirectory, cleanup: () => rm(temp, { recursive: true, force: true }) };
}
