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
  purpose?: "reference-photo" | "generated-preview";
  originalSha256?: string;
  originalFile?: string;
  perceptualHash?: string;
  identity: "title-candidate";
  view: "unknown";
}
export interface Research {
  input: VehicleInput;
  sources: Source[];
  measurements: Measurement[];
  images: VehicleImage[];
  issues: string[];
  analysisPurpose?: "public-photo-landmarks";
  imageAudit?: { title: string; reason: string }[];
}
export interface VisionResult {
  schemaVersion: 1 | 2 | 3;
  identity: "confirmed" | "uncertain" | "wrong";
  imageAssessments: {
    imageId: string;
    view:
      | "front"
      | "rear"
      | "side"
      | "top"
      | "oblique"
      | "interior"
      | "unknown";
    identity: "confirmed" | "uncertain" | "wrong";
    modified: boolean;
    features: string[];
    duplicateOf?: string | null;
    vehicleType?: "photo" | "scale-model" | "unknown";
  }[];
  constraints: {
    name:
      | "hoodLength"
      | "cabinStart"
      | "cabinEnd"
      | "roofHeight"
      | "frontOverhang"
      | "rearOverhang"
      | "frontAxle"
      | "rearAxle"
      | "hoodStart"
      | "hoodEnd"
      | "roofStart"
      | "roofEnd"
      | "wheelRadius"
      | "groundClearance"
      | "windshieldAngle"
      | "rearWindowAngle";
    min: number;
    max: number;
    imageIds: string[];
    unit?: "lengthFraction" | "heightFraction" | "widthFraction" | "degrees";
  }[];
  sections?: {
    name: "nose" | "hood" | "windshield" | "roof" | "rearWindow" | "tail";
    x: [number, number];
    height: [number, number] | null;
    width: [number, number] | null;
    imageIds: string[];
  }[];
  features?: { name: string; description: string; imageIds: string[] }[];
  landmarks2d?: {
    imageId: string;
    points: {
      name: string;
      x: [number, number] | null;
      y: [number, number] | null;
    }[];
  }[];
  uncertainty: string[];
}
export type Stage =
  | "research"
  | "vision"
  | "planning"
  | "assembly"
  | "images"
  | "selection"
  | "generation"
  | "validation"
  | "output";
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
  preview?: unknown;
  craftOptions?: import("./design-cases.js").CraftOptions;
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
