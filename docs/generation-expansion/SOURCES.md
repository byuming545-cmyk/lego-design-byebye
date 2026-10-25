# 本轮数字来源、许可与分发边界

本轮复用两个已缓存的固定版本上游档案，重新核对档案SHA及每个成员字节。没有抓取BrickLink、Studio、Rebrickable网页、绕过访问控制或调用私有接口；不需在线密钥。原生身份不依赖未核实的Element映射。

| 来源 | 固定来源与版本 | 允许方式和限制 |
| --- | --- | --- |
| LDraw Parts Library，Pybricks镜像 | [LDraw](https://www.ldraw.org/)、[固定版本](https://github.com/pybricks/ldraw/tree/c43ed06a128a10ed65675166bf42eb6fd608b9b0) | 只接纳逐文件声明CC BY 4.0或CC BY 2.0/4.0双许可、保留作者和完整依赖的文件；本轮按CC BY 4.0条件保留署名、许可和未修改说明。第三方附带资源不能默认同许可。 |
| LDCad Shadow Library | [固定版本](https://github.com/RolandMelkert/LDCadShadowLibrary/tree/9b1131fb1991f8c0bfc072325e4e12f6271aba35)，Roland Melkert及贡献者 | CC BY-SA 4.0；保留许可/署名，连接衍生记录及随包连接证据保持相同许可。吸附辅助不等于物理认证。 |
| 既有LEGO说明书、库存 | 用户既存参考资料 | 仅指导需求和结构，不从图片重建几何，不复制PDF到来源包，不主张可自由分发。 |
| Rebrickable | [批量下载](https://rebrickable.com/downloads/)、[官方API](https://rebrickable.com/api/) | 后续须遵守认证、速率、数据与再分发条款。既有镜像数据许可未独立确认，本包排除映射/库存；本轮未访问，不把历史401/403列作当前结果。 |
| BrickLink / Studio | [BrickLink](https://www.bricklink.com/)、[Studio](https://www.bricklink.com/v3/studio/download.page) | 本轮没有访问或复制。网页不得无授权抓取，Studio内部几何/.conn不得默认再分发，项目未取得获准资源集。 |

本轮没有新的来源访问失败；复用档案不是在线可用性测试。1751连接缺失表示固定数据没有适用记录，不是网络故障。历史Rebrickable阻止不推断为AI检测。

## 档案与完整性

```text
LDraw revision: c43ed06a128a10ed65675166bf42eb6fd608b9b0
URL: https://codeload.github.com/pybricks/ldraw/tar.gz/c43ed06a128a10ed65675166bf42eb6fd608b9b0
bytes: 78519975
SHA256: cbdd578181a13ca0406211206da8bf3852cd6bb4f01b981ecbd8e40444368292

Shadow revision: 9b1131fb1991f8c0bfc072325e4e12f6271aba35
URL: https://codeload.github.com/RolandMelkert/LDCadShadowLibrary/tar.gz/9b1131fb1991f8c0bfc072325e4e12f6271aba35
bytes: 318614
SHA256: a91dbdb5487a5796bdb76de64966e11e9c25ee1de56121000d7d943d3cfa1b3a
```

最终闭包743个LDraw文件：699声明CC BY 4.0、44声明CC BY 2.0/4.0双许可；245个Shadow文件均为CC BY-SA 4.0。上游`CAlicense.txt`、`CAlicense4.txt`、`CAreadme.txt`及Shadow的`LICENSE.md`、`README.md`、`CONTRIBUTING.md`保留并逐字节与上游比较。

本轮追加11个LDraw、9个Shadow及8个正式根编号，原有732+236个源文件逐字节未改；新文件亦无修改。来源清单见[LDraw manifest](../../data/parts-foundation/ldraw/manifest.json)、[Shadow manifest](../../data/parts-foundation/shadow/manifest.json)。每个源的作者、URL、字节、SHA、许可及源内`!HISTORY`可追溯；子零件和primitive不重复算新增根件。

新增根件均为`parts/<编号>.dat`、CC BY 4.0：

| 编号 | 原始作者 |
| --- | --- |
| 32000、3623、3456、41539 | James Jessiman |
| 60479 | Philippe Hurbain [Philo] |
| 78329 | Gerald Lasser [GeraldLasser] |
| 69729 | Vincent Messenet [Cheenzo] |
| 6934 | Tore Eriksson [Tore_Eriksson] |

根件作者不能替代依赖作者；完整署名和依赖见[candidates.json](candidates.json)和逐文件清单。导出要求每个几何文件均有获准许可和作者。

## 处理方式与权利范围

原始几何及Shadow字节未改。程序解析依赖变换并生成接口记录、资格与模型，保留实际依赖摘要/版本。刚体放置不改变尺寸或制造变体；上游依赖变换按原源解析，不据此放行未知接口。

LDraw几何保留适用CC BY条件；Shadow及连接衍生记录保持CC BY-SA 4.0，包括本轮资格/接口测试、模型中的连接描述与图证据。随包报告保留署名和许可链，不限制源数据许可已有权利。算法结果不构成上游、LEGO或原作者的认可、实物测试或不同版本零件担保。

来源ZIP使用明确白名单：当前743+245个源、清单、原始许可、当前资格/接口证据、本轮13模型及必要报告。没有递归打包整个仓库；排除历史编号镜像/映射、私有资料、上传PDF、Studio资源、旧模型/缓存和旧生成模块。不打包全部应用、npm依赖或字体，各自许可仍独立适用。开发仓库ZIP与本来源包范围不同。

模型是最终规则下实际生成并重导入的证据，无从历史模型库复制或人工编写的成品坐标。再利用时继续保留逐文件作者、URL、适用许可和连接衍生数据的相同方式共享要求。
