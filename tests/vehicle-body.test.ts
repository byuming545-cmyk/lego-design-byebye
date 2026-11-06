import { beforeAll, describe, it, expect, vi, afterEach } from "vitest";
import { readFile, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { BodyCatalog } from "../src/vehicles/body-catalog.js";
import {
  generateBodyPreview,
  validateBodyPreview,
  type BodyPreview,
} from "../src/vehicles/body-preview.js";
import { bodyPlan } from "../src/vehicles/body-plan.js";
import { validateVision } from "../src/vehicles/vision-contract.js";
import {
  loadCampaign,
  reserveCampaign,
  estimateCny,
  type Campaign,
} from "../src/vehicles/campaign-budget.js";
import { VehicleNativeAssembly } from "../src/vehicles/native-assembly.js";
import { isRigidTransform } from "../src/parts/assembly/math.js";
import { miniDigest } from "../src/mini-cars/catalog.js";
import type { Research, VisionResult } from "../src/vehicles/types.js";
let research: Research,
  vision: VisionResult,
  model: BodyPreview,
  catalog: BodyCatalog;
beforeAll(async () => {
  const job = JSON.parse(
    await readFile(
      "artifacts/vehicle-body-2026-11-07/api-job-round-1.json",
      "utf8",
    ),
  );
  research = job.research;
  vision = job.vision;
  catalog = new BodyCatalog();
  model = await generateBodyPreview(catalog, research, vision);
}, 120000);
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("source-derived full vehicle preview", () => {
  it("uses the genuine analyzed image IDs and rejects unknown profile evidence", () => {
    expect(
      validateVision(
        vision,
        research.images.map((x) => x.id),
      ),
    ).toEqual(vision);
    const bad = structuredClone(vision);
    bad.sections![0].imageIds = ["not-a-source"];
    expect(() =>
      validateVision(
        bad,
        research.images.map((x) => x.id),
      ),
    ).toThrow();
  });
  it("keeps missing observations and identity/view failure blocked", () => {
    const missing = structuredClone(vision);
    missing.constraints = missing.constraints.filter(
      (x) => x.name !== "wheelRadius",
    );
    expect(() => bodyPlan(research, missing, 30)).toThrow(
      "MISSING_wheelRadius",
    );
    expect(() =>
      bodyPlan(research, { ...vision, identity: "uncertain" }, 30),
    ).toThrow("IDENTITY");
    expect(() =>
      bodyPlan(
        research,
        {
          ...vision,
          imageAssessments: vision.imageAssessments.map((x) => ({
            ...x,
            view: "front",
          })),
        },
        30,
      ),
    ).toThrow("VIEWS");
  });
  it("derives BOM and draft steps from every actual rigid instance, without claiming formal success", () => {
    expect(model.placements.length).toBeGreaterThan(60);
    expect(model.sources.length).toBeGreaterThan(10);
    expect(model.bom.reduce((n, x) => n + x.quantity, 0)).toBe(
      model.placements.length,
    );
    expect(model.steps.items.flatMap((x) => x.instanceIds).sort()).toEqual(
      model.placements.map((x) => x.instanceId).sort(),
    );
    expect(model.placements.every((x) => isRigidTransform(x.transform))).toBe(
      true,
    );
    expect(model.checks).toMatchObject({
      formalConnections: "NOT_VERIFIED",
      wheelFit: "UNKNOWN",
      collision: "UNKNOWN",
      stability: "UNKNOWN",
      physicalBuildVerified: false,
    });
    expect(model.steps.status).toBe("DRAFT_NOT_BUILD_INSTRUCTIONS");
    expect(model.checks.metricPass).toBe(true);
  });
  it("has a flat evidence-bounded roof, expresses glass with actual slopes, and records unresolved evidence conflicts", () => {
    expect(
      model.plan.profile
        .filter((x) => /roof/.test(x.name))
        .map((x) => x.height),
    ).toEqual([1, 1]);
    expect(model.sources.some((x) => /Slope/.test(x.name))).toBe(true);
    expect(model.checks.rejectionReasons).toContain(
      "HOOD_HEIGHT_BELOW_NATIVE_WHEEL_TOP",
    );
    expect(
      model.placements.every((x) =>
        x.decision.imageIds.every((id) =>
          research.images.some((i) => i.id === id),
        ),
      ),
    ).toBe(true);
  });
  it("changes geometry and selection when actual constraints change, rather than branching on the vehicle name", async () => {
    const changed = structuredClone(vision);
    const radius = changed.constraints.find((x) => x.name === "wheelRadius")!;
    radius.min = 0.3;
    radius.max = 0.34;
    const other = await generateBodyPreview(catalog, research, changed);
    expect(other.plan.widthStuds).not.toBe(model.plan.widthStuds);
    expect(other.placements.map((x) => [x.partId, x.transform])).not.toEqual(
      model.placements.map((x) => [x.partId, x.transform]),
    );
    const renamed = await generateBodyPreview(
      catalog,
      {
        ...research,
        input: { ...research.input, make: "Fixture", model: "Generic" },
      },
      vision,
    );
    expect(renamed.placements).toEqual(model.placements);
  }, 60000);
  it.each([
    "unknown-id",
    "scale",
    "mirror",
    "bom",
    "forged-validation",
    "source-hash",
  ])(
    "rejects %s even after an attacker recomputes the exported checksum",
    async (kind) => {
      const bad = structuredClone(model);
      if (kind === "unknown-id") bad.placements[0].partId = "not-a-real-id";
      if (kind === "scale") bad.placements[0].transform.rotation[0] = 2;
      if (kind === "mirror") bad.placements[0].transform.rotation[0] = -1;
      if (kind === "bom") bad.bom[0].quantity++;
      if (kind === "forged-validation")
        (bad.checks as any).formalConnections = "VALID";
      if (kind === "source-hash") bad.sources[0].meshSha256 = "0".repeat(64);
      const { contentSha256: _, ...rest } = bad;
      bad.contentSha256 = miniDigest(rest);
      await expect(
        validateBodyPreview(bad, catalog, research, vision),
      ).rejects.toThrow();
    },
    60000,
  );
  it("reopens deterministically and cannot be imported as a formally validated native assembly", async () => {
    expect(
      await validateBodyPreview(
        JSON.parse(JSON.stringify(model)),
        catalog,
        research,
        vision,
      ),
    ).toEqual(model);
    await expect(
      new VehicleNativeAssembly().importModel(model),
    ).rejects.toThrow();
  }, 60000);
  it("rejects unknown native identities before a source import", async () => {
    await expect(catalog.load(["fake-native-part"])).rejects.toThrow(
      "UNKNOWN_NATIVE_ID",
    );
  });
});
describe("finite CNY campaign accounting", () => {
  const campaign = (): Campaign => ({
    schemaVersion: 1,
    campaign: "test-" + randomUUID(),
    enabled: true,
    maxRequests: 2,
    budgetFen: 200,
    reserveFenPerRequest: 100,
    provider: "dashscope",
    region: "beijing",
    model: "qwen3-vl-plus",
    maxOutputTokens: 6000,
    priceSource: "official-fixture",
    priceCheckedAt: new Date().toISOString(),
    priceTiersCnyPerMillionTokens: [
      [32768, 1, 10],
      [131072, 1.5, 15],
      [262144, 3, 30],
    ],
    reservationBasis: "full context upper bound",
  });
  it("calculates actual usage at the matching official tier and rejects unknown usage", () => {
    const c = campaign();
    expect(estimateCny(12446, 6000, c)).toBeCloseTo(0.072446);
    expect(estimateCny(50000, 1000, c)).toBe(0.09);
    expect(() => estimateCny(300000, 1, c)).toThrow();
    expect(() => estimateCny(NaN, 1, c)).toThrow();
  });
  it("does not reset the aggregate campaign cap after a new job, cache directory, or date bucket", async () => {
    vi.stubEnv(
      "BRICKLAB_DATA_DIR",
      await mkdtemp(path.join(tmpdir(), "body-budget-")),
    );
    const c = campaign();
    await reserveCampaign(c, "a");
    await reserveCampaign(c, "b");
    await expect(reserveCampaign(c, "c")).rejects.toThrow("LIMIT");
    await expect(
      reserveCampaign({ ...c, enabled: false }, "d"),
    ).rejects.toThrow("DISABLED");
  });
  it("does not overreserve on concurrent attempts", async () => {
    vi.stubEnv(
      "BRICKLAB_DATA_DIR",
      await mkdtemp(path.join(tmpdir(), "body-budget-concurrent-")),
    );
    const c = { ...campaign(), maxRequests: 1, budgetFen: 100 };
    const results = await Promise.allSettled([
      reserveCampaign(c, "a"),
      reserveCampaign(c, "b"),
    ]);
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  });
  it("fails closed on malformed or widened campaign settings", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "body-budget-config-")),
      file = path.join(dir, "campaign.json");
    vi.stubEnv("VEHICLE_VISION_CAMPAIGN_FILE", file);
    await writeFile(file, JSON.stringify({ ...campaign(), maxRequests: 99 }));
    expect(() => loadCampaign()).toThrow("INVALID");
  });
});

it("preserves the genuine schema-3 observations while reporting calibration and inconsistent pixel landmarks", async () => {
  const j = JSON.parse(
    await readFile(
      "artifacts/vehicle-body-2026-11-07/api-job-final.json",
      "utf8",
    ),
  );
  const before = JSON.stringify(j.vision);
  expect(
    validateVision(
      j.vision,
      j.research.images.map((x: { id: string }) => x.id),
    ).schemaVersion,
  ).toBe(3);
  const p = bodyPlan(j.research, j.vision, 30);
  expect(p.rawVisualSections).toEqual(j.vision.sections);
  expect(p.heightCalibration.factor).toBeGreaterThan(1);
  expect(p.conflicts).toContain("LANDMARK_VS_NORMALIZED_frontAxle_CONFLICT");
  expect(JSON.stringify(j.vision)).toBe(before);
  const bad = structuredClone(j.vision);
  bad.landmarks2d[0].imageId = "unknown-photo";
  expect(() =>
    validateVision(
      bad,
      j.research.images.map((x: { id: string }) => x.id),
    ),
  ).toThrow("LANDMARK_IMAGE");
});
it("rejects an unknown zero-height calibration instead of manufacturing a roof", async () => {
  const j = JSON.parse(
    await readFile(
      "artifacts/vehicle-body-2026-11-07/api-job-final.json",
      "utf8",
    ),
  );
  const bad = structuredClone(j.vision);
  bad.sections.find((x: { name: string }) => x.name === "roof").height = [0, 0];
  expect(() => bodyPlan(j.research, bad, 30)).toThrow("CALIBRATION_UNKNOWN");
});
