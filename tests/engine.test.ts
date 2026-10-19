import { describe, expect, it } from 'vitest';
import { generateModel, GenerationError } from '../src/generators/index.js';
import { getPartDefinition, PART_CATALOG } from '../src/lego/catalog.js';
import { connectedComponents, connectionMap, modelDimensions, supports } from '../src/lego/geometry.js';
import { createBuildSteps } from '../src/instructions/steps.js';
import { CollisionValidator, ConnectionValidator, InventoryValidator, validateModel } from '../src/validators/index.js';
import { MockInventoryProvider } from '../src/inventory/mock.js';
import type { GenerationOptions, LegoModel, PartInventoryItem, PlacedPart, SetInventory } from '../src/types/index.js';

const yellow = { id: 14, name: '黄色', hex: 'F2CD37' };
const gray = { id: 71, name: '浅灰色', hex: 'A0A5A9' };
const options: GenerationOptions = { prompt: '机器人', size: 'balanced', colorStrategy: 'substitute', maximizeUsage: false };

function item(partId: string, quantityAvailable: number, color = yellow): PartInventoryItem {
  const definition = getPartDefinition(partId)!;
  return { partId, name: definition.name, category: definition.category, dimensions: { ...definition.dimensions }, color: { ...color }, quantityAvailable, quantityUsed: 0, supported: true };
}
function inventory(items: PartInventoryItem[]): SetInventory {
  return { setNumber: 'test-1', name: 'Test inventory', source: 'mock', sourceLabel: 'Test', items, warnings: [] };
}
function placed(partId: string, x: number, y: number, z: number, instanceId: string, rotation: PlacedPart['rotation'] = 0): PlacedPart {
  const definition = getPartDefinition(partId)!;
  return { instanceId, partId, name: definition.name, category: definition.category, color: { ...yellow }, dimensions: { ...definition.dimensions }, position: { x, y, z }, rotation, connections: [], buildStep: 1 };
}
function modelFrom(parts: PlacedPart[], available: SetInventory): LegoModel {
  const connections = connectionMap(parts);
  parts.forEach(part => { part.connections = connections.get(part.instanceId)!; });
  const usage = new Map<string, { partId: string; colorId: number; quantityUsed: number; quantityAvailable: number }>();
  for (const part of parts) {
    const key = `${part.partId}:${part.color.id}`;
    const existing = usage.get(key);
    if (existing) existing.quantityUsed++;
    else usage.set(key, { partId: part.partId, colorId: part.color.id, quantityUsed: 1, quantityAvailable: available.items.filter(item => item.partId === part.partId && item.color.id === part.color.id).reduce((sum, item) => sum + item.quantityAvailable, 0) });
  }
  return { id: 'test', name: 'Test model', description: '', template: 'robot', parts, dimensions: modelDimensions(parts), inventoryUsage: [...usage.values()], notes: [] };
}

describe('catalog and independent physical rules', () => {
  it('uses canonical plate heights and ignores inherited catalog properties', () => {
    expect(PART_CATALOG['3001'].dimensions).toEqual({ x: 2, y: 4, z: 3 });
    expect(PART_CATALOG['3020'].dimensions.z).toBe(1);
    expect(getPartDefinition('__proto__')).toBeUndefined();
    expect(getPartDefinition('constructor')).toBeUndefined();
  });

  it('checks rotated footprints and permits only touching faces', () => {
    const stock = inventory([item('3001', 3)]);
    const first = placed('3001', 0, 0, 0, 'a', 90);
    const overlapping = placed('3001', 3, 0, 0, 'b');
    expect(new CollisionValidator().validate(modelFrom([first, overlapping], stock)).valid).toBe(false);
    overlapping.position.x = 4;
    expect(new CollisionValidator().validate(modelFrom([first, overlapping], stock)).valid).toBe(true);
  });

  it('rejects floating parts, fractional positions and false connection lists', () => {
    const stock = inventory([item('3003', 3)]);
    const bottom = placed('3003', 0, 0, 0, 'a');
    const floating = placed('3003', 0, 0, 4, 'b');
    const model = modelFrom([bottom, floating], stock);
    expect(new ConnectionValidator().validate(model).errors.join('')).toMatch(/悬空/);
    expect(() => createBuildSteps(model)).toThrow(/悬空/);
    floating.position.z = 3;
    model.parts[0].position.x = 0.5;
    expect(new CollisionValidator().validate(model).valid).toBe(false);
    model.parts[0].position.x = 0;
    expect(new ConnectionValidator().validate(model).errors.join('')).toMatch(/连接清单/);
  });

  it('does not allow tiles or sloped tops to provide stud support', () => {
    for (const cap of ['3068b', '3040b']) {
      const stock = inventory([item('3022', 1), item(cap, 1), item('3005', 1)]);
      const bottom = placed('3022', 0, 0, 0, 'a');
      const middle = placed(cap, 0, 0, 1, 'b');
      const upper = placed('3005', 0, 0, 1 + middle.dimensions.z, 'c');
      expect(supports(middle, upper)).toBe(false);
      expect(new ConnectionValidator().validate(modelFrom([bottom, middle, upper], stock)).valid).toBe(false);
    }
  });

  it('rejects disconnected grounded components in the final model', () => {
    const stock = inventory([item('3003', 2)]);
    const model = modelFrom([placed('3003', 0, 0, 0, 'a'), placed('3003', 5, 0, 0, 'b')], stock);
    expect(new ConnectionValidator().validate(model).errors.join('')).toMatch(/互不连接/);
  });

  it('validates exact part/color stock, usage and canonical dimensions independently', () => {
    const stock = inventory([item('3003', 1), item('3003', 5, gray)]);
    const model = modelFrom([placed('3003', 0, 0, 0, 'a'), placed('3003', 0, 0, 3, 'b')], stock);
    expect(new InventoryValidator().validate(model, stock).errors.join('')).toMatch(/库存不足/);
    const changed = structuredClone(model);
    changed.parts[1].color.id = 999;
    changed.parts[0].dimensions.z = 1;
    changed.inventoryUsage[0].quantityUsed = 1;
    const errors = new InventoryValidator().validate(changed, stock).errors.join('');
    expect(errors).toMatch(/不存在/);
    expect(errors).toMatch(/尺寸或类别/);
    expect(errors).toMatch(/用量清单/);
  });
});

describe('inventory-constrained template generation', () => {
  const combinations = ['机器人', '汽车', '小屋', '动物'].flatMap(prompt =>
    (['small', 'balanced', 'large'] as const).flatMap(size =>
      (['preserve', 'substitute'] as const).flatMap(colorStrategy =>
        [false, true].map(maximizeUsage => ({ prompt, size, colorStrategy, maximizeUsage })))));

  it.each(combinations)('generates one real assembly for $prompt / $size / $colorStrategy / maximize $maximizeUsage', async request => {
    const stock = await new MockInventoryProvider().getSetInventory('10696-1');
    const before = structuredClone(stock);
    const model = generateModel(stock, request);
    expect(validateModel(model, stock)).toMatchObject({ valid: true, errors: [] });
    expect(connectedComponents(model.parts)).toHaveLength(1);
    expect(model.parts.every(part => part.position.z === 0 || model.parts.some(lower => supports(lower, part)))).toBe(true);
    expect(model.inventoryUsage.every(usage => usage.quantityUsed <= usage.quantityAvailable)).toBe(true);
    expect(stock).toEqual(before);
    if (request.colorStrategy === 'preserve') expect(new Set(model.parts.map(part => part.color.id)).size).toBeLessThanOrEqual(2);
  }, 15000);

  it('changes requested sizes when stock permits and explains necessary simplification', async () => {
    const abundant = inventory([yellow, gray].flatMap(color => Object.keys(PART_CATALOG).map(id => item(id, 60, color))));
    const small = generateModel(abundant, { ...options, size: 'small' });
    const large = generateModel(abundant, { ...options, size: 'large' });
    expect(large.dimensions.x).toBeGreaterThan(small.dimensions.x);
    expect(large.parts.length).toBeGreaterThan(small.parts.length);
    const limited = await new MockInventoryProvider().getSetInventory('10696');
    const simplified = generateModel(limited, { ...options, prompt: '房子', size: 'large', colorStrategy: 'preserve' });
    expect(simplified.notes.join('')).toMatch(/大型.*简化.*小型/);
  });

  it('maximizes use with supported decorations without adding loose filler', async () => {
    const stock = await new MockInventoryProvider().getSetInventory('10696');
    const normal = generateModel(stock, options);
    const decorated = generateModel(stock, { ...options, maximizeUsage: true });
    expect(decorated.parts.length).toBeGreaterThan(normal.parts.length);
    expect(decorated.parts.length - normal.parts.length).toBeLessThanOrEqual(8);
    expect(connectedComponents(decorated.parts)).toHaveLength(1);
  });

  it('fails transparently on shortage, unsupported prompts and reserved C mode', () => {
    const tiny = inventory([item('3005', 2)]);
    expect(() => generateModel(tiny, options)).toThrow(/只有 2 件/);
    expect(() => generateModel(tiny, { ...options, prompt: '一架飞机' })).toThrow(/四类规则模板/);
    expect(() => generateModel(tiny, { ...options, prompt: 'robot car' })).toThrow(/多个模型类别/);
    expect(() => generateModel(tiny, { ...options, colorStrategy: 'missing-parts' })).toThrow(/尚未实现/);
    try { generateModel(tiny, options); } catch (error) { expect(error).toBeInstanceOf(GenerationError); expect((error as GenerationError).code).toBe('INSUFFICIENT_INVENTORY'); }
    const onlyTiles = inventory([item('3068b', 30)]);
    expect(() => generateModel(onlyTiles, options)).toThrow(/缺少带凸点/);
  });

  it('uses plates as honest shorter structures if no bricks exist', () => {
    const plates = inventory([item('3020', 50), item('3022', 30), item('3023', 30), item('3024', 30)]);
    const model = generateModel(plates, { ...options, size: 'small' });
    expect(model.parts.every(part => part.category === 'Plate')).toBe(true);
    expect(model.notes.join('')).toMatch(/使用库存中的板替代砖/);
    expect(validateModel(model, plates).valid).toBe(true);
  });
});

describe('independent build instructions', () => {
  it('provides stable small batches, self-contained snapshots and valid assembly prefixes', async () => {
    const stock = await new MockInventoryProvider().getSetInventory('10696');
    const model = generateModel(stock, { ...options, prompt: '动物', maximizeUsage: true });
    const steps = createBuildSteps(model);
    const built = new Set<string>();
    for (const step of steps) {
      expect(step.addedParts.length).toBeGreaterThan(0);
      expect(step.addedParts.length).toBeLessThanOrEqual(4);
      for (const part of step.addedParts) {
        expect(part.buildStep).toBe(step.stepNumber);
        expect(part.position.z === 0 || step.totalModelState.some(lower => built.has(lower.instanceId) && supports(lower, part))).toBe(true);
        expect(built.has(part.instanceId)).toBe(false);
        built.add(part.instanceId);
      }
      expect(step.totalModelState).toHaveLength(built.size);
      expect(step.totalModelState.every(part => part.connections.every(id => built.has(id)))).toBe(true);
    }
    expect(built.size).toBe(model.parts.length);
    expect(steps.at(-1)!.totalModelState).toEqual(model.parts.slice().sort((a, b) => a.buildStep - b.buildStep || steps.at(-1)!.totalModelState.findIndex(p => p.instanceId === a.instanceId) - steps.at(-1)!.totalModelState.findIndex(p => p.instanceId === b.instanceId)));
    expect(createBuildSteps(model)).toEqual(steps);
    const initial = steps[0].totalModelState[0].position.x;
    model.parts[0].position.x += 100;
    expect(steps[0].totalModelState[0].position.x).toBe(initial);
  });

  it('rejects an otherwise valid final model with impossible top-down instructions', async () => {
    const stock = await new MockInventoryProvider().getSetInventory('10696');
    const model = generateModel(stock, options);
    const maximum = Math.max(...model.parts.map(part => part.buildStep));
    model.parts.forEach(part => { part.buildStep = maximum + 1 - part.buildStep; });
    expect(validateModel(model, stock).errors.join('')).toMatch(/此前已搭建/);
  });
});
