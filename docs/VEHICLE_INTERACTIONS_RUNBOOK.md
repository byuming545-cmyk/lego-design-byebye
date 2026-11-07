# 配色与步骤分组：操作与复现

本轮从实际 HEAD `eb0a38d` 接续，分支 `codex/vehicle-paint-steps`。仅增加交互；两车比例、零件、原生网格和安装姿态保持原样。没有发布、推送或合并。

## 直接使用离线包

下载 [ZIP](../artifacts/vehicle-interactions-2026-11-07/offline-final/bricklab-paint-steps.zip)，解压后用电脑 Chrome 或 Edge 打开其中的 `bricklab-paint-steps.html`。也可单独下载 [HTML](../artifacts/vehicle-interactions-2026-11-07/offline-final/bricklab-paint-steps.html)。全部模型、网格、图片、脚本和样式都在 HTML 内，无需 Node、后端或网络。

1. 点击已有 Charger 或 Golf 卡片，打开真实已保存示例。离线版不生成新车型。
2. 选择“配色区域”，点击八色色块，或选择四组快捷预设。可分别设置车身、车顶、饰条/保险杠、轮拱。玻璃、轮胎、轮毂和灯区保留用途颜色。
3. 拖动模型旋转，滚轮缩放，使用五视图或“重置视角”。切色复用同一画布与网格。
4. 使用“下一步”“上一步”或进度条查看功能组；“播放/暂停”控制自动展示，“显示全部”退出分组展示。当前组发光高亮，先前组正常显示，后续组隐藏，相机按完整模型取景。
5. “保存配色草稿”保存当前浏览器的选择；建议同时“导出配色草稿 JSON”。重开时先选同一车型，再导入这个 JSON。“当前配色 BOM”导出完整清单。

离线配色是独立派生草稿，保留原模型哈希与完整原始文档，不覆盖原模型。步骤显示状态不影响导出零件数量。修改配色后保存/导出，文件仍保留原始验证结论与模块原色。对应实物颜色、库存与供应未验证。

云端管理策略可能阻止 `file://`；不要更改组织策略。若出现管理员阻止，可使用获允许的个人电脑浏览器。交付报告分别记录实际文件打开限制与同一 HTML 的自包含验证范围，未将 HTTP 验收冒充为文件直开通过。

## 完整应用

Node 24.5+；在仓库根目录运行。依赖已安装时跳过 `npm ci`。

```bash
npm ci
npm run build
BRICKLAB_DATA_DIR=data INVENTORY_PROVIDER=mock PREVIEW_PORT=3000 node scripts/preview.mjs
```

在运行服务的同一台电脑访问 `http://localhost:3000/vehicle-generator`。云端机器上的 localhost 不属于用户电脑；本轮没有建立公网隧道。用户无法访问云端预览时直接使用上面的离线包。

完整版保留实际生成流程和原有已保存示例。生成任务上的“保存配色草稿”写入任务下独立 `designs/<SHA256>.json`，地址中的 `design` 参数可重开已保存设计。它会复验原始任务和草稿，但不重新研究车型、不调用模型，也不改写 `job.json`。已保存示例的配色只保存到浏览器或导出文件，界面明确区分。

## 重新制作与验证

```bash
npm run export:vehicle-review -- /tmp/new-vehicle-review
npm run typecheck
npm test -- --maxWorkers=1
npm run build
npx playwright test --config playwright.vehicle-body.config.ts
```

离线导出目录必须尚不存在。导出脚本使用已有 esbuild 与 Python 3 标准库打包 ZIP，不访问网络。`manifest.json` 绑定原模型、共享逻辑文件和 HTML 哈希。

## 演示口径

“我先打开一款已有外观模型。这里可以按功能区域配色，保存后零件和姿态保持一致。下面逐组显示底部、轮组、车身、前后覆盖和座舱。这个功能帮助理解模型组成，并非已验证的实拼说明书。所有完整零件和来源可以导出，尚未确认的连接、轮组配合和实物状态仍保留原结论。”

本轮未调整造型，也不补充车辆对照。保留 `APPEARANCE_DRAFT`、整车连接 `NOT_VERIFIED`、原轮组/稳定性/实物结论和 `DRAFT_NOT_BUILD_INSTRUCTIONS`。
