import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { canonicalLDrawPath, LDrawPartImporter } from './importer.js';
import type { BundledLDrawManifest, LDrawResolver } from './types.js';

export const BUNDLED_LDRAW_DIRECTORY = fileURLToPath(new URL('../../../data/parts-foundation/ldraw/', import.meta.url));

export async function loadBundledLDrawManifest(directory = BUNDLED_LDRAW_DIRECTORY): Promise<BundledLDrawManifest> {
  const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8')) as BundledLDrawManifest;
  if (manifest.schemaVersion !== 1 || manifest.library !== 'LDraw' || !/^[a-f0-9]{40}$/.test(manifest.revision)
      || !Array.isArray(manifest.files) || !Array.isArray(manifest.roots)) throw new Error('Invalid bundled LDraw manifest');
  return manifest;
}

export async function createBundledLDrawResolver(directory = BUNDLED_LDRAW_DIRECTORY): Promise<LDrawResolver> {
  const manifest = await loadBundledLDrawManifest(directory);
  const expectedHashes = Object.fromEntries(manifest.files.map(file => [file.path, file.sha256]));
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
      if (createHash('sha256').update(bytes).digest('hex') !== expectedHashes[normalized]) throw new Error(`Pinned LDraw source integrity failed: ${normalized}`);
      return bytes.toString('utf8');
    },
  };
}

export async function createBundledLDrawImporter(directory = BUNDLED_LDRAW_DIRECTORY): Promise<LDrawPartImporter> {
  return new LDrawPartImporter(await createBundledLDrawResolver(directory));
}
