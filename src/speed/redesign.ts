import { getSpeedPartDefinition } from './catalog.js';
import { applyVehicleConnections, canConnect, worldConnectionPoints } from './connections.js';
import { SpeedGenerationError } from './errors.js';
import { partBoundsLdu, vehicleDimensions } from './geometry.js';
import { buildVehicleSteps } from './steps.js';
import { speedPartsCollide, validateVehicle } from './validators.js';
import type { LocalRedesignResult, SpeedInventory, SpeedInventoryItem, SpeedPlacedPart, VehicleCandidate, VehicleModel, VehicleModuleId } from './types.js';

const names: Record<VehicleModuleId, string> = { chassis: '底盘', front: '车头', rear: '车尾', cockpit: '驾驶舱', roof: '车顶', leftWheelModule: '左轮组', rightWheelModule: '右轮组', bodyShell: '车身外壳', aero: '尾翼', details: '细节' };
const labels: Record<VehicleModuleId, string> = { chassis: '底盘', front: '车头|車頭|车鼻|引擎盖', rear: '车尾|車尾|尾部', cockpit: '驾驶舱|駕駛艙|座舱', roof: '车顶|車頂|顶棚', bodyShell: '车身|侧裙|外壳', aero: '尾翼', leftWheelModule: '左轮组|左轮', rightWheelModule: '右轮组|右轮', details: '细节' };
const lowerAction = '太高了?|(?:降低|低|矮)(?:一点|一些|些)?|(?:更|再)(?:低|矮|低矮)(?:一点|一些|些)?';
const matchesAction = (clause: string, module: string, action: string): boolean => new RegExp(`^(?:${module})(?:${action})$`).test(clause);
const decorative = (part: SpeedPlacedPart) => ['Tile', 'Slope', 'CurvedSlope', 'CurvedTile', 'Grille', 'RoundTile', 'Light'].includes(part.category);
const rowKey = (partId: string, colorId: number) => `${partId}:${colorId}`;
const modelHeight = (model: VehicleModel, moduleId?: VehicleModuleId): number => Math.max(...model.parts.filter(part => !moduleId || part.moduleId === moduleId).map(part => partBoundsLdu(part).max.z)) / 8;

export function localRedesign(candidate: VehicleCandidate, inventory: SpeedInventory, prompt: string): LocalRedesignResult {
  const failed = (message: string): LocalRedesignResult => ({ success: false, candidate, changedModules: [], message, rolledBack: true });
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 500) return failed('请用 1–500 字说明要局部调整的模块；原方案已保留。');
  if (!validateVehicle(candidate.model, inventory).valid) return failed('原方案未通过当前完整校验，未执行局部修改。');
  const model = structuredClone(candidate.model), changed = new Set<VehicleModuleId>(), locksChanged = new Set<VehicleModuleId>(), messages: string[] = [];
  let lowerFront = false, lowerCabin = false, lowerWhole = false, smallWing = false, largeWing = false, lowerWingOnly = false, narrowWingOnly = false, aggressiveRear = false;
  // Deliberately finite grammar: every character in every clause must belong to a
  // supported module/action. Recognizing one keyword must never discard another action.
  for (const raw of prompt.split(/[，,。；;！!\n]|但是|但|同时|并且|然后/).filter(Boolean)) {
    const clause = raw.replace(/\s+/g, '').replace(/^(?:请你|请|麻烦你|麻烦|帮我)/, '').replace(/^(?:把|将)/, '');
    const lock = (Object.keys(labels) as VehicleModuleId[]).flatMap(id => {
      const module = `(?:${labels[id]})`;
      if (new RegExp(`^(?:锁定${module}|${module}(?:锁定|不要改|不要修改|不改|保持不变|保持原样))$`).test(clause)) return [{ id, locked: true }];
      if (new RegExp(`^(?:解锁${module}|${module}解锁)$`).test(clause)) return [{ id, locked: false }];
      return [];
    })[0];
    if (lock) {
      const module = model.modules.find(module => module.id === lock.id)!;
      if (module.locked !== lock.locked) { module.locked = lock.locked; locksChanged.add(lock.id); messages.push(`${names[lock.id]}已${lock.locked ? '锁定' : '解锁'}`); }
    } else if (matchesAction(clause, labels.front, lowerAction)) lowerFront = true;
    else if (matchesAction(clause, `${labels.cockpit}|${labels.roof}|整辆(?:车)?|整车|全车`, lowerAction)) {
      lowerCabin = true; lowerWhole ||= /^(?:整辆|整车|全车)/.test(clause);
    } else if (matchesAction(clause, labels.aero, lowerAction)) lowerWingOnly = true;
    else if (matchesAction(clause, labels.aero, '(?:窄|变窄|收窄|更窄)(?:一点|一些|些)?')) narrowWingOnly = true;
    else if (matchesAction(clause, labels.aero, '(?:小|缩小|减小|更小)(?:一点|一些|些)?')) smallWing = true;
    else if (matchesAction(clause, labels.aero, '(?:大|变大|放大|加大|扩大|宽|变宽|加宽|更大|更宽)(?:一点|一些|些)?')) largeWing = true;
    else if (matchesAction(clause, labels.rear, '(?:更|更加|再)?(?:激进|凶|有攻击性)(?:一点|一些|些)?')) aggressiveRear = true;
    else return failed('该分句未完整匹配已支持的编辑规则，整次事务已回滚。请使用“车头降低一点”“尾翼小一点”“车尾更加激进”或“驾驶舱不要改”等完整例句；多个指令用逗号分开。');
  }
  if (Number(smallWing) + Number(largeWing) + Number(lowerWingOnly) + Number(narrowWingOnly) > 1) return failed('同次尾翼修改请只指定一种尺寸动作（降低、变窄、缩小或放大），已保留原方案。');
  const targets = new Set<VehicleModuleId>([...(lowerFront ? ['front' as const] : []), ...(lowerCabin ? ['cockpit' as const, 'roof' as const] : []), ...(smallWing || largeWing || lowerWingOnly || narrowWingOnly ? ['aero' as const] : []), ...(aggressiveRear ? ['rear' as const] : [])]);
  if (!targets.size && !locksChanged.size) return failed('当前支持车头降低、尾翼缩小 / 放大、车尾更激进、驾驶舱 / 车顶降低，以及明确模块锁定。未识别到新改动（或锁定状态已相同），原方案已保留。');
  for (const id of targets) if (model.modules.find(module => module.id === id)?.locked) return failed(`${names[id]}已锁定，本次修改需要调整该模块，已回滚；其他模块没有改变。`);
  let sequence = 0;
  const pool = (): Array<{ item: SpeedInventoryItem; remaining: number }> => {
    const used = new Map<string, number>();
    for (const part of model.parts) { const key = rowKey(part.partId, part.color.id); used.set(key, (used.get(key) ?? 0) + 1); }
    return inventory.items.filter(item => item.supported && getSpeedPartDefinition(item.partId)?.support === 'supported').map(item => ({ item, remaining: item.quantityAvailable - (used.get(rowKey(item.partId, item.color.id)) ?? 0) }));
  };
  const make = (item: SpeedInventoryItem, moduleId: VehicleModuleId, x: number, y: number, z: number, rotation: 0 | 90 = 0): SpeedPlacedPart => {
    const definition = getSpeedPartDefinition(item.partId)!;
    return { instanceId: `${model.id}-v${model.version + 1}-part-${++sequence}`, partId: item.partId, name: definition.name, category: definition.category, color: { ...item.color }, dimensions: { ...definition.dimensions! }, position: { x, y, z }, orientation: { x: 0, y: 0, z: rotation }, moduleId, connectionPoints: structuredClone(definition.connectionPoints), activeConnections: [], buildStep: 1 };
  };
  const hasConnection = (part: SpeedPlacedPart) => worldConnectionPoints(part).some(point => model.parts.some(other => worldConnectionPoints(other).some(existing => canConnect(point, existing))));
  const pack = (moduleId: VehicleModuleId, x: number, y: number, width: number, depth: number, z: number, height: 1 | 3): void => {
    const stock = pool().filter(row => row.remaining > 0 && row.item.category === (height === 1 ? 'Plate' : 'Brick') && row.item.dimensions?.z === height);
    const cells = new Set<string>();
    for (let dy = 0; dy < depth; dy++) for (let dx = 0; dx < width; dx++) cells.add(`${x + dx},${y + dy}`);
    let visits = 0;
    const visit = (): boolean => {
      if (!cells.size) return true;
      if (++visits > 3000) return false;
      const [px, py] = [...cells].map(cell => cell.split(',').map(Number)).sort((a, b) => a[1] - b[1] || a[0] - b[0])[0];
      const candidates = stock.filter(row => row.remaining > 0).sort((a, b) => b.item.dimensions!.x * b.item.dimensions!.y - a.item.dimensions!.x * a.item.dimensions!.y);
      for (const row of candidates) for (const rotation of (row.item.dimensions!.x === row.item.dimensions!.y ? [0] : [0, 90]) as Array<0 | 90>) {
        const dimensions = row.item.dimensions!, w = rotation ? dimensions.y : dimensions.x, d = rotation ? dimensions.x : dimensions.y;
        if (w > width || d > depth) continue;
        const occupied: string[] = [];
        for (let dy = 0; dy < d; dy++) for (let dx = 0; dx < w; dx++) occupied.push(`${px + dx},${py + dy}`);
        if (!occupied.every(cell => cells.has(cell))) continue;
        const part = make(row.item, moduleId, px + (rotation ? w : 0), py, z, rotation);
        if (!hasConnection(part) || model.parts.some(other => speedPartsCollide(part, other))) continue;
        row.remaining--; occupied.forEach(cell => cells.delete(cell)); model.parts.push(part);
        if (visit()) return true;
        model.parts.pop(); occupied.forEach(cell => cells.add(cell)); row.remaining++;
      }
      return false;
    };
    if (!visit()) throw new SpeedGenerationError(`${names[moduleId]}局部改动缺少合适的 ${width}×${depth} 真实结构件，已保留原方案。`, 'LOCAL_REDESIGN_SHORTAGE');
  };
  const originalOverall = candidate.model.dimensions.z;
  try {
    if (lowerFront) {
      const previousHeight = modelHeight(model, 'front'), oldDecorations = model.parts.filter(part => part.moduleId === 'front' && decorative(part));
      if (!oldDecorations.length) throw new SpeedGenerationError('车头已接近当前承重底盘允许的最低高度，不能在保持其他模块不变时继续降低。', 'LOCAL_REDESIGN_LIMIT');
      model.parts = model.parts.filter(part => !(part.moduleId === 'front' && decorative(part)));
      let added = 0;
      if (previousHeight > 10) {
        const preferred = oldDecorations[0]?.color.id, occupied = new Set<string>(), stock = pool().filter(row => row.remaining > 0 && row.item.category === 'Tile' && (model.options.priority !== 'color' || row.item.color.id === preferred)).sort((a, b) => Number(b.item.color.id === preferred) - Number(a.item.color.id === preferred));
        for (let y = 0; y < model.parameters.hoodLength; y++) for (let x = 1; x < 7; x++) for (const row of stock) {
          const size = row.item.dimensions!;
          if (!row.remaining || x + size.x > 7 || y + size.y > model.parameters.hoodLength) continue;
          const cells: string[] = [];
          for (let dy = 0; dy < size.y; dy++) for (let dx = 0; dx < size.x; dx++) cells.push(`${x + dx},${y + dy}`);
          if (cells.some(cell => occupied.has(cell))) continue;
          const part = make(row.item, 'front', x, y, 9);
          if (!hasConnection(part) || model.parts.some(other => speedPartsCollide(part, other))) continue;
          model.parts.push(part); row.remaining--; cells.forEach(cell => occupied.add(cell)); added++; break;
        }
      }
      const height = modelHeight(model, 'front');
      if (height >= previousHeight) throw new SpeedGenerationError('没有找到可合法降低车头的局部饰面，已回滚。', 'LOCAL_REDESIGN_LIMIT');
      changed.add('front'); messages.push(`车头由 ${previousHeight} 降至 ${height} plate；使用 ${added} 件库存 Tile，未移动底盘或驾驶舱`);
    }
    if (smallWing || largeWing || lowerWingOnly || narrowWingOnly) {
      const oldParts = model.parts.filter(part => part.moduleId === 'aero');
      if (!oldParts.length) throw new SpeedGenerationError('当前方案没有可缩放的尾翼模块。', 'LOCAL_REDESIGN_LIMIT');
      const boxes = oldParts.map(partBoundsLdu), oldWidth = (Math.max(...boxes.map(box => box.max.x)) - Math.min(...boxes.map(box => box.min.x))) / 20;
      const oldHeight = modelHeight(model, 'aero'), width = lowerWingOnly ? oldWidth : smallWing || narrowWingOnly ? Math.max(4, oldWidth - 2) : Math.min(8, oldWidth + 2), lowerWing = lowerWingOnly || smallWing && width === oldWidth;
      if (narrowWingOnly && width === oldWidth) throw new SpeedGenerationError('尾翼已经达到当前双支点规则的最小宽度；变窄指令不会改动高度，原方案已保留。', 'LOCAL_REDESIGN_LIMIT');
      if (lowerWing && oldHeight <= 11) throw new SpeedGenerationError('尾翼已经达到当前双支点规则的最小宽度与单板支柱高度，不能继续缩小；原方案已保留。', 'LOCAL_REDESIGN_LIMIT');
      if (largeWing && width === oldWidth) throw new SpeedGenerationError('尾翼已经达到当前 8-wide 规则允许的最大宽度。', 'LOCAL_REDESIGN_LIMIT');
      model.parts = model.parts.filter(part => part.moduleId !== 'aero');
      const postHeight = lowerWing || oldHeight <= 11 ? 1 : 3;
      for (const x of [2, 5]) pack('aero', x, model.parameters.length - 2, 1, 2, 9, postHeight);
      pack('aero', (8 - width) / 2, model.parameters.length - 2, width, 2, 9 + postHeight, 1);
      changed.add('aero'); messages.push(`尾翼从 ${oldWidth} 调整为 ${width} stud 宽，最高点由 ${oldHeight} 调整为 ${modelHeight(model, 'aero')} plate；保留两个双凸点支柱`);
    }
    if (lowerCabin) {
      const roofBase = Math.min(...model.parts.filter(part => part.moduleId === 'roof').map(part => part.position.z)), newBase = roofBase >= 15 ? roofBase - 3 : roofBase >= 12 ? 10 : roofBase;
      if (newBase >= roofBase) throw new SpeedGenerationError('驾驶舱已达到当前单板支柱的最低高度，不能继续降低。', 'LOCAL_REDESIGN_LIMIT');
      model.parts = model.parts.filter(part => !(part.moduleId === 'cockpit' && part.position.z >= 9));
      for (let z = 9; z < newBase; z += 3) for (const x of [2, 5]) for (const y of [model.parameters.cockpitPosition, model.parameters.cockpitPosition + 3]) pack('cockpit', x, y, 1, 1, z, newBase - z >= 3 ? 3 : 1);
      const drop = roofBase - newBase;
      for (const part of model.parts.filter(part => part.moduleId === 'roof')) part.position.z -= drop;
      model.parameters.roofHeight -= drop; changed.add('cockpit'); changed.add('roof'); messages.push(`驾驶舱支柱与原车顶共同降低 ${drop} plate，保留原车顶零件与轮组`);
    }
    if (aggressiveRear) {
      model.parts = model.parts.filter(part => !(part.moduleId === 'rear' && decorative(part)));
      for (const x of [1, 6]) pack('rear', x, model.parameters.cockpitPosition + 4, 1, 2, 9, 3);
      changed.add('rear'); messages.push('车尾增加两条有双凸点支撑的立体鳍片，最高达到 12 plate；没有移动其他模块');
    }
    model.dimensions = vehicleDimensions(model.parts);
    if (lowerWhole && model.dimensions.z >= originalOverall) throw new SpeedGenerationError('当前整车最高点由尾翼或其他保留模块决定，仅降低座舱不能降低整车外廓；已回滚。', 'LOCAL_REDESIGN_LIMIT');
    if (lowerWhole) messages.push(`整车实际外廓由 ${originalOverall} 降至 ${model.dimensions.z} plate`);
    const physical = (parts: SpeedPlacedPart[]) => JSON.stringify(parts.map(({ activeConnections: _connections, buildStep: _step, ...part }) => part).sort((a, b) => a.instanceId.localeCompare(b.instanceId)));
    for (const module of candidate.model.modules) {
      if (!targets.has(module.id) || module.locked) {
        if (physical(candidate.model.parts.filter(part => part.moduleId === module.id)) !== physical(model.parts.filter(part => part.moduleId === module.id))) throw new SpeedGenerationError(module.locked ? `${names[module.id]}在修改前已锁定；请先单独解锁，再提交结构修改。本次已回滚。` : '局部改动触及非目标模块，已自动回滚。', 'LOCKED_SPEED_MODULE');
      }
    }
    const available = new Map<string, number>();
    for (const item of inventory.items) { const key = rowKey(item.partId, item.color.id); available.set(key, (available.get(key) ?? 0) + item.quantityAvailable); }
    const usage = new Map<string, VehicleModel['inventoryUsage'][number]>();
    for (const part of model.parts) {
      const key = rowKey(part.partId, part.color.id), existing = usage.get(key);
      if (existing) existing.quantityUsed++; else usage.set(key, { partId: part.partId, colorId: part.color.id, quantityUsed: 1, quantityAvailable: available.get(key) ?? 0 });
    }
    model.inventoryUsage = [...usage.values()];
    for (const module of model.modules) module.partIds = model.parts.filter(part => part.moduleId === module.id).map(part => part.instanceId);
    applyVehicleConnections(model);
    const validation = validateVehicle(model, inventory);
    if (!validation.valid) throw new SpeedGenerationError(`局部修改未通过硬约束，已回滚：${validation.errors.join('；')}`, 'INVALID_LOCAL_REDESIGN');
    for (const module of model.modules) module.structuralScore = validation.structure.moduleScores.find(row => row.moduleId === module.id)?.score ?? 0;
    if (changed.size) {
      model.version++;
      model.designNotes = model.designNotes.filter(note => !/^实际使用 \d+ 件|^采用 .*车顶实际最高|^尾翼宽 \d+/.test(note));
      const currentCurves = model.parts.filter(part => part.category === 'CurvedSlope').length;
      model.designNotes.push(`当前模型使用 ${currentCurves} 件曲面零件，车顶最高 ${model.parameters.roofHeight} plate；用量表已按本版本重新计算。`);
    }
    model.designNotes.push(`${changed.size ? `局部修改 V${model.version}` : '模块锁定状态'}：${messages.join('；')}。`);
    return { success: true, candidate: { model, validation, steps: buildVehicleSteps(model) }, changedModules: [...changed], message: messages.join('；'), rolledBack: false };
  } catch (error) {
    if (!(error instanceof SpeedGenerationError)) throw error;
    return failed(error.message);
  }
}
