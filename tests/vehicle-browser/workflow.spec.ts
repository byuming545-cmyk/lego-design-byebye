import { test, expect } from "@playwright/test";
test("default entry accepts only vehicle identity and polls real task states", async ({
  page,
}) => {
  let gets = 0;
  await page.route("**/api/vehicles/jobs", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      make: "Dodge",
      model: "Charger",
      year: 1969,
      variant: "R/T",
    });
    await route.fulfill({
      status: 202,
      json: {
        id: "test-job",
        state: "running",
        events: [
          {
            stage: "research",
            state: "running",
            detail: "Searching licensed sources",
          },
        ],
      },
    });
  });
  await page.route("**/api/vehicles/jobs/test-job", async (route) => {
    gets++;
    await route.fulfill({
      json: {
        id: "test-job",
        state: "blocked",
        events: [
          {
            stage: "research",
            state: "passed",
            detail: "source metadata retained",
          },
          {
            stage: "vision",
            state: "blocked",
            detail: "VISION_CREDENTIAL_MISSING",
          },
          {
            stage: "planning",
            state: "skipped",
            detail: "Visual evidence unavailable",
          },
        ],
      },
    });
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "从真实车型，开始自动设计" }),
  ).toBeVisible();
  await expect(page.locator("input[type=file]")).toHaveCount(0);
  await page.getByRole("button", { name: "生成", exact: true }).click();
  await expect(page.getByText("任务状态：blocked")).toBeVisible();
  await expect(page.getByText(/VISION_CREDENTIAL_MISSING/)).toBeVisible();
  expect(gets).toBeGreaterThan(0);
  await page.screenshot({
    path: "artifacts/vehicle-recovery/vehicle-home.png",
    fullPage: true,
  });
});
test("direct vehicle route preserves ordinary form input and exposes API errors", async ({
  page,
}) => {
  await page.route("**/api/vehicles/jobs", (route) =>
    route.fulfill({ status: 429, json: { error: "TASK_CAPACITY" } }),
  );
  await page.goto("/vehicle-generator");
  await page.getByLabel("品牌", { exact: true }).fill("Chevrolet");
  await page.getByLabel("型号", { exact: true }).fill("Camaro");
  await page.getByLabel("年份", { exact: true }).fill("1967");
  await page.getByRole("button", { name: "生成", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("TASK_CAPACITY");
  await expect(page.getByLabel("型号", { exact: true })).toHaveValue("Camaro");
});

test("reopens a persisted real support, revalidates export and renders native geometry", async ({
  page,
  request,
}) => {
  const { readFile, mkdir, writeFile } = await import("node:fs/promises");
  const root = process.env.VEHICLE_BROWSER_DATA_DIR;
  if (!root)
    throw Error(
      "Set VEHICLE_BROWSER_DATA_DIR for isolated native fixture storage",
    );
  const job = JSON.parse(
    await readFile(
      "artifacts/vehicle-recovery/charger-task-final.json",
      "utf8",
    ),
  );
  const directory = root + "/vehicle-platform/" + job.id;
  await mkdir(directory, { recursive: true });
  await writeFile(directory + "/job.json", JSON.stringify(job));
  await page.goto("/vehicle-generator?job=" + job.id);
  await expect(page.getByText("任务状态：blocked")).toBeVisible();
  await expect(page.locator("canvas")).toBeVisible({ timeout: 60000 });
  await expect(page.getByRole("link", { name: "下载当前复验的局部模型 JSON" })).toBeVisible();
  const exported = await request.get(
    "/api/vehicles/jobs/" + job.id + "/model?download=json",
  );
  expect(exported.ok()).toBe(true);
  const model = await exported.json();
  expect(model.placements).toHaveLength(5);
  expect(
    model.bom.reduce((n: number, x: { quantity: number }) => n + x.quantity, 0),
  ).toBe(5);
  expect(model.steps).toHaveLength(5);
  await page.screenshot({
    path: "artifacts/vehicle-recovery/native-support-page.png",
    fullPage: true,
  });
});
