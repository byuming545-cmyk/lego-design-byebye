import { useEffect, useState } from "react";
import NativeAssemblyViewer, {
  type AssemblyAsset,
  type AssemblyPlacement,
} from "../components/NativeAssemblyViewer.js";
import type { Job } from "../vehicles/types.js";
export default function VehicleGenerator() {
  const [support, setSupport] = useState<{
    model: { placements: AssemblyPlacement[] };
    assets: Record<string, AssemblyAsset>;
  }>();
  const [make, setMake] = useState("Dodge"),
    [model, setModel] = useState("Charger"),
    [year, setYear] = useState(1969),
    [variant, setVariant] = useState("R/T"),
    [job, setJob] = useState<Job>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const id = new URL(window.location.href).searchParams.get("job");
    if (!id) return;
    const controller = new AbortController();
    fetch("/api/vehicles/jobs/" + encodeURIComponent(id), {
      signal: controller.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw Error("保存任务不可用");
        setJob(await r.json());
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(String(e));
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!job || job.state !== "running") return;
    const controller = new AbortController();
    const timer = setInterval(() => {
      fetch("/api/vehicles/jobs/" + job.id, { signal: controller.signal })
        .then(async (r) => {
          if (!r.ok) throw Error("任务查询失败");
          setJob(await r.json());
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(String(e));
        });
    }, 2000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [job?.id, job?.state]);
  useEffect(() => {
    setSupport(undefined);
    if (!job?.assembly || job.state === "running") return;
    const controller = new AbortController();
    fetch("/api/vehicles/jobs/" + job.id + "/model", {
      signal: controller.signal,
    })
      .then(async (r) => {
        if (r.ok) setSupport(await r.json());
      })
      .catch(() => {});
    return () => controller.abort();
  }, [job?.id, job?.state]);
  async function generate() {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/vehicles/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ make, model, year, variant }),
      });
      const data = await r.json();
      if (!r.ok) throw Error(data.error);
      setJob(data);
      const url = new URL(window.location.href);
      url.searchParams.set("job", data.id);
      window.history.replaceState({}, "", url);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main style={{ maxWidth: 960, margin: "3rem auto", padding: "1.5rem" }}>
      <p>BRICKLAB · VEHICLE RESEARCH</p>
      <h1>从真实车型，开始自动设计</h1>
      <p>
        自动检索尺寸与许可图片、分析视觉约束，再接入真实零件装配。当前输出为研究与局部结构，完整汽车仍在开发中。
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void generate();
        }}
        style={{ display: "flex", gap: 12, flexWrap: "wrap" }}
      >
        <label>
          品牌
          <input
            required
            maxLength={100}
            value={make}
            onChange={(e) => setMake(e.target.value)}
          />
        </label>
        <label>
          型号
          <input
            required
            maxLength={100}
            value={model}
            onChange={(e) => setModel(e.target.value)}
          />
        </label>
        <label>
          年份
          <input
            type="number"
            required
            min={1886}
            max={new Date().getFullYear() + 1}
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          />
        </label>
        <label>
          版本
          <input
            maxLength={100}
            value={variant}
            onChange={(e) => setVariant(e.target.value)}
          />
        </label>
        <button disabled={busy || job?.state === "running"}>生成</button>
      </form>
      {error && <p role="alert">{error}</p>}
      {job && (
        <section aria-live="polite">
          <h2>任务状态：{job.state}</h2>
          <p>任务编号：{job.id}</p>
          <ol>
            {job.events.map((event, i) => (
              <li key={i}>
                {event.stage} · {event.state}：{event.detail}
              </li>
            ))}
          </ol>
          {job.research && (
            <>
              <h2>研究证据</h2>
              <p>
                {job.research.measurements.length} 项尺寸记录，
                {job.research.images.length} 张候选图片。标题匹配未作视觉确认。
              </p>
              <ul>
                {job.research.sources.map((s) => (
                  <li key={s.id}>
                    <a href={s.url} target="_blank" rel="noreferrer">
                      {s.scope}
                    </a>{" "}
                    · {s.sha256}
                  </li>
                ))}
              </ul>
              <ul>
                {job.research.images.map((image) => (
                  <li key={image.id}>
                    <a href={image.page} target="_blank" rel="noreferrer">
                      {image.title}
                    </a>{" "}
                    · {image.author} · {image.license}
                  </li>
                ))}
              </ul>
            </>
          )}
          {job.plan !== undefined && (
            <>
              <h2>设计目标（未完成整车）</h2>
              <pre style={{ whiteSpace: "pre-wrap" }}>
                {JSON.stringify(job.plan, null, 2)}
              </pre>
            </>
          )}
          {job.assembly !== undefined && (
            <>
              <h2>独立局部支撑回归</h2>
              <p>不是完整车型，轮组与实物稳定性未验证。</p>
              {support && (
                <>
                  <div style={{ position: "relative" }}>
                    <NativeAssemblyViewer
                      placements={support.model.placements}
                      assets={support.assets}
                      showConnections={false}
                      showProxies={false}
                      showPath={false}
                      showZones={false}
                    />
                  </div>
                  <a
                    href={
                      "/api/vehicles/jobs/" + job.id + "/model?download=json"
                    }
                  >
                    下载当前复验的局部模型 JSON
                  </a>
                </>
              )}
              <details>
                <summary>模型、BOM、步骤和重导入结果</summary>
                <pre style={{ whiteSpace: "pre-wrap" }}>
                  {JSON.stringify(job.assembly, null, 2)}
                </pre>
              </details>
            </>
          )}
        </section>
      )}
    </main>
  );
}
