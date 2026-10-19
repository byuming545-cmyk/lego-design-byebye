import { getPartDefinition } from '../lego/catalog.js';
import type { PartColor, PartInventoryItem, SetInventory } from '../types/index.js';
import { InventoryError, normalizeSetNumber, type SetInventoryProvider } from './provider.js';

const COLORS: PartColor[] = [
  { id: 14, name: '黄色', hex: '#F2CD37' },
  { id: 2, name: '绿色', hex: '#237841' },
  { id: 4, name: '红色', hex: '#C91A09' },
  { id: 71, name: '浅灰色', hex: '#A0A5A9' },
];

// Intentionally synthetic: these quantities do NOT describe the referenced retail sets.
const DEMO_PARTS: Array<[string, number]> = [
  ['3001', 4], ['3003', 4], ['3004', 3], ['3005', 2],
  ['3020', 2], ['3022', 1], ['3023', 1], ['3024', 1],
  ['3068b', 1], ['3069b', 1], ['3040b', 1],
];

export class MockInventoryProvider implements SetInventoryProvider {
  readonly source = 'mock' as const;

  async getSetInventory(input: string): Promise<SetInventory> {
    const setNumber = normalizeSetNumber(input);
    if (!['10696-1', '11013-1'].includes(setNumber)) {
      throw new InventoryError(
        '演示模式仅支持 10696-1 和 11013-1，且库存为合成示例。读取其他套装请配置 Rebrickable API Key。',
        'DEMO_SET_NOT_FOUND', 404,
      );
    }
    const items: PartInventoryItem[] = COLORS.flatMap(color => DEMO_PARTS.map(([partId, quantity]) => {
      const definition = getPartDefinition(partId);
      if (!definition) throw new Error(`Missing demonstration part definition: ${partId}`);
      return {
        partId, name: definition.name, category: definition.category, color: { ...color },
        quantityAvailable: quantity, quantityUsed: 0, supported: true,
        dimensions: { ...definition.dimensions },
      };
    }));
    items.push(
      { partId: 'demo-wheel', name: '演示车轮（暂不支持）', category: 'Unsupported', color: { id: 0, name: '黑色', hex: '#171717' }, quantityAvailable: 4, quantityUsed: 0, supported: false, dimensions: { x: 1, y: 1, z: 1 } },
      { partId: 'demo-technic-axle', name: '演示 Technic 轴（暂不支持）', category: 'Unsupported', color: { id: 71, name: '浅灰色', hex: '#A0A5A9' }, quantityAvailable: 2, quantityUsed: 0, supported: false, dimensions: { x: 1, y: 1, z: 1 } },
    );
    return {
      setNumber, name: `${setNumber} · 合成演示库存`, source: this.source,
      sourceLabel: 'Mock · 合成演示数据，非官方套装库存', items,
      warnings: [
        '此库存为 V0.1 人工构造的演示数据，不代表 10696 或 11013 真实套装的零件、颜色或数量。',
        '84 个支持的基础零件可参与生成；6 个车轮和 Technic 零件仅展示，不参与生成。',
      ],
    };
  }
}
