import compression from "compression";
import { Router } from "express";
import { VehicleService } from "./service.js";
export function createVehicleRouter(service = new VehicleService()) {
  const router = Router();
  router.use(compression());
  router.post('/jobs/:id/structure-revisions',async(req,res,next)=>{
    try{
      if(!req.body||Object.keys(req.body).join()!=='parentContentSha256')return void res.status(400).json({error:'STRUCTURE_INPUT'});
      res.status(201).json(await service.reviseStructure(req.params.id,req.body.parentContentSha256));
    }catch(e){if(e instanceof Error&&/STRUCTURE_|PREVIEW_|NO_CAR/.test(e.message))res.status(e.message==='STRUCTURE_CAPACITY'?429:409).json({error:e.message});else next(e);}
  });
  router.get('/jobs/:id/structure-revisions/:digest',async(req,res,next)=>{
    try{res.json(await service.structureRevision(req.params.id,req.params.digest));}
    catch(e){if(e instanceof Error&&/STRUCTURE_|PREVIEW_|NO_CAR/.test(e.message))res.status(409).json({error:e.message});else if((e as NodeJS.ErrnoException).code==='ENOENT')res.status(404).json({error:'STRUCTURE_NOT_FOUND'});else next(e);}
  });
  router.post("/jobs/:id/designs", async (req,res,next)=>{
    try {res.status(201).json({status:"COLOUR_DRAFT_SAVED_NOT_FORMAL",draft:await service.saveDesign(req.params.id,req.body)});}
    catch(e){if(e instanceof SyntaxError||(e instanceof Error&&/DESIGN_|PREVIEW_|NO_CAR_PREVIEW/.test(e.message)))res.status(409).json({error:e instanceof Error?e.message:"DESIGN_IMPORT_FAILED"});else if((e as NodeJS.ErrnoException).code==="ENOENT")res.status(404).json({error:"JOB_OR_DESIGN_NOT_FOUND"});else next(e);}
  });
  router.get("/jobs/:id/designs/:digest",async(req,res,next)=>{
    try {res.json({status:"COLOUR_DRAFT_REOPENED_NOT_FORMAL",draft:await service.design(req.params.id,req.params.digest)});}
    catch(e){if(e instanceof Error&&/DESIGN_|PREVIEW_/.test(e.message))res.status(409).json({error:e.message});else if((e as NodeJS.ErrnoException).code==="ENOENT")res.status(404).json({error:"JOB_OR_DESIGN_NOT_FOUND"});else next(e);}
  });
  router.get("/jobs", async (_req, res, next) => {
    try {
      res.json({ jobs: await service.list() });
    } catch (e) {
      next(e);
    }
  });
  router.get("/jobs/:id/preview", async (req, res, next) => {
    try {
      const p = await service.preview(req.params.id);
      if (req.query.download === "json") {
        res.setHeader(
          "Content-Disposition",
          "attachment; filename=vehicle-appearance.json",
        );
        res.json(p.model);
      } else if (req.query.download === "bom") {
        res.setHeader(
          "Content-Disposition",
          "attachment; filename=vehicle-bom.csv",
        );
        res
          .type("text/csv")
          .send(
            "part_id,name,ldraw_design_color,quantity,color_availability\r\n" +
              p.model.bom
                .map((x) =>
                  [
                    x.partId,
                    x.name,
                    x.ldrawColor,
                    x.quantity,
                    x.colorAvailability,
                  ]
                    .map((v) => '"' + String(v).replaceAll('"', '""') + '"')
                    .join(","),
                )
                .join("\r\n"),
          );
      } else res.json(p);
    } catch (e) {
      if (e instanceof Error && /NO_CAR_PREVIEW|PREVIEW_/.test(e.message))
        res.status(409).json({ error: e.message });
      else next(e);
    }
  });
  router.post("/jobs/:id/preview/import", async (req, res, next) => {
    try {
      if (
        typeof req.body?.content !== "string" ||
        req.body.content.length > 8e6 ||
        Object.keys(req.body).length !== 1
      )
        throw Error("PREVIEW_IMPORT_INPUT");
      const p = await service.preview(
        req.params.id,
        JSON.parse(req.body.content),
      );
      res.json({ status: "APPEARANCE_REOPENED_NOT_FORMAL", model: p.model });
    } catch (e) {
      if (
        e instanceof SyntaxError ||
        (e instanceof Error && /PREVIEW_|NO_CAR_PREVIEW/.test(e.message))
      )
        res.status(409).json({
          error: e instanceof Error ? e.message : "PREVIEW_IMPORT_FAILED",
        });
      else next(e);
    }
  });
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
        ["INVALID_VEHICLE_INPUT", "CRAFT_OPTIONS_INVALID", "TASK_CAPACITY"].includes(e.message)
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
