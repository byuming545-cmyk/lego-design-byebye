import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { hash } from "./network.js";
import { validateVision } from "./vision-contract.js";
import { parseInput, type Research, type VehicleInput, type VisionResult } from "./types.js";
import { stableJson } from "../mini-cars/catalog.js";
import { DEMO_CARS } from "./demo-catalog.js";

export const DEMO_EVIDENCE_VERSION = "vehicle-demo-evidence-1";
export const DEMO_MANIFEST_SHA256 = "3816b14486c3829c80235bdc3d621d943dab633cd36af443c0b87d44957f610e";
export interface ObservationProvenance {
  method: "cached-provider" | "local-photo-review";
  label: string;
  bundleDigest: string;
  manifestDigest: string;
  limitations: string[];
}
export async function loadDemoEvidence(input: VehicleInput, directory = "data/vehicle-demos") {
  const entry = DEMO_CARS.find(d => stableJson(d.input) === stableJson(input));
  if (!entry) return undefined;
  const manifestBytes = await readFile(path.join(directory, "manifest.json"));
  if (hash(manifestBytes) !== DEMO_MANIFEST_SHA256) throw Error("DEMO_MANIFEST_INTEGRITY");
  const manifest = JSON.parse(manifestBytes.toString());
  const record = manifest.entries.find((e: { id: string }) => e.id === entry.id);
  if (manifest.version !== DEMO_EVIDENCE_VERSION || stableJson(record?.input) !== stableJson(input)) throw Error("DEMO_INPUT_BINDING");
  const files = new Map<string, Buffer>();
  for (const file of record.files as { file: string; sha256: string }[]) {
    if (!/^(?:sources\/)?[a-zA-Z0-9_.-]+$/.test(file.file)) throw Error("DEMO_FILE_PATH");
    const bytes = await readFile(path.join(directory, entry.id, file.file));
    if (hash(bytes) !== file.sha256) throw Error("DEMO_SOURCE_INTEGRITY");
    files.set(file.file, bytes);
  }
  const bytes = files.get("evidence.json");
  if (!bytes) throw Error("DEMO_EVIDENCE_MISSING");
  const value = JSON.parse(bytes.toString()) as { research: Research; vision: VisionResult; provenance: Omit<ObservationProvenance, "bundleDigest" | "manifestDigest"> };
  if (stableJson(parseInput(value.research.input)) !== stableJson(input) || !["cached-provider", "local-photo-review"].includes(value.provenance.method)) throw Error("DEMO_EVIDENCE_BINDING");
  for (const image of value.research.images) {
    if (hash(files.get("sources/" + image.localFile) ?? "") !== image.sha256 || image.id !== image.sha256) throw Error("DEMO_IMAGE_INTEGRITY");
    if (!image.author || !/^CC BY|^CC0|^Public domain/.test(image.license)) throw Error("DEMO_IMAGE_LICENCE");
    if (image.originalFile && hash(files.get("sources/" + image.originalFile) ?? "") !== image.originalSha256) throw Error("DEMO_ORIGINAL_INTEGRITY");
  }
  for (const source of value.research.sources) {
    const raw = files.get("sources/" + source.id + ".wiki.json");
    if (!raw || hash(raw) !== source.sha256) throw Error("DEMO_DIMENSION_SOURCE_INTEGRITY");
  }
  const vision = validateVision(value.vision, value.research.images.map(i => i.id));
  const observation: ObservationProvenance = { ...value.provenance, bundleDigest: hash(bytes), manifestDigest: DEMO_MANIFEST_SHA256 };
  return { id: entry.id, research: { ...value.research, observation }, vision,
    async copySources(destination: string) {
      await mkdir(destination, { recursive: true });
      for (const [name, bytes] of files) if (name.startsWith("sources/")) await writeFile(path.join(destination, path.basename(name)), bytes);
    } };
}
