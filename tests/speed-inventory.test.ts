import { describe, expect, it } from 'vitest';
import { SPEED_CATALOG_STATS, SPEED_PART_CATALOG, getSpeedPartDefinition } from '../src/speed/catalog.js';
import { addSpeedExtraParts, analyzeSpeedInventories, createSpeedDemoInventory, parseSpeedExtraParts, parseSpeedSetNumbers } from '../src/speed/inventory.js';
import type { PartInventoryItem, SetInventory } from '../src/types/index.js';

function row(partId: string, quantityAvailable = 1, colorId = 0): PartInventoryItem {
  return { partId, quantityAvailable, quantityUsed: 99, name: `Raw ${partId}`, category: 'Unsupported', color: { id: colorId, name: 'Test color', hex: '#123ABC' }, dimensions: { x: 99, y: 99, z: 99 }, supported: false };
}
function source(setNumber: string, items: PartInventoryItem[]): SetInventory {
  return { setNumber, name: `Test fixture ${setNumber}`, source: 'rebrickable', sourceLabel: 'Test fixture only', warnings: [], items };
}

describe('Speed part catalog', () => {
  it('has 100 sourced actual IDs, with only precisely modeled basic parts marked supported', () => {
    expect(SPEED_CATALOG_STATS).toMatchObject({ total: 100, supported: 63, partiallySupported: 37, unsupported: 0 });
    expect(Object.keys(SPEED_PART_CATALOG)).toHaveLength(100);
    for (const definition of Object.values(SPEED_PART_CATALOG)) {
      expect(definition.sourceUrl).toContain('/c43ed06a128a10ed65675166bf42eb6fd608b9b0/parts/');
      expect(definition.ldrawFile).toBe(`parts/${definition.partId}.dat`);
      if (definition.support === 'supported') {
        expect(definition.shape).not.toBeNull();
        expect(definition.dimensions).not.toBeNull();
        expect(definition.connectionPoints.length).toBeGreaterThan(0);
      } else {
        expect(definition.dimensions).toBeNull();
        expect(definition.shape).toBeNull();
        expect(definition.connectionPoints).toEqual([]);
      }
    }
  });

  it('defines explicit standard top/bottom grid connectors and no top studs on tiles', () => {
    const brick = getSpeedPartDefinition('3001')!;
    expect(brick.dimensions).toEqual({ x: 2, y: 4, z: 3 });
    expect(brick.connectionPoints.filter(point => point.type === 'stud')).toHaveLength(8);
    expect(brick.connectionPoints.filter(point => point.type === 'antiStud')).toHaveLength(8);
    expect(brick.connectionPoints[0]).toMatchObject({ localPosition: { x: 0.5, y: 0.5, z: 3 }, direction: { x: 0, y: 0, z: 1 } });
    expect(getSpeedPartDefinition('3069b')!.connectionPoints.every(point => point.type === 'antiStud')).toBe(true);
    expect(getSpeedPartDefinition('15573')!.notes.join(' ')).toContain('不能复用 3794b');
    expect(getSpeedPartDefinition('constructor')).toBeUndefined();
    expect(Object.isFrozen(brick.dimensions)).toBe(true);
  });

  it('models true slope top rows and curved underside steps without inventing studs', () => {
    for (const id of ['3039', '3040b']) {
      const definition = getSpeedPartDefinition(id)!;
      const top = definition.connectionPoints.filter(point => point.type === 'stud');
      expect(top).toHaveLength(definition.dimensions!.x);
      expect(top.every(point => point.localPosition.y === 1.5 && point.localPosition.z === 3)).toBe(true);
    }
    for (const id of ['11477', '15068', '50950']) {
      const definition = getSpeedPartDefinition(id)!;
      const y = definition.dimensions!.y;
      expect(definition.connectionPoints.every(point => point.type === 'antiStud')).toBe(true);
      expect(definition.connectionPoints.filter(point => point.localPosition.y === y - 0.5).every(point => point.localPosition.z === 1)).toBe(true);
      expect(definition.connectionPoints.filter(point => point.localPosition.y < y - 0.5).every(point => point.localPosition.z === 0)).toBe(true);
      expect(definition.shape!.boxes).toHaveLength(2);
      expect(definition.shape!.boxes![1].min.z).toBe(1);
    }
    for (const id of ['54200', '85984']) expect(getSpeedPartDefinition(id)!.connectionPoints.every(point => point.type === 'antiStud' && point.localPosition.z === 0)).toBe(true);
  });

  it('models verified side studs at their real plate offset and accepts rotated normal anti-studs', () => {
    const side = getSpeedPartDefinition('11211')!.connectionPoints.filter(point => point.type === 'sideStud');
    expect(side.map(point => point.localPosition)).toEqual([{ x: 0.5, y: 0, z: 1.75 }, { x: 1.5, y: 0, z: 1.75 }]);
    expect(side.every(point => point.direction.y === -1 && point.compatibleTypes.includes('antiStud'))).toBe(true);
    expect(getSpeedPartDefinition('3024')!.connectionPoints.find(point => point.type === 'antiStud')!.compatibleTypes).toContain('sideStud');
    expect(getSpeedPartDefinition('15573')!.support).toBe('partiallySupported');
  });

  it('defines each modern wheel component and precise sockets, pin segments and bore profiles', () => {
    const holder = getSpeedPartDefinition('18975')!;
    const pin = getSpeedPartDefinition('3673')!;
    const rim = getSpeedPartDefinition('66727')!;
    const tyre = getSpeedPartDefinition('18977')!;
    expect([holder, pin, rim, tyre].every(part => part.support === 'supported')).toBe(true);
    expect(holder.dimensions).toEqual({ x: 4, y: 2, z: 4 });
    expect(holder.connectionPoints.filter(point => point.type === 'wheelSocket').map(point => point.localPosition)).toEqual([{ x: 0.5, y: 1, z: 2.75 }, { x: 3.5, y: 1, z: 2.75 }]);
    expect(holder.connectionPoints.filter(point => point.type === 'stud' && point.localPosition.x === 1.5).every(point => point.localPosition.z === 1)).toBe(true);
    expect(holder.shape!.holes).toHaveLength(4);
    expect(pin.shape!.boxes).toBeUndefined();
    expect(pin.shape!.cylinders?.map(cylinder => cylinder.radius)).toEqual([0.4, 0.325, 0.325]);
    expect(pin.connectionPoints.map(point => point.localPosition.x)).toEqual([-0.5, 0.5]);
    expect(rim.shape!.innerRadius).toBe(0);
    expect(rim.shape!.holes).toEqual([
      { axis: 'x', center: { x: 0, y: 0, z: 0 }, radius: 0.3, width: 1 },
      { axis: 'x', center: { x: -0.45, y: 0, z: 0 }, radius: 0.4, width: 0.1 },
    ]);
    expect(tyre.shape).toMatchObject({ radius: 1.5, innerRadius: 1, width: 1.4 });
    expect(getSpeedPartDefinition('18976')!.support).toBe('partiallySupported');
  });
});

describe('Speed inventory classification and merging', () => {
  it('normalizes real IDs, preserves standalone demo identity, and counts repeated IDs once', () => {
    expect(parseSpeedSetNumbers('76922 + 76924-1, 76922-1')).toEqual(['76922-1', '76924-1']);
    expect(parseSpeedSetNumbers(['demo-speed', 'DEMO-SPEED'])).toEqual(['DEMO-SPEED']);
    for (const input of ['', '76922++76924', '769XX', '../76922', '76922?key=secret']) expect(() => parseSpeedSetNumbers(input)).toThrow();
  });

  it('merges exactly by part+color, retains source quantities, and ignores prior usage', () => {
    const first = source('10001', [row('3001', 3), row('3001', 2), row('3001', 1, 4)]);
    const second = source('10002-1', [row('3001', 7), row('3020', 2)]);
    const inventory = analyzeSpeedInventories([first, second]);
    const black = inventory.items.find(item => item.partId === '3001' && item.color.id === 0)!;
    expect(black.quantityAvailable).toBe(12);
    expect(black.quantityUsed).toBe(0);
    expect(black.sources).toEqual([
      { sourceId: 'set:10001-1', setNumber: '10001-1', quantity: 5 },
      { sourceId: 'set:10002-1', setNumber: '10002-1', quantity: 7 },
    ]);
    expect(inventory.items.find(item => item.color.id === 4)?.quantityAvailable).toBe(1);
    expect(inventory.inventorySources.every(item => item.quantity === 1)).toBe(true);
    expect(inventory.analysis.totalQuantity).toBe(15);
    expect(first.items[0].quantityUsed).toBe(99);
  });

  it('deduplicates normalized source IDs instead of accidentally doubling a box', () => {
    const inventory = analyzeSpeedInventories([
      source('10001', [row('3020', 5)]), source('10001-1', [row('3020', 5)]),
    ]);
    expect(inventory.inventorySources).toHaveLength(1);
    expect(inventory.analysis.totalQuantity).toBe(5);
    expect(inventory.warnings.join(' ')).toContain('已按 1 盒计算');
  });

  it('reclassifies all original rows by Speed ID and never trusts V0.1 placeholder geometry', () => {
    const unknown = { ...row('unknown-car-part', 3), supported: true, category: 'Brick' as const };
    const inventory = analyzeSpeedInventories([source('10001', [row('3034', 4), row('18976', 4), unknown])]);
    expect(inventory.items.find(item => item.partId === '3034')).toMatchObject({ support: 'supported', supported: true, dimensions: { x: 2, y: 8, z: 1 } });
    expect(inventory.items.find(item => item.partId === '18976')).toMatchObject({ support: 'partiallySupported', supported: false, dimensions: null });
    expect(inventory.items.find(item => item.partId === 'unknown-car-part')).toMatchObject({ support: 'unsupported', supported: false, dimensions: null });
    expect(inventory.analysis).toMatchObject({ totalQuantity: 11, supportedQuantity: 4, partiallySupportedQuantity: 4, unsupportedQuantity: 3, usableQuantity: 4 });
    expect(inventory.analysis.supportRate).toBeCloseTo(4 / 11);
    expect(inventory.analysis.canGenerate).toBe(false);
  });

  it('keeps unsupported rows without failing the full inventory and removes stale V0.1 classification warnings', () => {
    const input = source('10001', [row('unknown', 20), row('3020', 30)]);
    input.warnings = ['20 个零件暂未收录到 V0.1 几何目录，仅展示且不会用于生成。', 'Source warning'];
    const inventory = analyzeSpeedInventories([input]);
    expect(inventory.items).toHaveLength(2);
    expect(inventory.analysis.usableQuantity).toBe(30);
    expect(inventory.warnings.join(' ')).not.toContain('V0.1');
    expect(inventory.warnings.join(' ')).toContain('Source warning');
  });

  it('reports preliminary readiness only when one complete modeled mechanical family is present', () => {
    const inventory = analyzeSpeedInventories([createSpeedDemoInventory()]);
    expect(inventory.analysis.supportedQuantity).toBeGreaterThan(100);
    expect(inventory.analysis.partiallySupportedQuantity).toBeGreaterThan(0);
    expect(inventory.analysis.canGenerate).toBe(true);
    expect(inventory.analysis.missingRequirements).toEqual([]);
    expect(inventory.items.some(item => item.partId === '18975')).toBe(true);
    expect(inventory.items.some(item => item.partId === '3673')).toBe(true);
    expect(inventory.items.filter(item => !item.supported).every(item => item.dimensions === null)).toBe(true);
    expect(inventory.setNumber).toBe('DEMO-SPEED');
    expect(inventory.sourceLabel).toContain('非真实套装');
  });

  it('requires real holders and one separate pin per modern wheel, not just male-port totals', () => {
    for (const missing of ['18975', '3673', '18977', '66727']) {
      const input = createSpeedDemoInventory();
      input.items = input.items.filter(item => item.partId !== missing);
      const inventory = analyzeSpeedInventories([input]);
      expect(inventory.analysis.canGenerate).toBe(false);
      expect(inventory.analysis.missingRequirements.length).toBeGreaterThan(0);
    }
    const input = createSpeedDemoInventory();
    input.items.find(item => item.partId === '3673')!.quantityAvailable = 2;
    const inventory = analyzeSpeedInventories([input]);
    expect(inventory.analysis.canGenerate).toBe(false);
    expect(inventory.analysis.missingRequirements.join(' ')).toContain('每个 Pin 只能安装一个车轮');
  });

  it('never assigns a fabricated demo to an actual set number', () => {
    const demo = createSpeedDemoInventory();
    expect(() => analyzeSpeedInventories([{ ...demo, setNumber: '76922-1' }])).toThrow(/DEMO-SPEED/);
    expect(() => analyzeSpeedInventories([{ ...demo, source: 'rebrickable' }])).toThrow(/真实库存/);
    const next = createSpeedDemoInventory();
    demo.items[0].quantityAvailable = 0;
    expect(next.items[0].quantityAvailable).toBeGreaterThan(0);
  });

  it('supports the same classification pipeline for ten distinct source fixtures without set-specific recipes', () => {
    const sources = Array.from({ length: 10 }, (_, i) => source(`${10001 + i}`, [row('3020', 2), row('unknown', 1)]));
    const inventory = analyzeSpeedInventories(sources);
    expect(inventory.inventorySources).toHaveLength(10);
    expect(inventory.analysis).toMatchObject({ totalQuantity: 30, supportedQuantity: 20, unsupportedQuantity: 10 });
    expect(inventory.items.find(item => item.partId === '3020')?.sources).toHaveLength(10);
  });

  it('rejects invalid quantities, colors, limits and unsafe aggregate counts', () => {
    for (const quantity of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER]) {
      expect(() => analyzeSpeedInventories([source('10001', [row('3020', quantity)])])).toThrow();
    }
    const wrongColor = row('3020');
    wrongColor.color.hex = 'javascript:bad';
    expect(() => analyzeSpeedInventories([source('10001', [wrongColor])])).toThrow();
    expect(() => analyzeSpeedInventories([])).toThrow();
    expect(() => parseSpeedSetNumbers(Array.from({ length: 11 }, (_, index) => `${10001 + index}`))).toThrow();
  });
});

describe('user-reported Speed loose parts', () => {
  const black = { id: 0, name: '黑色', hex: '#171717' };
  const extra = (partId = '3020', quantity = 1, color = black) => ({ partId, quantity, color: { ...color } });

  it('parses a strict bounded stock contract and copies normalized colors', () => {
    expect(parseSpeedExtraParts(undefined)).toEqual([]);
    expect(parseSpeedExtraParts([])).toEqual([]);
    const input = [extra('3001pr0001', 1000, { id: 4, name: ' 红色 ', hex: '#c91a09' })];
    const parsed = parseSpeedExtraParts(input);
    expect(parsed).toEqual([{ partId: '3001pr0001', quantity: 1000, color: { id: 4, name: '红色', hex: '#C91A09' } }]);
    parsed[0].color.name = 'Changed';
    expect(input[0].color.name).toBe(' 红色 ');
    expect(parseSpeedExtraParts(Array.from({ length: 100 }, () => extra()))).toHaveLength(100);
  });

  it('rejects malformed IDs, quantities, colors and client-supplied geometry or provenance', () => {
    const invalid = [
      null, {}, '3020', Array.from({ length: 101 }, () => extra()),
      [extra('', 1)], [extra('../3020', 1)], [extra('3020?source=official', 1)], [extra('x'.repeat(81), 1)],
      ...[0, -1, 1.5, 1001, Number.MAX_SAFE_INTEGER, Number.NaN, '2'].map(quantity => [{ ...extra(), quantity }]),
      [{ ...extra(), dimensions: { x: 8, y: 8, z: 3 } }],
      [{ ...extra(), geometry: { kind: 'wheel' } }],
      [{ ...extra(), source: 'rebrickable' }],
      [{ ...extra(), supported: true }],
      [{ ...extra(), color: { ...black, id: -1 } }],
      [{ ...extra(), color: { ...black, id: 0.5 } }],
      [{ ...extra(), color: { ...black, name: '' } }],
      [{ ...extra(), color: { ...black, name: 'x'.repeat(101) } }],
      [{ ...extra(), color: { ...black, name: 'red\nblue' } }],
      [{ ...extra(), color: { ...black, hex: '#abc' } }],
      [{ ...extra(), color: { ...black, hex: '171717' } }],
      [{ ...extra(), color: { ...black, source: 'official' } }],
      [JSON.parse('{"partId":"3020","quantity":1,"color":{"id":0,"name":"black","hex":"#171717"},"__proto__":{"supported":true}}')],
    ];
    for (const input of invalid) expect(() => parseSpeedExtraParts(input)).toThrow();
  });

  it('merges exact part+color identities and accumulates one custom provenance contribution', () => {
    const base = analyzeSpeedInventories([source('10001', [row('3020', 5, 0)])]);
    const result = addSpeedExtraParts(base, [extra('3020', 2), extra('3020', 3), extra('3020', 4, { id: 4, name: '红色', hex: '#C91A09' })]);
    expect(result.items.find(item => item.color.id === 0)?.quantityAvailable).toBe(10);
    expect(result.items.find(item => item.color.id === 0)?.sources).toEqual([
      { sourceId: 'set:10001-1', setNumber: '10001-1', quantity: 5 },
      { sourceId: 'custom:extra-parts', setNumber: 'CUSTOM-EXTRAS', quantity: 5 },
    ]);
    expect(result.items.find(item => item.color.id === 4)?.quantityAvailable).toBe(4);
    expect(result.analysis).toMatchObject({ totalQuantity: 14, supportedQuantity: 14 });
    expect(result.inventorySources.filter(item => item.source === 'custom')).toEqual([
      { sourceId: 'custom:extra-parts', setNumber: 'CUSTOM-EXTRAS', name: '用户自报散件', source: 'custom', quantity: 1 },
    ]);
    expect(result.source).toBe('mixed');
    expect(result.sourceLabel).toContain('Rebrickable 真实套装来源');
    expect(result.sourceLabel).toContain('用户自报散件');
    expect(result.setNumber).toBe(base.setNumber);
    expect(result.name).toBe(base.name);
  });

  it('preserves the complete base bytes and returns independently mutable output, including with no extras', () => {
    const base = analyzeSpeedInventories([createSpeedDemoInventory()]);
    const before = JSON.stringify(base);
    const result = addSpeedExtraParts(base, [extra('3020', 2)]);
    expect(JSON.stringify(base)).toBe(before);
    expect(result.sourceLabel).toContain('DEMO-SPEED 合成演示');
    result.items[0].color.name = 'Changed';
    expect(JSON.stringify(base)).toBe(before);
    const unchanged = addSpeedExtraParts(base, []);
    expect(JSON.stringify(unchanged)).toBe(before);
    expect(unchanged).not.toBe(base);
    expect(unchanged.inventorySources.some(source => source.source === 'custom')).toBe(false);
  });

  it('keeps unknown and partial entries unusable and replaces stale quantity warnings', () => {
    const base = analyzeSpeedInventories([source('10001', [row('unknown-piece', 2), row('18976', 3)])]);
    const result = addSpeedExtraParts(base, [extra('unknown-piece', 4), extra('18976', 5)]);
    expect(result.analysis).toMatchObject({ totalQuantity: 14, unsupportedQuantity: 6, partiallySupportedQuantity: 8, usableQuantity: 0, canGenerate: false });
    expect(result.items.every(item => !item.supported && item.dimensions === null)).toBe(true);
    expect(result.warnings.filter(warning => /^\d+ 件未知零件/.test(warning))).toHaveLength(1);
    expect(result.warnings.some(warning => warning.startsWith('6 件未知零件'))).toBe(true);
    expect(result.warnings.filter(warning => /^\d+ 件零件可识别/.test(warning))).toHaveLength(1);
    expect(result.warnings.some(warning => warning.startsWith('8 件零件可识别'))).toBe(true);
    expect(result.warnings).not.toContain(base.warnings.find(warning => warning.startsWith('2 件未知零件')));
  });

  it('keeps an original display color on color-ID conflicts and avoids duplicate custom sources or warnings', () => {
    const base = analyzeSpeedInventories([source('10001', [row('3020', 2, 0)])]);
    const changed = extra('3020', 1, { id: 0, name: '用户颜色', hex: '#FFFFFF' });
    const first = addSpeedExtraParts(base, [changed]);
    const second = addSpeedExtraParts(first, [changed]);
    expect(second.items[0].color.hex).toBe('#123ABC');
    expect(second.items[0].quantityAvailable).toBe(4);
    expect(second.items[0].sources.filter(item => item.sourceId === 'custom:extra-parts')).toEqual([{ sourceId: 'custom:extra-parts', setNumber: 'CUSTOM-EXTRAS', quantity: 2 }]);
    expect(second.inventorySources.filter(item => item.source === 'custom')).toHaveLength(1);
    expect(second.warnings.filter(warning => warning.includes('来源色值不一致'))).toHaveLength(1);
    expect(second.warnings.filter(warning => warning.startsWith('用户自报散件的数量'))).toHaveLength(1);
  });

  it('recomputes mechanical readiness when self-reported loose parts supply a missing component', () => {
    const raw = createSpeedDemoInventory();
    raw.items = raw.items.filter(item => item.partId !== '3673');
    const base = analyzeSpeedInventories([raw]);
    expect(base.analysis.canGenerate).toBe(false);
    const result = addSpeedExtraParts(base, [extra('3673', 4)]);
    expect(result.analysis.canGenerate).toBe(true);
    expect(base.analysis.canGenerate).toBe(false);
  });

  it('does not count loose stock as another set and enforces the combined quantity ceiling', () => {
    const tenSets = analyzeSpeedInventories(Array.from({ length: 10 }, (_, i) => source(`${10001 + i}`, [row('3020', 2)])));
    const withExtras = addSpeedExtraParts(tenSets, [extra('3020', 1)]);
    expect(withExtras.inventorySources.filter(source => source.source !== 'custom')).toHaveLength(10);
    expect(withExtras.inventorySources).toHaveLength(11);
    expect(withExtras.setNumber).toBe(tenSets.setNumber);
    const nearLimit = analyzeSpeedInventories([source('10001', [row('3020', 999_999)])]);
    expect(addSpeedExtraParts(nearLimit, [extra('3020', 1)]).analysis.totalQuantity).toBe(1_000_000);
    expect(() => addSpeedExtraParts(nearLimit, [extra('3020', 2)])).toThrow(/1,000,000/);
    expect(nearLimit.analysis.totalQuantity).toBe(999_999);
  });
});
