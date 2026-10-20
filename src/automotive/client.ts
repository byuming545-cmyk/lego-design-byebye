import type { RealVehicleProfile, VehicleResearchResult } from './research/types.js';
import type { ReferenceLibraryEntry, ReferenceMetadataInput } from './references/types.js';
import type {
  AutomotiveDesignInput,
  AutomotiveSessionView,
  AutomotiveStatusView,
  AutomotivePatternLibraryView,
} from './ui-types.js';
import type { AutomotiveDesignResponse, AutomotiveReferenceResponse } from './contracts.js';
import type { AutomotivePalette } from './palette.js';
import type { PackedVehicleCandidate } from '../speed/stepCodec.js';
import { unpackCandidateSteps } from '../speed/stepCodec.js';
import type { SpeedInventory } from '../speed/types.js';

const API = '/api/automotive';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    signal: AbortSignal.timeout(120_000),
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const data = await response.json().catch(() => ({ error: '服务返回了无法读取的响应。' }));
  if (!response.ok) throw new Error(data.error || '请求未完成，请重试。');
  return data as T;
}

export const automotiveClient = {
  async status(): Promise<AutomotiveStatusView> {
    const result = await request<
      Omit<AutomotiveStatusView, 'palette'> & { palette: AutomotivePalette }
    >('/status');
    return {
      ...result,
      palette: result.palette.parts,
      warnings: [...result.warnings, ...result.palette.warnings],
    };
  },
  research: (query: string) =>
    request<VehicleResearchResult>('/research', {
      method: 'POST',
      body: JSON.stringify({ query }),
    }),
  manualProfile: (input: unknown) =>
    request<{ profile: RealVehicleProfile }>('/profiles/manual', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  async design(input: AutomotiveDesignInput): Promise<AutomotiveSessionView> {
    return sessionView(
      await request<AutomotiveDesignResponse>('/design', {
        method: 'POST',
        body: JSON.stringify({ ...input, bodyColor: input.bodyColor.id }),
      }),
    );
  },
  async session(sessionId: string): Promise<AutomotiveSessionView> {
    return sessionView(
      await request<AutomotiveDesignResponse>(`/sessions/${encodeURIComponent(sessionId)}`),
    );
  },
  async references() {
    const result = await request<AutomotiveReferenceResponse>('/references');
    return {
      references: [...result.models, ...result.links] as ReferenceLibraryEntry[],
      analyses: result.analyses,
    };
  },
  patterns: () => request<AutomotivePatternLibraryView>('/patterns'),
  importReference: (filename: string, content: string, metadata: ReferenceMetadataInput) =>
    request<{
      model?: ReferenceLibraryEntry;
      link?: ReferenceLibraryEntry;
      analysis: unknown;
      patternCandidates?: AutomotivePatternLibraryView['candidates'];
    }>('/references/import', {
      method: 'POST',
      body: JSON.stringify({
        filename,
        content,
        metadata,
        ...(metadata.longitudinalAxis ? { longitudinalAxis: metadata.longitudinalAxis } : {}),
        ...(metadata.frontDirection ? { frontDirection: metadata.frontDirection } : {}),
      }),
    }),
  async download(
    sessionId: string,
    candidateId: string,
    kind: 'bom.csv' | 'bom.json' | 'instructions.pdf' | 'model.json',
  ) {
    const candidatePath = `/sessions/${encodeURIComponent(sessionId)}/candidates/${encodeURIComponent(candidateId)}`;
    if (kind === 'instructions.pdf') {
      const data = await request<{ candidate: PackedVehicleCandidate; inventory: SpeedInventory }>(
        `${candidatePath}/instructions`,
      );
      const { buildSpeedInstructionsPdf } = await import('../speed/pdf.js');
      const pdf = await buildSpeedInstructionsPdf(
        unpackCandidateSteps(data.candidate),
        data.inventory,
        {
          editionLabel: 'Free Automotive Designer · V0.3',
          creator: 'Bricklab Free Automotive Designer V0.3',
          footerLabel: 'Free Automotive Designer · V0.3 · 虚拟设计零件',
          readingGuide:
            '按步骤拼搭，绿色描边表示本步新增零件。清单记录设计所需数量，使用无限数量的虚拟零件调色板。具体零件与颜色的生产可用性未核实；数字检查不能替代实体试拼。纵向 1 板单位为 1 块薄板，普通砖高 3 板单位。',
        },
      );
      pdf.save(`automotive-${candidateId}-instructions.pdf`);
      return;
    }
    const suffix =
      kind === 'bom.csv'
        ? 'bom?format=csv'
        : kind === 'bom.json'
          ? 'bom?format=json'
          : 'model.json';
    const response = await fetch(`${API}${candidatePath}/${suffix}`, {
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || '候选未通过导出检查。');
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `automotive-${candidateId}-${kind}`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  },
};

function sessionView(result: AutomotiveDesignResponse): AutomotiveSessionView {
  return {
    sessionId: result.sessionId,
    profile: result.profile,
    brief: result.brief,
    color: result.color,
    references: [],
    referenceSet: result.references,
    referenceAnalyses: result.referenceAnalyses,
    patterns: result.patterns,
    warnings: result.warnings,
    debug: result.debug,
    message: result.message,
    status: result.status,
    candidates: result.candidates.map((entry) => {
      const candidate = unpackCandidateSteps(entry.candidate);
      return {
        id: entry.id,
        name: entry.name,
        description: candidate.model.description,
        parts: candidate.model.parts,
        steps: candidate.steps,
        validation: candidate.validation,
        dimensions: candidate.model.dimensions,
        scores: entry.scores,
        reasons: entry.reasons,
        exportable: entry.exportable,
        warnings: entry.warnings,
        rejectionReasons: [
          ...entry.designValidation.hardErrors,
          ...entry.designValidation.designErrors,
        ],
        patternIds: [],
        designValidation: entry.designValidation,
      };
    }),
  };
}

export function automotiveFailure(error: unknown): string {
  if (!(error instanceof Error)) return '操作未完成，请重试。';
  if (error.name === 'TimeoutError') return '请求超时。可以减少候选数量后重试。';
  if (error.message === 'Failed to fetch')
    return '暂时无法连接 Automotive 服务，请确认服务已启动。';
  return error.message;
}
