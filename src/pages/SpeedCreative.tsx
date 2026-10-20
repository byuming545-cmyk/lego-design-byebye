import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Box,
  CarFront,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  FileJson,
  Gauge,
  Grid2X2,
  Layers3,
  LoaderCircle,
  LockKeyhole,
  MousePointer2,
  RotateCcw,
  RotateCw,
  ShieldCheck,
  Sparkles,
  Undo2,
  UnlockKeyhole,
  WandSparkles,
  X,
} from "lucide-react";
import ModelViewer from "../components/ModelViewer.js";
import {
  speedRenderingAdapter,
  toSpeedViewerParts,
} from "../speed/rendering.js";
import type {
  LocalRedesignResult,
  SpeedGenerationResult,
  SpeedExtraPart,
  SpeedInventory,
  SpeedPlacedPart,
  VehicleCandidate,
  VehicleDesignOptions,
  VehicleModuleId,
  VehicleStyle,
  VehicleType,
} from "../speed/types.js";
import "./speed.css";

interface SpeedSession extends SpeedGenerationResult {
  sessionId: string;
}
type BusyAction =
  | "inventory"
  | "generate"
  | "redesign"
  | "lock"
  | "undo"
  | "pdf"
  | null;
const vehicleLabels: Record<VehicleType, string> = {
  supercar: "Supercar · 超级跑车",
  "sports-car": "Sports Car · 运动跑车",
  gt: "GT · 长途跑车",
  concept: "Concept Car · 概念车",
};
const styleLabels: Record<VehicleStyle, string> = {
  modern: "Modern · 现代",
  futuristic: "Futuristic · 未来感",
  retro: "Retro · 复古",
  aggressive: "Aggressive · 激进",
  minimal: "Minimal · 简洁",
};
const moduleLabels: Record<VehicleModuleId, string> = {
  chassis: "底盘",
  front: "车头",
  rear: "车尾",
  cockpit: "驾驶舱",
  roof: "车顶",
  leftWheelModule: "左轮组",
  rightWheelModule: "右轮组",
  bodyShell: "车身外壳",
  aero: "空气动力学",
  details: "细节",
};
const editSuggestions = [
  "车头太高了",
  "尾翼小一点",
  "车尾更加激进",
  "驾驶舱不要改",
  "整辆车更低矮",
];
const extraColors: SpeedExtraPart["color"][] = [
  { id: 0, name: "黑色", hex: "#171717" },
  { id: 4, name: "红色", hex: "#C91A09" },
  { id: 15, name: "白色", hex: "#FFFFFF" },
  { id: 1, name: "蓝色", hex: "#0055BF" },
  { id: 14, name: "黄色", hex: "#F2CD37" },
];

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    signal: AbortSignal.timeout(90000),
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const data = await response
    .json()
    .catch(() => ({ error: "服务响应异常，请确认后端服务正常运行。" }));
  if (!response.ok) throw new Error(data.error || "请求未完成，请重试。");
  return data as T;
}
function failureText(failure: unknown): string {
  if (failure instanceof Error) {
    if (failure.name === "TimeoutError")
      return "请求超时，请缩小库存范围后重试。";
    if (failure.message === "Failed to fetch")
      return "暂时无法连接后端，请检查服务是否正在运行。";
    return failure.message;
  }
  return "操作未完成，请重试。";
}
function groupParts(parts: SpeedPlacedPart[]) {
  const groups = new Map<string, { part: SpeedPlacedPart; count: number }>();
  for (const part of parts) {
    const key = `${part.partId}:${part.color.id}`;
    const group = groups.get(key);
    if (group) group.count++;
    else groups.set(key, { part, count: 1 });
  }
  return [...groups.values()];
}
function decimal(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
function ChoiceToggle({
  checked,
  onChange,
  title,
  detail,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: string;
  detail: string;
  disabled: boolean;
}) {
  return (
    <label className="speed-toggle">
      <span>
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
      <input
        type="checkbox"
        aria-label={title}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <i aria-hidden="true">
        <span />
      </i>
    </label>
  );
}
function CheckLabel({
  valid,
  children,
}: {
  valid: boolean;
  children: React.ReactNode;
}) {
  return (
    <span className={valid ? "speed-check valid" : "speed-check invalid"}>
      {valid ? <Check size={12} /> : <CircleHelp size={12} />}
      {children}
    </span>
  );
}

export default function SpeedCreative() {
  const [setNumbers, setSetNumbers] = useState("DEMO-SPEED");
  const [loadedInput, setLoadedInput] = useState("DEMO-SPEED");
  const [inventory, setInventory] = useState<SpeedInventory | null>(null);
  const [session, setSession] = useState<SpeedSession | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [prompt, setPrompt] = useState(
    "未来感超级跑车，低矮、宽体，拥有清晰的车身轮廓。",
  );
  const [vehicleType, setVehicleType] = useState<VehicleType>("supercar");
  const [style, setStyle] = useState<VehicleStyle>("futuristic");
  const [minifigure, setMinifigure] = useState(false);
  const [priority, setPriority] =
    useState<VehicleDesignOptions["priority"]>("structure");
  const [maximizeUsage, setMaximizeUsage] = useState(false);
  const [busy, setBusy] = useState<BusyAction>("inventory");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [view, setView] = useState<"model" | "steps">("model");
  const [stepIndex, setStepIndex] = useState(0);
  const [showGrid, setShowGrid] = useState(true);
  const [exploded, setExploded] = useState(false);
  const [viewerVersion, setViewerVersion] = useState(0);
  const [editPrompt, setEditPrompt] = useState("");
  const [undoDepths, setUndoDepths] = useState<Record<string, number>>({});
  const [expandedInventory, setExpandedInventory] = useState(false);
  const [extraParts, setExtraParts] = useState<SpeedExtraPart[]>([]);
  const [loadedExtras, setLoadedExtras] = useState<SpeedExtraPart[]>([]);
  const [extraPartId, setExtraPartId] = useState("");
  const [extraColorId, setExtraColorId] = useState("0");
  const [extraQuantity, setExtraQuantity] = useState("1");

  const candidate =
    session?.candidates.find((item) => item.model.id === selectedId) ||
    session?.candidates[0];
  const activeInventory = session?.inventory || inventory;
  const currentStep = candidate?.steps[stepIndex];
  const visibleParts =
    view === "steps"
      ? currentStep?.totalModelState || []
      : candidate?.model.parts || [];
  const viewerParts = useMemo(
    () => toSpeedViewerParts(visibleParts),
    [visibleParts],
  );
  const highlightIds = useMemo(
    () =>
      view === "steps"
        ? currentStep?.addedParts.map((part) => part.instanceId)
        : undefined,
    [currentStep, view],
  );
  const inventoryDirty =
    setNumbers.trim() !== loadedInput.trim() ||
    JSON.stringify(extraParts) !== JSON.stringify(loadedExtras);
  const undoDepth = candidate ? undoDepths[candidate.model.id] || 0 : 0;
  const selectedUsage = useMemo(
    () =>
      new Map(
        candidate?.model.inventoryUsage.map((item) => [
          `${item.partId}:${item.colorId}`,
          item.quantityUsed,
        ]) || [],
      ),
    [candidate],
  );

  async function load(value = setNumbers, extras = extraParts) {
    setBusy("inventory");
    setError("");
    setNotice("");
    try {
      const data = extras.length
        ? await request<SpeedInventory>("/api/speed/inventory", {
            method: "POST",
            body: JSON.stringify({ setNumbers: value, extraParts: extras }),
          })
        : await request<SpeedInventory>(
            `/api/speed/inventory?sets=${encodeURIComponent(value)}`,
          );
      setInventory(data);
      setLoadedInput(value);
      setLoadedExtras(structuredClone(extras));
      setSession(null);
      setSelectedId("");
      setStepIndex(0);
      setView("model");
      setUndoDepths({});
    } catch (failure) {
      setError(failureText(failure));
    } finally {
      setBusy(null);
    }
  }
  useEffect(() => {
    void load("DEMO-SPEED");
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 6000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  function addExtraPart(event: React.FormEvent) {
    event.preventDefault();
    if (busy || extraParts.length >= 100) return;
    const partId = extraPartId.trim();
    const quantity = Number(extraQuantity);
    const color = extraColors.find((item) => item.id === Number(extraColorId));
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(partId)) {
      setError("散件编号仅允许字母、数字、点、下划线和短横线，最长 80 字符。");
      return;
    }
    if (
      !color ||
      !Number.isSafeInteger(quantity) ||
      quantity < 1 ||
      quantity > 1000
    ) {
      setError("请选择散件颜色，并填写 1–1000 的整数数量。");
      return;
    }
    setExtraParts((previous) => [
      ...previous,
      { partId, color: { ...color }, quantity },
    ]);
    setExtraPartId("");
    setExtraQuantity("1");
    setError("");
  }
  function removeExtraPart(index: number) {
    if (busy) return;
    setExtraParts((previous) => previous.filter((_, row) => row !== index));
  }

  async function generate(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !inventory || inventoryDirty) return;
    setBusy("generate");
    setError("");
    setNotice("");
    const options: VehicleDesignOptions = {
      prompt: prompt.trim(),
      vehicleType,
      style,
      minifigure,
      priority,
      maximizeUsage,
    };
    try {
      const data = await request<SpeedSession>("/api/speed/generate", {
        method: "POST",
        body: JSON.stringify({
          setNumbers: inventory.inventorySources
            .filter((source) => source.source !== "custom")
            .map((source) => source.setNumber),
          options,
          ...(loadedExtras.length ? { extraParts: loadedExtras } : {}),
        }),
      });
      if (!data.candidates.length)
        throw new Error("当前库存未能生成通过全部校验的车辆，请调整条件。");
      if (data.candidates.some((item) => !item.validation.valid))
        throw new Error("返回的方案未通过全部校验，已保留原设计。");
      setSession(data);
      setSelectedId(data.candidates[0].model.id);
      setStepIndex(0);
      setView("model");
      setExploded(false);
      setUndoDepths({});
      setNotice(`已生成 ${data.candidates.length} 个通过全部校验的设计。`);
    } catch (failure) {
      setError(failureText(failure));
    } finally {
      setBusy(null);
    }
  }
  function replaceCandidate(
    next: VehicleCandidate,
    beforeId: string,
    undoDepth?: number,
  ) {
    if (!next.validation.valid)
      throw new Error("修改结果未通过全部校验，已保留原设计。");
    setSession((previous) =>
      previous
        ? {
            ...previous,
            candidates: previous.candidates.map((item) =>
              item.model.id === beforeId ? next : item,
            ),
          }
        : previous,
    );
    setSelectedId(next.model.id);
    setStepIndex(0);
    setView("model");
    setExploded(false);
    if (undoDepth !== undefined)
      setUndoDepths((previous) => ({
        ...previous,
        [next.model.id]: undoDepth,
      }));
  }
  async function setLocked(moduleId: VehicleModuleId, locked: boolean) {
    if (busy || !session || !candidate) return;
    setBusy("lock");
    setError("");
    try {
      const result = await request<{
        candidate: VehicleCandidate;
        undoDepth?: number;
      }>(
        `/api/speed/designs/${encodeURIComponent(session.sessionId)}/modules/${moduleId}`,
        {
          method: "PATCH",
          body: JSON.stringify({ candidateId: candidate.model.id, locked }),
        },
      );
      replaceCandidate(result.candidate, candidate.model.id, result.undoDepth);
      setNotice(`${moduleLabels[moduleId]}已${locked ? "锁定" : "解锁"}。`);
    } catch (failure) {
      setError(failureText(failure));
    } finally {
      setBusy(null);
    }
  }
  async function redesign(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !session || !candidate || !editPrompt.trim()) return;
    setBusy("redesign");
    setError("");
    setNotice("");
    try {
      const result = await request<
        LocalRedesignResult & { undoDepth?: number }
      >(
        `/api/speed/designs/${encodeURIComponent(session.sessionId)}/redesign`,
        {
          method: "POST",
          body: JSON.stringify({
            candidateId: candidate.model.id,
            prompt: editPrompt.trim(),
          }),
        },
      );
      if (result.success) {
        const fallbackDepth =
          result.candidate.model.version !== candidate.model.version
            ? undoDepth + 1
            : undoDepth;
        replaceCandidate(
          result.candidate,
          candidate.model.id,
          result.undoDepth ?? fallbackDepth,
        );
        setNotice(result.message);
        setEditPrompt("");
      } else {
        setError(
          `${result.message}${result.rolledBack ? " 已保留修改前的方案。" : ""}`,
        );
      }
    } catch (failure) {
      setError(failureText(failure));
    } finally {
      setBusy(null);
    }
  }
  async function undo() {
    if (busy || !session || !candidate) return;
    setBusy("undo");
    setError("");
    try {
      const result = await request<{
        candidate: VehicleCandidate;
        undoDepth?: number;
      }>(`/api/speed/designs/${encodeURIComponent(session.sessionId)}/undo`, {
        method: "POST",
        body: JSON.stringify({ candidateId: candidate.model.id }),
      });
      replaceCandidate(
        result.candidate,
        candidate.model.id,
        result.undoDepth ?? Math.max(0, undoDepth - 1),
      );
      setNotice("已恢复到上一个版本。");
    } catch (failure) {
      setError(failureText(failure));
    } finally {
      setBusy(null);
    }
  }
  async function exportPdf() {
    if (!candidate || !activeInventory) return;
    setBusy("pdf");
    setError("");
    try {
      const { downloadSpeedInstructionsPdf } = await import("../speed/pdf.js");
      await downloadSpeedInstructionsPdf(candidate, activeInventory);
      setNotice("Speed Creative PDF 说明书已导出。");
    } catch (failure) {
      setError(`PDF 导出失败：${failureText(failure)}`);
    } finally {
      setBusy(null);
    }
  }
  function exportJson() {
    if (!candidate || !activeInventory) return;
    const url = URL.createObjectURL(
      new Blob(
        [JSON.stringify({ candidate, inventory: activeInventory }, null, 2)],
        { type: "application/json" },
      ),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `bricklab-speed-${candidate.model.id}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setNotice("车辆、连接图与库存 JSON 已导出。");
  }

  return (
    <main className="speed-page">
      <section className="speed-hero">
        <div>
          <span className="speed-kicker">
            <Gauge size={14} /> BRICKLAB / SPEED CREATIVE
          </span>
          <h1>
            为下一次出发，<em>重新设计。</em>
          </h1>
          <p>从已有的零件出发，让一辆原创跑车真正成立。</p>
        </div>
        <div className="speed-hero-note">
          <span>08</span>
          <strong>STUD DESIGN STUDIO</strong>
          <small>底盘优先 · 连接有据 · 库存有界</small>
        </div>
      </section>
      <div className="speed-workflow">
        <span>
          <i>01</i> 读取车库
        </span>
        <b />
        <span>
          <i>02</i> 设计车辆
        </span>
        <b />
        <span>
          <i>03</i> 精修与拼搭
        </span>
        <em>
          <span /> INVENTORY FIRST. CREATIVITY NEXT.
        </em>
      </div>
      {error && (
        <div className="speed-error" role="alert">
          <CircleHelp size={17} />
          <span>{error}</span>
          <button aria-label="关闭 Speed 错误提示" onClick={() => setError("")}>
            <X size={16} />
          </button>
        </div>
      )}
      <div className="speed-studio-layout">
        <aside className="speed-form-column">
          <section className="speed-card speed-garage-card">
            <div className="speed-card-title">
              <span>01 / YOUR GARAGE</span>
              <h2>
                读取你的零件车库
                <Box size={16} />
              </h2>
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (!busy) void load();
              }}
            >
              <label htmlFor="speed-sets">
                套装编号<span>可用 + 合并多套</span>
              </label>
              <div className="speed-input-row">
                <input
                  id="speed-sets"
                  value={setNumbers}
                  onChange={(event) => setSetNumbers(event.target.value)}
                  disabled={!!busy}
                  required
                  maxLength={200}
                  placeholder="76922 + 76924"
                />
                <button disabled={!!busy}>
                  {busy === "inventory" ? (
                    <LoaderCircle size={15} className="spin" />
                  ) : (
                    <ArrowRight size={15} />
                  )}
                  读取库存
                </button>
              </div>
            </form>
            <button
              className="speed-demo-link"
              disabled={!!busy}
              onClick={() => {
                setSetNumbers("DEMO-SPEED");
                void load("DEMO-SPEED");
              }}
            >
              使用 DEMO-SPEED 演示库存
              <ArrowUpRight size={11} />
            </button>
            <p className="speed-source-hint">
              DEMO-SPEED 为独立的人工合成零件池，不是 BMW
              或其他官方套装的真实清单。
            </p>
            <details className="speed-extra-parts">
              <summary>
                添加自有散件
                <span>
                  {extraParts.length ? `${extraParts.length} 行` : "可选"}
                </span>
                <ChevronDown size={13} />
              </summary>
              <p>
                用户自报，非官方套装清单。未知零件会保留在库存中，但不会参与生成。
              </p>
              <form onSubmit={addExtraPart}>
                <label htmlFor="speed-extra-id">散件零件编号</label>
                <input
                  id="speed-extra-id"
                  value={extraPartId}
                  onChange={(event) => setExtraPartId(event.target.value)}
                  maxLength={80}
                  required
                  disabled={!!busy || extraParts.length >= 100}
                  placeholder="例如 3034"
                />
                <div className="speed-extra-fields">
                  <label htmlFor="speed-extra-color">
                    散件颜色
                    <select
                      id="speed-extra-color"
                      value={extraColorId}
                      onChange={(event) => setExtraColorId(event.target.value)}
                      disabled={!!busy || extraParts.length >= 100}
                    >
                      {extraColors.map((color) => (
                        <option key={color.id} value={color.id}>
                          {color.name} · {color.id}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label htmlFor="speed-extra-quantity">
                    散件数量
                    <input
                      id="speed-extra-quantity"
                      type="number"
                      min={1}
                      max={1000}
                      step={1}
                      required
                      value={extraQuantity}
                      onChange={(event) => setExtraQuantity(event.target.value)}
                      disabled={!!busy || extraParts.length >= 100}
                    />
                  </label>
                </div>
                <button
                  className="speed-extra-add"
                  disabled={
                    !!busy || extraParts.length >= 100 || !extraPartId.trim()
                  }
                >
                  添加散件
                  <ArrowRight size={13} />
                </button>
              </form>
              {extraParts.length > 0 && (
                <ul className="speed-extra-list" aria-label="自报散件清单">
                  {extraParts.map((extra, index) => (
                    <li key={index}>
                      <i style={{ backgroundColor: extra.color.hex }} />
                      <span>
                        <strong>{extra.partId}</strong>
                        <small>
                          {extra.color.name} · ×{extra.quantity}
                        </small>
                      </span>
                      <button
                        type="button"
                        aria-label={`删除散件 ${extra.partId}${extraParts.filter((row) => row.partId === extra.partId).length > 1 ? ` ${extra.color.name} 第${index + 1}行` : ""}`}
                        disabled={!!busy}
                        onClick={() => removeExtraPart(index)}
                      >
                        <X size={13} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <small className="speed-extra-hint">
                {extraParts.length >= 100
                  ? "已达到 100 行上限。"
                  : "最多 100 行，每行 1–1000 件。"}
                点击添加后，再读取库存才能生效；尚未添加的输入不会计入库存。
              </small>
            </details>
            {inventoryDirty && inventory && (
              <p className="speed-dirty-hint">
                编号或散件清单已修改，请先重新读取库存。
              </p>
            )}
            {activeInventory && (
              <>
                <div className="speed-garage-summary">
                  <div>
                    <strong>{activeInventory.analysis.totalQuantity}</strong>
                    <small>全部零件</small>
                  </div>
                  <div>
                    <strong>{activeInventory.analysis.usableQuantity}</strong>
                    <small>可用于生成</small>
                  </div>
                  <div>
                    <strong>
                      {Math.round(activeInventory.analysis.supportRate * 100)}
                      <sup>%</sup>
                    </strong>
                    <small>数量支持率</small>
                  </div>
                </div>
                <div className="speed-support-bar">
                  <span
                    style={{
                      width: `${activeInventory.analysis.supportRate * 100}%`,
                    }}
                  />
                </div>
                <div className="speed-source-list">
                  {activeInventory.inventorySources.map((source) => (
                    <span key={source.sourceId}>
                      <Check size={10} />
                      {source.source === "custom"
                        ? "用户自报散件 · 未核验"
                        : source.setNumber}
                    </span>
                  ))}
                </div>
                {!activeInventory.analysis.canGenerate && (
                  <div className="speed-capability-note">
                    <strong>当前库存缺少关键条件</strong>
                    {activeInventory.analysis.missingRequirements.map(
                      (item) => (
                        <p key={item}>{item}</p>
                      ),
                    )}
                  </div>
                )}
              </>
            )}
          </section>

          <section className="speed-card speed-design-card">
            <div className="speed-card-title">
              <span>02 / DESIGN BRIEF</span>
              <h2>
                这辆车，该是什么样？
                <Sparkles size={16} />
              </h2>
            </div>
            <form onSubmit={generate}>
              <label htmlFor="speed-prompt">创意描述</label>
              <textarea
                id="speed-prompt"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                required
                minLength={2}
                maxLength={500}
                rows={3}
                disabled={!!busy}
                placeholder="低矮、未来感，或一辆有经典比例的 GT…"
              />
              <div className="speed-select-grid">
                <label htmlFor="speed-vehicle-type">
                  车型
                  <select
                    id="speed-vehicle-type"
                    value={vehicleType}
                    onChange={(event) =>
                      setVehicleType(event.target.value as VehicleType)
                    }
                    disabled={!!busy}
                  >
                    {Object.entries(vehicleLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label htmlFor="speed-style">
                  风格
                  <select
                    id="speed-style"
                    value={style}
                    onChange={(event) =>
                      setStyle(event.target.value as VehicleStyle)
                    }
                    disabled={!!busy}
                  >
                    {Object.entries(styleLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label htmlFor="speed-priority">
                设计偏好
                <select
                  id="speed-priority"
                  value={priority}
                  onChange={(event) =>
                    setPriority(
                      event.target.value as VehicleDesignOptions["priority"],
                    )
                  }
                  disabled={!!busy}
                >
                  <option value="structure">结构优先</option>
                  <option value="appearance">外观优先</option>
                  <option value="color">颜色优先</option>
                </select>
              </label>
              <div className="speed-preferences">
                <ChoiceToggle
                  checked={minifigure}
                  onChange={setMinifigure}
                  title="容纳 Minifigure"
                  detail="需要合理座椅、头部空间和挡风玻璃"
                  disabled={!!busy}
                />
                <ChoiceToggle
                  checked={maximizeUsage}
                  onChange={setMaximizeUsage}
                  title="尽量利用更多零件"
                  detail="在结构允许的范围内增加细节"
                  disabled={!!busy}
                />
              </div>
              <button
                className="speed-generate-button"
                disabled={
                  !!busy ||
                  !inventory?.analysis.canGenerate ||
                  inventoryDirty ||
                  !prompt.trim()
                }
              >
                {busy === "generate" ? (
                  <LoaderCircle className="spin" size={19} />
                ) : (
                  <WandSparkles size={19} />
                )}
                <span>
                  {busy === "generate"
                    ? "正在设计并逐项校验…"
                    : "生成 Speed 方案"}
                </span>
                <ArrowUpRight size={18} />
              </button>
              <p className="speed-hard-constraint">
                <ShieldCheck size={11} />
                库存、连接与轮组检查始终是硬约束
              </p>
            </form>
          </section>
          <div className="speed-studio-note">
            <span>✳</span>
            <p>
              好看的车，先要站得住。
              <small>选择偏好不会绕过任何结构检查。</small>
            </p>
          </div>
        </aside>

        <div className="speed-result-column">
          <section
            className="speed-card speed-model-card"
            aria-busy={busy === "generate"}
          >
            <div className="speed-model-header">
              <div>
                <span className="speed-kicker">YOUR NEXT ORIGINAL DRIVE</span>
                <h2>{candidate?.model.name || "下一辆原创，从这里开始。"}</h2>
                <p>
                  {candidate
                    ? `${vehicleLabels[candidate.model.vehicleType].split(" · ")[0]} · ${styleLabels[candidate.model.style].split(" · ")[1]} · ${candidate.model.parts.length} 件零件 · V${candidate.model.version}`
                    : "读取库存，写下创意，生成通过全部检查的新设计。"}
                </p>
              </div>
              <button
                className="speed-export-button"
                disabled={!!busy || !candidate?.validation.valid}
                onClick={exportPdf}
              >
                {busy === "pdf" ? (
                  <LoaderCircle className="spin" size={15} />
                ) : (
                  <ArrowDownToLine size={15} />
                )}
                <span>{busy === "pdf" ? "正在导出…" : "导出 PDF"}</span>
              </button>
            </div>
            {session && (
              <div
                className="speed-candidates"
                role="group"
                aria-label="车辆候选方案"
              >
                {session.candidates.map((item, index) => (
                  <button
                    key={item.model.id}
                    className={
                      candidate?.model.id === item.model.id ? "selected" : ""
                    }
                    aria-label={`选择方案 ${String.fromCharCode(65 + index)}`}
                    aria-pressed={candidate?.model.id === item.model.id}
                    disabled={!!busy}
                    onClick={() => {
                      setSelectedId(item.model.id);
                      setStepIndex(0);
                      setView("model");
                      setExploded(false);
                    }}
                  >
                    <span>{String.fromCharCode(65 + index)}</span>
                    <div>
                      <strong>{item.model.name}</strong>
                      <small>
                        轴距 {decimal(item.model.parameters.wheelbase)} · 车长{" "}
                        {decimal(item.model.parameters.length)} studs
                      </small>
                    </div>
                    {candidate?.model.id === item.model.id && (
                      <Check size={13} />
                    )}
                  </button>
                ))}
              </div>
            )}
            <div className="speed-preview-toolbar">
              <div
                className="speed-view-tabs"
                role="group"
                aria-label="Speed 查看方式"
              >
                <button
                  className={view === "model" ? "active" : ""}
                  onClick={() => setView("model")}
                >
                  <CarFront size={14} />
                  完整车辆
                </button>
                <button
                  className={view === "steps" ? "active" : ""}
                  disabled={!candidate?.steps.length}
                  onClick={() => setView("steps")}
                >
                  <Layers3 size={14} />
                  分步拼搭{candidate && <span>{candidate.steps.length}</span>}
                </button>
              </div>
              <div className="speed-view-actions">
                <button
                  aria-label="Speed 显示网格"
                  title="显示网格"
                  aria-pressed={showGrid}
                  onClick={() => setShowGrid(!showGrid)}
                  className={showGrid ? "active" : ""}
                >
                  <Grid2X2 size={15} />
                </button>
                <button
                  aria-label="Speed 展开零件"
                  title="展开零件"
                  aria-pressed={exploded}
                  onClick={() => setExploded(!exploded)}
                  className={exploded ? "active" : ""}
                >
                  <Layers3 size={15} />
                </button>
                <button
                  aria-label="Speed 重置视角"
                  title="重置视角"
                  onClick={() => {
                    setViewerVersion((version) => version + 1);
                    setExploded(false);
                  }}
                >
                  <RotateCcw size={15} />
                </button>
              </div>
            </div>
            <div className="speed-model-stage">
              <span className="speed-stage-label">
                <i />
                {view === "steps"
                  ? `STEP ${String(stepIndex + 1).padStart(2, "0")} / ${String(candidate?.steps.length || 0).padStart(2, "0")}`
                  : "LIVE 3D / CONNECTION-AWARE MODEL"}
              </span>
              {visibleParts.length ? (
                <ModelViewer
                  key={`${candidate?.model.id}-${viewerVersion}`}
                  adapter={speedRenderingAdapter}
                  allowUnderside
                  parts={viewerParts}
                  highlightIds={highlightIds}
                  showGrid={showGrid}
                  exploded={exploded}
                />
              ) : (
                <div className="speed-empty-model">
                  <CarFront size={71} strokeWidth={0.9} />
                  <strong>
                    {inventory?.analysis.canGenerate
                      ? "零件就绪，等待你的设计。"
                      : "先为车库准备好零件。"}
                  </strong>
                  <p>生成结果会先通过库存、连接、轮组与结构检查。</p>
                </div>
              )}
              <span className="speed-stage-hint">
                <MousePointer2 size={11} />
                拖动旋转<span>·</span>滚轮缩放
              </span>
              {busy === "generate" && (
                <div className="speed-stage-loading">
                  <LoaderCircle size={28} className="spin" />
                  <span>从底盘开始，寻找一个可靠的新比例。</span>
                </div>
              )}
            </div>
            {view === "steps" && currentStep ? (
              <div className="speed-instructions">
                <div className="speed-step-heading">
                  <div>
                    <span>
                      STEP {String(currentStep.stepNumber).padStart(2, "0")}
                      <em>
                        {currentStep.type === "subassembly"
                          ? "独立子组件"
                          : currentStep.type === "attach"
                            ? "安装到主体"
                            : currentStep.type === "rotate"
                              ? "旋转模型"
                              : "主体拼搭"}
                      </em>
                    </span>
                    <h3>{currentStep.title}</h3>
                    <p>{currentStep.description}</p>
                  </div>
                  <span className="speed-new-part-legend">
                    {currentStep.type !== "rotate" && <i />}
                    {currentStep.type === "attach"
                      ? "本步安装高亮"
                      : currentStep.type === "rotate"
                        ? "本步无需取件"
                        : "本步新增高亮"}
                  </span>
                </div>
                {(currentStep.type === "rotate" ||
                  currentStep.cameraHint === "bottom") && (
                  <div className="speed-rotation-hint">
                    <RotateCw size={16} />
                    <span>
                      请旋转模型，从
                      {currentStep.cameraHint === "bottom"
                        ? "底部"
                        : "提示方向"}
                      观察并安装。
                      <small>
                        方向 X {currentStep.orientation.x}° / Y{" "}
                        {currentStep.orientation.y}° / Z{" "}
                        {currentStep.orientation.z}°
                      </small>
                    </span>
                  </div>
                )}
                {currentStep.subAssemblyId && (
                  <p className="speed-assembly-label">
                    {currentStep.type === "subassembly"
                      ? "独立子组件 · 主车暂放一旁"
                      : `安装目标：${currentStep.parentAssembly === "vehicle" ? "车辆主体" : moduleLabels[currentStep.parentAssembly]}`}
                  </p>
                )}
                {currentStep.type === "attach" && (
                  <p className="speed-step-parts-label">
                    已拼子组件内容（不重复取件）
                  </p>
                )}
                {currentStep.addedParts.length > 0 && (
                  <div className="speed-added-parts">
                    {groupParts(currentStep.addedParts).map(
                      ({ part, count }) => (
                        <div key={`${part.partId}:${part.color.id}`}>
                          <i style={{ backgroundColor: part.color.hex }} />
                          <span>
                            <strong>{part.name}</strong>
                            <small>
                              {part.color.name} · {part.partId}
                            </small>
                          </span>
                          <b>×{count}</b>
                        </div>
                      ),
                    )}
                  </div>
                )}
                <div className="speed-step-navigation">
                  <button
                    disabled={stepIndex === 0 || !!busy}
                    onClick={() =>
                      setStepIndex((index) => Math.max(0, index - 1))
                    }
                  >
                    <ChevronLeft size={16} />
                    上一步
                  </button>
                  <div className="speed-step-dots" aria-label="Speed 步骤跳转">
                    {candidate?.steps.map((item, index) => (
                      <button
                        key={item.stepNumber}
                        aria-label={`Speed 跳转第 ${index + 1} 步`}
                        aria-current={index === stepIndex ? "step" : undefined}
                        className={
                          index === stepIndex
                            ? "active"
                            : index < stepIndex
                              ? "complete"
                              : ""
                        }
                        onClick={() => setStepIndex(index)}
                      />
                    ))}
                  </div>
                  <button
                    disabled={
                      stepIndex === (candidate?.steps.length || 1) - 1 || !!busy
                    }
                    onClick={() =>
                      setStepIndex((index) =>
                        Math.min((candidate?.steps.length || 1) - 1, index + 1),
                      )
                    }
                  >
                    下一步
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            ) : (
              <div className="speed-model-stats">
                <div>
                  <strong>
                    {candidate?.model.parts.length || "—"}
                    <span>件</span>
                  </strong>
                  <small>当前方案用量</small>
                </div>
                <div>
                  <strong>
                    {candidate
                      ? decimal(candidate.model.parameters.wheelbase)
                      : "—"}
                    <span>studs</span>
                  </strong>
                  <small>前后轮轴距</small>
                </div>
                <div>
                  <strong>
                    {candidate?.validation.wheels.wheelCount || "—"}
                    <span>轮</span>
                  </strong>
                  <small>真实轮轴连接</small>
                </div>
                <button
                  disabled={!candidate}
                  onClick={() => {
                    setView("steps");
                    setStepIndex(0);
                  }}
                >
                  开始拼搭
                  <ArrowRight size={16} />
                </button>
              </div>
            )}
            {candidate && (
              <div className="speed-dimension-strip">
                <span>
                  实际外包尺寸{" "}
                  <strong>
                    {decimal(candidate.model.dimensions.x)} ×{" "}
                    {decimal(candidate.model.dimensions.y)} studs · 高{" "}
                    {decimal(candidate.model.dimensions.z)} plates
                  </strong>
                </span>
                <span>
                  轮距{" "}
                  <strong>
                    {decimal(candidate.model.parameters.track)} studs
                  </strong>
                </span>
                <span>
                  驾驶舱位置{" "}
                  <strong>
                    {decimal(candidate.model.parameters.cockpitPosition)} studs
                  </strong>
                </span>
                <span>
                  车头长度{" "}
                  <strong>
                    {decimal(candidate.model.parameters.hoodLength)} studs
                  </strong>
                </span>
              </div>
            )}
          </section>

          {candidate && (
            <>
              <section className="speed-card speed-validation-card">
                <div className="speed-section-header">
                  <h2>
                    <ShieldCheck size={16} />
                    结构与轮组检查
                  </h2>
                  <span className="speed-valid-badge">
                    {candidate.validation.valid ? "全部通过" : "未通过"}
                  </span>
                </div>
                <div className="speed-check-grid">
                  <CheckLabel valid={candidate.validation.inventory.valid}>
                    库存数量合法
                  </CheckLabel>
                  <CheckLabel valid={candidate.validation.connection.valid}>
                    合法连接成网
                  </CheckLabel>
                  <CheckLabel valid={candidate.validation.collision.valid}>
                    无明显实体碰撞
                  </CheckLabel>
                  <CheckLabel
                    valid={candidate.validation.wheels.rotationalClearance}
                  >
                    轮胎旋转空间通过
                  </CheckLabel>
                </div>
                <div className="speed-validation-metrics">
                  <div>
                    <strong>
                      {candidate.validation.wheels.groundedWheels} /{" "}
                      {candidate.validation.wheels.wheelCount}
                    </strong>
                    <span>四轮落地</span>
                  </div>
                  <div>
                    <strong>
                      {candidate.validation.wheels.axleConnections}
                    </strong>
                    <span>轮轴安装连接</span>
                  </div>
                  <div>
                    <strong>
                      {candidate.validation.structure.structuralScore}
                      <small>/100</small>
                    </strong>
                    <span>规则式结构分</span>
                  </div>
                </div>
                <details className="speed-validation-details">
                  <summary>
                    查看连接图与模块支撑
                    <ChevronDown size={13} />
                  </summary>
                  <p>
                    {candidate.model.parts.length} 个零件节点 ·{" "}
                    {candidate.model.connections.length} 条连接 ·{" "}
                    {candidate.model.modules.length} 个模块
                  </p>
                  <div>
                    {candidate.validation.structure.moduleScores.map((item) => (
                      <span key={item.moduleId}>
                        {moduleLabels[item.moduleId]}
                        <b>
                          {item.anchorCount} 个锚点 · {item.score} 分
                        </b>
                      </span>
                    ))}
                  </div>
                  {candidate.validation.warnings.map((warning, index) => (
                    <p key={index}>{warning}</p>
                  ))}
                </details>
              </section>

              <section className="speed-card speed-redesign-card">
                <div className="speed-section-header">
                  <div>
                    <span className="speed-card-overline">
                      LOCAL REDESIGN / KEEP WHAT YOU LOVE
                    </span>
                    <h2>保留喜欢的，再改一点。</h2>
                  </div>
                  <button
                    className="speed-undo-button"
                    onClick={undo}
                    disabled={!!busy || undoDepth < 1}
                  >
                    <Undo2 size={14} />
                    撤销上一次修改
                  </button>
                </div>
                <p className="speed-redesign-intro">
                  先锁定想保留的模块，再描述修改。每次修改都会重新检查，失败时保留上一个方案。
                  <br />
                  当前支持车头降低，尾翼降低、变窄、缩小或放大，车尾更激进，驾驶舱
                  / 车顶降低，以及模块锁定。其他修改会明确提示并保留原方案。
                </p>
                <div className="speed-module-locks" aria-label="车辆模块锁定">
                  {candidate.model.modules.map((module) => (
                    <button
                      key={module.id}
                      aria-label={`${module.locked ? "解锁" : "锁定"}${moduleLabels[module.id]}`}
                      aria-pressed={module.locked}
                      className={module.locked ? "locked" : ""}
                      disabled={!!busy}
                      onClick={() => void setLocked(module.id, !module.locked)}
                    >
                      {module.locked ? (
                        <LockKeyhole size={12} />
                      ) : (
                        <UnlockKeyhole size={12} />
                      )}
                      <span>{moduleLabels[module.id]}</span>
                      <small>{module.partIds.length}</small>
                    </button>
                  ))}
                </div>
                <form onSubmit={redesign}>
                  <label
                    className="speed-sr-only"
                    htmlFor="speed-redesign-prompt"
                  >
                    局部修改描述
                  </label>
                  <div className="speed-redesign-input">
                    <input
                      id="speed-redesign-prompt"
                      value={editPrompt}
                      onChange={(event) => setEditPrompt(event.target.value)}
                      disabled={!!busy}
                      required
                      maxLength={300}
                      placeholder="例如：车头太高了，驾驶舱保持不变。"
                    />
                    <button disabled={!!busy || !editPrompt.trim()}>
                      {busy === "redesign" ? (
                        <LoaderCircle className="spin" size={15} />
                      ) : (
                        <WandSparkles size={15} />
                      )}
                      修改方案
                    </button>
                  </div>
                  <div className="speed-edit-suggestions">
                    {editSuggestions.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        disabled={!!busy}
                        onClick={() => setEditPrompt(suggestion)}
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </form>
              </section>

              <section className="speed-card speed-notes-card">
                <div className="speed-section-header">
                  <h2>
                    <Sparkles size={15} />
                    为什么这样设计
                  </h2>
                  <button
                    className="speed-json-button"
                    disabled={!!busy}
                    onClick={exportJson}
                  >
                    <FileJson size={13} />
                    导出模型 JSON
                  </button>
                </div>
                <ul>
                  {candidate.model.designNotes.map((note, index) => (
                    <li key={index}>{note}</li>
                  ))}
                </ul>
              </section>
            </>
          )}

          {activeInventory && (
            <section className="speed-card speed-inventory-card">
              <div className="speed-section-header">
                <div>
                  <h2>
                    <Box size={16} />
                    零件支持与使用清单
                  </h2>
                  <p>按零件编号 + 颜色计数，每个候选独立使用同一份库存。</p>
                </div>
                <button
                  onClick={() => setExpandedInventory(!expandedInventory)}
                  aria-expanded={expandedInventory}
                >
                  {expandedInventory ? "收起清单" : "查看全部"}
                  <ChevronDown
                    size={14}
                    className={expandedInventory ? "speed-flipped" : ""}
                  />
                </button>
              </div>
              <div className="speed-support-counts">
                <span>
                  <i className="supported" />
                  支持 {activeInventory.analysis.supportedQuantity} 件
                </span>
                <span>
                  <i className="partial" />
                  部分支持 {
                    activeInventory.analysis.partiallySupportedQuantity
                  }{" "}
                  件
                </span>
                <span>
                  <i className="unsupported" />
                  未支持 {activeInventory.analysis.unsupportedQuantity} 件
                </span>
              </div>
              {expandedInventory && (
                <div className="speed-parts-table">
                  <table>
                    <thead>
                      <tr>
                        <th>零件 / PART</th>
                        <th>类别 / 状态</th>
                        <th>颜色</th>
                        <th>可用</th>
                        <th>使用</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeInventory.items.map((item) => (
                        <tr
                          key={`${item.partId}:${item.color.id}`}
                          title={item.sources
                            .map(
                              (source) =>
                                `${source.setNumber === "CUSTOM-EXTRAS" ? "用户自报散件" : source.setNumber}: ${source.quantity} 件`,
                            )
                            .join("；")}
                        >
                          <td>
                            <strong>{item.name}</strong>
                            <small>#{item.partId}</small>
                          </td>
                          <td>
                            {item.category}
                            <small>
                              {item.support === "supported"
                                ? "支持"
                                : item.support === "partiallySupported"
                                  ? "部分支持"
                                  : "未支持"}
                            </small>
                          </td>
                          <td>
                            <i style={{ background: item.color.hex }} />
                            {item.color.name}
                          </td>
                          <td>{item.quantityAvailable}</td>
                          <td>
                            <span
                              className={
                                selectedUsage.get(
                                  `${item.partId}:${item.color.id}`,
                                )
                                  ? "used"
                                  : ""
                              }
                            >
                              {selectedUsage.get(
                                `${item.partId}:${item.color.id}`,
                              ) || "—"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="speed-inventory-caption">
                <ShieldCheck size={13} />
                <span>{activeInventory.sourceLabel}</span>
              </div>
            </section>
          )}
          {session?.warnings.length || activeInventory?.warnings.length ? (
            <div className="speed-data-notes">
              {[
                ...new Set([
                  ...(session?.warnings || []),
                  ...(activeInventory?.warnings || []),
                ]),
              ].map((warning, index) => (
                <p key={index}>{warning}</p>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      {notice && (
        <div className="speed-toast" role="status">
          <Check size={16} />
          <span>{notice}</span>
          <button aria-label="关闭 Speed 通知" onClick={() => setNotice("")}>
            <X size={14} />
          </button>
        </div>
      )}
    </main>
  );
}
