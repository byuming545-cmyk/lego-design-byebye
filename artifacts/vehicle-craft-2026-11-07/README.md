# 本地工艺检索与实际生成证据

基线 a9a6f1d，当前分支 codex/vehicle-design-cases。权重更新、付费调用和内部渲染外发均为 0。来源是已保存的许可明确第三方数字重建，未读取原 PDF。

- [完整交付](../../docs/VEHICLE_CRAFT_DELIVERY.md)
- [交互五视图对照](comparison.html)
- [最终验证](validation.json)、[视觉审查及不足](visual-review.json)
- [定稿案例库](round-2/corpus.json)、[训练候选，非已训练模型](round-2/training-candidates.jsonl)
- [套装来源留出](round-2/source-group-holdouts.json)
- [实际源三角形量测](actual-surface-profiles.json)
- [父片段缺口审计](source-gap-audit.json)、[数字源 STEP 局部分组观察](source-step-observations.json)

基线、round-1、round-2 均保存模型、BOM及实际五视图。round-2 保持首轮几何，补齐署名/版本绑定并验证标准流程。diagnostics/ 保留绑定草稿、初次浏览器/类型检查失败，不当作通过，也不计为独立训练样本。

工艺库六配方只代表四个保守设计家族、两个来源；其中三家族通过内部数字检查，最终采用两家族。四次重复的前缘组合仍是同一家族。完整动作顺序未知；源数字 STEP 分组不等于官方说明书或实拼安装路径。

全量75文件/1000测试、当前核心39测试、浏览器8测试、构建和类型检查通过。日志：unit-tests.log、focused-tests.log、browser.log、build.log。reopen.log 验证当前来源绑定重开，render-manifest.json 将40张轮次/对照五视图绑定到实际导出的模型与几何哈希。

完整汽车保持外观草稿：全图占用、整车连接、轮组和实物未知；正式轮组 fresh run 仍 blocked，独立五件支撑重导入 VALID。没有发布、推送或合并。
