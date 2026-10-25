import { createHash } from 'node:crypto';
import { createBundledLDrawImporter, createBundledLDrawResolver, loadBundledLDrawManifest, type BundledLDrawManifest } from '../ldraw/index.js';
import { createBundledConnectionImporter } from '../connections/index.js';
import type { NativeAssemblyPart } from './types.js';
import { CONNECTION_PARSER_VERSION } from '../connections/importer.js';
import { LDRAW_GEOMETRY_PARSER_VERSION } from '../ldraw/importer.js';
import { assertDigitalPartOrigin } from '../provenance.js';

export const PART_LIBRARY_VERSION = 'ldraw-c43ed06a-shadow-9b1131fb-geometry-1-connections-2-expansion-1';
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
    geometryParserVersion: LDRAW_GEOMETRY_PARSER_VERSION,
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
  /** Explicit source-bundle selection for reviewed offline imports. Not request/env controlled. */
  constructor(private readonly sourceBundle: { geometryDirectory?: string; shadowDirectory?: string } = {}) {}
  private prepared?: Promise<void>;
  private manifest?: BundledLDrawManifest;
  private importer?: Awaited<ReturnType<typeof createBundledLDrawImporter>>;
  private connections?: ReturnType<typeof createBundledConnectionImporter>;
  private readonly cache = new Map<string, Promise<NativeAssemblyPart | undefined>>();
  private initialize() {
    this.prepared ??= (async () => {
      this.manifest = await loadBundledLDrawManifest(this.sourceBundle.geometryDirectory);
      this.importer = await createBundledLDrawImporter(this.sourceBundle.geometryDirectory);
      this.connections = createBundledConnectionImporter(await createBundledLDrawResolver(this.sourceBundle.geometryDirectory), undefined, { directory: this.sourceBundle.shadowDirectory });
    })();
    return this.prepared;
  }
  async listIds(): Promise<string[]> { await this.initialize(); return this.manifest!.roots.map(root => root.partId); }
  async getManifest(): Promise<BundledLDrawManifest> { await this.initialize(); return structuredClone(this.manifest!); }
  async getPart(partId: string): Promise<NativeAssemblyPart | undefined> {
    await this.initialize();
    if (!this.manifest!.roots.some(root => root.partId === partId)) return undefined;
    if (!this.cache.has(partId)) this.cache.set(partId, (async () => {
      const part = { partId, geometry: await this.importer!.importPart(partId), connections: await this.connections!.importPart(partId) };
      // Failed imports retain their diagnostics; no placeholder or legacy fallback is substituted.
      if (part.geometry.status === 'geometryReady') assertDigitalPartOrigin(part);
      return freezeSource(part);
    })());
    return this.cache.get(partId)!;
  }
}
