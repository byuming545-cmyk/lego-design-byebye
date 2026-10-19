import type { BuildStep, LegoModel, PlacedPart } from '../types/index.js';
import { connectionMap, supports } from '../lego/geometry.js';

/** Mutates only model buildStep/connections; snapshots are independent deep copies. */
export function createBuildSteps(model: LegoModel): BuildStep[] {
  const connections = connectionMap(model.parts);
  const pending = [...model.parts].sort((a, b) => a.position.z - b.position.z || a.position.y - b.position.y || a.position.x - b.position.x || a.instanceId.localeCompare(b.instanceId));
  const assembled: PlacedPart[] = [];
  const steps: BuildStep[] = [];
  while (pending.length) {
    const ready = pending.filter(part => part.position.z === 0 || assembled.some(lower => supports(lower, part)));
    if (!ready.length) throw new Error('无法生成搭建步骤：存在悬空零件或没有凸点连接的支撑。');
    const lowest = Math.min(...ready.map(part => part.position.z));
    const added = ready.filter(part => part.position.z === lowest).slice(0, 4);
    const stepNumber = steps.length + 1;
    for (const part of added) {
      part.buildStep = stepNumber;
      part.connections = connections.get(part.instanceId) ?? [];
      assembled.push(part);
      pending.splice(pending.indexOf(part), 1);
    }
    const assembledIds = new Set(assembled.map(part => part.instanceId));
    const snapshot = (parts: PlacedPart[]) => parts.map(part => ({ ...structuredClone(part), connections: part.connections.filter(id => assembledIds.has(id)) }));
    steps.push({
      stepNumber,
      title: stepNumber === 1 ? '搭建底部' : `搭建第 ${stepNumber} 组零件`,
      description: `在${lowest === 0 ? '平整桌面' : `高度 ${lowest} 板单位的已有凸点`}放置 ${added.length} 件零件；按高亮位置对齐并压紧。`,
      addedParts: snapshot(added),
      totalModelState: snapshot(assembled),
    });
  }
  return steps;
}
