# V0.6 旧体系清理、隔离与数字零件导入边界

审计日期：2026-10-25，Asia/Shanghai。修改前基线 `d001aad09472cbf541d3048666089659c5e87796`，工作区干净。实现分支 `codex/legacy-isolation`。

本轮调整来源治理，不新增车型、零件数量、机械配合或碰撞算法。正式运行仍使用原有 245 种原生零件及当前版本接口资格：4,632 组中 1,765 PASS、786 BLOCKED、2,081 转审、0 Pending，79 种零件至少有部分接口获准使用。

## A. Legacy Inventory

先审计、记录基线和本地数据备份，再修改。机器清单 [legacy-inventory.json](legacy-inventory.json) 覆盖基线全部 **1,896 个受 Git 管理的文件**，逐项列出原路径、SHA、来源、当前用途、类别、现有直接引用、处置和恢复方法；另外逐条记录 531 个 Element 的精确映射状态。清单中“直接引用”不等于生成准入，运行时依赖边界另有自动化测试。

| 资源 | 实际数量 | 原位置 / 调用者 | 结论 |
| --- | ---: | --- | --- |
| 基础手写定义 | 11 条 | `src/lego/catalog.ts`；旧通用生成、展示、库存分类 | 全部属于 64 个旧参数化编号中的重叠项，不重复相加 |
| Speed 目录 | 101 条 | `src/speed/catalog.ts`；旧生成、碰撞、轮组、参考分析、前端缩略图 | 64 个手写参数化外形，37 个只有编号/名称的候选 |
| 手写连接点 | 1,917 个 | 旧 Speed 目录与构造函数 | 网格、侧凸点、轴和配合位置由代码构造；不是 Shadow 原始连接资料 |
| 原生几何 | 245 个根件、732 个源文件 | `data/parts-foundation/ldraw/` → `NativePartRepository` | 固定版本递归解析与逐文件 SHA 校验 |
| 原生连接来源 | 236 个源文件；当前解析统计 4,694 条原始记录 | `data/parts-foundation/shadow/` → 原生连接导入器 | 来源记录不等于获准接口；ready/partial/missing 与装配状态独立 |
| 说明书资料 | 8 条文档记录，6 本已读，2 本传输受限 | `instructions/{manifest,inventories,validation}.json` | 4 份附录、667 行、531 个不同 Element；不代表完整套装库存 |
| 外部编号观察 | 531 条 | `mappings/{manifest,element-rows}.json` | 固定 Rebrickable 表镜像的 source-observed 记录，不是独立官方认证 |
| 精确 LDraw 对应 | 0 VERIFIED、14 PROBABLE、88 CONFLICT、429 UNRESOLVED | `mappings/ldraw-mapping-review.json` | 全部不得凭相同数字自动提供几何 |
| 旧碰撞与配合 | 代码规则，未将规则条数当作零件数 | `src/speed/{geometry,connections,wheelAssemblies,validators}.ts` | 保留历史测试用途，不进入原生引擎 |
| 历史汽车输出 | 17 + 34 个受管理产物文件 | `artifacts/automotive/`、`artifacts/automotive-benchmark/` | 历史预览/参数化成功不构成原生验证 |
| 本地历史会话 | 5 份，私有内容未发布 | `data/automotive/sessions/` | Git 基线不能备份这些未受管理文件；已另做本地备份，原文件保留 |

没有发现 PDF 图片直接转成原生网格的实现。代码能证明手写外形有 64 个独立编号，但不能逐字段证明它们是猜测、测量还是手工转录，因此“从图片猜出的模型数量”记为 **UNKNOWN**。

没有发现应用使用生产关系数据库。持久化是 JSON 源包、私有库存、参考模型和旧会话；缓存是进程内 Map、源解析缓存、浏览器上次模型 ID。镜像 SQL/构建脚本是提取来源证据，不是应用数据库迁移。

## B. Data Classification

文件清单口径为 A=1,614、B=7、C=153、共享基础设施=122。A 包含原生文件和历史版本证据；C 包含 49 个测试文件的 test-only 分类，**这些数字不表示不可信零件数量**。同一个目录可含不同记录类别，例如 Speed 的 64 个外形属于 C，37 个识别候选属于 B。

- **A：保留参考及可信原始来源。** 原生 LDraw/Shadow 包；说明书文档、页码和附录观察；531 条外部编号/颜色观察；原始参考模型、来源链接和车型身份资料。A 的适用范围必须保留：库存可以帮助查编号，不能证明几何；来源链接不代表已访问该网页；旧版原生报告只有在源和版本匹配时才能用于资格核验。
- **B：保留但重新核验。** 37 个无几何候选；未解决的精确编号关系；旧参考分析器根据参数化外形估算的尺寸和连接；提取工具与待核验结果。精确映射逐条保留 PROBABLE、CONFLICT、UNRESOLVED，不改成 VERIFIED。参考分析新增 `sourceGovernance.status=LEGACY_UNVERIFIED`。
- **C：从正式生成中退出。** 64 个参数化外形、1,917 个人工连接点、手写配合/包络/穿透规则、虚构 demo 编号、历史生成成功标记。旧构造器移至 `src/legacy/`，逐条带 `LEGACY_QUARANTINED`、`nativeGeometryVerified:false`、`automaticPromotionAllowed:false`。原路径只保留弃用转发。

任何手写坐标、猜测公差、旧成功标记都永久禁止**自动**升级。后续发现相应真实数字模型时，应导入一条有新来源和新验证证据的记录；不修改旧记录使其冒充原生资料。

## C. Production Isolation

| 验收项 | 当前实现 / 代码依据 | 测试证据 |
| --- | --- | --- |
| 正式库接收旧推测几何？ | 否。`assembly/source.ts` 只列出源清单根件，使用原生几何和连接解析器；`provenance.ts` 检查来源、原生坐标及连接的文件证据；源对象深度冻结 | `parts-digital-import-boundary.test.ts`：伪造来源标记、legacy/element 编号、手写连接被拒绝；245 件仍可导入 |
| 新导入器读取旧连接点？ | 否。只读 LDraw/Shadow 来源；重复源文件和编号冲突在创建哈希表前报 CONFLICT | 同上；`parts-governance-boundary.test.ts` 递归检查运行时依赖 |
| 正式 Generator 使用旧定义？ | 否。`AssemblyService` → 原生 Generator → production `AttachmentEngine` → `NativePartRepository`；仍要求当前逐接口资格 | 新架构依赖测试及现有 assembly-generator/service/API 测试 |
| 原生碰撞继承旧例外？ | 否。原生 `collision.ts`/`proxy.ts` 未修改，不加载 `speed/connections.ts` 的放行或包络 | 新 Test C 把 allowAll/空代理等历史字段附加到真实重叠砖，结果仍是实体碰撞 |
| 旧 API/缓存能恢复生产模型？ | 旧生成、改造、导出保持阻止；新增阻止 `/api/speed/models/import` 和 `/:id/open`。页面不读取上次 ID 进行自动恢复，文件导入与打开按钮禁用 | route 测试覆盖大小写、尾斜杠、编码参数和伪造 fixture 请求；新增浏览器缓存测试 |
| 旧导出 JSON 能冒充新验证？ | 原生导入只采纳编号、姿态和连接图，重新读取服务端源、校验当前版本、权限、哈希和全部连接；重建 BOM 与证据 | 既有 `parts-native-model-import.test.ts` 覆盖缺边、撤权、版本变化、上传假状态和任意字段 |

额外切断了 `parts/api.ts`、`parts/inventoryStore.ts` 通过 `inventory/index.ts` 桶导出间接加载旧目录的依赖，改为只引用独立的错误类型模块。测试用 TypeScript AST 追踪导入、再导出和动态导入，禁止正式原生入口依赖旧目录、旧生成器或旧库存实现。

旧只读目录、会话索引、反馈、参考模型检索、库存分析保留，响应有隔离标记。这些路径不能写入正式源包。没有删除原始存档或清空用户浏览器历史；历史 ID 被忽略。原生运行模型与资格缓存只读当前原生来源及版本，不读取旧 `data/models`。

## D. New Import Boundary

```text
固定 LDraw 清单 → 唯一编号/文件路径/版本/许可核验 → 逐文件字节及 SHA 核验
  → 递归原生几何解析 → Shadow 来源连接解析 → 来源断言/完整性检查
  → 当前版本装配验证报告 → 限定接口正式库 → 原生 Generator

说明书/附录/外部编号表/旧参考模型
  → 来源和状态保留 → 检索、统计或待核验线索
  └─ 不创建原生几何，不写正式连接表，不授予生成资格
```

复用现有 readiness/接口权限，不建立另一套人工“可信等级晋升”。新增 `FoundationPart.sourceMetadata` 展示 sourceSystem、sourcePartId、sourceFile、sourceVersion、provenance、geometryStatus、connectionStatus、assemblyStatus、legacyStatus 和来源文件证据。库存元素明确为 `InventoryObservation / reference-observation-only`，不冒充官方库存认证。

实际几何源是 LDraw，连接源是 LDCad Shadow。Rebrickable 仍只提供命名空间明确的编号、颜色、库存观察。Studio 尚无获准数据及适配器；本轮未导入。新来源未来必须另行审阅格式、编号及许可，不能只填 sourceSystem 标签获得准入。

没有公开几何写入/状态提升接口。旧同名编号不能覆盖原生缓存；旧目录根本不作为原生候选来源。冲突清单明确报错，不选择“最后一条”。文件系统及发布代码是可信部署边界，本轮不声称防御同时拥有代码、源文件和清单写权限的恶意修改者。

下一批原生零件的入口仍是独立的数字源包：保存获准的原始文件与递归依赖、建立带版本和哈希的清单根记录，再经 `NativePartRepository.getPart()` 解析。新根件没有对应当前验证记录时保持禁用；须运行适用装配/接口验证并发布匹配报告后才可生成。不能从旧目录复制尺寸，不能用库存导入 API 代替几何导入，也不能直接给新记录写 `generatable:true`。本轮复用并加固已有入口，没有新增一套重复的零件构造器或自动批量下载服务。

## E. Tests

实际执行记录、耗时和日志摘要见 [validation-results.json](validation-results.json)。

最终完整执行结果：`npm test -- --maxWorkers=2` **42 个文件、590 项通过，0 失败，93.10 秒**；`npm run test:e2e` **10 项通过，0 失败，约 1.1 分钟**；`npm run test:preview` **3 项通过，0 失败，32.1 秒**，包含生产构建和类型检查。新增 17 项单元/API、1 项浏览器测试。资料审计确认 1,896 个基线文件覆盖、996 个受保护哈希一致、531 条映射状态及 2 处物理迁移。

首轮浏览器回归为 9 通过、1 失败：新测试发现旧库存加载逻辑会清除历史模型 ID，已改为隔离时不恢复且不改写历史指针，再完整运行 10 项通过。构建仍有既有的 Vite 大包提示，本轮未扩展到前端分包优化。

| 用户要求 | 对应测试 |
| --- | --- |
| A 旧几何隔离 | 数字来源测试拒绝旧几何/伪造标记；旧路由 import 拒绝；native model import 拒绝无原生编号 |
| B 旧连接隔离 | 数字来源测试拒绝找不到源文件证据的手写连接；正式依赖图排除旧规则 |
| C 旧碰撞例外隔离 | 真实重叠原生砖加旧例外字段仍返回 SOLID_SOLID_OVERLAP |
| D 可信来源优先 | 原生对象冻结、源哈希和同编号实例不被旧副本覆盖 |
| E 编号冲突 | 重复根编号、根文件错配、等价路径、重复 Shadow 文件被拒绝；既有映射冲突测试保留 |
| F 历史参考可用 | 原参考导入与检索测试；新增测试保留原 placements 并标出衍生分析未验证；受保护资料哈希核对 |
| G 正式生成来源审计 | 三个原生入口的传递运行依赖扫描；现有原生生成/服务/API 和浏览器回归 |
| H 缓存/API 隔离 | API 门禁、禁止客户端 fixture 绕过；真实浏览器保留历史 ID 但不发恢复请求、禁用旧导入 |

本轮未改变碰撞、兼容性、求解器、原生文件、迁移报告和源哈希语义，因此保留原资格，不声称重新执行了全部 4,632 组接口长测。是否保持运行资格另由当前源校验和回归确认。

## F. Preserved Assets

[preserved-assets.json](preserved-assets.json) 对 **996 个受保护的来源/资料文件**记录修改前和当前 SHA。732 个 LDraw 与 236 个 Shadow 原文件、说明书提取、编号快照和审查状态都保留。

6 本原始 PDF 仍在任务附件目录，SHA 与此前清单一致：`6522905.pdf`、`6592556.pdf`、`6592612.pdf`、`6617271.pdf`、`6617283.pdf`、`6662707.pdf`。PDF 没有受 Git 管理，**GitHub ZIP 不包含这些原始附件**，包含的是文档来源、提取数据及页码证据。另两本 `6572269.pdf`、`6592544.pdf` 保持传输受限、未读取，不声称已保存其内容。

5 个车型身份种子、来源链接、用户输入资料及参考模型检索能力保留。未把被阻止的官方链接描述成已抓取的图片或已核定尺寸。531 条外部编号观察保留，但独立官方认证数及精确 LDraw VERIFIED 数仍为 0。

## G. Quarantine Manifest 与回滚

[quarantine-manifest.json](quarantine-manifest.json) 列出 160 个 B/C 基线文件的原路径、当前位置、状态、原因和恢复方法；测试文件属于 test-only 管理。两处物理迁移：

- `src/lego/catalog.ts` → `src/legacy/lego/catalog.ts`
- `src/speed/catalog.ts` → `src/legacy/speed/catalog.ts`

其他历史算法和产物保留原位置，通过独立命名空间、引用边界、只读档案和生产拒绝策略隔离，没有盲目搬迁所有参考模块。

开始修改前，完整本地 `data/` 已备份到任务环境的 `/tmp/lego-pre-governance-data.tar.gz`，哈希与大小记录在私有基线 `/tmp/legacy-governance-baseline.json`；未把可能包含用户资料的备份发布到 Git。这个工作区备份不是持久托管备份，迁移环境前需由操作者保存。

恢复历史证据可使用 `git show d001aad:<原路径>` 或在独立 worktree 检出基线，不能将旧文件覆盖正式原生来源。运行时回滚需要恢复匹配的整套代码/目录和重新构建、重启；若只是参考旧算法，使用明确的 test-fixture 工具，不重新开放生产门禁。

复核命令：

```sh
python scripts/audit-legacy-isolation.py --check
npm test -- --maxWorkers=2
npm run test:e2e
npm run test:preview
```

重新生成审计可执行 `python scripts/audit-legacy-isolation.py --baseline /tmp/legacy-governance-baseline.json`；没有本地基线时脚本从指定 Git 基线读取，ZIP 用户可直接执行 `--check`，不需要 Git 历史。

## H. Remaining Risks

1. 历史生成器、参考分析、缩略图仍引用隔离目录；参考测量和旧规则不是原生证据。它们保留是为了检索、展示和可复现历史测试，不属于正式 Generator 的依赖链。
2. `createApp({legacyGenerationPolicy:'test-fixture'})` 和内部 verification 工厂仍供测试及明确声明的历史 benchmark 使用。生产服务器始终调用默认策略，HTTP、环境变量和上传文件不能启用 fixture。未来新增服务器入口必须继续遵守这一约束。
3. 用户自行部署的数据目录不在当前工作区的审计范围；当前程序不会把旧目录读成原生源，但未替用户检查其他电脑上的备份和插件。
4. Rebrickable/LeoCAD 映射数据的独立许可未核定；不把工具代码许可推断成数据许可。Studio 数据无获准来源，未导入。
5. 原始 PDF 不随 Git 分发，两本未读取。旧模型字段的历史作者证据不完整，不能声称全是图片猜测或全有官方证据。
6. 原生几何仍有开放边界、机械配合未完成等旧限制；它们是装配能力缺口，不因本次来源隔离而自动解决。

## I. Final Verdict

**在本仓库交付的正式服务器、原生源仓库、导入 API、原生装配和生成调用链范围内，真实数字零件导入已与旧说明书/手写推测建模隔离。** 旧记录不会自动提供几何、连接、碰撞放行或装配资格；需要复用的历史线索必须通过真实来源重新导入并产生新的验证记录。

这不表示删除了全部旧代码，也不表示适用于任意人手写的服务器入口。上述剩余引用、私有数据边界和显式测试工厂保留在审计中；测试结果以实际执行记录为准。
