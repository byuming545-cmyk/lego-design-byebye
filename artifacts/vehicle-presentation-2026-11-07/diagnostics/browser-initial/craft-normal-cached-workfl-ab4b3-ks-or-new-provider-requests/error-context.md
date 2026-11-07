# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: craft.spec.ts >> normal cached workflow executes both craft controls without route mocks or new provider requests
- Location: tests/vehicle-body-browser/craft.spec.ts:18:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText(/本功能未训练或微调模型/)
Expected: visible
Error: strict mode violation: getByText(/本功能未训练或微调模型/) resolved to 2 elements:
    1) <p>外观草稿；整车装配、轮组配合和实物可拼未验证。本功能未训练或微调模型。</p> aka getByText('外观草稿；整车装配、轮组配合和实物可拼未验证。本功能未训练或微调模型。')
    2) <p>…</p> aka getByText('资料库 4 个设计家族 / 2 个来源；实际采用 0')

Call log:
  - Expect "toBeVisible" getByText(/本功能未训练或微调模型/) with timeout 30000ms
  - waiting for getByText(/本功能未训练或微调模型/)

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - banner [ref=e4]:
    - link "Bricklab 首页" [ref=e5] [cursor=pointer]:
      - /url: "#"
      - generic [ref=e10]: bricklab.
    - navigation "主导航" [ref=e11]:
      - button "真实零件库" [ref=e12] [cursor=pointer]
      - button "接口与拼接库" [ref=e13] [cursor=pointer]
      - button "车型生成" [ref=e14] [cursor=pointer]
      - button "迷你跑车" [ref=e15] [cursor=pointer]
      - button "通用创意" [ref=e16] [cursor=pointer]
      - button "Speed Creative" [ref=e17] [cursor=pointer]
      - button "自由汽车设计" [ref=e18] [cursor=pointer]
      - button "我的拼搭指南" [disabled] [ref=e19]
    - button "VEHICLE DESIGN · 两车演示原型" [ref=e20] [cursor=pointer]:
      - text: VEHICLE DESIGN
      - generic [ref=e22]: · 两车演示原型
  - main [ref=e26]:
    - generic [ref=e27]:
      - generic [ref=e28]:
        - paragraph [ref=e29]: BRICKLAB / AUTOMOTIVE STUDIO
        - heading [level=1] [ref=e31]:
          - text: 把喜欢的车，
          - emphasis [ref=e32]: 变成积木。
        - paragraph [ref=e33]: 从车型资料到真实零件，让比例、轮廓与拼搭工艺一起参与设计。
      - generic [ref=e34]:
        - strong [ref=e38]: 两款车型 · 一个生成流程
        - generic [ref=e39]: 课堂演示版本 / 外观设计原型
        - generic [ref=e40]: 资料驱动 · 原生几何 · 可追溯工艺
    - generic [ref=e41]:
      - generic [ref=e42]: 01 / 选择一辆车开始
      - generic [ref=e43]: 已准备资料的演示车型
    - region "演示车型" [ref=e44]:
      - article [ref=e45]:
        - generic [ref=e46]:
          - generic [ref=e47]: "01"
          - img "Dodge Charger R/T 实际积木模型截图" [ref=e48]
        - generic [ref=e49]:
          - text: 1969 · 长机盖硬顶
          - heading "Dodge Charger R/T" [level=2] [ref=e50]
          - paragraph [ref=e51]: 长机盖、宽前脸与后置硬顶座舱。
          - generic [ref=e52]:
            - button "生成这款车" [ref=e53] [cursor=pointer]
            - button "打开已保存示例" [ref=e56] [cursor=pointer]
      - article [ref=e59]:
        - generic [ref=e60]:
          - generic [ref=e61]: "02"
          - img "Volkswagen Golf GTI Mk1 实际积木模型截图" [ref=e62]
        - generic [ref=e63]:
          - text: 1976 · 紧凑两厢
          - heading "Volkswagen Golf GTI Mk1" [level=2] [ref=e64]
          - paragraph [ref=e65]: 短机盖、较高座舱与紧凑两厢车尾。
          - generic [ref=e66]:
            - button "生成这款车" [ref=e67] [cursor=pointer]
            - button "打开已保存示例" [ref=e70] [cursor=pointer]
    - generic [ref=e73]:
      - complementary [ref=e74]:
        - paragraph [ref=e75]: 02 / 车型输入
        - heading "设计工作台" [level=2] [ref=e76]
        - paragraph [ref=e77]: 两款演示车复用已缓存资料，点击后重新选件与生成。
        - generic [ref=e78]:
          - generic [ref=e79]:
            - text: 品牌
            - textbox "品牌" [ref=e80]: Dodge
          - generic [ref=e81]:
            - text: 型号
            - textbox "型号" [ref=e82]: Charger
          - generic [ref=e83]:
            - text: 年份
            - spinbutton "年份" [ref=e84]: "1969"
          - generic [ref=e85]:
            - text: 版本
            - textbox "版本" [ref=e86]: R/T
          - generic [ref=e87]:
            - checkbox "使用已有拼搭工艺" [ref=e88]
            - text: 使用已有拼搭工艺
          - button "生成" [ref=e89] [cursor=pointer]
        - generic [ref=e98]:
          - text: 使用已缓存资料
          - generic [ref=e99]: Charger：复用此前真实照片分析
        - paragraph [ref=e100]: 离线示例已准备
        - group [ref=e103]:
          - generic "演示范围" [ref=e104] [cursor=pointer]
      - generic [ref=e108]:
        - generic [ref=e109]:
          - generic [ref=e110]:
            - paragraph [ref=e111]: 03 / REAL PARTS, REAL GEOMETRY
            - heading "完整汽车外观预览" [level=2] [ref=e112]
          - generic [ref=e113]: 外观草稿
        - generic "实际生成流程" [ref=e114]:
          - generic [ref=e115]: 车型资料
          - generic [ref=e120]: 比例规划
          - generic [ref=e125]: 工艺检索
          - generic [ref=e130]: 真实选件
          - generic [ref=e135]: 生成与检查
        - generic [ref=e140]:
          - strong [ref=e141]: 1969 Dodge Charger R/T
          - generic [ref=e142]: 当前引擎实际生成
        - generic "模型视角" [ref=e143]:
          - button "斜侧" [pressed] [ref=e144] [cursor=pointer]
          - button "侧面" [ref=e145] [cursor=pointer]
          - button "正面" [ref=e146] [cursor=pointer]
          - button "背面" [ref=e147] [cursor=pointer]
          - button "俯视" [ref=e148] [cursor=pointer]
        - generic [ref=e150]:
          - img "真实积木汽车三维预览" [ref=e152]
          - generic: 真实零件外观草稿 · 拖动旋转
          - button "重置视角" [ref=e153] [cursor=pointer]
        - generic [ref=e157]:
          - generic [ref=e158]:
            - strong [ref=e162]: "142"
            - generic [ref=e163]: 真实零件实例
          - generic [ref=e164]:
            - strong [ref=e169]: "17"
            - generic [ref=e170]: 原生零件种类
          - generic [ref=e171]:
            - strong [ref=e175]: "0"
            - generic [ref=e176]: 采用的工艺家族
          - generic [ref=e177]:
            - strong [ref=e178]: "8"
            - generic [ref=e179]: 格车身宽度
        - paragraph [ref=e180]: 整车连接未验证 · 轮组与稳定性未知 · 步骤为外观分组草稿
        - generic [ref=e181]:
          - button "保存当前任务" [ref=e182] [cursor=pointer]
          - button "模型 JSON" [ref=e185] [cursor=pointer]
          - button "零件清单" [ref=e188] [cursor=pointer]
    - generic [ref=e189]:
      - generic [ref=e190]:
        - generic [ref=e191]: 04 / 设计依据与验证详情
        - generic [ref=e192]: 模型、来源与实际 BOM 一致
      - group [ref=e193]:
        - generic "本次使用的拼搭工艺" [active] [ref=e194] [cursor=pointer]
        - paragraph [ref=e197]: 资料库 4 个设计家族 / 2 个来源；实际采用 0 个家族、0 次组合。本功能未训练或微调模型。
        - generic [ref=e198]: "[ { \"query\": { \"region\": \"nose-cover\", \"size\": [ 40, 16.00006098, 60 ], \"twinGrille\": false }, \"candidates\": [ { \"caseId\": \"75878-curved-cover-left\", \"familyId\": \"design-d1bb1084b0e83221\", \"sourceSet\": \"75878\", \"rotation\": [ 1, 0, 0, 0, 1, 0, 0, 0, 1 ], \"bounds\": { \"min\": [ -20, -8.00006098, -40 ], \"max\": [ 20, 8, 20 ] }, \"size\": [ 40, 16.00006098, 60 ], \"score\": 0.003, \"reasons\": [ \"RETRIEVAL_DISABLED\" ], \"eligible\": false }, { \"caseId\": \"75878-curved-cover-right\", \"familyId\": \"design-d1bb1084b0e83221\", \"sourceSet\": \"75878\", \"rotation\": [ -1, 0, 0, 0, 1, 0, 0, 0, -1 ], \"bounds\": { \"min\": [ -20, -8.00006098, -40 ], \"max\": [ 20, 8, 20 ] }, \"size\": [ 40, 16.00006098, 60 ], \"score\": 0.003, \"reasons\": [ \"RETRIEVAL_DISABLED\" ], \"eligible\": false }, { \"caseId\": \"76897-rear-panel-core\", \"familyId\": \"design-60304e6e046a88c2\", \"sourceSet\": \"76897\", \"rotation\": [ 1, 0, 0, 0, 1, 0, 0, 0, 1 ], \"bounds\": { \"min\": [ -60, -16, -10 ], \"max\": [ 60, 8, 10 ] }, \"size\": [ 120, 24, 20 ], \"score\": 128.00293901999999, \"reasons\": [ \"RETRIEVAL_DISABLED\", \"NO_CURVED_SURFACE_PATTERN\", \"NO_SOURCE_SLOPE_DIRECTION\", \"NATIVE_FOOTPRINT_OR_HEIGHT_MISMATCH\" ], \"eligible\": false }, { \"caseId\": \"76897-spoiler-blade\", \"familyId\": \"design-645c51895f4f0a71\", \"sourceSet\": \"76897\", \"rotation\": [ 1, 0, 0, 0, 1, 0, 0, 0, 1 ], \"bounds\": { \"min\": [ -80, -15.6, -30 ], \"max\": [ 80, 15.9441, 10.000647 ] }, \"size\": [ 160, 31.5441, 40.000647 ], \"score\": 155.55139202, \"reasons\": [ \"RETRIEVAL_DISABLED\", \"CURRENT_ENGINE_BLOCKED\", \"NATIVE_FOOTPRINT_OR_HEIGHT_MISMATCH\" ], \"eligible\": false }, { \"caseId\": \"76897-hood-core\", \"familyId\": \"design-b69226d7dddd013d\", \"sourceSet\": \"76897\", \"rotation\": [ 1, 0, 0, 0, 1, 0, 0, 0, 1 ], \"bounds\": { \"min\": [ -80, -16, -10 ], \"max\": [ 80, 8, 10 ] }, \"size\": [ 160, 24, 20 ], \"score\": 168.00493902, \"reasons\": [ \"RETRIEVAL_DISABLED\", \"NO_CURVED_SURFACE_PATTERN\", \"NO_SOURCE_SLOPE_DIRECTION\", \"NATIVE_FOOTPRINT_OR_HEIGHT_MISMATCH\" ], \"eligible\": false }, { \"caseId\": \"76897-hood-adapted\", \"familyId\": \"design-b69226d7dddd013d\", \"sourceSet\": \"76897\", \"rotation\": [ 1, 0, 0, 0, 1, 0, 0, 0, 1 ], \"bounds\": { \"min\": [ -80, -16, -10 ], \"max\": [ 80, 8, 10 ] }, \"size\": [ 160, 24, 20 ], \"score\": 168.00693902, \"reasons\": [ \"RETRIEVAL_DISABLED\", \"NO_CURVED_SURFACE_PATTERN\", \"NO_SOURCE_SLOPE_DIRECTION\", \"NATIVE_FOOTPRINT_OR_HEIGHT_MISMATCH\" ], \"eligible\": false } ], \"attempts\": [] }, { \"query\": { \"region\": \"front-fascia\", \"size\": [ 160, 20, 24 ], \"twinGrille\": true }, \"candidates\": [ { \"caseId\": \"76897-hood-core\", \"familyId\": \"design-b69226d7dddd013d\", \"sourceSet\": \"76897\", \"rotation\": [ 1, 0, 0, 0, 0, -1, 0, 1, 0 ], \"bounds\": { \"min\": [ -80, -10, -16 ], \"max\": [ 80, 10, 8 ] }, \"size\": [ 160, 20, 24 ], \"score\": 0.005, \"reasons\": [ \"RETRIEVAL_DISABLED\", \"NO_PAIRED_FACE_TILES\" ], \"eligible\": false }, { \"caseId\": \"76897-hood-adapted\", \"familyId\": \"design-b69226d7dddd013d\", \"sourceSet\": \"76897\", \"rotation\": [ 1, 0, 0, 0, 0, -1, 0, 1, 0 ], \"bounds\": { \"min\": [ -80, -10, -16 ], \"max\": [ 80, 10, 8 ] }, \"size\": [ 160, 20, 24 ], \"score\": 0.007, \"reasons\": [ \"RETRIEVAL_DISABLED\" ], \"eligible\": false }, { \"caseId\": \"76897-spoiler-blade\", \"familyId\": \"design-645c51895f4f0a71\", \"sourceSet\": \"76897\", \"rotation\": [ 1, 0, 0, 0, 0, -1, 0, 1, 0 ], \"bounds\": { \"min\": [ -80, -10.000647, -15.6 ], \"max\": [ 80, 30, 15.9441 ] }, \"size\": [ 160, 40.000647, 31.5441 ], \"score\": 27.552747, \"reasons\": [ \"RETRIEVAL_DISABLED\", \"CURRENT_ENGINE_BLOCKED\", \"NO_SOURCE_GRILLE_FEATURE\", \"NO_PAIRED_FACE_TILES\", \"NATIVE_FOOTPRINT_OR_HEIGHT_MISMATCH\" ], \"eligible\": false }, { \"caseId\": \"76897-rear-panel-core\", \"familyId\": \"design-60304e6e046a88c2\", \"sourceSet\": \"76897\", \"rotation\": [ 1, 0, 0, 0, 0, -1, 0, 1, 0 ], \"bounds\": { \"min\": [ -60, -10, -16 ], \"max\": [ 60, 10, 8 ] }, \"size\": [ 120, 20, 24 ], \"score\": 40.003, \"reasons\": [ \"RETRIEVAL_DISABLED\", \"NO_SOURCE_GRILLE_FEATURE\", \"NO_PAIRED_FACE_TILES\", \"NATIVE_FOOTPRINT_OR_HEIGHT_MISMATCH\" ], \"eligible\": false }, { \"caseId\": \"75878-curved-cover-left\", \"familyId\": \"design-d1bb1084b0e83221\", \"sourceSet\": \"75878\", \"rotation\": [ 1, 0, 0, 0, 0, -1, 0, 1, 0 ], \"bounds\": { \"min\": [ -20, -20, -8.00006098 ], \"max\": [ 20, 40, 8 ] }, \"size\": [ 40, 60, 16.00006098 ], \"score\": 168.00293901999999, \"reasons\": [ \"RETRIEVAL_DISABLED\", \"NO_SOURCE_GRILLE_FEATURE\", \"NO_PAIRED_FACE_TILES\", \"NATIVE_FOOTPRINT_OR_HEIGHT_MISMATCH\" ], \"eligible\": false }, { \"caseId\": \"75878-curved-cover-right\", \"familyId\": \"design-d1bb1084b0e83221\", \"sourceSet\": \"75878\", \"rotation\": [ 1, 0, 0, 0, 0, -1, 0, 1, 0 ], \"bounds\": { \"min\": [ -20, -40, -8.00006098 ], \"max\": [ 20, 20, 8 ] }, \"size\": [ 40, 60, 16.00006098 ], \"score\": 168.00293901999999, \"reasons\": [ \"RETRIEVAL_DISABLED\", \"NO_SOURCE_GRILLE_FEATURE\", \"NO_PAIRED_FACE_TILES\", \"NATIVE_FOOTPRINT_OR_HEIGHT_MISMATCH\" ], \"eligible\": false } ], \"attempts\": [] }, { \"query\": { \"region\": \"window\", \"size\": [ 160, 30.97833897957088, 120.00000000000004 ], \"twinGrille\": false }, \"candidates\": [ { \"caseId\": \"76897-spoiler-blade\", \"familyId\": \"design-645c51895f4f0a71\", \"sourceSet\": \"76897\", \"rotation\": [ 1, 0, 0, 0, 1, 0, 0, 0, 1 ], \"bounds\": { \"min\": [ -80, -15.6, -30 ], \"max\": [ 80, 15.9441, 10.000647 ] }, \"size\": [ 160, 31.5441, 40.000647 ], \"score\": 80.57311402042916, \"reasons\": [ \"RETRIEVAL_DISABLED\", \"CURRENT_ENGINE_BLOCKED\", \"NO_REVIEWED_COCKPIT_SOURCE\", \"NATIVE_FOOTPRINT_OR_HEIGHT_MISMATCH\" ], \"eligible\": false }, { \"caseId\": \"76897-hood-core\", \"familyId\": \"design-b69226d7dddd013d\", \"sourceSet\": \"76897\", \"rotation\": [ 1, 0, 0, 0, 1, 0, 0, 0, 1 ], \"bounds\": { \"min\": [ -80, -16, -10 ], \"max\": [ 80, 8, 10 ] }, \"size\": [ 160, 24, 20 ], \"score\": 106.98333897957092, \"reasons\": [ \"RETRIEVAL_DISABLED\", \"NO_REVIEWED_COCKPIT_SOURCE\", \"NATIVE_FOOTPRINT_OR_HEIGHT_MISMATCH\" ], \"eligible\": false }, { \"caseId\": \"76897-hood-adapted\", \"familyId\": \"design-b69226d7dddd013d\", \"sourceSet\": \"76897\", \"rotation\": [ 1, 0, 0, 0, 1, 0, 0, 0, 1 ], \"bounds\": { \"min\": [ -80, -16, -10 ], \"max\": [ 80, 8, 10 ] }, \"size\": [ 160, 24, 20 ], \"score\": 106.98533897957093, \"reasons\": [ \"RETRIEVAL_DISABLED\", \"NO_REVIEWED_COCKPIT_SOURCE\", \"NATIVE_FOOTPRINT_OR_HEIGHT_MISMATCH\" ], \"eligible\": false }, { \"caseId\": \"76897-rear-panel-core\", \"familyId\": \"design-60304e6e046a88c2\", \"sourceSet\": \"76897\", \"rotation\": [ 1, 0, 0, 0, 1, 0, 0, 0, 1 ], \"bounds\": { \"min\": [ -60, -16, -10 ], \"max\": [ 60, 8, 10 ] }, \"size\": [ 120, 24, 20 ], \"score\": 146.98133897957092, \"reasons\": [ \"RETRIEVAL_DISABLED\", \"NO_REVIEWED_COCKPIT_SOURCE\", \"NATIVE_FOOTPRINT_OR_HEIGHT_MISMATCH\" ], \"eligible\": false }, { \"caseId\": \"75878-curved-cover-left\", \"familyId\": \"design-d1bb1084b0e83221\", \"sourceSet\": \"75878\", \"rotation\": [ 1, 0, 0, 0, 1, 0, 0, 0, 1 ], \"bounds\": { \"min\": [ -20, -8.00006098, -40 ], \"max\": [ 20, 8, 20 ] }, \"size\": [ 40, 16.00006098, 60 ], \"score\": 194.98127799957092, \"reasons\": [ \"RETRIEVAL_DISABLED\", \"NO_REVIEWED_COCKPIT_SOURCE\", \"NATIVE_FOOTPRINT_OR_HEIGHT_MISMATCH\" ], \"eligible\": false }, { \"caseId\": \"75878-curved-cover-right\", \"familyId\": \"design-d1bb1084b0e83221\", \"sourceSet\": \"75878\", \"rotation\": [ 1, 0, 0, 0, 1, 0, 0, 0, 1 ], \"bounds\": { \"min\": [ -20, -8.00006098, -20 ], \"max\": [ 20, 8, 40 ] }, \"size\": [ 40, 16.00006098, 60 ], \"score\": 194.98127799957092, \"reasons\": [ \"RETRIEVAL_DISABLED\", \"NO_REVIEWED_COCKPIT_SOURCE\", \"NATIVE_FOOTPRINT_OR_HEIGHT_MISMATCH\" ], \"eligible\": false } ], \"attempts\": [] } ]"
      - group [ref=e199]:
        - generic "比例规划与来源证据" [ref=e200] [cursor=pointer]
      - group [ref=e203]:
        - generic "零件、草稿步骤与重新导入" [ref=e204] [cursor=pointer]
      - group [ref=e207]:
        - generic "实际任务日志与装配范围" [ref=e208] [cursor=pointer]
    - generic [ref=e211]:
      - generic [ref=e212]: BRICKLAB · 从资料到积木的设计实验
      - generic [ref=e213]: 两款案例验证 / 非任意车型质量保证
```

# Test source

```ts
  1  | import { test, expect } from "@playwright/test";
  2  | import { readFile, writeFile, mkdir, cp, readdir } from "node:fs/promises";
  3  | const root = process.env.VEHICLE_BODY_BROWSER_DATA_DIR ?? "/tmp/bricklab-vehicle-body-browser";
  4  | const artifacts = "artifacts/vehicle-presentation-2026-11-07/craft-controls";
  5  | const cases = new Map<string, any>();
  6  | test.beforeAll(async () => {
  7  |     for (const name of ["enabled", "disabled", "holdout-76897", "holdout-75878"]) {
  8  |         const j = JSON.parse(await readFile(`${artifacts}/round-2/${name}/job.json`, "utf8"));
  9  |         cases.set(name, j);
  10 |         const directory = `${root}/vehicle-platform/${j.id}`;
  11 |         await mkdir(directory, { recursive: true });
  12 |         await writeFile(directory + "/job.json", JSON.stringify(j));
  13 |     }
  14 |     // Reuse genuine, locally hash-checked research and vision. The campaign
  15 |     // template stays disabled; a cache miss cannot become an authorized call.
  16 |     await cp("data/vehicle-platform/successful-research", `${root}/vehicle-platform/successful-research`, { recursive: true });
  17 | });
  18 | test("normal cached workflow executes both craft controls without route mocks or new provider requests", async ({ page, request }) => {
  19 |     for (const enabled of [false, true]) {
  20 |         await page.goto("/vehicle-generator");
  21 |         await page.getByRole("checkbox", { name: "使用已有拼搭工艺" }).setChecked(enabled);
  22 |         const created = page.waitForResponse(r => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/vehicles/jobs");
  23 |         await page.getByRole("button", { name: "生成", exact: true }).click();
  24 |         const response=await created;
  25 |         expect(response.status()).toBe(202);
  26 |         const j = await response.json();
  27 |         expect(j.craftOptions.enabled).toBe(enabled);
  28 |         await expect(page.getByTestId("vehicle-preview-stage").locator("canvas")).toBeVisible({ timeout: 120000 });
  29 |         const result = await (await request.get(`/api/vehicles/jobs/${j.id}`)).json();
  30 |         const name = enabled ? "enabled" : "disabled";
  31 |         expect(result.preview.contentSha256).toBe(cases.get(name).preview.contentSha256);
  32 |         expect(result.preview.layout.craft.options.enabled).toBe(enabled);
  33 |         await writeFile(`${artifacts}/unmocked-${name}-job.json`, JSON.stringify(result, null, 2));
  34 |         await page.getByText("本次使用的拼搭工艺", { exact: true }).click();
> 35 |         await expect(page.getByText(/本功能未训练或微调模型/)).toBeVisible();
     |                                                     ^ Error: expect(locator).toBeVisible() failed
  36 |         await page.screenshot({ path: `${artifacts}/unmocked-${name}-page.png`, fullPage: true });
  37 |     }
  38 |     const cache = await readdir(`${root}/vehicle-platform/vision-cache`).catch((e) => { if (e.code === "ENOENT")
  39 |         return []; throw e; });
  40 |     expect(cache.filter(f => f.endsWith(".request.json"))).toEqual([]);
  41 | });
  42 | test("whole-set holdouts preserve exclusions and explicit context rejections in actual API output", async ({ request, page }) => {
  43 |     for (const set of ["76897", "75878"]) {
  44 |         const j = cases.get("holdout-" + set), r = await request.get(`/api/vehicles/jobs/${j.id}/preview?download=json`);
  45 |         expect(r.ok()).toBe(true);
  46 |         const m = await r.json();
  47 |         expect(m.craftOptions.excludedSourceSets).toEqual([set]);
  48 |         expect(m.layout.craft.selections.every((s: any) => s.sourceSet !== set)).toBe(true);
  49 |         await page.goto("/vehicle-generator?job=" + j.id);
  50 |         await expect(page.getByTestId("vehicle-preview-stage").locator("canvas")).toBeVisible();
  51 |     }
  52 | });
  53 | test("job-bound controls and historical schema cannot be bypassed by an otherwise valid appearance document", async ({ request }) => {
  54 |     const j = cases.get("enabled"), disabled = cases.get("disabled");
  55 |     const r = await request.post(`/api/vehicles/jobs/${j.id}/preview/import`, { data: { content: JSON.stringify(disabled.preview) } });
  56 |     expect(r.status()).toBe(409);
  57 |     const old = await readFile("artifacts/vehicle-presentation-2026-11-07/craft-controls/baseline/model.json", "utf8");
  58 |     expect((await request.post(`/api/vehicles/jobs/${j.id}/preview/import`, { data: { content: old } })).status()).toBe(409);
  59 | });
  60 | test("rejects unsupported control grants before starting research", async ({ request }) => {
  61 |     for (const craftOptions of [{ enabled: true, excludedSourceSets: ["../private"] }, { enabled: true, excludedSourceSets: [], formal: true }]) {
  62 |         expect((await request.post("/api/vehicles/jobs", { data: { make: "Dodge", model: "Charger", year: 1969, variant: "R/T", craftOptions } })).status()).toBe(400);
  63 |     }
  64 | });
  65 |
```
