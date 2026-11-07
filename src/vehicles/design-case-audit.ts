import {readFile} from "node:fs/promises";
import path from "node:path";
import {MODULE_DIRECTORY,digest} from "../parts/modules/catalog.js";
import {isRigidTransform} from "../parts/assembly/math.js";
import type {Matrix3,Vector3} from "../parts/assembly/types.js";
import type {DesignCorpus} from "./design-cases.js";
import type {BodyCatalog} from "./body-catalog.js";

/** Documentary observations only. Unselected records never become recipes or
 * connector truth, and digital STEP groups are not executable instructions. */
export async function auditDesignSources(corpus:DesignCorpus,catalog:BodyCatalog){
 const manifest=await catalog.repository.getManifest(),known=new Map(manifest.roots.map(r=>[r.partId,r.name]));
 const files=[],stepObservations=[];
 for(const file of new Set(corpus.cases.map(c=>c.source.file))){
  const cases=corpus.cases.filter(c=>c.source.file===file),bytes=await readFile(path.join(MODULE_DIRECTORY,file));
  if(digest(bytes)!==cases[0].source.sha256)throw Error("CRAFT_AUDIT_SOURCE_CHANGED");
  const records=[];let step=0;
  for(const line of bytes.toString("utf8").split(/\r?\n/)){
   if(/^0 (STEP|ROTSTEP)\b/.test(line))step++;
   if(!/^1\s/.test(line))continue;
   const v=line.trim().split(/\s+/),direct=v.length===15&&/^[a-z0-9_-]+\.dat$/i.test(v[14]);
   const id=direct?v[14].slice(0,-4).toLowerCase():null;
   records.push({ordinal:records.length,step,reference:v.slice(14).join(" "),directNativeReference:direct,
    knownNativeIdentity:id!==null&&known.has(id),partId:id,name:id?known.get(id):undefined,
    rigid:v.length>=14&&isRigidTransform({translation:v.slice(2,5).map(Number) as Vector3,rotation:v.slice(5,14).map(Number) as Matrix3})});
  }
  files.push({file,sourceSha256:digest(bytes),records:records.length,sourceStepMarkers:step,
   unresolved:records.filter(r=>!r.directNativeReference||!r.knownNativeIdentity||!r.rigid),knownWindowCandidates:records.filter(r=>/Windscreen|Window/.test(r.name??"")),
   sourceScope:"record audit only; unselected records do not grant recipes, identities or permissions"});
  for(const c of cases){
   const groups=new Map<number,number[]>();
   for(const r of records.filter(r=>c.selectedOrdinals.includes(r.ordinal)))groups.set(r.step,[...(groups.get(r.step)??[]),r.ordinal]);
   stepObservations.push({caseId:c.id,file,sourceSha256:c.source.sha256,groups:[...groups].map(([step,selectedOrdinals])=>({step,selectedOrdinals})),
    scope:"third-party digital STEP groups; partial source extraction; within-group action order and physical insertion paths UNKNOWN; not official PDF steps"});
  }
 }
 return {files,stepObservations,originalPdfBytesRead:0};
}
