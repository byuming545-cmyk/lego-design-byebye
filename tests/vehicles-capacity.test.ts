import { it, expect, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const gates = vi.hoisted(() => ({ release: [] as (() => void)[] }));
vi.mock("../src/vehicles/research.js", () => ({
  researchVehicle: vi.fn(async (input) => {
    await new Promise<void>((resolve) => gates.release.push(resolve));
    return {
      input,
      sources: [],
      measurements: [],
      images: [],
      issues: ["offline-fixture"],
    };
  }),
}));
vi.mock("../src/vehicles/native-assembly.js", () => ({
  VehicleNativeAssembly: class {
    async generate() {
      return {
        status: "blocked",
        reasons: ["fixture-no-native-model"],
        model: null,
      };
    }
  },
}));
import { VehicleService } from "../src/vehicles/service.js";
it("reserves capacity before asynchronous task persistence and releases it after completion", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "vehicle-capacity-")),
    service = new VehicleService(dir),
    input = { make: "Dodge", model: "Charger", year: 1969, variant: "R/T" };
  const first = service.create(input),
    second = service.create(input);
  await expect(service.create(input)).rejects.toThrow("TASK_CAPACITY");
  const [a, b] = await Promise.all([first, second]);
  await vi.waitFor(() => expect(gates.release).toHaveLength(2));
  for (const release of gates.release) release();
  expect((await service.wait(a.id)).state).toBe("blocked");
  expect((await service.wait(b.id)).state).toBe("blocked");
  const third = await service.create(input);
  await vi.waitFor(() => expect(gates.release).toHaveLength(3));
  gates.release[2]();
  expect((await service.wait(third.id)).state).toBe("blocked");
});
