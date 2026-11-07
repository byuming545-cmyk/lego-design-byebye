import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { BodyCatalog } from "../vehicles/body-catalog.js";
import { bodyPlan } from "../vehicles/body-plan.js";
import { bodyLayoutSvg } from "../vehicles/body-layout.js";
import { generateBodyPreview } from "../vehicles/body-preview.js";
import type { Job } from "../vehicles/types.js";
// Offline replay only: this CLI has no provider or research network calls.
const input = process.argv[2], output = process.argv[3];
if (!input || !output)
    throw Error("Usage: tsx src/cli/vehicle-surface-evidence.ts saved-job.json NEW-output-directory");
const job = JSON.parse(await readFile(input, "utf8")) as Job;
if (!job.research || !job.vision)
    throw Error("SAVED_REAL_RESEARCH_AND_VISION_REQUIRED");
await mkdir(output, { recursive: false });
const catalog = new BodyCatalog(), parts = await catalog.palette(), tyre = parts.get("18977")!;
const b = tyre.geometry.bounds!, radius = (b.max[0] - b.min[0]) / 2;
// Commit the layout diagnostic to disk before constructing any exterior.
const plan = bodyPlan(job.research, job.vision, radius);
await writeFile(path.join(output, "layout-plan.json"), JSON.stringify(plan, null, 2));
await writeFile(path.join(output, "layout-plan.svg"), bodyLayoutSvg(plan));
await writeFile(path.join(output, "raw-vision.json"), JSON.stringify(job.vision, null, 2));
const model = await generateBodyPreview(catalog, job.research, job.vision);
for (const [name, value] of Object.entries({ "model.json": model, "parameters.json": model.plan, "sources.json": model.sources,
    "cover-selections.json": model.layout, "steps.json": model.steps, "wheel-envelope.json": model.layout.wheelEnvelope,
    "pair-diagnostics.json": model.layout.surfacePairs, "mount-candidates.json": model.layout.mountCandidates, "checks.json": model.checks }))
    await writeFile(path.join(output, name), JSON.stringify(value, null, 2));
await writeFile(path.join(output, "bom.csv"), "part_id,name,ldraw_design_color,quantity\n" + model.bom.map(x => [x.partId, '"' + x.name.replaceAll('"', '""') + '"', x.ldrawColor, x.quantity].join(",")).join("\n") + "\n");
console.log(JSON.stringify({ id: model.id, hash: model.contentSha256, parts: model.placements.length, types: model.sources.length,
    metricPass: model.checks.metricPass, wheelEnvelopeConflicts: model.layout.wheelEnvelope.conflicts.length,
    nativePairStatuses: model.layout.surfacePairs.results.map(x => x.status), formalConnections: model.checks.formalConnections }));
