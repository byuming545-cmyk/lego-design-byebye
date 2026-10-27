import { LEGACY_QUARANTINE } from '../../parts/legacyStatus.js';
import type { PartCategory, PartDimensions } from '../../types/index.js';

export interface PartDefinition {
  legacyStatus: 'LEGACY_QUARANTINED';
  sourceSystem: 'LegacyParametric';
  nativeGeometryVerified: false;
  automaticPromotionAllowed: false;
  partId: string;
  name: string;
  category: Exclude<PartCategory, 'Unsupported'>;
  dimensions: PartDimensions;
  /** Only planar studded tops may support another part in V0.1. */
  hasStuds: boolean;
}

const part = (partId: string, name: string, category: PartDefinition['category'], x: number, y: number, z: number, hasStuds = true): PartDefinition => ({ ...LEGACY_QUARANTINE, partId, name, category, dimensions: { x, y, z }, hasStuds });

/** x/y are studs; z is plates (one ordinary brick is three plates). */
export const PART_CATALOG: Record<string, PartDefinition> = {
  '3001': part('3001', 'Brick 2 × 4', 'Brick', 2, 4, 3),
  '3003': part('3003', 'Brick 2 × 2', 'Brick', 2, 2, 3),
  '3004': part('3004', 'Brick 1 × 2', 'Brick', 1, 2, 3),
  '3005': part('3005', 'Brick 1 × 1', 'Brick', 1, 1, 3),
  '3020': part('3020', 'Plate 2 × 4', 'Plate', 2, 4, 1),
  '3022': part('3022', 'Plate 2 × 2', 'Plate', 2, 2, 1),
  '3023': part('3023', 'Plate 1 × 2', 'Plate', 1, 2, 1),
  '3024': part('3024', 'Plate 1 × 1', 'Plate', 1, 1, 1),
  '3068b': part('3068b', 'Tile 2 × 2', 'Tile', 2, 2, 1, false),
  '3069b': part('3069b', 'Tile 1 × 2', 'Tile', 1, 2, 1, false),
  '3040b': part('3040b', 'Slope 45° 1 × 2', 'Slope', 1, 2, 3, false),
};

export const SUPPORTED_PART_IDS = Object.freeze(Object.keys(PART_CATALOG));
export const getPartDefinition = (partId: string): PartDefinition | undefined => Object.hasOwn(PART_CATALOG, partId) ? PART_CATALOG[partId] : undefined;
