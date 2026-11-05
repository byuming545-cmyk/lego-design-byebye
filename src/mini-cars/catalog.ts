import { createHash } from 'node:crypto';
import { NativePartRepository } from '../parts/assembly/source.js';
import { createBundledLDrawResolver, type LDrawResolver } from '../parts/ldraw/index.js';
import { LDRAW_GEOMETRY_PARSER_VERSION } from '../parts/ldraw/importer.js';
import type { NativeAssemblyPart } from '../parts/assembly/types.js';
import type { MiniSource } from './types.js';

export const MINI_PALETTE = ['3020', '3022', '3032', '3623', '3004', '3001', '15068', '3039', '18974', '3068b', '3069b', '3710', '3005', '18977', '66727'] as const;
export class MiniCarError extends Error {
  constructor(message: string, readonly code = 'INVALID_MINI_CAR', readonly status = 400) { super(message); }
}
export const stableJson = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
export const miniDigest = (value: unknown) => createHash('sha256').update(stableJson(value)).digest('hex');

/** Native meshes are shared with the real library; this palette is a design
 * choice, never another source of dimensions, connectors or assembly authority. */
export class MiniCatalog {
  private resolver?: Promise<LDrawResolver>;
  private readonly parts = new Map<string, NativeAssemblyPart>();
  constructor(readonly repository = new NativePartRepository(), private readonly verifyResolver = () => createBundledLDrawResolver()) {}
  get snapshot() { this.repository.assertCurrentSnapshot(); return this.repository.snapshotDigest; }
  async load(ids: readonly string[] = MINI_PALETTE): Promise<Map<string, NativeAssemblyPart>> {
    void this.snapshot;
    const manifest = await this.repository.getManifest();
    for (const id of new Set(ids)) {
      if (!MINI_PALETTE.includes(id as typeof MINI_PALETTE[number]) || !manifest.roots.some(root => root.partId === id)) throw new MiniCarError('零件不在当前真实来源设计集合中。', 'MINI_UNKNOWN_PART');
      const part = this.parts.get(id) ?? await this.repository.getPart(id);
      if (!part || part.partId !== id || part.geometry.partId !== id || part.geometry.status !== 'geometryReady' || !part.geometry.mesh || !part.geometry.bounds ||
          part.geometry.source.integrity !== 'verified' || part.geometry.source.licenseStatus !== 'complete' || part.geometry.source.rootFile !== `parts/${id}.dat` || part.geometry.source.revision !== manifest.revision || !part.geometry.source.files.some(f => f.path === part.geometry.source.rootFile)) throw new MiniCarError('真实零件几何或来源不完整。', 'MINI_SOURCE_UNAVAILABLE', 409);
      const mesh = part.geometry.mesh;
      if (!mesh.positions.length || !mesh.indices.length || mesh.indices.length % 3 || !mesh.positions.every(v => v.length === 3 && v.every(Number.isFinite)) || !mesh.indices.every(i => Number.isSafeInteger(i) && i >= 0 && i < mesh.positions.length)) throw new MiniCarError('真实网格完整性检查失败。', 'MINI_INVALID_MESH', 409);
      this.parts.set(id, part);
    }
    // Re-read every required original dependency on each request, including warm
    // cache hits. A raw source edit cannot be hidden behind a cached mesh.
    this.resolver ??= this.verifyResolver();
    const resolver = await this.resolver;
    const expected = new Map(manifest.files.map(file => [file.path, file]));
    const allFiles = ids.flatMap(id => this.parts.get(id)!.geometry.source.files);
    for (const file of allFiles) if (stableJson(expected.get(file.path)) !== stableJson(file)) throw new MiniCarError('依赖来源与固定清单不一致。', 'MINI_SOURCE_MISMATCH', 409);
    const files = new Map(allFiles.map(file => [file.path, file]));
    for (const file of files.values()) {
      if (stableJson(expected.get(file.path)) !== stableJson(file)) throw new MiniCarError('依赖来源与固定清单不一致。', 'MINI_SOURCE_MISMATCH', 409);
      try { if (await resolver.readText(file.path) === undefined) throw new Error('Missing dependency'); }
      catch { throw new MiniCarError('原始依赖缺失或哈希、大小、许可已变化。', 'MINI_SOURCE_CHANGED', 409); }
    }
    return new Map(ids.map(id => [id, this.parts.get(id)!]));
  }
  source(part: NativeAssemblyPart): MiniSource {
    return { partId: part.partId, name: part.geometry.name ?? part.partId, revision: part.geometry.source.revision,
      rootFile: part.geometry.source.rootFile, geometryParser: LDRAW_GEOMETRY_PARSER_VERSION, meshSha256: miniDigest(part.geometry.mesh), files: structuredClone(part.geometry.source.files) };
  }
}
