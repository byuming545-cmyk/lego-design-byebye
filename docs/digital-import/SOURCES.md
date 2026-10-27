# 试点数字零件来源与允许的操作

核对日期：2026-10-25（Asia/Shanghai）。这是本项目本轮的来源准入政策，不把可访问、软件附带或编号相同当作复制许可。本轮逐文件准入由 `src/parts/digitalImport/sources.ts` 实现；实际导入还须核验原始字节、哈希、文件头和依赖，之后再做装配验证。

| 来源 | 本轮用途与准入 | 许可、限制及证据 |
| --- | --- | --- |
| LDraw Parts Library 固定镜像 | 几何允许：固定 Pybricks 修订 `c43ed06a128a10ed65675166bf42eb6fd608b9b0`，只用审阅的原文件及递归依赖 | 原包 732 个文件中 689 个声明 CC BY 4.0、43 个声明 CC BY 2.0 / CC BY 4.0 双许可。保留逐文件 Author/History/许可、固定 URL、SHA、署名及许可文本；不同资源逐件核验，不按镜像仓库代码许可推断 |
| LDCad Shadow Library | 连接数据允许：固定修订 `9b1131fb1991f8c0bfc072325e4e12f6271aba35` | CC-BY-SA-4.0；保留作者、来源、许可文本及来源/衍生连接记录的 share-alike 义务。它是社区连接辅助资料，解析成功不代表机械装配已验证 |
| Rebrickable 官方 API | 尚未启用本轮新数据准入；未来仅在授权及条款核验后获取库存、编号、颜色 | 当前没有配置 API 密钥；不发送未授权请求。遵守官方当前公布的速率、用途和再分发限制；本轮不编造一个未核实的速率数字 |
| Rebrickable 官方批量下载 | 后续大量表数据的优先评估渠道；本轮未下载 | 应先核对下载与再分发条件，再选择批量表或增量更新，不能把任意镜像视作官方替代渠道 |
| 已有 Rebrickable 表镜像记录 | 只保留既有历史线索和冲突状态；不下载更多、不给几何准入 | `mappings/manifest.json` 明确 dataLicense 未独立核定。构建程序的 MIT 许可不是数据许可。531 条 source-observed 记录不能宣称官方验证或直接证明 Element→LDraw 身份 |
| BrickLink 公开网页 | 无自动化获取、复制或监控 | 按用户提供的本轮约束，未有事先书面许可不得使用自动化或人工流程监控、复制网页。没有提供许可，本轮未请求任何 BrickLink 网页；不反向工程内部接口或绕过访问限制 |
| BrickLink 授权公开 API | 尚无授权及已审阅数据用途，不接入 | 未来需先确认 API 凭据、scope、条款和再分发权限。API 可用不自动证明数据可以嵌入公开部署 |
| BrickLink Studio / `.conn` | 无数据导入适配器，不复制安装资源 | 可在允许访问时调查官方格式和工作流程；`.conn` 存在不代表安装目录可自由复制。当前未提供具体资源许可，不导入、打包或分发 Studio 几何和连接文件 |
| 用户上传说明书及附录观察 | 需求排序、套装/页码线索、结构参考 | 不从图片重建现成零件；附录库存不证明几何或接口。原始 PDF 不因用户上传就获得公开再分发许可，本轮不纳入公开部署包 |

## 本轮实际访问观察

读取了当前云环境运行状态和本机网络政策；运行状态报告网络 enforcement 状态为 `unknown`，本机配置为 restricted。以下记录不把配置缺口误报为真实 HTTP 403：

- `www.ldraw.org`、`ldraw.org`、`rebrickable.com`、`cdn.rebrickable.com` 不在配置允许域名集合中，因此本来源审阅没有对它们发出请求。状态是 **NOT_ATTEMPTED_NETWORK_POLICY**，不是“官方网站拒绝了本次请求”。
- `REBRICKABLE_API_KEY` 仅检查是否配置，结果未配置，没有打印密钥内容。官方 API 状态同时受凭据缺失阻止。
- BrickLink 网页/API 与 Studio 资源因没有相应许可或授权证据，状态为 **NOT_ATTEMPTED_PERMISSION**。没有尝试验证码、代理切换、内部接口、安装目录复制或其他绕过手段。
- 已有 LDraw/Shadow 固定文件、清单、许可和作者信息可以从本地读取。试点若另行请求同一获准 GitHub 源包，真实 URL、状态、时间、校验结果由该次获取日志单独记录，不能用本表代替实际获取记录。
- 用户此前粘贴的 Cloudflare 拒绝页面只证明当时某次访问被安全服务阻止；无法从该信息判断是 AI 检测，本轮也不作此归因。

## 许可证据与官方入口

本轮准入依据是已保存的原始许可与源文件声明，未声称重新取得官方网站的条款页面：

- LDraw：`data/parts-foundation/ldraw/{manifest.json,CAreadme.txt,CAlicense.txt,CAlicense4.txt}`；各 `.dat` 的 Author/!LICENSE/!HISTORY 保留。`CAreadme.txt` 自身说明它是参考说明，完整法律许可另存于 licence 文件。
- Shadow：`data/parts-foundation/shadow/{manifest.json,LICENSE.md,IMPORT_NOTES.md}`，来源修订和许可与 LDraw 分别保存。
- 既有镜像：`data/parts-foundation/mappings/manifest.json` 的 `upstreamTablesFetchedDirectly:false`、`dataLicense:not-independently-verified` 仍然生效，不升级其可信或许可状态。
- 供后续获准访问核对的官方入口：[LDraw](https://www.ldraw.org/)、[Rebrickable API](https://rebrickable.com/api/)、[Rebrickable 下载](https://rebrickable.com/downloads/)、[BrickLink API](https://www.bricklink.com/v3/api.page)。列出链接不表示本轮已访问、获授权或接受了其当前条款。

## 后续批量获取的边界

1. 先基于可用说明书和库存观察形成需求；保留原编号、命名空间、候选及冲突，不用外观或数字相同升级身份。
2. 只获取已经审阅许可的、固定版本的几何与连接源。没有许可、网络不允许、依赖缺失或哈希不符时停止对应项，不跨站“补一个像的”。
3. 明确区分获准下载、获准处理和获准再分发；新源或新修订必须重新审阅。库存/颜色资料不能作为几何许可证。
4. 源导入成功只说明来源与格式检查通过；新的接口仍须验证后逐项开放，软件装配成功不等于实物拼搭认证。
