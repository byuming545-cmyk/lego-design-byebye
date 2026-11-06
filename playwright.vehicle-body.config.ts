import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/vehicle-body-browser",
  outputDir: "test-results/vehicle-body",
  workers: 1,
  timeout: 120000,
  expect: { timeout: 30000 },
  use: {
    baseURL: "http://127.0.0.1:3012",
    launchOptions: {
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_PATH ?? "/usr/bin/chromium",
      args: ["--no-sandbox", "--enable-unsafe-swiftshader"],
    },
  },
  webServer: {
    command: "node scripts/preview.mjs",
    url: "http://127.0.0.1:3012/api/health",
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      PREVIEW_PORT: "3012",
      INVENTORY_PROVIDER: "mock",
      BRICKLAB_DATA_DIR:
        process.env.VEHICLE_BODY_BROWSER_DATA_DIR ??
        "/tmp/bricklab-vehicle-body-browser",
    },
  },
});
