import { useEffect, useMemo, useRef, useState } from 'react';
import AnimatedPairViewer, { type PairTransform, type PairViewerHandle, type PairView } from './AnimatedPairViewer.js';
import type { NativeConnectionPoint, NativeMesh, NativeVector } from './NativePartViewer.js';
import type { ConnectionCaseDetail } from '../parts/library/types.js';
import { encodeGif, type GifFrame } from '../lib/gif.js';

export interface CasePlayerProps {
  detail: ConnectionCaseDetail;
  fixed: { mesh: NativeMesh; points: NativeConnectionPoint[] };
  moving: { mesh: NativeMesh; points: NativeConnectionPoint[] };
  onOpenStudio?: () => void;
}

function add(a: NativeVector, b: NativeVector): NativeVector { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function scale(v: NativeVector, amount: number): NativeVector { return [v[0] * amount, v[1] * amount, v[2] * amount]; }
function normalize(v: NativeVector): NativeVector { const length = Math.hypot(...v) || 1; return [v[0] / length, v[1] / length, v[2] / length]; }
const ease = (value: number) => value * value * (3 - 2 * value);
const identity: PairTransform['rotation'] = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export default function AssemblyCasePlayer({ detail, fixed, moving, onOpenStudio }: CasePlayerProps) {
  const viewer = useRef<PairViewerHandle>(null);
  const [progress, setProgress] = useState(0.82);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [view, setView] = useState<PairView>('free');
  const [showConnections, setShowConnections] = useState(true);
  const [gifState, setGifState] = useState<'idle' | 'rendering' | 'error'>('idle');
  const seated = detail.placements.find(item => item.partId === detail.movingPartId)?.transform ?? { rotation: identity, translation: [0, 0, 0] as NativeVector };
  const axis = normalize((detail.edge?.axis ?? [0, 1, 0]) as NativeVector);
  const fixedTransform = (detail.placements.find(item => item.partId === detail.fixedPartId)?.transform ?? { rotation: identity, translation: [0, 0, 0] }) as PairTransform;
  const seatedTransform: PairTransform = { rotation: seated.rotation as PairTransform['rotation'], translation: seated.translation as NativeVector };
  const distance = 38;
  const approach = progress < 0.28 ? 0 : progress < 0.5 ? 0 : progress < 0.88 ? ease((progress - 0.5) / 0.38) : 1;
  const movingTransform = useMemo<PairTransform>(() => ({ rotation: seatedTransform.rotation, translation: add(seatedTransform.translation, scale(axis, distance * (1 - approach))) }), [approach, axis, seatedTransform.rotation, seatedTransform.translation]);
  const caption = progress < 0.2 ? '分开：观察两件真实零件和轴向' : progress < 0.48 ? '高亮：确认两端连接位置' : progress < 0.7 ? '对准：沿来源轴接近' : progress < 0.94 ? '插入：接近 seat 范围' : '已就位：只表示这个姿态，不表示安装过程已验证';

  useEffect(() => {
    if (!playing) return;
    let frame = 0; let last = performance.now();
    const tick = (now: number) => {
      const delta = Math.min(80, now - last); last = now;
      setProgress(current => {
        const next = current + delta / 4200 * speed;
        if (next >= 1) { setPlaying(false); return 1; }
        return next;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed]);

  const replay = () => { setProgress(0); setPlaying(true); };
  const captureLabel = (context: CanvasRenderingContext2D, width: number, height: number) => {
    context.fillStyle = 'rgba(20, 28, 24, .82)'; context.fillRect(18, 16, Math.min(width - 36, 560), 58);
    context.fillStyle = '#fffdf7'; context.font = '600 16px sans-serif';
    context.fillText(`${detail.fixedPartId} → ${detail.movingPartId} · ${detail.ruleId}`, 32, 42);
    context.font = '12px sans-serif'; context.fillStyle = '#f4d49a';
    const status = detail.validation.installationPath === 'source-axis-pose-only' ? '示意动画 · 安装路径未验证' : '安装路径未验证';
    context.fillText(`${status} · 辅助显示色：固定/移动`, 32, 62);
    context.fillStyle = 'rgba(20, 28, 24, .82)'; context.fillRect(18, height - 50, Math.min(width - 36, 600), 32);
    context.fillStyle = '#fffdf7'; context.font = '13px sans-serif'; context.fillText(caption, 32, height - 29);
  };

  const exportGif = async () => {
    setGifState('rendering');
    try {
      const frames: GifFrame[] = [];
      const total = 22;
      for (let i = 0; i < total; i++) {
        setProgress(i / (total - 1));
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        const shot = viewer.current?.capturePixels(800, 500);
        if (!shot) throw new Error('无法捕获三维画面。');
        const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 500;
        const context = canvas.getContext('2d'); if (!context) throw new Error('无法创建导出画布。');
        const image = context.createImageData(800, 500); image.data.set(shot.pixels); context.putImageData(image, 0, 0);
        const frameProgress = i / (total - 1);
        const frameCaption = frameProgress < 0.2 ? '分开' : frameProgress < 0.48 ? '高亮连接位置' : frameProgress < 0.7 ? '沿轴对准' : frameProgress < 0.94 ? '接近插入' : '已就位（路径未验证）';
        context.fillStyle = 'rgba(20, 28, 24, .84)'; context.fillRect(18, 16, 650, 58);
        context.fillStyle = '#fffdf7'; context.font = '600 16px sans-serif'; context.fillText(`${detail.fixedPartId} → ${detail.movingPartId} · ${detail.ruleId}`, 32, 42);
        context.fillStyle = '#f4d49a'; context.font = '12px sans-serif'; context.fillText('示意动画 · 安装路径未验证 · 辅助显示色', 32, 62);
        context.fillStyle = 'rgba(20, 28, 24, .84)'; context.fillRect(18, 450, 500, 32);
        context.fillStyle = '#fffdf7'; context.font = '13px sans-serif'; context.fillText(frameCaption, 32, 471);
        frames.push({ width: 800, height: 500, pixels: context.getImageData(0, 0, 800, 500).data, delayCs: 9 });
      }
      const bytes = encodeGif(frames);
      const buffer = new ArrayBuffer(bytes.byteLength); new Uint8Array(buffer).set(bytes);
      const blob = new Blob([buffer], { type: 'image/gif' });
      const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `bar-clip-${detail.fixedPartId}-${detail.movingPartId}.gif`; anchor.click(); URL.revokeObjectURL(url);
      setGifState('idle');
    } catch { setGifState('error'); }
  };

  return (
    <div className="case-player">
      <div className="case-player-stage">
        <AnimatedPairViewer ref={viewer} fixedMesh={fixed.mesh} movingMesh={moving.mesh} fixedPoints={fixed.points} movingPoints={moving.points} fixedTransform={fixedTransform} movingTransform={movingTransform} fixedConnectionId={detail.edge?.fixedConnectionId ?? null} movingConnectionId={detail.edge?.movingConnectionId ?? null} interactive={false} tool="move" showConnections={showConnections} onReady={() => viewer.current?.setView(view)} />
        <div className="case-player-legend"><span><i className="dot fixed" />固定件</span><span><i className="dot moving" />移动件</span><span>辅助显示色，不代表真实颜色</span></div>
        <p className="case-player-caption">{caption}</p>
      </div>
      <div className="case-player-controls">
        <button type="button" onClick={() => setPlaying(value => !value)}>{playing ? '暂停' : '播放'}</button>
        <button type="button" onClick={replay}>重播</button>
        <label>速度 <select value={speed} onChange={event => setSpeed(Number(event.target.value))}><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option></select></label>
        <input aria-label="动画进度" type="range" min="0" max="1" step="0.001" value={progress} onChange={event => { setPlaying(false); setProgress(Number(event.target.value)); }} />
        <span>{Math.round(progress * 100)}%</span>
      </div>
      <div className="case-player-tools">
        {(['free', 'front', 'side', 'top'] as PairView[]).map(item => <button type="button" key={item} className={view === item ? 'active' : ''} onClick={() => { setView(item); viewer.current?.setView(item); }}>{item === 'free' ? '自由视角' : item === 'front' ? '正视' : item === 'side' ? '侧视' : '俯视'}</button>)}
        <label><input type="checkbox" checked={showConnections} onChange={event => setShowConnections(event.target.checked)} /> 连接位置</label>
        <button type="button" onClick={() => void exportGif()} disabled={gifState === 'rendering'}>{gifState === 'rendering' ? '正在生成 GIF…' : '导出 GIF'}</button>
        {onOpenStudio ? <button type="button" className="primary" onClick={onOpenStudio}>我来拼搭</button> : null}
      </div>
      {gifState === 'error' ? <p className="case-player-error">GIF 生成失败；三维画面仍可继续查看。</p> : null}
      <p className="case-player-notice">动画只移动已有真实零件，不生成安装轨迹，不代表插入过程已通过碰撞检查。{detail.displayNotice}</p>
    </div>
  );
}
