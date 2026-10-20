import { getSpeedPartDefinition, MODERN_SPEED_AXLE_FAMILY, MODERN_SPEED_TYRE_FAMILY, SPEED_LDRAW_REVISION } from './catalog.js';
import type { SpeedConnection, SpeedInventoryItem, SpeedOrientation, SpeedPlacedPart, SpeedVector } from './types.js';

export type WheelAssemblyRole = 'holder' | 'axle' | 'wheel' | 'tyre';
export interface WheelAssemblyRequirement { partId: string; quantity: number; role: WheelAssemblyRole }
export interface WheelAssemblyInterface {
  partA: string;
  partB: string;
  connectionType: SpeedConnection['connectionType'];
  allowsRotation: boolean;
  /** Only this source-calibrated interface is eligible for a nesting exception. */
  verifiedNesting: boolean;
}
export interface WheelAssemblyPose {
  role: WheelAssemblyRole;
  partId: string;
  /** Relative to vehicle centerline x and axle y; z is measured from ground. */
  offset: SpeedVector;
  orientation: SpeedOrientation;
}
interface WheelAssemblyBase {
  id: string;
  name: string;
  wheelPart: string;
  tyrePart: string;
  holderPart: string;
  axlePart: string | null;
  compatibleTyres: readonly string[];
  compatibleWheels: readonly string[];
  requiredQuantities: readonly WheelAssemblyRequirement[];
  sourceRevision: string;
  notes: readonly string[];
}
export interface GeneratableWheelAssemblyDefinition extends WheelAssemblyBase {
  status: 'generatable';
  rotationAxis: 'x';
  wheelRadius: number;
  wheelWidth: number;
  /** LDU envelope clearance; zero rejects material overlap without inventing a safety margin. */
  minimumClearanceLdu: number;
  supportedVehicleWidths: readonly number[];
  mountingConnection: { axleFamily: string; tyreFamily: string };
  interfaces: readonly WheelAssemblyInterface[];
  supportedOrientations: { left: SpeedOrientation; right: SpeedOrientation };
  poses: { holder: WheelAssemblyPose; left: readonly WheelAssemblyPose[]; right: readonly WheelAssemblyPose[] };
  /** The parts permitted in a rotating bearing subassembly, per individual wheel. */
  rotatingParts: readonly { partId: string; quantity: number }[];
  chassisMount: {
    width: number;
    basePlateZ: number;
    /** Recess filler volumes; heights supported by the existing plate/brick packer. */
    supports: readonly { x: number; y: number; z: number; width: number; depth: number; height: 1 | 3 }[];
  };
  track: number;
}
export interface RecognizedWheelAssemblyDefinition extends WheelAssemblyBase {
  status: 'recognizedOnly';
  /** No dimensions, placement or fit claim until all constituent geometry is calibrated. */
  reason: string;
}
export type WheelAssemblyDefinition = GeneratableWheelAssemblyDefinition | RecognizedWheelAssemblyDefinition;

const upright: SpeedOrientation = { x: 0, y: 0, z: 0 };
const outwardLeft: SpeedOrientation = { x: 0, y: 0, z: 180 };
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

/** Compatibility evidence is explicit. An identified combination is not automatically generatable. */
export const WHEEL_ASSEMBLY_REGISTRY: readonly WheelAssemblyDefinition[] = freeze([
  {
    id: 'speed-modern-18975-3673-66727-18977', name: '现代 Speed / Technic Pin 轮组', status: 'generatable',
    wheelPart: '66727', tyrePart: '18977', holderPart: '18975', axlePart: '3673',
    compatibleTyres: ['18977'], compatibleWheels: ['66727'],
    requiredQuantities: [
      { partId: '18975', quantity: 2, role: 'holder' }, { partId: '3673', quantity: 4, role: 'axle' },
      { partId: '66727', quantity: 4, role: 'wheel' }, { partId: '18977', quantity: 4, role: 'tyre' },
    ],
    rotationAxis: 'x', wheelRadius: 1.5, wheelWidth: 1.4, minimumClearanceLdu: 0,
    supportedVehicleWidths: [8], track: 5.6,
    mountingConnection: { axleFamily: MODERN_SPEED_AXLE_FAMILY, tyreFamily: MODERN_SPEED_TYRE_FAMILY },
    interfaces: [
      { partA: '18975', partB: '3673', connectionType: 'wheel-axle', allowsRotation: true, verifiedNesting: true },
      { partA: '3673', partB: '66727', connectionType: 'wheel-axle', allowsRotation: true, verifiedNesting: true },
      { partA: '66727', partB: '18977', connectionType: 'tyre-fit', allowsRotation: false, verifiedNesting: true },
    ],
    supportedOrientations: { left: outwardLeft, right: upright },
    poses: {
      holder: { partId: '18975', role: 'holder', offset: { x: -2, y: -1, z: 1 }, orientation: upright },
      left: [
        { partId: '3673', role: 'axle', offset: { x: -2, y: 0, z: 3.75 }, orientation: upright },
        { partId: '66727', role: 'wheel', offset: { x: -2.5, y: 0, z: 3.75 }, orientation: outwardLeft },
        { partId: '18977', role: 'tyre', offset: { x: -2.8, y: 0, z: 3.75 }, orientation: outwardLeft },
      ],
      right: [
        { partId: '3673', role: 'axle', offset: { x: 2, y: 0, z: 3.75 }, orientation: upright },
        { partId: '66727', role: 'wheel', offset: { x: 2.5, y: 0, z: 3.75 }, orientation: upright },
        { partId: '18977', role: 'tyre', offset: { x: 2.8, y: 0, z: 3.75 }, orientation: upright },
      ],
    },
    rotatingParts: [{ partId: '3673', quantity: 1 }, { partId: '66727', quantity: 1 }, { partId: '18977', quantity: 1 }],
    chassisMount: { width: 4, basePlateZ: 5, supports: [{ x: -1, y: -1, z: 2, width: 2, depth: 2, height: 3 }] },
    sourceRevision: SPEED_LDRAW_REVISION,
    notes: ['沿用既有固定版本 LDraw 校准几何；未新增零件或扩大已验证兼容列表。', '轮胎为轴对称圆环旋转包络；不模拟轮胎形变、制造公差、载荷或真实摩擦，实物验证仍待用户反馈。'],
  },
  {
    id: 'classic-4600-4624-3641', name: '经典轮轴组合（仅识别）', status: 'recognizedOnly',
    wheelPart: '4624', tyrePart: '3641', holderPart: '4600', axlePart: null,
    compatibleTyres: ['3641'], compatibleWheels: ['4624'],
    requiredQuantities: [{ partId: '4600', quantity: 2, role: 'holder' }, { partId: '4624', quantity: 4, role: 'wheel' }, { partId: '3641', quantity: 4, role: 'tyre' }],
    sourceRevision: SPEED_LDRAW_REVISION,
    reason: '已识别 LDraw car.ldr / 4624c01 装配关系；精确轮轴接口、姿态和碰撞几何未校准，不参与自动选择。',
    notes: ['不能将经典细轮轴与现代 Technic Pin 圆孔互换；当前可生成轮组数量仍为 1。'],
  },
]);

export const generatableWheelAssemblies = (): GeneratableWheelAssemblyDefinition[] => WHEEL_ASSEMBLY_REGISTRY.filter((entry): entry is GeneratableWheelAssemblyDefinition => entry.status === 'generatable');

export interface WheelAssemblyAvailability {
  definition: WheelAssemblyDefinition;
  /** Complete vehicles supported by this combination; recognizedOnly always stays zero. */
  completeVehicles: number;
  available: boolean;
  missing: { partId: string; required: number; available: number }[];
}

export function discoverAvailableWheelAssemblies(items: readonly SpeedInventoryItem[]): WheelAssemblyAvailability[] {
  const quantities = new Map<string, number>();
  for (const row of items) {
    const part = getSpeedPartDefinition(row.partId);
    if (!Number.isSafeInteger(row.quantityAvailable) || row.quantityAvailable <= 0 || !row.supported || row.support !== 'supported' || part?.support !== 'supported' || !part.dimensions || !part.shape) continue;
    quantities.set(row.partId, (quantities.get(row.partId) ?? 0) + row.quantityAvailable);
  }
  return WHEEL_ASSEMBLY_REGISTRY.map(definition => {
    const missing = definition.requiredQuantities.filter(row => (quantities.get(row.partId) ?? 0) < row.quantity).map(row => ({ partId: row.partId, required: row.quantity, available: quantities.get(row.partId) ?? 0 }));
    const completeVehicles = definition.status === 'generatable' ? Math.min(...definition.requiredQuantities.map(row => Math.floor((quantities.get(row.partId) ?? 0) / row.quantity))) : 0;
    return { definition, completeVehicles, available: completeVehicles > 0, missing };
  });
}

/** Selection never infers compatibility from category names or unverified catalog metadata. */
export function selectWheelAssembly(items: readonly SpeedInventoryItem[], vehicleWidth = 8): GeneratableWheelAssemblyDefinition | undefined {
  return discoverAvailableWheelAssemblies(items).find((entry): entry is WheelAssemblyAvailability & { definition: GeneratableWheelAssemblyDefinition } => entry.available && entry.definition.status === 'generatable' && entry.definition.supportedVehicleWidths.includes(vehicleWidth))?.definition;
}

export function wheelAssemblyForWheel(partId: string): GeneratableWheelAssemblyDefinition | undefined {
  return generatableWheelAssemblies().find(entry => entry.wheelPart === partId && entry.compatibleWheels.includes(partId));
}

export function wheelAssemblyInterface(partA: string, partB: string): WheelAssemblyInterface | undefined {
  return generatableWheelAssemblies().flatMap(entry => [...entry.interfaces]).find(entry => entry.partA === partA && entry.partB === partB || entry.partA === partB && entry.partB === partA);
}

export function wheelBearingAssembly(parts: readonly SpeedPlacedPart[], assemblyId?: string): GeneratableWheelAssemblyDefinition | undefined {
  return generatableWheelAssemblies().find(entry => (!assemblyId || entry.id === assemblyId) && entry.rotatingParts.reduce((count, row) => count + row.quantity, 0) === parts.length && entry.rotatingParts.every(row => parts.filter(part => part.partId === row.partId).length === row.quantity));
}
