import type { BodyPreview } from "./body-preview.js";
export const GROUP_VERSION = "functional-appearance-groups-1";
export const GROUP_NOTICE = "按功能分组展示模型组成，非已验证实拼说明书。";
const definitions = [
  { id: "base", name: "底部支撑", use: "展示底部承托零件，不代表已验证底盘", roles: ["chassis","internal-support","internal-mount"] },
  { id: "wheels", name: "轮组", use: "展示真实轮胎与轮毂；配合与安装状态保持原结论", roles: ["wheel"] },
  { id: "body", name: "侧面与轮拱", use: "展示侧面、腰线、侧裙和轮拱覆盖", roles: ["side", "belt", "shoulder", "side-skirt", "wheel-arch"] },
  { id: "front", name: "机盖与前脸", use: "展示机盖、格栅、灯区与前保险杠", roles: ["hood", "grille", "grille-divider", "headlamp", "front-bumper", "front-apron"] },
  { id: "rear", name: "尾部覆盖", use: "展示尾厢、尾部面板、尾灯与后保险杠", roles: ["tail", "rear-panel", "taillamp", "rear-bumper"] },
  { id: "cabin", name: "窗区与窗柱", use: "展示前后挡、侧窗和窗柱的外观组成", roles: ["windshield", "rear-window", "side-window", "window-pillar"] },
  { id: "roof", name: "车顶覆盖", use: "展示车顶覆盖件，完成整体外观展示", roles: ["roof"] },
  { id: "other", name: "其他实际零件", use: "未映射功能的现有零件，保留原角色与验证状态", roles: [] },
] as const;
/** Regroup actual source members for presentation, never manufacture assembly evidence. */
export function appearanceGroups(base: BodyPreview) {
  if (base.steps.status !== "DRAFT_NOT_BUILD_INSTRUCTIONS") throw Error("GROUP_SOURCE_STATUS");
  const actual = new Map(base.placements.map(p => [p.instanceId,p]));
  if (actual.size !== base.placements.length || !actual.size) throw Error("GROUP_DUPLICATE_OR_EMPTY_MODEL");
  const sourceSteps = new Map<string,number>();
  for (const step of base.steps.items) for (const id of step.instanceIds) {
    if (!actual.has(id) || sourceSteps.has(id) || actual.get(id)!.role !== step.role) throw Error("GROUP_SOURCE_MEMBERSHIP");
    sourceSteps.set(id,step.step);
  }
  if (sourceSteps.size !== actual.size) throw Error("GROUP_SOURCE_INCOMPLETE");
  return {
    version: base.structure?'functional-structure-groups-2':GROUP_VERSION, status: "DRAFT_NOT_BUILD_INSTRUCTIONS" as const, notice: GROUP_NOTICE,
    parentContentSha256: base.contentSha256,
    groups: definitions.map(d => ({id:d.id,name:d.name,use:d.use,members:base.placements.filter(p => {
      const match=definitions.find(q=>(q.roles as readonly string[]).includes(p.role));
      return (match?.id??"other")===d.id;
    }).map(p=>({instanceId:p.instanceId,partId:p.partId,role:p.role,sourceGroup:sourceSteps.get(p.instanceId)!,craft:p.craft??null}))})).filter(g=>g.members.length),
  };
}
export type AppearanceGroups = ReturnType<typeof appearanceGroups>;
export function groupPresentation(groups: AppearanceGroups, index: number | null) {
  if (index === null) return { visibleInstanceIds:undefined, highlightInstanceIds:undefined };
  if (!Number.isInteger(index) || index<0 || index>=groups.groups.length) throw Error("GROUP_INDEX_INVALID");
  return { visibleInstanceIds:groups.groups.slice(0,index+1).flatMap(g=>g.members.map(p=>p.instanceId)),
    highlightInstanceIds:groups.groups[index].members.map(p=>p.instanceId) };
}
