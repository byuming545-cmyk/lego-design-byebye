# BRICKLAB · V0.6 碰撞架构专项

当前分支已将碰撞引擎升级为 `native-closed-bvh-local-partition-1.1.0`：4,632 个物理接口中 1,765 PASS、786 BLOCKED、2,081 转审、0 Pending；原 1,248 个 PASS 全部保留。完整通过零件为 33 件，部分可生成 46 件。专项结论、回归和下一轮任务见 [Sol Handoff](sol-handoff/v0.6-collision/README.md)。下面的 V0.6 A–H 报告与原 `astra-handoff/` 是修改前基线；当前跨版本复现用 `npm run collision:review -- MULTI-3020-3710`。

当前首页是 **Part Lab `/part-lab`**：查看有来源的原生 LEGO 网格、连接点、说明书证据，并在“装配模式”选择真实零件与已验证接口自动拼接。运行网站无需 Rebrickable 密钥或在线下载几何。

原生包的 **245 个 LDraw 根零件全部保留在迁移队列**。V0.6 重新验证现有接口，增加可中断恢复的分批测试、多点连接图及接口占用检查。工作台分别显示 PASS、BLOCKED、需要 Astra 复核、PENDING，以及完整通过、部分准入和处理完成状态；运行时只开放具有当前来源、版本和夹具证明的接口。当前 4,632 个物理接口组中 1,248 个 PASS、786 个 BLOCKED、2,598 个转审、0 个 PENDING；79 件零件具有限定接口生成资格。978 个旧延期接口已全部形成终态，其中 274 个 PASS。完整口径见 [V0.6 A–H 工程报告](docs/SOL_ENGINEERING_V0.6.md)和工作台的实际状态。

6 本可读说明书的 4 份附录提取了 667 行、531 个不同 Element ID；另两本超过传输上限。**531 个元素已有 `source-observed` 的 Part / Design / 颜色记录，精确 LDraw 身份链为 0 VERIFIED、14 PROBABLE、88 CONFLICT、429 UNRESOLVED。** 正式几何查询仅接纳 VERIFIED，本批说明书元素的装配/生成恢复仍为 0。外部目录查询、精确几何身份与原生装配资格分别统计。

**旧版通用、Speed、Automotive 的参数化生成、改造和导出继续暂停。** 新基础模块通过 `attachPart()` 求姿态、检查原生碰撞并更新连接图，仅使用当前报告授权的零件与接口。历史算法保留供回归，客户端参数和环境变量不能绕过生产门禁。

本轮 A–H 结果见 [V0.6 工程报告](docs/SOL_ENGINEERING_V0.6.md)，具体依据见 [多点装配](docs/MULTIPOINT_CONNECTIONS.md)、[解析审计](docs/CONNECTION_PARSE_AUDIT.md)、[Element 恢复](docs/PART_RECOVERY_REPORT.md)和[连接规则](docs/ASSEMBLY_CONNECTION_RULES.md)。软件装配资格只适用于白名单接口；没有实物拼搭认证、制造公差认证或整件插入轨迹扫掠认证。镜像数据许可未独立核定，与其构建代码的 MIT 许可分别记录。

历史版本文档：[V0.5](docs/REAL_PARTS_V0.5.md)、[V0.4](docs/REAL_PARTS_V0.4.md)、[V0.3](docs/AUTOMOTIVE_V0.3.md)、[V0.2.1](docs/V0.2.1交付报告.md)、[V0.2](docs/V0.2交付报告.md)。本文后部旧生成流程仅为历史说明，以本版真实性门禁为准。

本项目为独立创意原型，与 LEGO® 集团无关联。

## 快速运行

需要 Node.js **24.5.0 或更高版本**，仓库 `.nvmrc` 固定为 **24.19.0**。服务端使用 Node.js 的代理支持，因此不能直接换成较旧版本运行。

### Windows：从 ZIP 启动

本版工作分支为 `codex/astra-collision-architecture`，可下载 [V0.6 分支 ZIP](https://github.com/byuming545-cmyk/lego-design-byebye/archive/refs/heads/codex/astra-collision-architecture.zip)。

先安装 Node.js 24.19.0 或更高的 24.x 版本，再解压下载的项目 ZIP。进入**能够看到 `package.json` 的文件夹**；如果第一层只有同名文件夹，继续进入一层。

在资源管理器地址栏输入 `cmd` 并回车，会在该目录打开命令窗口。逐行执行，**每一行成功结束后再输入下一行**：

```cmd
npm ci
npm run build
npm start
```

出现服务已启动的信息后，保持命令窗口开启，浏览器打开 **<http://localhost:3001/part-lab>**。搜索 `3001` 查看原生砖、接口覆盖和白名单；搜索 `element:4666579` 查看映射四态及说明书页码。点击“装配模式”自动拼接、生成基础结构或重新验证导出的 JSON。导入返回 `NEEDS_REVALIDATION` 时不开放导出；`VALID` 仅证明当前来源、接口和最终姿态连接图，导入模块名称仍是文件标签。停止服务按 `Ctrl+C`。运行网站无需 `.env`、API Key 或 Python。不要在 Windows 中复制下面云环境的 `/workspace` 路径或 Bash 环境变量前缀。

### 当前云环境：开发模式

```bash
cd /workspace/lego-design-byebye
# 如使用 nvm：nvm install && nvm use
npm ci --cache /workspace/.npm-cache
npm run dev
```

上面的缓存路径适用于当前云环境；在自己的电脑上可直接使用 `npm ci`。

打开 <http://localhost:5173/part-lab>。开发模式同时启动 Vite 前端（`5173`）和 Express API（`3001`），Vite 将 `/api` 请求代理至后端。默认进入真实零件工作台，不自动生成模型，不请求 Rebrickable。

若已有环境变量配置了真实 API Key，`auto` 模式会使用真实数据。要明确使用演示模式，可运行：

```bash
INVENTORY_PROVIDER=mock npm run dev
```

开发代理固定指向 `3001`，开发时请保留该 API 端口。已有任务通常在隔离环境内运行，直接使用当前检出目录即可，无需额外创建 Git worktree。

### 网页预览

```bash
npm run preview
```

这个命令先构建项目，再在 `0.0.0.0:3000` 启动统一预览服务；页面、字体、脚本和 `/api` 均从同一个端口提供。打开 <http://localhost:3000/part-lab>，不需要密钥。需要转发网页时选择 `3000` 端口，无需同时转发开发 API，也不会受到 Vite 开发服务的域名检查影响。可以通过 `.env` 中的 `PREVIEW_PORT` 更改预览端口；它独立于开发 API 的 `PORT`。

预览加载失败时，先确认 `npm run preview` 仍在运行、预览指向相应端口，再检查该端口的 `/api/health`。单独的静态页面服务器无法提供本项目的库存和生成 API。若使用 Vite 开发模式通过自定义域名访问，需显式配置该域名的 `server.allowedHosts`，保留域名校验。

### 构建与生产模式

```bash
npm run build
npm start
```

打开 <http://localhost:3001>。Express 同时提供构建后的前端和 API，生产模式可以使用 `PORT` 更改监听端口。`build` 包含 TypeScript 类型检查、Vite 前端构建与服务端编译；`npm start` 需要先完成构建。服务端未指定 `NODE_ENV` 时默认 production；`npm run dev:api` 显式带 `--development`，开发 `auto` 缺 Key 时允许合成演示。

## 装配与覆盖报告

`npm run report:parts` 从实际原生注册表、当前生产接口准入、531 个元素的恢复队列和逐本说明书覆盖重建 `artifacts/parts-foundation/` 下的 JSON/CSV。它会区分原生装配数量、碰撞代理数量和说明书元素分母；已完成映射的元素不再列入“待映射”清单，另列需要核定 LDraw 对应的目标。返回 0 表示运行报告核定 ready，2 表示已输出报告但当前装配准入未 ready，1 表示命令错误。

V0.6 的接口测试使用独立工作线程、原子检查点及来源/夹具/版本绑定；正常启动网站无需重跑。更换原生来源、连接解析、装配或碰撞规则后，旧证据必须失效。补测命令的当前参数和断点恢复方法见 [V0.6 工程报告](docs/SOL_ENGINEERING_V0.6.md)。历史 `npm run verify:assembly` 仍保留每件最多 32 个接口的范围，不能把其局部通过当作整件全部接口通过。

```text
npm run verify:interfaces
npm run smoke:assembly
npm run report:parts
npm run audit:connections
npm run astra:pack
npm run astra:check
npm run astra:case -- WHEEL-TYRE
```

前三条分别重建当前接口证据、运行基础结构回归和汇总实际准入报告。`audit:connections` 重放源语法审计；`astra:pack` 从当前版本的实际阻塞记录生成交接资料；`astra:check` 核对整包诊断重放；`astra:case` 重现单个记录，附加 `--debug` 可导出原生调试场景。Astra 诊断不授予生产生成资格，未知物理预期保留 `EXPECTED_UNKNOWN`。复杂碰撞、轮胎/轮毂/轮轴和 clip/bar 专门规则继续作为明确复核项，不使用临时例外提高通过率。

## 历史 V0.1 使用流程（当前生成入口已暂停）

以下保留旧版算法流程以便理解历史设计，当前网页不会开放生成或导出。使用 mock 不能绕过真实性门禁；Speed 和 Automotive 的旧生成说明同样属于历史行为。

1. 输入 `10696` 或 `11013`，点击“读取套装”。省略后缀时自动补成 `-1`。
2. 输入含有单一类别的描述，如“一个小机器人”“一辆小汽车”“一座小屋”“一只小狗”，也可点击四个模板按钮。
3. 选择小型、均衡或大型；设置“优先保持颜色”和“让更多积木派上用场”，点击生成。
4. 拖动旋转 3D 模型、滚轮缩放，切换网格、展开零件或重置视角。
5. 点击“开始拼搭”或“分步拼搭”，查看每步新增零件、零件编号、颜色和数量；绿色轮廓标记本步新增零件。
6. 点击“导出 PDF”下载拼搭说明书，或点击“模型 JSON”保存完整生成结果。

零件表按**零件编号 + 颜色编号**分别显示库存和用量。“查看全部”会展示不支持的特殊零件，它们保留在库存中，但不会参与生成或计入可用库存利用率。

### 颜色与库存策略

| 模式 | API 值 | 当前行为 |
| --- | --- | --- |
| A：优先保持颜色 | `preserve` | 按库存中带凸点零件的覆盖面积选取主色、辅色，模板主体和强调层分别使用这两种颜色；库存不足时尝试缩小结构。 |
| B：允许换色 | `substitute` | 允许使用库存中的其他颜色完成结构，仍按零件编号和真实颜色严格扣减；界面默认采用此模式。 |
| C：缺件建议 | `missing-parts` | 仅保留类型接口，V0.1 未实现，API 会明确拒绝请求；界面不提供此选项。 |

A 模式中的“保持颜色”指规则选出的主色与辅色，不是对任意描述进行精确配色。大小选项表示目标规模：库存不足时会按“大型 → 均衡 → 小型”依次尝试，还可使用库存中的板替代整层砖，并在模型提示中解释实际简化。无法完成最小结构时返回失败，不会补入库存之外的零件。

“让更多积木派上用场”只会在已有凸点结构上增加有限的顶部装饰，不保证耗尽库存，也不保证找到全局最高利用率。

## 数据来源与真实库存

### 合成演示库存

通用创意的 mock 模式中，`10696-1` 与 `11013-1` 使用相同的人工构造示例：84 件受支持的基础零件，以及 6 件仅展示的特殊零件。**它们不是对应零售套装的真实零件、颜色或数量**，不能据此判断手中的真实套装能够拼出示例模型。页面、API 和导出说明书均保留来源提示。

演示模式只接受上述两个套装编号。其他编号需要真实数据源。

### Rebrickable 数据源

注册或登录 Rebrickable，在账户设置的 API 区域申请/查看 API Key。将 Key 填入本地 `.env`，修改后重启服务。Windows 复制命令是 `copy .env.example .env`；Bash 使用下面的 `cp`。

```bash
cp .env.example .env
# 使用编辑器在 .env 中配置服务端 API Key
npm run dev
```

`.env` 配置项：

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `INVENTORY_PROVIDER` | `auto` | 有 Key 时使用 Rebrickable；无 Key 时仅开发 `auto` 允许 mock，生产 `auto` 与 `rebrickable` 的库存请求均返回明确 503；`mock` 显式使用合成演示。 |
| `REBRICKABLE_API_KEY` | 空 | Rebrickable 服务端访问凭证。 |
| `BRICKLAB_DATA_DIR` | `data` | 本地库存快照、模型及修订、Benchmark、实拼反馈的保存根目录。 |
| `PORT` | `3001` | Express 监听端口。 |
| `PREVIEW_PORT` | `3000` | `npm run preview` 的统一预览端口。 |

真实数据需要有效的 Rebrickable API Key，以及服务端通过 HTTPS 访问 `rebrickable.com`。云环境如限制出站网络，请在环境设置中允许该域名。服务端沿用环境提供的代理与 CA 信任，不应关闭 TLS 校验。

Key 只保存在服务端环境变量或本地 `.env` 中。`.env` 已被 Git 忽略；不要提交它、不要使用 `VITE_` 前缀暴露 Key，也不要将凭证放入前端代码。前端只请求本项目 `/api`。

真实 provider 会读取套装信息和完整分页库存、合并重复零件/颜色条目，并处理授权失败、套装不存在、超时和限流。保留名称、上游类别 ID、颜色、件数和 spare 标记；明确 `is_spare=true` 的备用件单列并排除出生成库存，标记缺失或 null 时保留未知状态、警告并仍计入可用库存。成功读取后原始 metadata、完整 raw pages 和标准化库存写入 `data/inventories/`；经 Speed 库存分析或 Benchmark 后补充 Speed 支持分类。切换为真实 provider 后，失败会显示错误，不会静默改用合成库存。

启动后可访问 `http://localhost:3001/api/sets/76900`，或在 Speed 页读取 `76900`；`GET /api/speed/status` 和页面的 Data Source 显示 `Rebrickable / real`、`Mock / mock` 或 `unconfigured`。真实响应 `source` 为 `rebrickable`，并含 `snapshotId` 与 `fetchedAt`。`DEMO-SPEED` 永远是独立合成演示，不会冒充真实编号。

当前项目已提供真实 API 适配与使用模拟响应的测试；**没有使用真实 Key 验证 Rebrickable 的在线访问**。真实库存中大量零件可能尚不在几何目录内，因此能读取库存不等于能够生成所选造型。

## 10 套真实 Speed Benchmark

默认配置 [speed-benchmark.json](speed-benchmark.json) 包含 `76900-1` 至 `76909-1`。编号、名称和 Speed Champions 主题来自实际核对的固定 Rebrickable 目录归档，配置保留归档链接、revision 与 SHA-256；这不是实时库存读取证据。当前 API 保存 `themeId`，未请求主题名称，报告的实时主题确认仍为 `unverified`。

配置 `.env` 的 `REBRICKABLE_API_KEY` 后执行；Windows 和 Bash 均可直接使用这些 npm 命令：

```text
npm run benchmark:speed
npm run benchmark:speed -- --sets 76900,76901 --output data/benchmarks/custom.json
npm run benchmark:speed -- --config speed-benchmark.json --output data/benchmarks/real-online.json
```

CLI 始终默认真实 Rebrickable 模式，独立于网页的 `INVENTORY_PROVIDER`。它逐套串行读取完整库存，单套失败继续后续套装；对成功库存保存快照和支持分类，实际尝试生成并运行 Inventory、Connection、Wheel、Structural、Collision 五个校验器。无 Key、网络不可用、授权或限流时保留 pending，不填入 DEMO。退出码 `0` 表示全部 PASS；`1` 表示存在 FAIL 或已执行的 PARTIAL；`2` 表示仍有真实在线验证 pending。

| 字段 | 含义 |
| --- | --- |
| `basic` | 排除明确 spare 后的总件数、不同 part+color 数、不同 part ID 数，另列 spare 件数；未知 spare 标记保留并警告。 |
| `support` | generatable / recognizedOnly / unknown 件数与唯一编号数；百分比按实际件数加权。 |
| `criticalCarParts` | 轮毂、轮胎、轮轴/轮架、挡风件、轮拱、Bracket、曲面、楔形、侧凸点件的存在与支持情况；上游名称回退只证明存在。 |
| `canGenerate` / `generation` | 前置库存判断与实际生成结果；前者不能代替后者。 |
| `validators` / `errors` | 各校验器 pass/fail/unrun，以及库存、分析、快照、生成、校验阶段的错误和 trace。 |
| `result` / `executionState` | PASS/PARTIAL/FAIL 与 pending/succeeded/failed 分开。pending 的 PARTIAL 不表示部分验收通过。 |

只有生成及全部校验通过、且库存没有仅识别或未知件时报告 PASS；生成及校验通过但仍有未建模库存时为 PARTIAL。未取得库存的支持率为 `null`、校验为 `unrun`，不能解读为支持率 0% 或校验失败。

默认输出到 `${BRICKLAB_DATA_DIR:-data}/benchmarks/`；`--output` 接受目录或 `.json` 文件名。每次写入四份原子替换文件：报告 JSON/CSV、独立 missing-frequency JSON/CSV。频次分母只含本次成功读取的完整真实库存；pending、mock、spare 均不计入，按零件 ID 汇总件数、类别及出现套装数。

本轮已实际执行无 Key 命令，得到 **0 套真实读取、10 套 pending、0 个真实 PASS、频次分母 0**。可审查 [完整 JSON](docs/benchmarks/real-online-pending.json)、[CSV](docs/benchmarks/real-online-pending.csv)、[频次 JSON](docs/benchmarks/real-online-pending.missing-frequency.json) 和 [频次 CSV](docs/benchmarks/real-online-pending.missing-frequency.csv)。没有 `0/10` 缺件频次结论。

独立演示命令如下，只接受 `DEMO-SPEED`，不会增加真实验收数，也不会混入真实频次；因演示库存含 recognizedOnly 件，自动校验全过仍可能 PARTIAL / 退出 1。

```text
npm run benchmark:speed -- --mock --output data/benchmarks/mock.json
```

## 模型数据与校验规则

本节介绍保留的 V0.1 通用模型；Speed 的独立目录、坐标、模型存档与导入见后面的 Speed 专节。

核心 TypeScript 类型位于 `src/types/index.ts`。每个零件实例包含 `instanceId`、`partId`、名称、类别、颜色、尺寸、位置、旋转角、连接实例列表和搭建步骤。生成结果包含：

```text
GenerationResult
├── model       模型元信息、全部零件、外廓尺寸、用量与生成提示
├── inventory   数据来源、完整库存和本次 quantityUsed
├── validation  valid、errors、warnings
└── steps       每步新增零件与截至该步的独立模型快照
```

JSON 导出保存完整 `GenerationResult`，可供后续编辑器或算法继续使用；V0.1 没有 JSON 导入功能，也不直接输出 LDraw、Studio 或 CAD 文件。

### 坐标与连接

- `x/y` 使用凸点网格单位（stud），`z` 使用板高度单位（plate）；普通砖高 `3`，薄板高 `1`。
- `position` 是旋转后占用外接盒的最小 `x/y/z` 角点。`dimensions` 保留目录中的未旋转尺寸；旋转 `90°/270°` 时交换平面占用宽深，旋转值仅允许 `0/90/180/270`。
- 空间碰撞按轴对齐外接盒判断；表面贴合允许，共占实体空间不允许。斜坡采用保守外接盒，可能拒绝实际可行的紧邻排布。
- 基础连接要求上下表面高度一致、至少有 `1 × 1` 凸点网格重叠，且下方零件具有可承接的顶面凸点。
- Tile 和当前 Slope 没有可承接的顶面凸点，不能支撑上层零件。高于地面的零件必须有下方支撑，最终完整模型必须形成接地的单一连接组件。中途的搭建步骤允许存在尚待上层跨接的独立接地脚部。
- 说明书从下往上生成，每步最多增加 4 件零件；校验也检查每一步的已搭建前缀，避免最终模型有支撑、搭建顺序却悬空的情况。

独立校验器会检查每种零件与颜色的用量、目录尺寸、库存颜色、实例 ID、整数坐标、旋转、碰撞、连接清单、外廓尺寸和步骤支撑。服务端每次重新读取可信库存，不接受客户端提交库存或用量；生成结果只有通过校验才会返回。

这些规则提供基础几何筛查，不模拟扣合力、重心、扭矩、悬臂或真实材料行为；不能视为完整 CAD 验证、物理稳定性保证或官方拼搭说明。实际拼搭前仍需核对零件和连接。

### 当前支持的零件目录

| 类别 | 零件编号 |
| --- | --- |
| Brick | `3001`、`3003`、`3004`、`3005` |
| Plate | `3020`、`3022`、`3023`、`3024` |
| Tile | `3068b`、`3069b` |
| Slope | `3040b` |

其他编号统一标记为 `Unsupported`，其尺寸只用于库存显示占位，不能参与生成。车轮、车轴、Technic、人仔和曲面复杂零件尚未实现。汽车模板用基础砖表现四轮轮廓，是不能滚动的静态造型；动物描述共用通用四足模板。

## PDF 与渲染

3D 使用 Three.js 的简化几何，基础砖带凸点，Tile 使用平面，Slope 使用斜面外形；保留 `ModelRenderingAdapter` 接口，便于后续替换为真实零件几何。浏览器缺少 WebGL 时提供等轴测 Canvas 降级图，交互能力相应减少。

PDF 在浏览器本地生成，包含完成模型、套装与来源、模型提示、每步累计模型图、绿色新增零件轮廓，以及本步编号/颜色/数量清单。中文字体随项目打包，文字与图示先绘制到 Canvas，再写入 A4 PDF，避免中文缺字；因此 PDF 主要是栅格内容，文字不可搜索，放大后的清晰度受渲染分辨率限制。PDF 是按真实步骤快照绘制的图示，不是仅截取完整模型的一张图片。

## 项目结构

```text
src/
├── App.tsx                  中文工作台、库存、步骤与导出交互
├── components/
│   ├── ModelViewer.tsx      Three.js 视图、渲染适配器与降级图
│   └── PartThumbnail.tsx    零件列表缩略图
├── api/
│   ├── app.ts               Express 路由、参数校验与错误处理
│   └── server.ts            环境配置、代理与服务启动
├── inventory/               provider 接口、mock 与 Rebrickable
├── generators/              四种分层模板、库存约束铺砖与装饰
├── validators/              库存、碰撞、连接及搭建顺序校验
├── lego/                    零件目录、几何规则、等轴测绘图
├── instructions/            步骤生成与中文 PDF
└── types/                   前后端共用结构化类型
tests/                       算法、数据源、API 与浏览器测试
```

技术栈：React 19、TypeScript、Vite、Three.js、Express、jsPDF、Vitest、Playwright。字体使用本地打包的 Noto Sans SC 与 Space Grotesk。

## API 示例

开发时访问后端 `3001`，也可通过前端同源 `/api` 调用；生产时统一使用 `3001`。

```bash
curl http://localhost:3001/api/health
curl http://localhost:3001/api/sets/10696
curl -X POST http://localhost:3001/api/generate \
  -H 'Content-Type: application/json' \
  -d '{"setNumber":"10696-1","options":{"prompt":"一个小机器人","size":"balanced","colorStrategy":"substitute","maximizeUsage":false}}'
```

| 接口 | 响应 |
| --- | --- |
| `GET /api/health` | 服务状态、版本、provider 和是否为演示数据。 |
| `GET /api/sets/:setNumber` | 完整 `SetInventory`。 |
| `POST /api/generate` | `GenerationResult`；输入无效返回 `400`，库存无法生成或模型校验失败返回 `422`。 |

错误统一使用 `{ "error": "可展示的信息", "code": "ERROR_CODE" }`。API 只接受文档中定义的参数，不接受任意库存、客户端使用数量或额外字段。

## 验证命令

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run test:preview
```

单元与 API 测试覆盖库存解析、生成约束、结构校验、步骤快照、参数验证和上游错误。端到端测试在 mock 模式启动开发服务，验证页面的实际生成与导出流程。测试不需要真实 API Key，不等于验证了真实 Rebrickable 网络服务。

`test:preview` 会在独立端口构建并启动统一预览服务，检查转发域名的页面/资源/API 请求、浏览器实际生成与导出，以及 iframe 内的模型显示。

浏览器测试需要 Chromium。当前配置优先使用 `PLAYWRIGHT_CHROMIUM_PATH`，未指定时使用 `/usr/bin/chromium`：

```bash
PLAYWRIGHT_CHROMIUM_PATH=/path/to/chromium npm run test:e2e
```

在没有系统 Chromium 的环境，先安装受支持的 Chromium，再提供可执行文件路径。Playwright 的失败截图和 trace 输出到忽略的测试产物目录，不会提交进仓库。

## 通用创意 V0.1 的边界

通用创意模型为简化外形，四种模板不能表达完整自然语言中的具体细节。其真实库存覆盖率受 11 种几何目录限制；库存搜索有计算预算，失败不一定代表现实中不存在可行拼法。V0.1 通用模型与历史仍不持久化；本轮的磁盘恢复、JSON 导入和实拼反馈适用于 Speed。没有登录、多人协作或服务端数据库，未发布到公网托管服务。

本轮后续只优先推进真实 10 套验收、依据真实频次补齐关键结构族，以及第一轮实拼反馈，详见 [交付报告 H](docs/V0.2.1交付报告.md#h-下一步建议)。

## Speed Creative V0.2.1

Speed Creative 保留 V0.2 的库存分类、连接图、现代轮组、模块化生成、多候选、局部修改、子装配说明书、多套合并和自报散件。本轮按真实数据验证需求增加 Benchmark、快照与版本追踪、轮组 Registry、结构规则、持久化、受校验的 JSON 导入及用户实拼反馈。真实 10 套验收与高频汽车零件扩充仍等待真实库存，不能将基础设施完成描述为全部 Phase 验收完成。

本轮最终验证：**231/231 项单元/API 测试通过（12 个文件，37.99 秒），13/13 项浏览器测试通过（约 1.4 分钟），4/4 项生产预览测试通过（24.8 秒，含最终构建和类型检查）**；生产依赖审计为 0 个已知漏洞。编译后的生产服务缺 Key 负例也已检查：模式为 unconfigured，真实套号及 DEMO 请求均返回 `503 / MISSING_API_KEY`。详情见 [V0.2.1 交付报告](docs/V0.2.1交付报告.md#自动化验证)。测试使用隔离临时数据目录及明确标注的 fixture 或合成演示，未进行真实套装在线批量验收和实物拼搭。V0.2 历史验证数字保留在旧交付报告中。

### 入口与网页验证流程

使用相同的安装和启动命令，点击顶部 **Speed Creative**，或直接打开 <http://localhost:5173/#/speed>；统一预览地址为 <http://localhost:3000/#/speed>。顶部“通用创意”可返回 V0.1。

在通用创意和 Speed 之间切换会保留当前候选与编辑状态。Speed 生成和修改会自动写入本地模型存档；刷新或重启服务后，可在“保存的模型与 JSON”打开模型继续查看，浏览器会尝试恢复上次打开的模型。会话内撤销历史仍不跨重启保存。

1. 确认页面 Data Source 与运行模式。演示模式读取 `DEMO-SPEED`，检查总件数、可用件数、部分支持件数、未支持件数和支持率；生产缺 Key 时应明确显示未配置。
2. 展开“查看零件分类与库存”，按编号核对类别与支持状态。可识别但几何/连接不完整的汽车零件应显示“部分支持”，不能计入可生成数量。
3. 保留演示库存、关闭人仔空间要求，选择车型并点击“生成 Speed 方案”。切换 A/B/C，检查车长、轴距、驾驶舱与车顶差异，以及各方案独立的库存用量和全部校验结果；每次最多返回三个合法候选。
4. 锁定驾驶舱，输入“车头太高了”。检查只改车头、版本增加，驾驶舱与轮组保留；再要求“驾驶舱降低一点”，应因锁定而回滚。点击“撤销上一次修改”，应恢复先前结构并保留驾驶舱锁；切换 B 不应改变 A。
5. 切换“分步拼搭”，观察独立轮组、安装与翻转页：子组件在主车旁拼好，安装时不重复领料，翻转页新增零件为 0；最后主车应包含全部零件。再下载 PDF 与模型 JSON。
6. 展开“保存的模型与 JSON”，打开自动保存的模型或导入本版导出的模型 JSON。导入成功后会分配新模型 ID、重新校验，并将库存来源标记为用户自报；旧 V0.2 无 schema 文件会明确拒绝，请重新生成后导出。首次实拼流程见下方“模型保存、导入与实拼反馈”。
7. 展开“添加自有散件”，添加 `3034`、黑色、2 件，再添加未知编号 `unknown-speed-part`、1 件。点击“读取库存”后才生效：前者按色累加，后者显示未支持，两者均带用户自报来源。重新生成后仍需全部校验；删除散件行并再次读取库存，应恢复原有数量与来源。
8. 读取真实套装前，按上文配置服务端 `REBRICKABLE_API_KEY`，并使用 `auto` 或 `rebrickable` provider。多个编号可用 `+` 或逗号分隔，例如 `76900 + 76901`；这是输入示例，并非已在线验收清单。未配置真实 provider 时应收到明确错误，不能冒用演示库存。重复编号只按一盒计算。
9. 在 mock 模式返回通用创意，验证 `10696` 的机器人生成、3D、分步说明书和 PDF 仍可使用，再切回 Speed 检查当前状态保留。

`DEMO-SPEED` 是独立的人工合成零件池，**不对应任何官方 BMW 或其他 Speed Champions 套装**。当前环境没有可用真实 API Key，已在线验证的真实 Speed Champions 套装数量为 **0**，尚未达到“至少 10 套”的验收目标。适配器可读取 Rebrickable 中任意符合编号格式的套装，再按零件能力分类；这不代表每盒库存都足以生成车辆，也不代表已经确认其属于 Speed Champions 系列。

### 库存支持边界

独立 Speed 目录识别 **100 个零件编号**，当前为 **63 个 `supported`、37 个 `partiallySupported`**。完整支持包括 50 个基础 Brick、Plate、Tile，7 个已核对底部台阶与凸点位置的 Slope/Curved Slope，带侧向凸点的 `87087`、`11211`，以及现代轮组族 `18975 / 3673 / 66727 / 18977`。未知编号为 `unsupported`。这里的完整支持指已经具备本版本的简化几何与接口定义，不代表完整 CAD 精度。

对应验证版术语：`supported` 是可生成 `generatable`，`partiallySupported` 是仅识别 `recognizedOnly`。本轮新增可生成编号 **0**；真实频次分母仍为 0，因此没有据演示库存盲目添加 Bracket、轮拱或挡风件。63/100 是目录编号比例，不能当作真实套装按件数加权的支持率。

仍有部分编号未完整建模的类别包括 Jumper、Slope、Curved Slope、Wing、Bracket、Modified Brick/Plate、Mudguard、Windscreen、Grille、Round Tile、Seat、Wheel、Tyre、Wheel Holder 和 Panel。轮组只完整支持上述特定配合族，不能将其他轮毂、轮胎或轮架直接混用。类型声明中的 Wedge、Curved Tile、Wheel Arch、Light 等名称是可扩展分类，不代表已有对应的完整几何或连接实现。

支持率按**实际零件件数**计算，而非不同编号数量；`usableQuantity` 只累计完整支持的条目。部分支持和未知条目的 `dimensions` 保持 `null`，不使用占位尺寸参与生成。库存分析会列出基础承重砖/板、底盘板和已验证兼容轮组的不足；`canGenerate` 只是库存前置条件，不能代替后续连接、轮组与结构校验。

多个库存按 `partId + color.id` 累加，同时在 `inventorySources` 和每条零件的 `sources` 保留来源与数量。一次最多合并 10 个不同套装；重复编号仍只算一盒。已识别但不支持的零件保留在完整库存中，不会因为部分零件不支持而丢弃整个套装。自报散件的边界见下方“多套库存与用户自报散件”。

### 独立模块与 API

```text
src/pages/SpeedCreative.tsx  Speed 专用页面；与 V0.1 工作台并存
src/speed/types.ts          Speed 库存、连接点、模块、候选、步骤等类型
src/speed/catalog.ts        独立零件目录、几何/连接支持状态与来源
src/speed/inventory.ts      完整库存重新分类、合并、来源追踪与前置分析
src/speed/geometry.ts       基于物理单位的三轴旋转与世界空间几何
src/speed/connections.ts    显式接口匹配、连接图推导与组件分析
src/speed/generator.ts      底盘优先的车辆模块与库存约束铺砖
src/speed/redesign.ts       分句规则、目标模块重建与原样回滚
src/speed/sessions.ts       服务端可信库存、候选与有界撤销历史
src/speed/validators.ts     库存、连接图、碰撞、四轮与规则式结构校验
src/speed/steps.ts          子装配、安装、翻转及独立模型快照
src/speed/rendering.ts      Speed 3D 适配与等轴测绘图
src/speed/pdf.ts            复用中文 PDF 排版并绘制 Speed 几何
src/speed/api.ts            /api/speed 路由
```

Speed 复用已有服务端库存 provider，不沿用 V0.1 的 11 编号支持标记；每个零件按 Speed 目录重新分类。Speed 专用逻辑保持在独立目录，后续可用同样的边界扩展其他主题，而不将车辆规则塞入通用生成器。

```bash
curl http://localhost:3001/api/speed/catalog
curl 'http://localhost:3001/api/speed/inventory?sets=DEMO-SPEED'
# 需要真实 provider：+ 使用 URL 编码，避免变成查询参数中的空格
curl 'http://localhost:3001/api/speed/inventory?sets=76922%2B76924'
curl -X POST http://localhost:3001/api/speed/generate \
  -H 'Content-Type: application/json' \
  -d '{"setNumbers":["DEMO-SPEED"],"options":{"prompt":"低矮原创跑车","vehicleType":"supercar","style":"futuristic","minifigure":false,"priority":"structure","maximizeUsage":false}}'
```

`GET /api/speed/catalog` 返回目录统计；`GET /api/speed/inventory` 返回完整库存、来源、支持率和缺少的组件。`POST /api/speed/generate` 从服务端重新读取库存，返回 `inventory`、最多三个 `candidates`、`warnings` 和 `sessionId`；每个候选包含完整通过校验的车辆及其步骤。任何硬约束失败都返回明确错误，不输出失败模型。

`POST /api/speed/inventory` 接受 `setNumbers` 和可选 `extraParts`，用于分析基础套装与自报散件；`POST /api/speed/generate` 也接受同样的 `extraParts`。未提供散件时保持原行为。Speed 响应支持协商 gzip 压缩；HTTP 兼容原有逐步快照形状，内存及磁盘采用步骤 ID 引用，按需恢复快照。

编辑接口使用生成时返回的会话与候选 ID，不接受客户端提交模型或库存：

| 接口 | JSON 请求内容 |
| --- | --- |
| `PATCH /api/speed/designs/:sessionId/modules/:moduleId` | `candidateId`、`locked`。 |
| `POST /api/speed/designs/:sessionId/redesign` | `candidateId`、`prompt`。 |
| `POST /api/speed/designs/:sessionId/undo` | `candidateId`。 |

局部修改失败会返回 `success: false`、`rolledBack: true`、原候选和原因，不替换服务器上的有效设计。

### Connection Graph

每个目录零件定义带位置、方向、类型与兼容类型的 `ConnectionPoint`；放置实例保存三轴四分之一圈旋转和实际连接列表。连接匹配从目录重新读取接口，不相信实例自行添加的凸点。

世界空间计算先将坐标转换为各向同性 LDraw 单位（1 stud = 20 LDU，1 plate = 8 LDU），再按 X → Y → Z 旋转，避免将横向 stud 与纵向 plate 直接交换产生错误。Speed 的 `position` 固定表示零件自身坐标原点，与 V0.1 的旋转后外接盒角点约定不同。

只有接口位置重合、方向相反、类型双向兼容且可选 `fitFamily` 相同，才建立连接。`SpeedConnectionValidator` 独立重新推导全部边，检查伪造或过期连接、重复实例 ID、一个接口被多次占用、`activeConnections` 不一致，以及没有合法连接或不属于同一组件的零件。两块砖侧面碰到一起，或将砖摆在无凸点 Tile 上，都不会因此成为连接。

已测试实际 `87087` 侧凸点与旋转后的 `3005` 连接；改变接口偏移或方向会失败。SNOT 支持当前限于目录中明确定义的接口，不能据此推断所有 Bracket 或 Modified 零件均已支持。连接图通过只表示所实现接口规则成立，不代替轮胎间隙、碰撞、承重或实际物理稳定性判断。

### 现代轮组与兼容 Registry

当前可生成的安装链为 **`18975` 轮架 → `3673` Technic Pin → `66727` 轮毂 → `18977` 轮胎**。轮组定义集中在 `src/speed/wheelAssemblies.ts`，包含兼容零件、四轮数量、旋转轴、安装姿态、轮径/轮宽、间隙与底盘支撑；库存分析、生成器及校验器读取同一 Registry。新增经过校准的组合通过登记定义接入，不另写一套车辆生成器。

Registry 有 **1 个 generatable 现代轮组和 1 个 recognizedOnly 经典组合**（`4600 / 4624 / 3641`）；经典组合不参与自动选择，不能描述为已有两套可用轮组。轮架是母孔，不包含虚构的一体轮轴；每个现代轮毂需要独立 Pin 和轮胎。接口匹配使用已核对的孔径、方向、偏移和配合族，不会仅因零件名称含“Wheel”就认定可安装。

`WheelValidator` 返回 `valid`、`wheelCount`、`groundedWheels`、`collisions`、`rotationalClearance`、`axleConnections` 和警告。它检查恰好四个轮毂/轮胎、四条有效可转轮轴安装链、横向轮轴、等高四轮接地、矩形前后轴布局、合理轮距/轴距、车身离地间隙及轮胎旋转包络碰撞。测试中的完整机械底盘得到 4 个轮子、4 个接地轮胎、4 条轮轴连接和可用旋转空间；删除轮架、错误轮高或侧裙侵入轮胎区域都会失败。

碰撞使用分段实体、圆柱和显式孔道。只有精确同轴就位的已知孔轴配合、狭窄轮胎压配区域及 Pin 端部保留唇的标称干涉可按定义处理，不会跳过整对零件的碰撞。当前“可旋转”表示已建模接口允许旋转且包络无阻挡，**没有进行实物摩擦、载荷、弹性或制造公差测试**；不能据此证明真实套装的四轮转动或车辆稳定性。

### 模块化车辆生成

`generateVehicleModel` 已能在给定库存上生成约 8 stud 宽的车辆，模块包括 `chassis`、左右轮组、`front`、`rear`、`cockpit`、`roof`、`bodyShell`、`aero` 和 `details`。每个模块保存自己的零件与连接 ID，零件也记录所属模块；空细节模块允许保留，供后续扩展。

生成先分配关键车顶/尾翼承重板，再实际组装轮架凹台与填充砖、两层跨接底盘、现代四轮、前后结构与侧裙、四柱驾驶舱、车顶及双支点尾翼，最后添加有合法接口的饰面。预留结构板只扣减库存，待支撑存在后才加入模型，避免装饰先耗尽关键承重件。库存约束铺砖优先跨接独立组件，生成结束重新检查连接、碰撞和轮组。

车辆约为 `8 × 14` 或 `8 × 16` stud，按 `partId + color.id` 核对用量。GT 采用较长轴距，Concept 采用前移驾驶舱，Sports Car 的默认驾驶舱比 Supercar 后移 1 stud；具体参数及用量以输出模型为准。

当前不使用未校准的轮拱或透明挡风件；要求容纳 Minifigure 会明确失败，而不会将普通驾驶舱框架视为已验证的人仔空间。F1、卡车和摩托描述也会明确拒绝。模型和局部修改都必须通过完整校验，才会交给网页和说明书。

### 结构校验与网页输出

`StructuralValidator` 首先要求底盘自身形成刚性连续连接网络；底盘及外部承重路径排除 `allowsRotation` 轴承边，不能用自由旋转的轮轴“吊住”主车架。它再分别检查各模块内部的每个独立子组件，不能让一个牢固子组件掩盖另一个单点悬挂子组件。主结构需要至少两个相距 1 stud 的独立锚点；物理跨度达到 6 stud 的长组件要求锚点展开至少 2 stud。车顶、驾驶舱和尾翼适用相同规则。

此外，移除一条凸点连接后若会分离出较大结构，则拒绝该单点承重。只有 `details` 中最多 2 件且最长不超过 2 stud 的微型装饰可以单点固定；轮组的轴承例外仅允许 `3673 / 66727 / 18977` 三件总成，并且必须连到已固定的轮架，不允许借轮组标签承载额外车身零件。检查返回各模块锚点数、评分与总 `structuralScore`；当前通过的结构评分至少 90，分数表示规则符合度，**不表示实物强度或载荷认证**。

V0.2.1 增加长主梁沿主跨度的支撑覆盖检查，要求底盘 Plate/Brick 自身形成跨越前后轮架的纵向刚性路径；同层板/砖接缝需有实际连接接缝两侧零件的跨接件，不能借另一条梁或无关接缝的连接代替。装饰件与承重件分开评价，小型装饰保留合理单点连接。

生成后的库存、颜色、连接、碰撞、轮组与结构全部通过才输出。审核还覆盖底盘错缝跨接不足和大型装饰单点连接的反例，不能靠改模块名称绕过结构要求。

说明书使用子装配、安装与翻转流程，详见下方；网页、PDF 和 JSON 使用同一组步骤，局部修改后重新生成。

### 多候选与有限风格规则

三个方向分别重新从同一份完整库存开始分配，并独立通过全部校验。它们改变车长、轴距、驾驶舱位置、引擎盖比例与车顶高度，不靠换色制造候选差异；结构签名重复的方向会去重。**候选是替代方案，一盒库存不能同时拼出三辆车。** 库存或搜索预算不足时返回较少的合法方案并给出警告及原因，不补入虚构零件。

演示库存的三方向比例示例如下；坐标参数使用 stud，车顶高度使用 plate。用量和步骤数随输入及版本变化，以当前页面和 JSON 为准。

| 候选 | 车长 | 轴距 | 驾驶舱位置 | 车顶高度 |
| --- | --- | --- | --- | --- |
| A | 14 | 8 | 6 | 14 |
| B | 16 | 10 | 8 | 14 |
| C | 16 | 10 | 5 | 12 |

C 的完整外廓高 13 plate，尾翼比车顶更高。模型参数与完整外廓分别计算，页面、步骤和 JSON 随选择的候选切换。

Futuristic 实际降低支柱与车顶；Minimal 只选 Tile 饰面，Retro 优先 Tile。结构、外观和颜色偏好会影响 4/6/8 stud 尾翼宽度及车顶/侧裙饰面；颜色优先仅对可选饰面使用库存主色，不改变实际库存颜色。当前还识别“无尾翼”“低矮”“长引擎盖”等有限文字规则。设计说明来自这些真实分配与参数，不把未识别的任意自然语言细节宣称为已实现效果，也不使用语言模型。

### 局部修改、锁定与撤销

编辑器采用有限分句语法，不是大语言模型。页面提供以下五个例句；操作达到当前规则极限、库存不足或校验失败时，会明确说明并保留原设计。

| 例句 | 实际目标 |
| --- | --- |
| 车头太高了 | 只重铺 `front` 饰面以降低高度。 |
| 尾翼小一点 | 缩小 `aero`，保留双支点；另支持单独降低、变窄或放大。 |
| 车尾更加激进 | 只修改 `rear`，增加有双凸点支撑的立体鳍片。 |
| 驾驶舱不要改 | 锁定 `cockpit`，不产生结构版本。 |
| 整辆车更低矮 | 降低 `cockpit` 与 `roof`，且完整外廓必须实际降低，否则回滚。 |

“尾翼降低一点”保留宽度，“尾翼变窄一点”保留高度。多个完整指令用逗号分隔；每个分句都必须完整匹配。未知要求、未定义的否定语句、额外改色或移动要求会拒绝整次事务，不能只执行其中识别到的一半。若某模块提交前已锁定，同次输入“解锁并修改”也会回滚；必须先单独解锁，再修改。

修改先释放目标模块用量，使用剩余真实库存局部重建，再重算用量、连接、全部 Validator 和说明书。非目标模块的物理数据保持原样；派生的连接列表与步骤号允许重新计算。服务器还独立检查原有锁、候选 ID 和实际变化的模块是否与 `changedModules` 一致，通过后才替换结果。浏览器实测中，车头由 11 降至 10 plate，使用 12 件真实 Tile，其余模块保持原样；锁定驾驶舱后的非法修改使模型 JSON 原样回滚。

结构修改保持候选 ID 稳定，`version` 加 1，并记录该候选自己的撤销历史；修改 B 不影响 A。纯锁定/解锁不增加版本，`changedModules` 为空，也不创建结构撤销记录。撤销恢复上个结构版本，并保留当前模块锁定状态。

编辑会话仍在内存中：最多 30 个会话，每个候选最多 12 个可撤销版本，1 小时无活动后过期。生成、修改、锁定和撤销后的模型会自动保存到磁盘，并保留独立修订；刷新或服务重启后可重新打开模型，撤销栈不会恢复。没有账户同步、数据库或 Redo。

### 子装配与旋转说明书

步骤区分 `build`、`subassembly`、`attach`、`rotate`，保存 `parentAssembly`、`subAssemblyId`、`orientation` 和 `cameraHint`。四个轮子分别作为 Pin / 轮毂 / 轮胎三件独立总成拼搭，不能将同侧前后轮错误地视作一个可独立拿起的组件。尾翼只有内部连通、外部依赖均已就绪且不会造成循环等待时才预组装；否则按实际连接逐件安装。

`subassembly` 展示独立组件自身的累计状态；`attach` 将已拼组件接入主车，并标注不重复领料；`rotate` 只改变观察与持握方向，新增零件为空，底部安装采用底视图。主车各步保持连通，最终包含全部零件；每件实际零件只在 `build/subassembly` 中领用一次，不能把安装页高亮再次算作新增库存。

已实际导出一个合成演示的 74 件、39 步模型（20 build / 10 subassembly / 5 attach / 4 rotate）：41 页 A4 中文 PDF，压缩后 **2,783,812 字节**，已检查中文、轮组与步骤图。这个演示不是实物验收。逐步数量、独立组件、翻转零领料、安装不重复领料、最终主车全件有自动检查。PDF 拒绝任一 Validator 失败或没有步骤的模型；V0.1 的默认 PDF 导出路径保留。页数、体积和耗时随模型与设备变化。

### 多套库存与用户自报散件

库存和 API 已支持在最多 10 个基础套装之外附加最多 100 行散件，每行包括 `partId`、`color` 和整数 `quantity`（1–1000）。页面使用常用颜色选项；API 颜色结构为 `{ id, name, hex: "#RRGGBB" }`。散件不能提交几何、连接点或官方来源声明，由服务器按同一个目录重新分类。

```json
{
  "setNumbers": ["DEMO-SPEED"],
  "extraParts": [
    { "partId": "3024", "color": { "id": 0, "name": "黑色", "hex": "#171717" }, "quantity": 5 }
  ]
}
```

相同零件与颜色累加，同时保留 `CUSTOM-EXTRAS` / `custom:extra-parts` 来源，并明确标记“用户自报散件（未核验）”。未知或仅部分支持的散件可加入库存展示，但不计入生成数量；不提供散件时不增加来源或改变原库存语义。套装与散件总量受 1,000,000 件分析上限约束。

页面在折叠的“添加自有散件”中提供编号、常用颜色、数量及逐行删除。点击“添加散件”后，必须重新“读取库存”才生效；只填写尚未添加的输入不计入库存。散件清单变更后会要求重新读取，再允许生成，避免使用过期库存。删除全部散件并重读可恢复无散件的原始行为，浏览器与生产预览均已验证。

### 当前边界与下一轮优化

真实套装在线验收为 0，实物拼搭为 0；尚不能将演示成功解释为某盒 BMW 套装已经可拼。当前只完整支持一个现代轮组配合族，Bracket、轮拱、挡风玻璃等仍有大量部分支持条目；人仔空间要求明确返回 422。文字生成与编辑采用有限规则，物理验证是几何和连接筛查。

本轮已将内存和磁盘重复步骤快照改为 ID 引用。74 件、39 步的合成 fixture 序列化从 2,999,697 降至 295,743 字节（90.14%）；20 份副本的留存堆微基准从 161,151,680 降至 15,445,944 字节（90.42%）。这属于同环境 fixture 测量，不是所有真实模型的性能保证；HTTP 仍兼容原有响应形状并支持 gzip。下一步优先级见 [V0.2.1 交付报告](docs/V0.2.1交付报告.md#h-下一步建议)。

### 模型保存、导入与实拼反馈

Speed 生成和修改会自动保存。展开“保存的模型与 JSON”，选择模型并点击“打开模型”；刷新或重启服务后也可使用，页面会尝试恢复上次打开的模型。浏览器只记录最后模型 ID，实际模型在服务端磁盘。恢复会重新运行当前自动校验；最近模型列表默认最多 30 条，撤销历史仍只保存在当前内存会话中。

| 路径（默认根目录 `data`） | 内容 |
| --- | --- |
| `inventories/{snapshotId}.json` | Rebrickable 原始 metadata/pages、标准化库存、spare 分类、支持分类及读取时间。 |
| `models/{modelId}.json` | 当前模型、库存、连接、模块、步骤、校验与版本元数据。 |
| `models/revisions/` | 与修订号、摘要对应的模型存档，用于追溯具体拼搭版本。 |
| `benchmarks/` | Benchmark 及缺件频次 JSON/CSV。 |
| `feedback/{modelId}/` | 用户自报实拼反馈。 |

可用 `.env` 的 `BRICKLAB_DATA_DIR` 更改根目录。目录需要可写；更换目录不会自动迁移旧数据，备份时保留整个数据目录。

点击“模型 JSON”导出本版 `schemaVersion: 1` 文件；“导入模型 JSON”恢复模型和说明书。导入上限 40 MB、300 个放置零件，会校验 schema、数量、尺寸、姿态和目录接口，重建连接、用量及步骤，重新运行全部校验。不会信任文件中的支持标记或通过声明。导入分配新 UUID、标记 `origin: imported`，通过 `importedFrom` 保留原模型与算法版本线索，库存一律作为用户自报；旧 V0.2 无 schema 文件明确拒绝，请重新生成后导出。

每个模型保存 `generatorVersion`、`validatorVersion`、`partLibraryVersion`。`model.version` 是结构版本，`metadata.revision` 是每次保存的修订号；锁定、解锁、撤销也会增加修订。`modelDigest` 对应具体模型、库存及说明书，不把旧修订反馈迁移到新修订。

首次实拼请先核对手中的真实零件，再打开保存模型、导出对应说明书，实际动手拼搭；随后展开“实拼反馈”，确认已经实际拼搭，记录成功/部分成功/失败、四轮状况、稳定性、说明书和具体问题。问题可带步骤与零件编号，类型包括 `cannot_connect`、`collision`、`too_weak`、`wheel_blocked`、`impossible_step`、`wrong_part`、`unclear_instruction`、`other`。

反馈关联确切 `modelId + revision + modelDigest`，始终标记 `userReported: true`。只有用户明确确认已拼、报告成功、四轮正常、结构牢固或稳定、说明清楚且无问题时，该修订的反馈状态才可显示 `passed`；其余为 `untested`，同时保留具体失败/部分成功记录。生成、自动测试和 JSON 导入均不能建立实拼通过记录。模型导出的 metadata 保持 `untested`，用户自报状态从独立反馈记录读取。

### 零件资料来源与许可

目录中的零件名称、标称尺寸和装配资料参考 [Pybricks 的 LDraw Parts Library 镜像](https://github.com/pybricks/ldraw/tree/c43ed06a128a10ed65675166bf42eb6fd608b9b0)，固定修订为 `c43ed06a128a10ed65675166bf42eb6fd608b9b0`，避免跟随上游变化而无法复核。每个目录条目的 `ldrawFile` 和 `sourceUrl` 指向对应原始 `.dat` 文件；原作者及文件许可声明见该文件头部。LDraw 资料按 [Creative Commons Attribution 4.0 International（CC BY 4.0）](https://creativecommons.org/licenses/by/4.0/) 标注，参考资料与本项目的简化建模有区别。

目录文件作者、来源格式与改编范围详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

本项目**未打包或加载原始 LDraw 几何库**；当前展示和校验使用自行编写的简化外包络与连接数据，不能声称已经接入真实 CAD 零件或证明实际可拼搭。复杂汽车零件即使名称和装配参考能够核对，仍需独立完成几何、接口与轮胎间隙验证后才能提升为完整支持。

运行演示不需要访问 LDraw 或下载其几何；资料审查时涉及 `github.com`、`raw.githubusercontent.com`，真实库存运行时涉及 `rebrickable.com`。新增网络来源只用于公开零件资料和已有库存 API，不包含用户凭证或模型上传。当前的真实套装验收、轮组物理安装和稳定性结论都不能由元数据审查代替。
