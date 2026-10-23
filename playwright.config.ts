import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: 'test-results/e2e',
  // Current production scope. Older generation workflows remain as historical
  // fixtures; their HTTP/UI entry points remain blocked in V0.6.
  testMatch: ['parts-foundation.spec.ts', 'assembly.spec.ts'],
  timeout: 60000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_PATH || "/usr/bin/chromium",
      args: ["--no-sandbox", "--enable-unsafe-swiftshader"],
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
    env: { INVENTORY_PROVIDER: "mock", BRICKLAB_DATA_DIR: path.join(tmpdir(), `bricklab-e2e-${randomUUID()}`) },
  },
});
