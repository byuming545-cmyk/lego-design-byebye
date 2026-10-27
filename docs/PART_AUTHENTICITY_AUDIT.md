# 旧版零件真实性审计与生产门禁

审计日期：2026-10-23。范围：V0.1 通用生成、Speed Creative V0.2/V0.2.1、Automotive V0.3、库存快照、旧渲染与导出、CLI benchmark。本文讨论旧版实现；真实原生数据新增数量与当前就绪情况以 Part Lab 的来源记录为准。

## 审计结论

旧版 101 个 Speed 编号中，64 个被旧代码标为 `supported`，37 个被标为 `partiallySupported`。V0.1 另有 11 个基础砖/板/瓦/斜坡定义，与 Speed 有重合，不能相加声称 112 种真实零件。旧版 `supported` 仅意味着手动参数模型能被旧算法使用，不能证明原生几何、来源连接或实物验证。

旧库引用的固定 LDraw revision 和 `sourceUrl` 有助于核对身份，但运行时没有递归导入这些 DAT 文件。旧库尺寸、网格接口、轮组及渲染形状主要是作者在代码中写出的参数。把此路径称作“已经导入真实 LDraw 几何”不准确。此次门禁不把任何旧 `supported`、`generatable` 字段提升为真实零件库的状态。

审计没有发现旧生成器在运行过程中临时发明新的商用零件编号。明确的合成标识 `demo-wheel`、`demo-technic-axle` 出现在 V0.1 Mock 库存；它们始终 `supported:false`、仅作合成示例显示，不是 LEGO 编号，也不进入真实零件库。旧手动定义仍应视为未验证，而不是因为编号存在就视为物理模型正确。

## 具体发现

| 位置 | 实现与问题 | 本轮处理 |
| --- | --- | --- |
| `src/lego/catalog.ts` | 11 个手写尺寸定义；`hasStuds` 仅控制平顶支持，没有原生反凸点或内部空腔 | 降为历史参数化路径；默认生成 API 被阻止 |
| `src/lego/geometry.ts`、`src/validators/index.ts` | 主要按外包围盒、垂直支撑与整数格判断，没有逐接口来源或内部咬合模型 | 不用于新增真实零件验证；旧算法仅保留回归用途 |
| `src/speed/catalog.ts` | 64 个手写 `box`、`shapedSlope`、`sideStudBrick`、`mechanical` 定义；`standardGrid` 按尺寸生成所有底部反凸点；特殊件连接与孔位由代码录入 | 旧参数化定义不能产生真实 `generatable`/`verified` 状态 |
| `src/speed/catalog.ts` 的 37 个部分支持编号 | 复杂挡风玻璃、翼子板、Bracket 等保持 `dimensions:null`、`shape:null` 和空连接 | 这种保留未知的做法继续保留；不得用方块补全 |
| `src/speed/rendering.ts` | `RoundedBoxGeometry`、斜面挤出、贝塞尔曲面、旋转圆环、手写轮架孔和轮毂 8 条装饰肋；并非 DAT 原生表面 | 旧画面标为参数化示意；不作真实几何或连接证据 |
| `src/components/ModelViewer.tsx`、`src/lego/renderIsometric.ts` | 基础渲染根据类别与尺寸生成方块/斜坡/凸点，Canvas 后备也为示意图 | 不作为真实 Part Lab 的几何后备；真实数据缺失应显示缺失状态 |
| `src/components/PartThumbnail.tsx` | 所有类别使用通用 SVG 方砖示意，不是对应零件的缩略图 | 不进入真实零件的来源判断；Part Lab 由原生网格另行绘制 |
| `src/speed/wheelAssemblies.ts` | 轮组配合族、姿态和车宽表经过旧程序规则检查，但没有逐条外部接口证据和实拼 | 旧 `generatable` 只保留作历史算法状态，不作为真实轮组验证 |
| `src/automotive/generator/body.ts` | 驾驶舱由透明基础斜坡/砖拼成，没有使用虚构单件挡风玻璃；造型是程序先验，不是学习出的官方车壳 | 仍非真实学习成果；旧车型生成暂停 |
| `src/automotive/palette.ts` | 从旧 Speed `supported` 过滤得到虚拟无限数量调色板；没有真实零件颜色组合库存证据 | 不计入当前真实可生成数量；旧页面改为历史参数化目录 |
| `src/automotive/references/importer.ts` | MPD 结构/实例解析保留未知 DAT 引用；`resolved` 旧义为能映射到旧 catalog，不等于已导入网格 | 不作为新的 native-mesh 证据；真实几何应由新递归导入器独立读取 |
| `src/inventory/rebrickable.ts` | 未识别零件用 `supported:false` 携带兼容旧类型的 `1×1×1` 占位尺寸；旧生成器会排除，但这些数字不是尺寸证据 | 此旧兼容字段不得迁移到新真实零件库；新增库应使用缺失/null，且默认旧生成被阻止 |
| `src/inventory/mock.ts`、`src/speed/inventory.ts` | 合成库存、虚拟零件数量，标签明确，但不能作为套装统计分母或真库存 | 真实 miner 只接受有来源的库存记录；不混入 Mock |
| `src/speed/snapshotSupport.ts` | 之前在读取真库存后把旧 `supported` 写成快照中的 `generatable` | 已改成 `recognizedOnly`，真实支持量与支持率为 0，catalogVersion 标明 legacy-parametric-unverified |
| `src/cli/speed-benchmark.ts` | 之前会把旧支持结果写回真库存快照 | 已移除此提升路径；CLI 默认停止，显式 `--legacy-fixture` 才运行历史算法 |

## 默认边界

`src/parts/legacyPolicy.ts` 在旧 API 路由前使用与 Express 路由相同的大小写和末尾斜杠规则进行门禁。下列入口默认返回 HTTP 409，代码 `REAL_PARTS_FOUNDATION_REQUIRED`：

- `POST /api/generate`
- `POST /api/speed/generate`
- `POST /api/automotive/design`
- Speed 模块变更、局部改造、撤销
- Speed 模型 JSON 导出
- Automotive 候选 BOM、模型 JSON、说明书导出

读取库存、查看已有模型、导入来源、车型研究和用户反馈可继续使用。旧数据响应附带 `X-Bricklab-Part-Authenticity: legacy-parametric-unverified`。旧 Speed 与 Automotive 页面有相应说明，生成/修改/导出按钮禁用，客户端 PDF 函数也在进入导出之前被阻止。历史程序校验通过或用户自报实拼，不会改变原生数据来源等级。

服务器启动与统一预览使用 `createApp()` 的默认阻止策略；没有环境变量、请求体或查询参数可以开启旧生成。测试可通过服务器构造参数 `legacyGenerationPolicy:'test-fixture'` 显式验证历史算法，响应附带 `X-Bricklab-Legacy-Fixture:true`，这些测试输出不计入真实库或实物验证。

两个 benchmark CLI 默认返回退出码 3。只有明确传入 `--legacy-fixture` 才运行历史参数模型，并输出历史回归说明。库中的旧算法保留供维护与回归使用；新生产生成器必须以新真实注册表为唯一准入依据，不能直接复用旧 palette。

## 后续恢复生成所需证据

新 Part Lab 负责来源、几何、连接、碰撞准备状态。即使某零件拥有正确原生表面和若干来源连接，仍需要说明支持的装配规则、可靠碰撞方法与对应校验。保守 AABB 只能提供外包络，不能证明空腔内的轴或凸点能插入；因此不能为了提高数量而把这类数据自动升级成可生成。

恢复任何旧生成入口前，必须迁移其数据依赖到可信注册表，保留原生连接坐标变换与来源，并通过相应连接、旋转、碰撞、轮轴或夹持装配检查。物理实拼状态仍应独立记录，不以“程序检查通过”代替。

## 验证

`tests/parts-authenticity-policy.test.ts` 验证默认构造的实际 HTTP 应用：所有旧生成/变更/导出入口被拦截，大小写及末尾斜杠一致，未知模型不会触发旧档案读取，客户端无法传入 fixture 参数绕过门禁，健康与目录读取保留并有来源标签。原旧 API 与 benchmark 回归显式使用测试 fixture 模式。
