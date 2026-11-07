# 两车细分拼搭顺序演示

从实际 HEAD `74c99c0` 接续，本地分支 `codex/vehicle-assembly-sequence`。原始未提交目录仍保留。开始时逐文件记录两份历史证据目录、冻结示例和预算账本的哈希，记录在 [preserved-hashes.json](../artifacts/vehicle-sequence-2026-11-07/preserved-hashes.json)。没有回退、发布、推送或合并。

## 改了什么

在原七个功能组概览之外，新增独立的“拼搭顺序演示（草稿）”。两端共用 `appearance-sequence.ts`、`VehicleSequencePanel`、现有材质和显隐接口。没有重写原生渲染器或更改零件几何。

两款现有模型各得到 88 步，每步新增 1–2 件。Charger 仍是 158 件 / 21 个原生编号，Golf 仍是 160 件 / 15 个原生编号。88 是实际成员及配对后的结果，没有固定步数目标。两车阶段范围与具体成员不同，见各自 [Charger 规划](../artifacts/vehicle-sequence-2026-11-07/charger-sequence.json) 和 [Golf 规划](../artifacts/vehicle-sequence-2026-11-07/golf-sequence.json)。本轮不制作车辆对照。

支持开始、前后步进、进度拖动、播放暂停、0.5–4倍速、阶段跳转、显示全部及退出。当前成员发光，已展示成员正常显示，未来成员隐藏。相机取景始终基于完整模型；切车停止播放。原八色、四预设及配色保存/导入仍保留。

## 顺序依据及证据边界

本轮读取现有完整模型、原生网格、成员用途、原功能分组和保存的模块来源。没有重新读取或声称学会原始整车说明书，没有新增车型研究或视觉调用。

排序先按功能阶段组织，再使用实际原生网格顶点经既有刚体姿态变换后的边界排序。LDraw 的 Y 向下，较低的原生边界优先；空间邻近且用途相同的成员最多两件一组，已有同源局部布局允许作为小组合依据。没有按车型名称返回固定坐标，没有将数字文件行序作为说明书顺序。

展示阶段依次覆盖：底部承托、车身下部、轮拱、侧面腰线、前脸、尾部面板、机盖和前后覆盖、窗柱、窗区、车顶、轮组。车顶较晚出现是为了减少观察遮挡。轮组最后逐件显示，是为了独立展示其未知配合，不代表该时机已获机械验证。

每步记录原成员 ID、编号、原设计色、模块 case/group/local ID 与源色、原生边界、展示前序、理由和未知事项。原外观分组编号不是原说明书页码；`originalInstructionStep` 全部保持 null。

“此前投影邻件”仅是原生包围盒在 XZ 平面的邻近提示，记录有符号竖向间隔。它不是接触、连接、碰撞或支承验证，没有改变原碰撞容差。Charger 有 16 步、Golf 有 13 步包含未找到此前投影邻件的成员，其中包括正常的展示起点；不能把这些数字解释为已经证明的悬空数量。另有 14 / 11 步记录正的竖向包围盒间隔，同样不能直接判定机械可拼或不可拼。具体列表见 [规划发现](../artifacts/vehicle-sequence-2026-11-07/planning-findings.json)。

全部步骤的排序证据均为 `HEURISTIC_NOT_INSTRUCTION_EVIDENCE`，连接 `NOT_VERIFIED`，承托和安装路径 `UNKNOWN`。有候选邻件也不升级资格。没有插入轨迹、飞入动画或伪造连接图。

## 格式、保存和离线包

独立格式 `bricklab-vehicle-sequence-demo-1`，规则 `native-role-spatial-sequence-1`。绑定原模型内容哈希、真实网格哈希和当前配色完整派生草稿。导出包含完整模型与全步骤，不因可见性删除成员。

导入时重新计算完整规划和配色文档，严格比较全部内容；重算 SHA 后改顺序、成员、姿态、原说明书步骤或资格状态仍会拒绝。旧配色格式及基础模型格式保持原样，不静默迁移。完整版资源缓存更新为 `bricklab-sequence-demo-v3`，车型研究缓存键未改。

新 [HTML](../artifacts/vehicle-sequence-2026-11-07/offline/bricklab-sequence-demo.html) 和 [ZIP](../artifacts/vehicle-sequence-2026-11-07/offline/bricklab-sequence-demo.zip) 内嵌两车实际模型、原生网格、图片、脚本及样式。ZIP 还含两份完整默认配色顺序草稿和哈希 manifest。无需 CDN、外部字体、模型服务或后端。离线版明确仅打开已保存结果，不执行新车型生成。操作见 [运行说明](VEHICLE_SEQUENCE_RUNBOOK.md)。

## 保留的限制

Charger 原模型哈希 `a44e1e081684666a408cdca577b564655bd58075bf5fc9519af2083d7ced8fc7`；Golf 原模型哈希 `035cad4a2321f4b56499a9cf2f4a615272796a804d7ab301e95c9d920986e5ab`。

本轮未改比例、造型、零件数量、编号、姿态、`.dat`、接口或碰撞容差。`APPEARANCE_DRAFT`、整车连接 `NOT_VERIFIED`、轮组/稳定性/实物原结论和 `DRAFT_NOT_BUILD_INSTRUCTIONS` 全部保留。局部源模块或五件支撑的有效状态不扩展为新整车装配通过。

没有新增付费调用、训练、微调、预算重置、索要密钥或内部渲染外发。这套顺序帮助课堂理解模型组成，不能保证按顺序完成实物拼搭。

## 验证记录

新增 20 项正负向单元测试通过；全量 **79 文件 / 1053 项通过，802.75 秒**。类型检查与构建通过，仍有既存大型前端 chunk 提示，未扩大到拆包改造。日志见 [全量单元](../artifacts/vehicle-sequence-2026-11-07/validation/unit.log) 与 [构建](../artifacts/vehicle-sequence-2026-11-07/validation/build.log)。

细分顺序的两项真实浏览器测试均通过（9.7 分钟）。完整版两车逐步检查全部 88 帧与阶段，核对实际渲染成员、本步 BOM、累计数量、画布复用和手动缩放后的相机不变；播放暂停、速度、结束状态、退出恢复、切车重置、完整导出导入、重算哈希的乱序篡改拒绝通过。真实保存 API 及全新存储上下文重开通过，原任务字节未改。没有模拟新增功能接口，也没有发出新车型生成请求，见 [完整版记录](../artifacts/vehicle-sequence-2026-11-07/browser/full-workflow.json)。

离线测试首先仅请求 HTML 文件本身，然后停止临时服务并禁网；两车全步骤、配色与导入导出通过。禁网重新初始化同一 HTML 后配色恢复，步骤停止且显示全车；390px 窄屏无横向溢出。**云端 Chromium 的 file:// 打开被管理员策略拒绝（ERR_BLOCKED_BY_ADMINISTRATOR）**，未更改策略，未宣称文件直开通过，见 [离线记录](../artifacts/vehicle-sequence-2026-11-07/browser/offline-workflow.json)。

首次相机测试等待旋转惯性精确收敛超时，[失败记录](../artifacts/vehicle-sequence-2026-11-07/browser/initial-camera-test.log) 保留；后续使用实际手动缩放后的稳定相机检查所有步骤，没有修改相机实现或几何验证条件。

实际图像：[Charger 正常操作界面](../artifacts/vehicle-sequence-2026-11-07/browser/charger-ready.png)、[Charger 当前步骤与清单](../artifacts/vehicle-sequence-2026-11-07/browser/charger-active-step.png)、[Golf 正常操作界面](../artifacts/vehicle-sequence-2026-11-07/browser/golf-ready.png)、[窄屏](../artifacts/vehicle-sequence-2026-11-07/browser/offline-narrow.png)。两车各有早、中、晚及最终模型截图。

自动播放过程分别保存在 [Charger 采样](../artifacts/vehicle-sequence-2026-11-07/browser/charger-playback.html) 与 [Golf 采样](../artifacts/vehicle-sequence-2026-11-07/browser/golf-playback.html)，也可下载 [实际截图与播放记录 ZIP](../artifacts/vehicle-sequence-2026-11-07/sequence-playback-records.zip)。这是实际连续播放的六次截图采样，不是补画或合成；截图期间可能跨越一步，记录了截图前后实际步号范围，不冒充逐帧录像。两个车型分别放在各自目录，不制作车辆对照。

ZIP CRC、所含 HTML 和两份完整草稿字节一致性通过；共享代码与 manifest 绑定一致。120 个历史/模型/预算文件哈希保持不变，详见 [完整性记录](../artifacts/vehicle-sequence-2026-11-07/integrity.json)。四份实际浏览器导出的顺序文档均通过完整模型、BOM、来源和顺序重新绑定，见 [导出记录](../artifacts/vehicle-sequence-2026-11-07/validation/document-bindings.json)。

相关旧流程浏览器回归 **8/8 通过（7.7 分钟）**：八色、四预设、七组概览、真实 API 保存/全新存储重开、篡改拒绝、两车真实缓存生成、重复生成、五视图、失败保留结果和重试、刷新后离线打开、窄屏、异常查询恢复。连同新顺序的 2 项，共 **10 项相关真实浏览器检查通过**。日志见 [回归](../artifacts/vehicle-sequence-2026-11-07/validation/browser-regression.log)，最终统计见 [汇总](../artifacts/vehicle-sequence-2026-11-07/validation/summary.json)。

最终单文件 HTML SHA256：`d31edbb6fd5f8340913e4de62e12ee5b27443559bd327935a266edff1652df3c`。本地 3000 端口预览已启动，实际提供当前构建页面，记录为 [本地预览](../artifacts/vehicle-sequence-2026-11-07/validation/local-preview.json)；这不是用户电脑可直接访问的外网网站。
