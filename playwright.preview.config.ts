import { defineConfig, devices } from '@playwright/test';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export default defineConfig({
  testDir: './tests/preview',
  // The compiled V0.4 preview serves the source-backed library. Archived
  // generation specs cannot run against its intentional authenticity gate.
  testMatch: 'parts-foundation.spec.ts',
  timeout: 60000,
  expect: { timeout: 15000 },
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:3010',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || '/usr/bin/chromium',
      args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
    },
  },
  projects: [{ name: 'preview-chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run preview',
    url: 'http://127.0.0.1:3010/api/health',
    reuseExistingServer: false,
    timeout: 120000,
    env: { PREVIEW_PORT: '3010', INVENTORY_PROVIDER: 'mock', BRICKLAB_DATA_DIR: path.join(tmpdir(), `bricklab-preview-${randomUUID()}`) },
  },
});
