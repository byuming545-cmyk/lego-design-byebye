import { SPEED_PART_CATALOG, SPEED_LDRAW_REVISION } from '../speed/catalog.js';
import type { SpeedInventory, SpeedPartDefinition } from '../speed/types.js';
import type { PartColor } from '../types/index.js';

/** Real LEGO/LDraw colour identifiers. Availability of every part-colour
 * combination is deliberately a separate, currently unverified question. */
export const AUTOMOTIVE_COLORS: readonly PartColor[] = Object.freeze([
  { id: 0, name: 'Black', hex: '#05131D' },
  { id: 15, name: 'White', hex: '#FFFFFF' },
  { id: 71, name: 'Light Bluish Gray', hex: '#A0A5A9' },
  { id: 72, name: 'Dark Bluish Gray', hex: '#6C6E68' },
  { id: 4, name: 'Red', hex: '#C91A09' },
  { id: 1, name: 'Blue', hex: '#0055BF' },
  { id: 14, name: 'Yellow', hex: '#F2CD37' },
  { id: 40, name: 'Trans-Clear', hex: '#FCFCFC' },
]);

export interface AutomotivePalette {
  id: 'automotive-reliable-v1';
  parts: SpeedPartDefinition[];
  colors: PartColor[];
  quantityMode: 'unlimited-design';
  ownership: 'virtual-not-owned';
  partColorAvailability: 'not-verified';
  sourceRevision: string;
  excludedCount: number;
  warnings: string[];
}
export function getAutomotivePalette(): AutomotivePalette {
  const definitions = Object.values(SPEED_PART_CATALOG);
  const parts = definitions.filter(part => part.support === 'supported' && part.shape && part.dimensions && part.connectionPoints.length);
  return {
    id: 'automotive-reliable-v1', parts: structuredClone(parts), colors: structuredClone([...AUTOMOTIVE_COLORS]),
    quantityMode: 'unlimited-design', ownership: 'virtual-not-owned', partColorAvailability: 'not-verified',
    sourceRevision: SPEED_LDRAW_REVISION, excludedCount: definitions.length - parts.length,
    warnings: ['自由设计使用虚拟零件，不代表你拥有这些零件。', '只使用已建模的几何与连接；尚未支持的零件不参与生成。', '颜色属于真实 LEGO 色表；具体零件与颜色的生产、库存及购买可用性未核实。', '标称几何校验不代替实物搭建测试。'],
  };
}

/** Adapter for the existing physical validators. The finite upper bound is
 * greater than the design complexity limit; it is never represented as owned stock. */
export function createVirtualPaletteInventory(colors: readonly PartColor[] = AUTOMOTIVE_COLORS): SpeedInventory {
  const palette = getAutomotivePalette();
  for (const color of colors) if (!AUTOMOTIVE_COLORS.some(entry => entry.id === color.id && entry.hex.toLowerCase() === color.hex.toLowerCase())) throw new Error('Unsupported automotive LEGO colour.');
  return {
    setNumber: 'virtual-automotive-palette', name: 'Automotive Part Palette（虚拟设计零件）', source: 'mock',
    sourceLabel: '无限数量的虚拟设计零件；不是实际套装库存',
    inventorySources: [{ sourceId: 'virtual-automotive-palette', setNumber: 'virtual', name: '虚拟设计零件库', source: 'custom', quantity: 0 }],
    analysis: { totalQuantity: palette.parts.length * colors.length * 100_000, supportedQuantity: palette.parts.length * colors.length * 100_000, partiallySupportedQuantity: 0, unsupportedQuantity: 0, usableQuantity: palette.parts.length * colors.length * 100_000, supportRate: 1, missingRequirements: [], canGenerate: true },
    warnings: [...palette.warnings],
    items: palette.parts.flatMap(part => colors.map(color => ({
      partId: part.partId, name: part.name, category: part.category, color: { ...color },
      quantityAvailable: 100_000, quantityUsed: 0, support: part.support, supported: true,
      dimensions: { ...part.dimensions! }, sources: [{ sourceId: 'virtual-automotive-palette', setNumber: 'virtual', quantity: 100_000 }],
    }))),
  };
}

export function resolveAutomotiveColor(requested: string | number): { requested: string | number; actual: PartColor; substituted: boolean; reason: string } {
  const exact = AUTOMOTIVE_COLORS.find(color => color.id === requested || color.name.toLowerCase() === String(requested).trim().toLowerCase() || color.hex.toLowerCase() === String(requested).trim().toLowerCase());
  if (exact) return { requested, actual: { ...exact }, substituted: false, reason: '真实 LEGO 色表中的颜色；零件颜色组合可用性未核实。' };
  const value = String(requested).trim();
  let nearest = AUTOMOTIVE_COLORS.find(color => color.id === 72)!;
  if (/^#[0-9a-f]{6}$/i.test(value)) {
    const rgb = (hex: string) => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));
    const source = rgb(value);
    nearest = AUTOMOTIVE_COLORS.filter(color => color.id !== 40).reduce((best, color) => {
      const distance = (entry: PartColor) => rgb(entry.hex).reduce((sum, channel, index) => sum + (channel - source[index]) ** 2, 0);
      return distance(color) < distance(best) ? color : best;
    }, nearest);
  }
  return { requested, actual: { ...nearest }, substituted: true, reason: '请求颜色不在可靠色表内，选择最接近的实际 LEGO 颜色；不是制造商车漆的精确复现。' };
}
