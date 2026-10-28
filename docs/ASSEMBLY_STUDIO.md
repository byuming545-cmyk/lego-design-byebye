# 拼接动画与手动拼搭

## 定位

本页在真实接口与拼接库内增加三个连续入口：

- **看示范**：真实两件零件的分步动画和 GIF。
- **我来拼搭**：在真实三维工作台移动、旋转、记录关键帧并提交。
- **检查结果**：分别显示规则、最终碰撞、安装路径和人工判断，不用单一“正确”标签。

所有零件、网格、接口、规则、碰撞检查来自同一条正式引擎链路。人工示例只保存到独立的复核数据，不改变生产资格、规则、碰撞版本或生成模块。

## 看示范

已验证案例使用 `AssemblyCasePlayer`：

- 四个阶段：分离、连接高亮、接近、已就位。
- 播放/暂停/重播、0.5×/1×/2×、进度拖动。
- 自由/正视/侧视/俯视、连接标记、真实零件辅助显示色（青色固定、橙色移动）。
- 导出 800×500、约 20 fps、循环 GIF；帧内叠加零件编号、规则和“示意动画 · 安装路径未验证”。
- 动画只沿来源轴向刚体移动，不是经过验证的安装路径。

被阻止案例仍显示真实零件和阻塞原因，不生成“成功”动画。当前 `30374 → 60470b` 为真实碰撞阻塞。

## 我来拼搭

工作台使用 `AnimatedPairViewer` 和 `AssemblyStudio`：

- 固定 A / 移动 B，可切换。
- 移动/旋转/转动视角三种工具；移动沿 X/Y/Z，旋转绕 X/Y/Z。
- 步长和角度可输入；撤销/重做/恢复原始位置。
- 自由/正视/侧视/俯视。
- 辅助模式：来源规则成立时给出来源候选姿态；可吸附，但吸附不是完整验证。
- 自由示范：不吸附、不纠正；重叠只警告；只能保存为待验证示例。
- 关键帧：起始位置、过程位置、连接完成位置；未记录过程时明确显示“未提供安装过程”。
- 提交字段：连接说明、理由、是否实物拼过；本轮附件只支持来源链接，页面明确说明不展示二进制上传。

## 验证语义

保存示例包含：

- 两端真实零件 ID、名称、来源 SHA/版本和来源端点快照。
- 初始/最终变换、所有关键帧、人工候选信息。
- 规则/解析器/装配引擎/碰撞/grammar 版本。
- 人工说明、时间、系统检查、处理历史。

提交后显示四个独立结果：

1. **用户认为可行**：人工判断，不是软件通过。
2. **规则检查**：`compatible / unknown / incompatible`，带规则 ID、源证据和姿态偏差。
3. **最终碰撞**：`clear / collision / blocked`，带位置证据。
4. **安装路径**：`checked-clear / checked-collision / not-checked / not-provided`。

路径检查只采样两件刚体的关键帧/四元数插值。它不验证形变、卡扣/轮胎弹性、保持力、环境或实物。当前 C01 示范的中间取样姿态无法绑定到合法 seat，页面显示“暂时无法判断”，不会把终点 clear 当成路径通过。

## API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/interface-library/studio/validate` | 检查当前输入，不保存 |
| POST | `/api/interface-library/studio/examples` | 保存为 `pending-review` |
| GET | `/api/interface-library/studio/examples` | 列出待验证示例 |
| GET | `/api/interface-library/studio/examples/:id` | 重新打开并标记 stale |
| POST | `/api/interface-library/studio/examples/:id/revalidate` | 按当前版本重新检查并追加历史 |

存储：`<data>/interface-library/studio-examples.json`，最多 1000 条，原子写入。来源 SHA 变化时 `stale:true`，可重新检查。

## 证据与限制

- 浏览器流程：C01 3024→3070b，打开看示范、播放/暂停、导出 GIF、进入手动工作台、移动/撤销/重做/恢复、记录起始/完成、吸附、检查、保存、刷新后重开；桌面 1440×1100 与移动 390×844，0 控制台错误。
- 截图与 GIF：`artifacts/interface-library/studio.png`、`studio-result.png`、`studio-saved.png`、`studio-reopen.png`、`studio-mobile.png`、`case-player.png`、`case-c01.gif`。
- 人工示例不会获得正式生成资格；正式生产规则仍是 C01/BAR_CLIP/PIN_HOLE。
- 安装路径的 seat 绑定目前只支持最终对齐姿态，因此 C01 路径检查显示“暂时无法判断”，不是通过。
- 还没有覆盖所有接口族的真实示范；未支持的类别在接口库/复核队列中保持 UNKNOWN/PARTIAL。
