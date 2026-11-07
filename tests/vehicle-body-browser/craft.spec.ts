import { test, expect } from "@playwright/test";
import { readFile, writeFile, mkdir, cp, readdir } from "node:fs/promises";
const root = process.env.VEHICLE_BODY_BROWSER_DATA_DIR ?? "/tmp/bricklab-vehicle-body-browser";
const artifacts = "artifacts/vehicle-presentation-2026-11-07/craft-controls";
const output = "artifacts/vehicle-interactions-2026-11-07/craft-regression";
const cases = new Map<string, any>();
test.beforeAll(async () => {
    await mkdir(output, { recursive: true });
    for (const name of ["enabled", "disabled", "holdout-76897", "holdout-75878"]) {
        const j = JSON.parse(await readFile(`${artifacts}/round-2/${name}/job.json`, "utf8"));
        cases.set(name, j);
        const directory = `${root}/vehicle-platform/${j.id}`;
        await mkdir(directory, { recursive: true });
        await writeFile(directory + "/job.json", JSON.stringify(j));
    }
    // Reuse genuine, locally hash-checked research and vision. The campaign
    // template stays disabled; a cache miss cannot become an authorized call.
    await cp("data/vehicle-platform/successful-research", `${root}/vehicle-platform/successful-research`, { recursive: true });
});
test("normal cached workflow executes both craft controls without route mocks or new provider requests", async ({ page, request }) => {
    for (const enabled of [false, true]) {
        await page.goto("/vehicle-generator");
        await page.getByRole("checkbox", { name: "使用已有拼搭工艺" }).setChecked(enabled);
        const created = page.waitForResponse(r => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/vehicles/jobs");
        await page.getByRole("button", { name: "生成", exact: true }).click();
        const response=await created;
        expect(response.status()).toBe(202);
        const j = await response.json();
        expect(j.craftOptions.enabled).toBe(enabled);
        await expect(page.getByTestId("vehicle-preview-stage").locator("canvas")).toBeVisible({ timeout: 120000 });
        const result = await (await request.get(`/api/vehicles/jobs/${j.id}`)).json();
        const name = enabled ? "enabled" : "disabled";
        expect(result.preview.contentSha256).toBe(cases.get(name).preview.contentSha256);
        expect(result.preview.layout.craft.options.enabled).toBe(enabled);
        await writeFile(`${output}/unmocked-${name}-job.json`, JSON.stringify(result, null, 2));
        await page.getByText("本次使用的拼搭工艺", { exact: true }).click();
        await expect(page.locator(".vehicle-evidence").getByText(/本功能未训练或微调模型/)).toBeVisible();
        await page.screenshot({ path: `${output}/unmocked-${name}-page.png`, fullPage: true });
    }
    const cache = await readdir(`${root}/vehicle-platform/vision-cache`).catch((e) => { if (e.code === "ENOENT")
        return []; throw e; });
    expect(cache.filter(f => f.endsWith(".request.json"))).toEqual([]);
});
test("whole-set holdouts preserve exclusions and explicit context rejections in actual API output", async ({ request, page }) => {
    for (const set of ["76897", "75878"]) {
        const j = cases.get("holdout-" + set), r = await request.get(`/api/vehicles/jobs/${j.id}/preview?download=json`);
        expect(r.ok()).toBe(true);
        const m = await r.json();
        expect(m.craftOptions.excludedSourceSets).toEqual([set]);
        expect(m.layout.craft.selections.every((s: any) => s.sourceSet !== set)).toBe(true);
        await page.goto("/vehicle-generator?job=" + j.id);
        await expect(page.getByTestId("vehicle-preview-stage").locator("canvas")).toBeVisible();
    }
});
test("job-bound controls and historical schema cannot be bypassed by an otherwise valid appearance document", async ({ request }) => {
    const j = cases.get("enabled"), disabled = cases.get("disabled");
    const r = await request.post(`/api/vehicles/jobs/${j.id}/preview/import`, { data: { content: JSON.stringify(disabled.preview) } });
    expect(r.status()).toBe(409);
    const old = await readFile("artifacts/vehicle-presentation-2026-11-07/baseline/model.json", "utf8");
    expect((await request.post(`/api/vehicles/jobs/${j.id}/preview/import`, { data: { content: old } })).status()).toBe(409);
});
test("rejects unsupported control grants before starting research", async ({ request }) => {
    for (const craftOptions of [{ enabled: true, excludedSourceSets: ["../private"] }, { enabled: true, excludedSourceSets: [], formal: true }]) {
        expect((await request.post("/api/vehicles/jobs", { data: { make: "Dodge", model: "Charger", year: 1969, variant: "R/T", craftOptions } })).status()).toBe(400);
    }
});
