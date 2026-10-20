import type { jsPDF } from 'jspdf';
import { buildInstructionsPdf, type InstructionsPdfOptions } from '../instructions/pdf.js';
import type { BuildStep, GenerationResult } from '../types/index.js';
import { renderSpeedIsometric, toSpeedViewerParts } from './rendering.js';
import type { SpeedBuildStep, SpeedInventory, VehicleCandidate, VehicleModuleId } from './types.js';

const moduleNames: Record<VehicleModuleId | 'vehicle', string> = {
  vehicle: '主车', chassis: '底盘', front: '车头', rear: '车尾', cockpit: '驾驶舱',
  roof: '车顶', leftWheelModule: '左轮组', rightWheelModule: '右轮组', bodyShell: '车身外壳',
  aero: '空气动力组件', details: '细节',
};
const stepTypeNames: Record<SpeedBuildStep['type'], string> = {
  build: '主体拼搭', subassembly: '独立子组件', attach: '安装子组件', rotate: '翻转模型',
};
const cameraNames: Record<SpeedBuildStep['cameraHint'], string> = {
  isometric: '等轴视图', bottom: '底部视图', front: '车头视图', rear: '车尾视图', side: '侧面视图',
};

function description(step: SpeedBuildStep): string {
  const instructions = [step.description];
  if (step.type === 'subassembly') {
    instructions.push(`本页只显示 ${moduleNames[step.parentAssembly]} 的独立子组件，尚未接入主车。`);
  } else if (step.type === 'attach') {
    instructions.push('将先前拼好的子组件安装到主车。下方清单用于核对子组件内容，请勿重复取件。');
  } else if (step.type === 'rotate') {
    instructions.push('本步只调整模型的观察或安装方向，不新增零件。');
  }
  const { x, y, z } = step.orientation;
  instructions.push(`观察方向：${cameraNames[step.cameraHint]}${x || y || z ? `；旋转提示 X ${x}° / Y ${y}° / Z ${z}°` : ''}。`);
  return instructions.filter(Boolean).join('\n');
}

function title(step: SpeedBuildStep): string {
  const name = step.title.replace(/^(?:主体拼搭|独立子组件|独立拼搭|安装子组件|安装已拼子组件|翻转模型|翻转主车)\s*·\s*/, '');
  return `${stepTypeNames[step.type]} · ${name}`;
}

function summary(step: SpeedBuildStep): string {
  if (step.type === 'rotate') return `翻转观察，不新增零件  ·  主车当前 ${step.totalModelState.length} 块`;
  if (step.type === 'attach') return `绿色描边：安装已拼子组件 ${step.addedParts.length} 块（不重复取件）  ·  主车共 ${step.totalModelState.length} 块`;
  if (step.type === 'subassembly') return `绿色描边：新增 ${step.addedParts.length} 块  ·  独立子组件当前 ${step.totalModelState.length} 块`;
  return `绿色描边：新增 ${step.addedParts.length} 块  ·  主车当前 ${step.totalModelState.length} 块`;
}

/** Reuse the proven V0.1 layout while preserving Speed's canonical, per-step snapshots. */
export async function buildSpeedInstructionsPdf(candidate: VehicleCandidate, inventory: SpeedInventory): Promise<jsPDF> {
  const checks = [candidate.validation, candidate.validation.inventory, candidate.validation.collision, candidate.validation.connection, candidate.validation.wheels, candidate.validation.structure];
  if (checks.some(check => !check.valid)) throw new Error('车辆尚未通过验证，无法导出最终拼搭说明书。');
  if (!candidate.steps.length) throw new Error('当前车辆尚未生成拼搭步骤，请先完成说明书生成。');
  const sources = new Map<BuildStep, SpeedBuildStep>();
  const steps: BuildStep[] = candidate.steps.map(step => {
    const mapped: BuildStep = {
      stepNumber: step.stepNumber,
      title: title(step),
      description: description(step),
      addedParts: toSpeedViewerParts(step.addedParts),
      // Subassembly states are independent. Never concatenate them with the vehicle.
      totalModelState: toSpeedViewerParts(step.totalModelState),
    };
    sources.set(mapped, step);
    return mapped;
  });
  const wheels = candidate.validation.wheels;
  const structure = candidate.validation.structure;
  // Custom loose parts retain their own warning/label; they are never listed as a set.
  const setSources = inventory.inventorySources.filter(source => source.source !== 'custom');
  const hasCustomSources = inventory.inventorySources.some(source => source.source === 'custom');
  const result: GenerationResult = {
    model: {
      id: candidate.model.id, name: candidate.model.name, description: candidate.model.description,
      template: 'car', parts: toSpeedViewerParts(candidate.model.parts), dimensions: candidate.model.dimensions,
      inventoryUsage: candidate.model.inventoryUsage,
      notes: [
        ...candidate.model.designNotes,
        `验证记录：${wheels.wheelCount} 个车轮，${wheels.groundedWheels} 轮落地，${wheels.axleConnections} 个轴连接；旋转间隙${wheels.rotationalClearance ? '通过' : '未通过'}。`,
        `规则式结构评分：${structure.structuralScore} / 100。此评分来自连接与承重规则，不代表实物承重测试。`,
        '几何来源：LDraw contributors，CC BY 4.0；已做简化与参数化修改。各零件作者见项目 THIRD_PARTY_NOTICES.md。来源：https://www.ldraw.org/ ；许可：https://creativecommons.org/licenses/by/4.0/ 。',
      ],
    },
    validation: { valid: candidate.validation.valid, errors: candidate.validation.errors, warnings: candidate.validation.warnings },
    steps,
    inventory: {
      setNumber: setSources.length ? setSources.map(source => source.setNumber).join(' + ') : hasCustomSources ? '无套装来源（用户自报散件）' : inventory.setNumber,
      name: inventory.name, source: setSources.some(source => source.source === 'rebrickable') || (!setSources.length && inventory.source === 'rebrickable') ? 'rebrickable' : 'mock', sourceLabel: inventory.sourceLabel,
      items: [], warnings: inventory.warnings,
    },
  };
  const options: InstructionsPdfOptions = {
    editionLabel: 'Speed Creative · V0.2',
    creator: 'BRICKLAB Speed Creative V0.2',
    footerLabel: 'BRICKLAB  /  Speed Creative 拼搭说明书',
    readingGuide: '阅读方式：按顺序拼搭底盘、轮组与车身。绿色描边表示本步新增零件或本步安装的已拼子组件。子组件页独立拼搭，安装页再接回主车，请勿重复取件。翻转页只提示观察方向。纵向 1 板单位 = 1 块薄板；车轮按真实轮毂、轮胎与轴销几何绘制。',
    renderModel(canvas, _parts, context) {
      const step = context.step ? sources.get(context.step) : undefined;
      renderSpeedIsometric(canvas, step?.totalModelState ?? candidate.model.parts, {
        highlightIds: context.highlightIds,
        background: context.background,
        cameraHint: step?.cameraHint ?? 'isometric',
      });
    },
    stepSummary: step => summary(sources.get(step)!),
    stepPartsHeading: step => sources.get(step)!.type === 'attach' ? '已拼子组件内容（不重复取件）' : '本步所需零件',
    emptyPartsText: () => '本步无需领取新零件。',
  };
  return buildInstructionsPdf(result, options);
}

export async function downloadSpeedInstructionsPdf(candidate: VehicleCandidate, inventory: SpeedInventory): Promise<void> {
  const pdf = await buildSpeedInstructionsPdf(candidate, inventory);
  const id = candidate.model.id.replace(/[^a-z0-9_-]/gi, '-').slice(0, 80) || 'vehicle';
  pdf.save(`bricklab-speed-${id}.pdf`);
}
