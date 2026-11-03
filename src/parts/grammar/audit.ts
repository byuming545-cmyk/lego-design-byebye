import { GrammarAssemblyService } from '../grammar/service.js';
import { CONNECTOR_FAMILIES, CONNECTOR_GRAMMAR_VERSION, CONNECTOR_SCHEMA_VERSION, type ConnectorCoverage, type ConnectorFamily, type ConnectorSourceKind, type ConnectorDiagnostic } from '../grammar/schema.js';
import { CONNECTOR_INGESTION_VERSION, type ConnectorIngestion } from '../grammar/sources.js';
import { classifyBuildingPatterns, BUILDING_PATTERN_VERSION } from '../grammar/patterns.js';
import { GRAMMAR_ADMISSION_VERSION } from '../grammar/admission.js';
import { CONNECTION_PARSER_VERSION } from '../connections/importer.js';
import { PART_LIBRARY_VERSION } from '../assembly/source.js';
import { COLLISION_VERSION } from '../assembly/collision.js';
import type { ConnectionSourceFile } from '../connections/types.js';
const countBy = <T>(values: readonly T[], key: (value: T) => string) => values.reduce<Record<string, number>>((counts, value) => { const id = key(value); counts[id] = (counts[id] ?? 0) + 1; return counts; }, {});
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
    schemaVersion: 1, sourceSnapshot: service.repository.snapshotDigest, generatedAt: new Date().toISOString(), branchBaseline: '35eec2067b4e9a711b65bd0199ac3bb5f89db636',
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
