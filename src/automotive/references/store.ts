import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, lstat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { assertReferenceEntry, createReferenceLink, importReferenceModel, normalizeReferenceFilename, REFERENCE_IMPORT_LIMITS, ReferenceImportError } from './importer.js';
import type { ReferenceLibraryEntry, ReferenceLink, ReferenceMetadataInput, ReferenceVehicleModel } from './types.js';

const MAX_STORED_BYTES = 32 * 1024 * 1024;
const pendingWrites = new Map<string, Promise<void>>();
const safeId = (id: string): string => {
  if (typeof id !== 'string' || !/^ref-[a-f0-9]{24}$/.test(id)) throw new ReferenceImportError('Invalid reference identifier.', 'INVALID_REFERENCE_ID');
  return id;
};
/** Rebuild trusted fields from source sections. Extra fields cannot smuggle model text into a link-only record. */
function canonicalEntry(input: ReferenceLibraryEntry): ReferenceLibraryEntry {
  assertReferenceEntry(input);
  if (input.kind === 'link') return { ...createReferenceLink(input.metadata), id: safeId(input.id) };
  const lines: string[] = [];
  let placements = 0, primitives = 0;
  for (const submodel of input.submodels) {
    lines.push(`0 FILE ${normalizeReferenceFilename(submodel.name)}`);
    if (!Array.isArray(submodel.placements) || !Array.isArray(submodel.primitives)) throw new ReferenceImportError('Invalid stored reference submodel.');
    placements += submodel.placements.length; primitives += submodel.primitives.length;
    if (placements > REFERENCE_IMPORT_LIMITS.maxParts || primitives > REFERENCE_IMPORT_LIMITS.maxLines) throw new ReferenceImportError('Stored reference exceeds source record limits.', 'REFERENCE_IMPORT_LIMIT');
    for (const p of submodel.placements) {
      if (!p.positionLdu || !Array.isArray(p.matrixLdu) || p.matrixLdu.length !== 9) throw new ReferenceImportError('Invalid stored reference placement.');
      lines.push(`1 ${p.color} ${p.positionLdu.x} ${p.positionLdu.y} ${p.positionLdu.z} ${p.matrixLdu.join(' ')} ${normalizeReferenceFilename(p.fileName)}`);
    }
    for (const p of submodel.primitives) {
      if (![2, 3, 4, 5].includes(p.type) || !Array.isArray(p.vertices)) throw new ReferenceImportError('Invalid stored reference primitive.');
      lines.push(`${p.type} ${p.color} ${p.vertices.flatMap(v => [v.x, v.y, v.z]).join(' ')}`);
    }
    lines.push('0 NOFILE');
  }
  const model = importReferenceModel({ text: lines.join('\n'), metadata: input.metadata });
  if (model.rootModel !== input.rootModel) throw new ReferenceImportError('Stored reference root does not match its source sections.');
  return { ...model, id: safeId(input.id) };
}

export class ReferenceLibraryStore {
  readonly directory: string;
  constructor(options: { dataDir?: string } = {}) { this.directory = path.resolve(options.dataDir ?? process.env.BRICKLAB_DATA_DIR ?? 'data', 'automotive', 'references'); }
  private filename(id: string): string { return path.join(this.directory, `${safeId(id)}.json`); }
  async save(entry: ReferenceLibraryEntry): Promise<void> {
    const canonical = canonicalEntry(entry), filename = this.filename(canonical.id), json = JSON.stringify(canonical);
    if (Buffer.byteLength(json) > MAX_STORED_BYTES) throw new ReferenceImportError('Reference document exceeds the storage limit.', 'REFERENCE_IMPORT_LIMIT', 413);
    const previous = pendingWrites.get(filename) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(async () => {
      await mkdir(this.directory, { recursive: true });
      const temporary = `${filename}.${randomUUID()}.tmp`;
      try { await writeFile(temporary, json, { encoding: 'utf8', flag: 'wx', mode: 0o600 }); await rename(temporary, filename); }
      finally { await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }); }
    });
    pendingWrites.set(filename, operation);
    try { await operation; } finally { if (pendingWrites.get(filename) === operation) pendingWrites.delete(filename); }
  }
  async get(id: string): Promise<ReferenceLibraryEntry> {
    const filename = this.filename(id);
    try {
      const info = await lstat(filename);
      if (!info.isFile() || info.size > MAX_STORED_BYTES) throw new ReferenceImportError('Invalid stored reference file.', 'REFERENCE_STORAGE_CORRUPT', 500);
      let parsed: unknown;
      try { parsed = JSON.parse(await readFile(filename, 'utf8')); } catch { throw new ReferenceImportError('Stored reference JSON is corrupt.', 'REFERENCE_STORAGE_CORRUPT', 500); }
      assertReferenceEntry(parsed);
      if (parsed.id !== id) throw new ReferenceImportError('Stored reference identifier mismatch.', 'REFERENCE_STORAGE_CORRUPT', 500);
      return canonicalEntry(parsed);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new ReferenceImportError('Reference not found.', 'REFERENCE_NOT_FOUND', 404);
      throw error;
    }
  }
  async load(id: string): Promise<ReferenceLibraryEntry> { return this.get(id); }
  async list(limit = 100): Promise<ReferenceLibraryEntry[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new ReferenceImportError('Reference list limit must be 1–1000.');
    let entries;
    try { entries = await readdir(this.directory, { withFileTypes: true }); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    const names = entries.filter(entry => entry.isFile() && /^ref-[a-f0-9]{24}\.json$/.test(entry.name)).map(entry => entry.name).sort();
    if (names.length > 2000) throw new ReferenceImportError('Reference library exceeds bounded listing limit.', 'REFERENCE_IMPORT_LIMIT');
    const models = await Promise.all(names.map(name => this.get(name.slice(0, -5))));
    return models.sort((a, b) => b.metadata.importedAt.localeCompare(a.metadata.importedAt) || a.id.localeCompare(b.id)).slice(0, limit);
  }
}
export { ReferenceLibraryStore as ReferenceDiskStore };
export async function saveReferenceModel(model: ReferenceVehicleModel, options?: { dataDir?: string }): Promise<void> { await new ReferenceLibraryStore(options).save(model); }
export async function getReferenceModel(id: string, options?: { dataDir?: string }): Promise<ReferenceLibraryEntry> { return new ReferenceLibraryStore(options).get(id); }
export async function listReferenceModels(options?: { dataDir?: string; limit?: number }): Promise<ReferenceLibraryEntry[]> { return new ReferenceLibraryStore(options).list(options?.limit); }
export async function saveReferenceLink(metadata: ReferenceMetadataInput, options?: { dataDir?: string }): Promise<ReferenceLink> { const link = createReferenceLink(metadata); await new ReferenceLibraryStore(options).save(link); return link; }
