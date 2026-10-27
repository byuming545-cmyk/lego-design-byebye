import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { NativePartRepository, nativePartSourceHash, PART_LIBRARY_VERSION } from '../parts/assembly/source.js';
import { AttachmentEngine } from '../parts/assembly/engine.js';
import { AssemblyService } from '../parts/assembly/service.js';
import { loadStandardAssemblyFixtures } from '../parts/assembly/fixtures.js';
import { verifyNativePartAssembly, type NativePartAssemblyVerification } from '../parts/assembly/verification.js';
import { INTERFACE_TEST_VERSION } from '../parts/assembly/deferredTypes.js';
import { adaptPdfInventories } from '../parts/inventory/pdf.js';
import { buildInstructionDemand, demandEvidenceForNativePart, PILOT_PART_SELECTION } from '../parts/digitalImport/demand.js';
import { DIGITAL_SOURCE_POLICIES, assertReviewedPilotManifestDigests } from '../parts/digitalImport/sources.js';
import { runDigitalImportPilot } from '../parts/digitalImport/pipeline.js';
import type { DigitalImportRequest } from '../parts/digitalImport/types.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const readJson = async (file: string) => JSON.parse(await readFile(file, 'utf8'));

/** Runs reviewed local source imports only. Network acquisition and public source
 * preparation are explicit separate operations; this command cannot grant rights. */
export async function digitalImportPilotMain(args = process.argv.slice(2)): Promise<void> {
  let bundle = path.join(ROOT, 'data/parts-foundation/pilots/speed-26');
  let output = path.join(ROOT, 'docs/digital-import');
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help') {
      console.log('Usage: npm run import:pilot -- [--bundle reviewed-source-directory] [--output report-directory]\nNo network or production qualification writes. Full historical mapping demand remains private.'); return;
    }
    if (!['--bundle', '--output'].includes(args[i]) || !args[i + 1]) throw new Error('Expected --bundle or --output with a directory.');
    if (args[i] === '--bundle') bundle = path.resolve(args[++i]);
    else output = path.resolve(args[++i]);
  }
  const geometryDirectory = path.join(bundle, 'ldraw'), shadowDirectory = path.join(bundle, 'shadow');
  const sourceManifestHashes = { ldraw: hash(await readFile(path.join(geometryDirectory, 'manifest.json'))), shadow: hash(await readFile(path.join(shadowDirectory, 'manifest.json'))) };
  assertReviewedPilotManifestDigests(sourceManifestHashes);
  const staged = new NativePartRepository({ geometryDirectory, shadowDirectory });
  const production = new NativePartRepository();
  const manifest = await staged.getManifest(), productionManifest = await production.getManifest();
  const roots = new Set(manifest.roots.map(root => root.partId));
  if (roots.size !== PILOT_PART_SELECTION.length || PILOT_PART_SELECTION.some(row => !roots.has(row.partId))) throw new Error('Pilot source roots must exactly match the reviewed selection.');
  const baselineIds = new Set(productionManifest.roots.map(root => root.partId));
  const notices = await Promise.all([
    ...['CAlicense.txt', 'CAlicense4.txt', 'CAreadme.txt'].map(name => readFile(path.join(geometryDirectory, name))),
    ...['LICENSE.md', 'README.md', 'CONTRIBUTING.md'].map(name => readFile(path.join(shadowDirectory, name))),
  ]);
  // Compare the LDraw notices to already-reviewed original copies; inspect the
  // Shadow licence bytes, rather than asserting that merely named files exist.
  const reviewedNotices = await Promise.all(['CAlicense.txt', 'CAlicense4.txt', 'CAreadme.txt'].map(name => readFile(path.join(ROOT, 'data/parts-foundation/ldraw', name))));
  const licenseCopiesPresent = reviewedNotices.every((notice, i) => hash(notice) === hash(notices[i])) && notices[3].toString().startsWith('Attribution-ShareAlike 4.0 International');
  if (!licenseCopiesPresent) throw new Error('Pilot licence copies differ from reviewed terms.');
  const inventoryPath = path.join(ROOT, 'data/parts-foundation/instructions/inventories.json');
  const reviewPath = path.join(ROOT, 'data/parts-foundation/mappings/ldraw-mapping-review.json');
  const historicalReviewHash = hash(await readFile(reviewPath));
  const inventories = adaptPdfInventories(await readJson(inventoryPath), '2026-10-25T00:00:00.000Z');
  const demand = buildInstructionDemand(inventories, await readJson(reviewPath));
  const privateDirectory = path.resolve(process.env.BRICKLAB_DATA_DIR ?? path.join(ROOT, 'data'), 'parts-foundation/private/digital-import');
  await mkdir(privateDirectory, { recursive: true, mode: 0o700 });
  await writeFile(path.join(privateDirectory, 'speed-26-demand.json'), JSON.stringify(demand, null, 2) + '\n', { mode: 0o600 });
  const requests: DigitalImportRequest[] = PILOT_PART_SELECTION.map(selection => {
    const hints = demandEvidenceForNativePart(selection.partId, demand);
    return { requestId: `native-pilot-${selection.partId}`, originalIdentity: { system: 'ldraw', id: selection.partId }, nativePartId: selection.partId,
      identityStatus: 'EXACT_NATIVE_ID', identityEvidence: [`Exact pinned native file parts/${selection.partId}.dat; its original Name header and source hash are checked.`, 'No Element/Design/colour identity chain or exact set membership is asserted.'],
      // Public report contains aggregate audit facts only. Full candidate rows
      // from unknown-licence historical mappings are never copied to deployment.
      demandEvidence: [{ category: selection.category, structuralPurpose: selection.purpose, categoryCoverageRequest: true,
        historicalHintCount: hints.length, conflictingHintCount: hints.filter(hint => hint.status === 'CONFLICT').length,
        historicalMappingSourceSha256: historicalReviewHash, exactSetMembershipProven: false, referenceOnly: true,
        fullDemandPlan: 'private local review only; excluded from public deployment' }],
    };
  });
  const loadPart = (id: string) => roots.has(id) ? staged.getPart(id) : production.getPart(id);
  const fixtureRoots = [...productionManifest.roots, ...manifest.roots.filter(root => !baselineIds.has(root.partId))];
  const fixtures = await loadStandardAssemblyFixtures({ roots: fixtureRoots, partLibraryVersion: PART_LIBRARY_VERSION, geometryRevision: manifest.revision,
    async loadPart(id) { const part = await loadPart(id); if (!part) throw new Error('Missing source-backed fixture.'); return part; } });
  const axle = await staged.getPart('3705');
  if (axle) {
    const index = fixtures.findIndex(fixture => fixture.definition.role === 'axle');
    fixtures[index] = { definition: { role: 'axle', partId: '3705', purpose: 'Actual newly imported native axle; no new mechanical mating rule is inferred.' }, part: axle,
      status: axle.connections.status === 'ready' ? 'source-ready' : 'source-partial', reason: 'Pilot-only source fixture; production standard fixture definitions unchanged.' };
  }
  const engine = new AttachmentEngine({ mode: 'verification', loadPart });
  const runtime = new AssemblyService({ repository: production });
  const proofs: NativePartAssemblyVerification[] = [];
  const started = performance.now();
  const report = await runDigitalImportPilot(requests, {
    assemblyEvidenceOrigin: 'fresh-verification',
    async resolveSource(request) {
      const source = manifest.roots.find(root => root.partId === request.nativePartId);
      return { sourceSystem: 'LDraw', access: source ? 'available' : 'unavailable', license: licenseCopiesPresent ? 'approved' : 'unknown',
        attributionPreserved: notices.every(notice => notice.length > 0), licenseCopiesPresent,
        evidence: [`Pinned archive ${manifest.archive.sourceUrl}`, `Archive SHA256 ${manifest.archive.sha256}`, 'Untouched author/history headers and per-file licences retained.'] };
    },
    loadPart: id => staged.getPart(id),
    async getAssemblyEvidence(id, part) {
      const proof = await verifyNativePartAssembly(part, part.geometry.name ?? id, fixtures, engine, { maxInterfacesPerPart: null });
      proofs.push(proof);
      console.log(`${proofs.length}/${requests.length}\t${id}\tgeometry=${part.geometry.status}\tconnections=${part.connections.status}\tassembly=${proof.status}\tinterfaces=${proof.testedPhysicalInterfaceCount}/${proof.physicalInterfaceCount}`);
      return proof;
    },
    async getCapability(id) {
      if (!baselineIds.has(id)) return undefined;
      const a = await staged.getPart(id), b = await production.getPart(id);
      if (!a || !b || nativePartSourceHash(a) !== nativePartSourceHash(b)) return undefined;
      return runtime.getCapability(id);
    },
  });
  const runtimeStatus = await runtime.status();
  const publicReport = { ...report, generatedAt: new Date().toISOString(), elapsedMs: Math.round(performance.now() - started), verificationSuiteVersion: INTERFACE_TEST_VERSION,
    scope: '26 source-native IDs; independent staged import; every eligible interface selected, with source/proxy precondition blocks recorded; unchanged production permissions',
    demandSummary: { observedElements: demand.distinctElementCount, observedRows: demand.observedRowCount, setNumbers: demand.observedSetNumbers,
      completeSetNumbers: demand.completeSetNumbers, identityCounts: demand.counts, exactInventoryToLDrawLinks: 0,
      fullHistoricalCandidateRowsPublished: false, privateDemandPlanGenerated: true },
    selectionSummary: { stagedNativeRoots: roots.size, existingProductionRootsSelected: [...roots].filter(id => baselineIds.has(id)).length,
      newlyImportedNativeRoots: [...roots].filter(id => !baselineIds.has(id)), formalProductionRootCount: baselineIds.size },
    sourceManifestHashes,
    attributionAndLicenceCopies: notices.map((notice, i) => ({ file: ['ldraw/CAlicense.txt', 'ldraw/CAlicense4.txt', 'ldraw/CAreadme.txt', 'shadow/LICENSE.md', 'shadow/README.md', 'shadow/CONTRIBUTING.md'][i], sha256: hash(notice) })),
    productionRuntime: { versions: runtime.engine.versions, counts: runtimeStatus.counts, interfaceCoverage: { ...runtimeStatus.interfaceCoverage, parts: undefined }, runtimeValidation: runtimeStatus.runtimeValidation },
    dataLicensing: { nativeGeometry: 'Each source file retains its applicable CC BY licence', connectionDerivedRecords: 'CC-BY-SA-4.0; preserve attribution and licence', applicationCode: 'Separate from imported data licences' },
  };
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'pilot-results.json'), JSON.stringify(publicReport, null, 2) + '\n');
  await writeFile(path.join(output, 'assembly-verification.json'), JSON.stringify({ schemaVersion: 1, verificationSuiteVersion: INTERFACE_TEST_VERSION,
    versions: engine.versions, maxInterfacesPerPart: null, physicalBuildVerified: false, productionQualificationWrites: false,
    connectionDerivedDataLicence: 'CC-BY-SA-4.0; sources and attribution preserved', proofs }, null, 2) + '\n');
  await writeFile(path.join(output, 'source-access.json'), JSON.stringify({ schemaVersion: 1, sources: DIGITAL_SOURCE_POLICIES,
    acquisition: [manifest.archive, (await readJson(path.join(shadowDirectory, 'manifest.json'))).archive],
    acquisitionMethod: 'Explicit pinned public repository archive downloads through inherited HTTPS proxy; exact archive hashes checked before selection',
    brickLinkRequests: 0, studioFilesCopied: 0, newMirrorRowsFetched: 0, officialWebsiteDeniedRequestsAttempted: 0 }, null, 2) + '\n');
  console.log(JSON.stringify({ counts: report.counts, demandIdentityCounts: demand.counts, newlyStaged: publicReport.selectionSummary.newlyImportedNativeRoots,
    productionQualificationWrites: false, output }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  digitalImportPilotMain().catch(error => { console.error(error instanceof Error ? error.message : 'Digital pilot failed.'); process.exitCode = 1; });
}
