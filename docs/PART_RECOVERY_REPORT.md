# Failed Part Recovery / Element Design Mapping

此前从用户上传说明书中的 **531 个不同 Element ID** 出发，取得了全部 531 个元素的明确 Part / Design / 颜色表记录。来源是公开的 Rebrickable Downloads 数据库镜像，信任等级保留为 `source-observed`，没有升级成直接官方/API 核验。当前 Phase 4 将完整 Element → 精确 LDraw 身份链细分为四态，不再把外部目录查询成功当作正式几何映射完成。

## Phase 4 精确身份链四态

| `mappingStatus` | Element 数 | 当前含义 |
| --- | ---: | --- |
| `VERIFIED` | 0 | 完整身份链有明确、精确到变体的已审查证据；只有此态可进入几何查询 |
| `PROBABLE_BUT_UNVERIFIED` | 14 | 有唯一显式转换候选，但精确模具、材质、组件或打印身份尚未核定；其中 13 条目标在现有原生库外 |
| `CONFLICT` | 88 | 固定源表对同一设计列出多个不同目标，不能按本地缺件或便利性消除冲突 |
| `UNRESOLVED` | 429 | 没有可采用的显式 LDraw 对应记录，不使用同编号回退 |
| 合计 | 531 | 本次几何查询准入仍为 0 |

实际推进是：复核固定 LeoCAD 表的全部明确候选，保留逐行来源及上下文，完成 531 项四态分流，暴露 30 个设计编号的变体冲突，并用命名空间防止将 LEGO Design ID 当作 Rebrickable Part ID 查找。没有为提高覆盖率虚增 VERIFIED。

兼容字段 `status: mapped`、`mappedBySource`、`mappingUnresolved` 继续只描述 Element → 外部 Part / Design / 颜色阶段；完整链使用 `mappingStatus`、`mappingStatusCounts`、`geometryPipelineAllowed`、`ldrawCandidatePartIds` 和 `evidence`。摘要中的旧 `conflicts` 保留外部目录冲突含义；完整链冲突为 `mappingStatusCounts.CONFLICT` / `mappingConflicts`。报告及每本说明书都保留相同分母与阶段定义。

显式引用也不会自动成为 VERIFIED。引用缺少精确变体审查时仅为 probable；正式审查需要打印身份、模具版本、组件/整组区别、材质、颜色特定元素及替代设计关系都有明确匹配或有依据的不适用记录，并列出已审查的 Element ID。一个颜色/材质元素的许可不会扩散到共享同一外部 Part 键的其他元素。用户提供的验证声明不能自行提升几何准入，且没有对应的 HTTP 升格接口。

唯一在库候选 Element `6514193` → Design `35380` → `98138.dat` 也保留 probable。固定 XML 的该行位于 `Custom Parts NOT in LDraw` 区，前注释标记透明 PC 变体，而相邻 Transformation 指向 `35380.dat`；普通 `98138.dat` 的转换另有 `ty=-0.32`。这些信息不足以证明精确模具/材质及转换关系。其原生接口 `p/stud4o.dat:8:0` 还独立存在 `compatibility-unknown`，不会因此解锁生成。

数据：`ldraw-mapping-review.json` 保存带源哈希的 531 项审查；[交叉引用研究](LDRAW_CROSS_REFERENCE_RESEARCH.md)说明固定来源及字段语义。`artifacts/mapping-review/astra-handoff-input.json` 将 88 个冲突 Element 按 30 个设计编号分组，并加入唯一在库 probable 案例，共 31 个最小交接输入；每项保留 replay Element ID、完整候选、源行及 `EXPECTED_UNKNOWN`，供统一 Astra case builder 生成可运行案例。

## 映射结果

| 项目 | 数量 |
| --- | ---: |
| 已观察的不同 Element ID | 531 |
| 来源原表找到唯一 Part / Design / 颜色记录 | 531 |
| 映射缺失 / 冲突 | 0 / 0 |
| 不同 Rebrickable Part ID | 290 |
| 颜色 / 来源类别 | 30 / 34 |
| 独立官方源核验 | 0 |
| 已核定 Element → LDraw 跨编号映射 | 0 |
| 本批说明书元素装配恢复 / 可生成恢复 | 0 / 0 |

最后两项不会因映射率达到 100% 而自动增加。本轮原生 LDraw 零件的装配迁移是另一组有独立分母的测试；不能把原生零件已通过的结果套用到同数字的说明书元素。

举例：

| Element | Rebrickable Part | LEGO Design | Rebrickable 颜色 | 来源名称摘录 |
| --- | --- | --- | --- | --- |
| 302401 | 3024 | 3024 | 15 / White | Plate 1 x 1 |
| 4666579 | 3749 | 6562 | 19 / Tan | Technic Axle Pin |
| 6336858 | 72206 | 72206 | 0 / Black | Wheel Rim 24 x 12 with Black Tyre |
| 6575731 | 5810 | 5810 | 0 / Black | Tyre 21/24 x 11 |
| 6585400 | 3383pr0003 | 115809 | 1095 / Trans-Black | Windscreen 6 x 6 x 1 1/3 with Black Frame, White Lines Print |
| 6614318 | 5808pr0001 | 118437 | 297 / Pearl Gold | Wheel, Sport 21 x 11, Double Spokes with BMW Logo Print |

其中 172 个元素的 Rebrickable Part ID 与 Design ID 不相同。程序保留两者，既不截取 element 编号，也不去除印刷后缀猜基础件。附录中备件身份仍未知；映射提供颜色与设计身份，不会补造 `isSpare` 或整套库存完整性。

## 来源审查与可复现性

- 公开镜像：[ojuuji/rb.db](https://github.com/ojuuji/rb.db)，固定 release `2026-10-22-13-13`。
- 构建代码固定 commit：`03547a1273f36f7ea7beb5ff7e67bc40830c15d8`。
- 数据库生成时间：`2026-10-22T13:13:22Z`。
- 数据库 SHA-256：`7044cba72207698fb52e292638172cf5fb23e8c6b4197d6fd70eaf1e8e328d6d`，与固定 release 的发布校验文件逐字匹配。
- 审查了下载循环、原始表 schema、CSV 逐字段导入和 CSV header 测试。`design_id` 来自原始 `elements.csv` 列；没有使用镜像自定义表来推断 Design ID。
- 原始数据库只留在工作区 `/tmp/bricklab-rb.db`，未复制入 Git。仓库只保存 531 行所需的最小元素事实、290 个 part / 30 种颜色 / 34 种类别事实，以及带哈希的审计代码。
- 镜像构建代码许可是 MIT，其原文已保留。Rebrickable 数据本身的许可未在本次受限会话中独立核定，没有声称数据为 MIT，也未全量分发数据库或商业软件零件库。

数据与抽取入口：`data/parts-foundation/mappings/manifest.json`、`element-rows.json`、`extract-mappings.py`。抽取脚本验证完整数据库哈希后以只读方式查询；源 SQL 的 trusted schema 功能关闭，没有执行下载来的构建代码。

运行时 `ElementDesignMapper` 校验截取事实文件和审查快照的大小与 SHA-256，严格核对外键、531 项分母及身份命名空间，返回来源、信任标签和原始元素行。同名外部 ID 出现冲突时输出 `status: conflict`；未取得外部记录时输出 `status: unresolved`。完整链另以四态记录；不会选取较方便的候选。调用者修改返回对象不会修改后续映射结果。

## 跨编号与失败恢复队列

`Failed Part Recovery Queue` 已覆盖全部 531 个元素，每个都有明确 `blocked` 原因：已取得 element/part/design/color 记录，但尚无核定的 Rebrickable / LEGO Design → LDraw 文件跨编号证据。因此当前首先阻塞在 `mapping` 的后半段，而非回到“完全不知道零件身份”。

队列另保留来源描述支持的特殊分类，例如 `Wheels and Tyres` → `wheel-system-special-case`、带 `[Complete Set]` 标签的轮罩套装 → `composite-part`。后续跨编号解决后，代码依次检查 geometry、connection、collision、assembly 和 generator smoke test，返回对应阻塞原因；不会把它们全部归为泛化 `unsupported`。

此前对已有 LDraw 文件扫描明确的 `Rebrickable` 关键词及 `LEGO designID / LDD` 注释，没有找到可直接采用的声明。当前补充审查了固定 LeoCAD 转换表，形成上述候选和冲突；仍无 VERIFIED 精确映射。数值相同的文件名只构成潜在查找线索，不作为已核定映射。镜像 `inventory_parts.img_url` 也没有作为依据，因为源文档明确说明可能引用相似零件图片或其他颜色。

## 逐本说明书 Coverage

以下分母为可用附录中**已观察的不同 Element ID**。同一设计不同颜色可能有多个 Element ID；这些数值不等于整套 design part 数或官方套装完整件数。

| PDF / 封面套装 | 观察分母 | Mapped | Assembly verified | Generatable | 装配 unresolved |
| --- | ---: | ---: | ---: | ---: | ---: |
| 6662707 / 77263 | 173 | 173 / 100% | 0 / 0% | 0 / 0% | 173 / 100% |
| 6592556 / 77238 | 242 | 242 / 100% | 0 / 0% | 0 / 0% | 242 / 100% |
| 6592612 / 77238 | 未知，无附录 | 未知 | 未知 | 未知 | 未知 |
| 6617271 / 77254 | 133 | 133 / 100% | 0 / 0% | 0 / 0% | 133 / 100% |
| 6617283 / 77257 | 119 | 119 / 100% | 0 / 0% | 0 / 0% | 119 / 100% |
| 6522905 / 76924 | 未知，无附录 | 未知 | 未知 | 未知 | 未知 |
| 6572269 / 未读 | 未知，transfer-limit | 未知 | 未知 | 未知 | 未知 |
| 6592544 / 未读 | 未知，transfer-limit | 未知 | 未知 | 未知 | 未知 |

套装汇总保留 6 个指定目标。77238 两本算同一套装；76924 当前可读册没有附录；77239 没有已读且已确认的本地清单。没有分母的比例保持 `null`。有分母时，mapped 100% 与装配 unresolved 100% 可以同时成立，因为后者包括未核定跨编号与未通过装配测试的元素。

机器报告：`data/parts-foundation/mappings/recovery-report.json` 保存全部 531 个队列项；`instruction-coverage.json` 保存 8 个文件和 6 个套装的各阶段数量、比例及明确分母。

## 验证

`tests/parts-recovery.test.ts` 的 19 项检查通过，覆盖 531 个真实来源记录、四态分母、Part/Design 独立索引、打印后缀不剥离、唯一候选未审查不升格、模具证据缺失阻断、用户声明不升格、多目标冲突、审查身份错配和文件篡改拒绝、颜色特定元素许可不扩散、probable 即使带 LDraw 字段也不触发几何查询，以及 8 份说明书/6 套装分母和必要装配前提。

`getSourceFingerprint()` 捕获同一 factory 加载的 policy version、manifest SHA、外部元素事实 SHA 和审查快照 SHA，供 Astra replay 及报告校验。测试证明：即使四态数量和外部元素事实未改变，单独修改候选审查说明也会改变审查及 manifest 指纹，不能把“状态恰好一致”当作旧证据仍有效。

仍需推进的关键件包括六种说明书风挡元素、轮胎 6575731、轮组 6336858、印刷轮毂 6585316 / 6614318、轮罩整套 6508995，以及真实车架/车身曲面件。它们现在已有明确 part/design 身份；下一步需要有来源的精确 LDraw 跨编号、对应几何版本和专用装配验证。
