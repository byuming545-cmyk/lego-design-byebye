import { expect, test, type Page, type Response } from '@playwright/test';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../src/api/app.js';
import { createInventoryProvider } from '../../src/inventory/index.js';
import type { SpeedModelDocument, SpeedModelSummary } from '../../src/speed/documents.js';
import type { PhysicalBuildFeedback, PhysicalBuildFeedbackInput } from '../../src/speed/feedback.js';
import type { SpeedGenerationResult, VehicleCandidate } from '../../src/speed/types.js';

interface SpeedSession extends SpeedGenerationResult { sessionId: string }

const pathname = (response: Response) => new URL(response.url()).pathname;
const responseFor = (path: string, method: string) => (response: Response) => pathname(response) === path && response.request().method() === method;
const LAST_MODEL_KEY = 'bricklab-speed-last-model-id';

/** Observe large, genuine responses without replacing requests or application data. */
async function observedJson<T>(page: Page, path: string, method: string, action: () => Promise<unknown>): Promise<{ response: Response; data: T }> {
  const network = await page.context().newCDPSession(page);
  await network.send('Network.enable', { maxTotalBufferSize: 128 * 1024 * 1024, maxResourceBufferSize: 128 * 1024 * 1024 });
  let requestId: string | undefined;
  const body = new Promise<T>((resolve, reject) => {
    network.on('Network.responseReceived', event => {
      if (new URL(event.response.url).pathname === path) requestId = event.requestId;
    });
    network.on('Network.loadingFinished', event => {
      if (event.requestId !== requestId) return;
      void network.send('Network.getResponseBody', { requestId: event.requestId }).then(result => {
        resolve(JSON.parse(result.base64Encoded ? Buffer.from(result.body, 'base64').toString() : result.body) as T);
      }).catch(reject);
    });
    network.on('Network.loadingFailed', event => {
      if (event.requestId === requestId) reject(new Error(event.errorText));
    });
  });
  try {
    const responsePromise = page.waitForResponse(responseFor(path, method));
    await action();
    const response = await responsePromise;
    return { response, data: await body };
  } finally { await network.detach(); }
}

async function exportJson(page: Page): Promise<SpeedModelDocument> {
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出模型 JSON', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^bricklab-speed-.*\.json$/);
  expect(await download.failure()).toBeNull();
  return JSON.parse(await readFile((await download.path())!, 'utf8')) as SpeedModelDocument;
}

async function assertViewerAndInstructions(page: Page, candidate: VehicleCandidate): Promise<void> {
  await expect(page.locator('.speed-model-stage .model-viewer-canvas')).toHaveAccessibleName(new RegExp(`共 ${candidate.model.parts.length} 个零件`));
  await page.getByRole('button', { name: '开始拼搭', exact: true }).click();
  const lastStep = candidate.steps.length;
  await page.getByRole('button', { name: `Speed 跳转第 ${lastStep} 步`, exact: true }).click();
  await expect(page.getByRole('button', { name: '下一步', exact: true })).toBeDisabled();
  await expect(page.locator('.speed-model-stage .model-viewer-canvas')).toHaveAccessibleName(new RegExp(`共 ${candidate.steps.at(-1)!.totalModelState.length} 个零件`));
  await page.getByRole('button', { name: '完整车辆', exact: true }).click();
}

async function setImportFile(page: Page, value: unknown, name: string): Promise<void> {
  await page.getByLabel('导入模型 JSON', { exact: true }).setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
}

test.describe('Speed Creative V0.2.1 Validation Edition', () => {
  test('production without an API key reports unconfigured and refuses both real and demo inventory', async ({ request }, testInfo) => {
    // This isolated server uses the application's actual missing-key provider;
    // no response or Rebrickable inventory is mocked.
    const previousNodeEnv = process.env.NODE_ENV;
    const previousDataDir = process.env.BRICKLAB_DATA_DIR;
    let app: ReturnType<typeof createApp>;
    try {
      process.env.NODE_ENV = 'production';
      process.env.BRICKLAB_DATA_DIR = testInfo.outputPath('unconfigured-data');
      app = createApp({ provider: createInventoryProvider({ NODE_ENV: 'production', INVENTORY_PROVIDER: 'auto', REBRICKABLE_API_KEY: '' }), staticDir: false });
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousDataDir === undefined) delete process.env.BRICKLAB_DATA_DIR;
      else process.env.BRICKLAB_DATA_DIR = previousDataDir;
    }
    const server = app.listen(0, '127.0.0.1');
    try {
      await once(server, 'listening');
      const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const statusResponse = await request.get(`${baseUrl}/api/speed/status`);
      expect(statusResponse.status()).toBe(200);
      expect(await statusResponse.json()).toMatchObject({ dataSource: 'Rebrickable', mode: 'unconfigured', realAvailable: false, demoAllowed: false });
      for (const setNumber of ['76922', 'DEMO-SPEED']) {
        const response = await request.get(`${baseUrl}/api/speed/inventory`, { params: { sets: setNumber } });
        expect(response.status()).toBe(503);
        expect(await response.json()).toEqual({ error: 'Rebrickable API Key 未配置。', code: 'MISSING_API_KEY' });
      }
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });

  test('persists generated models, revalidates imports, rejects invalid files and retains synthetic partial feedback', async ({ page, request }) => {
    test.setTimeout(240000);
    const browserErrors: string[] = [];
    page.on('pageerror', error => browserErrors.push(error.message));
    const inventoryPromise = page.waitForResponse(response => pathname(response) === '/api/speed/inventory');
    await page.goto('/#/speed');
    expect((await inventoryPromise).status()).toBe(200);
    await expect(page.getByLabel('Speed 数据来源与版本')).toContainText('Data Source: Mock');
    await expect(page.getByLabel('Speed 数据来源与版本')).toContainText('Mode: mock');
    await expect(page.getByRole('button', { name: '生成 Speed 方案', exact: true })).toBeEnabled();
    const generated = await observedJson<SpeedSession>(page, '/api/speed/generate', 'POST', () => page.getByRole('button', { name: '生成 Speed 方案', exact: true }).click());
    expect(generated.response.status()).toBe(200);
    expect(generated.data.inventory.source).toBe('mock');
    expect(generated.data.candidates.length).toBeGreaterThan(0);
    const candidate = generated.data.candidates[0];
    const document = await exportJson(page);
    expect(document.schemaVersion).toBe(1);
    expect(document.candidate).toEqual(candidate);
    expect(document.inventory).toEqual(generated.data.inventory);
    expect(document.metadata).toMatchObject({ modelId: candidate.model.id, revision: 1, physicalValidation: 'untested', origin: 'generated', sourceSets: ['DEMO-SPEED'] });
    expect(document.metadata.modelDigest).toMatch(/^[a-f0-9]{64}$/);
    for (const key of ['generatorVersion', 'validatorVersion', 'partLibraryVersion'] as const) expect(document.metadata[key]).toBeTruthy();
    expect(document.candidate.model.connections.length).toBeGreaterThan(0);
    expect(document.candidate.model.modules.length).toBeGreaterThan(0);
    expect(document.candidate.steps.length).toBeGreaterThan(1);
    expect(document.candidate.validation.valid).toBe(true);
    await expect.poll(() => page.evaluate(key => localStorage.getItem(key), LAST_MODEL_KEY)).toBe(candidate.model.id);

    const restored = await observedJson<SpeedSession>(page, `/api/speed/models/${candidate.model.id}/open`, 'POST', () => page.reload());
    expect(restored.response.status()).toBe(200);
    expect(restored.data.candidates[0]).toEqual(candidate);
    expect((await exportJson(page)).metadata).toEqual(document.metadata);
    await assertViewerAndInstructions(page, candidate);

    const feedbackPanel = page.locator('.speed-physical-feedback');
    await feedbackPanel.locator('summary').click();
    await expect(feedbackPanel).toContainText('实拼状态 · untested');
    await expect(page.getByRole('button', { name: '保存实拼反馈', exact: true })).toBeDisabled();
    await expect(page.getByRole('combobox', { name: '实拼结果', exact: true })).toBeDisabled();
    const feedbackPath = `/api/speed/models/${candidate.model.id}/feedback`;
    // A synthetic form submission exercises storage only. No LEGO was built,
    // and the partial report must never create a physicalValidation=passed claim.
    const fixtureText = '[AUTOMATED TEST FIXTURE — no physical build] 第一步连接过弱，需要人工实拼确认。';
    const feedback: PhysicalBuildFeedbackInput = {
      modelId: candidate.model.id, revision: document.metadata.revision, modelDigest: document.metadata.modelDigest,
      actuallyBuilt: true, buildResult: 'partial', wheel: 'friction', stability: 'weak', instructions: 'difficult',
      problems: [{ stepNumber: candidate.steps[0].stepNumber, partId: candidate.model.parts[0].partId, issueType: 'too_weak', text: fixtureText }],
    };
    const unconfirmed = await request.post(feedbackPath, { data: { ...feedback, actuallyBuilt: false } });
    expect(unconfirmed.status()).toBe(400);
    expect((await unconfirmed.json()).code).toBe('INVALID_PHYSICAL_BUILD_FEEDBACK');
    const mismatched = await request.post(feedbackPath, { data: { ...feedback, modelDigest: '0'.repeat(64) } });
    expect(mismatched.status()).toBe(404);
    expect((await mismatched.json()).code).toBe('SPEED_MODEL_REVISION_NOT_FOUND');
    await page.getByRole('checkbox', { name: '我已使用真实积木，实际尝试拼搭这个版本。', exact: true }).check();
    await page.getByRole('combobox', { name: '实拼结果', exact: true }).selectOption('partial');
    await page.getByRole('combobox', { name: '实拼车轮', exact: true }).selectOption('friction');
    await page.getByRole('combobox', { name: '实拼稳定性', exact: true }).selectOption('weak');
    await page.getByRole('combobox', { name: '实拼说明书', exact: true }).selectOption('difficult');
    await page.getByRole('button', { name: '添加拼搭问题', exact: true }).click();
    await page.getByRole('spinbutton', { name: '问题 1 步骤编号', exact: true }).fill(String(feedback.problems[0].stepNumber));
    await page.getByRole('textbox', { name: '问题 1 零件编号', exact: true }).fill(feedback.problems[0].partId!);
    await page.getByRole('combobox', { name: '问题 1 类型', exact: true }).selectOption('too_weak');
    await page.getByRole('textbox', { name: '问题 1 描述', exact: true }).fill(fixtureText);
    const feedbackResponsePromise = page.waitForResponse(responseFor(feedbackPath, 'POST'));
    await page.getByRole('button', { name: '保存实拼反馈', exact: true }).click();
    const feedbackResponse = await feedbackResponsePromise;
    expect(feedbackResponse.status()).toBe(200);
    expect(feedbackResponse.request().postDataJSON()).toEqual(feedback);
    const feedbackResult = await feedbackResponse.json() as { feedback: PhysicalBuildFeedback; physicalValidation: string; userReported: boolean };
    const savedFeedback = feedbackResult.feedback;
    expect(feedbackResult).toMatchObject({ physicalValidation: 'untested', userReported: true });
    expect(savedFeedback).toMatchObject({ ...feedback, userReported: true, physicalValidation: 'untested' });
    await expect(page.getByText('实拼反馈已保存；尚未达到用户自报通过条件，状态为 untested。', { exact: true })).toBeVisible();
    await expect(feedbackPanel.locator('summary')).toContainText('实拼状态 · untested');
    await expect(feedbackPanel.locator('summary')).not.toContainText('用户实拼自报通过');
    const feedbackRestored = await observedJson<SpeedSession>(page, `/api/speed/models/${candidate.model.id}/open`, 'POST', () => page.reload());
    expect(feedbackRestored.data.candidates[0].model.id).toBe(candidate.model.id);
    await feedbackPanel.locator('summary').click();
    await expect(page.getByLabel('已保存实拼反馈')).toContainText('已保存 1 条用户自报反馈');
    await expect(page.getByLabel('已保存实拼反馈')).toContainText('当前版本 · 用户自报：部分成功');
    await expect(page.getByLabel('已保存实拼反馈')).toContainText(fixtureText);
    await expect(feedbackPanel.locator('summary')).toContainText('实拼状态 · untested');
    const storedFeedbackResponse = await request.get(feedbackPath);
    expect(storedFeedbackResponse.status()).toBe(200);
    const storedFeedback = await storedFeedbackResponse.json() as { feedback: PhysicalBuildFeedback[] };
    expect(storedFeedback.feedback).toContainEqual(savedFeedback);
    expect((await exportJson(page)).metadata.physicalValidation).toBe('untested');

    const savedPanel = page.locator('.speed-saved-models');
    await savedPanel.locator('summary').click();
    const untrustedClaims = structuredClone(document);
    Object.assign(untrustedClaims.metadata, { physicalValidation: 'passed' });
    untrustedClaims.candidate.validation.valid = false;
    untrustedClaims.candidate.validation.errors = ['UNTRUSTED_IMPORTED_VALIDATION'];
    untrustedClaims.candidate.steps = [];
    const imported = await observedJson<SpeedSession>(page, '/api/speed/models/import', 'POST', () => setImportFile(page, untrustedClaims, 'model-with-untrusted-claims.json'));
    expect(imported.response.status()).toBe(200);
    const importedCandidate = imported.data.candidates[0];
    expect(importedCandidate.model.id).not.toBe(candidate.model.id);
    expect(importedCandidate.validation.valid).toBe(true);
    expect(importedCandidate.validation.errors).toEqual([]);
    expect(importedCandidate.model.connections.length).toBeGreaterThan(0);
    expect(importedCandidate.steps.length).toBeGreaterThan(1);
    expect(imported.data.inventory.sourceLabel).toContain('用户自报');
    expect(imported.data.inventory.inventorySources.every(source => source.source === 'custom')).toBe(true);
    await expect(page.getByLabel('Speed 数据来源与版本')).toContainText('Data Source: 用户自报（未核验）');
    await expect(page.getByText('模型已重新校验并导入，已分配新的模型 ID。实拼状态为 untested。', { exact: true })).toBeVisible();
    const importedDocument = await exportJson(page);
    expect(importedDocument.metadata).toMatchObject({ modelId: importedCandidate.model.id, origin: 'imported', physicalValidation: 'untested', snapshotIds: [], importedFrom: { modelId: candidate.model.id } });
    expect(importedDocument.candidate.validation.valid).toBe(true);
    await assertViewerAndInstructions(page, importedCandidate);
    const modelsResponse = await request.get('/api/speed/models');
    const models = (await modelsResponse.json() as { models: SpeedModelSummary[] }).models;
    expect(models).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: candidate.model.id, physicalValidation: 'untested' }),
      expect.objectContaining({ id: importedCandidate.model.id, physicalValidation: 'untested' }),
    ]));
    await page.getByRole('combobox', { name: '保存的模型', exact: true }).selectOption(candidate.model.id);
    const openedOriginal = await observedJson<SpeedSession>(page, `/api/speed/models/${candidate.model.id}/open`, 'POST', () => page.getByRole('button', { name: '打开模型', exact: true }).click());
    expect(openedOriginal.data.candidates[0].model.id).toBe(candidate.model.id);
    await page.getByRole('combobox', { name: '保存的模型', exact: true }).selectOption(importedCandidate.model.id);
    const openedImported = await observedJson<SpeedSession>(page, `/api/speed/models/${importedCandidate.model.id}/open`, 'POST', () => page.getByRole('button', { name: '打开模型', exact: true }).click());
    expect(openedImported.data.candidates[0]).toEqual(importedCandidate);

    const invalidGeometry = structuredClone(document);
    invalidGeometry.candidate.model.parts[0].dimensions.x += 1;
    const negativeStock = structuredClone(document);
    negativeStock.inventory.items[0].quantityAvailable = -1;
    for (const [name, invalid] of [['invalid-geometry.json', invalidGeometry], ['negative-stock.json', negativeStock]] as const) {
      const responsePromise = page.waitForResponse(responseFor('/api/speed/models/import', 'POST'));
      await setImportFile(page, invalid, name);
      const response = await responsePromise;
      expect(response.status()).toBe(400);
      expect((await response.json()).code).toBe('INVALID_SPEED_MODEL_DOCUMENT');
      await expect(page.getByRole('alert')).toContainText('模型导入失败');
      await expect.poll(() => page.evaluate(key => localStorage.getItem(key), LAST_MODEL_KEY)).toBe(importedCandidate.model.id);
      expect(await exportJson(page)).toEqual(importedDocument);
      await expect(page.locator('.speed-model-stage .model-viewer-canvas')).toHaveAccessibleName(new RegExp(`共 ${importedCandidate.model.parts.length} 个零件`));
    }
    expect(browserErrors).toEqual([]);
  });
});
