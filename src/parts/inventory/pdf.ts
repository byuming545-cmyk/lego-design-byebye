import { FoundationInventoryError, parseFoundationInventory, record, sourceHash } from './import.js';
import type { FoundationInventory } from './types.js';

/** The appendix reports element observations, not a design-ID/geometry mapping. */
export function adaptPdfInventories(payload: unknown, importedAt = new Date().toISOString()): FoundationInventory[] {
  const root = record(payload, 'PDF inventories');
  if (root.schemaVersion !== 1 || !Array.isArray(root.inventories) || root.inventories.length > 500) throw new FoundationInventoryError('PDF inventories schema is invalid');
  return root.inventories.map(raw => {
    const inventory = record(raw, 'PDF inventory');
    const source = record(inventory.source, 'PDF source');
    if (source.kind !== 'user-uploaded-lego-pdf' || inventory.inventoryComplete !== false || inventory.sparesDistinguished !== false || !Array.isArray(inventory.rows) || inventory.rows.length > 20_000) throw new FoundationInventoryError('PDF observations cannot claim complete or spare-resolved inventories');
    const sha256 = sourceHash(source.sha256);
    const items = inventory.rows.map(value => {
      const row = record(value, 'PDF row');
      // Importers must not silently infer a design, color or spare flag from an element number or image.
      if (row.partId != null || row.designId != null || row.color != null || row.isSpare != null) throw new FoundationInventoryError('PDF element observations require separate verified identity mapping before adding design, color or spare data');
      const evidence = record(row.evidence, 'PDF evidence');
      if (!['native-pdf-text-block', 'native-pdf-text-coordinate-pair'].includes(String(evidence.method)) || !['text-layer-extracted', 'visual-spot-checked'].includes(String(evidence.reviewStatus))) throw new FoundationInventoryError('PDF row extraction evidence is missing');
      return { partId: null, partIdSystem: null, designId: null, elementId: row.elementId, color: null, quantity: row.quantity, isSpare: null, category: null, evidence: [evidence] };
    });
    return parseFoundationInventory({
      schemaVersion: 1, id: `pdf-${inventory.documentId}`, setNumber: inventory.setNumber, inventoryComplete: false,
      provenance: { kind: 'official-pdf', sourceId: inventory.documentId, sourceUrl: source.sourceUrl ?? null, sha256, importedAt, trust: 'source-observed', ...(source.fileName !== undefined ? { fileName: source.fileName } : {}), officialOriginIndependentlyVerified: source.officialOriginIndependentlyVerified === true }, items,
    });
  });
}
