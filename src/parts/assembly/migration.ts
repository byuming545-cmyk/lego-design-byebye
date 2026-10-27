import { createHash } from 'node:crypto';
import { AUTOMOTIVE_ASSEMBLY_PAIR_FIXTURES, createAssemblySourceLoader, loadStandardAssemblyFixtures, type AssemblySourceLoader, type AssemblySourceRoot } from './fixtures.js';
import { fingerprintAssemblyPart, verifyAssemblyConnectionWithFixtures, verifyNativePartAssembly, type AssemblyVerificationEngine, type ConnectionFixtureVerification, type NativePartAssemblyVerification } from './verification.js';
import type { AssemblyInterfaceCapability, NativeAssemblyPart } from './types.js';
import { ASSEMBLY_ENGINE_VERSION } from './engine.js';
import { CONNECTION_RULE_VERSION } from './compatibility.js';
import { COLLISION_VERSION } from './collision.js';
import type { aggregatePhysicalInterfaceCoverage } from './coverage.js';
import { INTERFACE_TEST_VERSION } from './deferredTypes.js';

export const ASSEMBLY_MIGRATION_VERSION = 'native-assembly-migration-1';
export type AssemblyMigrationBatch = '1-basic-brick-plate-tile' | '2-modified-bracket-snot' | '3-slope-curved-wedge' | '4-body-windscreen-mudguard' | '5-wheel-tyre-axle' | '6-bar-clip-detail' | 'other-source-part';
export interface AssemblyMigrationEntry extends NativePartAssemblyVerification {
  batch: AssemblyMigrationBatch;
  selectionBasis: string;
  blockedCategory: 'geometry' | 'connection' | 'collision' | 'special-assembly' | 'other' | null;
}
export interface AssemblyMigrationReport {
  interfaceCoverage?: ReturnType<typeof aggregatePhysicalInterfaceCoverage>;
  deferredRun?: { targetCount: number; pass: number; blocked: number; requiresAstraReview: number; pending: number; directTests: number; sharedPrecondition: number; reviewDependency: number; interrupted: boolean; checkpointDirectory: string; testVersion: string };
  schemaVersion: 1;
  migrationVersion: string;
  /** Qualifications are valid only for the verification suite which produced them. */
  testVersion: string;
  partLibraryVersion: string;
  assemblyEngineVersion: string;
  connectionRuleVersion: string;
  collisionVersion: string;
  generatedAt: string;
  scope: 'every-pinned-native-root';
  verificationScope: 'only-listed-connection-ids; no physical-build claim';
  interfaceBudget: number | null;
  sourceCounts: { totalRoots: number; geometryReady: number; connectionReady: number; connectionPartial: number; connectionMissing: number };
  counts: { total: number; assemblyVerified: number; generatable: number; blocked: number; verifiedInterfaces: number; disabledInterfaces: number; testedPhysicalInterfaces: number; deferredPhysicalInterfaces: number; deferredRawConnectionIds: number; wheelModulesVerified: 0; physicalBuildsVerified: 0 };
  blockedReasons: Record<'geometry' | 'connection' | 'collision' | 'special-assembly' | 'other', number>;
  batches: { batch: AssemblyMigrationBatch; total: number; assemblyVerified: number; generatable: number; blocked: number }[];
  fixtures: { role: string; partId: string | null; status: string; reason: string }[];
  representativePairs: RepresentativePairVerification[];
  entries: AssemblyMigrationEntry[];
  limitations: string[];
}
export interface RepresentativePairVerification {
  id: string;
  label: string;
  fixedPartId: string;
  movingPartId: string | null;
  requiredInterface: string;
  status: 'verified' | 'blocked';
  reason: string;
  fixedSourceDigest: string | null;
  movingSourceDigest: string | null;
  result: ConnectionFixtureVerification | null;
}

export async function verifyRepresentativePairs(loader: AssemblySourceLoader, engine: AssemblyVerificationEngine): Promise<RepresentativePairVerification[]> {
  const records: RepresentativePairVerification[] = [];
  for (const definition of AUTOMOTIVE_ASSEMBLY_PAIR_FIXTURES) {
    const record: RepresentativePairVerification = { ...definition, status: 'blocked', reason: '', fixedSourceDigest: null, movingSourceDigest: null, result: null };
    if (!definition.movingPartId) { record.reason = 'No pinned standalone axle fixture exists in the current source root set.'; records.push(record); continue; }
    try {
      const fixed = await loader.loadPart(definition.fixedPartId), moving = await loader.loadPart(definition.movingPartId);
      record.fixedSourceDigest = fingerprintAssemblyPart(fixed).digest;
      record.movingSourceDigest = fingerprintAssemblyPart(moving).digest;
      if (fixed.connections.status !== 'ready' || moving.connections.status !== 'ready') {
        record.reason = `Source connection data remains incomplete: fixed=${fixed.connections.status}, moving=${moving.connections.status}.`;
      } else {
        let points = fixed.connections.points;
        if (definition.requiredInterface === 'side-stud') points = points.filter(point => point.gender === 'M' && Math.abs(point.direction[1]) < 1e-6);
        else if (definition.requiredInterface === 'wheel-rim') points = points.filter(point => point.family === 'wheelMount');
        else if (definition.requiredInterface === 'wheel-pin') points = points.filter(point => point.source.path.includes('wpin'));
        else if (definition.requiredInterface === 'bar-clip') points = points.filter(point => point.kind === 'clip');
        else if (definition.requiredInterface === 'pin') points = points.filter(point => point.family === 'pinHole');
        for (const point of points) {
          const result = await verifyAssemblyConnectionWithFixtures(fixed, point, [point.id], [{ definition: { role: 'representative-pair', partId: moving.partId, purpose: definition.label }, part: moving, status: 'source-ready', reason: 'Representative pair uses actual pinned source interfaces.' }], engine);
          record.result = result;
          if (result.status === 'verified') { record.status = 'verified'; record.reason = 'The required actual pair interface passed compatibility, transform, reverse, collision, rotation, graph and attachment smoke checks.'; break; }
        }
        if (record.status !== 'verified') record.reason = record.result?.reasons.join('; ') || 'The requested interface has no supported source-backed mating rule.';
      }
    } catch (error) { record.reason = `Representative pair could not be verified: ${error instanceof Error ? error.message.slice(0, 500) : 'source or engine error'}`; }
    records.push(record);
  }
  return records;
}
export function batchFor(root: AssemblySourceRoot): AssemblyMigrationBatch {
  const name = root.name;
  if (/\b(?:Wheel|Tyre|Technic|Axlehole|Axle|Wheel Pins)\b/i.test(name)) return '5-wheel-tyre-axle';
  if (/\b(?:Bar|Clip|Clips|Minifig)\b/i.test(name)) return '6-bar-clip-detail';
  if (/\b(?:Windscreen|Mudguard|Panel)\b/i.test(name)) return '4-body-windscreen-mudguard';
  if (/\b(?:Slope|Wedge|Wing)\b/i.test(name)) return '3-slope-curved-wedge';
  if (/\b(?:Bracket|Headlight|Side|Sides|Centre Stud|Side Bricks)\b/i.test(name)) return '2-modified-bracket-snot';
  if (/\b(?:Brick|Plate|Tile)\b/i.test(name)) return '1-basic-brick-plate-tile';
  return 'other-source-part';
}
export function blockedCategory(result: NativePartAssemblyVerification, batch: AssemblyMigrationBatch): AssemblyMigrationEntry['blockedCategory'] {
  if (result.assemblyVerified) return null;
  if (result.reasonCodes.some(code => /geometry|integrity/.test(code))) return 'geometry';
  if (result.reasonCodes.some(code => /source-partial|connection-missing/.test(code))) return 'connection';
  if (result.reasonCodes.some(code => /collision/.test(code))) return 'collision';
  if (batch === '5-wheel-tyre-axle' || batch === '6-bar-clip-detail') return 'special-assembly';
  if (result.reasonCodes.some(code => /compatibility|interface|fixture/.test(code))) return 'connection';
  return 'other';
}
function blockedSourceEntry(root: AssemblySourceRoot, revision: string, reason: string): NativePartAssemblyVerification {
  return {
    partId: root.partId, name: root.name, status: 'blocked', geometryReady: false, connectionSourceStatus: 'missing',
    source: { digest: createHash('sha256').update(JSON.stringify([revision, root.path, 'source-load-failed'])).digest('hex'), geometryRevision: revision, geometryRoot: root.path, geometryFiles: [], connectionFiles: [] },
    scope: 'source-backed-tested-interfaces-only', assemblyVerified: false, generatable: false, allowedConnectionIds: [], verifiedConnectionIds: [], disabledConnectionIds: [], capabilities: [],
    ruleIds: [], reasonCodes: ['source-load-failed'], reasons: [reason], wheelModuleVerified: false, physicalBuildVerified: false,
    sourceChecks: [{ name: 'source-integrity', outcome: 'blocked', reason }], fixtures: [], fixtureTestsPassed: 0, fixtureTestsTotal: 0, generatorSmokePassed: false,
    interfaceBudget: null, physicalInterfaceCount: 0, testedPhysicalInterfaceCount: 0, deferredPhysicalInterfaceCount: 0, deferredConnectionIds: [],
  };
}

/**
 * All roots are attempted, including partial and missing connector records. A failed part
 * never aborts the queue or disappears from its denominator. Engine must be the actual
 * server AttachmentEngine in verification mode; HTTP cannot select this mode.
 */
export async function runAssemblyMigration(options: { engine: AssemblyVerificationEngine; sourceLoader?: AssemblySourceLoader; maxInterfacesPerPart?: number | null; onProgress?: (entry: AssemblyMigrationEntry, completed: number, total: number) => void | Promise<void> }): Promise<AssemblyMigrationReport> {
  const loader = options.sourceLoader ?? await createAssemblySourceLoader();
  const fixtures = await loadStandardAssemblyFixtures(loader);
  const entries: AssemblyMigrationEntry[] = [];
  for (const root of loader.roots) {
    let result: NativePartAssemblyVerification;
    let part: NativeAssemblyPart | undefined;
    try { part = await loader.loadPart(root.partId); result = await verifyNativePartAssembly(part, root.name, fixtures, options.engine, { maxInterfacesPerPart: options.maxInterfacesPerPart }); }
    catch (error) {
      const reason = `Native source or assembly verification did not complete: ${error instanceof Error ? error.message.slice(0, 600) : 'unknown verification failure'}`;
      result = blockedSourceEntry(root, loader.geometryRevision, reason);
      if (part) {
        result.source = fingerprintAssemblyPart(part);
        result.geometryReady = part.geometry.status === 'geometryReady';
        result.connectionSourceStatus = part.connections.status;
        result.disabledConnectionIds = part.connections.points.map(point => point.id);
        result.reasonCodes = ['verification-execution-error'];
      }
    }
    const batch = batchFor(root);
    const entry: AssemblyMigrationEntry = { ...result, batch, selectionBasis: root.selectionBasis, blockedCategory: blockedCategory(result, batch) };
    entries.push(entry);
    await options.onProgress?.(entry, entries.length, loader.roots.length);
  }
  const categories: AssemblyMigrationReport['blockedReasons'] = { geometry: 0, connection: 0, collision: 0, 'special-assembly': 0, other: 0 };
  for (const entry of entries) if (entry.blockedCategory) categories[entry.blockedCategory]++;
  const batches = [...new Set(entries.map(entry => entry.batch))].sort().map(batch => {
    const rows = entries.filter(entry => entry.batch === batch);
    return { batch, total: rows.length, assemblyVerified: rows.filter(entry => entry.assemblyVerified).length, generatable: rows.filter(entry => entry.generatable).length, blocked: rows.filter(entry => !entry.assemblyVerified).length };
  });
  return {
    schemaVersion: 1, migrationVersion: ASSEMBLY_MIGRATION_VERSION, testVersion: INTERFACE_TEST_VERSION, partLibraryVersion: loader.partLibraryVersion, assemblyEngineVersion: ASSEMBLY_ENGINE_VERSION, connectionRuleVersion: CONNECTION_RULE_VERSION, collisionVersion: COLLISION_VERSION, generatedAt: new Date().toISOString(), scope: 'every-pinned-native-root', verificationScope: 'only-listed-connection-ids; no physical-build claim',
    interfaceBudget: options.maxInterfacesPerPart === undefined ? 32 : options.maxInterfacesPerPart,
    sourceCounts: { totalRoots: loader.roots.length, geometryReady: entries.filter(entry => entry.geometryReady).length, connectionReady: entries.filter(entry => entry.connectionSourceStatus === 'ready').length, connectionPartial: entries.filter(entry => entry.connectionSourceStatus === 'partial').length, connectionMissing: entries.filter(entry => entry.connectionSourceStatus === 'missing').length },
    counts: { total: entries.length, assemblyVerified: entries.filter(entry => entry.assemblyVerified).length, generatable: entries.filter(entry => entry.generatable).length, blocked: entries.filter(entry => !entry.assemblyVerified).length, verifiedInterfaces: entries.reduce((sum, entry) => sum + entry.verifiedConnectionIds.length, 0), disabledInterfaces: entries.reduce((sum, entry) => sum + entry.disabledConnectionIds.length, 0), testedPhysicalInterfaces: entries.reduce((sum, entry) => sum + entry.testedPhysicalInterfaceCount, 0), deferredPhysicalInterfaces: entries.reduce((sum, entry) => sum + entry.deferredPhysicalInterfaceCount, 0), deferredRawConnectionIds: entries.reduce((sum, entry) => sum + entry.deferredConnectionIds.length, 0), wheelModulesVerified: 0, physicalBuildsVerified: 0 },
    blockedReasons: categories, batches,
    fixtures: fixtures.map(fixture => ({ role: fixture.definition.role, partId: fixture.definition.partId, status: fixture.status, reason: fixture.reason })), representativePairs: await verifyRepresentativePairs(loader, options.engine), entries,
    limitations: [
      'assemblyVerified and generatable are scoped to the listed tested connection IDs. Every other port is disabled.',
      'The default first-pass budget is 32 distinct physical interfaces per part, selected across source profiles, genders, axes, spatial extrema and interior positions. Untested budget-deferred ports are explicitly disabled. Use --all-interfaces for exhaustive expansion.',
      'A part with a tested ordinary stud interface is not thereby qualified for wheel, axle, pin, clip or flexible assembly.',
      'Partial connection sources remain blocked as a whole until source directives and inherited dimensions are resolved.',
      'Fixture attachment is the per-part engine smoke test; larger generator modules have separate reports.',
      'No physical build or manufacturer-certified tolerance verification is claimed.',
      'Standard fixture availability and every unresolved source / rule / transform / mesh-collision result are retained.',
    ],
  };
}

export function capabilityFromMigration(entry: AssemblyMigrationEntry): AssemblyInterfaceCapability {
  return { partId: entry.partId, assemblyVerified: entry.assemblyVerified, generatable: entry.generatable, allowedConnectionIds: [...entry.allowedConnectionIds], ruleIds: [...entry.ruleIds], reasonCodes: [...entry.reasonCodes], reasons: [...entry.reasons] };
}

/** Never truncate a verified-port proof. Only blocked case details may be represented compactly. */
export function compactAssemblyMigrationReport(report: AssemblyMigrationReport, caseLimit = 16): AssemblyMigrationReport & { detailPolicy: { representativeCaseBudget: number; allVerifiedCaseProofsPreserved: true; allPartDecisionsPreserved: true; allInterfaceAllowListsPreserved: true } } {
  if (!Number.isSafeInteger(caseLimit) || caseLimit < 1 || caseLimit > 100) throw new Error('Invalid migration case detail limit.');
  return {
    ...report,
    entries: report.entries.map(entry => {
      const selected = entry.fixtures.filter(fixture => fixture.status === 'verified');
      const representatives = new Map<string, ConnectionFixtureVerification>();
      for (const fixture of entry.fixtures.filter(fixture => fixture.status !== 'verified')) {
        const key = JSON.stringify([fixture.status, fixture.ruleId, fixture.connectionFamily, fixture.fixtureRole, fixture.reasonCodes]);
        if (!representatives.has(key)) representatives.set(key, fixture);
      }
      for (const fixture of representatives.values()) if (selected.length < caseLimit) selected.push(fixture);
      return { ...entry, fixtures: selected };
    }),
    detailPolicy: { representativeCaseBudget: caseLimit, allVerifiedCaseProofsPreserved: true, allPartDecisionsPreserved: true, allInterfaceAllowListsPreserved: true },
  };
}
