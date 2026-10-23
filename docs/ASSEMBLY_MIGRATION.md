# Assembly Migration：当前固定库的逐件结果

本轮处理了固定 LDraw / LDCad Shadow 来源库中全部 **245 个 root 零件编号**，没有只挑选少量简单零件。245 个零件均得到 `assemblyVerified` 或 `blocked` 的明确结果。这里的装配资格只覆盖报告列出的连接接口，不表示整个零件的所有接口都已验证，也不表示完成了实物拼搭。

当前完整执行结果保存在 [运行报告](../data/parts-foundation/assembly/migration.json)；[完整逐口记录](../artifacts/assembly-development/migration-full.json.gz) 使用 gzip 保存，运行报告记录了解压后内容的 SHA-256。

| 项目 | 数量 |
| --- | ---: |
| 全部原生 root 零件 | 245 |
| 原生几何可读 | 245 |
| 完整连接语法可读 | 195 |
| 连接来源部分未解析 | 46 |
| 缺少连接数据 | 4 |
| assemblyVerified / generatable（限定接口） | 78 |
| blocked | 167 |
| 已测试的不同物理接口 | 1,221 |
| 因首轮预算延期的不同物理接口 | 978 |
| 允许使用的原始连接编号 | 1,001 |
| 禁用的原始连接编号 | 3,693 |
| 已验证轮组 | 0 |
| 已验证实物拼搭 | 0 |

原始连接记录可能通过不同源文件路径重复描述同一个物理接口。验证预算按物理接口去重计算；所有等价原始编号通过 `equivalentConnectionIds` 关联到同一份证明，因此原始编号数量与不同物理接口数量不能互换。

首轮每件最多测试 **32 个不同物理接口**。选点先覆盖来源中的连接类型、gender、方向和截面；同类接口按中心、空间极值和最远未覆盖位置分配，避免仅验证大板的一端。小件在接口数不超过预算时全部测试。每个未测试口明确标记 `deferred-interface-budget`，保存到 `deferredConnectionIds`，并保持禁用。

每个开放接口都必须通过真实标准测试件的兼容性、刚体变换、反向连接、合法拼接碰撞、非法重叠、允许旋转、连接图和 `attachPart()` 烟测。来源完整性和可证明的闭合实体代理是前置条件。完整证明绑定该零件及标准测试件的原生几何闭包、连接源文件 SHA、库版本、规则版本、装配引擎版本和碰撞版本。运行版保留所有开放接口的证明，只压缩被阻塞接口的重复说明。

当前可用规则是带明确来源的普通凸点与封口底部接收区域，支持对应的侧向 SNOT 和 quarter-turn 候选。通过这类测试的零件，只能使用对应的普通凸点接口；轮轴、轮胎、卡扣等其他口仍需独立规则和验证。`wheelModuleVerified` 目前全部为 `false`。

167 个阻塞零件按主要原因分为：连接 52、碰撞代理或碰撞证明 113、特殊装配 2。逐件记录保留实际的源文件、行号及细因，包括未支持的截面、继承缩放、缺少连接、开口或分叉边界、无法由源面覆盖的缺口等，不会补造塑料或连接点。

11 个代表性汽车组合中，Bracket + Plate、Side Stud + Tile、Jumper offset 已通过。当前指定的 Mudguard、Windscreen、Curved Slope 组合因对应源网格无法生成完整闭合证明而阻塞；Wheel + Tyre、Wheel + Holder、Bar + Clip、Pin + Hole、Axle 组合分别保留其规则、源解析或标准测试件缺失的具体原因。

在项目根目录重新执行默认范围：

```sh
npx tsx src/cli/assembly-verify.ts --max-interfaces-per-part 32
```

如需继续扩张到所有当前源接口，可执行完整复核；该过程会显著增加计算量，仍不会把失败或未验证接口开放给生成器：

```sh
npx tsx src/cli/assembly-verify.ts --all-interfaces
```

`tests/parts-assembly-migration.test.ts` 验证全部 245 件的队列完整性、当前来源与版本、开放接口的逐项证明、空间选点与延期禁用规则，并实际重跑基础砖板瓦、SNOT 和阻塞样本的装配验证。
