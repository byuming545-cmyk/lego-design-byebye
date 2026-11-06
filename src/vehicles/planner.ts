import type { Research, VisionResult } from "./types.js";
export function planVehicle(research: Research, vision: VisionResult) {
  const confirmed = vision.imageAssessments.filter(
      (x) => x.identity === "confirmed" && !x.modified,
    ),
    validIds = new Set(confirmed.map((x) => x.imageId));
  const reasons: string[] = [];
  if (vision.identity !== "confirmed")
    reasons.push("VEHICLE_IDENTITY_UNCONFIRMED");
  if (
    new Set(confirmed.map((x) => x.view).filter((x) => x !== "unknown")).size <
    2
  )
    reasons.push("INSUFFICIENT_CONFIRMED_VIEWS");
  const dimensions: Record<string, number> = {};
  for (const key of ["length", "width", "height", "wheelbase"]) {
    const values = [
      ...new Set(
        research.measurements.filter((x) => x.key === key).map((x) => x.mm),
      ),
    ];
    if (values.length !== 1)
      reasons.push("DIMENSION_MISSING_OR_CONFLICT_" + key);
    else dimensions[key] = values[0];
  }
  const constraints = vision.constraints.filter((x) =>
    x.imageIds.every((id) => validIds.has(id)),
  );
  for (const name of [
    "hoodLength",
    "cabinStart",
    "cabinEnd",
    "roofHeight",
    "frontOverhang",
    "rearOverhang",
  ])
    if (!constraints.some((x) => x.name === name))
      reasons.push("VISUAL_CONSTRAINT_MISSING_" + name);
  const cabinStart = constraints.find((x) => x.name === "cabinStart"),
    cabinEnd = constraints.find((x) => x.name === "cabinEnd");
  if (cabinStart && cabinEnd && cabinStart.max >= cabinEnd.min)
    reasons.push("CABIN_INTERVALS_OVERLAP");
  if (dimensions.wheelbase >= dimensions.length)
    reasons.push("INVALID_PHYSICAL_PROPORTIONS");
  const scale = dimensions.width ? 160 / dimensions.width : null;
  return {
    status: reasons.length ? "blocked" : "design-targets-only",
    reasons,
    units: {
      physical: "mm",
      geometry: "LDU",
      studLdu: 20,
      plateLdu: 8,
      axes: "longitudinal X, lateral Y, up Z",
    },
    bodyWidthStuds: 8,
    supportWidthStuds: 6,
    dimensions,
    dimensionsScope: "generation body; exact requested trim unconfirmed",
    scaleLduPerMm: scale,
    lengthLdu: scale ? dimensions.length * scale : null,
    wheelbaseLdu: scale ? dimensions.wheelbase * scale : null,
    regions: constraints.map((c) => ({
      ...c,
      units: "normalized-design-estimate",
      status: "not-assembled",
    })),
    wheelAssembly: "BLOCKED_SOURCE_AND_MATE_EVIDENCE",
    stability: "UNKNOWN",
    insertionPaths: "UNKNOWN",
    physicalBuild: "UNKNOWN",
    completeCar: false,
  };
}
