import { MockInventoryProvider } from './mock.js';
import { InventoryError, type SetInventoryProvider } from './provider.js';
import { RebrickableInventoryProvider } from './rebrickable.js';

export { MockInventoryProvider, RebrickableInventoryProvider, InventoryError };
export { normalizeSetNumber } from './provider.js';
export type { SetInventoryProvider } from './provider.js';

export function createInventoryProvider(env: Record<string, string | undefined> = process.env): SetInventoryProvider {
  const selection = env.INVENTORY_PROVIDER?.trim() || 'auto';
  if (!['auto', 'mock', 'rebrickable'].includes(selection)) {
    throw new InventoryError('INVENTORY_PROVIDER 仅支持 auto、mock 或 rebrickable。', 'INVALID_PROVIDER', 503);
  }
  if (selection === 'mock' || (selection === 'auto' && !env.REBRICKABLE_API_KEY?.trim())) return new MockInventoryProvider();
  return new RebrickableInventoryProvider(env.REBRICKABLE_API_KEY ?? '');
}
