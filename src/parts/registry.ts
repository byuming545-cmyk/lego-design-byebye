import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LDrawPartResult } from './ldraw/types.js';
import type { ConnectionImportResult } from './connections/types.js';
import { adaptPdfInventories, parseFoundationInventory, type FoundationInventory } from './inventory/index.js';
import { mineFoundationInventories } from './miner.js';
import { buildReferenceSetRecords, type InstructionDocument } from './referenceSets.js';
import { assessPartReadiness, type PartCheck, type PartReadiness } from './trust.js';
import { AssemblyService } from './assembly/service.js';
import { NativePartRepository } from './assembly/source.js';
import { buildNativeCollisionProxy } from './assembly/proxy.js';
import { IDENTITY_TRANSFORM } from './assembly/math.js';
import { createBundledElementDesignMapper, buildFailedPartRecoveryQueue, buildInstructionCoverage, type ElementDesignMapper, type ElementMappingResult } from './recovery/index.js';
import type { AssemblyMigrationEntry } from './assembly/migration.js';
import type { PhysicalInterfaceCoverage } from './assembly/coverage.js';

export const FOUNDATION_BUNDLE_ROOT = fileURLToPath(new URL('../../data/parts-foundation/', import.meta.url));
export const FOUNDATION_LIMITATIONS = [
  'Element → Part / Design / 颜色映射来自固定版本的公开数据镜像，保留 source-observed；LDraw 跨编号关系仍需明确证据。',
  '附录数量有页码依据；颜色映射尚未独立与 PDF 图像逐项核对，备用件属性及整套完整性仍未知。',
  '装配通过仅适用于逐件报告白名单中的接口和规则；其余接口保持禁用，不代表已做实物或制造公差验证。',
  '闭合原生代理用于实体碰撞检查；无法可靠闭合的几何、未知机械配合或未测接口均保留具体阻塞原因。',
  '6572269.pdf 与 6592544.pdf 超过当前附件传输上限，未读取其内容。Porsche 77239 暂无已读取的本地说明书。',
  '真实装配生成器先开放基础结构。旧版参数化生成与导出继续暂停；没有训练神经网络或将 PDF 自动还原为整车。',
] as const;

type GeometryResult = LDrawPartResult;
type ConnectionsResult = ConnectionImportResult;
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
  mapping?: ElementMappingResult;
  enabledConnectionIds?: string[];
  assemblyReport?: AssemblyMigrationEntry;
  interfaceCoverage?: PhysicalInterfaceCoverage;
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
function nativeChecks(geometry: GeometryResult, entry?: AssemblyMigrationEntry): PartCheck[] {
  const mesh = geometry.mesh, bounds = geometry.bounds;
  const hasMesh = geometry.status === 'geometryReady' && !!mesh && !!bounds;
  let finite = !!hasMesh && mesh!.indices.length >= 3 && mesh!.indices.length % 3 === 0 &&
    mesh!.positions.every(point => point.length === 3 && point.every(Number.isFinite)) &&
    mesh!.indices.every(index => Number.isSafeInteger(index) && index >= 0 && index < mesh!.positions.length);
  if (hasMesh) finite &&= mesh!.positions.every(point => point.every((value, axis) => value >= bounds!.min[axis] - 1e-7 && value <= bounds!.max[axis] + 1e-7));
  const hashed = hasMesh && geometry.source.integrity === 'verified' && geometry.source.licenseStatus === 'complete' && geometry.source.files.length > 0 && geometry.source.files.every(file => /^[a-f0-9]{64}$/.test(file.sha256) && !!file.license);
  const scopePassed = entry?.assemblyVerified === true && entry.generatable && entry.generatorSmokePassed && entry.allowedConnectionIds.length > 0;
  return [
    { id: 'source-integrity', outcome: hashed ? 'passed' : 'failed', description: '导入器核对固定源文件哈希，保留递归文件及许可。' },
    { id: 'mesh-integrity', outcome: finite ? 'passed' : 'failed', description: '检查有限顶点、三角形索引与由真实网格导出的外包框。' },
    { id: 'rotation', outcome: scopePassed ? 'passed' : 'not-run', description: scopePassed ? '白名单接口已枚举合法离散旋转，并使用通过原生碰撞检查的姿态。' : '尚无通过完整夹具测试的装配姿态。' },
    { id: 'attachment', outcome: scopePassed ? 'passed' : 'not-run', description: scopePassed ? '白名单接口通过真实夹具的正向与反向拼接、图占用和源变换检查。' : '尚无经过完整验证的接口。' },
    { id: 'collision-clearance', outcome: scopePassed ? 'passed' : 'not-run', description: scopePassed ? '闭合原生代理验证接触与实体净空；同位重复实心穿模会被拒绝。' : '该零件尚无经过装配夹具验证的实体碰撞结果。' },
    { id: 'part-verification', outcome: scopePassed ? 'passed' : 'not-run', description: scopePassed ? '软件验证限定在报告白名单接口；禁用口及实物验证不包含在此状态。' : '仍需完成适用接口与生成烟测。' },
  ];
}

/** Static sources are immutable; imported local observations live outside this source bundle. */
export class RealPartRegistry {
  private initialized?: Promise<void>;
  private parts = new Map<string, FoundationPart>();
  private detailCache = new Map<string, FoundationPartDetail>();
  private documents: InstructionDocument[] = [];
  private bundledInventories: FoundationInventory[] = [];
  readonly repository: NativePartRepository;
  readonly assemblyService: AssemblyService;
  private mapper?: ElementDesignMapper;
  private sourceProblems = new Set<string>();
  readonly localInventoryDir: string;
  constructor(options: { dataDir?: string; repository?: NativePartRepository; assemblyService?: AssemblyService } = {}) {
    this.repository = options.repository ?? new NativePartRepository();
    this.assemblyService = options.assemblyService ?? new AssemblyService({ repository: this.repository });
    this.localInventoryDir = path.resolve(options.dataDir ?? process.env.BRICKLAB_DATA_DIR ?? 'data', 'parts-foundation', 'private', 'inventories');
  }
  private async initialize(): Promise<void> {
    const manifestValue = await readJson(path.join(FOUNDATION_BUNDLE_ROOT, 'instructions', 'manifest.json')) as { documents: InstructionDocument[] };
    this.documents = manifestValue.documents;
    this.bundledInventories = adaptPdfInventories(await readJson(path.join(FOUNDATION_BUNDLE_ROOT, 'instructions', 'inventories.json')), '2026-10-23T00:00:00.000Z');
    this.mapper = await createBundledElementDesignMapper();
    const source = await this.repository.getManifest();
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
      const mapping = this.mapper!.resolve(row.identity.id);
      this.parts.set(id, {
        id, identitySystem: 'lego-element', name: mapping.partName ? `${mapping.partName} · Element ${row.identity.id}` : `Element ${row.identity.id}`, category: mapping.category,
        sourcePartId: null, designId: mapping.designId, elementId: row.identity.id, mapping,
        selectionBasis: 'source-backed element observation; external design mapping does not establish LDraw identity', source: 'Uploaded instruction PDF or local inventory observation',
        ...assessPartReadiness({ geometryReady: false, connectionReady: false, collisionReady: false, checks: missingChecks() }),
        issues: [mapping.status === 'mapped' ? '已有来源支持的 Part / Design / 颜色记录；尚无核定的 LDraw 跨编号对应。' : 'Element → Part / Design 映射未解决。', '备用件属性和完整套装库存尚未核定。'],
        observedSetNumbers: row.setNumbers, evidence: row.evidence,
      });
    }
  }
  private ready(): Promise<void> {
    this.initialized ??= this.initialize();
    return this.initialized;
  }
  private async importNative(id: string, name: string, selectionBasis: string): Promise<FoundationPartDetail> {
    const native = await this.repository.getPart(id);
    if (!native) throw new Error('The manifest references an unavailable native source part.');
    const { geometry, connections } = native;
    const entry = await this.assemblyService.getEntry(id);
    const geometryReady = geometry.status === 'geometryReady';
    const checks = nativeChecks(geometry, entry);
    const proxy = buildNativeCollisionProxy(native, { instanceId: `catalog-${id}`, partId: id, transform: structuredClone(IDENTITY_TRANSFORM) });
    const readiness = assessPartReadiness({
      geometryReady,
      connectionReady: geometryReady && connections.status === 'ready' && connections.points.length > 0 && connections.points.every(point => point.dimensionsResolved && !!point.source.sha256),
      collisionReady: geometryReady && proxy.status === 'ready',
      assemblyVerified: entry?.assemblyVerified === true,
      generatorSmokePassed: entry?.generatorSmokePassed === true && entry.generatable,
      checks,
    });
    return {
      part: {
        id, identitySystem: 'ldraw', name, category: categoryFromSourceHeader(name), sourcePartId: id,
        // Equal-looking numbers are not proof of an Element/Design/LDraw mapping.
        designId: null, elementId: null, selectionBasis, source: 'LDraw + LDCad Shadow Library', ...readiness,
        issues: [...geometry.issues.map(issue => `${issue.code}: ${issue.message}`), ...connections.issues.map(issue => `${issue.code}: ${issue.message}`), ...(proxy.status !== 'ready' ? [`${proxy.reasonCode}: ${proxy.reason}`] : []), ...(!readiness.generatable ? entry?.reasons ?? ['尚未通过逐件拼接与净空校验，禁止生成。'] : entry?.disabledConnectionIds.length ? [`${entry.disabledConnectionIds.length} 个来源接口未开放；仅可使用白名单接口。`] : [])],
        observedSetNumbers: [], evidence: geometry.source.files,
        enabledConnectionIds: entry?.allowedConnectionIds ?? [], ...(entry ? { assemblyReport: entry } : {}),
        ...(entry?.interfaceCoverage ? { interfaceCoverage: entry.interfaceCoverage } : {}),
      },
      geometry, connections,
    };
  }
  async list(query = ''): Promise<FoundationPart[]> {
    await this.ready();
    this.refreshElements(await this.inventories());
    const normalized = query.trim().toLowerCase();
    return [...this.parts.values()].filter(part => !normalized || [part.id, part.name, part.category, part.elementId, part.sourcePartId, part.designId, part.mapping?.partId].some(value => value?.toLowerCase().includes(normalized))).map(part => {
      const summary = structuredClone(part);
      delete summary.assemblyReport;
      summary.evidence = [];
      if (summary.interfaceCoverage) summary.interfaceCoverage.decisions = [];
      return summary;
    });
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
  private recoveryState = (id: string) => {
    const part = this.parts.get(id);
    return part ? { geometryReady: part.geometryReady, connectionReady: part.connectionReady, collisionReady: part.collisionReady, assemblyVerified: part.assemblyVerified, generatable: part.generatable, blockedReasons: part.assemblyReport?.reasonCodes ?? part.issues } : undefined;
  };
  async elementMapping(id: string) { await this.ready(); return this.mapper!.resolve(id); }
  async recovery() {
    await this.ready();
    return buildFailedPartRecoveryQueue(this.bundledInventories, this.mapper!, this.recoveryState);
  }
  async instructionCoverage() {
    await this.ready();
    return buildInstructionCoverage(this.documents, this.bundledInventories, this.mapper!, this.recoveryState);
  }
  async status() {
    await this.ready();
    const inventories = await this.inventories();
    this.refreshElements(inventories);
    const parts = [...this.parts.values()];
    const ranking = mineFoundationInventories(inventories, { expectedSetNumbers: ['77263', '76924', '77239', '77238', '77254', '77257'], limit: 5000 });
    const trustedRanking = mineFoundationInventories(inventories.filter(inventory => inventory.provenance.trust === 'verified-upstream' || inventory.provenance.trust === 'verified-export'), { limit: 5000 });
    const coverage = await this.instructionCoverage();
    const recovery = await this.recovery();
    const assembly = await this.assemblyService.status();
    const referenceSets = buildReferenceSetRecords(this.documents).map(set => {
      const setInventories = inventories.filter(inventory => inventory.setNumber.replace(/-1$/, '') === set.setNumber);
      const rows = setInventories.flatMap(inventory => inventory.items);
      const setRanking = mineFoundationInventories(setInventories, { limit: 5000 });
      const observedElements = new Set(rows.flatMap(row => row.elementId ? [row.elementId] : []));
      const mapped = [...observedElements].map(id => this.mapper!.resolve(id)).filter(mapping => mapping.status === 'mapped');
      const sourceCoverage = coverage.sets.find(row => row.setNumber === set.setNumber);
      return { ...set, elementCount: observedElements.size, observedRowCount: rows.length,
        observedQuantity: setRanking.elementRanking.reduce((sum, row) => sum + row.observedQuantity, 0), quantityBasis: 'deduplicated element observations; not whole-set piece count',
        mappedPartCount: new Set(mapped.map(mapping => mapping.partId)).size, mappedElementCount: mapped.length,
        mappingPercentage: observedElements.size ? Number((100 * mapped.length / observedElements.size).toFixed(2)) : null,
        declaredIdentityRowCount: rows.filter(row => row.designId !== null || row.partId !== null).length,
        geometryReady: sourceCoverage?.counts.geometryReady ?? 0, connectionReady: sourceCoverage?.counts.connectionReady ?? 0,
        assemblyVerified: sourceCoverage?.counts.assemblyVerified ?? 0, generatable: sourceCoverage?.counts.generatable ?? 0, verified: 0,
        supportedPercentage: sourceCoverage?.percentages.generatable ?? null, coverageBasis: sourceCoverage?.denominatorBasis ?? 'No observed appendix denominator',
        missingCriticalParts: [], criticalPartStatus: '已保留来源设计编号；关键件仍需核定 LDraw 对应和相应装配测试。',
        notes: [rows.length ? '来源映射与原生几何分开统计；仅统计已读附录，不代表完整套装。' : '尚无可用附录清单，覆盖率未知。'],
      };
    });
    const count = (key: keyof PartReadiness) => parts.filter(part => part[key] === true).length;
    return {
      schemaVersion: 1, version: '0.6.0', mode: 'real-parts-foundation',
      counts: { catalogOnly: count('catalogOnly'), geometryReady: count('geometryReady'), connectionReady: count('connectionReady'), collisionReady: count('collisionReady'), assemblyVerified: count('assemblyVerified'), generatable: count('generatable'), verified: count('verified'),
        ldrawPartIds: parts.filter(part => part.identitySystem === 'ldraw').length, observedElementIds: parts.filter(part => part.identitySystem === 'lego-element').length,
        readableDocuments: this.documents.filter(document => document.status === 'ready').length, physicalBuildsVerified: 0 },
      countBasis: 'Readiness axes overlap. LDraw IDs and LEGO Element IDs are separate identities; their sum is not a unique LEGO design count.',
      referenceSets,
      instructions: this.documents.map(document => ({ ...document, setId: document.setNumber, pageCount: document.pages, inventoryPages: document.appendixPages ?? [] })),
      mining: ranking, partRanking: trustedRanking.partRanking, elementRanking: ranking.elementRanking,
      nextPriority: recovery.entries.slice(0, 50).map(entry => ({ elementId: entry.elementId, designId: entry.mapping.designId, partId: entry.mapping.partId, observedQuantity: entry.observedQuantity, distinctObservedSets: entry.distinctObservedSets, blockedCategory: entry.blockedCategory, sourceTrust: entry.mapping.source?.trust })),
      nextPriorityStatus: 'source-observed-recovery-frequency; LDraw cross-reference still required',
      userReportedDesignRanking: ranking.designRanking,
      userReportedPartRanking: ranking.partRanking,
      assembly: { counts: assembly.counts, interfaceCoverage: assembly.interfaceCoverage, partLibraryVersion: assembly.partLibraryVersion, assemblyEngineVersion: assembly.assemblyEngineVersion, connectionRuleVersion: assembly.connectionRuleVersion, collisionVersion: assembly.collisionVersion, verificationScope: assembly.verificationScope, runtimeValidation: assembly.runtimeValidation },
      elementMapping: this.mapper!.summary(), recovery: { counts: recovery.counts, blockedReasons: recovery.blockedReasons }, instructionCoverage: coverage,
      capabilities: { neuralTraining: false, pdfTo3d: false, nativeLDrawGeometry: true, sourceConnections: true, inventoryElementExtraction: true, legacyGenerationEnabled: false, nativeAssemblyGeneration: assembly.counts.generatable > 0 },
      limitations: [...FOUNDATION_LIMITATIONS, ...new Set(this.sourceProblems)],
    };
  }
}
