# Astra Handoff Pack

每个案例绑定当前四版本及实际源哈希。所有预期物理结果保留 EXPECTED_UNKNOWN；诊断输出不授予生产生成资格。

运行 `npm run astra:case -- CASE_ID`，例如 `npm run astra:case -- WHEEL-TYRE`；附加 `--debug` 可导出原生调试场景。退出 0 表示重现记录的问题，2 表示当前结果与记录不同。源版本或文件变化会拒绝复用旧案例。

映射案例按同一外部 part/design/状态归组，保留全部受影响 Element。接口案例列出关联的物理接口，direct-test 与 review-dependency 以迁移报告为准，不把共享前置阻塞说成已通过实际插接测试。

优先级：1. MULTI-3020-3710 的多点纵向加强碰撞；2. WHEEL-TYRE / WHEEL-HOLDER 的有来源配合规则；3. 映射冲突和普通解析缺证。不要按名称、相同编号或期望造几何/机械公差。
