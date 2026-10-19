import { expect, test, type Page, type Response } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { GenerationOptions, GenerationResult, SetInventory, TemplateId } from '../../src/types/index.js';

const generationResponse = (response: Response) => response.url().endsWith('/api/generate') && response.request().method() === 'POST';

async function openWorkspace(page: Page): Promise<GenerationResult> {
  const generated = page.waitForResponse(generationResponse);
  await page.goto('/');
  const response = await generated;
  expect(response.status()).toBe(200);
  const result = await response.json() as GenerationResult;
  await expect(page.getByRole('button', { name: '生成我的拼搭方案' })).toBeEnabled();
  await expect(page.getByText('库存数量安全', { exact: true })).toBeVisible();
  await expect(page.locator('.model-viewer-canvas')).toHaveAccessibleName(new RegExp(`共 ${result.model.parts.length} 个零件`));
  return result;
}

async function generate(page: Page, options: GenerationOptions, template: TemplateId): Promise<GenerationResult> {
  const responsePromise = page.waitForResponse(generationResponse);
  await page.getByRole('button', { name: '生成我的拼搭方案' }).click();
  const response = await responsePromise;
  expect(response.request().postDataJSON()).toEqual({ setNumber: '10696-1', options });
  expect(response.status()).toBe(200);
  const result = await response.json() as GenerationResult;
  expect(result.model.template).toBe(template);
  assertInventorySafe(result);
  await expect(page.getByRole('button', { name: '生成我的拼搭方案' })).toBeEnabled();
  await expect(page.locator('.model-viewer-canvas')).toHaveAccessibleName(new RegExp(`共 ${result.model.parts.length} 个零件`));
  return result;
}

function assertInventorySafe(result: GenerationResult): void {
  expect(result.validation.valid).toBe(true);
  expect(result.validation.errors).toEqual([]);
  expect(result.model.parts.length).toBeGreaterThan(0);
  const actualUsage = new Map<string, number>();
  for (const part of result.model.parts) {
    const key = `${part.partId}:${part.color.id}`;
    actualUsage.set(key, (actualUsage.get(key) || 0) + 1);
    expect(result.inventory.items.some(item => item.supported && item.partId === part.partId && item.color.id === part.color.id)).toBe(true);
  }
  for (const item of result.inventory.items) {
    expect(item.quantityUsed).toBe(actualUsage.get(`${item.partId}:${item.color.id}`) || 0);
    expect(item.quantityUsed).toBeLessThanOrEqual(item.quantityAvailable);
    expect(item.quantityUsed).toBeGreaterThanOrEqual(0);
    if (!item.supported) expect(item.quantityUsed).toBe(0);
  }
  expect(result.model.inventoryUsage.reduce((sum, item) => sum + item.quantityUsed, 0)).toBe(result.model.parts.length);
  for (const item of result.model.inventoryUsage) {
    expect(item.quantityUsed).toBe(actualUsage.get(`${item.partId}:${item.colorId}`));
    expect(item.quantityUsed).toBeLessThanOrEqual(item.quantityAvailable);
  }
  const byId = (parts: GenerationResult['model']['parts']) => [...parts].sort((a, b) => a.instanceId.localeCompare(b.instanceId));
  expect(byId(result.steps.at(-1)!.totalModelState)).toEqual(byId(result.model.parts));
  expect(result.steps.flatMap(step => step.addedParts).map(part => part.instanceId).sort()).toEqual(result.model.parts.map(part => part.instanceId).sort());
}

async function canvasSnapshot(page: Page): Promise<string> {
  return page.locator('.model-viewer-canvas').evaluate(element => (element as HTMLCanvasElement).toDataURL());
}

test('loads real mock inventory and regenerates an inventory-safe robot through the UI', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const initial = await openWorkspace(page);
  expect(initial.model.template).toBe('robot');
  expect(initial.inventory.source).toBe('mock');
  assertInventorySafe(initial);
  await expect(page.getByText('演示库存 · 非该套装真实清单', { exact: true })).toBeVisible();
  await expect(page.locator('.model-viewer-canvas')).toBeVisible();

  const inventoryResponse = page.waitForResponse(response => response.url().endsWith('/api/sets/10696'));
  await page.getByRole('textbox', { name: 'LEGO 套装编号' }).fill('10696');
  await page.getByRole('button', { name: '读取套装' }).click();
  const inventory = await (await inventoryResponse).json() as SetInventory;
  expect(inventory.setNumber).toBe('10696-1');
  await expect(page.getByRole('button', { name: '导出 PDF' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '生成我的拼搭方案' })).toBeEnabled();
  const prompt = await page.getByRole('textbox', { name: '用户创意描述' }).inputValue();
  const result = await generate(page, { prompt, size: 'balanced', colorStrategy: 'substitute', maximizeUsage: false }, 'robot');

  await page.getByRole('button', { name: '查看全部' }).click();
  await expect(page.getByRole('button', { name: '收起零件' })).toHaveAttribute('aria-expanded', 'true');
  const rows = page.getByRole('table').getByRole('row');
  await expect(rows).toHaveCount(inventory.items.length + 1);
  const quantities = await page.getByRole('table').locator('tbody tr').evaluateAll(elements => elements.map(row => {
    const cells = row.querySelectorAll('td');
    return { available: cells[2].textContent || '', usedText: cells[3].textContent || '' };
  }));
  for (const quantity of quantities) {
    const available = Number(quantity.available);
    const usedText = quantity.usedText;
    expect(usedText === '—' ? 0 : Number(usedText)).toBeLessThanOrEqual(available);
  }
  await page.getByRole('button', { name: '收起零件' }).click();
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(5);
  await page.evaluate(() => document.fonts.ready);
  await expect.poll(() => canvasSnapshot(page)).not.toBe('data:,');
  await page.screenshot({ path: '/tmp/bricklab-desktop.png', fullPage: true });
  expect(result.steps.length).toBeGreaterThan(1);
  expect(errors).toEqual([]);
});

test('navigates cumulative instructions, added parts, grid, explode, and reset controls', async ({ page }) => {
  const result = await openWorkspace(page);
  const canvas = page.locator('.model-viewer-canvas');
  const grid = page.getByRole('button', { name: '显示网格', exact: true });
  const explode = page.getByRole('button', { name: '展开零件', exact: true });
  await expect(grid).toHaveAttribute('aria-pressed', 'true');
  const withGrid = await canvasSnapshot(page);
  await grid.click();
  await expect(grid).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => canvasSnapshot(page)).not.toBe(withGrid);
  const assembled = await canvasSnapshot(page);
  await explode.click();
  await expect(explode).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => canvasSnapshot(page)).not.toBe(assembled);
  await page.getByRole('button', { name: '重置视角' }).click();
  await expect(explode).toHaveAttribute('aria-pressed', 'false');
  await grid.click();

  await page.getByRole('button', { name: '开始拼搭', exact: true }).click();
  await expect(page.getByRole('button', { name: '上一步', exact: true })).toBeDisabled();
  await expect(page.getByText('绿色轮廓为本步新增', { exact: true })).toBeVisible();
  await expect(canvas).toHaveAccessibleName(new RegExp(`共 ${result.steps[0].totalModelState.length} 个零件`));
  for (let index = 0; index < result.steps.length; index++) {
    if (index > 0) await page.getByRole('button', { name: '下一步', exact: true }).click();
    const step = result.steps[index];
    await expect(page.getByRole('button', { name: `跳转第 ${index + 1} 步`, exact: true })).toHaveAttribute('aria-current', 'step');
    await expect(page.getByRole('heading', { level: 3, name: step.title, exact: true })).toBeVisible();
    await expect(canvas).toHaveAccessibleName(new RegExp(`共 ${step.totalModelState.length} 个零件`));
    const displayedAdded = await page.locator('.step-parts b').allTextContents();
    expect(displayedAdded.reduce((sum, value) => sum + Number(value.replace('×', '')), 0)).toBe(step.addedParts.length);
    for (const part of step.addedParts) {
      await expect(page.locator('.step-parts').getByText(`${part.color.name} · ${part.partId}`, { exact: true })).toBeVisible();
    }
  }
  await expect(page.getByRole('button', { name: '下一步', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '跳转第 1 步', exact: true }).click();
  await expect(page.getByRole('button', { name: '上一步', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '完整模型', exact: true }).click();
  await expect(canvas).toHaveAccessibleName(new RegExp(`共 ${result.model.parts.length} 个零件`));
});

test('submits all template, size, color, and usage choices with genuine UI interactions', async ({ page }) => {
  await openWorkspace(page);
  const choices = [
    { label: '小汽车', template: 'car', sizeLabel: '小型', size: 'small', preserve: true, maximize: true },
    { label: '小房子', template: 'house', sizeLabel: '均衡', size: 'balanced', preserve: false, maximize: false },
    { label: '小动物', template: 'animal', sizeLabel: '大型', size: 'large', preserve: false, maximize: true },
  ] as const;
  for (const choice of choices) {
    await page.getByRole('button', { name: choice.label, exact: true }).click();
    await page.getByRole('group', { name: '模型规模' }).getByRole('button', { name: choice.sizeLabel, exact: true }).click();
    await expect(page.getByRole('group', { name: '模型规模' }).getByRole('button', { name: choice.sizeLabel, exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('checkbox', { name: /优先保持颜色/ }).setChecked(choice.preserve);
    await page.getByRole('checkbox', { name: /让更多积木派上用场/ }).setChecked(choice.maximize);
    const prompt = await page.getByRole('textbox', { name: '用户创意描述' }).inputValue();
    const result = await generate(page, { prompt, size: choice.size, colorStrategy: choice.preserve ? 'preserve' : 'substitute', maximizeUsage: choice.maximize }, choice.template);
    if (choice.maximize) expect(result.model.notes.some(note => note.includes('尽量使用零件'))).toBe(true);
  }
});

test('downloads a real multi-page PDF and complete inventory-safe model JSON', async ({ page }) => {
  const result = await openWorkspace(page);
  const jsonDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '模型 JSON' }).click();
  const json = await jsonDownload;
  expect(json.suggestedFilename()).toBe('bricklab-robot.json');
  expect(await json.failure()).toBeNull();
  const downloaded = JSON.parse(await readFile((await json.path())!, 'utf8')) as GenerationResult;
  expect(downloaded).toEqual(result);
  assertInventorySafe(downloaded);

  const pdfDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 PDF' }).click();
  const pdf = await pdfDownload;
  expect(pdf.suggestedFilename()).toBe('bricklab-robot.pdf');
  expect(await pdf.failure()).toBeNull();
  const bytes = await readFile((await pdf.path())!);
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  expect(bytes.length).toBeGreaterThan(10000);
  const data = bytes.toString('latin1');
  const pageCount = [...data.matchAll(/\/Type\s*\/Page\b/g)].length;
  expect(pageCount).toBeGreaterThanOrEqual(result.steps.length + 1);
  expect(data).toContain('BRICKLAB');
  expect(data.trimEnd()).toMatch(/%%EOF$/);
  await expect(page.getByRole('button', { name: '导出 PDF' })).toBeEnabled();
});

test('explains unsupported prompts, unknown demo sets, and data limitations', async ({ page }) => {
  await openWorkspace(page);
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.getByRole('textbox', { name: '用户创意描述' }).fill('拼一艘会飞的宇宙飞船');
  const generation = page.waitForResponse(generationResponse);
  await page.getByRole('button', { name: '生成我的拼搭方案' }).click();
  expect((await generation).status()).toBeGreaterThanOrEqual(400);
  await expect(page.getByRole('alert')).toContainText(/模板|暂不支持|四类/);
  await page.getByRole('button', { name: '关闭错误提示' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);

  await page.getByRole('textbox', { name: 'LEGO 套装编号' }).fill('999999');
  const inventory = page.waitForResponse(response => response.url().endsWith('/api/sets/999999'));
  await page.getByRole('button', { name: '读取套装' }).click();
  expect((await inventory).status()).toBe(404);
  await expect(page.getByRole('alert')).toContainText(/演示模式仅支持|Rebrickable/);
  await page.getByRole('button', { name: '关于这个小实验' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('并非对应官方套装的真实零件清单');
  await expect(dialog).toContainText('不代表完整 CAD 或物理稳定性认证');
  await page.getByRole('button', { name: '知道了，继续创作' }).click();
  await expect(dialog).not.toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('remains usable on a mobile viewport without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const result = await openWorkspace(page);
  const noHorizontalOverflow = () => page.evaluate(() => ({ viewport: window.innerWidth, content: document.documentElement.scrollWidth }));
  const dimensions = await noHorizontalOverflow();
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
  await expect(page.getByRole('button', { name: '生成我的拼搭方案' })).toBeEnabled();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: '/tmp/bricklab-mobile.png', fullPage: true });
  await page.getByRole('button', { name: '开始拼搭', exact: true }).click();
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await expect(page.locator('.model-viewer-canvas')).toHaveAccessibleName(new RegExp(`共 ${result.steps[1].totalModelState.length} 个零件`));
  const stepDimensions = await noHorizontalOverflow();
  expect(stepDimensions.content).toBeLessThanOrEqual(stepDimensions.viewport);
  expect(errors).toEqual([]);
});
