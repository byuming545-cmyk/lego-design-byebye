import { createHash } from 'node:crypto';
import type { NativeGeneratedAssembly } from './generator.js';
import { isRigidTransform } from './math.js';

function validateDocument(model: NativeGeneratedAssembly) {
  if (!model || model.schemaVersion !== 1 || !Array.isArray(model.placements) || !model.placements.length || model.placements.length > 32 || !Array.isArray(model.edges) || model.edges.length < model.placements.length - 1) throw new Error('真实装配模型结构无效。');
  const { contentSha256, ...document } = model;
  if (createHash('sha256').update(JSON.stringify(document)).digest('hex') !== contentSha256) throw new Error('装配文档已修改，请重新从真实装配引擎生成。');
  for (const placement of model.placements) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(placement.partId) || !isRigidTransform(placement.transform)) throw new Error('模型包含无效零件编号或非刚性变换，已阻止导出。');
    if (!/^[a-f0-9]{64}$/.test(model.sourceHashes[placement.partId] ?? '') || !model.sources.some(source => source.library === 'LDraw' && source.path === `parts/${placement.partId}.dat` && /^[a-f0-9]{64}$/.test(source.sha256))) throw new Error('模型中的零件缺少真实原生文件来源，已阻止导出。');
  }
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
