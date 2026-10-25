/** Historical definitions remain inspectable; this metadata can never grant admission. */
export const LEGACY_QUARANTINE = Object.freeze({
  legacyStatus: 'LEGACY_QUARANTINED' as const,
  sourceSystem: 'LegacyParametric' as const,
  nativeGeometryVerified: false as const,
  automaticPromotionAllowed: false as const,
});

/** Shared browser/server presentation policy. No Express or filesystem imports. */
export const LEGACY_OPERATIONS_BLOCKED: boolean = true;

export const LEGACY_PART_AUTHENTICITY = Object.freeze({
  ...LEGACY_QUARANTINE,
  source: 'legacy-parametric' as const,
  status: 'unverified' as const,
  nativeMeshImported: false,
  sourceConnectionsImported: false,
  generatable: false,
  verified: false,
});

export const LEGACY_GENERATION_BLOCK = Object.freeze({
  code: 'REAL_PARTS_FOUNDATION_REQUIRED',
  error: '旧版生成器尚未接入真实零件几何、来源连接与碰撞验证，已暂停生成、改造及导出。请先在真实零件库中完成验证。',
  partLabUrl: '/part-lab',
  authenticity: LEGACY_PART_AUTHENTICITY,
});
