# 碰撞方法与已有零件选用：验证记录

[完整报告](../../docs/COLLISION_METHOD_REVIEW.md)。基准 `548b5fe`，分支 `codex/collision-method-review`。

- `references.json`：在线实际查阅的仓库、提交、文件、函数、许可与哈希。没有安装或执行第三方代码。
- `comparison.json`：19 个真实姿态的新旧碰撞对照、实际公共区域、四个单编号筛选回归、当前资格与原始来源保留检查。
- `models/`：四个已有曲面/风挡的表面合同样例，以及一个九件双模块回归。均正式生成、导出并重新导入。
- `screenshots/`：实际网页选择与生成风挡，非完整汽车。
- `logs/`、`unit-results.json` 与 `verification.json`：本轮运行结果、最终核对与日志哈希。

最终代码实际执行结果（2026-11-05）：

| 命令 | 结果 | 记录 |
|---|---|---|
| `npm test -- --maxWorkers=1 --reporter=default --reporter=json --outputFile=artifacts/collision-method-review/unit-results.json` | 66 个文件，885/885 通过；0 失败、0 跳过 | `logs/unit.log`、`unit-results.json` |
| `CI=1 npm run test:e2e -- --reporter=list` | Chromium 18/18 通过，包含实际曲面/风挡选择、生成与重导入 | `logs/browser.log` |
| `npm run test:preview` | 编译版本 6/6 通过；启动时实际重新构建前后端 | `logs/preview.log` |
| `npm run typecheck` | 通过；最后一次 build 再次执行通过 | `logs/typecheck.log`、`logs/build.log` |
| `npm run build` | 通过；保留既有大 chunk 提示 | `logs/build.log` |
| `npm run review:collision-methods` | 19 组真实姿态对照；四个单编号目标由阻止变为成功并重导入；五个当前生成样例；993 个原始来源文件未变 | `logs/comparison.log`、`comparison.json` |

没有失败、跳过或以历史结果代替本轮检查。未执行实物、轮组安装轨迹、保持力和完整跑车验证；这些不属于已通过测试的证明范围。

开发过程先完成碰撞修复，48/48 针对性、879/879 全量、17/17 网页与 5/5 编译预览通过。随后定位并修复单编号筛选和表面件选择入口，47/47 相关针对性测试通过，再执行最终完整验收。前一阶段记录分别保存在 `*-before-selection.log`，不代替最终结果。

复现：

```sh
npm run review:collision-methods
```

此命令需要当前 Git 检出包含 `548b5fe`，将本项目旧函数适配到相同几何依赖作为对照，并清理临时文件。不执行第三方项目代码，不覆盖历史证据目录。

本轮没有新的零件准入。所有结论都限定于记录的姿态与合同；碰撞微小不代表合法，UNKNOWN 不会产生通过证书，局部误报修复不代表整个零件已放行。未执行安装路径、轮组、保持力、材料和实物验证。
