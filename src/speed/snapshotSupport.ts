import { enrichInventorySnapshot } from '../inventory/index.js';
import type { SetInventory } from '../types/index.js';
import { analyzeSpeedInventories } from './inventory.js';
import { VERSION_METADATA } from './versions.js';

export async function recordSpeedSupport(inventory: SetInventory): Promise<void> {
  if (inventory.source !== 'rebrickable' || !inventory.snapshotId) return;
  const classified = analyzeSpeedInventories([inventory]);
  await enrichInventorySnapshot(inventory.snapshotId, {
    catalogVersion: VERSION_METADATA.partLibraryVersion,
    totalQuantity: classified.analysis.totalQuantity,
    supportedQuantity: classified.analysis.supportedQuantity,
    recognizedOnlyQuantity: classified.analysis.partiallySupportedQuantity,
    unsupportedQuantity: classified.analysis.unsupportedQuantity,
    supportRatio: classified.analysis.supportRate,
    parts: classified.items.map(item => ({ partId: item.partId, colorId: item.color.id, quantity: item.quantityAvailable,
      status: item.supported ? 'generatable' : item.support === 'partiallySupported' ? 'recognizedOnly' : 'unsupported', category: item.category })),
  });
}
