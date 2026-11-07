import { ModuleCatalog, MODULE_LIBRARY_DIGEST } from "../parts/modules/catalog.js";
import type { ModuleMember, ModuleSource } from "../parts/modules/catalog.js";
import { ModuleAssembler } from "../parts/modules/assembly.js";
import { modulePolicy } from "../parts/modules/policy.js";
import { AttachmentEngine } from "../parts/assembly/engine.js";
import { assessGrammarAdmission } from "../parts/grammar/admission.js";
import { transformPoint, distance } from "../parts/assembly/math.js";
import type { NativeAssemblyPart, Vector3 } from "../parts/assembly/types.js";
import { miniDigest, stableJson } from "../mini-cars/catalog.js";
import { BodyCatalog } from "./body-catalog.js";
export const DESIGN_CASE_VERSION = "source-design-cases-1";
export interface CraftOptions {
    enabled: boolean;
    excludedSourceSets: string[];
}
export function craftOptions(value?: unknown): CraftOptions {
    if (value === undefined)
        return { enabled: true, excludedSourceSets: [] };
    const v = value as CraftOptions;
    if (!v || typeof v.enabled !== "boolean" || !Array.isArray(v.excludedSourceSets) || v.excludedSourceSets.length > 10 ||
        v.excludedSourceSets.some(s => typeof s !== "string" || !/^\d{5}$/.test(s)) ||
        Object.keys(v).some(k => !["enabled", "excludedSourceSets"].includes(k)))
        throw Error("CRAFT_OPTIONS_INVALID");
    return { enabled: v.enabled, excludedSourceSets: [...new Set(v.excludedSourceSets)].sort() };
}
export interface DesignCase {
    id: string;
    familyId: string;
    sourceGroup: string;
    recipeDigest: string;
    role: string;
    source: ModuleSource;
    selectedOrdinals: number[];
    adaptation: string;
    members: ModuleMember[];
    bounds: {
        min: Vector3;
        max: Vector3;
    };
    size: Vector3;
    features: {
        grilleMembers: string[];
        flatTrimMembers: string[];
        curveMembers: string[];
        topProfile: {
            z: number;
            topY: number | null;
        }[];
        edgeRiseLdu: number | null;
    };
    permissions: {
        localId: string;
        structural: boolean;
        surface: boolean;
        allowedConnectionIds: string[];
        reasonCodes: string[];
    }[];
    validation: {
        status: "VALID" | "BLOCKED";
        reasons: string[];
        versions: ReturnType<typeof modulePolicy>;
        nativeVersions: AttachmentEngine["versions"];
        edges: {
            fixedLocalId: string;
            fixedConnectionId: string;
            movingLocalId: string;
            movingConnectionId: string;
            ruleId: string;
        }[];
        ports: {
            localId: string;
            connectionId: string;
        }[];
    };
    steps: "SOURCE_STEP_ORDER_UNKNOWN";
    physicalBuildVerified: false;
}
export interface DesignCorpus {
    version: typeof DESIGN_CASE_VERSION;
    libraryDigest: string;
    sourceSnapshot: string;
    digest: string;
    cases: DesignCase[];
    summary: {
        recipes: number;
        sourceFiles: number;
        sourceSets: number;
        designFamilies: number;
        validatedFamilies: number;
        validatedRecipes: number;
        blockedRecipes: number;
        modelWeightsUpdated: false;
    };
}
/** Native source triangles, rather than bbox height, supply the cover profile. */
export function topAt(vertices: Vector3[], indices: number[], x: number, z: number) {
    let top = Infinity;
    for (let i = 0; i < indices.length; i += 3) {
        const [a, b, c] = indices.slice(i, i + 3).map(j => vertices[j]);
        const det = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
        if (Math.abs(det) < 1e-9)
            continue;
        const u = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / det;
        const v = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / det;
        if (u >= -1e-8 && v >= -1e-8 && u + v <= 1 + 1e-8)
            top = Math.min(top, u * a[1] + v * b[1] + (1 - u - v) * c[1]);
    }
    return Number.isFinite(top) ? top : null;
}
export function caseGeometry(members: ModuleMember[], parts: Map<string, NativeAssemblyPart>) {
    const meshes = members.map(m => { const mesh = parts.get(m.partId)!.geometry.mesh!; return { positions: mesh.positions.map(v => transformPoint(m.transform, v)), indices: mesh.indices }; });
    const vertices = meshes.flatMap(m => m.positions);
    const min = [0, 1, 2].map(a => Math.min(...vertices.map(v => v[a]))) as Vector3, max = [0, 1, 2].map(a => Math.max(...vertices.map(v => v[a]))) as Vector3;
    const topProfile = Array.from({ length: 7 }, (_, i) => {
        const z = min[2] + (max[2] - min[2]) * (i + .5) / 7;
        const values = meshes.map(m => topAt(m.positions, m.indices, (min[0] + max[0]) / 2, z)).filter(v => v !== null) as number[];
        return { z, topY: values.length ? Math.min(...values) : null };
    });
    const first = topProfile[0].topY, last = topProfile.at(-1)!.topY;
    return { bounds: { min, max }, size: max.map((v, a) => v - min[a]) as Vector3, topProfile, edgeRiseLdu: first === null || last === null ? null : first - last };
}
export class DesignCaseLibrary {
    readonly assembler: ModuleAssembler;
    readonly nativeVersions: AttachmentEngine["versions"];
    constructor(readonly catalog: BodyCatalog, readonly modules = new ModuleCatalog(), engine?: AttachmentEngine) {
        const activeEngine=engine ?? new AttachmentEngine({ mode: "production", getSourceSnapshot: () => catalog.snapshot,
            loadPart: id => catalog.repository.getPart(id), getCapability: async (id) => { const p = await catalog.repository.getPart(id); return p ? assessGrammarAdmission(p).capability : undefined; } });
        this.nativeVersions=activeEngine.versions;
        this.assembler = new ModuleAssembler(activeEngine, modules);
    }
    async load(): Promise<DesignCorpus> {
        // Both source and current permissions are rechecked, including cache hits.
        const definitions = this.modules.list().map(r => this.modules.get(r.id));
        const parts = await this.catalog.load(definitions.flatMap(d => d.members.map(m => m.partId)));
        const cases: DesignCase[] = [];
        for (const d of definitions) {
            const geometry = caseGeometry(d.members, parts), edges: DesignCase["validation"]["edges"] = [], ports: DesignCase["validation"]["ports"] = [];
            let status: "VALID" | "BLOCKED" = "BLOCKED", reasons: string[] = [];
            try {
                const verified = await this.assembler.compile(d.recipe.id);
                const inverse = new Map([...verified.memberInstances].map(([local, id]) => [id, local]));
                for (const e of verified.graph.edges)
                    edges.push({ fixedLocalId: inverse.get(e.fixedInstanceId)!, fixedConnectionId: e.fixedConnectionId, movingLocalId: inverse.get(e.movingInstanceId)!, movingConnectionId: e.movingConnectionId, ruleId: e.ruleId });
                ports.push(...verified.ports);
                status = "VALID";
            }
            catch (e) {
                reasons = [e instanceof Error ? e.message : String(e)];
            }
            const named = (pattern: RegExp) => d.members.filter(m => pattern.test(parts.get(m.partId)!.geometry.name ?? "")).map(m => m.localId);
            cases.push({ id: d.recipe.id, familyId: "", sourceGroup: d.recipe.source.originalSha256, recipeDigest: d.recipeDigest, role: d.recipe.role,
                source: d.recipe.source, selectedOrdinals: d.recipe.selectedOrdinals, adaptation: d.recipe.adaptation, members: d.members,
                bounds: geometry.bounds, size: geometry.size,
                features: { grilleMembers: named(/^Tile.*Grille/), flatTrimMembers: named(/^Tile\s+\d+ x\s*\d+(?:$| with Groove$)/), curveMembers: named(/^Slope Brick Curved/), topProfile: geometry.topProfile, edgeRiseLdu: geometry.edgeRiseLdu },
                permissions: d.members.map(m => {
                    const a = assessGrammarAdmission(parts.get(m.partId)!);
                    return { localId: m.localId, structural: a.generationEligible, surface: a.exteriorGeneratable,
                        allowedConnectionIds: m.collisionClass === "exterior-shell" ? a.capability.exteriorAllowedConnectionIds ?? [] : a.capability.allowedConnectionIds, reasonCodes: a.reasonCodes };
                }),
                validation: { status, reasons, versions: modulePolicy(), nativeVersions: { ...this.nativeVersions }, edges, ports }, steps: "SOURCE_STEP_ORDER_UNKNOWN", physicalBuildVerified: false });
        }
        // Overlapping extraction variants and same-source, same-role distance
        // patterns form families. This is conservative grouping, not proof of exact
        // interchangeability; left/right members retain their own literal poses.
        const parent = cases.map((_, i) => i), root = (i: number): number => parent[i] === i ? i : root(parent[i]);
        const signature = (c: DesignCase) => stableJson({ ids: c.members.map(m => m.partId).sort(), distances: c.members.flatMap((a, i) => c.members.slice(i + 1).map(b => ({ ids: [a.partId, b.partId].sort(), distance: Math.round(distance(a.transform.translation, b.transform.translation) * 1e5) / 1e5 }))).sort((a, b) => stableJson(a).localeCompare(stableJson(b))) });
        for (let i = 0; i < cases.length; i++)
            for (let j = 0; j < i; j++) {
                const a = cases[i], b = cases[j];
                if (a.sourceGroup === b.sourceGroup && a.role === b.role && ((a.source.file === b.source.file && a.selectedOrdinals.some(n => b.selectedOrdinals.includes(n))) || signature(a) === signature(b)))
                    parent[root(i)] = root(j);
            }
        for (let i = 0; i < cases.length; i++)
            cases[i].familyId = "design-" + miniDigest(cases.filter((_, j) => root(j) === root(i)).map(c => c.id).sort()).slice(0, 16);
        const content: Omit<DesignCorpus, "digest"> = { version: DESIGN_CASE_VERSION, libraryDigest: MODULE_LIBRARY_DIGEST, sourceSnapshot: this.catalog.snapshot, cases,
            summary: { recipes: cases.length, sourceFiles: new Set(cases.map(c => c.source.file)).size, sourceSets: new Set(cases.map(c => c.source.setNumber)).size,
                designFamilies: new Set(cases.map(c => c.familyId)).size, validatedFamilies: new Set(cases.filter(c => c.validation.status === "VALID").map(c => c.familyId)).size,
                validatedRecipes: cases.filter(c => c.validation.status === "VALID").length, blockedRecipes: cases.filter(c => c.validation.status === "BLOCKED").length, modelWeightsUpdated: false as const } };
        return { ...content, digest: miniDigest(content) };
    }
}
const libraries = new WeakMap<BodyCatalog, DesignCaseLibrary>();
export function designCaseLibrary(catalog: BodyCatalog) { let library = libraries.get(catalog); if (!library) {
    library = new DesignCaseLibrary(catalog);
    libraries.set(catalog, library);
} return library; }
