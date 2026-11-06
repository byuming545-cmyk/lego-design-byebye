# 当前阿里云视觉配置

运行实例已绑定 `DASHSCOPE_API_KEY`，北京目标 `dashscope.aliyuncs.com`，认证HTTP200。不要重新索要密钥、打印或写到Git/前端。`qwen3-vl-plus`是别名。默认非思考、JSON Object，程序严格校验schema 1历史、2轮廓、3像素点位；JSON模式不是供应商强制Schema。

`config/vehicle-vision-budget.json`是可审查的非秘密预算模板，默认 `enabled:false`。本轮授权副本在 `data/vehicle-body-2026-11-07/approved-budget.json`，账本 `data/vehicle-platform/campaigns/vehicle-body-2026-11-07/ledger.json`，已经5次/500分，停止新增调用。指定副本可用 `VEHICLE_VISION_CAMPAIGN_FILE`，但不能清账、换campaign或改日期以突破授权。模板上限由代码再次限制8次、5元；若未来要新一轮，请先有新的明确额度与价格核对。旧美元预算保留给兼容路径，不与人民币混算。

当前Charger可复用真实分析缓存，不需再付费。服务默认读取模板，即使密钥存在也不会将0或disabled误当放行。缓存绑定合同、图片哈希、输入、Provider/区域/模型；历史响应原文独立保留，失败不自动改成成功。视觉HTTP时限180秒，超时也计尝试；401/403/429不循环重试。

官方定价与本轮实际usage见 `artifacts/vehicle-body-2026-11-07/pricing.json` 和 `usage-and-budget.json`。原图及处理后图在忽略的data目录，Git报告保留许可与来源；不把秘密或私人Studio数据上传。
