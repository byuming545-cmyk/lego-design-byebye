import { InventoryError, normalizeSetNumber } from '../inventory/provider.js';
import type { PartColor, PartInventoryItem, SetInventory } from '../types/index.js';
import { getSpeedPartDefinition } from './catalog.js';
import { discoverAvailableWheelAssemblies } from './wheelAssemblies.js';
import type { InventorySource, SpeedExtraPart, SpeedInventory, SpeedInventoryAnalysis, SpeedInventoryItem } from './types.js';

export const SPEED_DEMO_SET_NUMBER = 'DEMO-SPEED';
export const MAX_SPEED_SETS = 10;
const MAX_TOTAL_QUANTITY = 1_000_000;
const CUSTOM_SOURCE_ID = 'custom:extra-parts';
const CUSTOM_SET_NUMBER = 'CUSTOM-EXTRAS';

function invalid(message: string, code = 'INVALID_SPEED_INVENTORY'): never {
  throw new InventoryError(message, code, 400);
}

function normalizeSpeedSource(value: string): string {
  return value.trim().toUpperCase() === SPEED_DEMO_SET_NUMBER ? SPEED_DEMO_SET_NUMBER : normalizeSetNumber(value);
}

function exactKeys(value: unknown, keys: string[]): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

/** Validate request data without accepting client geometry or stock provenance. */
export function parseSpeedExtraParts(input: unknown): SpeedExtraPart[] {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > 100) invalid('额外零件须为最多 100 行的列表。', 'INVALID_SPEED_EXTRA_PARTS');
  return input.map((entry, index) => {
    if (!exactKeys(entry, ['partId', 'color', 'quantity']) ||
        typeof entry.partId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(entry.partId) ||
        !Number.isSafeInteger(entry.quantity) || Number(entry.quantity) < 1 || Number(entry.quantity) > 1000 ||
        !exactKeys(entry.color, ['id', 'name', 'hex']) ||
        !Number.isSafeInteger(entry.color.id) || Number(entry.color.id) < 0 ||
        typeof entry.color.name !== 'string' || entry.color.name.length > 100 || !entry.color.name.trim() || /[\u0000-\u001f\u007f]/.test(entry.color.name) ||
        typeof entry.color.hex !== 'string' || !/^#[A-Fa-f0-9]{6}$/.test(entry.color.hex)) {
      invalid(`第 ${index + 1} 行额外零件无效：仅允许 partId、color、quantity；编号最长 80 字符，数量 1–1000，颜色须含非负整数 ID、1–100 字名称及 #RRGGBB 色值。`, 'INVALID_SPEED_EXTRA_PARTS');
    }
    return {
      partId: entry.partId, quantity: Number(entry.quantity),
      color: { id: Number(entry.color.id), name: entry.color.name.trim(), hex: entry.color.hex.toUpperCase() },
    };
  });
}

/** Repeated set IDs mean one box, never implicit extra quantities. */
export function parseSpeedSetNumbers(input: string | string[]): string[] {
  const entries = typeof input === 'string' ? [input] : input;
  if (!Array.isArray(entries) || !entries.length || entries.length > 100 || entries.some(entry => typeof entry !== 'string' || entry.length > 500)) {
    return invalid('请输入 1–10 个套装编号，或使用独立演示编号 DEMO-SPEED。', 'INVALID_SPEED_SET_NUMBERS');
  }
  const result = new Set<string>();
  for (const entry of entries) {
    const tokens = entry.trim().split(/\s*(?:\+|,|，|;|；|\n)\s*/);
    if (tokens.some(token => !token.trim())) invalid('套装编号之间请使用 + 或逗号分隔，勿留空项。', 'INVALID_SPEED_SET_NUMBERS');
    for (const token of tokens) result.add(normalizeSpeedSource(token));
  }
  if (result.size > MAX_SPEED_SETS) invalid(`一次最多分析 ${MAX_SPEED_SETS} 个不同套装。`, 'TOO_MANY_SPEED_SETS');
  return [...result];
}

function checkRow(row: PartInventoryItem): void {
  if (!row || typeof row.partId !== 'string' || !row.partId.length || row.partId.length > 100 ||
      !Number.isSafeInteger(row.quantityAvailable) || row.quantityAvailable < 0 ||
      !row.color || !Number.isSafeInteger(row.color.id) || typeof row.color.name !== 'string' ||
      typeof row.color.hex !== 'string' || !/^#[a-fA-F0-9]{6}$/.test(row.color.hex)) {
    invalid('库存包含无效零件、颜色或数量；已停止分析，未使用部分库存。');
  }
}

function analyze(items: SpeedInventoryItem[]): SpeedInventoryAnalysis {
  const sum = (selected: SpeedInventoryItem[]) => selected.reduce((total, item) => total + item.quantityAvailable, 0);
  const supported = items.filter(item => item.supported);
  const totalQuantity = sum(items);
  const supportedQuantity = sum(supported);
  const partiallySupportedQuantity = sum(items.filter(item => item.support === 'partiallySupported'));
  const unsupportedQuantity = sum(items.filter(item => item.support === 'unsupported'));
  // A rate is 0..1, weighted by physical quantities rather than unique IDs.
  const supportRate = totalQuantity ? supportedQuantity / totalQuantity : 0;
  const missingRequirements: string[] = [];
  if (sum(supported.filter(item => item.category === 'Brick' || item.category === 'Plate')) < 12) missingRequirements.push('可用的基础承重砖 / 板不足 12 件。');
  if (sum(supported.filter(item => item.category === 'Plate')) < 4) missingRequirements.push('缺少至少 4 件已支持的基础 Plate 底盘零件。');
  if (supportRate < 0.15) missingRequirements.push('可直接用于生成的零件比例低于初步分析阈值 15%。');

  const families = new Map<string, { axle: string; tyre: string; wheels: number }>();
  for (const item of supported.filter(item => item.category === 'Wheel')) {
    const definition = getSpeedPartDefinition(item.partId)!;
    const socket = definition.connectionPoints.find(point => point.type === 'wheelSocket' && point.fitFamily);
    const rim = definition.connectionPoints.find(point => point.type === 'rim' && point.fitFamily);
    if (definition.shape?.kind !== 'wheel' || !socket?.fitFamily || !rim?.fitFamily) continue;
    const key = JSON.stringify([socket.fitFamily, rim.fitFamily]);
    const existing = families.get(key);
    if (existing) existing.wheels += item.quantityAvailable;
    else families.set(key, { axle: socket.fitFamily, tyre: rim.fitFamily, wheels: item.quantityAvailable });
  }
  const available = [...families.values()].map(family => {
    let tyres = 0, holderSockets = 0, directHolderPins = 0, pins = 0;
    for (const item of supported) {
      const definition = getSpeedPartDefinition(item.partId)!;
      const points = definition.connectionPoints;
      if (item.category === 'Tyre' && definition.shape?.kind === 'tyre' && points.some(point => point.type === 'tyre' && point.fitFamily === family.tyre)) tyres += item.quantityAvailable;
      const males = points.filter(point => point.type === 'wheelPin' && point.fitFamily === family.axle);
      if (item.category === 'WheelHolder') {
        holderSockets += points.filter(point => point.type === 'wheelSocket' && point.fitFamily === family.axle).length * item.quantityAvailable;
        directHolderPins += males.length * item.quantityAvailable;
      } else if (males.length >= 2) {
        // A separate two-ended pin joins ONE wheel to ONE holder; its two ports
        // must never be counted as two independent mounted wheels.
        pins += item.quantityAvailable;
      }
    }
    return { ...family, tyres, holderSockets, directHolderPins, pins, mounts: directHolderPins + Math.min(holderSockets, pins) };
  });
  const ready = available.some(family => family.wheels >= 4 && family.tyres >= 4 && family.mounts >= 4);
  if (ready && !discoverAvailableWheelAssemblies(items).some(assembly => assembly.available)) missingRequirements.push('接口库存数量齐全，但尚无已完成几何验证、可以生成的登记轮组。');
  const best = available.sort((a, b) =>
    (Math.min(b.wheels, b.tyres, b.mounts) - Math.min(a.wheels, a.tyres, a.mounts)) || b.wheels - a.wheels,
  )[0];
  if (!best) {
    const known = sum(items.filter(item => item.category === 'Wheel'));
    missingRequirements.push(known >= 4 ? `已识别 ${known} 个轮毂，但尚无 4 个完成精确轮轴接口建模的兼容轮毂。` : `缺少可用轮毂：需要 4 个，目前仅识别 ${known} 个。`);
    missingRequirements.push('尚无可验证的同系列轮毂 / 轮胎 / Wheel Holder / 轮轴连接件完整组合。');
  } else if (!ready) {
    if (best.wheels < 4) missingRequirements.push(`同一兼容系列的轮毂不足 4 个，当前 ${best.wheels} 个。`);
    if (best.tyres < 4) missingRequirements.push(`与轮毂配合的同系列轮胎不足 4 个，当前 ${best.tyres} 个。`);
    if (best.mounts < 4) {
      if (best.holderSockets + best.directHolderPins < 4) missingRequirements.push(`Wheel Holder 匹配连接点不足 4 个，当前 ${best.holderSockets + best.directHolderPins} 个。`);
      if (best.holderSockets > 0 && best.pins < 4 - best.directHolderPins) missingRequirements.push(`独立轮轴 Pin 不足：需要 ${4 - best.directHolderPins} 个，当前 ${best.pins} 个；每个 Pin 只能安装一个车轮。`);
    }
  }
  return {
    totalQuantity, supportedQuantity, partiallySupportedQuantity, unsupportedQuantity,
    usableQuantity: supportedQuantity, supportRate, missingRequirements,
    // Inventory readiness is only a prerequisite; generation must still run every validator.
    canGenerate: missingRequirements.length === 0,
  };
}

function analysisWarnings(analysis: SpeedInventoryAnalysis): string[] {
  const warnings: string[] = [];
  if (analysis.partiallySupportedQuantity) warnings.push(`${analysis.partiallySupportedQuantity} 件零件可识别但尚未完成精确几何 / 连接建模，不计入可生成数量。`);
  if (analysis.unsupportedQuantity) warnings.push(`${analysis.unsupportedQuantity} 件未知零件保留在完整库存中，不会使用占位尺寸参与生成。`);
  return warnings;
}

/**
 * Loose stock is explicitly self-reported, never relabeled as official set stock.
 * This is additive; repeat rows contribute to the same custom-source quantity trace.
 */
export function addSpeedExtraParts(base: SpeedInventory, extras: SpeedExtraPart[]): SpeedInventory {
  const validated = parseSpeedExtraParts(extras);
  const result = structuredClone(base);
  if (!validated.length) return result;

  const warnings = new Set(result.warnings.filter(warning =>
    !/^\d+ 件(?:零件可识别但尚未完成精确几何 \/ 连接建模|未知零件保留在完整库存中)/.test(warning),
  ));
  const merged = new Map<string, SpeedInventoryItem>();
  let totalQuantity = 0;
  for (const item of result.items) {
    if (!Number.isSafeInteger(item.quantityAvailable) || item.quantityAvailable < 0) invalid('基础库存数量无效，未添加额外零件。');
    totalQuantity += item.quantityAvailable;
    const definition = getSpeedPartDefinition(item.partId);
    item.support = definition?.support ?? 'unsupported';
    item.supported = item.support === 'supported' && Boolean(definition?.dimensions && definition?.shape);
    item.category = definition?.category ?? 'Other';
    item.dimensions = definition?.dimensions ? { ...definition.dimensions } : null;
    merged.set(`${item.partId}:${item.color.id}`, item);
  }
  for (const extra of validated) {
    totalQuantity += extra.quantity;
    if (!Number.isSafeInteger(totalQuantity) || totalQuantity > MAX_TOTAL_QUANTITY) invalid('套装及自报散件合并后超过 1,000,000 件安全上限。', 'SPEED_INVENTORY_LIMIT');
    const key = `${extra.partId}:${extra.color.id}`;
    let item = merged.get(key);
    if (!item) {
      const definition = getSpeedPartDefinition(extra.partId);
      const support = definition?.support ?? 'unsupported';
      item = {
        partId: extra.partId, name: definition?.name ?? extra.partId, category: definition?.category ?? 'Other',
        color: { ...extra.color }, quantityAvailable: 0, quantityUsed: 0, support,
        supported: support === 'supported' && Boolean(definition?.dimensions && definition?.shape),
        dimensions: definition?.dimensions ? { ...definition.dimensions } : null, sources: [],
      };
      merged.set(key, item);
    } else if (item.color.hex.toUpperCase() !== extra.color.hex) {
      warnings.add(`颜色 ID ${extra.color.id} 的来源色值不一致，采用第一个来源的显示色；库存仍按颜色 ID 合并。`);
    }
    item.quantityAvailable += extra.quantity;
    const trace = item.sources.find(source => source.sourceId === CUSTOM_SOURCE_ID);
    if (trace) trace.quantity += extra.quantity;
    else item.sources.push({ sourceId: CUSTOM_SOURCE_ID, setNumber: CUSTOM_SET_NUMBER, quantity: extra.quantity });
  }
  result.items = [...merged.values()];
  result.inventorySources = result.inventorySources.filter(source => source.sourceId !== CUSTOM_SOURCE_ID);
  result.inventorySources.push({ sourceId: CUSTOM_SOURCE_ID, setNumber: CUSTOM_SET_NUMBER, name: '用户自报散件', source: 'custom', quantity: 1 });
  result.source = 'mixed';
  const origins: string[] = [];
  if (result.inventorySources.some(source => source.source === 'mock')) origins.push('DEMO-SPEED 合成演示');
  if (result.inventorySources.some(source => source.source === 'rebrickable')) origins.push('Rebrickable 真实套装来源');
  result.sourceLabel = `${origins.length ? origins.join(' + ') : base.sourceLabel} + 用户自报散件（未核验）`;
  result.analysis = analyze(result.items);
  warnings.add('用户自报散件的数量及颜色由用户提供，未经平台或官方库存核验。');
  analysisWarnings(result.analysis).forEach(warning => warnings.add(warning));
  result.warnings = [...warnings];
  return result;
}

/**
 * Classify by our own part-ID catalog, ignoring V0.1 supported flags and placeholder
 * geometry. Each distinct normalized set contributes exactly one box. Additional
 * copies require an explicit future quantity contract, never repeated inputs.
 */
export function analyzeSpeedInventories(inventories: SetInventory[]): SpeedInventory {
  if (!Array.isArray(inventories) || !inventories.length || inventories.length > 100) invalid('请先读取至少一个完整套装库存。');
  const sources: InventorySource[] = [];
  const seen = new Set<string>();
  const warnings = new Set<string>();
  const merged = new Map<string, SpeedInventoryItem>();
  let totalQuantity = 0;
  for (const inventory of inventories) {
    if (!inventory || typeof inventory.setNumber !== 'string' || !Array.isArray(inventory.items) || !['mock', 'rebrickable'].includes(inventory.source)) invalid('库存来源无效。');
    const setNumber = normalizeSpeedSource(inventory.setNumber);
    if ((inventory.source === 'mock') !== (setNumber === SPEED_DEMO_SET_NUMBER)) {
      invalid('Speed 演示库存只能使用独立编号 DEMO-SPEED；真实套装必须读取真实库存。', 'SYNTHETIC_SET_MISMATCH');
    }
    if (seen.has(setNumber)) {
      warnings.add(`重复的 ${setNumber} 已按 1 盒计算，未重复增加数量。`);
      continue;
    }
    seen.add(setNumber);
    if (seen.size > MAX_SPEED_SETS) invalid(`一次最多分析 ${MAX_SPEED_SETS} 个不同套装。`, 'TOO_MANY_SPEED_SETS');
    const sourceId = `set:${setNumber}`;
    sources.push({ sourceId, setNumber, name: inventory.name, source: inventory.source, quantity: 1,
      ...(inventory.snapshotId ? { snapshotId: inventory.snapshotId, fetchedAt: inventory.fetchedAt, sparePolicy: inventory.sparePolicy } : {}),
      ...(inventory.themeId !== undefined ? { themeId: inventory.themeId } : {}),
    });
    for (const warning of inventory.warnings ?? []) {
      // Those warnings concern the older 11-ID catalog and are stale after reclassification.
      if (!/V0\.1.*(?:目录|不参与生成)|未收录到 V0\.1/.test(warning)) warnings.add(`${setNumber}：${warning}`);
    }
    for (const row of inventory.items) {
      checkRow(row);
      if (!row.quantityAvailable) continue;
      totalQuantity += row.quantityAvailable;
      if (!Number.isSafeInteger(totalQuantity) || totalQuantity > MAX_TOTAL_QUANTITY) invalid('合并库存数量超出安全分析上限。');
      const definition = getSpeedPartDefinition(row.partId);
      const support = definition?.support ?? 'unsupported';
      const supported = support === 'supported' && definition?.dimensions !== null && definition?.shape !== null;
      const key = `${row.partId}:${row.color.id}`;
      let item = merged.get(key);
      if (!item) {
        item = {
          partId: row.partId, name: definition?.name ?? row.name,
          category: definition?.category ?? 'Other', color: { ...row.color, hex: row.color.hex.toUpperCase() },
          quantityAvailable: 0, quantityUsed: 0, support, supported,
          dimensions: definition?.dimensions ? { ...definition.dimensions } : null, sources: [],
        };
        merged.set(key, item);
      } else if (item.color.hex !== row.color.hex.toUpperCase()) {
        warnings.add(`颜色 ID ${row.color.id} 的来源色值不一致，采用第一个来源的显示色；库存仍按颜色 ID 合并。`);
      }
      item.quantityAvailable += row.quantityAvailable;
      const trace = item.sources.find(source => source.sourceId === sourceId);
      if (trace) trace.quantity += row.quantityAvailable;
      else item.sources.push({ sourceId, setNumber, quantity: row.quantityAvailable });
    }
  }
  const items = [...merged.values()];
  const analysis = analyze(items);
  analysisWarnings(analysis).forEach(warning => warnings.add(warning));
  const source = sources.every(item => item.source === 'mock') ? 'mock' : sources.every(item => item.source === 'rebrickable') ? 'rebrickable' : 'mixed';
  return {
    setNumber: sources.map(item => item.setNumber).join(' + '),
    name: sources.length === 1 ? sources[0].name : `${sources.length} 套合并库存`,
    source, sourceLabel: source === 'mock' ? 'DEMO-SPEED · 人工合成演示，非真实套装库存' : source === 'rebrickable' ? 'Rebrickable · 完整套装库存，按 Speed 目录独立分类' : '混合来源 · 包含独立合成演示库存',
    inventorySources: sources, items, analysis, warnings: [...warnings],
  };
}

/** A standalone synthetic pool: never assign this inventory to an official set ID. */
export function createSpeedDemoInventory(): SetInventory {
  const black: PartColor = { id: 0, name: '黑色', hex: '#171717' };
  const red: PartColor = { id: 4, name: '红色', hex: '#C91A09' };
  const clear: PartColor = { id: 40, name: '透明', hex: '#E5F3F5' };
  const rows: Array<[string, number, PartColor]> = [
    ['3020', 12, black], ['3795', 8, black], ['3034', 6, black], ['3710', 10, black],
    ['3023', 12, black], ['3024', 10, black], ['3004', 8, black], ['3005', 8, black],
    ['3069b', 12, red], ['2431', 8, red], ['87079', 6, red], ['63864', 8, red],
    ['11477', 8, red], ['15068', 8, red], ['50950', 4, red], ['29119', 2, red], ['29120', 2, red],
    ['99780', 4, black], ['99781', 4, black], ['15573', 4, black], ['2412b', 4, black],
    ['4624', 4, black], ['3641', 4, black], ['4600', 4, black],
    ['18975', 2, black], ['3673', 4, black], ['66727', 4, black], ['18977', 4, black],
    ['65633', 1, clear], ['98138', 4, clear],
  ];
  const items = rows.map(([partId, quantityAvailable, color]): PartInventoryItem => {
    const definition = getSpeedPartDefinition(partId)!;
    // The reused V0.1 transport requires dimensions. For partial entries this is
    // explicitly a transport placeholder; analyzeSpeedInventories replaces it with null.
    return {
      partId, name: definition.name, category: ['Brick', 'Plate', 'Tile'].includes(definition.category) ? definition.category as PartInventoryItem['category'] : 'Unsupported',
      color: { ...color }, quantityAvailable, quantityUsed: 0,
      supported: definition.support === 'supported', dimensions: definition.dimensions ? { ...definition.dimensions } : { x: 1, y: 1, z: 1 },
    };
  });
  return {
    setNumber: SPEED_DEMO_SET_NUMBER, name: 'Speed Creative 独立合成演示零件池', source: 'mock',
    sourceLabel: 'DEMO-SPEED · 人工合成演示，非任何官方套装', items,
    warnings: [
      '此零件池为人工合成演示，不对应任何官方 Speed Champions 套装或真实套装库存。',
      '尚未建模的汽车零件只用于分类展示；原始传输占位尺寸不是实际几何，Speed 分析中一律置空。',
      '轮架 / 轮毂 / 轮胎的可安装性与车辆安全性仍须由后续连接及轮组校验验证。',
    ],
  };
}
