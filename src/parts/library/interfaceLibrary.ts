import path from 'node:path';
import type { AssemblyInterfaceCapability, NativeAssembly, NativeAssemblyPart } from '../assembly/types.js';
import type { AssemblyService } from '../assembly/service.js';
import { CONNECTOR_GRAMMAR_RULES, inspectConnectorSupport, evaluateConnectorCompatibility } from '../grammar/rules.js';
import type { Connector, ConnectorFamily, GrammarRuleId } from '../grammar/schema.js';
import { CONNECTOR_FAMILIES, CONNECTOR_GRAMMAR_VERSION, CONNECTOR_SCHEMA_VERSION } from '../grammar/schema.js';
import { adaptNativePartConnectors, isSourceDeclaredBarEndpoint, isSourceDeclaredClipEndpoint, isSourceDeclaredPinEndpoint, isSourceDeclaredPinHoleEndpoint } from '../grammar/sources.js';
import { assessGrammarAdmission, GRAMMAR_ADMISSION_VERSION, type GrammarPartAdmission } from '../grammar/admission.js';
import { GrammarAssemblyService } from '../grammar/service.js';
import { PART_LIBRARY_VERSION } from '../assembly/source.js';
import { ASSEMBLY_ENGINE_VERSION } from '../assembly/engine.js';
import { CONNECTION_RULE_VERSION, checkConnectionCompatibility, STANDARD_STUD_RULE_ID, BAR_CLIP_RULE_ID, PIN_HOLE_RULE_ID } from '../assembly/compatibility.js';
import { COLLISION_VERSION } from '../assembly/collision.js';
import { solveAttachment } from '../assembly/solver.js';
import { exportNativeAssemblyJson } from '../assembly/documents.js';
import type { NativeGeneratedAssembly, NativeGenerationResult } from '../assembly/generator.js';
import type { ConnectionImportIssue, ImportedConnectionPoint } from '../connections/types.js';
import type { RealPartRegistry } from '../registry.js';
import { FeedbackStore } from './feedback.js';
import type {
  CasePlacement, CaseTransform, ComparisonCandidate, ConnectionCaseDetail, ConnectionCaseSummary, FeedbackInput, FeedbackPatch,
  InterfaceInstanceDetail, InterfaceInstanceSummary, InterfaceTypeRecord, InterfaceUseStatus, JointRuleDetail, JointRuleRecord,
  LibraryIndexSnapshot, LibraryOverview, LibraryVersions, PartComparison, ReviewItem, RuleUseStatus,
} from './types.js';

const FAMILY_LABELS: Record<ConnectorFamily, string> = {
  STUD: '标准凸点', ANTISTUD: '标准凹槽', HOLLOW_STUD: '空心凸点', BAR: '圆杆', BAR_HOLE: '杆孔', CLIP: '夹口',
  PIN: '销', PIN_HOLE: '销孔', AXLE: '十字轴', AXLE_HOLE: '十字孔', ROUND_HOLE: '圆孔',
  HINGE_FINGER: '铰链指', CLICK_HINGE: '卡扣铰链', TURNTABLE: '转盘', BALL: '球', BALL_SOCKET: '球窝',
  TOWBALL: '牵引球', TOWBALL_SOCKET: '牵引球窝', WHEEL_PIN: '轮轴销', WHEEL_HOLE: '轮孔',
  RIM_SEAT: '轮辋座', TYRE_SEAT: '轮胎座', RAIL: '导轨', GROOVE: '导槽', GENERIC_SPECIAL: '未分类特殊接口',
};
const FAMILY_DESCRIPTIONS: Record<ConnectorFamily, string> = {
  STUD: '从来源凸点解析出的标准凸点。名称只用于组织；能否配合取决于 profile、尺寸和规则。',
  ANTISTUD: '从来源凹槽解析出的标准凹槽。必须与标准凸点及来源尺寸共同判断。',
  HOLLOW_STUD: '空心/开口凸点，几何与保持力不等同实心凸点。',
  BAR: '由官方 LDraw “Bar …” 描述和阳圆杆来源共同声明；半径本身不是 BAR 证据。',
  BAR_HOLE: '来源明确声明的杆孔；当前固定库没有独立“with Bar Hole”来源零件。',
  CLIP: 'LDCad SNAP_CLP 来源夹座，开口壳体，seat 参数由来源半径和长度决定。',
  PIN: 'Technic 销来源接口；销身长度、端部和 seat 全部保留来源字段。',
  PIN_HOLE: 'Technic 销孔来源接口；孔深和截面来自 SNAP_CYL，不从外观推断。',
  AXLE: '十字轴接口。当前未进入生产规则。', AXLE_HOLE: '十字孔接口。当前未进入生产规则。',
  ROUND_HOLE: '圆形孔。除非来源明确声明用途，否则不能自动当作杆孔、销孔或轴孔。',
  HINGE_FINGER: '铰链指提示；尚无完整来源姿态/限位，不生产。', CLICK_HINGE: '卡扣铰链，未生产。',
  TURNTABLE: '转盘，未生产。', BALL: '球接头，未生产。', BALL_SOCKET: '球窝，空间姿态未闭合。',
  TOWBALL: '牵引球，未生产。', TOWBALL_SOCKET: '牵引球窝，未生产。', WHEEL_PIN: '轮轴销，轮组阻塞。',
  WHEEL_HOLE: '轮孔，轮组阻塞。', RIM_SEAT: '轮辋座，轮组阻塞。', TYRE_SEAT: '轮胎座，未生产。',
  RAIL: '导轨，未生产。', GROOVE: '导槽，未生产。',
  GENERIC_SPECIAL: '来源几何存在，但族/配合策略未建立；不得用名称、半径或外观补造兼容性。',
};
const RULE_LABELS: Record<string, string> = {
  C01: 'C01 标准凸点 ↔ 标准凹槽', BAR_CLIP: 'BAR_CLIP 圆杆 ↔ 夹口', BAR_RECEPTACLE: 'BAR_RECEPTACLE 圆杆 ↔ 杆孔',
  PIN_HOLE: 'PIN_HOLE 销 ↔ 销孔', AXLE_KEYED: 'AXLE_KEYED 十字轴 ↔ 十字孔', AXLE_ROUND: 'AXLE_ROUND 圆轴 ↔ 圆孔',
  HINGE: 'HINGE 铰链', CLICK_HINGE: 'CLICK_HINGE 卡扣铰链', TURNTABLE: 'TURNTABLE 转盘',
  BALL_SOCKET: 'BALL_SOCKET 球 ↔ 球窝', TOWBALL_SOCKET: 'TOWBALL_SOCKET 牵引球 ↔ 球窝',
  WHEEL_MOUNT: 'WHEEL_MOUNT 轮组座', TYRE_RIM: 'TYRE_RIM 轮胎 ↔ 轮辋', RAIL_GROOVE: 'RAIL_GROOVE 导轨 ↔ 导槽',
  GENERIC_GROUP: 'GENERIC_GROUP 来源分组',
};
const RULE_ROWS: Record<string, { conditions: string[]; missing: string[]; negative: string[]; docs: string[] }> = {
  C01: { conditions: ['两端均来自钉死来源', '凸点 R6×4、caps=one、非 center/slide', '凹槽来源为 aStud 或 R/S6 且长度≥4', '同轴、离散四分之一转之一', '正式装配图、占用、碰撞和多点闭合通过'], missing: [], negative: ['凸点 → 销孔明确禁止', '未列入白名单的凸点/凹槽不得开放'], docs: ['docs/CONNECTOR_GRAMMAR.md'] },
  BAR_CLIP: { conditions: ['官方 LDraw 描述以 Bar <n>L 开头', '阳杆来源为单段 R4 SNAP_CYL，caps none/one', '夹口来源为 SNAP_CLP R4/L8 center', '同轴、插入范围 [1,8] 有正交集', '开壳 seat 碰撞检查通过', '正式图/占用/多点闭合通过'], missing: ['无独立来源 Bar Receptacle 零件'], negative: ['仅半径 R4 的匿名圆柱不得成为 BAR', '60470b 的 80LDU 杆案例被真实 seat 外碰撞阻止', '两个开壳不得互相配对'], docs: ['docs/grammar/BAR_CLIP.md'] },
  PIN_HOLE: { conditions: ['Shadow 标题/ID 明确 Technic Pin / Connector Hole', '销≥3段 R/L_/_L 且至少一段 R6', '孔深 20、center/slide、R6 段', '插入范围 [1,20] 有正交集', '销全包络 seat 检查通过', '正式图/占用/多点闭合通过'], missing: ['没有独立来源的短销杆件，3673 销身 40LDU 超出 32000 孔深 20'], negative: ['18591 风挡本体在销 seat 外碰撞，不能作为成功案例', '不能删除碰撞或扩大 seat 来强行通过'], docs: ['docs/grammar/PIN_PIN_HOLE.md'] },
};
const CASE_DEFS = [
  { id: 'case-c01-standard-studs', label: 'C01 标准凸点 → 凹槽（真实两件）', ruleId: 'C01', build: 'default-pair' as const, summary: '由正式装配引擎选择的真实凸点/凹槽两件装配。' },
  { id: 'case-bar-clip-30374-48729b', label: 'BAR_CLIP 30374 → 48729b', ruleId: 'BAR_CLIP', build: 'module' as const, module: 'bar-clip' as const, summary: '真实 4L 圆杆插入真实夹口，生成/导出/重导入通过。' },
  { id: 'case-pin-hole-3673-32000', label: 'PIN_HOLE 3673 → 32000', ruleId: 'PIN_HOLE', build: 'module' as const, module: 'pin-hole' as const, summary: '真实 Technic 销插入真实销孔，生成/导出/重导入通过。' },
  { id: 'case-bar-clip-60470b-blocked', label: 'BAR_CLIP 30374 → 60470b（真实阻塞）', ruleId: 'BAR_CLIP', build: 'blocked' as const, summary: '真实 4L 圆杆与带夹板件在 seat 外碰撞，正式引擎拒绝。' },
];
const VERSIONS: LibraryVersions = { schema: CONNECTOR_SCHEMA_VERSION, grammar: CONNECTOR_GRAMMAR_VERSION, admission: GRAMMAR_ADMISSION_VERSION, partLibrary: PART_LIBRARY_VERSION, assemblyEngine: ASSEMBLY_ENGINE_VERSION, connectionRule: CONNECTION_RULE_VERSION, collision: COLLISION_VERSION };
const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/;
const featurePattern = /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,999}$/;
const unique = <T,>(items: T[]) => [...new Set(items)];
const vector = (value: readonly number[]): [number, number, number] => [Number(value[0] ?? 0), Number(value[1] ?? 0), Number(value[2] ?? 0)];
const featureKey = (partId: string, featureId: string) => `${partId}\u0000${featureId}`;
const instanceId = (partId: string, featureId: string) => `${partId}:${featureId}`;
function sourceOf(connector: Connector) { return connector.sources.find(source => source.line !== null) ?? connector.sources[0] ?? null; }
function nativeRuleFor(ruleId: GrammarRuleId): string | null { return ruleId === 'C01' ? STANDARD_STUD_RULE_ID : ruleId === 'BAR_CLIP' ? BAR_CLIP_RULE_ID : ruleId === 'PIN_HOLE' ? PIN_HOLE_RULE_ID : null; }
function caseType(definition: typeof CASE_DEFS[number]): ConnectionCaseSummary['caseType'] { return definition.build === 'blocked' ? 'blocked' : 'production'; }
function emptyCapability(partId: string): AssemblyInterfaceCapability { return { partId, admissionBasis: 'interface-grammar', sourceReady: false, collisionGeometryReady: false, connectable: false, assemblyVerified: false, generatable: false, allowedConnectionIds: [], ruleIds: [], reasonCodes: ['library-unavailable'], reasons: ['No source admission was available.'] }; }

export class InterfaceLibrary {
  private indexPromise?: Promise<LibraryIndexSnapshot>;
  private casesPromise?: Promise<ConnectionCaseDetail[]>;
  private caseDocuments = new Map<string, NativeGeneratedAssembly>();
  private attachmentGraphs = new Map<string, NativeAssembly>();
  readonly feedback: FeedbackStore;
  constructor(private readonly registry: RealPartRegistry, options: { libraryDataDir?: string } = {}) {
    this.feedback = new FeedbackStore(path.resolve(options.libraryDataDir ?? process.env.BRICKLAB_DATA_DIR ?? 'data', 'interface-library'));
  }

  private grammar(): GrammarAssemblyService | null { return this.registry.assemblyService instanceof GrammarAssemblyService ? this.registry.assemblyService : null; }
  async index(): Promise<LibraryIndexSnapshot> { return this.indexPromise ??= this.buildIndex(); }
  private async buildIndex(): Promise<LibraryIndexSnapshot> {
    const assembly = this.registry.assemblyService;
    const grammar = this.grammar();
    const manifest = await this.registry.repository.getManifest();
    const instances: InterfaceInstanceSummary[] = [];
    const connectors = new Map<string, { connector: Connector; point: ImportedConnectionPoint; partId: string; partName: string }>();
    const partIds = new Set<string>();
    for (const root of manifest.roots) {
      const part = await assembly.getPart(root.partId).catch(() => undefined);
      if (!part) continue;
      partIds.add(part.partId);
      const admission = grammar ? await grammar.getGrammarAdmission(part.partId).catch(() => undefined) : assessGrammarAdmission(part);
      const capability = admission?.capability ?? await assembly.getCapability(part.partId) ?? emptyCapability(part.partId);
      const ingestion = admission?.ingestion ?? adaptNativePartConnectors(part);
      const supportById = new Map((admission?.featureSupport ?? []).map(feature => [feature.featureId, feature]));
      for (const connector of ingestion.connectors) {
        const source = sourceOf(connector);
        const support = supportById.get(connector.featureId);
        const sourceId = connector.sourceConnectionId;
        const enabled = !!sourceId && capability.allowedConnectionIds.includes(sourceId);
        const supported = support?.supported === true;
        const issue = support?.reasonCodes?.[0] ?? (connector.coverage === 'COMPLETE' ? null : connector.diagnostics[0]?.code ?? null);
        const status: InterfaceUseStatus = supported && enabled ? 'production' : connector.coverage === 'NONE' ? 'unresolved' : connector.coverage === 'PARTIAL' || connector.unknownFields.length > 0 || connector.diagnostics.length > 0 ? 'partial' : 'source-ready';
        const summary: InterfaceInstanceSummary = {
          id: instanceId(part.partId, connector.featureId), partId: part.partId, partName: part.geometry.name ?? part.partId,
          featureId: connector.featureId, sourceConnectionId: sourceId, family: connector.family, role: connector.role, profile: connector.profile,
          coverage: connector.coverage, status, supported, enabled, nativeRuleIds: support?.ruleIds ?? [], sourcePath: source?.reference ?? null,
          sourceLine: source?.line ?? null, sourceRaw: source?.raw ?? null, sourceSha256: source?.sha256 ?? null,
          position: vector(connector.localPositionLdu), axis: vector(connector.axis), dimensions: connector.dimensions,
          insertionRangeLdu: connector.insertionRangeLdu, slideAllowed: connector.slideAllowed, rotationAllowed: connector.rotationAllowed,
          unknownFields: connector.unknownFields, diagnostics: connector.diagnostics.map(diagnostic => ({ code: diagnostic.code, message: diagnostic.message })), issue, caseIds: [],
        };
        instances.push(summary);
        const point = part.connections.points.find(candidate => candidate.id === sourceId);
        if (point) connectors.set(featureKey(part.partId, connector.featureId), { connector, point, partId: part.partId, partName: part.geometry.name ?? part.partId });
      }
    }
    const rules = this.buildRules(instances);
    const overview = this.buildOverview(instances, rules, partIds.size);
    return { overview, instances, cases: [], rules, queue: [], connectors };
  }

  private buildRules(instances: InterfaceInstanceSummary[]): JointRuleRecord[] {
    return CONNECTOR_GRAMMAR_RULES.map(rule => {
      const matching = instances.filter(instance => rule.maleFamilies.includes(instance.family) || rule.femaleFamilies.includes(instance.family));
      const nativeRuleId = nativeRuleFor(rule.id);
      const production = !!nativeRuleId && ['C01', 'BAR_CLIP', 'PIN_HOLE'].includes(rule.id);
      const status: RuleUseStatus = production ? 'production' : rule.evidenceRequired === 'SOURCE_DECLARED_FIT' ? 'source-declared' : rule.evidenceRequired === 'VERIFIED_FIT' ? 'conditional' : 'specification-only';
      const row = RULE_ROWS[rule.id];
      return {
        id: rule.id, label: RULE_LABELS[rule.id] ?? rule.id, description: `${FAMILY_LABELS[rule.maleFamilies[0] as ConnectorFamily] ?? rule.maleFamilies.join('/')} ↔ ${FAMILY_LABELS[rule.femaleFamilies[0] as ConnectorFamily] ?? rule.femaleFamilies.join('/')}`,
        maleFamilies: [...rule.maleFamilies], femaleFamilies: [...rule.femaleFamilies], evidenceRequired: rule.evidenceRequired, nativeRuleId, production, status,
        instanceCount: matching.length, partCount: new Set(matching.map(instance => instance.partId)).size, caseIds: CASE_DEFS.filter(definition => definition.ruleId === rule.id).map(definition => definition.id),
        conditions: row?.conditions ?? ['规则声明存在；尚无生产适配或来源前提核验。'], missingEvidence: row?.missing ?? ['尚未实现生产连接图适配。'],
        negativeControls: row?.negative ?? ['不得用名称、半径或外观替代来源证据。'], docs: row?.docs ?? ['docs/CONNECTOR_GRAMMAR.md'],
        openFeedback: 0,
        reviewState: 'clear' as const,
        versions: { grammar: CONNECTOR_GRAMMAR_VERSION, connectionRule: nativeRuleId ? CONNECTION_RULE_VERSION : null },
      };
    });
  }

  private buildOverview(instances: InterfaceInstanceSummary[], rules: JointRuleRecord[], partCount: number): LibraryOverview {
    const types: InterfaceTypeRecord[] = CONNECTOR_FAMILIES.map(family => {
      const rows = instances.filter(instance => instance.family === family);
      const complete = rows.filter(instance => instance.coverage === 'COMPLETE').length, partial = rows.filter(instance => instance.coverage === 'PARTIAL').length, unresolved = rows.length - complete - partial;
      const production = rows.some(instance => instance.status === 'production');
      return { id: family, label: FAMILY_LABELS[family], description: FAMILY_DESCRIPTIONS[family], organizationalOnly: true as const, rules: rules.filter(rule => rule.maleFamilies.includes(family) || rule.femaleFamilies.includes(family)).map(rule => rule.id), productionRules: rules.filter(rule => rule.production && (rule.maleFamilies.includes(family) || rule.femaleFamilies.includes(family))).map(rule => rule.id), instanceCount: rows.length, partCount: new Set(rows.map(instance => instance.partId)).size, complete, partial, unresolved, status: production ? 'production' as const : complete > 0 ? 'source-ready' as const : partial > 0 ? 'partial' as const : 'unresolved' as const, notes: family === 'GENERIC_SPECIAL' ? ['未分类接口保留给复核；不得自动用于生成。'] : [] };
    });
    return {
      versions: VERSIONS, generatedAt: new Date().toISOString(),
      counts: { parts: partCount, interfaces: instances.length, types: types.length, rules: rules.length, productionRules: rules.filter(rule => rule.production).length, productionInterfaces: instances.filter(instance => instance.status === 'production').length, sourceReadyInterfaces: instances.filter(instance => instance.status === 'source-ready').length, partialInterfaces: instances.filter(instance => instance.status === 'partial').length, unresolvedInterfaces: instances.filter(instance => instance.status === 'unresolved').length, cases: CASE_DEFS.length, validatedCases: 0, blockedCases: 0, openFeedback: 0 },
      types, rules, recentCases: [], limitations: ['接口库只汇总当前钉死来源、已实现规则和正式引擎结果；“已识别”不等于“已配合”。', '三维方向、尺寸和 seat 来自来源数据；参数示意不得作为碰撞或实物证据。', '人工反馈持久化在本地 JSON，不会自动授权、解禁或改变软件结论。'],
    };
  }

  private async enrichRules(rows: JointRuleRecord[]): Promise<JointRuleRecord[]> {
    const active = (await this.feedback.list()).filter(record => !['resolved', 'rejected'].includes(record.status));
    return rows.map(row => { const openFeedback = active.filter(record => record.target.ruleId === row.id || (record.target.kind === 'rule' && record.target.id === row.id)).length; return { ...row, openFeedback, reviewState: openFeedback > 0 ? 'review-required' : 'clear' }; });
  }

  async overview(): Promise<LibraryOverview> { const index = await this.index(); const cases = await this.cases().catch(() => []); const openFeedback = (await this.feedback.list()).filter(record => record.status === 'open' || record.status === 'triaged').length; const rules = await this.enrichRules(index.overview.rules); return { ...index.overview, counts: { ...index.overview.counts, cases: cases.length, validatedCases: cases.filter(item => item.status === 'validated').length, blockedCases: cases.filter(item => item.status === 'blocked').length, openFeedback }, recentCases: cases.map(this.caseSummary), types: index.overview.types, rules }; }

  async interfaces(query: { family?: string; status?: string; coverage?: string; query?: string; supported?: string; partId?: string; limit?: number; offset?: number } = {}) {
    const index = await this.index();
    const q = (query.query ?? '').trim().toLowerCase();
    const limit = Math.max(1, Math.min(200, Number(query.limit ?? 60) || 60)), offset = Math.max(0, Number(query.offset ?? 0) || 0);
    const rows = index.instances.filter(row =>
      (!query.family || row.family === query.family) && (!query.status || row.status === query.status) && (!query.coverage || row.coverage === query.coverage) &&
      (!query.partId || row.partId === query.partId) && (query.supported === undefined || String(row.supported) === query.supported) &&
      (!q || `${row.partId} ${row.partName} ${row.family} ${row.sourceConnectionId ?? ''}`.toLowerCase().includes(q)));
    return { total: rows.length, offset, limit, instances: rows.slice(offset, offset + limit) };
  }

  async instance(partId: string, featureId: string): Promise<InterfaceInstanceDetail | null> {
    if (!idPattern.test(partId) || !featurePattern.test(featureId)) return null;
    const index = await this.index(); const row = index.instances.find(item => item.partId === partId && item.featureId === featureId);
    const entry = index.connectors.get(featureKey(partId, featureId));
    if (!row || !entry) return null;
    const part = await this.registry.assemblyService.getPart(partId); if (!part) return null;
    const grammar = this.grammar();
    const admission = grammar ? await grammar.getGrammarAdmission(partId).catch(() => undefined) : assessGrammarAdmission(part);
    const capability = admission?.capability ?? emptyCapability(partId);
    const relatedRules = await Promise.all(index.rules.filter(rule => rule.maleFamilies.includes(row.family) || rule.femaleFamilies.includes(row.family)).map(rule => this.rule(rule.id)));
    const feedback = await this.feedback.list({ targetId: row.id });
    const sourceFiles = [
      ...part.geometry.source.files.map(file => ({ library: 'LDraw', path: file.path, revision: part.geometry.source.revision, sha256: file.sha256, license: file.license ?? 'unknown', sourceUrl: file.sourceUrl })),
      ...part.connections.sourceFiles,
    ];
    return {
      ...row, connector: entry.connector, relatedRules: relatedRules.filter((rule): rule is JointRuleDetail => !!rule), sourceFiles, rawPoints: [entry.point],
      issues: part.connections.issues, feedback,
      part: { id: part.partId, name: part.geometry.name ?? part.partId, bounds: part.geometry.bounds ?? null, generationEligible: capability.generatable ?? false, connectable: capability.connectable ?? false, collisionGeometryReady: capability.collisionGeometryReady ?? false, sourceReady: capability.sourceReady ?? false, reasons: capability.reasons, allowedConnectionIds: capability.allowedConnectionIds, ruleIds: capability.ruleIds },
    };
  }

  async rules(): Promise<JointRuleRecord[]> { return this.enrichRules((await this.index()).rules); }
  async rule(ruleId: string): Promise<JointRuleDetail | null> {
    const index = await this.index(); const found = index.rules.find(rule => rule.id === ruleId); if (!found) return null; const row = (await this.enrichRules([found]))[0];
    const cases = (await this.cases()).filter(item => item.ruleId === ruleId);
    const examples = index.instances.filter(instance => row.maleFamilies.includes(instance.family) || row.femaleFamilies.includes(instance.family)).slice(0, 12);
    return { ...row, cases: cases.map(this.caseSummary), examples, sources: [...new Set(examples.flatMap(example => example.sourcePath ? [example.sourcePath] : []))], jointTypes: ruleId === 'C01' ? ['RIGID'] : ruleId === 'BAR_CLIP' || ruleId === 'PIN_HOLE' ? ['CYLINDRICAL'] : ['RIGID'] };
  }

  async cases(): Promise<ConnectionCaseDetail[]> { return this.casesPromise ??= this.buildCases(); }
  private caseSummary = (item: ConnectionCaseDetail): ConnectionCaseSummary => ({ id: item.id, label: item.label, ruleId: item.ruleId, status: item.status, fixedPartId: item.fixedPartId, movingPartId: item.movingPartId, summary: item.summary, caseType: item.caseType, sourceDeclared: item.sourceDeclared, physicalBuildVerified: false });

  private async buildCases(): Promise<ConnectionCaseDetail[]> {
    const index = await this.index(); const assembly = this.registry.assemblyService; const cases: ConnectionCaseDetail[] = [];
    for (const definition of CASE_DEFS) {
      try {
        let graph: NativeAssembly | null = null, model: NativeGeneratedAssembly | null = null;
        let result: Awaited<ReturnType<AssemblyService['attach']>> | NativeGenerationResult | null = null;
        let importStatus: 'VALID' | 'NEEDS_REVALIDATION' | 'NOT_RUN' = 'NOT_RUN';
        if (definition.build === 'default-pair') {
          const status = await assembly.status(); if (!status.defaultPair) continue;
          const attached = await assembly.attach(status.defaultPair); graph = attached.graph; result = attached;
        } else if (definition.build === 'module') {
          const generated = await assembly.generate({ module: definition.module, partCount: 2 }); result = generated; model = generated.model; graph = model;
          if (model) { const imported = await assembly.importModel(JSON.parse(exportNativeAssemblyJson(model))); importStatus = imported.status; if (imported.status === 'VALID' && imported.model) { model = imported.model; graph = imported.model; } }
        } else {
          const bar = index.instances.find(instance => instance.partId === '30374' && instance.sourceConnectionId && isSourceDeclaredBarEndpoint(index.connectors.get(featureKey(instance.partId, instance.featureId))!.point));
          const clip = index.instances.find(instance => instance.partId === '60470b' && instance.sourceConnectionId && isSourceDeclaredClipEndpoint(index.connectors.get(featureKey(instance.partId, instance.featureId))!.point));
          if (!bar?.sourceConnectionId || !clip?.sourceConnectionId) continue;
          const attached = await assembly.attach({ partA: bar.partId, connectionA: bar.sourceConnectionId, partB: clip.partId, connectionB: clip.sourceConnectionId, twistDegrees: 0 });
          graph = attached.graph; result = attached;
        }
        if (!graph) continue;
        if (model) this.caseDocuments.set(definition.id, model);
        if (definition.build === 'blocked') this.attachmentGraphs.set(definition.id, graph);
        const edge = graph.edges[0] ?? null;
        const placements: CasePlacement[] = graph.placements.map(placement => ({ instanceId: placement.instanceId, partId: placement.partId, transform: this.transform(placement.transform) }));
        const candidateTransform = result && 'candidate' in result && result.candidate ? result.candidate.transform : null;
        if (definition.build === 'blocked' && candidateTransform && !placements.some(placement => placement.partId === '60470b')) placements.push({ instanceId: 'candidate-60470b', partId: '60470b', transform: this.transform(candidateTransform) });
        let fixedPlacement = edge ? placements.find(placement => placement.instanceId === edge.fixedInstanceId) ?? placements[0] : placements[0];
        let movingPlacement = edge ? placements.find(placement => placement.instanceId === edge.movingInstanceId) : placements[1];
        let fixedPoint = edge ? index.instances.find(instance => instance.partId === fixedPlacement?.partId && instance.sourceConnectionId === edge.fixedConnectionId) : undefined;
        let movingPoint = edge ? index.instances.find(instance => instance.partId === movingPlacement?.partId && instance.sourceConnectionId === edge.movingConnectionId) : undefined;
        if (!fixedPoint || !movingPoint) {
          if (definition.build !== 'blocked') continue;
          fixedPoint = index.instances.find(instance => instance.partId === '30374' && instance.family === 'BAR');
          movingPoint = index.instances.find(instance => instance.partId === '60470b' && instance.family === 'CLIP');
        }
        if (!fixedPlacement || !fixedPoint || !movingPoint) continue;
        const fixedPart = await assembly.getPart(fixedPoint.partId), movingPart = await assembly.getPart(movingPoint.partId);
        if (definition.build === 'blocked' && !movingPlacement && fixedPart && movingPart) {
          const solvedCase = await solveAttachment({ fixedPart, fixedPlacement: { instanceId: fixedPlacement.instanceId, partId: fixedPart.partId, transform: fixedPlacement.transform }, fixedConnectionId: fixedPoint.sourceConnectionId!, movingPart, movingConnectionId: movingPoint.sourceConnectionId! });
          if (solvedCase.candidates[0]) {
            const candidate = solvedCase.candidates[0];
            movingPlacement = { instanceId: `blocked-candidate-${movingPoint.partId}`, partId: movingPoint.partId, transform: this.transform(candidate.transform) };
            placements.push(movingPlacement);
          }
        }
        if (!movingPlacement) continue;
        const compatible = fixedPart && movingPart ? await checkConnectionCompatibility(
          fixedPart.connections.points.find(point => point.id === fixedPoint.sourceConnectionId)!,
          movingPart.connections.points.find(point => point.id === movingPoint.sourceConnectionId)!,
        ) : null;
        const collision = result && 'collision' in result ? result.collision : undefined;
        const rejectionCodes = result && 'rejections' in result ? result.rejections.map(item => item.code) : [];
        const accepted = result && 'accepted' in result ? result.accepted : model?.assemblyValidation.valid === true;
        const reasons = result && 'rejections' in result ? result.rejections.map(item => item.reason) : result && 'reasons' in result ? result.reasons : [];
        const graphValid = await assembly.engine.validateGraph(graph).then(value => value.valid).catch(() => false);
        const caseModel = this.caseDocuments.get(definition.id) ?? model;
        cases.push({
          id: definition.id, label: definition.label, ruleId: definition.ruleId, status: accepted && importStatus !== 'NEEDS_REVALIDATION' && graphValid ? 'validated' : 'blocked', fixedPartId: fixedPoint.partId, movingPartId: movingPoint.partId,
          summary: definition.summary, caseType: caseType(definition), sourceDeclared: !!compatible?.sourceEvidence.length, physicalBuildVerified: false,
          fixed: fixedPoint, moving: movingPoint,
          edge: edge ? { fixedInstanceId: edge.fixedInstanceId, fixedConnectionId: edge.fixedConnectionId, movingInstanceId: edge.movingInstanceId, movingConnectionId: edge.movingConnectionId, ruleId: edge.ruleId, ruleVersion: edge.ruleVersion, axis: edge.axis, anchor: edge.anchor, insertionDepthLdu: edge.insertionDepthLdu, twistDeg: edge.twistDeg } : null,
          placements, allowedTwistsDeg: [0, 90, 180, 270], allowedRelativeOrientations: ['同轴；允许离散四分之一转（0/90/180/270）'], jointTypes: definition.ruleId === 'C01' ? ['RIGID'] : ['CYLINDRICAL'],
          validation: { engineAccepted: !!accepted, graphValid, importStatus, collisionStatus: collision?.status === 'clear' ? 'clear' : collision?.status === 'collision' ? 'collision' : collision?.status === 'blocked' ? 'blocked' : accepted ? 'clear' : rejectionCodes.includes('native-plastic-collision') || rejectionCodes.includes('no-collision-free-transform') ? 'collision' : 'not-run', reasons, rejectionCodes, installationPath: accepted ? 'source-axis-pose-only' : 'not-validated', physicalBuildVerified: false },
          modelMeta: caseModel ? { bom: caseModel.bom.map(row => ({ partId: row.partId, name: row.name, quantity: row.quantity })), steps: caseModel.steps.length, sources: caseModel.sources.length, exportBytes: (() => { try { return Buffer.byteLength(exportNativeAssemblyJson(caseModel)); } catch { return null; } })(), contentSha256: caseModel.contentSha256 } : null,
          displayNotice: definition.build === 'blocked' ? '真实引擎拒绝的故障案例：位置和碰撞原因保留，不展示成功姿态。' : '姿态来自正式求解；未验证安装轨迹，切换仅为示意，不是碰撞证明。',
          versions: VERSIONS,
          feedback: await this.feedback.list({ targetId: definition.id }),
        });
        for (const id of [fixedPoint.id, movingPoint.id]) { const row = index.instances.find(instance => instance.id === id); if (row) row.caseIds = unique([...row.caseIds, definition.id]); }
      } catch { /* One blocked case must not hide the rest of the library. */ }
    }
    return cases;
  }

  private transform(value: { rotation: readonly number[]; translation: readonly number[] }): CaseTransform { return { rotation: value.rotation.slice(0, 9) as CaseTransform['rotation'], translation: value.translation.slice(0, 3) as CaseTransform['translation'] }; }

  async queue(): Promise<ReviewItem[]> {
    const index = await this.index(); const feedback = await this.feedback.list(); const items: ReviewItem[] = [];
    for (const instance of index.instances) {
      if (instance.status === 'production') continue;
      const category: ReviewItem['category'] = instance.status === 'partial' ? 'partial-parse' : instance.family === 'GENERIC_SPECIAL' ? 'missing-source' : 'unsupported-rule';
      items.push({ id: `queue:${instance.id}`, category, severity: instance.status === 'unresolved' ? 'blocking' : 'warning', title: `${instance.partId} · ${instance.family} ${instance.sourceConnectionId ?? instance.featureId}`, detail: instance.issue ?? (instance.unknownFields.length ? `未知字段：${instance.unknownFields.join(', ')}` : '来源已解析，但当前无生产规则或碰撞准入。'), partId: instance.partId, featureId: instance.featureId, ruleId: instance.nativeRuleIds[0] ?? null, caseId: null, code: instance.issue ?? 'UNSUPPORTED_OR_UNKNOWN', openFeedback: 0 });
    }
    for (const record of feedback.filter(item => !['resolved', 'rejected'].includes(item.status))) items.push({ id: `feedback:${record.id}`, category: 'human-dispute', severity: record.status === 'open' ? 'warning' : 'info', title: `人工反馈 · ${record.kind}`, detail: `${record.message.slice(0, 300)}${record.message.length > 300 ? '…' : ''}`, partId: record.target.partId ?? null, featureId: record.target.featureId ?? null, ruleId: record.target.ruleId ?? null, caseId: record.target.caseId ?? null, code: record.status.toUpperCase(), openFeedback: 1 });
    return items.slice(0, 800);
  }

  async compare(partId: string, targetPartId: string | null = null): Promise<PartComparison | null> {
    if (!idPattern.test(partId) || targetPartId && !idPattern.test(targetPartId)) return null;
    const index = await this.index(); const assembly = this.registry.assemblyService;
    const part = await assembly.getPart(partId); if (!part) return null;
    const grammar = this.grammar();
    const admission = grammar ? await grammar.getGrammarAdmission(partId).catch(() => undefined) : assessGrammarAdmission(part);
    const capability = admission?.capability ?? emptyCapability(partId);
    const ingestion = admission?.ingestion ?? adaptNativePartConnectors(part);
    const supportById = new Map((admission?.featureSupport ?? []).map(feature => [feature.featureId, feature]));
    const candidates: ComparisonCandidate[] = [];
    for (const connector of ingestion.connectors) {
      const support = supportById.get(connector.featureId); const policy = connector.matchingPolicy;
      const rules = index.rules.filter(rule => rule.maleFamilies.includes(connector.family) || rule.femaleFamilies.includes(connector.family));
      const classification: ComparisonCandidate['classification'] = support?.supported && policy?.kind === 'SOURCE_DECLARED_FIT' ? 'exact' : support?.supported ? 'candidate' : connector.family === 'GENERIC_SPECIAL' || connector.coverage !== 'COMPLETE' ? 'insufficient' : rules.length ? 'candidate' : 'insufficient';
      const counterparts = index.instances.filter(instance => instance.partId !== partId && (!targetPartId || instance.partId === targetPartId) && (instance.status === 'production' || instance.status === 'source-ready') && rules.some(rule => (rule.maleFamilies.includes(connector.family) && rule.femaleFamilies.includes(instance.family)) || (rule.femaleFamilies.includes(connector.family) && rule.maleFamilies.includes(instance.family))));
      let best: ComparisonCandidate['counterpart'] = null, formal: ComparisonCandidate['formalAssembly'] = null;
      for (const counterpart of counterparts.slice(0, 40)) {
        const other = index.connectors.get(featureKey(counterpart.partId, counterpart.featureId)); if (!other) continue;
        const otherPart = await assembly.getPart(counterpart.partId); if (!otherPart) continue;
        const pair = connector.role === 'MALE' ? [connector, other.connector] : [other.connector, connector];
        const compatibility = evaluateConnectorCompatibility(pair[0], pair[1]);
        if (compatibility.status !== 'COMPATIBLE') continue;
        const fixed = connector.role === 'MALE' ? otherPart : part, moving = connector.role === 'MALE' ? part : otherPart;
        const fixedConnector = connector.role === 'MALE' ? other.connector : connector, movingConnector = connector.role === 'MALE' ? connector : other.connector;
        const fixedPoint = fixed.connections.points.find(point => point.id === fixedConnector.sourceConnectionId);
        const movingPoint = moving.connections.points.find(point => point.id === movingConnector.sourceConnectionId);
        if (!fixedPoint || !movingPoint) continue;
        const nativeCompatibility = checkConnectionCompatibility(fixedPoint, movingPoint);
        const solved = solveAttachment({ fixedPart: fixed, fixedPlacement: { instanceId: 'compare-fixed', partId: fixed.partId, transform: { rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1], translation: [0, 0, 0] } }, fixedConnectionId: fixedPoint.id, movingPart: moving, movingConnectionId: movingPoint.id });
        best = { partId: otherPart.partId, featureId: other.connector.featureId, sourceConnectionId: other.connector.sourceConnectionId, family: other.connector.family, role: other.connector.role, compatibility: nativeCompatibility.status, solver: solved.status, collision: solved.candidates.length ? 'solved-pose-not-collision-tested' : 'not-run' };
        const fixedCapability = await assembly.getCapability(fixed.partId), movingCapability = await assembly.getCapability(moving.partId);
        const fixedReady = fixedCapability?.generatable === true, movingReady = movingCapability?.generatable === true;
        if (fixedReady && movingReady) {
          const attached = await assembly.attach({ partA: fixed.partId, connectionA: fixedPoint.id, partB: moving.partId, connectionB: movingPoint.id, twistDegrees: solved.candidates[0]?.twistDeg ?? 0 });
          formal = { status: attached.accepted ? 'accepted' : 'rejected', reasons: attached.rejections.map(item => item.reason), modelId: attached.accepted ? (attached.graph as NativeAssembly & { id?: string }).id ?? null : null };
        } else formal = { status: 'not-run', reasons: [`正式装配需要两端当前生成准入；${fixed.partId}=${fixedReady}，${moving.partId}=${movingReady}`], modelId: null };
        break;
      }
      candidates.push({ interfaceId: instanceId(partId, connector.featureId), featureId: connector.featureId, family: connector.family, role: connector.role, classification, matchedRuleIds: rules.map(rule => rule.id), reasons: support?.reasonCodes ?? [], failedConditions: support?.supported ? [] : [...support?.reasonCodes ?? [], ...(policy?.kind === 'VERIFIED_FIT' ? ['缺少逐对已验证 fit 证据'] : [])], sourceIds: connector.sources.map(source => source.id), counterpart: best, formalAssembly: formal });
      if (!best && targetPartId) candidates[candidates.length - 1].reasons.push('与指定目标零件没有来源兼容端点。');
      if (!best && !targetPartId && rules.length === 0) candidates[candidates.length - 1].reasons.push('没有可适用的拼接规则。');
    }
    return { partId, partName: part.geometry.name ?? partId, targetPartId, generatedAt: new Date().toISOString(), versions: VERSIONS, recognition: { interfaces: candidates.length, exact: candidates.filter(item => item.classification === 'exact').length, candidate: candidates.filter(item => item.classification === 'candidate').length, conflict: candidates.filter(item => item.classification === 'conflict').length, insufficient: candidates.filter(item => item.classification === 'insufficient').length, typeRecognition: capability.sourceReady ? 'source-declared' : 'partial', ruleMatch: candidates.some(item => item.classification === 'exact') ? 'matched' : candidates.length ? 'candidate' : 'none', assemblyPass: candidates.some(item => item.formalAssembly?.status === 'accepted') ? 'accepted' : candidates.some(item => item.formalAssembly?.status === 'rejected') ? 'rejected' : 'not-run', generationAdmission: false }, candidates, limitations: ['比对只说明“来源识别/规则候选/正式装配检查”的分层结果，不授予生成准入。', '外观、名称或相同半径不能替代来源身份和规则条件。', '未运行安装路径、稳定性、保持力或实物验证。'] };
  }

  async addFeedback(value: FeedbackInput) {
    const evidence = { ...value.evidence };
    evidence.grammarVersion ??= VERSIONS.grammar;
    evidence.partLibraryVersion ??= VERSIONS.partLibrary;
    evidence.collisionVersion ??= VERSIONS.collision;
    evidence.ruleVersion ??= CONNECTION_RULE_VERSION;
    let conclusion: string | null = null;
    const index = await this.index();
    const target = value.target;
    const instance = index.instances.find(item =>
      (target.featureId !== undefined && item.featureId === target.featureId && item.partId === target.partId)
      || item.id === target.id);
    if (instance) {
      evidence.interfaceStatus ??= instance.status;
      evidence.ruleId ??= instance.nativeRuleIds[0] ?? null;
      evidence.sourceDigest ??= instance.sourceSha256;
      evidence.sourceIds = [...new Set([...(evidence.sourceIds ?? []), ...(instance.sourceSha256 ? [instance.sourceSha256] : [])])];
      conclusion = `接口 ${instance.status} · 覆盖 ${instance.coverage} · 接口启用 ${instance.enabled ? 'true' : 'false'} · 规则 ${instance.nativeRuleIds.join(',') || '无'}`;
    }
    if (target.kind === 'rule') {
      const rule = index.rules.find(item => item.id === (target.ruleId ?? target.id));
      if (rule) {
        evidence.ruleId ??= rule.id;
        evidence.interfaceStatus ??= rule.status;
        conclusion = `规则 ${rule.id} · 状态 ${rule.status} · 生产 ${rule.production ? 'true' : 'false'}`;
      }
    }
    if (target.kind === 'case') {
      const found = (await this.cases()).find(item => item.id === (target.caseId ?? target.id));
      if (found) {
        evidence.ruleId ??= found.ruleId;
        evidence.interfaceStatus ??= found.status;
        evidence.sourceDigest ??= found.fixed.sourceSha256 ?? found.moving.sourceSha256;
        evidence.sourceIds = [...new Set([...(evidence.sourceIds ?? []), ...(found.fixed.sourceSha256 ? [found.fixed.sourceSha256] : []), ...(found.moving.sourceSha256 ? [found.moving.sourceSha256] : [])])];
        conclusion = `案例 ${found.status} · 引擎 ${found.validation.engineAccepted ? 'accepted' : 'rejected'} · 图 ${found.validation.graphValid ? 'valid' : 'invalid'} · 碰撞 ${found.validation.collisionStatus} · 重导入 ${found.validation.importStatus}`;
      }
    }
    evidence.conclusion ??= conclusion ?? '人工观察，不改变软件验证结论。';
    return this.feedback.add({ ...value, evidence });
  }
  async patchFeedback(id: string, value: FeedbackPatch) { return this.feedback.patch(id, value); }
  async listFeedback(filter: Parameters<FeedbackStore['list']>[0] = {}) { return this.feedback.list(filter); }
  async caseDocument(id: string) { return this.caseDocuments.get(id) ?? null; }
  async attachmentGraph(id: string) { return this.attachmentGraphs.get(id) ?? null; }
}
