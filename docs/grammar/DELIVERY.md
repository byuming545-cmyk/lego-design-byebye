# 接口优先拼接语法：本轮交付

> **2026-10-27 Bar↔Clip 追加轮次**：当前语法准入计数为 253 总数、
> 100 generatable / 153 blocked；`npm test -- --maxWorkers=2` 当前为
> 53 文件 763/763 通过，`npm run build` 通过。Playwright e2e/preview 因环境
> 缺少 `/usr/bin/chromium` 未执行，不能算作通过。Bar↔Clip 已实现
> source-declared 语法/兼容/求解，两个 CLIP 零件仍因开壳碰撞未进入生成。
> 下文第 2 节及其后的 761/761、11/11、3/3 和 99/154 均为上一轮历史记录。

本轮在基准`35eec2067b4e9a711b65bd0199ac3bb5f89db636`上建立工作分支`codex/interface-first-grammar`，保留原有已验证装配引擎，默认生产入口改为接口语法准入。工作区开始时干净。没有合并main、部署网站、扩大源数据分发许可或重新开放旧生成器。

## 1. 变更与实际效果

旧做法要求零件端口保留具体fixturePartId、成功姿态及逐件smoke证明。新`GrammarAssemblyService`不读取旧migration来决定新件权限，也不与已有库逐件试拼。它检查真实来源、受支持接口规则和可用碰撞实体，派生源端口范围。

普通生成仍调用正式`NativeAssemblyGenerator`与`AttachmentEngine`：family索引选相容端口，local frames直接求有限姿态，再验证同一刚体下所有接触、占用、完整图及实体碰撞。布局搜索可以因空间拥挤回溯，但不靠碰撞来发现接口规则。

旧`AssemblyService`和历史夹具保留为回归工具，过期engine/rule版本明确失效。历史源与映射未删除；默认网站没有旧参数化回退。

## 2. 数量与范围

| 指标 | 基准 | 本轮 |
| --- | ---: | ---: |
| 真实来源根编号 | 253 | 253 |
| LDraw / Shadow文件 | 743 / 245 | 743 / 245，字节全保留 |
| 原生源解析ready/partial/missing | 205 / 44 / 4 | 205 / 44 / 4 |
| canonical COMPLETE/PARTIAL/NONE | 未建立 | 98 / 151 / 4 |
| 生成资格方式 | 87件依赖逐件夹具 | 99件来源/接口语法可选 |
| 新增来源件 | — | 0 |
| 新增语法资格 | — | 12 |
| 新增资格且实际生成/重导入 | — | 9 |
| 本轮专项生成样例 | — | 12个，覆盖22个原生编号 |
| 原生机械轮组／实物认证 | 0 / 0 | 0 / 0 |

99表示有支持的源端口及可靠碰撞几何，可进入布局搜索；不是99件已经逐件装配通过。来源资格的`assemblyVerified`、fixture PASS计数为0，避免伪造已执行验证。实际成功模型的`assemblyValidation.valid`来自正常引擎逐次检查，另外保留connectability/placement/collision/stress/legal/stable各状态。

253件共有5,084个原始feature，均保留ID、原始指令、SHA和继承变换。4,225个feature有规则支持，其中2,531个源端口在99件可选范围内。碰撞实体可用106件；语法sourceReady240件、connectable228件；这些条件交集才是99件。

canonical COMPLETE仅表示当前接口解释完整；可能仍被实体几何阻止。LDCad有feature的零件249件，Studio为0；384个feature无法可靠确定canonical family。原始FGR有9条字面family hint但未形成已验证关节，不能据此猜“缺失最多的接口族”。

本轮源内潜在拓扑：35件SNOT90、14件半格偏移、3件方向反转。它们是来源接口拓扑潜力，不是已生成装配或实物证书。

## 3. 新增资格与实际生成

| 原生编号 | 语法资格 | 普通生成及重新导入 |
| --- | --- | --- |
| 3004 | 已取得，未知缩放端口隔离 | 墙体通过 |
| 3008 | 已取得，未知缩放端口隔离 | 墙体通过 |
| 3009 | 已取得，未知缩放端口隔离 | 墙体通过 |
| 3010 | 已取得，未知缩放端口隔离 | 墙体通过 |
| 3622 | 已取得，未知缩放端口隔离 | 墙体通过 |
| 6111 | 已取得，未知缩放端口隔离 | 长砖墙体通过 |
| 11211 | 已取得，未知缩放端口隔离 | 含侧向接口砖的墙体通过 |
| 24299 | 已取得，未知缩放端口隔离 | 左侧楔形平台通过 |
| 24307 | 已取得，未知缩放端口隔离 | 右侧楔形平台通过 |
| 85984 | 已取得端口资格 | 当前墙体/底盘/SNOT/屋顶/平台任务均受阻 |
| 17454 | 已取得端口资格 | 当前结构目标、碰撞及搜索预算受阻 |
| 52038 | 已取得端口资格 | 当前结构目标、碰撞及搜索预算受阻 |

前三个未成功件未计入9件。资格只证明可推导候选连接；实际遮挡、目标结构及有限搜索仍可能导致无输出，不能据此判定它们所有实物拼法都非法。没有提高预算、伪造塑料净空或改源来凑数。

额外保留32000墙体回归，仍只有4个普通端口开放；销孔、stud3未知尺寸及未解释结构语法没有借普通凸点规则开放。组合成果包括5件加固底盘（3456、32000、69729及3024）和3件侧向结构（3023、3070b、87087）。

[普通API生成记录](../../artifacts/connector-grammar/generation-report.json)逐件保存请求、搜索次数、失败原因与实际来源；每个成功目录含JSON/LDraw/BOM CSV/步骤/来源/重导入/验证文件。[最终代码重导入复验](../../artifacts/connector-grammar/model-revalidation.json)对12个专项模型重新执行普通上传API，12/12 VALID，原导出SHA、图与来源保持一致。

## 4. 已实现的架构能力与边界

`src/parts/grammar/`包含schema、sources、rules、joints、solver、exact、patterns、validation、interaction、library、admission、service和modelAssessment。

25个family和15条规则覆盖完整可扩展词典；RIGID、REVOLUTE、PRISMATIC、CYLINDRICAL、SPHERICAL共用关节模型。轴向区间、真实重叠长度、截面对称、摩擦、detents和未知字段均有明确表示。共位不同feature不再按位置粗暴合并。

C01保留真实固定Shadow来源规则并进入正常生成。BAR_CLIP新增**SOURCE_DECLARED_FIT**来源层（官方LDraw Bar描述 + LDCad male cylinder/clip seat），语法、原生兼容和求解已实现；两个真实CLIP零件仍因开壳碰撞不能进入生产生成，原生模型图/导出当前只启用C01。其余13规则为**条件式算法内核**：只有适用的结构化VERIFIED_FIT证据及完整参数才能推导；数学测试fixture明确标记ALGORITHM_FIXTURE且生产默认拒绝。实际库尚无这些机械配合的充分证据，未宣称真实轮组、销轴或球关节生成完成。

新solver区分圆截面滚转和keyed对称，检查实际轴向重叠及端部约束。球关节可返回SPHERICAL符号自由度；完整球姿态定向求解仍未知。Click角未给出时不猜步长，group或半径相同不能自动建立配合。

精确有理LDU证明5×8=2×20；SNOT90/180、10LDU半格和8LDU高度关系来自接口拓扑。两次90形成180的算法夹具与真实4070/87087、3794b/15573来源测试分开。多点采用同一刚体姿态，1LDU和极小非零误差均不能靠平均或弯曲补偿。

`MechanicalInteraction`使用独立图；齿数只给出代数传动比，不能自动声明齿轮啮合。稳定性是可解释排序启发式，未知质量、摩擦和承载不造数，不会添加连接。

Studio提供有权限且已解码记录的adapter，保留原始ID及未知映射；没有.conn二进制解析器、获准资源集或Studio安装资源复制。新LDCad层复用既有递归/镜像/grid/include/clear读取器，保留未支持的FGR/覆盖语法，未把原始parse ready当作机械规则验证成功。

## 5. 实际验证

最终命令及原始日志见[validation-results.json](validation-results.json)和[logs](../../artifacts/connector-grammar/logs/)：

- `npm test -- --maxWorkers=2`：53文件，**761/761通过**，101.54秒。
- `npm run test:e2e`：**11/11通过**，约1.7分钟；使用统一compiled服务，普通网页生成、下载、上传、源检查和旧链路隔离均实际执行。
- `npm run test:preview`：最后exact-angle修复及UI说明后的**3/3通过**，32.9秒，包含TypeScript、Vite和服务端构建。
- `npm run audit:connectors`：全253源审计，无零件对试拼或夹具测试。
- `npm run coverage:grammar`：13目标中10个实际生成（9个新增资格＋32000回归），另2组合结构通过；8个篡改/禁用接口负向探针通过。
- `npm run smoke:assembly -- --output artifacts/connector-grammar/smoke`：6基础模块生成、1轮组阻止、0失败；4件4边桥接通过。
- 最终普通HTTP重新导入：12个专项模型全部通过，层级结果仍为COMPATIBLE/SOLVED/CLEAR，stress/legal/stable为UNKNOWN。

未重跑旧5,019组逐件夹具来创建新准入。其历史报告原封保留，新语法资格不继承旧PASS，旧版本被回归测试明确撤销。

开发失败如实保留：初次集成13个单测失败，涉及旧统计语义、当时并行未冻结的source/solver修改、旧浮点quarter-turn与跨度fixture矛盾；逐项修正后最终761项全过，没有删除或跳过用例。独立审查另外发现并修复OPPOSITE反向座位、非零偏移滑动区间、非刚性帧被归一化及near-detent容差问题，补了负向及真实世界轴段计算回归。烟测CLI曾仍要求旧migration缓存，已接入grammar eligibility，初次全阻止日志保留。

首次dev浏览器测试为10 PASS / 1 FAIL：开发watch因并行编辑重启，内存模型丢失导致导出404。稳定compiled服务重跑全11通过；随后最后3preview构建核对最新exact-kernel和UI。未把早期失败隐藏为成功。

未执行或未完成：真实机械族端到端原生图、轮组、球关节完整定向、物理应力/公差/稳定性/插入轨迹、实物搭建、未知复杂外壳修复、Studio授权资源、完整车辆生成、部署。现有Vite bundle体积提示仍保留。

## 6. 来源、许可与下一步

与本轮基准相比，743个LDraw和245个Shadow，共988个原始文件及两份manifest字节保持一致；旧几何/连接parser、碰撞proxy与legacy策略未改。逐文件SHA/作者/许可仍以原始清单为准。

LDraw逐文件CC BY条件与Shadow CC BY-SA 4.0署名保留。本轮连接衍生记录及相应图证据继续保留Shadow的相同许可与署名要求；这不扩大历史镜像、PDF、Studio、整个应用、字体或依赖的数据分发许可。没有把未知许可或私有资料放入新的源分发包；本轮没有新增源包，先前包保留历史证明范围。

下一类最值得补的是**Bar/Clip及明确来源的Bar receptacle**，直接服务汽车细节，并可复用轴向区间/自由度内核。需要先补真实身份与配合/插入范围证据，不能把匿名R4圆柱或hollow外观自动当作BAR或中心孔。随后再处理Pin/Axle与轮组配合；复杂碰撞实体和结构目标搜索也是独立瓶颈。
