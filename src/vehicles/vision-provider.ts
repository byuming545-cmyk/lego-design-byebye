import { mkdir, readFile, writeFile, rmdir } from "node:fs/promises";
import path from "node:path";
import { boundedFetch, hash } from "./network.js";
import { validateVision, VISION_PROMPT } from "./vision-contract.js";
import type { Research, VisionResult } from "./types.js";
export interface VisionConfig {
  provider: "dashscope" | "openai";
  region: "beijing" | "singapore";
  model: string;
  key?: string;
  maxRequests: number;
  dailyBudget: number;
  reserve: number;
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
  };
}
export async function analyzeVehicle(
  research: Research,
  imagesDirectory: string,
  stateDirectory: string,
  config = visionConfig(),
): Promise<VisionResult> {
  if (research.images.length < 3) throw Error("VISION_INSUFFICIENT_IMAGES");
  const digest = hash(
    JSON.stringify({
      input: research.input,
      images: research.images.map((x) => x.id),
      provider: config.provider,
      region: config.region,
      model: config.model,
      prompt: VISION_PROMPT,
    }),
  );
  const cache = path.join(stateDirectory, "vision-cache");
  await mkdir(cache, { recursive: true });
  try {
    const cached = JSON.parse(
      await readFile(path.join(cache, digest + ".json"), "utf8"),
    );
    return validateVision(
      cached,
      research.images.map((x) => x.id),
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  if (!config.key) throw Error("VISION_CREDENTIAL_MISSING");
  if (
    config.maxRequests < 1 ||
    config.reserve < 1 ||
    config.dailyBudget < config.reserve
  )
    throw Error("VISION_BUDGET_DISABLED");
  const parts = [];
  for (const image of research.images) {
    const bytes = await readFile(path.join(imagesDirectory, image.localFile));
    if (hash(bytes) !== image.sha256) throw Error("IMAGE_INTEGRITY");
    parts.push(
      { type: "text", text: "imageId: " + image.id },
      {
        type: "image_url",
        image_url: {
          url: `data:${image.mime.split(";")[0]};base64,${bytes.toString("base64")}`,
        },
      },
    );
  }
  // Exclusive, persistent reservations across processes. Fail closed after any crash; no automatic retry.
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
  const endpoint =
    config.provider === "openai"
      ? "https://api.openai.com/v1/chat/completions"
      : config.region === "beijing"
        ? "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
        : "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions";
  const body = {
    model: config.model,
    max_tokens: 4000,
    response_format: { type: "json_object" },
    ...(config.provider === "dashscope" ? { enable_thinking: false } : {}),
    messages: [
      { role: "system", content: VISION_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: JSON.stringify(research.input) },
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
          { role: "system", content: VISION_PROMPT },
          {
            role: "user",
            input: research.input,
            imageIds: research.images.map((x) => x.id),
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
        maxOutputTokens: 4000,
        reserveMicroUsd: config.reserve,
        actualPrice: "unknown",
      }),
    );
    if (choice?.finish_reason !== "stop")
      throw Error("VISION_TRUNCATED_OR_FILTERED");
    const result = validateVision(
      JSON.parse(choice.message.content),
      research.images.map((x) => x.id),
    );
    await writeFile(path.join(cache, digest + ".json"), JSON.stringify(result));
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
