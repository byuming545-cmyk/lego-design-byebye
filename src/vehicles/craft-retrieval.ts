import { axisRotation, composeTransforms, rotate, transformPoint } from "../parts/assembly/math.js";
import type { Matrix3, NativeAssemblyPart, RigidTransform, Vector3 } from "../parts/assembly/types.js";
import type { BodyPlacement } from "./body-preview.js";
import type { BodyPlan } from "./body-plan.js";
import type { CraftOptions, DesignCase, DesignCorpus } from "./design-cases.js";
import { inspectBodySurfacePairs, inspectWheelEnvelope, type SourceJointHint } from "./body-inspection.js";
export interface CraftQuery {
    region: "nose-cover" | "front-fascia" | "window";
    size: Vector3;
    twinGrille: boolean;
}
export function rankDesignCases(corpus: DesignCorpus, query: CraftQuery, options: CraftOptions) {
    return corpus.cases.map(c => {
        const reasons: string[] = [];
        if (!options.enabled)
            reasons.push("RETRIEVAL_DISABLED");
        if (options.excludedSourceSets.includes(c.source.setNumber))
            reasons.push("SOURCE_SET_HELD_OUT");
        if (c.validation.status !== "VALID")
            reasons.push("CURRENT_ENGINE_BLOCKED");
        let rotation = axisRotation([0, 1, 0], 0);
        if (query.region === "nose-cover") {
            if (!c.features.curveMembers.length)
                reasons.push("NO_CURVED_SURFACE_PATTERN");
            if (c.features.edgeRiseLdu === null || Math.abs(c.features.edgeRiseLdu) < 1)
                reasons.push("NO_SOURCE_SLOPE_DIRECTION");
            if ((c.features.edgeRiseLdu ?? 0) < 0)
                rotation = axisRotation([0, 1, 0], 180);
        }
        else if (query.region === "front-fascia") {
            rotation = axisRotation([1, 0, 0], 90);
            if (!c.features.grilleMembers.length)
                reasons.push("NO_SOURCE_GRILLE_FEATURE");
            if (query.twinGrille && c.features.flatTrimMembers.length < 2)
                reasons.push("NO_PAIRED_FACE_TILES");
        }
        else
            reasons.push("NO_REVIEWED_COCKPIT_SOURCE");
        const corners = Array.from({ length: 8 }, (_, i) => rotate(rotation, c.bounds.min.map((v, a) => i & (1 << a) ? c.bounds.max[a] : v) as Vector3));
        const min = [0, 1, 2].map(a => Math.min(...corners.map(v => v[a]))) as Vector3, max = [0, 1, 2].map(a => Math.max(...corners.map(v => v[a]))) as Vector3;
        const size = max.map((v, a) => v - min[a]) as Vector3;
        const dimensionError = size.reduce((s, v, a) => s + Math.abs(v - query.size[a]), 0);
        if (dimensionError > 0.001)
            reasons.push("NATIVE_FOOTPRINT_OR_HEIGHT_MISMATCH");
        return { caseId: c.id, familyId: c.familyId, sourceSet: c.source.setNumber, rotation, bounds: { min, max }, size,
            score: dimensionError + c.members.length * .001, reasons, eligible: reasons.length === 0 };
    }).sort((a, b) => Number(b.eligible) - Number(a.eligible) || a.score - b.score || a.caseId.localeCompare(b.caseId));
}
export interface CraftSelection {
    caseId: string;
    familyId: string;
    sourceSet: string;
    groupId: string;
    region: string;
    moduleTransform: RigidTransform;
    sourceRole: string;
    targetRole: string;
    adaptation: string;
    members: {
        localId: string;
        instanceId: string;
        sourcePartId: string;
        actualPartId: string;
        sourceColor: string;
    }[];
    source: DesignCase["source"];
    recipeDigest: string;
    selectedOrdinals: number[];
    sourceVerification: DesignCase["validation"];
    internalValidation: "VALID";
    externalInstallation: "NOT_VERIFIED";
    physicalBuildVerified: false;
}
/** Fitted source patterns replace the requested surface; all candidate failure
 * records survive. The whole-car document remains an appearance draft. */
export function applyDesignCases(base: BodyPlacement[], parts: Map<string, NativeAssemblyPart>, plan: BodyPlan, corpus: DesignCorpus, options: CraftOptions) {
    let placements = [...base];
    const selections: CraftSelection[] = [], hints: SourceJointHint[] = [];
    const queries: {
        query: CraftQuery;
        candidates: ReturnType<typeof rankDesignCases>;
        attempts: {
            caseId: string;
            status: string;
            reasons: string[];
            removedInstanceIds: string[];
        }[];
    }[] = [];
    const W = plan.width, L = plan.length;
    const hoodHeight = Math.round(plan.profile.find(p => p.name === "hood-end")!.height * plan.height / 8) * 8;
    const candidateParts = (ps: BodyPlacement[]) => new Map([...new Set(ps.map(p => p.partId))].map(id => [id, parts.get(id)!]));
    const worldBounds = (p: BodyPlacement) => {
        const b = parts.get(p.partId)!.geometry.bounds!;
        const vs = Array.from({ length: 8 }, (_, i) => transformPoint(p.transform, b.min.map((v, a) => i & (1 << a) ? b.max[a] : v) as Vector3));
        return { min: [0, 1, 2].map(a => Math.min(...vs.map(v => v[a]))), max: [0, 1, 2].map(a => Math.max(...vs.map(v => v[a]))) };
    };
    const install = (query: CraftQuery, remove: (p: BodyPlacement) => boolean, centers: (row: ReturnType<typeof rankDesignCases>[number]) => Vector3[], targetRole: string) => {
        const candidates = rankDesignCases(corpus, query, options), record = { query, candidates, attempts: [] as typeof queries[number]["attempts"] };
        queries.push(record);
        for (const ranked of candidates.filter(c => c.eligible)) {
            const c = corpus.cases.find(c => c.id === ranked.caseId)!, removed = placements.filter(remove), next = placements.filter(p => !remove(p));
            const addedSelections: CraftSelection[] = [], addedHints: SourceJointHint[] = [];
            for (const [i, center] of centers(ranked).entries()) {
                const mid = ranked.bounds.min.map((v, a) => (v + ranked.bounds.max[a]) / 2) as Vector3;
                const transform: RigidTransform = { rotation: ranked.rotation, translation: center.map((v, a) => v - mid[a]) as Vector3 };
                const groupId = `craft-${query.region}-${i}`, members: CraftSelection["members"] = [];
                for (const m of c.members) {
                    const instanceId = groupId + "-" + m.localId;
                    let color: BodyPlacement["color"] = "white";
                    if (query.region === "front-fascia")
                        color = c.features.flatTrimMembers.includes(m.localId) ? "black" : "graphite";
                    next.push({ instanceId, partId: m.partId, role: targetRole, color, transform: composeTransforms(transform, m.transform), assemblyStatus: "NOT_VERIFIED",
                        decision: { constraints: ["native-source-pattern", "region-target", "source-slope-direction", "current-admission"], imageIds: plan.imageIds,
                            purpose: `${query.region}: ${c.id}, source ${m.localId}; internal source layout validated, external mounting NOT_VERIFIED` },
                        craft: { caseId: c.id, groupId, localId: m.localId, sourcePartId: m.sourcePartId, sourceColor: m.sourceColor } });
                    members.push({ localId: m.localId, instanceId, sourcePartId: m.sourcePartId, actualPartId: m.partId, sourceColor: m.sourceColor });
                }
                for (const e of c.validation.edges)
                    addedHints.push({ fixedInstanceId: members.find(m => m.localId === e.fixedLocalId)!.instanceId, fixedConnectionId: e.fixedConnectionId,
                        movingInstanceId: members.find(m => m.localId === e.movingLocalId)!.instanceId, movingConnectionId: e.movingConnectionId, caseId: c.id });
                addedSelections.push({ caseId: c.id, familyId: c.familyId, sourceSet: c.source.setNumber, groupId, region: query.region, moduleTransform: transform, sourceRole: c.role, targetRole,
                    source: c.source, recipeDigest: c.recipeDigest, selectedOrdinals: c.selectedOrdinals, sourceVerification: c.validation,
                    adaptation: c.adaptation + " Single rigid region placement; design colours override source colours and remain availability-unverified.", members, internalValidation: "VALID", externalInstallation: "NOT_VERIFIED", physicalBuildVerified: false });
            }
            // The source profile supplies a recessed fascia frame; its lower edge
            // permits the bumper to expose the native tile thickness instead of an
            // upright one-stud-tall slab. No extra module is inserted behind it.
            if (query.region === "front-fascia") {
                const b = parts.get("4162")!.geometry.bounds!;
                const width = b.max[0] - b.min[0], depth = b.max[2] - b.min[2], height = b.max[1] - b.min[1];
                if (width !== W) {
                    record.attempts.push({ caseId: c.id, status: "REJECTED", reasons: ["NATIVE_BUMPER_SPAN_MISMATCH"], removedInstanceIds: removed.map(p => p.instanceId) });
                    continue;
                }
                const faceTop = -Math.max(...next.filter(p => p.role === "hood" && worldBounds(p).min[2] <= -L / 2 + .0001).map(p => worldBounds(p).max[1]));
                const faceBottom = faceTop - query.size[1];
                next.push({ instanceId: "craft-front-bumper", partId: "4162", color: "graphite", role: "front-bumper", assemblyStatus: "NOT_VERIFIED",
                    transform: { rotation: axisRotation([0, 1, 0], 0), translation: [0, -faceBottom, -L / 2 + depth / 2] },
                    decision: { constraints: ["native-tile-thickness", "source-fascia-lower-edge"], imageIds: plan.imageIds, purpose: `native ${height}-LDU tile edge beneath source-profile fascia` } });
                next.push({ instanceId: "craft-front-apron", partId: "4162", color: "white", role: "front-apron", assemblyStatus: "NOT_VERIFIED",
                    transform: { rotation: axisRotation([1, 0, 0], 90), translation: [0, -faceBottom + height + depth / 2, -L / 2 + height] },
                    decision: { constraints: ["source-fascia-frame", "native-tile-depth"], imageIds: plan.imageIds, purpose: "visible lower apron below thin native bumper edge; current mounting NOT_VERIFIED" } });
                // Re-tile the neighbouring side boundary around the source frame's
                // actual back plate. Whole original panels are removed first; the new
                // caps use native 20-LDU faces and 8-LDU thickness, without cutting or
                // shrinking either the source module or an existing tile.
                const sourceMembers = next.filter(p => p.craft?.groupId === "craft-front-fascia-0");
                const boxes = sourceMembers.map(worldBounds);
                const sourceMin = [0, 1, 2].map(a => Math.min(...boxes.map(b => b.min[a]))), sourceMax = [0, 1, 2].map(a => Math.max(...boxes.map(b => b.max[a])));
                const boundary = next.filter(p => p.role === "side" && worldBounds(p).min.every((v, a) => Math.min(worldBounds(p).max[a], sourceMax[a]) - Math.max(v, sourceMin[a]) > .0001));
                let boundaryFailure = false;
                for (const p of boundary) {
                    const box = worldBounds(p), lower = box.max[1] - sourceMax[1], upper = sourceMax[1] - box.min[1], remaining = box.max[2] - sourceMax[2];
                    if (Math.abs(lower - 20) > .0001 || Math.abs(upper - 20) > .0001 || Math.abs((box.max[2] - box.min[2]) - 20) > .0001 || remaining < 0 || Math.abs(remaining / 8 - Math.round(remaining / 8)) > .0001) {
                        boundaryFailure = true;
                        break;
                    }
                    const side = (box.max[0] + box.min[0]) > 0 ? 1 : -1;
                    const addTile = (id: string, center: Vector3, rotation: Matrix3) => {
                        const part = parts.get("3070b")!, bounds = part.geometry.bounds!, offset = rotate(rotation, bounds.min.map((v, a) => (v + bounds.max[a]) / 2) as Vector3);
                        next.push({ instanceId: id, partId: "3070b", color: "white", role: "side", assemblyStatus: "NOT_VERIFIED", transform: { rotation, translation: center.map((v, a) => v - offset[a]) as Vector3 },
                            decision: { constraints: ["source-frame-adjacency", "native-20-face-8-thickness"], imageIds: plan.imageIds, purpose: "boundary re-tiling after source frame replaces conflicting side cover; mounting NOT_VERIFIED" } });
                    };
                    next.splice(next.indexOf(p), 1);
                    removed.push(p);
                    addTile(`craft-side-${side}-lower`, [(box.min[0] + box.max[0]) / 2, sourceMax[1] + 10, (box.min[2] + box.max[2]) / 2], axisRotation([0, 0, 1], side * 90));
                    for (let z = sourceMax[2]; z < box.max[2] - .0001; z += 8)
                        addTile(`craft-side-${side}-${Math.round(z * 1000)}`, [side * (W / 2 - 10), box.min[1] + 10, z + 4], axisRotation([1, 0, 0], 90));
                }
                if (boundaryFailure) {
                    record.attempts.push({ caseId: c.id, status: "REJECTED", reasons: ["NATIVE_BOUNDARY_RETILING_UNAVAILABLE"], removedInstanceIds: removed.map(p => p.instanceId) });
                    continue;
                }
            }
            const used = candidateParts(next), pair = inspectBodySurfacePairs(next, used, [...hints, ...addedHints]);
            const tyre = parts.get("18977")!.geometry.bounds!;
            const wheel = inspectWheelEnvelope(next, used, plan.wheelRadiusLdu, (tyre.max[2] - tyre.min[2]) / 2);
            const failures = pair.results.filter(p => p.status !== "clear").map(p => `${p.status}:${p.a}/${p.b}:${p.reasonCode}`);
            if (wheel.conflicts.length)
                failures.push("SOURCE_PATTERN_INTERSECTS_WHEEL_ENVELOPE");
            if (failures.length) {
                record.attempts.push({ caseId: c.id, status: "REJECTED", reasons: failures, removedInstanceIds: removed.map(p => p.instanceId) });
                continue;
            }
            placements = next;
            selections.push(...addedSelections);
            hints.push(...addedHints);
            record.attempts.push({ caseId: c.id, status: "APPEARANCE_FITTED_NOT_FORMAL", reasons: [], removedInstanceIds: removed.map(p => p.instanceId) });
            break;
        }
    };
    // This request is a continuous ramp followed by a flat landing. Width and
    // length come from the actual cover source; the overall region comes from
    // the vehicle plan. Failed tiling does not scale a source module.
    const coverCases = corpus.cases.filter(c => c.features.curveMembers.length && c.validation.status === "VALID");
    const cover = coverCases[0];
    if (cover) {
        const span = cover.size[2], unit = cover.size[0];
        if (W % unit === 0 && span < plan.cabinStart * L)
            install({ region: "nose-cover", size: cover.size, twinGrille: false }, p => p.role === "hood" && worldBounds(p).max[2] <= -L / 2 + span + .0001, row => Array.from({ length: W / unit }, (_, i) => [-W / 2 + (i + .5) * unit, -hoodHeight + row.size[1] / 2, -L / 2 + span / 2] as Vector3), "hood");
    }
    const twin = plan.features.some(f => /grille/i.test(f.name) && /twin|dual|split/i.test(f.description));
    const frame = corpus.cases.find(c => c.features.grilleMembers.length && c.features.flatTrimMembers.length >= 2);
    if (frame)
        install({ region: "front-fascia", size: [W, frame.size[2], frame.size[1]], twinGrille: twin }, p => ["grille", "grille-divider", "front-bumper"].includes(p.role), row => {
            const faceTop = -Math.max(...placements.filter(p => p.role === "hood" && worldBounds(p).min[2] <= -L / 2 + .0001).map(p => worldBounds(p).max[1]));
            return [[0, -faceTop + row.size[1] / 2, -L / 2 + row.size[2] / 2]];
        }, "grille");
    queries.push({ query: { region: "window", size: [plan.width, plan.height - hoodHeight, (plan.cabinEnd - plan.cabinStart) * L], twinGrille: false },
        candidates: rankDesignCases(corpus, { region: "window", size: [plan.width, plan.height - hoodHeight, (plan.cabinEnd - plan.cabinStart) * L], twinGrille: false }, options), attempts: [] });
    return { placements, hints, report: { version: "craft-region-retrieval-1", options, corpusDigest: corpus.digest, summary: corpus.summary, queries, selections,
            externalConnections: "NOT_VERIFIED", occupancy: "WHOLE_GRAPH_UNKNOWN", modelWeightsUpdated: false } };
}
