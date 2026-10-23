import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBundledLDrawImporter, createBundledLDrawResolver, loadBundledLDrawManifest } from './ldraw/index.js';
import { createBundledConnectionImporter, loadBundledConnections } from './connections/index.js';
import { adaptPdfInventories, parseFoundationInventory, type FoundationInventory } from './inventory/index.js';
import { mineFoundationInventories } from './miner.js';
import { buildReferenceSetRecords, type InstructionDocument } from './referenceSets.js';
import { assessPartReadiness, type PartCheck, type PartReadiness } from './trust.js';

export const FOUNDATION_BUNDLE_ROOT = fileURLToPath(new URL('../../data/parts-foundation/', import.meta.url));
export const FOUNDATION_LIMITATIONS = [
  'PDF 附录记录的是 Element ID。尚无可靠设计编号映射，不能把附录编号直接当作 LDraw 文件名。',
  '当前附录清单为带页码的文本观测；颜色、设计编号、备用件标记及整套完整性尚未核定。',
  'LDraw 几何与 LDCad Shadow 连接分别有来源。导入成功不等于已通过拼接、公差或实物验证。',
  '碰撞外包框来自真实网格，但不能证明孔洞、轮胎嵌套或凸点插接的净空；未验证零件禁止进入生成器。',
  '6572269.pdf 与 6592544.pdf 超过当前附件传输上限，未读取其内容。Porsche 77239 暂无已读取的本地说明书。',
  '没有训练神经网络，也没有将 PDF 自动还原为整车 3D 模型。旧版参数化生成与导出已暂停。',
] as const;

type GeometryResult = Awaited<ReturnType<Awaited<ReturnType<typeof createBundledLDrawImporter>>['importPart']>>;
type ConnectionsResult = Awaited<ReturnType<typeof loadBundledConnections>>;
export interface FoundationPart extends PartReadiness {
  id: string;
  identitySystem: 'ldraw' | 'lego-element';
  name: string;
  category: string | null;
  sourcePartId: string | null;
  designId: string | null;
  elementId: string | null;
  selectionBasis: string;
  source: string;
  issues: string[];
  observedSetNumbers: string[];
  evidence: unknown[];
}
export interface FoundationPartDetail {
  part: FoundationPart;
  geometry: GeometryResult | null;
  connections: ConnectionsResult | null;
}

async function readJson(filename: string): Promise<unknown> {
  const data = await readFile(filename);
  if (data.length > 24 * 1024 * 1024) throw new Error('Foundation source manifest exceeds its limit.');
  return JSON.parse(data.toString('utf8'));
}
function categoryFromSourceHeader(name: string): string | null {
  // These are LDraw header labels, not an inferred inventory category.
  if (/^~?Car Mudguard\b/i.test(name)) return 'Mudguard';
  if (/^~?Slope\b.*\bCurved\b/i.test(name)) return 'CurvedSlope';
  if (/^~?Tile\b.*\bCurved\b/i.test(name)) return 'CurvedTile';
  const match = name.match(/^~?(Windscreen|Mudguard|Vehicle|Bracket|Slope|Tile|Plate|Brick|Wedge|Wheel|Tyre|Panel|Technic|Minifig)\b/i);
  return match?.[1] ?? null;
}
function missingChecks(): PartCheck[] {
  return [
    { id: 'attachment', outcome: 'not-run', description: '尚未完成该零件与标准砖的实际几何拼接校验。' },
    { id: 'collision-clearance', outcome: 'not-run', description: '外包框不证明插接区域、孔洞和凹槽净空。' },
    { id: 'part-verification', outcome: 'not-run', description: '尚未完成逐件适用测试或人工审核。' },
  ];
}
function nativeChecks(geometry: GeometryResult): PartCheck[] {
  const mesh = geometry.mesh, bounds = geometry.bounds;
  const hasMesh = geometry.status === 'geometryReady' && !!mesh && !!bounds;
  let finite = !!hasMesh && mesh!.indices.length >= 3 && mesh!.indices.length % 3 === 0 &&
    mesh!.positions.every(point => point.length === 3 && point.every(Number.isFinite)) &&
    mesh!.indices.every(index => Number.isSafeInteger(index) && index >= 0 && index < mesh!.positions.length);
  if (hasMesh) finite &&= mesh!.positions.every(point => point.every((value, axis) => value >= bounds!.min[axis] - 1e-7 && value <= bounds!.max[axis] + 1e-7));
  const hashed = hasMesh && geometry.source.integrity === 'verified' && geometry.source.licenseStatus === 'complete' && geometry.source.files.length > 0 && geometry.source.files.every(file => /^[a-f0-9]{64}$/.test(file.sha256) && !!file.license);
  return [
    { id: 'source-integrity', outcome: hashed ? 'passed' : 'failed', description: '导入器核对固定源文件哈希，保留递归文件及许可。' },
    { id: 'mesh-integrity', outcome: finite ? 'passed' : 'failed', description: '检查有限顶点、三角形索引与由真实网格导出的外包框。' },
    { id: 'rotation', outcome: 'not-run', description: '尚未完成该零件在所有适用装配姿态下的拼接与碰撞测试。' },
    ...missingChecks(),
  ];
}

/** Static sources are immutable; imported local observations live outside this source bundle. */
export class RealPartRegistry {
  private initialized?: Promise<void>;
  private parts = new Map<string, FoundationPart>();
  private detailCache = new Map<string, FoundationPartDetail>();
  private documents: InstructionDocument[] = [];
  private bundledInventories: FoundationInventory[] = [];
  private importer?: Awaited<ReturnType<typeof createBundledLDrawImporter>>;
  private resolver?: Awaited<ReturnType<typeof createBundledLDrawResolver>>;
  private connectionImporter?: ReturnType<typeof createBundledConnectionImporter>;
  private sourceProblems = new Set<string>();
  readonly localInventoryDir: string;
  constructor(options: { dataDir?: string } = {}) {
    this.localInventoryDir = path.resolve(options.dataDir ?? process.env.BRICKLAB_DATA_DIR ?? 'data', 'parts-foundation', 'private', 'inventories');
  }
  private async initialize(): Promise<void> {
    const manifestValue = await readJson(path.join(FOUNDATION_BUNDLE_ROOT, 'instructions', 'manifest.json')) as { documents: InstructionDocument[] };
    this.documents = manifestValue.documents;
    this.bundledInventories = adaptPdfInventories(await readJson(path.join(FOUNDATION_BUNDLE_ROOT, 'instructions', 'inventories.json')), '2026-10-23T00:00:00.000Z');
    this.importer = await createBundledLDrawImporter();
    this.resolver = await createBundledLDrawResolver();
    this.connectionImporter = createBundledConnectionImporter(this.resolver);
    const source = await loadBundledLDrawManifest();
    // Parse sequentially to bound transient native mesh memory. Only summaries persist.
    for (const root of source.roots) {
      const detail = await this.importNative(root.partId, root.name, root.selectionBasis);
      this.parts.set(root.partId, detail.part);
    }
    this.refreshElements(this.bundledInventories);
  }
  private refreshElements(inventories: FoundationInventory[]) {
    for (const [key, part] of this.parts) if (part.identitySystem === 'lego-element') this.parts.delete(key);
    const elements = mineFoundationInventories(inventories, { limit: 5000 }).elementRanking;
    for (const row of elements) {
      const id = `element:${row.identity.id}`;
      this.parts.set(id, {
        id, identitySystem: 'lego-element', name: `Element ${row.identity.id}`, category: null,
        sourcePartId: null, designId: null, elementId: row.identity.id,
        selectionBasis: 'source-backed element observation; design mapping unverified', source: 'Uploaded instruction PDF or local inventory observation',
        ...assessPartReadiness({ geometryReady: false, connectionReady: false, collisionReady: false, checks: missingChecks() }),
        issues: ['缺少有来源的 Element → Design / LDraw 映射。', '颜色与备用件状态尚未核定。'],
        observedSetNumbers: row.setNumbers, evidence: row.evidence,
      });
    }
  }
  private ready(): Promise<void> {
    this.initialized ??= this.initialize();
    return this.initialized;
  }
  private async importNative(id: string, name: string, selectionBasis: string): Promise<FoundationPartDetail> {
    const geometry = await this.importer!.importPart(id);
    const connections = await this.connectionImporter!.importPart(id);
    const geometryReady = geometry.status === 'geometryReady';
    const checks = nativeChecks(geometry);
    const readiness = assessPartReadiness({
      geometryReady,
      connectionReady: geometryReady && connections.status === 'ready' && connections.points.length > 0 && connections.points.every(point => point.dimensionsResolved && !!point.source.sha256),
      collisionReady: geometryReady && !!geometry.collision && checks.find(check => check.id === 'mesh-integrity')?.outcome === 'passed',
      checks,
    });
    return {
      part: {
        id, identitySystem: 'ldraw', name, category: categoryFromSourceHeader(name), sourcePartId: id,
        // Equal-looking numbers are not proof of an Element/Design/LDraw mapping.
        designId: null, elementId: null, selectionBasis, source: 'LDraw + LDCad Shadow Library', ...readiness,
        issues: [...geometry.issues.map(issue => `${issue.code}: ${issue.message}`), ...connections.issues.map(issue => `${issue.code}: ${issue.message}`), ...(!readiness.generatable ? ['尚未通过逐件拼接与净空校验，禁止生成。'] : [])],
        observedSetNumbers: [], evidence: geometry.source.files,
      },
      geometry, connections,
    };
  }
  async list(query = ''): Promise<FoundationPart[]> {
    await this.ready();
    this.refreshElements(await this.inventories());
    const normalized = query.trim().toLowerCase();
    return [...this.parts.values()].filter(part => !normalized || [part.id, part.name, part.category, part.elementId, part.sourcePartId].some(value => value?.toLowerCase().includes(normalized))).map(part => structuredClone(part));
  }
  async get(id: string): Promise<FoundationPartDetail | undefined> {
    await this.ready();
    if (id.startsWith('element:')) this.refreshElements(await this.inventories());
    const part = this.parts.get(id);
    if (!part) return undefined;
    if (part.identitySystem === 'lego-element') return { part: structuredClone(part), geometry: null, connections: null };
    let detail = this.detailCache.get(id);
    if (!detail) {
      detail = await this.importNative(id, part.name, part.selectionBasis);
      this.detailCache.set(id, detail);
      if (this.detailCache.size > 8) this.detailCache.delete(this.detailCache.keys().next().value!);
    }
    // Callers cannot mutate the authoritative source geometry or its readiness.
    return structuredClone(detail);
  }
  async inventories(): Promise<FoundationInventory[]> {
    await this.ready();
    let entries: string[];
    try { entries = await readdir(this.localInventoryDir); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return structuredClone(this.bundledInventories); throw error; }
    const local: FoundationInventory[] = [];
    const names = entries.filter(name => /^[a-f0-9]{64}\.json$/.test(name)).sort();
    const capacity = 500 - this.bundledInventories.length;
    if (names.length > capacity) this.sourceProblems.add('本地清单超过总计 500 份的统计上限，超出部分已明确排除。');
    for (const name of names.slice(0, capacity)) {
      try { local.push(parseFoundationInventory(await readJson(path.join(this.localInventoryDir, name)))); }
      catch { this.sourceProblems.add('有本地清单未通过格式校验，已从统计中排除。'); }
    }
    return [...structuredClone(this.bundledInventories), ...local];
  }
  async localInventoryCapacity() { await this.ready(); return Math.max(0, 500 - this.bundledInventories.length); }
  async status() {
    await this.ready();
    const inventories = await this.inventories();
    this.refreshElements(inventories);
    const parts = [...this.parts.values()];
    const ranking = mineFoundationInventories(inventories, { expectedSetNumbers: ['77263', '76924', '77239', '77238', '77254', '77257'], limit: 5000 });
    const trustedRanking = mineFoundationInventories(inventories.filter(inventory => inventory.provenance.trust === 'verified-upstream' || inventory.provenance.trust === 'verified-export'), { limit: 5000 });
    const referenceSets = buildReferenceSetRecords(this.documents).map(set => {
      const setInventories = inventories.filter(inventory => inventory.setNumber.replace(/-1$/, '') === set.setNumber);
      const rows = setInventories.flatMap(inventory => inventory.items);
      const setRanking = mineFoundationInventories(setInventories, { limit: 5000 });
      const observedElements = new Set(rows.flatMap(row => row.elementId ? [row.elementId] : []));
      return { ...set, elementCount: observedElements.size, observedRowCount: rows.length,
        observedQuantity: setRanking.elementRanking.reduce((sum, row) => sum + row.observedQuantity, 0), quantityBasis: 'deduplicated element observations; not whole-set piece count',
        mappedPartCount: 0, declaredIdentityRowCount: rows.filter(row => row.designId !== null || row.partId !== null).length,
        geometryReady: 0, connectionReady: 0, generatable: 0, verified: 0,
        supportedPercentage: null, coverageBasis: 'Element-to-design mapping and inventory completeness unresolved',
        missingCriticalParts: [], criticalPartStatus: '未映射设计编号前不推测关键零件编号。',
        notes: [rows.length ? '清单仍未核定 Element → 设计零件映射，尚不能计算整套真实设计零件覆盖率。' : '尚无可用附录清单。'],
      };
    });
    const count = (key: keyof PartReadiness) => parts.filter(part => part[key] === true).length;
    return {
      schemaVersion: 1, version: '0.4.0', mode: 'real-parts-foundation',
      counts: { catalogOnly: count('catalogOnly'), geometryReady: count('geometryReady'), connectionReady: count('connectionReady'), collisionReady: count('collisionReady'), generatable: count('generatable'), verified: count('verified'),
        ldrawPartIds: parts.filter(part => part.identitySystem === 'ldraw').length, observedElementIds: parts.filter(part => part.identitySystem === 'lego-element').length,
        readableDocuments: this.documents.filter(document => document.status === 'ready').length, physicalBuildsVerified: 0 },
      countBasis: 'Readiness axes overlap. LDraw IDs and LEGO Element IDs are separate identities; their sum is not a unique LEGO design count.',
      referenceSets,
      instructions: this.documents.map(document => ({ ...document, setId: document.setNumber, pageCount: document.pages, inventoryPages: document.appendixPages ?? [] })),
      mining: ranking, partRanking: trustedRanking.partRanking, elementRanking: ranking.elementRanking,
      nextPriority: trustedRanking.designRanking.slice(0, 50), nextPriorityStatus: trustedRanking.designRanking.length ? 'source-backed-design-frequency' : 'awaiting-source-backed-element-to-design-mapping',
      userReportedDesignRanking: ranking.designRanking,
      userReportedPartRanking: ranking.partRanking,
      capabilities: { neuralTraining: false, pdfTo3d: false, nativeLDrawGeometry: true, sourceConnections: true, inventoryElementExtraction: true, legacyGenerationEnabled: false },
      limitations: [...FOUNDATION_LIMITATIONS, ...new Set(this.sourceProblems)],
    };
  }
}
