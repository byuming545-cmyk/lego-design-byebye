import { NativePartRepository } from "../parts/assembly/source.js";
import { createBundledLDrawResolver } from "../parts/ldraw/index.js";
import { MiniCatalog, miniDigest, stableJson } from "../mini-cars/catalog.js";
import type { NativeAssemblyPart } from "../parts/assembly/types.js";
export class BodyCatalog {
  readonly repository = new NativePartRepository();
  async load(ids: string[]) {
    this.repository.assertCurrentSnapshot();
    const manifest = await this.repository.getManifest(),
      resolver = await createBundledLDrawResolver(),
      expected = new Map(manifest.files.map((f) => [f.path, f]));
    const parts = new Map<string, NativeAssemblyPart>();
    for (const id of [...new Set(ids)]) {
      if (!manifest.roots.some((x) => x.partId === id))
        throw Error("BODY_UNKNOWN_NATIVE_ID");
      const part = await this.repository.getPart(id);
      if (
        !part ||
        part.geometry.status !== "geometryReady" ||
        !part.geometry.mesh ||
        !part.geometry.bounds ||
        part.geometry.source.integrity !== "verified" ||
        part.geometry.source.licenseStatus !== "complete" ||
        part.geometry.partId !== id
      )
        throw Error("BODY_SOURCE_UNAVAILABLE");
      for (const f of part.geometry.source.files) {
        if (stableJson(expected.get(f.path)) !== stableJson(f))
          throw Error("BODY_SOURCE_MANIFEST_MISMATCH");
        if ((await resolver.readText(f.path)) === undefined)
          throw Error("BODY_SOURCE_DEPENDENCY_MISSING");
      }
      parts.set(id, part);
    }
    return parts;
  }
  async palette() {
    const manifest = await this.repository.getManifest();
    const roots = manifest.roots.filter(
      (x) =>
        /^(?:Plate|Tile|Brick)\s+\d+ x\s*\d+(?:$| with Groove$)/.test(x.name) ||
        /^Slope Brick 45\s+2 x\s*2$/.test(x.name),
    );
    return this.load([...roots.map((x) => x.partId), "18977", "66727"]);
  }
  source(part: NativeAssemblyPart) {
    return new MiniCatalog(this.repository).source(part);
  }
  get snapshot() {
    return this.repository.snapshotDigest;
  }
}
