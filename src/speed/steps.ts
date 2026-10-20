import { deriveConnections, graphComponents } from './connections.js';
import { SpeedGenerationError } from './errors.js';
import type { SpeedBuildStep, SpeedConnection, SpeedPlacedPart, VehicleModel, VehicleModuleId } from './types.js';

interface Subassembly { id: string; moduleId: VehicleModuleId; name: string; parts: SpeedPlacedPart[]; external: SpeedConnection[] }
const priorities: Record<VehicleModuleId, number> = { chassis: 0, leftWheelModule: 1, rightWheelModule: 1, bodyShell: 2, cockpit: 3, front: 4, rear: 5, roof: 6, aero: 7, details: 8 };

/** Connected main assembly plus genuinely independent wheel / rear-wing builds. */
export function buildVehicleSteps(model: VehicleModel): SpeedBuildStep[] {
  const graph = deriveConnections(model.parts), built: SpeedPlacedPart[] = [], steps: SpeedBuildStep[] = [], assemblies: Subassembly[] = [];
  const name = (id: VehicleModuleId): string => model.modules.find(module => module.id === id)?.name ?? id;
  const snapshot = (parts: SpeedPlacedPart[]): SpeedPlacedPart[] => {
    const ids = new Set(parts.map(part => part.instanceId));
    return parts.map(part => ({ ...structuredClone(part), activeConnections: graph.filter(edge => ids.has(edge.partA) && ids.has(edge.partB) && (edge.partA === part.instanceId || edge.partB === part.instanceId)).map(edge => edge.id) }));
  };
  const touches = (part: SpeedPlacedPart, ids: Set<string>): boolean => graph.some(edge => edge.partA === part.instanceId && ids.has(edge.partB) || edge.partB === part.instanceId && ids.has(edge.partA));
  const addAssembly = (parts: SpeedPlacedPart[], moduleId: VehicleModuleId, label: string): void => {
    const ids = new Set(parts.map(part => part.instanceId));
    assemblies.push({ id: `${model.id}-subassembly-${moduleId}-${assemblies.length + 1}`, moduleId, name: label, parts, external: graph.filter(edge => ids.has(edge.partA) !== ids.has(edge.partB)) });
  };
  // Each side contains two separately mounted wheels, not one standalone side module.
  for (const moduleId of ['leftWheelModule', 'rightWheelModule'] as const) {
    const parts = model.parts.filter(part => part.moduleId === moduleId);
    for (const ids of graphComponents(parts, graph)) {
      const component = parts.filter(part => ids.includes(part.instanceId));
      if (component.length === 3 && ['3673', '66727', '18977'].every(partId => component.filter(part => part.partId === partId).length === 1)) {
        const axle = component[0].position.y < model.parameters.length / 2 ? '前轮' : '后轮';
        addAssembly(component, moduleId, `${moduleId === 'leftWheelModule' ? '左' : '右'}${axle}`);
      }
    }
  }
  const wing = model.parts.filter(part => part.moduleId === 'aero');
  if (wing.length > 1 && graphComponents(wing, graph).length === 1) {
    const wingIds = new Set(wing.map(part => part.instanceId)), remaining = model.parts.filter(part => !wingIds.has(part.instanceId));
    const chassisIds = new Set(remaining.filter(part => part.moduleId === 'chassis').map(part => part.instanceId));
    const mainWithoutWing = new Set(graphComponents(remaining, graph).find(component => component.some(id => chassisIds.has(id))) ?? []);
    const external = graph.filter(edge => wingIds.has(edge.partA) !== wingIds.has(edge.partB));
    // A detail resting on the wing must be built afterwards. Requiring that detail
    // before attaching the wing would create a circular prerequisite; build in place.
    if (external.every(edge => mainWithoutWing.has(wingIds.has(edge.partA) ? edge.partB : edge.partA))) addAssembly(wing, 'aero', name('aero'));
  }
  const independentIds = new Set(assemblies.flatMap(assembly => assembly.parts.map(part => part.instanceId)));
  const pending = model.parts.filter(part => !independentIds.has(part.instanceId));
  let underside = false;
  const rotateMain = (bottom: boolean): void => {
    if (underside === bottom || !built.length) return;
    underside = bottom;
    steps.push({ stepNumber: steps.length + 1, title: bottom ? '翻转主车 · 查看底部' : '转回主车 · 继续上部', description: bottom ? '将已拼主车翻转以看清底面 / 侧面的安装位置。只改变持握与观察方向；本步不用取新零件。' : '将已拼主车转回正常方向，继续安装上部结构。本步不用取新零件。', type: 'rotate', parentAssembly: 'vehicle', addedParts: [], totalModelState: snapshot(built), orientation: { x: bottom ? 180 : 0, y: 0, z: 0 }, cameraHint: bottom ? 'bottom' : 'isometric' });
  };
  const buildSubassembly = (assembly: Subassembly): void => {
    const remaining = [...assembly.parts], assembled: SpeedPlacedPart[] = [];
    while (remaining.length) {
      const ids = new Set(assembled.map(part => part.instanceId));
      let ready = remaining.filter(part => touches(part, ids));
      if (!assembled.length) ready = [...remaining].sort((a, b) => Number(b.category === 'Wheel') - Number(a.category === 'Wheel') || b.dimensions.x * b.dimensions.y - a.dimensions.x * a.dimensions.y || a.instanceId.localeCompare(b.instanceId)).slice(0, 1);
      if (!ready.length) throw new SpeedGenerationError('子组件内部没有连续合法的接口，无法生成说明书。', 'INVALID_SPEED_INSTRUCTIONS');
      const added = ready.slice(0, 4), stepNumber = steps.length + 1;
      for (const part of added) { part.buildStep = stepNumber; assembled.push(part); remaining.splice(remaining.indexOf(part), 1); }
      steps.push({ stepNumber, title: `独立拼搭 · ${assembly.name}`, description: assembled.length === added.length ? `先在主车旁独立拼 ${assembly.name}，拿取高亮的基准件；主车暂时放在一旁。` : `${assembly.moduleId === 'aero' ? '将支柱顶部凸点与横板底部凹槽对齐并压紧。' : '将轮胎压合到已核对的轮毂上，再把无摩擦插销插入轮毂圆孔。'}本步只领用高亮的新零件，暂不安装到主车。`, type: 'subassembly', parentAssembly: assembly.moduleId, subAssemblyId: assembly.id, addedParts: snapshot(added), totalModelState: snapshot(assembled), orientation: { x: assembly.moduleId === 'aero' ? 180 : 0, y: 0, z: 0 }, cameraHint: assembly.moduleId === 'aero' ? 'bottom' : 'side' });
    }
  };
  while (pending.length || assemblies.length) {
    const ids = new Set(built.map(part => part.instanceId));
    let ready = pending.filter(part => touches(part, ids));
    if (!built.length) ready = pending.filter(part => part.moduleId === 'chassis' && part.category === 'Plate').sort((a, b) => b.dimensions.x * b.dimensions.y - a.dimensions.x * a.dimensions.y || a.instanceId.localeCompare(b.instanceId)).slice(0, 1);
    ready.sort((a, b) => priorities[a.moduleId] - priorities[b.moduleId] || a.position.z - b.position.z || a.instanceId.localeCompare(b.instanceId));
    const readyAssemblies = built.length ? assemblies.filter(assembly => assembly.external.length > 0 && assembly.external.every(edge => ids.has(edge.partA) || ids.has(edge.partB))).sort((a, b) => priorities[a.moduleId] - priorities[b.moduleId] || a.id.localeCompare(b.id)) : [];
    const assembly = readyAssemblies[0];
    if (assembly && (!ready.length || priorities[assembly.moduleId] < priorities[ready[0].moduleId])) {
      buildSubassembly(assembly);
      rotateMain(assembly.parts.some(part => part.position.z < 5));
      built.push(...assembly.parts); assemblies.splice(assemblies.indexOf(assembly), 1);
      steps.push({ stepNumber: steps.length + 1, title: `安装已拼子组件 · ${assembly.name}`, description: assembly.moduleId === 'aero' ? '拿起刚才拼好的尾翼，将两个支柱同时压到主车对应凸点；安装全部已核对的锚点。不要重复取件。' : '拿起刚才拼好的车轮链，将无摩擦插销的空端压入对应轮座圆孔；检查车轮可转动。不要重复取件。', type: 'attach', parentAssembly: 'vehicle', subAssemblyId: assembly.id, addedParts: snapshot(assembly.parts), totalModelState: snapshot(built), orientation: { x: underside ? 180 : 0, y: 0, z: 0 }, cameraHint: underside ? 'bottom' : 'isometric' });
      continue;
    }
    if (!ready.length) throw new SpeedGenerationError('无法生成连贯说明书：有零件或子组件无法通过全部合法锚点装到已搭建部分。', 'INVALID_SPEED_INSTRUCTIONS');
    const moduleId = ready[0].moduleId, added = ready.filter(part => part.moduleId === moduleId).slice(0, 4);
    rotateMain(added.some(part => part.position.z < 5));
    const stepNumber = steps.length + 1;
    for (const part of added) { part.buildStep = stepNumber; built.push(part); pending.splice(pending.indexOf(part), 1); }
    steps.push({ stepNumber, title: `${stepNumber === 1 ? '先拼底盘 · ' : ''}${name(moduleId)}`, description: stepNumber === 1 ? '先拿起承重底盘板作为基准件；随后用交错层连接相邻板，不按外壳轮廓先摆零件。' : `${underside ? '从底面 / 侧面安装：' : ''}将本步 ${added.length} 件零件对准已拼结构的对应接口；高亮表示本步新增零件。`, type: 'build', parentAssembly: 'vehicle', addedParts: snapshot(added), totalModelState: snapshot(built), orientation: { x: underside ? 180 : 0, y: 0, z: 0 }, cameraHint: underside ? 'bottom' : 'isometric' });
  }
  rotateMain(false);
  return steps;
}
