# 延期接口补测与可恢复验证

本轮重新验证当前全部 245 个原生根的来源规格接口，不把 V0.5 的 PASS 换版本后直接沿用。V0.5 基线为 4,694 条展开后的来源记录、4,632 个按位置／方向／规格去重的物理接口组，其中 987 组 PASS、2,667 组 BLOCKED、978 组延期。原来开放的 1,001 个来源编号不能直接当成 1,001 个不同物理接口。

```sh
npm run verify:interfaces
```

完整命令使用 `src/cli/assembly-deferred.ts`。默认两个隔离 worker、每批 8 个接口、单接口 8 秒外部时钟预算、每件 60 秒调度预算、失败允许重试一次。调度预算在完整批次之间检查；不会为赶时间跳过一次正在进行的合法装配检查。同步几何计算超过接口预算时，父进程终止该 worker，不会让事件循环中的普通计时器失去作用。

每个结果原子写入系统临时目录下的 `bricklab-v06-interface-checkpoints`，再次运行同一命令会恢复与当前验证上下文完全相符的终态结果。上下文包含几何数据哈希、解析后的连接元数据哈希、双方原生来源闭包、标准测试件集合哈希、四个模型依赖版本和 `INTERFACE_TEST_VERSION`。

可选参数：

| 参数 | 含义 |
| --- | --- |
| `--checkpoint-dir PATH` | 指定检查点目录 |
| `--concurrency 1` | 并行 worker 数，范围 1–4 |
| `--batch-size 8` | 批次大小，范围 1–32 |
| `--timeout-ms 8000` | 单接口外部时间预算 |
| `--part-budget-ms 60000` | 每件调度预算；0 关闭该层预算，单接口超时仍保留 |
| `--max-retries 1` | 失败重试上限，范围 0–3 |
| `--retry-failed` | 重试之前的 BLOCKED / REQUIRES_ASTRA_REVIEW；有效 PASS 仍可恢复 |
| `--part 3005,3024` | 只保存指定真实根的检查点，不发布不完整的生产迁移报告 |

独立诊断代码还可传 `physicalInterfaceIds` 精确选择单个来源接口组。未知或重复的接口 ID 会拒绝，不会转成占位连接。Astra 复现使用独立临时检查点，不修改生产准入。

## 结果与计数

- `PASS`：真实源和 fixture 完成兼容、变换、反向、碰撞、非法重叠、旋转、连接图及统一装配路径验证。
- `BLOCKED`：有明确的常规证据或前置条件阻塞，保持禁用。
- `REQUIRES_ASTRA_REVIEW`：复杂几何、特殊配合或有界测试无法可靠作出结论，保持禁用。
- `PENDING`：仅在测试被明确中断时保留。

`verifiedCoveragePercent = PASS / discovered`；`processedCoveragePercent = (PASS + BLOCKED + REQUIRES_ASTRA_REVIEW) / discovered`。没有分母时为 `null`。处理完成率不能当成装配通过率。

每个结果还区分 `direct-test`、`shared-source-precondition` 和 `review-dependency`。同件所有接口都受同一未解析来源或无法建立实体代理的前置条件阻塞时，可以共享该源证据；同一规格和轴向已有两次真实隔离超时，或调度预算用尽时，剩余接口可转入明确的复审依赖。未直接测试的口不会声称发生了物理碰撞，更不会得到 PASS。

`fullyAssemblyVerified` 要求当前所有可识别来源规格接口均 PASS；`partiallyGeneratable` 表示已有 PASS 但未全部 PASS；`interfaceVerificationComplete` 只说明每个接口都有终态，可能仍含 BLOCKED / Astra 项目。共位置的不同规格保持独立验证，不互借证据。连接图为防重复占用而采用更保守的位置键；其占用位置组数不是本表的覆盖率分母。

## 输出

完整执行保留全部 245 件记录，并原子发布 `data/parts-foundation/assembly/migration.json`。完整接口证据为 `artifacts/assembly-development/interface-tests.json.gz`，完整迁移证据为 `migration-full.json.gz`；均附未压缩内容的 SHA-256。所有通过接口的证据都会保留。978 个原延期目标另列 PASS / BLOCKED / Astra / PENDING 和直接测试／共享前置／复审依赖计数。

遇到复杂碰撞、内部空腔、轮系、轴孔或 clip/bar 语义缺口时，本轮只保存真实最小证据并转交 Astra，不修改碰撞容差或创造机械规则。
