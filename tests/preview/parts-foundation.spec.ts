import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { expectConnectedAssembly, expectCoverageMatches, expectGrammarAssessment } from '../e2e/assemblyChecks.js';

test.setTimeout(180_000);

test('compiled mini car workspace remains independent and roundtrips its coloured appearance document',async({request,page})=>{
  await page.goto('/mini-cars');await expect(page.getByRole('heading',{name:'小比例，也有跑车的轮廓。'})).toBeVisible();
  const response=await request.post('/api/mini-cars/generate',{data:{style:'sprint',color:'yellow',seed:'compiled',spoiler:true}});
  expect(response.ok()).toBe(true);const result=await response.json();expect(result.model.state).toBe('APPEARANCE_DRAFT');expect(result.model.wheels).toHaveLength(4);
  expect(result.model.placements.length).toBeGreaterThan(32);
  expect((await request.post('/api/mini-cars/models',{data:{model:result.model}})).ok()).toBe(true);
  const exported=await request.get(`/api/mini-cars/models/${result.model.id}/export`);expect(exported.ok()).toBe(true);
  const imported=await request.post('/api/mini-cars/models/import',{data:{content:await exported.text()}});expect((await imported.json()).model).toEqual(result.model);
  expect((await request.post('/api/speed/generate',{data:{}})).status()).toBe(409);
});

test('compiled generator uses current multi-piece surface cover recipes and reimports both credits',async({request})=>{
  const response=await request.post('/api/parts-foundation/assembly/generate',{data:{kind:'module-assembly',requiredPartIds:['3035'],requiredModuleIds:['75878-curved-cover-right','75878-curved-cover-left']}});
  expect(response.ok()).toBe(true);const result=await response.json();expect(result.status,result.reasons.join(' ')).toBe('generated');
  expect(result.model.placements).toHaveLength(7);expect(result.model.bom.find((row:{partId:string})=>row.partId==='15068').quantity).toBe(2);
  const exported=await request.get(`/api/parts-foundation/assembly/models/${result.model.id}/export?format=json`);expect(exported.ok()).toBe(true);
  const imported=await request.post('/api/parts-foundation/assembly/models/import',{data:{content:await exported.text()}});
  expect(await imported.json()).toMatchObject({status:'VALID',model:{moduleComposition:result.model.moduleComposition}});
});

test('compiled preview serves Part Lab, bundled native geometry, fonts and API on one origin', async ({ page, request }) => {
  const badResponses: string[] = [];
  page.on('response', response => { if (response.status() >= 400) badResponses.push(`${response.status()} ${new URL(response.url()).pathname}`); });
  const health = await (await request.get('/api/health')).json();
  expect(health).toMatchObject({ version: '0.6.0', primaryArea: '/part-lab', legacyGenerationEnabled: false });
  const status = await (await request.get('/api/parts-foundation/status')).json();
  await page.goto('/part-lab');
  await expect(page.getByRole('heading', { name: '从真实零件，开始拼搭。' })).toBeVisible();
  await expect(page.locator('.part-counts > div').filter({ hasText: '已有真实几何' }).locator('strong')).toHaveText(String(status.counts.geometryReady));
  await expect(page.locator('.part-counts > div').filter({ hasText: '有已保存装配证明' }).locator('strong')).toHaveText(String(status.counts.assemblyVerified));
  await expect(page.locator('.part-counts > div').filter({ hasText: '语法可选零件' }).locator('strong')).toHaveText(String(status.counts.generatable));
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
  expect(assembly.admissionBasis).toBe('interface-grammar');
  expect(assembly.counts.generatable + assembly.counts.blocked).toBe(assembly.counts.total);
  expect(assembly.counts.assemblyVerified).toBe(0);
  expect(assembly.interfaceCoverage.verifiedPass).toBe(0);
  expect(assembly.grammar.counts).toMatchObject({ historicalFixtureProofsRequired: 0, executedPartFixtureTests: 0 });
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

test('compiled assembly API derives source grammar attachment and exports a currently validated real wall', async ({ request }) => {
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
  expectGrammarAssessment(result.model);
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
  expectGrammarAssessment(reimported.model);
  const { contentSha256: _checksum, ...old } = model;
  old.assemblyEngineVersion = 'outdated-preview-revalidation-test';
  const invalidated = await request.post('/api/parts-foundation/assembly/models/import', { data: { content: JSON.stringify({ ...old, contentSha256: createHash('sha256').update(JSON.stringify(old)).digest('hex') }) } });
  expect(invalidated.ok(), await invalidated.text()).toBe(true);
  expect(await invalidated.json()).toMatchObject({ status: 'NEEDS_REVALIDATION', model: null, physicalBuildVerified: false });
});

test('compiled module paths retain reviewed data, design credit and full JSON revalidation', async ({ request }) => {
  const catalogue = await request.get('/api/parts-foundation/assembly/modules');
  expect(catalogue.ok()).toBe(true);
  expect((await catalogue.json()).modules).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: '76897-hood-core', status: 'VALIDATED' }),
    expect.objectContaining({ id: '76897-spoiler-blade', status: 'BLOCKED' }),
  ]));
  const response = await request.post('/api/parts-foundation/assembly/generate', {
    data: { kind: 'module-assembly', requiredPartIds: ['3020'], requiredModuleIds: ['76897-hood-adapted'] },
  });
  expect(response.ok()).toBe(true);
  const result = await response.json();
  expect(result.status, result.reasons.join(' ')).toBe('generated');
  expect(result.model.placements).toHaveLength(8);
  expect(result.model.bom.find((row: { partId: string }) => row.partId === '3069b').quantity).toBe(2);
  const ldraw = await request.get(`/api/parts-foundation/assembly/models/${result.model.id}/export?format=ldr`);
  expect(ldraw.ok()).toBe(true);
  const text = await ldraw.text();
  expect(text).toContain('Adrien Pennamen');
  expect(text).toContain('https://creativecommons.org/licenses/by/2.0/');
  expect(text).toContain('Two 3069a source tiles replaced explicitly by actual 3069b');
  const exported = await request.get(`/api/parts-foundation/assembly/models/${result.model.id}/export?format=json`);
  expect(exported.ok()).toBe(true);
  const imported = await request.post('/api/parts-foundation/assembly/models/import', { data: { content: await exported.text() } });
  expect(imported.ok()).toBe(true);
  const checked = await imported.json();
  expect(checked.status).toBe('VALID');
  expect(checked.model.moduleComposition).toEqual(result.model.moduleComposition);
});

test('compiled generator installs two different modules with current multi-point evidence', async ({ request }) => {
  const generated = await request.post('/api/parts-foundation/assembly/generate', {
    data: { kind: 'module-assembly', requiredPartIds: ['3035'], requiredModuleIds: ['76897-hood-core', '76897-rear-panel-core'] },
  });
  expect(generated.ok()).toBe(true);
  const result = await generated.json(); expect(result.status, result.reasons.join(' ')).toBe('generated');
  expect(result.model.placements).toHaveLength(9);
  expect(result.model.moduleComposition.instances.map((instance: { installationSupport: { independentPoints: number } }) => instance.installationSupport.independentPoints)).toEqual([8, 6]);
  const exported = await request.get(`/api/parts-foundation/assembly/models/${result.model.id}/export?format=json`);
  const imported = await request.post('/api/parts-foundation/assembly/models/import', { data: { content: await exported.text() } });
  expect(imported.ok()).toBe(true); const model = await imported.json(); expect(model.status).toBe('VALID');
  expect(model.model.moduleComposition).toEqual(result.model.moduleComposition);
});

test('compiled generator interprets a single required exterior identity as a goal, not both mating roles', async ({ request }) => {
  const response = await request.post('/api/parts-foundation/assembly/generate', { data: { kind: 'exterior-shell', requiredPartIds: ['11477'] } });
  expect(response.ok()).toBe(true);
  const result = await response.json(); expect(result.status, result.reasons.join(' ')).toBe('generated');
  expect(result.model.placements.find((p: { partId: string }) => p.partId === '11477').collisionClass).toBe('exterior-shell');
  const imported = await request.post('/api/parts-foundation/assembly/models/import', { data: { content: JSON.stringify(result.model) } });
  expect(imported.ok()).toBe(true); expect((await imported.json()).status).toBe('VALID');
});
