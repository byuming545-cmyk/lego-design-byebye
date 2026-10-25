import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { canonicalLDrawPath, LDrawPartImporter } from './importer.js';
import type { BundledLDrawManifest, LDrawResolver } from './types.js';
import { ACCEPTED_LDRAW_LICENSES } from '../provenance.js';

export const BUNDLED_LDRAW_DIRECTORY = fileURLToPath(new URL('../../../data/parts-foundation/ldraw/', import.meta.url));

/** Ambiguous identities are conflicts, never last-write-wins overrides. */
export function validateBundledLDrawManifest(value: unknown): BundledLDrawManifest {
  const manifest = value as BundledLDrawManifest;
  if (!manifest || manifest.schemaVersion !== 1 || manifest.library !== 'LDraw' || !/^[a-f0-9]{40}$/.test(manifest.revision)
      || typeof manifest.sourceRoot !== 'string' || !/^https:\/\//.test(manifest.sourceRoot) || !manifest.sourceRoot.endsWith(`/${manifest.revision}/`)
      || !manifest.archive || !/^https:\/\//.test(manifest.archive.sourceUrl) || !/^[a-f0-9]{64}$/.test(manifest.archive.sha256)
      || !Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > 50000
      || !Array.isArray(manifest.roots) || !manifest.roots.length || manifest.roots.length > 10000) throw new Error('Invalid bundled LDraw manifest');
  const paths = new Set<string>();
  for (const file of manifest.files) {
    if (!file || typeof file.path !== 'string' || canonicalLDrawPath(file.path) !== file.path || !/^(?:parts|p)\//.test(file.path) || paths.has(file.path)) throw new Error('CONFLICT: duplicate or noncanonical LDraw source path');
    if (!/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > 4_000_000 ||
        !file.license || !ACCEPTED_LDRAW_LICENSES.has(file.license) || file.sourceUrl !== `${manifest.sourceRoot}${file.path}`) throw new Error('Unreviewed LDraw source digest, size, license or URL');
    paths.add(file.path);
  }
  const ids = new Set<string>();
  for (const root of manifest.roots) {
    if (!root || typeof root.partId !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(root.partId) || ids.has(root.partId) ||
        root.path !== `parts/${root.partId}.dat` || !paths.has(root.path)) throw new Error('CONFLICT: duplicate or mismatched native root identity');
    if (typeof root.name !== 'string' || !root.name.trim() || typeof root.selectionBasis !== 'string' || !root.selectionBasis.trim()) throw new Error('Missing native root selection evidence');
    ids.add(root.partId);
  }
  return manifest;
}

export async function loadBundledLDrawManifest(directory = BUNDLED_LDRAW_DIRECTORY): Promise<BundledLDrawManifest> {
  const bytes = await readFile(path.join(directory, 'manifest.json'));
  if (bytes.length > 24 * 1024 * 1024) throw new Error('Bundled LDraw manifest size limit exceeded');
  return validateBundledLDrawManifest(JSON.parse(bytes.toString('utf8')));
}

export async function createBundledLDrawResolver(directory = BUNDLED_LDRAW_DIRECTORY): Promise<LDrawResolver> {
  const manifest = await loadBundledLDrawManifest(directory);
  const expectedHashes = Object.fromEntries(manifest.files.map(file => [file.path, file.sha256]));
  const sources = new Map(manifest.files.map(file => [file.path, file]));
  const available = new Set(Object.keys(expectedHashes));
  return {
    revision: manifest.revision, sourceRoot: manifest.sourceRoot,
    expectedHashes, paths: [...available],
    async readText(requested) {
      const normalized = canonicalLDrawPath(requested);
      if (!available.has(normalized)) return undefined;
      let bytes: Buffer;
      try { bytes = await readFile(path.join(directory, 'files', normalized)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
      const source = sources.get(normalized)!;
      if (bytes.length !== source.bytes || createHash('sha256').update(bytes).digest('hex') !== expectedHashes[normalized]) throw new Error(`Pinned LDraw source integrity failed: ${normalized}`);
      const text = bytes.toString('utf8');
      const license = text.split(/\r?\n/).find(line => /^0\s+!LICENSE\s/.test(line))?.replace(/^0\s+!LICENSE\s+/, '').trim();
      if (license !== source.license) throw new Error(`Pinned LDraw source license differs from its manifest: ${normalized}`);
      return text;
    },
  };
}

export async function createBundledLDrawImporter(directory = BUNDLED_LDRAW_DIRECTORY): Promise<LDrawPartImporter> {
  return new LDrawPartImporter(await createBundledLDrawResolver(directory));
}
