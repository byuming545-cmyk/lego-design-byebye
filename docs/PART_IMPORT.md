# 新零件暂存导入合同

本页描述 `codex/part-import` 分支上的受控暂存导入链路。它只读取新的来源包，在临时 overlay 上验证，不修改 `data/parts-foundation` 固定源库，也不自动提升到正式目录。

## 先检查现场

```bash
git status
git log --oneline -8
git branch -vv
git diff --check
```

## 来源包

目录结构：

```text
imports/<partId>/
  bundle.json
  ldraw/parts/<partId>.dat
  ldraw/parts/...            # 真实依赖
  shadow/parts/<partId>.dat
```

`bundle.json` 使用 `bricklab-part-import-bundle-1`，必须声明：

- `partId`、`name`、`author`
- LDraw / LDCad Shadow 的固定 40 位 revision、许可、https 来源根、根文件
- 每个源文件的路径、SHA-256、字节数
- `selectionBasis`、`importBasis`、`reviewer`
- `allowStagingValidation`

校验会拒绝：路径穿越、重复/已存在的 partId、未审许可、非 pin revision、来源 URL 与 revision 不一致、缺失文件、符号链接、大小/数量超限、SHA 或字节数不符。只有几何没有 Shadow 时不会宣称接口可用。

## 运行

```bash
npm run import:part -- --bundle imports/3062b/bundle.json --validate
# 也可写报告
npm run import:part -- --bundle imports/3062b/bundle.json --output artifacts/part-import/report.json
```

CLI 只做暂存验证：读取/校验来源，复制固定源库到临时目录并叠加新文件，复用 `NativePartRepository`、`GrammarAssemblyService`、现有规则、`attachPart`、碰撞和导出/重导入。它不会写回正式 manifest。

报告包含：

- `sourceReady`、几何/连接状态
- 支持/不支持的接口及规则
- 与现有零件的 C01 候选和每次尝试的失败原因
- 姿态、碰撞、装配图有效性
- 生成、JSON 导出、重导入状态
- 清理说明和限制

## 当前边界

- 尝试当前生产规则 C01/BAR_CLIP/PIN_HOLE；按准入能力选择 structural 或显式 exterior-shell。
- 不按名称、外观、半径或零件编号推断接口。
- 只有显式 `collisionClass:'exterior-shell'` 才走表面合同；默认仍是闭合实体 structural。
- 暂存验证不授予正式生产资格；正式提升需要单独、显式执行并记录来源/哈希/许可/模型证据。
- 最终姿态不等于安装路径、保持力、摩擦、形变或实物证据。

## 当前真实状态

本分支已实现合同、overlay、CLI 和 5 个 bundle 负向/暂存测试，但当前环境没有新的真实零件来源包；`raw.githubusercontent.com` 连接被重置。因此本轮没有“新增真实零件”通过验证，也没有执行提升。

## 来源 host 与 base 文件

只接受固定公开来源：

- LDraw: `https://raw.githubusercontent.com/ldraw/ldraw/<40位revision>/`
- LDCad Shadow: `https://raw.githubusercontent.com/RolandMelkert/LDCadShadowLibrary/<40位revision>/`

来源 host 不在白名单、URL 不以 revision 结尾、或 revision 与当前固定库不一致，都会拒绝。

bundle 只能包含**新增文件**。如果某个 `parts/` 或 `p/` 路径已存在于固定 LDraw/Shadow manifest，会被拒绝为 `source-path-already-in-base`，避免用 overlay 覆盖 `p/stud.dat` 之类基础文件。bundle 目录中未声明的文件不会被复制到临时 overlay。

## staging 前置条件

`bundle.json` 必须显式设置：

```json
"allowStagingValidation": true
```

否则直接拒绝 `staging-not-allowed`。

## promote

promote 是独立、显式、默认拒绝的操作：

```bash
npm run import:part -- \
  --bundle imports/3062b/bundle.json \
  --promote --confirm 3062b
```

必须同时满足：

- 本次进程重新验证得到 `status: 'validated'`；
- `--confirm` 与 bundle/report 的 `partId` 完全一致；
- 源文件、许可、revision、SHA 重新校验；
- 目标 `parts/` / `p/` 文件不存在；
- 写入前备份正式 manifest；
- 写入失败时恢复 manifest 并删除已复制文件。

promote 只追加新文件和新 root，不覆盖固定 base 文件，不自动合并 main、不部署。

## 主要错误码

| 错误码 | 含义 |
|---|---|
| `invalid-bundle` | 元数据、路径、revision、URL 或文件列表不合法 |
| `invalid-license` | 未审 LDraw/Shadow 许可 |
| `unapproved-source` | 来源 host 不在项目白名单 |
| `part-already-exists` | partId 已存在于固定 253 根件 |
| `source-path-already-in-base` | bundle 文件会覆盖固定源文件 |
| `source-revision-mismatch` | 来源 revision 与当前固定库不一致 |
| `missing-source-file` | 声明文件缺失或不是普通文件 |
| `source-integrity` | 字节数或 SHA-256 不匹配 |
| `staging-not-allowed` | 未允许暂存验证 |
| `promotion-blocked` | 报告不是 validated |
| `promotion-confirm-mismatch` | confirm 与 report/bundle 不一致 |
| `promotion-revalidation-failed` | 重新验证未通过 |
| `promotion-target-exists` | 正式目标路径已存在，拒绝覆盖 |

## 当前状态

已有 10 个暂存合同/负向/清理测试；真实 bundle 仍为 0，正式 promote 仍为 0。没有真实来源包时，不创建 3062b 的伪造文件，也不宣称新增零件。
