import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { NativeGeneratedAssembly } from './generator.js';
import { finiteVector, isRigidTransform } from './math.js';
import { ASSEMBLY_ENGINE_VERSION } from './engine.js';
import { CONNECTION_RULE_VERSION } from './compatibility.js';
import { COLLISION_VERSION } from './collision.js';
import { PART_LIBRARY_VERSION } from './source.js';
import { BUNDLED_LDRAW_DIRECTORY, type BundledLDrawManifest } from '../ldraw/index.js';

let pinnedManifest: BundledLDrawManifest | undefined;
function exportManifest() {
  pinnedManifest ??= JSON.parse(readFileSync(path.join(BUNDLED_LDRAW_DIRECTORY, 'manifest.json'), 'utf8')) as BundledLDrawManifest;
  if (pinnedManifest.schemaVersion !== 1 || pinnedManifest.library !== 'LDraw' || !Array.isArray(pinnedManifest.roots) || !Array.isArray(pinnedManifest.files)) throw new Error('真实零件来源清单无效，已阻止导出。');
  return pinnedManifest;
}

function validateDocument(model: NativeGeneratedAssembly) {
  if (!model || model.schemaVersion !== 1 || !Array.isArray(model.placements) || !model.placements.length || model.placements.length > 32 || !Array.isArray(model.edges) || model.edges.length < model.placements.length - 1 || model.edges.length > 10000 || !Array.isArray(model.sources) || !Array.isArray(model.steps) || !Array.isArray(model.bom)) throw new Error('真实装配模型结构无效。');
  const { contentSha256, ...document } = model;
  if (createHash('sha256').update(JSON.stringify(document)).digest('hex') !== contentSha256) throw new Error('装配文档已修改，请重新从真实装配引擎生成。');
  if (model.partLibraryVersion !== PART_LIBRARY_VERSION || model.assemblyEngineVersion !== ASSEMBLY_ENGINE_VERSION || model.connectionRuleVersion !== CONNECTION_RULE_VERSION || model.collisionVersion !== COLLISION_VERSION) throw new Error('装配文档来源或验证版本已失效，必须重新验证后才能导出。');
  if (model.physicalBuildVerified !== false || model.ownership !== 'virtual-design-not-owned' || model.colorAvailability !== 'not-verified' || model.assemblyValidation?.checked !== true || model.assemblyValidation.valid !== true || model.assemblyValidation.issues.length !== 0) throw new Error('模型缺少当前真实装配验证或包含未经验证的实物声明。');
  const manifest = exportManifest(), roots = new Map(manifest.roots.map(root => [root.partId, root]));
  const files = new Map(manifest.files.map(file => [file.path, file.sha256]));
  const instances = new Map<string, number>(), quantities = new Map<string, number>();
  for (const placement of model.placements) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(placement.partId) || !isRigidTransform(placement.transform)) throw new Error('模型包含无效零件编号或非刚性变换，已阻止导出。');
    if (typeof placement.instanceId !== 'string' || !placement.instanceId || instances.has(placement.instanceId)) throw new Error('模型包含重复或无效的零件实例。');
    instances.set(placement.instanceId, instances.size);
    quantities.set(placement.partId, (quantities.get(placement.partId) ?? 0) + 1);
    const root = roots.get(placement.partId);
    if (!root || !/^[a-f0-9]{64}$/.test(model.sourceHashes?.[placement.partId] ?? '') || !model.sources.some(source => source.library === 'LDraw' && source.path === root.path && source.revision === manifest.revision && source.sha256 === files.get(root.path))) throw new Error('模型中的零件缺少真实原生文件来源或不在当前零件库中，已阻止导出。');
  }
  const edgeIds = new Set<string>(), occupied = new Set<string>(), adjacency = new Map(model.placements.map(placement => [placement.instanceId, new Set<string>()]));
  for (const edge of model.edges) {
    if (!edge || typeof edge.id !== 'string' || !edge.id || edgeIds.has(edge.id) || !instances.has(edge.fixedInstanceId) || !instances.has(edge.movingInstanceId) || edge.fixedInstanceId === edge.movingInstanceId || !edge.fixedConnectionId || !edge.movingConnectionId || edge.ruleVersion !== model.connectionRuleVersion || !finiteVector(edge.axis) || !finiteVector(edge.anchor) || !Number.isFinite(edge.twistDeg) || !Number.isFinite(edge.insertionDepthLdu) || edge.insertionDepthLdu < 0) throw new Error('模型包含重复或不完整的真实连接边。');
    edgeIds.add(edge.id);
    for (const key of [JSON.stringify([edge.fixedInstanceId, edge.fixedConnectionId]), JSON.stringify([edge.movingInstanceId, edge.movingConnectionId])]) {
      if (occupied.has(key)) throw new Error('模型连接图重复占用同一个来源接口。');
      occupied.add(key);
    }
    adjacency.get(edge.fixedInstanceId)!.add(edge.movingInstanceId);
    adjacency.get(edge.movingInstanceId)!.add(edge.fixedInstanceId);
  }
  const reachable = new Set<string>(), queue = [model.placements[0].instanceId];
  while (queue.length) { const instance = queue.pop()!; if (reachable.has(instance)) continue; reachable.add(instance); queue.push(...adjacency.get(instance)!); }
  if (reachable.size !== instances.size) throw new Error('模型连接图包含悬空零件。');
  const recordedEdges = new Set<string>();
  if (model.steps.length !== model.placements.length) throw new Error('模型步骤与真实零件实例数量不一致。');
  for (const [index, step] of model.steps.entries()) {
    const placement = model.placements[index];
    const expected = model.edges.filter(edge => Math.max(instances.get(edge.fixedInstanceId)!, instances.get(edge.movingInstanceId)!) === index).map(edge => edge.id);
    if (step.step !== index + 1 || step.addedInstanceId !== placement.instanceId || step.partId !== placement.partId || !Array.isArray(step.connectionEdgeIds) || step.connectionEdgeIds.length !== expected.length || new Set(step.connectionEdgeIds).size !== step.connectionEdgeIds.length || step.connectionEdgeIds.some(id => !expected.includes(id) || recordedEdges.has(id))) throw new Error('模型步骤没有按新增零件完整记录多点连接。');
    for (const id of step.connectionEdgeIds) recordedEdges.add(id);
  }
  if (recordedEdges.size !== edgeIds.size) throw new Error('模型步骤遗漏真实连接边。');
  const recordedParts = new Set<string>();
  for (const row of model.bom) {
    if (!row || recordedParts.has(row.partId) || quantities.get(row.partId) !== row.quantity || !Number.isSafeInteger(row.quantity) || row.quantity <= 0 || row.ldrawColor !== 16 || row.colorAvailability !== 'not-verified') throw new Error('模型零件清单与真实零件实例不一致。');
    recordedParts.add(row.partId);
  }
  if (recordedParts.size !== quantities.size) throw new Error('模型零件清单遗漏真实零件实例。');
}

/** Call only on a server-retained, source-verified generated document, not arbitrary uploads. */
export function exportNativeAssemblyJson(model: NativeGeneratedAssembly): string {
  validateDocument(model);
  return JSON.stringify(model, null, 2) + '\n';
}

/** LDraw references the unchanged source part. No proxy, stretched mesh or fake part is exported. */
export function exportNativeAssemblyLDraw(model: NativeGeneratedAssembly): string {
  validateDocument(model);
  const lines = [
    `0 ${model.name}`, '0 Name: bricklab-native-assembly.ldr', '0 Author: BRICKLAB source-backed assembly engine',
    `0 // partLibraryVersion: ${model.partLibraryVersion}`, `0 // assemblyEngineVersion: ${model.assemblyEngineVersion}`,
    `0 // connectionRuleVersion: ${model.connectionRuleVersion}`, `0 // collisionVersion: ${model.collisionVersion}`,
    '0 // Unspecified LDraw current colour 16; physical build and colour availability are unverified.',
  ];
  for (const placement of model.placements) {
    if (lines.some(line => line.startsWith('1 '))) lines.push('0 STEP');
    const { translation, rotation } = placement.transform;
    const values = [...translation, ...rotation].map(value => Number(value.toFixed(8)));
    lines.push(`1 16 ${values.join(' ')} ${placement.partId}.dat`);
  }
  return lines.join('\r\n') + '\r\n';
}

export function exportNativeAssemblyBomCsv(model: NativeGeneratedAssembly): string {
  validateDocument(model);
  const quote = (text: string) => `"${text.replaceAll('"', '""')}"`;
  return ['partId,name,quantity,ldrawColor,colorAvailability', ...model.bom.map(row => [quote(row.partId), quote(row.name), row.quantity, row.ldrawColor, row.colorAvailability].join(','))].join('\r\n') + '\r\n';
}
