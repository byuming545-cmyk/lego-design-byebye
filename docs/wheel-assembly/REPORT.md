# Wheel Assembly：来源审查与独立阻塞报告

本轮实际审查 `18975`、`3673`、`66727`、`18977`，未修改任何原始源文件、连接规则或碰撞豁免。结论为 **BLOCKED**；轮组不计入本轮新增正式生成成果。

已实现可重复运行的来源审查器：`src/parts/assembly/wheelAssessment.ts`。它读取当前原生仓库，核对请求编号与实际来源身份，保留源摘要、原始文件/许可、连接行、解析问题、实际碰撞代理结果和逐阶段结论。它不构造摆放坐标、不创建资格，不把普通凸点规则当作轮组配合证明。

复现：

```sh
npx tsx src/cli/wheel-assessment.ts --output artifacts/wheel-assembly/source-assessment.json
npx vitest run tests/parts-wheel-assessment.test.ts --maxWorkers=2
```

实际机器记录：[source-assessment.json](../../artifacts/wheel-assembly/source-assessment.json)。连接衍生记录保持 CC-BY-SA-4.0，原始 LDraw 文件保留各自许可、作者、URL 和 SHA。

## 实际来源和阻塞

| 原生编号 | 原始来源身份 | 几何 | 当前连接解释 | 原生代理 |
| --- | --- | --- | --- | --- |
| 18975 | Plate 2 x 4 with Side Bricks 1 x 2 x 1.333 with Hole | geometryReady，28个几何源文件 | partial；孔的 SNAP_INCL 三维 grid 语法未解释 | unresolved-boundary-cap |
| 3673 | Technic Pin | geometryReady，12个几何源文件 | partial；L_ / _L 圆柱分段端部轮廓未解释 | branched-native-boundary |
| 66727 | Wheel Rim 11 x 18 with Drilled Disc Brake | geometryReady，38个几何源文件 | ready；仅继承多段居中/滑动孔和普通 studO，没有轮胎座接口 | branched-native-boundary |
| 18977 | Tyre 11.2/28 x 17.6 Intermediate | geometryReady，16个几何源文件 | missing；当前固定 Shadow 闭包没有该轮胎的适用接口，继承结果为0点 | branched-native-boundary |

精确源行：

- `data/parts-foundation/shadow/files/parts/18975.dat:10`：`SNAP_INCL ref=connhole.dat`，`grid=1 C 2 1 0 60 0`。当前解析器只实现其已核实的标准 X/Z 网格；不能把这条未解释的三维网格按直觉简化成两个孔。
- `.../parts/3673.dat:10`：`secs=L_ 6.25 2 R 6 16 R 8 4 R 6 16 _L 6.25 2`，`center=true`、`slide=true`。当前不支持其端部轮廓，所以雄销端口没有发出；第11行剩余的R4雌孔不能冒充雄销。
- `.../p/connhol2.dat:8`：轮毂继承 `R8×2 / R6×16 / R8×2`、`center=true`、`slide=true` 的连接描述。长度与半径只构成来源轮廓，并不独立给出本项目已验证的插入位置、占用、销保持或运动自由度规则。
- `data/parts-foundation/ldraw/files/parts/18977.dat` 的轮胎尺寸/名称是原生几何资料，不是轮胎装配接口。没有在当前获准来源中找到相应连接描述时，保持缺失，不从名称或半径生成接口。

当前三组请求 `18975→3673`、`3673→66727`、`66727→18977` 均没有获得机械配合证明。第三组甚至没有可枚举的轮胎端口。

## 没有被混为一谈的阶段

| 阶段 | 实际达到的状态 |
| --- | --- |
| 原生源身份、依赖、哈希和许可读取 | 已完成四件来源审查 |
| 连接完整解析 | 未完成；部分语法和轮胎接口仍缺失 |
| 机械规则、允许姿态、插入深度、占用语义 | 未验证，不能产生合法轮组候选姿态 |
| 可证明的实体代理 | 四件均仍有来源边界问题 |
| 最终姿态及整组与底盘的正式连接 | 未执行，没有完整合法轮组候选 |
| 连续旋转净空 | 未执行；普通静态碰撞通过也不能代替 |
| 安装轨迹、弹性或过盈配合 | 未执行，没有足够来源/材料证据 |
| 实物保持力、转动及拼搭 | 未测试 |
| 轮组模型、BOM、步骤、导出与重新导入 | 未产出、未计为成功 |

`inspectWheelMatingCandidate()` 独立标记普通 stud 兼容性与机械规则证明。即使真正的 `3005/3024` 普通凸点匹配通过，也不会被记成 pin/tyre/rim 配合。来源相同的 `4624/3641` 确有共同 `rim8_6` group，但当前仍返回 `grouped-interface-seating-unresolved`；该 group 用于来源软件的形状匹配辅助，不能替代本项目的座位、实体净空、制造公差或轮胎变形证据。

没有采用“半径相近所以能装”“通用圆柱可滑动所以插入深度任意”“名字属于Wheel所以可以自由转动”等推断。没有补造机械公差、扩大实体豁免或封闭未知真实空腔。

## 本轮负向测试

`tests/parts-wheel-assessment.test.ts` 实际 **8项通过**：

1. 四件真实源可以读取，但不授予轮组权限或生成产物。
2. 未解析 grid、未支持销端轮廓、缺失轮胎接口保留精确来源行。
3. 真实普通凸点通过不能冒充轮组规则通过。
4. 真正的相同 rim group、相同名义分段半径不能自动建立轮组配合。
5. 最终姿态、旋转、安装轨迹和实物测试独立保持未执行。
6. 缺失来源不得以其他零件替代。
7. 即使另一个真实源可读，也不能挂在请求的轮组编号下。
8. 来源读取或哈希校验失败被记录为明确阻塞，不回退到其他零件。

本轮未添加机械准入规则，现有 `wheel-module` 继续被正式生成器阻止。后续可以先依据明确格式资料扩展三维网格和分段轮廓解释，再处理原生实体边界及机械规则；这些改进完成前不得把本报告的来源读取成功当作装配成功。
