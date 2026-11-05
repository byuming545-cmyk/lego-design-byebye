# 本轮多点安装与模块组合证据

[完整说明](../../docs/MODULE_COMPOSITION_DELIVERY.md)。这些文件属于 `codex/multipoint-module-composition`，基准为 `3fb3f03`；上一轮证据保留在 `artifacts/module-reuse/`。

- `source-acquisition.json`：固定许可模型的正常 HTTPS、全文件与三个源 section 的四条配方引用哈希。
- `module-catalogue.json`：三个可用配方，一个尾翼阻止配方；VALIDATED 只表示当前内部装配和开放口。
- `generation-results.json`：六个正式生成及重导入见证、1→4 安装位置对比、993 个原生文件和三个原配方保留。
- `models/`：四个改进上盖样例，以及 3035/3031 上的两个不同功能模块组合。每组保存模型、BOM、步骤、来源、支撑位置、搜索统计和 JSON 重导入结果。
- `negative-cases.json`：11211 真实障碍物导致安装拒绝，输入图不变。
- `spoiler-diagnosis.json`：原始提取、父子变换、接口、近接源面、原始三角面和精度指令摘录；尾翼仍未准入。
- `screenshots/`：本轮实际网页生成及重新导入画面，未覆盖历史模型。
- `logs/`、`unit-results.json`：本轮命令输出和完整自动化结果。

## 验证记录

| 本轮实际命令 | 结果 | 日志 |
|---|---|---|
| `python scripts/check-module-source.py --output artifacts/module-composition/source-acquisition.json` | HTTP 200；完整文件和四条配方引用的三个原始片段哈希一致 | `logs/source-acquisition.log` |
| `npm run evidence:module-composition` | 六组正式生成和 JSON 重导入全部通过，四组 1→4 位置改善、两组九件组合；无失败样例 | `logs/generation.log` |
| 首次针对性三个文件 | 62/63，旧请求数量断言与双模块新需求冲突，见下文 | `logs/targeted-initial.log` |
| `npm test -- tests/parts-module-composition.test.ts tests/parts-module-reuse.test.ts tests/parts-assembly-api.test.ts --maxWorkers=1` | 缓存补充前 57/57 | `logs/targeted.log` |
| `npm test -- --maxWorkers=1 --reporter=default --reporter=json --outputFile=artifacts/module-composition/unit-results.json` | 最终 65 文件，869/869，0 失败、0 跳过，419.96 秒 | `logs/unit.log`、`unit-results.json` |
| `npm run typecheck` | 通过 | `logs/typecheck.log` |
| `npm run build` | 通过，保留既有大于 500 kB 分块提示 | `logs/build.log` |
| `CI=1 npm run test:e2e -- --reporter=list` | 17/17，包含网页双模块生成、位置数量、署名与重新导入 | `logs/browser.log` |
| `CI=1 npm run test:preview -- --reporter=list` | 5/5，包含编译服务双模块生成与重新导入 | `logs/preview.log` |
| 独立重复调用仓库的 `diagnoseSpoiler()` | 当前源面、依赖和父子姿态复核成功；尾翼仍判 COLLISION，不授予准入 | `logs/spoiler-diagnosis.log` |

首次针对性 63 项中 62 通过、1 失败：旧 API 断言仍把两个模块视为非法请求。本轮需求明确允许两个模块，因此保留请求安全测试，将超限负例改为三个模块，并补充重复 ID 拒绝和真实双模块正例。调整后针对性 57/57 通过。

首次完整 868/868 通过；复查发现未使用的缓存端口需要随当前权限刷新，补齐实现与撤销测试后，重新运行最终全量套件。没有跳过失败用例。

本轮没有改正式碰撞实现；原有 UNKNOWN 保守性、C01、Bar/Clip、Pin/Hole、来源暂存晋升、示例复盘和旧体系隔离测试均随最终完整套件运行。实物、材料应力、保持力、安装路径、轮组专项和整车验收未执行，不计为通过。

`verification.json` 保存最终结果和日志哈希。开发探针日志只用于解释调查过程，不代替正式生成样例、最终测试或准入证据。

回退测试中的槽位拒绝是明确标注的测试策略，只注入拒绝，所有接受仍走真实引擎；不计入正式生成覆盖。尾翼的源精度假设不作为碰撞豁免。独立绕数观察不是闭合实体认证。

```sh
npm run evidence:module-composition
```

该命令重新执行全部正式样例和尾翼诊断，正常下载固定公开模型并核对哈希，不依赖临时附件目录。不导入 PDF、Studio 或历史私有数据。
