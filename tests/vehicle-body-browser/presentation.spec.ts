import { test, expect } from "@playwright/test";
import { writeFile, mkdir, readdir, readFile } from "node:fs/promises";
const output="artifacts/vehicle-interactions-2026-11-07/browser-regression";
const root=process.env.VEHICLE_BODY_BROWSER_DATA_DIR??"/tmp/bricklab-vehicle-body-browser";
test.beforeAll(async()=>{await mkdir(output,{recursive:true});});
test("two real cached-input generations, five views, repeated generation and persistent reopening",async({page,request})=>{
  test.setTimeout(360000);
  const posts:string[]=[],external:string[]=[];page.on("request",r=>{if(r.method()==="POST"&&new URL(r.url()).pathname==="/api/vehicles/jobs")posts.push(r.postData()??"");if(!r.url().startsWith("http://127.0.0.1:3012"))external.push(r.url());});
  await page.goto("/vehicle-generator");
  const summaries:any[]=[];
  for(const[id,model]of[["charger","Charger"],["golf","Golf"]]){
    const created=page.waitForResponse(r=>r.request().method()==="POST"&&new URL(r.url()).pathname==="/api/vehicles/jobs");
    await page.getByRole("article").filter({hasText:id==="charger"?"Dodge Charger R/T":"Volkswagen Golf GTI Mk1"}).getByRole("button",{name:"生成这款车"}).click();
    const response=await created;expect(response.status()).toBe(202);const job=await response.json();
    await expect(page.getByRole("button",{name:"正在生成",exact:true})).toBeDisabled();
    await expect(page.locator(".vehicle-model-label strong")).toContainText(model,{timeout:180000});
    const stage=page.getByTestId("vehicle-preview-stage");await expect(stage.locator("canvas")).toBeVisible();
    const result=await(await request.get(`/api/vehicles/jobs/${job.id}`)).json();
    expect(result.preview.input.model).toBe(model);expect(result.research.observation.method).toBe(id==="golf"?"local-photo-review":"cached-provider");
    expect(result.events.some((e:any)=>e.stage==="craft"&&e.state==="passed")).toBe(true);
    await expect(page.locator(".vehicle-data-note")).toContainText("使用已缓存资料");
    await expect(stage).toHaveAttribute("data-model-hash",result.preview.contentSha256);
    for(const[label,file]of[["正面","front"],["背面","rear"],["侧面","side"],["俯视","top"],["斜侧","perspective"]]){
      await page.getByRole("button",{name:label,exact:true}).click();await page.waitForTimeout(300);await stage.screenshot({path:`${output}/${id}-${file}.png`});
    }
    await page.getByRole("button",{name:"重置视角",exact:true}).click();
    await page.getByRole("button",{name:"保存当前任务",exact:true}).click();
    await expect(page.getByRole("navigation",{name:"保存的车型任务"})).toContainText(job.id.slice(0,8));
    await writeFile(`${output}/${id}-job.json`,JSON.stringify(result,null,2));await page.screenshot({path:`${output}/${id}-page.png`,fullPage:true});
    summaries.push({id,jobId:job.id,hash:result.preview.contentSha256,metrics:result.preview.checks.measured});
  }
  expect(summaries[0].metrics.length).toBeGreaterThan(summaries[1].metrics.length);
  const repeated=page.waitForResponse(r=>r.request().method()==="POST"&&new URL(r.url()).pathname==="/api/vehicles/jobs");
  await page.getByRole("button",{name:"生成",exact:true}).click();const j=await(await repeated).json();
  await expect(page.getByTestId("vehicle-preview-stage")).toHaveAttribute("data-model-hash",summaries[1].hash,{timeout:180000});
  await expect(page.getByRole("button",{name:"生成",exact:true})).toBeEnabled({timeout:180000});
  const repeatedResult=await(await request.get(`/api/vehicles/jobs/${j.id}`)).json();expect(repeatedResult.preview.contentSha256).toBe(summaries[1].hash);expect(j.id).not.toBe(summaries[1].jobId);
  await page.reload();await expect(page.locator(".vehicle-model-label strong")).toContainText("Golf");await expect(page.getByTestId("vehicle-preview-stage").locator("canvas")).toBeVisible();
  expect(posts).toHaveLength(3);expect(external).toEqual([]);
  const cache=await readdir(`${root}/vehicle-platform/vision-cache`).catch(()=>[]);expect(cache.filter(f=>f.endsWith(".request.json"))).toEqual([]);
  await writeFile(`${output}/normal-workflow.json`,JSON.stringify({summaries,posts:posts.map(x=>JSON.parse(x)),externalRequests:external,routeMocks:0},null,2));
});
test("failed submission keeps the old model and retries against the actual API",async({page})=>{
  test.setTimeout(180000);await page.goto("/vehicle-generator?example=charger");await expect(page.getByTestId("vehicle-preview-stage").locator("canvas")).toBeVisible();
  const old=await page.getByTestId("vehicle-preview-stage").getAttribute("data-model-hash");
  await page.route("**/api/vehicles/jobs",r=>r.request().method()==="POST"?r.abort("failed"):r.continue());
  await page.getByRole("button",{name:"生成",exact:true}).click();await expect(page.getByRole("alert")).toBeVisible();await expect(page.getByTestId("vehicle-preview-stage")).toHaveAttribute("data-model-hash",old!);
  await page.unroute("**/api/vehicles/jobs");await page.getByRole("button",{name:"重试生成"}).click();await expect(page.getByText("当前引擎实际生成",{exact:true})).toBeVisible({timeout:180000});
});
test("saved examples reopen offline after reload and never pretend to execute a generation",async({page,context})=>{
  test.setTimeout(180000);let posts=0;page.on("request",r=>{if(r.method()==="POST")posts++;});
  await page.goto("/vehicle-generator?example=charger");await expect(page.getByTestId("vehicle-preview-stage").locator("canvas")).toBeVisible();await expect(page.getByText("离线示例已准备",{exact:true})).toBeVisible({timeout:120000});
  await context.setOffline(true);await page.reload();await expect(page.getByText("已保存示例 · 本次未重新生成",{exact:true})).toBeVisible();
  await page.getByRole("article").filter({hasText:"Volkswagen Golf GTI Mk1"}).getByRole("button",{name:"打开已保存示例"}).click();await expect(page.locator(".vehicle-model-label strong")).toContainText("Golf");await expect(page.getByTestId("vehicle-preview-stage").locator("canvas")).toBeVisible();await page.reload();await expect(page.locator(".vehicle-model-label strong")).toContainText("Golf");
  await page.screenshot({path:`${output}/offline-golf.png`,fullPage:true});expect(posts).toBe(0);await context.setOffline(false);
});
test("narrow display keeps the model and controls within the viewport",async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto("/vehicle-generator?example=golf");await expect(page.getByTestId("vehicle-preview-stage").locator("canvas")).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.getByRole("button",{name:"侧面",exact:true}).click();await page.screenshot({path:`${output}/mobile.png`,fullPage:true});
});
test("missing job and unsupported year fail visibly while prepared examples remain available",async({page,request})=>{
  await page.goto("/vehicle-generator?job=00000000-0000-0000-0000-000000000000");await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("article").first().getByRole("button",{name:"打开已保存示例"}).click();await expect(page.getByTestId("vehicle-preview-stage").locator("canvas")).toBeVisible();
  const r=await request.post("/api/vehicles/jobs",{data:{make:"VW",model:"Golf",year:1000,variant:"GTI"}});expect(r.status()).toBe(400);
});
test("query interruption remains unknown and resumes the same actual job without a duplicate submission",async({page})=>{
  test.setTimeout(180000);let posts=0;page.on("request",r=>{if(r.method()==="POST"&&new URL(r.url()).pathname==="/api/vehicles/jobs")posts++;});
  await page.goto("/vehicle-generator?example=charger");await expect(page.getByTestId("vehicle-preview-stage").locator("canvas")).toBeVisible();
  await page.route("**/api/vehicles/jobs/*",r=>r.request().method()==="GET"?r.abort("failed"):r.continue());
  const created=page.waitForResponse(r=>r.request().method()==="POST"&&new URL(r.url()).pathname==="/api/vehicles/jobs");
  await page.getByRole("article").filter({hasText:"Volkswagen Golf GTI Mk1"}).getByRole("button",{name:"生成这款车"}).click();const job=await(await created).json();
  await expect(page.getByRole("alert")).toContainText("后台可能仍在运行",{timeout:30000});
  await expect(page.getByRole("article").last().getByRole("button",{name:"打开已保存示例"})).toBeEnabled();
  await page.unroute("**/api/vehicles/jobs/*");await page.getByRole("button",{name:"恢复查询"}).click();
  await expect(page.locator(".vehicle-model-label strong")).toContainText("Golf",{timeout:150000});expect(new URL(page.url()).searchParams.get("job")).toBe(job.id);expect(posts).toBe(1);
});
