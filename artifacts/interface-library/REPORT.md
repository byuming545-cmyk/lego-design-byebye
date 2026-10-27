# 接口与拼接库交付报告

## 结论

已在现有正式接口/规则/装配引擎之上交付可操作的“接口与拼接库”，入口为 `/#/interface-library`。页面读取 253 个真实根零件的 5,085 条来源接口，显示 25 个接口类型、15 条规则、3 条正式生产规则和 4 个真实案例。所有案例来自正式引擎；比较不会授予生成准入；人工反馈持久化但不改变软件验证。

## 交付范围

- 统一数据模型：`src/parts/library/types.ts`
- 持久化反馈：`src/parts/library/feedback.ts`
- 聚合/案例/比较服务：`src/parts/library/interfaceLibrary.ts`
- HTTP API：`src/parts/library/api.ts`，挂载 `/api/interface-library`
- 页面：`src/pages/InterfaceLibrary.tsx`、`src/pages/interface-library.css`
- 3D：`NativePartViewer` 新增聚焦、全零件、透明、Z 剖面、坐标轴；复用 `NativeAssemblyViewer`
- App 路由/导航：`/#/interface-library`
- 测试：`tests/parts-interface-library.test.ts`（5 项）

## 真实数据

- 零件：253
- 接口实例：5,085
- 接口类型：25
- 规则：15，其中正式生产 3（C01、BAR_CLIP、PIN_HOLE）
- 生产接口：2,545
- 来源就绪：1,912 / 部分：628
- 案例：4（3 已验证，1 真实阻止）
- 复核队列：800 条上限；缺少来源 0、解析不完整 267 等
- 人工反馈：持久化到 `<data>/interface-library/feedback.json`

## 案例

| 案例 | 状态 | 说明 |
| --- | --- | --- |
| 3024 → 3070b | 已验证 | C01；正式 attach，clear |
| 30374 → 48729b | 已验证 | BAR_CLIP；正式生成/导出/重导入 VALID |
| 3673 → 32000 | 已验证 | PIN_HOLE；正式生成/导出/重导入 VALID |
| 30374 → 60470b | 已阻止 | 真实 seat 外碰撞；保留拒绝原因，不展示成功 |

所有案例 `physicalBuildVerified:false`；开壳 seat 证明不是闭合实体认证。

## 对比

`POST /api/interface-library/compare` 使用：

1. 真实接口实例与来源身份；
2. `CONNECTOR_GRAMMAR_RULES` / `evaluateConnectorCompatibility`；
3. `checkConnectionCompatibility` 与 `solveAttachment`；
4. 双侧 `generatable` 时调用正式 `assembly.attach`。

输出 `exact/candidate/conflict/insufficient`，并分别记录类型识别、规则匹配、正式装配与 `generationAdmission:false`。名称、外观、半径相似不作为资格。

## 反馈

支持五类观察：看起来合理、位置/方向可能不对、接口识别可能不对、不应这样拼接、证据不足。记录版本、来源摘要、原始软件结论、处理状态和历史；可刷新/重启后重新打开。反馈不授予生产权限；已有规则被质疑时会标记 `review-required` 并显示未关闭数量，同时保留历史，而不是自动撤销；撤销仍需单独权限流程。附件仅支持来源链接，页面明确不提供二进制上传。

## 验证

- `npm run typecheck`：通过
- `npm test -- --maxWorkers=2`：**774/774，54 个文件，65.63 s**（日志 `unit-final.txt`）
- `npm run build`：通过（日志 `build.txt`）（Vite chunk-size warning）
- 浏览器：Chromium 1248，桌面 1440×1100 与移动 390×844；控制台 0 错误
- 截图：`overview.png`、`interface-detail.png`、`interface-feedback.png`、`rule-detail.png`、`case-detail.png`、`compare.png`、`review.png`、`mobile-overview.png`
- E2E：本轮未运行完整 Playwright 套件；使用独立截图脚本验证页面可操作

## 限制

- 正式生产仍只有 C01、BAR_CLIP、PIN_HOLE；其余规则显示为条件规则，不会自动开放。
- 没有来源明确的新接口实例不会因名称或半径被推断。
- 案例姿态不是安装轨迹；开壳 seat 证明弱于闭合实体碰撞。
- 服务端队列上限 800；完整数据通过筛选/搜索访问。
- 历史 migration 账本仍是 87/166 的旧证明；当前运行时为 104/149，页面案例按当前运行时重新计算。
