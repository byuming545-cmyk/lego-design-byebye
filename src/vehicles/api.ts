import { Router } from "express";
import { VehicleService } from "./service.js";
export function createVehicleRouter(service = new VehicleService()) {
  const router = Router();
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  router.post("/jobs", async (req, res, next) => {
    try {
      const job = await service.create(req.body);
      res.status(202).json(job);
    } catch (e) {
      if (
        e instanceof Error &&
        ["INVALID_VEHICLE_INPUT", "TASK_CAPACITY"].includes(e.message)
      )
        res
          .status(e.message === "TASK_CAPACITY" ? 429 : 400)
          .json({ error: e.message });
      else next(e);
    }
  });
  router.get("/jobs/:id/model", async (req, res, next) => {
    try {
      const payload = await service.model(req.params.id);
      if (req.query.download === "json") {
        res.setHeader(
          "Content-Disposition",
          "attachment; filename=local-support.json",
        );
        res.json(payload.model);
      } else res.json(payload);
    } catch (e) {
      if (
        e instanceof Error &&
        ["NO_LOCAL_MODEL", "MODEL_REQUIRES_REVALIDATION"].includes(e.message)
      )
        res.status(409).json({ error: e.message });
      else if (
        (e as NodeJS.ErrnoException).code === "ENOENT" ||
        (e instanceof Error && e.message === "INVALID_JOB_ID")
      )
        res.status(404).json({ error: "JOB_NOT_FOUND" });
      else next(e);
    }
  });
  router.get("/jobs/:id", async (req, res, next) => {
    try {
      res.json(await service.get(req.params.id));
    } catch (e) {
      if (
        (e as NodeJS.ErrnoException).code === "ENOENT" ||
        (e instanceof Error && e.message === "INVALID_JOB_ID")
      )
        res.status(404).json({ error: "JOB_NOT_FOUND" });
      else next(e);
    }
  });
  return router;
}
