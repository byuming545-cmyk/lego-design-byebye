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

`bundle.json` 使用 `bricklab-part-import-bundle-1`，必须声明 `partId`、`name`、`author`、LDraw/LDCad Shadow 固定 40 位 revision、许可、https 来源根、根文件、每个文件路径/SHA-256/字节数、`selectionBasis`、`importBasis`、`reviewer`、`allowStagingValidation`。

校验会拒绝：路径穿越、重复/已存在 partId、未审许可、非 pin revision、来源 URL 与 revision 不一致、未批准 host、缺失文件、符号链接、大小/数量超限、SHA 或字节数不符、覆盖 base 文件。只有几何没有 Shadow 时不会宣称接口可用。

## 运行

```bash
npm run import:part -- --bundle imports/3062b/bundle.json --validate
npm run import:part -- --bundle imports/3062b/bundle.json --output artifacts/part-import/report.json
```

暂存验证会读取/校验来源，复制固定源库到临时目录并叠加新文件，复用 `NativePartRepository`、`GrammarAssemblyService`、现有规则、`attachPart`、碰撞、图验证、生成/导出/重导入。它不会写回正式 manifest。

## 候选搜索

- 尝试当前声明规则 C01/BAR_CLIP/PIN_HOLE。
- 新零件先作为 moving；structural 失败后按 admission 尝试 exterior-shell。
- 新零件也可以作为 fixed root；fixed 的 `fixedCollisionClass` 会进入根 placement。当前没有“exterior root + 普通 moving”的生产生成模块，因此此类 candidate 只可做 attach/图验证，报告会标 `fixed-exterior-generation-unsupported`，不会算 validated。
- 每个 candidate 记录 class、规则、接受/拒绝、图有效、生成、导出和重导入。
- 不按名称、外观、半径或零件编号推断接口。

## promote

```bash
npm run import:part -- --bundle imports/3062b/bundle.json --promote --confirm 3062b
```

promote 必须重新验证为 `validated`、confirm 一致、源文件/SHA/license/revision 重校、目标文件不存在。实现采用：

- `<ldrawRoot>/.import.lock` 单进程锁；崩溃遗留锁在 PID 不存在时可回收。
- `<ldrawRoot>/.import-journal/<uuid>/` 持久 journal：manifest 备份、目标文件列表、状态 `prepared/copying/committed`。
- 只复制 bundle 声明的文件；manifest 和 ledger 先写临时文件、`fsync`、原子 `rename`，再 readback。
- 成功写 `<ldrawRoot>/imports/<partId>.json` ledger；失败恢复备份、删除已复制文件和 ledger。
- 启动/下一次 promote 前扫描未完成 journal：未提交则恢复，已提交则清理。

post-promote 在事务 verify 中重新加载 `NativePartRepository`、重建 `GrammarAssemblyService`，计算 promote 前后的总根件/结构计数/来源计数/阻塞原因/exterior 计数和新零件 admission，并将 `{before,after}` 写入 ledger 和 `artifacts/part-import/<partId>-post-promote.json`。只有根件数 = 旧数 + 1、新零件 source-ready、且 structural 或 exterior 至少一种可生产时，ledger 才会提交；失败会回滚。该审计是运行时 audit，不是完整 connector parse/coverage/report 文件重生成；完整派生报告仍需另跑项目命令，旧模型也不会自动重新认证。

## 错误码

`invalid-bundle`、`invalid-license`、`unapproved-source`、`part-already-exists`、`source-path-already-in-base`、`source-revision-mismatch`、`missing-source-file`、`source-integrity`、`staging-not-allowed`、`promotion-blocked`、`promotion-confirm-mismatch`、`promotion-revalidation-failed`、`promotion-target-exists`、`import-lock-held`、`post-promote-rebuild-failed`。

## 当前状态

- 18 个新增/相关测试：10 bundle/staging/promote 负向与清理、5 transactional promote/rollback/journal/ledger、3 fixed-class；exterior soundness 回归 6 个。
- 最近一次完整套件：802/802 tests，58 files，112.30 s；typecheck/build 通过。
- 真实 bundle：0；正式 promote：0；新增真实零件：0。
- 固定 253 根件、structural 104 generatable、exteriorGeneratable 128 的既有统计未改变。

没有真实来源包时，不创建 3062b 的伪造 .dat/Shadow/哈希/接口，不写“已验证”，不执行 promote。

## 真实来源拉取记录（2026-11-03）

- `3062b` 不在固定 LDraw 数据中。
- 对已批准 LDraw raw URL 的一次 `curl` 返回 `curl: (35) Recv failure: Connection reset by peer`；一次 `web_fetch` 返回 `TypeError: fetch failed`。
- 未重试、未绕过访问控制、未伪造文件；`.import-cache/3062b` 为空。记录见 `artifacts/part-import/fetch-attempts.json`。

## 未验证/限制

- 没有真实正向 bundle，暂存 `validated -> promote` 的真实来源证据仍为 0。
- post-promote 只做仓库/admission reload，不是完整审计。
- exterior root 的生产生成模块尚不存在；fixed-exterior 只能 attach/图验证。
- 路径、保持力、摩擦、形变、实物验证不在本链路。
