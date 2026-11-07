# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: presentation.spec.ts >> two real cached-input generations, five views, repeated generation and persistent reopening
- Location: tests/vehicle-body-browser/presentation.spec.ts:6:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('使用已缓存资料', { exact: true })
Expected: visible
Timeout: 30000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByText('使用已缓存资料', { exact: true }) with timeout 30000ms
  - waiting for getByText('使用已缓存资料', { exact: true })

```

```yaml
- banner:
  - link "Bricklab 首页":
    - /url: "#"
    - img
    - text: bricklab.
  - navigation "主导航":
    - button "真实零件库"
    - button "接口与拼接库"
    - button "车型生成"
    - button "迷你跑车"
    - button "通用创意"
    - button "Speed Creative"
    - button "自由汽车设计"
    - button "我的拼搭指南" [disabled]
  - button "VEHICLE DESIGN · 两车演示原型":
    - text: VEHICLE DESIGN · 两车演示原型
    - img
- main:
  - paragraph: BRICKLAB / AUTOMOTIVE STUDIO
  - heading "把喜欢的车， 变成积木。" [level=1]:
    - text: 把喜欢的车，
    - emphasis: 变成积木。
  - paragraph: 从车型资料到真实零件，让比例、轮廓与拼搭工艺一起参与设计。
  - img
  - strong: 两款车型 · 一个生成流程
  - text: 课堂演示版本 / 外观设计原型 资料驱动 · 原生几何 · 可追溯工艺 01 / 选择一辆车开始 已准备资料的演示车型
  - region "演示车型":
    - article:
      - text: "01"
      - img "Dodge Charger R/T 实际积木模型截图"
      - text: 1969 · 长机盖硬顶
      - heading "Dodge Charger R/T" [level=2]
      - paragraph: 长机盖、宽前脸与后置硬顶座舱。
      - button "生成这款车":
        - text: 生成这款车
        - img
      - button "打开已保存示例":
        - img
        - text: 打开已保存示例
    - article:
      - text: "02"
      - img "Volkswagen Golf GTI Mk1 实际积木模型截图"
      - text: 1976 · 紧凑两厢
      - heading "Volkswagen Golf GTI Mk1" [level=2]
      - paragraph: 短机盖、较高座舱与紧凑两厢车尾。
      - button "生成这款车":
        - text: 生成这款车
        - img
      - button "打开已保存示例":
        - img
        - text: 打开已保存示例
  - complementary:
    - paragraph: 02 / 车型输入
    - heading "设计工作台" [level=2]
    - paragraph: 两款演示车复用已缓存资料，点击后重新选件与生成。
    - text: 品牌
    - textbox "品牌": Dodge
    - text: 型号
    - textbox "型号": Charger
    - text: 年份
    - spinbutton "年份": "1969"
    - text: 版本
    - textbox "版本": R/T
    - checkbox "使用已有拼搭工艺" [checked]
    - text: 使用已有拼搭工艺
    - button "生成":
      - img
      - text: 生成
    - img
    - text: 使用已缓存资料 Charger：复用此前真实照片分析
    - paragraph:
      - img
      - text: 离线示例已准备
    - group:
      - img
      - text: 演示范围
  - paragraph: 03 / REAL PARTS, REAL GEOMETRY
  - heading "完整汽车外观预览" [level=2]
  - text: 外观草稿
  - img
  - text: 车型资料
  - img
  - text: 比例规划
  - img
  - text: 工艺检索
  - img
  - text: 真实选件
  - img
  - text: 生成与检查
  - strong: 1969 Dodge Charger R/T
  - text: 当前引擎实际生成
  - button "斜侧" [pressed]
  - button "侧面"
  - button "正面"
  - button "背面"
  - button "俯视"
  - img "真实积木汽车三维预览"
  - text: 真实零件外观草稿 · 拖动旋转
  - button "重置视角":
    - img
    - text: 重置视角
  - img
  - strong: "158"
  - text: 真实零件实例
  - img
  - strong: "21"
  - text: 原生零件种类
  - img
  - strong: "2"
  - text: 采用的工艺家族
  - strong: "8"
  - text: 格车身宽度
  - paragraph: 整车连接未验证 · 轮组与稳定性未知 · 步骤为外观分组草稿
  - button "保存当前任务":
    - img
    - text: 保存当前任务
  - button "模型 JSON":
    - img
    - text: 模型 JSON
  - button "零件清单"
  - text: 04 / 设计依据与验证详情 模型、来源与实际 BOM 一致
  - group:
    - text: 本次使用的拼搭工艺
    - img
  - group:
    - text: 比例规划与来源证据
    - img
  - group:
    - text: 零件、草稿步骤与重新导入
    - img
  - group:
    - text: 实际任务日志与装配范围
    - img
  - text: BRICKLAB · 从资料到积木的设计实验 两款案例验证 / 非任意车型质量保证
```

# Test source

```ts
  1  | import { test, expect } from "@playwright/test";
  2  | import { writeFile, mkdir, readdir, readFile } from "node:fs/promises";
  3  | const output="artifacts/vehicle-presentation-2026-11-07/browser";
  4  | const root=process.env.VEHICLE_BODY_BROWSER_DATA_DIR??"/tmp/bricklab-vehicle-body-browser";
  5  | test.beforeAll(async()=>{await mkdir(output,{recursive:true});});
  6  | test("two real cached-input generations, five views, repeated generation and persistent reopening",async({page,request})=>{
  7  |   test.setTimeout(360000);
  8  |   const posts:string[]=[],external:string[]=[];page.on("request",r=>{if(r.method()==="POST"&&new URL(r.url()).pathname==="/api/vehicles/jobs")posts.push(r.postData()??"");if(!r.url().startsWith("http://127.0.0.1:3012"))external.push(r.url());});
  9  |   await page.goto("/vehicle-generator");
  10 |   const summaries:any[]=[];
  11 |   for(const[id,model]of[["charger","Charger"],["golf","Golf"]]){
  12 |     const created=page.waitForResponse(r=>r.request().method()==="POST"&&new URL(r.url()).pathname==="/api/vehicles/jobs");
  13 |     await page.getByRole("article").filter({hasText:id==="charger"?"Dodge Charger R/T":"Volkswagen Golf GTI Mk1"}).getByRole("button",{name:"生成这款车"}).click();
  14 |     const response=await created;expect(response.status()).toBe(202);const job=await response.json();
  15 |     await expect(page.getByRole("button",{name:"正在生成",exact:true})).toBeDisabled();
  16 |     await expect(page.locator(".vehicle-model-label strong")).toContainText(model,{timeout:180000});
  17 |     const stage=page.getByTestId("vehicle-preview-stage");await expect(stage.locator("canvas")).toBeVisible();
  18 |     const result=await(await request.get(`/api/vehicles/jobs/${job.id}`)).json();
  19 |     expect(result.preview.input.model).toBe(model);expect(result.research.observation.method).toBe(id==="golf"?"local-photo-review":"cached-provider");
  20 |     expect(result.events.some((e:any)=>e.stage==="craft"&&e.state==="passed")).toBe(true);
> 21 |     await expect(page.getByText("使用已缓存资料",{exact:true})).toBeVisible();
     |                                                          ^ Error: expect(locator).toBeVisible() failed
  22 |     await expect(stage).toHaveAttribute("data-model-hash",result.preview.contentSha256);
  23 |     for(const[label,file]of[["正面","front"],["背面","rear"],["侧面","side"],["俯视","top"],["斜侧","perspective"]]){
  24 |       await page.getByRole("button",{name:label,exact:true}).click();await page.waitForTimeout(300);await stage.screenshot({path:`${output}/${id}-${file}.png`});
  25 |     }
  26 |     await page.getByRole("button",{name:"重置视角",exact:true}).click();
  27 |     await page.getByRole("button",{name:"保存当前任务",exact:true}).click();
  28 |     await expect(page.getByRole("navigation",{name:"保存的车型任务"})).toContainText(job.id.slice(0,8));
  29 |     await writeFile(`${output}/${id}-job.json`,JSON.stringify(result,null,2));await page.screenshot({path:`${output}/${id}-page.png`,fullPage:true});
  30 |     summaries.push({id,jobId:job.id,hash:result.preview.contentSha256,metrics:result.preview.checks.measured});
  31 |   }
  32 |   expect(summaries[0].metrics.length).toBeGreaterThan(summaries[1].metrics.length);
  33 |   const repeated=page.waitForResponse(r=>r.request().method()==="POST"&&new URL(r.url()).pathname==="/api/vehicles/jobs");
  34 |   await page.getByRole("button",{name:"生成",exact:true}).click();const j=await(await repeated).json();
  35 |   await expect(page.getByTestId("vehicle-preview-stage")).toHaveAttribute("data-model-hash",summaries[1].hash,{timeout:180000});
  36 |   await expect(page.getByRole("button",{name:"生成",exact:true})).toBeEnabled({timeout:180000});
  37 |   const repeatedResult=await(await request.get(`/api/vehicles/jobs/${j.id}`)).json();expect(repeatedResult.preview.contentSha256).toBe(summaries[1].hash);expect(j.id).not.toBe(summaries[1].jobId);
  38 |   await page.reload();await expect(page.locator(".vehicle-model-label strong")).toContainText("Golf");await expect(page.getByTestId("vehicle-preview-stage").locator("canvas")).toBeVisible();
  39 |   expect(posts).toHaveLength(3);expect(external).toEqual([]);
  40 |   const cache=await readdir(`${root}/vehicle-platform/vision-cache`).catch(()=>[]);expect(cache.filter(f=>f.endsWith(".request.json"))).toEqual([]);
  41 |   await writeFile(`${output}/normal-workflow.json`,JSON.stringify({summaries,posts:posts.map(x=>JSON.parse(x)),externalRequests:external,routeMocks:0},null,2));
  42 | });
  43 | test("failed submission keeps the old model and retries against the actual API",async({page})=>{
  44 |   test.setTimeout(180000);await page.goto("/vehicle-generator?example=charger");await expect(page.getByTestId("vehicle-preview-stage").locator("canvas")).toBeVisible();
  45 |   const old=await page.getByTestId("vehicle-preview-stage").getAttribute("data-model-hash");
  46 |   await page.route("**/api/vehicles/jobs",r=>r.request().method()==="POST"?r.abort("failed"):r.continue());
  47 |   await page.getByRole("button",{name:"生成",exact:true}).click();await expect(page.getByRole("alert")).toBeVisible();await expect(page.getByTestId("vehicle-preview-stage")).toHaveAttribute("data-model-hash",old!);
  48 |   await page.unroute("**/api/vehicles/jobs");await page.getByRole("button",{name:"重试生成"}).click();await expect(page.getByText("当前引擎实际生成",{exact:true})).toBeVisible({timeout:180000});
  49 | });
  50 | test("saved examples reopen offline after reload and never pretend to execute a generation",async({page,context})=>{
  51 |   test.setTimeout(180000);let posts=0;page.on("request",r=>{if(r.method()==="POST")posts++;});
  52 |   await page.goto("/vehicle-generator?example=charger");await expect(page.getByTestId("vehicle-preview-stage").locator("canvas")).toBeVisible();await expect(page.getByText("离线示例已准备",{exact:true})).toBeVisible({timeout:120000});
  53 |   await context.setOffline(true);await page.reload();await expect(page.getByText("已保存示例 · 本次未重新生成",{exact:true})).toBeVisible();
  54 |   await page.getByRole("article").filter({hasText:"Volkswagen Golf GTI Mk1"}).getByRole("button",{name:"打开已保存示例"}).click();await expect(page.locator(".vehicle-model-label strong")).toContainText("Golf");await expect(page.getByTestId("vehicle-preview-stage").locator("canvas")).toBeVisible();await page.reload();await expect(page.locator(".vehicle-model-label strong")).toContainText("Golf");
  55 |   await page.screenshot({path:`${output}/offline-golf.png`,fullPage:true});expect(posts).toBe(0);await context.setOffline(false);
  56 | });
  57 | test("narrow display keeps the model and controls within the viewport",async({page})=>{
  58 |   await page.setViewportSize({width:390,height:844});await page.goto("/vehicle-generator?example=golf");await expect(page.getByTestId("vehicle-preview-stage").locator("canvas")).toBeVisible();
  59 |   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.getByRole("button",{name:"侧面",exact:true}).click();await page.screenshot({path:`${output}/mobile.png`,fullPage:true});
  60 | });
  61 | test("missing job and unsupported year fail visibly while prepared examples remain available",async({page,request})=>{
  62 |   await page.goto("/vehicle-generator?job=00000000-0000-0000-0000-000000000000");await expect(page.getByRole("alert")).toBeVisible();
  63 |   await page.getByRole("article").first().getByRole("button",{name:"打开已保存示例"}).click();await expect(page.getByTestId("vehicle-preview-stage").locator("canvas")).toBeVisible();
  64 |   const r=await request.post("/api/vehicles/jobs",{data:{make:"VW",model:"Golf",year:1000,variant:"GTI"}});expect(r.status()).toBe(400);
  65 | });
  66 |
```
