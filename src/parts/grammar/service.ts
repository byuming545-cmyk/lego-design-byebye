import { AssemblyService, type RuntimeAssemblyStatus, type AssemblyDefaultPair } from '../assembly/service.js';
import { NativePartRepository, PART_LIBRARY_VERSION } from '../assembly/source.js';
import type { AssemblyInterfaceCapability, NativeAssemblyPart } from '../assembly/types.js';
import type { AssemblyMigrationEntry, AssemblyMigrationReport } from '../assembly/migration.js';
import { ASSEMBLY_ENGINE_VERSION } from '../assembly/engine.js';
import { CONNECTION_RULE_VERSION } from '../assembly/compatibility.js';
import { COLLISION_VERSION } from '../assembly/collision.js';
import { fingerprintAssemblyPart } from '../assembly/verification.js';
import { buildPhysicalInterfaceCoverage, aggregatePhysicalInterfaceCoverage } from '../assembly/coverage.js';
import { CONNECTOR_GRAMMAR_VERSION } from './schema.js';
import { GRAMMAR_ADMISSION_VERSION, assessGrammarAdmission, type GrammarPartAdmission } from './admission.js';

export interface GrammarRuntimeStatus extends RuntimeAssemblyStatus {
  admissionBasis: 'interface-grammar';
  grammar: {
    schemaVersion: 1; grammarVersion: string; admissionVersion: string;
    counts: { total: number; sourceReady: number; connectable: number; collisionGeometryReady: number;
      generationEligible: number; supportedFeatures: number; enabledNativeEndpoints: number;
      historicalFixtureProofsRequired: 0; executedPartFixtureTests: 0; physicalBuildsVerified: 0 };
    coverage: { COMPLETE: number; PARTIAL: number; NONE: number };
    interpretation: string[];
  };
}
interface Root { partId: string; path: string; name: string; selectionBasis: string }

/**
 * Production service using source-derived grammar admission. The inherited
 * attachment, generation, model storage and upload paths still use the ordinary
 * AttachmentEngine; only the capability provider replaces pair-fixture memory.
 */
export class GrammarAssemblyService extends AssemblyService {
  private grammarPrepared?: Promise<void>;
  private readonly grammarEntries = new Map<string, AssemblyMigrationEntry>();
  private readonly grammarAdmissions = new Map<string, GrammarPartAdmission>();
  private readonly grammarSourceParts = new Map<string, NativeAssemblyPart>();
  private readonly grammarIssues: string[] = [];
  private grammarCheckedAt = '';

  constructor(options: { repository?: NativePartRepository; dataDir?: string } = {}) { super(options); }

  override ready(): Promise<void> { return this.grammarPrepared ??= this.initializeGrammar(); }

  private async initializeGrammar(): Promise<void> {
    this.grammarCheckedAt = new Date().toISOString();
    let roots: Root[];
    try { roots = (await this.repository.getManifest()).roots; }
    catch (error) { this.grammarIssues.push('Native source catalogue unavailable: ' + String(error).slice(0, 500)); return; }
    for (const root of roots) {
      let part: NativeAssemblyPart | undefined;
      let admission: GrammarPartAdmission | undefined;
      try {
        part = await this.repository.getPart(root.partId);
        if (part) {
          this.grammarSourceParts.set(root.partId, part);
          admission = assessGrammarAdmission(part);
          this.grammarAdmissions.set(root.partId, admission);
        }
      } catch (error) { this.grammarIssues.push(root.partId + ': current source admission failed: ' + String(error).slice(0, 500)); }
      this.grammarEntries.set(root.partId, this.makeEntry(root, part, admission));
    }
  }

  private makeEntry(root: Root, part?: NativeAssemblyPart, admission?: GrammarPartAdmission): AssemblyMigrationEntry {
    const capability: AssemblyInterfaceCapability = admission?.capability ?? {
      partId: root.partId, admissionBasis: 'interface-grammar', grammarVersion: CONNECTOR_GRAMMAR_VERSION,
      sourceReady: false, collisionGeometryReady: false, connectable: false,
      assemblyVerified: false, generatable: false, allowedConnectionIds: [], ruleIds: [],
      reasonCodes: ['grammar-source-unavailable'], reasons: ['The current original source could not be admitted.'],
    };
    const coverage = part ? buildPhysicalInterfaceCoverage(part, []) : undefined;
    const source = part ? fingerprintAssemblyPart(part) : {
      digest: '', geometryRevision: '', geometryRoot: root.path, geometryFiles: [], connectionFiles: [],
    };
    return {
      ...capability, status: capability.generatable ? 'grammarEligible' : 'blocked',
      name: part?.geometry.name ?? root.name, geometryReady: part?.geometry.status === 'geometryReady',
      connectionSourceStatus: part?.connections.status ?? 'missing', source,
      scope: 'source-backed-grammar-interfaces-only', verifiedConnectionIds: [],
      disabledConnectionIds: part?.connections.points.filter(point => !capability.allowedConnectionIds.includes(point.id)).map(point => point.id) ?? [],
      capabilities: capability.generatable ? ['source-backed-interface-grammar'] : [],
      wheelModuleVerified: false, physicalBuildVerified: false,
      sourceChecks: [
        { name: 'source-integrity', outcome: admission?.sourceReady ? 'passed' : 'blocked', reason: 'Source identity, original dependency hashes, licence and isolated connector interpretation are inspected.' },
        { name: 'collision', outcome: admission?.collisionGeometryReady ? 'passed' : 'blocked', reason: admission?.proxy.reason ?? 'Native solid collision geometry is unavailable.' },
      ],
      // No fabricated physical PASS or fixture is created by grammar admission.
      fixtures: [], fixtureTestsPassed: 0, fixtureTestsTotal: 0, generatorSmokePassed: false,
      interfaceBudget: null, physicalInterfaceCount: coverage?.physicalInterfacesDiscovered ?? 0,
      testedPhysicalInterfaceCount: 0, deferredPhysicalInterfaceCount: coverage?.physicalInterfacesDiscovered ?? 0,
      deferredConnectionIds: part?.connections.points.map(point => point.id) ?? [],
      fullyAssemblyVerified: false, interfaceVerificationComplete: false, partiallyGeneratable: false,
      ...(coverage ? { interfaceCoverage: coverage } : {}),
      batch: 'other-source-part', selectionBasis: root.selectionBasis,
      blockedCategory: capability.generatable ? null : !admission?.sourceReady ? 'connection' : !admission?.collisionGeometryReady ? 'collision' : 'special-assembly',
    };
  }

  override async getCapability(partId: string): Promise<AssemblyInterfaceCapability | undefined> {
    await this.ready();
    const entry = this.grammarEntries.get(partId);
    return entry ? structuredClone({
      partId: entry.partId, admissionBasis: 'interface-grammar' as const, grammarVersion: CONNECTOR_GRAMMAR_VERSION,
      sourceReady: entry.sourceReady, collisionGeometryReady: entry.collisionGeometryReady, connectable: entry.connectable,
      assemblyVerified: false, generatable: entry.generatable,
      allowedConnectionIds: entry.allowedConnectionIds, ruleIds: entry.ruleIds, reasonCodes: entry.reasonCodes, reasons: entry.reasons,
    }) : undefined;
  }
  override async getEntry(partId: string): Promise<AssemblyMigrationEntry | undefined> {
    await this.ready(); const entry = this.grammarEntries.get(partId); return entry ? structuredClone(entry) : undefined;
  }
  async getGrammarAdmission(partId: string): Promise<GrammarPartAdmission | undefined> {
    await this.ready(); const admission = this.grammarAdmissions.get(partId); return admission ? structuredClone(admission) : undefined;
  }

  private recommendDefaultPair(): AssemblyDefaultPair | undefined {
    // Family indexes choose a demonstrator; no pair table, collision trial,
    // inferred interface, part-ID branch or remembered test result is used.
    const eligible = [...this.grammarSourceParts.values()].filter(part => this.grammarEntries.get(part.partId)?.generatable);
    const volume = (part: NativeAssemblyPart) => {
      const bound = part.geometry.bounds!;
      return bound.min.reduce((value, min, axis) => value * (bound.max[axis] - min), 1);
    };
    eligible.sort((a, b) => volume(a) - volume(b) || a.partId.localeCompare(b.partId));
    let fixed: { part: NativeAssemblyPart; connectionId: string } | undefined;
    let moving: { part: NativeAssemblyPart; connectionId: string } | undefined;
    for (const part of eligible) {
      const allowed = new Set(this.grammarEntries.get(part.partId)!.allowedConnectionIds);
      for (const point of part.connections.points) {
        if (!allowed.has(point.id) || Math.abs(point.direction[0]) > 1e-6 || point.direction[1] > -0.999 || Math.abs(point.direction[2]) > 1e-6) continue;
        if (!fixed && point.gender === 'M') fixed = { part, connectionId: point.id };
        if (!moving && point.gender === 'F') moving = { part, connectionId: point.id };
      }
      if (fixed && moving) break;
    }
    return fixed && moving ? { partA: fixed.part.partId, connectionA: fixed.connectionId, partB: moving.part.partId, connectionB: moving.connectionId, twistDegrees: 0 } : undefined;
  }

  override async status(): Promise<GrammarRuntimeStatus> {
    await this.ready();
    const entries = [...this.grammarEntries.values()], admissions = [...this.grammarAdmissions.values()];
    const sum = (key: 'allowedConnectionIds' | 'disabledConnectionIds') => entries.reduce((count, entry) => count + entry[key].length, 0);
    const totalPhysical = entries.reduce((count, entry) => count + entry.physicalInterfaceCount, 0);
    const totalRaw = entries.reduce((count, entry) => count + entry.allowedConnectionIds.length + entry.disabledConnectionIds.length, 0);
    const eligible = entries.filter(entry => entry.generatable).length;
    const counts: AssemblyMigrationReport['counts'] = {
      total: entries.length, assemblyVerified: 0, generatable: eligible, blocked: entries.length - eligible,
      verifiedInterfaces: 0, disabledInterfaces: sum('disabledConnectionIds'), testedPhysicalInterfaces: 0,
      deferredPhysicalInterfaces: totalPhysical, deferredRawConnectionIds: totalRaw,
      wheelModulesVerified: 0, physicalBuildsVerified: 0,
    };
    const blockedReasons: AssemblyMigrationReport['blockedReasons'] = { geometry: 0, connection: 0, collision: 0, 'special-assembly': 0, other: 0 };
    for (const entry of entries) if (!entry.generatable) blockedReasons[entry.blockedCategory ?? 'other']++;
    const coverage = { COMPLETE: 0, PARTIAL: 0, NONE: 0 };
    for (const admission of admissions) coverage[admission.ingestion.coverage]++;
    coverage.NONE += entries.length - admissions.length;
    const defaultPair = this.recommendDefaultPair();
    return structuredClone({
      schemaVersion: 1, migrationVersion: GRAMMAR_ADMISSION_VERSION, testVersion: 'not-applicable-source-derived-admission',
      partLibraryVersion: PART_LIBRARY_VERSION, assemblyEngineVersion: ASSEMBLY_ENGINE_VERSION,
      connectionRuleVersion: CONNECTION_RULE_VERSION, collisionVersion: COLLISION_VERSION,
      generatedAt: this.grammarCheckedAt, scope: 'every-pinned-native-root',
      verificationScope: 'only-listed-connection-ids; no physical-build claim',
      interfaceBudget: null, admissionBasis: 'interface-grammar',
      sourceCounts: {
        totalRoots: entries.length, geometryReady: entries.filter(entry => entry.geometryReady).length,
        connectionReady: entries.filter(entry => entry.connectionSourceStatus === 'ready').length,
        connectionPartial: entries.filter(entry => entry.connectionSourceStatus === 'partial').length,
        connectionMissing: entries.filter(entry => entry.connectionSourceStatus === 'missing').length,
      },
      counts, blockedReasons, batches: [{ batch: 'other-source-part', total: entries.length, assemblyVerified: 0, generatable: eligible, blocked: entries.length - eligible }],
      fixtures: [], representativePairs: [], entries,
      queue: entries.map(entry => ({ ...entry, source: { ...entry.source, geometryFiles: [], connectionFiles: [] }, ...(entry.interfaceCoverage ? { interfaceCoverage: { ...entry.interfaceCoverage, decisions: [] } } : {}) })),
      interfaceCoverage: aggregatePhysicalInterfaceCoverage(entries.flatMap(entry => entry.interfaceCoverage ? [entry.interfaceCoverage] : [])),
      capabilities: await Promise.all(entries.map(entry => this.getCapability(entry.partId))) as AssemblyInterfaceCapability[],
      ...(defaultPair ? { defaultPair } : {}),
      physicalBuildVerified: false,
      limitations: [
        'Generation eligibility is derived from pinned source connectors, enabled reusable rules and reliable native collision geometry; no per-part mate fixture is required.',
        'Grammar eligibility is not an executed assembly PASS. Physical fixture counters remain zero; each generated or uploaded complete model is validated separately.',
        'Only C01 standard stud interfaces are enabled in the current native graph adapter. Other connector and joint families remain UNKNOWN or require their own sourced fit evidence.',
        'Mechanical stability, deformation, swept installation clearance and physical builds are not certified.',
      ],
      runtimeValidation: { status: this.grammarIssues.length ? 'partial' : 'ready', issues: [...this.grammarIssues], reportLoaded: false, checkedAt: this.grammarCheckedAt },
      grammar: {
        schemaVersion: 1, grammarVersion: CONNECTOR_GRAMMAR_VERSION, admissionVersion: GRAMMAR_ADMISSION_VERSION,
        counts: {
          total: entries.length, sourceReady: admissions.filter(admission => admission.sourceReady).length,
          connectable: admissions.filter(admission => admission.connectable).length,
          collisionGeometryReady: admissions.filter(admission => admission.collisionGeometryReady).length,
          generationEligible: eligible, supportedFeatures: admissions.reduce((count, admission) => count + admission.featureSupport.filter(feature => feature.supported).length, 0),
          enabledNativeEndpoints: sum('allowedConnectionIds'), historicalFixtureProofsRequired: 0, executedPartFixtureTests: 0, physicalBuildsVerified: 0,
        },
        coverage,
        interpretation: ['COMPLETE/PARTIAL/NONE describe source connector interpretation, not final assembly legality.', 'generationEligible does not mean every placement is legal or mechanically stable.'],
      },
    });
  }
}
