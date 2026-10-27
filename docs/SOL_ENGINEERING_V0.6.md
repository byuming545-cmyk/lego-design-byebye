# Sol 工程推进与 Astra Handoff · V0.6

工作分支：`codex/sol-assembly-verification`。

交付日期：2026-10-24（Asia/Shanghai）。机器报告中的 `generatedAt` 保留实际 UTC 时间。

本版围绕接口补测、多点连接、普通解析修复、生成回归、精确身份链和可重现交接推进。245 个原生根零件继续保留在同一迁移队列。复杂实体碰撞、连续插入与特殊机械规则没有被放宽；无法可靠验证的接口继续禁用。

本轮将 978 个旧延期接口全部处理为明确终态，其中 274 个 PASS、704 个转 Astra；全库 4,632 个物理接口组中 1,248 个 PASS。79 件零件具有限定接口生成资格。`Pending = 0` 表示处理完成，转审接口仍禁用，不表示全部实体装配通过。

## 打开与复现

需要 Node.js 24.5+。下载并解压本分支 ZIP，进入能同时看到 `package.json` 与 `package-lock.json` 的文件夹，在资源管理器地址栏输入 `cmd`，逐行执行：

```cmd
npm ci
npm run build
npm start
```

保持命令窗口打开，访问 <http://localhost:3001/part-lab>。网站从仓库内固定来源和迁移报告读取，不需要 Rebrickable Key 或 Python。开发模式 `npm run dev` 使用 5173；统一预览 `npm run preview` 使用 3000。

重建与诊断命令：

```text
npm run verify:interfaces
npm run smoke:assembly
npm run report:parts
npm run audit:connections
npm run astra:pack
npm run astra:check
npm run astra:case -- WHEEL-TYRE
```

接口重验是有计算预算的工程任务，正常启动网站无需执行。默认参数如下：

| 参数 | 默认值 / 行为 |
| --- | --- |
| `--concurrency` | 2 个隔离 worker，可设 1–4 |
| `--batch-size` | 8，可设 1–32 |
| `--timeout-ms` | 单口 8,000 ms |
| `--part-budget-ms` | 单件调度预算 60,000 ms |
| `--max-retries` | 1 次，可设 0–3 |
| `--checkpoint-dir` | 系统临时目录下 `bricklab-v06-interface-checkpoints` |
| `--part` | 可选逗号分隔零件 ID，仅写该批检查点，不发布全库迁移报告 |
| `--retry-failed` | 重试非 PASS 的有效旧检查点 |

再次执行同一命令会复用仍满足来源、夹具和版本绑定的原子检查点；需要跨临时目录清理保留时显式指定 `--checkpoint-dir`。针对单件诊断后，再不带 `--part` 运行以核对全部检查点并发布全库报告。显式 `Ctrl+C` 中断保留未完成的 PENDING，退出码为 130；预算耗尽则形成 `REQUIRES_ASTRA_REVIEW`。

单个 Astra case 可附加 `--debug` 导出原生网格、连接点、源法向、碰撞代理和求得的局部插入信息。诊断结果不会授予生产生成权限。

## A. Interface Coverage

统一计数口径：原始来源记录是导入后展开的 4,694 条记录；逻辑连接组是展开 grid 之前的源指令实例；覆盖率按来源位置、方向、完整 frame 和 profile 去重的物理接口组计算。所有状态量使用同一分母。

| 指标 | Before | After |
| --- | ---: | ---: |
| Discovered physical frame/profile groups | 4,632 | 4,632 |
| Verified PASS | 987 | 1,248 |
| BLOCKED | 2,667 | 786 |
| Requires Astra | 0，旧版未单列 | 2,598 |
| Pending | 978 | 0 |
| Verified Interface Coverage | 21.3083% | 26.9430% |
| Processed Coverage | 78.8860% | 100% |

`Verified Interface Coverage = PASS / discovered`；`Processed Coverage = (PASS + BLOCKED + REQUIRES_ASTRA_REVIEW) / discovered`。BLOCKED 和转审只表示已经形成明确处理结果，不计入 PASS。没有分母时比例保持 `null`。

Before 来自 [V0.5 物理接口比较索引](../artifacts/assembly-development/v05-physical-index.json.gz)：用统一分组定义索引旧结果，只用于前后比较，不能作为新引擎的装配资格。978 个延期组集中于 16 种已具备局部生成资格的零件，因此扩大接口覆盖不承诺增加相同数量的可生成零件。

占用校验另外将共位置、同方向、同性别的端口保守合并为 4,603 个位置组，用于防止同一插口被重复占用。覆盖统计仍保留 4,632 个 source-frame/profile 组，防止一种 profile 的 PASS 被借给同位置的另一种 profile；两者不混作同一分母。

978 个旧延期目标的实际结果如下，运行未中断：

| 旧延期队列 | 数量 |
| --- | ---: |
| PASS | 274 |
| BLOCKED | 0 |
| REQUIRES_ASTRA_REVIEW | 704 |
| Pending | 0 |
| direct-test | 321 |
| shared-source-precondition | 0 |
| review-dependency | 657 |

全库执行路径为 1,514 个 direct-test、2,433 个 shared-source-precondition、685 个 review-dependency；合计 4,632。共享前置条件失败或同层有界尝试已转审时，关联端口随同禁用；这两条路径没有被写成逐口实体插接 PASS。

PASS 净增 261，覆盖率增加约 5.635 个百分点。旧 987 个 PASS 中 964 个在本轮保留，`3026` 的 23 个接口转 Astra：14 个因零件预算耗尽、9 个因同层超时转审，均没有冒充直接碰撞失败；另有 10 个旧 BLOCKED 在当前测试下转为 PASS。因此不能把 BLOCKED 减少的 1,881 个全部称为已修复。

实际数量来自 [migration.json](../data/parts-foundation/assembly/migration.json)，4,632 条逐口决策见 [interface-tests.json.gz](../artifacts/assembly-development/interface-tests.json.gz)，未裁剪详细报告见 [migration-full.json.gz](../artifacts/assembly-development/migration-full.json.gz)。运行时准入核定为 `ready` 且 `issues = []`。当前逻辑组为 2,862；1,248 个 PASS 物理组对应 1,262 条开放原始记录，另 3,432 条原始记录禁用。原始记录与物理组不混加。

## B. Part Status

| 状态 | 定义 | 当前版本数量 |
| --- | --- | ---: |
| `fullyAssemblyVerified` | 非空的所有当前可识别物理接口组均 PASS | 23 |
| `partiallyGeneratable` | 有已验证接口，但未达到所有接口均 PASS | 56 |
| `blocked` | 无已通过接口，已有明确终态阻塞或转审结果 | 162 |
| `unresolved` | 没有可识别接口，或尚有未完成且无 PASS 的接口 | 4 |

四类合计 245 件。具有限定接口装配/生成资格的为 23 + 56 = 79 件，较旧版 78 件增加 `69906` 这 1 件，没有整件撤销；迁移队列的“无生成资格”166 件包含 162 件 blocked 与 4 件 unresolved。

另列 `interfaceVerificationComplete = 241`：所有可识别接口已达到终态，包括 BLOCKED 和 Requires Astra。它不等于 `fullyAssemblyVerified`，也不自动授予生成资格。运行时还会核对源哈希、夹具证据、四个版本和具体接口白名单，不能通过请求参数自行提升。

## C. Sol Fixes

| 范围 | 本轮实际完成 |
| --- | --- |
| Parser | 修复 `SNAP_CLEAR` 已删除端口的旧尺寸告警作用域，只把被明确清除端口的告警移到保留证据的 `discardedIssues`。`30209`、`29115` 从 partial 变为 ready；全部 245 件的 4,694 个现存点、坐标、法向和来源闭包不变 |
| Parse audit | 完整解析 195→197、partial 46→44、missing 4→4；117 条有效问题实例减少到 114 条，逐项保留源文件、行号、指令、哈希、继承变换和未知解释 |
| Transform / stud / SNOT | 沿用有来源依据的普通凸点/底部规则，求同一刚体变换，检查四种离散旋转、反向关系、半凸点位移、旋转不一致及别名占用 |
| Multi-point graph | 一次放置记录全部可支持、当前已授权的实际接合边，也记录跨多个旧邻居的接触；验证时拒绝漏边、重复占用和未授权的额外接合口 |
| Generator | 所有实际放置仍经 `attachPart()`；占用和步骤按物理端口及实例处理，多边不会重复 BOM 或步骤。记录候选、接受/拒绝、原因、变换/碰撞失败和搜索耗时 |
| Model import | JSON 内容完整性只是第一道检查；导入后核对真实来源、现存零件、接口权限、当前四版本和完整图。VALID 模型重新建立 BOM、步骤和来源，分配新服务端编号；失效返回 `NEEDS_REVALIDATION` 并禁止导出 |
| Mapping | Element、LEGO Design、Rebrickable、LDraw 使用独立命名空间；加入四态、精确变体审查及 Element 白名单，不剥离印刷后缀、不按相同编号回退 |
| Version / source | 解析器版本纳入来源摘要；接口检查点绑定两端源、夹具集合、测试版本及四版本。来源或规则变化时拒绝复用旧证据 |
| Tests | 增加多点漏边、反向连接、别名占用、非刚体导入、源版本失效、覆盖数据拒权、精确身份审查指纹及 Astra 重放回归；最终结果列于文末 |

`30209`、`29115` 的解析状态恢复为 source-ready 后，仍因 `branched-native-boundary` 阻塞实体装配，没有自动授予生成资格；新增准入 `69906` 不归因于这两项 parser 修复。解析、连接兼容、变换、碰撞及装配资格分别检查。

真实多点正例已在定向测试中完成：`3023b` 与 `3023b` 居中堆叠为 2 节点/2 边；`3023b` 底板、两块 `3005` 与顶部 `3023b` 桥接为 4 节点/4 边。额外接合口缺少生产许可时仍被拒绝。大板纯坐标对齐通过不能替代实体净空证明。

导入的 `VALID` 范围是来源、接口和最终姿态连接图。`module` 仅作为导入文件标签，本次校验不认证其已满足车架、屋顶或轮组的结构设计目标。旧参数化通用、Speed、Automotive 生成与导出门禁继续保留。

详细证据：[多点装配](MULTIPOINT_CONNECTIONS.md)、[解析审计](CONNECTION_PARSE_AUDIT.md)、[映射恢复](PART_RECOVERY_REPORT.md)。

## D. Generator Regression

下表只采纳当前 V0.6 生产目录及白名单的实际回归。旧 V0.5 的烟测报告不能代替本轮结果。

| 模块 | 当前版本结果 | 实际实例 / 连接边 | 验证范围 |
| --- | --- | ---: | --- |
| Wall | PASS | 5 / 4 | 普通垂直拼接与实际图 |
| Platform | PASS（基础结构） | 5 / 4 | 平台最小回归；默认结果未发生多点接合 |
| Box | PASS | 13 / 12 | 闭合边界目标、逐件实际放置 |
| Roof | PASS | 5 / 4 | 普通坡件的源变换与实体净空 |
| Simple Chassis | PASS（最小基础结构） | 5 / 4 | 无轮基础结构；长结构、交错和纵向加强目标尚未全部通过 |
| SNOT | PASS | 3 / 2 | 侧向源坐标系与连接图 |

实际 [生产烟测](../artifacts/assembly-development/generator-smoke.json)请求 7 类，6 类 generated、1 类 wheel-module BLOCKED、0 类 failed。轮组没有通过装配验证的轮毂/轮胎/轮架规则，继续禁用。上述基础 PASS 不代表 Platform 的大面积多点目标或 Chassis 的全部加强目标已经完成。

独立 [production bridge probe](../artifacts/assembly-development/regression-probes/production-bridge.json)使用当前真实白名单，完成 4 实例、4 连接边、3 次 `attachPart()` 的多邻居桥接，完整图与碰撞验证 PASS。它与默认 Platform 烟测分开记录。

六类生成共记录 38 次候选尝试、30 次 API 放置调用、30 次接受、8 次因结构设计目标拒绝，变换/兼容/碰撞/占用失败候选均为 0；本轮搜索耗时约 1,408 ms。默认模块 `multiPointPlacements = 0`，多点生产证据为上述独立桥接。BOM 和装配步骤按实例生成，四边桥接不会增加重复零件。

`3020` 与 `3710` 纵向加强尝试已有来源支持的候选刚体变换，但完整原生碰撞达到表面分区上限。保留原合法基础车架，停止该复杂分支，不增加豁免或移动零件强行放入。

## E. Element Mapping

| 531 个观察 Element 的完整 LDraw 身份链 | 数量 |
| --- | ---: |
| VERIFIED | 0 |
| PROBABLE_BUT_UNVERIFIED | 14 |
| CONFLICT | 88 |
| UNRESOLVED | 429 |

全部 531 个元素已有来源支持的外部 Part / Design / 颜色记录，信任标签仍为 `source-observed`，独立官方/API 核验为 0。该阶段 `mapped=531` 与完整 LDraw 身份链 `VERIFIED=0` 是不同口径；正式几何查询仅接受 VERIFIED。因此本批说明书元素恢复到装配/生成的数量仍为 0。

14 个 probable 有唯一显式目标，但精确模具、材质、组件或印刷身份未核定；88 个冲突涉及 30 个设计编号，不按本地缺件删除其他候选；429 个无可采用的显式对应。唯一在库候选 `6514193`→Design `35380`→`98138.dat` 位于源表自定义透明变体区域，不能仅凭唯一目标升格。

审查工件绑定 mapping policy version、manifest SHA、外部元素事实 SHA 和审查快照 SHA。即使四态数量不变，审查内容变化也会让旧交接证据失效。19 项映射定向测试已覆盖这些边界。固定源、上下文和逐项说明见 [映射恢复报告](PART_RECOVERY_REPORT.md)与[交叉引用研究](LDRAW_CROSS_REFERENCE_RESEARCH.md)。

## F. Astra Handoff

当前 [Astra Handoff Pack](../astra-handoff/README.md)包含 **537 个案例**，覆盖 531 个说明书 Element 和 2,598 个转审物理接口。完整 Case ID、类别、受影响零件、原因及复现命令已记录在 [manifest](../astra-handoff/manifest.json)、[完整 CSV 索引](../astra-handoff/cases.csv)及各 `case.json`。按问题/共同前置条件分组，案例数不等于接口数。

| Case ID | Category | Affected parts | Reason | Reproduction command |
| --- | --- | --- | --- | --- |
| [MULTI-3020-3710](../astra-handoff/complex-collision/MULTI-3020-3710/case.json) | COMPLEX_COLLISION | `3020`, `3710` | 纵向加强的完整碰撞未获得可靠净空证明 | `npm run astra:case -- MULTI-3020-3710` |
| [WHEEL-TYRE](../astra-handoff/wheel-system/WHEEL-TYRE/case.json) | WHEEL_ASSEMBLY | `4624`, `3641` | 缺有证据的轮胎/轮毂保持、形变和插入规则 | `npm run astra:case -- WHEEL-TYRE` |
| [WHEEL-HOLDER](../astra-handoff/wheel-system/WHEEL-HOLDER/case.json) | WHEEL_ASSEMBLY | `4600`, `4624` | 缺轮架保持、插入深度和旋转自由度规则 | `npm run astra:case -- WHEEL-HOLDER` |
| [CLIP-BAR](../astra-handoff/special-mating/CLIP-BAR/case.json) | CLIP_BAR | `48729b`, `30374` | 普通 Stud 规则不能证明弹性保持与角度范围 | `npm run astra:case -- CLIP-BAR` |
| [PIN-HOLE](../astra-handoff/special-mating/PIN-HOLE/case.json) | AXLE_HOLE | `3700`, `3673` | 缺专门的插入、保持和净空规则 | `npm run astra:case -- PIN-HOLE` |
| [MAP-4E9E4791DC3DEF](../astra-handoff/unresolved-mapping/MAP-4E9E4791DC3DEF/case.json) | MAPPING_EVIDENCE_MISSING | 候选 `98138`；Element `6514193` | `35380` 的显式目标仍缺精确材质/模具身份核定 | `npm run astra:case -- MAP-4E9E4791DC3DEF` |
| [MAP-79A5EBAC669A5E](../astra-handoff/unresolved-mapping/MAP-79A5EBAC669A5E/case.json) | MAPPING_CONFLICT | 外部 `3069b` | 多个精确变体候选不能凭本地缺件排除 | `npm run astra:case -- MAP-79A5EBAC669A5E` |
| [PORT-3026-F695A2CF67](../astra-handoff/special-mating/PORT-3026-F695A2CF67/case.json) | VERIFICATION_BUDGET | `3026` | 原队列因预算未直测；独立代表已 PASS，整组仍需逐口核定 | `npm run astra:case -- PORT-3026-F695A2CF67` |

类别统计为 COMPLEX_COLLISION 16、HOLLOW_GEOMETRY 113、CONNECTION_PARSE 48、SPECIAL_MATING 49、VERIFICATION_BUDGET 7、WHEEL_ASSEMBLY 2、CLIP_BAR 1、AXLE_HOLE 1、MAPPING_CONFLICT 30、MAPPING_EVIDENCE_MISSING 270。

7 个 VERIFICATION_BUDGET case 的独立代表当前通过；这类案例重现的是预算转审留下的核定缺口，不声称重现几何失败，也不把一个代表的 PASS 扩展成整组生产资格。`3001`/`3020` 的所选两口重放当前净空成立，已从失败案例中移除。

每个案例保留实际源哈希、来源端口、法向、已求得的变换或明确未求解状态、真实输出、最小重放、相关源码/测试、已有合理尝试和停止原因。物理预期统一保留 `EXPECTED_UNKNOWN`，没有独立实物证据时不会写成“应当物理可行”。

缺少精确几何身份的映射案例会保留 `ldrawId: null`、几何摘要缺失及 `NOT_APPLICABLE`；无法求得接合姿态的机械案例保留 `UNRESOLVED`。这些空值表示缺口，不以虚构零件、默认位姿或替代网格补齐。

映射按相同外部 part/design/状态分组，记录全部受影响 Element；原生案例校验精确原生集合及源摘要。映射回放额外校验审查与事实文件的完整指纹。工件哈希不符、版本变化或来源变动时拒绝复用旧案例。

`npm run astra:check` 已对全部 537 个案例独立加载并重放：537 个与记录一致、0 个失败，耗时以最终工件记录为准，证据见 [批量重放核对](../artifacts/assembly-development/astra-replay-validation.json)，绑定当前 manifest SHA。重放吻合表示诊断与记录一致，包含 7 个预算代表 PASS；不表示 537 次实体拼搭通过。

所有 case 均为诊断资料，不会为相关接口授予生产权限。最小重放使用案例记录的精确来源和当前四版本；共同失败前置条件保留原夹具运行路径，不能以另一个恰好通过的零件对替代。

## G. Sol Could Not Reliably Solve

- 大面积、多凸点配对达到完整原生表面分区预算。没有提高碰撞豁免、删除真实凸点或忽略相邻实体；坐标测试通过与完整装配通过分别报告。
- 未证实的继承缩放、复杂截面、三维 grid、finger-joint 及 include override 语义。继续保留源指令与未知解释；解析不清时不补半径、深度或公差。
- 轮胎/轮毂、轮架/轮毂、轴孔和 clip/bar 的保持、变形、插入深度或旋转自由度。没有定义无依据的新机械配合规则。
- 完整插入轨迹扫掠、制造公差、物理承重和实物拼搭认证。最终静态姿态检查不会被称为这些认证。
- 531 项中尚未核定的精确 LDraw 模具、印刷、材质及组件身份。外部目录和显式候选均保留来源等级，未强行补齐。
- 有界调度预算内未能逐口直测的关联接口。7 个独立代表通过也没有自动完成整组核定；这类缺口与真正几何失败分开，保留继续逐口补测的入口。

这些项形成可验证的边界与交接资料，不阻塞普通 Stud/SNOT、解析修复和基础结构回归。

## H. Next Astra Priorities

1. 先复现 `MULTI-3020-3710`，解决多点纵向加强的完整原生表面分区瓶颈。以已通过的 4 件桥接作正例回归；不能通过扩大穿透豁免解决。
2. 依次处理 `WHEEL-TYRE` 与 `WHEEL-HOLDER`，取得轮胎/轮毂/轮架的真实保持、插入深度、旋转与净空证据，再定义独立规则；先不接入轮组生成。
3. 复核 `MAP-4E9E4791DC3DEF` 的 Element `6514193`→Design `35380`→候选 `98138` 精确材质/模具身份，并处理 `MAP-79A5EBAC669A5E` 的变体冲突；证据不足继续维持 probable/conflict，不增加编号回退。

## 版本与验收证据

| 字段 | 当前版本 |
| --- | --- |
| partLibraryVersion | `ldraw-c43ed06a-shadow-9b1131fb-parser-2` |
| assemblyEngineVersion | `native-assembly-0.6.0` |
| connectionRuleVersion | `source-stud-1.0.0` |
| collisionVersion | `native-closed-bvh-partition-1.0.0` |

本轮完整单元回归 `npm test -- --maxWorkers=2`：38 个文件、569 项测试全部 PASS，退出码 0，耗时 90.40 秒。开发浏览器 E2E 的 9 个场景最终均 PASS：初跑 7 个通过，2 个因断言仍引用旧标签而失败；同步实际“已开放原始连接 ID”标签后，定向复测 2/2 通过，没有放宽实质检查或超时。编译预览的 3 个场景全部 PASS（32.4 秒），其前置 build、TypeScript 检查和服务端编译均通过。生产烟测、真实多邻居桥接及全包 Astra 诊断重放结果见上文链接。本次测试结果使用当前 V0.6 来源和版本。

完整验收范围、实际命令、首轮与复测历史、截图及日志 SHA 见 [release-verification.json](../artifacts/assembly-development/release-verification.json)。测试与重放均未授予实物拼搭认证。
