# 外表面碰撞合同（外表面碰撞，非闭合实体认证）

## 1. 为什么需要单独的合同

固定零件库里有大量 LDraw 网格是“视觉外壳”：风挡、车身覆盖件、薄板和不规则曲面。它们的三角形并不围成水密实体，现有 `structural` 合同因此拒绝建立碰撞代理。

`exterior-shell` 是**逐 placement 显式选择**的第二个合同。它只回答一个问题：

> 在最终姿态下，真实来源表面是否与对侧发生实际三角形交叉/穿透；来源声明的接口 seat 内是否只有允许接触？

它不把开壳封闭、不补厚度、不生成实体体积，也不认证承重、保持力或实物。

## 2. 选择规则

- 默认 `collisionClass: 'structural'`；缺省或旧模型没有该字段时仍按 structural 处理。
- 只有 API `/assembly/attach` 显式传 `collisionClass: 'exterior-shell'`，或 `exterior-shell` 生成模块，才会创建 exterior placement。
- 不能从零件名称、标题、外观、半径或“像覆盖件”推断。没有零件编号配对表。
- 已闭合的零件不会被自动降级；只有 structural 代理失败、且外表面代理可建立的开壳零件才获得 `exteriorGeneratable`。
- 一个 3+ placement 图中可以同时有 structural 与 exterior placement；每个 placement 独立保留合同。

## 3. 代理和缓存

`src/parts/assembly/proxy.ts` 的外表面分支：

- 使用真实 LDraw 来源三角形，不生成替代几何。
- 不封边界、不加 cap、不计算 signed volume，不要求 containment。
- 记录 `sourceTriangles`、`boundarySegments`、`boundaryLoops`、`degenerateTriangles`、来源 SHA/版本/许可。
- 拓扑状态为 `exterior-source-surface`，原因码 `source-exterior-surface`。
- 缓存键包含 `collisionClass`，不会覆盖同一零件的 closed proxy。

## 4. 碰撞判定

`src/parts/assembly/collision.ts`：

- shell ↔ closed：
  - 真实三角形之间的严格穿越检测；
  - 开壳顶点/面心进入闭壳实体，且不在来源 seat 内 → 碰撞；
  - 面共面接触计数，不把单纯贴合当作穿透；
  - 不允许用 bbox 相交直接判 PASS。
- shell ↔ shell：
  - 两侧真实三角形严格穿越 → 碰撞；
  - 共面重叠显式计数并分类；
  - 边界保持开放，不自动封口；
  - 无交集的远距离对返回 `exterior-surface-broadphase`。
- 无法判定、seat 不成立、超出预算、外表面与 structural open CLIP/PIN 混配 → `blocked`/UNKNOWN，不返回 clear。

## 5. 证明字段

成功结果保留：

```text
exteriorSourceSurfaces: true
openSurface: true
surfaceCrossingChecked: true
closedSourceProxies: false
containmentChecked: false
structuralSupport: false
wholePairExempted: false
completeSurfacePartition: false
degenerateTriangles
coplanarContacts
penetrationZone / penetrationZoneValidated
```

分类：

```text
EXTERIOR_SURFACE_CLEAR
EXTERIOR_SURFACE_COLLISION
EXTERIOR_SURFACE_UNKNOWN
```

结论必须读成“表面交叉检查通过”，不能读成闭合实体、厚度、承重或实物通过。

## 6. 接入

- `NativePlacement.collisionClass` 随 graph、JSON 导出、模型导入保存。
- `AttachmentEngine` 的资格、接口、占用、多点、整图复验都按 placement 合同检查。
- `modelImport` 校验非法合同值；缺失字段按 structural 处理，若该零件没有 structural 准入则返回 revalidation/拒绝，而不是静默降级。
- 碰撞版本提升为 `native-exterior-shell-3.0.0`，旧碰撞证明作废，不重标为当前通过。
- `/assembly/generate` 提供显式 `exterior-shell` 模块；模块只把移动 placement 标记为 exterior，根 placement 保持 structural。
- 该合同不让 134 个碰撞阻塞零件自动变成可生成；结构资格仍为 104，另列外表面合同资格。

## 7. 真实样例

`3001`（structural brick）+ `11477`（exterior slope）：

- structural attach：拒绝 `part-or-interface-blocked`；
- exterior attach：接受，graph `valid`；
- clear：验收姿态为 `exterior-surface-clear` / `EXTERIOR_SURFACE_CLEAR`；若交叉点落在距共面接触片 1 LDU 内，才按接触处理；其他交叉仍是 collision。
- 2 placements、1 edge；
- JSON 19,878 bytes，重导入 `VALID`，placement 保留 `exterior-shell`。

`3001` + `11477` 是本轮验收模型。更严格的逐穿透过滤后，`3024` + `11477` 被判定为 seat 外真实表面交叉，保留失败；`3001` + `18973`、`3024` + `18973` 同样失败；只记为 blocked/UNKNOWN，不用于通过样例。

## 8. 边界

仍然未知或未完成：

- 安装路径：只检查最终姿态；关键帧路径不是本合同的证明。
- 保持力、摩擦、弹性、卡扣/轮胎形变、材料、承重。
- 外表面与 structural open CLIP/PIN 的混合配对。
- 共面接触的 1 LDU 工程容差；它只能把共面贴合归为 contact，仍需逐类复核，不能作为闭合实体或实物证据。
- `verification.ts` 的旧夹具路径仍以 structural 为主；外表面使用 attach/graph/model 流程，不冒充夹具 PASS。
- 18973 等风挡的 seat 边界接触存在假阳性，尚待接触-穿越策略。
