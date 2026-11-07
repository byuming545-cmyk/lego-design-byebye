import { beforeAll, afterEach, expect, it, vi } from "vitest";
import { readFile, cp, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadDemoEvidence } from "../src/vehicles/demo-evidence.js";
import { DEMO_CARS } from "../src/vehicles/demo-catalog.js";
import { BodyCatalog } from "../src/vehicles/body-catalog.js";
import { generateBodyPreview, validateBodyPreview, type BodyPreview } from "../src/vehicles/body-preview.js";
import { bodyPlan } from "../src/vehicles/body-plan.js";
import { miniDigest } from "../src/mini-cars/catalog.js";
import { isRigidTransform } from "../src/parts/assembly/math.js";
import { verifySavedExample } from "../src/vehicles/saved-example.js";
let evidence: NonNullable<Awaited<ReturnType<typeof loadDemoEvidence>>>[], models: BodyPreview[], catalog: BodyCatalog;
beforeAll(async () => {
  evidence = (await Promise.all(DEMO_CARS.map(d => loadDemoEvidence(d.input)))).map(e => e!);
  catalog = new BodyCatalog(); models=[];
  for (const e of evidence) models.push(await generateBodyPreview(catalog,e.research,e.vision));
},120000);
afterEach(()=>vi.unstubAllGlobals());
it("loads pinned input dossiers without requests or final coordinates, distinguishing reviewed estimates from provider analysis",async()=>{
  vi.stubGlobal("fetch",vi.fn(()=>{throw Error("NO_NETWORK_ALLOWED");}));
  for(const d of DEMO_CARS){const e=(await loadDemoEvidence(d.input))!;expect(e.research.observation.bundleDigest).toMatch(/^[a-f0-9]{64}$/);expect(e).not.toHaveProperty("placements");}
  expect(evidence.map(e=>e.research.observation.method)).toEqual(["cached-provider","local-photo-review"]);
  expect(evidence[1].research.issues).toContain("EXACT_1976_TRIM_UNCONFIRMED");
  expect(await loadDemoEvidence({...DEMO_CARS[1].input,year:2025})).toBeUndefined();
  expect(fetch).not.toHaveBeenCalled();
});
it("rejects a changed raw image and cannot silently fall back to research",async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),"vehicle-demo-tamper-"));await cp("data/vehicle-demos",dir,{recursive:true});
  const file=evidence[1].research.images[0].localFile;await writeFile(path.join(dir,"golf/sources",file),"corrupt");
  await expect(loadDemoEvidence(DEMO_CARS[1].input,dir)).rejects.toThrow("SOURCE_INTEGRITY");
});
it("uses physical evidence to distinguish a long-hood hardtop from a short-hood tall hatchback",()=>{
  const [a,b]=models;
  expect(a.plan.length).toBeGreaterThan(b.plan.length);
  expect(a.checks.measured.hoodLength/a.checks.measured.length).toBeGreaterThan(b.checks.measured.hoodLength/b.checks.measured.length+.15);
  expect(b.checks.measured.height).toBeGreaterThan(a.checks.measured.height);
  expect(b.layout.shortDeck).toBe(true);expect(a.layout.shortDeck).toBe(false);
  expect(b.plan.roofEnd-b.plan.roofStart).toBeGreaterThan(a.plan.roofEnd-a.plan.roofStart);
  expect(b.placements.filter(p=>p.role==="headlamp").map(p=>p.partId)).toEqual(["98138","98138"]);
  expect(a.placements.filter(p=>p.role==="headlamp")).toEqual([]);
});
it("keeps the literal native source geometry and collision policy for both cars",()=>{
  for(const m of models){expect(new Set(m.placements.map(p=>p.instanceId)).size).toBe(m.placements.length);expect(m.placements.every(p=>isRigidTransform(p.transform))).toBe(true);expect(m.layout.surfacePairs.results.filter(p=>p.status!=="clear")).toEqual([]);expect(m.layout.wheelEnvelope.conflicts).toEqual([]);expect(m.checks.formalConnections).toBe("NOT_VERIFIED");expect(m.checks.physicalBuildVerified).toBe(false);expect(m.steps.status).toBe("DRAFT_NOT_BUILD_INSTRUCTIONS");expect(m.bom.reduce((n,b)=>n+b.quantity,0)).toBe(m.placements.length);}
  expect(models[1].layout.craft.selections).toEqual([]);
  expect(models[1].layout.craft.queries.some(q=>q.candidates.some(c=>c.reasons.includes("NATIVE_FOOTPRINT_OR_HEIGHT_MISMATCH")))).toBe(true);
});
it("preserves original observations and records nonzero angle/endpoint errors instead of changing the source",()=>{
  for(let i=0;i<models.length;i++)expect(models[i].plan.rawVisualSections).toEqual(evidence[i].vision.sections);
  expect(models[1].layout.glassFits.some(g=>Math.abs(g.gapLdu)>1)).toBe(true);
  expect(models[1].layout.angularConflicts.some(g=>Math.abs(g.errorDegrees)>1)).toBe(true);
  expect(models[1].plan.conflicts).toContain("QUANTIZED_rearOverhang_VS_OBSERVATION");
});
it("derives geometry from evidence rather than matching a car name",async()=>{
  const e=evidence[1], renamed=await generateBodyPreview(catalog,{...e.research,input:{...e.research.input,make:"Fixture",model:"Unnamed"}},e.vision);
  expect(renamed.placements).toEqual(models[1].placements);
  const changed=structuredClone(e.vision);changed.constraints.find(c=>c.name==="roofEnd")!.min=.65;changed.constraints.find(c=>c.name==="roofEnd")!.max=.71;
  expect(bodyPlan(e.research,changed,30).roofEnd).not.toBe(models[1].plan.roofEnd);
},60000);
it("binds observation provenance and rejects a forged formal claim even after rehashing",async()=>{
  const bad=structuredClone(models[1]);bad.observation!.method="cached-provider";const{contentSha256:_,...rest}=bad;bad.contentSha256=miniDigest(rest);
  await expect(validateBodyPreview(bad,catalog,evidence[1].research,evidence[1].vision)).rejects.toThrow("SOURCE_LAYOUT_OR_HASH");
},60000);
it("checks frozen offline model and native mesh hashes without claiming current assembly replay",async()=>{
  const payload=JSON.parse(await readFile("public/vehicle-demos/golf.json","utf8"));expect((await verifySavedExample(payload)).preview.model.state).toBe("APPEARANCE_DRAFT");
  const bad=structuredClone(payload);bad.preview.assets[bad.preview.model.sources[0].partId].mesh.positions[0][0]+=1;await expect(verifySavedExample(bad)).rejects.toThrow("MESH_INTEGRITY");
  const formal=structuredClone(payload);formal.preview.model.checks.formalConnections="VALID";await expect(verifySavedExample(formal)).rejects.toThrow("INTEGRITY");
});
