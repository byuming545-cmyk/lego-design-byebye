import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const out = path.join(root, 'artifacts', 'interface-library');
const base = process.env.CATALOG_BASE ?? 'http://127.0.0.1:3007';
const executablePath = path.join(root, '.playwright-browsers/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell');
const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
page.on('pageerror', error => errors.push(`page: ${error.message}`));
await page.goto(`${base}/#/interface-library`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: '我来拼搭' }).last().click();
await page.locator('.studio-category-row select').waitFor({ timeout: 90000 });
await page.locator('.studio-part-card strong').first().waitFor({ timeout: 90000 });
await page.waitForTimeout(800);
const categories = await page.locator('.studio-category-row select option').allTextContents();
await page.screenshot({ path: path.join(out, 'studio-catalog.png'), fullPage: false });
const initialParts = await page.locator('.studio-part-card strong').allTextContents();
const thumbnailOk = await page.locator('.studio-part-card img').first().evaluate(img => img.complete && img.naturalWidth > 0).catch(() => false);

// Explicit gap category.
const categorySelect = page.locator('.studio-category-row select');
await categorySelect.selectOption('BALL_SOCKET');
await page.locator('.studio-gap').waitFor({ timeout: 30000 });
await page.screenshot({ path: path.join(out, 'studio-catalog-gap.png'), fullPage: false });
const gapText = await page.locator('.studio-gap').innerText();
await categorySelect.selectOption('C01');
await page.locator('.studio-part-card strong').first().waitFor({ timeout: 90000 });
await page.waitForTimeout(1500);

// Pick B as the same real part 3024.
await page.locator('.studio-part-card').nth(1).click();
await page.locator('.studio-picker').waitFor({ timeout: 30000 });
await page.screenshot({ path: path.join(out, 'studio-part-picker.png'), fullPage: false });
await page.locator('.studio-search input').fill('3024');
await page.waitForTimeout(400);
await page.locator('.studio-part-grid button').first().click();
await page.locator('.studio-picker').waitFor({ state: 'detached', timeout: 30000 });
await page.waitForTimeout(1200);
const samePart = await page.locator('.studio-part-card strong').allTextContents();
await page.screenshot({ path: path.join(out, 'studio-same-part.png'), fullPage: false });

// Switch to C01's validated example.
const select = page.locator('.studio-category-row select');
await select.selectOption('C01');
await page.waitForTimeout(1200);
const exampleButtons = page.locator('.studio-example-strip button');
const exampleCount = await exampleButtons.count();
if (exampleCount > 0) { await exampleButtons.first().click(); await page.waitForTimeout(1200); }

// Record a keyframed manual attempt and validate it.
await page.getByRole('button', { name: '俯视' }).click();
await page.getByRole('button', { name: '记录起始位置' }).click();
await page.getByRole('button', { name: '吸附到来源候选姿态' }).click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: '记录连接完成位置' }).click();
await page.getByRole('button', { name: '运行检查' }).click();
await page.locator('.studio-result').waitFor({ timeout: 30000 });
await page.locator('.studio-result').scrollIntoViewIfNeeded();
await page.screenshot({ path: path.join(out, 'studio-result-catalog.png'), fullPage: false });
const resultText = await page.locator('.studio-result').innerText();

// Save failure must preserve the notes and transforms.
await page.locator('.studio-claim textarea').fill('保存失败时这行说明必须保留。');
await page.route('**/studio/drafts', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'forced failure' }) }));
await page.getByRole('button', { name: '保存草稿' }).click();
await page.locator('.studio-error').waitFor({ timeout: 30000 });
const preservedNote = await page.locator('.studio-claim textarea').inputValue();
const preservedStage = await page.locator('.studio-stage canvas').count();
await page.unroute('**/studio/drafts');
await page.waitForTimeout(300);

// Save draft version 1 and version 2.
await page.getByRole('button', { name: '保存草稿' }).click();
await page.locator('.studio-save-status').waitFor({ timeout: 30000 });
await page.waitForTimeout(500);
const save1 = await page.locator('.studio-save-status').innerText();
await page.locator('.studio-step-row input').first().fill('2');
await page.getByRole('button', { name: '保存草稿' }).click();
await page.waitForTimeout(1500);
const save2 = await page.locator('.studio-save-status').innerText();
const recordCount = await page.locator('.studio-example-list button').count();
await page.screenshot({ path: path.join(out, 'studio-catalog-saved.png'), fullPage: false });

// Export the feedback bundle.
const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
await page.getByRole('button', { name: '导出给 DeepSeek' }).click();
const download = await downloadPromise;
const bundlePath = path.join(out, 'studio-bundle.json');
await download.saveAs(bundlePath);
const bundle = JSON.parse(await fs.readFile(bundlePath, 'utf8'));

// Reload, reopen the latest saved record.
await page.reload({ waitUntil: 'networkidle' });
await page.getByRole('button', { name: '我来拼搭' }).last().click();
await page.locator('.studio-category-row select').waitFor({ timeout: 90000 });
await page.waitForTimeout(800);
const listCount = await page.locator('.studio-example-list button').count();
if (listCount > 0) { await page.locator('.studio-example-list button').first().click(); await page.waitForTimeout(1500); }
const reopenText = await page.locator('.studio-save-status').innerText().catch(() => 'missing');
const reopenedView = await page.locator('.studio-view-row button.active').innerText().catch(() => 'missing');
const savedPreview = await page.locator('.studio-save-status img').count();
await page.screenshot({ path: path.join(out, 'studio-catalog-reopen.png'), fullPage: false });

// Import the same bundle into drafts.
const input = page.locator('.studio-file input[type=file]');
await input.setInputFiles(bundlePath);
await page.waitForTimeout(2500);
const importNotice = await page.locator('.studio-notice').innerText().catch(() => 'missing');

// Mobile view.
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(out, 'studio-catalog-mobile.png'), fullPage: false });

const info = {
  categories,
  initialParts,
  thumbnailOk,
  gapText,
  preservedNote,
  preservedStage,
  reopenedView,
  savedPreview,
  samePart,
  exampleCount,
  resultText,
  save1,
  save2,
  recordCount,
  bundleFormat: bundle.format,
  bundleExamples: bundle.examples?.length,
  listCount,
  reopenText,
  importNotice,
  errors,
  expectedInducedErrors: errors.filter(value => value.includes('503 (Service Unavailable)')),
  unexpectedErrors: errors.filter(value => !value.includes('503 (Service Unavailable)')),
};
await fs.writeFile(path.join(out, 'catalog-ui-check.json'), JSON.stringify(info, null, 2));
console.log(JSON.stringify(info, null, 2));
await browser.close();
