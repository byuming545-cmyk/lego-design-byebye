export type PartCategory = "Brick" | "Plate" | "Tile" | "Slope" | "Unsupported";
/** hex is a CSS color in #RRGGBB form, consistently across API and renderers. */
export interface PartColor {
  id: number;
  name: string;
  hex: string;
}
export interface PartDimensions {
  x: number;
  y: number;
  z: number;
}
export interface PartInventoryItem {
  partId: string;
  name: string;
  category: PartCategory;
  color: PartColor;
  quantityAvailable: number;
  quantityUsed: number;
  supported: boolean;
  dimensions: PartDimensions;
  /** Rebrickable's category ID is preserved separately from our local geometry category. */
  partCategoryId?: number | null;
  /** Spare stock is traceable but excluded from quantityAvailable. */
  quantitySpare?: number;
  quantityTotal?: number;
}
/** One upstream row, retained before merging exact part / color identities. */
export interface RawInventoryItem {
  partId: string;
  name: string;
  partCategoryId: number | null;
  color: PartColor;
  quantity: number;
  /** null means the upstream row did not supply spare information. */
  isSpare: boolean | null;
  page: number;
  row: number;
}
export interface InventoryQuantitySummary {
  regularQuantity: number;
  spareQuantity: number;
  totalQuantity: number;
}
export interface SetInventory {
  setNumber: string;
  name: string;
  source: "mock" | "rebrickable";
  sourceLabel: string;
  items: PartInventoryItem[];
  warnings: string[];
  themeId?: number;
  snapshotId?: string;
  fetchedAt?: string;
  sparePolicy?: 'excluded';
  rawItems?: RawInventoryItem[];
  /** A separate list, never consumed by generators through items. */
  spareItems?: PartInventoryItem[];
  quantitySummary?: InventoryQuantitySummary;
}
export type Rotation = 0 | 90 | 180 | 270;
export interface PlacedPart {
  instanceId: string;
  partId: string;
  name: string;
  category: PartCategory;
  color: PartColor;
  dimensions: PartDimensions;
  position: { x: number; y: number; z: number };
  rotation: Rotation;
  connections: string[];
  buildStep: number;
}
export interface InventoryUsage {
  partId: string;
  colorId: number;
  quantityUsed: number;
  quantityAvailable: number;
}
export type TemplateId = "robot" | "car" | "house" | "animal";
export type ModelSize = "small" | "balanced" | "large";
export type ColorStrategy = "preserve" | "substitute" | "missing-parts";
export interface GenerationOptions {
  prompt: string;
  size: ModelSize;
  colorStrategy: ColorStrategy;
  maximizeUsage: boolean;
}
export interface LegoModel {
  id: string;
  name: string;
  description: string;
  template: TemplateId;
  parts: PlacedPart[];
  dimensions: PartDimensions;
  inventoryUsage: InventoryUsage[];
  notes: string[];
}
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}
export interface BuildStep {
  stepNumber: number;
  title: string;
  description: string;
  addedParts: PlacedPart[];
  totalModelState: PlacedPart[];
}
export interface GenerationResult {
  model: LegoModel;
  validation: ValidationResult;
  steps: BuildStep[];
  inventory: SetInventory;
}
export interface GenerateRequest {
  setNumber: string;
  options: GenerationOptions;
}
export interface ApiError {
  error: string;
  code?: string;
}
