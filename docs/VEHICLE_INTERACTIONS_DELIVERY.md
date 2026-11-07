# 配色与步骤分组交付

基线：实际 HEAD `eb0a38d`，本地分支 `codex/vehicle-paint-steps`。开始时未提交的 `artifacts/website-access-2026-11-07/` 20 个文件已逐一记录哈希，全部保留。没有回退、覆盖历史模型、发布、推送或合并。

## 配色

先完成配色，再进行步骤交互。第一阶段 16 项单元测试以及完整版/离线 HTML 的真实 Chromium 验收通过，证据在 [colour-stage](../artifacts/vehicle-interactions-2026-11-07/colour-stage/checks.json)。包括八色色块、四预设、同一画布与相机、完整导出/导入、真实 API 保存链接重开和篡改拒绝。

八种车身设计颜色：白、红、橙、蓝、深绿、黄、黑、石墨灰。车身、车顶、饰条/保险杠、轮拱覆盖分开设置；轮拱未单独选择时跟随车身。恢复默认精确恢复原模型配色。

映射读取不可变基础模型的功能角色。窗区包含玻璃与框架的混合角色，使用原始框架标记和外侧位置识别白色框架；黑色玻璃、轮胎/轮毂、格栅、头灯、尾灯不受车身染色影响。不是按画面当前颜色全局替换。

已有六色保持原有项目值。新增橙色 LDraw 25 与深绿 288 从零件库同一固定版本 `c43ed06…` 的真实 `LDConfig.ldr` 读取；[源文件](../artifacts/vehicle-interactions-2026-11-07/LDConfig-source.ldr) SHA256 为 `56689f411f9cd49da8fc13a1e1892f77a7cdd6ee28225b46acb43cb078ea6599`。没有猜测 Element ID、零件颜色供应或库存。

切色只更新既有实例材质，不重新加载网格、重置相机、提交生成任务或修改研究缓存。完整 BOM 按实际实例和当前设计颜色汇总。派生草稿同时保留 `originalDesignColor`、模块 `sourceColor`、设计颜色和完整基础文档。

新增设计格式 `bricklab-vehicle-colour-draft-1` / 配色规则 `functional-role-paint-1`。独立父模型哈希绑定，严格重新计算整个草稿；即使重算 SHA 也不能修改姿态、数量、来源色、验证状态或插入额外权限。完整版真实任务保存到独立 `designs/<SHA>.json`，不改原任务；离线版明确只保存浏览器选择/导出文件。两个入口都可重开完整 JSON。

## 步骤分组

规则版本 `functional-appearance-groups-1`。读取实际原分组与实际 placements，严格核对重复、遗漏、虚构实例及角色不一致，然后按功能展示七组：底部支撑、轮组、侧面与轮拱、机盖与前脸、尾部覆盖、窗区与窗柱、车顶覆盖。未知角色单独保留为“其他实际零件”，不丢弃。

支持上一步、下一步、进度条、播放/暂停、显示全部。当前组通过独立 emissive 材质高亮，之前零件正常显示，之后零件隐藏；基础设计颜色未改。关闭分组准确恢复完整颜色和全部实例。相机始终使用完整模型的原生边界，切换组不会改变取景。切换车型卸载旧状态并停止计时器。

当前组详情显示实际实例、编号、数量、用途、设计颜色以及模块 case/local member 或原外观分组引用。源组编号不冒充说明书页码/步骤，完整来源仍在原模型中。分组显示不影响保存、导出和完整 BOM。

界面始终声明：**按功能分组展示模型组成，非已验证实拼说明书。** 没有插入轨迹或飞入动画。

## 完整版与离线版

两端共用 `VehicleDesignStudio`、`appearance-design`、`appearance-groups` 和原生渲染器。渲染器场景生命周期独立于配色、视角及分组状态，保留网格和相机。完整版离线资源缓存键升级为 `bricklab-paint-groups-v2`，未改变车型研究键、基础模型 schema 或生成语义。

下载 [单文件 HTML](../artifacts/vehicle-interactions-2026-11-07/offline-final/bricklab-paint-steps.html) 或 [ZIP](../artifacts/vehicle-interactions-2026-11-07/offline-final/bricklab-paint-steps.zip)。包内含使用说明和模型/逻辑/HTML 哈希 manifest。无外部字体、CDN、API 或模型服务依赖。本次离线打开仅展示已保存结果，明确不执行新车型生成。

操作见 [运行说明](VEHICLE_INTERACTIONS_RUNBOOK.md)。云端 localhost 不是用户电脑的外网入口，没有创建公网隧道。

## 模型与验证边界

| 原模型 | 件数 / 原生种类 | 原始内容哈希 |
|---|---:|---|
| Charger | 158 / 21 | `a44e1e081684666a408cdca577b564655bd58075bf5fc9519af2083d7ced8fc7` |
| Golf | 160 / 15 | `035cad4a2321f4b56499a9cf2f4a615272796a804d7ab301e95c9d920986e5ab` |

本轮没有改比例、造型、编号、刚体姿态、原生网格、`.dat`、接口或碰撞容差。未新增车辆对照。正式整车连接 `NOT_VERIFIED`；保留原轮组/稳定性/实物结论与 `APPEARANCE_DRAFT`、`DRAFT_NOT_BUILD_INSTRUCTIONS`。原先独立五件支撑的有效结论也未扩展到整车。步骤和配色不授予装配资格。

新增付费调用 0；未训练/微调，未索要密钥、重置预算或外发内部渲染。原预算账本哈希与旧离线目录核对见 [完整性记录](../artifacts/vehicle-interactions-2026-11-07/integrity.json)。

## 验收记录

新增 25 项正负向单元测试已通过，类型检查与构建通过。构建仍提示原有大型前端 chunk，未为本轮交互扩大到拆包改造。

新增真实浏览器检查已通过，两车分别检查八色、四预设、角色独立控制、完整导入/导出、七组恰好覆盖、逐组显隐/高亮、进度拖动、播放/暂停、切车停止旧播放以及同一画布/相机稳定。完整页面还通过真实 API 保存及全新存储上下文重开、重算 SHA 后的姿态篡改拒绝、原任务文件字节不变。见 [完整版记录](../artifacts/vehicle-interactions-2026-11-07/browser-final/full-checks.json)。JSON 与 CSV 的全模型数量及逐行设计颜色一致，见 [完整版 BOM](../artifacts/vehicle-interactions-2026-11-07/browser-final/bom-consistency.json) 和 [离线 BOM](../artifacts/vehicle-interactions-2026-11-07/browser-final/bom-consistency.json)。

离线验收使用实际单文件，首次仅请求 HTML 本身；随后停止临时 HTTP 服务、浏览器禁网，两车配色和分组操作通过。禁网后重新初始化同一 HTML，已选配色成功恢复；390px 窄屏未横向溢出。**云端 Chromium 直接文件打开被管理员策略拒绝（`ERR_BLOCKED_BY_ADMINISTRATOR`），未修改策略，未声称 file:// 直开通过。** 见 [离线记录](../artifacts/vehicle-interactions-2026-11-07/browser-final/offline-checks.json)。

实际截图：[完整版配色与控件](../artifacts/vehicle-interactions-2026-11-07/browser-final/vehicle-preview-stage-charger-studio.png)、[步骤当前组高亮](../artifacts/vehicle-interactions-2026-11-07/browser-final/vehicle-preview-stage-charger-highlight.png)、[离线版控件](../artifacts/vehicle-interactions-2026-11-07/browser-final/offline-model-golf-studio.png)、[窄屏](../artifacts/vehicle-interactions-2026-11-07/browser-final/offline-mobile.png)。图片仅说明交互与展示，本轮没有改进车体造型或提升装配验证结论。

浏览器全套 **16/16 通过（12.6 分钟）**，包括原有工艺开关/留出验证、两车真实生成、重复生成、五视图、失败保留结果/重试、查询中断恢复、离线示例、窄屏、原格式导入及旧迷你跑车 API。相关检查使用实际构建产物与原生网格，不模拟新增功能接口。

全量单元 **78 文件 / 1033 项全部通过（819.84 秒）**。首次误在禁止监听本地 HTTP 的文件沙箱中启动，因监听限制中止；随后在允许本地端口的环境完整重跑，没有修改测试条件。最终类型检查、构建通过，完整日志保存在 [validation](../artifacts/vehicle-interactions-2026-11-07/validation/unit.log)。

收尾时补充了按实际区域颜色显示“当前色”的提示，最终包位于 `offline-final/`。追加检查一度错误预期两车原始饰件是多色；读取实际实例确认它们均为石墨灰，修正了测试预期，未修改模型数据。该次失败日志也保留。最终构建与 `offline-final` 的两端检查重跑 **2/2 通过（4.1 分钟）**，全部颜色、组操作、保存/重开与断网自包含检查再次通过。最终 HTML SHA256 为 `9e560515fd3fd7e8a983201ebf6c5c760f965947efd1e80017578e36d122b943`。ZIP CRC 与内嵌 HTML 字节一致性核对通过。完整统计见 [验证汇总](../artifacts/vehicle-interactions-2026-11-07/validation/summary.json)。
