import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AssemblyService } from '../parts/assembly/service.js';
import { NativePartRepository } from '../parts/assembly/source.js';
import { checkConnectionCompatibility } from '../parts/assembly/compatibility.js';
import { createBundledElementDesignMapper } from '../parts/recovery/mapper.js';
import { adaptPdfInventories } from '../parts/inventory/index.js';
import { readFile } from 'node:fs/promises';
import { HANDOFF_ROOT, currentHandoffVersions, handoffPartFingerprint, replayAstraOperation, type AstraCase, type AstraCategory, type AstraReplay } from '../parts/handoff/cases.js';
import type { NativeAssemblyPart } from '../parts/assembly/types.js';
import type { InterfaceTestRecord } from '../parts/assembly/deferredTypes.js';

const repository = new NativePartRepository(), service = new AssemblyService({ repository });
const runtime = await service.status();
if (runtime.runtimeValidation.status !== 'ready') throw new Error('Build the current verified migration cache before creating the Astra handoff pack.');
const versions = currentHandoffVersions();
const savedReport = JSON.parse(await readFile('data/parts-foundation/assembly/migration.json', 'utf8')) as { interfaceTestArtifact?: { file: string; uncompressedSha256: string } };
if (!savedReport.interfaceTestArtifact || savedReport.interfaceTestArtifact.file !== 'artifacts/assembly-development/interface-tests.json.gz') throw new Error('The source-bound per-interface execution artifact is required for faithful Astra cases.');
const ledgerBytes = gunzipSync(await readFile(savedReport.interfaceTestArtifact.file), { maxOutputLength: 128 * 1024 * 1024 });
if (createHash('sha256').update(ledgerBytes).digest('hex') !== savedReport.interfaceTestArtifact.uncompressedSha256) throw new Error('The interface execution artifact hash differs from its runtime report.');
const testRecords = (JSON.parse(ledgerBytes.toString('utf8')) as { records: InterfaceTestRecord[] }).records;
const records: AstraCase[] = [];
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const nativeCategory = (codes: readonly string[]): AstraCategory => codes.some(code => /proxy|hollow|boundary|shell/.test(code)) ? 'HOLLOW_GEOMETRY' : codes.some(code => /collision|computation|partition/.test(code)) ? 'COMPLEX_COLLISION' : 'SPECIAL_MATING';

async function addCase(caseId: string, category: AstraCategory, replay: AstraReplay, context: { reason: string; attempts: string[]; evidence?: unknown[]; physicalIds?: string[]; elements?: string[] }) {
  const actual = await replayAstraOperation(replay, repository);
  const isolatedPass = replay.kind === 'fixture' && actual.status === 'PASS';
  const parts = await Promise.all([...new Set([replay.partId, replay.fixturePartId].filter((value): value is string => !!value))].map(id => repository.getPart(id)));
  const sourceFiles = parts.flatMap(part => part ? [...part.geometry.source.files.map(file => `data/parts-foundation/ldraw/files/${file.path}`), ...part.connections.sourceFiles.filter(file => file.library === 'LDCadShadowLibrary').map(file => `data/parts-foundation/shadow/files/${file.path}`)] : []);
  records.push({
    schemaVersion: 1, caseId, category: isolatedPass ? 'VERIFICATION_BUDGET' : category, versions, affectedParts: parts.filter((part): part is NativeAssemblyPart => !!part).map(handoffPartFingerprint),
    ...(context.elements ? { affectedElements: context.elements } : {}), ...(context.physicalIds ? { affectedPhysicalInterfaces: context.physicalIds } : {}),
    connections: actual.connections, currentTransform: actual.transform,
    transformStatus: replay.kind === 'mapping' ? 'NOT_APPLICABLE' : replay.kind === 'proxy' ? 'SOURCE_IDENTITY' : actual.transform ? 'SOLVED_CANDIDATE' : 'UNRESOLVED',
    expectedBehavior: { status: 'EXPECTED_UNKNOWN', explanation: 'No independent physical-build proof is available. Resolve the source, rule or geometric evidence before declaring this arrangement valid.' },
    actualBehavior: { status: actual.status, reasonCodes: actual.reasonCodes, details: actual.details }, replay,
    reproductionCommand: `npm run astra:case -- ${caseId}`, relevantSourceFiles: [...new Set(sourceFiles)],
    relevantTests: replay.kind === 'mapping' ? ['tests/parts-recovery.test.ts'] : replay.kind === 'parse' ? ['tests/parts-connections.test.ts'] : ['tests/parts-assembly-collision.test.ts', 'tests/parts-assembly-multipoint.test.ts'],
    evidence: context.evidence ?? [], attemptsAlreadyMade: context.attempts,
    whySolStopped: isolatedPass ? 'The original run routed this group without direct testing under its scheduling budget. This isolated representative now passes; no geometric failure is asserted. The other linked interfaces still need individual source-bound tests, and this diagnostic does not publish production permissions.' : context.reason,
    diagnosticOnly: true,
    ...(replay.kind === 'fixture' ? { fixtureTestContext: (actual.details as InterfaceTestRecord).context } : {}),
  });
}
async function interfaceReplay(part: NativeAssemblyPart, connectionId: string): Promise<AstraReplay | null> {
  const point = part.connections.points.find(value => value.id === connectionId);
  const fixture = await repository.getPart('3005');
  if (!point || !fixture) return null;
  const compatible = fixture.connections.points.find(mate => checkConnectionCompatibility(point, mate).status === 'compatible');
  const mate = compatible ?? fixture.connections.points.find(mate => mate.gender !== point.gender);
  return mate ? { kind: 'interface', partId: part.partId, connectionId: point.id, fixturePartId: fixture.partId, fixtureConnectionId: mate.id } : null;
}

for (const entry of runtime.entries) {
  const part = await repository.getPart(entry.partId);
  if (!part) continue;
  if (!entry.assemblyVerified) {
    const witness = testRecords.find(record => record.partId === part.partId && record.execution === 'direct-test' && record.status !== 'PASS');
    const replay: AstraReplay | null = part.connections.status !== 'ready' ? { kind: 'parse', partId: part.partId }
      : entry.reasonCodes.some(code => /proxy|boundary|shell/.test(code)) ? { kind: 'proxy', partId: part.partId }
      : witness ? { kind: 'fixture', partId: part.partId, physicalInterfaceId: witness.physicalInterfaceId, timeoutMs: 8000 } : { kind: 'parse', partId: part.partId };
    if (replay) await addCase(`PART-${part.partId.toUpperCase()}`, replay.kind === 'parse' ? 'CONNECTION_PARSE' : nativeCategory(entry.reasonCodes), replay, {
      reason: 'Further progress requires missing source semantics or complex solid/retention rules; no ad hoc geometry or collision exception was introduced.',
      attempts: ['Loaded and fingerprinted the actual pinned native source.', 'Ran the current per-part migration source/fixture prerequisites.'],
      evidence: [{ reasonCodes: entry.reasonCodes, reasons: entry.reasons, sourceChecks: entry.sourceChecks }],
      physicalIds: entry.interfaceCoverage?.decisions.filter(decision => decision.status === 'REQUIRES_ASTRA_REVIEW').map(decision => decision.physicalInterfaceId),
    });
  }
  const grouped = new Map<string, NonNullable<typeof entry.interfaceCoverage>['decisions']>();
  for (const decision of entry.interfaceCoverage?.decisions ?? []) if (decision.status === 'REQUIRES_ASTRA_REVIEW') {
    const key = decision.reasonCodes.join('|'); const values = grouped.get(key) ?? []; values.push(decision); grouped.set(key, values);
  }
  for (const [reason, decisions] of grouped) {
    if (!entry.assemblyVerified) continue; // Already linked to the source prerequisite case above.
    const first = decisions[0];
    const original = testRecords.find(record => record.partId === part.partId && decisions.some(decision => decision.physicalInterfaceId === record.physicalInterfaceId) && record.execution === 'direct-test' && record.status !== 'PASS')
      ?? testRecords.find(record => record.partId === part.partId && record.execution === 'direct-test' && record.status !== 'PASS' && testRecords.some(dependency => dependency.partId === part.partId && decisions.some(decision => decision.physicalInterfaceId === dependency.physicalInterfaceId) && dependency.relatedCaseIds.includes(record.caseId)))
      ?? testRecords.find(record => record.partId === part.partId && record.physicalInterfaceId === first.physicalInterfaceId);
    const attempted = original?.proof?.lastAttempt;
    const replay: AstraReplay = attempted?.stage === 'collision' && attempted.transform ? { kind: 'interface', partId: part.partId, connectionId: original!.proof!.connectionId, fixturePartId: attempted.fixturePartId, fixtureConnectionId: attempted.fixtureConnectionId, ...(attempted.twistDeg === null ? {} : { twistDegrees: attempted.twistDeg }) }
      : { kind: 'fixture', partId: part.partId, physicalInterfaceId: original?.physicalInterfaceId ?? first.physicalInterfaceId, timeoutMs: 8000 };
    if (replay) await addCase(`PORT-${part.partId.toUpperCase()}-${hash(reason).slice(0, 10).toUpperCase()}`, nativeCategory(first.reasonCodes), replay, {
      reason: 'A bounded ordinary-interface fixture could not be certified; the related ports remain disabled and require review of the recorded shared dependency.',
      attempts: ['Applied the existing source-backed stud rule.', 'Used bounded fixture tests and the recorded retry policy without changing collision rules.'],
      evidence: [{ originalExecution: original }, ...decisions.map(decision => ({ physicalInterfaceId: decision.physicalInterfaceId, rawConnectionIds: decision.rawConnectionIds, reasonCodes: decision.reasonCodes, reasons: decision.reasons, attempts: decision.attempts }))],
      physicalIds: decisions.map(decision => decision.physicalInterfaceId),
    });
  }
}

// Explicit automotive-critical source pairs. These are diagnostics, never new mechanical permissions.
for (const replay of [
  { kind: 'interface' as const, partId: '3020', connectionId: 'p/stud.dat:8:0', fixturePartId: '3710', fixtureConnectionId: 'parts/3710.dat:8:7', twistDegrees: 180 },
]) {
  const part = await repository.getPart(replay.partId), mate = await repository.getPart(replay.fixturePartId);
  if (!part?.connections.points.some(point => point.id === replay.connectionId) || !mate?.connections.points.some(point => point.id === replay.fixtureConnectionId)) continue;
  await addCase(`MULTI-${replay.partId}-${replay.fixturePartId}`, 'COMPLEX_COLLISION', replay, { reason: 'Source-coordinate multi-point alignment does not establish complete native solid clearance. Complex partition redesign is reserved for Astra.', attempts: ['Checked the shared rigid source transform and all coincident source mates.', 'Retained the actual bounded native collision result.'] });
}
for (const definition of [
  { id: 'WHEEL-TYRE', a: '4624', b: '3641', family: 'wheelMount', category: 'WHEEL_ASSEMBLY' as const },
  { id: 'WHEEL-HOLDER', a: '4600', b: '4624', family: 'wheelMount', category: 'WHEEL_ASSEMBLY' as const },
  { id: 'CLIP-BAR', a: '48729b', b: '30374', family: 'clip', category: 'CLIP_BAR' as const },
  { id: 'PIN-HOLE', a: '3700', b: '3673', family: 'pinHole', category: 'AXLE_HOLE' as const },
]) {
  const a = await repository.getPart(definition.a), b = await repository.getPart(definition.b);
  const point = a?.connections.points.find(point => point.family === definition.family) ?? a?.connections.points[0];
  const mate = b?.connections.points.find(mate => mate.gender !== point?.gender) ?? b?.connections.points[0];
  if (a && b && point && mate) await addCase(definition.id, definition.category, { kind: 'interface', partId: a.partId, connectionId: point.id, fixturePartId: b.partId, fixtureConnectionId: mate.id }, { reason: 'The current standard stud rule has no verified insertion/retention/elasticity semantics for this special interface.', attempts: ['Read the exact imported source endpoint sections and frames.', 'Kept compatibilityUnknown; did not create a mechanical mating rule.'] });
}

const inventories = adaptPdfInventories(JSON.parse(await readFile('data/parts-foundation/instructions/inventories.json', 'utf8')), new Date().toISOString());
const mapper = await createBundledElementDesignMapper(), mappingGroups = new Map<string, string[]>();
for (const elementId of new Set(inventories.flatMap(inventory => inventory.items.flatMap(row => row.elementId ? [row.elementId] : [])))) {
  const mapping = mapper.resolve(elementId); if (mapping.mappingStatus === 'VERIFIED') continue;
  const key = JSON.stringify([mapping.partId, mapping.designId, mapping.mappingStatus]); const ids = mappingGroups.get(key) ?? []; ids.push(elementId); mappingGroups.set(key, ids);
}
for (const [key, elements] of mappingGroups) {
  const mapping = mapper.resolve(elements[0]), caseId = `MAP-${hash(key).slice(0, 14).toUpperCase()}`;
  await addCase(caseId, mapping.mappingStatus === 'CONFLICT' ? 'MAPPING_CONFLICT' : 'MAPPING_EVIDENCE_MISSING', { kind: 'mapping', elementId: elements[0] }, {
    reason: 'The exact LDraw mold/print/component identity chain is not verified; names, numeric equality and missing local alternatives cannot resolve it.',
    attempts: ['Preserved explicit Element / LEGO Design / Rebrickable identities and colour facts.', 'Reviewed the fixed explicit cross-reference evidence and retained all conflicting candidates.'], evidence: [mapping], elements,
  });
  records.at(-1)!.affectedParts = [{ partId: mapping.partId ?? `element:${elements[0]}`, ldrawId: null, identitySystem: 'rebrickable', sourceDigest: mapping.source?.sha256 ?? null, geometryHash: null, connectionMetadataHash: null }];
  records.at(-1)!.mappingSourceFingerprint = mapper.getSourceFingerprint();
  records.at(-1)!.relevantSourceFiles = ['data/parts-foundation/mappings/manifest.json', 'data/parts-foundation/mappings/element-rows.json', 'data/parts-foundation/mappings/ldraw-mapping-review.json'];
}
await mkdir(HANDOFF_ROOT, { recursive: true });
const manifest: { caseId: string; category: AstraCategory; path: string; sha256: string; affectedParts: string[]; reason: string; reproductionCommand: string }[] = [];
for (const record of records.sort((a, b) => a.caseId.localeCompare(b.caseId))) {
  const directory = record.category.startsWith('MAPPING') ? 'unresolved-mapping' : record.category.includes('WHEEL') ? 'wheel-system' : ['COMPLEX_COLLISION', 'HOLLOW_GEOMETRY'].includes(record.category) ? 'complex-collision' : 'special-mating';
  const relative = `${directory}/${record.caseId}/case.json`, text = JSON.stringify(record, null, 2) + '\n';
  await mkdir(path.dirname(path.join(HANDOFF_ROOT, relative)), { recursive: true }); await writeFile(path.join(HANDOFF_ROOT, relative), text);
  manifest.push({ caseId: record.caseId, category: record.category, path: relative, sha256: createHash('sha256').update(text).digest('hex'), affectedParts: record.affectedParts.map(part => part.partId), reason: record.whySolStopped, reproductionCommand: record.reproductionCommand });
}
await writeFile(path.join(HANDOFF_ROOT, 'manifest.json'), JSON.stringify({ schemaVersion: 1, versions, generatedAt: new Date().toISOString(), diagnosticOnly: true, counts: { cases: records.length, affectedInstructionElements: new Set(records.flatMap(record => record.affectedElements ?? [])).size, affectedPhysicalInterfaces: new Set(records.flatMap(record => record.affectedPhysicalInterfaces ?? [])).size }, categories: Object.fromEntries([...new Set(records.map(record => record.category))].sort().map(category => [category, records.filter(record => record.category === category).length])), cases: manifest }, null, 2) + '\n');
const csv = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
await writeFile(path.join(HANDOFF_ROOT, 'cases.csv'), [['caseId', 'category', 'affectedParts', 'reason', 'reproductionCommand', 'caseFile'].join(','), ...manifest.map(record => [record.caseId, record.category, record.affectedParts.join(' + '), record.reason, record.reproductionCommand, record.path].map(csv).join(','))].join('\r\n') + '\r\n');
await writeFile(path.join(HANDOFF_ROOT, 'README.md'), '# Astra Handoff Pack\n\n每个案例绑定当前四版本及实际源哈希。所有预期物理结果保留 EXPECTED_UNKNOWN；诊断输出不授予生产生成资格。\n\n运行 `npm run astra:case -- CASE_ID`，例如 `npm run astra:case -- WHEEL-TYRE`；附加 `--debug` 可导出原生调试场景。退出 0 表示重现记录的问题，2 表示当前结果与记录不同。源版本或文件变化会拒绝复用旧案例。\n\n映射案例按同一外部 part/design/状态归组，保留全部受影响 Element。接口案例列出关联的物理接口，direct-test 与 review-dependency 以迁移报告为准，不把共享前置阻塞说成已通过实际插接测试。\n\n优先级：1. MULTI-3020-3710 的多点纵向加强碰撞；2. WHEEL-TYRE / WHEEL-HOLDER 的有来源配合规则；3. 映射冲突和普通解析缺证。不要按名称、相同编号或期望造几何/机械公差。\n');
console.info(JSON.stringify({ directory: HANDOFF_ROOT, cases: records.length, categories: [...new Set(records.map(record => record.category))], versions }, null, 2));
