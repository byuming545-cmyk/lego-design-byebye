import { it, expect, vi, afterEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { boundedFetch } from "../src/vehicles/network.js";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it("supports concurrent public cache writes and serves hash-checked retained bytes", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "vehicle-http-cache-"));
  vi.stubEnv("BRICKLAB_DATA_DIR", dir);
  const fake = vi
    .fn()
    .mockImplementation(
      async () =>
        new Response("cached-public-image", {
          headers: { "content-type": "image/jpeg" },
        }),
    );
  vi.stubGlobal("fetch", fake);
  const url = "https://thumb.wikimedia.org/cache-concurrency-test";
  const [a, b] = await Promise.all([boundedFetch(url), boundedFetch(url)]);
  expect(a.bytes.toString()).toBe("cached-public-image");
  expect(b.bytes.toString()).toBe("cached-public-image");
  const calls = fake.mock.calls.length;
  const cached = await boundedFetch(url);
  expect(cached.bytes.equals(a.bytes)).toBe(true);
  expect(fake).toHaveBeenCalledTimes(calls);
});
it("honors rate-limit cooldowns without retrying in a fresh request", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "vehicle-http-backoff-"));
  vi.stubEnv("BRICKLAB_DATA_DIR", dir);
  const fake = vi
    .fn()
    .mockResolvedValue(
      new Response("", { status: 429, headers: { "retry-after": "120" } }),
    );
  vi.stubGlobal("fetch", fake);
  await expect(
    boundedFetch("https://commons.wikimedia.org/cooldown-test"),
  ).rejects.toThrow("HTTP_429");
  await expect(
    boundedFetch("https://commons.wikimedia.org/another-request"),
  ).rejects.toThrow("UPSTREAM_BACKOFF");
  expect(fake).toHaveBeenCalledTimes(1);
});
