# 迷你跑车：完整外观模型与验证

基准 `3cbf8ac`，工作分支 `codex/mini-car-appearance`。完整说明见 [交付报告](../../docs/MINI_CARS_DELIVERY.md)。

入口 `/mini-cars`，导航“迷你跑车”。独立 API `/api/mini-cars`，独立外观格式及保存空间。普通黑色砖/斜坡表达窗区，真实轮组仅外观定位。没有正式装配或实物通过声明。

- `models/`：四个完整外观样例；每例包含 JSON、BOM、来源、重开模型和验证结果。
- `generation-results.json`：件数、布局、来源、四轮、三角面、当前资格和原始来源保留。
- `screenshots/`：实际网页的斜侧、侧面、俯视、手机预览与对应 HTTP 模型。
- `experiments/initial-side-gaps.png`：早期侧向缺口，当前侧板已修复；不是最终交付外形。
- `logs/`、`unit-results.json`：本轮实跑；完整命令、结果、日志哈希及证明边界见 [verification.json](verification.json)。
- `baseline.json`：实际工作基准、远端检查和保护范围；`references.json`：既有组件及来源复用记录。
- `gallery.json`：四个编译后网页样例与保存模型 ID 一致，页面错误列表为空。

四个样例分别为 68 件红色短轴、79 件蓝色长轴、65 件白色无尾翼、79 件黄色长轴。全车实际覆盖 15 个既有原生身份。没有新增来源零件、正式资格或整车装配证书。

来源许可、逐文件署名和哈希保存在每个模型的 sources。几何使用现有 LDraw 固定库，未新增第三方代码或数据依赖。用户图片仅供轮廓方向参考，不冒充原视频结构的完整重建。

复现：`npm run evidence:mini-cars`；实际网站使用 `npm run preview`，同机访问 `http://localhost:3000/mini-cars`。开发地址为 `http://localhost:5173/mini-cars`。

## 本轮实际验证

| 检查 | 结果 |
|---|---|
| 针对性单元/API | 35/35 |
| 最终全量单元 | 69 个文件，938/938，0 跳过 |
| 浏览器全量 | 21/21 |
| 最后保存保护更新后的迷你页复测 | 2/2 |
| 编译预览 | 8/8 |
| 类型检查与构建 | 通过 |
| 生成、保存重开、旧正式导入拒绝 | 4/4 |

初次类型检查和初次全量的保存冲突断言失败记录保留在 `typecheck-initial.log`、`unit-initial.log` 和 `unit-initial-results.json`。最终运行通过，不删除断言或跳过失败用例。全部状态仍是外观草稿，不是实体碰撞、轮组机械或实物认证。

实际页面：[桌面工作区](screenshots/workspace-desktop.png)、[侧面](screenshots/sprint-side.png)、[俯视](screenshots/sprint-top.png)、[手机](screenshots/gt-mobile.png)。四个编译后方案：[红色短轴](screenshots/sprint-red-gallery.png)、[蓝色长轴](screenshots/gt-blue-gallery.png)、[白色无翼](screenshots/sprint-white-no-wing-gallery.png)、[黄色长轴](screenshots/gt-yellow-gallery.png)。
