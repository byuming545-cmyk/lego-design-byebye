# Connector Grammar：接口优先的 LEGO 拼接语法

本版把“识别一个来源可信的接口”与“验证一次具体装配”拆开。新零件只描述自身的几何、接口、局部坐标与来源；通用规则根据接口语义推导兼容性和候选姿态。零件描述没有 `can_connect_to=[partA,partB,...]` 字段，加入零件也不要求遍历已有零件做试拼。

实际生产通过 `GrammarAssemblyService` 提供来源派生资格，继续使用原有原生几何、刚体装配、碰撞、连接图、模型输出和上传复验能力。逐件夹具结果保留为历史回归证据，不是当前语法准入依据。简短现状审计见 [ARCHITECTURE_AUDIT.md](grammar/ARCHITECTURE_AUDIT.md)，来源核查与访问边界见 [SOURCE_REVIEW.md](grammar/SOURCE_REVIEW.md)。

## 1. 四层职责

| 层 | 输入与输出 | 不得代替的证明 |
| --- | --- | --- |
| A：Connector | 来源接口记录 → canonical `Connector[]`；保留位置、截面、局部帧、轴向区间和出处 | 接口存在不等于能与某个接口配合 |
| B：Compatibility Grammar | 接口族、角色、截面和来源配合策略 → `COMPATIBLE / INCOMPATIBLE / ILLEGAL / UNKNOWN` | 兼容不等于某个零件摆放后没有碰撞 |
| C：Joint / Constraint Placement | 两个局部接口帧、插入范围、对称与自由度 → 刚体候选、运动姿态族及多点一致性 | 一个端口对齐不等于全部端口闭合、安装轨迹可行 |
| D：Assembly Validation | 整个连接图、实际原生实体及来源 → 碰撞、刚体闭合、应力合法性与稳定性分项结果 | 静态通过不等于材料安全、稳定、可安装或实物拼搭通过 |

```mermaid
flowchart LR
  S[固定版本原生来源] --> A[Connector ingestion]
  A --> B[Family / profile grammar]
  B --> C[Frames · insertion · joints]
  C --> M[单一刚体姿态下多点闭合]
  M --> D[原生碰撞与占用]
  D --> V[合法性及稳定性分项]
  V --> O[模型 · BOM · 步骤 · 导出及复验]
  A --> P[Topology pattern classifier]
  C --> P
```

`BuildingPatternClassifier` 是建立在A/C层上的能力分类器，不参与兼容许可判定。机械传动/接触属于独立的 `MechanicalInteractionGraph`，不混入结构连接图。

## 2. 模块与主要API

| 模块 | 职责 |
| --- | --- |
| `src/parts/grammar/schema.ts` | canonical feature、来源、匹配策略、关节、候选和状态 |
| `sources.ts` | LDraw递归继承结果/LDCad适配、来源冲突、合法Studio已解码资料适配 |
| `rules.ts` | 族/角色/截面/来源策略匹配，及单接口语法前提检查 |
| `joints.ts` | 五类关节、轴向区间、角度范围与卡点 |
| `solver.ts` | 接口帧直接计算少量刚体候选，保留连续自由度 |
| `library.ts` | 按接口族索引候选及真实零件描述，未注册零件对许可表 |
| `admission.ts` | 从当前来源、已识别接口语法和碰撞几何派生可选资格 |
| `service.ts` | 普通网站的生产能力提供者，复用原生装配/导出/导入服务 |
| `exact.ts` | 有界有理数LDU运算和精确端点闭合 |
| `patterns.ts` | 局部/已解装配拓扑的SNOT、偏移及关节能力分类 |
| `validation.ts` | 多点、插入/姿态、后置碰撞、应力合法性、稳定性分项 |
| `interaction.ts` | 齿轮、齿条、链、带、凸轮和轮胎接地的独立数据模型 |

主要入口是 `adaptNativePartConnectors()`、`inspectConnectorSupport()`、`evaluateConnectorCompatibility()`、`solveConnectorPlacement()`、`validateGrammarMultiPoint()`、`classifyBuildingPatterns()` 与 `assessGrammarAdmission()`。它们各自返回本层状态，不写入一个混合的“全部通过”标志。

## 3. Connector与Part描述

`Connector` 包含：

- 身份：`featureId`、`sourceConnectionId`、`family`、`role`。
- 空间：`units='LDU'`、`localPositionLdu`、`localOrientation`、`axis`。
- 截面与范围：`profile`、`dimensions.sections`、半径/长度/宽度/高度、`axialSpanLdu`、`capStart`、`capEnd`、`insertionRangeLdu`。
- 运动：`slideAllowed`、`rotationAllowed`、`symmetryOrder`、`friction`、`angleLimitsDeg`、`detentsDeg`。
- 约束：`compatibilityGroup`、`matchingPolicy`、`occupied`、`contactSurface`、`entryFace`。
- 追溯：`sources[]`、`confidence`、`coverage`、`unknownFields`、`diagnostics`、`notes`。

未知值保持 `null`、`UNKNOWN` 或 `PARTIAL`，例如未给出friction就不会凭“这是一个Pin”赋予高摩擦。接触面、入口面、轮胎座或轴向限位缺失时也不会用零件名或包围盒填补。

`describeGrammarPart()` 组合原始geometry、collision geometry状态、connectors、bounds、metadata和provenance。没有可靠证据的整件symmetry与surfaces保持null；不从零件标题推断。

同一位置可以有多个不同feature：外部Hollow Stud和中心Bar receptacle都能保存。两者必须各自有来源；看到空心凸点不能自动补造中心Bar接口。同位功能也不意味着可以同时占用，实际连接仍检查接口占用与实体。原生生产图目前只开放C01；其它功能的共享占用语义需要相应来源及图适配。

## 4. 25个可扩展接口族

当前schema明确列出：

```text
STUD, ANTISTUD, HOLLOW_STUD, BAR, BAR_HOLE, CLIP,
PIN, PIN_HOLE, AXLE, AXLE_HOLE, ROUND_HOLE,
HINGE_FINGER, CLICK_HINGE, TURNTABLE,
BALL, BALL_SOCKET, TOWBALL, TOWBALL_SOCKET,
WHEEL_PIN, WHEEL_HOLE, RIM_SEAT, TYRE_SEAT,
RAIL, GROOVE, GENERIC_SPECIAL
```

这是词汇表，不代表当前253件来源已经提供每一种接口的可靠数据。无名R4圆柱仍可能保持 `GENERIC_SPECIAL`；“半径像Bar”不足以把它变成Bar。部分指接语法仅保留原始 `SNAP_FGR` 和族提示，不生成猜测的hinge端点。

`GENERIC_SPECIAL` 保留group与bounding声明。group相同只满足必要筛选条件，不能单独建立插入深度、保持力、形变或座位配合。

## 5. 15条注册规则及启用边界

规则数随接口族增长，不随库中零件两两组合增长。

| 规则 | 接口配对 | 关节含义及所需条件 | 当前真实原生生产图 |
| --- | --- | --- | --- |
| C01 | STUD/HOLLOW_STUD ↔ ANTISTUD | 来源证明的普通System stud完全就位，RIGID，0平移/0转动DOF | 已启用明确来源子集 |
| BAR_CLIP | BAR ↔ CLIP | 真实轴向span、clip宽度、限位与运动权限；可派生转动/滑动族 | 未启用，真实配合证据不足 |
| BAR_RECEPTACLE | BAR ↔ BAR_HOLE/ROUND_HOLE | 真实孔类型和插入范围；不能把任意孔视为Bar孔 | 未启用 |
| PIN_HOLE | PIN ↔ PIN_HOLE | 需要摩擦/保持、插入范围、实际运动权限 | 未启用 |
| AXLE_KEYED | AXLE ↔ AXLE_HOLE | CROSS截面对齐；锁定自由roll，可在来源允许范围滑动 | 未启用 |
| AXLE_ROUND | AXLE ↔ ROUND_HOLE | 单独的圆孔轴承规则；来源允许时滑动与转动 | 未启用 |
| HINGE | HINGE_FINGER ↔ HINGE_FINGER | pivot、axis与真实角度限位，REVOLUTE | 未启用 |
| CLICK_HINGE | CLICK_HINGE ↔ CLICK_HINGE | REVOLUTE，必须有可相交的真实detent表 | 未启用 |
| TURNTABLE | TURNTABLE ↔ TURNTABLE | 复用REVOLUTE；座位与保持轮廓仍须独立证据 | 未启用 |
| BALL_SOCKET | BALL ↔ BALL_SOCKET | 保持球心及来源角度范围，SPHERICAL | 未启用 |
| TOWBALL_SOCKET | TOWBALL ↔ TOWBALL_SOCKET | 与大球头分开；尺寸/轮廓身份必须匹配 | 未启用 |
| WHEEL_MOUNT | WHEEL_PIN ↔ WHEEL_HOLE | 轴向保持、绕真实轴转动，REVOLUTE | 未启用 |
| TYRE_RIM | RIM_SEAT ↔ TYRE_SEAT | VERIFIED_FIT座位轮廓配合，装配后RIGID | 未启用 |
| RAIL_GROOVE | RAIL ↔ GROOVE | 实际行程与stop；PRISMATIC，不能自由旋转 | 未启用 |
| GENERIC_GROUP | GENERIC_SPECIAL ↔ GENERIC_SPECIAL | group、角色及获证配合策略共同匹配 | 未启用 |

除C01的已核定来源子集外，其余14条是**条件式算法kernel**：它们能够检验资料齐全的接口描述，推导关节约束并产生相应结果，但当前原生来源还没有为其提供完整、经核定的真实fit数据。算法测试用的明确标记 `ALGORITHM_FIXTURE` 不能作为LEGO实配记录或生产override；默认规则不接纳此范围的证据。

`VERIFIED_FIT` 需要双方共享经核定的接口profile/seat身份、有效来源证据、轴关系、座位偏移及真实范围。该profile身份表示可复用接口标准，不是零件A/B配对允许表。相同半径、family或group不会跳过此检查。

`STUD/HOLLOW_STUD → PIN_HOLE` 被明确返回 `ILLEGAL`，即使直径接近。没有注册规则或来源不足返回 `UNKNOWN`，不会自动标成合法，也不据此断言实物一定不兼容。

### C01的具体范围

当前真实启用规则复用之前有来源依据的ordinary stud seating：

- male来自固定Shadow源中明确的 `studC/studO` 普通闭合/空心凸点，单段 `R 6 4`、one cap、非center、非slide。
- receiver来自明确单段 `R/S 6`、长度至少4LDU、one cap的普通underside接口，不带其它专用身份或group。
- 实际源sections、frame与维度解析必须一致，原始依赖及许可/hash必须完整。
- 完全就位连接的机械DOF为0；0/90/180/270度是格点保守候选，不是连接后的自由转动。
- 多Stud在同一个刚体姿态下共同验证并记录全部实际接触边。不能只证第一个Stud、分别吸附后平均位置，或用一个接口通过开放整件未知接口。

内部 `stud3` 的R4管仍保留其原始标签与尺寸，但不能据此冒充普通R6外凸点、制造Stud reversal或扩展C01兼容性。Hollow Stud的外部C01能力也不会自动证明其中心孔接受Bar。

## 6. 五种关节及姿态求解

| Joint | 平移DOF | 转动DOF | 语义 |
| --- | ---: | ---: | --- |
| RIGID | 0 | 0 | 完全固定的接口相对姿态 |
| REVOLUTE | 0 | 1 | 保持pivot/轴与轴向位置；转动受真实limits/detents限制 |
| PRISMATIC | 1 | 0 | 沿来源轴滑动，截面roll锁定 |
| CYLINDRICAL | 1 | 1 | 独立的轴向滑动和绕轴转动 |
| SPHERICAL | 0 | 3 | 保持中心，完整空间朝向受来源角度包络限制 |

轴、pivot、translation range、angle limits、detents及碰撞包络分别保存。没有限位不会擅自设为360度；没有摩擦不会给Pin赋予rigid/revolute；没有有效span不会产生任意滑动行程。Keyed截面的等价姿态按双方真实symmetry的公共等价角处理，不能free roll。

`solveConnectorPlacement()` 先查兼容规则，再直接由两个局部frame计算候选刚体变换。连续自由度保持 `poseFamily` 描述，调用者可提供有限的来源允许角度/位置，不进行任意3D姿态遍历。候选必须是determinant +1的刚体放置；原始LDraw自身的依赖变换保留在来源中，不复制成整件拉伸或镜像。

当前SPHERICAL在完整姿态空间求解器缺失时仍返回 `UNKNOWN`，即使球/socket接口的条件兼容性已成立。当前native assembly graph也未接入机械连接族的完整运动状态，因此不能把上述kernel能力报告为已经能生成轮组、球头或铰链车辆。

## 7. LDU、SNOT、偏移与严格闭合

核心尺寸：

```text
stud pitch = 20 LDU
half stud = 10 LDU
plate height = 8 LDU
brick height = 24 LDU
stud diameter = 12 LDU
stud height = 4 LDU

5 × 8 = 2 × 20 = 40 LDU
```

`exact.ts`用有界有理数表达十进制或分数。输入 `39.99999999999999`不会被吸附成40；`0.1 + 0.2`可按明确十进制有理数计算。世界端点闭合逐维比较精确残差，不用毫米epsilon弥补刚性误差。无法证明的精确旋转/坐标关系不转换成已获证闭合。

`BuildingPatternClassifier`不读part ID或名称：

- `NORMAL_STACK`：接收与输出System接口的snap轴同向；LDCad的stud凸出方向与receiver入孔方向在配合时同向，不能因male/female就翻转轴。
- `SNOT_90`：可信C01接口snap轴正交。真实4070、87087的能力来自source transforms，不是编号列表。
- `SNOT_180`：snap轴真正反向，或实际连通并已解姿态的两级90度拓扑形成反转；普通上下Stud/Anti-stud不会因此误报180度。
- `HALF_STUD_OFFSET`：输入/输出接口有精确10 modulo 20LDU的横向差；真实Jumper由其端口位置推导。
- `PLATE_HEIGHT_OFFSET`：精确非零8LDU倍数的接口轴向高度差；24LDU自然属于3 plates。
- `BRACKET_OFFSET`、`STUD_IN_SNOT`、`STUD_OUT_SNOT`：由正交接口的相对位置及接收/输出轴推导，不把它当成某类零件的名称识别。
- `AXIAL_SLIDE`、`AXIAL_ROTATION`、`HINGE_ANGLE`、`CLIP_BAR_ANGLE`、`BALL_JOINT_ANGLE`、`WHEEL_MOUNT`：必须有相应compatible、solved joint证据。
- `MULTI_POINT_CONNECTION`：已有同一姿态下多个实际配合的验证结果；多个Stud的存在本身不构成多点通过。
- `OFF_GRID_ROTATED_SUBASSEMBLY`：来源支持的已解关节产生实际非正交子结构姿态。
- `EXACT_CLOSED_ANGLE`：至少多个指定端点在同一已求姿态下精确闭合；1LDU或微小非零残差均不能以强行弯曲补偿。

分类输出分别标记 `TOPOLOGY_POTENTIAL`、`SOLVED_JOINT`、`EXACT_CLOSURE`；`legalAssemblyEstablished`始终false。存在能力潜力、数学闭合与完整实体装配通过是不同记录。

## 8. 碰撞、应力与稳定性分离

`validateGrammarMultiPoint()`验证一个共享proper rigid transform下所有指定接口；截面方向、深度、轴、端点及重复占用均需一致。它不为每个端口单独修改位置。

后置碰撞继续复用原生source-bound solid proxy及实际几何。连接区域用于证明允许的表面接触/插入，不是一块“里面任意重叠都豁免”的区域。Stud在孔内合法就位不应被误判为塑料穿插；原生实体真的重叠时仍拒绝。部分未知外壳不会为了提高通过率被随意封闭。

验证流程分别保留以下分项；multiPoint为独立的刚体闭合结果，输入合法性评估器：

```text
connectability
placement
multiPoint
collision
stress
legal
stable
```

`evaluateGrammarLegality()`会拒绝明显强迫形变或非法接口；精确刚体闭合也不能推定材料应力安全。缺少经过核定的stress/fit证据时，全局 `legal`仍为 `UNKNOWN`。网站现有模型的 `VALID`表示当前来源、白名单接口、刚体最终姿态、连接图和实体检查通过，不等于该全局材料证明或实物拼搭成功。

`scoreGrammarStability()`是明确标注 `HEURISTIC` 的排序依据；未知摩擦、质量、接触面积及材料保持力保留缺口。分数不会创建不存在的连接，也不会把 `physicalStability=UNKNOWN`改成实物稳定。最终姿态、连续安装轨迹、轮组全角度净空和实物测试分别记录，不能互相替代。

## 9. 来源优先级、冲突与Studio边界

每个feature保留source kind、原始ID、URL/reference、revision、原始SHA、许可、行号、raw directive、继承变换、verification及scope。

来源优先级为：明确实物/人工核定证据较高；合法取得的Studio和LDCad结构化数据较高；LDraw primitive来源次之；纯geometry inference/heuristic最低。具体来源类型包含：

```text
REAL_BUILD_VERIFIED, VERIFIED_MANUAL, STUDIO_CONNECTIVITY,
LDCAD_SHADOW, LDRAW_PRIMITIVE, OFFICIAL_SHORTCUT, KNOWN_PAIRING,
CONSERVATIVE_GEOMETRY_INFERENCE, HEURISTIC
```

优先级不触发静默覆盖。相同feature ID的冲突会同时保存双方，输出diagnostic并隔离匹配策略；只有可信服务端明确批准、来源更高且经过核定的override可解冲突，仍保留原始断言。客户端或上传模型不能自报 `VERIFIED_MANUAL`取得新权限。

LDCad现有递归解析支持 `SNAP_CYL`、`SNAP_CLP`、`SNAP_GEN`、`SNAP_INCL`、`SNAP_CLEAR`及其已经核定的transform/grid/include/clear子集。未知三维grid、指接轮廓、include override或继承尺寸继续给出PARTIAL/UNKNOWN，完整raw证据不会被丢弃。本版没有宣称完整实现所有LDCad元数据。

`adaptStudioConnectivity()`接受**有权限且已解码**的结构化资料，保留原始numeric/type ID；canonical type mapping必须另有核定证据。本版没有Studio .conn二进制解析器、默认社区ID映射或获准Studio数据集，也未复制安装目录资源。未满足授权或再分发条件时不导入专有raw内容。

Rebrickable只用于目录、编号/颜色/库存线索。未确认的数据再分发权不会因应用代码许可或本轮LDraw/Shadow许可而扩大。没有从PDF图像补造现成零件或接口。

## 10. 普通生产调用链

```text
RealPartRegistry
→ 默认 GrammarAssemblyService
→ 当前原生来源与Connector adapter
→ assessGrammarAdmission（单feature识别已知规则，无mate-part夹具）
→ NativeAssemblyGenerator + ConnectorRegistry（接口族候选索引）
→ Connector grammar compatibility + frame-derived attachment solver
→ 同一刚体姿态下multi-point与占用
→ 原生实体碰撞与整图复验
→ model / BOM / steps / source hashes
→ 正常export
→ 正常upload：按当前版本、来源、接口权限和连接图重验
```

生产调用仍使用 `/api/parts-foundation/assembly/*`，没有另建能绕过门禁的特殊测试入口。结构目标仍需在已兼容接口之间选件；碰撞可以拒绝某个结构候选，但不会据碰撞试验结果创设新的基本拼法。

当前版本轴：

```text
connector schema: connector-schema-1
grammar: connector-grammar-1
admission: source-connector-admission-1
assembly: native-assembly-0.7.0-grammar
connection bridge: source-stud-2.0.0-connector-grammar-1
```

`GrammarAssemblyService`不读取旧migration的逐件fixture PASS作为准入，不写假的物理接口PASS。旧 `AssemblyService`及夹具机制保留作历史回归，默认网站已使用grammar服务。source digest绑定真实依赖与解析器，资格及模型另检查当前grammar/engine/rule版本；来源、语义或规则改变后模型需要当前复验。

当前grammar资格字段为 `sourceReady`、`connectable`、`collisionGeometryReady`、`generationEligible`。它没有继承“逐件夹具已执行成功”的含义：`assemblyVerified=false`、历史fixture计数为0，随后真实生成的完整模型另存实际验证记录。

## 11. 新零件与新接口的扩展流程

### 加入一个使用已有接口的新真实零件

1. 核对原始身份、固定版本、几何/连接来源、许可及完整递归依赖。
2. 加入原始source manifest，保留字节、作者、SHA及编号体系。
3. 正常repository读取几何与递归primitive/Shadow metadata，生成canonical features。
4. 为已有grammar满足前提的feature派生接口支持，分析拓扑；未知接口保持单独禁用。
5. 核查原生碰撞几何、source completeness及身份，派生可选资格。
6. 正常结构目标按接口索引选用，具体候选执行完整装配、导出/上传复验。

流程不需要填写该零件可以搭配哪些旧编号，也不要求为新零件先执行所有旧零件对。明确局部尺寸未知可被隔离时，已知C01端点可单独识别；未知include/clear/inheritance等结构性语法不会被忽略后放行。

### 加入真正的新Connector family

1. 在schema扩展family及必要的真实语义字段，不借已有相似族标签掩盖新配合方式。
2. 在来源adapter加入有依据的识别，保留原始声明与缺失值。
3. 给出可复用profile/seat匹配策略、来源证据、轴关系、插入/限位与joint语义。
4. 注册一条接口族规则，补正/负向算法fixture；真实资料与ALGORITHM_FIXTURE分开。
5. 实现对应joint姿态、区间/截面对齐、multi-point、contact/实体与占用验证。
6. 在native graph、输出及导入层保存必要运动状态，完成真实来源模型证据后开放生产。

修改规则而不更新相应版本与回归证据不是扩展流程。缺少真实fit、detent、friction或轮胎兼容数据时继续UNKNOWN；不会按名称、近似尺寸或网上技巧推断合法。

## 12. 覆盖率与可复现检查

以下三个口径分开报告：

- raw source parse：LDCad语法是否在当前解析子集内。
- canonical connector coverage：COMPLETE / PARTIAL / NONE，包含族语义和缺失字段。
- generation eligibility：已知启用接口、来源和原生实体满足候选条件；随后每个模型仍单独验证。

开发核对快照是253个来源根件，raw解析205完整/44部分/4缺失；canonical 98 COMPLETE/151 PARTIAL/4 NONE；grammar候选资格99，旧87件均保留候选资格。这些是开发中核对的状态，**最终交付数量以同版本的当前audit和普通API状态为准**，不能将99候选资格说成99件已实际生成或全部接口已通过。

```sh
npm run audit:connectors
# 使用独立输出位置
npm run audit:connectors -- --output /tmp/connector-grammar-audit

npm test -- --maxWorkers=2
npm run typecheck
npm run build
```

覆盖产物为 `artifacts/connector-grammar/report.json`、`parts.csv`、`REPORT.md`，逐件保留connector数量/族/来源、unknown interfaces、碰撞几何状态、发现的patterns及需要处理项。当前生成样例和导出/重新导入证据在同目录的 `models/` 与 `generation-report.json`；缺失或未执行的阶段不从旧报告复制成功标记。

普通生产API可在正常网站服务启动后检查：

```sh
curl http://localhost:3001/api/parts-foundation/assembly/status

curl -X POST http://localhost:3001/api/parts-foundation/assembly/generate \
  -H 'Content-Type: application/json' \
  -d '{"kind":"wall","partCount":3,"requiredPartIds":["32000"]}'
```

生成响应提供的model ID用于普通 `GET /api/parts-foundation/assembly/models/<modelId>/export?format=json`；将返回的原始JSON字符串作为 `content`交给 `POST /api/parts-foundation/assembly/models/import`。重新导入会核对当前来源与规则，不信任上传文件自带的资格、成功标志或重新计算的校验和。

## 13. 尚需真实数据或后续求解的内容

当前真实生产仍集中于C01，主要未闭合事项为：Bar/Clip及Bar receptacle的配合与span/stop数据，Pin摩擦/保持、Axle-bearing差异，hinge/click detent，ball/towball角度包络及完整空间姿态，wheel retention/rotation/clearance，tyre/rim seat fit和安装过程，以及复杂原生边界的实体解释。相同group或可显示几何都不足以关闭这些缺口。

优先补充合法、可追溯的Bar/Clip连接资料及真实装配证据，可以直接扩展汽车后视镜、尾翼、小杆支架和斜置panel；它们完成前不会被记作已支持的真实生成成果。P1/P2接口和MechanicalInteraction继续使用相同来源与未知状态原则，不会挤进Stud兼容逻辑。
