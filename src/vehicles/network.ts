import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
export const hash = (v: string | Uint8Array) =>
  createHash("sha256").update(v).digest("hex");
const hosts = new Set([
  "en.wikipedia.org",
  "commons.wikimedia.org",
  "upload.wikimedia.org",
  "thumb.wikimedia.org",
  "dashscope.aliyuncs.com",
  "dashscope-intl.aliyuncs.com",
  "api.openai.com",
]);
const backoff = new Map<string, number>();
export async function boundedFetch(
  url: string,
  init: RequestInit = {},
  max = 4_000_000,
): Promise<{ bytes: Buffer; mime: string; retrievedAt: string }> {
  const u = new URL(url);
  if (
    u.protocol !== "https:" ||
    !hosts.has(u.hostname) ||
    u.username ||
    u.password ||
    u.port
  )
    throw Error("UNSAFE_DESTINATION");
  const cacheDir = path.join(
    process.env.BRICKLAB_DATA_DIR ?? "data",
    "vehicle-platform",
    "http-cache",
  );
  const cacheFile = path.join(cacheDir, hash(url) + ".json");
  const cacheable = !init.method || init.method === "GET";
  if (cacheable) {
    try {
      const cached = JSON.parse(await readFile(cacheFile, "utf8"));
      const bytes = Buffer.from(cached.base64, "base64");
      if (hash(bytes) !== cached.sha256) throw Error("HTTP_CACHE_INTEGRITY");
      if (bytes.length > max) throw Error("RESPONSE_TOO_LARGE");
      if (Date.now() - Date.parse(cached.retrievedAt) < 86400000)
        return { bytes, mime: cached.mime, retrievedAt: cached.retrievedAt };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
  const cooldownDir = path.join(
    process.env.BRICKLAB_DATA_DIR ?? "data",
    "vehicle-platform",
    "network-cooldowns",
  );
  const cooldownFile = path.join(cooldownDir, u.hostname + ".json");
  try {
    const saved = JSON.parse(await readFile(cooldownFile, "utf8"));
    backoff.set(
      u.hostname,
      Math.max(backoff.get(u.hostname) ?? 0, Number(saved.until) || 0),
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT")
      throw Error("NETWORK_COOLDOWN_UNREADABLE");
  }
  if ((backoff.get(u.hostname) ?? 0) > Date.now())
    throw Error("UPSTREAM_BACKOFF");
  const r = await fetch(u, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(init.method === "POST" ? 180000 : 45000),
  });
  if (!r.ok) {
    if (r.status === 403 || r.status === 429) {
      const retry = r.headers.get("retry-after"),
        seconds =
          retry && /^\d+$/.test(retry)
            ? Number(retry) * 1000
            : retry
              ? Date.parse(retry) - Date.now()
              : 60000;
      const until =
        Date.now() +
        Math.max(
          60000,
          Math.min(86400000, Number.isFinite(seconds) ? seconds : 60000),
        );
      backoff.set(u.hostname, until);
      await mkdir(cooldownDir, { recursive: true });
      await writeFile(
        cooldownFile,
        JSON.stringify({ until, status: r.status }),
      );
    }
    await r.body?.cancel();
    throw Error(`UPSTREAM_HTTP_${r.status}`);
  }
  const reader = r.body?.getReader();
  if (!reader) throw Error("EMPTY_BODY");
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.length;
      if (size > max) {
        await reader.cancel();
        throw Error("RESPONSE_TOO_LARGE");
      }
      parts.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = Buffer.concat(parts),
    mime = r.headers.get("content-type") ?? "",
    retrievedAt = new Date().toISOString();
  if (cacheable) {
    await mkdir(cacheDir, { recursive: true });
    const temporary = cacheFile + "." + randomUUID() + ".tmp";
    await writeFile(
      temporary,
      JSON.stringify({
        base64: bytes.toString("base64"),
        sha256: hash(bytes),
        mime,
        retrievedAt,
      }),
    );
    await rename(temporary, cacheFile);
  }
  return { bytes, mime, retrievedAt };
}
export async function wiki(
  host: string,
  params: Record<string, string>,
): Promise<{ data: any; url: string; bytes: Buffer; retrievedAt: string }> {
  const url =
    `https://${host}/w/api.php?` +
    new URLSearchParams({ format: "json", formatversion: "2", ...params });
  const { bytes, retrievedAt } = await boundedFetch(url, {
    headers: {
      "User-Agent":
        "BricklabVehicleResearch/1.0 (source-attributed development prototype)",
    },
  });
  const data = JSON.parse(bytes.toString());
  if (data.error) throw Error("WIKI_API_ERROR_" + String(data.error.code));
  return { data, url, bytes, retrievedAt };
}
