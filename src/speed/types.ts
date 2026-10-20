import type { PartColor, PartDimensions, Rotation, ValidationResult } from '../types/index.js';

/** Speed uses stud x/y and plate z, with metric-aware 3D quarter-turn rotations. */
export interface SpeedVector { x: number; y: number; z: number }
export interface SpeedOrientation { x: Rotation; y: Rotation; z: Rotation }
export type SpeedSupport = 'supported' | 'partiallySupported' | 'unsupported';
export type SpeedCategory = 'Brick' | 'Plate' | 'Tile' | 'Jumper' | 'Slope' | 'CurvedSlope' | 'Wedge' | 'Wing' | 'CurvedTile' | 'Bracket' | 'ModifiedBrick' | 'ModifiedPlate' | 'Wheel' | 'Tyre' | 'WheelHolder' | 'WheelArch' | 'Mudguard' | 'Windscreen' | 'Panel' | 'Seat' | 'Grille' | 'RoundTile' | 'Light' | 'Other';
export type ConnectorType = 'stud' | 'antiStud' | 'sideStud' | 'sideAntiStud' | 'wheelPin' | 'wheelSocket' | 'rim' | 'tyre';
export interface ConnectionPoint {
  id: string;
  type: ConnectorType;
  localPosition: SpeedVector;
  direction: SpeedVector;
  compatibleTypes: ConnectorType[];
  fitFamily?: string;
  allowsRotation?: boolean;
}
export interface SpeedBox { min: SpeedVector; max: SpeedVector }
export interface SpeedCylinder {
  axis: 'x' | 'y' | 'z';
  center: SpeedVector;
  /** Cylinder radii and axial width are studs, independent of plate-height units. */
  radius: number;
  innerRadius?: number;
  width: number;
}
export interface SpeedShape {
  kind: 'box' | 'slope' | 'curved' | 'wedge' | 'wheel' | 'tyre' | 'holder' | 'windscreen' | 'grille' | 'round';
  /** Axis of revolution in the unrotated local frame. Radii/width are studs. */
  axis?: 'x' | 'y' | 'z';
  radius?: number;
  innerRadius?: number;
  width?: number;
  center?: SpeedVector;
  boxes?: SpeedBox[];
  cylinders?: SpeedCylinder[];
  /** Verified female sockets/bores; collision checks subtract only these volumes. */
  holes?: SpeedCylinder[];
  transparent?: boolean;
  wheelSystem?: string;
}
export interface SpeedPartDefinition {
  partId: string;
  name: string;
  category: SpeedCategory;
  support: SpeedSupport;
  /** Unknown complex geometry stays null and is excluded from generation. */
  dimensions: PartDimensions | null;
  shape: SpeedShape | null;
  connectionPoints: ConnectionPoint[];
  notes: string[];
  ldrawFile: string;
  sourceUrl?: string;
}
export interface InventorySource {
  sourceId: string;
  setNumber: string;
  name: string;
  source: 'mock' | 'rebrickable' | 'custom';
  quantity: number;
}
/** User-reported loose stock; geometry and support always come from the catalog. */
export interface SpeedExtraPart {
  partId: string;
  color: PartColor;
  quantity: number;
}
export interface SpeedInventoryItem {
  partId: string;
  name: string;
  category: SpeedCategory;
  color: PartColor;
  quantityAvailable: number;
  quantityUsed: number;
  support: SpeedSupport;
  supported: boolean;
  dimensions: PartDimensions | null;
  sources: { sourceId: string; setNumber: string; quantity: number }[];
}
export interface SpeedInventoryAnalysis {
  totalQuantity: number;
  supportedQuantity: number;
  partiallySupportedQuantity: number;
  unsupportedQuantity: number;
  usableQuantity: number;
  supportRate: number;
  missingRequirements: string[];
  canGenerate: boolean;
}
export interface SpeedInventory {
  setNumber: string;
  name: string;
  source: 'mock' | 'rebrickable' | 'mixed';
  sourceLabel: string;
  inventorySources: InventorySource[];
  items: SpeedInventoryItem[];
  analysis: SpeedInventoryAnalysis;
  warnings: string[];
}
export type VehicleModuleId = 'chassis' | 'front' | 'rear' | 'cockpit' | 'roof' | 'leftWheelModule' | 'rightWheelModule' | 'bodyShell' | 'aero' | 'details';
export interface SpeedPlacedPart {
  instanceId: string;
  partId: string;
  name: string;
  category: SpeedCategory;
  color: PartColor;
  dimensions: PartDimensions;
  /** Canonical part-origin; transforms never reinterpret this as a rotated AABB. */
  position: SpeedVector;
  orientation: SpeedOrientation;
  moduleId: VehicleModuleId;
  connectionPoints: ConnectionPoint[];
  activeConnections: string[];
  buildStep: number;
}
export interface SpeedConnection {
  id: string;
  partA: string;
  connectionPointA: string;
  partB: string;
  connectionPointB: string;
  connectionType: 'stud' | 'side-stud' | 'wheel-axle' | 'tyre-fit';
  allowsRotation: boolean;
}
export interface VehicleModule {
  id: VehicleModuleId;
  name: string;
  partIds: string[];
  connectionIds: string[];
  locked: boolean;
  structuralScore: number;
}
export type VehicleType = 'supercar' | 'sports-car' | 'gt' | 'concept';
export type VehicleStyle = 'modern' | 'futuristic' | 'retro' | 'aggressive' | 'minimal';
export interface VehicleDesignOptions {
  prompt: string;
  vehicleType: VehicleType;
  style: VehicleStyle;
  minifigure: boolean;
  priority: 'structure' | 'appearance' | 'color';
  maximizeUsage: boolean;
}
export interface VehicleParameters {
  width: number;
  length: number;
  wheelbase: number;
  track: number;
  cockpitPosition: number;
  hoodLength: number;
  roofHeight: number;
}
export interface VehicleModel {
  id: string;
  name: string;
  description: string;
  vehicleType: VehicleType;
  style: VehicleStyle;
  options: VehicleDesignOptions;
  parameters: VehicleParameters;
  parts: SpeedPlacedPart[];
  connections: SpeedConnection[];
  modules: VehicleModule[];
  dimensions: PartDimensions;
  inventoryUsage: { partId: string; colorId: number; quantityUsed: number; quantityAvailable: number }[];
  designNotes: string[];
  version: number;
}
export interface WheelValidation extends ValidationResult {
  wheelCount: number;
  groundedWheels: number;
  collisions: string[];
  rotationalClearance: boolean;
  axleConnections: number;
}
export interface StructuralValidation extends ValidationResult {
  structuralScore: number;
  moduleScores: { moduleId: VehicleModuleId; score: number; anchorCount: number }[];
}
export interface VehicleValidation extends ValidationResult {
  inventory: ValidationResult;
  collision: ValidationResult;
  connection: ValidationResult;
  wheels: WheelValidation;
  structure: StructuralValidation;
}
export interface SpeedBuildStep {
  stepNumber: number;
  title: string;
  description: string;
  type: 'build' | 'subassembly' | 'attach' | 'rotate';
  parentAssembly: 'vehicle' | VehicleModuleId;
  subAssemblyId?: string;
  addedParts: SpeedPlacedPart[];
  totalModelState: SpeedPlacedPart[];
  orientation: SpeedOrientation;
  cameraHint: 'isometric' | 'bottom' | 'front' | 'rear' | 'side';
}
export interface VehicleCandidate {
  model: VehicleModel;
  validation: VehicleValidation;
  steps: SpeedBuildStep[];
}
export interface SpeedGenerationResult {
  inventory: SpeedInventory;
  candidates: VehicleCandidate[];
  warnings: string[];
}
export interface LocalRedesignResult {
  success: boolean;
  candidate: VehicleCandidate;
  changedModules: VehicleModuleId[];
  message: string;
  /** A failed modification returns the original candidate intact. */
  rolledBack: boolean;
}
