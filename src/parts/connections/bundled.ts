import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalConnectionPath, importLdcadShadow, SHADOW_REVISION, SHADOW_SOURCE_ROOT } from './importer.js';
import type { ConnectionImportOptions, ConnectionLibrary } from './types.js';

export interface GeometryTextResolver {
  readText(path: string): Promise<string | undefined>;
  revision?: string;
  sourceRoot?: string;
}

export interface ShadowManifest {
  schemaVersion: number;
  library: string;
  revision: string;
  sourceRoot: string;
  license: string;
  files: { path: string; bytes: number; sha256: string; license: string; sourceUrl: string }[];
}

export function createBundledShadowLibrary(geometryResolver: GeometryTextResolver, root = fileURLToPath(new URL('../../..', import.meta.url))): ConnectionLibrary {
  // From both src/parts/connections and dist-server/parts/connections, three parents reach repository root.
  const directory = path.join(root, 'data', 'parts-foundation', 'shadow');
  let manifestPromise: Promise<ShadowManifest> | undefined;
  const cache = new Map<string, Promise<string | undefined>>();
  async function manifest() {
    manifestPromise ??= readFile(path.join(directory, 'manifest.json'), 'utf8').then((text) => {
      const value = JSON.parse(text) as ShadowManifest;
      if (value.revision !== SHADOW_REVISION || value.library !== 'LDCadShadowLibrary' || value.license !== 'CC-BY-SA-4.0' || !Array.isArray(value.files)) throw new Error('Unexpected bundled Shadow source manifest.');
      return value;
    });
    return manifestPromise;
  }
  return {
    geometryRevision: geometryResolver.revision,
    geometrySourceRoot: geometryResolver.sourceRoot,
    shadowRevision: SHADOW_REVISION,
    shadowSourceRoot: SHADOW_SOURCE_ROOT,
    getGeometryFile: (name) => geometryResolver.readText(name),
    async getShadowFile(name) {
      const safe = canonicalConnectionPath(name);
      if (!safe) return undefined;
      if (!cache.has(safe)) cache.set(safe, (async () => {
        const source = (await manifest()).files.find((file) => file.path === safe);
        if (!source) return undefined;
        const bytes = await readFile(path.join(directory, 'files', safe));
        if (bytes.length !== source.bytes || createHash('sha256').update(bytes).digest('hex') !== source.sha256) throw new Error(`Shadow source integrity mismatch: ${safe}`);
        return bytes.toString('utf8');
      })());
      return cache.get(safe)!;
    },
  };
}

/** Reuse a factory to share source-file cache across the Part Lab catalogue scan. */
export function createBundledConnectionImporter(geometryResolver: GeometryTextResolver, root?: string) {
  const library = createBundledShadowLibrary(geometryResolver, root);
  return { library, importPart: (partId: string, options?: ConnectionImportOptions) => importLdcadShadow(partId, library, options) };
}

export async function loadBundledConnections(partId: string, geometryResolver: GeometryTextResolver, options?: ConnectionImportOptions) {
  return createBundledConnectionImporter(geometryResolver).importPart(partId, options);
}
