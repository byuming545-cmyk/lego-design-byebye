import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { expectConnectedAssembly, expectCoverageMatches } from '../e2e/assemblyChecks.js';

test.setTimeout(180_000);

test('compiled preview serves Part Lab, bundled native geometry, fonts and API on one origin', async ({ page, request }) => {
  const badResponses: string[] = [];
  page.on('response', response => { if (response.status() >= 400) badResponses.push(`${response.status()} ${new URL(response.url()).pathname}`); });
  const health = await (await request.get('/api/health')).json();
  expect(health).toMatchObject({ version: '0.6.0', primaryArea: '/part-lab', legacyGenerationEnabled: false });
  const status = await (await request.get('/api/parts-foundation/status')).json();
  await page.goto('/part-lab');
  await expect(page.getByRole('heading', { name: '从真实零件，开始拼搭。' })).toBeVisible();
  await expect(page.locator('.part-counts > div').filter({ hasText: '已有真实几何' }).locator('strong')).toHaveText(String(status.counts.geometryReady));
  await expect(page.locator('.part-counts > div').filter({ hasText: '有已验证接口' }).locator('strong')).toHaveText(String(status.counts.assemblyVerified));
  const partResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/parts-foundation/parts/3001');
  await page.getByRole('textbox', { name: '搜索真实零件' }).fill('3001');
  const detail = await (await partResponse).json();
  expect(detail.geometry.source).toMatchObject({ library: 'LDraw', integrity: 'verified' });
  expect(detail.connections.points).toHaveLength(16);
  await expectCoverageMatches(page.getByRole('region', { name: '本零件物理接口验证覆盖', exact: true }), detail.part.interfaceCoverage);
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
  const assembly = await (await request.get('/api/parts-foundation/assembly/status')).json();
  expect(status.counts).toMatchObject({ geometryReady: assembly.sourceCounts.geometryReady, connectionReady: assembly.sourceCounts.connectionReady, assemblyVerified: assembly.counts.assemblyVerified, generatable: assembly.counts.generatable });
  expect(status.counts.generatable).toBeGreaterThan(0);
  expect(status.elementMapping).toMatchObject({ mappedBySource: 531, resolvedLDraw: 0, sourceTrust: 'source-observed' });
  expect(status.instructions.filter((document: { status: string }) => document.status === 'ready')).toHaveLength(6);
  const windscreen = await (await request.get('/api/parts-foundation/parts/65633')).json();
  expect(windscreen.part.name).toContain('Windscreen');
  expect(windscreen.geometry.mesh.indices.length).toBeGreaterThan(300);
  expect(windscreen.part.generatable).toBe(false);
  const unmapped = await (await request.get('/api/parts-foundation/parts/element%3A4666579')).json();
  expect(unmapped.geometry).toBeNull();
  expect(unmapped.part).toMatchObject({ generatable: false, mapping: { status: 'mapped', partId: '3749', designId: '6562', ldrawPartId: null } });
  expect(unmapped.part.mapping.geometryPipelineAllowed).toBe(false);
  expect(unmapped.part.mapping.mappingStatus).not.toBe('VERIFIED');
  expect((await request.get('/api/parts-foundation/parts/fake-windscreen')).status()).toBe(404);
  const blocked = await request.post('/api/automotive/design', { data: { legacyGenerationPolicy: 'test-fixture' } });
  expect(blocked.status()).toBe(409);
  expect(await blocked.json()).toMatchObject({ code: 'REAL_PARTS_FOUNDATION_REQUIRED' });
});

test('compiled assembly API attaches verified source interfaces and exports a versioned real wall', async ({ request }) => {
  const statusResponse = await request.get('/api/parts-foundation/assembly/status');
  expect(statusResponse.ok()).toBe(true);
  const status = await statusResponse.json();
  expect(status.defaultPair).toBeDefined();
  const attachment = await request.post('/api/parts-foundation/assembly/attach', { data: status.defaultPair });
  expect(attachment.ok(), await attachment.text()).toBe(true);
  const attached = await attachment.json();
  expect(attached.accepted).toBe(true);
  expect(attached.assembly.placements).toHaveLength(2);
  expectConnectedAssembly(attached.assembly);
  const generated = await request.post('/api/parts-foundation/assembly/generate', { data: { kind: 'wall', partCount: 3 } });
  expect(generated.ok(), await generated.text()).toBe(true);
  const result = await generated.json();
  expect(result.status).toBe('generated');
  expect(result.model.placements).toHaveLength(3);
  expectConnectedAssembly(result.model);
  const exported = await request.get(`/api/parts-foundation/assembly/models/${encodeURIComponent(result.model.id)}/export?format=json`);
  expect(exported.ok(), await exported.text()).toBe(true);
  const model = await exported.json();
  for (const key of ['partLibraryVersion', 'assemblyEngineVersion', 'connectionRuleVersion', 'collisionVersion']) {
    expect(typeof model[key]).toBe('string');
    expect(model[key]).toBe(result.model[key]);
  }
  expect(model.placements).toEqual(result.model.placements);
  expect(model.sourceHashes).toEqual(result.model.sourceHashes);
  expect(model.physicalBuildVerified).toBe(false);
  const reimportedResponse = await request.post('/api/parts-foundation/assembly/models/import', { data: { content: JSON.stringify(model) } });
  expect(reimportedResponse.ok(), await reimportedResponse.text()).toBe(true);
  const reimported = await reimportedResponse.json();
  expect(reimported.status).toBe('VALID');
  expect(reimported.model.id).not.toBe(model.id);
  expectConnectedAssembly(reimported.model);
  const { contentSha256: _checksum, ...old } = model;
  old.assemblyEngineVersion = 'outdated-preview-revalidation-test';
  const invalidated = await request.post('/api/parts-foundation/assembly/models/import', { data: { content: JSON.stringify({ ...old, contentSha256: createHash('sha256').update(JSON.stringify(old)).digest('hex') }) } });
  expect(invalidated.ok(), await invalidated.text()).toBe(true);
  expect(await invalidated.json()).toMatchObject({ status: 'NEEDS_REVALIDATION', model: null, physicalBuildVerified: false });
});
