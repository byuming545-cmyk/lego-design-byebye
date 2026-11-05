import { useEffect, useMemo, useState } from 'react';
import { ArrowDownToLine, Car, Check, FolderOpen, LoaderCircle, RefreshCw, Save, Upload } from 'lucide-react';
import NativeAssemblyViewer, { type AssemblyAsset } from '../components/NativeAssemblyViewer.js';
import { MINI_COLORS, type MiniModel, type MiniOptions } from '../mini-cars/types.js';
import './mini-cars.css';

interface Payload { model: MiniModel; assets: Record<string, AssemblyAsset> }
interface Saved { id: string; modifiedAt: string }
async function api<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch('/api/mini-cars' + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(45000) });
  const value = await r.json(); if (!r.ok) throw new Error(value.error ?? '操作未完成。'); return value as T;
}
export default function MiniCars() {
  const [options, setOptions] = useState<MiniOptions>({ style: 'sprint', color: 'red', seed: 'mini-01', spoiler: true });
  const [payload, setPayload] = useState<Payload | null>(null);
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [saved, setSaved] = useState<Saved[]>([]), [view, setView] = useState<'perspective' | 'side' | 'top'>('perspective');
  const [file, setFile] = useState<File | null>(null);
  const colors = useMemo(() => Object.fromEntries((payload?.model.placements ?? []).map(p => [p.instanceId, MINI_COLORS[p.color].hex])), [payload]);
  const refreshSaved = async () => setSaved((await api<{ models: Saved[] }>('/models')).models);
  useEffect(() => { void refreshSaved().catch(e => setError(e.message)); }, []);
  async function perform(kind: string, operation: () => Promise<void>) {
    setBusy(kind); setError(''); setNotice(''); try { await operation(); } catch (e) { setError(e instanceof Error ? e.message : '操作未完成，请重试。'); } finally { setBusy(''); }
  }
  const adopt = (value: Payload) => { setPayload(value); setOptions(value.model.options); setView('perspective'); };
  const generate = (different = false) => void perform('generate', async () => {
    const next: MiniOptions = different ? { ...options, style: options.style === 'sprint' ? 'gt' : 'sprint' } : options;
    adopt(await api<Payload>('/generate', next));
  });
  const save = () => void perform('save', async () => { if (!payload) return; await api('/models', { model: payload.model }); await refreshSaved(); setNotice('已保存，可从本页重新打开。'); });
  const download = (format: 'json' | 'bom') => void perform(format, async () => {
    if (!payload) return; await api('/models', { model: payload.model }); await refreshSaved();
    const r = await fetch(`/api/mini-cars/models/${payload.model.id}/export?format=${format}`);
    if (!r.ok) { const result = await r.json(); throw new Error(result.error ?? '导出失败。'); }
    const url = URL.createObjectURL(await r.blob()), a = document.createElement('a'); a.href = url;
    a.download = `mini-car-${payload.model.options.style}.${format === 'bom' ? 'csv' : 'json'}`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  const model = payload?.model;
  return <main className="mini-cars">
    <header className="mini-heading"><div><span className="mini-eyebrow">MINI CARS · APPEARANCE STUDIO</span><h1>小比例，也有跑车的轮廓。</h1><p>6 格车身、黑色窗区、四轮与简洁覆盖。选择造型，生成你的迷你跑车。</p></div><span className="mini-draft-badge">外观草稿 · 未验证实拼</span></header>
    <div className="mini-workspace">
      <aside className="mini-controls" aria-label="迷你跑车生成选项">
        <label>车身造型<select aria-label="车身造型" value={options.style} disabled={!!busy} onChange={e => setOptions({ ...options, style: e.target.value as MiniOptions['style'] })}><option value="sprint">短轴跑车</option><option value="gt">长轴 GT</option></select></label>
        <fieldset><legend>车身配色</legend><div className="mini-swatches">{(['red','blue','white','yellow'] as const).map(color => <button key={color} type="button" aria-label={MINI_COLORS[color].label} aria-pressed={options.color === color} disabled={!!busy} onClick={() => setOptions({ ...options, color })} style={{ background: MINI_COLORS[color].hex, color: color === 'white' || color === 'yellow' ? '#303b31' : '#fff' }}>{options.color === color && <Check size={17} />}</button>)}</div></fieldset>
        <label>方案种子<input aria-label="方案种子" value={options.seed} maxLength={32} pattern="[a-zA-Z0-9_-]+" disabled={!!busy} onChange={e => setOptions({ ...options, seed: e.target.value })} /><small>相同选项与种子，可以再次生成同一方案。</small></label>
        <label className="mini-check"><input type="checkbox" checked={options.spoiler} disabled={!!busy} onChange={e => setOptions({ ...options, spoiler: e.target.checked })} />加上简单尾翼</label>
        <button className="mini-primary" disabled={!!busy || !options.seed} onClick={() => generate()}>{busy === 'generate' ? <LoaderCircle size={17} className="part-spin" /> : <Car size={17} />}生成迷你跑车</button>
        <button className="mini-secondary" disabled={!!busy || !model} onClick={() => generate(true)}><RefreshCw size={15} />切换车身方案</button>
        <p className="mini-scope">使用真实零件几何。轮组先按外观定位，连接、配合和实物稳定性尚未验证。</p>
      </aside>
      <section className="mini-preview" aria-label="迷你跑车工作区">
        <div className="mini-preview-bar"><div><strong>{model ? model.options.style === 'sprint' ? '短轴跑车' : '长轴 GT' : '你的第一辆迷你跑车'}</strong><span>{model ? `${model.placements.length} 件 · 4 轮 · 车身 6 格宽 · ${model.layout.lengthLdu / 20} 格长` : '先选造型与颜色，再点击生成'}</span></div><div className="mini-views" aria-label="查看角度">{([['perspective','斜侧'],['side','侧面'],['top','俯视']] as const).map(([id,label]) => <button key={id} disabled={!model} aria-pressed={view === id} onClick={() => setView(id)}>{label}</button>)}</div></div>
        {payload ? <NativeAssemblyViewer placements={payload.model.placements} assets={payload.assets} showConnections={false} showPath={false} showProxies={false} showZones={false} designColors={colors} view={view} /> : <div className="mini-empty"><Car size={64} strokeWidth={1} /><p>从真实零件，组合一辆完整的小车。</p><span>短轴或长轴 · 统一车身色 · 黑色窗区</span></div>}
        <div className="mini-export"><button disabled={!model || !!busy} onClick={save}><Save size={15} />保存方案</button><button disabled={!model || !!busy} onClick={() => download('json')}><ArrowDownToLine size={15} />导出模型</button><button disabled={!model || !!busy} onClick={() => download('bom')}><ArrowDownToLine size={15} />导出 BOM</button>{model && <span>轮组配合：未验证</span>}</div>
      </section>
    </div>
    {error && <p className="mini-error" role="alert">{error}</p>}{notice && <p className="mini-notice" role="status">{notice}</p>}
    <div className="mini-records"><section><h2><FolderOpen size={18} />保存的方案</h2>{!saved.length ? <p>保存后的方案会出现在这里。</p> : <div className="mini-saved">{saved.map((item,i) => <button key={item.id} disabled={!!busy} onClick={() => void perform('open', async () => { adopt(await api<Payload>('/models/' + item.id)); setNotice('已按当前来源重新打开外观模型。'); })}>打开方案 {saved.length-i}<small>{new Date(item.modifiedAt).toLocaleString()}</small></button>)}</div>}</section>
      <section><h2><Upload size={18} />重新打开模型文件</h2><p>读取本工作区导出的 JSON，检查当前来源与方案后显示。</p><form onSubmit={e => { e.preventDefault(); void perform('import', async () => { if (file) { if(file.size>2*1024*1024) throw new Error('模型文件最多 2 MiB。'); adopt(await api<Payload>('/models/import', { content: await file.text() })); setNotice('模型文件已重新打开。'); } }); }}><input type="file" accept=".json,application/json" aria-label="迷你跑车模型文件" disabled={!!busy} onChange={e => setFile(e.target.files?.[0] ?? null)} /><button disabled={!file || !!busy} type="submit">打开模型文件</button></form></section></div>
    {model && <details className="mini-bom"><summary>零件清单与来源 · {model.bom.length} 种编号与颜色组合</summary><p>颜色为设计指定色，未验证实物颜色供应。此清单对应当前外观模型，不是实拼认证。</p><div className="mini-table-scroll"><table><thead><tr><th>原生编号</th><th>名称</th><th>设计颜色</th><th>数量</th></tr></thead><tbody>{model.bom.map(row => <tr key={`${row.partId}:${row.color}`}><td>{row.partId}</td><td>{row.name}</td><td>{MINI_COLORS[row.color].label}</td><td>{row.quantity}</td></tr>)}</tbody></table></div><details><summary>查看数字零件来源与署名</summary>{model.sources.map(source => <p key={source.partId}><strong>{source.partId}</strong> · LDraw · {source.files.find(f => f.path === source.rootFile)?.author ?? '作者见源文件'} · {source.files.find(f => f.path === source.rootFile)?.license}<br /><a href={source.files.find(f => f.path === source.rootFile)?.sourceUrl} target="_blank" rel="noreferrer">原始数字零件文件</a></p>)}</details></details>}
  </main>;
}
