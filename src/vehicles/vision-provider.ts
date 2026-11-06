import {
  rememberImageFeedback,
  rememberSuccessfulResearch,
  successfulResearch,
} from "./image-feedback.js";
import {
  loadCampaign,
  reserveCampaign,
  estimateCny,
  type Campaign,
} from "./campaign-budget.js";
import { mkdir, readFile, writeFile, rmdir } from "node:fs/promises";
import path from "node:path";
import { boundedFetch, hash } from "./network.js";
import {
  validateVision,
  VISION_PROMPT,
  REVIEW_PROMPT,
  PUBLIC_LANDMARK_PROMPT,
} from "./vision-contract.js";
import type { Research, VisionResult } from "./types.js";
export interface VisionConfig {
  provider: "dashscope" | "openai";
  region: "beijing" | "singapore";
  model: string;
  key?: string;
  maxRequests: number;
  dailyBudget: number;
  reserve: number;
  campaign?: Campaign;
}
export function visionConfig(): VisionConfig {
  const provider = process.env.VEHICLE_VISION_PROVIDER ?? "dashscope",
    region = process.env.DASHSCOPE_REGION ?? "beijing";
  if (
    !["dashscope", "openai"].includes(provider) ||
    !["beijing", "singapore"].includes(region)
  )
    throw Error("INVALID_VISION_CONFIGURATION");
  const integer = (name: string) => {
    const v = Number(process.env[name] ?? 0);
    if (!Number.isSafeInteger(v) || v < 0) throw Error("INVALID_BUDGET");
    return v;
  };
  return {
    provider: provider as VisionConfig["provider"],
    region: region as VisionConfig["region"],
    model:
      provider === "dashscope"
        ? (process.env.DASHSCOPE_VISION_MODEL ?? "qwen3-vl-plus")
        : (process.env.VEHICLE_OPENAI_MODEL ?? "gpt-4.1-mini"),
    key:
      provider === "dashscope"
        ? process.env.DASHSCOPE_API_KEY
        : process.env.OPENAI_API_KEY,
    maxRequests: integer("VEHICLE_VISION_MAX_REQUESTS_PER_DAY"),
    dailyBudget: integer("VEHICLE_VISION_DAILY_BUDGET_MICRO_USD"),
    reserve: integer("VEHICLE_VISION_RESERVE_MICRO_USD"),
    campaign: loadCampaign(),
  };
}
export async function analyzeVehicle(
  research: Research,
  imagesDirectory: string,
  stateDirectory: string,
  config = visionConfig(),
): Promise<VisionResult> {
  if (research.images.length < 3) throw Error("VISION_INSUFFICIENT_IMAGES");
  const prompt =
    research.analysisPurpose === "public-photo-landmarks"
      ? PUBLIC_LANDMARK_PROMPT
      : research.images.some((x) => x.purpose === "generated-preview")
        ? REVIEW_PROMPT
        : VISION_PROMPT;
  const digest = hash(
    JSON.stringify({
      input: research.input,
      images: research.images.map((x) => x.id),
      provider: config.provider,
      region: config.region,
      model: config.model,
      prompt: prompt,
      transport: "short-image-aliases-1",
    }),
  );
  const shared = await successfulResearch(research.input, hash(VISION_PROMPT));
  if (shared?.analysisDigest === digest && shared.vision)
    return validateVision(
      shared.vision,
      research.images.map((x) => x.id),
    );
  const cache = path.join(stateDirectory, "vision-cache");
  await mkdir(cache, { recursive: true });
  try {
    const cached = JSON.parse(
      await readFile(path.join(cache, digest + ".json"), "utf8"),
    );
    const validated = validateVision(
      cached,
      research.images.map((x) => x.id),
    );
    await rememberSuccessfulResearch(
      research,
      imagesDirectory,
      hash(VISION_PROMPT),
      validated,
      digest,
    );
    return validated;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  if (!config.key) throw Error("VISION_CREDENTIAL_MISSING");
  if (
    !config.campaign &&
    (config.maxRequests < 1 ||
      config.reserve < 1 ||
      config.dailyBudget < config.reserve)
  )
    throw Error("VISION_BUDGET_DISABLED");
  const aliases = new Map(
    research.images.map((x, i) => [
      config.campaign ? "p" + (i + 1) : x.id,
      x.id,
    ]),
  );
  const parts = [];
  for (const image of research.images) {
    const bytes = await readFile(path.join(imagesDirectory, image.localFile));
    if (hash(bytes) !== image.sha256) throw Error("IMAGE_INTEGRITY");
    parts.push(
      {
        type: "text",
        text:
          "imageId: " +
          [...aliases].find(([, id]) => id === image.id)![0] +
          "; purpose: " +
          (image.purpose ?? "reference-photo"),
      },
      {
        type: "image_url",
        image_url: {
          url: `data:${image.mime.split(";")[0]};base64,${bytes.toString("base64")}`,
        },
      },
    );
  }
  // Exclusive, persistent reservations across processes. Fail closed after any crash; no automatic retry.
  if (config.campaign) {
    if (
      config.provider !== config.campaign.provider ||
      config.region !== config.campaign.region ||
      config.model !== config.campaign.model
    )
      throw Error("CAMPAIGN_MODEL_MISMATCH");
    await reserveCampaign(config.campaign, digest);
  } else {
    const ledger = path.join(
      stateDirectory,
      "vision-budget",
      new Date().toISOString().slice(0, 10),
    );
    await mkdir(ledger, { recursive: true });
    const lock = path.join(ledger, "reservation.lock");
    try {
      await mkdir(lock);
    } catch {
      throw Error("VISION_BUDGET_LOCKED");
    }
    try {
      let previous: { requests: number; reserved: number } = {
        requests: 0,
        reserved: 0,
      };
      try {
        previous = JSON.parse(
          await readFile(path.join(ledger, "ledger.json"), "utf8"),
        );
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      if (
        !Number.isSafeInteger(previous.requests) ||
        !Number.isSafeInteger(previous.reserved) ||
        previous.requests < 0 ||
        previous.reserved < 0
      )
        throw Error("VISION_LEDGER_INVALID");
      if (
        previous.requests >= config.maxRequests ||
        previous.reserved + config.reserve > config.dailyBudget
      )
        throw Error("VISION_DAILY_LIMIT");
      await writeFile(
        path.join(ledger, "ledger.json"),
        JSON.stringify({
          requests: previous.requests + 1,
          reserved: previous.reserved + config.reserve,
        }),
      );
    } finally {
      await rmdir(lock);
    }
  }
  const endpoint =
    config.provider === "openai"
      ? "https://api.openai.com/v1/chat/completions"
      : config.region === "beijing"
        ? "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
        : "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions";
  const body = {
    model: config.model,
    max_tokens: config.campaign?.maxOutputTokens ?? 4000,
    response_format: { type: "json_object" },
    ...(config.provider === "dashscope" ? { enable_thinking: false } : {}),
    messages: [
      { role: "system", content: prompt },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: JSON.stringify(
              research.images.some((x) => x.purpose === "generated-preview")
                ? {
                    vehicle: research.input,
                    physicalDimensionsMm: research.measurements.map((x) => ({
                      name: x.key,
                      mm: x.mm,
                      scope: x.scope,
                    })),
                    note: "wheelbase/length is a physical reference; visual observations must remain consistent within their uncertainty",
                  }
                : research.input,
            ),
          },
          ...parts,
        ],
      },
    ],
  };
  await writeFile(
    path.join(cache, digest + ".request.json"),
    JSON.stringify(
      {
        ...body,
        messages: [
          { role: "system", content: prompt },
          {
            role: "user",
            input: research.input,
            imageIds: research.images.map((x) => x.id),
            imageAliasMap: Object.fromEntries(aliases),
          },
        ],
      },
      null,
      2,
    ),
  );
  try {
    const { bytes } = await boundedFetch(
      endpoint,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + config.key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
      2_000_000,
    );
    await writeFile(path.join(cache, digest + ".response.json"), bytes);
    const response = JSON.parse(bytes.toString()),
      choice = response.choices?.[0];
    await writeFile(
      path.join(cache, digest + ".usage.json"),
      JSON.stringify({
        model: response.model,
        usage: response.usage,
        provider: config.provider,
        region: config.region,
        maxOutputTokens: body.max_tokens,
        reserveMicroUsd: config.reserve,
        actualPrice: "estimated-from-published-rates-not-invoice",
        campaign: config.campaign?.campaign,
        estimatedCny:
          config.campaign && response.usage
            ? estimateCny(
                response.usage.prompt_tokens,
                response.usage.completion_tokens,
                config.campaign,
              )
            : null,
      }),
    );
    if (choice?.finish_reason !== "stop")
      throw Error("VISION_TRUNCATED_OR_FILTERED");
    const parsed = JSON.parse(choice.message.content);
    await rememberImageFeedback(research, parsed, aliases);
    const transport = validateVision(parsed, [...aliases.keys()]);
    const expand = (ids: string[]) => ids.map((id) => aliases.get(id)!);
    const result: VisionResult = {
      ...transport,
      ...(transport.landmarks2d
        ? {
            landmarks2d: transport.landmarks2d.map((g) => ({
              ...g,
              imageId: aliases.get(g.imageId)!,
            })),
          }
        : {}),
      imageAssessments: transport.imageAssessments.map((x) => ({
        ...x,
        imageId: aliases.get(x.imageId)!,
        ...(x.duplicateOf ? { duplicateOf: aliases.get(x.duplicateOf)! } : {}),
      })),
      constraints: transport.constraints.map((x) => ({
        ...x,
        imageIds: expand(x.imageIds),
      })),
      ...(transport.sections
        ? {
            sections: transport.sections.map((x) => ({
              ...x,
              imageIds: expand(x.imageIds),
            })),
          }
        : {}),
      ...(transport.features
        ? {
            features: transport.features.map((x) => ({
              ...x,
              imageIds: expand(x.imageIds),
            })),
          }
        : {}),
    };
    validateVision(
      result,
      research.images.map((x) => x.id),
    );
    await writeFile(path.join(cache, digest + ".json"), JSON.stringify(result));
    await rememberSuccessfulResearch(
      research,
      imagesDirectory,
      hash(VISION_PROMPT),
      result,
      digest,
    );
    return result;
  } catch (e) {
    await writeFile(
      path.join(cache, digest + ".error.json"),
      JSON.stringify({
        error: e instanceof Error ? e.message : "VISION_FAILED",
        at: new Date().toISOString(),
      }),
    );
    throw e;
  }
}
