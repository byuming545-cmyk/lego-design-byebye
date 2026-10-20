# Automotive V0.3：参考引导汽车设计

本模块为原有通用创意与 Speed Creative 增加独立的 Free Automotive Designer。目标是先规划车型比例、轮组与车舱，再组合局部 LEGO 构建模式，最后运行物理检查和外形评分。首个重点车型是现款 Mercedes-AMG S 63 E PERFORMANCE，W223。

## 当前证据边界

以下状态不能用界面出现模型、测试通过或分数较高来替代：

| 项目 | 本轮可确认的状态 |
| --- | --- |
| 合法真实参考整车导入 | **0 个**；导入器的原创测试 fixture 不计入真实参考样本 |
| 官方 LEGO 汽车设计规律学习 | 没有真实样本支持的分布仍为 `engineer-prior`；不称为已从官方套装学得 |
| 现实车辆官方尺寸核验 | 本开发环境访问所列官方目标 URI 时被代理拒绝；目录四项尺寸均为 `null` |
| 车型目录标签 | `catalog_seed`，包括 W223 身份和轿车轮廓等编辑标签；与已联网核验的事实分开 |
| 手动尺寸与图片 | `manual` / `user_supplied`；用户自报，未独立核验 |
| 现实图片理解 | 未实现；图片只保存链接、角度、来源，`analysisStatus: not_analyzed` |
| 产品内 LLM 调用或模型训练 | 未实现；当前为解析、检索、工程规则、评分与候选搜索 |
| 零件颜色组合的实际生产与购买可用性 | `partColorAvailability: not-verified`；真实 LEGO 颜色编号不等于该零件生产过该颜色 |
| 实体试拼 | **0 次**；目录几何、连接和结构检查不等于真实承重或装配验证 |

Free Design 使用虚拟零件需求，不代表用户拥有这些零件；原有受套装库存约束的模式继续使用自己的库存流程。参考模型用于提取局部结构知识，不能把完整第三方整车改名后作为原创结果输出。

## Windows 解压与启动

使用最新 Node.js 24 LTS。先把 ZIP **完整解压**到普通目录，不要在压缩包预览窗口内运行命令。进入同时包含 `package.json`、`package-lock.json`、`src` 的那一层；下载包外面可能还有一层同名目录。

在 PowerShell 中执行，路径替换为自己的实际目录：

```powershell
cd "D:\Projects\lego-design-byebye"
Get-Item package.json, package-lock.json
npm ci
npm run build
npm start
```

终端出现监听成功后打开 `http://localhost:3001/#/automotive`；参考调试页是 `http://localhost:3001/#/automotive-lab`。`npm start` 运行已构建的服务，因此修改源码后需要重新 `npm run build`。默认端口来自 `src/api/server.ts`，可通过 `PORT` 修改。

也可执行：

```powershell
npm ci
npm run preview
```

此命令会构建项目，并在 `http://localhost:3000/#/automotive` 同时提供页面和 API。预览端口使用 `PREVIEW_PORT`，默认 **3000**；不是 Vite 常见的 4173。

开发时使用 `npm run dev`，网页默认 `http://localhost:5173`，API 默认 3001。关闭服务按 `Ctrl+C`。如果提示找不到 `package.json`，先检查当前目录；不要通过新建空 `package.json` 来解决路径错误。

## 设计一次车型

1. 打开 Automotive，输入车型或选择目录车型。目录包含 W223 S63、G82 M4、992 911 Carrera、Roma、Revuelto，分别覆盖豪华轿车、性能双门轿跑、跑车、GT、超级跑车。
2. 查看“车型研究”的来源、访问结果和未知字段。HTTP 请求成功但未解析到对应车型的可靠尺寸，也不能显示为尺寸已核验。
3. 指定 8、10 或 12 studs 宽度与颜色。Design Brief 另有 custom 宽度规划接口，但当前零件生成器的独立布局仅覆盖 8/10/12；其他宽度不保证可生成或导出。
4. 尺寸不完整时，优先补充手动资料。仅在接受概念研究时主动启用“允许工程估计”；`dimensionBasis: estimated` 或 `mixed` 会随结果保留。估计值不能回写成真实车厂规格。
5. 选择合法导入的参考模型，生成 5–20 个粗候选。参考库为空时，系统明确使用工程先验和人工局部构建模式。
6. 查看 Design Brief、所用 Pattern、物理检查、分数明细和淘汰原因。候选生成数量与最终通过数量不同；没有候选通过质量门槛时，结果应明确失败。
7. 只有通过导出门槛的候选才能导出 BOM CSV/JSON、模型 JSON 和逐步 PDF。BOM 是材料需求，不是购物清单可购性保证。

“相似度”当前比较数字比例和模块目标，方法为 `geometric-heuristic`。它没有识别照片，也没有验证 AMG 图案、灯组图形或品牌辨识度。估计 brief 的高分只说明候选接近这份估计规划。

## 现实车型资料与联网来源

`src/automotive/research` 将尺寸与视觉描述保存为带 `status`、`sourceIds` 的事实。未知值使用 `null`，不补成看似合理的数字。来源访问结果与事实状态相互独立：保存官方链接不代表读到内容；读到页面也不保证有可用规格。

四种事实状态分别为：

- `unknown`：没有可用事实。
- `catalog_seed`：编辑目录种子，未作本轮独立核验。
- `manual`：用户提供的资料；注明来源仍不等于独立核验。
- `live_verified`：本次从预设官方来源的对应车型结构化数据读取到字段，并保留来源。

Provider 只会请求服务器预设的官方 URL；不接受客户端指定任意抓取 URL。它限制同源重定向、超时、响应大小和 Content-Type，只解析 JSON / JSON-LD 或 HTML 内的 JSON-LD，不执行网页脚本。它要求明确的单位和车型匹配；含后视镜与不含后视镜的宽度不混用。未支持的网页正文布局不会被猜成尺寸。

2026-10-20 的只读官方访问观察为代理 `CONNECT 403 Forbidden`。这证明本环境未读到网站内容，不能据此判断官方页面是否存在、规格是否正确，或网站是否永久拒绝访问。

| 车型 | 预设官方目标链接 |
| --- | --- |
| Mercedes-AMG S63 W223 | <https://www.mercedes-amg.com/en/home/vehicles/s-class/sedan.html>；<https://www.mbusa.com/en/vehicles/model/s-class/sedan/s63e> |
| BMW M4 G82 | <https://www.bmwusa.com/vehicles/m-models/m4-coupe/overview.html> |
| Porsche 911 Carrera | <https://www.porsche.com/usa/models/911/carrera-models/911-carrera/> |
| Ferrari Roma | <https://www.ferrari.com/en-EN/auto/ferrari-roma> |
| Lamborghini Revuelto | <https://www.lamborghini.com/en-en/models/revuelto> |

本轮已将以下厂商域名，以及 `omr.ldraw.org`、`www.ldraw.org` 保存到云环境配置草稿，保留原有 Rebrickable 与包管理器设置。平台返回 `saved / requires_publish: true`：草稿尚未改变当前网络权限，需要在环境设置中保存并发布后再研究。其他受限部署也需要开放相应 **HTTPS 目标域名**：

```text
www.mercedes-amg.com
www.mbusa.com
www.bmwusa.com
www.porsche.com
www.ferrari.com
www.lamborghini.com
```

允许 GitHub 或包管理器域名不会同时允许上述网站。保留环境注入的代理与 CA 信任，使用受支持的网络配置变更流程；修改容器中的策略文件或清除代理不能授予访问权限。生产启动入口会使用 Node 的环境代理配置。放行域名之后，页面仍可能不存在、重定向到未允许域名，或没有当前解析器支持的结构化规格；届时应保留失败/未知并按实际情况完善预设来源。

图片和官方 PDF 只保留必要链接与来源元数据，不重新打包分发。Provider 当前不下载图像，不自动判断拍摄角度，也不执行视觉分析。

## 补充手动资料

未知车型可以走结构化手动资料入口，无需伪装成已支持的目录车型。尺寸单位固定为毫米，宽度为**不含后视镜车身宽度**。示例数据是虚构测试值，不能用作 S63 官方规格：

```json
{
  "manufacturer": "Example",
  "model": "Measured Sedan",
  "vehicleType": "luxury-sedan",
  "dimensions": {
    "lengthMm": 5300,
    "widthMm": 1950,
    "heightMm": 1500,
    "wheelbaseMm": 3200
  },
  "visualFeatures": {
    "doorCount": 4,
    "hoodLengthRatio": 0.27,
    "cabinPositionRatio": 0.32,
    "roofline": "用户标注的曲面轿车车顶"
  },
  "signatureFeatures": ["长轴距四门轿车轮廓"],
  "featureTags": ["long-wheelbase", "four-door", "long-hood"],
  "sourceLabel": "用户测量记录；未独立核验",
  "sourceUrl": "https://example.org/measurement-notes",
  "referenceImages": [
    { "angle": "side", "url": "https://example.org/side.jpg" },
    { "angle": "front", "url": "https://example.org/front.jpg" }
  ]
}
```

`generation` 可选；未知字段省略或在支持的位置使用 `null`。四项尺寸有缺失时，默认无法生成 source-backed brief。图片角度支持 `front`、`front-three-quarter`、`side`、`rear-three-quarter`、`rear`、`unknown`，每张图仍保持 `not_analyzed`。

把上述 JSON 保存为 `manual-profile.json`，在项目根目录用 PowerShell 提交；响应中的 `profile.id` 可用于设计请求：

```powershell
$saved = Invoke-RestMethod -Method Post -Uri "http://localhost:3001/api/automotive/profiles/manual" -ContentType "application/json; charset=utf-8" -Body ([System.IO.File]::ReadAllText((Resolve-Path ".\manual-profile.json")))
$saved.profile.id
```

`toVehicleDesignBrief(profile, { widthStuds, allowEstimatedProportions })` 根据尺寸比例重新计算目标长度、轴距、车高与局部模块，并离散选择规划尺寸。底盘层数、车舱宽度和车顶宽度分别规划，不通过统一缩放 LEGO 零件实现变宽。四项尺寸完整时的 `dimensionBasis: source-backed` 只说明尺寸有来源；车顶、前后悬、轮径等仍可能存在单独列出的工程假设。

## 合法导入 LDraw / MPD 参考

先确认每份数字模型的使用条件。可以使用自己拥有权利的原创模型，或许可明确且当前导入器支持的开放模型。拥有 LEGO 实体套装、下载官方说明书或看到公开 MOC，不自动授予复制数字模型的权利。

当前模型导入接受 `CC0-1.0`、`CC-BY-4.0` 与带声明的 `user-owned`。`unknown` 禁止导入模型正文；未知或暂不支持的许可应只保留链接和原始许可说明。不要把 CC BY 2.0、受限 MOC 或其他许可擅自改标为 CC0 / CC BY 4.0。LDraw OMR 是可研究的来源，不能仅凭“来自 OMR”就认定每个文件均可按当前格式导入。

操作步骤：

1. 在 Studio 等工具中将有权使用的模型导出为 LDraw `.ldr` 或 `.mpd`。当前上传入口不直接解析 `.io` 压缩工程。
2. 在 Automotive Lab 选择文件，填写来源、模型名、作者、许可和署名；套装号存在时也应保留。`user-owned` 必须勾选并提供权利声明，该声明仅覆盖自己有权许可的模型。
3. 使用 MPD 时把所需子模型嵌入同一文件。解析器不会跟随文件路径下载外部文件；未知零件会保留原始引用并列入 unresolved，而不是生成已验证的占位几何。
4. 导入后检查 `coverage.geometryRate`、`unresolvedPartIds`、层级和 warnings。解析成功不保证整车几何完整，也不保证结构指标可测。
5. 为参考资料显式标注 `vehicleType` 与 `featureTags`，然后再参与类别统计与检索。车名、品牌名、目标生成车型都不会自动成为参考分类证据。

完整元数据示例，可随导入请求提交：

```json
{
  "source": "自己的原创数字模型；本地导出",
  "modelName": "Original Long Sedan Study",
  "author": "Your name",
  "license": "user-owned",
  "attribution": "原创作者署名；允许作为本地结构研究参考",
  "vehicleType": "luxury-sedan",
  "featureTags": ["long-wheelbase", "long-hood", "four-door"],
  "rightsDeclaration": {
    "ownsRights": true,
    "statement": "我拥有本数字模型的权利，并允许用于本项目的参考分析。"
  }
}
```

分类取值为 `luxury-sedan`、`performance-coupe`、`sports-car`、`gt`、`supercar`、`unknown`。基础上传表单未提供的分类字段可通过元数据/API 入口提交，不能用修改文件名替代分类。没有合格类别样本的 Grammar 保持工程先验。默认至少需要同类别 **3 个不同、许可明确、足够几何覆盖与测量置信度的真实参考**，相应分布才会成为 `reference-derived`；不足样本的观测可展示，但不能称为统计学习成功。

例如把元数据保存为 `reference-metadata.json`，用以下方式上传自己有权使用的 MPD。若已明确转换后的内部纵向轴与车头方向，可在请求顶层追加 `longitudinalAxis: "x" | "y"`、`frontDirection: 1 | -1`；不确定时省略，不要根据希望生成的目标车型编造方向。

```powershell
$metadata = Get-Content -Raw ".\reference-metadata.json" | ConvertFrom-Json
$payload = @{ filename = "my-car.mpd"; content = (Get-Content -Raw ".\my-car.mpd"); metadata = $metadata } | ConvertTo-Json -Depth 20
Invoke-RestMethod -Method Post -Uri "http://localhost:3001/api/automotive/references/import" -ContentType "application/json; charset=utf-8" -Body $payload
```

许可未知时使用同一接口，`metadata.license` 设为 `unknown`，**不发送 `content`**，仅保存来源链接。此记录返回 `link` 与 `analysis: null`，不会进入模型学习。当前没有单独的在线 classify 自动识别服务；分类信息来自导入元数据。修改既有参考时应保留原始来源与许可，按实际接口能力重新提交元数据，而不是直接编辑持久化 JSON。

Importer 保留颜色、位置、原生 3×3 矩阵、子模型和层级，统一坐标转换集中于 `references/coordinates.ts`。原生 LDraw 的 `(x,y,z)` 转为 `(x,z,-y)`，平面单位为 stud，高度为 plate。原始矩阵不会被简单当作欧拉角；无法可靠适配目录几何的变换会保留并产生未知测量。

硬限制为 8 MiB、200,000 行、1,000 个子模型、20,000 次零件/子模型放置与 32 层递归；接口还可能有请求大小限制。循环引用、危险路径、奇异矩阵和超限输入会被拒绝。

## API 入口

下面路径均以 `/api/automotive` 为前缀。使用预览端口时，将示例中的 3001 替换为 3000。

| 方法与路径 | 用途 |
| --- | --- |
| `GET /status` | Palette、车型、能力声明、警告与默认评分权重 |
| `POST /research` | `{ "query": "Mercedes-AMG S63", "live": true }`；`live: false` 明确只读目录 |
| `POST /profiles/manual` | 原始结构化手动车型，返回 `{ profile }` |
| `GET /references` | 返回 `{ models, links, analyses }`，链接记录不计为模型 |
| `GET /patterns` | 已确认的工程模式与从已导入模型自动提取的待审局部候选；二者分开返回 |
| `GET /references/:referenceId/patterns` | 查询某个数字模型的局部候选；仅有来源链接时返回 422 |
| `POST /references/import` | `{ filename, content, metadata }`；未知许可只发送 metadata |
| `POST /design` | profileId、宽度、显式估计开关、5–20 候选数、可选参考/颜色/权重 |
| `GET /sessions/:sessionId` | 读取保存的设计会话 |
| `GET /sessions/:sessionId/candidates/:candidateId/bom?format=csv` | 导出前重新验证后返回 CSV；`format=json` 返回 JSON |
| `GET /sessions/:sessionId/candidates/:candidateId/model.json` | 导出合格候选与所需设计上下文 |
| `GET /sessions/:sessionId/candidates/:candidateId/instructions` | 复验后返回浏览器 PDF/步骤生成所需数据；不是服务器直接返回 PDF 文件 |

设计请求示例；`profileId` 替换为保存成功后返回的 ID。`bodyColor` 为真实 LEGO 颜色编号、名称或十六进制请求值；服务端保存请求色与选中的实际 palette 色。

```json
{
  "profileId": "manual-examplemeasuredsedan",
  "widthStuds": 10,
  "allowEstimatedProportions": false,
  "candidateCount": 8,
  "referenceIds": [],
  "bodyColor": 72,
  "weights": {
    "automotiveDesign": 0.2,
    "legoStyle": 0.2,
    "referenceSimilarity": 0.35,
    "structure": 0.2,
    "buildability": 0.05
  }
}
```

返回状态 `accepted` 只表示有候选通过当前数字门槛；`rejected` 表示没有合格候选；`unsupported` 表示已得到 custom brief，但当前宽度布局与轮组尚未支持整车构建。权重会归一化，不能关闭硬检查或降低最低质量门槛。

## 架构与阶段门槛

主链路为：现实车型资料 → Design Brief → 参考分析与检索 → 比例/模块规划 → 局部 Pattern 选择 → 零件几何与 Connection Graph → 物理复验 → 设计评分与排名 → 合格候选导出。

| Phase | 实现位置与职责 | 进入后续阶段前应检查 |
| --- | --- | --- |
| 1 Reference Library / Importer | `references/types.ts`、`importer.ts`、`store.ts`、`coordinates.ts` | 许可、署名、矩阵/层级、坐标、循环/路径/大小限制；真实参考数独立记录 |
| 2 Analyzer | `references/analyzer.ts` | 只从可支持的几何和连接计算，未知语义保持 `null`，每项带置信度与证据 |
| 3 Grammar | `grammar.ts` | 明确区分 `engineer-prior` 与合格真实样本分布，fixture 不计入真实学习数量 |
| 4 Pattern Library | `patterns.ts` | Pattern 是局部组件；confirmed 来自目录、几何、连接图检查，强度是启发分 |
| 5 Design / Style | `quality.ts` | 物理复验与质量阈值同时生效，低外形质量候选不能凭物理合法性晋级 |
| 6 Free Palette | `palette.ts` | 已支持几何/尺寸/连接信息才入选；数量为虚拟设计能力，颜色组合可用性另标未知 |
| 7 Research / Brief | `research/*`、`profiles.ts` | 目录、自报、联网事实分开；缺尺寸默认拒绝，估计需要显式选择 |
| 8 Retrieval | `retrieval.ts` | 按测量比例、设计问题与显式标签检索，品牌相同不自动加分；空库明确回退 |
| 9 Generator | `generator/*` | 先生成独立模块规划，再构建零件，宽度对应校准轮组；不缩放零件或整车模板 |
| 10 Candidates / Ranking | `quality.ts` 与设计流水线 | 5–20 粗候选，独立重跑硬检查，按可调权重排序并保留淘汰原因 |
| 11 Benchmark | Automotive benchmark CLI | 五类别与 S63 三宽度分别记录来源状态、耗时、分数、失败和预览信息；估计结果单独标记 |
| 12 Instructions groundwork | `instructionReferences.ts`、现有步骤/PDF/模型编解码 | 已预留来源链接与装配次序、临时支撑、加固、分组的观察接口；当前不下载或解析官方 PDF，尚未导入真实说明书研究样本 |

这里列的是实现职责与验收门槛，不代表 12 个阶段都已获得真实参考、视觉或实体证据。最终集成验证见本文末尾记录。

物理门槛包括库存/虚拟 palette 适配、碰撞、连接、轮组与结构。汽车造型分检查实际外廓、前后悬、轮位与引擎盖—座舱—车顶的高度关系；LEGO 风格分独立检查饰面、曲斜面、侧向接口、跨层连接和模块覆盖；相似度比较 Brief 与参考中的可测比例。默认汽车造型与 LEGO 风格分别至少 64、比例相似度至少 60、综合至少 67。调用方只能提高最低阈值。五项权重可调整，碰撞、连接、轮组、结构及完整拼搭步骤检查始终生效。

Lab 与会话 JSON 保留所有已经评分候选的分项与排名，包括未进入前三名的合格方案。物理检查失败或无法生成完整步骤的方案保留失败原因；没有足够证据计算的分数不填造假数值。

失败结果应为 `No candidate met design quality threshold.`，保留调试信息，不把被淘汰候选包装成最终成功。Pattern 的程序检查与结构分也不衡量手指空间、真实插入路径、装配力或实体承重。

## Benchmark 与可复现检查

五类别基础 benchmark 与 W223 S63 的 8/10/12-wide 比较使用同一通用规划/生成链路。不得为 S63 建立专用整车生成器。

在官方资料尚不完整的当前环境，概念研究命令为：

```powershell
npm run benchmark:automotive -- --estimated --output artifacts/automotive-benchmark/estimated
```

`--estimated` 只允许明确标注的工程比例研究。它不表示已完成车厂规格核验或真实 LEGO 参考学习。省略此选项时，缺少可信尺寸的案例应为 pending/失败，而不是自动生成“已核实”结果：

```powershell
npm run benchmark:automotive -- --output artifacts/automotive-benchmark/source-required
```

查看每一行的车型、宽度、最佳候选、分数方法、尺寸来源状态、零件数、耗时、硬检查/设计失败与预览信息。没有通过的案例应保留失败原因，不能只统计成功案例。截图/预览提供观察证据，不等于程序已经判断车型外观好坏。

运行代码检查：

```powershell
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run test:preview
```

测试浏览器首次安装时，可按本机 Playwright 提示执行 `npx playwright install chromium`。网络或浏览器环境失败需要如实记录，不能当作测试已通过。

持久资料默认保存在 `data/automotive/references`、`data/automotive/profiles` 和 `data/automotive/sessions`，可用 `BRICKLAB_DATA_DIR` 改变数据根目录。`data` 是运行数据且被 Git 忽略；重启服务不会自动把数据变成随源码分发的公开参考库。备份自己的合法资料并保留许可元数据。

## 最终集成验证记录

以下为 2026-10-20 的实际运行结果。这里的通过是当前软件规则的通过，车型辨识与实物搭建另行记录。

| 检查 | 最终结果 |
| --- | --- |
| TypeScript 类型检查 | 通过 |
| 单元/API 测试 | `npm test`：19 文件，350 项全部通过 |
| 生产构建 | `test:preview` 内的 `npm run build` 成功，包含前端和服务端编译 |
| 开发 E2E | 覆盖 16 个场景；发现并修复手机导航溢出后，两项旧版手机回归均通过。其余 14 个场景通过 |
| 生产预览 E2E | `npm run test:preview`：6 项全部通过，含自定义预览 Host、iframe、三维模型、会话恢复及旧版 PDF |
| 五类别与 S63 多宽度 benchmark 产物 | 7 组显式估算概念稿均有 3 个合格候选；56 个粗候选保留分项分数；其中一个长方案因说明书编码限制淘汰。默认不估算时为 7 项研究待完成 |
| 人工查看候选预览与淘汰原因 | 7 组真实 WebGL 截图已查看；车型外观辨识未达到目标，不能凭几何分数验收 S63 / 911 / Revuelto |
| 合法真实参考整车导入 | 0，除非后续实际导入并补充来源证据 |
| 实体试拼 | 0 |

报告入口：[估算 benchmark](../artifacts/automotive-benchmark/estimated/report.json)、[来源资料待完成报告](../artifacts/automotive-benchmark/source-required/report.json)、[截图与人工观察清单](../artifacts/automotive/manifest.json)。另有 [五类别 × 三宽度生成器覆盖记录](../artifacts/automotive-benchmark/generator-coverage.json)：75 个方案通过数字物理校验，74 个通过完整质量与步骤编码检查；15 组均能选出 3 个候选。长方案超过原有 4000 连接点上限时仍会被拒绝。

本轮已实现导入、分析、可追溯模式、重规划、评分、导出和调试的基础链路，但尚未完成“学习真实参考后，生成具有车型辨识度的汽车”这一核心外观目标。当前五类车仍共享较多方形座舱、平顶和相似前脸，需要合法真实参考及进一步的造型构造与评审，不能将本次规则分数当成目标已经达成。

仍需后续验证或建设：真实开放参考模型的合法导入及覆盖率；厂商官方尺寸与多角度图片来源；真实参考统计是否改善生成；目标车型外观辨识；custom 宽度的独立轮组与模块构造；零件颜色实际可用性；实体试拼；装配可达性；说明书观察接口的实际样本。当前页面、规则分数和 fixture 测试不能替代这些证据。
