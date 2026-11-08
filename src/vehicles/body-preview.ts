import { rotate } from "../parts/assembly/math.js";
import type { Vector3, Matrix3 } from "../parts/assembly/types.js";
import { miniDigest, stableJson } from "../mini-cars/catalog.js";
import {
  MINI_COLORS,
  type MiniColor,
  type MiniSource,
} from "../mini-cars/types.js";
import { BodyCatalog } from "./body-catalog.js";
import { bodyPlan, type BodyPlan } from "./body-plan.js";
import { regionShell } from "./body-surfaces.js";
import type { Research, VisionResult, VehicleInput } from "./types.js";
import { craftOptions, designCaseLibrary, type CraftOptions } from "./design-cases.js";
export const BODY_SCHEMA = "bricklab-vehicle-envelope-appearance-4";
export const BODY_GENERATOR = "evidence-cabin-regions-7-collision-4.2";
export interface BodyPlacement {
  instanceId: string;
  partId: string;
  color: MiniColor;
  role: string;
  transform: { rotation: Matrix3; translation: Vector3 };
  assemblyStatus: "NOT_VERIFIED";
  decision: { constraints: string[]; imageIds: string[]; purpose: string };
  craft?: {caseId:string;groupId:string;localId:string;sourcePartId:string;sourceColor:string};
}
export interface BodyPreview {
  schema: typeof BODY_SCHEMA;
  generatorVersion: string;
  id: string;
  state: "APPEARANCE_DRAFT";
  units: "LDU";
  sourceSnapshot: string;
  input: VehicleInput;
  observation?: Research["observation"];
  craftOptions:CraftOptions;
  plan: BodyPlan;
  placements: BodyPlacement[];
  layout: ReturnType<typeof regionShell>["layout"];
  sources: MiniSource[];
  bom: {
    partId: string;
    name: string;
    ldrawColor: number;
    color: MiniColor;
    quantity: number;
    colorAvailability: "NOT_VERIFIED";
  }[];
  steps: {
    status: "DRAFT_NOT_BUILD_INSTRUCTIONS";
    items: { step: number; role: string; instanceIds: string[] }[];
  };
  checks: {
    sourceIntegrity: true;
    rigidTransforms: true;
    formalConnections: "NOT_VERIFIED";
    collision: "UNKNOWN";
    wheelFit: "UNKNOWN";
    stability: "UNKNOWN";
    physicalBuildVerified: false;
    measured: Record<string, number>;
    target: Record<string, number>;
    errors: Record<string, number>;
    metricPass: boolean;
    partCount: number;
    nativePartKinds: number;
    rejectionReasons: string[];
  };
  contentSha256: string;
  structure?: {
    schema: 'bricklab-vehicle-structure-revision-1';
    version: string;
    parentContentSha256: string;
    audit: import('./structure-audit.js').StructureAudit;
    changes: {instanceId:string;action:string;reason:string;original?:BodyPlacement;replacement?:BodyPlacement}[];
    rejected: {instanceId:string;reason:string}[];
    internalInstanceIds: string[];
    floorInstanceIds: string[];
    floorGraph: import('../parts/assembly/types.js').NativeAssembly;
    floorValidation: {valid:boolean;issues:string[]};
  };
}
export async function generateBodyPreview(
  catalog: BodyCatalog,
  research: Research,
  vision: VisionResult,
  options?:CraftOptions,
  progress?: (stage: "planning" | "craft" | "selection" | "generation" | "validation", state: "running" | "passed", detail: string) => Promise<void>,
): Promise<BodyPreview> {
  await progress?.("planning","running","Reading native tyre geometry and solving physical dimensions / observed body regions");
  const tyre = (await catalog.load(["18977"])).get("18977")!,
    radius = (tyre.geometry.bounds!.max[0] - tyre.geometry.bounds!.min[0]) / 2,
    plan = bodyPlan(research, vision, radius);
  await progress?.("planning","passed",`Side / top layout solved; ${plan.conflicts.length} evidence conflicts retained`);
  await progress?.("craft","running","Revalidating attributable source patterns and current interface permissions");
  const selectedOptions=craftOptions(options),corpus=await designCaseLibrary(catalog).load();
  await progress?.("craft","passed",`${corpus.summary.designFamilies} design families reviewed; installation candidates will be checked in context`);
  await progress?.("selection","running","Reading hash-verified native curves, tiles, slopes and arches");
  const parts = await catalog.palette();
  for(const [id,part]of await catalog.load(corpus.cases.flatMap(c=>c.members.map(m=>m.partId))))parts.set(id,part);
  await progress?.("selection","passed",`${parts.size} native identities inspected; no part scaling`);
  await progress?.("generation","running","Fitting functional surfaces and source patterns to this layout");
  const { placements, layout } = regionShell(parts, plan,corpus,selectedOptions);
  if(new Set(placements.map(p=>p.instanceId)).size!==placements.length)throw Error("BODY_DUPLICATE_INSTANCE_ID");
  await progress?.("validation","running","Checking actual source poses, native pair collisions, tyre envelopes and BOM; formal assembly remains unverified");
  const sourceIds = [...new Set(placements.map((p) => p.partId))].sort(),
    sources = sourceIds.map((id) => catalog.source(parts.get(id)!));
  const bom = new Map<string, BodyPreview["bom"][number]>();
  for (const p of placements) {
    const k = p.partId + ":" + p.color,
      old = bom.get(k);
    if (old) old.quantity++;
    else
      bom.set(k, {
        partId: p.partId,
        name: parts.get(p.partId)!.geometry.name ?? p.partId,
        ldrawColor: MINI_COLORS[p.color].ldraw,
        color: p.color,
        quantity: 1,
        colorAvailability: "NOT_VERIFIED",
      });
  }
  const bounds = {
      min: [Infinity, Infinity, Infinity],
      max: [-Infinity, -Infinity, -Infinity],
    },
    bodyBounds = {
      min: [Infinity, Infinity, Infinity],
      max: [-Infinity, -Infinity, -Infinity],
    },
    roleBounds = new Map<string, { minZ: number; maxZ: number; minY:number; maxY:number }>();
  for (const p of placements) {
    const b = parts.get(p.partId)!.geometry.bounds!;
    for (let i = 0; i < 8; i++) {
      const corner = b.min.map((v, a) =>
          i & (1 << a) ? b.max[a] : v,
        ) as Vector3,
        rotated = rotate(p.transform.rotation, corner);
      for (let a = 0; a < 3; a++) {
        const n = rotated[a] + p.transform.translation[a];
        bounds.min[a] = Math.min(bounds.min[a], n);
        bounds.max[a] = Math.max(bounds.max[a], n);
        if (p.role !== "wheel") {
          bodyBounds.min[a] = Math.min(bodyBounds.min[a], n);
          bodyBounds.max[a] = Math.max(bodyBounds.max[a], n);
        }
        if (a === 2) {
          const rb = roleBounds.get(p.role) ?? {
            minZ: Infinity,
            maxZ: -Infinity,
            minY: Infinity,
            maxY: -Infinity,
          };
          rb.minZ = Math.min(rb.minZ, n);
          rb.maxZ = Math.max(rb.maxZ, n);
          roleBounds.set(p.role, rb);
        }
        if(a===1){
          const rb=roleBounds.get(p.role)??{minZ:Infinity,maxZ:-Infinity,minY:Infinity,maxY:-Infinity};
          rb.minY=Math.min(rb.minY,n);rb.maxY=Math.max(rb.maxY,n);roleBounds.set(p.role,rb);
        }
      }
    }
  }
  const measured = {
      frontOverhang: plan.axleFront - plan.length / 2 - bounds.min[2],
      rearOverhang: bounds.max[2] - (plan.axleRear - plan.length / 2),
      length: bounds.max[2] - bounds.min[2],
      width: bodyBounds.max[0] - bodyBounds.min[0],
      overallWidth: bounds.max[0] - bounds.min[0],
      height: -bounds.min[1],
      wheelbase: plan.axleRear - plan.axleFront,
      hoodLength: roleBounds.get("hood")!.maxZ - bounds.min[2],
      cabinStart: roleBounds.get("windshield")!.minZ - bounds.min[2],
      cabinEnd: roleBounds.get("rear-window")!.maxZ - bounds.min[2],
      roofStart: roleBounds.get("roof")!.minZ-bounds.min[2],
      roofEnd: roleBounds.get("roof")!.maxZ-bounds.min[2],
      bodyGroundClearance: -bodyBounds.max[1],
      wheelDiameter: radius*2,
      sideWindowHeight: roleBounds.has("side-window") ? Math.max(0,Math.min(-roleBounds.get("side-window")!.minY,layout.roofHeight-8)+roleBounds.get("side-window")!.maxY):0,
    },
    target = {
      length: plan.dimensionsMm.length * plan.scaleLduPerMm,
      width: plan.width,
      height: plan.height,
      wheelbase: plan.dimensionsMm.wheelbase * plan.scaleLduPerMm,
      hoodLength: plan.cabinStart * plan.length,
      cabinStart: plan.cabinStart * plan.length,
      cabinEnd: plan.cabinEnd * plan.length,
      frontOverhang: plan.axleFront,
      rearOverhang: plan.length - plan.axleRear,
    },
    errors = Object.fromEntries(
      Object.entries(target).map(([k, v]) => [
        k,
        measured[k as keyof typeof measured] - v,
      ]),
    );
  const tolerance = plan.quantization.comparisonToleranceLdu,
    metricPass = Object.entries(errors).every(
      ([k, v]) => Math.abs(v) <= tolerance[k as keyof typeof tolerance],
    );
  const roles = [...new Set(placements.map((p) => p.role))];
  const content: Omit<BodyPreview, "id" | "contentSha256"> = {
    schema: BODY_SCHEMA,
    generatorVersion: BODY_GENERATOR,
    state: "APPEARANCE_DRAFT" as const,
    units: "LDU" as const,
    sourceSnapshot: catalog.snapshot,
    input: research.input,
    ...(research.observation ? {observation:research.observation}:{}),
    craftOptions:selectedOptions,
    plan,
    placements,
    layout,
    sources,
    bom: [...bom.values()].sort(
      (a, b) =>
        a.partId.localeCompare(b.partId) || a.color.localeCompare(b.color),
    ),
    steps: {
      status: "DRAFT_NOT_BUILD_INSTRUCTIONS" as const,
      items: roles.map((role, i) => ({
        step: i + 1,
        role,
        instanceIds: placements
          .filter((p) => p.role === role)
          .map((p) => p.instanceId),
      })),
    },
    checks: {
      sourceIntegrity: true as const,
      rigidTransforms: true as const,
      formalConnections: "NOT_VERIFIED" as const,
      collision: "UNKNOWN" as const,
      wheelFit: "UNKNOWN" as const,
      stability: "UNKNOWN" as const,
      physicalBuildVerified: false as const,
      measured,
      target,
      errors,
      metricPass,
      partCount: placements.length,
      nativePartKinds: sourceIds.length,
      rejectionReasons: [
        "WHOLE_VEHICLE_CONNECTION_GRAPH_NOT_VERIFIED",
        "WHEEL_FIT_AND_INSERTION_PATH_UNKNOWN",
        "STRUCTURAL_STABILITY_UNKNOWN",
        ...plan.conflicts,
      ],
    },
  };
  const withId = {
    ...content,
    id: "vehicle-" + miniDigest(content).slice(0, 24),
  };
  return { ...withId, contentSha256: miniDigest(withId) };
}
export async function validateBodyPreview(
  value: unknown,
  catalog: BodyCatalog,
  research: Research,
  vision: VisionResult,
  expectedOptions?:CraftOptions,
) {
  const v = value as BodyPreview;
  if (!v || v.schema !== BODY_SCHEMA || v.generatorVersion !== BODY_GENERATOR)
    throw Error("PREVIEW_SCHEMA_OR_VERSION");
  const expected = await generateBodyPreview(catalog, research, vision,craftOptions(expectedOptions??v.craftOptions));
  if (stableJson(v) !== stableJson(expected))
    throw Error("PREVIEW_SOURCE_LAYOUT_OR_HASH_CHANGED");
  return expected;
}
