import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { GrammarAssemblyService } from '../parts/grammar/service.js';
import { CONNECTOR_FAMILIES, CONNECTOR_GRAMMAR_VERSION, CONNECTOR_SCHEMA_VERSION, type ConnectorCoverage, type ConnectorFamily, type ConnectorSourceKind, type ConnectorDiagnostic } from '../parts/grammar/schema.js';
import { CONNECTOR_INGESTION_VERSION, type ConnectorIngestion } from '../parts/grammar/sources.js';
import { classifyBuildingPatterns, BUILDING_PATTERN_VERSION } from '../parts/grammar/patterns.js';
import { GRAMMAR_ADMISSION_VERSION } from '../parts/grammar/admission.js';
import { CONNECTION_PARSER_VERSION } from '../parts/connections/importer.js';
import { PART_LIBRARY_VERSION } from '../parts/assembly/source.js';
import { COLLISION_VERSION } from '../parts/assembly/collision.js';
import type { ConnectionSourceFile } from '../parts/connections/types.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const countBy = <T>(values: readonly T[], key: (value: T) => string) => values.reduce<Record<string, number>>((counts, value) => { const id = key(value); counts[id] = (counts[id] ?? 0) + 1; return counts; }, {});
const csvCell = (value: unknown) => '"' + String(value ?? '').replaceAll('"', '""') + '"';

export interface ConnectorAuditPart {
  part_id: string; name: string | null; geometry_ready: boolean; connector_count: number;
  connector_families: Record<string, number>;
  source: {
    kinds: ConnectorSourceKind[];
    geometry: { library: string; revision: string; rootFile: string; rootSha256: string | null; fileCount: number; integrity: string; licenceStatus: string } | null;
    connectorFiles: ConnectionSourceFile[];
    summary: ConnectorIngestion['sourceSummary'] | null;
  };
  source_digest: string | null; coverage: ConnectorCoverage;
  raw_parser_status: 'ready' | 'partial' | 'missing';
  unknown_interfaces: ConnectorIngestion['unknownInterfaces'];
  collision_geometry_status: 'ready' | 'blocked'; collision_geometry_reason: string;
  building_patterns_detected: ReturnType<typeof classifyBuildingPatterns>['patterns'];
  topology_diagnostics: ReturnType<typeof classifyBuildingPatterns>['diagnostics'];
  generation_eligible: boolean; supported_feature_count: number; enabled_source_endpoint_count: number;
  manual_verification_needed: boolean; review_reasons: string[];
  assembly_verified: false; physical_build_verified: false; diagnostics: ConnectorDiagnostic[];
}

/** Source/feature/solid inspection only. There is no placement solver, fixture
 * runner, part-pair table, trial generation or collision search in this audit. */
export async function buildConnectorLibraryAudit(service = new GrammarAssemblyService()) {
  await service.ready();
  const ids = await service.repository.listIds();
  const parts: ConnectorAuditPart[] = [];
  const coverage: Record<ConnectorCoverage, number> = { COMPLETE: 0, PARTIAL: 0, NONE: 0 };
  const familyDistribution = Object.fromEntries(CONNECTOR_FAMILIES.map(family => [family, { features: 0, parts: 0 }])) as Record<ConnectorFamily, { features: number; parts: number }>;
  const partialFeatureFamilies: Record<string, number> = {}, literalUnparsedFamilyHints: Record<string, number> = {};
  const uniqueSourceFiles = new Map<string, { library: string; path: string; revision: string; sha256: string; license: string; sourceUrl: string }>();
  let unclassifiedFeatures = 0;
  for (const id of ids) {
    const admission = await service.getGrammarAdmission(id), native = await service.repository.getPart(id);
    const ingestion = admission?.ingestion;
    const connectors = ingestion?.connectors ?? [];
    const families = countBy(connectors, feature => feature.family);
    for (const family of CONNECTOR_FAMILIES) {
      familyDistribution[family].features += families[family] ?? 0;
      if (families[family]) familyDistribution[family].parts++;
    }
    for (const connector of connectors) if (connector.coverage !== 'COMPLETE') {
      if (connector.unknownFields.includes('canonicalFamily')) unclassifiedFeatures++;
      else partialFeatureFamilies[connector.family] = (partialFeatureFamilies[connector.family] ?? 0) + 1;
    }
    for (const unknown of ingestion?.unknownInterfaces ?? []) if (unknown.familyHint) literalUnparsedFamilyHints[unknown.familyHint] = (literalUnparsedFamilyHints[unknown.familyHint] ?? 0) + 1;
    const topology = classifyBuildingPatterns(connectors);
    const partCoverage = ingestion?.coverage ?? 'NONE'; coverage[partCoverage]++;
    const sourceFiles = native?.connections.sourceFiles ?? [];
    for (const source of sourceFiles) uniqueSourceFiles.set(`${source.library}:${source.revision}:${source.path}:${source.sha256}`, source);
    const root = native?.geometry.source.files.find(file => file.path === native.geometry.source.rootFile);
    const reviewReasons = [...new Set([
      ...(admission?.reasonCodes ?? ['source-unavailable']),
      ...(ingestion?.unknownInterfaces.map(unknown => unknown.code) ?? []),
      ...topology.diagnostics.map(diagnostic => diagnostic.code),
    ])];
    const hasUnknown = !!ingestion?.unknownInterfaces.length || !!topology.diagnostics.length;
    parts.push({
      part_id: id, name: native?.geometry.name ?? null,
      geometry_ready: native?.geometry.status === 'geometryReady' && !!native.geometry.mesh,
      connector_count: connectors.length, connector_families: families,
      source: {
        kinds: [...new Set(connectors.flatMap(connector => connector.sources.map(source => source.kind)))].sort(),
        geometry: native ? { library: 'LDraw', revision: native.geometry.source.revision, rootFile: native.geometry.source.rootFile, rootSha256: root?.sha256 ?? null, fileCount: native.geometry.source.files.length, integrity: native.geometry.source.integrity, licenceStatus: native.geometry.source.licenseStatus } : null,
        connectorFiles: sourceFiles,
        summary: ingestion?.sourceSummary ?? null,
      },
      source_digest: admission?.sourceDigest ?? null,
      coverage: partCoverage,
      raw_parser_status: native?.connections.status ?? 'missing',
      unknown_interfaces: ingestion?.unknownInterfaces ?? [],
      collision_geometry_status: admission?.proxy.status ?? 'blocked',
      collision_geometry_reason: admission?.proxy.reasonCode ?? 'source-unavailable',
      building_patterns_detected: topology.patterns,
      topology_diagnostics: topology.diagnostics,
      generation_eligible: admission?.generationEligible ?? false,
      supported_feature_count: admission?.featureSupport.filter(feature => feature.supported).length ?? 0,
      enabled_source_endpoint_count: admission?.capability.allowedConnectionIds.length ?? 0,
      manual_verification_needed: !admission?.generationEligible || hasUnknown,
      review_reasons: reviewReasons,
      assembly_verified: false,
      physical_build_verified: false,
      diagnostics: ingestion?.diagnostics ?? [],
    });
  }
  const sourceKinds = ['LDCAD_SHADOW', 'LDRAW_PRIMITIVE', 'STUDIO_CONNECTIVITY', 'VERIFIED_MANUAL'] as const;
  return {
    schemaVersion: 1, generatedAt: new Date().toISOString(), branchBaseline: '35eec2067b4e9a711b65bd0199ac3bb5f89db636',
    versions: { connectorSchema: CONNECTOR_SCHEMA_VERSION, grammar: CONNECTOR_GRAMMAR_VERSION, admission: GRAMMAR_ADMISSION_VERSION,
      ingestion: CONNECTOR_INGESTION_VERSION, shadowParser: CONNECTION_PARSER_VERSION, patterns: BUILDING_PATTERN_VERSION, partLibrary: PART_LIBRARY_VERSION, collision: COLLISION_VERSION },
    scope: 'Current exact native roots; source-backed connectors, topology potential and source-derived eligibility. No part-pair trials or physical builds.',
    counting: 'Distinct native part IDs; colours do not multiply the part count.',
    summary: {
      totalParts: parts.length, canonicalCoverage: coverage,
      rawParserCoverage: countBy(parts, part => part.raw_parser_status),
      geometryReady: parts.filter(part => part.geometry_ready && part.source.geometry?.integrity === 'verified' && part.source.geometry.licenceStatus === 'complete').length,
      collisionGeometryReady: parts.filter(part => part.collision_geometry_status === 'ready').length,
      generationEligible: parts.filter(part => part.generation_eligible).length,
      supportedFeatures: parts.reduce((sum, part) => sum + part.supported_feature_count, 0),
      enabledSourceEndpoints: parts.reduce((sum, part) => sum + part.enabled_source_endpoint_count, 0),
      totalCanonicalFeatures: parts.reduce((sum, part) => sum + part.connector_count, 0),
      familyDistribution,
      partialFeatureCountsByRecognisedFamily: partialFeatureFamilies,
      unclassifiedCanonicalFeatureCount: unclassifiedFeatures,
      literalUnparsedFamilyHints,
      mostMissingConnectorFamily: null,
      missingFamilyExplanation: 'Absent/unclassified records do not establish which physical connector family is missing. Only literal source family hints and observed canonical families are counted; no missing family counts are guessed.',
      sourceCoverage: Object.fromEntries(sourceKinds.map(kind => [kind, {
        partsWithSourceFiles: parts.filter(part => (part.source.summary?.[kind].sourceFiles ?? 0) > 0).length,
        partsWithCanonicalFeatures: parts.filter(part => (part.source.summary?.[kind].features ?? 0) > 0).length,
        features: parts.reduce((sum, part) => sum + (part.source.summary?.[kind].features ?? 0), 0),
      }])),
      topologyPatternPartCounts: countBy(parts.flatMap(part => [...new Set(part.building_patterns_detected.map(pattern => pattern.kind))]), pattern => pattern),
      partsNeedingSourceOrAlgorithmReview: parts.filter(part => part.manual_verification_needed).length,
      executedPartPairTrials: 0, partFixtureTests: 0, physicalBuildsVerified: 0,
      historicalComparison: { baselineCommit: '35eec2067b4e9a711b65bd0199ac3bb5f89db636', fixtureQualifiedParts: 87,
        rawParserCoverage: { ready: 205, partial: 44, missing: 4 },
        note: 'The historical 87 fixture-qualified parts and current grammar eligibility are different proof categories, not an inherited or newly executed part-assembly PASS count.' },
    },
    limitations: [
      'COMPLETE/PARTIAL/NONE concern canonical source interpretation, not successful full-part assembly or physical certification.',
      'generationEligible is source/rule/solid readiness; each generated or uploaded complete model still requires the normal placement, multi-point and solid checks.',
      'Building patterns in this audit are topology potential only. No accepted joint or whole-assembly closure is supplied to the classifier.',
      'Studio source coverage is zero because no authorised Studio resource set is installed. Structured adapters do not invent Studio type mappings.',
      'manual_verification_needed means outstanding source or algorithm review, not a requirement to physically test every ordinary new part.',
      'Unparsed directives, scaling and ambiguous source types remain PARTIAL/UNKNOWN. No geometry, interface, tolerance or fit is manufactured.',
    ],
    sourceFiles: [...uniqueSourceFiles.values()].sort((a, b) => `${a.library}:${a.path}`.localeCompare(`${b.library}:${b.path}`)),
    parts,
  };
}

export async function connectorAuditMain(args = process.argv.slice(2)) {
  let output = path.join(ROOT, 'artifacts/connector-grammar');
  if (args.length) {
    if (args.length !== 2 || args[0] !== '--output') throw new Error('Usage: npm run audit:connectors -- [--output directory]');
    output = path.resolve(args[1]);
  }
  const report = await buildConnectorLibraryAudit();
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  const header = ['part_id', 'name', 'connector_count', 'connector_families', 'sources', 'coverage', 'raw_parser_status', 'unknown_interface_count', 'collision_geometry_status', 'collision_geometry_reason', 'building_patterns_detected', 'generation_eligible', 'manual_verification_needed', 'source_digest'];
  const rows = report.parts.map(part => [part.part_id, part.name, part.connector_count, JSON.stringify(part.connector_families), part.source.kinds.join(';'), part.coverage, part.raw_parser_status, part.unknown_interfaces.length,
    part.collision_geometry_status, part.collision_geometry_reason, [...new Set(part.building_patterns_detected.map(pattern => pattern.kind))].join(';'), part.generation_eligible, part.manual_verification_needed, part.source_digest]);
  await writeFile(path.join(output, 'parts.csv'), [header, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n');
  const summary = report.summary;
  const body = [
    '# 当前真实零件库 Connector Audit', '',
    '此报告读取真实固定来源与当前接口语法准入，不执行零件对遍历、试拼或生成夹具。颜色不重复计数。', '',
    `- 总零件：${summary.totalParts}；原生几何来源完整：${summary.geometryReady}。`,
    `- Canonical connector覆盖：COMPLETE ${summary.canonicalCoverage.COMPLETE} / PARTIAL ${summary.canonicalCoverage.PARTIAL} / NONE ${summary.canonicalCoverage.NONE}。`,
    `- 原始Shadow解析：ready ${summary.rawParserCoverage.ready ?? 0} / partial ${summary.rawParserCoverage.partial ?? 0} / missing ${summary.rawParserCoverage.missing ?? 0}。`,
    `- 可用碰撞实体：${summary.collisionGeometryReady}；当前grammar generationEligible：${summary.generationEligible}。`,
    `- Canonical features：${summary.totalCanonicalFeatures}；有规则依据的features：${summary.supportedFeatures}；生产开放原始端口：${summary.enabledSourceEndpoints}。`,
    `- 需要来源或算法审查的零件：${summary.partsNeedingSourceOrAlgorithmReview}。该数字不是实物测试清单。`,
    '- 零件对试拼：0；零件夹具测试：0；实物验证：0。', '',
    '## 计数不能混用', '',
    '历史87件是上一轮逐接口夹具证明口径；本报告的grammar资格来自真实来源、通用规则前提和可用实体表示，不能称为新增完整装配PASS。实际模型必须另行生成、整体校验、导出并重新导入。', '',
    '原始205/44/4统计语法读取结果；canonical覆盖还检查接口语义是否明确，因此数量不同。COMPLETE不代表全部机械自由度、配合或实物合法性均已验证。', '',
    '## 已观察接口族', '',
    '| Family | Features | Parts |', '| --- | ---: | ---: |',
    ...Object.entries(summary.familyDistribution).filter(([, count]) => count.features).map(([family, count]) => `| ${family} | ${count.features} | ${count.parts} |`), '',
    '## 未知与来源', '',
    `未分类canonical feature：${summary.unclassifiedCanonicalFeatureCount}。不能由未知记录猜测“缺失最多的接口族”；report.json保留明确的未解析family hint与识别族的部分覆盖数量。`, '',
    'LDCad原始行、变换、固定版本和SHA保留；LDraw primitive几何继承不被冒充额外连接真值。Studio授权资源覆盖为0，不从软件安装目录复制资源或猜原始type ID映射。', '',
    '每件详情见parts.csv与report.json：unknown_interfaces、collision_geometry_reason、来源/摘要、topology潜力、生产资格及审查原因均分开保存。大拓扑预算耗尽会明确诊断，不伪称已检查所有接口关系。', '',
    '## 复现', '', '```sh', 'npm run audit:connectors', '```', '',
    ...report.limitations.map(value => '- ' + value), '',
  ].join('\n');
  await writeFile(path.join(output, 'REPORT.md'), body);
  console.log(JSON.stringify({ output, totalParts: summary.totalParts, coverage: summary.canonicalCoverage, rawParserCoverage: summary.rawParserCoverage, generationEligible: summary.generationEligible,
    executedPartPairTrials: 0, physicalBuildsVerified: 0, files: ['report.json', 'parts.csv', 'REPORT.md'] }, null, 2));
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) connectorAuditMain().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
