import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/preview',
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
    env: { PREVIEW_PORT: '3010', INVENTORY_PROVIDER: 'mock' },
  },
});
