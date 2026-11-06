export interface VehicleInput {
  make: string;
  model: string;
  year: number;
  variant: string;
}
export interface Source {
  id: string;
  url: string;
  retrievedAt: string;
  sha256: string;
  scope: string;
  text: string;
}
export interface Measurement {
  key: "length" | "width" | "height" | "wheelbase";
  mm: number;
  sourceId: string;
  scope: "generation-body";
  applicableYears: number[];
  variant: "unconfirmed";
  evidence: string;
}
export interface VehicleImage {
  id: string;
  title: string;
  page: string;
  url: string;
  sha256: string;
  mime: string;
  author: string;
  license: string;
  licenseUrl: string;
  localFile: string;
  identity: "title-candidate";
  view: "unknown";
}
export interface Research {
  input: VehicleInput;
  sources: Source[];
  measurements: Measurement[];
  images: VehicleImage[];
  issues: string[];
}
export interface VisionResult {
  schemaVersion: 1;
  identity: "confirmed" | "uncertain" | "wrong";
  imageAssessments: {
    imageId: string;
    view: "front" | "rear" | "side" | "top" | "oblique" | "unknown";
    identity: "confirmed" | "uncertain" | "wrong";
    modified: boolean;
    features: string[];
  }[];
  constraints: {
    name:
      | "hoodLength"
      | "cabinStart"
      | "cabinEnd"
      | "roofHeight"
      | "frontOverhang"
      | "rearOverhang";
    min: number;
    max: number;
    imageIds: string[];
  }[];
  uncertainty: string[];
}
export type Stage = "research" | "vision" | "planning" | "assembly";
export interface Event {
  at: string;
  stage: Stage;
  state: "running" | "passed" | "partial" | "blocked" | "skipped" | "failed";
  detail: string;
}
export interface Job {
  id: string;
  input: VehicleInput;
  state: "running" | "partial" | "blocked" | "failed";
  events: Event[];
  research?: Research;
  vision?: VisionResult;
  plan?: unknown;
  assembly?: unknown;
  error?: string;
}
export function parseInput(value: unknown): VehicleInput {
  const v = value as VehicleInput;
  if (
    !v ||
    typeof v !== "object" ||
    Object.keys(v).some(
      (k) => !["make", "model", "year", "variant"].includes(k),
    ) ||
    !Number.isInteger(v.year) ||
    v.year < 1886 ||
    v.year > new Date().getFullYear() + 1 ||
    ["make", "model", "variant"].some(
      (k) =>
        typeof v[k as keyof VehicleInput] !== "string" ||
        String(v[k as keyof VehicleInput]).length > 100,
    ) ||
    !v.make.trim() ||
    !v.model.trim()
  )
    throw Error("INVALID_VEHICLE_INPUT");
  return {
    make: v.make.trim(),
    model: v.model.trim(),
    year: v.year,
    variant: v.variant.trim(),
  };
}
