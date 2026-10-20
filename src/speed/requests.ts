import { InventoryError } from '../inventory/index.js';
import type { VehicleDesignOptions, VehicleModuleId } from './types.js';

export const SPEED_MODULE_IDS: VehicleModuleId[] = ['chassis', 'front', 'rear', 'cockpit', 'roof', 'leftWheelModule', 'rightWheelModule', 'bodyShell', 'aero', 'details'];
export function requestObject(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) {
    throw new InventoryError('请求包含无效或未允许的字段。', 'INVALID_SPEED_REQUEST', 400);
  }
  return value as Record<string, unknown>;
}

export function parseVehicleOptions(value: unknown): VehicleDesignOptions {
  const input = requestObject(value, ['prompt', 'vehicleType', 'style', 'minifigure', 'priority', 'maximizeUsage']);
  if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 500 ||
      !['supercar', 'sports-car', 'gt', 'concept'].includes(input.vehicleType as string) ||
      !['modern', 'futuristic', 'retro', 'aggressive', 'minimal'].includes(input.style as string) ||
      typeof input.minifigure !== 'boolean' || typeof input.maximizeUsage !== 'boolean' ||
      !['structure', 'appearance', 'color'].includes(input.priority as string)) {
    throw new InventoryError('请填写 1–500 字创意，并选择有效的车型、风格、人仔空间和偏好选项。', 'INVALID_VEHICLE_OPTIONS', 400);
  }
  return { prompt: input.prompt.trim(), vehicleType: input.vehicleType as VehicleDesignOptions['vehicleType'], style: input.style as VehicleDesignOptions['style'], minifigure: input.minifigure, maximizeUsage: input.maximizeUsage, priority: input.priority as VehicleDesignOptions['priority'] };
}

export function candidateId(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 120) throw new InventoryError('请选择有效的候选方案。', 'INVALID_CANDIDATE_ID', 400);
  return value;
}
