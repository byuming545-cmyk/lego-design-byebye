# 真实零件正式生成扩充验收记录

本轮交付 **8种新增可参与正式生成的真实LDraw零件**，全部经过当前接口资格、普通生产API生成、整体校验、模型/BOM/步骤导出及重新导入。没有改动原始几何、补造连接、设置手动准入标志或开放旧生成链路。

工作分支：`codex/native-generation-expansion`。基准为`codex/compliant-parts-pilot`的`8b88b30b5483d0a06e2b91506f217c64c5806f89`；开始时工作区干净，读取远端确认试点分支仍指向此提交。没有从main重建，没有合并main或发布部署。执行日期：2026-10-25 UTC。

## 数量与成功口径

| 指标 | 基准 | 本轮最终状态 |
| --- | ---: | ---: |
| 正式原生根编号／几何导入成功 | 245 | 253 |
| 原始LDraw递归文件 | 732 | 743 |
| 原始Shadow连接文件 | 236 | 245 |
| 连接完整解析 | 197 | 205 |
| 连接部分解析／缺失 | 44 / 4 | 44 / 4 |
| 至少一组接口通过、具有当前限定接口生成资格 | 79 | 87 |
| 全部发现接口通过／部分接口准入 | 33 / 46 | 38 / 49 |
| 物理接口组PASS | 1,765 | 2,251 |
| 已有来源件恢复生成资格 | — | 0 |
| 待准入件迁移且实际生成 | — | 1：32000 |
| 新取得来源件且实际生成 | — | 7 |
| 既有资格件获得本轮实际用途 | — | 3：21、28326、50967 |
| 轮组／实物拼搭认证 | 0 / 0 | 0 / 0 |

以上87件只能使用资格记录明确开放的接口，不代表全部接口或任意配合可用。最终全量报告发现5,019个物理接口组：2,251 PASS、786 BLOCKED、1,982 REQUIRES_ASTRA_REVIEW、0 PENDING；实际直接执行2,426组，其余为明确来源前置失败2,433组、复核依赖160组。不能把5,019组都称为实际装配成功。

本轮保存13个专项生成并重新导入样例：11个逐件覆盖模型、2个组合结构，实际出现21个不同编号。基准保留的6个历史样例出现9个编号，见[基准记录](baseline.json)；样本数量和任务不同，9→21不是全部历史生成能力的覆盖率。本轮新增资格数仅为8，未把另外13个已有编号算作新增。

上一轮26件试点、26件几何、23件完整连接/3件部分连接、15件局部接口通过及14件既有正式资格属于历史记录。试点原始包未改；本轮只迁移32000。3705、2780、32054仍待准入，没有借普通凸点规则开放机械接口。

## 候选逐件结果

全部编号体系均为 **LDraw原生身份**，没有把相似外观转换为Element或Design精确映射。[预选清单](candidates.json)保留原始编号、URL、声明名、作者、许可、SHA、递归依赖、Shadow来源及基线；preflight的pending字段为选件时快照。最终结果以[当前覆盖记录](../../artifacts/generation-expansion/generation-coverage.json)为准。

| 原生编号、原始名称 | 本轮类型与用途 | 几何／连接 | PASS物理组／发现组；开放原始端口数 | 正式生成结果或阻塞 |
| --- | --- | --- | --- | --- |
| 32000 Technic Brick 1 x 2 with Holes | 待准入迁移；车架加固砖 | 成功／完整 | 4/8；4 | [墙体](../../artifacts/generation-expansion/models/32000-wall/model.json)；仅普通凸点接口，销孔禁用 |
| 3623 Plate 1 x 3 | 新来源；短板、交错加固 | 成功／完整 | 6/8；9 | [平台](../../artifacts/generation-expansion/models/3623-platform/model.json)；其余兼容性未知 |
| 60479 Plate 1 x 12 | 新来源；纵向长板 | 成功／完整 | 24/35；24 | [长平台](../../artifacts/generation-expansion/models/60479-platform/model.json)；未知接口禁用 |
| 78329 Plate 1 x 5 | 新来源；奇数长度覆盖 | 成功／完整 | 10/14；10 | [平台](../../artifacts/generation-expansion/models/78329-platform/model.json)；未知接口禁用 |
| 3456 Plate 6 x 14 | 新来源；宽车架、底板 | 成功／完整 | 168/168；168 | [底板结构](../../artifacts/generation-expansion/models/3456-platform/model.json) |
| 69729 Tile 2 x 6 | 新来源；侧向光面覆盖 | 成功／完整 | 12/12；12 | [SNOT覆盖](../../artifacts/generation-expansion/models/69729-basic-snot/model.json) |
| 6934 Tile 3 x 6 | 新来源；宽面覆盖 | 成功／完整 | 14/14；14 | [覆盖平台](../../artifacts/generation-expansion/models/6934-platform/model.json) |
| 41539 Plate 8 x 8 | 新来源；宽平台 | 成功／完整 | 128/128；128 | [平台](../../artifacts/generation-expansion/models/41539-platform/model.json) |
| 21 Windscreen 2 x 4 x 1 & 2/3 | 既有资格新增用途；挡风玻璃 | 成功／完整 | 12/12；12 | [直立结构](../../artifacts/generation-expansion/models/21-wall/model.json) |
| 28326 Car Mudguard 4 x 3 x 1 | 既有资格新增用途；轮拱 | 成功／完整 | 10/10；10 | [轮拱结构](../../artifacts/generation-expansion/models/28326-wall/model.json)；没有轮组认证 |
| 50967 Slope Brick Curved 8 x 1 x 1 & 2/3 with Arch | 既有资格新增用途；长曲面 | 成功／完整 | 3/4；3 | [曲面结构](../../artifacts/generation-expansion/models/50967-wall/model.json)；另1组碰撞或姿态阻止 |
| 11477 Slope Brick Curved 2 x 1 | 已有受阻来源复核 | 成功／完整 | 0/2；0 | open-external-shell，未知外壳未封闭；未生成 |
| 15068 Slope Brick Curved 2 x 2 x 0.667 | 已有受阻来源复核 | 成功／完整 | 0/5；0 | open-external-shell；未生成 |
| 18973 Windscreen 6 x 4 x 1.333 Curved | 已有受阻来源复核 | 成功／完整 | 0/4；0 | branched-native-boundary；未生成 |
| 18974 Car Mudguard 4 x 2.5 x 2.333 | 已有受阻来源复核 | 成功／完整 | 0/14；0 | branched-native-boundary；未生成 |

开放数为原始连接ID，物理组会去重来源别名，所以3623的9个原始ID对应6个PASS组。精确白名单、通过及禁用原因位于正式[migration.json](../../data/parts-foundation/assembly/migration.json)各条目的`allowedConnectionIds`、`disabledConnectionIds`与`interfaceCoverage`。

15件中：原生精确身份15、相似候选映射0、编号冲突0、身份未解决0；正式资格/实际生成11，装配受阻4。预筛查时1751缺连接、6112继承非刚性连接变换、2356边界分叉，未为凑数纳入扩充。531个Element的跨编号映射未改变，也没有成为原生编号扩库前置条件。

## 32000完整生产链与结构成果

32000固定源为`parts/32000.dat`，作者James Jessiman，CC BY 4.0，原始SHA为`d5c344e273a7df7bbbd49e5696c973d9f31359e2b658acf620d5c23302c06811`。全部几何依赖和3个Shadow源文件及其许可/哈希保存在候选清单。导入只追加清单与原始字节；资格由正式全量接口验证产生，没有人工写入`generatable=true`。

实际3件墙体包含3005、3023、32000，3条连接边，最终校验通过。另有5件加固底盘包含3456、32000、69729及2个3024，16条实际接触边；这是底板、加固与覆盖结构，没有假称完整可行驶汽车。侧向结构包含3023、3070b、87087，共3件2边；69729独立SNOT样例展示本批新增光面件的侧向用途。

每个样例目录均包含：

- `model.json`：普通API导出的版本化模型、连接图、BOM、步骤、来源摘要与校验和。
- `model.ldr`、`bom.csv`：正式导出接口得到的LDraw文件和清单。
- `steps.json`、`sources.json`：实际模型步骤与来源证据。
- `reimported.json`、`validation.json`：普通上传接口按当前来源、权限、端口占用、碰撞及连接图复验结果。

查看[32000整体验证](../../artifacts/generation-expansion/models/32000-wall/validation.json)、[BOM](../../artifacts/generation-expansion/models/32000-wall/bom.csv)、[步骤](../../artifacts/generation-expansion/models/32000-wall/steps.json)、[重新导入](../../artifacts/generation-expansion/models/32000-wall/reimported.json)，以及[组合车架](../../artifacts/generation-expansion/models/reinforced-native-chassis/model.json)、[车架BOM](../../artifacts/generation-expansion/models/reinforced-native-chassis/bom.csv)、[侧向结构](../../artifacts/generation-expansion/models/native-side-structure/model.json)。[网页截图](../../artifacts/generation-expansion/screenshots/32000-production-and-reimport.png)来自实际浏览器测试。

32000销孔仍禁用。直接attach被`part-or-interface-blocked`拒绝；篡改模型使用孔接口并重算校验和后，普通上传返回`NEEDS_REVALIDATION`且不能重新导出。普通端口的准入不会授权其余接口。

## 实现与隔离边界

正常调用关系：`POST /api/parts-foundation/assembly/generate` → 有效资格服务 → `NativeAssemblyGenerator` → 搜索／`attachPart()`／接口占用、碰撞与连接图 → `createNativeAssemblyDocument()` → 普通导出 → 普通导入复验。`src/cli/generation-expansion.ts`调用相同HTTP入口，不提供人工姿态或额外兼容性。

生成器删除旧名称Brick/Plate/Tile/Slope正则门槛。候选来自当前资格服务与白名单，依据真实几何边界、源端口方向/坐标及网格斜面选择，名称变化不改变接口或几何；各基础结构仍保留用途限制。新增通用`requiredPartIds`目标（最多8件且在数量预算内），正常搜索选择根件、求连接并满足目标；未知或无资格目标阻止，没有32000专用分支或预拼成品坐标。

网页提供普通“生成时包含的零件”与“生成零件数量”。选32000、数量3、点击墙体可重现；既有默认生成无需填写目标。正式放置仍只能改变刚体位置和朝向，不拉伸、镜像或变形零件。

资格绑定实际几何解析器版本`ldraw-native-parser-1`、连接解析版本、实际依赖哈希、库版本、装配/连接/碰撞规则及验证套件。缺失或过期套件、旧解析器摘要、报告内矛盾都会撤销准入。实现变化需同步版本并重验，不能给旧报告换标签。服务使用进程内来源快照；磁盘来源变更应重启后加载核验，本轮没有实现文件监视式热更新。

最终版本：

```text
partLibraryVersion: ldraw-c43ed06a-shadow-9b1131fb-geometry-1-connections-2-expansion-1
assemblyEngineVersion: native-assembly-0.6.0
connectionRuleVersion: source-stud-1.0.0
collisionVersion: native-closed-bvh-local-partition-1.1.0
testVersion: native-interface-suite-0.6.0-worker-2
```

未修改连接规则或碰撞算法。原有1,765个PASS全部在最终版本重验保持PASS；另120个已有接口获得新证明，387个新增来源物理组中366个PASS。见[接口差异](../../artifacts/generation-expansion/interface-diff.json)。旧参数化生成、手工连接及历史碰撞例外仍隔离；历史资料、映射、说明书和试点包未迁移或删除。

## Wheel Assembly独立专项

已实现来源/配合审查器、CLI、普通wheel入口的精确阻塞说明及8项负向测试。18975、3673、66727、18977仍为BLOCKED：

- 18975的三维`SNAP_INCL grid`未完整解释，代理有未解决边界。
- 3673的`L_ / _L`销端轮廓未解释；剩余R4雌孔不能代替雄销。
- 66727只有继承分段孔及普通凸点，缺经验证的轮胎座，边界分叉。
- 18977当前获准Shadow无适用轮胎端口，不能依据名称或半径补造。

缺少经验证的销保持、插入深度、占用、轮胎弹性及制造公差规则。最终姿态、底盘安装、旋转净空、安装轨迹和实物测试分别保持阻塞/未执行。没有轮组模型/BOM/步骤/重导入成功，也没有把普通凸点通过算作轮组成功。[专项报告](../wheel-assembly/REPORT.md)和[机器审查](../../artifacts/wheel-assembly/source-assessment.json)保存精确行号与各阶段。

## 本轮实际验证与复现

以下均为本轮执行；[机器记录](validation-results.json)和[命令日志](../../artifacts/generation-expansion/logs/)保留证据。Node需24.5+，源准备/打包另需Python3；运行网站与生成不需在线密钥或Python。

```sh
npm ci
python3 scripts/prepare-generation-expansion.py --ldraw-archive /tmp/digital-ldraw-source.tar.gz --shadow-archive /tmp/digital-shadow-source.tar.gz
npm run verify:interfaces -- --checkpoint-dir /tmp/generation-expansion-geometry1-final --concurrency 3 --batch-size 8 --timeout-ms 10000 --part-budget-ms 120000 --max-retries 1
npm run coverage:expansion
npm run smoke:assembly
npm run audit:wheel
npm run audit:connections -- --output artifacts/generation-expansion/connection-audit
npm run report:parts
npm test -- --maxWorkers=2
npm run test:e2e
npm run test:preview
```

独立全新验证应使用不存在的新检查点目录。本轮最终验证恢复记录数为0，361秒；来源准备不授予资格。

| 检查 | 本轮结果 |
| --- | --- |
| 原始生产源保留 | 732个LDraw+236个Shadow与基准Git对象逐字节一致 |
| 当前全量接口 | 5,019终态；0复用旧标记；2,251 PASS、786阻止、1,982待审 |
| 正常生成/重导入 | 11/11已取得资格候选成功，4受阻；另2组合结构成功 |
| 篡改API探针 | 8/8通过：禁用孔、重封孔模型、伪造边/重复占用、悬空、源SHA、旧版本、未知编号、轮组 |
| 基础模块烟测 | 6生成、1轮组阻止、0失败；桥接4件4边通过 |
| 单元测试 | 47文件，645/645通过，99.16秒 |
| 浏览器测试 | 11/11通过，约1.5分钟；含普通网页32000生成→下载→上传 |
| 构建预览 | 3/3通过，34.8秒；先执行typecheck、Vite、服务端构建 |

回归另覆盖未知编号、缺依赖、源SHA不符、伪造边、重复端口、穿模、悬空、刚体限制、旧链路隔离，以及来源/几何解析器/连接解析器/规则/碰撞/套件版本失效。`VALID`仅证明当前源接口、最终刚体姿态和连接图，不代替材料、公差、连续安装轨迹或实物拼搭。

开发中保留的失败：首次全量单测642通过/3失败，均为245件基准旧数量/旧集合断言；改为当前精确数量，逐项核对原245件无变化且新增恰为8件，没有删除断言或跳过。扩大候选后曾暴露默认填充搜索回退，保留原断言与预算，通过调整默认候选排序解决。加入实际几何解析器摘要后，先前迁移与生成证明作废，重新执行最终全量和13样例，未继承旧成功标记。最终无未解决测试失败。构建仍提示bundle大于500kB，尚未进行本轮性能优化。

未执行：实物、轮组合法姿态/轨迹/旋转、完整车辆生成、受阻四件未知外壳封闭、在线库存/531Element精确映射及部署。未用扩展碰撞豁免或缩放处理这些缺口。

## 来源包与后续扩充

许可来源见[SOURCES.md](SOURCES.md)。[native-generation-sources.zip](../../artifacts/generation-expansion/native-generation-sources.zip)只含许可核定、固定版本与字节核验的LDraw/Shadow、必要许可、当前资格及本轮13模型证据；无历史映射、私有资料、PDF、Studio或旧模型库，不代表整个应用的数据分发许可。

```sh
python3 scripts/export-generation-expansion.py --ldraw-archive /tmp/digital-ldraw-source.tar.gz --shadow-archive /tmp/digital-shadow-source.tar.gz --output artifacts/generation-expansion/native-generation-sources.zip
```

已有输出会拒绝覆盖，复现请另选路径。脚本核对上游档案SHA、全部源字节/作者/许可、当前资格/模型版本、白名单、BOM/步骤及导出哈希。包内`DISTRIBUTION-MANIFEST.json`逐文件列SHA，[外部校验](../../artifacts/generation-expansion/distribution-verification.json)保存ZIP摘要与排除项检查。

基础板、加固砖和光面板已有继续扩充通路。下一批优先明确原生身份及普通接口，仍需新验证与生成覆盖。共性瓶颈为复杂外壳边界解释、未实现连接语法/机械规则、受限搜索预算及缺少物理/运动证据；它们限制外形和轮组，但不阻止合规基础件逐批准入。
