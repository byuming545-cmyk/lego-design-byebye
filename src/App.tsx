import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Blocks,
  Box,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Grid2X2,
  Layers3,
  LoaderCircle,
  Maximize2,
  MousePointer2,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  WandSparkles,
  X,
} from "lucide-react";
import ModelViewer from "./components/ModelViewer.js";
import { PartThumbnail } from "./components/PartThumbnail.js";
import SpeedCreative from "./pages/SpeedCreative.js";
import type {
  GenerationOptions,
  GenerationResult,
  ModelSize,
  PartInventoryItem,
  PlacedPart,
  SetInventory,
  TemplateId,
} from "./types/index.js";

const targets: {
  id: TemplateId;
  label: string;
  emoji: string;
  prompt: string;
}[] = [
  {
    id: "robot",
    label: "小机器人",
    emoji: "🤖",
    prompt: "生成一个小机器人，方方的脑袋，充满好奇心。",
  },
  {
    id: "car",
    label: "小汽车",
    emoji: "🚙",
    prompt: "拼一辆小汽车，准备开始一段新的冒险。",
  },
  { id: "house", label: "小房子", emoji: "🏡", prompt: "拼一座温暖的小房子。" },
  {
    id: "animal",
    label: "小动物",
    emoji: "🐾",
    prompt: "拼一个可爱的小动物。",
  },
];
const sizeLabels: Record<ModelSize, string> = {
  small: "小型",
  balanced: "均衡",
  large: "大型",
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    signal: AbortSignal.timeout(45000),
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const data = await response
    .json()
    .catch(() => ({ error: "服务响应异常，请检查后端是否已启动。" }));
  if (!response.ok) throw new Error(data.error || "请求失败，请稍后重试。");
  return data as T;
}

function groupedParts(parts: PlacedPart[]) {
  const groups = new Map<string, { part: PlacedPart; count: number }>();
  parts.forEach((part) => {
    const key = `${part.partId}:${part.color.id}`;
    const group = groups.get(key);
    if (group) group.count++;
    else groups.set(key, { part, count: 1 });
  });
  return [...groups.values()];
}

function Toggle({
  checked,
  onChange,
  label,
  detail,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  detail: string;
}) {
  return (
    <label className="toggle-row">
      <span>
        <span className="toggle-label">{label}</span>
        <span className="toggle-detail">{detail}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="toggle-switch" aria-hidden="true">
        <span />
      </span>
    </label>
  );
}

export default function App() {
  const [area, setArea] = useState<'general' | 'speed'>(() => window.location.hash === '#/speed' ? 'speed' : 'general');
  const [speedOpened, setSpeedOpened] = useState(area === 'speed');
  useEffect(() => { if (area === 'speed') setSpeedOpened(true); }, [area]);
  useEffect(() => {
    const navigate = () => setArea(window.location.hash === '#/speed' ? 'speed' : 'general');
    window.addEventListener('hashchange', navigate);
    return () => window.removeEventListener('hashchange', navigate);
  }, []);
  const [setNumber, setSetNumber] = useState("10696");
  const [inventory, setInventory] = useState<SetInventory | null>(null);
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [prompt, setPrompt] = useState(targets[0].prompt);
  const [size, setSize] = useState<ModelSize>("balanced");
  const [preserveColors, setPreserveColors] = useState(false);
  const [maximizeUsage, setMaximizeUsage] = useState(false);
  const [loadingSet, setLoadingSet] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [view, setView] = useState<"model" | "steps">("model");
  const [stepIndex, setStepIndex] = useState(0);
  const [showGrid, setShowGrid] = useState(true);
  const [exploded, setExploded] = useState(false);
  const [viewerVersion, setViewerVersion] = useState(0);
  const [showAllInventory, setShowAllInventory] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const initialLoad = useRef(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const options = (): GenerationOptions => ({
    prompt: prompt.trim(),
    size,
    colorStrategy: preserveColors ? "preserve" : "substitute",
    maximizeUsage,
  });

  useEffect(() => {
    if (area !== 'general' || initialLoad.current) return;
    initialLoad.current = true;
    void (async () => {
      try {
        const loaded = await request<SetInventory>("/api/sets/10696");
        setInventory(loaded);
        const generated = await request<GenerationResult>("/api/generate", {
          method: "POST",
          body: JSON.stringify({
            setNumber: loaded.setNumber,
            options: {
              prompt: targets[0].prompt,
              size: "balanced",
              colorStrategy: "substitute",
              maximizeUsage: false,
            },
          }),
        });
        setResult(generated);
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setLoadingSet(false);
      }
    })();
  }, [area]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (aboutOpen) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [aboutOpen]);

  async function loadSet(event: React.FormEvent) {
    event.preventDefault();
    setLoadingSet(true);
    setError("");
    try {
      const loaded = await request<SetInventory>(
        `/api/sets/${encodeURIComponent(setNumber.trim())}`,
      );
      setInventory(loaded);
      setResult(null);
      setView("model");
      setStepIndex(0);
      setNotice(
        `已读取 ${loaded.items.reduce((n, item) => n + item.quantityAvailable, 0)} 件零件，写下你的新创意吧。`,
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoadingSet(false);
    }
  }

  async function generate(event: React.FormEvent) {
    event.preventDefault();
    if (!inventory) return;
    setGenerating(true);
    setError("");
    try {
      const generated = await request<GenerationResult>("/api/generate", {
        method: "POST",
        body: JSON.stringify({
          setNumber: inventory.setNumber,
          options: options(),
        }),
      });
      setResult(generated);
      setStepIndex(0);
      setView("model");
      setExploded(false);
      setNotice("新方案已生成，库存、碰撞与基础连接检查通过。");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setGenerating(false);
    }
  }

  async function exportPdf() {
    if (!result) return;
    setExporting(true);
    setError("");
    try {
      const { downloadInstructionsPdf } = await import("./instructions/pdf.js");
      await downloadInstructionsPdf(result);
      setNotice("PDF 说明书已导出，开始你的拼搭吧。");
    } catch (err) {
      setError(`PDF 导出失败：${errorMessage(err)}`);
    } finally {
      setExporting(false);
    }
  }

  function downloadModel() {
    if (!result) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(result, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `bricklab-${result.model.template}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setNotice("结构化模型 JSON 已导出。");
  }

  const displayInventory = result?.inventory || inventory;
  const supportedItems =
    displayInventory?.items.filter((item) => item.supported) || [];
  const available = supportedItems.reduce(
    (total, item) => total + item.quantityAvailable,
    0,
  );
  const unsupportedCount = (displayInventory?.items || [])
    .filter((item) => !item.supported)
    .reduce((sum, item) => sum + item.quantityAvailable, 0);
  const used = result?.model.parts.length || 0;
  const step = result?.steps[stepIndex];
  const visibleParts =
    view === "steps" ? step?.totalModelState || [] : result?.model.parts || [];
  const busy = generating || loadingSet;
  const matchingTarget = targets.find(
    (target) => target.id === result?.model.template,
  );

  return (
    <div className="app-shell">
      <header className="site-header">
        <a
          className="brand"
          href="#"
          aria-label="Bricklab 首页"
          onClick={(e) => {
            e.preventDefault();
            window.location.hash = '/general';
            setArea('general');
            setView("model");
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        >
          <span className="brand-icon">
            <Box size={24} strokeWidth={1.7} />
          </span>
          <span>
            bricklab<span className="brand-dot">.</span>
          </span>
        </a>
        <nav aria-label="主导航">
          <button
            className={area === 'general' && view === "model" ? "nav-link active" : "nav-link"}
            onClick={() => { window.location.hash = '/general'; setArea('general'); setView("model"); }}
          >
            通用创意
          </button>
          <button className={area === 'speed' ? 'nav-link active' : 'nav-link'} onClick={() => { window.location.hash = '/speed'; setArea('speed'); }}>Speed Creative</button>
          <button
            className={area === 'general' && view === "steps" ? "nav-link active general-guide-nav" : "nav-link general-guide-nav"}
            disabled={!result}
            onClick={() => { window.location.hash = '/general'; setArea('general'); setView("steps"); }}
          >
            我的拼搭指南
          </button>
        </nav>
        <button className="version-button" onClick={() => setAboutOpen(true)}>
          <span className="status-dot" /> {area === 'speed' ? 'V0.2' : 'V0.1'}{" "}
          <span className="version-label">· 创意实验中</span>
          <ArrowUpRight size={14} />
        </button>
      </header>

      {(speedOpened || area === 'speed') && <div hidden={area !== 'speed'}><SpeedCreative /></div>}
      <main hidden={area === 'speed'}>
        <section className="page-intro">
          <div>
            <div className="eyebrow">
              <span /> A LITTLE REBUILD, A NEW POSSIBILITY
            </div>
            <h1>
              旧积木，<span>新可能。</span>
              <Sparkles aria-hidden="true" />
            </h1>
            <p>用你手边的积木，拼出脑海里的下一个小世界。</p>
          </div>
          <div className="intro-note">
            <span className="note-line" />
            <span>
              不必拥有更多，
              <br />
              也能创造更多。<span className="hand-drawn-arrow">↙</span>
            </span>
          </div>
        </section>

        <div className="workspace-progress" aria-label="创作流程">
          <span className={inventory ? "done" : "current"}>
            <i>{inventory ? <Check size={12} /> : "01"}</i> 读取积木
          </span>
          <div />
          <span className={result ? "done" : inventory ? "current" : ""}>
            <i>{result ? <Check size={12} /> : "02"}</i> 释放创意
          </span>
          <div />
          <span className={view === "steps" ? "current" : ""}>
            <i>03</i> 开始拼搭
          </span>
          <span className="workspace-label">
            <span className="status-dot" /> YOUR CREATIVE SPACE
          </span>
        </div>

        {error && (
          <div role="alert" className="alert error">
            <CircleHelp size={18} />
            <span>{error}</span>
            <button aria-label="关闭错误提示" onClick={() => setError("")}>
              <X size={16} />
            </button>
          </div>
        )}

        <div className="workspace-layout">
          <aside className="control-column">
            <section className="card setup-card">
              <div className="section-heading">
                <span className="section-number">01</span>
                <h2>从你的积木开始</h2>
                <Box size={17} />
              </div>
              <form onSubmit={loadSet}>
                <label htmlFor="set-number" className="field-label">
                  LEGO 套装编号 <span>SET NUMBER</span>
                </label>
                <div className="set-input-row">
                  <input
                    id="set-number"
                    value={setNumber}
                    onChange={(e) => setSetNumber(e.target.value)}
                    placeholder="例如 10696"
                    pattern="[0-9]{3,8}(-[0-9]+)?"
                    required
                    maxLength={15}
                    autoComplete="off"
                  />
                  <button type="submit" className="read-button" disabled={busy}>
                    {loadingSet ? (
                      <LoaderCircle size={15} className="spin" />
                    ) : (
                      <ArrowRight size={15} />
                    )}
                    读取套装
                  </button>
                </div>
              </form>
              {inventory ? (
                <div className="loaded-set">
                  <div className="set-art" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                    <span />
                  </div>
                  <div>
                    <strong>{inventory.name}</strong>
                    <span>
                      #{inventory.setNumber}{" "}
                      <span className="loaded-label">
                        <CheckCheck size={12} />
                        已读取
                      </span>
                    </span>
                  </div>
                </div>
              ) : (
                <div className="empty-set">
                  <Blocks size={21} />
                  <span>
                    {loadingSet
                      ? "正在整理你的积木…"
                      : "输入套装编号，建立你的零件库"}
                  </span>
                </div>
              )}
              <div className="source-note">
                <span
                  className={`source-dot ${inventory?.source === "rebrickable" ? "live" : ""}`}
                />
                <span>
                  {inventory?.source === "rebrickable"
                    ? "Rebrickable 实时套装库存"
                    : "演示库存 · 非该套装真实清单"}
                </span>
                <button
                  aria-label="了解数据来源"
                  onClick={() => setAboutOpen(true)}
                >
                  <CircleHelp size={13} />
                </button>
              </div>
            </section>

            <section className="card creative-card">
              <div className="section-heading">
                <span className="section-number">02</span>
                <h2>这次，想拼些什么？</h2>
                <Sparkles size={17} />
              </div>
              <form onSubmit={generate}>
                <label htmlFor="creative-prompt" className="sr-only">
                  用户创意描述
                </label>
                <textarea
                  id="creative-prompt"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="例如：一个方脑袋的小机器人…"
                  required
                  minLength={2}
                  maxLength={500}
                  rows={3}
                />
                <div className="suggestions" aria-label="创意模板">
                  {targets.map((target) => (
                    <button
                      key={target.id}
                      type="button"
                      onClick={() => setPrompt(target.prompt)}
                      className={prompt === target.prompt ? "selected" : ""}
                    >
                      <span aria-hidden="true">{target.emoji}</span>
                      {target.label}
                    </button>
                  ))}
                </div>
                <div className="field-label size-label">
                  模型规模 <span>BUILD SIZE</span>
                </div>
                <div className="size-picker" role="group" aria-label="模型规模">
                  {(["small", "balanced", "large"] as const).map(
                    (value, index) => (
                      <button
                        type="button"
                        key={value}
                        aria-pressed={size === value}
                        onClick={() => setSize(value)}
                        className={size === value ? "selected" : ""}
                      >
                        <span
                          className={`size-graphic size-${index}`}
                          aria-hidden="true"
                        >
                          <i />
                          <i />
                          <i />
                        </span>
                        {sizeLabels[value]}
                      </button>
                    ),
                  )}
                </div>
                <div className="preferences">
                  <Toggle
                    checked={preserveColors}
                    onChange={setPreserveColors}
                    label="优先保持颜色"
                    detail="颜色不足时，简化造型"
                  />
                  <Toggle
                    checked={maximizeUsage}
                    onChange={setMaximizeUsage}
                    label="让更多积木派上用场"
                    detail="用剩余零件丰富模型"
                  />
                </div>
                <button
                  className="generate-button"
                  type="submit"
                  disabled={!inventory || !prompt.trim() || busy}
                >
                  {generating ? (
                    <LoaderCircle className="spin" size={19} />
                  ) : (
                    <WandSparkles size={19} />
                  )}
                  <span>
                    {generating ? "正在拼出你的灵感…" : "生成我的拼搭方案"}
                  </span>
                  <ArrowUpRight size={19} />
                </button>
                <p className="under-button">
                  <ShieldCheck size={12} />
                  只用库存里的积木，每一块都有来处
                </p>
              </form>
            </section>

            <div className="little-tip">
              <span>✳</span>
              <p>
                小小灵感，大大世界。
                <br />
                <span>先从简单的模型开始，惊喜会慢慢发生。</span>
              </p>
            </div>
          </aside>

          <div className="result-column">
            <section className="card model-card" aria-busy={busy}>
              <div className="model-card-header">
                <div>
                  <div className="eyebrow small">YOUR NEXT LITTLE CREATION</div>
                  <div className="model-title-line">
                    <h2>{result?.model.name || "等待一个新灵感"}</h2>
                    {result && (
                      <span className="validation-pill">
                        <ShieldCheck size={12} />
                        基础校验通过
                      </span>
                    )}
                  </div>
                  <p>
                    {result
                      ? `${matchingTarget?.label || "创意模型"} · ${used} 块积木 · ${result.steps.length} 个拼搭步骤`
                      : "读取套装，写下创意，让积木重新出发。"}
                  </p>
                </div>
                <button
                  className="export-button"
                  disabled={!result || exporting || busy}
                  onClick={exportPdf}
                >
                  {exporting ? (
                    <LoaderCircle className="spin" size={16} />
                  ) : (
                    <ArrowDownToLine size={16} />
                  )}
                  <span>{exporting ? "制作中…" : "导出 PDF"}</span>
                </button>
              </div>
              <div className="preview-toolbar">
                <div className="view-tabs" role="group" aria-label="查看方式">
                  <button
                    className={view === "model" ? "active" : ""}
                    onClick={() => setView("model")}
                  >
                    <Box size={14} />
                    完整模型
                  </button>
                  <button
                    className={view === "steps" ? "active" : ""}
                    disabled={!result}
                    onClick={() => setView("steps")}
                  >
                    <Layers3 size={14} />
                    分步拼搭{result && <span>{result.steps.length}</span>}
                  </button>
                </div>
                <div className="viewer-actions">
                  <button
                    onClick={() => setShowGrid(!showGrid)}
                    aria-label="显示网格"
                    aria-pressed={showGrid}
                    title="显示网格"
                    className={showGrid ? "active" : ""}
                  >
                    <Grid2X2 size={16} />
                  </button>
                  <button
                    onClick={() => setExploded(!exploded)}
                    aria-label="展开零件"
                    aria-pressed={exploded}
                    title="展开零件"
                    className={exploded ? "active" : ""}
                  >
                    <Layers3 size={16} />
                  </button>
                  <button
                    aria-label="重置视角"
                    title="重置视角"
                    onClick={() => {
                      setViewerVersion((v) => v + 1);
                      setExploded(false);
                    }}
                  >
                    <RotateCcw size={16} />
                  </button>
                </div>
              </div>
              <div className="model-stage">
                <div className="stage-top-label">
                  <span className="status-dot" />
                  {view === "steps"
                    ? `STEP ${String(stepIndex + 1).padStart(2, "0")} / ${String(result?.steps.length || 0).padStart(2, "0")}`
                    : "LIVE 3D PREVIEW"}
                </div>
                {visibleParts.length > 0 ? (
                  <ModelViewer
                    key={viewerVersion}
                    parts={visibleParts}
                    highlightIds={
                      view === "steps"
                        ? step?.addedParts.map((part) => part.instanceId)
                        : undefined
                    }
                    showGrid={showGrid}
                    exploded={exploded}
                  />
                ) : (
                  <div className="preview-empty">
                    <Blocks size={62} strokeWidth={1} />
                    <span>
                      {busy
                        ? "正在为积木寻找新的可能…"
                        : "你的下一个创意，将在这里出现"}
                    </span>
                  </div>
                )}
                <div className="stage-axis" aria-hidden="true">
                  <span>z</span>
                  <i />
                  <b>y</b>
                  <em>x</em>
                </div>
                <div className="stage-hint">
                  <MousePointer2 size={12} />
                  拖动旋转<span>·</span>滚轮缩放
                </div>
                <div className="stage-corner">
                  <Maximize2 size={16} />
                </div>
                {busy && (
                  <div className="stage-loading">
                    <LoaderCircle size={27} className="spin" />
                    <span>
                      {loadingSet ? "读取积木中" : "正在搭建你的新创意"}
                    </span>
                  </div>
                )}
              </div>
              {view === "steps" && step ? (
                <div className="instruction-panel">
                  <div className="step-heading">
                    <div>
                      <span className="step-overline">
                        STEP {String(step.stepNumber).padStart(2, "0")}
                      </span>
                      <h3>{step.title}</h3>
                      <p>{step.description}</p>
                    </div>
                    <span className="new-parts-label">
                      <span />
                      绿色轮廓为本步新增
                    </span>
                  </div>
                  <div className="step-parts">
                    {groupedParts(step.addedParts).map(({ part, count }) => (
                      <div key={`${part.partId}:${part.color.id}`}>
                        <PartThumbnail
                          color={part.color.hex}
                          category={part.category}
                          small
                        />
                        <span>
                          <strong>{part.name}</strong>
                          <small>
                            {part.color.name} · {part.partId}
                          </small>
                        </span>
                        <b>×{count}</b>
                      </div>
                    ))}
                  </div>
                  <div className="step-navigation">
                    <button
                      onClick={() => setStepIndex((n) => Math.max(0, n - 1))}
                      disabled={stepIndex === 0}
                    >
                      <ChevronLeft size={16} />
                      上一步
                    </button>
                    <div className="step-dots" aria-label="跳转拼搭步骤">
                      {result?.steps.map((item, index) => (
                        <button
                          key={item.stepNumber}
                          className={
                            index === stepIndex
                              ? "active"
                              : index < stepIndex
                                ? "complete"
                                : ""
                          }
                          onClick={() => setStepIndex(index)}
                          aria-label={`跳转第 ${index + 1} 步`}
                          aria-current={
                            index === stepIndex ? "step" : undefined
                          }
                        />
                      ))}
                    </div>
                    <button
                      onClick={() =>
                        setStepIndex((n) =>
                          Math.min((result?.steps.length || 1) - 1, n + 1),
                        )
                      }
                      disabled={stepIndex === (result?.steps.length || 1) - 1}
                    >
                      下一步
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="model-bottom">
                  <div className="model-stats">
                    <div>
                      <strong>
                        {used.toString().padStart(2, "0")}
                        <span>块</span>
                      </strong>
                      <small>已使用积木</small>
                    </div>
                    <div>
                      <strong>
                        {(result?.steps.length || 0)
                          .toString()
                          .padStart(2, "0")}
                        <span>步</span>
                      </strong>
                      <small>一点点拼出惊喜</small>
                    </div>
                    <div>
                      <strong>
                        {available ? Math.round((used / available) * 100) : 0}
                        <span>%</span>
                      </strong>
                      <small>可用库存利用率</small>
                    </div>
                  </div>
                  <button
                    className="start-building"
                    disabled={!result}
                    onClick={() => {
                      setView("steps");
                      setStepIndex(0);
                    }}
                  >
                    开始拼搭
                    <ArrowRight size={17} />
                  </button>
                </div>
              )}
            </section>

            {result && (
              <div className="validation-strip">
                <span>
                  <Check size={13} />
                  库存数量安全
                </span>
                <span>
                  <Check size={13} />
                  无明显空间重叠
                </span>
                <span>
                  <Check size={13} />
                  基础连接通过
                </span>
                <button
                  onClick={downloadModel}
                  title="导出可继续编辑的结构化数据"
                >
                  模型 JSON
                  <ArrowUpRight size={12} />
                </button>
              </div>
            )}

            <section className="card inventory-card">
              <div className="inventory-heading">
                <div className="section-heading">
                  <span className="inventory-heading-icon">
                    <Blocks size={17} />
                  </span>
                  <h2>你的零件小仓库</h2>
                  <span className="inventory-count">
                    {supportedItems.length} 种 · {available} 件可用
                  </span>
                </div>
                <button
                  onClick={() => setShowAllInventory(!showAllInventory)}
                  aria-expanded={showAllInventory}
                >
                  {showAllInventory ? "收起零件" : "查看全部"}
                  <ChevronDown
                    size={14}
                    className={showAllInventory ? "flipped" : ""}
                  />
                </button>
              </div>
              <div className="inventory-table-wrap">
                <table className="inventory-table">
                  <thead>
                    <tr>
                      <th>零件 / PART</th>
                      <th>颜色</th>
                      <th>库存</th>
                      <th>已使用</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(showAllInventory
                      ? displayInventory?.items || []
                      : supportedItems.slice(0, 4)
                    ).map((item: PartInventoryItem) => (
                      <tr key={`${item.partId}:${item.color.id}`}>
                        <td>
                          <PartThumbnail
                            color={item.color.hex}
                            category={item.category}
                            small
                          />
                          <span>
                            <strong>{item.name}</strong>
                            <small>
                              #{item.partId}
                              {!item.supported && <em>暂不参与生成</em>}
                            </small>
                          </span>
                        </td>
                        <td>
                          <span
                            className="color-swatch"
                            style={{ backgroundColor: item.color.hex }}
                          />
                          <span className="color-name">{item.color.name}</span>
                        </td>
                        <td>{item.quantityAvailable}</td>
                        <td>
                          <span
                            className={
                              item.quantityUsed > 0
                                ? "used-quantity has-used"
                                : "used-quantity"
                            }
                          >
                            {item.quantityUsed || "—"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!inventory && (
                  <div className="inventory-placeholder">
                    读取套装后，所有可用零件会出现在这里。
                  </div>
                )}
              </div>
              <div className="inventory-footnote">
                <ShieldCheck size={13} />
                <span>
                  零件按编号与颜色分别计数
                  {unsupportedCount > 0 &&
                    ` · 另有 ${unsupportedCount} 件特殊零件保留在库存中`}
                </span>
              </div>
            </section>
            {result && result.model.notes.length > 0 && (
              <div className="model-notes">
                <Sparkles size={14} />
                <div>
                  {result.model.notes.map((note, i) => (
                    <p key={i}>{note}</p>
                  ))}
                </div>
              </div>
            )}
            {inventory?.warnings.length ? (
              <div className="data-warnings">
                {inventory.warnings.map((warning, i) => (
                  <p key={i}>{warning}</p>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <section className="bottom-note">
          <span className="bottom-note-icon">✳</span>
          <span>创造的乐趣，不止于说明书。</span>
          <span className="bottom-note-sub">
            REIMAGINE WHAT YOU ALREADY HAVE.
          </span>
        </section>
      </main>

      <footer>
        <span className="footer-brand">bricklab.</span>
        <span>为每一块积木，寻找下一种可能。</span>
        <span>独立创意原型 · 与 LEGO® 集团无关联</span>
        <button onClick={() => setAboutOpen(true)}>
          关于这个小实验
          <ArrowUpRight size={12} />
        </button>
      </footer>
      {notice && (
        <div className="toast" role="status">
          <Check size={17} />
          {notice}
          <button aria-label="关闭通知" onClick={() => setNotice("")}>
            <X size={15} />
          </button>
        </div>
      )}
      <dialog
        ref={dialogRef}
        className="about-dialog"
        onCancel={() => setAboutOpen(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setAboutOpen(false);
        }}
      >
        <button
          className="dialog-close"
          aria-label="关闭关于窗口"
          onClick={() => setAboutOpen(false)}
        >
          <X size={20} />
        </button>
        <span className="brand-icon">
          <Box size={26} />
        </span>
        <div className="eyebrow">BRICKLAB · {area === 'speed' ? 'SPEED CREATIVE V0.2' : 'V0.1'}</div>
        <h2>
          让已有的积木，
          <br />
          遇见新的想象。
        </h2>
        <p>
          {area === 'speed'
            ? 'Speed Creative 是独立的原创汽车工作台，按实际库存生成约 8 stud 宽的模块化小车。设计与文字修改由有限规则驱动。'
            : '这是一个规则驱动的创意重拼原型，目前支持机器人、汽车、房子与小动物四种基础模板。'}
        </p>
        <h3>关于演示数据</h3>
        <p>
          {area === 'speed'
            ? 'DEMO-SPEED 是人工合成的独立零件池，不代表任何官方套装。真实套装需要在服务器配置 Rebrickable API Key，缺少 Key 时不会用演示零件替代。'
            : '未配置 Rebrickable 时，10696 与 11013 使用人工编写的演示库存，并非对应官方套装的真实零件清单。真实数据由服务器端的 Rebrickable 数据源提供。'}
        </p>
        <h3>关于拼搭校验</h3>
        <p>
          {area === 'speed'
            ? '车辆检查库存、显式连接图、实体碰撞、轮轴安装、轮胎间隙及规则式结构支撑。这些检查尚未经过实物拼搭、摩擦或承重测试。'
            : '模型按 studs 网格与 plate 高度计算，检查库存、明显重叠和上下连接。简化外形与连接规则不代表完整 CAD 或物理稳定性认证。汽车是静态积木造型，特殊机械件暂不参与生成。'}
        </p>
        <button className="generate-button" onClick={() => setAboutOpen(false)}>
          知道了，继续创作
          <ArrowRight size={18} />
        </button>
      </dialog>
    </div>
  );
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "TimeoutError") return "请求超时，请稍后重试。";
    if (err.message === "Failed to fetch")
      return "暂时无法连接服务器，请确认前后端服务均已启动。";
    return err.message;
  }
  return "操作未完成，请重试。";
}
