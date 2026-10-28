# 数据驱动拼接目录与手动拼搭工作台

分支：`codex/interface-library`  
基线：`5db5e7c`（本报告对应未推送的本地实现）  
日期：2026-10-28

## 结论

本轮把原来三个固定配对扩展为**从真实零件索引派生的拼接目录**：

- 15 个正式/条件门类，按真实接口实例和规则生成，不再由前端硬编码配对。
- 每一类给出真实示例、可用零件数或明确资料缺口。
- A/B 可自由选择，允许同一零件编号的两个实例。
- 手动工作台支持移动、旋转、视角、撤销/重做/恢复、关键帧、吸附、草稿/待复核、版本、导出/导入；可标记 A/B 局部候选点作为人工信息，不是来源端点。
- 保存的是服务端 JSON，刷新/重启后可重新打开；失败保存保留当前编辑内容。
- 人工示例始终 `generationEligible:false`，不改变生产资格、规则、碰撞或生成模块。

## 目录

| 门类 | 示例 | 零件 | 状态 |
| --- | ---: | ---: | --- |
| C01 标准凸点 ↔ 标准凹槽 | 2 | 239 | 正式生产 |
| BAR_CLIP 圆杆 ↔ 夹口 | 3 | 3 | 正式生产 |
| PIN_HOLE 销 ↔ 销孔 | 3 | 11 | 正式生产 |
| BAR_RECEPTACLE 圆杆 ↔ 杆孔 | 0 | 2 | 条件规则；无来源明确示例 |
| AXLE_KEYED 十字轴 ↔ 十字孔 | 0 | 4 | 条件规则；无来源明确示例 |
| AXLE_ROUND / HINGE / CLICK_HINGE / TURNTABLE / BALL_SOCKET / TOWBALL_SOCKET / WHEEL_MOUNT / TYRE_RIM / RAIL_GROOVE | 0 | 0 | 明确资料缺口 |
| GENERIC_GROUP 来源分组 | 1 | 90 | 未验证来源分组，不作为生产规则 |

缺口文案直接来自目录构建，例如：

```text
BALL_SOCKET 球 ↔ 球窝
固定 253 零件库没有 BALL ↔ BALL_SOCKET 的真实来源实例。
```

没有把 `AXLE_HOLE`、`GENERIC_SPECIAL` 或相似半径的形状补造成不存在的门类。`BAR_RECEPTACLE` 有 2 个带 R4 孔的零件，但 LDraw 标题/关键词没有明确“杆孔”身份，因此只显示为条件缺口。

## 真实示例与工作台

已验证真实对：

- C01：`3024`（Plate 1×1）→ `3070b`（Tile 1×1 with Groove），正式生成/导出/重导入通过。
- BAR_CLIP：`30374`（Bar 4L）→ `48729b`（Bar 1.5L with Clip），正式生成/导出/重导入通过。
- PIN_HOLE：`3673`（Technic Pin）→ `32000`（Technic Brick 1×2 with Holes），正式生成/导出/重导入通过。

C01 另有来源候选 `2445 → 2431`，目录明确标记为“来源候选；尚未生成/导出样例”，不是已验证案例。

工作台功能：

- 门类选择、示例切换、A/B 零件选择、真实几何 SVG 缩略图、搜索。
- 同编号双实例（如 `3024` + `3024`）可准备和保存。
- 固定 A / 移动 B 交换。
- 移动/旋转/转动视角，X/Y/Z 步进，平移/角度输入，撤销/重做/恢复。
- 自由/正视/侧视/俯视；相机位置、目标、视角随保存记录。
- 辅助拼搭：来源候选吸附预览；吸附不等于碰撞或路径通过。
- 自由示范：不吸附、不纠正；重叠警告；结果只进入待复核。
- 关键帧：起始、过程、连接完成；未记录过程时明确“未提供安装过程”。
- 四个独立结论：用户认为可行、规则检查、最终碰撞、安装路径。
- 附件只支持 http(s) 链接；页面明确说明没有二进制上传，不显示死按钮。

## 持久化与导出

存储：`<data>/interface-library/studio-examples.json`，原子写入，最多 1000 条。

每条记录包含：

- 零件 ID、名称、来源 SHA、revision、接口快照。
- 固定/移动实例 ID、初始/最终变换、A-local-to-B-local 相对刚体变换。
- 所有关键帧、相机、预览 PNG（≤900 KB 数据 URL）、说明、实物经历、链接附件。
- 规则/parser/admission/grammar/assembly/collision 版本。
- 四个检查结果、stale 标记、版本号、rootId、previousId、处理历史。

保存行为：

- 首次保存创建 `rootId` 和版本 1；同一 `rootId` 再保存生成版本 2、3，不覆盖旧版本。
- 草稿保存走 `/studio/drafts`；提交待复核走 `/studio/examples`，两者都重新验证。
- 保存失败时前端捕获错误，当前零件、姿态、说明、相机、关键帧不重置。
- 刷新/重开后按记录恢复相机、姿态、关键帧、说明和检查结果。
- `stale` 由零件来源 SHA 变化触发；重新检查会追加历史。
- 零件选择器显示全部匹配项（不再截断 24 条），列表内部滚动；模态打开时锁定背景滚动，关闭后恢复。

导出包：`bricklab-studio-bundle`，bundleVersion 1，schema `studio-example-2`，包含 examples、feedback、versions、sourceSummary 和复现说明；**不包含**源模型。导入时只创建草稿，不直接进入正式生成。

## 人工判断与验证边界

四个结果分别显示，不用一个“正确”徽章：

1. 用户认为可行：人工判断。
2. 规则检查：来源接口/规则/姿态匹配结果。
3. 最终碰撞：最终姿态的实体碰撞结果。
4. 安装路径：关键帧/插值刚体取样结果，或 `not-provided` / `not-checked`。

当前 C01 的关键帧路径显示：

```text
安装路径
暂时无法判断
当前取样姿态无法绑定到合法 seat，暂时无法判断安装路径。
```

原因：路径采样复用最终 seated 碰撞 seat，中间分离/接近姿态无法绑定该 seat。系统没有删除 seat 检查，也没有把终点无碰撞当成路径通过。

限制：

- 只覆盖两件刚体；不验证形变、轮胎/卡扣弹性、保持力、环境或实物。
- 不是 AI 训练；人工示例只是待复核记录。
- 人工示例不会自动修改规则，不会提升 `generationEligible`。

## API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/interface-library/studio/catalog` | 真实门类、示例、零件、缺口 |
| POST | `/api/interface-library/studio/prepare` | 选择 A/B 并求解来源初始/就位姿态 |
| POST | `/api/interface-library/studio/validate` | 检查，不保存 |
| POST | `/api/interface-library/studio/drafts` | 保存草稿（版本化） |
| POST | `/api/interface-library/studio/examples` | 保存待复核示例 |
| GET | `/api/interface-library/studio/examples` | 版本/记录列表 |
| GET | `/api/interface-library/studio/examples/:id` | 重开并计算 stale |
| POST | `/api/interface-library/studio/examples/:id/submit` | 草稿转待复核 |
| POST | `/api/interface-library/studio/examples/:id/revalidate` | 按当前版本重检 |
| GET | `/api/interface-library/studio/export` | 导出交接包 |
| POST | `/api/interface-library/studio/import` | 导入包，创建草稿 |
| GET | `/api/parts-foundation/parts/:id/thumbnail` | 真实几何 SVG 缩略图 |

## 验证

- `npm run typecheck`：通过。
- `npm test -- --maxWorkers=2`：777/777，54 files，89.86 s，日志 `artifacts/interface-library/unit-scroll-fix.log`。
- `npm run build`：通过，日志 `artifacts/interface-library/build-catalog.log`。
- 浏览器（隔离数据目录，1440×1100 与 390×844）：
  - 目录 15 门类；C01 初始 A/B = `3024` / `3070b`。
  - 同编号 A/B = `3024` / `3024`，准备为 compatible。
  - BALL_SOCKET 缺口文案可见。
  - 保存失败 503 时说明保留、画布保留。
  - 草稿版本 1/2 保存；刷新后重开版本 2，相机恢复为“俯视”，预览 PNG 可显示。
  - 导出 2 条示例；导入创建 2 条草稿；旧用户包另测 3 条导入。
  - 失效来源可通过 `POST /studio/examples/:id/revalidate` 重检，历史追加；API 回归覆盖。
  - 预期 503 console error 1 条；其他 console/page error 0。
- 历史 3 条用户示例保留在 `data/interface-library/studio-examples.json`，未改写为测试数据；读取时升级为 `PIN_HOLE`、版本 1、默认相机、相对变换和历史。已导出为 `artifacts/interface-library/studio-user-bundle.json`（3 条、2 个零件、4 个来源路径）；在隔离数据目录导入得到 3 条草稿、0 跳过、0 错误，原文件不变。

## 证据

- `artifacts/interface-library/catalog-ui-check.json`
- `artifacts/interface-library/catalog-verification.json`
- `artifacts/interface-library/studio-catalog.png`
- `artifacts/interface-library/studio-catalog-gap.png`
- `artifacts/interface-library/studio-part-picker.png`
- `artifacts/interface-library/studio-same-part.png`
- `artifacts/interface-library/studio-result-catalog.png`
- `artifacts/interface-library/studio-catalog-saved.png`
- `artifacts/interface-library/studio-catalog-reopen.png`
- `artifacts/interface-library/studio-catalog-mobile.png`
- `artifacts/interface-library/studio-bundle.json`

本轮仍未推送、未合并主分支、未部署。人工示例数据不进入 Git。
