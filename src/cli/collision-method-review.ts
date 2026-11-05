import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { GrammarAssemblyService } from '../parts/grammar/service.js';
import { checkNativePairCollision, COLLISION_VERSION, COLLISION_TOLERANCE_LDU } from '../parts/assembly/collision.js';
import { buildNativeCollisionProxy, boundsOverlap } from '../parts/assembly/proxy.js';
import { solveAttachment } from '../parts/assembly/solver.js';
import { dot, subtract, length, scale, IDENTITY_TRANSFORM } from '../parts/assembly/math.js';
import type { NativeAssemblyPart, NativePlacement, Vector3 } from '../parts/assembly/types.js';
import type { NativeModuleRequest } from '../parts/assembly/generator.js';
import type { ConnectionPenetrationZone } from '../parts/assembly/solver.js';
import { isSourceDeclaredBarEndpoint, isSourceDeclaredClipEndpoint, isSourceDeclaredPinEndpoint, isSourceDeclaredPinHoleEndpoint } from '../parts/grammar/sources.js';
import { intersectCoplanarSourceTriangles } from '../parts/assembly/surfaceContact.js';
import { ModuleCatalog } from '../parts/modules/catalog.js';
import { exportNativeAssemblyJson, exportNativeAssemblyLDraw, exportNativeAssemblyBomCsv } from '../parts/assembly/documents.js';

const BASELINE = '548b5fe';
const output = path.resolve(process.argv[2] ?? 'artifacts/collision-method-review');
await mkdir(output, { recursive: true });
const temporary = await mkdtemp(path.join(tmpdir(), 'lego-collision-comparison-'));
try {
  // Execute only our own baseline implementation. Rebase relative imports onto
  // unchanged checkout geometry/math modules; no third-party code is executed.
  const original = execFileSync('git', ['show', `${BASELINE}:src/parts/assembly/collision.ts`], { encoding: 'utf8' });
  const adapted = original.replace(/from (['"])(\.{1,2}\/[^'"]+)\1/g, (_match, _quote, relative) => {
    const file = path.resolve('src/parts/assembly', relative).replace(/\.js$/, '.ts');
    return `from ${JSON.stringify(pathToFileURL(file).href)}`;
  });
  const adapterPath = path.join(temporary, 'baseline.mts'); await writeFile(adapterPath, adapted);
  const baseline = await import(pathToFileURL(adapterPath).href) as typeof import('../parts/assembly/collision.js');
  const service = new GrammarAssemblyService({ dataDir: temporary }); await service.ready();
  const oldGeneratorSource = execFileSync('git', ['show', `${BASELINE}:src/parts/assembly/generator.ts`], { encoding: 'utf8' });
  const oldGeneratorPath = path.join(temporary, 'baseline-generator.mts');
  await writeFile(oldGeneratorPath, oldGeneratorSource.replace(/from (['"])(\.{1,2}\/[^'"]+)\1/g, (_match, _quote, relative) =>
    `from ${JSON.stringify(pathToFileURL(path.resolve('src/parts/assembly', relative).replace(/\.js$/, '.ts')).href)}`));
  const { NativeAssemblyGenerator: OldGenerator } = await import(pathToFileURL(oldGeneratorPath).href) as typeof import('../parts/assembly/generator.js');
  const oldSelector = new OldGenerator(service.engine, { partIds: await service.repository.listIds() });
  const selectionComparisons = [];
  for (const request of [
    { module: 'exterior-shell', requiredPartIds: ['11477'] }, { module: 'exterior-shell', requiredPartIds: ['3001'] },
    { module: 'bar-clip', requiredPartIds: ['30374'] }, { module: 'pin-hole', requiredPartIds: ['3673'] },
  ] as NativeModuleRequest[]) {
    const before = await oldSelector.generate(request), current = await service.generate(request);
    const reimport = current.model ? await service.importModel(JSON.parse(exportNativeAssemblyJson(current.model))) : undefined;
    selectionComparisons.push({ request, before: { status: before.status, reasons: before.reasons }, current: { status: current.status, reasons: current.reasons,
      partIds: current.model?.placements.map(part => part.partId), reimport: reimport?.status },
      scope: 'Candidate selection only: both selector implementations use the same current production engine, permissions and source geometry.' });
    if (before.status !== 'blocked' || current.status !== 'generated' || reimport?.status !== 'VALID') throw new Error('Single-identity selection regression did not pass: ' + JSON.stringify(request));
    console.log(JSON.stringify({ selection: request, before: before.status, current: current.status, reimport: reimport.status }));
  }
  const results: object[] = [], generated: object[] = [];
  const placement = (part: NativeAssemblyPart, instanceId: string): NativePlacement => ({ instanceId, partId: part.partId, transform: structuredClone(IDENTITY_TRANSFORM) });
  const compare = (name: string, a: NativeAssemblyPart, pa: NativePlacement, b: NativeAssemblyPart, pb: NativePlacement, seat?: ConnectionPenetrationZone) => {
    const old = baseline.checkNativePairCollision(a, pa, b, pb, seat), current = checkNativePairCollision(a, pa, b, pb, seat);
    const row = { name, placements: [pa, pb], seat, before: old, current };
    results.push(row); console.log(JSON.stringify({ name, before: old.status, current: current.status, reason: current.reasonCode }));
    return row;
  };
  const inSeat = (point: Vector3, seat: ConnectionPenetrationZone) => {
    const delta = subtract(point, seat.center), axial = dot(delta, seat.axis);
    return Math.abs(axial) <= seat.depth / 2 + COLLISION_TOLERANCE_LDU && length(subtract(delta, scale(seat.axis, axial))) <= seat.radius + COLLISION_TOLERANCE_LDU;
  };
  const auditCoplanar = (a: NativeAssemblyPart, pa: NativePlacement, b: NativeAssemblyPart, pb: NativePlacement, seat: ConnectionPenetrationZone) => {
    const proxyA = buildNativeCollisionProxy(a, pa).proxy!, proxyB = buildNativeCollisionProxy(b, pb).proxy!;
    let tests = 0, coplanarPairs = 0, oldOutside = 0, disjoint = 0, localContact = 0, realOutside = 0;
    const witnesses: object[] = [];
    outer: for (const x of proxyA.triangles) for (const y of proxyB.triangles) {
      if (++tests > 1_000_000) break outer;
      if (!boundsOverlap(x.bounds, y.bounds, COLLISION_TOLERANCE_LDU) || Math.abs(dot(x.normal, y.normal)) < 1 - 1e-6 || y.vertices.some(v => Math.abs(dot(x.normal, subtract(v, x.vertices[0]))) > COLLISION_TOLERANCE_LDU)) continue;
      coplanarPairs++;
      if ([...x.vertices, ...y.vertices].every(v => inSeat(v, seat))) continue;
      oldOutside++;
      const contact = intersectCoplanarSourceTriangles(x, y, COLLISION_TOLERANCE_LDU);
      if (contact.status === 'disjoint') disjoint++;
      else if (contact.status === 'contact' && contact.points.every(v => inSeat(v, seat))) localContact++;
      else if (contact.status === 'contact') realOutside++;
      if (witnesses.length < 4 && (contact.status === 'disjoint' || contact.status === 'contact' && contact.points.every(v => inSeat(v, seat)))) witnesses.push({ fixedTriangle: x.sourceTriangle, movingTriangle: y.sourceTriangle, originalVertices: [x.vertices, y.vertices], actualContact: contact });
    }
    return { trianglePairsVisited: tests, budgetExhausted: tests > 1_000_000, coplanarPairs, oldOutside, disjoint, localContact, realOutside, witnesses,
      scope: 'Contact-policy difference for face pairs; a spurious face-pair hit does not prove the complete part pair is clear.' };
  };
  const contactAudit = [];
  for (const [aId, bId, selectA, selectB] of [
    ['30374', '48729b', isSourceDeclaredBarEndpoint, isSourceDeclaredClipEndpoint],
    ['30374', '60470b', isSourceDeclaredBarEndpoint, isSourceDeclaredClipEndpoint],
    ['3673', '32000', isSourceDeclaredPinEndpoint, isSourceDeclaredPinHoleEndpoint],
  ] as const) {
    const a = (await service.engine.getPart(aId))!, b = (await service.engine.getPart(bId))!, pa = placement(a, 'fixed');
    const solved = solveAttachment({ fixedPart: a, fixedPlacement: pa, fixedConnectionId: a.connections.points.find(selectA)!.id, movingPart: b, movingConnectionId: b.connections.points.find(selectB)!.id });
    for (const candidate of solved.candidates) compare(`${aId}+${bId}/${candidate.twistDeg}`, a, pa, b, { ...placement(b, 'moving'), transform: candidate.transform }, candidate.penetrationZone);
    const candidate = solved.candidates[0];
    contactAudit.push({ parts: [aId, bId], ...auditCoplanar(a, pa, b, { ...placement(b, 'moving'), transform: candidate.transform }, candidate.penetrationZone) });
  }
  const brick = (await service.engine.getPart('3001'))!, plate = (await service.engine.getPart('3024'))!, fixed = placement(brick, 'fixed');
  const stud = brick.connections.points.find(p => p.gender === 'M')!, receiver = plate.connections.points.find(p => p.gender === 'F')!;
  const seated = solveAttachment({ fixedPart: brick, fixedPlacement: fixed, fixedConnectionId: stud.id, movingPart: plate, movingConnectionId: receiver.id }).candidates[0];
  compare('C01-legal', brick, fixed, plate, { ...placement(plate, 'moving'), transform: seated.transform }, seated.penetrationZone);
  const intrusion = structuredClone(seated.transform); intrusion.translation[0] += 0.5;
  compare('C01-real-intrusion', brick, fixed, plate, { ...placement(plate, 'moving'), transform: intrusion }, seated.penetrationZone);
  const blade = new ModuleCatalog().get('76897-spoiler-blade'), a = (await service.engine.getPart(blade.members[0].partId))!, b = (await service.engine.getPart(blade.members[1].partId))!;
  compare('source-spoiler-unchanged', a, placement(a, 'fixed'), b, { ...placement(b, 'moving'), transform: blade.members[1].transform });

  for (const partId of ['11477', '15068', '18973', '65633']) {
    const request = { module: 'exterior-shell' as const, requiredPartIds: ['3001', partId] };
    const result = await service.generate(request);
    if (!result.model) { generated.push({ partId, request, status: result.status, reasons: result.reasons, search: result.search }); continue; }
    const model = result.model, text = exportNativeAssemblyJson(model), imported = await service.importModel(JSON.parse(text));
    const graph = await service.engine.validateGraph(model);
    if (!graph.valid || imported.status !== 'VALID') throw new Error('Exterior generation/roundtrip failed for ' + partId);
    const directory = path.join(output, 'models', partId); await mkdir(directory, { recursive: true });
    const files = { 'model.json': text, 'model.ldr': exportNativeAssemblyLDraw(model), 'bom.csv': exportNativeAssemblyBomCsv(model),
      'steps.json': JSON.stringify(model.steps, null, 2), 'sources.json': JSON.stringify(model.sources, null, 2),
      'reimported.json': JSON.stringify(imported.model, null, 2), 'validation.json': JSON.stringify({ graph, reimport: imported.status, search: result.search }, null, 2) };
    for (const [name, body] of Object.entries(files)) await writeFile(path.join(directory, name), body.endsWith('\n') ? body : body + '\n');
    generated.push({ partId, status: result.status, placements: model.placements.length, edges: model.edges.length, graphValid: graph.valid, reimport: imported.status });
    const pa = model.placements[0], pb = model.placements[1], a = (await service.engine.getPart(pa.partId))!, b = (await service.engine.getPart(pb.partId))!, edge = model.edges[0];
    const sourceSeat = solveAttachment({ fixedPart: a, fixedPlacement: pa, fixedConnectionId: edge.fixedConnectionId, movingPart: b, movingConnectionId: edge.movingConnectionId, twistsDeg: [edge.twistDeg] }).candidates.find(c => c.transform.translation.every((n, i) => Math.abs(n - pb.transform.translation[i]) < 1e-5));
    compare(`generated-exterior-${partId}`, a, pa, b, pb, sourceSeat?.penetrationZone);
  }
  const composition = await service.generate({ module: 'module-assembly', requiredPartIds: ['3035'], requiredModuleIds: ['76897-hood-core', '76897-rear-panel-core'] });
  if (!composition.model) throw new Error('The existing two-module generator regressed: ' + composition.reasons.join(' '));
  const model = composition.model, text = exportNativeAssemblyJson(model), adopted = await service.importModel(JSON.parse(text));
  if (adopted.status !== 'VALID') throw new Error('The current-version module model could not be reimported.');
  const moduleDirectory = path.join(output, 'models', 'hood-rear-3035'); await mkdir(moduleDirectory, { recursive: true });
  for (const [name, body] of Object.entries({ 'model.json': text, 'model.ldr': exportNativeAssemblyLDraw(model), 'bom.csv': exportNativeAssemblyBomCsv(model),
    'steps.json': JSON.stringify(model.steps, null, 2), 'sources.json': JSON.stringify({ parts: model.sources, modules: model.moduleComposition }, null, 2),
    'reimported.json': JSON.stringify(adopted.model, null, 2), 'validation.json': JSON.stringify({ reimport: adopted.status, search: composition.search }, null, 2) })) {
    await writeFile(path.join(moduleDirectory, name), body.endsWith('\n') ? body : body + '\n');
  }
  generated.push({ id: 'hood-rear-3035', status: composition.status, placements: model.placements.length,
    supportPoints: model.moduleComposition!.instances.map(instance => instance.installationSupport.independentPoints), reimport: adopted.status });
  const status = await service.status();
  const stale = JSON.parse(await readFile('artifacts/module-composition/models/hood-rear-3035/model.json', 'utf8'));
  const staleImport = await service.importModel(stale);
  if (staleImport.status !== 'NEEDS_REVALIDATION') throw new Error('An old collision certificate bypassed current model validation.');
  const sourceUnchanged = [];
  for (const side of ['ldraw', 'shadow']) {
    const root = `data/parts-foundation/${side}`, manifest = JSON.parse(execFileSync('git', ['show', `${BASELINE}:${root}/manifest.json`], { encoding: 'utf8', maxBuffer: 5_000_000 }));
    for (const file of manifest.files) { const bytes = await readFile(path.join(root, 'files', file.path)); if (createHash('sha256').update(bytes).digest('hex') !== file.sha256 || bytes.length !== file.bytes) throw new Error('Original native source changed.'); sourceUnchanged.push(side + '/' + file.path); }
  }
  await writeFile(path.join(output, 'comparison.json'), JSON.stringify({ baseline: BASELINE,
    baselineAdapter: { sourceSha256: createHash('sha256').update(original).digest('hex'), changes: 'Only relative import specifiers relocated to the unchanged checkout geometry/math modules.' },
    versions: { before: baseline.COLLISION_VERSION, current: COLLISION_VERSION }, sourceSnapshot: service.repository.snapshotDigest,
    baselineGeneratorSha256: createHash('sha256').update(oldGeneratorSource).digest('hex'),
    results, contactAudit, generated, selectionComparisons, counts: status.counts, qualificationCounts: { structural: status.capabilities.filter(c => c.generatable).length, exterior: status.capabilities.filter(c => c.exteriorGeneratable).length },
    unchangedNativeFiles: sourceUnchanged.length, staleImport: { status: staleImport.status, reasons: staleImport.reasons },
    interpretation: 'Method corrections do not manufacture connectors, upgrade exterior contracts, waive real penetration or establish physical stability. Model examples are existing parts under the exterior contract.' }, null, 2) + '\n');
} finally { await rm(temporary, { recursive: true, force: true }); }
