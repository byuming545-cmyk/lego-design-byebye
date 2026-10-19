import type { GenerationOptions, InventoryUsage, LegoModel, ModelSize, PartInventoryItem, PlacedPart, Rotation, SetInventory } from '../types/index.js';
import { getPartDefinition } from '../lego/catalog.js';
import { bounds, connectedComponents, footprint, modelDimensions, overlaps, supports } from '../lego/geometry.js';
import { createBuildSteps } from '../instructions/steps.js';
import { validateModel } from '../validators/index.js';
import { blueprint, resolveTemplate, TEMPLATE_NAMES, type TemplateLayer } from './templates.js';
import { GenerationError } from './errors.js';
export { GenerationError } from './errors.js';

interface Stock { item: PartInventoryItem; remaining: number; initial: number }
interface PackedLayer { parts: PlacedPart[]; height: number }
const keyOf = (partId: string, colorId: number) => `${partId}:${colorId}`;
const sizeName: Record<ModelSize, string> = { small: '小型', balanced: '均衡', large: '大型' };

function collectStock(inventory: SetInventory): Stock[] {
  const stock = new Map<string, Stock>();
  for (const item of inventory.items) {
    if (!Number.isInteger(item.quantityAvailable) || item.quantityAvailable < 0) throw new GenerationError(`库存 ${item.partId} 的数量无效，无法生成。`, 'INVALID_INVENTORY');
    if (!item.supported || !getPartDefinition(item.partId) || !item.quantityAvailable) continue;
    const key = keyOf(item.partId, item.color.id);
    const old = stock.get(key);
    if (old) { old.remaining += item.quantityAvailable; old.initial += item.quantityAvailable; }
    else stock.set(key, { item, remaining: item.quantityAvailable, initial: item.quantityAvailable });
  }
  return [...stock.values()];
}

function makePart(stock: Stock, x: number, y: number, z: number, rotation: Rotation): PlacedPart {
  const definition = getPartDefinition(stock.item.partId)!;
  return {
    instanceId: '', partId: definition.partId, name: definition.name,
    category: definition.category, color: { ...stock.item.color }, dimensions: { ...definition.dimensions },
    position: { x, y, z }, rotation, connections: [], buildStep: 1,
  };
}

/** Exact rectangular packing, with inventory and physical support checked at placement time. */
function packLayer(layer: TemplateLayer, z: number, height: number, stock: Stock[], lowerParts: PlacedPart[], preferredColor: number, allowSubstitution: boolean): PlacedPart[] | undefined {
  const cells = new Set(layer.cells);
  const placements: PlacedPart[] = [];
  let visited = 0;
  const lowerComponents = connectedComponents(lowerParts);
  const componentOf = new Map(lowerComponents.flatMap((group, index) => group.map(part => [part, index] as const)));
  const candidates = stock.filter(s => s.remaining > 0 && getPartDefinition(s.item.partId)?.dimensions.z === height && ['Brick', 'Plate'].includes(getPartDefinition(s.item.partId)!.category) && (allowSubstitution || s.item.color.id === preferredColor));
  const ordered = [...candidates].sort((a, b) => {
    const ad = getPartDefinition(a.item.partId)!.dimensions, bd = getPartDefinition(b.item.partId)!.dimensions;
    return bd.x * bd.y - ad.x * ad.y || Number(b.item.color.id === preferredColor) - Number(a.item.color.id === preferredColor) || b.remaining - a.remaining || a.item.color.id - b.item.color.id || a.item.partId.localeCompare(b.item.partId);
  });
  const failed = new Set<string>();
  const visit = (): boolean => {
    if (!cells.size) return true;
    if (++visited > 25000) return false;
    const state = `${[...cells].sort().join(';')}|${ordered.map(s => s.remaining).join(',')}`;
    if (failed.has(state)) return false;
    const [x, y] = [...cells].map(cell => cell.split(',').map(Number)).sort((a, b) => a[1] - b[1] || a[0] - b[0])[0];
    // Prefer a brick that crosses an existing seam. A layer of perfectly aligned
    // tiles can be fully supported yet leave a model as several loose assemblies.
    const roots = lowerComponents.map((_, index) => index);
    const root = (id: number): number => roots[id] === id ? id : (roots[id] = root(roots[id]));
    for (const placed of placements) {
      const connected = lowerParts.filter(lower => supports(lower, placed)).map(lower => root(componentOf.get(lower)!));
      for (const id of connected.slice(1)) roots[root(id)] = root(connected[0]);
    }
    const options: Array<{ entry: Stock; placed: PlacedPart; occupied: string[]; joins: number; contacts: number; area: number }> = [];
    for (const entry of ordered) {
      if (!entry.remaining) continue;
      const dims = getPartDefinition(entry.item.partId)!.dimensions;
      const rotations: Rotation[] = dims.x === dims.y ? [0] : [90, 0];
      for (const rotation of rotations) {
        const placed = makePart(entry, x, y, z, rotation);
        const size = footprint(placed);
        const occupied: string[] = [];
        for (let dy = 0; dy < size.y; dy++) for (let dx = 0; dx < size.x; dx++) occupied.push(`${x + dx},${y + dy}`);
        if (!occupied.every(cell => cells.has(cell))) continue;
        const contacts = lowerParts.filter(lower => supports(lower, placed));
        if (z > 0 && !contacts.length) continue;
        options.push({ entry, placed, occupied, joins: new Set(contacts.map(lower => root(componentOf.get(lower)!))).size, contacts: contacts.length, area: occupied.length });
      }
    }
    options.sort((a, b) => b.joins - a.joins || b.area - a.area || b.contacts - a.contacts);
    for (const { entry, placed, occupied } of options) {
      occupied.forEach(cell => cells.delete(cell));
      entry.remaining--; placements.push(placed);
      if (visit()) return true;
      placements.pop(); entry.remaining++;
      occupied.forEach(cell => cells.add(cell));
    }
    failed.add(state);
    return false;
  };
  return visit() ? placements : undefined;
}

function buildTemplate(layers: TemplateLayer[], originalStock: Stock[], primary: number, accent: number, allowSubstitution: boolean, adaptPlates: boolean): { parts: PlacedPart[]; stock: Stock[]; plateLayers: number } | undefined {
  const stock = originalStock.map(s => ({ ...s }));
  const parts: PlacedPart[] = [];
  let z = 0, plateLayers = 0;
  for (const layer of layers) {
    const preferred = layer.role === 'body' ? primary : accent;
    let packed: PackedLayer | undefined;
    for (const height of adaptPlates ? [3, 1] : [3]) {
      const layerParts = packLayer(layer, z, height, stock, parts, preferred, allowSubstitution);
      if (layerParts) { packed = { parts: layerParts, height }; break; }
    }
    if (!packed) return undefined;
    parts.push(...packed.parts);
    z += packed.height;
    if (packed.height === 1) plateLayers++;
  }
  if (connectedComponents(parts).length !== 1) return undefined;
  return { parts, stock, plateLayers };
}

/** Add a bounded number of supported roof/antenna/cargo details, never loose filler. */
function decorate(parts: PlacedPart[], stock: Stock[], preferredColors: Set<number>, allowSubstitution: boolean): number {
  const limit = Math.min(8, Math.max(1, Math.floor(parts.length * 0.3)));
  const surfaces = [...parts].sort((a, b) => bounds(b).maxZ - bounds(a).maxZ || a.position.x - b.position.x);
  let added = 0;
  const highest = Math.max(...surfaces.map(part => bounds(part).maxZ));
  for (const surface of surfaces) {
    if (added >= limit) break;
    if (!getPartDefinition(surface.partId)?.hasStuds || bounds(surface).maxZ < highest - 3) continue;
    const box = bounds(surface);
    const candidates = stock.filter(entry => entry.remaining > 0 && (allowSubstitution || preferredColors.has(entry.item.color.id))).sort((a, b) => {
      const aDef = getPartDefinition(a.item.partId)!, bDef = getPartDefinition(b.item.partId)!;
      const score = (entry: typeof aDef) => (entry.category === 'Slope' ? 0 : entry.category === 'Tile' ? 1 : entry.category === 'Plate' ? 2 : 3);
      return score(aDef) - score(bDef) || aDef.dimensions.x * aDef.dimensions.y - bDef.dimensions.x * bDef.dimensions.y || b.remaining - a.remaining;
    });
    let found = false;
    for (const candidate of candidates) {
      for (const rotation of [0, 90] as Rotation[]) {
        for (let y = box.minY; y < box.maxY && !found; y++) {
          for (let x = box.minX; x < box.maxX && !found; x++) {
            const placed = makePart(candidate, x, y, box.maxZ, rotation);
            const placedBox = bounds(placed);
            if (placedBox.maxX > box.maxX || placedBox.maxY > box.maxY || parts.some(part => overlaps(part, placed)) || !supports(surface, placed)) continue;
            parts.push(placed); candidate.remaining--; added++; found = true;
          }
        }
        if (found) break;
      }
      if (found) break;
    }
  }
  return added;
}

export function generateModel(inventory: SetInventory, options: GenerationOptions): LegoModel {
  if (!options || !['small', 'balanced', 'large'].includes(options.size)) throw new GenerationError('模型尺寸必须为 small、balanced 或 large。', 'INVALID_OPTIONS');
  if (!['preserve', 'substitute', 'missing-parts'].includes(options.colorStrategy)) throw new GenerationError('请选择有效的颜色策略。', 'INVALID_OPTIONS');
  if (options.colorStrategy === 'missing-parts') throw new GenerationError('C 缺件建议模式尚未实现。V0.1 请使用 A 保留配色或 B 允许颜色替代；模型不会使用库存之外的零件。', 'UNSUPPORTED_COLOR_STRATEGY');
  if (typeof options.prompt !== 'string') throw new GenerationError('模型描述必须是文字。', 'INVALID_PROMPT');
  const template = resolveTemplate(options.prompt);
  const stock = collectStock(inventory);
  const count = stock.reduce((sum, entry) => sum + entry.remaining, 0);
  if (count < 4) throw new GenerationError(`可用的受支持零件只有 ${count} 件，无法搭建可识别的${TEMPLATE_NAMES[template]}。请使用含基础砖与板的库存。`, 'INSUFFICIENT_INVENTORY');
  const colorArea = new Map<number, number>();
  for (const entry of stock) {
    const definition = getPartDefinition(entry.item.partId)!;
    if (definition.hasStuds) colorArea.set(entry.item.color.id, (colorArea.get(entry.item.color.id) ?? 0) + definition.dimensions.x * definition.dimensions.y * entry.remaining);
  }
  const palette = [...colorArea.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([id]) => id);
  if (!palette.length) throw new GenerationError('库存只有光面砖、斜坡或不支持的零件，缺少带凸点的基础结构零件。', 'INSUFFICIENT_INVENTORY');
  const primary = palette[0], accent = palette[1] ?? primary;
  const allowSubstitution = options.colorStrategy === 'substitute';
  const sizes: ModelSize[] = options.size === 'large' ? ['large', 'balanced', 'small'] : options.size === 'balanced' ? ['balanced', 'small'] : ['small'];
  let assembled: ReturnType<typeof buildTemplate>;
  let actualSize: ModelSize = options.size;
  for (const size of sizes) {
    for (const adapt of [false, true]) {
      assembled = buildTemplate(blueprint(template, size), stock, primary, accent, allowSubstitution, adapt);
      if (assembled) break;
    }
    if (assembled) { actualSize = size; break; }
  }
  if (!assembled) {
    const detail = allowSubstitution ? '已尝试全部可用颜色和更小的结构。' : 'A 模式保留主色/辅色，已尝试缩小结构；可尝试 B 模式允许库存内的其他颜色替代。';
    throw new GenerationError(`库存不足以搭建具有有效凸点支撑的最小${TEMPLATE_NAMES[template]}。${detail}需要更多 2×4、2×2 或 1×2 基础砖/板；不会补入虚构零件。`, 'INSUFFICIENT_INVENTORY');
  }
  const { parts } = assembled;
  const notes = [
    'V0.1 由规则模板与库存约束生成；不是任意造型 AI。坐标 x/y 为凸点，z 为板单位（1 砖 = 3 板）。',
    allowSubstitution ? 'B 模式允许使用库存内的其他真实颜色替代目标主色/辅色。' : 'A 模式根据库存中占比最高的两种颜色确定主色/辅色；不足时简化结构。',
  ];
  if (actualSize !== options.size) notes.push(`库存约束：从${sizeName[options.size]}简化为${sizeName[actualSize]}模型，保留主要轮廓。`);
  if (assembled.plateLayers) notes.push(`有 ${assembled.plateLayers} 层使用库存中的板替代砖，高度相应简化。`);
  if (template === 'car') notes.push('V0.1 汽车的四个轮子采用基础砖表现轮廓，没有使用库存外的车轮或车轴，不能滚动。');
  if (template === 'animal') notes.push('动物模板表现通用四足动物轮廓；猫、狗等描述目前共用此模板。');
  if (options.maximizeUsage) {
    const added = decorate(parts, assembled.stock, new Set([primary, accent]), allowSubstitution);
    notes.push(`尽量使用零件：在已有结构上增加 ${added} 件有凸点支撑的顶部装饰；保留造型，不强行耗尽库存。`);
  }
  const minX = Math.min(...parts.map(part => part.position.x)), minY = Math.min(...parts.map(part => part.position.y));
  parts.forEach((part, index) => { part.instanceId = `part-${String(index + 1).padStart(3, '0')}`; part.position.x -= minX; part.position.y -= minY; });
  const usage = new Map<string, InventoryUsage>();
  for (const part of parts) {
    const key = keyOf(part.partId, part.color.id);
    const used = usage.get(key);
    if (used) used.quantityUsed++;
    else usage.set(key, { partId: part.partId, colorId: part.color.id, quantityUsed: 1, quantityAvailable: stock.find(s => keyOf(s.item.partId, s.item.color.id) === key)!.initial });
  }
  const model: LegoModel = {
    id: `model-${Date.now().toString(36)}-${template}`,
    name: `${sizeName[actualSize]}${TEMPLATE_NAMES[template]}`,
    description: `根据「${options.prompt.trim().slice(0, 180)}」生成的${TEMPLATE_NAMES[template]}，使用 ${parts.length} 件库存零件。`,
    template, parts, dimensions: modelDimensions(parts), inventoryUsage: [...usage.values()].sort((a, b) => a.partId.localeCompare(b.partId) || a.colorId - b.colorId), notes,
  };
  createBuildSteps(model);
  const checked = validateModel(model, inventory);
  if (!checked.valid) throw new Error(`模型未通过独立校验：${checked.errors.join('；')}`);
  return model;
}
