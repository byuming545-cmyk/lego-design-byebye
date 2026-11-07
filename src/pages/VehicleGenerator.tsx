import type { BodyPreview } from "../vehicles/body-preview.js";
import { bodyLayoutSvg } from "../vehicles/body-layout.js";
import "./vehicle-generator.css";
import { useEffect, useState } from "react";
import NativeAssemblyViewer, {
  type AssemblyAsset,
  type AssemblyPlacement,
} from "../components/NativeAssemblyViewer.js";
import type { Job } from "../vehicles/types.js";
export default function VehicleGenerator() {
  const [appearance, setAppearance] = useState<{
    model: BodyPreview;
    assets: Record<string, AssemblyAsset>;
    designColors: Record<string, string>;
  }>();
  const [view, setView] = useState<
    "perspective" | "front" | "rear" | "side" | "top"
  >("perspective");
  const [importStatus, setImportStatus] = useState("");
  const [saved, setSaved] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("bricklab-vehicle-jobs") ?? "[]");
    } catch {
      return [];
    }
  });

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
  useEffect(() => {
    setAppearance(undefined);
    if (!job?.preview || job.state === "running") return;
    const c = new AbortController();
    fetch("/api/vehicles/jobs/" + job.id + "/preview", { signal: c.signal })
      .then(async (r) => {
        if (!r.ok) throw Error((await r.json()).error);
        setAppearance(await r.json());
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(String(e));
      });
    return () => c.abort();
  }, [job?.id, job?.state]);
  async function importAppearance(file: File) {
    if (!job || file.size > 8e6) {
      setImportStatus("文件过大");
      return;
    }
    try {
      const r = await fetch(
        "/api/vehicles/jobs/" + job.id + "/preview/import",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: await file.text() }),
        },
      );
      const data = await r.json();
      if (!r.ok) throw Error(data.error);
      setImportStatus(data.status);
    } catch (e) {
      setImportStatus(String(e));
    }
  }
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
        自动检索尺寸与许可图片、分析视觉约束，再接入真实零件装配。依据真实视觉轮廓生成完整外观预览；外观、正式连接与实拼证据分别展示。
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
      {saved.length > 0 && (
        <nav className="vehicle-saved" aria-label="保存的车型任务">
          {saved.map((id) => (
            <a key={id} href={"/vehicle-generator?job=" + id}>
              重开 {id.slice(0, 8)}
            </a>
          ))}
        </nav>
      )}
      {job && (
        <button
          onClick={() => {
            const next = [job.id, ...saved.filter((id) => id !== job.id)].slice(
              0,
              10,
            );
            localStorage.setItem("bricklab-vehicle-jobs", JSON.stringify(next));
            setSaved(next);
          }}
        >
          保存当前任务
        </button>
      )}
      {appearance && job && (
        <section className="vehicle-result">
          <div>
            <h2>完整汽车外观预览</h2>
            <p>
              真实零件 · {appearance.model.placements.length} 件 /{" "}
              {appearance.model.sources.length} 种 ·{" "}
              {appearance.model.plan.widthStuds}{" "}
              格宽。整车连接、轮组配合、碰撞与稳定性尚未验证。
            </p>
          </div>
          <div className="vehicle-views">
            {(
              [
                ["perspective", "斜侧"],
                ["side", "侧面"],
                ["front", "正面"],
                ["rear", "背面"],
                ["top", "俯视"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                aria-pressed={view === id}
                onClick={() => setView(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <div data-testid="vehicle-preview-stage">
            <NativeAssemblyViewer
              placements={appearance.model.placements}
              assets={appearance.assets}
              designColors={appearance.designColors}
              view={view}
              showConnections={false}
              showProxies={false}
              showPath={false}
              showZones={false}
            />
          </div>
          <div className="vehicle-downloads">
            <a href={"/api/vehicles/jobs/" + job.id + "/preview?download=json"}>
              导出外观模型 JSON
            </a>
            <a href={"/api/vehicles/jobs/" + job.id + "/preview?download=bom"}>
              导出实际 BOM
            </a>
            <label>
              重新导入外观模型 JSON
              <input
                type="file"
                accept="application/json,.json"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void importAppearance(f);
                }}
              />
            </label>
            <span>{importStatus}</span>
          </div>
          <h3>尺寸比较（LDU）</h3>
          <details>
            <summary>侧面与俯视布局诊断</summary>
            <img style={{width:"100%"}} alt="侧面和俯视布局：灰色保留视觉区间，蓝色为选择轮廓" src={"data:image/svg+xml," + encodeURIComponent(bodyLayoutSvg(appearance.model.plan))} />
            <p>布局先于外壳规划；原始视觉区间、尺寸来源及冲突保留在导出模型中。轮拱机械净空仍未验证。</p>
          </details>
          <table>
            <thead>
              <tr>
                <th>项目</th>
                <th>目标</th>
                <th>实际实例</th>
                <th>误差</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(appearance.model.checks.target).map(
                ([key, value]) => (
                  <tr key={key}>
                    <td>
                      {{
                        length: "车长",
                        width: "车身宽",
                        height: "总高",
                        wheelbase: "轴距",
                        hoodLength: "机盖长度",
                        cabinStart: "座舱起点",
                        cabinEnd: "座舱终点",
                        frontOverhang: "前悬",
                        rearOverhang: "后悬",
                      }[key] ?? key}
                    </td>
                    <td>{value.toFixed(1)}</td>
                    <td>{appearance.model.checks.measured[key].toFixed(1)}</td>
                    <td>{appearance.model.checks.errors[key].toFixed(1)}</td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
          <p>
            容差在生成前按一格纵向、一个板高加凸点设定；配色为设计指定色，未核对实物供应。
          </p>
          <details>
            <summary>未验证范围与视觉估计冲突</summary>
            <ul>
              {appearance.model.checks.rejectionReasons.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </details>
          <h3>实际零件清单</h3>
          <details>
            <summary>
              {appearance.model.bom.length} 条编号＋设计颜色记录
            </summary>
            <table>
              <thead>
                <tr>
                  <th>编号</th>
                  <th>名称</th>
                  <th>颜色</th>
                  <th>数量</th>
                </tr>
              </thead>
              <tbody>
                {appearance.model.bom.map((x) => (
                  <tr key={x.partId + ":" + x.color}>
                    <td>{x.partId}</td>
                    <td>{x.name}</td>
                    <td>{x.ldrawColor}</td>
                    <td>{x.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
          <h3>步骤状态：外观分组草稿，非可实拼说明书</h3>
          <ol>
            {appearance.model.steps.items.map((x) => (
              <li key={x.step}>
                {x.role} · {x.instanceIds.length} 件
              </li>
            ))}
          </ol>
        </section>
      )}
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
              <details>
                <summary>查看约束与设计决策</summary>
                <pre style={{ whiteSpace: "pre-wrap" }}>
                  {JSON.stringify(job.plan, null, 2)}
                </pre>
              </details>
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
