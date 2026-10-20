import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// Browser checks stay on loopback; arbitrary proxy Host headers are covered below.
const forwardedOrigin = 'http://bricklab-preview.localhost:3010';

test('serves HTML, built assets, and API using a forwarded preview Host', async ({ request }) => {
  const headers = { Host: 'bricklab-preview.example' };
  const page = await request.get('/', { headers });
  expect(page.status()).toBe(200);
  expect(page.headers()['content-type']).toContain('text/html');
  const html = await page.text();
  const script = html.match(/<script[^>]+src="([^"]+)"/)?.[1];
  const stylesheet = html.match(/<link[^>]+href="([^"]+\.css)"/)?.[1];
  expect(script).toMatch(/^\/assets\/.*\.js$/);
  expect(stylesheet).toBeDefined();
  for (const asset of [script!, stylesheet!]) {
    const response = await request.get(asset, { headers });
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).not.toContain('text/html');
  }
  const health = await request.get('/api/health', { headers });
  expect(health.status()).toBe(200);
  expect(await health.json()).toMatchObject({ status: 'ok', provider: 'mock' });
  const extras = await request.post('/api/speed/inventory', {
    headers,
    data: { setNumbers: ['DEMO-SPEED'], extraParts: [{ partId: '3034', color: { id: 0, name: '黑色', hex: '#171717' }, quantity: 2 }] },
  });
  expect(extras.status()).toBe(200);
  expect(await extras.json()).toMatchObject({ source: 'mixed', sourceLabel: expect.stringContaining('用户自报散件') });
});

test('opens a forwarded preview domain and generates instructions with a real PDF', async ({ page }) => {
  const errors: string[] = [];
  const requests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('requestfailed', request => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
  page.on('request', request => requests.push(request.url()));
  const generated = page.waitForResponse(response => response.url().endsWith('/api/generate'));
  const response = await page.goto(forwardedOrigin);
  expect(response?.status()).toBe(200);
  expect((await generated).status()).toBe(200);
  await expect(page.getByText('基础校验通过', { exact: true })).toBeVisible();
  await expect(page.locator('.model-viewer-canvas')).toBeVisible();
  await page.getByRole('button', { name: '开始拼搭', exact: true }).click();
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await expect(page.getByRole('button', { name: '跳转第 2 步', exact: true })).toHaveAttribute('aria-current', 'step');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 PDF', exact: true }).click();
  const pdf = await downloaded;
  expect(await pdf.failure()).toBeNull();
  expect((await readFile((await pdf.path())!)).subarray(0, 5).toString()).toBe('%PDF-');
  expect(requests.every(url => new URL(url).origin === forwardedOrigin || url.startsWith('blob:'))).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({ path: '/tmp/bricklab-preview-fixed.png', fullPage: true });
});

test('loads the same complete workspace inside an embedded preview iframe', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent(`<iframe title="Bricklab preview" sandbox="allow-scripts allow-same-origin allow-downloads" src="${forwardedOrigin}" style="width:100%;height:900px;border:0"></iframe>`);
  const frame = page.frameLocator('iframe');
  await expect(frame.getByText('基础校验通过', { exact: true })).toBeVisible();
  await expect(frame.locator('.model-viewer-canvas')).toBeVisible();
  await frame.getByRole('button', { name: '开始拼搭', exact: true }).click();
  await expect(frame.getByRole('button', { name: '上一步', exact: true })).toBeDisabled();
  await expect(frame.getByRole('heading', { level: 3, name: '搭建底部', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('generates and exports Speed Creative from the built forwarded preview', async ({ page }) => {
  // Complete step snapshots exceed Chromium's default response cache budget.
  const network = await page.context().newCDPSession(page);
  await network.send('Network.enable', { maxTotalBufferSize: 128 * 1024 * 1024, maxResourceBufferSize: 64 * 1024 * 1024 });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('requestfailed', request => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
  await page.goto(`${forwardedOrigin}/#/speed`);
  const generate = page.getByRole('button', { name: '生成 Speed 方案', exact: true });
  await expect(generate).toBeEnabled();
  const generated = page.waitForResponse(response => new URL(response.url()).pathname === '/api/speed/generate');
  await generate.click();
  const response = await generated;
  expect(response.status()).toBe(200);
  const result = await response.json();
  expect(result.candidates).toHaveLength(3);
  for (const candidate of result.candidates) {
    expect(candidate.validation.valid).toBe(true);
    expect(candidate.validation.wheels).toMatchObject({ groundedWheels: 4, axleConnections: 4, rotationalClearance: true });
  }
  await expect(page.locator('.speed-model-stage .model-viewer-canvas')).toBeVisible();
  await page.getByRole('button', { name: '开始拼搭', exact: true }).click();
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Speed 跳转第 2 步', exact: true })).toHaveAttribute('aria-current', 'step');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 PDF', exact: true }).click();
  const pdf = await downloaded;
  expect(await pdf.failure()).toBeNull();
  expect((await readFile((await pdf.path())!)).subarray(0, 5).toString()).toBe('%PDF-');
  expect(errors).toEqual([]);
});
