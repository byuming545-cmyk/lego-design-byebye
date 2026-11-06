import { it, expect } from "vitest";
import express from "express";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { VehicleService } from "../src/vehicles/service.js";
import { createVehicleRouter } from "../src/vehicles/api.js";
it("returns explicit invalid input and missing job responses over HTTP", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "vehicle-api-"));
  const app = express();
  app.use(express.json(), createVehicleRouter(new VehicleService(dir)));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as { port: number },
    base = "http://127.0.0.1:" + address.port;
  try {
    expect(
      (
        await fetch(base + "/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ year: 1969 }),
        })
      ).status,
    ).toBe(400);
    expect((await fetch(base + "/jobs/not-an-id")).status).toBe(404);
    expect((await fetch(base + "/jobs/" + randomUUID())).status).toBe(404);
  } finally {
    server.close();
    await once(server, "close");
  }
});
it("preserves interrupted jobs and never automatically retries a possible paid operation", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "vehicle-interrupted-")),
    id = randomUUID();
  await mkdir(path.join(dir, id));
  await writeFile(
    path.join(dir, id, "job.json"),
    JSON.stringify({
      id,
      input: { make: "Dodge", model: "Charger", year: 1969, variant: "R/T" },
      state: "running",
      events: [{ stage: "vision", state: "running" }],
    }),
  );
  const service = new VehicleService(dir);
  expect(await service.get(id)).toMatchObject({
    state: "blocked",
    error: "TASK_INTERRUPTED_NO_AUTOMATIC_RETRY",
  });
  expect(await new VehicleService(dir).get(id)).toMatchObject({
    state: "blocked",
  });
});
