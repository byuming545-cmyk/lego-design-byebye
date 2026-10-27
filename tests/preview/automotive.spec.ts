import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { AutomotiveDesignResponse } from '../../src/automotive/contracts.js';

const forwardedOrigin = 'http://bricklab-preview.localhost:3010';

function observeBuiltPreview(page: Page, requests: string[], errors: string[]) {
  page.on('pageerror', error => errors.push(error.message));
  page.on('requestfailed', request => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
  page.on('request', request => requests.push(request.url()));
}

function assertBuiltRequests(requests: string[]) {
  expect(requests.some(url => /\/assets\/[^/]+\.js(?:\?|$)/.test(url))).toBe(true);
  expect(requests.filter(url => /\/@vite\/|\/@react-refresh|\/src\/.*\.[jt]sx?(?:\?|$)/.test(url))).toEqual([]);
  expect(requests.every(url => url.startsWith('blob:') || new URL(url).origin === forwardedOrigin)).toBe(true);
}

test('generates a packed automotive design and restores its real WebGL model from the built forwarded preview', async ({ page, context }) => {
  test.setTimeout(180_000);
  const requests: string[] = [];
  const errors: string[] = [];
  observeBuiltPreview(page, requests, errors);
  const opened = await page.goto(`${forwardedOrigin}/automotive`);
  expect(opened?.status()).toBe(200);
  await expect(page.getByText('Automotive 引擎已连接', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '研究车型与来源', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '8', exact: true }).click();
  await page.getByRole('checkbox', { name: /允许 estimated 比例/ }).check();
  await page.getByRole('slider', { name: '候选数量', exact: true }).press('Home');
  const generated = page.waitForResponse(response => new URL(response.url()).pathname === '/api/automotive/design' && response.request().method() === 'POST', { timeout: 120_000 });
  await page.getByRole('button', { name: '生成 5 个设计候选', exact: true }).click();
  const response = await generated;
  expect(response.status(), await response.text()).toBe(200);
  const session = await response.json() as AutomotiveDesignResponse;
  expect(session.status, JSON.stringify(session.debug.rejections)).toBe('accepted');
  expect(session.brief).toMatchObject({ targetWidthStuds: 8, dimensionBasis: 'estimated' });
  expect(session.candidates.length).toBeGreaterThan(0);
  const selected = session.candidates.find(candidate => candidate.exportable)!;
  expect(selected).toBeTruthy();
  expect(selected.candidate).toMatchObject({ stepEncoding: 'part-ids-v1', validation: { valid: true } });
  expect(selected.candidate.steps.length).toBeGreaterThan(1);
  for (const step of selected.candidate.steps) {
    expect(Array.isArray(step.addedPartIds)).toBe(true);
    expect(Array.isArray(step.statePartIds)).toBe(true);
    expect(step).not.toHaveProperty('addedParts');
    expect(step).not.toHaveProperty('totalModelState');
  }
  expect(selected.scores.automotiveDesign).toBeGreaterThanOrEqual(64);
  expect(selected.designValidation).toMatchObject({ valid: true, instructions: { status: 'passed' } });
  const canvas = page.locator('.auto-viewer .model-viewer-canvas');
  await expect(canvas).toHaveAttribute('data-renderer', 'webgl');
  await expect(canvas).toHaveAttribute('data-rendered-parts', String(selected.candidate.model.parts.length));
  await expect(canvas).toHaveAccessibleName(/交互式 3D 积木模型/);
  await expect(page.locator('.auto-generating')).toHaveCount(0);

  const pendingDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'BOM JSON', exact: true }).click();
  const download = await pendingDownload;
  expect(await download.failure()).toBeNull();
  const bom = JSON.parse(await readFile((await download.path())!, 'utf8')) as { items: { quantity: number }[] };
  expect(bom).toMatchObject({ sessionId: session.sessionId, candidateId: selected.id, quantitySource: 'virtual-unlimited-not-owned', physicalBuildsVerified: 0 });
  expect(bom.items.reduce((sum, item) => sum + item.quantity, 0)).toBe(selected.candidate.model.parts.length);

  const restored = await context.newPage();
  observeBuiltPreview(restored, requests, errors);
  const resumed = await restored.goto(`${forwardedOrigin}/automotive-lab?session=${encodeURIComponent(session.sessionId)}`);
  expect(resumed?.status()).toBe(200);
  await expect(restored.getByRole('status')).toContainText('已恢复设计记录');
  await expect(restored.locator('.auto-candidate[aria-pressed="true"]')).toContainText(selected.name);
  await expect(restored.locator('.auto-viewer .model-viewer-canvas')).toHaveAttribute('data-renderer', 'webgl');
  await expect(restored.locator('.auto-viewer .model-viewer-canvas')).toHaveAttribute('data-rendered-parts', String(selected.candidate.model.parts.length));
  await expect(restored.getByRole('heading', { name: '参考模型库', exact: true })).toBeVisible();
  await restored.getByRole('tab', { name: 'Design Brief', exact: true }).click();
  await expect(restored.getByRole('tabpanel')).toContainText('estimated · 估算比例');
  assertBuiltRequests(requests);
  expect(errors).toEqual([]);
  await restored.close();
});

test('opens the built automotive workspace directly inside the embedded preview iframe', async ({ page }) => {
  const requests: string[] = [];
  const errors: string[] = [];
  observeBuiltPreview(page, requests, errors);
  await page.setContent(`<iframe title="Automotive preview" sandbox="allow-scripts allow-same-origin allow-downloads" src="${forwardedOrigin}/automotive" style="width:100%;height:900px;border:0"></iframe>`);
  const frame = page.frameLocator('iframe[title="Automotive preview"]');
  await expect(frame.getByText('Automotive 引擎已连接', { exact: true })).toBeVisible();
  await expect(frame.getByRole('button', { name: '研究车型与来源', exact: true })).toBeEnabled();
  await expect(frame.getByRole('heading', { name: '目标车型', exact: true })).toBeVisible();
  await expect(frame.getByText('规则驱动生成 · 未训练 AI 模型', { exact: true })).toBeVisible();
  await expect(frame.getByRole('button', { name: '生成 8 个设计候选', exact: true })).toBeDisabled();
  await expect(frame.getByText('当前缺少真实尺寸。请补充资料或允许估算。', { exact: true })).toBeVisible();
  await frame.getByRole('link', { name: 'Automotive Lab', exact: true }).click();
  await expect(frame.getByRole('heading', { name: '参考模型库', exact: true })).toBeVisible();
  expect(requests.filter(url => /\/api\/(?:sets(?:\/|$)|speed\/inventory)|rebrickable/i.test(url))).toEqual([]);
  assertBuiltRequests(requests);
  expect(errors).toEqual([]);
});
