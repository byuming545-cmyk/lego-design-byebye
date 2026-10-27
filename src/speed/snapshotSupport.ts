import { enrichInventorySnapshot } from '../inventory/index.js';
import type { SetInventory } from '../types/index.js';
import { analyzeSpeedInventories } from './inventory.js';
import { VERSION_METADATA } from './versions.js';

export async function recordSpeedSupport(inventory: SetInventory, dataDir?: string): Promise<void> {
  if (inventory.source !== 'rebrickable' || !inventory.snapshotId) return;
  const classified = analyzeSpeedInventories([inventory]);
  await enrichInventorySnapshot(inventory.snapshotId, {
    catalogVersion: `${VERSION_METADATA.partLibraryVersion}-legacy-parametric-unverified`,
    totalQuantity: classified.analysis.totalQuantity,
    // Legacy parameter definitions recognize identity but are not source-backed
    // geometry/connection imports. Inventory reads must not promote their trust.
    supportedQuantity: 0,
    recognizedOnlyQuantity: classified.analysis.supportedQuantity + classified.analysis.partiallySupportedQuantity,
    unsupportedQuantity: classified.analysis.unsupportedQuantity,
    supportRatio: 0,
    parts: classified.items.map(item => ({ partId: item.partId, colorId: item.color.id, quantity: item.quantityAvailable,
      status: item.support === 'unsupported' ? 'unsupported' : 'recognizedOnly', category: item.category })),
  }, dataDir);
}
