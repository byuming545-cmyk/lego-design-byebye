# 模块复用的可复现证据

完整说明见 [本轮交付报告](../../docs/MODULE_REUSE_DELIVERY.md)。这些文件是本轮重新执行所得，不是历史成功标记。

- `source-acquisition.json`：固定来源 HTTPS 获取、作者、许可和两段原始 section 的哈希。
- `module-catalogue.json`：当前正式引擎重算的模块内部装配和未占用安装口，不代表实物认证。
- `generation-results.json`：四个正式生成及重导入组合、实际身份覆盖、255/106 基准及 993 个既有来源文件保留检查。
- `models/`：核心版/换件版分别安装到 3001 和 3020；每组包含展开 BOM、步骤、来源和完整 JSON 重导入。
- `negative-cases.json`：原始尾翼阻止姿态及碰撞证明；真实 11211 障碍物导致安装失败和原图不变。
- `screenshots/`：本轮浏览器生成、导出及重导入后的真实画面，不是手动拼装效果图。
- `logs/` 和 `unit-results.json`：本轮命令的输出。

## 验证结果

| 本轮实际命令 | 结果 | 日志 |
|---|---|---|
| `python scripts/check-module-source.py` | HTTP 200，完整 MPD 哈希及两个原 section 的三条配方引用一致 | `logs/source-acquisition.log` |
| `npm run evidence:modules` | 四个正式组合全部生成、整图通过并重导入 VALID；原始 993 文件不变；尾翼/障碍物保持拒绝 | `logs/generation.log` |
| `npm test -- tests/parts-module-reuse.test.ts tests/parts-assembly-generator.test.ts --maxWorkers=1` | 开发期 41/41 | `logs/targeted-initial.log` |
| `npm test -- tests/parts-module-reuse.test.ts tests/parts-assembly-generator.test.ts tests/parts-assembly-api.test.ts --maxWorkers=1` | 开发期 62/62 | `logs/targeted.log` |
| `npm test -- tests/parts-module-reuse.test.ts --maxWorkers=1` | 补充真实障碍物及重复实例后 29/29 | `logs/module-final-targeted.log` |
| `npm test -- --maxWorkers=1 --reporter=default --reporter=json --outputFile=artifacts/module-reuse/unit-results.json` | 最终 64 文件、855/855，0 跳过、0 失败，380.40 秒 | `logs/unit.log`、`unit-results.json` |
| `npm run typecheck` | 通过 | `logs/typecheck.log` |
| `npm run build` | 通过；保留既有 >500 kB 分块提示 | `logs/build.log` |
| `CI=1 npm run test:e2e -- --reporter=list` | 16/16；包括模块网页生成、署名、导出、重导入及篡改拒绝 | `logs/browser.log` |
| `CI=1 npm run test:preview -- --reporter=list` | 4/4；重新构建后读取模块库、保留 LDraw 署名并完成 JSON 重导入 | `logs/preview.log` |

初次全量也通过 855/855；收尾补齐 LDraw 文件内的设计署名后重新执行了最终完整套件，以上表格和 JSON 是后一次结果。没有失败测试被删除或跳过。浏览器 16 项已通过，之后署名导出的最终改动另由编译预览及最终单元回归覆盖。

未执行实物拼搭、材料应力/保持力实验、安装轨迹或整车验收；没有宣称这些能力通过。正常 HTTPS 已成功，没有被网络问题阻止的模块源下载。尾翼装配仍失败；该失败保留在目录状态和负例记录中。

`verification.json` 汇总本轮结果及日志哈希；执行时的绝对工作路径属于复现环境记录，不是用户 Windows 本地路径。

## 重新生成

```sh
python scripts/check-module-source.py
npm run evidence:modules
```

下载脚本只验证固定、公开、带明确 section 许可的源文件，可通过 `--source-file` 指定已有原始 MPD 离线复核。不会导入整仓库数据、原始说明书或 Studio 文件。

生成模型的颜色 16 是未指定外观，来源色号另存；未验证实际颜色供应。尾翼失败不等于现实套装拼法非法，仍需核对源重建姿态/变体及当前代理解释。安装、保持力、实物和整车均未认证。
