import {
  axisRotation,
  IDENTITY_ROTATION,
  rotate,
  isRigidTransform,
} from "../parts/assembly/math.js";
import type { Vector3, Matrix3 } from "../parts/assembly/types.js";
import { miniDigest, stableJson } from "../mini-cars/catalog.js";
import {
  MINI_COLORS,
  type MiniColor,
  type MiniSource,
} from "../mini-cars/types.js";
import { BodyCatalog } from "./body-catalog.js";
import { bodyPlan, sampleProfile, type BodyPlan } from "./body-plan.js";
import type { Research, VisionResult, VehicleInput } from "./types.js";
export const BODY_SCHEMA = "bricklab-vehicle-envelope-appearance-1";
export const BODY_GENERATOR = "source-voxel-envelope-3-calibrated";
export interface BodyPlacement {
  instanceId: string;
  partId: string;
  color: MiniColor;
  role: string;
  transform: { rotation: Matrix3; translation: Vector3 };
  assemblyStatus: "NOT_VERIFIED";
  decision: { constraints: string[]; imageIds: string[]; purpose: string };
}
export interface BodyPreview {
  schema: typeof BODY_SCHEMA;
  generatorVersion: string;
  id: string;
  state: "APPEARANCE_DRAFT";
  units: "LDU";
  sourceSnapshot: string;
  input: VehicleInput;
  plan: BodyPlan;
  placements: BodyPlacement[];
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
}
export async function generateBodyPreview(
  catalog: BodyCatalog,
  research: Research,
  vision: VisionResult,
): Promise<BodyPreview> {
  const parts = await catalog.palette(),
    tyre = parts.get("18977")!,
    radius = (tyre.geometry.bounds!.max[0] - tyre.geometry.bounds!.min[0]) / 2,
    plan = bodyPlan(research, vision, radius);
  const cells = new Map<string, { color: MiniColor; role: string }>(),
    key = (x: number, z: number, h: number) => `${x},${z},${h}`;
  const base = Math.max(8, Math.round(plan.groundClearance / 8) * 8),
    nx = plan.widthStuds,
    nz = Math.round(plan.length / 20) - 2,
    maxLayers = Math.ceil(plan.height / 8);
  const hood = plan.profile.find((x) => x.name === "hood-end")!,
    belt = hood.height * plan.height;
  for (let z = 0; z < nz; z++)
    for (let x = 0; x < nx; x++) {
      const t = (z + 1.5) / (nz + 2),
        section = sampleProfile(plan, t),
        rowWidth = Math.min(
          nx,
          Math.max(2, Math.round((section.width * nx) / 2) * 2),
        );
      if (x < (nx - rowWidth) / 2 || x >= (nx + rowWidth) / 2) continue;
      const top = section.height * plan.height;
      for (let h = 0; h < maxLayers; h++) {
        const level = base + h * 8;
        if (level + 8 > top + 4) break;
        const wheelWell =
          Math.abs((x + 0.5) * 20 - plan.width / 2) > plan.width / 2 - 40 &&
          [plan.axleFront, plan.axleRear].some((a) => {
            const dz = Math.max(0, Math.abs((z + 0.5) * 20 - a) - 10),
              dy = Math.max(0, Math.abs(level + 4 - radius) - 4);
            return dz * dz + dy * dy < (radius + 8) ** 2;
          });
        if (wheelWell) continue;
        let role =
            t < plan.cabinStart ? "hood" : t > plan.cabinEnd ? "tail" : "cabin",
          color: MiniColor = "white";
        if (h === 0) {
          role = "chassis";
          color = "black";
        } else if (role === "cabin" && level > belt) {
          color =
            t >= plan.roofStart && t <= plan.roofEnd && level + 8 >= top - 4
              ? "white"
              : "black";
          if (color === "white") role = "roof";
        } else if (x === 0 || x === nx - 1) role = "side";
        cells.set(key(x, z, h), { color, role });
      }
    }
  const placements: BodyPlacement[] = [];
  const put = (
    id: string,
    role: string,
    color: MiniColor,
    center: Vector3,
    rotation: Matrix3,
    decision: BodyPlacement["decision"],
  ) => {
    const part = parts.get(id);
    if (!part?.geometry.bounds) throw Error("BODY_PART_MISSING");
    const b = part.geometry.bounds,
      middle = b.min.map((v, a) => (v + b.max[a]) / 2) as Vector3,
      offset = rotate(rotation, middle);
    const transform = {
      rotation,
      translation: center.map((v, a) => v - offset[a]) as Vector3,
    };
    if (!isRigidTransform(transform) || placements.length >= 700)
      throw Error("BODY_NONRIGID_OR_BUDGET");
    placements.push({
      instanceId: "vehicle-part-" + (placements.length + 1),
      partId: id,
      role,
      color,
      transform,
      assemblyStatus: "NOT_VERIFIED",
      decision,
    });
  };
  const candidates = [...parts.values()]
    .flatMap((p) => {
      const b = p.geometry.bounds!,
        name = p.geometry.name ?? "",
        height = b.max[1];
      if (!/^(Plate|Tile|Brick)\s/.test(name) || ![8, 24].includes(height))
        return [];
      const w = (b.max[0] - b.min[0]) / 20,
        d = (b.max[2] - b.min[2]) / 20;
      if (!Number.isInteger(w) || !Number.isInteger(d) || w < 1 || d < 1)
        return [];
      return [0, 90].map((deg) => ({
        id: p.partId,
        w: deg ? d : w,
        d: deg ? w : d,
        layers: height / 8,
        rotation: deg
          ? axisRotation([0, 1, 0], deg)
          : ([...IDENTITY_ROTATION] as Matrix3),
        tile: /^Tile/.test(name),
      }));
    })
    .sort(
      (a, b) =>
        b.w * b.d * b.layers - a.w * a.d * a.layers ||
        Number(b.tile) - Number(a.tile) ||
        a.id.localeCompare(b.id),
    );
  for (let h = 0; h < maxLayers; h++)
    for (let z = 0; z < nz; z++)
      for (let x = 0; x < nx; x++) {
        const cell = cells.get(key(x, z, h));
        if (!cell) continue;
        const fits = (c: { w: number; d: number; layers: number }) =>
          c.w <= nx - x &&
          c.d <= nz - z &&
          Array.from({ length: c.layers }, (_, dh) =>
            Array.from({ length: c.d }, (_, dz) =>
              Array.from({ length: c.w }, (_, dx) => {
                const other = cells.get(key(x + dx, z + dz, h + dh));
                return other?.color === cell.color && other?.role === cell.role;
              }),
            ),
          )
            .flat(2)
            .every(Boolean);
        const frac = (z + 1.5) / (nz + 2),
          slopePart = [...parts.values()].find((p) =>
            /^Slope Brick 45\s+2 x\s*2$/.test(p.geometry.name ?? ""),
          );
        const slope =
          slopePart &&
          cell.role === "cabin" &&
          cell.color === "black" &&
          ((frac >= plan.cabinStart && frac < plan.roofStart) ||
            (frac > plan.roofEnd && frac <= plan.cabinEnd)) &&
          !cells.has(key(x, z, h + 3)) &&
          fits({ w: 2, d: 2, layers: 3 })
            ? {
                id: slopePart.partId,
                w: 2,
                d: 2,
                layers: 3,
                rotation:
                  frac < 0.5
                    ? ([...IDENTITY_ROTATION] as Matrix3)
                    : axisRotation([0, 1, 0], 180),
                tile: false,
              }
            : undefined;
        const candidate =
          slope ??
          candidates.find(
            (c) =>
              c.w <= nx - x &&
              c.d <= nz - z &&
              Array.from({ length: c.layers }, (_, dh) =>
                Array.from({ length: c.d }, (_, dz) =>
                  Array.from({ length: c.w }, (_, dx) => {
                    const other = cells.get(key(x + dx, z + dz, h + dh));
                    return (
                      other?.color === cell.color && other?.role === cell.role
                    );
                  }),
                ),
              )
                .flat(2)
                .every(Boolean),
          );
        if (!candidate) throw Error("BODY_NATIVE_TILING_UNSUPPORTED");
        const p = parts.get(candidate.id)!,
          bounds = p.geometry.bounds!,
          physicalHeight = candidate.layers * 8;
        const center: Vector3 = [
          -plan.width / 2 + (x + candidate.w / 2) * 20,
          -base - h * 8 - physicalHeight + (bounds.min[1] + bounds.max[1]) / 2,
          -plan.length / 2 + 20 + (z + candidate.d / 2) * 20,
        ];
        const refs = plan.profile
          .filter((s) => Math.abs(s.x - (z + 1.5) / (nz + 2)) < 0.35)
          .flatMap((s) => s.evidenceImageIds);
        put(candidate.id, cell.role, cell.color, center, candidate.rotation, {
          constraints: [
            cell.role === "chassis"
              ? "groundClearance"
              : cell.role === "cabin"
                ? "cabinStart/cabinEnd"
                : "section-profile",
          ],
          imageIds: [...new Set(refs)],
          purpose:
            cell.role +
            " envelope at quantized source-compatible stud/plate grid",
        });
        for (let dh = 0; dh < candidate.layers; dh++)
          for (let dz = 0; dz < candidate.d; dz++)
            for (let dx = 0; dx < candidate.w; dx++)
              cells.delete(key(x + dx, z + dz, h + dh));
      }
  for (const axle of [plan.axleFront, plan.axleRear])
    for (const side of [-1, 1])
      for (const [id, color] of [
        ["18977", "black"],
        ["66727", "graphite"],
      ] as const) {
        put(
          id,
          "wheel",
          color,
          [side * (plan.width / 2 - 10), -radius, axle - plan.length / 2],
          axisRotation([0, 1, 0], 90),
          {
            constraints: [
              "frontAxle",
              "rearAxle",
              "wheelRadius",
              "physical-wheelbase",
            ],
            imageIds: plan.imageIds,
            purpose:
              "source wheel geometry; rim/tyre fit and chassis mounting UNKNOWN",
          },
        );
      }
  // Native face tiles express observed end panels; they do not authorize SNOT connections.
  for (const end of [-1, 1]) {
    const t = end < 0 ? 0 : 1,
      height = sampleProfile(plan, t).height * plan.height,
      rot = axisRotation([1, 0, 0], end < 0 ? -90 : 90);
    const tile = parts.has("3069b") ? "3069b" : "3024";
    for (let x = -plan.width / 2 + 40; x <= plan.width / 2 - 40; x += 40)
      put(
        tile,
        end < 0 ? "grille" : "rear-panel",
        "black",
        [x, -height * 0.6, end * (plan.length / 2 - 20 + 4)],
        rot,
        {
          constraints: ["section-profile", "visible-end-features"],
          imageIds: plan.imageIds,
          purpose: "dark end panel, appearance only",
        },
      );
    for (const side of [-1, 1])
      put(
        "3024",
        end < 0 ? "headlamp" : "taillamp",
        end < 0 ? "white" : "red",
        [
          side * (plan.width / 2 - 20),
          -height * 0.6,
          end * (plan.length / 2 - 20 + 6),
        ],
        rot,
        {
          constraints: ["visible-end-features"],
          imageIds: plan.imageIds,
          purpose:
            "generic lamp expression from real plate; no badge/sticker claim",
        },
      );
  }
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
    roleBounds = new Map<string, { minZ: number; maxZ: number }>();
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
          };
          rb.minZ = Math.min(rb.minZ, n);
          rb.maxZ = Math.max(rb.maxZ, n);
          roleBounds.set(p.role, rb);
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
      cabinStart: roleBounds.get("cabin")!.minZ - bounds.min[2],
      cabinEnd: roleBounds.get("cabin")!.maxZ - bounds.min[2],
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
    plan,
    placements,
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
) {
  const v = value as BodyPreview;
  if (!v || v.schema !== BODY_SCHEMA || v.generatorVersion !== BODY_GENERATOR)
    throw Error("PREVIEW_SCHEMA_OR_VERSION");
  const expected = await generateBodyPreview(catalog, research, vision);
  if (stableJson(v) !== stableJson(expected))
    throw Error("PREVIEW_SOURCE_LAYOUT_OR_HASH_CHANGED");
  return expected;
}
