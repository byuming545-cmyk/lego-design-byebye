import { expect, test } from '@playwright/test';

test('compiled preview serves Part Lab, bundled native geometry, fonts and API on one origin', async ({ page, request }) => {
  const badResponses: string[] = [];
  page.on('response', response => { if (response.status() >= 400) badResponses.push(`${response.status()} ${new URL(response.url()).pathname}`); });
  const health = await (await request.get('/api/health')).json();
  expect(health).toMatchObject({ version: '0.4.0', primaryArea: '/part-lab', legacyGenerationEnabled: false });
  await page.goto('/part-lab');
  await expect(page.getByRole('heading', { name: '从真实零件，开始拼搭。' })).toBeVisible();
  await expect(page.locator('.part-counts > div').filter({ hasText: '已有真实几何' })).toContainText('245');
  const partResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/parts-foundation/parts/3001');
  await page.getByRole('textbox', { name: '搜索真实零件' }).fill('3001');
  const detail = await (await partResponse).json();
  expect(detail.geometry.source).toMatchObject({ library: 'LDraw', integrity: 'verified' });
  expect(detail.connections.points).toHaveLength(16);
  await expect(page.locator('.part-native-canvas canvas')).toBeVisible();
  await expect.poll(() => page.locator('.part-native-canvas canvas').evaluate(element => new Promise<number>(resolve => requestAnimationFrame(() => {
    const canvas = element as HTMLCanvasElement, gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl || gl.isContextLost()) { resolve(0); return; }
    const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
    gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let visible = 0;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 100) visible++;
    resolve(visible);
  })))).toBeGreaterThan(1000);
  expect(await page.evaluate(() => document.fonts.check('400 16px "Noto Sans SC"'))).toBe(true);
  expect(badResponses).toEqual([]);
});

test('compiled routes preserve source evidence and generation restrictions', async ({ request }) => {
  const status = await (await request.get('/api/parts-foundation/status')).json();
  expect(status.counts).toMatchObject({ geometryReady: 245, connectionReady: 195, generatable: 0, verified: 0 });
  expect(status.instructions.filter((document: { status: string }) => document.status === 'ready')).toHaveLength(6);
  const windscreen = await (await request.get('/api/parts-foundation/parts/65633')).json();
  expect(windscreen.part.name).toContain('Windscreen');
  expect(windscreen.geometry.mesh.indices.length).toBeGreaterThan(300);
  expect(windscreen.part.generatable).toBe(false);
  const unmapped = await (await request.get('/api/parts-foundation/parts/element%3A4666579')).json();
  expect(unmapped.geometry).toBeNull();
  expect((await request.get('/api/parts-foundation/parts/fake-windscreen')).status()).toBe(404);
  const blocked = await request.post('/api/automotive/design', { data: { legacyGenerationPolicy: 'test-fixture' } });
  expect(blocked.status()).toBe(409);
  expect(await blocked.json()).toMatchObject({ code: 'REAL_PARTS_FOUNDATION_REQUIRED' });
});
