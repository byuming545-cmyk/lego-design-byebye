import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { RealPartRegistry } from '../parts/registry.js';

const csv = (rows: readonly (readonly unknown[])[]) => rows.map(row => row.map(value => {
  if (value === null || value === undefined) return '';
  const text = Array.isArray(value) ? value.join(' + ') : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}).join(',')).join('\r\n') + '\r\n';

async function optionalArtifact(filename: string): Promise<unknown | null> {
  try {
    const bytes = await readFile(filename);
    if (bytes.length > 6 * 1024 * 1024) throw new Error('Related report artifact exceeds its limit.');
    return JSON.parse(bytes.toString('utf8'));
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length && (args[0] !== '--output' || args.length !== 2 || !args[1])) throw new Error('Usage: npm run report:parts -- [--output directory]');
  const directory = path.resolve(args[1] ?? 'artifacts/parts-foundation');
  const registry = new RealPartRegistry();
  const status = await registry.status();
  const [parts, assembly, recovery, coverage] = await Promise.all([
    registry.list(), registry.assemblyService.status(), registry.recovery(), registry.instructionCoverage(),
  ]);
  const geometryCategories = Object.fromEntries([...new Set(parts.filter(part => part.identitySystem === 'ldraw').map(part => part.category ?? 'Other'))].sort().map(category => [category, parts.filter(part => part.identitySystem === 'ldraw' && (part.category ?? 'Other') === category).length]));
  const versions = {
    partLibraryVersion: assembly.partLibraryVersion, assemblyEngineVersion: assembly.assemblyEngineVersion,
    connectionRuleVersion: assembly.connectionRuleVersion, collisionVersion: assembly.collisionVersion,
  };
  const nativeParts = parts.filter(part => part.identitySystem === 'ldraw');
  const proxyReadiness = {
    nativeRoots: nativeParts.length, ready: nativeParts.filter(part => part.collisionReady).length,
    blocked: nativeParts.filter(part => !part.collisionReady).length,
    basis: 'source-derived native collision proxy; not assembly or generator approval',
  };
  const generatorSmoke = await optionalArtifact('artifacts/assembly-development/generator-smoke.json');
  const report = {
    ...status, geometryCategories, versions, proxyReadiness, generatorSmoke,
    reportNotes: [
      'Native root assembly decisions, documentary elements and proxy readiness have different denominators.',
      'Only allowlisted, source-bound, tested interfaces can participate in production assembly. Untested and budget-deferred interfaces remain disabled.',
      assembly.runtimeValidation.reportLoaded ? `Active per-part physical interface budget: ${assembly.interfaceBudget ?? 'exhaustive'}; a successful part flag is not approval of every port.` : 'No valid saved migration report was loaded; production assembly capabilities remain blocked.',
      '531 source-observed mirror mappings are not independent official/API verification or LDraw cross-reference proof.',
      'No physical build, manufactured tolerance, deformation fit or full swept-body insertion certification is claimed.',
      'Frequency denominators include only available source observations; missing appendices have unknown coverage.',
    ],
  };
  await mkdir(directory, { recursive: true });
  const writeJson = (name: string, value: unknown) => writeFile(path.join(directory, name), JSON.stringify(value, null, 2) + '\n');
  await writeJson('report.json', report);
  await writeJson('assembly-runtime-summary.json', {
    schemaVersion: 1, ...versions, generatedAt: assembly.generatedAt, runtimeValidation: assembly.runtimeValidation,
    scope: assembly.scope, verificationScope: assembly.verificationScope, interfaceBudget: assembly.interfaceBudget,
    counts: assembly.counts, sourceCounts: assembly.sourceCounts, proxyReadiness, blockedReasons: assembly.blockedReasons,
    interfaceCoverage: assembly.interfaceCoverage, deferredRun: assembly.deferredRun,
    batches: assembly.batches, fixtures: assembly.fixtures, representativePairs: assembly.representativePairs,
    runtimeReport: 'data/parts-foundation/assembly/migration.json', fullProofArtifact: 'artifacts/assembly-development/migration-full.json.gz',
    limitations: assembly.limitations,
  });
  await writeFile(path.join(directory, 'assembly-migration.csv'), csv([
    ['partId', 'name', 'status', 'geometryReady', 'connectionSourceStatus', 'assemblyVerified', 'generatable', 'enabledSourceIds', 'disabledSourceIds', 'interfaceBudget', 'physicalInterfaces', 'testedPhysicalInterfaces', 'deferredPhysicalInterfaces', 'fixtureChecksPassed', 'fixtureChecksTotal', 'sourceDigest', 'reasonCodes', 'reasons'],
    ...assembly.entries.map(entry => [entry.partId, entry.name, entry.status, entry.geometryReady, entry.connectionSourceStatus, entry.assemblyVerified, entry.generatable, entry.allowedConnectionIds.length, entry.disabledConnectionIds.length, entry.interfaceBudget, entry.physicalInterfaceCount, entry.testedPhysicalInterfaceCount, entry.deferredPhysicalInterfaceCount, entry.fixtureTestsPassed, entry.fixtureTestsTotal, entry.source.digest, entry.reasonCodes, entry.reasons]),
  ]));
  await writeJson('interface-coverage.json', { schemaVersion: 1, ...versions, runtimeValidation: assembly.runtimeValidation, countBasis: 'Source-frame/profile physical-interface groups, distinct from conservative graph occupancy locations.', interfaceCoverage: assembly.interfaceCoverage, deferredRun: assembly.deferredRun, parts: assembly.entries.map(entry => ({ partId: entry.partId, assemblyVerified: entry.assemblyVerified, generatable: entry.generatable, interfaceCoverage: entry.interfaceCoverage })) });
  await writeFile(path.join(directory, 'interface-coverage.csv'), csv([
    ['partId', 'rawSourceConnectionRecords', 'logicalConnectionGroups', 'physicalInterfacesDiscovered', 'verifiedPass', 'verifiedBlocked', 'requiresAstraReview', 'pending', 'enabledRawConnectionIds', 'enabledPhysicalInterfaces', 'verifiedCoveragePercent', 'processedCoveragePercent', 'fullyAssemblyVerified', 'partiallyGeneratable', 'interfaceVerificationComplete'],
    ...assembly.entries.map(entry => { const coverage = entry.interfaceCoverage; return [entry.partId, coverage?.rawSourceConnectionRecords, coverage?.logicalConnectionGroups, coverage?.physicalInterfacesDiscovered, coverage?.verifiedPass, coverage?.verifiedBlocked, coverage?.requiresAstraReview, coverage?.pending, coverage?.enabledRawConnectionIds, coverage?.enabledPhysicalInterfaces, coverage?.verifiedCoveragePercent, coverage?.processedCoveragePercent, coverage?.fullyAssemblyVerified, coverage?.partiallyGeneratable, coverage?.interfaceVerificationComplete]; }),
  ]));
  await writeJson('failed-part-recovery.json', recovery);
  await writeFile(path.join(directory, 'failed-part-recovery.csv'), csv([
    ['elementId', 'mappingStatus', 'mappingTrust', 'partIdSystem', 'partId', 'designId', 'colorId', 'colorName', 'ldrawPartId', 'assemblyVerified', 'generatable', 'blockedCategory', 'reasonCodes', 'distinctObservedSets', 'observedQuantity'],
    ...recovery.entries.map(entry => [entry.elementId, entry.mapping.status, entry.mapping.source?.trust, entry.mapping.partIdSystem, entry.mapping.partId, entry.mapping.designId, entry.mapping.color?.id, entry.mapping.color?.name, entry.mapping.ldrawPartId, entry.assemblyVerified, entry.generatable, entry.blockedCategory, entry.reasonCodes, entry.distinctObservedSets, entry.observedQuantity]),
  ]));
  await writeJson('instruction-coverage.json', coverage);
  const coverageRows = [...coverage.documents.map(row => ({ ...row, scope: 'document', id: row.documentId })), ...coverage.sets.map(row => ({ ...row, scope: 'set', id: row.setNumber, fileName: '', sourceStatus: '' }))];
  await writeFile(path.join(directory, 'instruction-coverage.csv'), csv([
    ['scope', 'id', 'fileName', 'sourceStatus', 'coverageStatus', 'observedElementDenominator', 'mapped', 'mappedPercent', 'resolvedLDraw', 'geometryReady', 'connectionReady', 'assemblyVerified', 'assemblyVerifiedPercent', 'generatable', 'generatablePercent', 'unresolved', 'unresolvedPercent', 'inventoryComplete'],
    ...coverageRows.map(row => [row.scope, row.id, row.fileName, row.sourceStatus, row.coverageStatus, row.denominator, row.counts.mapped, row.percentages.mapped, row.counts.resolvedLDraw, row.counts.geometryReady, row.counts.connectionReady, row.counts.assemblyVerified, row.percentages.assemblyVerified, row.counts.generatable, row.percentages.generatable, row.counts.unresolved, row.percentages.unresolved, row.inventoryComplete]),
  ]));
  const frequencyHeader = ['rank', 'identitySystem', 'elementId', 'distinctSets', 'observedQuantity', 'knownNonSpareQuantity', 'spareUnknownQuantity', 'setNumbers', 'sourceIds', 'mappingStatus', 'mappingTrust', 'partId', 'designId', 'colorId', 'ldrawPartId'];
  const frequency = await Promise.all(status.elementRanking.map(async row => {
    const mapping = await registry.elementMapping(row.identity.id);
    return { mapping, cells: [row.rank, row.identity.system, row.identity.id, row.distinctSetCount, row.observedQuantity, row.knownNonSpareQuantity, row.spareUnknownQuantity, row.setNumbers, row.sourceIds, mapping.status, mapping.source?.trust, mapping.partId, mapping.designId, mapping.color?.id, mapping.ldrawPartId] };
  }));
  await writeFile(path.join(directory, 'element-frequency.csv'), csv([frequencyHeader, ...frequency.map(row => row.cells)]));
  // Keep the historical filename accurate after mapping recovery: completed mappings are excluded.
  await writeFile(path.join(directory, 'next-50-element-mapping-targets.csv'), csv([frequencyHeader, ...frequency.filter(row => row.mapping.status !== 'mapped').slice(0, 50).map(row => row.cells)]));
  await writeFile(path.join(directory, 'next-50-ldraw-cross-reference-targets.csv'), csv([frequencyHeader, ...frequency.filter(row => row.mapping.status === 'mapped' && !row.mapping.ldrawPartId).slice(0, 50).map(row => row.cells)]));
  await writeJson('next-design-parts.json', status.nextPriority);
  console.info(JSON.stringify({ directory, version: status.version, counts: status.counts, assembly: assembly.counts, runtimeValidation: assembly.runtimeValidation, mapping: status.elementMapping, recovery: recovery.counts, observedInventorySets: status.mining.actualSetDenominator, elementIdentities: status.elementRanking.length, unresolvedMappingTargets: frequency.filter(row => row.mapping.status !== 'mapped').length, ldrawCrossReferenceTargets: frequency.filter(row => row.mapping.status === 'mapped' && !row.mapping.ldrawPartId).length, versions }, null, 2));
  if (assembly.runtimeValidation.status !== 'ready') process.exitCode = 2;
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Unable to create source report.'); process.exitCode = 1; });
