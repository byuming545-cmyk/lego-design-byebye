import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { GrammarAssemblyService } from '../../src/parts/grammar/service.js';
import { exportNativeAssemblyJson, exportNativeAssemblyLDraw, exportNativeAssemblyBomCsv } from '../../src/parts/assembly/documents.js';

// Reviewed existing native identities. This experiment grants no source,
// interface, vehicle-membership, printed-variant or physical-build authority.
const output = path.resolve('artifacts/car-canopy-review');
await mkdir(output, { recursive: true });
const temporary = await mkdtemp(path.join(tmpdir(), 'car-canopy-review-'));
try {
  const service = new GrammarAssemblyService({ dataDir: temporary });
  const status = await service.status();
  const categories = [
    { name: 'curved-slopes', matches: (n: string) => n.includes('slope') && n.includes('curved') },
    { name: 'windscreens-including-frames', matches: (n: string) => n.includes('windscreen') },
    { name: 'mudguards', matches: (n: string) => n.includes('mudguard') },
  ].map(category => {
    // Catalog descriptions classify reporting groups only. They never determine fit.
    const entries = status.entries.filter(entry => category.matches(entry.name.toLowerCase()));
    return { category: category.name, sources: entries.length, structural: entries.filter(e => e.generatable).length,
      exterior: entries.filter(e => e.exteriorGeneratable).length,
      blocked: entries.filter(e => !e.generatable && !e.exteriorGeneratable).length,
      entries: entries.map(e => ({ partId: e.partId, name: e.name, structural: e.generatable, exterior: e.exteriorGeneratable, reasonCodes: e.reasonCodes })) };
  });
  const results = [];
  for (const partId of ['18973', '62360', '65632', '65633']) {
    const request = { module: 'exterior-shell' as const, requiredPartIds: ['3001', partId] };
    const generated = await service.generate(request);
    const directory = path.join(output, partId);
    await mkdir(directory, { recursive: true });
    let evidence: object = { partId, request, status: generated.status, reasons: generated.reasons, search: generated.search };
    if (generated.model) {
      const model = generated.model, graph = await service.engine.validateGraph(model);
      const json = exportNativeAssemblyJson(model), reimport = await service.importModel(JSON.parse(json));
      if (!graph.valid || reimport.status !== 'VALID') throw new Error(`${partId}: generated model failed current revalidation`);
      for (const [name, content] of Object.entries({ 'model.json': json, 'model.ldr': exportNativeAssemblyLDraw(model),
        'bom.csv': exportNativeAssemblyBomCsv(model), 'steps.json': JSON.stringify(model.steps, null, 2),
        'sources.json': JSON.stringify(model.sources, null, 2),
        'validation.json': JSON.stringify({ graph, reimport: reimport.status, search: generated.search }, null, 2) })) {
        await writeFile(path.join(directory, name), content);
      }
      evidence = { ...evidence, graphValid: graph.valid, reimport: reimport.status, bom: model.bom,
        placements: model.placements, edges: model.edges.length, steps: model.steps.length,
        scope: 'Two-part final-pose source-surface fit only; not a complete car, installation path, stability or physical proof.' };
    }
    results.push(evidence);
    console.log(JSON.stringify({ partId, status: generated.status, reasons: generated.reasons }));
  }
  // Preserve separation of requested vehicle identity and catalog-match evidence.
  const report = { baseline: '23470ca', sourceSnapshot: service.repository.snapshotDigest, categories, results,
    vehicleDemands: [
      { setNumber: '76924', vehicle: 'Mercedes-AMG SL 63', confirmedByUser: true, status: 'PART_ID_UNRESOLVED',
        evidence: 'Existing 6522905.pdf manifest records no appendix and zero inventory rows. No windscreen ID inferred from its image.' },
      { setNumber: '77254', vehicle: 'Ferrari reference set', status: 'CANDIDATE_ONLY',
        instruction: { documentId: '6617271', page: 123, elementId: '6585318' },
        historicalCatalogCandidate: { rebrickablePartNum: '65633pr0021', designId: '115754', description: 'Windscreen 6 x 6 x 1 1/3 with Black Frame Print', source: 'Existing source-observed Rebrickable mirror; not independently verified official.' },
        existingNativeBase: '65633', exactMappingVerified: false,
        note: 'Base geometry and printed-variant identity must not be merged by their similar numbers. No printed source or material was added.' },
    ],
    renderer: { nativePartViewer: 'Current source viewer uses a uniform inspection material; opacity is a user control, not a verified transparent-colour or printed-frame assignment.' },
    sourceImports: 0, qualificationChanges: 0, physicalBuildsVerified: 0 };
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
} finally { await rm(temporary, { recursive: true, force: true }); }
