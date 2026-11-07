# 拼搭顺序演示（草稿）：操作与复现

本轮从 `74c99c0` 接续，本地分支 `codex/vehicle-assembly-sequence`。只增加展示规划和交互，保留两车原模型、零件、姿态和配色功能。

## 离线使用

下载 [ZIP](../artifacts/vehicle-sequence-2026-11-07/offline/bricklab-sequence-demo.zip)，解压后使用电脑 Chrome 或 Edge 打开 `bricklab-sequence-demo.html`。也可以单独下载 [HTML](../artifacts/vehicle-sequence-2026-11-07/offline/bricklab-sequence-demo.html)。无需后端、密钥或网络。

1. 选择 Charger 或 Golf 已保存模型。这里不执行新车型生成。
2. 按需设置配色，车身、车顶、饰件和轮拱可分别选择；玻璃、轮胎、轮毂和灯区保留用途颜色。
3. 在模型下方切换“拼搭顺序演示（草稿）”，点击“开始演示”。每步新增 1–2 件实际零件。
4. 使用上一步、下一步或进度条，查看本步编号、设计颜色、数量、用途和累计件数。当前成员发光，先前成员正常显示，后续隐藏。
5. 使用“播放/暂停”和 0.5×、1×、2×、4×速度。课堂演示可用 4×，也可跳转到车身、覆盖、窗区等实际阶段。相机不会逐步自动取景，可自行旋转、缩放和切换五视图。
6. “显示全部”或“退出演示”恢复全车及当前配色。切换车型会停止播放，回到默认功能概览。
7. “导出演示顺序 JSON”保留完整模型、当前配色、全部成员、顺序依据和未知状态。先打开同一车型，再“导入演示顺序 JSON”，重开后显示全车并停止播放。

ZIP 内的 `charger-sequence.json` 与 `golf-sequence.json` 是完整默认配色演示草稿，可在相应车型中导入。原“导出配色草稿 JSON”和“当前配色 BOM”也始终导出全模型，不受隐藏步骤影响。浏览器保存和真实任务保存保留配色；播放位置不当成模型数据保存。

## 汇报口径

“这里展示两款已有积木汽车从底部到完整外观的建议顺序。每一步都对应实际模型里的零件，可以查看编号、颜色和数量。顺序根据功能和原生几何位置规划，复用模块保留来源，但没有原整车说明书的装配顺序证据。轮胎与轮毂最后逐件展示，配合和底盘安装仍未知。这是帮助理解模型组成的演示草稿，不能保证照着它就能实拼。”

无需完整播放两车的 88 步。可以先播放底部与侧面，再跳到前后覆盖、窗区和车顶，最后展示轮组未知说明。两车没有进行造型或比例调整。

## 开发者复现

Node 24.5+，已有依赖时不必重新安装；离线导出 ZIP 使用 Python 3 标准库。

```bash
npm run typecheck
npm test -- --maxWorkers=1
npm run build
BRICKLAB_DATA_DIR=data INVENTORY_PROVIDER=mock PREVIEW_PORT=3000 node scripts/preview.mjs
```

在运行服务的同一台电脑打开 `http://localhost:3000/vehicle-generator`。云端 localhost 不属于用户电脑；本轮不创建公网隧道。无法使用云端预览时直接使用离线包。

```bash
# 输出目录必须尚不存在；不会改写历史包
npm run export:vehicle-review -- /tmp/new-sequence-review
# 构建后运行实际浏览器，使用真实本地API与原生网格
npx playwright test --config playwright.vehicle-body.config.ts
```

运行环境若禁止本地 HTTP 监听，应在允许本地端口的执行环境运行相关测试，不能删减验证。云端浏览器若按管理员策略阻止 `file://`，记录限制，在允许的本地方式加载同一 HTML 后停止服务并禁网检查，不修改策略，也不将其称为文件直开通过。

所有排序、邻近提示与可视化状态都不授予装配资格。保留 `APPEARANCE_DRAFT`、`NOT_VERIFIED`、`UNKNOWN` 和 `DRAFT_NOT_BUILD_INSTRUCTIONS`。
