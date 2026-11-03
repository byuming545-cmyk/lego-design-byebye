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

- 仅尝试当前生产规则（C01；按准入能力选择 structural 或显式 exterior-shell）。
- 不按名称、外观、半径或零件编号推断接口。
- 只有显式 `collisionClass:'exterior-shell'` 才走表面合同；默认仍是闭合实体 structural。
- 暂存验证不授予正式生产资格；正式提升需要单独、显式执行并记录来源/哈希/许可/模型证据。
- 最终姿态不等于安装路径、保持力、摩擦、形变或实物证据。

## 当前真实状态

本分支已实现合同、overlay、CLI 和 5 个 bundle 负向/暂存测试，但当前环境没有新的真实零件来源包；`raw.githubusercontent.com` 连接被重置。因此本轮没有“新增真实零件”通过验证，也没有执行提升。
