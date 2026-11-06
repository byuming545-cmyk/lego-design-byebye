# 车型自动研究与完整外观预览

当前实现及边界见 [本轮交付](VEHICLE_PLATFORM_DELIVERY.md)。入口 `/`、`/vehicle-generator`，输入品牌、型号、年份和版本；标准流程没有图片上传入口。当前能由真实公开资料与真实千问响应生成完整、可旋转的原生零件外观，BOM与草稿步骤来自实际实例。**完整外观不等于正式可拼整车，辨识度仍需提高。**

## 运行

Node >=24.5，仓库目录 `/workspace/lego-design-byebye`：

```bash
npm ci --cache /workspace/.npm-cache
npm run build
INVENTORY_PROVIDER=mock PORT=3001 npm run dev
```

开发前端端口5173，Express API3001；浏览器进入 `/vehicle-generator`，参数 `Dodge / Charger / 1969 / R/T`。本实例已有经过严格验证的真实视觉缓存，重开或重复该输入不再次付费；最终任务ID在 `artifacts/vehicle-body-2026-11-07/api-job-final-id.txt`，可用 `/vehicle-generator?job=<id>` 重开。Git只保留公开证据，真实研究缓存、任务数据库及原图在忽略的data目录；新克隆并不自带该运行数据库。

`DASHSCOPE_API_KEY`由环境安全绑定，不能放入前端或Git；本轮已就绪，不需重新提供。预算模板 `config/vehicle-vision-budget.json` 默认关闭，本轮账本已5次/500分，不再调用。新的研究若无缓存和新授权额度，应明确停止；不要清空账本、换campaign或反复发布环境解锁。详细配置见 [阿里云说明](ALIYUN_VISION_SETUP.md)。

## 数据链与接口

- POST `/api/vehicles/jobs`：仅 `{make,model,year,variant}`，202返回持久任务，自动衔接后续阶段。
- GET `/api/vehicles/jobs/:id`：真实事件、研究、视觉、规划、外观、独立正式结构及状态。中断任务返回明确标记，不自动重试模型。
- GET `/api/vehicles/jobs/:id/preview`：对当前版本与原始来源重新生成对比后返回完整外观和真实网格。
- 同上 `?download=json` 或 `?download=bom`：实际外观模型或编号＋设计色BOM。
- POST `/api/vehicles/jobs/:id/preview/import`：`{content:"JSON文本"}`，仅返回 `APPEARANCE_REOPENED_NOT_FORMAL`；篡改布局、来源、数量、版本、刚体或验证标志均拒绝。
- GET `/api/vehicles/jobs/:id/model`：保留独立已验证局部结构，不把它与整车外观合并成正式通过。
- GET `/api/vehicles/jobs`：保留任务概览；页面“保存当前任务”保留可重开链接。

公开HTTP响应缓存24小时并核对哈希，403/429持久退避，固定HTTPS目的地、拒绝重定向，保留平台代理和TLS信任。图像原字节保留；新依赖 `sharp@0.34.5` 用于受限解码、EXIF方向、1024以内缩放、灰度感知哈希去重，不增造内容。视觉短ID与原哈希映射留档。源零件沿用固定LDraw几何、完整依赖、许可/哈希与Shadow，未新增零件或改写正式规则。

视觉合同1兼容历史；2包含视角、身份、重复、单位明确的比例、截面与特征；3补充图像坐标点。缺失值保持null/缺失；身份/视角/未知ID/单位错误不当成功。矛盾的像素点不驱动摆放。物理尺寸为权威比例锚，视觉高度/屋顶比值仅作显式设计估计，原始响应不修改。程序输出原区间、校正假设、离散化误差和冲突，不能用JSON合法代替事实正确。

## 验证

```bash
npm run typecheck
npm test -- --maxWorkers=1
npm run build
npm test -- --maxWorkers=1 tests/vehicle-body.test.ts
VEHICLE_BODY_BROWSER_DATA_DIR=/tmp/bricklab-vehicle-body-browser npx playwright test --config playwright.vehicle-body.config.ts
```

浏览器配置启动编译预览3012，系统Chromium；测试目录与用户数据库隔离。其中表单展示用受控HTTP响应，真实网格/导入导出/来源复验和旧模式用实际服务。另有本轮未模拟正常页面点击生成的独立记录。五视角截图均为实际WebGL零件渲染。没有通过缩放、镜像、修改.dat、扩大容差或删除BLOCKED分支通过样例。
