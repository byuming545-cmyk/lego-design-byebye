import { randomUUID } from 'node:crypto';
import { InventoryError } from '../inventory/index.js';
import { getSpeedPartDefinition } from './catalog.js';
import { applyVehicleConnections } from './connections.js';
import { createSpeedDocument, MAX_IMPORTED_SPEED_PARTS, MAX_SPEED_DOCUMENT_BYTES, safeSpeedModelId, type SpeedModelDocument, type SpeedModelMetadata } from './documents.js';
import { vehicleDimensions } from './geometry.js';
import { addSpeedExtraParts } from './inventory.js';
import { parseVehicleOptions, SPEED_MODULE_IDS } from './requests.js';
import { buildVehicleSteps } from './steps.js';
import { validateVehicle } from './validators.js';
import type { SpeedExtraPart, SpeedInventory, SpeedPlacedPart, VehicleCandidate, VehicleModel, VehicleModuleId } from './types.js';
import { SPEED_ARCHIVE_SCHEMA_VERSION } from './versions.js';
import { SPEED_STEP_ENCODING, unpackCandidateSteps } from './stepCodec.js';

type ObjectValue = Record<string, unknown>;
function invalid(message = '模型 JSON 不符合受支持的 schemaVersion 1 格式。'): never {
  throw new InventoryError(message, 'INVALID_SPEED_MODEL_DOCUMENT', 400);
}
function object(value: unknown, allowed: string[], required = allowed): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key))) invalid();
  return value as ObjectValue;
}
function text(value: unknown, max = 200, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) invalid('模型 JSON 含无效或过长的文本字段。');
  return value;
}
function integer(value: unknown, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) invalid('模型 JSON 含无效或超限的数量。');
  return Number(value);
}
function list(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) invalid('模型 JSON 列表超过安全上限。');
  return value;
}
function strings(value: unknown, maxCount: number, maxLength = 200): string[] { return list(value, maxCount).map(entry => text(entry, maxLength)); }
function vector(value: unknown, positive = false) {
  const input = object(value, ['x', 'y', 'z']);
  for (const axis of ['x', 'y', 'z']) if (typeof input[axis] !== 'number' || !Number.isFinite(input[axis]) || Number(input[axis]) > 1024 || Number(input[axis]) < (positive ? Number.MIN_VALUE : -1024)) invalid('模型坐标或尺寸须为有限数值并在安全范围内。');
  return { x: Number(input.x), y: Number(input.y), z: Number(input.z) };
}
function color(value: unknown) {
  const input = object(value, ['id', 'name', 'hex']);
  const hex = text(input.hex, 7);
  if (!/^#[A-Fa-f0-9]{6}$/.test(hex)) invalid('模型库存颜色必须使用 #RRGGBB。');
  return { id: integer(input.id, 0, 1_000_000), name: text(input.name, 100), hex: hex.toUpperCase() };
}
function partId(value: unknown): string {
  const id = text(value, 80);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(id)) invalid('零件编号无效。');
  return id;
}
function equal(a: unknown, b: unknown): boolean {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)])) : value;
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

function importedInventory(value: unknown): SpeedInventory {
  const input = object(value, ['setNumber', 'name', 'source', 'sourceLabel', 'inventorySources', 'items', 'analysis', 'warnings']);
  text(input.setNumber, 1000); text(input.name, 1000); text(input.sourceLabel, 2000);
  if (!['mock', 'rebrickable', 'mixed'].includes(input.source as string)) invalid('模型库存来源类型无效。');
  strings(input.warnings, 200, 2000);
  const analysis = object(input.analysis, ['totalQuantity', 'supportedQuantity', 'partiallySupportedQuantity', 'unsupportedQuantity', 'usableQuantity', 'supportRate', 'missingRequirements', 'canGenerate']);
  for (const key of ['totalQuantity', 'supportedQuantity', 'partiallySupportedQuantity', 'unsupportedQuantity', 'usableQuantity']) integer(analysis[key], 0, 1_000_000);
  if (typeof analysis.supportRate !== 'number' || !Number.isFinite(analysis.supportRate) || analysis.supportRate < 0 || analysis.supportRate > 1 || typeof analysis.canGenerate !== 'boolean') invalid('库存分析字段格式无效。');
  strings(analysis.missingRequirements, 100, 2000);
  const sourceMap = new Map<string, string>();
  const sources = list(input.inventorySources, 30).map((value, index) => {
    const source = object(value, ['sourceId', 'setNumber', 'name', 'source', 'quantity', 'snapshotId', 'fetchedAt', 'sparePolicy', 'themeId'], ['sourceId', 'setNumber', 'name', 'source', 'quantity']);
    const oldId = text(source.sourceId, 160);
    if (sourceMap.has(oldId) || !['mock', 'rebrickable', 'custom'].includes(source.source as string)) invalid('模型库存来源重复或无效。');
    if (source.snapshotId !== undefined) text(source.snapshotId, 120);
    if (source.fetchedAt !== undefined && !Number.isFinite(Date.parse(text(source.fetchedAt, 40)))) invalid('库存抓取时间无效。');
    if (source.sparePolicy !== undefined && source.sparePolicy !== 'excluded') invalid('库存备件策略无效。');
    if (source.themeId !== undefined) integer(source.themeId, 0, 1_000_000);
    const sourceId = `import:source:${index + 1}`;
    sourceMap.set(oldId, sourceId);
    return { sourceId, setNumber: text(source.setNumber, 100), name: `${text(source.name, 300)}（导入自报）`, source: 'custom' as const, quantity: integer(source.quantity, 1, 100) };
  });
  if (!sources.length) invalid('模型库存必须保留至少一项自报来源。');
  const traces = new Map<string, SpeedInventory['items'][number]['sources']>();
  const extras: SpeedExtraPart[] = [];
  let total = 0;
  for (const value of list(input.items, 2000)) {
    const item = object(value, ['partId', 'name', 'category', 'color', 'quantityAvailable', 'quantityUsed', 'support', 'supported', 'dimensions', 'sources']);
    const id = partId(item.partId), itemColor = color(item.color), quantity = integer(item.quantityAvailable, 1, 1_000_000);
    text(item.name, 300); text(item.category, 40);
    integer(item.quantityUsed, 0, quantity);
    if (!['supported', 'partiallySupported', 'unsupported'].includes(item.support as string) || typeof item.supported !== 'boolean') invalid('库存支持状态字段格式无效。');
    if (item.dimensions !== null) vector(item.dimensions, true);
    const key = `${id}:${itemColor.id}`;
    if (traces.has(key)) invalid('库存不能包含重复的零件 / 颜色行。');
    const seenSources = new Set<string>();
    let traced = 0;
    const itemSources = list(item.sources, 30).map(value => {
      const source = object(value, ['sourceId', 'setNumber', 'quantity']);
      const sourceId = sourceMap.get(text(source.sourceId, 160));
      if (!sourceId || seenSources.has(sourceId)) invalid('库存数量来源缺失或重复。');
      seenSources.add(sourceId);
      const setNumber = text(source.setNumber, 100);
      if (sources.find(source => source.sourceId === sourceId)!.setNumber !== setNumber) invalid('库存数量来源的套装编号不一致。');
      const quantity = integer(source.quantity, 1, 1_000_000);
      traced += quantity;
      return { sourceId, setNumber, quantity };
    });
    if (traced !== quantity) invalid('库存数量与来源数量总和不一致。');
    traces.set(key, itemSources);
    total += quantity;
    if (total > 1_000_000) invalid('导入库存超过 1,000,000 件安全上限。');
    for (let remaining = quantity; remaining > 0; remaining -= 1000) extras.push({ partId: id, color: itemColor, quantity: Math.min(1000, remaining) });
  }
  if (!extras.length) invalid('模型库存没有零件。');
  let inventory: SpeedInventory = {
    setNumber: sources.map(source => source.setNumber).join(' + '), name: '用户导入库存', source: 'mixed',
    sourceLabel: 'JSON 导入 · 数量、颜色及套装来源为用户自报，未核验', inventorySources: [], items: [], warnings: [],
    analysis: { totalQuantity: 0, supportedQuantity: 0, partiallySupportedQuantity: 0, unsupportedQuantity: 0, usableQuantity: 0, supportRate: 0, missingRequirements: [], canGenerate: false },
  };
  // The existing loose-stock path derives every support/geometry flag from our catalog.
  for (let index = 0; index < extras.length; index += 100) inventory = addSpeedExtraParts(inventory, extras.slice(index, index + 100));
  inventory.sourceLabel = 'JSON 导入 · 数量、颜色及套装来源为用户自报，未核验';
  inventory.inventorySources = sources;
  for (const item of inventory.items) item.sources = traces.get(`${item.partId}:${item.color.id}`)!;
  inventory.warnings = [...new Set([...inventory.warnings, 'JSON 中的库存来源、数量与颜色为用户自报；导入不会建立官方或 Rebrickable 核验记录。'])];
  return inventory;
}

/** Treat imported validation, graph, support flags and instructions as untrusted claims. */
export function parseImportedSpeedDocument(value: unknown): SpeedModelDocument {
  const root = object(value, ['schemaVersion', 'metadata', 'candidate', 'inventory']);
  if (root.schemaVersion !== SPEED_ARCHIVE_SCHEMA_VERSION) invalid('仅支持 schemaVersion 1 模型 JSON；旧 V0.2 文件请重新生成后导出。');
  let serialized: string;
  try { serialized = JSON.stringify(value); } catch { invalid('模型 JSON 必须是无循环的普通数据。'); }
  if (Buffer.byteLength(serialized) > MAX_SPEED_DOCUMENT_BYTES) throw new InventoryError('模型 JSON 超过 40 MB 安全上限。', 'SPEED_MODEL_TOO_LARGE', 413);
  const metadata = object(root.metadata, ['modelId', 'generatedAt', 'updatedAt', 'generatorVersion', 'validatorVersion', 'partLibraryVersion', 'revision', 'modelDigest', 'physicalValidation', 'origin', 'sourceSets', 'snapshotIds', 'importedFrom'], ['modelId', 'generatedAt', 'updatedAt', 'generatorVersion', 'validatorVersion', 'partLibraryVersion', 'revision', 'modelDigest', 'physicalValidation', 'origin', 'sourceSets', 'snapshotIds']);
  const originalId = safeSpeedModelId(metadata.modelId);
  const generatedAt = text(metadata.generatedAt, 40);
  if (!Number.isFinite(Date.parse(generatedAt)) || !Number.isFinite(Date.parse(text(metadata.updatedAt, 40)))) invalid('模型生成日期无效。');
  integer(metadata.revision, 1, 1_000_000);
  if (!/^[a-f0-9]{64}$/.test(text(metadata.modelDigest, 64)) || !['untested', 'passed'].includes(metadata.physicalValidation as string) || !['generated', 'imported'].includes(metadata.origin as string)) invalid('模型版本元数据无效。');
  const importedFrom: SpeedModelMetadata['importedFrom'] = {
    modelId: originalId, generatedAt, generatorVersion: text(metadata.generatorVersion, 80), validatorVersion: text(metadata.validatorVersion, 80), partLibraryVersion: text(metadata.partLibraryVersion, 80),
    sourceSets: strings(metadata.sourceSets, 30, 100), snapshotIds: strings(metadata.snapshotIds, 30, 120),
  };
  if (metadata.importedFrom !== undefined) {
    const previous = object(metadata.importedFrom, ['modelId', 'generatedAt', 'generatorVersion', 'validatorVersion', 'partLibraryVersion', 'sourceSets', 'snapshotIds'], ['modelId', 'generatedAt', 'generatorVersion', 'validatorVersion', 'partLibraryVersion']);
    safeSpeedModelId(previous.modelId); text(previous.generatedAt, 40);
    for (const key of ['generatorVersion', 'validatorVersion', 'partLibraryVersion']) text(previous[key], 80);
    if (previous.sourceSets !== undefined) strings(previous.sourceSets, 30, 100);
    if (previous.snapshotIds !== undefined) strings(previous.snapshotIds, 30, 120);
  }
  const candidate = object(root.candidate, ['model', 'validation', 'steps', 'stepEncoding'], ['model', 'validation', 'steps']);
  if (candidate.stepEncoding !== undefined && candidate.stepEncoding !== SPEED_STEP_ENCODING) invalid('步骤编码版本不受支持。');
  object(candidate.validation, Object.keys(candidate.validation && typeof candidate.validation === 'object' && !Array.isArray(candidate.validation) ? candidate.validation : {}), []);
  list(candidate.steps, MAX_IMPORTED_SPEED_PARTS * 4 + 20);
  const input = object(candidate.model, ['id', 'name', 'description', 'vehicleType', 'style', 'options', 'parameters', 'parts', 'connections', 'modules', 'dimensions', 'inventoryUsage', 'designNotes', 'version']);
  if (input.id !== originalId) invalid('模型 ID 与元数据 ID 不一致。');
  const options = parseVehicleOptions(input.options);
  if (options.minifigure) invalid('当前版本不支持导入声明已完成人仔空间的模型。');
  if (input.vehicleType !== options.vehicleType || input.style !== options.style) invalid('模型车型 / 风格与设计选项不一致。');
  const parameters = object(input.parameters, ['width', 'length', 'wheelbase', 'track', 'cockpitPosition', 'hoodLength', 'roofHeight']);
  for (const [key, value] of Object.entries(parameters)) if (typeof value !== 'number' || !Number.isFinite(value) || value > 1024 || value < (['cockpitPosition', 'hoodLength'].includes(key) ? 0 : Number.MIN_VALUE)) invalid('车辆参数不在安全范围内。');
  const rawParts = list(input.parts, MAX_IMPORTED_SPEED_PARTS);
  if (!rawParts.length) invalid('模型必须包含零件。');
  const inventory = importedInventory(root.inventory), seenParts = new Set<string>();
  let points = 0;
  const parts: SpeedPlacedPart[] = rawParts.map(value => {
    const part = object(value, ['instanceId', 'partId', 'name', 'category', 'color', 'dimensions', 'position', 'orientation', 'moduleId', 'connectionPoints', 'activeConnections', 'buildStep']);
    const instanceId = text(part.instanceId, 120), id = partId(part.partId), definition = getSpeedPartDefinition(id);
    if (seenParts.has(instanceId)) invalid('模型含重复的零件实例 ID。');
    seenParts.add(instanceId);
    if (!definition || definition.support !== 'supported' || !definition.dimensions || !definition.shape) invalid(`零件 ${id} 尚无完整本地几何，不能作为可拼模型导入。`);
    text(part.name, 300);
    const suppliedPoints = list(part.connectionPoints, definition.connectionPoints.length);
    for (const value of suppliedPoints) {
      const point = object(value, ['id', 'type', 'localPosition', 'direction', 'compatibleTypes', 'fitFamily', 'allowsRotation'], ['id', 'type', 'localPosition', 'direction', 'compatibleTypes']);
      text(point.id, 120); text(point.type, 40); vector(point.localPosition); vector(point.direction); strings(point.compatibleTypes, 8, 40);
      if (point.fitFamily !== undefined) text(point.fitFamily, 120);
      if (point.allowsRotation !== undefined && typeof point.allowsRotation !== 'boolean') invalid('接口旋转属性无效。');
    }
    if (part.category !== definition.category || !equal(vector(part.dimensions, true), definition.dimensions) || !equal(suppliedPoints, definition.connectionPoints)) invalid(`零件 ${instanceId} 的类别、尺寸或接口与本地目录不一致；已拒绝导入。`);
    points += definition.connectionPoints.length;
    if (points > 4000) invalid('模型接口总量超过 4000 个安全计算上限。');
    const position = vector(part.position), orientation = object(part.orientation, ['x', 'y', 'z']);
    if (Object.values(orientation).some(value => ![0, 90, 180, 270].includes(value as number))) invalid('零件旋转只允许 0/90/180/270 度。');
    if (!SPEED_MODULE_IDS.includes(part.moduleId as VehicleModuleId)) invalid('零件模块编号无效。');
    strings(part.activeConnections, 4000, 1000); integer(part.buildStep, 1, MAX_IMPORTED_SPEED_PARTS * 4 + 20);
    return { instanceId, partId: id, name: definition.name, category: definition.category, color: color(part.color), dimensions: { ...definition.dimensions }, position, orientation: orientation as unknown as SpeedPlacedPart['orientation'], moduleId: part.moduleId as VehicleModuleId, connectionPoints: structuredClone(definition.connectionPoints), activeConnections: [], buildStep: 1 };
  });
  const seenModules = new Set<string>();
  const modules = list(input.modules, SPEED_MODULE_IDS.length).map(value => {
    const module = object(value, ['id', 'name', 'partIds', 'connectionIds', 'locked', 'structuralScore']);
    if (!SPEED_MODULE_IDS.includes(module.id as VehicleModuleId) || seenModules.has(module.id as string) || typeof module.locked !== 'boolean') invalid('模块 ID 重复或模块格式无效。');
    seenModules.add(module.id as string);
    const members = strings(module.partIds, MAX_IMPORTED_SPEED_PARTS, 120);
    if (!equal([...members].sort(), parts.filter(part => part.moduleId === module.id).map(part => part.instanceId).sort())) invalid('模块的零件归属清单与模型不一致。');
    strings(module.connectionIds, 4000, 1000);
    if (typeof module.structuralScore !== 'number' || !Number.isFinite(module.structuralScore) || module.structuralScore < 0 || module.structuralScore > 100) invalid('模块结构分数无效。');
    return { id: module.id as VehicleModuleId, name: text(module.name, 200), partIds: members, connectionIds: [], locked: module.locked, structuralScore: 0 };
  });
  for (const part of parts) if (!seenModules.has(part.moduleId)) invalid('模型零件的所属模块不存在。');
  for (const value of list(input.connections, 4000)) {
    const edge = object(value, ['id', 'partA', 'connectionPointA', 'partB', 'connectionPointB', 'connectionType', 'allowsRotation']);
    text(edge.id, 1000); text(edge.connectionPointA, 120); text(edge.connectionPointB, 120);
    if (!seenParts.has(text(edge.partA, 120)) || !seenParts.has(text(edge.partB, 120)) || !['stud', 'side-stud', 'wheel-axle', 'tyre-fit'].includes(edge.connectionType as string) || typeof edge.allowsRotation !== 'boolean') invalid('连接图格式或零件引用无效。');
  }
  const usage = new Map<string, VehicleModel['inventoryUsage'][number]>();
  for (const part of parts) {
    const key = `${part.partId}:${part.color.id}`, row = usage.get(key);
    if (row) row.quantityUsed++;
    else usage.set(key, { partId: part.partId, colorId: part.color.id, quantityUsed: 1, quantityAvailable: inventory.items.find(item => item.partId === part.partId && item.color.id === part.color.id)?.quantityAvailable ?? 0 });
  }
  for (const value of list(input.inventoryUsage, MAX_IMPORTED_SPEED_PARTS)) {
    const row = object(value, ['partId', 'colorId', 'quantityUsed', 'quantityAvailable']);
    partId(row.partId); integer(row.colorId, 0, 1_000_000); integer(row.quantityUsed, 1, MAX_IMPORTED_SPEED_PARTS); integer(row.quantityAvailable, 1, 1_000_000);
  }
  const dimensions = vehicleDimensions(parts);
  if (!equal(vector(input.dimensions, true), dimensions)) invalid('车辆整体尺寸与实际零件几何不一致。');
  const model: VehicleModel = {
    id: randomUUID(), name: text(input.name, 300), description: text(input.description, 2000, true),
    vehicleType: options.vehicleType, style: options.style, options, parameters: parameters as unknown as VehicleModel['parameters'],
    parts, connections: [], modules, dimensions, inventoryUsage: [...usage.values()], designNotes: [...strings(input.designNotes, 100, 2000), '由用户 JSON 导入；已用当前本地目录重建连接、自动校验及说明书，库存来源未经核验。'], version: integer(input.version, 1, 1_000_000),
  };
  // Decode only after the complete model / stock schema passed the cheap checks.
  try { if ((candidate.steps as unknown[]).length) unpackCandidateSteps(root.candidate); }
  catch { invalid('模型拼搭步骤编码无效或超过安全上限。'); }
  applyVehicleConnections(model);
  const validation = validateVehicle(model, inventory);
  if (!validation.valid) throw new InventoryError(`导入模型未通过当前自动校验：${validation.errors.join('；')}`, 'SPEED_IMPORTED_MODEL_INVALID', 422);
  for (const module of model.modules) module.structuralScore = validation.structure.moduleScores.find(item => item.moduleId === module.id)?.score ?? 0;
  let steps: VehicleCandidate['steps'];
  try { steps = buildVehicleSteps(model); }
  catch { throw new InventoryError('导入模型不能生成连贯的拼搭步骤。', 'SPEED_IMPORTED_INSTRUCTIONS_INVALID', 422); }
  return createSpeedDocument({ model, validation, steps }, inventory, { origin: 'imported', importedFrom, snapshotIds: [] });
}
