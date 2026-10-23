import { expect, test, type Locator, type Page, type Response } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expectCoverageMatches } from './assemblyChecks.js';
import type { InterfaceCoverageData } from '../../src/components/InterfaceCoverage.js';

const artifactDirectory = path.resolve('artifacts/parts-foundation');
const pathname = (response: Response) => decodeURIComponent(new URL(response.url()).pathname);
const pageErrors = new WeakMap<Page, string[]>();

interface FoundationStatus {
  counts: Record<string, number>;
  instructions: { fileName: string; status: string; setNumber: string | null; pages?: number }[];
  referenceSets: { setId: string; instructionCount: number; inventoryComplete: boolean }[];
  mining: {
    actualSetDenominator: number;
    designRanking: unknown[];
    elementRanking: { identity: { id: string }; distinctSetCount: number; observedQuantity: number }[];
  };
  partRanking?: { identity: { id: string; system: string }; distinctSetCount: number; observedQuantity: number }[];
  elementMapping: { mappedBySource: number; mappingStatusCounts: Record<string, number> };
}
interface NativePartDetail {
  part: { id: string; status: string; geometryReady: boolean; catalogOnly: boolean; assemblyVerified: boolean; generatable: boolean; verified: boolean; interfaceCoverage: InterfaceCoverageData; mapping?: { status: string; mappingStatus: string; geometryPipelineAllowed: boolean; partId: string | null; designId: string | null; ldrawPartId: string | null; color: { id: string; name: string } | null; source: { trust: string; independentlyVerifiedOfficial: boolean } | null } };
  geometry: null | {
    status: string;
    mesh: { positions: number[][]; indices: number[] };
    source: { revision: string; files: { path: string; sha256: string; license: string }[] };
  };
  connections: null | { points: { source: { sha256: string } }[] };
}
interface AssemblyStatus {
  counts: { total: number; assemblyVerified: number; generatable: number; blocked: number };
  queue?: { partId: string; assemblyVerified: boolean; generatable: boolean }[];
  entries?: { partId: string; assemblyVerified: boolean; generatable: boolean }[];
}

async function assemblyStatus(page: Page): Promise<AssemblyStatus> {
  const response = await page.request.get('/api/parts-foundation/assembly/status', { timeout: 180_000 });
  expect(response.ok()).toBe(true);
  return await response.json() as AssemblyStatus;
}

async function openLab(page: Page, url = '/part-lab'): Promise<FoundationStatus> {
  const statusResponse = page.waitForResponse(response => pathname(response) === '/api/parts-foundation/status');
  await page.goto(url);
  await expect(page.getByRole('heading', { name: '从真实零件，开始拼搭。' })).toBeVisible();
  const response = await statusResponse;
  expect(response.status(), await response.text()).toBe(200);
  const status = await response.json() as FoundationStatus;
  await expect(page.locator('.part-list-caption')).not.toContainText('正在检索');
  return status;
}

async function searchPart(page: Page, id: string): Promise<NativePartDetail> {
  const listResponse = page.waitForResponse(response => pathname(response) === '/api/parts-foundation/parts' && new URL(response.url()).searchParams.get('query') === id, { timeout: 30_000 });
  const detailResponse = page.waitForResponse(response => pathname(response) === `/api/parts-foundation/parts/${id}`, { timeout: 30_000 }).catch(() => null);
  await page.getByRole('textbox', { name: '搜索真实零件' }).fill(id);
  const listed = await listResponse;
  expect(listed.status(), await listed.text()).toBe(200);
  const response = await detailResponse;
  expect(response, `Expected source detail for ${id}`).not.toBeNull();
  if (!response) throw new Error(`Source detail did not load for ${id}.`);
  expect(response.status(), await response.text()).toBe(200);
  const detail = await response.json() as NativePartDetail;
  await expect(page.locator('.part-detail')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.part-detail-heading')).toContainText(id.replace(/^element:/, ''));
  return detail;
}

/** The transparent WebGL buffer contains only native geometry and its optional
 * markers. Sample inside requestAnimationFrame, after the viewer's own render,
 * so an unpreserved/composited buffer cannot masquerade as a blank frame. */
async function framePixels(canvas: Locator) {
  return canvas.evaluate(element => new Promise<{ width: number; height: number; visible: number; markers: number; checksum: number }>(resolve => {
    requestAnimationFrame(() => {
      const surface = element as HTMLCanvasElement;
      const gl = surface.getContext('webgl2') ?? surface.getContext('webgl');
      if (!gl || gl.isContextLost()) { resolve({ width: 0, height: 0, visible: 0, markers: 0, checksum: 0 }); return; }
      const width = gl.drawingBufferWidth, height = gl.drawingBufferHeight;
      const pixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let visible = 0, markers = 0, checksum = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        const [red, green, blue, alpha] = pixels.subarray(index, index + 4);
        if (alpha > 100) visible++;
        // Source markers are blue, orange or purple. The native body is green.
        if (alpha > 200 && ((blue > red + 35 && green > red + 35 && blue > green + 5) ||
            (red > green + 35 && green > blue + 35) || (red > green + 25 && blue > green + 25))) markers++;
        checksum = (Math.imul(checksum, 31) + red + green * 3 + blue * 7 + alpha) >>> 0;
      }
      resolve({ width, height, visible, markers, checksum });
    });
  }));
}

async function nativeFrame(page: Page) {
  const canvas = page.locator('.part-native-canvas canvas');
  await expect(canvas).toHaveAccessibleName('LDraw 原生零件三维视图，可拖动旋转、滚轮缩放');
  await expect.poll(async () => (await framePixels(canvas)).visible).toBeGreaterThan(1000);
  return canvas;
}

async function noHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => ({
    width: window.innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth,
  }))).toEqual({ width: 390, document: 390, body: 390 });
}

test.describe('real parts foundation with actual bundled sources and WebGL', () => {
  test.setTimeout(180_000);
  test.beforeEach(async ({ page }) => {
    const errors: string[] = [];
    pageErrors.set(page, errors);
    page.on('pageerror', error => errors.push(error.message));
    await mkdir(artifactDirectory, { recursive: true });
  });
  test.afterEach(async ({ page }) => { expect(pageErrors.get(page)).toEqual([]); });

  test('opens the real library by default and renders native 3001 mesh plus source markers', async ({ page }) => {
    const generationRequests: string[] = [];
    page.on('request', request => {
      if (/\/api\/(?:generate|speed\/generate|automotive\/design)(?:[/?]|$)/.test(request.url())) generationRequests.push(request.url());
    });
    const status = await openLab(page, '/');
    const migration = await assemblyStatus(page);
    const listResponse = await page.request.get('/api/parts-foundation/parts');
    expect(listResponse.ok()).toBe(true);
    const catalog = (await listResponse.json()).parts as { identitySystem: string; geometryReady: boolean; catalogOnly: boolean; assemblyVerified: boolean; generatable: boolean; verified: boolean }[];
    expect(status.counts.geometryReady).toBe(catalog.filter(part => part.geometryReady).length);
    expect(status.counts.ldrawPartIds).toBe(catalog.filter(part => part.identitySystem === 'ldraw').length);
    expect(status.counts.assemblyVerified).toBe(migration.counts.assemblyVerified);
    expect(status.counts.generatable).toBe(migration.counts.generatable);
    expect(status.counts.generatable).toBeGreaterThan(0);
    expect(status.counts.verified).toBe(catalog.filter(part => part.verified).length);
    expect(migration.counts.assemblyVerified + migration.counts.blocked).toBe(migration.counts.total);
    expect(status.counts).toMatchObject({ observedElementIds: 531, readableDocuments: 6 });
    for (const [label, key] of [['已有真实几何', 'geometryReady'], ['仅目录', 'catalogOnly'], ['有已验证接口', 'assemblyVerified'], ['允许用于生成', 'generatable'], ['限定范围复核', 'verified']]) {
      await expect(page.locator('.part-counts > div').filter({ hasText: label }).locator('strong')).toHaveText(String(status.counts[key]));
    }

    const detail = await searchPart(page, '3001');
    expect(detail.part).toMatchObject({ id: '3001', geometryReady: true });
    const migrationPart = (migration.queue ?? migration.entries ?? []).find(part => part.partId === '3001');
    expect(migrationPart).toBeDefined();
    expect(detail.part.assemblyVerified).toBe(migrationPart!.assemblyVerified);
    expect(detail.part.generatable).toBe(migrationPart!.generatable);
    await expectCoverageMatches(page.getByRole('region', { name: '本零件物理接口验证覆盖', exact: true }), detail.part.interfaceCoverage);
    await expect(page.locator('.part-interface-qualification')).toContainText(detail.part.interfaceCoverage.fullyAssemblyVerified ? '全部已发现接口通过' : '未全部通过');
    expect(detail.geometry?.status).toBe('geometryReady');
    expect(detail.geometry!.mesh.indices.length).toBeGreaterThan(300);
    expect(detail.geometry!.source.files.length).toBeGreaterThan(1);
    expect(detail.geometry!.source.files.every(file => /^[a-f0-9]{64}$/.test(file.sha256) && !!file.license)).toBe(true);
    expect(detail.connections!.points.length).toBeGreaterThan(0);
    expect(detail.connections!.points.every(point => /^[a-f0-9]{64}$/.test(point.source.sha256))).toBe(true);
    const canvas = await nativeFrame(page);
    await expect.poll(async () => (await framePixels(canvas)).markers).toBeGreaterThan(10);
    await page.locator('.part-native-stage').screenshot({ path: path.join(artifactDirectory, '3001-native-source-connectors.png') });

    await page.getByRole('checkbox', { name: '显示来源连接点' }).uncheck();
    await expect.poll(async () => (await framePixels(page.locator('.part-native-canvas canvas'))).markers).toBeLessThan(5);
    await nativeFrame(page);
    await page.getByRole('checkbox', { name: '显示网格包围盒' }).check();
    await nativeFrame(page);
    await page.screenshot({ path: path.join(artifactDirectory, 'part-lab-desktop.png'), fullPage: true });
    expect(generationRequests).toEqual([]);
  });

  test('retains source-observed external mapping without inventing an LDraw cross-reference or generation eligibility', async ({ page }) => {
    await openLab(page);
    const detail = await searchPart(page, 'element:4666579');
    expect(detail.part).toMatchObject({ id: 'element:4666579', status: 'catalogOnly', catalogOnly: true, geometryReady: false, generatable: false, verified: false });
    expect(detail.geometry).toBeNull();
    expect(detail.connections).toBeNull();
    expect(detail.part.mapping?.status).toBe('mapped');
    expect(typeof detail.part.mapping?.partId).toBe('string');
    expect(detail.part.mapping?.color).not.toBeNull();
    expect(detail.part.mapping?.source).toMatchObject({ trust: 'source-observed', independentlyVerifiedOfficial: false });
    expect(detail.part.mapping?.ldrawPartId).toBeNull();
    expect(detail.part.mapping?.mappingStatus).not.toBe('VERIFIED');
    expect(detail.part.mapping?.geometryPipelineAllowed).toBe(false);
    await expect(page.locator('.part-native-canvas canvas')).toHaveCount(0);
    await expect(page.locator('.part-missing-mesh')).toContainText('暂无经过来源确认的原生几何');
    await expect(page.locator('.part-mapping-evidence')).toContainText('来源记录已映射');
    await expect(page.locator('.part-mapping-evidence')).toContainText(detail.part.mapping!.mappingStatus);
    await expect(page.locator('.part-mapping-evidence')).toContainText('未获准，仅 VERIFIED 映射可进入正式几何流程');
    await expect(page.locator('.part-mapping-evidence')).toContainText('待核对，未绑定几何');
    await page.screenshot({ path: path.join(artifactDirectory, 'element-mapped-no-invented-geometry.png'), fullPage: true });
    await page.getByRole('checkbox', { name: '只看允许用于生成的零件' }).check();
    await expect(page.getByText('暂无通过生成准入的零件', { exact: true })).toBeVisible();
    await expect(page.locator('.part-native-canvas canvas')).toHaveCount(0);
  });

  test('shows six readable PDFs, two transfer failures and evidence-based element frequency without invented design coverage', async ({ page }) => {
    const status = await openLab(page);
    expect(status.instructions).toHaveLength(8);
    expect(status.instructions.filter(document => document.status === 'ready')).toHaveLength(6);
    expect(status.instructions.filter(document => document.status === 'transfer-limit').map(document => document.fileName).sort()).toEqual(['6572269.pdf', '6592544.pdf']);
    expect(status.referenceSets).toHaveLength(6);
    expect(status.referenceSets.find(set => set.setId === '77238')?.instructionCount).toBe(2);
    expect(status.referenceSets.every(set => set.inventoryComplete === false)).toBe(true);
    expect(status.mining.actualSetDenominator).toBe(4);
    expect(status.mining.elementRanking).toHaveLength(531);
    expect(status.mining.elementRanking.find(row => row.identity.id === '4666579')).toMatchObject({ distinctSetCount: 4, observedQuantity: 20 });

    await page.getByRole('tab', { name: '说明书与套装' }).click();
    await expect(page.getByRole('heading', { name: '套装资料覆盖', exact: true })).toBeVisible();
    await expect(page.locator('.part-reference-card')).toHaveCount(6);
    expect(Object.values(status.elementMapping.mappingStatusCounts).reduce((sum, count) => sum + count, 0)).toBe(status.counts.observedElementIds);
    for (const [key, count] of Object.entries(status.elementMapping.mappingStatusCounts)) {
      await expect(page.locator('.part-mapping-summary dl > div').filter({ has: page.getByText(key, { exact: true }) }).locator('dd')).toHaveText(String(count));
    }
    const documents = page.locator('.part-reference-view .part-table').first().locator('tbody tr');
    await expect(documents).toHaveCount(8);
    await expect(documents.filter({ hasText: '已读取' })).toHaveCount(6);
    await expect(documents.filter({ hasText: '超过传输上限' })).toHaveCount(2);
    await expect(documents.filter({ hasText: '6662707.pdf' })).toContainText('77263');
    await expect(documents.filter({ hasText: '6662707.pdf' })).toContainText('113、114、115');
    const partRanking = page.locator('.part-ranking').filter({ has: page.getByRole('heading', { name: '已确认编号映射的零件', exact: true }) });
    if (status.partRanking?.length) {
      await expect(partRanking.locator('tbody tr')).toHaveCount(Math.min(15, status.partRanking.length));
      await expect(partRanking).toContainText(status.partRanking[0].identity.id);
      await expect(partRanking).toContainText(status.partRanking[0].identity.system);
    } else await expect(page.getByText('暂无完成来源映射的排名', { exact: true })).toBeVisible();
    const elementRanking = page.locator('.part-ranking').filter({ has: page.getByRole('heading', { name: '观测 Element ID', exact: true }) });
    await expect(elementRanking).toContainText('出现套装数 / 4');
    await expect(elementRanking).toContainText('4666579');
    await page.screenshot({ path: path.join(artifactDirectory, 'instruction-sources-and-coverage.png'), fullPage: true });
  });

  test('supports mobile inspection and keeps legacy UI and actual HTTP generation/export blocked', async ({ page, request }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openLab(page);
    await searchPart(page, '3001');
    await nativeFrame(page);
    await noHorizontalOverflow(page);
    await page.locator('.part-native-stage').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(artifactDirectory, 'part-lab-mobile-390.png'), fullPage: true });
    await searchPart(page, 'element:4666579');
    await noHorizontalOverflow(page);
    await page.getByRole('tab', { name: '说明书与套装' }).click();
    await expect(page.locator('.part-reference-card')).toHaveCount(6);
    await noHorizontalOverflow(page);

    for (const [method, url] of [
      ['POST', '/api/generate'], ['POST', '/api/speed/generate'], ['POST', '/api/automotive/design'],
      ['POST', '/api/speed/designs/nonexistent/redesign'],
      ['GET', '/api/speed/models/nonexistent/export'],
      ['GET', '/api/automotive/sessions/nonexistent/candidates/nonexistent/bom'],
    ]) {
      const response = await request.fetch(url, { method });
      expect(response.status(), `${method} ${url}`).toBe(409);
      expect(await response.json()).toMatchObject({ code: 'REAL_PARTS_FOUNDATION_REQUIRED', authenticity: { generatable: false, verified: false } });
    }
    await page.goto('/#/general');
    await expect(page.getByRole('button', { name: '生成我的拼搭方案', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '导出 PDF', exact: true })).toBeDisabled();
    await expect(page.locator('.legacy-foundation-banner')).toContainText('历史版本 · 参数化零件尚未验证');
  });
});
