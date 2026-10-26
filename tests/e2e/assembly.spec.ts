import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { expectConnectedAssembly, expectCoverageMatches, expectGrammarAssessment } from './assemblyChecks.js';
import type { AggregateInterfaceCoverageData, InterfaceCoverageData } from '../../src/components/InterfaceCoverage.js';

test('uses an admitted 32000 through normal UI generation, exports it and validates the uploaded model', async ({ page }) => {
  await open(page);
  await page.getByLabel('生成时包含的零件', { exact: true }).selectOption('32000');
  await page.getByLabel('生成零件数量', { exact: true }).fill('3');
  const generatedResponse = page.waitForResponse(response => response.url().endsWith('/api/parts-foundation/assembly/generate') && response.request().method() === 'POST');
  await page.locator('.assembly-smoke-tests').getByRole('button', { name: '墙体', exact: true }).click();
  const response = await generatedResponse;
  expect(response.ok()).toBe(true);
  expect(response.request().postDataJSON()).toMatchObject({ kind: 'wall', partCount: 3, requiredPartIds: ['32000'] });
  const result = await response.json();
  expect(result.status, result.reasons?.join('; ')).toBe('generated');
  expect(result.model.placements.some((part: { partId: string }) => part.partId === '32000')).toBe(true);
  expect(result.model.bom.some((row: { partId: string; quantity: number }) => row.partId === '32000' && row.quantity > 0)).toBe(true);
  expect(result.model.steps.some((step: { partId: string }) => step.partId === '32000')).toBe(true);
  expectGrammarAssessment(result.model);
  await expectRealCanvas(page);
  await expect(page.locator('.assembly-result')).toContainText('应力、实际稳定性及实体实拼尚未验证');
  const download = page.waitForEvent('download', { timeout: 30_000 }).catch(() => null);
  const exportResponse = page.waitForResponse(response => response.url().includes('/assembly/models/') && response.url().endsWith('/export?format=json'));
  await page.getByRole('button', { name: '模型 JSON', exact: true }).click();
  const exportResult = await exportResponse;
  expect(exportResult.ok(), `${exportResult.status()} ${await exportResult.text()}`).toBe(true);
  const exported = await download;
  expect(exported).not.toBeNull();
  const file = await exported!.path();
  expect(file).not.toBeNull();
  const bytes = await readFile(file!);
  await page.getByLabel('选择真实装配模型 JSON', { exact: true }).setInputFiles({ name: 'native-32000.json', mimeType: 'application/json', buffer: bytes });
  const importResponse = page.waitForResponse(response => response.url().endsWith('/api/parts-foundation/assembly/models/import') && response.request().method() === 'POST');
  await page.getByRole('button', { name: '验证导入模型', exact: true }).click();
  const imported = await (await importResponse).json();
  expect(imported.status, imported.reasons?.join('; ')).toBe('VALID');
  expect(imported.model.placements.some((part: { partId: string }) => part.partId === '32000')).toBe(true);
  expectGrammarAssessment(imported.model);
  await expect(page.locator('.assembly-import-status')).toContainText('VALID');
  await mkdir('artifacts/connector-grammar/screenshots', { recursive: true });
  await page.locator('.assembly-native-stage').screenshot({ path: 'artifacts/connector-grammar/screenshots/32000-production-and-reimport.png' });
});

interface DefaultPair { partA: string; connectionA: string; partB: string; connectionB: string; twistDegrees?: number }
interface Status {
  admissionBasis: 'interface-grammar';
  grammar: { counts: { generationEligible: number; supportedFeatures: number; enabledNativeEndpoints: number; historicalFixtureProofsRequired: number; executedPartFixtureTests: number } };
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

test('separates source grammar eligibility from actual assembly evidence for every real part', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const report = await open(page);
  const entries = report.queue ?? report.entries ?? [];
  expect(report.counts.total).toBeGreaterThan(0);
  expect(entries.length).toBe(report.counts.total);
  expect(report.admissionBasis).toBe('interface-grammar');
  expect(report.counts.generatable + report.counts.blocked).toBe(report.counts.total);
  expect(report.counts.assemblyVerified).toBe(0);
  expect(report.grammar.counts.historicalFixtureProofsRequired).toBe(0);
  expect(report.grammar.counts.executedPartFixtureTests).toBe(0);
  expect(report.counts.generatable).toBeGreaterThan(0);
  expect(entries.filter(entry => entry.generatable)).toHaveLength(report.counts.generatable);
  expect(entries.every((entry) => !entry.assemblyVerified && (entry.generatable || entry.reasons.length > 0))).toBe(true);
  await expect(page.locator('.assembly-counts > div').first().locator('strong')).toHaveText(String(report.counts.total));
  await expect(page.locator('.assembly-counts > div').filter({ hasText: '语法可选零件' }).locator('strong')).toHaveText(String(report.counts.generatable));
  await expect(page.locator('.assembly-counts > div').filter({ hasText: '有已保存装配证明' }).locator('strong')).toHaveText('0');
  await expectCoverageMatches(page.getByRole('region', { name: '物理接口验证覆盖', exact: true }), report.interfaceCoverage);
  expect(report.interfaceCoverage.fullyAssemblyVerified).toBe(entries.filter((entry) => entry.interfaceCoverage.fullyAssemblyVerified).length);
  expect(report.interfaceCoverage.partiallyGeneratable).toBe(entries.filter((entry) => entry.interfaceCoverage.partiallyGeneratable).length);
  expect(report.interfaceCoverage.verifiedPass).toBe(0);
  for (const [label, expected] of [['语法开放原始接口', report.grammar.counts.enabledNativeEndpoints], ['符合规则的接口特征', report.grammar.counts.supportedFeatures], ['有已保存装配证明的零件', report.counts.assemblyVerified]] as const) {
    await expect(page.locator('.assembly-part-qualifications > div').filter({ has: page.getByText(label, { exact: true }) }).locator('dd')).toHaveText(String(expected));
  }
  if (entries.length > 20) await page.getByRole('button', { name: `查看全部 ${entries.length} 个结果`, exact: true }).click();
  await expect(page.locator('.assembly-migration tbody tr')).toHaveCount(entries.length);
  for (const entry of entries) {
    const row = page.locator('.assembly-migration tbody tr').filter({ has: page.getByRole('cell', { name: entry.partId, exact: true }) });
    await expect(row).toContainText(`${entry.interfaceCoverage.verifiedPass} / ${entry.interfaceCoverage.physicalInterfacesDiscovered}`);
    expect(entry.interfaceCoverage.fullyAssemblyVerified).toBe(false);
    expect(entry.interfaceCoverage.partiallyGeneratable).toBe(false);
    await expect(row).toContainText(entry.generatable ? 'GRAMMAR_ELIGIBLE' : 'BLOCKED');
  }
  await page.getByLabel('筛选装配验证状态', { exact: true }).selectOption('eligible');
  await expect(page.locator('.assembly-migration tbody tr')).toHaveCount(report.counts.generatable);
  const blocked = entries.find((entry) => !entry.generatable);
  if (blocked) {
    await page.getByLabel('搜索装配迁移零件', { exact: true }).fill(blocked.partId);
    await page.getByLabel('筛选装配验证状态', { exact: true }).selectOption('blocked');
    const row = page.locator('.assembly-migration tbody tr').filter({ has: page.getByRole('cell', { name: blocked.partId, exact: true }) });
    await expect(row).toContainText('BLOCKED');
    await expect(row).toContainText(blocked.reasons[0]);
  }
  expect(errors).toEqual([]);
});

test('attaches a source-backed grammar pair and rejects the same mating gender', async ({ page }, testInfo) => {
  const report = await open(page);
  expect(report.defaultPair, 'The source grammar must provide an eligible connector pair without remembered fixture results.').not.toBeNull();
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
  const allowed = new Set(entries.filter((entry) => entry.generatable).map((entry) => entry.partId));
  for (const label of ['墙体', '简单车架']) {
    const response = page.waitForResponse((item) => item.url().endsWith('/api/parts-foundation/assembly/generate') && item.request().method() === 'POST', { timeout: 120_000 });
    await page.getByRole('button', { name: label, exact: true }).click();
    const generation = await response;
    expect(generation.ok()).toBe(true);
    const result = await generation.json();
    expect(result.status).toBe('generated');
    expect(result.model.placements.length).toBeGreaterThan(1);
    expectConnectedAssembly(result.model);
    expectGrammarAssessment(result.model);
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
