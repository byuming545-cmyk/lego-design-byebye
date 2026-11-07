import { test, expect } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
let job: any;
test.beforeAll(async () => {
  job = JSON.parse(
    await readFile(
      "artifacts/vehicle-craft-2026-11-07/round-2/enabled/job.json",
      "utf8",
    ),
  );
  expect(job.state).toBe("partial");
  expect(job.preview.placements.length).toBeGreaterThan(60);
  const root =
      process.env.VEHICLE_BODY_BROWSER_DATA_DIR ??
      "/tmp/bricklab-vehicle-body-browser",
    directory = root + "/vehicle-platform/" + job.id;
  await mkdir(directory, { recursive: true });
  await writeFile(directory + "/job.json", JSON.stringify(job));
});
test("identity-only form automatically displays the actual completed appearance result", async ({
  page,
}) => {
  await page.route("**/api/vehicles/jobs", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    expect(route.request().postDataJSON()).toEqual({
      make: "Dodge",
      model: "Charger",
      year: 1969,
      variant: "R/T",
    });
    await route.fulfill({ status: 202, json: job });
  });
  await page.goto("/");
  expect(await page.locator("input[type=file]").count()).toBe(0);
  await page.getByRole("button", { name: "生成", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "完整汽车外观预览" }),
  ).toBeVisible();
  await expect(
    page.getByTestId("vehicle-preview-stage").locator("canvas"),
  ).toBeVisible();
  await expect(
    page.getByText("步骤状态：外观分组草稿，非可实拼说明书"),
  ).toBeVisible();
});
test("renders five actual source-mesh views and exposes persistent saving and sources", async ({
  page,
}) => {
  await page.goto("/vehicle-generator?job=" + job.id);
  const stage = page.getByTestId("vehicle-preview-stage");
  await expect(stage.locator("canvas")).toBeVisible();
  await expect(stage.locator(".assembly-viewer-error")).toHaveCount(0);
  for (const [label, file] of [
    ["侧面", "side"],
    ["正面", "front"],
    ["背面", "rear"],
    ["俯视", "top"],
    ["斜侧", "perspective"],
  ]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(
      page.getByRole("button", { name: label, exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.waitForTimeout(400);
    await stage.screenshot({
      path: "artifacts/vehicle-craft-2026-11-07/round-2/enabled/" + file + ".png",
    });
  }
  await page.getByRole("button", { name: "保存当前任务", exact: true }).click();
  await expect(
    page.getByRole("navigation", { name: "保存的车型任务" }),
  ).toContainText(job.id.slice(0, 8));
  await page.screenshot({
    path: "artifacts/vehicle-craft-2026-11-07/round-2/enabled/page.png",
    fullPage: true,
  });
});
test("exports true instance BOM and reimports only as appearance, rejecting forged validation", async ({
  request,
  page,
}) => {
  const response = await request.get(
    "/api/vehicles/jobs/" + job.id + "/preview?download=json",
  );
  expect(response.ok()).toBe(true);
  const model = await response.json();
  expect(model.contentSha256).toBe(job.preview.contentSha256);
  const csv = await request.get(
    "/api/vehicles/jobs/" + job.id + "/preview?download=bom",
  );
  expect(csv.ok()).toBe(true);
  expect(await csv.text()).toContain(
    "part_id,name,ldraw_design_color,quantity",
  );
  const imported = await request.post(
    "/api/vehicles/jobs/" + job.id + "/preview/import",
    { data: { content: JSON.stringify(model) } },
  );
  expect(imported.ok()).toBe(true);
  expect((await imported.json()).status).toBe("APPEARANCE_REOPENED_NOT_FORMAL");
  model.checks.formalConnections = "VALID";
  const bad = await request.post(
    "/api/vehicles/jobs/" + job.id + "/preview/import",
    { data: { content: JSON.stringify(model) } },
  );
  expect(bad.status()).toBe(409);
  await page.goto("/vehicle-generator?job=" + job.id);
  await expect(
    page.getByTestId("vehicle-preview-stage").locator("canvas"),
  ).toBeVisible();
  const file = await readFile(
    "artifacts/vehicle-craft-2026-11-07/round-2/enabled/model.json",
  );
  await page
    .getByLabel("重新导入外观模型 JSON")
    .setInputFiles({
      name: "actual-appearance.json",
      mimeType: "application/json",
      buffer: file,
    });
  await expect(
    page.getByText("APPEARANCE_REOPENED_NOT_FORMAL", { exact: true }),
  ).toBeVisible();
});
test("preserves the independent old mini-car mode and pinned real geometry API", async ({
  request,
}) => {
  const r = await request.post("/api/mini-cars/generate", {
    data: {
      style: "gt",
      color: "blue",
      seed: "vehicle-body-regression",
      spoiler: false,
    },
  });
  expect(r.ok()).toBe(true);
  const mini = await r.json();
  expect(mini.model.schema).toBe("bricklab-mini-car-appearance-1");
  expect(mini.model.placements.length).toBeGreaterThan(60);
  expect(mini.model.checks.connections).toBe("NOT_VERIFIED");
  const part = await request.get("/api/parts-foundation/parts/3001");
  expect(part.ok()).toBe(true);
  expect((await part.json()).geometry.source.integrity).toBe("verified");
});
