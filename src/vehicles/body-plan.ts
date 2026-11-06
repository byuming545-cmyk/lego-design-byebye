import type { Research, VisionResult } from "./types.js";
export const BODY_PLAN_VERSION = "vehicle-envelope-plan-2-roof-calibration";
export function bodyPlan(
  research: Research,
  vision: VisionResult,
  wheelRadiusLdu: number,
) {
  if (![2, 3].includes(vision.schemaVersion) || vision.identity !== "confirmed")
    throw Error("BODY_VISUAL_IDENTITY_REQUIRED");
  const images = vision.imageAssessments.filter(
      (x) =>
        x.identity === "confirmed" &&
        !x.modified &&
        x.vehicleType === "photo" &&
        !x.duplicateOf,
    ),
    ids = new Set(images.map((x) => x.imageId));
  const views = new Set(images.map((x) => x.view));
  if (
    !views.has("side") ||
    (!views.has("front") && !views.has("oblique")) ||
    (!views.has("rear") && !views.has("oblique"))
  )
    throw Error("BODY_INSUFFICIENT_VIEWS");
  const dimensions = {} as Record<
    "length" | "width" | "height" | "wheelbase",
    number
  >;
  for (const name of ["length", "width", "height", "wheelbase"] as const) {
    const values = [
      ...new Set(
        research.measurements.filter((x) => x.key === name).map((x) => x.mm),
      ),
    ];
    if (values.length !== 1)
      throw Error("BODY_DIMENSION_MISSING_OR_CONFLICT_" + name);
    dimensions[name] = values[0];
  }
  const constraints = vision.constraints.filter((x) =>
    x.imageIds.every((id) => ids.has(id)),
  );
  const observation = (name: string) => {
    const c = constraints.find((x) => x.name === name);
    if (!c) throw Error("BODY_OBSERVATION_MISSING_" + name);
    return c;
  };
  const center = (name: string) => {
    const c = observation(name);
    return (c.min + c.max) / 2;
  };
  const needed = [
    "frontAxle",
    "rearAxle",
    "cabinStart",
    "cabinEnd",
    "wheelRadius",
    "groundClearance",
  ];
  for (const n of needed) observation(n);
  const rawSections = (vision.sections ?? []).filter((x) =>
    x.imageIds.every((id) => ids.has(id)),
  );
  const rawRoof = rawSections.find((s) => s.name === "roof");
  if (!rawRoof?.height) throw Error("BODY_SECTION_MISSING_roof");
  const calibration =
    vision.schemaVersion === 3
      ? (rawRoof.height[0] + rawRoof.height[1]) / 2
      : 1;
  if (!Number.isFinite(calibration) || calibration <= 0)
    throw Error("BODY_ROOF_HEIGHT_CALIBRATION_UNKNOWN");
  const sections = rawSections.map((s) => ({
    ...s,
    height: s.height
      ? ([
          Math.min(1, s.height[0] / calibration),
          Math.min(1, s.height[1] / calibration),
        ] as [number, number])
      : null,
  }));
  for (const name of [
    "nose",
    "hood",
    "windshield",
    "roof",
    "rearWindow",
    "tail",
  ])
    if (!sections.some((x) => x.name === name && x.height && x.width))
      throw Error("BODY_SECTION_MISSING_" + name);
  const wheelFraction = center("wheelRadius") / calibration;
  if (wheelFraction < 0.1 || wheelFraction > 0.45)
    throw Error("BODY_WHEEL_RADIUS_OUT_OF_RANGE");
  // Choose source-compatible resolution by visible wheel/body ratio, then quantization error. No vehicle-name branch.
  const choices = [6, 8, 10, 12]
    .map((widthStuds) => {
      const scale = (widthStuds * 20) / dimensions.width,
        height = dimensions.height * scale;
      return {
        widthStuds,
        scale,
        score:
          Math.abs(wheelRadiusLdu / height - wheelFraction) +
          (Math.abs(
            Math.round((dimensions.length * scale) / 20) * 20 -
              dimensions.length * scale,
          ) /
            (dimensions.length * scale)) *
            0.2,
      };
    })
    .sort((a, b) => a.score - b.score);
  const choice = choices[0],
    scale = choice.scale,
    length = Math.round((dimensions.length * scale) / 20) * 20,
    width = choice.widthStuds * 20,
    height = dimensions.height * scale;
  const axleFront = Math.round((center("frontAxle") * length) / 20) * 20,
    axleRear = axleFront + Math.round((dimensions.wheelbase * scale) / 20) * 20;
  if (
    axleFront < 20 ||
    axleRear > length - 20 ||
    center("cabinStart") >= center("cabinEnd")
  )
    throw Error("BODY_LAYOUT_OUT_OF_BOUNDS");
  const rear = observation("rearAxle");
  if (
    axleRear / length < rear.min - 20 / length ||
    axleRear / length > rear.max + 20 / length
  )
    throw Error("BODY_AXLE_DIMENSION_VISUAL_CONFLICT");
  const profile = sections
    .map((s) => ({
      name: s.name,
      x: (s.x[0] + s.x[1]) / 2,
      height:
        s.name === "roof" && s.height![1] >= 1
          ? 1
          : (s.height![0] + s.height![1]) / 2,
      width: (s.width![0] + s.width![1]) / 2,
      evidenceImageIds: s.imageIds,
      uncertainty: { x: s.x, height: s.height, width: s.width },
    }))
    .sort((a, b) => a.x - b.x);
  if (profile.some((s, i) => i > 0 && s.x <= profile[i - 1].x))
    throw Error("BODY_PROFILE_ORDER");
  const cStart = observation("cabinStart"),
    cEnd = observation("cabinEnd"),
    rStart = observation("roofStart"),
    rEnd = observation("roofEnd");
  const hoodSection = sections.find((x) => x.name === "hood")!,
    tailSection = sections.find((x) => x.name === "tail")!,
    roofSection = sections.find((x) => x.name === "roof")!;
  if (roofSection.height![1] < 1) throw Error("BODY_ROOF_HEIGHT_CONFLICT");
  const cabinStart = cStart.min,
    cabinEnd = cEnd.max,
    roofStart = rStart.max,
    roofEnd = rEnd.min;
  if (!(cabinStart < roofStart && roofStart < roofEnd && roofEnd < cabinEnd))
    throw Error("BODY_ROOF_SEGMENT_ORDER");
  const chosenHood = hoodSection.height![1],
    chosenTail = tailSection.height![1],
    widthOf = (name: string) => {
      const x = sections.find((s) => s.name === name)!;
      return (x.width![0] + x.width![1]) / 2;
    };
  const solvedProfile = [
    {
      name: "nose",
      x: 0,
      height: sections.find((x) => x.name === "nose")!.height![1],
      width: widthOf("nose"),
    },
    {
      name: "hood-start",
      x: Math.max(0.01, center("hoodStart")),
      height: chosenHood,
      width: widthOf("hood"),
    },
    {
      name: "hood-end",
      x: cabinStart,
      height: chosenHood,
      width: widthOf("hood"),
    },
    { name: "roof-start", x: roofStart, height: 1, width: widthOf("roof") },
    { name: "roof-end", x: roofEnd, height: 1, width: widthOf("roof") },
    {
      name: "rear-window-end",
      x: cabinEnd,
      height: chosenTail,
      width: widthOf("tail"),
    },
    { name: "tail", x: 1, height: chosenTail, width: widthOf("tail") },
  ].map((s) => ({
    ...s,
    evidenceImageIds: [...new Set(sections.flatMap((s) => s.imageIds))],
  }));
  const conflicts: string[] = [];
  if (calibration !== 1)
    conflicts.push("PHYSICAL_HEIGHT_ANCHOR_CALIBRATES_VISUAL_ROOF");
  for (const group of vision.landmarks2d ?? []) {
    const point = (name: string) => group.points.find((p) => p.name === name),
      mid = (v: [number, number]) => (v[0] + v[1]) / 2;
    const front = point("frontBumper"),
      rear = point("rearBumper");
    if (!front?.x || !rear?.x || Math.abs(mid(rear.x) - mid(front.x)) < 0.2) {
      conflicts.push("LANDMARK_LONGITUDINAL_ANCHOR_UNKNOWN");
      continue;
    }
    for (const name of ["frontAxle", "rearAxle"]) {
      const p = point(name),
        c = constraints.find((c) => c.name === name);
      if (!p?.x || !c) continue;
      const observed = (mid(p.x) - mid(front.x)) / (mid(rear.x) - mid(front.x));
      if (observed < c.min || observed > c.max)
        conflicts.push("LANDMARK_VS_NORMALIZED_" + name + "_CONFLICT");
    }
    const low = point("windshieldBase"),
      high = point("windshieldTop");
    if (low?.x && high?.x && Math.abs(mid(low.x) - mid(high.x)) < 0.01)
      conflicts.push("LANDMARK_GLASS_HORIZONTAL_EXTENT_UNKNOWN");
  }

  const fo = observation("frontOverhang"),
    ro = observation("rearOverhang");
  if (center("frontAxle") > fo.max || center("frontAxle") < fo.min)
    conflicts.push("FRONT_OVERHANG_VS_AXLE_OBSERVATION");
  if (1 - center("rearAxle") > ro.max || 1 - center("rearAxle") < ro.min)
    conflicts.push("REAR_OVERHANG_VS_AXLE_OBSERVATION");
  if (observation("roofHeight").max < 1)
    conflicts.push("ROOF_HEIGHT_NORMALIZATION_CONFLICT");
  if (chosenHood * height < wheelRadiusLdu * 2)
    conflicts.push("HOOD_HEIGHT_BELOW_NATIVE_WHEEL_TOP");
  return {
    version: BODY_PLAN_VERSION,
    coordinateSystem:
      "native LDraw: X lateral, Y down, Z front(-) to rear(+); ground Y=0",
    units: "LDU",
    dimensionsMm: dimensions,
    dimensionSources: research.measurements,
    scaleLduPerMm: scale,
    widthStuds: choice.widthStuds,
    widthChoices: choices,
    conflicts,
    length,
    width,
    height,
    axleFront,
    axleRear,
    wheelRadiusLdu,
    groundClearance: (center("groundClearance") / calibration) * height,
    cabinStart,
    cabinEnd,
    roofStart,
    roofEnd,
    profile: solvedProfile,
    observedSections: profile,
    rawVisualSections: rawSections,
    heightCalibration: {
      factor: 1 / calibration,
      roofObservation: rawRoof.height,
      anchor: "authoritative physical total vehicle height",
      assumption:
        "visual section/roof ratios treated as design estimates; raw output remains unchanged and original visual intervals are not all satisfied",
    },
    selectionPolicy:
      "Choose upper hood/deck height inside observed intervals to maximize wheel clearance; use guaranteed flat hardtop interior between roofStart.max and roofEnd.min; keep unresolved angular conflicts explicit",
    constraints,
    features: vision.features ?? [],
    imageIds: [...ids],
    quantization: {
      longitudinalLdu: 20,
      lateralLdu: 20,
      verticalLdu: 8,
      comparisonToleranceLdu: {
        length: 20,
        width: 0,
        height: 12,
        wheelbase: 20,
        hoodLength: 20,
        cabinStart: 20,
        cabinEnd: 20,
        frontOverhang: 20,
        rearOverhang: 20,
      },
      basis:
        "one native stud longitudinal, one plate plus stud vertical; fixed before generation",
    },
    scope: "design-estimate-not-assembly-proof" as const,
  };
}
export type BodyPlan = ReturnType<typeof bodyPlan>;
export function sampleProfile(plan: BodyPlan, t: number) {
  const points = plan.profile;
  let a = points[0],
    b = points[points.length - 1];
  if (t <= a.x) return { height: a.height, width: a.width };
  if (t >= b.x) return { height: b.height, width: b.width };
  for (let i = 1; i < points.length; i++)
    if (t <= points[i].x) {
      a = points[i - 1];
      b = points[i];
      break;
    }
  const f = (t - a.x) / (b.x - a.x);
  return {
    height: a.height + (b.height - a.height) * f,
    width: a.width + (b.width - a.width) * f,
  };
}
