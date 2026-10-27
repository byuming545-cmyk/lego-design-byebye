/** Source observations are separate from geometry, connector or physical verification. */
export type InventorySourceTrust = 'user-reported' | 'source-observed' | 'verified-export' | 'verified-upstream';
export type PartIdSystem = 'ldraw' | 'rebrickable' | 'bricklink';
export type ColorIdSystem = 'lego' | 'ldraw' | 'rebrickable' | 'bricklink';

export interface InventoryEvidence {
  sourceId: string;
  page?: number;
  row?: number;
  bbox?: [number, number, number, number];
  quantityBbox?: [number, number, number, number];
  elementIdBbox?: [number, number, number, number];
  rawText?: string;
  method?: string;
  reviewStatus?: string;
}

export interface FoundationInventoryItem {
  /** Never populate this field with a LEGO element number. */
  partId: string | null;
  partIdSystem: PartIdSystem | null;
  designId: string | null;
  elementId: string | null;
  color: { system: ColorIdSystem; id: string; name?: string } | null;
  quantity: number;
  /** null means unknown; it must not be added to regular / non-spare quantity. */
  isSpare: boolean | null;
  category: string | null;
  evidence: InventoryEvidence[];
}

export interface FoundationInventory {
  schemaVersion: 1;
  id: string;
  setNumber: string;
  inventoryComplete: boolean;
  provenance: {
    kind: 'local-json' | 'local-csv' | 'official-pdf' | 'rebrickable';
    sourceId: string;
    sourceUrl: string | null;
    sha256: string;
    importedAt: string;
    trust: InventorySourceTrust;
    fileName?: string;
    officialOriginIndependentlyVerified?: boolean;
  };
  items: FoundationInventoryItem[];
}

export interface LocalInventoryOptions {
  id: string;
  setNumber: string;
  sourceId: string;
  sourceUrl?: string | null;
  inventoryComplete?: boolean;
  importedAt?: string;
}
