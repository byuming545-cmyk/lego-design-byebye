# Interface-first 升级前架构审计

审计基准为提交 `35eec2067b4e9a711b65bd0199ac3bb5f89db636`，工作分支为 `codex/interface-first-grammar`。本文审计的是升级前实现；实现阶段新增的 `src/parts/grammar/` 不作为已有能力证据。审计仅读取源码和既有记录，没有重新运行装配、单元或浏览器测试，也没有改写原始源文件、许可、资格或历史报告。

## 简短结论

项目已经有接口驱动的 C01 普通凸点连接：真实来源端口 → 兼容检查 → 两个局部帧直接求刚体姿态 → 同一姿态下多点校验 → 实体碰撞 → 连接图。它没有在任意3D旋转空间中盲试基本拼法，也没有正式的“零件A可接零件B列表”。

主要架构冲突在**准入与知识扩展方式**：新件每个开放接口仍必须保存与具体夹具零件试装成功的证据，才能获得生产资格；当前语义和运动系统又只实现普通凸点的固定配合。真实连接数据、通用接口语法、逐件夹具证明、最终组合验证尚未彻底分开。

可以复用来源、刚体数学、C01、图校验、碰撞与模型导入导出；需要重构 canonical Connector、多来源冲突、Joint/DOF、通用规则、拓扑分类及接口语法准入。已验证的原生能力、原始文件和历史夹具应保留为回归证据，不能删除或自动改名为新版证明。

## 已有能力与源码证据

| 范围 | 基准中已经存在 | 可复用及限制 |
| --- | --- | --- |
| LDraw解析 | [ldraw/importer.ts](../../src/parts/ldraw/importer.ts)、[bundled.ts](../../src/parts/ldraw/bundled.ts)：真实type-1递归、原始依赖变换、BFC/镜像绕序、三角面/边/颜色、LDU、来源SHA、许可和资源上限 | 保留原始字节与身份；`geometryReady`不是连接或实物认证 |
| mesh与展示 | [ldraw/types.ts](../../src/parts/ldraw/types.ts)、[registry.ts](../../src/parts/registry.ts)提供网格、原生边界及来源状态 | 不从显示外形反推缺失接口；UI类别名称不是装配真值 |
| collision geometry | [assembly/proxy.ts](../../src/parts/assembly/proxy.ts)：原生定向闭合实体、来源覆盖证明的内部cap、BVH；[collision.ts](../../src/parts/assembly/collision.ts)检查实体交叠、包容、相交面局部细分 | 正式碰撞已超出AABB；LDraw导入结果中的AABB只是元数据/粗筛。未知外壳不会随意封闭 |
| connector源数据 | [connections/types.ts](../../src/parts/connections/types.ts)保存局部位置、方向、完整源矩阵、圆柱分段、gender、group、原始属性、文件/行/SHA/继承链 | 是较丰富的源描述，不只是无出处坐标点；尚非完整canonical运动连接模型 |
| LDCad | [connections/importer.ts](../../src/parts/connections/importer.ts)：`SNAP_CYL/CLP/GEN/INCL/CLEAR`，递归LDraw子件及Shadow继承、标准X/Z grid、源清除及诊断 | 可做canonical adapter的输入；未支持的FGR、三维grid、include属性、端部轮廓/缩放保持诊断，不能把解析ready当作配合验证 |
| Studio connectivity | [provenance.ts](../../src/parts/provenance.ts)有`BrickLinkStudio`来源标签，但[数字导入pipeline](../../src/parts/digitalImport/pipeline.ts)实际只启用获准LDraw来源 | 基准无已接通的Studio `.conn`解析器或获准Studio资源集；一个schema标签不是已取得数据 |
| 零件身份/映射 | [recovery/mapper.ts](../../src/parts/recovery/mapper.ts)、[registry.ts](../../src/parts/registry.ts)、[digitalImport/pipeline.ts](../../src/parts/digitalImport/pipeline.ts)分开原生ID、Element、Design、外部编号及证据状态 | 保留精确身份与冲突状态；编号/图片相似不提供几何或接口，不把531 Element映射当原生扩库前置条件 |
| 兼容与求姿态 | [assembly/compatibility.ts](../../src/parts/assembly/compatibility.ts)的`checkConnectionCompatibility`，及[solver.ts](../../src/parts/assembly/solver.ts)的`solveAttachment` | 已按源属性和local frame直接求姿态；当前只认证C01普通stud/receiver，其他族UNKNOWN |
| 多点/图/占用 | [multipoint.ts](../../src/parts/assembly/multipoint.ts)、[engine.ts](../../src/parts/assembly/engine.ts)重新求解同一刚体姿态下所有已发现配合，记录桥接，检查遗漏、重复接口和悬空 | 应复用整图复验；canonical feature占用须细化，旧物理key只含gender/位置/方向，可能合并同位置的不同功能接口 |
| wheel/axle | [wheelAssessment.ts](../../src/parts/assembly/wheelAssessment.ts)记录四件源状态、精确行、代理和分阶段阻塞；兼容器对keyed axle和wheel group明确返回UNKNOWN | 来源审查和负向测试保留；没有合法轮组、保留/过盈/旋转净空或安装轨迹证明，不能靠group/半径直接开放 |
| part/assembly生成器 | [assembly/generator.ts](../../src/parts/assembly/generator.ts)使用真实几何、已开放端口、通用requiredPartIds，选根/候选、帧求解后调用正式attach | 名称正则已移除；仍依赖有限基础模板、接收点筛选、四分之一圈及碰撞后回溯。模板设计搜索不应被当作接口知识学习 |
| 输出与重新导入 | [documents.ts](../../src/parts/assembly/documents.ts)、[modelImport.ts](../../src/parts/assembly/modelImport.ts)、[parts/api.ts](../../src/parts/api.ts)输出模型、LDR、BOM、步骤、来源；上传后按当前权限/源/版本/图重新核验 | 保留这一生产链。校验和只证明内容完整性，不能创造连接或准入 |
| 旧体系隔离 | [legacyPolicy.ts](../../src/parts/legacyPolicy.ts)、[api/app.ts](../../src/api/app.ts)、[provenance.ts](../../src/parts/provenance.ts)阻止旧参数化生产入口和未manifest几何/端口 | 旧算法和参考资料保留，但不得成为新Grammar的源或碰撞例外 |

上述路径及下列符号均按基准提交核对；后续新增实现可能改变工作树行号。

## 与新目标冲突的具体设计

1. **生产资格依赖逐接口夹具，而非已知Grammar继承。**
   `verification.ts::verifyNativePartAssembly`遍历物理接口、调用`verifyAssemblyConnectionWithFixtures`。证明保存`fixturePartId/fixtureConnectionId/fixtureSourceDigest/transform`及`generator-smoke`。
   `service.ts::initialize/validateEntry/fixtureProblem`要求当前迁移报告、通过的source/collision检查、每个允许端口的完整夹具套件、具体配对来源与变换；`digitalImport/pipeline.ts`也验证同类夹具字段后才接受已有生产能力。新件即便有已知普通接口，仍不能立即继承资格。迁移到Grammar后应区分“接口规则可适用”与“实际组合已通过验证”，避免把自动推导标记成历史夹具PASS。

2. **兼容规则只覆盖固定C01。**
   `compatibility.ts`只接受固定版本显式普通stud及capped underside；clip、generic/group、A截面返回UNKNOWN。尺寸、group相同不会直接授予兼容，这是正确边界。需要可扩展规则注册表；不能以新增枚举或schema字段宣称Bar/Pin/Axle/Wheel等已经有实际配合证明。

3. **Joint与接口数据尚未分层。**
   源点有`sections`、`center/slide/caps`原始属性，但没有统一的axial interval、接触跨度、stopper、插入区间、friction、symmetry、detents、关节状态与分轴DOF。Graph edge只有固定rule、anchor、axis、depth、twist。Hinge、Wheel、Turntable应复用运动学类型，不能新建“Wheel接Car”抽象。

4. **结构能力没有独立的拓扑分类。**
   generator通过源方向识别side-stud并有固定三件SNOT任务，但没有通用`BuildingPatternClassifier`、组合SNOT180、half-stud、bracket/高度偏移或joint-derived patterns。分类应来自接口局部/世界变换；“可能产生某模式”不能等同某装配已经合法。

5. **闭合数学主要是带数值容差的浮点刚体检查。**
   `math.ts`和`multipoint.ts`使用LDU且正确要求同一刚体变换，未对各点独立吸附或平均；但目前没有有理/精确LDU闭合层来表达5×8=2×20、10LDU偏移、严格多端点闭合和组合变换证明。应保留数值几何验证，并单独标记精确网格证明与近似/未知输入。

6. **Connectability/Placement/Collision/Legal/Stable状态不完整分离。**
   已有compatibility、solver、collision和attach结果，但没有独立stress legality、材料/柔性授权、stability score。source axis的`insertionPath`仅是连接anchor路径，不是整件扫掠或弹性装配证明。没有实物证据时不能填充制造公差、扣合力、摩擦系数或假称物理稳定性。

7. **旧碰撞通路的正确保守边界必须延续。**
   `collision.ts`将penetration zone作为有来源的接触/插入标注，不豁免实体塑料体积。`proxy.ts`只接受来源覆盖的内部seam cap；113件代理受阻仍不能通过未知外壳补面或扩大豁免“修好”。碰撞应验证规则推导后的姿态，不能发明接口规则。

8. **机械相互作用未独立建模。**
   当前图表示实体拼接，不包含可验证的gear/rack/chain/belt/cam/ground-contact模型。后续交互应单独成图并保存pitch、ratio、axis等来源，不制造普通Connector edge或几何接触即啮合的推断。

## 基线数据与可复用测试

以下均来自基准提交保存的记录，**不是本次审计新执行的测试**：

| 基线项目 | 数量/状态 | 证据 |
| --- | --- | --- |
| 正式原生根编号 | 253；几何读取成功253 | `data/parts-foundation/ldraw/manifest.json`，`assembly/migration.json::sourceCounts` |
| 来源文件 | LDraw743、Shadow245，固定修订、许可和SHA | 两份source manifest |
| 源连接解析 | ready205、partial44、missing4 | `migration.json::sourceCounts`；不是新canonical Connector覆盖率 |
| 既有生产资格 | 87，含全部已发现接口通过38、限定部分接口49 | `migration.json::counts/interfaceCoverage` |
| 阻止准入 | 166：113代理不足、44部分解析、4缺连接、4配合未知、1当前受测碰撞/变换失败 | 各entry的`reasonCodes`，只代表当前主要阻塞，并非实体不可能拼 |
| 物理接口记录 | 5019：2251 PASS、786 BLOCKED、1982待审、0 PENDING | `migration.json::interfaceCoverage`；不能把全部5019称成功装配 |
| 本轮之前的专项生成证据 | 13模型、21不同原生编号；其中新增可生成8 | `artifacts/generation-expansion/generation-coverage.json`；不是87件全部逐件生成覆盖 |
| 历史自动化验证 | 47文件645单元、11浏览器、3编译预览通过 | `docs/generation-expansion/validation-results.json`及其日志；日期2026-10-25 |
| 轮组/实物 | 0已验证轮组、0实物认证 | `migration.json::counts`，`docs/wheel-assembly/REPORT.md` |

应继续保留并按修改范围重新执行的回归包括：

- `tests/parts-ldraw.test.ts`、`parts-connections.test.ts`、`parts-connection-clear-scope.test.ts`、`parts-connection-audit.test.ts`：来源、继承、语法、CLEAR、未支持数据保持不确定。
- `parts-assembly-connections.test.ts`、`parts-assembly-multipoint.test.ts`：C01、求帧、多点同姿态、反向配合、端口占用和桥接。
- `parts-assembly-collision.test.ts`、`parts-collision-local-partition.test.ts`：真实闭合实体、孔洞、包容、非法穿透和资源限制。
- `parts-assembly-engine.test.ts`、`parts-assembly-service.test.ts`、`parts-assembly-api.test.ts`、`parts-assembly-generator.test.ts`和`parts-native-model-import.test.ts`：当前源、权限、已限定接口、伪造图、失效版本、实际输出与重导入。
- `parts-digital-import-boundary.test.ts`、`parts-digital-pipeline.test.ts`、`parts-digital-sources.test.ts`、`parts-digital-pilot-bundle.test.ts`：导入许可/身份/源/准入分层；不会仅凭读取成功开放。
- `tests/e2e/assembly.spec.ts`与预览测试：网页真实生成、导出、上传校验与旧链路隔离。

新增规则fixture的职责应是验证**规则本身**与合法/非法边界，不成为每新增零件必须重新学习全部零件对的数据库。真正缺少来源或新型配合语义的对象继续保持UNKNOWN/PARTIAL/NEEDS_VERIFICATION。

## 改造边界与实施顺序

1. 在现有原生来源之上添加canonical Connector/Part description，不改变原始几何或继承源字节；原始ID、行、变换及各来源分别保留，冲突显式报告。
2. 将Compatibility、Joint/DOF、帧求解、轴向插入、多点闭合抽成规则族通路；用当前有效C01作生产桥接，其他族按真实证据分级。
3. 添加精确LDU与拓扑pattern分析，使SNOT/offset来自变换；单独维护机械相互作用和启发式稳定性。
4. 生产候选从已知接口语法继承能力，之后每次实际placement仍走来源、占用、多点、碰撞和完整图验证。历史逐件夹具保留回归，不作为唯一知识入口；任何新资格语义不得伪称旧`assemblyVerified`证明。
5. 输出新Connector覆盖报告、实际规则/未知原因和源覆盖，分别统计COMPLETE/PARTIAL/NONE、规则可用、实际生成与实物验证，不沿用205个parse-ready或87个旧资格替代新Grammar覆盖率。

本审计只支持上述基线判断，不宣称新架构或任何额外连接族已经实现或通过验证。升级后的实际功能和执行结果由本轮实现文档与新测试记录另行验收。
