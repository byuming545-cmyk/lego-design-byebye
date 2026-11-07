import { beforeAll, describe, it, expect } from "vitest";
import { readFile, mkdtemp, cp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { BodyCatalog } from "../src/vehicles/body-catalog.js";
import { DesignCaseLibrary, craftOptions, designCaseLibrary, type DesignCorpus } from "../src/vehicles/design-cases.js";
import { rankDesignCases } from "../src/vehicles/craft-retrieval.js";
import { generateBodyPreview, validateBodyPreview, type BodyPreview } from "../src/vehicles/body-preview.js";
import { composeTransforms, isRigidTransform } from "../src/parts/assembly/math.js";
import { ModuleCatalog, MODULE_DIRECTORY } from "../src/parts/modules/catalog.js";
import { miniDigest, stableJson } from "../src/mini-cars/catalog.js";
import { AttachmentEngine } from "../src/parts/assembly/engine.js";
import { assessGrammarAdmission } from "../src/parts/grammar/admission.js";
import { inspectBodySurfacePairs } from "../src/vehicles/body-inspection.js";
import type { Research, VisionResult } from "../src/vehicles/types.js";
let c: BodyCatalog, corpus: DesignCorpus, research: Research, vision: VisionResult, enabled: BodyPreview, disabled: BodyPreview, holdoutA: BodyPreview, holdoutB: BodyPreview;
beforeAll(async () => {
    const j = JSON.parse(await readFile("artifacts/vehicle-surface-2026-11-07/unmocked-job.json", "utf8"));
    research = j.research;
    vision = j.vision;
    c = new BodyCatalog();
    corpus = await designCaseLibrary(c).load();
    enabled = await generateBodyPreview(c, research, vision);
    disabled = await generateBodyPreview(c, research, vision, { enabled: false, excludedSourceSets: [] });
    holdoutA = await generateBodyPreview(c, research, vision, { enabled: true, excludedSourceSets: ["76897"] });
    holdoutB = await generateBodyPreview(c, research, vision, { enabled: true, excludedSourceSets: ["75878"] });
}, 120000);
const geometry = (m: BodyPreview) => m.placements.map(p => ({ partId: p.partId, color: p.color, transform: p.transform })).sort((a, b) => stableJson(a).localeCompare(stableJson(b)));
describe("native source craft learning, without weight training", () => {
    it("counts source designs rather than renderings, recipe overlaps or left/right variants", () => {
        expect(corpus.summary).toEqual({ recipes: 6, sourceFiles: 4, sourceSets: 2, designFamilies: 4, validatedFamilies: 3, validatedRecipes: 5, blockedRecipes: 1, modelWeightsUpdated: false });
        const family = (id: string) => corpus.cases.find(c => c.id === id)!.familyId;
        expect(family("76897-hood-core")).toBe(family("76897-hood-adapted"));
        expect(family("75878-curved-cover-left")).toBe(family("75878-curved-cover-right"));
        expect(corpus.cases.every(c => c.steps === "SOURCE_STEP_ORDER_UNKNOWN" && !c.physicalBuildVerified)).toBe(true);
        expect(corpus.cases.every(c => c.validation.nativeVersions.collisionVersion.includes("4.1.0"))).toBe(true);
    });
    it("retains the real blocked source design and excludes it from every retrieval", () => {
        const wing = corpus.cases.find(c => c.role === "rear-wing")!;
        expect(wing.validation.status).toBe("BLOCKED");
        expect(wing.validation.reasons.join()).toContain("collision");
        expect(enabled.layout.craft.queries.every(q => q.candidates.find(c => c.caseId === wing.id)!.reasons.includes("CURRENT_ENGINE_BLOCKED"))).toBe(true);
        expect(enabled.layout.craft.selections.some(s => s.caseId === wing.id)).toBe(false);
    });
    it("makes a real geometry change while disabled mode exactly preserves the original baseline", async () => {
        const old = JSON.parse(await readFile("artifacts/vehicle-craft-2026-11-07/baseline/model.json", "utf8"));
        expect(geometry(disabled)).toEqual(geometry(old));
        expect(geometry(enabled)).not.toEqual(geometry(disabled));
        expect(disabled.layout.craft.selections).toEqual([]);
        expect(new Set(enabled.layout.craft.selections.map(s => s.sourceSet))).toEqual(new Set(["76897", "75878"]));
        expect(enabled.layout.craft.modelWeightsUpdated).toBe(false);
    });
    it("preserves a single proper rigid transform for every literal member and actual BOM instance", () => {
        for (const selection of enabled.layout.craft.selections) {
            expect(isRigidTransform(selection.moduleTransform)).toBe(true);
            const design = corpus.cases.find(c => c.id === selection.caseId)!;
            for (const m of selection.members) {
                const actual = enabled.placements.find(p => p.instanceId === m.instanceId)!, source = design.members.find(p => p.localId === m.localId)!;
                expect(actual.transform).toEqual(composeTransforms(selection.moduleTransform, source.transform));
                expect(actual.partId).toBe(source.partId);
                expect(actual.craft?.sourcePartId).toBe(source.sourcePartId);
            }
            expect(selection.externalInstallation).toBe("NOT_VERIFIED");
            expect(selection.source.license).toBe("CC-BY-2.0");
            expect(selection.source.sha256).toMatch(/^[a-f0-9]{64}$/);
        }
        expect(enabled.bom.reduce((n, b) => n + b.quantity, 0)).toBe(enabled.placements.length);
        const removed = enabled.layout.craft.queries.flatMap(q => q.attempts.filter(a => a.status === "APPEARANCE_FITTED_NOT_FORMAL").flatMap(a => a.removedInstanceIds));
        expect(enabled.placements.some(p => removed.includes(p.instanceId))).toBe(false);
        expect(enabled.steps.items.flatMap(s => s.instanceIds).sort()).toEqual(enabled.placements.map(p => p.instanceId).sort());
    });
    it("does not turn internally verified source modules or local contact zones into a whole-car certificate", () => {
        expect(enabled.layout.surfacePairs.results.every(p => p.status === "clear")).toBe(true);
        expect(enabled.layout.wheelEnvelope.conflicts).toEqual([]);
        expect(enabled.layout.craft.occupancy).toBe("WHOLE_GRAPH_UNKNOWN");
        expect(enabled.checks).toMatchObject({ formalConnections: "NOT_VERIFIED", collision: "UNKNOWN", wheelFit: "UNKNOWN", physicalBuildVerified: false });
        expect(enabled.steps.status).toBe("DRAFT_NOT_BUILD_INSTRUCTIONS");
    });
    it("leaves whole source sets out together and records a real context-fit rejection", () => {
        expect(holdoutA.layout.craft.selections.every(s => s.sourceSet !== "76897")).toBe(true);
        expect(holdoutA.layout.craft.selections.length).toBeGreaterThan(0);
        expect(holdoutB.layout.craft.selections.every(s => s.sourceSet !== "75878")).toBe(true);
        expect(holdoutB.layout.craft.queries.flatMap(q => q.attempts).some(a => a.reasons.includes("NATIVE_BOUNDARY_RETILING_UNAVAILABLE"))).toBe(true);
        for (const set of ["76897", "75878"]) {
            const included = new Set(corpus.cases.filter(c => c.source.setNumber !== set).map(c => c.familyId));
            expect(corpus.cases.filter(c => c.source.setNumber === set).some(c => included.has(c.familyId))).toBe(false);
        }
    });
    it("rejects oversized native geometry and records the missing cockpit function", () => {
        const rows = rankDesignCases(corpus, { region: "front-fascia", size: [140, 20, 24], twinGrille: true }, craftOptions());
        expect(rows.some(r => r.eligible)).toBe(false);
        expect(rows.find(r => r.caseId === "76897-hood-adapted")!.reasons).toContain("NATIVE_FOOTPRINT_OR_HEIGHT_MISMATCH");
        const window = enabled.layout.craft.queries.find(q => q.query.region === "window")!;
        expect(window.candidates.every(c => !c.eligible && c.reasons.includes("NO_REVIEWED_COCKPIT_SOURCE"))).toBe(true);
    });
    it("fails closed on changed source bytes even though a historical catalogue says the recipe exists", async () => {
        const dir = await mkdtemp(path.join(tmpdir(), "craft-case-source-"));
        try {
            await cp(MODULE_DIRECTORY, dir, { recursive: true });
            const file = path.join(dir, "source/76897-hood.ldr");
            await writeFile(file, (await readFile(file, "utf8")) + "\n0 Unreviewed source change\n");
            await expect(new DesignCaseLibrary(c, new ModuleCatalog(dir)).load()).rejects.toThrow("MODULE_SOURCE_CHANGED");
        }
        finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
    it("refreshes cached source validation when a current permission is withdrawn", async () => {
        let withdrawn = false;
        const engine = new AttachmentEngine({ mode: "production", getSourceSnapshot: () => c.snapshot, loadPart: id => c.repository.getPart(id), getCapability: async (id) => {
                const part = await c.repository.getPart(id);
                if (!part)
                    return undefined;
                const cap = assessGrammarAdmission(part).capability;
                return withdrawn && id === "3460" ? { ...cap, generatable: false, allowedConnectionIds: [], exteriorGeneratable: false, exteriorAllowedConnectionIds: [] } : cap;
            } });
        const library = new DesignCaseLibrary(c, new ModuleCatalog(), engine), before = await library.load();
        withdrawn = true;
        const after = await library.load();
        expect(after.digest).not.toBe(before.digest);
        expect(after.cases.filter(c => c.role === "hood").every(c => c.validation.status === "BLOCKED")).toBe(true);
    }, 60000);
    it("does not let a source joint hint excuse an altered member that penetrates its neighbour", async () => {
        const bad = structuredClone(enabled.placements), tile = bad.find(p => p.craft?.caseId === "76897-hood-adapted" && p.partId === "2412b")!;
        tile.transform.translation[2] += 1;
        const hints = enabled.layout.craft.selections.flatMap(s => corpus.cases.find(c => c.id === s.caseId)!.validation.edges.map(e => ({
            fixedInstanceId: s.members.find(m => m.localId === e.fixedLocalId)!.instanceId, fixedConnectionId: e.fixedConnectionId,
            movingInstanceId: s.members.find(m => m.localId === e.movingLocalId)!.instanceId, movingConnectionId: e.movingConnectionId, caseId: s.caseId
        })));
        const result = inspectBodySurfacePairs(bad, await c.load(enabled.sources.map(s => s.partId)), hints);
        expect(result.results.some(p => p.status !== "clear")).toBe(true);
    }, 60000);
    it.each(["corpus", "membership", "formal-status", "options"])("rejects forged %s after recomputing the exported checksum", async (kind) => {
        const bad = structuredClone(enabled);
        if (kind === "corpus")
            bad.layout.craft.corpusDigest = "0".repeat(64);
        if (kind === "membership")
            bad.layout.craft.selections[0].members[0].actualPartId = "not-native";
        if (kind === "formal-status")
            (bad.layout.craft.selections[0] as any).externalInstallation = "VALID";
        if (kind === "options")
            bad.craftOptions.enabled = false;
        const { contentSha256: _, ...content } = bad;
        bad.contentSha256 = miniDigest(content);
        await expect(validateBodyPreview(bad, c, research, vision, enabled.craftOptions)).rejects.toThrow();
    }, 60000);
    it("canonicalizes bounded control options and rejects unknown grants", () => {
        expect(craftOptions({ enabled: true, excludedSourceSets: ["76897", "75878", "76897"] })).toEqual({ enabled: true, excludedSourceSets: ["75878", "76897"] });
        expect(() => craftOptions({ enabled: true, excludedSourceSets: [], formal: true })).toThrow();
        expect(() => craftOptions({ enabled: true, excludedSourceSets: ["../private"] })).toThrow();
    });
});
