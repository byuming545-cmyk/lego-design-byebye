# 第三方资料声明

上一轮独立的26件试点位于 `data/parts-foundation/pilots/speed-26/`：171个LDraw文件、39个Shadow文件及原始许可/署名，字节未修改。本轮只有32000经当前验证后迁入正式来源与接口资格，其余3件新试点仍待准入。见[试点来源清单](docs/digital-import/SOURCES.md)和[本轮来源说明](docs/generation-expansion/SOURCES.md)。原有245件的732个几何文件及236个连接文件字节未变；重叠依赖不重复算新增零件。

## 当前数字零件来源与历史改编的区别

正式原生几何来自固定版本的LDraw文件包：253个根零件、743个递归源文件，来源、SHA、作者及逐文件许可见[LDraw清单](data/parts-foundation/ldraw/manifest.json)。699个文件声明CC BY 4.0，44个声明CC BY 2.0 / CC BY 4.0双许可；原许可文本随包保留。

原生连接资料来自245个LDCad Shadow文件，逐文件来源和SHA见[Shadow清单](data/parts-foundation/shadow/manifest.json)，许可为CC BY-SA 4.0。解析不等于装配验证。本轮连接衍生记录保持CC BY-SA 4.0；不能由此推定历史镜像、说明书、Studio资源或整个应用的数据分发权。

Rebrickable 镜像只用于有状态的编号、颜色和库存线索。镜像数据许可尚未独立确认；构建工具的 MIT 许可不能代替数据许可。BrickLink Studio 的可复用数据及许可尚未提供，当前没有 Studio 导入适配器，不将其专有数据复制进正式库。用户上传说明书与车型链接保留原有来源状态，不视作几何许可或官方认证。

下面记载的是历史 Speed 参数化目录的参考和改编范围。手写目录已移至 `src/legacy/` 并标为 `LEGACY_QUARANTINED`；其外形和连接点不能作为正式原生来源。完整处置见 [隔离审计](docs/legacy-isolation/README.md)。

## LDraw Parts Library

Speed Creative 的零件名称、标称尺寸、部分连接位置及轮组装配参考来自 [LDraw Parts Library](https://www.ldraw.org/)。本项目查阅的是 [Pybricks 维护的镜像](https://github.com/pybricks/ldraw/tree/c43ed06a128a10ed65675166bf42eb6fd608b9b0)，固定修订为 `c43ed06a128a10ed65675166bf42eb6fd608b9b0`。

所引用 `.dat` 文件头部声明：`Licensed under CC BY 4.0 : see CAreadme.txt`。原始资料采用 [Creative Commons Attribution 4.0 International（CC BY 4.0）](https://creativecommons.org/licenses/by/4.0/)；[完整许可文本](https://creativecommons.org/licenses/by/4.0/legalcode)。原始作者与后续贡献者以各文件的 `Author`、`!HISTORY` 及其依赖子文件声明为准；以下作者名称按实际查阅的文件头部记录，不表示其认可或担保本项目。

每个历史目录条目在 [src/legacy/speed/catalog.ts](src/legacy/speed/catalog.ts) 中保留 `ldrawFile` 和固定版本的 `sourceUrl`。普通零件文件的完整来源格式为：

```text
https://raw.githubusercontent.com/pybricks/ldraw/c43ed06a128a10ed65675166bf42eb6fd608b9b0/parts/<partId>.dat
```

### 目录文件归属

下表中的编号均对应上述 `parts/<编号>.dat`，可通过该地址核对原始头部、历史及依赖资料。

| 文件头部作者 | 本目录参考文件编号 |
| --- | --- |
| James Jessiman | 3001、3002、3003、3004、3005、3006、3007、3008、3009、3010、3622、2456、6111、3020、3021、3022、3024、3026、3027、3028、3029、3030、3031、3032、3033、3034、3035、3036、3460、3666、3710、3795、3832、3958、4282、4477、3023b、2445、6636、4162、3040b、3039、3041、3038、4070、4079、4624、3641、4600、3673 |
| Orion Pobursky [OrionP] | 3023、50950、54200 |
| Owen Burgoyne [C3POwen] | 91988、11477、15068 |
| Rolf Osterthun [Rolf] | 11212 |
| Damien Guichard [BrickCaster] | 3068b |
| Santeri Piippo [arezey] | 3069b、2431 |
| Chris Dee [cwdee] | 3070b、52107 |
| Tim Gould [timgould] | 87079、63864、99781 |
| Philippe Hurbain [Philo] | 26603、98282 |
| Magnus Forsberg [MagFors] | 3794b、15573、29119、29120、24299、24307、99780、99207、11211、65635、18974、35789、65633、65632、18973、98138、18976、66727、18977、18975、85984 |
| Joerg Sommerer [Brickaneer] | 87580 |
| Donald Sutter [technog] | 43722、43723 |
| Marc Schickele [samrotule] | 41769、41770 |
| James Shields [lostcarpark] | 87087 |
| Sven Moritz Hein [smhltec] | 47905 |
| J.C. Tchang [tchang] | 99206、87552 |
| Willy Tschager [Holly-Wood] | 62360 |
| Guy Vivan [guyvivan] | 2412b |
| Max Martin Richter [MMR1988] | 14769 |

补充查阅的斜坡子文件和轮胎总成文件：

| 原始路径 | 文件头部作者 |
| --- | --- |
| `parts/s/11477s01.dat`、`parts/s/15068s01.dat` | Owen Burgoyne [C3POwen] |
| `parts/s/3040s01.dat`、`parts/s/54200s01.dat` | Orion Pobursky [OrionP] |
| `parts/s/3039s01.dat` | Willy Tschager [Holly-Wood] |
| `parts/s/85984s01.dat` | Magnus Forsberg [MagFors] |
| `parts/4624c01.dat`、`parts/18976c01.dat`、`parts/66727c01.dat` | Steffen [Steffen] |

### 本项目中的改编范围

本项目将查阅到的尺寸和接口数据转换为 stud/plate 坐标，并编写参数化简化外形、保守碰撞包络及连接规则。曲面、斜面、轮毂、轮胎等展示与验证几何属于近似表达；未保留原始零件的全部细节，也未模拟材料弹性与扣合力。这些改编与原始资料存在差异，不是 LDraw 官方验证结果。

本仓库没有捆绑完整LDraw库，但已捆绑上述253个根零件所需的原始文件与递归依赖；运行时不下载该库。作者及历史可沿固定来源及清单追溯。本声明不改变其他应用代码、字体或npm依赖各自的许可。
