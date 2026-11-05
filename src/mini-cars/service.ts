import { mkdir, readdir, readFile, link, stat, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { LDrawMesh } from '../parts/ldraw/types.js';
import { MiniCatalog, MiniCarError, miniDigest, stableJson } from './catalog.js';
import { generateMiniCar, parseMiniOptions } from './generator.js';
import { MINI_SCHEMA, MINI_GENERATOR_VERSION, MINI_MAX_PARTS, MINI_COLORS, type MiniModel } from './types.js';
import { isRigidTransform } from '../parts/assembly/math.js';

export class MiniCarService {
  readonly directory: string;
  constructor(readonly catalog = new MiniCatalog(), dataDir = process.env.BRICKLAB_DATA_DIR ?? 'data') { this.directory = path.resolve(dataDir, 'mini-cars', 'models'); }
  generate(value: unknown) { return generateMiniCar(this.catalog, value); }
  async validate(value: unknown): Promise<MiniModel> {
    const model = value as MiniModel;
    if (!model || model.schema !== MINI_SCHEMA || model.generatorVersion !== MINI_GENERATOR_VERSION || model.state !== 'APPEARANCE_DRAFT' || !Array.isArray(model.placements) || !model.placements.length || model.placements.length > MINI_MAX_PARTS ||
        model.placements.some(p => !p || !isRigidTransform(p.transform))) throw new MiniCarError('不是当前版本的迷你跑车外观模型，或包含无效刚体变换。', 'MINI_INVALID_MODEL');
    const { contentSha256, ...body } = model;
    if (miniDigest(body) !== contentSha256) throw new MiniCarError('模型内容校验失败。', 'MINI_CHECKSUM_MISMATCH');
    // Rebuild against current native sources. Re-signing forged poses, colours,
    // BOM or verification claims cannot grant authority or bypass this check.
    const expected = await this.generate(parseMiniOptions(model.options));
    if (stableJson(model) !== stableJson(expected)) throw new MiniCarError('模型与当前来源、版本或生成布局不一致，请重新生成。', 'MINI_NEEDS_REVALIDATION', 409);
    return expected;
  }
  async payload(model: MiniModel) {
    const assets: Record<string, { mesh: LDrawMesh }> = {}, parts = await this.catalog.load(model.sources.map(s => s.partId));
    for (const [id, part] of parts) assets[id] = { mesh: part.geometry.mesh! };
    return { model, assets };
  }
  private file(id: string) { if (!/^mini-[a-f0-9]{24}$/.test(id)) throw new MiniCarError('模型编号无效。'); return path.join(this.directory, id + '.json'); }
  async save(value: unknown) {
    const model = await this.validate(value), file = this.file(model.id);
    await mkdir(this.directory, { recursive: true });
    const temporary = file + '.' + randomUUID() + '.tmp';
    try {
      await writeFile(temporary, stableJson(model) + '\n', { flag: 'wx' });
      // Publish a complete file without replacing an existing user record.
      try { await link(temporary, file); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        if (await readFile(file, 'utf8') !== stableJson(model) + '\n') throw new MiniCarError('同名保存记录已变化，原文件已保留。请使用新参数另存方案。', 'MINI_SAVE_CONFLICT', 409);
      }
    }
    finally { await rm(temporary, { force: true }); }
    return { id: model.id, state: model.state };
  }
  async open(id: string) {
    let bytes: Buffer;
    try { bytes = await readFile(this.file(id)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new MiniCarError('没有找到保存的迷你跑车。', 'MINI_NOT_FOUND', 404); throw error; }
    if (bytes.length > 2 * 1024 * 1024) throw new MiniCarError('模型文件超过大小限制。');
    let value: unknown; try { value = JSON.parse(bytes.toString('utf8')); } catch { throw new MiniCarError('保存的模型 JSON 无效。'); }
    return this.validate(value);
  }
  async list() {
    let files: string[]; try { files = await readdir(this.directory); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    const rows = [];
    for (const file of files.filter(f => /^mini-[a-f0-9]{24}\.json$/.test(f)).slice(0, 200)) {
      const id = file.slice(0,-5), modifiedAt = (await stat(this.file(id))).mtime.toISOString();
      // Listing metadata never authorizes a saved model. Open revalidates it.
      rows.push({ id, modifiedAt });
    }
    return rows.sort((a,b) => b.modifiedAt.localeCompare(a.modifiedAt));
  }
  bomCsv(model: MiniModel) {
    const quote = (v: unknown) => '"' + String(v).replaceAll('"', '""') + '"';
    return [['part_id','name','design_color','ldraw_color','quantity','assembly','color_availability'], ...model.bom.map(row => [row.partId,row.name,MINI_COLORS[row.color].label,row.ldrawColor,row.quantity,row.assemblyStatus,row.colorAvailability])].map(row => row.map(quote).join(',')).join('\r\n') + '\r\n';
  }
}
