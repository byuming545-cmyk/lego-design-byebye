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

export { buildConnectorLibraryAudit } from '../parts/grammar/audit.js';
import { buildConnectorLibraryAudit } from '../parts/grammar/audit.js';

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
