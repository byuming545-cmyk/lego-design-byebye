import {beforeAll,it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {appearanceSequence,createSequenceDocument,validateSequenceDocument,STRUCTURAL_SEQUENCE_SCHEMA} from '../src/vehicles/appearance-sequence.js';
import {createDesignDraft,PAINT_PRESETS,designDigest,paintAppearance} from '../src/vehicles/appearance-design.js';
import {isRigidTransform} from '../src/parts/assembly/math.js';
import type {BodyPreview} from '../src/vehicles/body-preview.js';
import type {AssemblyAsset} from '../src/components/NativeAssemblyViewer.js';
let examples:{model:BodyPreview;assets:Record<string,AssemblyAsset>}[];
beforeAll(async()=>{examples=await Promise.all(['charger','golf'].map(async id=>JSON.parse(await readFile(`public/vehicle-structures/${id}.json`,'utf8')).preview));});
it('includes every real instance once and every predecessor is an actual earlier source joint',()=>{
 for(const {model,assets}of examples){const plan=appearanceSequence(model,assets),prior=new Set<string>();expect(plan.steps).toHaveLength(model.placements.length);
  for(const s of plan.steps){expect(s.members).toHaveLength(1);for(const id of s.predecessorInstanceIds??[])expect(prior.has(id)).toBe(true);for(const id of s.verifiedJointIds??[])expect(model.structure!.audit.edges.some(e=>e.id===id&&(s.members[0].instanceId===e.fixedInstanceId||s.members[0].instanceId===e.movingInstanceId))).toBe(true);expect(prior.has(s.members[0].instanceId)).toBe(false);prior.add(s.members[0].instanceId);expect(s.cumulativeCount).toBe(prior.size);expect(s.installationPath).toBe('UNKNOWN');}
  expect([...prior].sort()).toEqual(model.placements.map(p=>p.instanceId).sort());expect(model.checks.physicalBuildVerified).toBe(false);expect(model.checks.formalConnections).toBe('NOT_VERIFIED');expect(model.structure!.floorValidation.valid).toBe(true);expect(model.structure!.audit.blockers.filter(p=>p.status!=='UNKNOWN')).toEqual([]);
 }
});
it('preserves native rigid parts, original wheel poses, actual coloured BOM and parent identity',async()=>{
 for(let i=0;i<examples.length;i++){const{model}=examples[i],id=['charger','golf'][i],base=JSON.parse(await readFile(`public/vehicle-demos/${id}.json`,'utf8')).preview.model;expect(model.structure!.parentContentSha256).toBe(base.contentSha256);expect(model.placements.every(p=>isRigidTransform(p.transform))).toBe(true);expect(model.placements.filter(p=>p.role==='wheel')).toEqual(base.placements.filter((p:any)=>p.role==='wheel'));expect(model.layout.wheelEnvelope.conflicts).toEqual([]);const painted=paintAppearance(model,PAINT_PRESETS[0].options);expect(painted.bom.reduce((n,b)=>n+b.quantity,0)).toBe(model.placements.length);expect(painted.placements.filter(p=>p.role==='wheel').map(p=>p.color)).toEqual(model.placements.filter(p=>p.role==='wheel').map(p=>p.color));expect((await createDesignDraft(model,PAINT_PRESETS[0].options)).base).toEqual(model);}
});
it('round-trips the complete derivative, and rejects rehashed step or connection forgery',async()=>{
 for(const{model,assets}of examples){const d=await createSequenceDocument(model,assets,PAINT_PRESETS[0].options);expect(d.schema).toBe(STRUCTURAL_SEQUENCE_SCHEMA);expect(await validateSequenceDocument(JSON.parse(JSON.stringify(d)),model,assets)).toEqual(d);const bad=structuredClone(d);bad.sequence.steps[1].verifiedJointIds=['invented'];const{contentSha256,...raw}=bad;bad.contentSha256=await designDigest(raw);await expect(validateSequenceDocument(bad,model,assets)).rejects.toThrow('SEQUENCE_');}
});
it('uses actual source geometry and structure evidence rather than a vehicle-name lookup',()=>{
 for(const{model,assets}of examples){const a=appearanceSequence(model,assets),b=structuredClone(model);b.input={make:'Unspecified',model:'Different identity',year:2000,variant:''};b.placements.reverse();expect(appearanceSequence(b,assets).steps).toEqual(a.steps);}
});
