import { createHash } from 'node:crypto';
import { copyFile, cp, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
export interface PartImportRoots { ldrawRoot?: string; shadowRoot?: string }
const MAX_BUNDLE_JSON = 1_000_000;
const MAX_FILES = 500;
const MAX_FILE_BYTES = 4_000_000;
const MAX_TOTAL_BYTES = 50_000_000;
export const APPROVED_IMPORT_SOURCES: Record<ImportLibraryName, readonly string[]> = {
  LDraw: ['https://raw.githubusercontent.com/pybricks/ldraw/'],
  LDCadShadowLibrary: ['https://raw.githubusercontent.com/RolandMelkert/LDCadShadowLibrary/'],
};

export type ImportLibraryName = 'LDraw' | 'LDCadShadowLibrary';
export interface ImportSourceFile { path: string; sha256: string; bytes: number; author?: string | null; license?: string; reuse?: boolean }
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
  if (!APPROVED_IMPORT_SOURCES[expected].some(prefix => sourceUrl.startsWith(prefix))) throw new PartImportError('unapproved-source', `Source host is not approved for ${expected}.`);
  if (!APPROVED_IMPORT_SOURCES[expected].some(prefix => sourceUrl === `${prefix}${revision}/`)) throw new PartImportError('invalid-bundle', 'sourceUrl must end with the pinned revision.');
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
    files.push({ path: filePath, sha256, bytes, ...(typeof file.author === "string" ? { author: text(file.author, "file.author", 500) } : {}), ...(typeof file.license === "string" ? { license: text(file.license, "file.license", 100) } : {}), ...(file.reuse === true ? { reuse: true } : {}) });
  }
  if (!seen.has(root)) throw new PartImportError('invalid-bundle', 'Root file is not listed in files.');
  return { library, revision, license, sourceUrl, root, files };
}

export function validatePartImportMetadata(value: unknown): PartImportBundle {
  const raw = object(value);
  if (raw.schemaVersion !== PART_IMPORT_SCHEMA) throw new PartImportError('invalid-bundle', 'Unsupported bundle schema.');
  const rawPartId = text(raw.partId, 'partId', 80);
  const partId = rawPartId.toLowerCase();
  if (rawPartId !== partId || !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(partId)) throw new PartImportError('invalid-part-id', 'partId must be a lowercase native ID.');
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

function importRoots(options: PartImportRoots = {}) {
  return { ldrawRoot: options.ldrawRoot ?? BUNDLED_LDRAW_DIRECTORY, shadowRoot: options.shadowRoot ?? SHADOW_DIRECTORY };
}

async function checkedFile(root: string, file: ImportSourceFile, side: 'ldraw' | 'shadow'): Promise<string> {
  const target = path.join(root, side, file.path);
  let component = root;
  for (const piece of [side, ...file.path.split('/')]) {
    component = path.join(component, piece);
    const entry = await lstat(component).catch(() => undefined);
    if (entry?.isSymbolicLink()) throw new PartImportError('symbolic-source-path', `Symbolic source path is forbidden: ${side}/${file.path}`);
  }
  const stat = await lstat(target).catch(() => undefined);
  if (!stat || !stat.isFile() || stat.isSymbolicLink()) throw new PartImportError('missing-source-file', `Missing regular source file: ${side}/${file.path}`);
  const bytes = await readFile(target);
  if (bytes.length !== file.bytes) throw new PartImportError('source-integrity', `Byte count differs for ${side}/${file.path}.`);
  if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new PartImportError('source-integrity', `SHA-256 differs for ${side}/${file.path}.`);
  return target;
}

export async function readPartImportBundle(directory: string, options: PartImportRoots = {}): Promise<PartImportBundle> {
  const roots = importRoots(options);
  const metadataPath = path.join(directory, 'bundle.json');
  const metadata = await readFile(metadataPath).catch(() => { throw new PartImportError('missing-bundle', 'bundle.json is missing.'); });
  if (metadata.length > MAX_BUNDLE_JSON) throw new PartImportError('bundle-too-large', 'bundle.json exceeds the metadata limit.');
  let parsed: unknown;
  try { parsed = JSON.parse(metadata.toString('utf8')); } catch { throw new PartImportError('invalid-bundle', 'bundle.json is not valid JSON.'); }
  const bundle = validatePartImportMetadata(parsed);
  const base = await loadLDrawManifest(roots.ldrawRoot);
  if (base.revision !== bundle.geometry.revision) throw new PartImportError('source-revision-mismatch', 'LDraw bundle revision must equal the pinned repository revision.');
  if (SHADOW_REVISION !== bundle.connections.revision) throw new PartImportError('source-revision-mismatch', 'Shadow bundle revision must equal the pinned repository revision.');
  if (!bundle.allowStagingValidation) throw new PartImportError('staging-not-allowed', 'Bundle metadata does not allow staging validation.');
  const shadowBase = await loadShadowManifest(roots.shadowRoot);
  if (base.roots.some(root => root.partId === bundle.partId)) throw new PartImportError('part-already-exists', `Part ${bundle.partId} is already in the pinned catalogue; use a new native ID.`);
  if (bundle.geometry.sourceUrl !== base.sourceRoot || bundle.connections.sourceUrl !== shadowBase.sourceRoot) throw new PartImportError('source-root-mismatch', 'Bundle source roots must exactly match the reviewed pinned manifests.');
  for (const [library, manifest] of [[bundle.geometry, base], [bundle.connections, shadowBase]] as const) for (const file of library.files) {
    const existing = manifest.files.find(item => item.path === file.path);
    if (existing && (!file.reuse || existing.sha256 !== file.sha256 || existing.bytes !== file.bytes)) throw new PartImportError('source-path-already-in-base', `Conflicting or undeclared reuse of pinned source: ${file.path}`);
  }
  for (const [side, library, manifest, sourceRoot] of [
    ['ldraw', bundle.geometry, base, roots.ldrawRoot], ['shadow', bundle.connections, shadowBase, roots.shadowRoot],
  ] as const) for (const file of library.files) {
    const existing = manifest.files.find(item => item.path === file.path);
    if (existing && (!file.reuse || existing.sha256 !== file.sha256 || existing.bytes !== file.bytes)) throw new PartImportError('source-path-already-in-base', `Conflicting or undeclared reuse of pinned source: ${file.path}`);
    if (!existing && file.reuse) throw new PartImportError('missing-reused-source', `Reused source is absent: ${file.path}`);
    const target = existing ? path.join(sourceRoot, 'files', file.path) : await checkedFile(directory, file, side);
    const raw = await readFile(target);
    if (raw.length !== file.bytes || createHash('sha256').update(raw).digest('hex') !== file.sha256) throw new PartImportError('source-integrity', `Source hash differs: ${file.path}`);
    const lines = raw.toString('utf8').split(/\r?\n/);
    const author = lines.find(line => /^0\s+Author:/.test(line))?.replace(/^0\s+Author:\s*/, '').trim() ?? null;
    const licenseText = lines.find(line => /^0\s+!LICENSE\s/.test(line))?.replace(/^0\s+!LICENSE\s+/, '').trim();
    const license = side === 'shadow' && licenseText === 'CC BY-SA 4.0, see LICENSE.md' ? 'CC-BY-SA-4.0' : licenseText;
    if (!license || (side === 'ldraw' ? !ACCEPTED_LDRAW_LICENSES.has(license) : license !== 'CC-BY-SA-4.0')) throw new PartImportError('invalid-license', `Missing or unreviewed per-file licence: ${file.path}`);
    if (file.author !== undefined && file.author !== author || file.license !== undefined && file.license !== license) throw new PartImportError('source-metadata-mismatch', `Source author/licence differs: ${file.path}`);
    file.author = author; file.license = license;
    if (side === 'ldraw' && file.path === library.root) {
      const declaredName = lines.find(line => /^0\s+Name:/.test(line))?.replace(/^0\s+Name:\s*/, '').trim();
      if (declaredName !== `${bundle.partId}.dat` || bundle.author !== author || bundle.name !== lines[0]?.replace(/^0\s+/, '').trim()) throw new PartImportError('source-metadata-mismatch', 'Root identity, description or author differs from the unchanged source header.');
    }
  }
  return bundle;
}

export async function loadLDrawManifest(root = BUNDLED_LDRAW_DIRECTORY) {
  const text = await readFile(path.join(root, 'manifest.json'), 'utf8');
  return validateBundledLDrawManifest(JSON.parse(text));
}

export async function loadShadowManifest(root = SHADOW_DIRECTORY): Promise<ShadowManifest> {
  const text = await readFile(path.join(root, 'manifest.json'), 'utf8');
  return validateBundledShadowManifest(JSON.parse(text));
}

export async function stagePartImport(directory: string, bundle: PartImportBundle, options: PartImportRoots = {}): Promise<StagedPartImport> {
  const roots = importRoots(options);
  if (!bundle.allowStagingValidation) throw new PartImportError('staging-not-allowed', 'Bundle metadata does not allow staging validation.');
  const base = await loadLDrawManifest(roots.ldrawRoot);
  const shadowBase = await loadShadowManifest(roots.shadowRoot);
  // Recheck bytes and immutable-base reuse immediately before building the overlay.
  const checked = await readPartImportBundle(directory, options);
  if (JSON.stringify(checked) !== JSON.stringify(bundle)) throw new PartImportError('source-integrity', 'Bundle changed between validation and staging.');
  const temp = await mkdtemp(path.join(tmpdir(), `bricklab-part-import-${bundle.partId}-`));
  const ldrawDirectory = path.join(temp, 'ldraw'), shadowDirectory = path.join(temp, 'shadow');
  try {
    await cp(path.join(roots.ldrawRoot, 'files'), path.join(ldrawDirectory, 'files'), { recursive: true });
    await cp(path.join(roots.shadowRoot, 'files'), path.join(shadowDirectory, 'files'), { recursive: true });
    for (const file of bundle.geometry.files.filter(file => !file.reuse)) {
      const target = path.join(ldrawDirectory, 'files', file.path);
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(path.join(directory, 'ldraw', file.path), target);
    }
    for (const file of bundle.connections.files.filter(file => !file.reuse)) {
      const target = path.join(shadowDirectory, 'files', file.path);
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(path.join(directory, 'shadow', file.path), target);
    }
    const ldraw = structuredClone(base);
    ldraw.files.push(...bundle.geometry.files.filter(file => !file.reuse).map(file => ({ ...file, author: file.author ?? null, license: file.license!, sourceUrl: `${ldraw.sourceRoot}${file.path}` })));
    ldraw.roots.push({ partId: bundle.partId, path: bundle.geometry.root, name: bundle.name, selectionBasis: `part-import: ${bundle.selectionBasis}` });
    validateBundledLDrawManifest(ldraw);
    await writeFile(path.join(ldrawDirectory, 'manifest.json'), JSON.stringify(ldraw, null, 2));
    const shadow: ShadowManifest = structuredClone(shadowBase);
    shadow.files.push(...bundle.connections.files.filter(file => !file.reuse).map(file => ({ ...file, license: file.license!, sourceUrl: `${shadow.sourceRoot}${file.path}` })));
    validateBundledShadowManifest(shadow);
    await writeFile(path.join(shadowDirectory, 'manifest.json'), JSON.stringify(shadow, null, 2));
  } catch (error) {
    await rm(temp, { recursive: true, force: true });
    throw error;
  }
  return { partId: bundle.partId, ldrawDirectory, shadowDirectory, cleanup: () => rm(temp, { recursive: true, force: true }) };
}
