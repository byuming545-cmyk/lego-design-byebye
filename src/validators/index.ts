import type { LegoModel, PlacedPart, SetInventory, ValidationResult } from '../types/index.js';
import { getPartDefinition } from '../lego/catalog.js';
import { connectedComponents, connectionMap, modelDimensions, overlaps, supports } from '../lego/geometry.js';

const result = (errors: string[], warnings: string[] = []): ValidationResult => ({ valid: errors.length === 0, errors, warnings });
const keyOf = (partId: string, colorId: number) => `${partId}:${colorId}`;
const sameDimensions = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => a.x === b.x && a.y === b.y && a.z === b.z;

export class InventoryValidator {
  validate(model: LegoModel, inventory: SetInventory): ValidationResult {
    const errors: string[] = [];
    const available = new Map<string, number>();
    for (const item of inventory.items) {
      if (!Number.isInteger(item.quantityAvailable) || item.quantityAvailable < 0) {
        errors.push(`库存 ${item.partId} / ${item.color.name} 数量无效。`);
        continue;
      }
      if (item.supported && getPartDefinition(item.partId)) {
        const key = keyOf(item.partId, item.color.id);
        available.set(key, (available.get(key) ?? 0) + item.quantityAvailable);
      }
    }
    const used = new Map<string, number>();
    for (const part of model.parts) {
      const definition = getPartDefinition(part.partId);
      const key = keyOf(part.partId, part.color.id);
      used.set(key, (used.get(key) ?? 0) + 1);
      if (!definition) errors.push(`零件 ${part.partId} 不在 V0.1 支持目录中。`);
      if (!available.has(key)) errors.push(`${part.instanceId} 使用了库存中不存在或不支持的零件/颜色 ${key}。`);
      const original = inventory.items.find(item => item.supported && item.partId === part.partId && item.color.id === part.color.id);
      if (original && original.color.hex.toLowerCase() !== part.color.hex.toLowerCase()) errors.push(`${part.instanceId} 的显示颜色与库存颜色不一致。`);
      if (definition && (!sameDimensions(part.dimensions, definition.dimensions) || part.category !== definition.category)) errors.push(`${part.instanceId} 的零件尺寸或类别与目录不一致。`);
    }
    for (const [key, count] of used) {
      if (count > (available.get(key) ?? 0)) errors.push(`库存不足：${key} 使用 ${count} 件，可用 ${available.get(key) ?? 0} 件。`);
    }
    const reported = new Map<string, number>();
    for (const usage of model.inventoryUsage) {
      const key = keyOf(usage.partId, usage.colorId);
      if (reported.has(key)) errors.push(`用量清单重复记录 ${key}。`);
      reported.set(key, usage.quantityUsed);
      if (usage.quantityAvailable !== (available.get(key) ?? 0)) errors.push(`用量清单 ${key} 的可用数量不准确。`);
      if (!Number.isInteger(usage.quantityUsed) || usage.quantityUsed <= 0) errors.push(`用量清单 ${key} 的使用数量无效。`);
    }
    for (const key of new Set([...used.keys(), ...reported.keys()])) {
      if ((reported.get(key) ?? 0) !== (used.get(key) ?? 0)) errors.push(`用量清单 ${key} 与模型中的实际数量不一致。`);
    }
    return result(errors);
  }
}

export class CollisionValidator {
  validate(model: LegoModel): ValidationResult {
    const errors: string[] = [];
    for (const part of model.parts) {
      if (![part.position.x, part.position.y, part.position.z].every(Number.isInteger) || part.position.z < 0) errors.push(`${part.instanceId} 的坐标必须为整数且高度不得为负。`);
      if (![0, 90, 180, 270].includes(part.rotation)) errors.push(`${part.instanceId} 的旋转角度必须为 0、90、180 或 270 度。`);
      if (![part.dimensions.x, part.dimensions.y, part.dimensions.z].every(n => Number.isInteger(n) && n > 0)) errors.push(`${part.instanceId} 的尺寸无效。`);
    }
    for (let i = 0; i < model.parts.length; i++) {
      for (let j = i + 1; j < model.parts.length; j++) {
        if (overlaps(model.parts[i], model.parts[j])) errors.push(`零件碰撞：${model.parts[i].instanceId} 与 ${model.parts[j].instanceId} 占用了相同空间。`);
      }
    }
    return result(errors);
  }
}

export class ConnectionValidator {
  validate(model: LegoModel): ValidationResult {
    const errors: string[] = [];
    const actual = connectionMap(model.parts);
    const anchored = new Set(model.parts.filter(part => part.position.z === 0).map(part => part.instanceId));
    const queue = [...anchored];
    while (queue.length) {
      const id = queue.shift()!;
      for (const next of actual.get(id) ?? []) {
        if (!anchored.has(next)) { anchored.add(next); queue.push(next); }
      }
    }
    for (const part of model.parts) {
      if (part.position.z > 0 && !model.parts.some(lower => lower.instanceId !== part.instanceId && supports(lower, part))) errors.push(`${part.instanceId} 悬空，或下方零件没有可连接的顶面凸点。`);
      if (!anchored.has(part.instanceId)) errors.push(`${part.instanceId} 所在连接组件没有接触地面。`);
      const declared = [...new Set(part.connections)].sort();
      if (part.connections.length !== declared.length || JSON.stringify(declared) !== JSON.stringify(actual.get(part.instanceId) ?? [])) errors.push(`${part.instanceId} 的连接清单与实际凸点连接不一致。`);
    }
    if (connectedComponents(model.parts).length > 1) errors.push('模型包含互不连接的组件；最终模型必须通过真实凸点连接为一个整体。');
    return result(errors);
  }
}

export class ModelValidator {
  validate(model: LegoModel, inventory: SetInventory): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!model.parts.length) errors.push('模型没有零件。');
    const ids = new Set<string>();
    for (const part of model.parts) {
      if (!part.instanceId || ids.has(part.instanceId)) errors.push(`零件实例 ID 为空或重复：${part.instanceId}。`);
      ids.add(part.instanceId);
      if (!Number.isInteger(part.buildStep) || part.buildStep < 1) errors.push(`${part.instanceId} 缺少有效搭建步骤。`);
    }
    for (const validator of [new InventoryValidator(), new CollisionValidator(), new ConnectionValidator()]) {
      const checked = validator.validate(model, inventory);
      errors.push(...checked.errors); warnings.push(...checked.warnings);
    }
    if (!sameDimensions(model.dimensions, modelDimensions(model))) errors.push('模型外廓尺寸与实际零件范围不一致。');
    // Every published prefix must itself be buildable. Top-down ordering may pass
    // the final connection check, but is still an invalid set of instructions.
    const built: PlacedPart[] = [];
    for (const step of [...new Set(model.parts.map(part => part.buildStep))].sort((a, b) => a - b)) {
      const pending = model.parts.filter(part => part.buildStep === step);
      while (pending.length) {
        const index = pending.findIndex(part => part.position.z === 0 || built.some(lower => supports(lower, part)));
        if (index < 0) { errors.push(`第 ${step} 步无法在此前已搭建的零件上连接。`); break; }
        built.push(...pending.splice(index, 1));
      }
    }
    if (model.parts.some(part => part.category === 'Slope')) warnings.push('斜坡零件采用保守外接盒碰撞检测；V0.1 不允许在其斜面上承重。');
    return result([...new Set(errors)], [...new Set(warnings)]);
  }
}

export const validateModel = (model: LegoModel, inventory: SetInventory): ValidationResult => new ModelValidator().validate(model, inventory);
