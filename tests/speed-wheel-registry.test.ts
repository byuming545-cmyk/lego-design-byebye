import { beforeAll, describe, expect, it, vi } from 'vitest';
import { getSpeedPartDefinition } from '../src/speed/catalog.js';
import { applyVehicleConnections, deriveConnections, worldConnectionPoints } from '../src/speed/connections.js';
import { generateVehicleModel } from '../src/speed/generator.js';
import { partBoundsLdu } from '../src/speed/geometry.js';
import { analyzeSpeedInventories, createSpeedDemoInventory } from '../src/speed/inventory.js';
import { evaluateChassisContinuity, evaluateStructuralSupport, SpeedCollisionValidator, SpeedConnectionValidator, speedPartsCollide, structuralConnectionRole, StructuralValidator, WheelValidator } from '../src/speed/validators.js';
import { discoverAvailableWheelAssemblies, generatableWheelAssemblies, selectWheelAssembly, WHEEL_ASSEMBLY_REGISTRY, type WheelAssemblyPose } from '../src/speed/wheelAssemblies.js';
import type { SpeedPlacedPart, VehicleModel } from '../src/speed/types.js';

function place(pose: WheelAssemblyPose, id: string): SpeedPlacedPart {
  const definition = getSpeedPartDefinition(pose.partId)!;
  return { instanceId: id, partId: pose.partId, name: definition.name, category: definition.category, color: { id: 0, name: 'Black', hex: '#000000' }, dimensions: { ...definition.dimensions! }, position: { x: 4 + pose.offset.x, y: 3 + pose.offset.y, z: pose.offset.z }, orientation: { ...pose.orientation }, moduleId: pose.role === 'holder' ? 'chassis' : 'leftWheelModule', connectionPoints: structuredClone(definition.connectionPoints), activeConnections: [], buildStep: 1 };
}

describe('wheel compatibility registry and stock discovery', () => {
  it('keeps the uncalibrated classic combination out of automatic selection', () => {
    const stock = analyzeSpeedInventories([createSpeedDemoInventory()]);
    const classic = WHEEL_ASSEMBLY_REGISTRY.find(entry => entry.wheelPart === '4624')!;
    expect(classic.status).toBe('recognizedOnly');
    expect(generatableWheelAssemblies()).toHaveLength(2);
    for (const row of stock.items.filter(row => ['18975', '3673', '66727', '18977'].includes(row.partId))) row.quantityAvailable = 0;
    for (const partId of ['4600', '4624', '3641']) {
      const definition = getSpeedPartDefinition(partId)!;
      stock.items.push({ ...structuredClone(stock.items[0]), partId, name: definition.name, category: definition.category, support: 'supported', supported: true, quantityAvailable: 100 });
    }
    expect(selectWheelAssembly(stock.items)).toBeUndefined();
    expect(discoverAvailableWheelAssemblies(stock.items).every(entry => !entry.available && entry.completeVehicles === 0)).toBe(true);
  });

  it('aggregates colors while requiring four independent pins and all measured constituent parts', () => {
    const stock = analyzeSpeedInventories([createSpeedDemoInventory()]);
    const pin = stock.items.find(row => row.partId === '3673')!;
    pin.quantityAvailable = 2;
    stock.items.push({ ...structuredClone(pin), color: { id: 1, name: 'Blue', hex: '#0055BF' } });
    expect(selectWheelAssembly(stock.items)?.wheelPart).toBe('66727');
    stock.items.at(-1)!.quantityAvailable = 1;
    expect(selectWheelAssembly(stock.items)).toBeUndefined();
    expect(discoverAvailableWheelAssemblies(stock.items)[0].missing).toContainEqual({ partId: '3673', required: 4, available: 3 });
    stock.items.at(-1)!.quantityAvailable = 2;
    stock.items.find(row => row.partId === '18975')!.supported = false;
    expect(selectWheelAssembly(stock.items)).toBeUndefined();
  });

  it('places both sides as seated mechanical chains, with grounded tyres and clear material', () => {
    const assembly = generatableWheelAssemblies()[0];
    const holder = place(assembly.poses.holder, 'holder');
    const parts = [holder, ...assembly.poses.left.map((pose, index) => place(pose, `left-${index}`)), ...assembly.poses.right.map((pose, index) => place(pose, `right-${index}`))];
    const connections = deriveConnections(parts);
    expect(connections.filter(edge => edge.connectionType === 'wheel-axle')).toHaveLength(4);
    expect(connections.filter(edge => edge.connectionType === 'tyre-fit')).toHaveLength(2);
    for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) expect(speedPartsCollide(parts[i], parts[j]), `${parts[i].instanceId} / ${parts[j].instanceId}`).toBe(false);
    for (const tyre of parts.filter(part => part.category === 'Tyre')) expect(partBoundsLdu(tyre).min.z).toBe(0);

    // Reversing the left rim keeps its center close but points the socket away
    // from its pin; category matching must not invent a mechanical connection.
    const reversed = parts.find(part => part.instanceId === 'left-1')!;
    reversed.orientation.z = 0;
    expect(deriveConnections(parts).filter(edge => (edge.partA === reversed.instanceId || edge.partB === reversed.instanceId) && edge.connectionType === 'wheel-axle')).toHaveLength(0);
  });
});

function ordinaryPart(partId: string, instanceId: string, x = 0, y = 0, z = 0): SpeedPlacedPart {
  return place({ partId, role: 'holder', offset: { x: x - 4, y: y - 3, z }, orientation: { x: 0, y: 0, z: 0 } }, instanceId);
}
function realAnchors(part: SpeedPlacedPart, parts: SpeedPlacedPart[]) {
  const points = worldConnectionPoints(part);
  return deriveConnections(parts).filter(edge => edge.partA === part.instanceId || edge.partB === part.instanceId).map(edge => points.find(point => point.id === (edge.partA === part.instanceId ? edge.connectionPointA : edge.connectionPointB))!.positionLdu);
}

describe('structural support evidence from placed geometry', () => {
  it('accepts a small single-stud decorative tile while requiring stronger support for a brick', () => {
    const base = ordinaryPart('3024', 'base'), tile = ordinaryPart('3070b', 'tile', 0, 0, 1), brick = ordinaryPart('3005', 'brick', 0, 0, 1);
    expect(structuralConnectionRole(tile)).toBe('decorative');
    expect(evaluateStructuralSupport([tile], realAnchors(tile, [base, tile])).issue).toBeNull();
    expect(evaluateStructuralSupport([brick], realAnchors(brick, [base, brick])).issue).toBe('few-anchors');
  });

  it('rejects six clustered studs under a long beam and accepts widely distributed support', () => {
    const beam = ordinaryPart('4282', 'beam', 0, 0, 1);
    const shortBase = ordinaryPart('3021', 'short-base'), longBase = ordinaryPart('3029', 'long-base');
    const concentrated = [shortBase, beam], distributed = [longBase, beam];
    expect(new SpeedCollisionValidator().validate({ parts: concentrated } as VehicleModel).valid).toBe(true);
    expect(realAnchors(beam, concentrated)).toHaveLength(6);
    expect(evaluateStructuralSupport([beam], realAnchors(beam, concentrated)).issue).toBe('concentrated-long-support');
    expect(evaluateStructuralSupport([beam], realAnchors(beam, distributed)).issue).toBeNull();
  });

  it('requires a plate seam to be crossed by a part with real stud bonds on both sides', () => {
    const front = ordinaryPart('3020', 'front'), rear = ordinaryPart('3020', 'rear', 0, 4);
    const staggered = ordinaryPart('3020', 'staggered', 0, 2, 1);
    expect(evaluateChassisContinuity([front, rear, staggered]).valid).toBe(true);
    // The second cap is flush with the seam; visual contact creates no bond.
    const frontCap = ordinaryPart('3020', 'front-cap', 0, 0, 1), rearCap = ordinaryPart('3020', 'rear-cap', 0, 4, 1);
    const aligned = [front, rear, frontCap, rearCap];
    expect(deriveConnections(aligned)).toHaveLength(16);
    expect(evaluateChassisContinuity(aligned).errors.join('')).toMatch(/错缝跨接/);
    const otherRail = [ordinaryPart('3020', 'other-front', 4), ordinaryPart('3020', 'other-rear', 4, 4), ordinaryPart('3020', 'other-stagger', 4, 2, 1)];
    expect(evaluateChassisContinuity([...aligned, ...otherRail]).errors.join('')).toMatch(/错缝跨接/);
  });
});

describe('registry driven generation and independent validation', () => {
  const inventory = () => analyzeSpeedInventories([createSpeedDemoInventory()]);
  const options = { prompt: '原创跑车', vehicleType: 'supercar' as const, style: 'modern' as const, priority: 'structure' as const, maximizeUsage: false, minifigure: false };
  let baseline: VehicleModel;
  beforeAll(() => { baseline = generateVehicleModel(inventory(), options); });

  it('keeps unique model identities even when the clock does not advance', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    try {
      const first = generateVehicleModel(inventory(), options), second = generateVehicleModel(inventory(), options);
      expect(first.id).not.toBe(second.id);
      expect(first.id).toMatch(/^speed-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    } finally { clock.mockRestore(); }
  });

  it('rejects a mechanically intact wheel rectangle shifted away from the design centerline', () => {
    expect(new WheelValidator().validate(baseline).valid).toBe(true);
    const shifted = structuredClone(baseline);
    for (const part of shifted.parts) part.position.x += 1;
    applyVehicleConnections(shifted);
    expect(new SpeedConnectionValidator().validate(shifted).valid).toBe(true);
    expect(new WheelValidator().validate(shifted).errors.join('')).toMatch(/中心线对称/);
  });

  it('applies concentrated long-beam support rules to an otherwise connected vehicle', () => {
    const model = structuredClone(baseline);
    model.parts = model.parts.filter(part => !(part.moduleId === 'roof' && part.category === 'Tile'));
    const roof = model.parts.filter(part => part.moduleId === 'roof');
    const top = Math.max(...roof.map(part => partBoundsLdu(part).max.z)) / 8;
    const start = model.parameters.cockpitPosition + 1;
    const beam = ordinaryPart('4282', 'concentrated-long-beam', 2, start, top); beam.moduleId = 'aero';
    model.parts.push(beam);
    for (const module of model.modules) module.partIds = model.parts.filter(part => part.moduleId === module.id).map(part => part.instanceId);
    applyVehicleConnections(model);
    expect(new SpeedConnectionValidator().validate(model).valid).toBe(true);
    expect(new SpeedCollisionValidator().validate(model).valid).toBe(true);
    expect(new StructuralValidator().validate(model).errors.join('')).toMatch(/长主梁支撑过于集中/);
  });
});
