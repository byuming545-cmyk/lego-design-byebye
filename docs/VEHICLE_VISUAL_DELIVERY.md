# 积木工作台界面美化

2026-11-08，从 `b935a57` 接续。只调整汽车页面及共享离线查看器的视觉样式；模型、原生网格、BOM、配色规则、结构和步骤数据保持原样。

## 页面变化

- 暖白底色叠加淡黄、浅蓝渐变和低对比度底板纹理。
- 页头加入原创红、黄、蓝积木 SVG；它属于装饰，使用 `aria-hidden`，不拦截点击，也不参与模型或 BOM。
- 标题增加积木黄下划线；卡片使用暖黄、浅蓝展示背景、淡凸点和底部阴影；生成按钮使用黄色与轻微厚度效果。
- 预览、配色和步骤区统一深蓝灰文字与边框，保留失败、未知、外观草稿等真实状态。
- 桌面保留原有按钮和工作台布局。窄屏导航横向滚动，防止多行导航挤入主标题。主题作用域限于汽车页面，其他页面不采用这套背景。

新装饰和背景由本地 SVG/CSS 构成，无外部图片、字体、CDN 或新增模型调用。未复制第三方网站模板或商标图形。

## 验收入口

- [原页面](../artifacts/vehicle-visual-2026-11-08/before.png)、[新版完整页面](../artifacts/vehicle-visual-2026-11-08/charger-production.png)、[手机页面](../artifacts/vehicle-visual-2026-11-08/mobile-production.png)。
- [原控件位置](../artifacts/vehicle-visual-2026-11-08/before-layout.json)、[新版位置与差值](../artifacts/vehicle-visual-2026-11-08/after-layout.json)：1440 宽度下八个主要区域的位置和尺寸差值均为零。
- [生产构建的适配检查](../artifacts/vehicle-visual-2026-11-08/responsive-checks.json)：1440、1366、1024、768、390 五种宽度无横向溢出，导航不覆盖标题，其他页面主题未受影响。
- [模型与算法文件完整性](../artifacts/vehicle-visual-2026-11-08/model-integrity.json)：原外观示例、结构示例、几何渲染器、结构和步骤源文件字节不变。
- [两车完整版及离线交互回归](../artifacts/vehicle-visual-2026-11-08/browser-checked/checks.json)：实际视角、内部显隐、逐件步骤、播放、配色、完整导出和重开，无模拟接口。

类型检查与生产构建通过，构建仍提示既有的大 JS 分块。此次没有重新运行与静态主题无关的全量结构单元测试。首次浏览器脚本在固定 150 毫秒后检查步骤，读到上一步的渲染状态；改为等待实际显示成员数量后复验，没有修改应用逻辑来绕过断言。

## 本地与离线使用

启动方式保持不变：在项目根目录运行 `npm.cmd ci`，随后 `npm.cmd run preview`，打开 `http://localhost:3000/vehicle-generator`。

新版单文件位于根目录 `OPEN_STRUCTURAL_DEMO.html`，压缩包为 `Bricklab_Structural_Draft.zip`；生成记录另存于 `artifacts/vehicle-visual-2026-11-08/offline/`，旧结构交付目录保留。完整版离线缓存命名空间更新到 `bricklab-structure-demo-v5`，没有更改研究缓存键或模型版本。

云浏览器的文件直开限制继续单独记录；不能把经本地 HTTP 加载、停服并禁网的检查宣称为 `file://` 直开通过。当前整车连接、轮组、安装路径和实物状态没有因界面美化而提升。
