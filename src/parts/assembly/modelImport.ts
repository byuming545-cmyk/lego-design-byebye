import { createHash, randomUUID } from 'node:crypto';
import type { AttachmentEngine } from './engine.js';
import { NATIVE_MODULE_TYPES, type NativeGeneratedAssembly, type NativeSourceReference } from './generator.js';
import { isRigidTransform } from './math.js';

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,999}$/.test(value);
const connectionId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 1000 && !/[\u0000-\u001f\u007f]/.test(value);
export class NativeModelImportError extends Error {}
export interface NativeModelImportResult {
  status: 'VALID' | 'NEEDS_REVALIDATION';
  reasons: string[];
  originalModelId: string;
  model: NativeGeneratedAssembly | null;
  physicalBuildVerified: false;
  validationScope: 'source-interfaces-final-pose-graph-only';
}

/** An uploaded checksum is integrity only. Current source, permissions and graph checks remain authoritative. */
export async function inspectNativeModelImport(value: unknown, engine: AttachmentEngine): Promise<NativeModelImportResult> {
  if (!object(value) || value.schemaVersion !== 1 || !id(value.id) || !NATIVE_MODULE_TYPES.includes(value.module as NativeGeneratedAssembly['module']) ||
      !Array.isArray(value.placements) || value.placements.length < 1 || value.placements.length > 32 ||
      !Array.isArray(value.edges) || value.edges.length > 4096 || !object(value.sourceHashes) ||
      !Array.isArray(value.sources) || value.sources.length > 20000 || !Array.isArray(value.bom) || value.bom.length > 32 ||
      !Array.isArray(value.steps) || value.steps.length > 32 || value.physicalBuildVerified !== false ||
      value.ownership !== 'virtual-design-not-owned' || value.colorAvailability !== 'not-verified' ||
      typeof value.contentSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.contentSha256)) throw new NativeModelImportError('请选择真实装配生成器导出的有效 JSON 模型。');
  for (const placement of value.placements) {
    if (!object(placement) || !id(placement.instanceId) || !id(placement.partId) || !isRigidTransform(placement.transform)) throw new NativeModelImportError('模型含无效实例、零件编号或非刚性变换。');
  }
  for (const edge of value.edges) {
    if (!object(edge) || !['id', 'fixedInstanceId', 'movingInstanceId', 'ruleId'].every(key => id(edge[key])) || !connectionId(edge.fixedConnectionId) || !connectionId(edge.movingConnectionId)) throw new NativeModelImportError('模型含无效连接图记录。');
  }
  const { contentSha256, ...document } = value;
  if (createHash('sha256').update(JSON.stringify(document)).digest('hex') !== contentSha256) throw new NativeModelImportError('模型内容校验失败，文件可能已被修改。');
  const model = value as unknown as NativeGeneratedAssembly;
  const reasons: string[] = [];
  for (const [key, version] of Object.entries(engine.versions)) {
    if (model[key as keyof typeof engine.versions] !== version) reasons.push(`${key} 已变化，旧装配证明需重新验证。`);
  }
  // Check every actual part and endpoint even when an old version already prevents adoption.
  for (const placement of model.placements) {
    const part = await engine.getPart(placement.partId), capability = await engine.getCapability(placement.partId);
    if (!part) reasons.push(`原生零件 ${placement.partId} 已不存在。`);
    if (!capability?.generatable || !capability.assemblyVerified) reasons.push(`零件 ${placement.partId} 当前没有生成准入。`);
  }
  const placements = new Map(model.placements.map(placement => [placement.instanceId, placement]));
  for (const edge of model.edges) for (const [instanceId, connectionId] of [[edge.fixedInstanceId, edge.fixedConnectionId], [edge.movingInstanceId, edge.movingConnectionId]]) {
    const placement = placements.get(instanceId);
    const part = placement && await engine.getPart(placement.partId);
    const capability = placement && await engine.getCapability(placement.partId);
    if (!part?.connections.points.some(point => point.id === connectionId)) reasons.push(`来源连接 ${instanceId}/${connectionId} 已不存在。`);
    else if (!capability?.allowedConnectionIds.includes(connectionId)) reasons.push(`接口 ${instanceId}/${connectionId} 当前未开放。`);
  }
  const validation = await engine.validateGraph(model);
  reasons.push(...validation.issues);
  if (reasons.length) return { status: 'NEEDS_REVALIDATION', reasons: [...new Set(reasons)], originalModelId: model.id, model: null, physicalBuildVerified: false, validationScope: 'source-interfaces-final-pose-graph-only' };

  // Rebuild all presentation/export claims from current server sources, including BOM and steps.
  const sources = new Map<string, NativeSourceReference>(), bom = new Map<string, NativeGeneratedAssembly['bom'][number]>();
  for (const placement of model.placements) {
    const part = (await engine.getPart(placement.partId))!;
    const previous = bom.get(part.partId);
    if (previous) previous.quantity++;
    else bom.set(part.partId, { partId: part.partId, name: part.geometry.name ?? part.partId, quantity: 1, ldrawColor: 16, colorAvailability: 'not-verified' });
    for (const file of part.geometry.source.files) sources.set(`LDraw:${file.path}`, { library: 'LDraw', revision: part.geometry.source.revision, ...file });
    for (const file of part.connections.sourceFiles) sources.set(`${file.library}:${file.path}`, { ...file });
  }
  const canonicalPlacements = model.placements.map(placement => ({ instanceId: placement.instanceId, partId: placement.partId, transform: { rotation: [...placement.transform.rotation] as typeof placement.transform.rotation, translation: [...placement.transform.translation] as typeof placement.transform.translation } }));
  const canonicalEdges = model.edges.map(edge => ({ id: edge.id, fixedInstanceId: edge.fixedInstanceId, fixedConnectionId: edge.fixedConnectionId, movingInstanceId: edge.movingInstanceId, movingConnectionId: edge.movingConnectionId, ruleId: edge.ruleId, ruleVersion: edge.ruleVersion, twistDeg: edge.twistDeg, axis: [...edge.axis] as typeof edge.axis, anchor: [...edge.anchor] as typeof edge.anchor, insertionDepthLdu: edge.insertionDepthLdu }));
  const order = new Map(canonicalPlacements.map((placement, index) => [placement.instanceId, index]));
  const sourceHashes = Object.fromEntries(canonicalPlacements.map(placement => [placement.partId, model.sourceHashes[placement.partId]]));
  const trusted = {
    schemaVersion: 1 as const, id: `assembly-import-${randomUUID()}`, ...engine.versions,
    placements: canonicalPlacements, edges: canonicalEdges, sourceHashes, physicalBuildVerified: false as const,
    module: model.module, name: `已重新验证的真实装配（导入标签：${model.module}）`,
    bom: [...bom.values()].sort((a, b) => a.partId.localeCompare(b.partId)),
    steps: canonicalPlacements.map((placement, index) => ({ step: index + 1, addedInstanceId: placement.instanceId, partId: placement.partId, connectionEdgeIds: canonicalEdges.filter(edge => Math.max(order.get(edge.fixedInstanceId)!, order.get(edge.movingInstanceId)!) === index).map(edge => edge.id) })),
    sources: [...sources.values()].sort((a, b) => `${a.library}:${a.path}`.localeCompare(`${b.library}:${b.path}`)),
    ownership: 'virtual-design-not-owned' as const, colorAvailability: 'not-verified' as const,
    assemblyValidation: { checked: true as const, valid: true as const, issues: [] as [] },
    warnings: ['导入后已核对当前原生来源、接口权限与完整连接图；未认证实物拼搭、颜色库存或连续插入轨迹。', '导入模块名称仅为文件标签；本次校验不认证墙体、车架或轮组等结构设计目标。'],
  };
  return { status: 'VALID', reasons: [], originalModelId: model.id, model: { ...trusted, contentSha256: createHash('sha256').update(JSON.stringify(trusted)).digest('hex') }, physicalBuildVerified: false, validationScope: 'source-interfaces-final-pose-graph-only' };
}
