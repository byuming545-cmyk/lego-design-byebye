import type { ValidationResult } from '../types/index.js';
import { getSpeedPartDefinition } from './catalog.js';
import { deriveConnections, graphComponents, worldConnectionPoints } from './connections.js';
import { partBoundsLdu, primitiveBounds, primitivesIntersect, SPEED_EPSILON, vehicleDimensions, worldHoles, worldPrimitives, type WorldCylinder, type WorldPrimitive } from './geometry.js';
import { generatableWheelAssemblies, wheelAssemblyInterface, wheelBearingAssembly, type GeneratableWheelAssemblyDefinition } from './wheelAssemblies.js';
import type { SpeedInventory, SpeedPlacedPart, SpeedVector, StructuralValidation, VehicleModel, VehicleModuleId, VehicleValidation, WheelValidation } from './types.js';

export const validationResult = (errors: string[], warnings: string[] = []): ValidationResult => ({ valid: errors.length === 0, errors: [...new Set(errors)], warnings: [...new Set(warnings)] });
const sorted = (values: string[]) => [...values].sort();

export class SpeedConnectionValidator {
  validate(model: VehicleModel): ValidationResult {
    const errors: string[] = [];
    const ids = new Set<string>();
    let invalidPose = false;
    for (const part of model.parts) {
      if (!part.instanceId || ids.has(part.instanceId)) errors.push(`零件实例 ID 为空或重复：${part.instanceId}。`);
      ids.add(part.instanceId);
      const definition = getSpeedPartDefinition(part.partId);
      if (!definition || definition.support !== 'supported' || !definition.shape || !definition.dimensions) errors.push(`${part.instanceId} 没有已验证的 Speed 零件几何与接口。`);
      if (!(['x', 'y', 'z'] as const).every(axis => Number.isFinite(part.position?.[axis]) && [0, 90, 180, 270].includes(part.orientation?.[axis]))) { errors.push(`${part.instanceId} 的坐标或旋转无效。`); invalidPose = true; }
      if (definition && JSON.stringify(part.connectionPoints) !== JSON.stringify(definition.connectionPoints)) errors.push(`${part.instanceId} 的接口定义与目录不一致。`);
    }
    if (invalidPose) return validationResult(errors);
    const actual = deriveConnections(model.parts);
    if (JSON.stringify([...actual].sort((a, b) => a.id.localeCompare(b.id))) !== JSON.stringify([...model.connections].sort((a, b) => a.id.localeCompare(b.id)))) errors.push('Connection Graph 与按接口位置、类型和方向重新推导的实际连接不一致。');
    const occupied = new Set<string>();
    for (const edge of actual) for (const key of [`${edge.partA}/${edge.connectionPointA}`, `${edge.partB}/${edge.connectionPointB}`]) {
      if (occupied.has(key)) errors.push(`接口 ${key} 同时连接了多个零件。`);
      occupied.add(key);
    }
    for (const part of model.parts) {
      const expected = actual.filter(edge => edge.partA === part.instanceId || edge.partB === part.instanceId).map(edge => edge.id);
      if (JSON.stringify(sorted(expected)) !== JSON.stringify(sorted(part.activeConnections))) errors.push(`${part.instanceId} 的 activeConnections 与实际连接不一致。`);
      if (model.parts.length > 1 && !expected.length) errors.push(`${part.instanceId} 仅空间接触或悬空，没有合法 LEGO 连接。`);
    }
    if (!model.parts.length) errors.push('模型没有零件。');
    if (graphComponents(model.parts, actual).length > 1) errors.push('主结构存在互不连接的组件，未通过真实接口连接为整体。');
    return validationResult(errors);
  }
}

export { SpeedConnectionValidator as ConnectionValidator };

/** Only the three source-verified, exactly seated mechanical interfaces may nest. */
export function verifiedMechanicalNesting(a: SpeedPlacedPart, b: SpeedPlacedPart): boolean {
  const registered = wheelAssemblyInterface(a.partId, b.partId);
  if (!registered?.verifiedNesting) return false;
  const edges = deriveConnections([a, b]);
  if (!edges.some(edge => edge.connectionType === registered.connectionType && edge.allowsRotation === registered.allowsRotation)) return false;
  const first = worldPrimitives(a).find(shape => shape.kind === 'cylinder');
  const second = worldPrimitives(b).find(shape => shape.kind === 'cylinder');
  if (first?.kind === 'cylinder' && second?.kind === 'cylinder') {
    if (first.axis !== second.axis) return false;
    return (['x', 'y', 'z'] as const).filter(axis => axis !== first.axis).every(axis => Math.abs(first.center[axis] - second.center[axis]) < SPEED_EPSILON);
  }
  // 18975 has compound solid boxes; its circular bore is an explicitly verified
  // interface cutout. Exact pin seating above prevents a generic box exception.
  return generatableWheelAssemblies().some(assembly => assembly.holderPart === a.partId && assembly.axlePart === b.partId || assembly.holderPart === b.partId && assembly.axlePart === a.partId);
}

function coveredByBore(pin: SpeedPlacedPart, shaft: WorldCylinder, female: SpeedPlacedPart, material: WorldPrimitive): boolean {
  const box = primitiveBounds(material), axis = shaft.axis;
  const start = Math.max(box.min[axis], shaft.center[axis] - shaft.halfWidth), end = Math.min(box.max[axis], shaft.center[axis] + shaft.halfWidth);
  const holes = worldHoles(female).filter(hole => hole.axis === axis && (['x', 'y', 'z'] as const).filter(a => a !== axis).every(a => Math.abs(hole.center[a] - shaft.center[a]) < SPEED_EPSILON));
  const breaks = [...new Set([start, end, ...holes.flatMap(hole => [hole.center[axis] - hole.halfWidth, hole.center[axis] + hole.halfWidth]).filter(value => value > start && value < end)])].sort((a, b) => a - b);
  // The only intentional nominal interference is the real slotted Technic
  // retention lip: 6.5-LDU radius for two LDU at each tip, flexing into a 6-LDU
  // interface. It never grants clearance to the main shaft or collar.
  const isRetentionTip = pin.partId === '3673' && Math.abs(shaft.radius - 6.5) < SPEED_EPSILON && Math.abs(shaft.halfWidth - 1) < SPEED_EPSILON;
  for (let index = 1; index < breaks.length; index++) {
    const midpoint = (breaks[index - 1] + breaks[index]) / 2;
    const radius = Math.max(0, ...holes.filter(hole => midpoint >= hole.center[axis] - hole.halfWidth && midpoint <= hole.center[axis] + hole.halfWidth).map(hole => hole.radius));
    if (shaft.radius > radius + (isRetentionTip && radius >= 6 - SPEED_EPSILON ? 0.5 : 0) + SPEED_EPSILON) return false;
  }
  return end - start > SPEED_EPSILON && holes.length > 0;
}

function permittedInterfaceOverlap(a: SpeedPlacedPart, first: WorldPrimitive, b: SpeedPlacedPart, second: WorldPrimitive): boolean {
  if (!verifiedMechanicalNesting(a, b)) return false;
  const pair = [a.partId, b.partId].sort().join(':');
  if (pair === '18977:66727' && first.kind === 'cylinder' && second.kind === 'cylinder') {
    // Source-verified tyre bead/rim press fit. Only their narrow mating annulus
    // may overlap; unrelated solids and noncoaxial/incorrectly seated fits fail.
    return Math.max(first.innerRadius, second.innerRadius) >= 20 - SPEED_EPSILON && Math.min(first.radius, second.radius) <= 22 + SPEED_EPSILON;
  }
  if (a.partId === '3673' && first.kind === 'cylinder') return coveredByBore(a, first, b, second);
  if (b.partId === '3673' && second.kind === 'cylinder') return coveredByBore(b, second, a, first);
  return false;
}

export function speedPartsCollide(a: SpeedPlacedPart, b: SpeedPlacedPart): boolean {
  return worldPrimitives(a).some(first => worldPrimitives(b).some(second => primitivesIntersect(first, second) && !permittedInterfaceOverlap(a, first, b, second)));
}

export class SpeedCollisionValidator {
  validate(model: VehicleModel): ValidationResult {
    const errors: string[] = [];
    for (let i = 0; i < model.parts.length; i++) for (let j = i + 1; j < model.parts.length; j++) {
      if (speedPartsCollide(model.parts[i], model.parts[j])) errors.push(`实体碰撞：${model.parts[i].instanceId} 与 ${model.parts[j].instanceId}。`);
    }
    return validationResult(errors);
  }
}

export class WheelValidator {
  validate(model: VehicleModel): WheelValidation {
    const errors: string[] = [], collisions: string[] = [];
    const wheels = model.parts.filter(part => getSpeedPartDefinition(part.partId)?.category === 'Wheel');
    const tyres = model.parts.filter(part => getSpeedPartDefinition(part.partId)?.category === 'Tyre');
    const edges = deriveConnections(model.parts);
    const byId = new Map(model.parts.map(part => [part.instanceId, part]));
    const tyreAssemblies = new Map<string, GeneratableWheelAssemblyDefinition>();
    let axleConnections = 0, groundedWheels = 0;
    if (wheels.length !== 4 || tyres.length !== 4) errors.push(`需要恰好四个轮毂和四个轮胎，当前为 ${wheels.length} / ${tyres.length}。`);
    for (const wheel of wheels) {
      const definitions = generatableWheelAssemblies().filter(assembly => assembly.wheelPart === wheel.partId && assembly.compatibleWheels.includes(wheel.partId));
      if (!definitions.length) { errors.push(`${wheel.instanceId} 的轮毂尚无可生成的兼容轮组定义。`); continue; }
      const candidates = definitions.map(assembly => {
        const members = new Set<string>(), holders = new Set<string>(), queue = [wheel.instanceId];
        const assemblyEdges = edges.filter(edge => assembly.interfaces.some(iface => {
          const a = byId.get(edge.partA)?.partId, b = byId.get(edge.partB)?.partId;
          return (iface.partA === a && iface.partB === b || iface.partA === b && iface.partB === a) && edge.connectionType === iface.connectionType && edge.allowsRotation === iface.allowsRotation;
        }));
        // Traverse only registered interfaces, stopping at the fixed holder so
        // the opposite wheel never joins this independent bearing.
        while (queue.length) {
          const id = queue.pop()!, part = byId.get(id)!;
          if (part.partId === assembly.holderPart) { holders.add(id); continue; }
          if (members.has(id)) continue;
          members.add(id);
          for (const edge of assemblyEdges) {
            if (edge.partA === id) queue.push(edge.partB);
            else if (edge.partB === id) queue.push(edge.partA);
          }
        }
        const fitted = [...members].map(id => byId.get(id)!).filter(part => assembly.compatibleTyres.includes(part.partId));
        return { assembly, fitted, valid: holders.size === 1 && fitted.length === 1 && Boolean(wheelBearingAssembly([...members].map(id => byId.get(id)!), assembly.id)) };
      });
      const matched = candidates.find(candidate => candidate.valid) ?? candidates[0];
      if (!matched.valid) errors.push(`${wheel.instanceId} 缺少「${definitions.map(assembly => assembly.name).join(' / ')}」要求的独立轮胎、轮轴或合法轮架连接。`);
      else axleConnections++;
      const tyre = matched.fitted[0];
      if (tyre) tyreAssemblies.set(tyre.instanceId, matched.assembly);
      if (tyre && Math.abs(partBoundsLdu(tyre).min.z) < SPEED_EPSILON) groundedWheels++;
    }
    const cylinders = tyres.map(part => worldPrimitives(part).find(shape => shape.kind === 'cylinder')).filter(shape => shape !== undefined);
    if (tyres.some(tyre => worldPrimitives(tyre).some(shape => shape.kind === 'cylinder' && shape.axis !== (tyreAssemblies.get(tyre.instanceId)?.rotationAxis ?? 'x')))) errors.push('轮轴必须沿注册表要求的车辆横向 x 轴安装。');
    if (groundedWheels !== 4) errors.push(`四个轮胎须在同一水平面落地，当前接地 ${groundedWheels} 个。`);
    const centers = cylinders.filter(shape => shape.kind === 'cylinder').map(shape => shape.center);
    const unique = (values: number[]) => [...new Set(values.map(value => Math.round(value / SPEED_EPSILON) * SPEED_EPSILON))].sort((a, b) => a - b);
    const xs = unique(centers.map(center => center.x)), ys = unique(centers.map(center => center.y)), zs = unique(centers.map(center => center.z));
    if (xs.length !== 2 || ys.length !== 2 || zs.length !== 1 || new Set(centers.map(c => `${c.x}:${c.y}`)).size !== 4) errors.push('四个车轮的位置没有形成等高的前后双轴矩形。');
    const centerlineLdu = model.parameters.width * 10;
    if (!Number.isFinite(centerlineLdu) || xs.length === 2 && Math.abs((xs[0] + xs[1]) / 2 - centerlineLdu) > SPEED_EPSILON) errors.push('左右车轮未围绕车辆设计中心线对称。');
    if (xs.length === 2 && (xs[1] - xs[0] < 90 || xs[1] - xs[0] > 160 || Math.abs((xs[1] - xs[0]) / 20 - model.parameters.track) > SPEED_EPSILON)) errors.push('左右轮距不合理或与设计参数不一致。');
    if (ys.length === 2 && (ys[1] - ys[0] < 120 || ys[1] - ys[0] > 360 || Math.abs((ys[1] - ys[0]) / 20 - model.parameters.wheelbase) > SPEED_EPSILON)) errors.push('前后轴距不合理或与设计参数不一致。');
    for (const tyre of tyres) for (const other of model.parts) {
      if (tyre === other) continue;
      const clearance = tyreAssemblies.get(tyre.instanceId)?.minimumClearanceLdu ?? 0;
      const materialCollision = speedPartsCollide(tyre, other);
      const marginCollision = clearance > 0 && !verifiedMechanicalNesting(tyre, other) && worldPrimitives(tyre).some(shape => shape.kind === 'cylinder' && worldPrimitives(other).some(body => primitivesIntersect({ ...shape, radius: shape.radius + clearance, innerRadius: Math.max(0, shape.innerRadius - clearance), halfWidth: shape.halfWidth + clearance }, body)));
      if (!materialCollision && !marginCollision) continue;
      collisions.push(`${tyre.instanceId} 的旋转包络与 ${other.instanceId} 碰撞。`);
    }
    for (const part of model.parts.filter(part => !['Wheel', 'Tyre'].includes(getSpeedPartDefinition(part.partId)?.category ?? ''))) {
      if (partBoundsLdu(part).min.z < 1 - SPEED_EPSILON) errors.push(`${part.instanceId} 缺少基本离地间隙。`);
    }
    errors.push(...collisions);
    return { ...validationResult(errors, ['轮组按注册表中的 LDraw 接口及轴对称圆环旋转包络筛查；相同外形的旋转不会改变包络，尚不模拟花纹、形变、实物摩擦、载荷或制造公差。']), wheelCount: wheels.length, groundedWheels, collisions: [...new Set(collisions)], rotationalClearance: collisions.length === 0 && wheels.length === 4 && tyres.length === 4 && axleConnections === 4, axleConnections };
  }
}

export class SpeedInventoryValidator {
  validate(model: VehicleModel, inventory: SpeedInventory): ValidationResult {
    const errors: string[] = [], available = new Map<string, number>(), used = new Map<string, number>();
    const rowKey = (partId: string, colorId: number) => `${partId}:${colorId}`;
    for (const row of inventory.items) {
      if (!Number.isSafeInteger(row.quantityAvailable) || row.quantityAvailable < 0) { errors.push(`库存 ${row.partId} 数量无效。`); continue; }
      const definition = getSpeedPartDefinition(row.partId);
      if (!row.supported || row.support !== 'supported' || definition?.support !== 'supported') continue;
      const key = rowKey(row.partId, row.color.id); available.set(key, (available.get(key) ?? 0) + row.quantityAvailable);
    }
    for (const part of model.parts) {
      const definition = getSpeedPartDefinition(part.partId), key = rowKey(part.partId, part.color.id);
      used.set(key, (used.get(key) ?? 0) + 1);
      if (!available.has(key)) errors.push(`${part.instanceId} 使用了库存之外或未完成支持的零件 / 颜色 ${key}。`);
      const original = inventory.items.find(row => row.partId === part.partId && row.color.id === part.color.id && row.supported);
      if (original && original.color.hex.toLowerCase() !== part.color.hex.toLowerCase()) errors.push(`${part.instanceId} 的颜色显示值与真实库存不一致。`);
      if (!definition?.dimensions || definition.category !== part.category || !(['x', 'y', 'z'] as const).every(axis => definition.dimensions![axis] === part.dimensions[axis])) errors.push(`${part.instanceId} 的目录类别或尺寸被修改。`);
    }
    for (const [key, count] of used) if (count > (available.get(key) ?? 0)) errors.push(`库存超限 ${key}：使用 ${count}，可用 ${available.get(key) ?? 0}。`);
    const reported = new Map<string, number>();
    for (const row of model.inventoryUsage) {
      const key = rowKey(row.partId, row.colorId);
      if (reported.has(key) || !Number.isSafeInteger(row.quantityUsed) || row.quantityUsed <= 0 || row.quantityAvailable !== (available.get(key) ?? 0)) errors.push(`用量清单 ${key} 无效。`);
      reported.set(key, row.quantityUsed);
    }
    for (const key of new Set([...used.keys(), ...reported.keys()])) if (used.get(key) !== reported.get(key)) errors.push(`用量清单 ${key} 与实际模型不一致。`);
    const dimensions = vehicleDimensions(model.parts);
    if (!(['x', 'y', 'z'] as const).every(axis => Math.abs(dimensions[axis] - model.dimensions[axis]) < SPEED_EPSILON)) errors.push('车辆外廓尺寸与实际几何不一致。');
    return validationResult(errors);
  }
}

/** A role is a support heuristic, not permission to carry arbitrary payloads. */
export function structuralConnectionRole(part: SpeedPlacedPart): 'structural' | 'decorative' {
  return ['Tile', 'Slope', 'CurvedSlope', 'CurvedTile', 'Grille', 'RoundTile', 'Light'].includes(getSpeedPartDefinition(part.partId)?.category ?? '') ? 'decorative' : 'structural';
}
const decorative = (part: SpeedPlacedPart): boolean => structuralConnectionRole(part) === 'decorative';

export interface StructuralSupportAssessment {
  role: 'structural' | 'decorative';
  anchorCount: number;
  extentLdu: number;
  spreadLdu: number;
  longAxisSpreadLdu: number;
  issue: 'unanchored-decoration' | 'few-anchors' | 'narrow-support' | 'concentrated-long-support' | null;
  score: number;
}

/** Uses spatial support coverage, permitting legitimate small single-stud details. */
export function evaluateStructuralSupport(parts: readonly SpeedPlacedPart[], anchors: readonly SpeedVector[]): StructuralSupportAssessment {
  const boxes = parts.map(partBoundsLdu), axes = ['x', 'y', 'z'] as const;
  const lengths = axes.map(axis => boxes.length ? Math.max(...boxes.map(box => box.max[axis])) - Math.min(...boxes.map(box => box.min[axis])) : 0);
  const extentLdu = Math.max(...lengths), longAxis = axes[lengths.indexOf(extentLdu)];
  const unique = [...new Map(anchors.map(point => [`${Math.round(point.x * 1000)}:${Math.round(point.y * 1000)}:${Math.round(point.z * 1000)}`, point])).values()];
  let spreadLdu = 0;
  for (const a of unique) for (const b of unique) spreadLdu = Math.max(spreadLdu, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
  const longAxisSpreadLdu = unique.length ? Math.max(...unique.map(point => point[longAxis])) - Math.min(...unique.map(point => point[longAxis])) : 0;
  const role = parts.length > 0 && parts.every(decorative) ? 'decorative' : 'structural';
  let issue: StructuralSupportAssessment['issue'] = null;
  if (role === 'decorative' && parts.length <= 2 && extentLdu <= 40 + SPEED_EPSILON) {
    if (!unique.length) issue = 'unanchored-decoration';
  } else if (unique.length < 2 || spreadLdu < 20 - SPEED_EPSILON) issue = 'few-anchors';
  else if (extentLdu >= 120 - SPEED_EPSILON && spreadLdu < 40 - SPEED_EPSILON) issue = 'narrow-support';
  else if (extentLdu >= 200 - SPEED_EPSILON && longAxisSpreadLdu < extentLdu * 0.4 - SPEED_EPSILON) issue = 'concentrated-long-support';
  return { role, anchorCount: unique.length, extentLdu, spreadLdu, longAxisSpreadLdu, issue, score: issue ? issue === 'few-anchors' ? 30 : issue === 'unanchored-decoration' ? 0 : 50 : unique.length >= 4 || role === 'decorative' ? 100 : 90 };
}

/** Longitudinal load path and real stud bonds across same-course plate/brick seams. */
export function evaluateChassisContinuity(chassis: readonly SpeedPlacedPart[]): ValidationResult {
  const errors: string[] = [];
  const rails = chassis.filter(part => ['Plate', 'Brick', 'ModifiedPlate', 'ModifiedBrick'].includes(getSpeedPartDefinition(part.partId)?.category ?? ''));
  if (!rails.length) return validationResult(['底盘缺少可形成纵向承重路径的 Plate / Brick。']);
  const edges = deriveConnections(rails).filter(edge => !edge.allowsRotation), byId = new Map(rails.map(part => [part.instanceId, part]));
  const wheelStations = chassis.filter(part => getSpeedPartDefinition(part.partId)?.category === 'WheelHolder').flatMap(worldConnectionPoints).filter(point => point.type === 'wheelSocket' || point.type === 'wheelPin').map(point => point.positionLdu.y);
  if (wheelStations.length) {
    const front = Math.min(...wheelStations), rear = Math.max(...wheelStations);
    const spansAxles = graphComponents(rails, edges).some(component => {
      const boxes = component.map(id => partBoundsLdu(byId.get(id)!));
      return Math.min(...boxes.map(box => box.min.y)) <= front + SPEED_EPSILON && Math.max(...boxes.map(box => box.max.y)) >= rear - SPEED_EPSILON;
    });
    if (!spansAxles) errors.push('底盘 Plate / Brick 自身没有形成跨越前后轮架的连续纵向刚性路径。');
  }
  const boxes = new Map(rails.map(part => [part.instanceId, partBoundsLdu(part)]));
  const seams: Array<{ y: number; front: string; rear: string }> = [];
  for (const a of rails) for (const b of rails) {
    if (a === b) continue;
    const first = boxes.get(a.instanceId)!, second = boxes.get(b.instanceId)!;
    if (Math.abs(first.min.z - second.min.z) < SPEED_EPSILON && Math.abs(first.max.z - second.max.z) < SPEED_EPSILON && Math.abs(first.max.y - second.min.y) < SPEED_EPSILON && Math.min(first.max.x, second.max.x) - Math.max(first.min.x, second.min.x) > SPEED_EPSILON) seams.push({ y: first.max.y, front: a.instanceId, rear: b.instanceId });
  }
  for (const seam of seams) {
    const bonded = rails.some(bridge => {
      const box = boxes.get(bridge.instanceId)!;
      if (box.min.y > seam.y - 10 + SPEED_EPSILON || box.max.y < seam.y + 10 - SPEED_EPSILON) return false;
      const points = worldConnectionPoints(bridge), contacts = edges.filter(edge => (edge.connectionType === 'stud' || edge.connectionType === 'side-stud') && (edge.partA === bridge.instanceId || edge.partB === bridge.instanceId)).map(edge => ({ other: edge.partA === bridge.instanceId ? edge.partB : edge.partA, y: points.find(point => point.id === (edge.partA === bridge.instanceId ? edge.connectionPointA : edge.connectionPointB))!.positionLdu.y }));
      // A bonded seam in another rail or another course cannot stand in for
      // connections to the two actual pieces meeting at this seam.
      return contacts.some(point => point.other === seam.front && point.y <= seam.y - 10 + SPEED_EPSILON) && contacts.some(point => point.other === seam.rear && point.y >= seam.y + 10 - SPEED_EPSILON);
    });
    if (!bonded) errors.push(`底盘在纵向 ${Number((seam.y / 20).toFixed(2))} stud 的 Plate / Brick 接缝缺少两侧均有真实连接的错缝跨接件。`);
  }
  return validationResult(errors);
}

export class StructuralValidator {
  validate(model: VehicleModel): StructuralValidation {
    const errors: string[] = [], warnings: string[] = [], edges = deriveConnections(model.parts), rigidEdges = edges.filter(edge => !edge.allowsRotation);
    const moduleScores: StructuralValidation['moduleScores'] = [];
    const chassis = model.parts.filter(part => part.moduleId === 'chassis'), chassisIds = new Set(chassis.map(part => part.instanceId));
    if (!chassis.length || graphComponents(chassis, rigidEdges.filter(edge => chassisIds.has(edge.partA) && chassisIds.has(edge.partB))).length !== 1) errors.push('承重底盘本身没有形成刚性连续连接网络，不能依靠自由旋转轴承连接车架。');
    errors.push(...evaluateChassisContinuity(chassis).errors);
    const moduleIds = new Set<VehicleModuleId>();
    for (const module of model.modules) {
      if (moduleIds.has(module.id)) errors.push(`模块 ${module.id} 重复。`);
      moduleIds.add(module.id);
      const members = model.parts.filter(part => part.moduleId === module.id), ids = new Set(members.map(part => part.instanceId));
      const memberEdges = edges.filter(edge => ids.has(edge.partA) || ids.has(edge.partB));
      if (JSON.stringify(sorted([...ids])) !== JSON.stringify(sorted(module.partIds)) || JSON.stringify(sorted(memberEdges.map(edge => edge.id))) !== JSON.stringify(sorted(module.connectionIds))) errors.push(`${module.id} 模块的零件或连接归属清单不准确。`);
      if (!members.length) { moduleScores.push({ moduleId: module.id, score: 100, anchorCount: 0 }); continue; }
      if (module.id === 'chassis') { moduleScores.push({ moduleId: module.id, score: errors.some(message => message.includes('底盘')) ? 0 : 100, anchorCount: 0 }); continue; }
      const outsideParts = model.parts.filter(part => !ids.has(part.instanceId)), outsideEdges = rigidEdges.filter(edge => !ids.has(edge.partA) && !ids.has(edge.partB));
      const anchoredOutside = new Set(graphComponents(outsideParts, outsideEdges).filter(component => component.some(id => chassisIds.has(id))).flat());
      const internalEdges = module.id === 'leftWheelModule' || module.id === 'rightWheelModule' ? edges : rigidEdges;
      const components = graphComponents(members, internalEdges.filter(edge => ids.has(edge.partA) && ids.has(edge.partB)));
      let score = 100, totalAnchors = 0;
      for (const component of components) {
        const componentIds = new Set(component), componentParts = members.filter(part => componentIds.has(part.instanceId));
        if (module.id === 'leftWheelModule' || module.id === 'rightWheelModule') {
          const assemblies = generatableWheelAssemblies().filter(assembly => wheelBearingAssembly(componentParts, assembly.id));
          if (!assemblies.length) {
            errors.push(`${module.id} 的轴承例外仅适用于注册表中独立的轮轴 / 轮毂 / 轮胎总成，不能承载额外结构件。`); score = 0; continue;
          }
          const bearing = assemblies.some(assembly => edges.some(edge => {
            const insideId = componentIds.has(edge.partA) && anchoredOutside.has(edge.partB) ? edge.partA : componentIds.has(edge.partB) && anchoredOutside.has(edge.partA) ? edge.partB : undefined;
            if (!insideId) return false;
            const inside = model.parts.find(part => part.instanceId === insideId)!, outside = model.parts.find(part => part.instanceId === (insideId === edge.partA ? edge.partB : edge.partA))!;
            return outside.partId === assembly.holderPart && assembly.interfaces.some(iface => (iface.partA === inside.partId && iface.partB === outside.partId || iface.partA === outside.partId && iface.partB === inside.partId) && iface.connectionType === edge.connectionType && iface.allowsRotation && edge.allowsRotation);
          }));
          if (!bearing) { errors.push(`${module.id} 的独立轮组没有连接到已固定的轮架轴承。`); score = 0; }
          continue;
        }
        const anchors = new Map<string, { x: number; y: number; z: number }>();
        for (const edge of edges.filter(edge => edge.connectionType === 'stud' || edge.connectionType === 'side-stud')) {
          const insideId = componentIds.has(edge.partA) && anchoredOutside.has(edge.partB) ? edge.partA : componentIds.has(edge.partB) && anchoredOutside.has(edge.partA) ? edge.partB : undefined;
          if (!insideId) continue;
          const inside = model.parts.find(part => part.instanceId === insideId)!;
          const connector = worldConnectionPoints(inside).find(point => point.id === (insideId === edge.partA ? edge.connectionPointA : edge.connectionPointB))!;
          const p = connector.positionLdu; anchors.set(`${Math.round(p.x * 1000)}:${Math.round(p.y * 1000)}:${Math.round(p.z * 1000)}`, p);
        }
        totalAnchors += anchors.size;
        const support = evaluateStructuralSupport(componentParts, [...anchors.values()]);
        if (support.issue === 'unanchored-decoration') errors.push('小型细节子组件没有合法连接。');
        else if (support.issue === 'few-anchors') errors.push(`${module.id} 内的独立子组件 ${component[0]} 缺少至少两个相距 1 stud 的承重连接点。`);
        else if (support.issue === 'narrow-support') errors.push(`${module.id} 的长子组件缺少分散支撑，锚点距离至少应为 2 stud。`);
        else if (support.issue === 'concentrated-long-support') errors.push(`${module.id} 的长主梁支撑过于集中，沿主跨度的锚点覆盖不足 40%。`);
        score = Math.min(score, support.score);
      }
      moduleScores.push({ moduleId: module.id, score, anchorCount: totalAnchors });
    }
    for (const part of model.parts) if (!moduleIds.has(part.moduleId)) errors.push(`${part.instanceId} 没有所属模块记录。`);
    for (const required of ['chassis', 'front', 'rear', 'cockpit', 'bodyShell'] as VehicleModuleId[]) if (!model.parts.some(part => part.moduleId === required)) errors.push(`缺少主要模块 ${required}。`);

    // A single stud must not be a bridge carrying an entire structural cluster.
    const adjacency = new Map(model.parts.map(part => [part.instanceId, [] as Array<{ to: string; edge: number }>]));
    edges.forEach((edge, index) => { if (!edge.allowsRotation) { adjacency.get(edge.partA)?.push({ to: edge.partB, edge: index }); adjacency.get(edge.partB)?.push({ to: edge.partA, edge: index }); } });
    const entered = new Map<string, number>(), low = new Map<string, number>(), bridges: number[] = [];
    let tick = 0;
    const visit = (id: string, parentEdge = -1): void => {
      entered.set(id, ++tick); low.set(id, tick);
      for (const next of adjacency.get(id) ?? []) {
        if (next.edge === parentEdge) continue;
        if (entered.has(next.to)) low.set(id, Math.min(low.get(id)!, entered.get(next.to)!));
        else { visit(next.to, next.edge); low.set(id, Math.min(low.get(id)!, low.get(next.to)!)); if (low.get(next.to)! > entered.get(id)!) bridges.push(next.edge); }
      }
    };
    for (const part of model.parts) if (!entered.has(part.instanceId)) visit(part.instanceId);
    const root = chassis.find(part => part.category === 'Plate')?.instanceId ?? chassis[0]?.instanceId;
    for (const bridgeIndex of bridges) {
      const edge = edges[bridgeIndex];
      if (edge.connectionType !== 'stud' && edge.connectionType !== 'side-stud') continue;
      const separated = graphComponents(model.parts, edges.filter((edge, index) => !edge.allowsRotation && index !== bridgeIndex)).filter(component => !component.includes(root));
      const bearingParts = new Set(generatableWheelAssemblies().flatMap(assembly => assembly.rotatingParts.map(row => row.partId)));
      const payload = model.parts.filter(part => separated.some(component => component.includes(part.instanceId)) && !bearingParts.has(part.partId));
      const structural = payload.filter(part => !decorative(part));
      const boxes = payload.map(partBoundsLdu);
      const payloadExtent = boxes.length ? Math.max(...(['x', 'y', 'z'] as const).map(axis => Math.max(...boxes.map(box => box.max[axis])) - Math.min(...boxes.map(box => box.min[axis])))) : 0;
      if (structural.length >= 2 || payloadExtent > 40 + SPEED_EPSILON || payload.length > 2) errors.push(`单一凸点连接 ${edge.id} 承担了较大的结构组件，需要第二个独立固定点。`);
    }
    const structuralScore = Math.min(errors.length ? 49 : 100, ...moduleScores.filter(row => model.parts.some(part => part.moduleId === row.moduleId)).map(row => row.score));
    warnings.push('结构分数是连接规则符合度，不代表载荷、重心、扭矩或实物强度测试。');
    return { ...validationResult(errors, warnings), structuralScore, moduleScores };
  }
}

export function validateVehicle(model: VehicleModel, inventory: SpeedInventory): VehicleValidation {
  const connection = new SpeedConnectionValidator().validate(model);
  if (!model.parts.every(part => (['x', 'y', 'z'] as const).every(axis => Number.isFinite(part.position?.[axis]) && [0, 90, 180, 270].includes(part.orientation?.[axis])))) {
    const invalid = validationResult(['零件姿态无效，已在几何计算前停止校验。']);
    return { ...invalid, inventory: invalid, collision: invalid, connection, wheels: { ...invalid, wheelCount: 0, groundedWheels: 0, axleConnections: 0, rotationalClearance: false, collisions: [] }, structure: { ...invalid, structuralScore: 0, moduleScores: [] } };
  }
  const checkedInventory = new SpeedInventoryValidator().validate(model, inventory);
  const collision = new SpeedCollisionValidator().validate(model), wheels = new WheelValidator().validate(model), structure = new StructuralValidator().validate(model);
  const checked = [checkedInventory, collision, connection, wheels, structure];
  return { ...validationResult(checked.flatMap(result => result.errors), checked.flatMap(result => result.warnings)), inventory: checkedInventory, collision, connection, wheels, structure };
}
