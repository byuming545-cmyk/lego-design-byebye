import { expect, test, type Page, type Response } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { LocalRedesignResult, SpeedExtraPart, SpeedGenerationResult, SpeedInventory, VehicleCandidate, VehicleDesignOptions, VehicleModuleId } from '../../src/speed/types.js';

interface SpeedSession extends SpeedGenerationResult { sessionId: string }
interface CandidateUpdate { candidate: VehicleCandidate; undoDepth: number }
type RedesignUpdate = LocalRedesignResult & { undoDepth: number };

const pathname = (response: Response) => new URL(response.url()).pathname;
const generateResponse = (response: Response) => pathname(response) === '/api/speed/generate' && response.request().method() === 'POST';
const inventoryResponse = (sets: string) => (response: Response) => pathname(response) === '/api/speed/inventory' && new URL(response.url()).searchParams.get('sets') === sets;

async function openSpeed(page: Page): Promise<SpeedInventory> {
  const responsePromise = page.waitForResponse(inventoryResponse('DEMO-SPEED'));
  await page.goto('/#/speed');
  const response = await responsePromise;
  expect(response.status(), await response.text()).toBe(200);
  const inventory = await response.json() as SpeedInventory;
  await expect(page.getByRole('heading', { name: '读取你的零件车库' })).toBeVisible();
  await expect(page.getByRole('button', { name: '读取库存', exact: true })).toBeEnabled();
  return inventory;
}

async function generateSpeed(page: Page, extraParts?: SpeedExtraPart[]): Promise<SpeedSession> {
  const options: VehicleDesignOptions = { prompt: '未来感超级跑车，低矮、宽体，拥有清晰的车身轮廓。', vehicleType: 'supercar', style: 'futuristic', minifigure: false, priority: 'structure', maximizeUsage: true };
  await page.getByRole('textbox', { name: '创意描述', exact: true }).fill(options.prompt);
  await page.getByRole('combobox', { name: '车型', exact: true }).selectOption(options.vehicleType);
  await page.getByRole('combobox', { name: '风格', exact: true }).selectOption(options.style);
  await page.getByRole('combobox', { name: '设计偏好', exact: true }).selectOption(options.priority);
  await page.getByRole('checkbox', { name: /容纳 Minifigure/ }).setChecked(false);
  await page.getByRole('checkbox', { name: /尽量利用更多零件/ }).setChecked(true);
  // Subassembly snapshots make the genuine three-candidate response larger than
  // Chromium's default inspector cache. Observe it with a larger CDP buffer;
  // requests and responses still pass through the real application unchanged.
  const network = await page.context().newCDPSession(page);
  await network.send('Network.enable', { maxTotalBufferSize: 128 * 1024 * 1024, maxResourceBufferSize: 128 * 1024 * 1024 });
  let generatedRequestId: string | undefined;
  const observedBody = new Promise<SpeedSession>((resolve, reject) => {
    network.on('Network.responseReceived', event => {
      if (new URL(event.response.url).pathname === '/api/speed/generate') generatedRequestId = event.requestId;
    });
    network.on('Network.loadingFinished', event => {
      if (event.requestId !== generatedRequestId) return;
      void network.send('Network.getResponseBody', { requestId: event.requestId }).then(body => {
        resolve(JSON.parse(body.base64Encoded ? Buffer.from(body.body, 'base64').toString() : body.body) as SpeedSession);
      }).catch(reject);
    });
  });
  const responsePromise = page.waitForResponse(generateResponse);
  await page.getByRole('button', { name: '生成 Speed 方案', exact: true }).click();
  const response = await responsePromise;
  expect(response.request().postDataJSON()).toEqual({ setNumbers: ['DEMO-SPEED'], options, ...(extraParts ? { extraParts } : {}) });
  const session = await observedBody.finally(() => network.detach());
  expect(response.status()).toBe(200);
  expect(session.sessionId).toBeTruthy();
  expect(session.candidates).toHaveLength(3);
  for (const candidate of session.candidates) assertVehicle(candidate, session.inventory);
  await expect(page.getByRole('button', { name: '生成 Speed 方案', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: '选择方案 A', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.speed-model-stage .model-viewer-canvas')).toHaveAccessibleName(new RegExp(`共 ${session.candidates[0].model.parts.length} 个零件`));
  return session;
}

function assertVehicle(candidate: VehicleCandidate, inventory: SpeedInventory): void {
  const { model, validation } = candidate;
  expect(validation.valid, validation.errors.join('; ')).toBe(true);
  for (const result of [validation.inventory, validation.connection, validation.collision, validation.wheels, validation.structure]) {
    expect(result.valid, result.errors.join('; ')).toBe(true);
    expect(result.errors).toEqual([]);
  }
  expect(validation.wheels.wheelCount).toBe(4);
  expect(validation.wheels.groundedWheels).toBe(4);
  expect(validation.wheels.axleConnections).toBe(4);
  expect(validation.wheels.rotationalClearance).toBe(true);
  expect(validation.wheels.collisions).toEqual([]);
  expect(validation.structure.structuralScore).toBeGreaterThan(0);
  expect(validation.structure.structuralScore).toBeLessThanOrEqual(100);
  expect(model.parameters.width).toBeGreaterThanOrEqual(7);
  expect(model.parameters.width).toBeLessThanOrEqual(9);
  expect(model.parameters.wheelbase).toBeGreaterThan(0);
  expect(model.parameters.wheelbase).toBeLessThan(model.parameters.length);
  expect(model.parts.filter(part => part.category === 'Wheel')).toHaveLength(4);
  expect(model.parts.filter(part => part.category === 'Tyre')).toHaveLength(4);
  expect(model.parts.filter(part => part.category === 'WheelHolder').length).toBeGreaterThanOrEqual(2);

  const counts = new Map<string, number>();
  const available = new Map(inventory.items.map(item => [`${item.partId}:${item.color.id}`, item]));
  const partById = new Map(model.parts.map(part => [part.instanceId, part]));
  expect(partById.size).toBe(model.parts.length);
  for (const part of model.parts) {
    const key = `${part.partId}:${part.color.id}`;
    const item = available.get(key);
    expect(item?.support).toBe('supported');
    expect(item?.supported).toBe(true);
    expect(part.dimensions).toEqual(item?.dimensions);
    expect(part.connectionPoints.length).toBeGreaterThan(0);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  for (const [key, quantity] of counts) expect(quantity).toBeLessThanOrEqual(available.get(key)!.quantityAvailable);
  expect(model.inventoryUsage.reduce((total, item) => total + item.quantityUsed, 0)).toBe(model.parts.length);
  for (const usage of model.inventoryUsage) {
    expect(usage.quantityUsed).toBe(counts.get(`${usage.partId}:${usage.colorId}`));
    expect(usage.quantityUsed).toBeLessThanOrEqual(usage.quantityAvailable);
  }

  // Check the exported graph itself, including actual wheel endpoints, rather
  // than accepting the server's overall validation badge as sufficient evidence.
  const adjacency = new Map(model.parts.map(part => [part.instanceId, new Set<string>()]));
  expect(new Set(model.connections.map(edge => edge.id)).size).toBe(model.connections.length);
  for (const edge of model.connections) {
    const partA = partById.get(edge.partA);
    const partB = partById.get(edge.partB);
    expect(partA?.connectionPoints.some(point => point.id === edge.connectionPointA)).toBe(true);
    expect(partB?.connectionPoints.some(point => point.id === edge.connectionPointB)).toBe(true);
    expect(partA?.activeConnections).toContain(edge.id);
    expect(partB?.activeConnections).toContain(edge.id);
    adjacency.get(edge.partA)!.add(edge.partB);
    adjacency.get(edge.partB)!.add(edge.partA);
  }
  const visited = new Set<string>();
  const pending = [model.parts[0].instanceId];
  while (pending.length) {
    const id = pending.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    pending.push(...adjacency.get(id)!);
  }
  expect(visited.size).toBe(model.parts.length);
  for (const wheel of model.parts.filter(part => part.category === 'Wheel')) {
    const attached = model.connections.filter(edge => edge.partA === wheel.instanceId || edge.partB === wheel.instanceId);
    expect(attached.filter(edge => edge.connectionType === 'wheel-axle' && edge.allowsRotation)).toHaveLength(1);
    expect(attached.filter(edge => edge.connectionType === 'tyre-fit')).toHaveLength(1);
  }
  expect(model.modules.map(module => module.id)).toEqual(expect.arrayContaining(['chassis', 'front', 'rear', 'cockpit', 'roof', 'leftWheelModule', 'rightWheelModule', 'bodyShell', 'aero']));
  expect(model.modules.flatMap(module => module.partIds).sort()).toEqual([...partById.keys()].sort());
  for (const module of model.modules) {
    for (const id of module.partIds) expect(partById.get(id)?.moduleId).toBe(module.id);
    for (const id of module.connectionIds) expect(model.connections.some(edge => edge.id === id)).toBe(true);
  }
  expect(candidate.steps.length).toBeGreaterThan(1);
  const firstBuild = candidate.steps.find(step => step.addedParts.length > 0)!;
  expect(firstBuild.addedParts.every(part => part.moduleId === 'chassis')).toBe(true);
  expect(candidate.steps.at(-1)!.totalModelState.map(part => part.instanceId).sort()).toEqual([...partById.keys()].sort());
}

async function downloadedJson(page: Page): Promise<{ candidate: VehicleCandidate; inventory: SpeedInventory }> {
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出模型 JSON', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^bricklab-speed-.*\.json$/);
  expect(await download.failure()).toBeNull();
  return JSON.parse(await readFile((await download.path())!, 'utf8')) as { candidate: VehicleCandidate; inventory: SpeedInventory };
}

function physicalParts(candidate: VehicleCandidate, moduleId?: VehicleModuleId) {
  return candidate.model.parts.filter(part => !moduleId || part.moduleId === moduleId)
    .map(({ activeConnections: _connections, buildStep: _step, ...part }) => part)
    .sort((a, b) => a.instanceId.localeCompare(b.instanceId));
}

test.describe('Speed Creative V0.2', () => {
  test.setTimeout(120000);

  test('analyzes the standalone demo honestly and refuses real set IDs without a provider key', async ({ page }) => {
    const inventory = await openSpeed(page);
    expect(inventory.source).toBe('mock');
    expect(inventory.inventorySources).toHaveLength(1);
    expect(inventory.inventorySources[0].setNumber).toBe('DEMO-SPEED');
    const sum = (predicate: (item: SpeedInventory['items'][number]) => boolean) => inventory.items.filter(predicate).reduce((total, item) => total + item.quantityAvailable, 0);
    expect(inventory.analysis.totalQuantity).toBe(sum(() => true));
    expect(inventory.analysis.supportedQuantity).toBe(sum(item => item.support === 'supported'));
    expect(inventory.analysis.partiallySupportedQuantity).toBe(sum(item => item.support === 'partiallySupported'));
    expect(inventory.analysis.unsupportedQuantity).toBe(sum(item => item.support === 'unsupported'));
    expect(inventory.analysis.supportedQuantity + inventory.analysis.partiallySupportedQuantity + inventory.analysis.unsupportedQuantity).toBe(inventory.analysis.totalQuantity);
    expect(inventory.analysis.supportRate).toBeCloseTo(inventory.analysis.supportedQuantity / inventory.analysis.totalQuantity);
    expect(inventory.analysis.usableQuantity).toBe(inventory.analysis.supportedQuantity);
    for (const item of inventory.items.filter(item => item.support !== 'supported')) {
      expect(item.supported).toBe(false);
      expect(item.dimensions).toBeNull();
    }
    await expect(page.getByText('DEMO-SPEED 为独立的人工合成零件池，不是 BMW 或其他官方套装的真实清单。', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '查看全部', exact: true }).click();
    await expect(page.locator('.speed-parts-table tbody tr')).toHaveCount(inventory.items.length);

    const input = page.getByRole('textbox', { name: /套装编号/ });
    await input.fill('76922');
    await expect(page.getByRole('button', { name: '生成 Speed 方案', exact: true })).toBeDisabled();
    const refusedPromise = page.waitForResponse(inventoryResponse('76922'));
    await page.getByRole('button', { name: '读取库存', exact: true }).click();
    const refused = await refusedPromise;
    expect(refused.status()).toBe(503);
    expect((await refused.json()).code).toBe('SPEED_REAL_PROVIDER_REQUIRED');
    await expect(page.getByRole('alert')).toContainText(/真实 Speed 套装.*Rebrickable API Key/);
    await expect(page.getByRole('button', { name: '生成 Speed 方案', exact: true })).toBeDisabled();

    await input.fill('DEMO-SPEED + DEMO-SPEED');
    const deduplicatedPromise = page.waitForResponse(inventoryResponse('DEMO-SPEED + DEMO-SPEED'));
    await page.getByRole('button', { name: '读取库存', exact: true }).click();
    const deduplicated = await (await deduplicatedPromise).json() as SpeedInventory;
    expect(deduplicated.inventorySources).toHaveLength(1);
    expect(deduplicated.analysis.totalQuantity).toBe(inventory.analysis.totalQuantity);
    expect(deduplicated.items).toEqual(inventory.items);
  });

  test('generates genuinely different validated cars and exports their instructions and complete JSON', async ({ page }) => {
    const browserErrors: string[] = [];
    page.on('pageerror', error => browserErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') browserErrors.push(message.text()); });
    await openSpeed(page);
    const session = await generateSpeed(page);
    const signatures = session.candidates.map(candidate => JSON.stringify(candidate.model.parts.map(part => ({ partId: part.partId, position: part.position, orientation: part.orientation, moduleId: part.moduleId }))));
    expect(new Set(signatures).size).toBe(session.candidates.length);
    expect(new Set(session.candidates.map(candidate => candidate.model.parameters.wheelbase)).size).toBeGreaterThan(1);
    expect(new Set(session.candidates.map(candidate => candidate.model.parameters.cockpitPosition)).size).toBeGreaterThan(1);
    for (let index = 0; index < session.candidates.length; index++) {
      const candidate = session.candidates[index];
      const button = page.getByRole('button', { name: `选择方案 ${String.fromCharCode(65 + index)}`, exact: true });
      await button.click();
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      const exported = await downloadedJson(page);
      expect(exported.candidate).toEqual(candidate);
      expect(exported.inventory).toEqual(session.inventory);
      assertVehicle(exported.candidate, exported.inventory);
    }
    await page.getByRole('button', { name: '选择方案 A', exact: true }).click();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: '/tmp/bricklab-speed-desktop.png', fullPage: true });
    const candidate = session.candidates[0];
    const firstSubassembly = candidate.steps.findIndex(step => step.type === 'subassembly');
    const firstAttach = candidate.steps.findIndex(step => step.type === 'attach');
    const firstRotation = candidate.steps.findIndex(step => step.type === 'rotate');
    expect(firstSubassembly).toBeGreaterThanOrEqual(0);
    expect(firstAttach).toBeGreaterThan(firstSubassembly);
    expect(firstRotation).toBeGreaterThanOrEqual(0);
    await page.getByRole('button', { name: '开始拼搭', exact: true }).click();
    await expect(page.getByRole('button', { name: '上一步', exact: true })).toBeDisabled();
    for (const index of [...new Set([0, firstSubassembly, firstAttach, firstRotation, candidate.steps.length - 1])]) {
      const step = candidate.steps[index];
      const jump = page.getByRole('button', { name: `Speed 跳转第 ${index + 1} 步`, exact: true });
      await jump.click();
      await expect(jump).toHaveAttribute('aria-current', 'step');
      await expect(page.getByRole('heading', { name: step.title, level: 3, exact: true })).toBeVisible();
      const legend = step.type === 'attach' ? '本步安装高亮' : step.type === 'rotate' ? '本步无需取件' : '本步新增高亮';
      await expect(page.getByText(legend, { exact: true })).toBeVisible();
      await expect(page.locator('.speed-model-stage .model-viewer-canvas')).toHaveAccessibleName(new RegExp(`共 ${step.totalModelState.length} 个零件`));
      const quantities = await page.locator('.speed-added-parts b').allTextContents();
      expect(quantities.reduce((total, quantity) => total + Number(quantity.replace('×', '')), 0)).toBe(step.addedParts.length);
      if (step.type === 'rotate' || step.cameraHint === 'bottom') await expect(page.locator('.speed-rotation-hint')).toBeVisible();
      if (step.subAssemblyId) await expect(page.locator('.speed-assembly-label')).toContainText(/独立子组件|安装目标/);
    }
    await expect(page.getByRole('button', { name: '下一步', exact: true })).toBeDisabled();
    const pdfPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出 PDF', exact: true }).click();
    const download = await pdfPromise;
    expect(download.suggestedFilename()).toMatch(/speed.*\.pdf$/);
    expect(await download.failure()).toBeNull();
    const pdf = await readFile((await download.path())!);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(10000);
    const bytes = pdf.toString('latin1');
    expect([...bytes.matchAll(/\/Type\s*\/Page\b/g)].length).toBeGreaterThanOrEqual(candidate.steps.length + 1);
    expect(bytes.trimEnd()).toMatch(/%%EOF$/);
    await expect(page.getByRole('button', { name: '导出 PDF', exact: true })).toBeEnabled();
    const beforeLeaving = await downloadedJson(page);
    let extraGenerationRequests = 0;
    page.on('request', request => {
      if (new URL(request.url()).pathname === '/api/speed/generate') extraGenerationRequests++;
    });
    await page.getByRole('button', { name: '通用创意', exact: true }).click();
    await expect(page.getByRole('button', { name: '生成我的拼搭方案', exact: true })).toBeEnabled();
    await expect(page.getByText('库存数量安全', { exact: true })).toBeVisible();
    await expect(page.locator('.model-viewer-canvas:visible')).toBeVisible();
    await page.getByRole('button', { name: 'Speed Creative', exact: true }).click();
    await expect(page.getByRole('button', { name: '选择方案 A', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: `Speed 跳转第 ${candidate.steps.length} 步`, exact: true })).toHaveAttribute('aria-current', 'step');
    expect(await downloadedJson(page)).toEqual(beforeLeaving);
    expect(extraGenerationRequests).toBe(0);
    expect(browserErrors).toEqual([]);
  });

  test('locks the cockpit, changes only the front, rolls back a rejected change, and undoes successfully', async ({ page }) => {
    await openSpeed(page);
    const session = await generateSpeed(page);
    const original = session.candidates[0];
    const lockResponse = page.waitForResponse(response => /\/api\/speed\/designs\/[^/]+\/modules\/cockpit$/.test(pathname(response)) && response.request().method() === 'PATCH');
    await page.getByRole('button', { name: '锁定驾驶舱', exact: true }).click();
    const locked = await (await lockResponse).json() as CandidateUpdate;
    expect(locked.candidate.model.modules.find(module => module.id === 'cockpit')?.locked).toBe(true);
    expect(physicalParts(locked.candidate)).toEqual(physicalParts(original));
    await expect(page.getByRole('button', { name: '解锁驾驶舱', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: '撤销上一次修改', exact: true })).toBeDisabled();

    const edit = page.getByRole('textbox', { name: '局部修改描述', exact: true });
    await edit.fill('车头太高了');
    const changedPromise = page.waitForResponse(response => /\/api\/speed\/designs\/[^/]+\/redesign$/.test(pathname(response)));
    await page.getByRole('button', { name: '修改方案', exact: true }).click();
    const changed = await (await changedPromise).json() as RedesignUpdate;
    expect(changed.success, changed.message).toBe(true);
    expect(changed.rolledBack).toBe(false);
    expect(changed.changedModules).toEqual(['front']);
    expect(changed.candidate.model.version).toBeGreaterThan(original.model.version);
    expect(physicalParts(changed.candidate, 'front')).not.toEqual(physicalParts(original, 'front'));
    for (const module of original.model.modules.filter(module => module.id !== 'front')) expect(physicalParts(changed.candidate, module.id)).toEqual(physicalParts(original, module.id));
    expect(changed.candidate.model.modules.find(module => module.id === 'cockpit')?.locked).toBe(true);
    assertVehicle(changed.candidate, session.inventory);
    await expect(page.getByRole('button', { name: '撤销上一次修改', exact: true })).toBeEnabled();

    await edit.fill('驾驶舱降低一点');
    const rejectedPromise = page.waitForResponse(response => /\/api\/speed\/designs\/[^/]+\/redesign$/.test(pathname(response)));
    await page.getByRole('button', { name: '修改方案', exact: true }).click();
    const rejected = await (await rejectedPromise).json() as RedesignUpdate;
    expect(rejected.success).toBe(false);
    expect(rejected.rolledBack).toBe(true);
    expect(rejected.candidate).toEqual(changed.candidate);
    expect(rejected.undoDepth).toBe(changed.undoDepth);
    await expect(page.getByRole('alert')).toContainText(/锁定|保留/);
    expect((await downloadedJson(page)).candidate).toEqual(changed.candidate);

    const undoPromise = page.waitForResponse(response => /\/api\/speed\/designs\/[^/]+\/undo$/.test(pathname(response)));
    await page.getByRole('button', { name: '撤销上一次修改', exact: true }).click();
    const undone = await (await undoPromise).json() as CandidateUpdate;
    expect(physicalParts(undone.candidate)).toEqual(physicalParts(original));
    expect(undone.candidate.model.version).toBe(original.model.version);
    expect(undone.candidate.model.modules.find(module => module.id === 'cockpit')?.locked).toBe(true);
    expect(undone.undoDepth).toBe(0);
    assertVehicle(undone.candidate, session.inventory);
    await expect(page.getByRole('button', { name: '撤销上一次修改', exact: true })).toBeDisabled();
    expect((await downloadedJson(page)).candidate).toEqual(undone.candidate);
  });

  test('keeps the complete Speed workflow usable on mobile without horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 844 });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await openSpeed(page);
    const session = await generateSpeed(page);
    const dimensions = () => page.evaluate(() => ({ viewport: window.innerWidth, content: document.documentElement.scrollWidth }));
    const initial = await dimensions();
    expect(initial.content).toBeLessThanOrEqual(initial.viewport);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: '/tmp/bricklab-speed-mobile.png', fullPage: true });
    await page.getByRole('button', { name: '开始拼搭', exact: true }).click();
    const stepIndex = session.candidates[0].steps.findIndex(step => step.type === 'subassembly');
    expect(stepIndex).toBeGreaterThanOrEqual(0);
    await page.getByRole('button', { name: `Speed 跳转第 ${stepIndex + 1} 步`, exact: true }).click();
    await expect(page.getByText('本步新增高亮', { exact: true })).toBeVisible();
    const instructions = await dimensions();
    expect(instructions.content).toBeLessThanOrEqual(instructions.viewport);
    await page.getByRole('button', { name: '完整车辆', exact: true }).click();
    await page.getByRole('button', { name: '查看全部', exact: true }).click();
    const inventory = await dimensions();
    expect(inventory.content).toBeLessThanOrEqual(inventory.viewport);
    expect(errors).toEqual([]);
  });

  test('merges self-reported loose parts, preserves unknown stock, and requires reloading draft changes', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const base = await openSpeed(page);
    await page.locator('summary').filter({ hasText: '添加自有散件' }).click();
    const color = { id: 0, name: '黑色', hex: '#171717' };
    const extras: SpeedExtraPart[] = [
      { partId: '3034', color, quantity: 2 },
      { partId: 'unknown-extra', color, quantity: 1 },
    ];
    for (const extra of extras) {
      await page.getByRole('textbox', { name: '散件零件编号', exact: true }).fill(extra.partId);
      await page.getByRole('combobox', { name: '散件颜色', exact: true }).selectOption(String(extra.color.id));
      await page.getByRole('spinbutton', { name: '散件数量', exact: true }).fill(String(extra.quantity));
      await page.getByRole('button', { name: '添加散件', exact: true }).click();
    }
    await expect(page.getByRole('button', { name: '生成 Speed 方案', exact: true })).toBeDisabled();
    const mixedPromise = page.waitForResponse(response => pathname(response) === '/api/speed/inventory' && response.request().method() === 'POST');
    await page.getByRole('button', { name: '读取库存', exact: true }).click();
    const mixedResponse = await mixedPromise;
    expect(mixedResponse.status()).toBe(200);
    expect(mixedResponse.request().postDataJSON().extraParts).toEqual(extras);
    const mixed = await mixedResponse.json() as SpeedInventory;
    expect(mixed.source).toBe('mixed');
    expect(mixed.sourceLabel).toContain('用户自报散件（未核验）');
    expect(mixed.inventorySources).toHaveLength(2);
    expect(mixed.inventorySources.find(source => source.source === 'custom')?.name).toBe('用户自报散件');
    expect(mixed.analysis.totalQuantity).toBe(base.analysis.totalQuantity + 3);
    expect(mixed.analysis.usableQuantity).toBe(base.analysis.usableQuantity + 2);
    expect(mixed.analysis.unsupportedQuantity).toBe(base.analysis.unsupportedQuantity + 1);
    const baselinePlate = base.items.find(item => item.partId === '3034' && item.color.id === 0)!;
    const mergedPlate = mixed.items.find(item => item.partId === '3034' && item.color.id === 0)!;
    expect(mergedPlate.quantityAvailable).toBe(baselinePlate.quantityAvailable + 2);
    expect(mergedPlate.sources.find(source => source.sourceId === 'custom:extra-parts')?.quantity).toBe(2);
    expect(mergedPlate.sources.find(source => source.setNumber === 'DEMO-SPEED')?.quantity).toBe(baselinePlate.quantityAvailable);
    const unknown = mixed.items.find(item => item.partId === 'unknown-extra')!;
    expect(unknown.quantityAvailable).toBe(1);
    expect(unknown.support).toBe('unsupported');
    expect(unknown.supported).toBe(false);
    expect(unknown.dimensions).toBeNull();
    await expect(page.locator('.speed-inventory-caption')).toContainText('用户自报散件（未核验）');

    const session = await generateSpeed(page, extras);
    expect(session.inventory).toEqual(mixed);
    for (const candidate of session.candidates) {
      expect(candidate.model.parts.some(part => part.partId === 'unknown-extra')).toBe(false);
      expect(candidate.model.inventoryUsage.some(item => item.partId === 'unknown-extra')).toBe(false);
    }
    const exported = await downloadedJson(page);
    expect(exported.inventory.source).toBe('mixed');
    expect(exported.inventory.items.find(item => item.partId === 'unknown-extra')).toEqual(unknown);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: '/tmp/bricklab-speed-extras-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 375, height: 844 });
    const mobile = await page.evaluate(() => ({ viewport: window.innerWidth, content: document.documentElement.scrollWidth }));
    expect(mobile.content).toBeLessThanOrEqual(mobile.viewport);
    await page.screenshot({ path: '/tmp/bricklab-speed-extras-mobile.png', fullPage: true });

    await page.getByRole('button', { name: '删除散件 unknown-extra', exact: true }).click();
    await expect(page.getByRole('button', { name: '生成 Speed 方案', exact: true })).toBeDisabled();
    const reloadedPromise = page.waitForResponse(response => pathname(response) === '/api/speed/inventory' && response.request().method() === 'POST');
    await page.getByRole('button', { name: '读取库存', exact: true }).click();
    const reloadedResponse = await reloadedPromise;
    expect(reloadedResponse.request().postDataJSON().extraParts).toEqual([extras[0]]);
    const reloaded = await reloadedResponse.json() as SpeedInventory;
    expect(reloaded.analysis.totalQuantity).toBe(base.analysis.totalQuantity + 2);
    expect(reloaded.analysis.unsupportedQuantity).toBe(base.analysis.unsupportedQuantity);
    expect(reloaded.items.some(item => item.partId === 'unknown-extra')).toBe(false);
    await expect(page.getByRole('button', { name: '生成 Speed 方案', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: '选择方案 A', exact: true })).toHaveCount(0);
  });
});
