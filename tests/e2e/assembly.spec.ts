import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expectConnectedAssembly, expectCoverageMatches } from './assemblyChecks.js';
import type { AggregateInterfaceCoverageData, InterfaceCoverageData } from '../../src/components/InterfaceCoverage.js';

interface DefaultPair { partA: string; connectionA: string; partB: string; connectionB: string; twistDegrees?: number }
interface Status {
  counts: { total: number; assemblyVerified: number; generatable: number; blocked: number; wheelModulesVerified?: number };
  queue?: { partId: string; assemblyVerified: boolean; generatable: boolean; reasons: string[]; interfaceCoverage: InterfaceCoverageData }[];
  entries?: { partId: string; assemblyVerified: boolean; generatable: boolean; reasons: string[]; interfaceCoverage: InterfaceCoverageData }[];
  defaultPair: DefaultPair | null;
  interfaceCoverage: AggregateInterfaceCoverageData;
}

test.setTimeout(180_000);

async function status(page: Page) {
  const response = await page.request.get('/api/parts-foundation/assembly/status', { timeout: 180_000 });
  expect(response.ok(), `${response.status()} ${await response.text()}`).toBe(true);
  return await response.json() as Status;
}
async function open(page: Page) {
  const report = await status(page);
  await page.goto('/#/part-lab?mode=assembly');
  await expect(page.getByRole('heading', { name: '真实装配验证', exact: true })).toBeVisible();
  return report;
}
async function selectPair(page: Page, pair: DefaultPair) {
  await page.getByLabel('选择固定零件 A', { exact: true }).selectOption(pair.partA);
  await page.getByLabel('选择待装配零件 B', { exact: true }).selectOption(pair.partB);
  const fixed = page.getByLabel('Connection A', { exact: true });
  const moving = page.getByLabel('Connection B', { exact: true });
  await fixed.selectOption(pair.connectionA, { timeout: 30_000 });
  await moving.selectOption(pair.connectionB, { timeout: 30_000 });
  await expect(fixed).toHaveValue(pair.connectionA);
  await expect(moving).toHaveValue(pair.connectionB);
  await page.getByLabel('选择装配旋转', { exact: true }).selectOption(String(pair.twistDegrees ?? 0));
  await expect(page.getByRole('button', { name: 'Auto Attach', exact: true })).toBeEnabled();
}
async function attach(page: Page) {
  const response = page.waitForResponse((item) => item.url().endsWith('/api/parts-foundation/assembly/attach') && item.request().method() === 'POST', { timeout: 120_000 });
  await page.getByRole('button', { name: 'Auto Attach', exact: true }).click();
  const result = await response;
  expect(result.ok()).toBe(true);
  return await result.json();
}
async function expectRealCanvas(page: Page) {
  const canvas = page.locator('.assembly-native-canvas canvas');
  await expect(canvas).toBeVisible();
  await expect(page.locator('.assembly-viewer-error')).toHaveCount(0);
  await expect.poll(() => canvas.evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl) return 0;
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let opaque = 0;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 100) opaque++;
    return opaque;
  }), { timeout: 15_000 }).toBeGreaterThan(100);
}

test('reports every real source part as passed or blocked with an explicit scope', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const report = await open(page);
  const entries = report.queue ?? report.entries ?? [];
  expect(report.counts.total).toBeGreaterThan(0);
  expect(entries.length).toBe(report.counts.total);
  expect(report.counts.assemblyVerified + report.counts.blocked).toBe(report.counts.total);
  expect(report.counts.generatable).toBeGreaterThan(0);
  expect(entries.every((entry) => entry.assemblyVerified || entry.reasons.length > 0)).toBe(true);
  await expect(page.locator('.assembly-counts > div').first().locator('strong')).toHaveText(String(report.counts.total));
  await expectCoverageMatches(page.getByRole('region', { name: '物理接口验证覆盖', exact: true }), report.interfaceCoverage);
  expect(report.interfaceCoverage.fullyAssemblyVerified).toBe(entries.filter((entry) => entry.interfaceCoverage.fullyAssemblyVerified).length);
  expect(report.interfaceCoverage.partiallyGeneratable).toBe(entries.filter((entry) => entry.interfaceCoverage.partiallyGeneratable).length);
  for (const [label, key] of [['fullyAssemblyVerified 零件', 'fullyAssemblyVerified'], ['partiallyGeneratable 零件', 'partiallyGeneratable'], ['接口已全部处理的零件', 'interfaceVerificationComplete']] as const) {
    await expect(page.locator('.assembly-part-qualifications > div').filter({ has: page.getByText(label, { exact: true }) }).locator('dd')).toHaveText(String(report.interfaceCoverage[key]));
  }
  if (entries.length > 20) await page.getByRole('button', { name: `查看全部 ${entries.length} 个结果`, exact: true }).click();
  await expect(page.locator('.assembly-migration tbody tr')).toHaveCount(entries.length);
  for (const entry of entries) {
    const row = page.locator('.assembly-migration tbody tr').filter({ has: page.getByRole('cell', { name: entry.partId, exact: true }) });
    await expect(row).toContainText(`${entry.interfaceCoverage.verifiedPass} / ${entry.interfaceCoverage.physicalInterfacesDiscovered}`);
    if (entry.interfaceCoverage.fullyAssemblyVerified) await expect(row).toContainText('fullyAssemblyVerified');
    else if (entry.interfaceCoverage.partiallyGeneratable) await expect(row).toContainText('partiallyGeneratable');
  }
  const blocked = entries.find((entry) => !entry.assemblyVerified);
  if (blocked) {
    await page.getByLabel('搜索装配迁移零件', { exact: true }).fill(blocked.partId);
    await page.getByLabel('筛选装配验证状态', { exact: true }).selectOption('blocked');
    const row = page.locator('.assembly-migration tbody tr').filter({ has: page.getByRole('cell', { name: blocked.partId, exact: true }) });
    await expect(row).toContainText('BLOCKED');
    await expect(row).toContainText(blocked.reasons[0]);
  }
  expect(errors).toEqual([]);
});

test('attaches a source-verified pair and rejects the same mating gender', async ({ page }, testInfo) => {
  const report = await open(page);
  expect(report.defaultPair, 'The migration report must provide one actual eligible fixture pair.').not.toBeNull();
  const pair = report.defaultPair!;
  await selectPair(page, pair);
  const accepted = await attach(page);
  expect(accepted.accepted).toBe(true);
  expect(accepted.assembly.placements).toHaveLength(2);
  expectConnectedAssembly(accepted.assembly);
  await expect(page.locator('.assembly-result-heading')).toContainText('通过当前装配检查');
  await expect(page.getByRole('heading', { name: 'Part B 最终变换 · LDraw LDU', exact: true })).toBeVisible();
  await expectRealCanvas(page);
  await page.getByRole('checkbox', { name: '碰撞代理', exact: true }).check();
  await page.getByRole('checkbox', { name: '合法插入区', exact: true }).check();
  await expectRealCanvas(page);
  await page.locator('.assembly-result').screenshot({ path: testInfo.outputPath('source-verified-attachment.png') });
  await selectPair(page, { partA: pair.partA, connectionA: pair.connectionA, partB: pair.partA, connectionB: pair.connectionA });
  const rejected = await attach(page);
  expect(rejected.accepted).toBe(false);
  expect(rejected.compatibility?.status).toBe('incompatible');
  expect(rejected.assembly.placements).toHaveLength(1);
  await expect(page.locator('.assembly-result-heading')).toContainText('本次未通过');
  await expect(page.locator('.assembly-reasons').first()).toContainText(/gender|同|性别/i);
});

test('generates source-bound wall and chassis modules and preserves unsupported wheel reasons', async ({ page }, testInfo) => {
  const report = await open(page);
  const entries = report.queue ?? report.entries ?? [];
  const allowed = new Set(entries.filter((entry) => entry.assemblyVerified && entry.generatable).map((entry) => entry.partId));
  for (const label of ['墙体', '简单车架']) {
    const response = page.waitForResponse((item) => item.url().endsWith('/api/parts-foundation/assembly/generate') && item.request().method() === 'POST', { timeout: 120_000 });
    await page.getByRole('button', { name: label, exact: true }).click();
    const generation = await response;
    expect(generation.ok()).toBe(true);
    const result = await generation.json();
    expect(result.status).toBe('generated');
    expect(result.model.placements.length).toBeGreaterThan(1);
    expectConnectedAssembly(result.model);
    expect(result.model.placements.every((placement: { partId: string }) => allowed.has(placement.partId))).toBe(true);
    for (const key of ['partLibraryVersion', 'assemblyEngineVersion', 'connectionRuleVersion', 'collisionVersion']) expect(typeof result.model[key]).toBe('string');
    await expectRealCanvas(page);
    await expect(page.locator('.assembly-result-heading')).toContainText('通过当前装配检查');
  }
  await page.locator('.assembly-result').screenshot({ path: testInfo.outputPath('native-chassis.png') });
  const wheelResponse = page.waitForResponse((item) => item.url().endsWith('/api/parts-foundation/assembly/generate') && item.request().method() === 'POST');
  await page.getByRole('button', { name: '轮组模块', exact: true }).click();
  const wheel = await (await wheelResponse).json();
  if ((report.counts.wheelModulesVerified ?? 0) === 0) {
    expect(wheel.status).toBe('blocked');
    expect(wheel.reasons.length).toBeGreaterThan(0);
    await expect(page.locator('.assembly-result-heading')).toContainText('本次未通过');
    await expect(page.locator('.assembly-reasons').first()).toContainText(wheel.reasons[0]);
  } else expect(['generated', 'blocked']).toContain(wheel.status);
});

test('imports exported real models through current validation and prevents export after version or occupancy invalidation', async ({ page }) => {
  await open(page);
  const generationResponse = page.waitForResponse((item) => item.url().endsWith('/api/parts-foundation/assembly/generate') && item.request().method() === 'POST');
  await page.getByRole('button', { name: '墙体', exact: true }).click();
  const generated = await (await generationResponse).json();
  expect(generated.status).toBe('generated');
  expectConnectedAssembly(generated.model);
  await expect(page.locator('.assembly-export-buttons').getByRole('button', { name: '模型 JSON', exact: true })).toBeEnabled();
  const download = page.waitForEvent('download');
  await page.locator('.assembly-export-buttons').getByRole('button', { name: '模型 JSON', exact: true }).click();
  const file = await download, filename = await file.path();
  expect(filename).not.toBeNull();
  const content = await readFile(filename!, 'utf8');
  const exported = JSON.parse(content);
  expectConnectedAssembly(exported);

  async function upload(raw: string) {
    await page.getByLabel('选择真实装配模型 JSON', { exact: true }).setInputFiles({ name: 'real-assembly.json', mimeType: 'application/json', buffer: Buffer.from(raw) });
    const response = page.waitForResponse((item) => item.url().endsWith('/api/parts-foundation/assembly/models/import') && item.request().method() === 'POST');
    await page.getByRole('button', { name: '验证导入模型', exact: true }).click();
    const result = await response;
    expect(result.ok(), `${result.status()} ${await result.text()}`).toBe(true);
    return await result.json();
  }
  const imported = await upload(content);
  expect(imported.status).toBe('VALID');
  expect(imported.model.id).not.toBe(exported.id);
  expectConnectedAssembly(imported.model);
  await expect(page.locator('.assembly-import-status')).toContainText('VALID');
  await expect(page.locator('.assembly-export-buttons').getByRole('button', { name: '模型 JSON', exact: true })).toBeEnabled();

  const { contentSha256: _checksum, ...stale } = exported;
  stale.assemblyEngineVersion = 'outdated-engine-for-revalidation-test';
  const expired = await upload(JSON.stringify({ ...stale, contentSha256: createHash('sha256').update(JSON.stringify(stale)).digest('hex') }));
  expect(expired.status).toBe('NEEDS_REVALIDATION');
  expect(expired.model).toBeNull();
  expect(expired.reasons.length).toBeGreaterThan(0);
  await expect(page.locator('.assembly-import-status')).toContainText('NEEDS_REVALIDATION');
  await expect(page.locator('.assembly-export-buttons')).toHaveCount(0);

  const { contentSha256: _oldChecksum, ...occupied } = JSON.parse(content);
  occupied.edges.push({ ...occupied.edges[0], id: 'duplicate-source-endpoint-for-revalidation-test' });
  const duplicated = await upload(JSON.stringify({ ...occupied, contentSha256: createHash('sha256').update(JSON.stringify(occupied)).digest('hex') }));
  expect(duplicated.status).toBe('NEEDS_REVALIDATION');
  expect(duplicated.model).toBeNull();
  expect(duplicated.reasons.length).toBeGreaterThan(0);
  await expect(page.locator('.assembly-export-buttons')).toHaveCount(0);
});

test('mobile assembly mode keeps source controls, accepted rendering and debug data within the viewport', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const report = await open(page);
  expect(report.defaultPair).not.toBeNull();
  await selectPair(page, report.defaultPair!);
  expect((await attach(page)).accepted).toBe(true);
  await expectRealCanvas(page);
  await page.getByRole('checkbox', { name: '连接轴与插入路径', exact: true }).check();
  await page.locator('.assembly-result-data').filter({ has: page.getByText('插入路径与可视化调试数据', { exact: true }) }).locator('summary').click();
  const dimensions = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
  expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport + 1);
  await page.locator('.assembly-result').screenshot({ path: testInfo.outputPath('mobile-assembly.png') });
});
