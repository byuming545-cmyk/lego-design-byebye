import { MockInventoryProvider } from './mock.js';
import { InventoryError, type SetInventoryProvider } from './provider.js';
import { RebrickableInventoryProvider } from './rebrickable.js';

export { MockInventoryProvider, RebrickableInventoryProvider, InventoryError };
export { normalizeSetNumber } from './provider.js';
export type { SetInventoryProvider } from './provider.js';
export { enrichInventorySnapshot, saveInventorySnapshot } from './snapshot.js';
export type { InventorySupportSnapshot, RawSetInventorySnapshot } from './snapshot.js';

/** Keep production startup and health available while returning an actionable request error. */
export class MissingRebrickableInventoryProvider implements SetInventoryProvider {
  readonly source = 'rebrickable' as const;
  async getSetInventory(): Promise<never> {
    throw new InventoryError('Rebrickable API Key 未配置。', 'MISSING_API_KEY', 503);
  }
}

export function createInventoryProvider(env: Record<string, string | undefined> = process.env): SetInventoryProvider {
  const selection = env.INVENTORY_PROVIDER?.trim() || 'auto';
  if (!['auto', 'mock', 'rebrickable'].includes(selection)) {
    throw new InventoryError('INVENTORY_PROVIDER 仅支持 auto、mock 或 rebrickable。', 'INVALID_PROVIDER', 503);
  }
  if (selection === 'mock') return new MockInventoryProvider();
  if (!env.REBRICKABLE_API_KEY?.trim()) {
    if (selection === 'auto' && env.NODE_ENV !== 'production') return new MockInventoryProvider();
    return new MissingRebrickableInventoryProvider();
  }
  return new RebrickableInventoryProvider(env.REBRICKABLE_API_KEY ?? '', { dataDir: env.BRICKLAB_DATA_DIR });
}
