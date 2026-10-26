# 当前真实零件库 Connector Audit

此报告读取真实固定来源与当前接口语法准入，不执行零件对遍历、试拼或生成夹具。颜色不重复计数。

- 总零件：253；原生几何来源完整：253。
- Canonical connector覆盖：COMPLETE 98 / PARTIAL 151 / NONE 4。
- 原始Shadow解析：ready 205 / partial 44 / missing 4。
- 可用碰撞实体：106；当前grammar generationEligible：99。
- Canonical features：5084；有规则依据的features：4225；生产开放原始端口：2531。
- 需要来源或算法审查的零件：212。该数字不是实物测试清单。
- 零件对试拼：0；零件夹具测试：0；实物验证：0。

## 计数不能混用

历史87件是上一轮逐接口夹具证明口径；本报告的grammar资格来自真实来源、通用规则前提和可用实体表示，不能称为新增完整装配PASS。实际模型必须另行生成、整体校验、导出并重新导入。

原始205/44/4统计语法读取结果；canonical覆盖还检查接口语义是否明确，因此数量不同。COMPLETE不代表全部机械自由度、配合或实物合法性均已验证。

## 已观察接口族

| Family | Features | Parts |
| --- | ---: | ---: |
| STUD | 1949 | 194 |
| ANTISTUD | 2384 | 212 |
| HOLLOW_STUD | 330 | 72 |
| CLIP | 3 | 2 |
| PIN | 2 | 1 |
| PIN_HOLE | 24 | 6 |
| AXLE_HOLE | 6 | 4 |
| GENERIC_SPECIAL | 386 | 93 |

## 未知与来源

未分类canonical feature：384。不能由未知记录猜测“缺失最多的接口族”；report.json保留明确的未解析family hint与识别族的部分覆盖数量。

LDCad原始行、变换、固定版本和SHA保留；LDraw primitive几何继承不被冒充额外连接真值。Studio授权资源覆盖为0，不从软件安装目录复制资源或猜原始type ID映射。

每件详情见parts.csv与report.json：unknown_interfaces、collision_geometry_reason、来源/摘要、topology潜力、生产资格及审查原因均分开保存。大拓扑预算耗尽会明确诊断，不伪称已检查所有接口关系。

## 复现

```sh
npm run audit:connectors
```

- COMPLETE/PARTIAL/NONE concern canonical source interpretation, not successful full-part assembly or physical certification.
- generationEligible is source/rule/solid readiness; each generated or uploaded complete model still requires the normal placement, multi-point and solid checks.
- Building patterns in this audit are topology potential only. No accepted joint or whole-assembly closure is supplied to the classifier.
- Studio source coverage is zero because no authorised Studio resource set is installed. Structured adapters do not invent Studio type mappings.
- manual_verification_needed means outstanding source or algorithm review, not a requirement to physically test every ordinary new part.
- Unparsed directives, scaling and ambiguous source types remain PARTIAL/UNKNOWN. No geometry, interface, tolerance or fit is manufactured.
