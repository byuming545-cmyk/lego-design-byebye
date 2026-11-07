# 两车课堂演示：启动与复现

本地分支 codex/two-car-presentation；从 e680c95 接续。没有发布、推送或合并。

## 启动

在仓库根目录，使用 Node 24.5 或更新版本。已有 node_modules 时不必重新安装。

```bash
npm ci
npm run build
BRICKLAB_DATA_DIR=data INVENTORY_PROVIDER=mock PREVIEW_PORT=3000 node scripts/preview.mjs
```

`INVENTORY_PROVIDER=mock` 只隔离旧库存入口；车辆生成、原生零件和装配检查使用实际本地实现，没有模拟车辆API。

打开 `http://localhost:3000/vehicle-generator`。云环境通过预览面板选择 3000 端口。这是本地预览，不是发布环境。

开发模式可以运行 `npm run dev`，打开 5173。完整离线刷新只在编译后的同源页面验证；开发模式不注册离线缓存。

## 汇报前准备

1. 用将要汇报的浏览器打开页面，确认两个卡片封面都正常显示。
2. 等侧栏显示“离线示例已准备”。这会缓存本页、已加载的本地脚本/样式/字体和两款冻结示例。首次准备需要本地服务在线。
3. 分别点两张卡片的“生成这款车”，等待模型完成，切到侧面和斜侧，再点“保存当前任务”。这会实际运行共同生成器，复用本地资料，不调用收费服务。
4. 点两张卡片的“打开已保存示例”，确认冻结结果可显示。它们明确标为“已保存示例 · 本次未重新生成”。
5. 在浏览器离线模式下刷新示例页面并切换到另一款车。首次离线缓存未完成、浏览器清空了站点数据、换浏览器或换地址时，需要重新在线准备。

浏览器离线开关只用于演练。实际重新生成需要本地 Node 服务；没有服务时打开冻结示例。不能把备用入口描述成刚刚完成生成。

## 正常演示

卡片生成 Charger → 看真实阶段 → 旋转/侧面 → 生成 Golf → 比较短机盖、高座舱、短尾 → 展开“本次使用的拼搭工艺” → 展开来源和验证范围。

生成过程中保留上次结果，并明确标注。不要把旧模型当作新任务已完成。重复提交被阻止；任务失败时上次结果保留，可以重试。查询连续失败时后台状态仍未知，页面提供恢复查询或备用示例，不假装任务已经取消。

Charger 复用此前真实千问照片分析。Golf 使用可追溯的本地照片审阅估计，参考照片属于 1979/1982 的 Mk1 车身，精确 1976 配置未确认。两者来源方式在界面和导出中分别记录。

## 重新导出证据

```bash
# 必须是新目录；先保存侧面/俯视布局，随后实际调用 VehicleService
npm run evidence:vehicle-presentation -- /tmp/new-two-car-evidence
# 仅在有意刷新本轮新建的冻结示例时使用 --examples；历史 artifacts 不会被迁移
npm run evidence:vehicle-presentation -- /tmp/new-two-car-examples --examples
npm run typecheck
npm test -- --maxWorkers=1
npm run build
VEHICLE_BODY_BROWSER_DATA_DIR=/tmp/new-presentation-browser npx playwright test --config playwright.vehicle-body.config.ts
```

`--examples` 更新 public 中的两款当前示例；若有意更换示例，需重新生成对应的真实封面及 `offline-files.json` 的文件哈希，再构建并重新准备浏览器缓存。源输入发生变化时，必须审查来源、更新输入 manifest 与代码中的 pin；文件被改坏不会自动联网补齐。

## 备用与边界

- 模型 JSON 和 BOM 可以导出；草稿步骤不是可实拼说明书。
- 冻结示例在浏览器检查模型内容、原生网格哈希、刚体姿态与基本 BOM 一致性。它不是离线运行完整原生装配引擎。
- 当前引擎重新打开任务时严格复验；旧 schema 或旧生成语义不会被静默改写。e680c95 基线与第一轮模型保留在 artifacts。
- 整车连接、轮组配合、插入轨迹和实物稳定性没有通过。独立五件支撑有效不代表整车有效。
- 工艺库仅两个来源、四个设计家族；不承诺任意车型生成质量，也没有完成模型训练。
