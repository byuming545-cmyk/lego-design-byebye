# 外表面碰撞合同（exterior-shell）交付报告

## 结论

新增了**逐 placement 显式选择**的 `exterior-shell` 表面碰撞合同。默认 `structural` 闭合实体路径没有被替换；同一个零件可以在不同 placement 使用不同合同。

真实来源样例 `3001`（structural）+ `11477`（exterior）已经走通：

```text
C01 COMPATIBLE
→ 刚体姿态 SOLVED
→ exterior-surface-clear / EXTERIOR_SURFACE_CLEAR
→ engine.attachPart 接受
→ engine.validateGraph valid
→ exterior-shell 模块生成 2 placements / 1 edge
→ JSON 导出（19,878 bytes）
→ 重导入 VALID
→ placement 保留 collisionClass: "exterior-shell"
```

这不是闭合实体、厚度、承重、保持力或实物认证。

## 改动

| 层 | 文件 | 内容 |
|---|---|---|
| 类型 | `src/parts/assembly/types.ts` | `CollisionClass`、placement/attach 可选合同、资格字段与 helpers |
| 代理 | `src/parts/assembly/proxy.ts` | `exterior-source-surface`；真实三角形、保留开边界、无 cap/volume/containment；缓存按合同区分 |
| 碰撞 | `src/parts/assembly/collision.ts` | `native-exterior-shell-3.0.0`；shell↔closed、shell↔shell；真实交叉、seat、共面/退化计数；接触点必须在共面接触片 1 LDU 内才放行；proof flags |
| 装配 | `engine.ts` | 资格、接口、占用、多点、整图复验按 placement 合同 |
| 导入导出 | `documents.ts`、`modelImport.ts` | 合同写入 JSON、校验/保留；缺失按 structural 处理，不静默降级无资格零件 |
| 服务/API | `service.ts`、`api.ts` | attach 接受 `collisionClass`；生成模块与参数校验 |
| 准入 | `admission.ts`、`grammar/service.ts` | spatial 与 exterior 资格分离；结构 `generationEligible` 保持 104 |
| 生成 | `generator.ts` | `exterior-shell` 模块，显式移动 placement 标记；保留 root structural |
| 测试 | `tests/parts-assembly-exterior-shell.test.ts` 等 | 合同、真实配对、负例、导出重导入、准入、API |

## 计数

| 指标 | 变化 |
|---|---|
| 253 个来源根件 | 不变 |
| structural 可生成 | 104（不变） |
| structural 阻塞 | 149（不变） |
| `exteriorGeneratable` | 0 → 128 |
| 两者都不可生成 | 21 |
| 真实外表面模型 | 0 → 1（3001 + 11477） |
| 真实导出/重导入 | 1 个模型 VALID |
| 物理搭建 | 0，未认证 |

`exteriorGeneratable` 是“该零件可以建立真实外表面代理，并且有来源接口”，**不是**“已经通过某个真实配对”。本轮验收模型为 `3001+11477`。更严格的逐穿透过滤后，`3024+11477` 被判定为 seat 外真实交叉并保留失败；`3001+18973`、`3024+18973` 仍失败。

## 真实配对

| 固定 | 移动 | structural | exterior | 说明 |
|---|---|---|---|---|
| 3001 | 11477 | 拒绝 `part-or-interface-blocked` | 接受 | 验收模型 + 导出 + 重导入 VALID |
| 3001/3024 | 18973 | 拒绝 | 仍阻塞 | seat 边界接触策略未完成；不作为通过样例 |
| 30374 | — | — | 不再获得外表面资格 | 闭壳零件不自动降级；无 C01 接口不被外表面合同补造 |

`18973` 的见证点在来源 seat 外，当前表面接触/rim cavity 的“接触还是穿透”策略仍不完整。报告中保留为 blocked/UNKNOWN，不改样例、不删除断言。

## 负例

- 3001 + 3024（无合同）：仍为 `native-solid-clearance` / `NATIVE_SOLID_CLEARANCE`，`closedSourceProxies:true`、`structuralSupport:true`、`containmentChecked:true`。
- 11477 / 18973 的 structural proxy：仍为 `open-external-shell` / `branched-native-boundary`，结构资格仍为 false。
- 外表面穿过 brick：`EXTERIOR_SURFACE_COLLISION`，有 witness，不是 seat 接触。
- 两个外表面互穿：`EXTERIOR_SURFACE_COLLISION`。
- 两个外表面远距离：`exterior-surface-broadphase` / `EXTERIOR_SURFACE_CLEAR`，不需要 seat。
- 无接口开壳（3641/23448/45411）：`exteriorGeneratable:false`，attach 被拒绝。
- 闭壳零件（3001/3024/3005）：不获得 exterior 降级。
- 缺失 `collisionClass` 的旧模型：按 structural 处理；没有 structural 资格则 revalidation 拒绝，不会静默通过。
- 旧 collision version：`native-exterior-shell-3.0.0` 提升使旧碰撞证明作废，不重标为当前通过。

## 证明范围

明确写入 proof：

```text
exteriorSourceSurfaces: true
openSurface: true
surfaceCrossingChecked: true
closedSourceProxies: false
containmentChecked: false
structuralSupport: false
wholePairExempted: false
completeSurfacePartition: false
degenerateTriangles / coplanarContacts
```

因此只能声明“最终姿态的真实表面交叉检查通过”，不能声明：

- 闭合实体/厚度认证；
- 承重/结构支撑；
- 卡扣/轮胎形变、摩擦、保持力；
- 安装路径；
- 实物拼搭；
- 所有外表面零件的自动通过。

## 验证

- `npm run typecheck`：通过。
- `npm run pilot:exterior-shell`：生成、导出、重导入通过。
- 全量测试（本轮最终代码）：802/802，58 files，112.30 s；详见 `artifacts/part-import/unit-hardened.txt`。
- 外表面专项：`tests/parts-assembly-exterior-shell.test.ts` 5/5。
- API 专项：`tests/parts-assembly-api.test.ts` 12/12。
- `npm run build`：见 `artifacts/exterior-shell/logs/build.txt`。

## 剩余缺口

1. 安装路径未验证；最终姿态不等于路径可行。
2. 18973 的 seat 边界/rim 接触仍未通过；当前 1 LDU 共面容差只处理已识别的贴合，不覆盖该类真实边界接触。
3. 外表面 ↔ structural open CLIP/PIN 仍 blocked。
4. `verification.ts` 旧夹具路径仍以 structural 为主；外表面使用 attach/graph/model 流程，不冒充夹具 PASS。
5. 生成模块自动搜索可能达到预算；验收样例显式传入 `requiredPartIds:['3001','11477']`。
6. 没有物理样件、保持力、摩擦或材料证据。
