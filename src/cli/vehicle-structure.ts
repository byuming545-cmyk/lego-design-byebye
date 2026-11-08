import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { BodyCatalog } from '../vehicles/body-catalog.js';
import { reviseVehicleStructure, STRUCTURE_VERSION } from '../vehicles/structure-revision.js';
import { auditStructure } from '../vehicles/structure-audit.js';
import { createSequenceDocument } from '../vehicles/appearance-sequence.js';
import { parsePaintOptions } from '../vehicles/appearance-design.js';
import { miniDigest } from '../mini-cars/catalog.js';

const output=process.argv[2];if(!output)throw Error('Usage: node --import tsx src/cli/vehicle-structure.ts NEW-output-dir');
await mkdir(output,{recursive:false});const catalog=new BodyCatalog(),summary=[];
for(const id of ['charger','golf']){
  const payload=JSON.parse(await readFile(`public/vehicle-demos/${id}.json`,'utf8')),base=payload.preview.model;
  const {contentSha256,...raw}=base;if(miniDigest(raw)!==contentSha256)throw Error('STRUCTURE_BASE_HASH');
  console.log(id,'start');const baseline=auditStructure(base.placements,await catalog.load(base.sources.map((s:{partId:string})=>s.partId)));
  const {model,parts}=await reviseVehicleStructure(base,catalog,console.log),assets=Object.fromEntries(model.sources.map(s=>[s.partId,{mesh:parts.get(s.partId)!.geometry.mesh!}]));
  payload.preview={...payload.preview,model,assets};payload.job.preview=model;
  const directory=path.join(output,id);await mkdir(directory);
  for(const[name,value]of Object.entries({payload,model,bom:model.bom,baseline,structure:model.structure,sequence:await createSequenceDocument(model,assets,parsePaintOptions())}))await writeFile(path.join(directory,name+'.json'),JSON.stringify(value,null,2));
  summary.push({id,version:STRUCTURE_VERSION,base:base.contentSha256,model:model.contentSha256,parts:model.placements.length,kinds:model.sources.length,components:model.structure!.audit.components.length,rooted:model.structure!.audit.connectedToChassis.length,wheelConflicts:model.layout.wheelEnvelope.conflicts.length});console.log(summary.at(-1));
}
await writeFile(path.join(output,'summary.json'),JSON.stringify(summary,null,2));
