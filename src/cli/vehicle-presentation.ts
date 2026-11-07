import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { VehicleService } from "../vehicles/service.js";
import { DEMO_CARS } from "../vehicles/demo-catalog.js";
import { loadDemoEvidence } from "../vehicles/demo-evidence.js";
import { BodyCatalog } from "../vehicles/body-catalog.js";
import { bodyPlan } from "../vehicles/body-plan.js";
import { bodyLayoutSvg } from "../vehicles/body-layout.js";
const output = process.argv[2];
if (!output) throw Error("Usage: npm run evidence:vehicle-presentation -- NEW-output-directory [--examples]");
await mkdir(output, { recursive: false });
const service = new VehicleService();
const catalog = new BodyCatalog(), tyre = (await catalog.load(["18977"])).get("18977")!.geometry.bounds!;
const radius = (tyre.max[0] - tyre.min[0]) / 2;
const summary = [];
const save = (file: string, value: unknown) => writeFile(file, JSON.stringify(value, null, 2) + "\n");
for (const car of DEMO_CARS) {
  const evidence = (await loadDemoEvidence(car.input))!, directory = path.join(output, car.id);
  await mkdir(directory);
  // Layout evidence is saved before the real service generates the complete shell.
  const plan = bodyPlan(evidence.research, evidence.vision, radius);
  await save(path.join(directory, "layout-plan.json"), plan);
  await writeFile(path.join(directory, "layout-plan.svg"), bodyLayoutSvg(plan));
  const created = await service.create(car.input), job = await service.wait(created.id);
  if (!job.preview) throw Error(car.id + ":" + JSON.stringify(job.events));
  const preview = await service.preview(job.id), m = preview.model;
  for (const [name, value] of Object.entries({ "job.json": job, "model.json": m, "parameters.json": m.plan, "input.json": car.input,
    "research.json": job.research, "observations.json": job.vision, "checks.json": m.checks, "surface-selection.json": m.layout.selection,
    "craft-retrieval.json": m.layout.craft, "pair-checks.json": m.layout.surfacePairs, "wheel-envelope.json": m.layout.wheelEnvelope,
    "mount-candidates.json": m.layout.mountCandidates, "steps.json": m.steps, "sources.json": m.sources, "bom.json": m.bom })) await save(path.join(directory, name), value);
  await writeFile(path.join(directory, "bom.csv"), "part_id,name,color,quantity\n" + m.bom.map(b => `${b.partId},"${b.name.replaceAll('"', '""')}",${b.color},${b.quantity}`).join("\n") + "\n");
  if (process.argv.includes("--examples")) {
    await mkdir("public/vehicle-demos", { recursive: true });
    await writeFile(`public/vehicle-demos/${car.id}.json`, JSON.stringify({ scope: "saved-example-not-new-generation", preview, job }));
  }
  summary.push({ id: car.id, jobId: job.id, modelHash: m.contentSha256, input: car.input, parts: m.placements.length, nativeKinds: m.sources.length,
    dimensions: m.checks.measured, errors: m.checks.errors, conflicts: m.plan.conflicts, glassFits: m.layout.glassFits,
    sourcePatterns: m.layout.craft.selections.map(s => ({ id: s.caseId, family: s.familyId, members: s.members.length })),
    pairFailures: m.layout.surfacePairs.results.filter(p => p.status !== "clear"), tyreConflicts: m.layout.wheelEnvelope.conflicts,
    provenance: m.observation, formal: m.checks.formalConnections, physicalBuild: false });
  console.log(JSON.stringify(summary.at(-1)));
}
await save(path.join(output, "summary.json"), { scope: "two real service generations, offline input dossiers, no provider requests", cars: summary, paidCalls: 0, externalRenderUploads: 0 });
