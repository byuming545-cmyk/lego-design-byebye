# Connection Parse Audit

本轮逐件导入现有 245 个原生根零件，记录每个解析问题的根零件、原始文件、行号、完整指令、错误、源文件 SHA-256、继承变换及保留下来的端口证据。没有补造端口或机械尺寸。结果见 [report.json](../artifacts/connection-parse-audit/report.json)、[failures.csv](../artifacts/connection-parse-audit/failures.csv)；修改前基线保留在 [before.json](../artifacts/connection-parse-audit/before.json)。

| 解析结果 | 修改前 | 本轮 |
| --- | ---: | ---: |
| ready | 195 | 197 |
| partial | 46 | 44 |
| missing | 4 | 4 |
| 保留的原始连接记录 | 4694 | 4694 |
| 有效问题实例 | 117 | 114 |

`ready` 仅表示当前支持的语法已解析。它不授予兼容、碰撞、装配或生成资格；这些门禁仍须独立运行。

唯一的语义修复是 `SNAP_CLEAR` 的诊断作用域。现有解析器已经执行源指令删除端口，但先前被删除端口的尺寸缩放告警仍会残留。现在只在同一作用域内，明确的源 `SNAP_CLEAR` 已删除该告警涉及的全部端口时，才把告警移到 `discardedIssues`，同时保留原始指令及清除指令证据。未删除的端口、未知 CLEAR 条件、语法错误、缺失来源和资源上限告警都不会因此变成成功。

实际受影响的只有：

- `30209`：源 `parts/30209.dat:8` 的 `[id=axleHole]` 清除了相应继承点，移出 1 条缩放告警；仍保留 18 个原始点。
- `29115`：源 `parts/s/29115s01.dat:8` 的 CLEAR 清除了相应继承点，移出 2 条缩放告警；仍保留 61 个原始点。

全部 245 件修改前后的完整 `points` 序列 SHA-256 和源闭包 SHA-256 都相同。没有修改 LDraw 顶点、Shadow 指令、端口坐标、截面、法向或源文件字节。解析器版本为 `ldcad-shadow-parser-2-clear-scope`，已纳入原生来源摘要；零件库版本同步升级为 `ldraw-c43ed06a-shadow-9b1131fb-parser-2`，旧装配证据须重验。

剩余 114 条问题对应 23 个独立源位置，其中 110 条进入复核，4 条明确缺少连接来源：

| 原因 | 实例数 | 保留边界 |
| --- | ---: | --- |
| 继承缩放 | 94 | 不推测有效半径、长度、插入量或公差 |
| Finger-joint 语法 | 9 | 不推测关节配合及机械自由度 |
| Include override | 4 | 不推测 `slide=true` 的传递、替换语义 |
| Grid 语法 | 2 | 不按未证实的三维轴序展开 |
| `L_` 等复杂截面 | 1 | 不推测肩部、保持结构及啮合长度 |
| 连接来源缺失 | 4 | 不生成替代端口 |

例如 `3673` 的 `parts/3673.dat:10` 使用 `L_` 截面，`18975` 与 `52107` 有当前子集以外的 grid 写法，`45411` 的 include 使用 `slide=true`。报告保留原始文本及最小重放命令。缺失来源的根零件是 `18977`、`103918`、`17457`、`71771`。所有尚未确定的物理解释保持 `EXPECTED_UNKNOWN`，不表示预期物理 PASS。

重跑全部审核：

```sh
npm run audit:connections
```

重放单件并另存输出：

```sh
npm run audit:connections -- --part 3673 --output /tmp/bricklab-parse-3673
```

定向验证：

```sh
npx vitest run tests/parts-connections.test.ts tests/parts-connection-clear-scope.test.ts tests/parts-connection-audit.test.ts
```

这 16 项测试验证 CLEAR 作用域、未知条件及诊断上限不会放宽门禁，并逐件核对全部 245 个根零件与修改前来源、端口摘要。复杂截面、非刚性继承和特殊机械接口留给后续有来源依据的复核。
