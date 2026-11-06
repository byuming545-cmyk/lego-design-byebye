# 2026-11-07（Asia/Shanghai）车辆主线恢复审计

## 恢复证据

当前机器最初检出 `137bd4037323a2027d109e3f9e543a857d93ebaa`。完整搜索 `/workspace` 未找到 `/workspace/lego-import-collision` 或四份指定 bundle；`git fsck --no-reflogs --unreachable` 未发现目标提交。对远端所有 heads 实际列举、fetch 后，最完整车辆相关分支为 `codex/mini-car-appearance`，SHA `2bb4dff3ee41e4be683eb9995e334392cd0fbaa3`。精确 fetch `806c777bf70fc1e8d3ea7f0d5632d3778a5968ab` 返回 `not our ref`。这些结果仅证明本机及当前远端可访问范围内不可恢复，不证明旧云机器的数据已删除。

新分支 `codex/vehicle-platform-recovery` 从 `2bb4dff` 开始，24 个相对于 main 的既有提交完整保留。未 reset、强推或删除旧目录，未触碰 `data/interface-library/studio-examples.json`。没有恢复 `314c13f`、`9eea42d`、`b782b70`、`4f84615`、`806c777`。

## 差距与复用

| 范围 | 实际远端版本 | 本轮处理 |
|---|---|---|
| 真实零件 | 255 根件、原始几何及 Shadow、语法与碰撞内核 | 原样复用，无新增资格、无修改原始字节 |
| 迷你车 | 既有独立外观生成、渲染、存储、BOM | 保留；没有声称恢复 314c13f 的 25 种用件扩展 |
| SP2 | 缺少未推送的参考生成代码 | 未重建，不优化 SP2 |
| 研究平台 | 缺失 | 重新实现通用 Wikipedia/Commons 研究、许可/哈希/原始响应、年份范围与冲突保留 |
| 视觉 | 缺失 | 重新实现固定北京/新加坡 DashScope、显式 OpenAI、4000 输出 token、非思考 JSON、严格本地合同、预算预留与缓存 |
| 任务与页面 | 缺失 | 新首页和 `/vehicle-generator`、202 创建/轮询、持久化阶段、错误与中断记录，无手动上传入口 |
| 正式局部结构 | 既有旧服务的 migration 版本失效，生产准入为 0 | 车辆桥接直接复用既有 `assessGrammarAdmission` 和生产 AttachmentEngine，不采用陈旧 pair fixture PASS，不放宽任何规则 |
| 设计目标 | 缺失 | 视觉区间到通用比例和单位合同；缺证据时明确停止 |
| 整车规划、轮组、稳定性、有界整车修复、完整说明书 | 未完成 | 仍未完成；不能将局部支撑或设计目标称为完整 Charger |

## 验证边界

联网尺寸为 Wikipedia 明示年份范围内的代际车身数据，不是厂商精确 R/T 参数认证。Commons 标题/元数据只产生候选；作者、许可、下载字节哈希及原页面保留。图片可能仍是其他版本，必须由视觉阶段排除；仅标题筛选不授予身份确认。图片原字节在忽略的 `data/vehicle-recovery/` 下，Git 报告只存元数据与来源文本；Wikipedia 文本按其 CC BY-SA 条款，固定 revision URL 与页面历史保留归属，图片分别遵循记录的许可。

首次实验发现 Wikipedia 多代际信息框混用和官方 `thumb.wikimedia.org` 新域名，均修正后重测。Charger/Camaro 共用解析器；后续严格版本标题筛选可能减少候选，按最终报告分别记录，不用早期宽松候选数冒充版本确认。

早期 `charger-task.json` 如记录旧 migration 准入阻止，是本轮真实失败证据，后续 `native-support.json` 单独记录使用既有接口语法路径的结果。没有编辑旧证据使其通过。

真实视觉调用尚需当前环境绑定 `DASHSCOPE_API_KEY`。仅保存了该缺失要求到草稿，未发布环境、未改写此前安装/启动脚本。默认三个预算都是 0，不会调用；一次测试应设置 MAX_REQUESTS_PER_DAY=1、DAILY_BUDGET_MICRO_USD 与 RESERVE_MICRO_USD 为同一明确预留金额，并且不得自动重试。预留不是供应商账单硬封顶，供应商价格未核定，实际 usage 与模型别名必须单独记录。无凭证、预算、足够图片时停止；本轮模拟 Provider 合同测试不计真实视觉次数。


## 本轮最终结果

- 构建（含类型检查、Vite、服务端编译）通过，仅资源体积提示。
- 完整回归：71 文件、958 项通过，0 失败；另新增 3 项并发/公共缓存/429 回归通过。新增模块专项合计 23 项通过（其中 20 项与完整回归重叠）。
- 浏览器 3 项通过；前两项状态流使用受控响应，第三项使用本轮真实保存的局部模型、当前来源复验、原生渲染与导出。
- Charger 最终任务：4 项适用年份的代际车身尺寸、6 张 R/T 标题候选图片；真实视觉调用 0，明确 `VISION_CREDENTIAL_MISSING`；计划阶段跳过，没有生成虚构设计约束。
- 当前语法路径生成 1×3028 + 4×3024，5 个放置、5 个步骤，重导入 `VALID`。导出模型与三维截图均保存，仍不是整车。
- 实测 `wheel-module` 保持 BLOCKED，8 类具体原因见 `wheel-blocker.json`，未用容差、封壳或全件豁免通过样例。
- 最初完整测试在开发中新增导出时产生 1 个模块缓存错误（955 通过、1 失败）；保留原日志，后续重新运行全量通过，未删减断言。

证据目录：`artifacts/vehicle-recovery/`，其中 `validation.json`、`summary.json`、`charger-task-final.json`、`native-support.json` 及原始命令日志分别说明范围。没有借用旧环境的 1026 项历史结果。最终代码分支为 `codex/vehicle-platform-recovery`；实际推送后的 SHA 以本次交付消息和远端分支为准，文档不制造自引用提交哈希。
