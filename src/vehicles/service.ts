import { BodyCatalog } from "./body-catalog.js";
import { craftOptions } from "./design-cases.js";
import { loadDemoEvidence } from "./demo-evidence.js";
import { createDesignDraft, validateDesignDraft } from "./appearance-design.js";
import {
  generateBodyPreview,
  validateBodyPreview,
  type BodyPreview,
} from "./body-preview.js";
import { MINI_COLORS } from "../mini-cars/types.js";
import { readdir } from "node:fs/promises";
import type { LDrawMesh } from "../parts/ldraw/types.js";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { VehicleNativeAssembly } from "./native-assembly.js";
import { researchVehicle } from "./research.js";
import { analyzeVehicle } from "./vision-provider.js";
import { planVehicle } from "./planner.js";
import { parseInput, type Job, type Stage, type Event } from "./types.js";
export class VehicleService {
  private active = new Map<string, Promise<void>>();
  private starting = 0;
  private bodyCatalog = new BodyCatalog();
  constructor(
    readonly directory = path.join(
      process.env.BRICKLAB_DATA_DIR ?? "data",
      "vehicle-platform",
    ),
    private assembly = new VehicleNativeAssembly(),
  ) {}
  private file(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw Error("INVALID_JOB_ID");
    return path.join(this.directory, id, "job.json");
  }
  private async save(job: Job) {
    const file = this.file(job.id);
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = file + "." + randomUUID() + ".tmp";
    await writeFile(tmp, JSON.stringify(job, null, 2));
    await rename(tmp, file);
  }
  async get(id: string): Promise<Job> {
    const job = JSON.parse(await readFile(this.file(id), "utf8")) as Job;
    if (job.state === "running" && !this.active.has(id))
      return {
        ...job,
        state: "blocked",
        error: "TASK_INTERRUPTED_NO_AUTOMATIC_RETRY",
      };
    return job;
  }
  async model(id: string) {
    const job = await this.get(id);
    const saved = (
      job.assembly as { generated?: { model?: unknown } } | undefined
    )?.generated?.model;
    if (!saved) throw Error("NO_LOCAL_MODEL");
    const checked = await this.assembly.importModel(saved);
    if (checked.status !== "VALID" || !checked.model)
      throw Error("MODEL_REQUIRES_REVALIDATION");
    const assets: Record<string, { mesh: LDrawMesh }> = {};
    for (const placement of checked.model.placements) {
      const part = await this.assembly.repository.getPart(placement.partId);
      if (!part?.geometry.mesh) throw Error("MODEL_SOURCE_UNAVAILABLE");
      assets[placement.partId] = { mesh: part.geometry.mesh };
    }
    return { scope: "local-support-only", model: checked.model, assets };
  }
  async list() {
    await mkdir(this.directory, { recursive: true });
    const entries = (
      await readdir(this.directory, { withFileTypes: true })
    ).filter((x) => x.isDirectory() && /^[a-f0-9-]{36}$/.test(x.name));
    return Promise.all(
      entries.slice(-50).map(async (x) => {
        const job = await this.get(x.name);
        return {
          id: job.id,
          input: job.input,
          state: job.state,
          hasPreview: !!job.preview,
        };
      }),
    );
  }
  async saveDesign(id: string, value: unknown) {
    const checked = await this.preview(id);
    const v = value as { content?: unknown; options?: unknown; parentContentSha256?: unknown };
    let draft;
    if (v && Object.keys(v).length === 1 && typeof v.content === "string" && v.content.length <= 8e6) {
      draft = await validateDesignDraft(JSON.parse(v.content), checked.model);
    } else {
      if (!v || Object.keys(v).sort().join() !== "options,parentContentSha256" || v.parentContentSha256 !== checked.model.contentSha256) throw Error("DESIGN_INPUT_OR_PARENT");
      draft = await createDesignDraft(checked.model, v.options);
    }
    const directory = path.join(path.dirname(this.file(id)), "designs");
    await mkdir(directory, { recursive: true });
    const file = path.join(directory, draft.contentSha256 + ".json"), bytes = JSON.stringify(draft, null, 2);
    try { await writeFile(file, bytes, { flag: "wx" }); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; if (await readFile(file,"utf8") !== bytes) throw Error("DESIGN_SAVED_CONTENT_CHANGED"); }
    return draft;
  }
  async design(id: string, digest: string) {
    if (!/^[a-f0-9]{64}$/.test(digest)) throw Error("DESIGN_ID_INVALID");
    const value=JSON.parse(await readFile(path.join(path.dirname(this.file(id)),"designs",digest+".json"),"utf8"));
    const checked=await this.preview(id),draft=await validateDesignDraft(value,checked.model);
    if(draft.contentSha256!==digest)throw Error("DESIGN_SAVED_CONTENT_CHANGED");
    return draft;
  }
  async preview(id: string, value?: unknown) {
    const job = await this.get(id);
    if (!job.preview || !job.research || !job.vision)
      throw Error("NO_CAR_PREVIEW");
    const model = await validateBodyPreview(
      value ?? job.preview,
      this.bodyCatalog,
      job.research,
      job.vision,
      job.craftOptions,
    );
    const parts = await this.bodyCatalog.load(
        model.sources.map((x) => x.partId),
      ),
      assets: Record<string, { mesh: LDrawMesh }> = {};
    for (const [id, p] of parts) assets[id] = { mesh: p.geometry.mesh! };
    return {
      scope: "complete-appearance-not-formal-assembly",
      model,
      assets,
      designColors: Object.fromEntries(
        model.placements.map((x) => [x.instanceId, MINI_COLORS[x.color].hex]),
      ),
    };
  }
  async create(value: unknown) {
    if (this.active.size + this.starting >= 2) throw Error("TASK_CAPACITY");
    const identity=value&&typeof value==="object"&&!Array.isArray(value)
      ?Object.fromEntries(Object.entries(value).filter(([key])=>key!=="craftOptions")):value;
    const job: Job = {
      id: randomUUID(),
      input: parseInput(identity),
      craftOptions:craftOptions((value as {craftOptions?:unknown})?.craftOptions),
      state: "running",
      events: [],
    };
    this.starting++;
    try {
      await this.save(job);
    } finally {
      this.starting--;
    }
    const task = this.run(job)
      .catch(() => {
        job.state = "failed";
        job.error = "TASK_STORAGE_FAILURE";
      })
      .finally(() => this.active.delete(job.id));
    this.active.set(job.id, task);
    return job;
  }
  async wait(id: string) {
    await this.active.get(id);
    return this.get(id);
  }
  private async run(job: Job) {
    const event = async (
      stage: Stage,
      state: Event["state"],
      detail: string,
    ) => {
      job.events.push({ at: new Date().toISOString(), stage, state, detail });
      await this.save(job);
    };
    let current: Stage = "research";
    try {
      await event(
        "research",
        "running",
        "Checking prepared local dossiers and year-scoped research sources",
      );
      const images = path.join(this.directory, job.id, "sources");
      const demo = await loadDemoEvidence(job.input);
      if (demo) await demo.copySources(images);
      job.research = demo?.research ?? await researchVehicle(job.input, images);
      await event(
        "research",
        job.research.issues.length ? "partial" : "passed",
        `${demo ? "使用已缓存资料；" : ""}${job.research.measurements.length} dimension observations; ${job.research.images.length} title-candidate images`,
      );
      await event(
        "images",
        "passed",
        `${job.research.images.filter((x) => x.purpose !== "generated-preview").length} reference candidates; original bytes, licensing and duplicate-selection audit retained`,
      );
      current = "vision";
      await event(
        "vision",
        "running",
        demo ? "Reading pinned cached observations; no provider request" : "Checking provider, cache, credentials and bounded budget",
      );
      try {
        job.vision = demo?.vision ?? await analyzeVehicle(job.research, images, this.directory);
        await event(
          "vision",
          "passed",
          demo ? demo.research.observation.label : "Provider response passed local contract validation",
        );
      } catch (e) {
        await event(
          "vision",
          "blocked",
          e instanceof Error ? e.message : "VISION_FAILED",
        );
      }
      current = "planning";
      if (job.vision) {
        job.plan = planVehicle(job.research, job.vision);
        await event(
          "planning",
          (job.plan as { status: string }).status === "blocked"
            ? "blocked"
            : "partial",
          "Quantified design targets; no complete vehicle assembly",
        );
      } else
        await event(
          "planning",
          "skipped",
          "Visual evidence unavailable; no invented body proportions",
        );
      if (job.vision && job.vision.schemaVersion >= 2) {
        try {
          const preview = await generateBodyPreview(
            this.bodyCatalog,
            job.research,
            job.vision,
            job.craftOptions,
            async (stage,state,detail) => { current=stage; await event(stage,state,detail); },
          );
          job.preview = preview;
          job.plan = preview.plan;
          await event(
            "generation",
            "passed",
            `${preview.placements.length} real instances / ${preview.sources.length} native identities; full appearance draft`,
          );
          current = "validation";
          await event(
            "validation",
            "partial",
            `Source/rigid checks passed; dimensional metrics ${preview.checks.metricPass ? "passed" : "failed"}; whole-car connections, wheels and stability remain unverified`,
          );
          await event(
            "output",
            "partial",
            "Full preview, source-backed BOM and draft steps saved; not build-certified",
          );
        } catch (e) {
          await event(
            current,
            "blocked",
            e instanceof Error ? e.message : "BODY_GENERATION_FAILED",
          );
        }
      }
      current = "assembly";
      await event(
        "assembly",
        "running",
        "Independent regression of existing native support; not a complete car",
      );
      const generated = await this.assembly.generate({
        module: "simple-chassis",
        partCount: 5,
        requiredPartIds: ["3028", "3024"],
      });
      if (generated.model) {
        const exported = structuredClone(generated.model),
          reimport = await this.assembly.importModel(exported);
        job.assembly = {
          scope: "local-support-only",
          generated,
          reimport,
          completeCar: false,
          physicalBuild: "UNKNOWN",
        };
        await event(
          "assembly",
          reimport.status === "VALID" ? "partial" : "blocked",
          "Local native model, BOM, steps and current reimport: " +
            reimport.status,
        );
      } else {
        job.assembly = generated;
        await event("assembly", "blocked", generated.reasons.join("; "));
      }
      job.state = job.vision ? "partial" : "blocked";
    } catch (e) {
      job.state = "failed";
      job.error = e instanceof Error ? e.message : "TASK_FAILED";
      await event(current, "failed", job.error);
    }
    await this.save(job);
  }
}
