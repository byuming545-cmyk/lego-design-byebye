import { applyVehicleConnections } from '../../speed/connections.js';
import { vehicleDimensions } from '../../speed/geometry.js';
import type { VehicleModel, VehicleModuleId } from '../../speed/types.js';
import { AUTOMOTIVE_COLORS, createVirtualPaletteInventory } from '../palette.js';
import { createDesignPatternLibrary } from '../patterns.js';
import { validateAutomotivePhysics } from '../quality.js';
import { addAutomotiveBody } from './body.js';
import { addAutomotiveChassis, AutomotivePartBuilder } from './chassis.js';
import { planAutomotiveCandidates } from './planner.js';
import type { AutomotiveCoarsePlan, AutomotiveGenerationResult, AutomotiveGeneratorRequest } from './types.js';

const moduleNames: Record<VehicleModuleId, string> = { chassis: '交错承重底盘', front: '车头与引擎盖', rear: '车尾与后舱', cockpit: '斜面玻璃与驾驶舱', roof: '独立连接车顶', leftWheelModule: '左侧独立轮组', rightWheelModule: '右侧独立轮组', bodyShell: '肩线、轮眉与侧裙', aero: '空气动力部件', details: '细节' };

/** Coarse assembly returns a real Speed model; no image or whole-car mesh is used. */
export function assembleAutomotiveModel(request: AutomotiveGeneratorRequest, plan: AutomotiveCoarsePlan): VehicleModel {
  if (plan.status !== 'ready') throw new Error(plan.blockers.join(' '));
  const requested = request.requestedColor ?? AUTOMOTIVE_COLORS.find(color => color.id === 72)!;
  const paint = AUTOMOTIVE_COLORS.find(color => color.id === requested.id && color.hex.toLowerCase() === requested.hex.toLowerCase() && color.id !== 40);
  if (!paint) throw new Error('Body paint must be an opaque colour from the reliable automotive LEGO palette.');
  const builder = new AutomotivePartBuilder(`automotive-${plan.layout.widthStuds}-${plan.variant + 1}`);
  addAutomotiveChassis(builder, plan);
  addAutomotiveBody(builder, plan, request.brief, paint, request.patterns ?? createDesignPatternLibrary());
  plan.recommendedPatternChoices = structuredClone(plan.recommendedPatternChoices ?? plan.patternChoices.filter(choice => choice.status === 'recommended'));
  plan.patternChoices = structuredClone(builder.patternUses);
  const parts = builder.parts, inventory = createVirtualPaletteInventory(), usage = new Map<string, VehicleModel['inventoryUsage'][number]>();
  for (const part of parts) {
    const key = `${part.partId}:${part.color.id}`, existing = usage.get(key);
    if (existing) existing.quantityUsed++;
    else usage.set(key, { partId: part.partId, colorId: part.color.id, quantityUsed: 1, quantityAvailable: inventory.items.find(item => item.partId === part.partId && item.color.id === part.color.id)?.quantityAvailable ?? 0 });
  }
  const vehicleType = request.brief.vehicleClass === 'luxury-sedan' || request.brief.vehicleClass === 'performance-coupe' || request.brief.vehicleClass === 'unknown' ? 'gt' : request.brief.vehicleClass;
  const model: VehicleModel = {
    id: `automotive-${crypto.randomUUID()}`, name: `${request.brief.targetVehicle} · ${plan.layout.widthStuds} 格研究方案 ${plan.variant + 1}`,
    description: '通用模块语法按研究比例独立重排的 LEGO 汽车概念；尚需质量排名和实物验证。', vehicleType, style: 'modern',
    options: { prompt: request.prompt ?? request.brief.targetVehicle, vehicleType, style: 'modern', minifigure: false, priority: 'appearance', maximizeUsage: false },
    parameters: { width: plan.layout.widthStuds, length: plan.lengthStuds, wheelbase: plan.wheelbaseStuds, track: plan.trackStuds!, cockpitPosition: plan.cabinStartStuds, hoodLength: plan.hoodLengthStuds, roofHeight: plan.roofHeightPlates + 1 },
    parts, connections: [], modules: (Object.keys(moduleNames) as VehicleModuleId[]).map(id => ({ id, name: moduleNames[id], partIds: parts.filter(part => part.moduleId === id).map(part => part.instanceId), connectionIds: [], locked: false, structuralScore: 0 })), dimensions: vehicleDimensions(parts), inventoryUsage: [...usage.values()],
    designNotes: [
      '8 / 10 / 12 格宽分别重排底盘、座舱、车顶和前脸；没有缩放零件、轮轴或完整参考车。',
      '独立 3700 轮架由底板和交错横纵梁固定；外扩肩线位于完整轮胎旋转包络之上。',
      '车窗由已建模普通透明砖和斜面砖组合，未将未校准的专用挡风件假装为可靠几何。',
      '车头与灯组实例化已确认的局部 SNOT 模式；引擎盖曲面底部的高低连接分别由真实板层支持。',
      '虚拟设计零件数量不受个人库存限制；BOM 仅统计实际放置的合法目录零件，具体零件颜色生产可用性仍未核实。',
      `比例依据：${request.brief.dimensionBasis}；参考数量 ${request.references?.length ?? 0}。评分比较几何比例，不声称完成照片视觉复刻。`,
      '未声明可容纳人仔；实物夹持力、装配手部空间、载荷和摩擦仍需实搭验证。',
    ], version: 1,
  };
  applyVehicleConnections(model);
  return model;
}

/** Every valid candidate reaches ranking; quality is never inferred from physics alone. */
export function generateAutomotiveCandidates(request: AutomotiveGeneratorRequest): AutomotiveGenerationResult {
  const planning = planAutomotiveCandidates(request.brief, request), inventory = createVirtualPaletteInventory();
  const result: AutomotiveGenerationResult = { plans: planning.plans, candidates: [], diagnostics: [], rejections: [], warnings: [...planning.warnings, ...inventory.warnings, '候选通过物理几何校验后仍须通过独立造型质量排名；未达门槛时不返回可导出的成品。'] };
  for (const plan of planning.plans) {
    plan.recommendedPatternChoices = structuredClone(plan.patternChoices.filter(choice => choice.status === 'recommended'));
    plan.patternChoices = [];
    if (plan.status === 'blocked') {
      result.rejections.push({ planId: plan.id, stage: 'planning', errors: [...plan.blockers] });
      result.diagnostics.push({ planId: plan.id, status: 'blocked', partCount: 0, errors: [...plan.blockers] });
      continue;
    }
    let model: VehicleModel;
    try { model = assembleAutomotiveModel(request, plan); }
    catch (error) {
      const errors = [error instanceof Error ? error.message : 'Automotive assembly failed.'];
      result.rejections.push({ planId: plan.id, stage: 'placement', errors });
      result.diagnostics.push({ planId: plan.id, status: 'placement-failed', partCount: 0, errors });
      continue;
    }
    const validation = validateAutomotivePhysics(model, inventory, request.brief);
    if (!validation.valid) {
      result.rejections.push({ planId: plan.id, stage: 'physics', errors: [...validation.errors] });
      result.diagnostics.push({ planId: plan.id, candidateId: model.id, status: 'physics-rejected', partCount: model.parts.length, errors: [...validation.errors] });
    } else {
      result.candidates.push({ model, validation, steps: [] });
      result.diagnostics.push({ planId: plan.id, candidateId: model.id, status: 'physics-valid', partCount: model.parts.length, errors: [] });
    }
  }
  if (!result.candidates.length) result.warnings.push('所有粗方案均未通过真实几何与连接校验，未生成成品。');
  return result;
}
