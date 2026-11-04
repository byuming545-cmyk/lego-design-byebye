# 从开源实现学习到正式生成：接续交付

本轮将真实新件 **14716（Brick 1 × 1 × 3）** 接入正式库，生成了四砖支柱和带 2431 光面板的五件结构，模型、BOM、步骤及导出重导入均有机器记录。两个来源接口都被实际使用。没有新增零件专属拼接规则。

同时完成上一轮的来源关联解析诊断与只读示例复盘，并由负向测试发现、修复了工作台“只检查有限数，没有真正检查刚体矩阵”的问题。旧记录缺少版本字段、规则过期时，列表和详情现在一致显示待复核，不改写历史文件。

这是数字来源、规则和最终姿态验证。**不是安装轨迹、保持力、稳定性或实物认证。** 复杂开壳零件仍按各自合同限制使用；本轮没有修改碰撞容差或几何。

## 现场与边界

- 仓库：`byuming545-cmyk/lego-design-byebye`。
- 工作目录：`/workspace/lego-import-collision`。
- 工作分支：`codex/source-guided-production`。
- 基准：`d3b6299b65bc8bb77c52b989177d3e2b43dc423b`。
- 接续了 `codex/source-guided-improvements` 上未提交的实现与实验，未丢弃或重建它们。
- 本轮 fetch 后，远端 `codex/part-import-production` 仍为 `a1e4210`，没有超过本地基准；旧 `/workspace/lego-design-byebye` 未切换。
- 没有 push、merge 或 deploy。没有读取或覆盖 Git 忽略的用户示例文件。
- 以下结果以本轮命令、晋升账本、模型和测试记录为准；旧报告仅作明确标注的对照。

## 实际计数

| 口径 | 基准 | 本轮结束状态 |
|---|---:|---:|
| 正式真实来源身份，不按颜色重复 | 254 | 255 |
| 结构生成资格 | 105 | 106 |
| 结构阻塞 | 149 | 149 |
| 独立表面合同资格 | 128 | 128 |
| 原始接口解析 ready / partial / missing | 206 / 44 / 4 | 207 / 44 / 4 |
| 保留的原始接口特征 | 5,089 | 5,091 |
| 正式结构开放端口 | 2,546 | 2,548 |
| 本轮真实新增来源 / 准入 / 实际生成 / 晋升身份 | 0 / 0 / 0 / 0 | 1 / 1 / 1 / 1 |

新增的四个口径都指向 **14716**。3062b 属于上轮成果，只计回归。全库 106 个资格不等于本轮生成了 106 个零件；本轮生成覆盖由模型逐项统计，不从资格数倒推。

本轮实际重建并重导入 **8 个模型，覆盖 11 种身份（9 种结构合同、2 种表面合同）**，其中新增身份 1。见 `actual-generation-coverage.json`。历史全库覆盖没有完整的当前版本基准，不能给出可靠的“全库生成覆盖前后数”；本轮新增件的实际覆盖明确是 0→1。

`artifacts/source-guided-production/14716-promotion.json` 保存晋升前后实际审计；`production-evidence.json` 保存当前生成记录及原始文件保留检查。全部 **991** 个基准来源文件原字节与 manifest 哈希保持不变，仅新增两份原始文件（几何根件、Shadow 根件）。

## 现场问题与方法对应

| 问题与可复现案例 | 实际代码与原行为 | 预期、采用方式及结果 |
|---|---|---|
| LDraw 与依赖导入；14716、3037 | `scripts/acquire-part.py` 递归获取固定源；`src/parts/import/bundle.ts` 校验逐文件身份、许可、哈希、复用和冲突。3037 的 Shadow 根返回 404，当前 bundle 必须有同编号根文件 | 保留现有导入器。14716 完成闭环；3037 明确不导入。没有补造 Shadow 文件，primitive-only bundle 留作下一步 |
| Shadow 继承与缩放；3062b | `connections/importer.ts` 保留原始指令与变换；旧 `assembly/types.ts::hasIsolatedUnknownDimensions` 仅根据错误代码为 scaling 判断可隔离 | A：独立实现 `connections/impact.ts::analyzeConnectionImpact`，绑定来源行、SHA、版本、URL、继承变换。缺上下文、未知语法、include/clear、完整性错误仍整件阻止 |
| 两接口相对姿态与插入 | `assembly/solver.ts::solveAttachment` 已由来源接口计算候选，`multipoint.ts`、engine 检查单一刚体姿态和占用 | 复用现有规则和求解器。新件不用零件配对表。复盘仅接受原姿态与来源候选相符，不自动吸附修正 |
| 部分解析影响范围 | 原始诊断存在，但 API/UI 没有统一的接口影响解释 | 同一个 impact 分析被资格辅助判断、真实零件详情、复盘共用。3062b 的缩放问题准确指向 `p/stud4od.dat:8:1`，其他接口仍须独立准入 |
| 复杂网格碰撞；11477、18975、66727 | `assembly/collision.ts`、原生代理已有闭合实体与独立表面合同；这些零件不能全部按闭合实体使用 | D：Three.js 几何边界对照，保留本项目碰撞器。能显示不等于实体可拼；未采用第三方缩小 AABB 的豁免方法 |
| 手动移动、旋转与保存 | `AnimatedPairViewer` 已用 TransformControls；`library/studio.ts::isTransform` 原来只检查有限数组，缩放矩阵仍进入检查 | B：继续使用既有组件；复用本项目 `assembly/math.ts::isRigidTransform`，统一拒绝缩放、镜像、剪切及无效关键帧，不影响原始 LDraw 内部合法依赖变换 |
| 用户反馈复现与版本 | 导出包和会写入新草稿的导入已有；get 原先仅查来源，list 使用持久化 stale，缺版本字段可能报错 | A：借鉴 Nova 来源指纹思想，独立实现只读 replay API/CLI。新增工作台验证版本，list/get 共用当前状态检查；不改写文件，不授予资格 |
| 资格与正式生成关联 | `grammar/admission.ts`、`grammar/service.ts` 与生产 engine 已分开处理来源、开放接口、整体图验证 | 保留并加严局部问题隔离依据，准入版本为 `source-connector-admission-3-impact`。新件走普通 interface-assembly，而非特殊测试入口 |

仍存在的操作问题：工作台按钮步长与 TransformControls 的固定吸附步长，以及按钮全局轴和 gizmo 局部轴的关系，需下一轮统一；本轮没有把它们称为已修复。

## 外部实现读到了哪里

准确版本、实际查看的文件与 SHA-256 见 `artifacts/source-study/upstream-evidence.json`。没有执行这些仓库的安装器或应用入口。

| 来源、版本、许可 | 阅读的实现与判断 | 吸收方式 |
|---|---|---|
| LDCad Shadow `9b1131fb1991f8c0bfc072325e4e12f6271aba35`，CC BY-SA 4.0 | 真实 `parts/3062b.dat`、`p/stud4od.dat`、`parts/14716.dat`，及 geometry primitive 对应 Shadow。接口数据直接来自固定原文件 | B（已有数据源继续复用）。未给不支持的缩放补猜测语义 |
| Three.js r180 `0af9729d0c143a86a1d725d6e2c3ad83301f3f34`，MIT | `LDrawLoader.js` 的 type-1 矩阵、`LDrawParsedCache`、`processSubobject` 的 BFC/镜像；`TransformControls.js` 的 pointerMove、local/world、objectChange | B（已有控件），D（仅实验 LDrawLoader 几何对照）；没有更换生产导入器 |
| ldraw-validator `0635308c5e0876de20633fecd7eb718ebd554b7c`，MIT | `shadow_parser.py::parse_part/_expand_grid/_transform_points`；`connections.py::check_explicit_connection`；`collision.py::_check_narrow_phase` | D。实际执行两个已审查 AST 定义，不运行项目入口。姿态 TODO、网格猜测和缩小包围盒方法不适合迁入生产 |
| LDraw Nova `b176f02b7355ca1d6cb2c4585df2d7d5a95439ad`，AGPL v3 | `common.py::issue`、`validation.py::validate_text/polygon_issues`、`connectivity.py::metadata_summary/placement_path/connection_report/snap_report/apply_snap`；查看其测试与适配层中的 heuristic/编号例外 | A。学习结构化诊断、来源指纹、局部/全局姿态和报告绑定的方法；本项目独立实现，没有移植 AGPL 源码或编号例外 |

没有采用 C 类代码搬迁。LeoCAD、LPub3D、brick-instructions-skill 本轮未开展实现层研究，因其收益低于当前导入和装配问题。官方 `www.melkert.net/LDCad/tech/meta` 上轮访问遇到代理 403，本轮不绕过、不据此猜测新语法。

实验适配层利用 Three.js 私有 parse cache 注入本项目已校验的依赖，并禁止网络回退；这属于有维护成本的对照代码，不能作为生产 API。实验加载未提供完整颜色配置，会报告颜色 16 材质警告；只比较几何边界，不比较外观。

## 真实案例前后对照

### 普通凸点与非法销孔

3001/3024 的真实 Stud 与 Anti-stud 在规则级对齐锚点实验中，两边均接受基本接口配对。用真实 32000 销孔特征替换 Anti-stud，第三方检查器仍返回 true，本项目返回 incompatible。

这是**规则级反例**，不是经过批准的完整物理姿态。原因是外部函数仅检查 gender、SNAP 类型及距离，未检查剖面和朝向。记录见 `artifacts/source-study/validator-comparison.json`；本轮因此没有引入这个兼容算法。

### 3062b：部分解析

原来只能看到 scaling 错误及整件 partial；现在可追到具体源行和继承发生位置。只开放 `p/stud2a.dat:11:0`，`p/stud4od.dat:8:1` 与两个未分类特征继续禁用。三个“未受本次尺寸错误影响”的特征不等于三个可用接口。

去除错误的来源上下文、改变继承变换，或加入缺失 include/未知语法/完整性/资源错误，都会撤销可隔离判断。没有扩大 3062b 的资格。

### 复杂几何与机械案例

七件 Three.js 对照包括 3001、3024、3062b、11477、18975、66727、14716。最大边界差约 `5.272e-7 LDU`。这里只检查边界，不能推出拓扑、实体内部或安装路径相同。

11477 仍有结构代理限制，18975 仍 partial，66727 的分支边界没有被对照渲染解决。轮组没有被准入，也没有凭类别或半径猜配合。

本轮重跑指定表面合同姿态：3001+11477、3024+11477、3001+18973，以及另一个 3001+11477 接口姿态，均得到 surface-only CLEAR。将真实 11477 移入实体的负例得到 COLLISION。诊断保留端口、来源变换、配合区域和命中信息，见 `collision-regression/collision-current.json`。

这是对基准已有碰撞修复的回归，**不计作本轮新修复**；没有把表面通过改称闭合实体通过。

### 手动保存示例

使用真实 3001/3024 来源生成明确标注的开发测试示例，没有复制用户私有记录。

- 原样复盘：CURRENT_MATCH，正式最终姿态整图检查 accepted。
- 来源哈希、身份或版本变化：NEEDS_REVIEW。
- 姿态偏移 1 LDU：不自动吸附，正式姿态拒绝。
- 禁用接口：不能得到正式 accepted。
- 缩放、镜像或非法关键帧：输入拒绝。
- CURRENT_MATCH 仅表示观察可复现；即使原观察是碰撞或未知，重复这个结果也不是合法装配。
- 检查前后用户观察存储字节保持一致；CLI 禁止将报告输出到输入包或常规用户存储路径。

## 14716 正式闭环

来源与根件身份：

- 几何：`pybricks/ldraw@c43ed06a128a10ed65675166bf42eb6fd608b9b0/parts/14716.dat`。
- 原作者：Owen Burgoyne [C3POwen]；根文件 SHA-256 `6a65d7df417ff6a3eb91334cc6db5a6e51dc5a916281d9d732b253eb334fa668`。
- 几何许可：文件声明 LDraw CC BY 4.0；6 个几何文件中 5 个复用既有依赖，保留 James Jessiman 的各文件署名。
- Shadow：`RolandMelkert/LDCadShadowLibrary@9b1131fb1991f8c0bfc072325e4e12f6271aba35/parts/14716.dat`，CC BY-SA 4.0，LDCad Shadow Library 署名。2 个 Shadow 文件中 1 个复用。
- 新增原始文件 2，复用 6，内容冲突 0；精确原生身份 1，候选映射 0、冲突映射 0。本轮没有开展 Element 跨编号映射。

开放接口：`p/stud.dat:8:0`、`parts/14716.dat:8:1`。它们复用已有 C01 规则，不按零件名称猜连接。源模型内部 box5 的缩放属于原文件依赖变换，完整保留；生成放置仍只允许刚体。

生成样例：

| 目录（均在 artifacts/source-guided-production/models） | BOM | 图与步骤 | 结果 |
|---|---|---|---|
| tall-brick-support | 4 × 14716 + 1 × 2431 | 5 placements、4 edges、5 steps | 整图通过，JSON 重导入 VALID |
| tall-brick-column | 4 × 14716 | 4 placements、3 edges、4 steps | 整图通过，JSON 重导入 VALID |
| bar-clip-control | 30374 + 48729b | 2 placements、1 edge、2 steps | 当前版本控制模型 VALID |
| pin-hole-control | 3673 + 32000 | 2 placements、1 edge、2 steps | 当前版本控制模型 VALID |

五件结构是接口生成器实际选择的连接结构，并未声称它是四脚平台或完整汽车底盘。两种 14716 结构都实际覆盖两个开放接口。每个目录保存 model.json、model.ldr、bom.csv、steps.json、sources.json、validation.json、reimported.json。

## 晋升、缓存及失败处理

沿用 `PartImportService.promote` 和事务 journal/ledger：重新验证暂存内容，锁定来源快照，拒绝覆盖/冲突，事务写入，再以新 repository/service 重建目录、资格、接口审计和覆盖报告。运行指针为 `artifacts/part-import/catalogue-current.json`。

当前快照：`d10e9e5ba146e8cebccfacaa870f36527b014b3477b034c92edf3bf79d4485d0`。

旧进程采用明确重启机制，遇到来源快照变化返回 `SOURCE_SNAPSHOT_RESTART_REQUIRED`，API 不缓存目录响应。旧模型重新导入时检查版本、快照、当前端口权限、碰撞和连接图，不静默改写模型。工作台旧记录还需匹配 `studio-validation-2-rigid`；原文件仍保留。

隔离环境生命周期测试覆盖两种真实件的晋升、派生报告、旧服务撤销、旧模型待复验及重新计算校验和后的非法端口拒绝。失败事务、恢复和报告一致性继续由现有 transaction 测试覆盖。未引入热更新系统。

## 复现命令

```bash
# 新环境应按 package-lock 安装；当前环境复用已存在的依赖。
npm run typecheck
npm test -- --maxWorkers=1
npm run build
CI=1 npm run test:e2e
npm run test:preview

npm run evidence:source-production
npm run evidence:import-collision -- artifacts/source-guided-production/collision-regression
npm run study:sources
npm run replay:studio -- --input artifacts/source-study/development-example.json --output artifacts/source-guided-production/development-replay.json

# 单独 checkout MIT 对照仓库到已审查的固定提交后执行：
python scripts/study/validator-reference.py /path/to/ldraw-validator artifacts/source-study/reference-input.json artifacts/source-study/validator-comparison.json
```

获取/首次晋升使用已有命令：`python scripts/acquire-part.py 14716 --output <bundle-dir>`，然后 `npm run import:part -- --bundle <bundle-dir>/bundle.json`。仅在未收录的隔离基准上，使用 `--promote --confirm 14716` 执行首次晋升；当前正式库再次导入同身份应被拒绝。生命周期测试会在临时库可复现这条链路，无需破坏正式库。

实际结果：类型检查通过；全量 **63 文件、824/824 单元测试通过，0 跳过**；构建通过；**14/14 浏览器、3/3 编译预览通过**；独立只读复盘 CLI 通过。没有新增依赖，构建仍有既有的大于 500 kB 分块警告。

初次针对性检查为 14 通过、1 失败，暴露有限数组不等于刚体矩阵；修复后针对性 17/17 通过。初次完整运行 821/823，两项精确目录断言遗漏 14716，补入精确身份和接口后重跑完整套件，最终 824/824（另增加了 1 个保守未知测试）。没有删除断言或跳过失败用例。

机器记录：`artifacts/source-guided-production/validation-results.json`、`unit-results.json` 及 `logs/`。失败记录保留为 `targeted-initial.log`、`unit-initial-results.json`、`unit-initial.log`。运行代码指纹见 `runtime-code-evidence.json`；晋升发生于未提交工作区，原账本的 codeCommit 为 null，未伪造提交绑定。

普通页面的 14716 生成/重导入截图位于 `screenshots/14716-generation-reimport.png`，展示两件实例；它与上面的四件、五件 CLI 样例分别记录。移动端展开来源诊断也通过了无横向溢出的浏览器检查。离线历史生成器的回归测试通过不等于它们重新获得生产入口，公开隔离路由测试仍通过。

## 修改文件定位

- `connections/impact.ts` 与 registry/PartLab/准入辅助判断：统一来源关联诊断。
- `library/studio.ts`、`library/api.ts`、`cli/studio-replay.ts`：只读复盘、刚体输入与版本失效。
- `cli/source-production-evidence.ts`、`cli/source-study.ts`、`scripts/study/validator-reference.py`：可重跑的正式模型及独立对照实验。
- `tests/parts-connection-impact.test.ts`、`parts-studio-replay.test.ts`、接口 API、真实晋升及浏览器测试：正反例与完整回归。现有目录测试仅更新真实新增身份与精确计数，保留历史断言。
- 两个新原始文件、两份追加清单、晋升账本和派生报告：均由正常导入/晋升流程生成。
- `.gitattributes` 保留来源包原字节；`.gitignore` 同时忽略依赖目录及工作树共享依赖的符号链接。未增加依赖。

完整路径清单见 `artifacts/source-guided-production/changed-files.json`。

## 下一步按收益排序

1. 支持没有同编号 Shadow 根、但实际几何依赖已有可信 primitive connectivity 的导入包；需显式表达来源缺席与闭包，不补造文件。3037 是明确需求样例，尚未取得完整闭包。
2. 统一工作台按钮与 gizmo 的步长和坐标空间，继续用 TransformControls，并用姿态回放验证操作保存。
3. 针对一个真实阻塞的 Shadow 特殊语法取得权威语义，再补解析及影响范围测试；不能只靠外部不完整 parser。
4. 对结构碰撞代理的分支边界/开放壳体逐类建立来源保真的证明；没有依据时保留 UNKNOWN。
5. 轮组先补真实接口与配合证据，再实施净空、运动和最终姿态验证；不从渲染或相近尺寸推出兼容。

来源包仅有核定许可的几何/Shadow、必要许可文本和署名记录；未混入 PDF、Studio 安装资源、私有映射或旧模型。以上数据许可不扩大为完整应用的统一分发许可。
