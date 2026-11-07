import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { BodyCatalog } from "../vehicles/body-catalog.js";
import { bodyPlan } from "../vehicles/body-plan.js";
import { bodyLayoutSvg } from "../vehicles/body-layout.js";
import { generateBodyPreview } from "../vehicles/body-preview.js";
import { designCaseLibrary, type CraftOptions } from "../vehicles/design-cases.js";
import { miniDigest, stableJson } from "../mini-cars/catalog.js";
import type { Job } from "../vehicles/types.js";
import {auditDesignSources} from "../vehicles/design-case-audit.js";
const input = process.argv[2], output = process.argv[3];
if (!input || !output)
    throw Error("Usage: node --import tsx src/cli/vehicle-craft-evidence.ts saved-real-job.json NEW-output-directory");
const original = JSON.parse(await readFile(input, "utf8")) as Job;
if (!original.research || !original.vision)
    throw Error("REAL_SAVED_RESEARCH_AND_VISION_REQUIRED");
await mkdir(output, { recursive: false });
const save = async (name: string, value: unknown) => writeFile(path.join(output, name), JSON.stringify(value, null, 2) + "\n");
const catalog = new BodyCatalog(), corpus = await designCaseLibrary(catalog).load();
await save("corpus.json", corpus);
const sourceAudit=await auditDesignSources(corpus,catalog);
await save("source-gap-audit.json",sourceAudit.files);
await save("source-step-observations.json",sourceAudit.stepObservations);
const manifest = JSON.parse(await readFile("data/parts-foundation/instructions/manifest.json", "utf8"));
await save("source-audit.json", { readDigitalSourceFiles: [...new Set(corpus.cases.map(c => c.source.file))], sourceRecordsVerifiedBy: "ModuleCatalog pinned source bytes, attribution and licence; BodyCatalog pinned native dependencies",
    originalPdfBytesRead: 0, historicalInstructionSummary: manifest.summary, historicalReadyDoesNotProveCurrentPdfAvailability: true, externalDownloads: 0, newPaidCalls: 0 });
await save("source-group-holdouts.json", [...new Set(corpus.cases.map(c => c.source.setNumber))].map(set => ({ heldOutSet: set,
    includedCases: corpus.cases.filter(c => c.source.setNumber !== set).map(c => c.id), heldOutCases: corpus.cases.filter(c => c.source.setNumber === set).map(c => c.id),
    includedFamilies: [...new Set(corpus.cases.filter(c => c.source.setNumber !== set).map(c => c.familyId))], heldOutFamilies: [...new Set(corpus.cases.filter(c => c.source.setNumber === set).map(c => c.familyId))],
    interpretation: "source-set ablation of a two-source corpus; not a trained-model generalization benchmark" })));
await writeFile(path.join(output, "training-candidates.jsonl"), corpus.cases.map(c => JSON.stringify({ schema: "craft-training-candidate-1", id: c.id, familyId: c.familyId, splitGroup: c.sourceGroup,
    source: c.source, features: c.features, members: c.members, engineLabel: c.validation, stepLabel: c.steps, physicalBuildVerified: false,
    modelWeightsUpdated: false, readyForFullVehicleFineTuning: false })).join("\n") + "\n");
const variants: {
    name: string;
    options: CraftOptions;
}[] = [{ name: "enabled", options: { enabled: true, excludedSourceSets: [] } }, { name: "disabled", options: { enabled: false, excludedSourceSets: [] } },
    ...[...new Set(corpus.cases.map(c => c.source.setNumber))].map(set => ({ name: "holdout-" + set, options: { enabled: true, excludedSourceSets: [set] } }))];
const summaries = [];
const geometry = (m: {
    placements: {
        partId: string;
        color: string;
        transform: unknown;
    }[];
}) => miniDigest(m.placements.map(p => ({ partId: p.partId, color: p.color, transform: p.transform })).sort((a, b) => stableJson(a).localeCompare(stableJson(b))));
for (const variant of variants) {
    const directory = path.join(output, variant.name);
    await mkdir(directory);
    const tyre = (await catalog.load(["18977"])).get("18977")!.geometry.bounds!, radius = (tyre.max[0] - tyre.min[0]) / 2;
    const plan = bodyPlan(original.research, original.vision, radius);
    await writeFile(path.join(directory, "layout-plan.svg"), bodyLayoutSvg(plan));
    await writeFile(path.join(directory, "layout-plan.json"), JSON.stringify(plan, null, 2));
    const m = await generateBodyPreview(catalog, original.research, original.vision, variant.options);
    for (const [name, value] of Object.entries({ "model.json": m, "parameters.json": m.plan, "sources.json": m.sources, "steps.json": m.steps,
        "cover-selections.json": m.layout.selection, "retrieval.json": m.layout.craft, "mount-candidates.json": m.layout.mountCandidates, "pair-diagnostics.json": m.layout.surfacePairs,
        "wheel-envelope.json": m.layout.wheelEnvelope, "checks.json": m.checks }))
        await writeFile(path.join(directory, name), JSON.stringify(value, null, 2) + "\n");
    await writeFile(path.join(directory, "bom.csv"), "part_id,name,ldraw_design_color,quantity\n" + m.bom.map(x => [x.partId, '"' + x.name.replaceAll('"', '""') + '"', x.ldrawColor, x.quantity].join(",")).join("\n") + "\n");
    const hash = m.contentSha256, id = [hash.slice(0, 8), hash.slice(8, 12), hash.slice(12, 16), hash.slice(16, 20), hash.slice(20, 32)].join("-");
    const job: Job = { id, input: original.input, research: original.research, vision: original.vision, assembly: original.assembly, plan: m.plan, preview: m, craftOptions: variant.options, state: "partial",
        events: [{ at: new Date().toISOString(), stage: "generation", state: "partial", detail: "Offline replay of genuine saved research and vision; source-pattern appearance, no new provider request or whole-car assembly certificate." }] };
    await writeFile(path.join(directory, "job.json"), JSON.stringify(job, null, 2));
    summaries.push({ name: variant.name, id, hash, options: variant.options, geometryHash: geometry(m), parts: m.placements.length, nativeKinds: m.sources.length,
        selectedCases: m.layout.craft.selections.map(s => ({ caseId: s.caseId, familyId: s.familyId, region: s.region, members: s.members.map(m => m.instanceId) })),
        rejected: m.layout.craft.queries.flatMap(q => q.attempts.filter(a => a.status === "REJECTED")), metrics: m.checks.measured,
        wheelConflicts: m.layout.wheelEnvelope.conflicts.length, nativePairFailures: m.layout.surfacePairs.results.filter(p => p.status !== "clear") });
    console.log(JSON.stringify(summaries.at(-1)));
}
const disabled = summaries.find(s => s.name === "disabled")!;
const old = original.preview as Parameters<typeof geometry>[0];
const compareBaseline = old?.placements && !(old as {layout?:{craft?:unknown}}).layout?.craft;
if (compareBaseline && geometry(old) !== disabled.geometryHash)
    throw Error("DISABLED_CONTROL_GEOMETRY_DIFFERS_FROM_BASELINE");
await save("comparison-summary.json", { corpusDigest: corpus.digest, summary: corpus.summary, variants: summaries, disabledMatchesOriginalBaseline: compareBaseline ? geometry(old) === disabled.geometryHash : null, baselineComparisonScope: "only pre-craft snapshots can be a disabled baseline; source case/generator revisions are not silently rewritten",
    modelWeightsUpdated: false, formalWholeVehicle: "NOT_VERIFIED", physicalBuildVerified: false, newPaidCalls: 0, externalRenderUploads: 0 });
