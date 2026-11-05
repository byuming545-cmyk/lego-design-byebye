import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MiniCarService } from '../mini-cars/service.js';
import { MiniCatalog, miniDigest, stableJson } from '../mini-cars/catalog.js';
import type { MiniOptions } from '../mini-cars/types.js';
import { GrammarAssemblyService } from '../parts/grammar/service.js';

const output = path.resolve(process.argv[2] ?? 'artifacts/mini-cars');
const temporary = await mkdtemp(path.join(tmpdir(), 'mini-car-evidence-'));
const baseline = '3cbf8ac';
await mkdir(output, { recursive: true });
try {
  const catalog = new MiniCatalog(), service = new MiniCarService(catalog, temporary);
  const chooseSeed = (rounded: boolean) => ['mini-01','a','b','c','d'].find(seed => Boolean(parseInt(miniDigest(seed).slice(0,2),16)%2) === rounded)!;
  const plans: { name: string; options: MiniOptions }[] = [
    { name:'sprint-red', options:{style:'sprint',color:'red',seed:chooseSeed(true),spoiler:true} },
    { name:'gt-blue', options:{style:'gt',color:'blue',seed:chooseSeed(false),spoiler:true} },
    { name:'sprint-white-no-wing', options:{style:'sprint',color:'white',seed:chooseSeed(false),spoiler:false} },
    { name:'gt-yellow', options:{style:'gt',color:'yellow',seed:chooseSeed(true),spoiler:true} },
  ];
  const models: {name:string;id:string;parts:number;sourceIdentities:string[];layout:unknown;wheelCount:number;triangles:number;generateMs:number;roundtrip:'VALID_APPEARANCE';formalImport:'REJECTED'}[] = [];
  const native = new GrammarAssemblyService({ repository: catalog.repository, dataDir: temporary }); await native.ready();
  for (const plan of plans) {
    const started = performance.now(), model = await service.generate(plan.options), generateMs = performance.now()-started;
    const repeated = await service.generate(plan.options);
    if (stableJson(repeated) !== stableJson(model)) throw new Error('Seeded reproducibility failed.');
    await service.save(model);
    await service.save(model); // Same immutable ID is idempotent, never overwritten.
    const reopened = await new MiniCarService(new MiniCatalog(), temporary).open(model.id);
    if (stableJson(reopened) !== stableJson(model)) throw new Error('Cross-service source-bound roundtrip failed.');
    let rejected = false;
    try { await native.importModel(model); } catch { rejected = true; }
    if (!rejected) throw new Error('An appearance model reached formal native import.');
    const usedParts = await catalog.load(model.sources.map(s=>s.partId));
    const triangles = model.placements.reduce((sum,p)=>sum+usedParts.get(p.partId)!.geometry.mesh!.indices.length/3,0);
    const dir = path.join(output,'models',plan.name);await mkdir(dir,{recursive:true});
    const files = { 'model.json':JSON.stringify(model,null,2), 'bom.csv':service.bomCsv(model),
      'sources.json':JSON.stringify(model.sources,null,2),'reopened.json':JSON.stringify(reopened,null,2),
      'validation.json':JSON.stringify({checks:model.checks,expectedRoles:['chassis','body','window','roof','wheel'],
        reproducible:true,savedAndReopened:true,idempotentSave:true,formalImport:'REJECTED',generateMs,triangles,
        visualInspection:'See actual browser side/top/perspective images. Automatic checks cover layout and source, not solid collision or support.'},null,2) };
    for(const [file,body]of Object.entries(files))await writeFile(path.join(dir,file),body.endsWith('\n')?body:body+'\n');
    const summary={name:plan.name,id:model.id,parts:model.placements.length,sourceIdentities:model.sources.map(s=>s.partId),layout:model.layout,
      wheelCount:model.wheels.length,triangles,generateMs,roundtrip:'VALID_APPEARANCE' as const,formalImport:'REJECTED' as const};
    models.push(summary);console.log(JSON.stringify(summary));
  }
  let unchangedNativeFiles=0;
  for(const side of ['ldraw','shadow']){
    const root=`data/parts-foundation/${side}`,manifest=JSON.parse(execFileSync('git',['show',`${baseline}:${root}/manifest.json`],{encoding:'utf8',maxBuffer:5_000_000}));
    for(const file of manifest.files){const bytes=await readFile(path.join(root,'files',file.path));if(bytes.length!==file.bytes||createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw new Error('Original source changed.');unchangedNativeFiles++;}
  }
  const protectedPaths=['src/parts/assembly','src/parts/grammar','src/parts/connections','src/parts/legacyPolicy.ts','src/speed','src/automotive','data/parts-foundation'];
  const protectedDiff=execFileSync('git',['diff',baseline,'--name-only','--',...protectedPaths],{encoding:'utf8'}).trim();
  if(protectedDiff)throw new Error('An existing protected pipeline was modified: '+protectedDiff);
  const status=await native.status();
  const result={baseline,branch:'codex/mini-car-appearance',sourceSnapshot:catalog.snapshot,
    formalCounts:status.counts,formalQualifications:{structural:status.capabilities.filter(c=>c.generatable).length,exterior:status.capabilities.filter(c=>c.exteriorGeneratable).length},
    unchangedNativeFiles,protectedPipelinesUnchanged:true,newNativeSourceIdentities:0,newFormalQualifications:0,
    appearanceModels:models.length,sourceIdentitiesUsed:[...new Set(models.flatMap(m=>m.sourceIdentities))].sort(),models,
    performanceScope:'Warm shared native repository after the formal baseline audit; not a cold-start or device frame-rate guarantee.',
    formalWholeCarCertificates:0,mechanicalWheelValidation:false,externalRepositoryScriptsExecuted:false,newDependencies:[],
    note:'Project-designed appearance layouts using existing fixed native geometry. User images guide silhouette only; no hidden connections or exact tutorial reconstruction claimed.'};
  await writeFile(path.join(output,'generation-results.json'),JSON.stringify(result,null,2)+'\n');
} finally { await rm(temporary,{recursive:true,force:true}); }
