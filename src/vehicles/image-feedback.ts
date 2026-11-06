import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { hash } from "./network.js";
import type { Research, VehicleInput, VisionResult } from "./types.js";
const file = (input: VehicleInput) =>
  path.join(
    process.env.BRICKLAB_DATA_DIR ?? "data",
    "vehicle-platform",
    "image-feedback",
    hash(JSON.stringify(input)) + ".json",
  );
/** Negative selection hints only. Never accepts profile measurements or grants identity/assembly proof from a failed contract. */
export async function rememberImageFeedback(
  research: Research,
  value: unknown,
  aliases: Map<string, string>,
) {
  const v = value as { imageAssessments?: unknown };
  if (!Array.isArray(v?.imageAssessments)) return;
  const rejected = [] as {
    originalSha256: string;
    title: string;
    reason: string;
  }[];
  for (const raw of v.imageAssessments) {
    if (!raw || typeof raw !== "object") continue;
    const a = raw as Record<string, unknown>,
      id = typeof a.imageId === "string" ? aliases.get(a.imageId) : undefined,
      image = research.images.find((x) => x.id === id);
    if (!image) continue;
    const reason =
      a.identity === "wrong"
        ? "provider-wrong-identity"
        : a.vehicleType === "scale-model"
          ? "provider-scale-model"
          : a.view === "interior"
            ? "provider-interior"
            : a.modified === true
              ? "provider-modified"
              : typeof a.duplicateOf === "string" && aliases.has(a.duplicateOf)
                ? "provider-near-duplicate"
                : null;
    if (reason)
      rejected.push({
        originalSha256: image.originalSha256 ?? image.sha256,
        title: image.title,
        reason,
      });
  }
  const filename = file(research.input);
  await mkdir(path.dirname(filename), { recursive: true });
  let previous: { rejected: typeof rejected } = { rejected: [] };
  try {
    previous = JSON.parse(await readFile(filename, "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  await writeFile(
    filename,
    JSON.stringify(
      {
        input: research.input,
        scope: "negative-candidate-selection-only",
        rejected: [
          ...new Map(
            [...previous.rejected, ...rejected].map((x) => [
              x.originalSha256,
              x,
            ]),
          ).values(),
        ],
      },
      null,
      2,
    ),
  );
}
export async function imageFeedback(input: VehicleInput): Promise<Set<string>> {
  try {
    const v = JSON.parse(await readFile(file(input), "utf8"));
    return new Set(
      v.rejected.map((x: { originalSha256: string }) => x.originalSha256),
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return new Set();
    throw e;
  }
}
export async function rememberSuccessfulResearch(
  research: Research,
  imagesDirectory: string,
  contractDigest: string,
  vision?: VisionResult,
  analysisDigest?: string,
) {
  const filename = path.join(
    process.env.BRICKLAB_DATA_DIR ?? "data",
    "vehicle-platform",
    "successful-research",
    hash(JSON.stringify(research.input)) + ".json",
  );
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(
    filename,
    JSON.stringify(
      {
        research,
        imagesDirectory: path.resolve(imagesDirectory),
        contractDigest,
        vision,
        analysisDigest,
        savedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}
export async function successfulResearch(
  input: VehicleInput,
  contractDigest: string,
) {
  try {
    const filename = path.join(
      process.env.BRICKLAB_DATA_DIR ?? "data",
      "vehicle-platform",
      "successful-research",
      hash(JSON.stringify(input)) + ".json",
    );
    const v = JSON.parse(await readFile(filename, "utf8"));
    if (
      v.contractDigest !== contractDigest ||
      Date.now() - Date.parse(v.savedAt) > 86400000
    )
      return undefined;
    return v as {
      research: Research;
      imagesDirectory: string;
      contractDigest: string;
      savedAt: string;
      vision?: VisionResult;
      analysisDigest?: string;
    };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw e;
  }
}
