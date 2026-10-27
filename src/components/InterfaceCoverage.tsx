import './interface-coverage.css';

/** Counts come from one server report. Raw records, groups and physical interfaces are separate units. */
export interface InterfaceCoverageMetrics {
  physicalInterfacesDiscovered: number;
  verifiedPass: number;
  verifiedBlocked: number;
  requiresAstraReview: number;
  pending: number;
  verifiedCoveragePercent: number | null;
  processedCoveragePercent: number | null;
  rawSourceConnectionRecords: number;
  logicalConnectionGroups: number;
  enabledRawConnectionIds: number;
  verifiedPhysicalInterfaces: number;
  enabledPhysicalInterfaces: number;
  countBasis?: unknown;
}
export interface InterfaceCoverageData extends InterfaceCoverageMetrics {
  fullyAssemblyVerified: boolean;
  interfaceVerificationComplete: boolean;
  partiallyGeneratable: boolean;
}
export interface AggregateInterfaceCoverageData extends InterfaceCoverageMetrics {
  fullyAssemblyVerified: number;
  interfaceVerificationComplete: number;
  partiallyGeneratable: number;
  blockedParts: number;
  unresolvedParts: number;
}

const percent = (value: number | null | undefined) => value == null ? '—' : `${Number(value.toFixed(2))}%`;

export default function InterfaceCoverage({ value, title = '物理接口验证覆盖', description }: { value?: InterfaceCoverageMetrics; title?: string; description?: string }) {
  return <section className="interface-coverage" aria-label={title}>
    <h3>{title}</h3>
    {description && <p>{description}</p>}
    <div className="interface-coverage-states">{[
      ['physicalInterfacesDiscovered', '已发现物理接口'], ['verifiedPass', 'PASS'], ['verifiedBlocked', 'BLOCKED'], ['requiresAstraReview', 'REQUIRES_ASTRA_REVIEW'], ['pending', 'PENDING'],
    ].map(([key, label]) => <div key={key}><span>{label}</span><strong>{value ? String(value[key as keyof InterfaceCoverageMetrics] ?? '—') : '—'}</strong></div>)}</div>
    <dl className="interface-coverage-percentages"><div><dt>已验证覆盖率</dt><dd>{percent(value?.verifiedCoveragePercent)}</dd></div><div><dt>已处理覆盖率</dt><dd>{percent(value?.processedCoveragePercent)}</dd></div></dl>
    <dl className="interface-coverage-units"><div><dt>原始来源连接记录</dt><dd>{value?.rawSourceConnectionRecords ?? '—'}</dd></div><div><dt>逻辑连接组</dt><dd>{value?.logicalConnectionGroups ?? '—'}</dd></div><div><dt>已验证物理接口</dt><dd>{value?.verifiedPhysicalInterfaces ?? '—'}</dd></div><div><dt>已开放原始连接 ID</dt><dd>{value?.enabledRawConnectionIds ?? '—'}</dd></div><div><dt>已开放物理接口</dt><dd>{value?.enabledPhysicalInterfaces ?? '—'}</dd></div></dl>
    <p>已验证覆盖率 = PASS / 已发现物理接口；已处理覆盖率还包含 BLOCKED 与 Astra 待审。原始记录、逻辑组与物理接口是不同单位，不能相加。验证通过与运行时开放分别记录。</p>
  </section>;
}
