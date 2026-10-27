import { createAssemblySourceLoader, loadStandardAssemblyFixtures } from './fixtures.js';
import { AttachmentEngine, ASSEMBLY_ENGINE_VERSION } from './engine.js';
import { NativePartRepository, PART_LIBRARY_VERSION } from './source.js';
import { CONNECTION_RULE_VERSION } from './compatibility.js';
import { COLLISION_VERSION } from './collision.js';
import { ASSEMBLY_MIGRATION_VERSION, batchFor, blockedCategory, verifyRepresentativePairs, type AssemblyMigrationEntry, type AssemblyMigrationReport } from './migration.js';
import { aggregatePhysicalInterfaceCoverage, buildPhysicalInterfaceCoverage, type PhysicalInterfaceDecision } from './coverage.js';
import { fingerprintAssemblyPart } from './verification.js';
import type { DeferredRunnerResult } from './deferredRunner.js';
import { INTERFACE_TEST_VERSION } from './deferredTypes.js';

export interface DeferredBaselineIndex {
  schemaVersion: number;
  entries: { partId: string; groups: { physicalInterfaceId: string; rawConnectionIds: string[]; signature: string; status: string }[] }[];
  counts: { discovered: number; verified: number; blocked: number; pending: number };
}

export async function buildDeferredMigrationReport(run: DeferredRunnerResult, baseline: DeferredBaselineIndex, repository: NativePartRepository): Promise<AssemblyMigrationReport & { beforeInterfaceCoverage: DeferredBaselineIndex['counts']; testVersion: string }> {
  const loader = await createAssemblySourceLoader(repository), fixtures = await loadStandardAssemblyFixtures(loader);
  if (run.parts.length !== loader.roots.length || loader.roots.some(root => !run.parts.some(part => part.partId === root.partId))) throw new Error('A publishable migration must retain every pinned native root. Partial filters are checkpoint-only.');
  const entries: AssemblyMigrationEntry[] = run.parts.map(result => {
    const root = loader.roots.find(root => root.partId === result.partId)!, part = result.part;
    const passed = result.records.filter(record => record.status === 'PASS');
    const allowedConnectionIds = passed.flatMap(record => record.rawConnectionIds);
    const fixtures = result.records.flatMap(record => record.proof ? [record.proof] : []);
    const sourceChecks = result.base?.sourceChecks ?? result.records.find(record => record.sourceChecks.length)?.sourceChecks ?? [{ name: 'source-integrity' as const, outcome: 'blocked' as const, reason: 'No current complete interface test evidence is available.' }];
    const decisions: PhysicalInterfaceDecision[] = result.records.map(({ proof: _proof, ...record }) => ({ physicalInterfaceId: record.physicalInterfaceId, rawConnectionIds: record.rawConnectionIds, status: record.status, reasonCodes: record.reasonCodes, reasons: record.reasons, attempts: record.attempts, ...(record.interrupted ? { interrupted: true } : {}) }));
    const coverage = buildPhysicalInterfaceCoverage(part, decisions, allowedConnectionIds);
    const assemblyVerified = passed.length > 0 && part.connections.status === 'ready' && part.geometry.status === 'geometryReady' && sourceChecks.every(check => check.outcome === 'passed');
    const codes = [...new Set(result.records.filter(record => record.status !== 'PASS').flatMap(record => record.reasonCodes))];
    const reasons = [...new Set(result.records.filter(record => record.status !== 'PASS').flatMap(record => record.reasons))];
    if (!passed.length && !codes.length) { codes.push('EVIDENCE_MISSING'); reasons.push('No recognizable source interface is available for current assembly qualification.'); }
    const batch = batchFor(root);
    const entry: AssemblyMigrationEntry = {
      partId: part.partId, name: part.geometry.name ?? root.name, status: assemblyVerified ? 'assemblyVerified' : 'blocked', geometryReady: part.geometry.status === 'geometryReady', connectionSourceStatus: part.connections.status,
      source: fingerprintAssemblyPart(part), scope: 'source-backed-tested-interfaces-only', assemblyVerified, generatable: assemblyVerified,
      allowedConnectionIds: assemblyVerified ? allowedConnectionIds : [], verifiedConnectionIds: allowedConnectionIds, disabledConnectionIds: part.connections.points.filter(point => !assemblyVerified || !allowedConnectionIds.includes(point.id)).map(point => point.id),
      capabilities: assemblyVerified ? ['source-stud-interface-assembly'] : [], wheelModuleVerified: false, physicalBuildVerified: false, sourceChecks,
      fixtures, fixtureTestsPassed: fixtures.flatMap(fixture => fixture.checks).filter(check => check.outcome === 'passed').length, fixtureTestsTotal: fixtures.reduce((sum, fixture) => sum + fixture.checks.length, 0), generatorSmokePassed: assemblyVerified,
      ruleIds: [...new Set(passed.flatMap(record => record.proof?.ruleId ? [record.proof.ruleId] : []))], reasonCodes: codes, reasons,
      interfaceBudget: null, physicalInterfaceCount: coverage.physicalInterfacesDiscovered, testedPhysicalInterfaceCount: result.records.filter(record => record.execution === 'direct-test').length,
      deferredPhysicalInterfaceCount: coverage.pending, deferredConnectionIds: result.records.filter(record => record.status === 'PENDING').flatMap(record => record.rawConnectionIds),
      interfaceCoverage: coverage, fullyAssemblyVerified: coverage.fullyAssemblyVerified, interfaceVerificationComplete: coverage.interfaceVerificationComplete, partiallyGeneratable: coverage.partiallyGeneratable,
      batch, selectionBasis: root.selectionBasis, blockedCategory: null,
    };
    entry.blockedCategory = blockedCategory(entry, batch);
    return entry;
  });
  const blockedReasons: AssemblyMigrationReport['blockedReasons'] = { geometry: 0, connection: 0, collision: 0, 'special-assembly': 0, other: 0 };
  for (const entry of entries) if (entry.blockedCategory) blockedReasons[entry.blockedCategory]++;
  const targets = new Set(baseline.entries.flatMap(entry => entry.groups.filter(group => group.status === 'PENDING').map(group => `${entry.partId}:${group.physicalInterfaceId}`)));
  const targetRecords = run.parts.flatMap(part => part.records.filter(record => targets.has(`${part.partId}:${record.physicalInterfaceId}`)));
  if (targetRecords.length !== targets.size) throw new Error('A baseline deferred interface is absent from the current explicit outcomes; refusing an incomplete report.');
  const countTargets = (status: string) => targetRecords.filter(record => record.status === status).length;
  const allRecords = run.parts.flatMap(part => part.records);
  return {
    schemaVersion: 1, migrationVersion: ASSEMBLY_MIGRATION_VERSION, partLibraryVersion: PART_LIBRARY_VERSION, assemblyEngineVersion: ASSEMBLY_ENGINE_VERSION, connectionRuleVersion: CONNECTION_RULE_VERSION, collisionVersion: COLLISION_VERSION,
    testVersion: INTERFACE_TEST_VERSION, generatedAt: new Date().toISOString(), scope: 'every-pinned-native-root', verificationScope: 'only-listed-connection-ids; no physical-build claim', interfaceBudget: null,
    sourceCounts: { totalRoots: entries.length, geometryReady: entries.filter(entry => entry.geometryReady).length, connectionReady: entries.filter(entry => entry.connectionSourceStatus === 'ready').length, connectionPartial: entries.filter(entry => entry.connectionSourceStatus === 'partial').length, connectionMissing: entries.filter(entry => entry.connectionSourceStatus === 'missing').length },
    counts: { total: entries.length, assemblyVerified: entries.filter(entry => entry.assemblyVerified).length, generatable: entries.filter(entry => entry.generatable).length, blocked: entries.filter(entry => !entry.assemblyVerified).length, verifiedInterfaces: entries.reduce((sum, entry) => sum + entry.verifiedConnectionIds.length, 0), disabledInterfaces: entries.reduce((sum, entry) => sum + entry.disabledConnectionIds.length, 0), testedPhysicalInterfaces: allRecords.filter(record => record.execution === 'direct-test').length, deferredPhysicalInterfaces: allRecords.filter(record => record.status === 'PENDING').length, deferredRawConnectionIds: allRecords.filter(record => record.status === 'PENDING').reduce((sum, record) => sum + record.rawConnectionIds.length, 0), wheelModulesVerified: 0, physicalBuildsVerified: 0 },
    blockedReasons, batches: [...new Set(entries.map(entry => entry.batch))].sort().map(batch => { const rows = entries.filter(entry => entry.batch === batch); return { batch, total: rows.length, assemblyVerified: rows.filter(entry => entry.assemblyVerified).length, generatable: rows.filter(entry => entry.generatable).length, blocked: rows.filter(entry => !entry.assemblyVerified).length }; }),
    fixtures: fixtures.map(fixture => ({ role: fixture.definition.role, partId: fixture.definition.partId, status: fixture.status, reason: fixture.reason })),
    representativePairs: await verifyRepresentativePairs(loader, new AttachmentEngine({ loadPart: id => repository.getPart(id), mode: 'verification' })), entries,
    interfaceCoverage: aggregatePhysicalInterfaceCoverage(entries.map(entry => entry.interfaceCoverage!)), beforeInterfaceCoverage: baseline.counts,
    deferredRun: { targetCount: targets.size, pass: countTargets('PASS'), blocked: countTargets('BLOCKED'), requiresAstraReview: countTargets('REQUIRES_ASTRA_REVIEW'), pending: countTargets('PENDING'), directTests: targetRecords.filter(record => record.execution === 'direct-test').length, sharedPrecondition: targetRecords.filter(record => record.execution === 'shared-source-precondition').length, reviewDependency: targetRecords.filter(record => record.execution === 'review-dependency').length, interrupted: run.interrupted, checkpointDirectory: run.checkpointDirectory, testVersion: INTERFACE_TEST_VERSION },
    limitations: ['Every interface decision is current-version, source-bound evidence or explicit review routing; no old PASS was relabelled for the new engine.', 'PASS/discovered is verified coverage; (PASS + BLOCKED + REQUIRES_ASTRA_REVIEW)/discovered is processed coverage.', 'Fully verified requires every recognizable physical frame/profile group to PASS. Terminal blocked/review outcomes only establish processing completeness.', 'Worker and per-part CPU limits route unresolved cases to review without asserting a collision failure.', 'No wheel, tyre, axle, clip or deformation rule was invented or relaxed. No physical build is claimed.'],
  };
}
