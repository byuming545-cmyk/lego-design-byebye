import { beforeAll, describe, expect, it } from 'vitest';
import { getSpeedPartDefinition } from '../src/speed/catalog.js';
import { applyVehicleConnections, canConnect, deriveConnections, graphComponents, worldConnectionPoints, type WorldConnectionPoint } from '../src/speed/connections.js';
import { partBoundsLdu, primitivesIntersect, transformPoint, vehicleDimensions, worldPrimitives } from '../src/speed/geometry.js';
import { SpeedCollisionValidator, SpeedConnectionValidator, SpeedInventoryValidator, speedPartsCollide, StructuralValidator, validateVehicle, WheelValidator } from '../src/speed/validators.js';
import type { SpeedPlacedPart, VehicleModel } from '../src/speed/types.js';
import { analyzeSpeedInventories, createSpeedDemoInventory } from '../src/speed/inventory.js';
import { generateVehicleCandidates, generateVehicleModel } from '../src/speed/generator.js';
import { buildVehicleSteps } from '../src/speed/steps.js';
import { localRedesign } from '../src/speed/redesign.js';
import type { SpeedInventory, VehicleCandidate } from '../src/speed/types.js';

const color = { id: 0, name: '黑色', hex: '#171717' };
export function speedPart(partId: string, id: string, x = 0, y = 0, z = 0, moduleId: SpeedPlacedPart['moduleId'] = 'chassis'): SpeedPlacedPart {
  const definition = getSpeedPartDefinition(partId)!;
  return { instanceId: id, partId, name: definition.name, category: definition.category, color: { ...color }, dimensions: { ...definition.dimensions! }, position: { x, y, z }, orientation: { x: 0, y: 0, z: 0 }, moduleId, connectionPoints: structuredClone(definition.connectionPoints), activeConnections: [], buildStep: 1 };
}
export function speedModel(parts: SpeedPlacedPart[]): VehicleModel {
  const model: VehicleModel = { id: 'test', name: 'Test', description: '', vehicleType: 'supercar', style: 'modern', options: { prompt: 'test', vehicleType: 'supercar', style: 'modern', minifigure: false, priority: 'structure', maximizeUsage: false }, parameters: { width: 8, length: 14, track: 5.6, wheelbase: 8, cockpitPosition: 7, hoodLength: 4, roofHeight: 10 }, parts, connections: [], modules: [{ id: 'chassis', name: '底盘', partIds: parts.map(part => part.instanceId), connectionIds: [], locked: false, structuralScore: 100 }], dimensions: vehicleDimensions(parts), inventoryUsage: [], designNotes: [], version: 1 };
  applyVehicleConnections(model);
  return model;
}

describe('Speed Phase 2 explicit connector graph', () => {
  it('rotates metric coordinates correctly for SNOT rather than permuting studs and plates', () => {
    const part = speedPart('3005', 'a');
    part.orientation.x = 90;
    expect(transformPoint(part, { x: 0, y: 1, z: 0 })).toEqual({ x: 0, y: 0, z: 2.5 });
    expect(transformPoint(part, { x: 0, y: 0, z: 1 })).toEqual({ x: 0, y: -0.4, z: 0 });
  });
  it('connects matching stud/antiStud points and keeps independent stud anchors', () => {
    const model = speedModel([speedPart('3022', 'base'), speedPart('3003', 'upper', 0, 0, 1)]);
    expect(model.connections).toHaveLength(4);
    expect(new SpeedConnectionValidator().validate(model).valid).toBe(true);
    expect(graphComponents(model.parts)).toHaveLength(1);
  });
  it('rejects a side-touch and a tile top even when the bounding boxes meet', () => {
    for (const parts of [[speedPart('3005', 'a'), speedPart('3005', 'b', 1)], [speedPart('3068b', 'a'), speedPart('3003', 'b', 0, 0, 1)]]) {
      const model = speedModel(parts);
      expect(model.connections).toHaveLength(0);
      expect(new SpeedConnectionValidator().validate(model).valid).toBe(false);
    }
  });
  it('matches a transformed SNOT antiStud only with opposing direction and exact offset', () => {
    const male: WorldConnectionPoint = { id: 's', type: 'sideStud', localPosition: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 }, compatibleTypes: ['antiStud'], partId: 'a', positionLdu: { x: 20, y: 10, z: 12 }, worldDirection: { x: 1, y: 0, z: 0 } };
    const female: WorldConnectionPoint = { ...male, id: 'a', type: 'antiStud', compatibleTypes: ['stud'], partId: 'b', worldDirection: { x: -1, y: 0, z: 0 } };
    expect(canConnect(male, female)).toBe(true);
    expect(canConnect(male, { ...female, worldDirection: { x: 1, y: 0, z: 0 } })).toBe(false);
    expect(canConnect(male, { ...female, positionLdu: { x: 20.1, y: 10, z: 12 } })).toBe(false);
  });
  it('connects a verified side-stud brick to a physically rotated regular brick', () => {
    const support = speedPart('87087', 'side-support');
    const attached = speedPart('3005', 'side-panel', 0, 0, 0.5);
    attached.orientation.x = 90;
    const model = speedModel([support, attached]);
    expect(model.connections).toHaveLength(1);
    expect(model.connections[0].connectionType).toBe('side-stud');
    expect(new SpeedConnectionValidator().validate(model).valid).toBe(true);
    attached.position.z += 0.25;
    expect(new SpeedConnectionValidator().validate(model).valid).toBe(false);
  });
  it('rejects excessive rotations before attempting any geometric loops', () => {
    const model = speedModel([speedPart('3005', 'base')]);
    model.parts[0].orientation.x = 1e200 as 0;
    expect(new SpeedConnectionValidator().validate(model).errors.join('')).toMatch(/旋转无效/);
  });
  it('rejects arbitrary wheel fit families and forged connector definitions', () => {
    const a: WorldConnectionPoint = { id: 'pin', type: 'wheelPin', localPosition: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 }, compatibleTypes: ['wheelSocket'], fitFamily: 'family-a', partId: 'a', positionLdu: { x: 0, y: 0, z: 0 }, worldDirection: { x: 1, y: 0, z: 0 } };
    const b: WorldConnectionPoint = { ...a, id: 'socket', type: 'wheelSocket', compatibleTypes: ['wheelPin'], fitFamily: 'family-b', partId: 'b', worldDirection: { x: -1, y: 0, z: 0 } };
    expect(canConnect(a, b)).toBe(false);
    const model = speedModel([speedPart('3022', 'base'), speedPart('3003', 'upper', 0, 0, 1)]);
    model.parts[0].connectionPoints.push({ ...model.parts[0].connectionPoints[0], id: 'invented' });
    expect(new SpeedConnectionValidator().validate(model).errors.join('')).toMatch(/目录不一致/);
  });
  it('rebuilds graph independently and rejects forged edges, duplicate IDs and stale active lists', () => {
    const model = speedModel([speedPart('3022', 'base'), speedPart('3003', 'upper', 0, 0, 1)]);
    model.connections[0].allowsRotation = true;
    model.parts[0].activeConnections = [];
    expect(new SpeedConnectionValidator().validate(model).errors.join('')).toMatch(/Graph.*不一致.*activeConnections/);
    model.parts[1].instanceId = 'base';
    expect(new SpeedConnectionValidator().validate(model).errors.join('')).toMatch(/重复/);
    expect(deriveConnections(model.parts)).toHaveLength(0);
  });
});

export function mechanicalVehicle(): VehicleModel {
  const parts: SpeedPlacedPart[] = [];
  for (const [index, y] of [1, 9].entries()) {
    parts.push(speedPart('18975', `holder-${index}`, 2, y, 1));
    parts.push(speedPart('3003', `bridge-${index}`, 3, y, 2));
    for (const side of ['left', 'right']) {
      const left = side === 'left';
      const pin = speedPart('3673', `pin-${index}-${side}`, left ? 2 : 6, y + 1, 3.75, left ? 'leftWheelModule' : 'rightWheelModule');
      const rim = speedPart('66727', `rim-${index}-${side}`, left ? 1.5 : 6.5, y + 1, 3.75, pin.moduleId);
      const tyre = speedPart('18977', `tyre-${index}-${side}`, left ? 1.2 : 6.8, y + 1, 3.75, pin.moduleId);
      if (left) { rim.orientation.z = 180; tyre.orientation.z = 180; }
      parts.push(pin, rim, tyre);
    }
  }
  parts.push(speedPart('3034', 'chassis-spine', 3, 2, 5));
  return speedModel(parts);
}

describe('Speed Phase 3 verified modern mechanics', () => {
  it('installs four real holder→pin→rim→tyre chains with equal grounded wheels', () => {
    const model = mechanicalVehicle();
    expect(new SpeedConnectionValidator().validate(model)).toMatchObject({ valid: true });
    expect(new SpeedCollisionValidator().validate(model)).toMatchObject({ valid: true, errors: [] });
    expect(new WheelValidator().validate(model)).toMatchObject({ valid: true, wheelCount: 4, groundedWheels: 4, axleConnections: 4, rotationalClearance: true });
  });
  it('permits only measured coaxial bore seating and the narrow tyre/rim press fit', () => {
    const model = mechanicalVehicle();
    const pin = model.parts.find(part => part.instanceId === 'pin-0-right')!;
    const holder = model.parts.find(part => part.instanceId === 'holder-0')!;
    const rim = model.parts.find(part => part.instanceId === 'rim-0-right')!;
    const tyre = model.parts.find(part => part.instanceId === 'tyre-0-right')!;
    expect(worldPrimitives(pin).some(a => worldPrimitives(holder).some(b => primitivesIntersect(a, b)))).toBe(true);
    expect(speedPartsCollide(pin, holder)).toBe(false);
    expect(speedPartsCollide(pin, rim)).toBe(false);
    expect(speedPartsCollide(rim, tyre)).toBe(false);
    pin.position.y += 0.1;
    expect(speedPartsCollide(pin, holder)).toBe(true);
    tyre.position.y += 0.1;
    expect(speedPartsCollide(rim, tyre)).toBe(true);
  });
  it('detects tyre/body collisions from annular material rather than a generic wheel exception', () => {
    const model = mechanicalVehicle();
    model.parts.push(speedPart('3022', 'illegal-side-skirt', 0.5, 1.5, 3));
    applyVehicleConnections(model);
    const checked = new WheelValidator().validate(model);
    expect(checked.valid).toBe(false);
    expect(checked.rotationalClearance).toBe(false);
    expect(checked.collisions.join('')).toMatch(/illegal-side-skirt/);
  });
  it('rejects missing holders, missing wheels, wrong heights and unreasonable axle spacing', () => {
    const missingHolder = mechanicalVehicle();
    missingHolder.parts = missingHolder.parts.filter(part => part.partId !== '18975');
    expect(new WheelValidator().validate(missingHolder).axleConnections).toBe(0);
    const missingWheel = mechanicalVehicle();
    missingWheel.parts = missingWheel.parts.filter(part => part.instanceId !== 'rim-0-left');
    expect(new WheelValidator().validate(missingWheel).valid).toBe(false);
    const wrongHeight = mechanicalVehicle();
    for (const part of wrongHeight.parts.filter(part => /-0-left$/.test(part.instanceId))) part.position.z += 1;
    expect(new WheelValidator().validate(wrongHeight)).toMatchObject({ valid: false, groundedWheels: 3 });
    const wrongSpacing = mechanicalVehicle();
    wrongSpacing.parameters.wheelbase = 12;
    expect(new WheelValidator().validate(wrongSpacing).errors.join('')).toMatch(/轴距/);
  });
  it('does not treat the empty center of a tyre as solid, while rejecting its rubber band', () => {
    const tyre = { kind: 'cylinder' as const, axis: 'x' as const, center: { x: 0, y: 0, z: 0 }, radius: 30, innerRadius: 20, halfWidth: 14 };
    expect(primitivesIntersect(tyre, { kind: 'box', min: { x: -5, y: -5, z: -5 }, max: { x: 5, y: 5, z: 5 } })).toBe(false);
    expect(primitivesIntersect(tyre, { kind: 'box', min: { x: -5, y: 22, z: -5 }, max: { x: 5, y: 25, z: 5 } })).toBe(true);
  });
});

describe('Speed Phase 4 chassis-first modular generation', () => {
  it.each((['supercar', 'sports-car', 'gt', 'concept'] as const).flatMap(vehicleType => [false, true].map(maximizeUsage => ({ vehicleType, maximizeUsage }))))('builds real $vehicleType / maximize $maximizeUsage from stock', request => {
    const inventory = analyzeSpeedInventories([createSpeedDemoInventory()]), before = structuredClone(inventory);
    const model = generateVehicleModel(inventory, { prompt: '低矮原创跑车', vehicleType: request.vehicleType, style: 'futuristic', minifigure: false, priority: 'structure', maximizeUsage: request.maximizeUsage });
    expect(model.parts[0].moduleId).toBe('chassis');
    expect(model.parameters.width).toBe(8);
    expect(model.dimensions.x).toBe(8);
    expect(model.modules.filter(module => module.partIds.length).length).toBeGreaterThanOrEqual(9);
    expect(new SpeedConnectionValidator().validate(model).valid).toBe(true);
    expect(new SpeedCollisionValidator().validate(model).valid).toBe(true);
    expect(new WheelValidator().validate(model)).toMatchObject({ valid: true, groundedWheels: 4, axleConnections: 4 });
    const counts = new Map<string, number>();
    for (const part of model.parts) counts.set(`${part.partId}:${part.color.id}`, (counts.get(`${part.partId}:${part.color.id}`) ?? 0) + 1);
    for (const [id, quantity] of counts) {
      const row = inventory.items.find(item => `${item.partId}:${item.color.id}` === id)!;
      expect(row).toBeDefined(); expect(quantity).toBeLessThanOrEqual(row.quantityAvailable);
      const usage = model.inventoryUsage.find(item => `${item.partId}:${item.colorId}` === id)!;
      expect(usage.quantityUsed).toBe(quantity);
    }
    expect(inventory).toEqual(before);
    expect(model.parts.some(part => part.category === 'CurvedSlope')).toBe(true);
  }, 15000);
  it('fails with exact missing hardware and never promotes partial shapes by category', () => {
    const inventory = analyzeSpeedInventories([createSpeedDemoInventory()]);
    inventory.items = inventory.items.filter(item => item.partId !== '3673');
    expect(() => generateVehicleModel(inventory, { prompt: '跑车', vehicleType: 'supercar', style: 'modern', minifigure: false, priority: 'structure', maximizeUsage: false })).toThrow(/3673 至少 4 件/);
  });
  it('explicitly rejects unverified minifigure space and unrelated vehicles', () => {
    const inventory = analyzeSpeedInventories([createSpeedDemoInventory()]);
    const options = { prompt: '跑车', vehicleType: 'supercar' as const, style: 'modern' as const, minifigure: false, priority: 'structure' as const, maximizeUsage: false };
    expect(() => generateVehicleModel(inventory, { ...options, minifigure: true })).toThrow(/未完成.*人仔/);
    expect(() => generateVehicleModel(inventory, { ...options, prompt: '设计F1赛车' })).toThrow(/暂不支持 F1/);
  });
});

describe('Speed Phase 5 independent structure and publication gate', () => {
  const inventory = () => analyzeSpeedInventories([createSpeedDemoInventory()]);
  const options = { prompt: '原创跑车', vehicleType: 'supercar' as const, style: 'modern' as const, minifigure: false, priority: 'structure' as const, maximizeUsage: true };
  const refreshModules = (model: VehicleModel): void => {
    model.modules = [...new Set(model.parts.map(part => part.moduleId))].map(id => ({ id, name: id, partIds: model.parts.filter(part => part.moduleId === id).map(part => part.instanceId), connectionIds: [], locked: false, structuralScore: 0 }));
    applyVehicleConnections(model);
  };
  it.each(['supercar', 'sports-car', 'gt', 'concept'] as const)('publishes %s only after all five independent validators pass', vehicleType => {
    const stock = inventory(), candidates = generateVehicleCandidates(stock, { ...options, vehicleType });
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    const candidate = candidates[0];
    for (const name of ['inventory', 'connection', 'collision', 'wheels', 'structure'] as const) expect(candidate.validation[name].valid).toBe(true);
    expect(candidate.validation.valid).toBe(true);
    expect(candidate.validation.structure.structuralScore).toBeGreaterThanOrEqual(80);
    const chassis = candidate.model.parts.filter(part => part.moduleId === 'chassis');
    expect(graphComponents(chassis, deriveConnections(chassis))).toHaveLength(1);
  }, 15000);
  it('rejects a single stud carrying a long wing and checks each disconnected module fragment separately', () => {
    const model = speedModel([speedPart('3034', 'base'), speedPart('3034', 'wing-a', 1, 7, 1, 'aero'), speedPart('3710', 'wing-b', 0, -3, 1, 'aero')]);
    refreshModules(model);
    const checked = new StructuralValidator().validate(model);
    expect(checked.errors.filter(message => message.includes('独立子组件') && message.includes('aero'))).toHaveLength(2);
    expect(checked.errors.join('')).toMatch(/单一凸点/);
    expect(checked.moduleScores.find(row => row.moduleId === 'aero')!.score).toBeLessThan(50);
  });
  it('rejects use of the wheel bearing exemption to smuggle structural plates into wheel modules', () => {
    const stock = inventory(), candidate = generateVehicleCandidates(stock, options)[0];
    const part = candidate.model.parts.find(part => part.moduleId === 'front' && part.category === 'Plate')!;
    part.moduleId = 'leftWheelModule'; refreshModules(candidate.model);
    expect(new StructuralValidator().validate(candidate.model).errors.join('')).toMatch(/轴承例外仅适用于/);
  });
  it('rejects a long single-stud tile branch even when its aero module already has other strong anchors', () => {
    const stock = inventory(), candidate = generateVehicleCandidates(stock, options)[0];
    const wing = candidate.model.parts.filter(part => part.moduleId === 'aero' && part.category === 'Plate').sort((a, b) => b.position.z - a.position.z)[0];
    const appendage = speedPart('4162', 'long-tile-branch', partBoundsLdu(wing).max.x / 20 - 1, 13, 13, 'aero');
    candidate.model.parts.push(appendage); refreshModules(candidate.model);
    expect(new SpeedCollisionValidator().validate(candidate.model).valid).toBe(true);
    expect(deriveConnections(candidate.model.parts).filter(edge => edge.partA === appendage.instanceId || edge.partB === appendage.instanceId)).toHaveLength(1);
    expect(new StructuralValidator().validate(candidate.model).errors.join('')).toMatch(/单一凸点/);
  });
  it('never exempts a large compound slope staircase merely because it is labeled details', () => {
    const stock = inventory(), candidate = generateVehicleCandidates(stock, options)[0];
    candidate.model.parts = candidate.model.parts.filter(part => part.moduleId !== 'aero');
    for (let index = 0; index < 6; index++) candidate.model.parts.push(speedPart('3040b', `slope-stair-${index}`, 2, 13 + index, 9 + 3 * index, 'details'));
    refreshModules(candidate.model);
    expect(new SpeedConnectionValidator().validate(candidate.model).valid).toBe(true);
    expect(new SpeedCollisionValidator().validate(candidate.model).valid).toBe(true);
    const checked = new StructuralValidator().validate(candidate.model);
    expect(checked.valid).toBe(false);
    expect(checked.errors.join('')).toMatch(/details.*缺少至少两个|单一凸点/);
  });
  it('does not treat a frictionless wheel pin as a rigid bridge between chassis sections', () => {
    const stock = inventory(), candidate = generateVehicleCandidates(stock, options)[0], model = candidate.model;
    model.parts = model.parts.filter(part => part.moduleId !== 'aero');
    const additions = [speedPart('18975', 'hinge-inner-holder', 3, 12, 9), speedPart('3673', 'hinge-pin', 7, 13, 11.75), speedPart('18975', 'hinge-outer-holder', 7, 12, 9), speedPart('3003', 'hinge-brick', 8, 12, 10), speedPart('3020', 'hinge-plate', 11, 12, 13)];
    additions.at(-1)!.orientation.z = 90;
    model.parts.push(...additions);
    const keepRear = model.parts.find(part => part.moduleId === 'rear' && part.category === 'CurvedSlope' && part.dimensions.x >= 2);
    for (const part of model.parts) if (part.moduleId === 'rear' && part !== keepRear) part.moduleId = 'chassis';
    refreshModules(model);
    expect(graphComponents(model.parts)).toHaveLength(1);
    expect(new SpeedCollisionValidator().validate(model).valid).toBe(true);
    const checked = new StructuralValidator().validate(model);
    expect(checked.valid).toBe(false);
    expect(checked.errors.join('')).toMatch(/刚性连续连接网络/);
  });
  it('checks real quantities, dimensions, usage and module metadata independently', () => {
    const stock = inventory(), candidate = generateVehicleCandidates(stock, options)[0];
    const changed = structuredClone(candidate.model);
    const row = stock.items.find(item => item.partId === '18977')!; row.quantityAvailable = 3;
    changed.inventoryUsage[0].quantityUsed += 1;
    changed.parts[0].dimensions.x += 1;
    changed.modules[0].partIds.pop();
    expect(new SpeedInventoryValidator().validate(changed, stock).errors.join('')).toMatch(/库存超限/);
    expect(new SpeedInventoryValidator().validate(changed, stock).errors.join('')).toMatch(/用量清单/);
    expect(new SpeedInventoryValidator().validate(changed, stock).errors.join('')).toMatch(/尺寸被修改/);
    expect(new StructuralValidator().validate(changed).errors.join('')).toMatch(/归属清单/);
  });
  it('returns an explicit invalid result for NaN or extreme rotations without hanging or throwing', () => {
    const stock = inventory(), candidate = generateVehicleCandidates(stock, options)[0];
    candidate.model.parts[0].orientation.z = 1e200 as 0;
    expect(() => validateVehicle(candidate.model, stock)).not.toThrow();
    expect(validateVehicle(candidate.model, stock).valid).toBe(false);
    candidate.model.parts[0].orientation.z = 0;
    candidate.model.parts[0].position.x = Number.NaN;
    expect(validateVehicle(candidate.model, stock).valid).toBe(false);
    candidate.model.parts[0].position = null as never;
    expect(() => validateVehicle(candidate.model, stock)).not.toThrow();
    expect(validateVehicle(candidate.model, stock).valid).toBe(false);
    candidate.model.parts[0].orientation = undefined as never;
    expect(validateVehicle(candidate.model, stock).valid).toBe(false);
  });
  it('starts with the chassis and keeps every main or independent assembly prefix connected', () => {
    const stock = inventory(), candidate = generateVehicleCandidates(stock, options)[0];
    expect(candidate.steps[0].addedParts[0].moduleId).toBe('chassis');
    const seen = new Set<string>(), installed = new Set<string>();
    for (const step of candidate.steps) {
      if (step.type === 'build' || step.type === 'subassembly') {
        expect(step.addedParts.length).toBeGreaterThan(0);
        expect(step.addedParts.length).toBeLessThanOrEqual(4);
        for (const part of step.addedParts) { expect(seen.has(part.instanceId)).toBe(false); seen.add(part.instanceId); }
      }
      if (step.type === 'build' || step.type === 'attach') for (const part of step.addedParts) installed.add(part.instanceId);
      if (step.type !== 'subassembly') expect(step.totalModelState).toHaveLength(installed.size);
      expect(graphComponents(step.totalModelState)).toHaveLength(1);
    }
    expect(seen.size).toBe(candidate.model.parts.length);
    expect(buildVehicleSteps(candidate.model)).toEqual(candidate.steps);
  });
});

describe('Speed Phase 8 independently buildable subassemblies and rotation instructions', () => {
  let inventory: SpeedInventory, candidates: VehicleCandidate[];
  const options = { prompt: '原创未来跑车', vehicleType: 'supercar' as const, style: 'futuristic' as const, minifigure: false, priority: 'structure' as const, maximizeUsage: true };
  beforeAll(() => { inventory = analyzeSpeedInventories([createSpeedDemoInventory()]); candidates = generateVehicleCandidates(inventory, options); });
  const ids = (parts: SpeedPlacedPart[]) => parts.map(part => part.instanceId).sort();
  const physical = (parts: SpeedPlacedPart[]) => parts.map(({ activeConnections: _connections, buildStep: _step, ...part }) => part).sort((a, b) => a.instanceId.localeCompare(b.instanceId));
  const audit = (candidate: VehicleCandidate): void => {
    const picked = new Map<string, SpeedPlacedPart>(), independent = new Map<string, SpeedPlacedPart[]>(), attached = new Set<string>(), installed = new Set<string>();
    let main: SpeedPlacedPart[] = [];
    for (const [index, step] of candidate.steps.entries()) {
      expect(step.stepNumber).toBe(index + 1);
      expect(new Set(ids(step.totalModelState)).size).toBe(step.totalModelState.length);
      expect(graphComponents(step.totalModelState)).toHaveLength(1);
      const stateGraph = deriveConnections(step.totalModelState);
      for (const part of step.totalModelState) expect([...part.activeConnections].sort()).toEqual(stateGraph.filter(edge => edge.partA === part.instanceId || edge.partB === part.instanceId).map(edge => edge.id).sort());
      if (step.type === 'build' || step.type === 'subassembly') {
        expect(step.addedParts.length).toBeGreaterThan(0); expect(step.addedParts.length).toBeLessThanOrEqual(4);
        for (const part of step.addedParts) {
          expect(picked.has(part.instanceId)).toBe(false); picked.set(part.instanceId, part);
          expect(candidate.model.parts.find(original => original.instanceId === part.instanceId)?.buildStep).toBe(step.stepNumber);
        }
      }
      if (step.type === 'subassembly') {
        expect(step.subAssemblyId).toBeTruthy(); expect(step.parentAssembly).not.toBe('vehicle');
        const previous = independent.get(step.subAssemblyId!) ?? [];
        expect(ids(step.totalModelState)).toEqual(ids([...previous, ...step.addedParts]));
        expect(step.totalModelState.every(part => part.moduleId === step.parentAssembly && !installed.has(part.instanceId))).toBe(true);
        independent.set(step.subAssemblyId!, step.totalModelState);
        continue;
      }
      if (step.type === 'rotate') {
        expect(step.addedParts).toEqual([]); expect(step.totalModelState).toEqual(main);
        expect(step.cameraHint).toBe(step.orientation.x === 180 ? 'bottom' : 'isometric');
      } else {
        if (step.type === 'attach') {
          expect(attached.has(step.subAssemblyId!)).toBe(false); attached.add(step.subAssemblyId!);
          expect(ids(step.addedParts)).toEqual(ids(independent.get(step.subAssemblyId!) ?? []));
          const assemblyIds = new Set(ids(step.addedParts)), external = candidate.model.connections.filter(edge => assemblyIds.has(edge.partA) !== assemblyIds.has(edge.partB));
          expect(external.length).toBeGreaterThan(0);
          for (const edge of external) expect(installed.has(assemblyIds.has(edge.partA) ? edge.partB : edge.partA)).toBe(true);
          for (const part of step.addedParts) expect(physical([part])).toEqual(physical([picked.get(part.instanceId)!]));
          expect(step.description).toMatch(/不要重复取件/);
        }
        for (const part of step.addedParts) { expect(installed.has(part.instanceId)).toBe(false); installed.add(part.instanceId); }
      }
      expect(ids(step.totalModelState)).toEqual([...installed].sort());
      main = step.totalModelState;
    }
    expect([...picked.keys()].sort()).toEqual(ids(candidate.model.parts));
    expect([...installed].sort()).toEqual(ids(candidate.model.parts));
    expect(attached.size).toBe(independent.size);
    expect(physical(main)).toEqual(physical(candidate.model.parts));
  };
  it('uses each physical part once and installs every subassembly onto all existing legal anchors', () => {
    expect(candidates).toHaveLength(3);
    for (const candidate of candidates) { audit(candidate); expect(validateVehicle(candidate.model, inventory).valid).toBe(true); }
  });
  it('prebuilds four actual pin–rim–tyre chains and a wing only when its own graph is connected', () => {
    const candidate = candidates[0], attach = candidate.steps.filter(step => step.type === 'attach');
    const wheelAttach = attach.filter(step => step.addedParts.every(part => part.moduleId === 'leftWheelModule' || part.moduleId === 'rightWheelModule'));
    expect(wheelAttach).toHaveLength(4);
    for (const step of wheelAttach) expect(step.addedParts.map(part => part.partId).sort()).toEqual(['18977', '3673', '66727']);
    const wing = candidate.model.parts.filter(part => part.moduleId === 'aero');
    expect(graphComponents(wing)).toHaveLength(1);
    expect(attach.filter(step => step.addedParts.every(part => part.moduleId === 'aero'))).toHaveLength(1);
    expect(candidate.steps.filter(step => step.type === 'subassembly').every(step => !['front', 'rear'].includes(step.parentAssembly))).toBe(true);
  });
  it('inserts explicit view rotations with no material or geometry changes and leaves the final full model intact', () => {
    const candidate = candidates[0], rotations = candidate.steps.filter(step => step.type === 'rotate');
    expect(rotations.some(step => step.cameraHint === 'bottom' && step.orientation.x === 180)).toBe(true);
    expect(rotations.some(step => step.cameraHint === 'isometric' && step.orientation.x === 0)).toBe(true);
    expect(ids(candidate.steps.at(-1)!.totalModelState)).toEqual(ids(candidate.model.parts));
    expect(buildVehicleSteps(candidate.model)).toEqual(candidate.steps);
  });
  it('does not label a disconnected wide wing as a standalone subassembly', () => {
    // Explicit synthetic stock: shorter real plates force a beam seam between the
    // left / right supports. This whole wing needs the main car to stay assembled.
    const splitStock = structuredClone(inventory);
    for (const item of splitStock.items) if (item.category === 'Plate' && Math.max(item.dimensions!.x, item.dimensions!.y) > 4) item.quantityAvailable = 0;
    splitStock.items.find(item => item.partId === '3020')!.quantityAvailable += 20;
    const model = generateVehicleModel(splitStock, { ...options, prompt: '大尾翼原创跑车', style: 'aggressive' });
    const candidate = { model, validation: validateVehicle(model, splitStock), steps: buildVehicleSteps(model) };
    expect(candidate.validation.valid).toBe(true);
    expect(graphComponents(model.parts.filter(part => part.moduleId === 'aero')).length).toBeGreaterThan(1);
    expect(candidate.steps.some(step => step.type === 'subassembly' && step.parentAssembly === 'aero')).toBe(false);
    audit(candidate);
  });
  it('builds a wing in place when a later detail would otherwise create circular assembly prerequisites', () => {
    const model = structuredClone(candidates[0].model), stock = structuredClone(inventory), definition = getSpeedPartDefinition('3070b')!;
    // One explicitly supplied loose Tile, beyond the demo stock.
    const row = { partId: '3070b', name: definition.name, category: definition.category, color: { ...color }, quantityAvailable: 1, quantityUsed: 0, support: definition.support, supported: true, dimensions: definition.dimensions, sources: [] };
    stock.items.push(row);
    const beam = model.parts.find(part => part.moduleId === 'aero' && part.category === 'Plate')!, stud = worldConnectionPoints(beam).find(point => point.type === 'stud')!;
    const decoration = speedPart('3070b', 'wing-top-detail', stud.positionLdu.x / 20 - 0.5, stud.positionLdu.y / 20 - 0.5, stud.positionLdu.z / 8, 'details');
    decoration.color = { ...row.color }; model.parts.push(decoration);
    model.modules.find(module => module.id === 'details')!.partIds.push(decoration.instanceId);
    const usage = model.inventoryUsage.find(item => item.partId === row.partId && item.colorId === row.color.id);
    if (usage) usage.quantityUsed++; else model.inventoryUsage.push({ partId: row.partId, colorId: row.color.id, quantityUsed: 1, quantityAvailable: row.quantityAvailable });
    model.dimensions = vehicleDimensions(model.parts); applyVehicleConnections(model);
    const candidate = { model, validation: validateVehicle(model, stock), steps: buildVehicleSteps(model) };
    expect(candidate.validation.valid).toBe(true);
    expect(candidate.steps.some(step => step.type === 'subassembly' && step.parentAssembly === 'aero')).toBe(false);
    audit(candidate);
  });
  it('rebuilds valid instructions after local geometry edits and keeps independent snapshots immutable', () => {
    const edited = localRedesign(candidates[0], inventory, '尾翼降低一点');
    expect(edited.success).toBe(true); audit(edited.candidate);
    const clone = structuredClone(edited.candidate.model), steps = buildVehicleSteps(clone), snapshot = JSON.stringify(steps);
    clone.parts[0].position.x += 1; clone.parts[0].color.hex = '#000000';
    expect(JSON.stringify(steps)).toBe(snapshot);
  });
});

describe('Speed Phase 6 real structural alternatives and preferences', () => {
  const options = { prompt: '原创跑车', vehicleType: 'supercar' as const, style: 'modern' as const, minifigure: false, priority: 'appearance' as const, maximizeUsage: true };
  const inventory = () => analyzeSpeedInventories([createSpeedDemoInventory()]);
  it('provides three independently buildable designs with distinct geometry, not recolors', () => {
    const stock = inventory(), before = structuredClone(stock), started = Date.now();
    const candidates = generateVehicleCandidates(stock, { ...options, style: 'futuristic' });
    expect(candidates).toHaveLength(3);
    expect(new Set(candidates.map(candidate => JSON.stringify([candidate.model.parameters.wheelbase, candidate.model.parameters.cockpitPosition, candidate.model.parameters.hoodLength, candidate.model.parameters.roofHeight]))).size).toBe(3);
    expect(candidates.every(candidate => validateVehicle(candidate.model, stock).valid)).toBe(true);
    expect(candidates.every(candidate => candidate.model.inventoryUsage.find(row => row.partId === '18977')!.quantityUsed === 4)).toBe(true);
    expect(stock).toEqual(before);
    // A generous smoke bound detects accidental unbounded search, not CPU speed.
    expect(Date.now() - started).toBeLessThan(15000);
  }, 20000);
  it('lowers actual futuristic roofs and adds supported stock-colored roof and side finishes', () => {
    const stock = inventory(), modern = generateVehicleModel(stock, options), future = generateVehicleModel(stock, { ...options, style: 'futuristic' });
    expect(future.parameters.roofHeight).toBeLessThan(modern.parameters.roofHeight);
    expect(Math.max(...future.parts.filter(part => part.moduleId === 'roof').map(part => partBoundsLdu(part).max.z / 8))).toBe(future.parameters.roofHeight);
    expect(future.parts.some(part => part.moduleId === 'roof' && part.category === 'Tile' && part.color.id === 4)).toBe(true);
    expect(future.parts.some(part => part.moduleId === 'bodyShell' && part.category === 'Tile' && part.color.id === 4)).toBe(true);
    const low = generateVehicleModel(stock, { ...options, prompt: '更低矮的原创跑车' });
    expect(low.parameters.roofHeight).toBeLessThan(modern.parameters.roofHeight);
  });
  it('gives sports-car, GT and supercar different physical proportions', () => {
    const stock = inventory(), supercar = generateVehicleModel(stock, options), sports = generateVehicleModel(stock, { ...options, vehicleType: 'sports-car' }), gt = generateVehicleModel(stock, { ...options, vehicleType: 'gt' });
    expect(sports.parameters.cockpitPosition).toBeGreaterThan(supercar.parameters.cockpitPosition);
    expect(gt.parameters.wheelbase).toBeGreaterThan(sports.parameters.wheelbase);
    expect(gt.parameters.length).toBeGreaterThan(sports.parameters.length);
  });
  it('changes real wing dimensions for structural preference and explicit small/big wing prompts', () => {
    const stock = inventory();
    const width = (model: VehicleModel): number => {
      const boxes = model.parts.filter(part => part.moduleId === 'aero').map(partBoundsLdu);
      return (Math.max(...boxes.map(box => box.max.x)) - Math.min(...boxes.map(box => box.min.x))) / 20;
    };
    const structure = generateVehicleModel(stock, { ...options, priority: 'structure' });
    const appearance = generateVehicleModel(stock, options);
    const large = generateVehicleModel(stock, { ...options, prompt: '大尾翼原创跑车' });
    expect(width(structure)).toBe(4); expect(width(appearance)).toBe(6); expect(width(large)).toBe(8);
    const without = generateVehicleModel(stock, { ...options, prompt: '不要尾翼的原创跑车' });
    expect(without.parts.some(part => part.moduleId === 'aero')).toBe(false);
    expect(validateVehicle(without, stock).valid).toBe(true);
  });
  it('uses Tile for minimal style and enforces the actual dominant finish palette for color priority', () => {
    const stock = inventory();
    for (const item of stock.items.filter(item => item.category === 'CurvedSlope' || item.category === 'Slope')) item.quantityAvailable = 0;
    const sample = structuredClone(stock.items.find(item => item.partId === '15068')!);
    sample.color = { id: 1, name: '蓝色', hex: '#0055BF' }; sample.quantityAvailable = 8; stock.items.push(sample);
    const appearance = generateVehicleModel(stock, options), colorFirst = generateVehicleModel(stock, { ...options, priority: 'color' });
    expect(appearance.parts.some(part => part.category === 'CurvedSlope' && part.color.id === 1)).toBe(true);
    expect(colorFirst.parts.filter(part => ['Tile', 'CurvedSlope', 'Slope'].includes(part.category)).every(part => part.color.id === 4)).toBe(true);
    const minimal = generateVehicleModel(inventory(), { ...options, style: 'minimal' });
    expect(minimal.parts.some(part => part.category === 'CurvedSlope')).toBe(false);
    expect(minimal.parts.some(part => part.category === 'Tile')).toBe(true);
  });
});

describe('Speed Phase 7 transactional local redesign', () => {
  let stock: SpeedInventory, baseline: VehicleCandidate;
  const options = { prompt: '低矮未来跑车', vehicleType: 'supercar' as const, style: 'futuristic' as const, minifigure: false, priority: 'structure' as const, maximizeUsage: true };
  beforeAll(() => { stock = analyzeSpeedInventories([createSpeedDemoInventory()]); baseline = generateVehicleCandidates(stock, options)[0]; });
  const physical = (parts: SpeedPlacedPart[]) => parts.map(({ activeConnections: _connections, buildStep: _step, ...part }) => part).sort((a, b) => a.instanceId.localeCompare(b.instanceId));
  const fresh = () => ({ inventory: structuredClone(stock), candidate: structuredClone(baseline) });
  it('changes only front geometry, preserves model ID, increments version and reruns every hard validator', () => {
    const { inventory, candidate } = fresh(), beforeCandidate = JSON.stringify(candidate), beforeInventory = JSON.stringify(inventory);
    const result = localRedesign(candidate, inventory, '车头太高了');
    expect(result).toMatchObject({ success: true, rolledBack: false, changedModules: ['front'] });
    expect(result.candidate.model.id).toBe(candidate.model.id);
    expect(result.candidate.model.version).toBe(candidate.model.version + 1);
    expect(result.candidate.validation.valid).toBe(true);
    expect(validateVehicle(result.candidate.model, inventory).valid).toBe(true);
    expect(physical(result.candidate.model.parts.filter(part => part.moduleId !== 'front'))).toEqual(physical(candidate.model.parts.filter(part => part.moduleId !== 'front')));
    expect(JSON.stringify(candidate)).toBe(beforeCandidate); expect(JSON.stringify(inventory)).toBe(beforeInventory);
  });
  it('keeps a locked cockpit intact during front changes and rolls back a cockpit request byte-for-byte', () => {
    const { inventory, candidate } = fresh(); candidate.model.modules.find(module => module.id === 'cockpit')!.locked = true;
    const front = localRedesign(candidate, inventory, '车头太高了');
    expect(front.success).toBe(true);
    expect(front.candidate.model.modules.find(module => module.id === 'cockpit')!.locked).toBe(true);
    const before = JSON.stringify(front.candidate), rejected = localRedesign(front.candidate, inventory, '驾驶舱降低一点');
    expect(rejected).toMatchObject({ success: false, rolledBack: true, changedModules: [] });
    expect(rejected.candidate).toBe(front.candidate);
    expect(JSON.stringify(rejected.candidate)).toBe(before);
    expect(rejected.message).toMatch(/已锁定/);
  });
  it('locks and unlocks without changing physical parts, stock usage or structural version', () => {
    const { inventory, candidate } = fresh(), locked = localRedesign(candidate, inventory, '驾驶舱不要改');
    expect(locked.success).toBe(true); expect(locked.changedModules).toEqual([]);
    expect(locked.candidate.model.version).toBe(candidate.model.version);
    expect(physical(locked.candidate.model.parts)).toEqual(physical(candidate.model.parts));
    expect(locked.candidate.model.inventoryUsage).toEqual(candidate.model.inventoryUsage);
    const unlocked = localRedesign(locked.candidate, inventory, '解锁驾驶舱');
    expect(unlocked.success).toBe(true); expect(unlocked.changedModules).toEqual([]);
    expect(unlocked.candidate.model.modules.find(module => module.id === 'cockpit')!.locked).toBe(false);
    expect(unlocked.candidate.model.version).toBe(candidate.model.version);
    const combined = localRedesign(locked.candidate, inventory, '解锁驾驶舱，驾驶舱降低一点');
    expect(combined.success).toBe(false); expect(combined.candidate).toBe(locked.candidate);
    expect(combined.message).toMatch(/先单独解锁/);
  });
  it('parses separated lock scopes safely and never turns a negated edit into a positive edit', () => {
    const { inventory, candidate } = fresh();
    for (const prompt of ['车头不要降低', '车头不能降低', '不要锁定驾驶舱', '车头太高了驾驶舱不要改', '车头变成黄色，驾驶舱不要改', '车头低一点，尾翼改成蓝色', '车头加高一点，尾翼低一点', '车头不降低', '尾翼不变大', '车尾不激进', '车头低一点并往前移动两格', '驾驶舱保持原样且喷成蓝色', '驾驶舱不要改，车头降低一点再向前移动', '车头降低一点到一百格']) {
      const before = JSON.stringify(candidate), result = localRedesign(candidate, inventory, prompt);
      expect(result.success).toBe(false); expect(JSON.stringify(result.candidate)).toBe(before);
    }
    candidate.model.modules.find(module => module.id === 'front')!.locked = true;
    candidate.model.modules.find(module => module.id === 'cockpit')!.locked = true;
    const separate = localRedesign(candidate, inventory, '解锁车头但驾驶舱不要改');
    expect(separate.success).toBe(true);
    expect(separate.candidate.model.modules.find(module => module.id === 'front')!.locked).toBe(false);
    expect(separate.candidate.model.modules.find(module => module.id === 'cockpit')!.locked).toBe(true);
    expect(physical(separate.candidate.model.parts)).toEqual(physical(candidate.model.parts));
  });
  it('binds each physical action to its own clause without cross-module keyword leakage', () => {
    const { inventory, candidate } = fresh();
    const result = localRedesign(candidate, inventory, '车头降低一点，尾翼大一点');
    expect(result.success).toBe(true); expect(result.changedModules).toEqual(['front', 'aero']);
    const beforeWing = candidate.model.parts.filter(part => part.moduleId === 'aero').map(partBoundsLdu), afterWing = result.candidate.model.parts.filter(part => part.moduleId === 'aero').map(partBoundsLdu);
    expect(Math.max(...afterWing.map(box => box.max.x)) - Math.min(...afterWing.map(box => box.min.x))).toBeGreaterThan(Math.max(...beforeWing.map(box => box.max.x)) - Math.min(...beforeWing.map(box => box.min.x)));
    const kept = localRedesign(candidate, inventory, '驾驶舱保持原样，车头降低一点');
    expect(kept.success).toBe(true); expect(kept.changedModules).toEqual(['front']);
    expect(kept.candidate.model.modules.find(module => module.id === 'cockpit')!.locked).toBe(true);
    expect(physical(kept.candidate.model.parts.filter(part => part.moduleId === 'cockpit'))).toEqual(physical(candidate.model.parts.filter(part => part.moduleId === 'cockpit')));
  });
  it('shrinks a wing with real freed stock and rejects further no-op shrinking at the minimum', () => {
    const { inventory, candidate } = fresh(), result = localRedesign(candidate, inventory, '尾翼小一点');
    expect(result.success).toBe(true); expect(result.changedModules).toEqual(['aero']);
    expect(physical(result.candidate.model.parts.filter(part => part.moduleId !== 'aero'))).toEqual(physical(candidate.model.parts.filter(part => part.moduleId !== 'aero')));
    const before = JSON.stringify(result.candidate), again = localRedesign(result.candidate, inventory, '尾翼小一点');
    expect(again.success).toBe(false); expect(again.message).toMatch(/最小宽度/); expect(JSON.stringify(again.candidate)).toBe(before);
  });
  it('lowers wing height without narrowing it and never interprets minimum-width narrowing as lowering', () => {
    const { inventory, candidate } = fresh(), wider = localRedesign(candidate, inventory, '尾翼大一点');
    expect(wider.success).toBe(true);
    const bounds = (source: VehicleCandidate) => {
      const boxes = source.model.parts.filter(part => part.moduleId === 'aero').map(partBoundsLdu);
      return { width: Math.max(...boxes.map(box => box.max.x)) - Math.min(...boxes.map(box => box.min.x)), height: Math.max(...boxes.map(box => box.max.z)) };
    };
    const lowered = localRedesign(wider.candidate, inventory, '尾翼降低一点');
    expect(lowered.success).toBe(true);
    expect(bounds(lowered.candidate).width).toBe(bounds(wider.candidate).width);
    expect(bounds(lowered.candidate).height).toBeLessThan(bounds(wider.candidate).height);
    expect(physical(lowered.candidate.model.parts.filter(part => part.moduleId !== 'aero'))).toEqual(physical(wider.candidate.model.parts.filter(part => part.moduleId !== 'aero')));
    const narrow = localRedesign(candidate, inventory, '尾翼窄一点');
    expect(narrow.success).toBe(false); expect(narrow.candidate).toBe(candidate);
    const mixed = localRedesign(candidate, inventory, '尾翼降低一点，尾翼小一点');
    expect(mixed.success).toBe(false); expect(mixed.candidate).toBe(candidate);
  });
  it('lowers the original roof and cockpit together while preserving wheels and chassis', () => {
    const { inventory, candidate } = fresh(), result = localRedesign(candidate, inventory, '整辆车更低矮');
    expect(result.success).toBe(true); expect(result.changedModules).toEqual(['cockpit', 'roof']);
    expect(result.candidate.model.dimensions.z).toBeLessThan(candidate.model.dimensions.z);
    expect(result.candidate.model.parameters.roofHeight).toBeLessThan(candidate.model.parameters.roofHeight);
    expect(physical(result.candidate.model.parts.filter(part => !['cockpit', 'roof'].includes(part.moduleId)))).toEqual(physical(candidate.model.parts.filter(part => !['cockpit', 'roof'].includes(part.moduleId))));
  });
  it('changes only rear fins for an aggressive rear and never regenerates the entire car', () => {
    const { inventory, candidate } = fresh(), result = localRedesign(candidate, inventory, '车尾更加激进');
    expect(result.success).toBe(true); expect(result.changedModules).toEqual(['rear']);
    expect(physical(result.candidate.model.parts.filter(part => part.moduleId !== 'rear'))).toEqual(physical(candidate.model.parts.filter(part => part.moduleId !== 'rear')));
    expect(result.candidate.validation.valid).toBe(true);
  });
  it('rolls back true target-module shortages and unsupported intent without altering the original', () => {
    const limited = analyzeSpeedInventories([createSpeedDemoInventory()]);
    limited.items.find(item => item.partId === '3004')!.quantityAvailable = 6;
    limited.items.find(item => item.partId === '3005')!.quantityAvailable = 4;
    const model = generateVehicleModel(limited, options), source: VehicleCandidate = { model, validation: validateVehicle(model, limited), steps: buildVehicleSteps(model) };
    expect(source.validation.valid).toBe(true);
    const before = JSON.stringify(source), result = localRedesign(source, limited, '车尾更加激进');
    expect(result.success).toBe(false); expect(result.rolledBack).toBe(true); expect(result.candidate).toBe(source); expect(JSON.stringify(source)).toBe(before);
    expect(result.message).toMatch(/缺少合适/);
    const unsupported = localRedesign(source, limited, '变成一艘飞船');
    expect(unsupported.success).toBe(false); expect(unsupported.candidate).toBe(source); expect(JSON.stringify(source)).toBe(before);
  });
});
