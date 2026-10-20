import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { atomicSpeedJsonWrite } from '../speed/storage.js';
import { InventoryError } from '../inventory/index.js';
import { createManualVehicleProfile, getCatalogVehicleProfile, listCatalogVehicleProfiles } from './research/profiles.js';
import type { RealVehicleProfile } from './research/types.js';

export class AutomotiveProfileStore {
  private directory: string;
  constructor(options: { dataDir?: string } = {}) { this.directory = path.resolve(options.dataDir ?? process.env.BRICKLAB_DATA_DIR ?? 'data', 'automotive', 'profiles'); }
  private filename(id: string) {
    if (!/^manual-[\p{L}\p{N}]{1,100}$/u.test(id)) throw new InventoryError('车型资料编号无效。', 'INVALID_VEHICLE_PROFILE', 400);
    return path.join(this.directory, `${id}.json`);
  }
  async save(input: unknown): Promise<RealVehicleProfile> {
    const profile = createManualVehicleProfile(input);
    await atomicSpeedJsonWrite(this.filename(profile.id), input, 32_000);
    return profile;
  }
  async get(id: string): Promise<RealVehicleProfile> {
    if (!id.startsWith('manual-')) {
      const profile = getCatalogVehicleProfile(id);
      if (!profile) throw new InventoryError('尚无此车型资料，请先填写资料。', 'VEHICLE_PROFILE_NOT_FOUND', 404);
      return profile;
    }
    try {
      const filename = this.filename(id), info = await lstat(filename);
      if (!info.isFile() || info.size > 32_000) throw new Error('corrupt');
      const profile = createManualVehicleProfile(JSON.parse(await readFile(filename, 'utf8')));
      if (profile.id !== id) throw new Error('corrupt');
      return profile;
    } catch (error) {
      if (error instanceof InventoryError) throw error;
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new InventoryError('找不到已保存的车型资料。', 'VEHICLE_PROFILE_NOT_FOUND', 404);
      throw new InventoryError('已保存的车型资料损坏。', 'VEHICLE_PROFILE_CORRUPT', 500);
    }
  }
  async list(): Promise<RealVehicleProfile[]> {
    let names: string[];
    try { names = (await readdir(this.directory)).filter(name => /^manual-[\p{L}\p{N}]{1,100}\.json$/u.test(name)).sort().slice(0, 100); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return listCatalogVehicleProfiles(); throw error; }
    return [...listCatalogVehicleProfiles(), ...await Promise.all(names.map(name => this.get(name.slice(0, -5))))];
  }
}
