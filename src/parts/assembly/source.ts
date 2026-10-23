import { createHash } from 'node:crypto';
import { createBundledLDrawImporter, createBundledLDrawResolver, loadBundledLDrawManifest, type BundledLDrawManifest } from '../ldraw/index.js';
import { createBundledConnectionImporter } from '../connections/index.js';
import type { NativeAssemblyPart } from './types.js';
import { CONNECTION_PARSER_VERSION } from '../connections/importer.js';

export const PART_LIBRARY_VERSION = 'ldraw-c43ed06a-shadow-9b1131fb-parser-2';
const sourceHashes = new WeakMap<NativeAssemblyPart, string>();

function freezeSource<T>(value: T, seen = new WeakSet<object>()): T {
  if (value !== null && typeof value === 'object' && !seen.has(value)) {
    seen.add(value);
    for (const child of Object.values(value)) freezeSource(child, seen);
    Object.freeze(value);
  }
  return value;
}

/** Digest binds the complete native closure and all connector source bytes. */
export function nativePartSourceHash(part: NativeAssemblyPart): string {
  const existing = Object.isFrozen(part) ? sourceHashes.get(part) : undefined;
  if (existing) return existing;
  const hash = createHash('sha256').update(JSON.stringify({
    connectionParserVersion: CONNECTION_PARSER_VERSION,
    partId: part.partId,
    geometryRevision: part.geometry.source.revision,
    geometryRoot: part.geometry.source.rootFile,
    geometry: part.geometry.source.files.map(file => [file.path, file.sha256]).sort((a, b) => a[0].localeCompare(b[0])),
    connections: part.connections.sourceFiles.map(file => [file.library, file.path, file.revision, file.sha256]).sort((a, b) => a.join(':').localeCompare(b.join(':'))),
  })).digest('hex');
  if (Object.isFrozen(part)) sourceHashes.set(part, hash);
  return hash;
}

/** One immutable source repository is shared by verification, generation and rendering. */
export class NativePartRepository {
  private prepared?: Promise<void>;
  private manifest?: BundledLDrawManifest;
  private importer?: Awaited<ReturnType<typeof createBundledLDrawImporter>>;
  private connections?: ReturnType<typeof createBundledConnectionImporter>;
  private readonly cache = new Map<string, Promise<NativeAssemblyPart | undefined>>();
  private initialize() {
    this.prepared ??= (async () => {
      this.manifest = await loadBundledLDrawManifest();
      this.importer = await createBundledLDrawImporter();
      this.connections = createBundledConnectionImporter(await createBundledLDrawResolver());
    })();
    return this.prepared;
  }
  async listIds(): Promise<string[]> { await this.initialize(); return this.manifest!.roots.map(root => root.partId); }
  async getManifest(): Promise<BundledLDrawManifest> { await this.initialize(); return structuredClone(this.manifest!); }
  async getPart(partId: string): Promise<NativeAssemblyPart | undefined> {
    await this.initialize();
    if (!this.manifest!.roots.some(root => root.partId === partId)) return undefined;
    if (!this.cache.has(partId)) this.cache.set(partId, (async () => freezeSource({
      partId,
      geometry: await this.importer!.importPart(partId),
      connections: await this.connections!.importPart(partId),
    }))());
    return this.cache.get(partId)!;
  }
}
