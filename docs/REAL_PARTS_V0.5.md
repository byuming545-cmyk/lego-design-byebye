# Real LEGO Assembly Expansion V0.5

日期：2026-10-23。工作分支：`codex/real-lego-assembly-expansion`。

本轮把全部 **245 个原生 LDraw 根零件**纳入逐件装配迁移：**78 个通过限定接口的软件装配与生成准入，167 个明确 BLOCKED**。生产运行时重新核对版本、源哈希和保留的接口夹具证据后，仍准入 78 个，`runtimeValidation=ready`，无撤销问题。六种基础结构实际生成成功，轮组保持阻塞，旧汽车生成继续暂停。

说明书里的 **531 个 Element ID 全部取得有来源的 Part / Design / 颜色记录**，但其信任标签是公开镜像的 `source-observed`，已核定的 LDraw 跨编号关系为 0。因此“原生包 78 件可装配”和“531 个说明书元素映射恢复”是两个独立结果，不能合并成整套 Speed Champions 已可生成。

## 打开与使用

安装 Node.js 24.5+，解压本分支 ZIP，在能看到 `package.json` 和 `package-lock.json` 的文件夹地址栏输入 `cmd`。逐行执行，每行成功后再输入下一行：

```cmd
npm ci
npm run build
npm start
```

保持命令窗口打开，访问 <http://localhost:3001/part-lab>。网站使用仓库内固定几何、连接、映射和迁移报告，无需 Rebrickable API Key、Python或启动时联网获取数据。

- **零件检查**：搜索 `3001` 查看真实原生网格、连接点和接口白名单；搜索 `element:4666579` 查看附录页码及外部目录映射，其几何仍未跨编号核定。
- **装配模式**：选择有准入资格的 Part A、Part B 和具体接口，点击自动拼接；查看兼容性、刚性变换、源轴、局部插入区域及碰撞结果。未验证接口即使可见也不能用于生产拼接。
- **基础结构**：尝试墙体、平台、简单车架、盒体、屋顶或基础 SNOT 模块。结果带真实 BOM、步骤与源文件，可导出服务器保留的 JSON / LDraw / CSV。轮组返回具体阻塞原因。
- **说明书与套装**：查看六目标套装、八份文件和明确分母的阶段覆盖；无附录或未读取文件的比例保持未知。

开发用 `npm run dev` 后打开 <http://localhost:5173/part-lab>；统一预览用 `npm run preview` 后打开 <http://localhost:3000/part-lab>。完整迁移不是每次启动必须运行的任务。

## A. Current 200 Parts：全部当前原生零件

实际零件数量为 245，比需求中的“约 200”更大。本轮对所有根编号给出明确结果，包括连接 partial / missing 的条目，没有只挑选简单件。

| 项目 | 数量 | 分母 / 资格 |
| --- | ---: | --- |
| 原生根零件 / 迁移队列 | 245 | 固定 LDraw 根清单 |
| 真实几何导入 | 245 | 源哈希、许可及递归闭包 |
| 连接完整 / partial / missing | 195 / 46 / 4 | 全部仍进入迁移队列 |
| assemblyVerified | 78 | 仅报告列出的具体接口与规则 |
| generatable | 78 | 另需夹具走生产装配路径的 smoke test |
| BLOCKED | 167 | 每件保留原因、源摘要与测试结果 |
| 开放 / 禁用源接口 ID | 1,001 / 3,693 | 原始来源 ID；别名可能对应同一物理接口 |
| 测试过的物理接口 | 1,221 | 与原始 ID 数分开 |
| 预算延后的物理接口 | 978 | 全部保持禁用 |
| 实物拼搭认证 | 0 | 软件装配不等于实拼 |

首轮每件最多测试 **32 个不同物理接口**，按来源截面、性别、方向和空间位置选取。每个根零件都处理，不代表每个口都穷举。相同物理接口的源别名可以共享同一证据；未测、失败、未知机械口仍禁用。大零件的 deferred 明确列入报告，不会用某一个口通过来解锁整件所有接口。

按来源类别分批结果：

| 批次 | 总数 | assemblyVerified / generatable | BLOCKED |
| --- | ---: | ---: | ---: |
| Brick / Plate / Tile | 52 | 43 / 43 | 9 |
| Modified / Bracket / SNOT | 50 | 21 / 21 | 29 |
| Slope / Curved / Wedge | 80 | 4 / 4 | 76 |
| Body / Windscreen / Mudguard | 47 | 9 / 9 | 38 |
| Wheel / Tyre / Axle | 10 | 0 / 0 | 10 |
| Bar / Clip / Detail | 5 | 0 / 0 | 5 |
| 其他来源件 | 1 | 1 / 1 | 0 |

这些批次是原生标题分类，不等于已经恢复说明书的专门汽车组件。通过状态也不承诺所有方向、所有配对或所有几何组合都可拼。

## B. Blocked Reasons

245 个原生根的首要阻塞原因合计 167：

| 原因 | 数量 | 含义 |
| --- | ---: | --- |
| mapping | 0 | 原生根身份已明确；说明书跨编号缺口在另一个恢复队列 |
| geometry | 0 | 根几何已导入；更严格的实体代理问题归 collision |
| connection | 52 | partial / missing 来源或缺少可核定兼容接口 |
| collision | 113 | 原生实体代理、接触姿态或净空检查无法证明通过 |
| special assembly | 2 | 当前标准规则无法验证的专门配合 |
| other | 0 | 没有用不明原因吞掉失败 |

来源网格可构建可靠实体碰撞代理的是 **98 件 ready / 147 件 blocked**。这是代理构建结果，**不是 98 件 assemblyVerified**；具备代理仍须满足连接、姿态、正反向、非法碰撞、图占用和生成路径检查。

说明书恢复队列的另 531 项先阻塞在“缺少核定 LDraw 跨编号关系”。它们已有明确 Part / Design / 颜色记录，`mappingUnresolved=0` 仅表示这一段已恢复，不表示整体装配 unresolved 已清零。两种队列分别计数。

## C. Connection Engine

`ConnectionCompatibilityEngine` 当前正式支持一条范围受限的规则：**有明确来源的标准闭/开凸点 ↔ 带封口的标准底部接收口**，包含具有相同源规格的侧凸点 / SNOT。它检查来源、性别、截面、尺寸、封口、源坐标、插入深度和自由度，不只比较类型字符串。

标准凸点半径 6 LDU、长度 4 LDU 来自固定 Shadow 指令，接收口必须具有对应的单段规格、足够深度且非滑动 / 非居中 / 非专用 group。每个兼容结果保留两端源行、SHA、URL、规则版本及原始指令。详细依据见 [ASSEMBLY_CONNECTION_RULES.md](ASSEMBLY_CONNECTION_RULES.md)。

以下仍返回 `compatibilityUnknown` 或明确不兼容：bar↔clip、axle↔axleHole、pin↔pinHole、wheel↔holder/hub、tyre↔wheel，以及居中、多段、滑动和未解析缩放接口。没有因为半径、group 或名称相同而猜配合。

11 组代表性汽车相关配对中，**3 组通过**：Bracket+Plate、侧凸点+Tile、Jumper offset。Mudguard+body、Windscreen+base、Wheel+Tyre、Wheel+Holder、Axle+hole、CurvedSlope+body、Bar+Clip、Pin+hole 保留具体阻塞原因；没有把这些检查报告为全汽车模块通过。

## D. Transform Solver

`solveAttachment()` 从两端的源 frame 计算 proper rigid rotation 与 translation，保持旋转行列式为 +1，不改原生顶点。适用于规则允许的上下、侧向和经过源旋转的 SNOT 方向；位置由 `fixedAnchor − rotation × movingAnchor` 求出。

候选旋转为绕真实拼接轴的 **0° / 90° / 180° / 270°**，这是保守格点搜索策略，不是对真实圆凸点物理自由度的完整描述。普通凸点不开放任意连续旋转或轴向滑动。规则中的两端方向同向对齐，不能按“公母必反向”套用所有连接。

标准测试包含正向、反向、旋转候选、合法定位及连接图一致性。不能满足兼容、碰撞和图约束的候选被拒绝，生成器尝试其他方向、接口、真实零件，预算耗尽时返回 blocked。

## E. Collision

碰撞使用由原生三角面构建的闭合定向链及 BVH、表面分区和实体关系检查。内部平面封口只有被原始共面源面完全覆盖时才允许；外部孔洞、分叉边界或无法证明的缺口不会凭空补实体。

局部 `Connection Penetration Zone` 取自标准凸点真实半径、长度和世界轴。它表示待检查的连接插入范围，不会整对忽略碰撞，也不能许可实心塑料穿模。数值接触容差为 0.0001 LDU，不用于缩放零件或宣称制造公差。合法标准插接只有在对应整件姿态通过实际检查时才接受；同位实体重叠属于负例。

这是**最终姿态**的有界数值几何检查。输出的两点 insertion path 只是移动接口的轴向接近示意，没有完成整件物体沿全轨迹的扫掠净空认证，也未模拟弹性扣合、材料变形、扣合力或实物扭矩。轮胎嵌套、轮轴和 clip/bar 的专项合法插入尚未通过。

## F. Generator Migration

新增 `Real Parts Generator` 完全使用原生来源、当前生产接口准入和 `attachPart()`。根件建立全局刚性坐标；其余零件的最终位置由 Compatibility → Solver → Collision → Graph Update 求出，生成器只表达结构目标、排序与搜索预算，不写入近似零件尺寸或非根件的魔法位置。

生产目录为当前通过准入的 78 件。实际默认目录 smoke test 请求 7 类：**6 类 generated，轮组 1 类 blocked，失败 0**。

| 模块 | 本轮结果 | 默认模型件数 | 图边数 |
| --- | --- | ---: | ---: |
| wall | generated | 5 | 4 |
| platform | generated | 5 | 4 |
| simple-chassis | generated | 5 | 4 |
| simple-box | generated | 13 | 12 |
| simple-roof | generated | 5 | 4 |
| basic-snot | generated | 3 | 2 |
| wheel-module | blocked | — | — |

来源及检查见 `artifacts/assembly-development/generator-smoke.json`；六种模型的 JSON、LDraw 与 BOM 位于其 `models/<module>/` 子目录。不能把简单无轮车架称为完整汽车。基础 SNOT 当前固定 3 件，其他模块目标参数范围 3–32 件；指定结构不保证任意件数都能满足。

生成结果使用虚拟设计数量，尚未核验拥有库存或颜色供货。LDraw 导出使用 current colour 16，颜色可用性为 `not-verified`；不会把说明书映射颜色直接当作已拥有库存。导出只针对服务器保留、内容哈希与当前源图验证通过的真实装配文档。

**生产真实性审计**：新引擎、生成器和导出没有导入旧参数化目录、手写曲面、placeholder 或虚构轮组。每个实际零件来自固定原生根和递归哈希闭包，所有非根放置走 `attachPart()`，接口权限在服务器核定。旧通用 / Speed / Automotive 的生成、改造与导出门禁保持；历史算法只用于显式 fixture 回归。新生产生成器中的 fake / placeholder 使用数为 0，这不表示仓库历史代码已删除或全部汽车逻辑已迁移。

因此已迁移的是 **6 种基础结构生成**，旧车型生成逻辑仍留在 Legacy，未重新开放。尚无完整真实车轮、轮拱、风挡、车身与车顶共同组成的可生成汽车。

## G. Failed Part Recovery

此前 531 个观察元素全部进入 `Failed Part Recovery Queue`。本轮：**恢复到明确 Part / Design / 颜色映射 531，恢复到装配/生成 0，整体仍 blocked 531**。队列首先记录真实的 LDraw 跨编号缺口，并附来源支持的轮系、组件或柔性分类；后续可按 geometry → connection → collision → assembly → generator 继续分阶段恢复。

不会全部写成泛化 `unsupported`。例如轮胎与轮组带专门配合分类，`[Complete Set]` 轮罩带组件分类；原材料描述和上游类别作为事实保留，未用图片猜结构。

## H. Element ID Mapping

本轮取得 **531 / 531** 唯一原表记录、0 缺失、0 冲突，涉及 290 个不同 Rebrickable Part ID、30 个颜色和 34 个来源类别。172 个元素的 `part_num` 与 `design_id` 不同，两个字段完整保留。

来源：[ojuuji/rb.db 固定公开 release](https://github.com/ojuuji/rb.db/releases/tag/2026-10-22-13-13)，构建 commit `03547a1273f36f7ea7beb5ff7e67bc40830c15d8`。本地完整数据库 SHA-256 为 `7044cba72207698fb52e292638172cf5fb23e8c6b4197d6fd70eaf1e8e328d6d`，与该固定 release 发布校验和一致。已审查 `elements.csv` 字段直接导入流程，未使用镜像生成的自定义表猜 Design ID。仓库只保留本批所需事实和审计代码，未分发完整数据库。

信任标签为 `source-observed`，**独立官方/API 核验 0，已核定 LDraw 对应 0**。镜像构建代码 MIT 许可已保留，Rebrickable 数据本身许可未独立核定，分别记录；不能把代码许可扩大为数据许可。附录未知的备件身份和整套完整性没有因映射自动补齐。更多细节见 [PART_RECOVERY_REPORT.md](PART_RECOVERY_REPORT.md)。

另外研究的 LeoCAD 显式跨编号候选存在冲突与未独立核定许可问题，只作研究记录，没有接入生产映射。相似图片和相同数字的 LDraw 文件都不构成升级依据。

## I. Instruction Coverage

以下分母仅为**可读附录中不同 Element ID**，不是完整套装设计件数或官方库存件数。车型名来自用户需求，表中不宣称已确认完整官方产品元数据。

| 套装 | 已观察不同元素 | Mapped | Assembly verified | Generatable | 装配 unresolved |
| --- | ---: | ---: | ---: | ---: | ---: |
| 77263 BMW M3 (E30) | 173 | 100% | 0% | 0% | 100% |
| 76924 Mercedes-AMG 双车 | 未知，当前册无附录 | 未知 | 未知 | 未知 | 未知 |
| 77239 Porsche 911 GT3 RS | 未知，无已读确认清单 | 未知 | 未知 | 未知 | 未知 |
| 77238 Lamborghini 双车 | 242 | 100% | 0% | 0% | 100% |
| 77254 Ferrari SF90 XX Stradale | 133 | 100% | 0% | 0% | 100% |
| 77257 McLaren W1 | 119 | 100% | 0% | 0% | 100% |

各有附录的四册都为 mapped 100%、resolvedLDraw / geometryReady / connectionReady / assemblyVerified / generatable 0%。77238 的两册按一套去重，第一册自身没有附录。`6572269.pdf` 与 `6592544.pdf` 仍为 transfer-limit，未读其内容或猜测所属套装；可以拆成每份小于 32 MiB 再提供。

逐本 8 项、逐套 6 项报告在 `artifacts/parts-foundation/instruction-coverage.json` / `.csv`。无分母比例为 `null`；存在分母时 mapped 100% 与装配 unresolved 100% 可以同时成立，因为整体恢复还缺几何跨编号和装配证明。

## J. Remaining Critical Parts

优先处理下面已在真实来源表中确认的缺口：

- 六种说明书风挡元素 `6548233`、`6560204`、`6585318`、`6585400`、`6632635`、`6635727`：先核定其具体印刷/模具的 LDraw 对应，不能套用相似透明罩。
- 轮胎 `6575731` → Part `5810`、轮组 `6336858` → Part `72206`、印刷轮毂 `6585316` → Part `7834pr0001`、`6614318` → Part `5808pr0001`：精确跨编号之外还需要轮系入座、保持与净空规则。
- 轮罩套件 `6508995` → Part `6825`：来源明确为 Complete Set，需分清整体/子件与真实组件关系。
- 原生代表件中的轮拱、风挡与曲面：当前存在不能可靠闭合的实体代理；不能为提高覆盖率修补不存在的塑料或忽略穿模。

来源频次清单仍只反映 4 套已读附录观测。`next-50-ldraw-cross-reference-targets.csv` 保存实际观测排名中的下一批跨编号目标；已完成 Part/Design 映射的 531 个元素不会继续出现在旧“未映射元素”待办里。

## K. Next Step：只推荐三项

1. **核定高频基础与关键车身件的精确 LDraw 跨编号。** 按真实观测频次解决冲突、模具与印刷身份，并保留独立可用的来源许可；先让已取得身份的元素进入实际几何链。
2. **扩展装配规则与可信实体代理。** 优先轮系、轮轴、bar/clip 和风挡/轮拱净空，对应专门夹具和负例；同时逐批处理预算延后的接口，已通过零件也不能自动开放未测口。
3. **在新引擎上验证完整汽车子组件。** 先做有来源的底盘+轮组、轮拱+车身、风挡+车顶，再形成单一连接图的整车，加入完整插入轨迹与实物核对；这些条件满足后再恢复汽车生成。

## 版本、报告与复现

每个生成模型保存四个版本：

| 字段 | 本轮实际值 |
| --- | --- |
| partLibraryVersion | `ldraw-c43ed06a-shadow-9b1131fb` |
| assemblyEngineVersion | `native-assembly-0.5.0` |
| connectionRuleVersion | `source-stud-1.0.0` |
| collisionVersion | `native-closed-bvh-partition-1.0.0` |

生产运行时读取 `data/parts-foundation/assembly/migration.json`，重新核对当前版本、每件源摘要、源接口、通过的夹具和离散姿态，再授予具体接口白名单。缺失、损坏、版本不符或来源已变时关闭对应资格，不接受客户端 flags 自我授权。完整原始迁移证据压缩存于 `artifacts/assembly-development/migration-full.json.gz`；运行报告保留所有通过接口的证明，失败案例仅作有说明的压缩表示。

```text
npm run report:parts
npm run verify:assembly
```

第一条从实际注册表、当前生产准入、恢复队列和说明书覆盖重建 JSON/CSV 报告，默认写入 `artifacts/parts-foundation/`；退出码 0 表示运行报告核定 ready，2 表示报告已输出但生产准入未 ready，1 表示命令错误。它不重新执行全量装配迁移，也不把代理 ready 数当 assembly 数。

第二条重新逐件迁移全部根零件，默认最多 32 个物理接口/件，耗时明显长于页面读取；`npm run verify:assembly -- --all-interfaces` 才尝试去掉这一接口预算，资源与碰撞限制仍保留。生成新迁移报告后，应重新运行 `report:parts` 并重启服务读取当前证据。

本报告数值来自实际保存的迁移、当前 runtime 准入和默认目录生成报告。最终验证：整仓 32 文件 / 496 项单元与 API 测试通过，8 项真实开发浏览器场景与 3 项编译预览场景通过，生产构建及类型检查通过；`report:parts` 返回 0。默认车架采用真实 2×4 底板与 4 个 1×1 平板，4 次合法 attach、约 0.22 秒完成，不含轮组。验证记录见 `artifacts/parts-foundation/validation.json`，三维装配与移动端截图见 `artifacts/assembly-development/screenshots/`。
