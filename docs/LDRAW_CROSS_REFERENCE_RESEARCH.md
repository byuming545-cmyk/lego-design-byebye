# LEGO Design → LDraw 交叉引用限定研究

本次研究找到了一份明确记录 Design 与 LDraw 文件对应关系的公开候选表，但**没有把其中任何记录接入已核定生产几何映射**。Phase 4 已将候选审查接入运行时：531 项完整身份链明确分为 `VERIFIED: 0`、`PROBABLE_BUT_UNVERIFIED: 14`、`CONFLICT: 88`、`UNRESOLVED: 429`。外部 Part / Design / 颜色映射成功，与正式几何准入及装配通过仍分别统计。

初始研究见 [cross-reference-candidates.json](../artifacts/assembly-development/cross-reference-candidates.json)。当前带哈希的运行时审查为 `data/parts-foundation/mappings/ldraw-mapping-review.json`，增加源表分区、相邻注释及转换行。文件不包含完整 XML 或 LeoCAD 程序代码；所有候选均未授予几何准入。

## 固定来源及字段语义

- 仓库：`leozide/leocad`，固定提交 `306520badc87c00cc4afd29c2cb45496b5c286bd`。
- 映射表：[resources/ldraw.xml](https://github.com/leozide/leocad/blob/306520badc87c00cc4afd29c2cb45496b5c286bd/resources/ldraw.xml)。源文件 1,528,877 字节，SHA256：`2c1ddba5985edecaff361be7a63187e08877aec0a08ae35ec5e4ac04b1025a4b`。
- 表头注释日期为 `2025-03-17`，映射版本说明为 `LDD 4.3.11 Brick ver 2670`，并列出社区维护来源；这不是 LEGO 官方 API 的独立核验。
- 同提交 [common/lc_lxf.cpp](https://github.com/leozide/leocad/blob/306520badc87c00cc4afd29c2cb45496b5c286bd/common/lc_lxf.cpp) 的 `lcLoadLDrawXML` 读取 `<Brick lego="…" ldraw="…" />`，`lcImportLXFMLFile` 使用 LXFML `Part.designID` 查询该表。因此本次按设计编号解释 `lego` 字段，而非按 Element ID 解释。
- 语义审查代码文件 7,122 字节，SHA256：`ffb7afe8f742486c8900e4fe1cbf18a826bc23352c73cd252579903ac26ede9f`。只审阅代码，没有复制该程序实现。

只统计明确的 `<Brick>` 对应记录。原程序存在“无记录时使用同编号 `.dat`”的回退，本项目没有采用；仅有 `<Transformation>` 或相同数字也不会提升身份可信度。

## 本批结果

完整源表包含 3,216 条 `<Brick>` 记录、2,268 个不同设计编号。本次逐项比较本项目的 531 个已观察 Element，以及固定原生清单的 245 个根零件。

| 全表对该设计的结果 | Element 数 | 处理 |
| --- | ---: | --- |
| 没有明确 `<Brick>` 记录 | 429 | 保留未解决，不按相同编号回退 |
| 有多个不同 LDraw 目标 | 88 | 保留冲突，不自动选模具或别名 |
| 全表仅一个目标，但不在当前原生库 | 13 | 保留候选，不创建占位几何 |
| 全表仅一个目标，且在当前原生库 | 1 | 仅研究候选，未接入生产映射 |
| 合计 | 531 | 本次生产交叉引用新增 0 |

其中 102 个 Element 有明确记录，64 个至少有一个目标在当前原生库中。它们不是 102 或 64 个已核定的 LDraw 映射：这些统计包含冲突。

88 个冲突 Element 中，53 个只有一个候选恰好在当前原生库，10 个有多个候选在库。**不能因为本地缺少其他候选，就把剩下的一个视为已核定。** 例如 Design `3005` 在源表中同时出现 `3005.dat`、`30071.dat`、`35382.dat`；本研究没有擅自消除老模、新模或导入导出替代关系。

## 唯一在库候选仍不能生成

源表 [第 31612 行](https://github.com/leozide/leocad/blob/306520badc87c00cc4afd29c2cb45496b5c286bd/resources/ldraw.xml#L31612) 明确列出 Design `35380` → `98138.dat`。本批来源映射中 Element `6514193` 的 Design 为 `35380`，因此这是一条全表目标唯一、且原生文件在当前库内的候选。

Phase 4 进一步核对发现，该源行在第 30683 行起的 **Custom Parts NOT in LDraw** 区；第 31610 行注释带 `[NOT]` 并标明透明 PC 材质变体，第 31613 行相邻 Transformation 却指向 `35380.dat`。普通 `98138.dat` 的 Transformation 在第 15930 行，另有 `ty=-0.32`。因此不能只凭唯一转换目标证明精确模具、材质及转换语义，状态保留 `PROBABLE_BUT_UNVERIFIED`。

另外，当前 `98138` 的装配迁移结果仍为 `blocked`：

- `assemblyVerified: false`，`generatable: false`；
- 原因为 `no-verified-interface`、`compatibility-unknown`；
- 来源接口 `p/stud4o.dat:8:0` 的 profile、插入深度、保持结构及具体配合语义未被当前规则支持。

即使后续采纳这条身份交叉引用，也不能绕过装配准入，更不能据此解锁轮组或汽车生成。

## 后续整合审查

LeoCAD 的 [README](https://github.com/leozide/leocad/blob/306520badc87c00cc4afd29c2cb45496b5c286bd/docs/README.md) 与 [COPYING](https://github.com/leozide/leocad/blob/306520badc87c00cc4afd29c2cb45496b5c286bd/docs/COPYING.txt) 说明程序采用 GPLv2。映射文件本身没有独立许可声明，并引用第三方社区维护来源，因此这里没有把程序许可直接断言为映射数据的独立许可。数据来源、许可与冲突语义是后续整合审查项，不是请求用户批准的流程。

运行时按 `lego-design` 与 `rebrickable` 两个命名空间检索显式引用，不会把 Design 值放入外部 Part 键中。只有有完整精确变体审查、无其他目标冲突的 `VERIFIED` 链才返回正式 `ldrawPartId`；其余目标只在 `ldrawCandidatePartIds` 中保留，`geometryPipelineAllowed` 为 false。

身份映射通过后，几何、连接、闭合代理、装配夹具和生成烟测依然逐项执行；本研究没有提高任何生产准入标志。31 个分组交接输入见 `artifacts/mapping-review/astra-handoff-input.json`，覆盖全部 88 个冲突 Element 与唯一在库 probable 候选。
