# 曲面功能模块：本轮证据

分支 `codex/surface-body-modules`，基准 `ba619e9`。完整说明见 [交付报告](../../docs/SURFACE_BODY_MODULES_DELIVERY.md)。

本轮将真实 15068 曲面与 3022 支撑板、3069b 收边组成来源可追溯的三件覆盖核心。两个来源变体成功复用到多个真实基座，并与既有上盖组合。没有新增原生来源或资格，没有声称完整座舱、车身、跑车或实物认证。

- `source-acquisition.json`：固定上游两份 MPD 的 HTTP、哈希与逐 section 许可/署名检查。
- `baseline.json`、`references.json`：现场、远端检查与外部资料采用方式。
- `reader-comparison.json`：同一新审查清单上的旧/新读取结果，以及选入不支持记录时继续拒绝的证据。
- `part-audit.json`：曲面、风挡、轮拱及支撑件的当前接口和权限，配方关联不冒充生成覆盖。
- `module-catalogue.json`：六个配方当前内部编译结果；五个通过、尾翼继续阻止。
- `generation-results.json`：六个正式生成模型、计数、重导入和历史文件保留。
- `models/`：每项的完整模型、BOM、步骤、来源、检查及重导入。
- `blocked-source-route.json`：3021/50950 真实来源姿态拒绝，含原始表面诊断和见证点。
- `unresolved-windscreen.json`：风挡探索的来源与未核实换件假设，未注册为生产配方。
- `screenshots/`：网页生成结果，局部组合不是完整汽车。
- `logs/`、`unit-results.json`、`verification.json`：本轮实际运行、最终核对与日志哈希。

最终代码实际执行结果：

| 命令 | 结果 | 记录 |
|---|---|---|
| `npm test -- tests/parts-surface-modules.test.ts tests/parts-module-reuse.test.ts tests/parts-module-composition.test.ts --maxWorkers=1` | 59/59 通过 | `logs/targeted.log` |
| `npm test -- --maxWorkers=1 --reporter=default --reporter=json --outputFile=artifacts/surface-body-modules/unit-results.json` | 67 个文件、903/903 通过；0 失败、0 跳过 | `logs/unit.log`、`unit-results.json` |
| `CI=1 npm run test:e2e -- --reporter=list` | 19/19 通过，包含正常网页四件、七件生成及重导入 | `logs/browser.log` |
| `npm run test:preview` | 7/7 通过，实际重新构建并运行编译后的 API/UI | `logs/preview.log` |
| `npm run typecheck` | 最终通过 | `logs/typecheck-final.log` |
| `npm run build` | 最终通过，保留既有大分块提示 | `logs/build.log` |
| `python scripts/check-module-source.py --output artifacts/surface-body-modules/source-acquisition.json` | 两个固定原文件 HTTP 200、六个配方的原始片段核对通过 | `logs/source-acquisition.log` |
| `npm run evidence:surface-modules` | 六个模型正式生成、整图检查、输出及重导入均通过；保留碰撞负例 | `logs/generation.log` |

复现：`npm run evidence:surface-modules`。需要 `ba619e9` 的本地 Git 历史，仅执行本仓库旧读取函数的受控适配，不运行第三方项目代码。普通生成无需 Git、外网或额外 API 密钥。

开发初始的证据错误文本匹配、CLI 数组类型及由此导致的预览启动失败均保留日志。最终状态与初始记录分开，不用历史结果代替本轮执行。

`generation-initial.log` 是记录器未识别预期拒绝文本造成的失败；`typecheck-cli-initial.log`、`build-initial.log`、`preview-initial.log` 保留显式数组类型修复前的错误。最终上述命令均通过，没有删除安全断言或跳过用例。未执行实物、安装轨迹、保持力、完整座舱、轮组或整车验证。
