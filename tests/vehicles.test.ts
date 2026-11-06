import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtemp, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  parseInput,
  type Research,
  type VisionResult,
} from "../src/vehicles/types.js";
import {
  parseMeasurements,
  titleVariantMatch,
} from "../src/vehicles/research.js";
import { validateVision } from "../src/vehicles/vision-contract.js";
import {
  analyzeVehicle,
  visionConfig,
} from "../src/vehicles/vision-provider.js";
import { planVehicle } from "../src/vehicles/planner.js";
import { boundedFetch, hash } from "../src/vehicles/network.js";
const input = { make: "Dodge", model: "Charger", year: 1969, variant: "R/T" };
const ids = ["a", "b", "c"];
const vision: VisionResult = {
  schemaVersion: 1,
  identity: "confirmed",
  imageAssessments: ids.map((imageId, i) => ({
    imageId,
    view: i === 0 ? "side" : "front",
    identity: "confirmed",
    modified: false,
    features: ["visible body silhouette"],
  })),
  constraints: [
    "hoodLength",
    "cabinStart",
    "cabinEnd",
    "roofHeight",
    "frontOverhang",
    "rearOverhang",
  ].map((name, i) => ({
    name: name as VisionResult["constraints"][number]["name"],
    min: i === 2 ? 0.7 : 0.2,
    max: i === 2 ? 0.8 : 0.3,
    imageIds: ["a"],
  })),
  uncertainty: ["Exact trim remains uncertain"],
};
const research: Research = {
  input,
  sources: [],
  images: [],
  issues: [],
  measurements: (["length", "width", "height", "wheelbase"] as const).map(
    (key, i) => ({
      key,
      mm: [5000, 1900, 1350, 2900][i],
      sourceId: "s",
      scope: "generation-body",
      applicableYears: [1968, 1970],
      variant: "unconfirmed",
      evidence: "source text",
    }),
  ),
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("vehicle recovery contracts", () => {
  it("validates and normalizes generic input without a vehicle catalog", () => {
    expect(
      parseInput({
        ...input,
        make: " Chevrolet ",
        model: "Camaro",
        year: 1967,
      }),
    ).toMatchObject({ make: "Chevrolet", model: "Camaro" });
    expect(() => parseInput({ ...input, year: 1 })).toThrow();
    expect(() => parseInput({ ...input, apiKey: "bad" })).toThrow();
  });
  it("isolates generation infoboxes and retains conflicting observations", () => {
    const text =
      "{{Infobox automobile\n| production = 1968–1970\n| length = {{convert|208|in|mm}}\n| width = {{convert|1900|mm}}\n}}\n{{Infobox automobile\n| production = 2006–2010\n| length = {{convert|9999|mm}}\n}}";
    const found = parseMeasurements(text, "s", 1969);
    expect(found.map((x) => x.mm)).toEqual([5283.2, 1900]);
    expect(parseMeasurements(text, "s", 1985)).toEqual([]);
    expect(
      parseMeasurements("| length = {{convert|5000|mm}}", "s", 1969),
    ).toEqual([]);
  });
  it("does not confuse trim tokens with unrelated words", () => {
    expect(titleVariantMatch("1969 Charger R-T front", "R/T")).toBe(true);
    expect(titleVariantMatch("1969 Charger Daytona sports", "R/T")).toBe(false);
  });
  it("filters explicit short year ranges within a generation", () => {
    const text =
      "{{Infobox automobile\n| model_years = 1968–1970\n| length = {{convert|208|in}} (1968-69)<br/>{{convert|207.9|in}} (1970)\n}}";
    expect(parseMeasurements(text, "s", 1969).map((x) => x.mm)).toEqual([
      5283.2,
    ]);
  });
  it("accepts complete bounded image-linked output", () => {
    expect(validateVision(vision, ids)).toEqual(vision);
  });
  it.each([
    "unknown-image",
    "nonfinite",
    "range",
    "extra",
    "duplicate",
    "missing-image",
  ])("rejects invalid vision evidence: %s", (kind) => {
    const v = structuredClone(vision) as any;
    if (kind === "unknown-image") v.constraints[0].imageIds = ["x"];
    if (kind === "nonfinite") v.constraints[0].min = NaN;
    if (kind === "range") v.constraints[0].max = 2;
    if (kind === "extra") v.authorizeLego = true;
    if (kind === "duplicate") v.imageAssessments.push(v.imageAssessments[0]);
    if (kind === "missing-image") v.imageAssessments.pop();
    expect(() => validateVision(v, ids)).toThrow();
  });
  it("does not convert targets into assembly or physical proof", () => {
    expect(planVehicle(research, vision)).toMatchObject({
      status: "design-targets-only",
      completeCar: false,
      bodyWidthStuds: 8,
      wheelAssembly: "BLOCKED_SOURCE_AND_MATE_EVIDENCE",
      stability: "UNKNOWN",
    });
    expect(
      planVehicle(
        {
          ...research,
          measurements: [
            ...research.measurements,
            { ...research.measurements[0], mm: 9999 },
          ],
        },
        vision,
      ).reasons,
    ).toContain("DIMENSION_MISSING_OR_CONFLICT_length");
  });
  it("rejects identity and view insufficiency even with title matches", () => {
    expect(
      planVehicle(research, {
        ...vision,
        identity: "uncertain",
        imageAssessments: vision.imageAssessments.map((x) => ({
          ...x,
          view: "side",
        })),
      }).reasons,
    ).toContain("INSUFFICIENT_CONFIRMED_VIEWS");
  });
  it("uses fixed providers without credential fallback", () => {
    vi.stubEnv("VEHICLE_VISION_PROVIDER", "dashscope");
    vi.stubEnv("DASHSCOPE_REGION", "singapore");
    vi.stubEnv("OPENAI_API_KEY", "other-provider-test");
    vi.stubEnv("DASHSCOPE_API_KEY", "");
    expect(visionConfig()).toMatchObject({
      provider: "dashscope",
      region: "singapore",
      key: "",
    });
    vi.stubEnv("DASHSCOPE_REGION", "arbitrary-host");
    expect(() => visionConfig()).toThrow();
  });
  it("refuses unknown destinations before sending credentials", async () => {
    const fake = vi.fn();
    vi.stubGlobal("fetch", fake);
    await expect(boundedFetch("https://example.com")).rejects.toThrow("UNSAFE");
    expect(fake).not.toHaveBeenCalled();
  });
  it("limits response bytes and preserves HTTP denial", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response("abcd"))
        .mockResolvedValueOnce(new Response("", { status: 403 })),
    );
    await expect(
      boundedFetch("https://upload.wikimedia.org/test", {}, 3),
    ).rejects.toThrow("RESPONSE_TOO_LARGE");
    await expect(boundedFetch("https://en.wikipedia.org/test")).rejects.toThrow(
      "HTTP_403",
    );
  });
  it("blocks missing key and disabled budgets without a paid request", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "vehicle-budget-"));
    const r = { ...research, images: ids.map((id) => ({ id })) } as Research;
    const config = {
      provider: "dashscope" as const,
      region: "beijing" as const,
      model: "qwen3-vl-plus",
      maxRequests: 1,
      dailyBudget: 1,
      reserve: 1,
    };
    await expect(analyzeVehicle(r, dir, dir, config)).rejects.toThrow(
      "CREDENTIAL",
    );
    await expect(
      analyzeVehicle(r, dir, dir, {
        ...config,
        key: "test-only",
        maxRequests: 0,
      }),
    ).rejects.toThrow("BUDGET_DISABLED");
  });
  it("sends one bounded nonthinking request and replays cache without a second call", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "vehicle-call-"));
    const { writeFile } = await import("node:fs/promises");
    const images = [];
    for (const [i, id] of ids.entries()) {
      const bytes = Buffer.from("fixture-image-" + i),
        sha256 = hash(bytes);
      await writeFile(path.join(dir, id + ".image"), bytes);
      images.push({ id, sha256, localFile: id + ".image", mime: "image/jpeg" });
    }
    const r = { ...research, images } as Research;
    const fake = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            model: "qwen3-vl-plus",
            choices: [
              {
                finish_reason: "stop",
                message: { content: JSON.stringify(vision) },
              },
            ],
            usage: { completion_tokens: 100 },
          }),
        ),
      );
    vi.stubGlobal("fetch", fake);
    const config = {
      provider: "dashscope" as const,
      region: "beijing" as const,
      model: "qwen3-vl-plus",
      key: "test-only",
      maxRequests: 1,
      dailyBudget: 100,
      reserve: 100,
    };
    expect(await analyzeVehicle(r, dir, dir, config)).toEqual(vision);
    expect(await analyzeVehicle(r, dir, dir, config)).toEqual(vision);
    expect(fake).toHaveBeenCalledTimes(1);
    const [url, options] = fake.mock.calls[0];
    expect(url.hostname).toBe("dashscope.aliyuncs.com");
    expect(JSON.parse(options.body)).toMatchObject({
      max_tokens: 4000,
      enable_thinking: false,
      response_format: { type: "json_object" },
    });
    await expect(
      analyzeVehicle(
        { ...r, input: { ...input, variant: "different" } },
        dir,
        dir,
        config,
      ),
    ).rejects.toThrow("DAILY_LIMIT");
    expect(fake).toHaveBeenCalledTimes(1);
  });
});
