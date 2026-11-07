# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: craft.spec.ts >> job-bound controls and historical schema cannot be bypassed by an otherwise valid appearance document
- Location: tests/vehicle-body-browser/craft.spec.ts:53:1

# Error details

```
Error: ENOENT: no such file or directory, open 'artifacts/vehicle-presentation-2026-11-07/craft-controls/baseline/model.json'
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
  35 |         await expect(page.getByText(/本功能未训练或微调模型/)).toBeVisible();
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
> 57 |     const old = await readFile("artifacts/vehicle-presentation-2026-11-07/craft-controls/baseline/model.json", "utf8");
     |                 ^ Error: ENOENT: no such file or directory, open 'artifacts/vehicle-presentation-2026-11-07/craft-controls/baseline/model.json'
  58 |     expect((await request.post(`/api/vehicles/jobs/${j.id}/preview/import`, { data: { content: old } })).status()).toBe(409);
  59 | });
  60 | test("rejects unsupported control grants before starting research", async ({ request }) => {
  61 |     for (const craftOptions of [{ enabled: true, excludedSourceSets: ["../private"] }, { enabled: true, excludedSourceSets: [], formal: true }]) {
  62 |         expect((await request.post("/api/vehicles/jobs", { data: { make: "Dodge", model: "Charger", year: 1969, variant: "R/T", craftOptions } })).status()).toBe(400);
  63 |     }
  64 | });
  65 |
```
