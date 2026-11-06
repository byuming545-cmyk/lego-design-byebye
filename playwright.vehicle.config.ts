import { defineConfig } from "@playwright/test";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
export default defineConfig({
  testDir: "./tests/vehicle-browser",
  outputDir: "test-results/vehicle-browser",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3011",
    launchOptions: {
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_PATH ?? "/usr/bin/chromium",
      args: ["--no-sandbox", "--enable-unsafe-swiftshader"],
    },
  },
  webServer: {
    command: "node scripts/preview.mjs",
    url: "http://127.0.0.1:3011/api/health",
    reuseExistingServer: false,
    env: {
      PREVIEW_PORT: "3011",
      INVENTORY_PROVIDER: "mock",
      BRICKLAB_DATA_DIR:
        process.env.VEHICLE_BROWSER_DATA_DIR ??
        path.join(tmpdir(), "vehicle-browser-" + randomUUID()),
    },
  },
});
