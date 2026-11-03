# 新零件暂存导入：硬化报告

## 结论

本轮完成了 fixed-side exterior-shell、structural/exterior 尝试回退、可注入源库根、事务性 promote（锁/journal/原子 manifest/ledger/崩溃恢复），并补了正向事务、回滚和固定端 class 测试。

但当前没有可用的真实新零件来源包。因此：

- 真实 bundle 验证：0
- 正式 promote：0
- 新增真实生产零件：0
- 固定 253 根件统计未改变

## 本轮代码

- `src/parts/import/bundle.ts`：批准 host、base 路径拒绝、只复制声明文件、`allowStagingValidation`、可注入 LDraw/Shadow 根。
- `src/parts/import/transaction.ts`：锁、journal、manifest 备份、原子写/readback、ledger、回滚、崩溃恢复。
- `src/parts/import/service.ts`：C01/BAR_CLIP/PIN_HOLE 候选、moving/fixed 两种方向、structural 失败后 exterior 回退、事务 promote、post-promote before/after 运行时审计（根件、计数、来源、阻塞原因、新零件 admission）和 JSON 审计产物。
- `src/parts/assembly/{types,service,engine}.ts`、`src/parts/api.ts`：`fixedCollisionClass` 透传；根 placement 保存 class；默认 structural。
- `tests/parts-part-import.test.ts`：10 个 bundle/staging/promote 测试。
- `tests/parts-part-import-transaction.test.ts`：5 个提交/目标存在/回滚/崩溃恢复/ledger-after-verify 测试。
- `tests/parts-assembly-fixed-class.test.ts`：3 个 fixed exterior root、structural 默认、fixed exterior + moving structural 测试。

## 实际执行

- `npm run typecheck`：通过
- `npm test -- --maxWorkers=2`：**802/802 passed，58 files，112.30 s**
- `npm run build`：通过
- 真实 bundle：0；真实 promote：0

## Promote 语义

- 只允许 validated report + confirm 匹配 + 重新验证通过。
- 目标已存在、lock 占用、journal/readback/ledger 失败都会拒绝或回滚。
- promote 后做 repository/grammar admission reload、before/after 运行时审计并写 ledger/JSON；完整 connector audit/coverage/report 文件重建未自动执行。

## 真实 3062b 状态

未获得 LDraw + LDCad Shadow 的真实来源包（host/revision/SHA/许可/作者齐全），因此没有导入、没有生成真实模型、没有 promote。当前 `raw.githubusercontent.com` 连接重置，记录见 `fetch-attempts.json`。

## 本地提交

代码提交 `062c49e fix: harden part import audit and exterior soundness`（基线 `6825b4c`）；本报告在随后的小提交中记录该哈希。

## 边界

未修改 `data/parts-foundation` 原始文件；未把阻塞件批量标为 exterior；未按零件编号建规则；未删除碰撞、准入、接口或图检查；未推送、合并或部署。

## 未验证

- 真实 bundle 的正向 validate/promote 证据。
- post-promote 全量 connector audit/coverage/report 文件重建（运行时审计已实现）。
- exterior root 的生产生成模块。
- 安装路径、保持力、摩擦、形变、实物。
