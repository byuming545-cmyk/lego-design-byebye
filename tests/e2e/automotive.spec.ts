import { expect, test, type Download, type Page, type Response } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { AutomotiveDesignResponse } from '../../src/automotive/contracts.js';
import type { VehicleResearchResult } from '../../src/automotive/research/types.js';

const pathname = (response: Response) => new URL(response.url()).pathname;
const designResponse = (response: Response) => pathname(response) === '/api/automotive/design' && response.request().method() === 'POST';

async function openAutomotive(page: Page): Promise<VehicleResearchResult> {
  const researched = page.waitForResponse(response => pathname(response) === '/api/automotive/research');
  await page.goto('/#/automotive');
  const response = await researched;
  expect(response.status(), await response.text()).toBe(200);
  const result = await response.json() as VehicleResearchResult;
  await expect(page.getByRole('button', { name: '研究车型与来源' })).toBeEnabled();
  await expect(page.getByText('Automotive 引擎已连接', { exact: true })).toBeVisible();
  return result;
}

async function renderedCar(page: Page, partCount: number) {
  const canvas = page.locator('.auto-viewer .model-viewer-canvas');
  await expect(canvas).toHaveAccessibleName(new RegExp(`交互式 3D 积木模型，共 ${partCount} 个零件`));
  await expect(canvas).toHaveAttribute('data-renderer', 'webgl');
  await expect(canvas).toHaveAttribute('data-rendered-parts', String(partCount));
  // A real WebGL frame must exist. An accessible label alone would also pass
  // for a blank canvas or for a model whose geometry never finished rendering.
  await expect.poll(() => canvas.evaluate(element => {
    const canvasElement = element as HTMLCanvasElement;
    const gl = canvasElement.getContext('webgl2') ?? canvasElement.getContext('webgl');
    if (!gl || gl.isContextLost() || canvasElement.width < 1 || canvasElement.height < 1) return 0;
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let visible = 0;
    for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 0) visible++;
    return visible;
  })).toBeGreaterThan(1000);
  await expect(page.locator('.auto-generating')).toHaveCount(0);
}

async function download(page: Page, label: string): Promise<{ download: Download; bytes: Buffer }> {
  const pending = page.waitForEvent('download', { timeout: 120_000 });
  await page.getByRole('button', { name: label, exact: true }).click();
  const result = await pending;
  expect(await result.failure()).toBeNull();
  return { download: result, bytes: await readFile((await result.path())!) };
}

async function noHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => ({ width: window.innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth })))
    .toEqual({ width: 390, document: 390, body: 390 });
}

test.describe('Free Automotive Designer V0.3', () => {
  test.setTimeout(180_000);

  test('keeps research, missing dimensions and engineering provenance honest without loading inventory', async ({ page, request }) => {
    const inventoryRequests: string[] = [];
    page.on('request', request => {
      if (/\/api\/(?:sets(?:\/|$)|speed\/inventory)|rebrickable/i.test(request.url())) inventoryRequests.push(request.url());
    });
    const research = await openAutomotive(page);
    expect(research.profile?.generation).toBe('W223');
    expect(Object.values(research.profile!.dimensions).some(fact => fact.value === null)).toBe(true);
    await expect(page.getByText('规则驱动生成 · 未训练 AI 模型', { exact: true })).toBeVisible();
    await expect(page.getByText('参考图片尚未分析', { exact: true })).toBeVisible();
    await expect(page.getByText('零件颜色组合的生产可用性未核实', { exact: true })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: /允许 estimated 比例/ })).not.toBeChecked();
    await expect(page.getByText('当前缺少真实尺寸。请补充资料或允许估算。', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '生成 8 个设计候选', exact: true })).toBeDisabled();
    await expect(page.locator('.auto-viewer .model-viewer-canvas')).toHaveCount(0);

    // The same boundary is enforced by the real API when the UI is bypassed.
    const refused = await request.post('/api/automotive/design', { data: { profileId: research.profile!.id, widthStuds: 8, candidateCount: 5, allowEstimatedProportions: false } });
    expect(refused.status()).toBe(422);
    expect(await refused.json()).toMatchObject({ code: 'UNKNOWN_DIMENSIONS' });

    await page.getByRole('tab', { name: '车型研究', exact: true }).click();
    await expect(page.getByRole('tabpanel')).toContainText('尺寸缺失');
    await expect(page.getByRole('tabpanel')).toContainText('来源');
    const official = page.locator('.auto-research a[target="_blank"]').first();
    await expect(official).toHaveAttribute('href', /^https:\/\//);
    await expect(page.getByRole('tabpanel')).toContainText(/访问受阻|获取失败|未抓取|已抓取/);
    await page.getByRole('link', { name: 'Automotive Lab', exact: true }).click();
    await expect(page.getByRole('heading', { name: '参考模型库', exact: true })).toBeVisible();
    await expect(page.locator('.auto-lab-patterns').filter({ has: page.getByRole('heading', { name: 'Lego Design Patterns', exact: true }) })).toContainText('工程先验会明确标注');
    await page.getByText('候选选择 / 检查 / 生成调试', { exact: true }).click();
    await expect(page.locator('.auto-debug')).toContainText('"modelTraining": "none"');
    expect(inventoryRequests).toEqual([]);

    await page.setViewportSize({ width: 390, height: 844 });
    await noHorizontalOverflow(page);
  });

  test('builds an explicitly estimated 8-stud car, exports real requirements and PDF, and restores its session', async ({ page, context }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    const research = await openAutomotive(page);
    await page.getByRole('button', { name: '8', exact: true }).click();
    await page.getByRole('checkbox', { name: /允许 estimated 比例/ }).check();
    await page.getByRole('slider', { name: '候选数量', exact: true }).press('Home');
    const generated = page.waitForResponse(designResponse, { timeout: 120_000 });
    await page.getByRole('button', { name: '生成 5 个设计候选', exact: true }).click();
    const response = await generated;
    expect(response.request().postDataJSON()).toMatchObject({ profileId: research.profile!.id, widthStuds: 8, allowEstimatedProportions: true, candidateCount: 5, referenceIds: [], bodyColor: 0 });
    expect(response.status(), await response.text()).toBe(200);
    const session = await response.json() as AutomotiveDesignResponse;
    expect(session.status, JSON.stringify(session.debug.rejections)).toBe('accepted');
    expect(session.candidates.length).toBeGreaterThan(0);
    expect(session.brief).toMatchObject({ targetWidthStuds: 8, dimensionBasis: 'estimated', planningMethod: 'discrete-module-replanning' });
    expect(session.brief.assumptions.length).toBeGreaterThan(0);
    expect(session.debug).toMatchObject({ physicalBuildsVerified: 0, imageAnalysis: 'not-configured' });
    const selected = session.candidates.find(candidate => candidate.exportable)!;
    expect(selected).toBeTruthy();
    expect(selected.candidate.validation.valid).toBe(true);
    expect(selected.designValidation.valid).toBe(true);
    expect(selected.scores.automotiveDesign).toBeGreaterThanOrEqual(64);
    expect(selected.candidate.model.parts.filter(part => part.category === 'Wheel')).toHaveLength(4);
    await expect(page.locator('.auto-candidate')).toHaveCount(session.candidates.length);
    await expect(page.locator('.auto-candidate[aria-pressed="true"]')).toContainText(selected.name);
    await renderedCar(page, selected.candidate.model.parts.length);
    if (session.candidates.length > 1) {
      const alternative = session.candidates[1];
      const geometry = (entry: typeof selected) => entry.candidate.model.parts.map(({ partId, position, orientation, moduleId }) => ({ partId, position, orientation, moduleId }));
      expect(geometry(alternative)).not.toEqual(geometry(selected));
      await page.locator('.auto-candidate').nth(1).click();
      await expect(page.locator('.auto-candidate[aria-pressed="true"]')).toContainText(alternative.name);
      await renderedCar(page, alternative.candidate.model.parts.length);
      await page.locator('.auto-candidate').first().click();
      await expect(page.locator('.auto-candidate[aria-pressed="true"]')).toContainText(selected.name);
      await renderedCar(page, selected.candidate.model.parts.length);
    }
    await expect(page.getByRole('tabpanel')).toContainText('estimated · 估算比例');
    await expect(page.getByRole('tabpanel')).toContainText('明确记录的设计假设');

    await page.getByRole('tab', { name: '评分与检查', exact: true }).click();
    await expect(page.locator('.auto-score')).toHaveCount(6);
    await expect(page.locator('.auto-score').filter({ hasText: '汽车造型' })).toBeVisible();
    await expect(page.locator('.auto-validation .good')).toHaveCount(4);
    await expect(page.getByRole('tabpanel')).toContainText('未进行实体试拼');
    await page.getByRole('tab', { name: '所需零件', exact: true }).click();
    const expected = new Map<string, number>();
    for (const part of selected.candidate.model.parts) {
      const key = `${part.partId}:${part.color.id}`;
      expected.set(key, (expected.get(key) ?? 0) + 1);
    }
    await expect(page.locator('.auto-bom-scroll tbody tr')).toHaveCount(expected.size);
    const quantities = await page.locator('.auto-bom-scroll tbody tr td:last-child').allTextContents();
    expect(quantities.reduce((sum, value) => sum + Number(value), 0)).toBe(selected.candidate.model.parts.length);
    const bom = await download(page, 'BOM JSON');
    expect(bom.download.suggestedFilename()).toMatch(/^automotive-.*-bom\.json$/);
    const requirements = JSON.parse(bom.bytes.toString()) as { items: { partId: string; colorId: number; quantity: number }[] };
    expect(requirements).toMatchObject({ sessionId: session.sessionId, candidateId: selected.id, quantitySource: 'virtual-unlimited-not-owned', partColorAvailability: 'not-verified', physicalBuildsVerified: 0 });
    expect(new Map(requirements.items.map(item => [`${item.partId}:${item.colorId}`, item.quantity]))).toEqual(expected);
    const csv = await download(page, 'BOM CSV');
    expect(csv.bytes.toString()).toContain('"partId","name","colorId","color","quantity"');
    expect(csv.bytes.toString().trim().split(/\r?\n/)).toHaveLength(expected.size + 1);

    await page.getByRole('tab', { name: '拼搭步骤', exact: true }).click();
    await expect(page.getByRole('button', { name: '上一步', exact: true })).toBeDisabled();
    const lastIndex = selected.candidate.steps.length - 1;
    await page.getByRole('slider', { name: '拼搭步骤', exact: true }).press('End');
    await expect(page.getByRole('button', { name: '下一步', exact: true })).toBeDisabled();
    await expect(page.getByRole('tabpanel')).toContainText(selected.candidate.steps[lastIndex].title);
    await renderedCar(page, selected.candidate.model.parts.length);
    const pdf = await download(page, '拼搭说明 PDF');
    expect(pdf.download.suggestedFilename()).toMatch(/^automotive-.*-instructions\.pdf$/);
    expect(pdf.bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.bytes.length).toBeGreaterThan(10_000);
    expect(pdf.bytes.toString('latin1')).toContain('/Type /Page');

    await page.getByRole('tab', { name: 'Design Brief', exact: true }).click();
    await page.getByRole('button', { name: '分解视图', exact: true }).click();
    await page.locator('.auto-nav').getByRole('link', { name: /Speed Creative/ }).click();
    await expect(page.getByRole('heading', { name: '读取你的零件车库' })).toBeVisible();
    await page.locator('.site-header').getByRole('button', { name: '自由汽车设计', exact: true }).click();
    await expect(page.getByRole('button', { name: '分解视图', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.auto-candidate[aria-pressed="true"]')).toContainText(selected.name);
    await page.locator('.auto-nav').getByRole('link', { name: /通用创意/ }).click();
    await expect(page.locator('.site-header').getByRole('button', { name: '通用创意', exact: true })).toHaveClass(/active/);
    await page.locator('.site-header').getByRole('button', { name: '自由汽车设计', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: /允许 estimated 比例/ })).toBeChecked();
    await expect(page.getByRole('slider', { name: '候选数量', exact: true })).toHaveValue('5');
    await expect(page.getByRole('button', { name: '分解视图', exact: true })).toHaveAttribute('aria-pressed', 'true');

    // A fresh page restores persisted server data, not React state from above.
    const restored = await context.newPage();
    await restored.goto(`/#/automotive-lab?session=${encodeURIComponent(session.sessionId)}`);
    await expect(restored.getByRole('status')).toContainText('已恢复设计记录');
    await expect(restored.locator('.auto-candidate[aria-pressed="true"]')).toContainText(selected.name);
    await renderedCar(restored, selected.candidate.model.parts.length);
    await restored.getByRole('tab', { name: '车型研究', exact: true }).click();
    await expect(restored.getByRole('tabpanel')).toContainText('W223');
    await expect(restored.getByRole('heading', { name: '参考模型库', exact: true })).toBeVisible();
    await restored.setViewportSize({ width: 390, height: 844 });
    await noHorizontalOverflow(restored);
    await restored.getByRole('tab', { name: '所需零件', exact: true }).click();
    await noHorizontalOverflow(restored);
    await renderedCar(restored, selected.candidate.model.parts.length);
    await restored.close();
    expect(pageErrors).toEqual([]);
  });

  test('persists a custom-width plan while blocking uncalibrated whole-car exports', async ({ page, request }) => {
    await openAutomotive(page);
    await page.getByRole('checkbox', { name: /允许 estimated 比例/ }).check();
    await page.getByRole('button', { name: '自定义', exact: true }).click();
    await page.getByRole('spinbutton', { name: '自定义宽度', exact: true }).fill('9');
    await expect(page.getByText(/此宽度目前只生成 Design Brief/)).toBeVisible();
    const generated = page.waitForResponse(designResponse);
    await page.getByRole('button', { name: '生成 8 个设计候选', exact: true }).click();
    const response = await generated;
    expect(response.status(), await response.text()).toBe(200);
    const session = await response.json() as AutomotiveDesignResponse;
    expect(session).toMatchObject({ status: 'unsupported', candidates: [], brief: { targetWidthStuds: 9 } });
    await expect(page.getByText('仅 Brief · 整车导出已阻止', { exact: true })).toBeVisible();
    await expect(page.locator('.auto-viewer .model-viewer-canvas')).toHaveCount(0);
    for (const label of ['BOM CSV', 'BOM JSON', '模型 JSON', '拼搭说明 PDF']) await expect(page.getByRole('button', { name: label, exact: true })).toBeDisabled();
    const refused = await request.get(`/api/automotive/sessions/${session.sessionId}/candidates/unaccepted/bom`);
    expect(refused.status()).toBe(422);
    expect(await refused.json()).toMatchObject({ code: 'AUTOMOTIVE_EXPORT_BLOCKED' });
    await page.reload();
    await page.goto(`/#/automotive-lab?session=${encodeURIComponent(session.sessionId)}`);
    await expect(page.getByRole('status')).toContainText('已恢复设计记录');
    await expect(page.getByRole('spinbutton', { name: '自定义宽度', exact: true })).toHaveValue('9');
    await expect(page.getByRole('button', { name: '拼搭说明 PDF', exact: true })).toBeDisabled();
  });
});
