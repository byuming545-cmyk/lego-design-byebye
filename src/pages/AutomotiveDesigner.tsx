import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Blocks,
  BookOpen,
  Box,
  CarFront,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Code2,
  FileJson,
  FlaskConical,
  Grid2X2,
  Layers3,
  LoaderCircle,
  Palette,
  RotateCcw,
  Ruler,
  ShieldCheck,
  SlidersHorizontal,
  Upload,
  WandSparkles,
} from 'lucide-react';
import ModelViewer from '../components/ModelViewer.js';
import { LEGACY_GENERATION_BLOCK, LEGACY_OPERATIONS_BLOCKED } from '../parts/legacyStatus.js';
import { speedRenderingAdapter, toSpeedViewerParts } from '../speed/rendering.js';
import { automotiveClient, automotiveFailure } from '../automotive/client.js';
import type {
  AutomotiveCandidateView,
  AutomotiveSessionView,
  AutomotiveStatusView,
  AutomotivePatternLibraryView,
} from '../automotive/ui-types.js';
import type {
  RealVehicleProfile,
  VehicleClass,
  VehicleDesignBrief,
  VehicleFact,
  VehicleResearchResult,
} from '../automotive/research/types.js';
import type {
  ReferenceLibraryEntry,
  ReferenceLicense,
  ReferenceMetadataInput,
} from '../automotive/references/types.js';
import type { LegoDesignPattern } from '../automotive/patterns.js';
import type { AutomotiveQualityScore } from '../automotive/quality.js';
import './automotive.css';

const colors = [
  { id: 0, name: '曜石黑', hex: '#05131D' },
  { id: 71, name: '浅灰', hex: '#A0A5A9' },
  { id: 15, name: '白色', hex: '#FFFFFF' },
  { id: 4, name: '红色', hex: '#C91A09' },
  { id: 1, name: '蓝色', hex: '#0055BF' },
];
const classes: Record<string, string> = {
  'luxury-sedan': '豪华轿车',
  'performance-coupe': '性能轿跑',
  'sports-car': '运动跑车',
  gt: 'GT',
  supercar: '超级跑车',
  unknown: '待确定车型',
};
const factLabels: Record<string, string> = {
  unknown: '缺失',
  catalog_seed: '目录初始信息',
  manual: '用户提供',
  live_verified: '已获取来源',
};
const accessLabels: Record<string, string> = {
  not_fetched: '未抓取',
  blocked: '访问受阻',
  fetched: '已抓取',
  failed: '获取失败',
  user_supplied: '用户提供',
};
const scoreLabels = {
  overall: '综合',
  legoStyle: '积木风格',
  automotiveDesign: '汽车造型',
  referenceSimilarity: '形态相似度',
  structure: '结构',
  buildability: '可拼搭性',
};
function safeUrl(value: string | null | undefined) {
  try {
    const url = new URL(value || '');
    return ['https:', 'http:'].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}
function number(value: number) {
  return Number.isInteger(value) ? value : value.toFixed(1);
}
function sessionFromLocation() {
  const route = (
    window.location.hash ? window.location.hash.slice(1) : window.location.pathname
  ).split('?')[0];
  if (!['/automotive', '/automotive-lab'].includes(route)) return null;
  const hashQuery = window.location.hash.split('?')[1];
  return new URLSearchParams(hashQuery ?? window.location.search).get('session');
}
function Badge({
  children,
  tone = '',
}: {
  children: React.ReactNode;
  tone?: '' | 'good' | 'warn' | 'bad';
}) {
  return <span className={`auto-chip ${tone}`}>{children}</span>;
}
function Warnings({ items }: { items: string[] }) {
  return items.length ? (
    <div className="auto-warnings">
      {[...new Set(items)].map((item, i) => (
        <p key={i}>
          <CircleHelp size={13} />
          {item}
        </p>
      ))}
    </div>
  ) : null;
}
function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="auto-empty">
      <Box size={24} strokeWidth={1.3} />
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}
function Fact({
  label,
  fact,
  unit = '',
}: {
  label: string;
  fact: VehicleFact<unknown>;
  unit?: string;
}) {
  return (
    <div className="auto-fact">
      <span>{label}</span>
      <strong>{fact.value === null ? '—' : `${String(fact.value)}${unit}`}</strong>
      <small>{factLabels[fact.status]}</small>
      {fact.sourceIds.length > 0 && (
        <small className="auto-fact-source" title={fact.sourceIds.join(', ')}>
          {fact.sourceIds.join(', ')}
        </small>
      )}
      {fact.note && <small>{fact.note}</small>}
    </div>
  );
}
function ResearchDetails({
  profile,
  research,
}: {
  profile: RealVehicleProfile | null;
  research: VehicleResearchResult | null;
}) {
  if (!profile)
    return <Empty title="从车型研究开始">输入车型，查看来源与缺失信息，再选择设计宽度。</Empty>;
  const missing = Object.entries(profile.dimensions).filter(
    ([, fact]) => fact.value === null,
  ).length;
  return (
    <div className="auto-research">
      <div className="auto-split">
        <div>
          <span className="auto-kicker">REAL VEHICLE PROFILE</span>
          <h3>
            {profile.manufacturer} {profile.model} <small>{profile.generation}</small>
          </h3>
          <p className="auto-small">
            {classes[profile.vehicleType]} ·{' '}
            {profile.researchStatus === 'verified'
              ? '来源已验证'
              : profile.researchStatus === 'manual'
                ? '用户提供资料'
                : '研究未完成'}
          </p>
        </div>
        <Badge tone={missing ? 'warn' : 'good'}>
          {missing ? `${missing} 项尺寸缺失` : '尺寸信息完整'}
        </Badge>
      </div>
      <div className="auto-facts">
        <Fact label="车身长度" fact={profile.dimensions.lengthMm} unit=" mm" />
        <Fact label="不含后视镜宽度" fact={profile.dimensions.widthMm} unit=" mm" />
        <Fact label="车身高度" fact={profile.dimensions.heightMm} unit=" mm" />
        <Fact label="轴距" fact={profile.dimensions.wheelbaseMm} unit=" mm" />
      </div>
      <div className="auto-grid-two">
        <div>
          <h4>辨识特征</h4>
          {profile.signatureFeatures.map((fact, i) => (
            <div className="auto-feature" key={i}>
              <span>{fact.value || '待补充'}</span>
              <Badge>{factLabels[fact.status]}</Badge>
            </div>
          ))}
          <div className="auto-tags">
            {profile.featureTags.map((tag) => (
              <Badge key={tag}>{tag}</Badge>
            ))}
          </div>
        </div>
        <div>
          <h4>研究来源 · {profile.sources.length}</h4>
          {profile.sources.map((source) => (
            <div className="auto-source" key={source.id}>
              <div>
                <strong>{source.title}</strong>
                <Badge tone={source.accessStatus === 'fetched' ? 'good' : 'warn'}>
                  {accessLabels[source.accessStatus]}
                </Badge>
              </div>
              {safeUrl(source.url) && (
                <a href={safeUrl(source.url)} target="_blank" rel="noreferrer">
                  查看来源链接 <ArrowUpRight size={12} />
                </a>
              )}
              <small>{source.attribution}</small>
              <small className="auto-source-id">{source.id}</small>
              {source.notes.map((note, i) => (
                <small key={i}>{note}</small>
              ))}
            </div>
          ))}
        </div>
      </div>
      <details className="auto-details">
        <summary>查看视觉字段与图片元数据</summary>
        <div className="auto-facts">
          {Object.entries(profile.visualFeatures).map(([key, fact]) => (
            <Fact key={key} label={key} fact={fact} />
          ))}
        </div>
        <p className="auto-small">图片仅作为链接元数据保存。当前未配置图片视觉分析。</p>
        {profile.referenceImages.length ? (
          profile.referenceImages.map((image, i) => (
            <p key={i} className="auto-small">
              {image.angle} ·{' '}
              <a href={safeUrl(image.url)} target="_blank" rel="noreferrer">
                图片链接 ↗
              </a>{' '}
              · 未分析
            </p>
          ))
        ) : (
          <p className="auto-small">没有已获取的车辆参考图片。</p>
        )}
      </details>
      {research?.attempts.length ? (
        <details className="auto-details">
          <summary>查看获取记录 · {research.attempts.length}</summary>
          {research.attempts.map((attempt, i) => (
            <p className="auto-small" key={i}>
              {attempt.status} · {attempt.errorCode || ''} · {attempt.url}
              <br />
              {attempt.message}
            </p>
          ))}
        </details>
      ) : null}
      <Warnings items={[...profile.warnings, ...(research?.warnings ?? [])]} />
    </div>
  );
}
function BriefDetails({ brief }: { brief: VehicleDesignBrief | undefined }) {
  if (!brief)
    return (
      <Empty title="Design Brief 等待生成">车型资料、宽度与显式估算选项将共同决定模块布局。</Empty>
    );
  const labels: Record<string, string> = {
    lengthStuds: '长度',
    wheelbaseStuds: '轴距',
    heightPlates: '高度 / plate',
    wheelDiameterStuds: '轮径',
    frontOverhangStuds: '前悬',
    rearOverhangStuds: '后悬',
    cockpitStartStuds: '驾驶舱起点',
    cockpitLengthStuds: '驾驶舱长度',
    hoodLengthStuds: '引擎盖长度',
    roofLengthStuds: '车顶长度',
  };
  return (
    <div>
      <div className="auto-split">
        <div>
          <span className="auto-kicker">DESIGN BRIEF</span>
          <h3>{brief.targetVehicle}</h3>
        </div>
        <Badge tone={brief.dimensionBasis === 'source-backed' ? 'good' : 'warn'}>
          {brief.dimensionBasis === 'estimated'
            ? 'estimated · 估算比例'
            : brief.dimensionBasis === 'mixed'
              ? '来源 + 估算'
              : '依据来源尺寸'}
        </Badge>
      </div>
      <p className="auto-small">
        目标宽度 {brief.targetWidthStuds} stud ·{' '}
        {brief.widthSelection === 'user' ? '用户选择' : '系统建议'} · 每个宽度重新规划模块
      </p>
      <div className="auto-brief-metrics">
        {Object.entries(brief.proportions).map(([key, value]) => (
          <div key={key}>
            <span>{labels[key] || key}</span>
            <strong>{number(value)}</strong>
          </div>
        ))}
      </div>
      <div className="auto-grid-two">
        <div>
          <h4>优先保留</h4>
          <ul className="auto-reasons">
            {brief.identityPriorities.map((feature, i) => (
              <li key={i}>{feature}</li>
            ))}
          </ul>
        </div>
        <div>
          <h4>次要特征</h4>
          <ul className="auto-reasons">
            {brief.secondaryFeatures.map((feature, i) => (
              <li key={i}>{feature}</li>
            ))}
          </ul>
        </div>
      </div>
      <details className="auto-details">
        <summary>模块尺寸与位置</summary>
        <div className="auto-scroll">
          <table className="auto-table">
            <thead>
              <tr>
                <th>模块</th>
                <th>宽 × 长 / stud</th>
                <th>高 / plate</th>
                <th>起点 / stud</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(brief.modules).map(([key, mod]) => (
                <tr key={key}>
                  <td>{key}</td>
                  <td>
                    {mod.widthStuds} × {mod.lengthStuds}
                  </td>
                  <td>{mod.heightPlates}</td>
                  <td>{mod.startStuds}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      {brief.assumptions.length > 0 && (
        <div className="auto-notice warning">
          <strong>明确记录的设计假设</strong>
          {brief.assumptions.map((item, i) => (
            <p key={i}>
              {item.field} — {item.reason}
              {item.sourceIds.length > 0 && <small> · {item.sourceIds.join(', ')}</small>}
            </p>
          ))}
        </div>
      )}
      <Warnings items={brief.warnings} />
    </div>
  );
}
function CandidateScores({ candidate }: { candidate: AutomotiveCandidateView }) {
  return (
    <div className="auto-scores">
      {Object.entries(scoreLabels).map(([key, label]) => {
        const score = candidate.scores[key as keyof typeof scoreLabels];
        if (typeof score !== 'number') return null;
        return (
          <div className="auto-score" key={key}>
            <span>{label}</span>
            <i>
              <span style={{ width: `${Math.max(0, Math.min(100, score))}%` }} />
            </i>
            <strong>{number(score)}</strong>
          </div>
        );
      })}
    </div>
  );
}
function QualityEvidence({ candidate }: { candidate: AutomotiveCandidateView }) {
  const validation = candidate.designValidation;
  const reports = [
    { title: '积木风格', report: validation.legoStyleScore },
    { title: '形态相似度', report: validation.referenceSimilarityScore },
  ];
  const automotiveDesignScore = (
    validation as typeof validation & { automotiveDesignScore?: AutomotiveQualityScore }
  ).automotiveDesignScore;
  if (automotiveDesignScore)
    reports.splice(1, 0, { title: '汽车造型', report: automotiveDesignScore });
  const basisLabels = {
    'engineering-class-priors': '工程车型类别先验',
    'catalog-construction-heuristic': '目录零件构建启发式',
    'design-brief': 'Design Brief 目标比例',
    'reference-analysis': '已导入参考模型的测量',
  };
  return (
    <div className="auto-quality-evidence">
      {reports.map(({ title, report }) => (
        <details className="auto-details" key={title}>
          <summary>
            {title}依据 · {basisLabels[report.basis]} · {number(report.score)} 分
          </summary>
          <p className="auto-small">{report.explanation}</p>
          {report.basis === 'engineering-class-priors' && (
            <p className="auto-inline-warning">
              <CircleHelp size={13} />
              此分数依据工程类别比例；没有使用真实参考模型或图片识别。
            </p>
          )}
          <div className="auto-scroll">
            <table className="auto-table">
              <thead>
                <tr>
                  <th>指标</th>
                  <th>测量值</th>
                  <th>目标</th>
                  <th>得分</th>
                  <th>置信度</th>
                  <th>证据</th>
                </tr>
              </thead>
              <tbody>
                {report.metrics.map((metric) => (
                  <tr key={metric.id}>
                    <td>{metric.label}</td>
                    <td>
                      {number(metric.value)} {metric.unit}
                    </td>
                    <td>
                      {Array.isArray(metric.target)
                        ? metric.target.map(number).join(' – ')
                        : number(metric.target)}
                    </td>
                    <td>{number(metric.score)}</td>
                    <td>{Math.round(metric.confidence * 100)}%</td>
                    <td>{metric.evidence}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Warnings items={report.warnings} />
        </details>
      ))}
      <details className="auto-details">
        <summary>综合排序权重与可拼搭性依据</summary>
        <div className="auto-tags">
          {Object.entries(validation.weights).map(([key, weight]) => (
            <Badge key={key}>
              {scoreLabels[key as keyof typeof scoreLabels] ?? key} · {Math.round(weight * 100)}%
            </Badge>
          ))}
        </div>
        <p className="auto-small">{validation.buildabilityExplanation}</p>
      </details>
    </div>
  );
}
function ReferenceSelection({ session }: { session: AutomotiveSessionView | null }) {
  if (!session)
    return (
      <Empty title="生成设计后查看参考检索与采用理由">
        按测量比例、特征标签和构建用途比较参考，不以品牌名称匹配。
      </Empty>
    );
  return (
    <div>
      <div className="auto-split">
        <h3>本次参考选择</h3>
        <Badge tone={session.referenceSet.fallbackPrior ? 'warn' : 'good'}>
          {session.referenceSet.fallbackPrior
            ? '工程先验 · 无匹配参考'
            : `${session.referenceSet.references.length} 个匹配参考`}
        </Badge>
      </div>
      <p className="auto-small">
        {session.referenceSet.targetVehicle} ·
        参考按比例和局部设计用途选择，可以组合不同车型的构建经验。
      </p>
      <div className="auto-retrieval-grid">
        {session.referenceSet.references.map((reference) => (
          <article className="auto-pattern" key={reference.referenceId}>
            <div className="auto-split">
              <h4>
                {reference.rank}. {reference.modelName}
              </h4>
              <Badge>{number(reference.score)} 分</Badge>
            </div>
            <div className="auto-tags">
              {reference.uses.map((use) => (
                <Badge key={use}>{use}</Badge>
              ))}
            </div>
            <ul className="auto-reasons">
              {reference.reasons.map((reason, i) => (
                <li key={i}>{reason}</li>
              ))}
            </ul>
            <small className="auto-small">{reference.referenceId}</small>
          </article>
        ))}
      </div>
      <Warnings items={session.referenceSet.notes} />
    </div>
  );
}
function Bom({ candidate }: { candidate: AutomotiveCandidateView | undefined }) {
  const rows = useMemo(() => {
    const map = new Map<
      string,
      { part: NonNullable<typeof candidate>['parts'][number]; quantity: number }
    >();
    for (const part of candidate?.parts ?? []) {
      const key = `${part.partId}:${part.color.id}`;
      const row = map.get(key);
      if (row) row.quantity++;
      else map.set(key, { part, quantity: 1 });
    }
    return [...map.values()].sort(
      (a, b) => b.quantity - a.quantity || a.part.partId.localeCompare(b.part.partId),
    );
  }, [candidate]);
  if (!candidate) return <Empty title="生成候选后查看材料清单" />;
  return (
    <>
      <div className="auto-split">
        <div>
          <h3>所需零件清单</h3>
          <p className="auto-small">
            {rows.length} 个零件 / 颜色组合 · {candidate.parts.length}{' '}
            件。此历史设计使用旧版参数化零件，零件与颜色组合尚未来源验证。
          </p>
        </div>
        <Badge>需求数量</Badge>
      </div>
      <div className="auto-scroll auto-bom-scroll">
        <table className="auto-table">
          <thead>
            <tr>
              <th>零件编号</th>
              <th>零件</th>
              <th>颜色</th>
              <th>所需数量</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ part, quantity }) => (
              <tr key={`${part.partId}:${part.color.id}`}>
                <td className="auto-mono">{part.partId}</td>
                <td>{part.name}</td>
                <td>
                  <span className="auto-inline">
                    <i className="auto-color-dot" style={{ background: part.color.hex }} />
                    {part.color.name} <small>#{part.color.id}</small>
                  </span>
                </td>
                <td>{quantity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
function Patterns({ patterns }: { patterns: LegoDesignPattern[] }) {
  if (!patterns.length)
    return (
      <Empty title="暂无参考衍生模式">
        当前可用模式来自工程规则。导入可信来源后，才会记录参考模型证据。
      </Empty>
    );
  return (
    <div className="auto-pattern-grid">
      {patterns.map((pattern) => (
        <article className="auto-pattern" key={pattern.id}>
          <div className="auto-split">
            <h4>{pattern.name}</h4>
            <Badge tone={pattern.status === 'confirmed' ? 'good' : 'warn'}>
              {pattern.status === 'confirmed' ? '几何检查通过' : '待检查'}
            </Badge>
          </div>
          <p>{pattern.structuralRole}</p>
          <div className="auto-inline">
            <Badge>{pattern.category}</Badge>
            <Badge>{pattern.parts.length} 件</Badge>
            <Badge>{pattern.connectionGraph.length} 连接</Badge>
          </div>
          <p className="auto-small">
            {pattern.provenance.kind === 'engineer-prior' ? '工程先验' : '从参考模型提取'} ·{' '}
            {pattern.provenance.note}
          </p>
          <p className="auto-small">
            {pattern.sourceReferences.length
              ? `参考：${pattern.sourceReferences.join(', ')}`
              : '无参考模型来源'}
          </p>
          <p className="auto-small">
            连接强度启发分：{pattern.strengthScore ?? '未评估'}；未进行实体承重测试。
          </p>
        </article>
      ))}
    </div>
  );
}
function ExtractedPatternCandidates({
  library,
  loading,
  error,
}: {
  library: AutomotivePatternLibraryView | null;
  loading: boolean;
  error: string;
}) {
  return (
    <section className="auto-panel auto-lab-pattern-candidates">
      <div className="auto-panel-title">
        <Layers3 size={17} />
        <h2>自动提取的局部候选</h2>
        <Badge tone="warn">{library?.candidates.length ?? 0} 个 · 待人工审查</Badge>
      </div>
      <p className="auto-small">
        这些是从已导入数字模型的几何和连接中提取的局部拼搭候选。状态为
        candidate，未确认、未被生成器采用，尚需审查语义用途与实体稳定性。
      </p>
      {loading && (
        <p className="auto-small" role="status">
          正在获取局部候选…
        </p>
      )}
      {error && (
        <p className="auto-notice error" role="alert">
          {error}
        </p>
      )}
      {library && (
        <p className="auto-small">
          本次检查 {library.sourceModelsAssessed} 个来源模型 · 返回 {library.candidates.length}{' '}
          个局部候选
          {library.remainingModels > 0 ? ` · 另有 ${library.remainingModels} 个模型尚未检查` : ''}
        </p>
      )}
      {library?.candidates.length ? (
        <div className="auto-pattern-grid">
          {library.candidates.map((pattern) => (
            <article className="auto-pattern" key={pattern.id}>
              <div className="auto-split">
                <h4>{pattern.name}</h4>
                <Badge tone="warn">candidate · 待审查</Badge>
              </div>
              <p>{pattern.structuralRole}</p>
              <div className="auto-inline">
                <Badge>{pattern.category}</Badge>
                <Badge>{pattern.parts.length} 件</Badge>
                <Badge>{pattern.connectionGraph.length} 连接</Badge>
              </div>
              <details className="auto-details">
                <summary>来源与提取依据</summary>
                <p className="auto-small">候选编号：{pattern.id}</p>
                <p className="auto-small">
                  来源模型：{pattern.sourceReferences.join(', ') || '未记录'}
                </p>
                <p className="auto-small">{pattern.provenance.note}</p>
              </details>
              <details className="auto-details">
                <summary>查看局部零件 · {pattern.parts.length} 件</summary>
                <div className="auto-scroll">
                  <table className="auto-table">
                    <thead>
                      <tr>
                        <th>零件</th>
                        <th>名称</th>
                        <th>位置 x/y/z</th>
                        <th>方向 x/y/z</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pattern.parts.map((part) => (
                        <tr key={part.instanceId}>
                          <td>{part.partId}</td>
                          <td>{part.name}</td>
                          <td>
                            {part.position.x}/{part.position.y}/{part.position.z}
                          </td>
                          <td>
                            {part.orientation.x}/{part.orientation.y}/{part.orientation.z}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
              <details className="auto-details">
                <summary>
                  程序化检查 · {pattern.validation.valid ? '通过，仍待人工审查' : '未通过'}
                </summary>
                <p className="auto-small">
                  检查范围：{pattern.validation.checked.join(', ')} ·{' '}
                  {pattern.validation.connectionCount} 个连接
                </p>
                {pattern.validation.errors.length ? (
                  <Warnings items={pattern.validation.errors} />
                ) : (
                  <p className="auto-small">
                    当前程序检查未报告错误。这不构成人工确认，也不证明实体承重能力。
                  </p>
                )}
                <p className="auto-small">
                  强度评估：
                  {pattern.strengthScore === null
                    ? '未评估'
                    : `${pattern.strengthScore} · 连接启发分`}
                  。此候选不参与设计模式采用。
                </p>
              </details>
            </article>
          ))}
        </div>
      ) : (
        !loading &&
        !error && (
          <Empty title="暂无自动提取的局部候选">
            导入许可清楚的 .ldr 或 .mpd
            数字模型后，会显示从可识别几何与连接中提取的结果；仅保存来源链接不会产生候选。
          </Empty>
        )
      )}
      {library && <Warnings items={library.warnings} />}
    </section>
  );
}
function ManualProfileForm({
  busy,
  onSave,
}: {
  busy: boolean;
  onSave: (profile: RealVehicleProfile) => void;
}) {
  const [manufacturer, setManufacturer] = useState('');
  const [model, setModel] = useState('');
  const [generation, setGeneration] = useState('');
  const [vehicleType, setVehicleType] = useState<VehicleClass>('luxury-sedan');
  const [dimensions, setDimensions] = useState({
    lengthMm: '',
    widthMm: '',
    heightMm: '',
    wheelbaseMm: '',
  });
  const [sourceLabel, setSourceLabel] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save(event: FormEvent) {
    event.preventDefault();
    setError('');
    setSaving(true);
    try {
      const input = {
        manufacturer,
        model,
        generation: generation || null,
        vehicleType,
        dimensions: Object.fromEntries(
          Object.entries(dimensions)
            .filter(([, value]) => value !== '')
            .map(([key, value]) => [key, Number(value)]),
        ),
        sourceLabel,
        ...(sourceUrl.trim() ? { sourceUrl: sourceUrl.trim() } : {}),
      };
      const result = await automotiveClient.manualProfile(input);
      onSave(result.profile);
    } catch (failure) {
      setError(automotiveFailure(failure));
    } finally {
      setSaving(false);
    }
  }

  return (
    <details className="auto-details auto-manual">
      <summary>补充手动车型资料</summary>
      <p className="auto-small">
        官网访问受阻时，可录入你查到的技术参数并注明来源。资料标为用户提供，未独立验证。
      </p>
      <form onSubmit={save}>
        <label className="auto-field">
          制造商
          <input
            className="auto-input"
            required
            maxLength={200}
            value={manufacturer}
            onChange={(event) => setManufacturer(event.target.value)}
          />
        </label>
        <label className="auto-field">
          车型
          <input
            className="auto-input"
            required
            maxLength={200}
            value={model}
            onChange={(event) => setModel(event.target.value)}
          />
        </label>
        <label className="auto-field">
          代号 / 世代
          <input
            className="auto-input"
            maxLength={100}
            value={generation}
            onChange={(event) => setGeneration(event.target.value)}
            placeholder="例如 W223"
          />
        </label>
        <label className="auto-field">
          车型类别
          <select
            className="auto-select"
            value={vehicleType}
            onChange={(event) => setVehicleType(event.target.value as VehicleClass)}
          >
            {Object.entries(classes).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div className="auto-manual-dimensions">
          {(
            [
              ['lengthMm', '长度', 1500, 10000],
              ['widthMm', '宽度 · 不含后视镜', 900, 3500],
              ['heightMm', '高度', 600, 3500],
              ['wheelbaseMm', '轴距', 800, 7000],
            ] as const
          ).map(([key, label, min, max]) => (
            <label key={key} className="auto-field">
              {label} / mm
              <input
                className="auto-input"
                type="number"
                min={min}
                max={max}
                step="any"
                value={dimensions[key]}
                onChange={(event) =>
                  setDimensions((previous) => ({ ...previous, [key]: event.target.value }))
                }
              />
            </label>
          ))}
        </div>
        <label className="auto-field">
          来源标题
          <input
            className="auto-input"
            required
            maxLength={200}
            value={sourceLabel}
            onChange={(event) => setSourceLabel(event.target.value)}
            placeholder="例如技术参数手册及版本"
          />
        </label>
        <label className="auto-field">
          来源 URL · 可选
          <input
            className="auto-input"
            type="url"
            maxLength={2000}
            value={sourceUrl}
            onChange={(event) => setSourceUrl(event.target.value)}
            placeholder="https://…"
          />
        </label>
        {error && (
          <p className="auto-notice error" role="alert">
            {error}
          </p>
        )}
        <button className="auto-secondary auto-full" disabled={busy || saving} type="submit">
          {saving ? <LoaderCircle size={14} className="auto-spin" /> : <Check size={14} />}
          保存并选用资料
        </button>
      </form>
    </details>
  );
}
function ReferenceImporter({
  busy,
  onImport,
}: {
  busy: boolean;
  onImport: (filename: string, content: string, metadata: ReferenceMetadataInput) => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState('');
  const [modelName, setModelName] = useState('');
  const [author, setAuthor] = useState('');
  const [license, setLicense] = useState<ReferenceLicense>('unknown');
  const [attribution, setAttribution] = useState('');
  const [ownsRights, setOwnsRights] = useState(false);
  const [vehicleType, setVehicleType] = useState<VehicleClass>('unknown');
  const [featureTags, setFeatureTags] = useState('');
  const [longitudinalAxis, setLongitudinalAxis] = useState<'auto' | 'x' | 'y'>('auto');
  const [frontDirection, setFrontDirection] = useState<'unknown' | '1' | '-1'>('unknown');
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (license !== 'unknown' && !file) {
      setError('请选择 .ldr 或 .mpd 文件。');
      return;
    }
    if (license !== 'unknown' && file && file.size > 8 * 1024 * 1024) {
      setError('文件不能超过 8 MiB。');
      return;
    }
    if (license === 'user-owned' && !ownsRights) {
      setError('请先确认你拥有此模型的使用权。');
      return;
    }
    try {
      await onImport(
        license === 'unknown' ? '' : file!.name,
        license === 'unknown' ? '' : await file!.text(),
        {
          source,
          modelName,
          author,
          license,
          attribution,
          vehicleType,
          featureTags: featureTags
            .split(/[,，]/)
            .map((tag) => tag.trim())
            .filter(Boolean),
          ...(longitudinalAxis !== 'auto' ? { longitudinalAxis } : {}),
          ...(frontDirection !== 'unknown'
            ? { frontDirection: Number(frontDirection) as 1 | -1 }
            : {}),
          ...(license === 'user-owned'
            ? {
                rightsDeclaration: {
                  ownsRights: true,
                  statement:
                    'I own the rights to this model and authorize its use as a design reference.',
                },
              }
            : {}),
        },
      );
      setFile(null);
      setModelName('');
    } catch (failure) {
      setError(automotiveFailure(failure));
    }
  }
  return (
    <form className="auto-ref-form" onSubmit={submit}>
      <div className="auto-split">
        <div>
          <h3>导入自己的参考模型</h3>
          <p className="auto-small">
            支持 LDraw .ldr / .mpd，保留层级、颜色与原生矩阵。只使用许可清楚的来源。
          </p>
        </div>
        <Upload size={19} />
      </div>
      <label className="auto-field">
        模型文件
        <input
          type="file"
          accept=".ldr,.mpd"
          disabled={busy}
          onChange={(event) => {
            const next = event.target.files?.[0] ?? null;
            setFile(next);
            if (next && !modelName) setModelName(next.name.replace(/\.(ldr|mpd)$/i, ''));
          }}
        />
        {file && (
          <small>
            {file.name} · {(file.size / 1024).toFixed(1)} KiB
          </small>
        )}
      </label>
      <div className="auto-grid-two">
        <label className="auto-field">
          模型名称
          <input
            className="auto-input"
            required
            maxLength={200}
            value={modelName}
            onChange={(event) => setModelName(event.target.value)}
          />
        </label>
        <label className="auto-field">
          作者
          <input
            className="auto-input"
            required
            maxLength={200}
            value={author}
            onChange={(event) => setAuthor(event.target.value)}
          />
        </label>
        <label className="auto-field">
          来源 URL 或说明
          <input
            className="auto-input"
            required
            maxLength={2000}
            value={source}
            onChange={(event) => setSource(event.target.value)}
            placeholder="https://… 或自己的原创模型"
          />
        </label>
        <label className="auto-field">
          使用许可
          <select
            className="auto-select"
            value={license}
            onChange={(event) => setLicense(event.target.value as ReferenceLicense)}
          >
            <option value="unknown">未知 · 仅保存来源链接</option>
            <option value="user-owned">我拥有权利</option>
            <option value="CC0-1.0">CC0 1.0</option>
            <option value="CC-BY-4.0">CC BY 4.0</option>
          </select>
        </label>
      </div>
      <div className="auto-grid-two">
        <label className="auto-field">
          参考车型类别
          <select
            className="auto-select"
            value={vehicleType}
            onChange={(event) => setVehicleType(event.target.value as VehicleClass)}
          >
            {Object.entries(classes).map(([key, label]) => (
              <option key={key} value={key}>
                {key === 'unknown' ? '未分类 · 不推断车型' : label}
              </option>
            ))}
          </select>
        </label>
        <label className="auto-field">
          特征标签 · 逗号分隔
          <input
            className="auto-input"
            maxLength={500}
            value={featureTags}
            onChange={(event) => setFeatureTags(event.target.value)}
            placeholder="long-hood, large-grille"
          />
        </label>
      </div>
      <div className="auto-grid-two">
        <label className="auto-field">
          模型纵轴 · 内部坐标
          <select
            className="auto-select"
            value={longitudinalAxis}
            onChange={(event) => setLongitudinalAxis(event.target.value as typeof longitudinalAxis)}
          >
            <option value="auto">未指定 · 从几何边界估计</option>
            <option value="x">X 轴</option>
            <option value="y">Y 轴</option>
          </select>
        </label>
        <label className="auto-field">
          车头方向
          <select
            className="auto-select"
            value={frontDirection}
            onChange={(event) => setFrontDirection(event.target.value as typeof frontDirection)}
          >
            <option value="unknown">未知 · 不推断前后悬</option>
            <option value="1">沿纵轴正方向 +1</option>
            <option value="-1">沿纵轴负方向 -1</option>
          </select>
        </label>
      </div>
      <label className="auto-field">
        署名与许可说明
        <textarea
          className="auto-textarea"
          required
          maxLength={2000}
          rows={2}
          value={attribution}
          onChange={(event) => setAttribution(event.target.value)}
          placeholder="作者署名、来源与许可依据"
        />
      </label>
      {license === 'user-owned' && (
        <label className="auto-checkbox">
          <input
            type="checkbox"
            checked={ownsRights}
            onChange={(event) => setOwnsRights(event.target.checked)}
          />
          我拥有该模型的权利并允许将它作为设计参考。
        </label>
      )}
      {error && (
        <p className="auto-notice error" role="alert">
          {error}
        </p>
      )}
      {license === 'unknown' && (
        <p className="auto-small">
          许可未知时，只保存来源和署名信息，不发送或解析模型文件，也不提取设计模式。
        </p>
      )}
      <button
        className="auto-secondary"
        type="submit"
        disabled={busy || (license !== 'unknown' && !file)}
      >
        {busy ? <LoaderCircle size={15} className="auto-spin" /> : <Upload size={15} />}
        {license === 'unknown' ? '仅保存来源链接' : '解析并记录来源'}
      </button>
      <p className="auto-small">
        粘贴官网链接不会导入或分析官方模型。未知几何会记录为缺失，不会假定已验证。
      </p>
    </form>
  );
}

export default function AutomotiveDesigner({ lab = false }: { lab?: boolean }) {
  const [status, setStatus] = useState<AutomotiveStatusView | null>(null);
  const [query, setQuery] = useState('Mercedes-AMG S 63 W223');
  const [research, setResearch] = useState<VehicleResearchResult | null>(null);
  const [session, setSession] = useState<AutomotiveSessionView | null>(null);
  const [references, setReferences] = useState<ReferenceLibraryEntry[]>([]);
  const [patternLibrary, setPatternLibrary] = useState<AutomotivePatternLibraryView | null>(null);
  const [patternsLoading, setPatternsLoading] = useState(false);
  const [patternsError, setPatternsError] = useState('');
  const [referenceIds, setReferenceIds] = useState<string[]>([]);
  const [width, setWidth] = useState('10');
  const [customWidth, setCustomWidth] = useState(14);
  const [estimated, setEstimated] = useState(false);
  const [count, setCount] = useState(8);
  const [color, setColor] = useState(colors[0]);
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>('loading');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [tab, setTab] = useState<'brief' | 'research' | 'scores' | 'bom' | 'steps'>(
    lab ? 'research' : 'brief',
  );
  const [showGrid, setShowGrid] = useState(true);
  const [exploded, setExploded] = useState(false);
  const [underside, setUnderside] = useState(false);
  const [viewerKey, setViewerKey] = useState(0);
  const [step, setStep] = useState(0);
  const profile = research?.profile ?? null;
  const candidate =
    session?.candidates.find((item) => item.id === selectedId) ?? session?.candidates[0];
  const currentStep = candidate?.steps[step];
  const stepMode = tab === 'steps' && candidate?.exportable && currentStep;
  const viewerParts = useMemo(
    () => toSpeedViewerParts(stepMode ? currentStep.totalModelState : (candidate?.parts ?? [])),
    [candidate, currentStep, stepMode],
  );
  const highlightIds = useMemo(
    () => (stepMode ? currentStep.addedParts.map((part) => part.instanceId) : []),
    [stepMode, currentStep],
  );
  const targetWidth = width === 'custom' ? customWidth : Number(width);
  const missingDimensions = profile
    ? Object.values(profile.dimensions).some((fact) => fact.value === null)
    : false;
  const validatedCount = session?.candidates.filter((item) => item.exportable).length ?? 0;
  const weightsTotal = Object.values(weights).reduce((sum, value) => sum + value, 0);
  const confirmedPatterns = patternLibrary?.confirmed ?? session?.patterns ?? [];

  useEffect(() => {
    if (!lab) return;
    let active = true;
    setPatternsLoading(true);
    setPatternsError('');
    void automotiveClient
      .patterns()
      .then((result) => {
        if (active) setPatternLibrary(result);
      })
      .catch((failure) => {
        if (active) setPatternsError(automotiveFailure(failure));
      })
      .finally(() => {
        if (active) setPatternsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [lab]);

  useEffect(() => {
    let active = true;
    let restoreVersion = 0;
    const applySession = (restored: AutomotiveSessionView) => {
      setSession(restored);
      setSelectedId(
        restored.candidates.find((item) => item.exportable)?.id ?? restored.candidates[0]?.id ?? '',
      );
      setResearch({
        status: 'partial',
        profile: restored.profile,
        attempts: [],
        warnings: restored.profile.warnings,
      });
      setQuery(
        `${restored.profile.manufacturer} ${restored.profile.model} ${restored.profile.generation ?? ''}`,
      );
      setWidth(
        [8, 10, 12].includes(restored.brief.targetWidthStuds)
          ? String(restored.brief.targetWidthStuds)
          : 'custom',
      );
      setCustomWidth(restored.brief.targetWidthStuds);
      setReferenceIds(restored.referenceSet.references.map((reference) => reference.referenceId));
      setEstimated(restored.brief.dimensionBasis !== 'source-backed');
      setColor(
        colors.find((entry) => entry.id === restored.color.actual.id) ?? restored.color.actual,
      );
      if (restored.candidates[0]?.designValidation.weights)
        setWeights((previous) => ({
          ...previous,
          ...restored.candidates[0].designValidation.weights,
        }));
      setStep(0);
      setNotice(`已恢复设计记录。${restored.message}`);
    };
    void (async () => {
      const initialSession = sessionFromLocation();
      const version = ++restoreVersion;
      const results = await Promise.allSettled([
        automotiveClient.status(),
        automotiveClient.references(),
        automotiveClient.research('Mercedes-AMG S 63 W223'),
        initialSession ? automotiveClient.session(initialSession) : Promise.resolve(null),
      ] as const);
      if (!active) return;
      if (results[0].status === 'fulfilled') {
        setStatus(results[0].value);
        if (results[0].value.rankingWeights) setWeights(results[0].value.rankingWeights);
      } else setError(automotiveFailure(results[0].reason));
      if (results[1].status === 'fulfilled') setReferences(results[1].value.references);
      if (version === restoreVersion) {
        if (results[2].status === 'fulfilled') setResearch(results[2].value);
        else setError(automotiveFailure(results[2].reason));
        if (results[3].status === 'fulfilled' && results[3].value) applySession(results[3].value);
        else if (results[3].status === 'rejected') setError(automotiveFailure(results[3].reason));
        setBusy(null);
      }
    })();
    const restore = async () => {
      const id = sessionFromLocation();
      if (!id) return;
      const version = ++restoreVersion;
      setBusy('restore');
      setError('');
      try {
        const restored = await automotiveClient.session(id);
        if (active && version === restoreVersion) applySession(restored);
      } catch (failure) {
        if (active && version === restoreVersion) setError(automotiveFailure(failure));
      } finally {
        if (active && version === restoreVersion) setBusy(null);
      }
    };
    window.addEventListener('hashchange', restore);
    return () => {
      active = false;
      window.removeEventListener('hashchange', restore);
    };
  }, []);
  async function doResearch(event?: FormEvent) {
    event?.preventDefault();
    setBusy('research');
    setError('');
    setNotice('');
    try {
      const result = await automotiveClient.research(query.trim());
      setResearch(result);
      setTab('research');
      if (!result.profile)
        setNotice('没有匹配的车型资料。可使用已列出的车型，或通过「补充手动车型资料」录入车型。');
    } catch (failure) {
      setError(automotiveFailure(failure));
    } finally {
      setBusy(null);
    }
  }
  async function generate() {
    if (LEGACY_OPERATIONS_BLOCKED) { setError(LEGACY_GENERATION_BLOCK.error); return; }
    if (!profile) return;
    setBusy('generate');
    setError('');
    setNotice('');
    try {
      const result = await automotiveClient.design({
        profileId: profile.id,
        widthStuds: targetWidth,
        allowEstimatedProportions: estimated,
        candidateCount: count,
        referenceIds,
        bodyColor: color,
        ...(Object.keys(weights).length ? { weights } : {}),
      });
      setSession(result);
      setSelectedId(
        result.candidates.find((item) => item.exportable)?.id ?? result.candidates[0]?.id ?? '',
      );
      setStep(0);
      setTab('brief');
      setNotice(
        result.message ||
          `已返回 ${result.candidates.length} 个候选，${result.candidates.filter((item) => item.exportable).length} 个通过导出检查。`,
      );
    } catch (failure) {
      setError(automotiveFailure(failure));
    } finally {
      setBusy(null);
    }
  }
  async function download(kind: 'bom.csv' | 'bom.json' | 'instructions.pdf' | 'model.json') {
    if (LEGACY_OPERATIONS_BLOCKED) { setError(LEGACY_GENERATION_BLOCK.error); return; }
    if (!session || !candidate?.exportable) return;
    setBusy(`export-${kind}`);
    setError('');
    try {
      await automotiveClient.download(session.sessionId, candidate.id, kind);
    } catch (failure) {
      setError(automotiveFailure(failure));
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="auto-page">
      <div className="auto-notice" role="status">
        <strong>历史参数化预览 · 零件未验证</strong>
        <span>{LEGACY_GENERATION_BLOCK.error} <a href="#/part-lab">打开真实零件库</a></span>
      </div>
      <header className="auto-header">
        <a className="auto-brand" href="#/general" aria-label="Bricklab 首页">
          <span className="auto-mark">
            <Blocks size={23} strokeWidth={1.6} />
          </span>
          bricklab<span className="auto-brand-dot">.</span>
        </a>
        <nav className="auto-nav" aria-label="主导航">
          <a href="#/general">
            通用创意 <span>V0.1</span>
          </a>
          <a href="#/speed">
            Speed Creative <span>V0.2</span>
          </a>
          <a className="active" href="#/automotive">
            Automotive <span>V0.3</span>
          </a>
        </nav>
        <a
          href={
            lab
              ? `#/automotive${session ? `?session=${encodeURIComponent(session.sessionId)}` : ''}`
              : `#/automotive-lab${session ? `?session=${encodeURIComponent(session.sessionId)}` : ''}`
          }
          className="auto-lab-link"
        >
          <FlaskConical size={16} />
          {lab ? '返回设计器' : 'Automotive Lab'}
          <ArrowUpRight size={13} />
        </a>
      </header>
      <main className="auto-main">
        <section className="auto-intro">
          <div>
            <p className="auto-kicker">
              <span />
              FREE AUTOMOTIVE DESIGNER / V0.3
            </p>
            <h1>
              {lab ? '让设计过程，' : '从真实车型，'}
              <em>{lab ? '有据可查。' : '到积木语言。'}</em>
            </h1>
            <p>
              {lab
                ? '检查资料、参考来源、构建模式和候选评分，查看每个设计决定的依据。'
                : '研究车型特征，重新规划每个宽度的结构，比较真正由零件构建的候选。'}
            </p>
          </div>
          <div className="auto-intro-note">
            <CarFront size={25} strokeWidth={1.3} />
            <span>FREE DESIGN MODE</span>
            <strong>旧版参数化零件 · 仅供查看</strong>
            <small>材料清单记录设计所需数量</small>
          </div>
        </section>
        <div className="auto-runtime">
          <span>
            <span className={`auto-status-dot ${status ? '' : 'offline'}`} />
            {status
              ? 'Automotive 引擎已连接'
              : busy === 'loading'
                ? '正在连接 Automotive 引擎'
                : 'Automotive 引擎不可用'}
          </span>
          <span>规则驱动生成 · 未训练 AI 模型</span>
          <span>参考图片尚未分析</span>
          <span>零件颜色组合的生产可用性未核实</span>
          <span>W223 首个验证目标 · 多车型结构</span>
        </div>
        {error && (
          <div className="auto-notice error" role="alert">
            <CircleHelp size={16} />
            {error}
          </div>
        )}
        {notice && (
          <div className="auto-notice" role="status">
            <Check size={15} />
            {notice}
          </div>
        )}
        <div className="auto-layout">
          <aside className="auto-sidebar">
            <section className="auto-panel">
              <div className="auto-panel-title">
                <span className="auto-section-number">01</span>
                <h2>目标车型</h2>
                <CarFront size={17} />
              </div>
              <form onSubmit={doResearch}>
                <label className="auto-field">
                  车型或代号
                  <input
                    className="auto-input"
                    list="automotive-models"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Mercedes-AMG S 63 W223"
                    required
                    maxLength={500}
                    disabled={Boolean(busy)}
                  />
                  <datalist id="automotive-models">
                    {status?.profiles.map((item) => (
                      <option
                        key={item.id}
                        value={`${item.manufacturer} ${item.model} ${item.generation ?? ''}`}
                      />
                    ))}
                  </datalist>
                </label>
                <button
                  className="auto-secondary auto-full"
                  type="submit"
                  disabled={Boolean(busy) || !query.trim()}
                >
                  {busy === 'research' || busy === 'loading' ? (
                    <LoaderCircle size={15} className="auto-spin" />
                  ) : (
                    <SlidersHorizontal size={15} />
                  )}
                  研究车型与来源
                  <ArrowRight size={14} />
                </button>
              </form>
              {profile && (
                <div className="auto-profile-summary">
                  <strong>
                    {profile.manufacturer} {profile.model}
                  </strong>
                  <small>
                    {profile.generation} · {classes[profile.vehicleType]}
                  </small>
                  <Badge tone={missingDimensions ? 'warn' : 'good'}>
                    {missingDimensions ? '尺寸待补充' : '尺寸可用'}
                  </Badge>
                </div>
              )}
              <p className="auto-small">
                可切换 S63、M4、911、Roma、Revuelto。车型目录特征需要进一步核实。
              </p>
              <ManualProfileForm
                busy={Boolean(busy)}
                onSave={(manual) => {
                  setResearch({
                    status: 'partial',
                    profile: manual,
                    attempts: [],
                    warnings: manual.warnings,
                  });
                  setQuery(`${manual.manufacturer} ${manual.model}`);
                  setTab('research');
                  setNotice('已选用手动车型资料。尺寸标为用户提供，未独立验证。');
                }}
              />
            </section>
            <section className="auto-panel">
              <div className="auto-panel-title">
                <span className="auto-section-number">02</span>
                <h2>设计约束</h2>
                <Ruler size={17} />
              </div>
              <div className="auto-field">
                <span id="auto-width-label">目标车宽</span>
                <span className="auto-field-detail">stud</span>
                <div className="auto-width-options" role="group" aria-labelledby="auto-width-label">
                  {['8', '10', '12', 'custom'].map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={width === value ? 'selected' : ''}
                      onClick={() => setWidth(value)}
                      disabled={Boolean(busy)}
                    >
                      {value === 'custom' ? '自定义' : value}
                    </button>
                  ))}
                </div>
              </div>
              {width === 'custom' && (
                <label className="auto-field">
                  自定义宽度
                  <input
                    className="auto-input"
                    type="number"
                    min={6}
                    max={24}
                    step={1}
                    value={customWidth}
                    onChange={(event) => setCustomWidth(Number(event.target.value))}
                    disabled={Boolean(busy)}
                  />
                </label>
              )}
              <p className="auto-small">宽度变化会重新计算轴距、车舱和模块布局。</p>
              {width === 'custom' && ![8, 10, 12].includes(customWidth) && (
                <p className="auto-inline-warning">
                  <CircleHelp size={13} />
                  此宽度目前只生成 Design Brief；轮架与整车布局尚未校准，导出会被阻止。
                </p>
              )}
              <div className="auto-field">
                <span id="auto-color-label">车身主色</span>
                <div className="auto-swatches" role="group" aria-labelledby="auto-color-label">
                  {colors.map((option) => (
                    <button
                      type="button"
                      className={`auto-swatch ${color.id === option.id ? 'selected' : ''}`}
                      key={option.id}
                      aria-label={option.name}
                      aria-pressed={color.id === option.id}
                      title={option.name}
                      style={{ background: option.hex }}
                      onClick={() => setColor(option)}
                      disabled={Boolean(busy)}
                    >
                      {color.id === option.id && (
                        <Check
                          size={14}
                          style={{
                            color: option.id === 15 || option.id === 71 ? '#173e35' : 'white',
                          }}
                        />
                      )}
                    </button>
                  ))}
                  <span>{color.name}</span>
                </div>
              </div>
              <label className="auto-field">
                候选数量 <strong>{count}</strong>
                <input
                  aria-label="候选数量"
                  type="range"
                  min={5}
                  max={20}
                  step={1}
                  value={count}
                  onChange={(event) => setCount(Number(event.target.value))}
                  disabled={Boolean(busy)}
                />
                <span className="auto-range-labels">
                  <span>5 个 · 快速比较</span>
                  <span>20 个 · 更多探索</span>
                </span>
              </label>
              <label className="auto-checkbox auto-estimate">
                <input
                  type="checkbox"
                  checked={estimated}
                  onChange={(event) => setEstimated(event.target.checked)}
                  disabled={Boolean(busy)}
                />
                <span>
                  <strong>允许 estimated 比例</strong>
                  <small>当真实尺寸缺失时，采用明确记录的车型工程比例。生成结果会标明估算。</small>
                </span>
              </label>
              {missingDimensions && !estimated && (
                <p className="auto-inline-warning">
                  <CircleHelp size={13} />
                  当前缺少真实尺寸。请补充资料或允许估算。
                </p>
              )}
            </section>
            <section className="auto-panel">
              <div className="auto-panel-title">
                <span className="auto-section-number">03</span>
                <h2>参考与生成</h2>
                <Layers3 size={17} />
              </div>
              {references.filter((item) => item.kind === 'model').length ? (
                <div className="auto-ref-select">
                  {references
                    .filter((item) => item.kind === 'model')
                    .map((item) => (
                      <label className="auto-checkbox" key={item.id}>
                        <input
                          type="checkbox"
                          checked={referenceIds.includes(item.id)}
                          disabled={Boolean(busy) || item.metadata.license === 'unknown'}
                          onChange={(event) =>
                            setReferenceIds((previous) =>
                              event.target.checked
                                ? [...previous, item.id]
                                : previous.filter((id) => id !== item.id),
                            )
                          }
                        />
                        <span>
                          {item.metadata.modelName}
                          <small>
                            {item.metadata.license} · {item.metadata.author}
                          </small>
                        </span>
                      </label>
                    ))}
                </div>
              ) : (
                <div className="auto-reference-empty">
                  <BookOpen size={18} />
                  <p>
                    还没有可用参考模型。
                    <br />
                    本次使用已验证的工程局部构建模式。
                  </p>
                </div>
              )}
              <a
                href={
                  session
                    ? `#/automotive-lab?session=${encodeURIComponent(session.sessionId)}`
                    : '#/automotive-lab'
                }
                className="auto-text-link"
              >
                管理参考来源 <ArrowUpRight size={12} />
              </a>
              {Object.keys(weights).length > 0 && (
                <details className="auto-details auto-weight-controls">
                  <summary>候选排序偏好</summary>
                  <p className="auto-small">
                    调整各项对综合评分的影响。碰撞、连接与最低质量要求始终保留。
                  </p>
                  {Object.entries(weights).map(([key, value]) => (
                    <label className="auto-field" key={key}>
                      {scoreLabels[key as keyof typeof scoreLabels] ?? key}
                      <strong>
                        {weightsTotal > 0 ? Math.round((value / weightsTotal) * 100) : 0}%
                      </strong>
                      <input
                        type="range"
                        aria-label={`${scoreLabels[key as keyof typeof scoreLabels] ?? key}权重`}
                        min={0}
                        max={100}
                        step={1}
                        value={Math.round(value * 100)}
                        onChange={(event) =>
                          setWeights((previous) => ({
                            ...previous,
                            [key]: Number(event.target.value) / 100,
                          }))
                        }
                        disabled={Boolean(busy)}
                      />
                    </label>
                  ))}
                  <button
                    type="button"
                    className="auto-text-link"
                    disabled={Boolean(busy)}
                    onClick={() => setWeights(status?.rankingWeights ?? {})}
                  >
                    恢复默认偏好
                  </button>
                  {weightsTotal === 0 && (
                    <p className="auto-inline-warning">至少保留一项排序权重。</p>
                  )}
                </details>
              )}
              <button
                className="auto-primary auto-full"
                type="button"
                onClick={generate}
                disabled={
                  LEGACY_OPERATIONS_BLOCKED ||
                  Boolean(busy) ||
                  (Object.keys(weights).length > 0 && weightsTotal === 0) ||
                  !profile ||
                  (missingDimensions && !estimated) ||
                  !Number.isInteger(targetWidth) ||
                  targetWidth < 6 ||
                  targetWidth > 24
                }
              >
                {busy === 'generate' ? (
                  <LoaderCircle size={17} className="auto-spin" />
                ) : (
                  <WandSparkles size={17} />
                )}
                {busy === 'generate' ? '规划与验证候选…' : `生成 ${count} 个设计候选`}
                <ArrowRight size={16} />
              </button>
              <p className="auto-small">
                通过碰撞、连接、车轮和结构检查后，才能导出材料清单与说明书。
              </p>
            </section>
          </aside>
          <div className="auto-workspace">
            <section className="auto-model-panel">
              <div className="auto-workspace-header">
                <div>
                  <span className="auto-kicker">DESIGN WORKSPACE</span>
                  <h2>
                    {candidate?.name ||
                      (session?.status === 'unsupported'
                        ? '自定义宽度 · 规划已完成'
                        : session?.status === 'rejected'
                          ? '本轮候选未通过质量门槛'
                          : '等待你的第一个汽车设计')}
                  </h2>
                </div>
                <Badge tone={candidate ? (candidate.exportable ? 'good' : 'bad') : ''}>
                  {candidate
                    ? candidate.exportable
                      ? '数字检查通过'
                      : '仅供检查 · 导出已阻止'
                    : session?.status === 'unsupported'
                      ? '仅 Brief · 整车导出已阻止'
                      : session?.status === 'rejected'
                        ? '未通过 · 导出已阻止'
                        : '3D 设计工作区'}
                </Badge>
              </div>
              <div className="auto-viewer">
                {candidate ? (
                  <ModelViewer
                    key={viewerKey}
                    parts={viewerParts}
                    adapter={speedRenderingAdapter}
                    initialView="front"
                    highlightIds={highlightIds}
                    showGrid={showGrid}
                    exploded={exploded}
                    allowUnderside={underside}
                  />
                ) : (
                  <div className="auto-viewer-empty">
                    <div className="auto-blueprint">
                      <CarFront size={80} strokeWidth={0.65} />
                      <span className="auto-blueprint-width">{targetWidth} STUDS</span>
                      <i />
                      <i />
                    </div>
                    <span className="auto-kicker">RESEARCH → BRIEF → BUILD → VALIDATE</span>
                    <h3>
                      {session?.status === 'unsupported'
                        ? '已保存自定义宽度的模块规划。'
                        : session?.status === 'rejected'
                          ? '尚无通过质量门槛的候选。'
                          : '把特征，变成可以拼搭的设计。'}
                    </h3>
                    <p>
                      {session?.status === 'unsupported'
                        ? '查看下方 Design Brief。此宽度的轮架与整车布局尚未校准，可以改选 8、10 或 12 stud。'
                        : session?.status === 'rejected'
                          ? '查看评分与生成诊断，调整车型资料、宽度或参考来源后再试。'
                          : '选择车型与宽度，生成候选后在这里旋转、缩放并检查真实零件布局。'}
                    </p>
                  </div>
                )}
                <div className="auto-viewer-caption">
                  <Box size={12} />
                  {candidate ? '旧版参数化示意图 · 不代表真实零件网格' : '旧版生成已暂停，请先完善真实零件库'}
                  <span>{candidate ? '拖动旋转 · 滚轮缩放' : '无库存限制'}</span>
                </div>
                {busy === 'generate' && (
                  <div className="auto-generating">
                    <LoaderCircle size={28} className="auto-spin" />
                    <strong>重规划模块并检查候选</strong>
                    <span>构建零件 → 检查接口 → 评分排序</span>
                  </div>
                )}
              </div>
              <div className="auto-toolbar">
                <div>
                  <button
                    className={showGrid ? 'active' : ''}
                    aria-label="显示网格"
                    aria-pressed={showGrid}
                    onClick={() => setShowGrid((value) => !value)}
                  >
                    <Grid2X2 size={15} />
                    <span>网格</span>
                  </button>
                  <button
                    className={exploded ? 'active' : ''}
                    aria-label="分解视图"
                    aria-pressed={exploded}
                    onClick={() => setExploded((value) => !value)}
                  >
                    <Layers3 size={15} />
                    <span>分解</span>
                  </button>
                  <button
                    className={underside ? 'active' : ''}
                    aria-label="允许查看底部"
                    aria-pressed={underside}
                    onClick={() => setUnderside((value) => !value)}
                  >
                    <Box size={15} />
                    <span>底部</span>
                  </button>
                </div>
                <button aria-label="重置视角" onClick={() => setViewerKey((value) => value + 1)}>
                  <RotateCcw size={14} />
                  <span>重置视角</span>
                </button>
              </div>
              <div className="auto-stats">
                <div className="auto-stat">
                  <span>车宽</span>
                  <strong>
                    {candidate ? number(candidate.dimensions.x) : targetWidth}
                    <small>stud</small>
                  </strong>
                </div>
                <div className="auto-stat">
                  <span>车长</span>
                  <strong>
                    {candidate ? number(candidate.dimensions.y) : '—'}
                    <small>stud</small>
                  </strong>
                </div>
                <div className="auto-stat">
                  <span>设计零件</span>
                  <strong>
                    {candidate?.parts.length ?? '—'}
                    <small>件</small>
                  </strong>
                </div>
                <div className="auto-stat">
                  <span>通过检查</span>
                  <strong>
                    {session ? `${validatedCount}/${session.candidates.length}` : '—'}
                    <small>候选</small>
                  </strong>
                </div>
              </div>
            </section>
            {session && (
              <section className="auto-candidates-section">
                <div className="auto-split">
                  <h3>
                    设计候选 <small>{session.candidates.length} 个</small>
                  </h3>
                  <span className="auto-small">按综合评分比较 · 分数为规则启发式</span>
                </div>
                <div className="auto-candidates">
                  {session.candidates.map((item, index) => (
                    <button
                      key={item.id}
                      className={`auto-candidate ${item.id === candidate?.id ? 'selected' : ''}`}
                      onClick={() => {
                        setSelectedId(item.id);
                        setStep(0);
                      }}
                      aria-pressed={item.id === candidate?.id}
                    >
                      <div className="auto-split">
                        <span className="auto-candidate-number">
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        <Badge tone={item.exportable ? 'good' : 'bad'}>
                          {item.exportable ? '可导出' : '已阻止'}
                        </Badge>
                      </div>
                      <strong>{item.name}</strong>
                      <p>{item.description}</p>
                      <div className="auto-candidate-bottom">
                        <span>{item.parts.length} 件</span>
                        <span>
                          综合 <b>{number(item.scores.overall)}</b>
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            )}
            <section className="auto-information">
              <div className="auto-tabs" role="tablist" aria-label="设计详情">
                {(
                  [
                    { id: 'brief', name: 'Design Brief', icon: Ruler },
                    { id: 'research', name: '车型研究', icon: BookOpen },
                    { id: 'scores', name: '评分与检查', icon: ShieldCheck },
                    { id: 'bom', name: '所需零件', icon: Palette },
                    { id: 'steps', name: '拼搭步骤', icon: Layers3 },
                  ] as const
                ).map((item) => (
                  <button
                    role="tab"
                    aria-selected={tab === item.id}
                    aria-controls={`auto-tab-${item.id}`}
                    id={`auto-tab-button-${item.id}`}
                    key={item.id}
                    className={tab === item.id ? 'active' : ''}
                    onClick={() => {
                      setTab(item.id);
                      setStep(0);
                    }}
                  >
                    <item.icon size={14} />
                    {item.name}
                  </button>
                ))}
              </div>
              <div
                className="auto-tab-content"
                role="tabpanel"
                id={`auto-tab-${tab}`}
                aria-labelledby={`auto-tab-button-${tab}`}
              >
                {tab === 'brief' && <BriefDetails brief={session?.brief} />}
                {tab === 'research' && <ResearchDetails profile={profile} research={research} />}
                {tab === 'scores' &&
                  (candidate ? (
                    <>
                      <div className="auto-split">
                        <h3>候选评分与采用理由</h3>
                        <Badge>规则启发分 / 100</Badge>
                      </div>
                      <CandidateScores candidate={candidate} />
                      <QualityEvidence candidate={candidate} />
                      <ul className="auto-reasons">
                        {candidate.reasons.map((reason, i) => (
                          <li key={i}>{reason}</li>
                        ))}
                      </ul>
                      <div className="auto-validation">
                        {(['collision', 'connection', 'wheels', 'structure'] as const).map(
                          (key) => (
                            <Badge
                              key={key}
                              tone={candidate.validation[key].valid ? 'good' : 'bad'}
                            >
                              {candidate.validation[key].valid ? (
                                <Check size={12} />
                              ) : (
                                <CircleHelp size={12} />
                              )}
                              {
                                {
                                  collision: '碰撞检查',
                                  connection: '连接检查',
                                  wheels: '车轮检查',
                                  structure: '结构检查',
                                }[key]
                              }
                            </Badge>
                          ),
                        )}
                      </div>
                      <Warnings
                        items={[
                          ...candidate.rejectionReasons,
                          ...candidate.validation.errors,
                          ...candidate.warnings,
                        ]}
                      />
                      <p className="auto-small">
                        数字检查基于目录建模与连接规则；未进行实体试拼。辨识度分数没有来自图片识别。
                      </p>
                    </>
                  ) : (
                    <Empty title="生成候选后查看评分与检查结果" />
                  ))}
                {tab === 'bom' && <Bom candidate={candidate} />}
                {tab === 'steps' &&
                  (candidate?.exportable && currentStep ? (
                    <>
                      <div className="auto-stepper">
                        <button
                          className="auto-icon-button"
                          aria-label="上一步"
                          disabled={step === 0}
                          onClick={() => setStep((value) => value - 1)}
                        >
                          <ChevronLeft size={18} />
                        </button>
                        <div>
                          <span className="auto-kicker">
                            STEP {step + 1} / {candidate.steps.length}
                          </span>
                          <h3>{currentStep.title}</h3>
                        </div>
                        <button
                          className="auto-icon-button"
                          aria-label="下一步"
                          disabled={step >= candidate.steps.length - 1}
                          onClick={() => setStep((value) => value + 1)}
                        >
                          <ChevronRight size={18} />
                        </button>
                      </div>
                      <p className="auto-small">{currentStep.description}</p>
                      <p className="auto-small">
                        本步加入 {currentStep.addedParts.length} 件 · 累计{' '}
                        {currentStep.totalModelState.length} 件 · 3D 视图已高亮本步零件
                      </p>
                      <input
                        className="auto-step-range"
                        type="range"
                        aria-label="拼搭步骤"
                        min={0}
                        max={candidate.steps.length - 1}
                        value={step}
                        onChange={(event) => setStep(Number(event.target.value))}
                      />
                    </>
                  ) : (
                    <Empty
                      title={
                        candidate
                          ? '此候选尚未通过说明书导出检查'
                          : '生成通过检查的候选后查看拼搭步骤'
                      }
                    >
                      通过数字检查后可以浏览逐步模型，并导出 PDF 说明书。
                    </Empty>
                  ))}
              </div>
            </section>
            <section className="auto-export">
              <div>
                <span className="auto-kicker">TAKE YOUR DESIGN</span>
                <h3>开始下一步拼搭</h3>
                <p>此历史版本的零件未完成来源验证，材料需求和拼搭说明导出已暂停。</p>
              </div>
              <div className="auto-export-actions">
                <button
                  className="auto-secondary"
                  disabled={LEGACY_OPERATIONS_BLOCKED || Boolean(busy) || !candidate?.exportable}
                  onClick={() => download('bom.csv')}
                >
                  <ArrowDownToLine size={14} />
                  BOM CSV
                </button>
                <button
                  className="auto-secondary"
                  disabled={LEGACY_OPERATIONS_BLOCKED || Boolean(busy) || !candidate?.exportable}
                  onClick={() => download('bom.json')}
                >
                  <FileJson size={14} />
                  BOM JSON
                </button>
                <button
                  className="auto-secondary"
                  disabled={LEGACY_OPERATIONS_BLOCKED || Boolean(busy) || !candidate?.exportable}
                  onClick={() => download('model.json')}
                >
                  <Code2 size={14} />
                  模型 JSON
                </button>
                <button
                  className="auto-primary"
                  disabled={LEGACY_OPERATIONS_BLOCKED || Boolean(busy) || !candidate?.exportable}
                  onClick={() => download('instructions.pdf')}
                >
                  {busy?.startsWith('export-') ? (
                    <LoaderCircle size={15} className="auto-spin" />
                  ) : (
                    <BookOpen size={15} />
                  )}
                  拼搭说明 PDF
                </button>
              </div>
            </section>
            {session && <Warnings items={session.warnings} />}
          </div>
        </div>
        {lab && (
          <section className="auto-lab-section">
            <div className="auto-lab-heading">
              <span className="auto-kicker">
                <FlaskConical size={14} />
                AUTOMOTIVE LAB / INSPECT THE EVIDENCE
              </span>
              <h2>每个设计，都留下依据。</h2>
              <p>来源、解析覆盖率、构建模式与调试数据。未获取、未验证的内容会明确标记。</p>
            </div>
            <div className="auto-lab-grid">
              <section className="auto-panel">
                <ReferenceImporter
                  busy={Boolean(busy)}
                  onImport={async (filename, content, metadata) => {
                    setBusy('import');
                    setError('');
                    try {
                      await automotiveClient.importReference(filename, content, metadata);
                      setPatternsLoading(true);
                      setPatternsError('');
                      const [referenceResult, patternResult] = await Promise.allSettled([
                        automotiveClient.references(),
                        automotiveClient.patterns(),
                      ]);
                      if (referenceResult.status === 'fulfilled')
                        setReferences(referenceResult.value.references);
                      else
                        setError(
                          `来源已保存，但参考列表刷新失败：${automotiveFailure(referenceResult.reason)}`,
                        );
                      if (patternResult.status === 'fulfilled')
                        setPatternLibrary(patternResult.value);
                      else setPatternsError(automotiveFailure(patternResult.reason));
                      setNotice(
                        metadata.license === 'unknown'
                          ? '来源链接已保存。未导入模型内容或提取设计模式。'
                          : '参考模型已导入。自动提取的局部候选仍待人工审查，未进入生成器；请查看覆盖率、来源与程序检查。',
                      );
                    } finally {
                      setPatternsLoading(false);
                      setBusy(null);
                    }
                  }}
                />
              </section>
              <section className="auto-panel">
                <div className="auto-panel-title">
                  <BookOpen size={17} />
                  <h2>参考模型库</h2>
                  <Badge>{references.length}</Badge>
                </div>
                {references.length ? (
                  <div className="auto-ref-list">
                    {references.map((item) => (
                      <article key={item.id}>
                        <div className="auto-split">
                          <strong>{item.metadata.modelName}</strong>
                          <Badge tone={item.metadata.license === 'unknown' ? 'warn' : 'good'}>
                            {item.metadata.license}
                          </Badge>
                        </div>
                        <p>
                          {item.metadata.author} ·{' '}
                          {item.kind === 'model' ? '已解析模型' : '来源链接'}
                        </p>
                        <small>{item.metadata.attribution}</small>
                        <small>
                          {safeUrl(item.metadata.source) ? (
                            <a
                              href={safeUrl(item.metadata.source)}
                              target="_blank"
                              rel="noreferrer"
                            >
                              查看模型来源 ↗
                            </a>
                          ) : (
                            item.metadata.source
                          )}
                        </small>
                        <small>{item.metadata.importedAt}</small>
                        {item.kind === 'model' && (
                          <>
                            <div className="auto-inline">
                              <Badge>{item.parts.length} 件</Badge>
                              <Badge>
                                {Math.round(item.coverage.geometryRate * 100)}% 几何覆盖
                              </Badge>
                              <Badge>{item.submodels.length} 子模型</Badge>
                            </div>
                            {item.coverage.unresolvedPartIds.length > 0 && (
                              <p className="auto-small">
                                缺失几何：{item.coverage.unresolvedPartIds.join(', ')}
                              </p>
                            )}
                            <Warnings items={item.warnings} />
                          </>
                        )}
                      </article>
                    ))}
                  </div>
                ) : (
                  <Empty title="参考库为空">
                    没有已学习的官方模型。导入你拥有权利或开放许可的模型后，才会显示真实解析结果。
                  </Empty>
                )}
              </section>
            </div>
            <section className="auto-panel auto-lab-patterns">
              <ReferenceSelection session={session} />
            </section>
            <section className="auto-panel auto-lab-patterns">
              <div className="auto-panel-title">
                <Blocks size={17} />
                <h2>Lego Design Patterns</h2>
                <Badge>{confirmedPatterns.length} 个</Badge>
              </div>
              <p className="auto-small">
                已确认表示通过程序化目录、几何和接口检查。工程先验会明确标注；没有来源时不会声称从官方模型学得。
              </p>
              <Patterns patterns={confirmedPatterns} />
            </section>
            <ExtractedPatternCandidates
              library={patternLibrary}
              loading={patternsLoading}
              error={patternsError}
            />
            <section className="auto-panel auto-debug">
              <div className="auto-panel-title">
                <Code2 size={17} />
                <h2>可检查的设计记录</h2>
              </div>
              <p className="auto-small">
                {session ? `会话 ${session.sessionId}` : '等待生成设计会话'}
              </p>
              {status && <Warnings items={status.warnings} />}
              <details>
                <summary>Design Brief JSON</summary>
                <pre className="auto-json">
                  {JSON.stringify(session?.brief ?? { status: '等待生成 Design Brief' }, null, 2)}
                </pre>
              </details>
              <details>
                <summary>参考模型分析</summary>
                <pre className="auto-json">
                  {JSON.stringify(session?.referenceAnalyses ?? [], null, 2)}
                </pre>
              </details>
              <details>
                <summary>候选选择 / 检查 / 生成调试</summary>
                <pre className="auto-json">
                  {JSON.stringify(
                    session?.debug ?? {
                      status: '尚未生成候选',
                      method: 'rule-based',
                      imageAnalysis: 'not configured',
                      modelTraining: 'none',
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
              <details>
                <summary>旧版参数化目录 · {status?.palette.length ?? 0} 种</summary>
                <p className="auto-small">
                  以下为旧版手动参数化定义，不能作为真实几何、连接或可生成状态的证据。
                </p>
                <div className="auto-scroll">
                  <table className="auto-table">
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>名称</th>
                        <th>类别</th>
                        <th>连接点</th>
                      </tr>
                    </thead>
                    <tbody>
                      {status?.palette.map((part) => (
                        <tr key={part.partId}>
                          <td>{part.partId}</td>
                          <td>{part.name}</td>
                          <td>{part.category}</td>
                          <td>{part.connectionPoints.length}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </section>
          </section>
        )}
        <footer className="auto-footer">
          <a href="#/general">
            <ArrowLeft size={12} />
            通用创意
          </a>
          <span>BRICKLAB / AUTOMOTIVE V0.3 · 工程规则驱动 · 所有参考保留来源与许可</span>
          <a
            href={
              lab
                ? `#/automotive${session ? `?session=${encodeURIComponent(session.sessionId)}` : ''}`
                : `#/automotive-lab${session ? `?session=${encodeURIComponent(session.sessionId)}` : ''}`
            }
          >
            {lab ? '打开设计器' : '打开 Automotive Lab'}
            <ArrowUpRight size={12} />
          </a>
        </footer>
      </main>
    </div>
  );
}
