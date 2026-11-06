# 车辆平台（本轮重新实现）

入口 `/`、`/vehicle-generator`。输入品牌、型号、年份和版本后点生成；无上传图片的标准流程。现阶段输出研究证据、视觉约束（服务可用时）和独立局部支撑，**不输出已完成的 Charger**。

## 运行与复验

在 `/workspace/lego-design-byebye` 使用 Node >=24.5：

```bash
npm ci --cache /workspace/.npm-cache
npm run build
INVENTORY_PROVIDER=mock npm run dev
# 新模块、HTTP、缓存、并发与预算合同（均不调用收费模型）
npm test -- --maxWorkers=1 tests/vehicles.test.ts tests/vehicles-api.test.ts tests/vehicles-network.test.ts tests/vehicles-capacity.test.ts
# 完整仓库回归
npm test -- --maxWorkers=1
# 先构建，再运行浏览器回归；用专用临时目录隔离保存模型
VEHICLE_BROWSER_DATA_DIR=/tmp/bricklab-vehicle-browser-verified npx playwright test --config playwright.vehicle.config.ts
```

浏览器回归使用 `/usr/bin/chromium`；前两项用可控 HTTP 响应验证表单与状态流，第三项重开本轮真实任务，实际走当前接口与碰撞复验、原生渲染及下载。截图在 `artifacts/vehicle-recovery/`。旧迷你车、Part Lab 和其他页面仍保留。此前上传的私人 Studio 示例不参与测试。

## API 与存储

- `POST /api/vehicles/jobs`：`{make,model,year,variant}`，202 返回任务。
- `GET /api/vehicles/jobs/:id`：轮询持久事件和结果。
- `GET /api/vehicles/jobs/:id/model`：仅已生成的局部模型，先按当前来源、权限与图重验，再返回原生网格。
- `GET /api/vehicles/jobs/:id/model?download=json`：下载当前复验模型，内含真实实例、BOM、连接步骤及来源。

任务目录 `${BRICKLAB_DATA_DIR:-data}/vehicle-platform/:uuid/` 保存原始研究数据、图片及 job.json，原子更新。查询参数 `?job=uuid` 可重开；中断任务不自动重试研究或付费调用。并发容量为 2。图片由候选来源自动获取，按明确许可、作者、年份和版本标题筛选；标题始终不等于视觉身份确认。

公共 HTTP 响应缓存最多 24 小时，读取检查字节哈希；当前候选精确哈希去重，不声称完成感知去重。请求禁用重定向，固定 HTTPS 域名，保留 TLS 与平台代理；403/429 持久退避，不更换路线绕过访问限制。Wikipedia 提取是有意保守的模板子集：按独立代际信息框和明示年份范围筛选，处理 `MY1967`、`1968-69`；缺字段、非支持模板、冲突和精确版本不明均保留状态。不是全网车型目录或所有百科模板的完整解析器。

## 视觉与预算

默认 DashScope `qwen3-vl-plus` **别名**，不是已锁定的未知快照。北京固定 `dashscope.aliyuncs.com`，新加坡固定 `dashscope-intl.aliyuncs.com`，不由请求提供自定义地址。OpenAI 仅 `VEHICLE_VISION_PROVIDER=openai` 显式启用，使用自身密钥，无跨供应商自动回退。

请在环境设置安全绑定 `DASHSCOPE_API_KEY`；不在聊天、仓库或前端保存值。已保存北京目的地主机的缺失密钥要求；草稿保存没有实际注入凭证，也没有发布环境。本轮读取的运行实例未绑定该凭证。

默认预算变量都是 0。仅执行此前授权的一次真实测试时，应将 `VEHICLE_VISION_MAX_REQUESTS_PER_DAY=1`，`VEHICLE_VISION_DAILY_BUDGET_MICRO_USD` 和 `VEHICLE_VISION_RESERVE_MICRO_USD` 设为同一明确预留金额；不要开启无上限重试。每日以 UTC 分桶。程序在发送前独占锁定、持久预留；失败/超时也消耗此次次数，不自动退款重试。预算是本地预留账，不是供应商人民币账单硬上限，不能将未核定的价格当作真值。

每次最多 4000 输出 Token，DashScope 非思考 JSON Object；本地严格验证字段、全部图片 ID、身份/视角枚举、唯一约束和有限区间。供应商 JSON 模式不意味着强制 JSON Schema。请求摘要、原始响应、实际模型/usage、截断或失败原因分别留存；缓存绑定车型、图片哈希、Provider、区域、模型和合同，后续调试复盘响应，避免反复收费。3 张以下图片或缺密钥/预算会在发送前停止。

## 仍然缺少

量化合同到通用设计目标已有，但尚无真实视觉输出，本轮真实调用 0 次。尚未实现约束驱动的完整车身装配、完整轮组、整车稳定性、有界整车修复与整车实拼说明书。5 件支撑只证明现有通用接口语法和引擎的局部回归，不能满足整车验收。视觉也不能授权 LEGO 几何或接口。
