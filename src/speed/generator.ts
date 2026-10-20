import { getSpeedPartDefinition } from './catalog.js';
import { applyVehicleConnections, canConnect, graphComponents, worldConnectionPoints } from './connections.js';
import { SpeedGenerationError } from './errors.js';
import { partBoundsLdu, SPEED_EPSILON, vehicleDimensions } from './geometry.js';
import { SpeedCollisionValidator, SpeedConnectionValidator, speedPartsCollide, validateVehicle, WheelValidator } from './validators.js';
import { buildVehicleSteps } from './steps.js';
import type { SpeedInventory, SpeedInventoryItem, SpeedPlacedPart, VehicleCandidate, VehicleDesignOptions, VehicleModel, VehicleModuleId } from './types.js';

export { SpeedGenerationError } from './errors.js';
interface Stock { item: SpeedInventoryItem; remaining: number; available: number }
const moduleNames: Record<VehicleModuleId, string> = { chassis: '交错承重底盘', front: '车头与长引擎盖', rear: '车尾', cockpit: '驾驶舱框架', roof: '车顶', leftWheelModule: '左侧轮组', rightWheelModule: '右侧轮组', bodyShell: '宽体侧裙', aero: '双支点尾翼', details: '车身细节' };
const key = (partId: string, colorId: number) => `${partId}:${colorId}`;
const pointKey = (point: { x: number; y: number; z: number }) => `${Math.round(point.x * 1000)}:${Math.round(point.y * 1000)}:${Math.round(point.z * 1000)}`;

export function generateVehicleModel(inventory: SpeedInventory, options: VehicleDesignOptions, variant = 0): VehicleModel {
  const deadline = Date.now() + 4000;
  const checkBudget = () => { if (Date.now() > deadline) throw new SpeedGenerationError('当前库存的结构搜索超出计算预算，请减少合并套装或调整车型后重试；这不表示现实中一定无法拼搭。', 'SPEED_SEARCH_BUDGET_EXCEEDED'); };
  if (!options || !['supercar', 'sports-car', 'gt', 'concept'].includes(options.vehicleType) || !['modern', 'futuristic', 'retro', 'aggressive', 'minimal'].includes(options.style) || !['structure', 'appearance', 'color'].includes(options.priority) || typeof options.prompt !== 'string' || typeof options.maximizeUsage !== 'boolean' || typeof options.minifigure !== 'boolean') throw new SpeedGenerationError('Speed 设计参数无效。', 'INVALID_SPEED_OPTIONS');
  if (/\bf1\b|方程式|卡车|卡車|摩托|motorcycle|\btruck\b/i.test(options.prompt)) throw new SpeedGenerationError('V0.2 当前支持 Supercar、Sports Car、GT 与 Concept Car；暂不支持 F1、卡车或摩托。', 'UNSUPPORTED_SPEED_VEHICLE');
  if (options.minifigure) throw new SpeedGenerationError('当前尚未完成可容纳人仔的驾驶舱、挡风玻璃与头部净空组合验证。请关闭人仔要求；不会将普通封闭盒子标记为可容纳人仔。', 'MINIFIGURE_CONFIGURATION_UNSUPPORTED');
  const stocks = new Map<string, Stock>();
  for (const item of inventory.items) {
    if (!Number.isSafeInteger(item.quantityAvailable) || item.quantityAvailable < 0) throw new SpeedGenerationError('库存数量无效。', 'INVALID_SPEED_INVENTORY');
    const definition = getSpeedPartDefinition(item.partId);
    if (!item.supported || definition?.support !== 'supported' || !definition.dimensions || !definition.shape || !item.quantityAvailable) continue;
    const id = key(item.partId, item.color.id), existing = stocks.get(id);
    if (existing) { existing.remaining += item.quantityAvailable; existing.available += item.quantityAvailable; }
    else stocks.set(id, { item, remaining: item.quantityAvailable, available: item.quantityAvailable });
  }
  const stock = [...stocks.values()];
  const missing = ([['18975', 2], ['3673', 4], ['66727', 4], ['18977', 4]] as const).filter(([id, needed]) => stock.filter(entry => entry.item.partId === id).reduce((sum, entry) => sum + entry.remaining, 0) < needed);
  if (missing.length) throw new SpeedGenerationError(`当前库存缺少已验证现代轮组的关键零件：${missing.map(([id, needed]) => `${id} 至少 ${needed} 件`).join('、')}。不会按 Wheel 类别强行替代不兼容轮毂。`, 'MISSING_SPEED_PARTS');
  const parts: SpeedPlacedPart[] = [];
  let sequence = 0;
  const make = (entry: Stock, moduleId: VehicleModuleId, x: number, y: number, z: number, rotation: 0 | 90 | 180 | 270 = 0): SpeedPlacedPart => {
    const definition = getSpeedPartDefinition(entry.item.partId)!;
    return { instanceId: `speed-part-${String(++sequence).padStart(3, '0')}`, partId: definition.partId, name: definition.name, category: definition.category, color: { ...entry.item.color }, dimensions: { ...definition.dimensions! }, position: { x, y, z }, orientation: { x: 0, y: 0, z: rotation }, moduleId, connectionPoints: structuredClone(definition.connectionPoints), activeConnections: [], buildStep: 1 };
  };
  const take = (partId: string, moduleId: VehicleModuleId, x: number, y: number, z: number, rotation: 0 | 180 = 0): SpeedPlacedPart => {
    const entry = stock.filter(row => row.item.partId === partId && row.remaining).sort((a, b) => b.remaining - a.remaining)[0];
    if (!entry) throw new SpeedGenerationError(`缺少关键零件 ${partId}；无法完成真实现代轮组 / 底盘。`, 'MISSING_SPEED_PARTS');
    const placed = make(entry, moduleId, x, y, z, rotation); entry.remaining--; parts.push(placed); return placed;
  };

  /** Exact inventory-constrained tiling; every non-base course needs real studs. */
  const pack = (moduleId: VehicleModuleId, x: number, y: number, width: number, depth: number, z: number, height: 1 | 3, allowUnanchored = false): void => {
    if (!width || !depth) return;
    const remaining = new Set<string>();
    for (let dy = 0; dy < depth; dy++) for (let dx = 0; dx < width; dx++) remaining.add(`${x + dx},${y + dy}`);
    const prior = [...parts], groups = graphComponents(prior), componentOf = new Map(groups.flatMap((ids, index) => ids.map(id => [id, index] as const)));
    const topPoints = new Map<string, number[]>();
    for (const point of prior.flatMap(worldConnectionPoints).filter(point => point.type === 'stud' && point.worldDirection.z > 0.9 && Math.abs(point.positionLdu.z - z * 8) < SPEED_EPSILON)) {
      const id = pointKey(point.positionLdu); topPoints.set(id, [...(topPoints.get(id) ?? []), componentOf.get(point.partId)!]);
    }
    const candidates = stock.filter(entry => entry.remaining && getSpeedPartDefinition(entry.item.partId)!.category === (height === 1 ? 'Plate' : 'Brick') && getSpeedPartDefinition(entry.item.partId)!.dimensions!.z === height);
    const placed: Array<{ part: SpeedPlacedPart; entry: Stock; occupied: string[]; contacts: number[] }> = [];
    let visits = 0;
    const visit = (): boolean => {
      checkBudget();
      if (!remaining.size) return true;
      if (++visits > 12000) return false;
      const [px, py] = [...remaining].map(cell => cell.split(',').map(Number)).sort((a, b) => a[1] - b[1] || a[0] - b[0])[0];
      const roots = groups.map((_, index) => index);
      const root = (id: number): number => roots[id] === id ? id : (roots[id] = root(roots[id]));
      for (const previous of placed) for (const id of previous.contacts.slice(1)) roots[root(id)] = root(previous.contacts[0]);
      const choices: Array<{ part: SpeedPlacedPart; entry: Stock; occupied: string[]; contacts: number[]; joins: number; bondLead: number }> = [];
      for (const entry of candidates) {
        checkBudget();
        if (!entry.remaining) continue;
        const dimensions = getSpeedPartDefinition(entry.item.partId)!.dimensions!;
        for (const rotation of (dimensions.x === dimensions.y ? [0] : [0, 90]) as Array<0 | 90>) {
          const w = rotation ? dimensions.y : dimensions.x, d = rotation ? dimensions.x : dimensions.y;
          if (w > width || d > depth) continue;
          const occupied: string[] = [];
          for (let dy = 0; dy < d; dy++) for (let dx = 0; dx < w; dx++) occupied.push(`${px + dx},${py + dy}`);
          if (!occupied.every(cell => remaining.has(cell))) continue;
          const part = make(entry, moduleId, px + (rotation ? w : 0), py, z, rotation);
          const contacts = worldConnectionPoints(part).filter(point => point.type === 'antiStud' && point.worldDirection.z < -0.9).flatMap(point => topPoints.get(pointKey(point.positionLdu)) ?? []);
          if (!allowUnanchored && !contacts.length) continue;
          const bondLead = moduleId === 'chassis' && z === 6 && placed.length === 0 && w === width && d <= 2 ? d === 1 ? 2 : 1 : 0;
          choices.push({ part, entry, occupied, contacts, joins: new Set(contacts.map(root)).size, bondLead });
        }
      }
      choices.sort((a, b) => b.bondLead - a.bondLead || b.joins - a.joins || b.occupied.length - a.occupied.length || b.contacts.length - a.contacts.length || b.entry.remaining - a.entry.remaining);
      for (const choice of choices) {
        choice.occupied.forEach(cell => remaining.delete(cell)); choice.entry.remaining--; placed.push(choice);
        if (visit()) return true;
        placed.pop(); choice.entry.remaining++; choice.occupied.forEach(cell => remaining.add(cell));
      }
      return false;
    };
    if (!visit()) throw new SpeedGenerationError(`库存无法完成「${moduleNames[moduleId]}」的 ${width}×${depth} 承重区域；需要更多 ${height === 1 ? 'Plate' : 'Brick'}，没有使用替代占位零件。`, 'INSUFFICIENT_SPEED_STRUCTURE');
    parts.push(...placed.map(item => item.part));
  };

  const length = options.vehicleType === 'gt' || variant === 2 ? 16 : 14;
  const requestedLow = /低矮|低趴|贴地|更低|low.?slung/i.test(options.prompt);
  const roofBase = variant === 2 ? 10 : requestedLow || options.style === 'futuristic' || options.style === 'minimal' ? 12 : 15;
  const cockpitShift = /长车头|长引擎盖|long.*hood/i.test(options.prompt) ? 1 : /驾驶舱前移|前移驾驶舱/i.test(options.prompt) ? -1 : 0;
  const baseCockpit = options.vehicleType === 'concept' ? 5 : options.vehicleType === 'gt' ? variant === 1 ? 8 : 7 : options.vehicleType === 'sports-car' ? variant === 1 ? 6 : 7 : 6;
  const cockpitStart = Math.max(5, Math.min(length - 7, baseCockpit + cockpitShift));
  const requestedSmallWing = /小尾翼|尾翼小|smaller.*wing/i.test(options.prompt), requestedBigWing = /大尾翼|尾翼.*大|large.*wing/i.test(options.prompt);
  const wingWidth = /无尾翼|不要尾翼|没有尾翼/i.test(options.prompt) ? 0 : requestedSmallWing ? 4 : requestedBigWing || options.style === 'aggressive' ? 8 : options.priority === 'structure' || options.style === 'minimal' ? 4 : 6;
  const frontAxle = 3, rearAxle = length - 3;
  // Reserve real load-bearing roof/wing plates before optional wide bodywork
  // consumes short pieces. They are committed only after their supports exist.
  pack('roof', 2, cockpitStart, 4, 4, roofBase, 1, true);
  const reservedRoof = parts.splice(0);
  if (wingWidth) pack('aero', (8 - wingWidth) / 2, length - 2, wingWidth, 2, 12, 1, true);
  const reservedWing = parts.splice(0);
  // Recessed modern holders and filler bricks form level, real stud surfaces.
  for (const y of [frontAxle - 1, rearAxle - 1]) {
    take('18975', 'chassis', 2, y, 1);
    pack('chassis', 3, y, 2, 2, 2, 3);
  }
  pack('chassis', 2, 0, 4, length, 5, 1, true);
  pack('chassis', 2, 0, 4, length, 6, 1);
  for (const y of [frontAxle, rearAxle]) for (const left of [true, false]) {
    const moduleId = left ? 'leftWheelModule' : 'rightWheelModule';
    take('3673', moduleId, left ? 2 : 6, y, 3.75);
    take('66727', moduleId, left ? 1.5 : 6.5, y, 3.75, left ? 180 : 0);
    take('18977', moduleId, left ? 1.2 : 6.8, y, 3.75, left ? 180 : 0);
  }
  pack('front', 2, 0, 4, frontAxle + 2, 7, 1);
  pack('rear', 2, rearAxle - 2, 4, length - (rearAxle - 2), 7, 1);
  pack('bodyShell', 0, frontAxle + 2, 8, rearAxle - frontAxle - 4, 7, 1);
  pack('cockpit', 2, cockpitStart, 4, 4, 8, 1);
  pack('front', 1, 0, 6, cockpitStart, 8, 1);
  pack('rear', 1, cockpitStart + 4, 6, length - cockpitStart - 4, 8, 1);
  for (let z = 9; z < roofBase; z += 3) for (const x of [2, 5]) for (const y of [cockpitStart, cockpitStart + 3]) pack('cockpit', x, y, 1, 1, z, roofBase - z >= 3 ? 3 : 1);
  parts.push(...reservedRoof);
  // Two widely separated bearing posts, rather than a single-stud rear wing.
  if (wingWidth) for (const x of [2, 5]) pack('aero', x, length - 2, 1, 2, 9, 3);
  parts.push(...reservedWing);

  let curvedDetails = 0, roofTiles = 0, sideTiles = 0;
  const paintAreas = new Map<number, number>();
  for (const entry of stock.filter(row => ['CurvedSlope', 'Slope', 'Tile'].includes(row.item.category))) paintAreas.set(entry.item.color.id, (paintAreas.get(entry.item.color.id) ?? 0) + entry.available * entry.item.dimensions!.x * entry.item.dimensions!.y);
  const paintColor = [...paintAreas].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
  const existingPoints = parts.flatMap(worldConnectionPoints);
  const decorateRect = (moduleId: VehicleModuleId, startX: number, startY: number, width: number, maxDepth: number, z: number, tilesOnly = false): void => {
    const occupied = new Set<string>();
    const score = (entry: Stock): number => {
      const definition = getSpeedPartDefinition(entry.item.partId)!;
      const color = Number(entry.item.color.id === paintColor) * (options.priority === 'color' ? 100 : 10);
      if (options.style === 'retro' || options.priority === 'color') return color + Number(definition.category === 'Tile') * 20;
      return color + Number(definition.category === 'CurvedSlope') * 20 + (options.style === 'aggressive' ? definition.dimensions!.y * 2 : definition.dimensions!.x * 2);
    };
    const candidates = stock.filter(entry => entry.remaining && (tilesOnly || options.style === 'minimal' ? entry.item.category === 'Tile' : ['CurvedSlope', 'Slope', 'Tile'].includes(entry.item.category)) && (options.priority !== 'color' || entry.item.color.id === paintColor)).sort((a, b) => score(b) - score(a));
    for (let y = startY; y < startY + maxDepth; y++) for (let x = startX; x < startX + width; x++) {
      for (const entry of candidates) {
        checkBudget();
        if (!entry.remaining) continue;
        const definition = getSpeedPartDefinition(entry.item.partId)!, size = definition.dimensions!;
        if (x + size.x > startX + width || y + size.y > startY + maxDepth) continue;
        const cells: string[] = [];
        for (let dy = 0; dy < size.y; dy++) for (let dx = 0; dx < size.x; dx++) cells.push(`${x + dx},${y + dy}`);
        if (cells.some(cell => occupied.has(cell))) continue;
        const part = make(entry, moduleId, x, y, z), points = worldConnectionPoints(part);
        if (!points.some(point => existingPoints.some(existing => canConnect(point, existing))) || parts.some(other => speedPartsCollide(part, other))) continue;
        entry.remaining--; parts.push(part); existingPoints.push(...points); cells.forEach(cell => occupied.add(cell)); curvedDetails += Number(definition.category === 'CurvedSlope'); roofTiles += Number(moduleId === 'roof'); sideTiles += Number(moduleId === 'bodyShell'); break;
      }
    }
  };
  decorateRect('front', 1, 0, 6, options.maximizeUsage ? cockpitStart : Math.min(options.style === 'aggressive' ? 3 : 2, cockpitStart), 9);
  decorateRect('rear', 1, cockpitStart + 4, 6, Math.max(0, length - (cockpitStart + 4) - (wingWidth ? 2 : 0)), 9);
  decorateRect('roof', 2, cockpitStart, 4, 4, roofBase + 1, true);
  for (const x of [0, 7]) decorateRect('bodyShell', x, frontAxle + 2, 1, rearAxle - frontAxle - 4, 8, true);
  const actualRoofHeight = Math.max(...parts.filter(part => part.moduleId === 'roof').map(part => partBoundsLdu(part).max.z)) / 8;
  const usage = new Map<string, VehicleModel['inventoryUsage'][number]>();
  for (const part of parts) {
    const id = key(part.partId, part.color.id), row = usage.get(id);
    if (row) row.quantityUsed++;
    else usage.set(id, { partId: part.partId, colorId: part.color.id, quantityUsed: 1, quantityAvailable: stocks.get(id)!.available });
  }
  const model: VehicleModel = {
    id: `speed-${Date.now().toString(36)}-${variant}`, name: `${options.vehicleType === 'gt' ? '长轴 GT' : options.vehicleType === 'concept' ? '前移驾驶舱概念车' : '宽体原创跑车'}`,
    description: `基于实际库存，以底盘和真实轮组为先的 ${options.style} ${options.vehicleType} 规则设计。`, vehicleType: options.vehicleType, style: options.style, options: { ...options },
    parameters: { width: 8, length, wheelbase: rearAxle - frontAxle, track: 5.6, cockpitPosition: cockpitStart, hoodLength: cockpitStart, roofHeight: actualRoofHeight },
    parts, connections: [], modules: (Object.keys(moduleNames) as VehicleModuleId[]).map(id => ({ id, name: moduleNames[id], partIds: parts.filter(part => part.moduleId === id).map(part => part.instanceId), connectionIds: [], locked: false, structuralScore: 0 })),
    dimensions: vehicleDimensions(parts), inventoryUsage: [...usage.values()], designNotes: [
      '使用两层交错 Plate 底盘跨接前后 18975 轮架，连接依据真实凸点位置；中间填充砖补齐轮架凹台。',
      '分配库存时先预留承重车顶与跨接尾翼板，避免装饰消耗掉关键结构件。',
      '四轮采用 18975 → 3673 无摩擦 Pin → 66727 轮毂 → 18977 轮胎；不是将轮胎贴在车身侧面。',
      '宽体侧裙仅放在前后车轮之间，轮位处保留完整轮胎旋转空间；车宽约 8 stud。',
      `实际使用 ${curvedDetails} 件已支持曲面零件；所有装饰均来自库存，未使用尚未校准的挡风玻璃或轮拱。`,
      `采用 ${roofBase === 15 ? '双层砖高车柱' : roofBase === 12 ? '单层砖低车柱' : '单板低矮座舱支柱'}；车顶实际最高 ${actualRoofHeight} plate，车顶 / 侧裙增加 ${roofTiles} / ${sideTiles} 件库存饰面。`,
      wingWidth ? `尾翼宽 ${wingWidth} stud，以两个相距 3 stud 的双凸点支柱固定；${options.priority === 'structure' ? '结构偏好优先缩短悬臂' : '造型 / 配色偏好保留更宽的轮廓'}。` : '根据“不要尾翼”规则移除了 aero 模块，未额外消耗尾翼零件。',
      options.priority === 'color' ? `颜色偏好：可选饰面限制为库存覆盖面积最大的颜色 ID ${paintColor}；承重零件仍按实际库存配色。` : `风格 ${options.style} 实际控制支柱高度、尾翼宽度及 Tile / 曲面饰面的选择顺序。`,
      '驾驶舱使用四柱与可拆车顶，未声明可容纳人仔；当前不使用未验证的透明挡风件。',
      '当前描述通过有限规则和显式车型选项控制，不调用语言模型；未识别的文字细节不会作为已完成效果宣称。',
      options.maximizeUsage ? '增加了有实际凸点支撑的引擎盖饰面；不为耗尽库存而加入松散零件。' : '保留库存余量，优先完成承重底盘、轮组及双支点尾翼。',
    ], version: 1,
  };
  applyVehicleConnections(model);
  for (const validator of [new SpeedConnectionValidator(), new SpeedCollisionValidator(), new WheelValidator()]) {
    const checked = validator.validate(model);
    if (!checked.valid) throw new SpeedGenerationError(`车辆未通过 ${validator.constructor.name}：${checked.errors.join('；')}`, 'INVALID_SPEED_GENERATION');
  }
  return model;
}

/** Each alternative starts with the same untouched inventory, never pooled usage. */
export function generateVehicleCandidates(inventory: SpeedInventory, options: VehicleDesignOptions): VehicleCandidate[] {
  const directions: VehicleDesignOptions[] = [options, { ...options, vehicleType: options.vehicleType === 'gt' ? 'sports-car' : 'gt', style: options.vehicleType === 'gt' ? 'futuristic' : 'retro' }, { ...options, vehicleType: 'concept', style: 'minimal' }];
  const candidates: VehicleCandidate[] = [], failures: string[] = [], signatures = new Set<string>(), started = Date.now();
  for (const [index, direction] of directions.entries()) {
    if (Date.now() - started > 9500) { failures.push('额外候选因总搜索预算停止'); break; }
    try {
      const model = generateVehicleModel(inventory, direction, index), validation = validateVehicle(model, inventory);
      if (!validation.valid) throw new SpeedGenerationError(`车辆未通过完整硬约束：${validation.errors.join('；')}`, 'INVALID_SPEED_GENERATION');
      const signature = JSON.stringify([model.parameters.length, model.parameters.wheelbase, model.parameters.cockpitPosition, model.parameters.hoodLength, model.parameters.roofHeight]);
      if (signatures.has(signature)) continue;
      signatures.add(signature); model.name = `${String.fromCharCode(65 + candidates.length)} · ${model.name}`;
      model.designNotes.push('各候选是同一库存的替代设计，独立通过库存校验；不表示一盒零件可同时搭建所有候选。');
      for (const module of model.modules) module.structuralScore = validation.structure.moduleScores.find(score => score.moduleId === module.id)?.score ?? 0;
      candidates.push({ model, validation, steps: buildVehicleSteps(model) });
    } catch (error) {
      if (!(error instanceof SpeedGenerationError)) throw error;
      if (['MINIFIGURE_CONFIGURATION_UNSUPPORTED', 'UNSUPPORTED_SPEED_VEHICLE', 'INVALID_SPEED_OPTIONS', 'MISSING_SPEED_PARTS', 'INVALID_SPEED_INVENTORY'].includes(error.code)) throw error;
      failures.push(`${String.fromCharCode(65 + index)} 方向：${error.message}`);
    }
  }
  if (!candidates.length) throw new SpeedGenerationError(`没有通过全部硬约束的车辆方案：${failures.join('；')}`, 'NO_VALID_SPEED_DESIGN');
  if (failures.length) for (const candidate of candidates) candidate.model.designNotes.push(`仅展示 ${candidates.length} 个合法候选。其他方向未输出：${failures.join('；')}`);
  return candidates;
}
