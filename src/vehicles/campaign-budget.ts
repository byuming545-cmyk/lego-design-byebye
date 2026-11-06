import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile, rmdir } from "node:fs/promises";
import path from "node:path";
export interface Campaign {
  schemaVersion: 1;
  campaign: string;
  enabled: boolean;
  maxRequests: number;
  budgetFen: number;
  reserveFenPerRequest: number;
  provider: string;
  region: string;
  model: string;
  maxOutputTokens: number;
  priceSource: string;
  priceCheckedAt: string;
  priceTiersCnyPerMillionTokens: number[][];
  reservationBasis: string;
}
export function loadCampaign(): Campaign | undefined {
  try {
    const c = JSON.parse(
      readFileSync(
        process.env.VEHICLE_VISION_CAMPAIGN_FILE ??
          "config/vehicle-vision-budget.json",
        "utf8",
      ),
    ) as Campaign;
    if (
      c.schemaVersion !== 1 ||
      !/^[a-z0-9-]{1,80}$/.test(c.campaign) ||
      c.provider !== "dashscope" ||
      c.region !== "beijing" ||
      c.model !== "qwen3-vl-plus" ||
      !Number.isInteger(c.maxRequests) ||
      c.maxRequests < 0 ||
      c.maxRequests > 8 ||
      !Number.isInteger(c.budgetFen) ||
      c.budgetFen < 0 ||
      c.budgetFen > 500 ||
      !Number.isSafeInteger(c.reserveFenPerRequest) ||
      c.reserveFenPerRequest < 100 ||
      !Number.isSafeInteger(c.maxOutputTokens) ||
      c.maxOutputTokens < 1 ||
      c.maxOutputTokens > 6000
    )
      throw Error("INVALID_CAMPAIGN_BUDGET");
    return c;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw e;
  }
}
export async function reserveCampaign(c: Campaign, digest: string) {
  if (c.maxRequests > 8 || c.budgetFen > 500 || c.reserveFenPerRequest < 100)
    throw Error("INVALID_CAMPAIGN_BUDGET");
  if (!c.enabled || c.maxRequests < 1 || c.budgetFen < c.reserveFenPerRequest)
    throw Error("VISION_BUDGET_DISABLED");
  const root = path.join(
    process.env.BRICKLAB_DATA_DIR ?? "data",
    "vehicle-platform",
    "campaigns",
    c.campaign,
  );
  await mkdir(root, { recursive: true });
  const lock = path.join(root, "lock");
  try {
    await mkdir(lock);
  } catch {
    throw Error("VISION_BUDGET_LOCKED");
  }
  try {
    let ledger = { requests: 0, reservedFen: 0, attempts: [] as unknown[] };
    try {
      ledger = JSON.parse(
        await readFile(path.join(root, "ledger.json"), "utf8"),
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    if (
      !Number.isSafeInteger(ledger.requests) ||
      !Number.isSafeInteger(ledger.reservedFen) ||
      ledger.requests < 0 ||
      ledger.reservedFen < 0 ||
      !Array.isArray(ledger.attempts)
    )
      throw Error("VISION_LEDGER_INVALID");
    if (
      ledger.requests >= c.maxRequests ||
      ledger.reservedFen + c.reserveFenPerRequest > c.budgetFen
    )
      throw Error("VISION_CAMPAIGN_LIMIT");
    ledger.requests++;
    ledger.reservedFen += c.reserveFenPerRequest;
    ledger.attempts.push({
      digest,
      at: new Date().toISOString(),
      reservedFen: c.reserveFenPerRequest,
    });
    await writeFile(
      path.join(root, "ledger.json"),
      JSON.stringify(ledger, null, 2),
    );
    return { request: ledger.requests, reservedFen: ledger.reservedFen };
  } finally {
    await rmdir(lock);
  }
}
export function estimateCny(input: number, output: number, c: Campaign) {
  if (
    !Number.isSafeInteger(input) ||
    input < 0 ||
    !Number.isSafeInteger(output) ||
    output < 0
  )
    throw Error("USAGE_INVALID");
  const tier = c.priceTiersCnyPerMillionTokens.find((t) => input <= t[0]);
  if (!tier) throw Error("USAGE_CONTEXT_EXCEEDS_PRICE_TABLE");
  return (input * tier[1] + output * tier[2]) / 1e6;
}
