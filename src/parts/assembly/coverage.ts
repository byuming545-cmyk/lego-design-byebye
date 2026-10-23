import { groupPhysicalInterfaces, logicalConnectionGroupCount } from './interfaces.js';
import type { NativeAssemblyPart } from './types.js';
import type { ConnectionFixtureVerification } from './verification.js';

export type PhysicalInterfaceStatus = 'PASS' | 'BLOCKED' | 'REQUIRES_ASTRA_REVIEW' | 'PENDING';
export interface PhysicalInterfaceDecision {
  physicalInterfaceId: string;
  rawConnectionIds: string[];
  status: PhysicalInterfaceStatus;
  reasonCodes: string[];
  reasons: string[];
  proof?: ConnectionFixtureVerification;
  attempts?: number;
  interrupted?: boolean;
}
export interface PhysicalInterfaceCoverage {
  rawSourceConnectionRecords: number;
  logicalConnectionGroups: number;
  physicalInterfacesDiscovered: number;
  verifiedPass: number;
  verifiedBlocked: number;
  requiresAstraReview: number;
  pending: number;
  verifiedPhysicalInterfaces: number;
  enabledPhysicalInterfaces: number;
  enabledRawConnectionIds: number;
  verifiedCoveragePercent: number | null;
  processedCoveragePercent: number | null;
  fullyAssemblyVerified: boolean;
  interfaceVerificationComplete: boolean;
  partiallyGeneratable: boolean;
  decisions: PhysicalInterfaceDecision[];
  countBasis: string;
}
const fraction = (numerator: number, denominator: number): number | null => denominator ? Number((100 * numerator / denominator).toFixed(4)) : null;

/** A terminal blocked outcome counts as processed, never as verified PASS. */
export function buildPhysicalInterfaceCoverage(part: NativeAssemblyPart, decisions: readonly PhysicalInterfaceDecision[], enabledConnectionIds: readonly string[] = []): PhysicalInterfaceCoverage {
  if (new Set(decisions.map(decision => decision.physicalInterfaceId)).size !== decisions.length || decisions.some(decision => !['PASS', 'BLOCKED', 'REQUIRES_ASTRA_REVIEW', 'PENDING'].includes(decision.status))) throw new Error('Duplicate or unknown physical interface decisions are not valid coverage evidence.');
  const known = groupPhysicalInterfaces(part), byId = new Map(decisions.map(decision => [decision.physicalInterfaceId, decision]));
  const enabled = new Set(enabledConnectionIds);
  const normalized = known.map(group => {
    const found = byId.get(group.physicalInterfaceId);
    if (!found) return { physicalInterfaceId: group.physicalInterfaceId, rawConnectionIds: group.rawConnectionIds, status: 'PENDING' as const, reasonCodes: ['verification-not-completed'], reasons: ['This recognizable physical interface has not yet received a terminal decision.'] };
    if (found.rawConnectionIds.length !== group.rawConnectionIds.length || group.rawConnectionIds.some(id => !found.rawConnectionIds.includes(id))) throw new Error('Physical decision aliases do not match the current source group.');
    return { ...found, rawConnectionIds: [...group.rawConnectionIds] };
  });
  const discovered = known.length;
  const pass = normalized.filter(decision => decision.status === 'PASS').length;
  const blocked = normalized.filter(decision => decision.status === 'BLOCKED').length;
  const astra = normalized.filter(decision => decision.status === 'REQUIRES_ASTRA_REVIEW').length;
  const pending = normalized.filter(decision => decision.status === 'PENDING').length;
  const admitted = normalized.filter(decision => decision.status === 'PASS' && decision.rawConnectionIds.some(id => enabled.has(id)));
  return {
    rawSourceConnectionRecords: part.connections.points.length, logicalConnectionGroups: logicalConnectionGroupCount(part), physicalInterfacesDiscovered: discovered,
    verifiedPass: pass, verifiedBlocked: blocked, requiresAstraReview: astra, pending, verifiedPhysicalInterfaces: pass,
    enabledPhysicalInterfaces: admitted.length, enabledRawConnectionIds: admitted.reduce((sum, decision) => sum + decision.rawConnectionIds.filter(id => enabled.has(id)).length, 0),
    verifiedCoveragePercent: fraction(pass, discovered), processedCoveragePercent: fraction(pass + blocked + astra, discovered),
    fullyAssemblyVerified: discovered > 0 && pass === discovered,
    interfaceVerificationComplete: discovered > 0 && pending === 0,
    partiallyGeneratable: pass > 0 && pass < discovered,
    decisions: normalized,
    countBasis: 'Raw imported records; logical source-directive instances; physical interface groups deduplicated by position/direction/specification. Co-located different profiles remain separate here; occupancy sockets can be more conservative. Only PASS counts as verified; enabled additionally requires the supplied runtime allowlist.',
  };
}
export function aggregatePhysicalInterfaceCoverage(values: readonly PhysicalInterfaceCoverage[]) {
  const sum = (key: keyof PhysicalInterfaceCoverage) => values.reduce((total, value) => total + Number(value[key] ?? 0), 0);
  const discovered = sum('physicalInterfacesDiscovered'), pass = sum('verifiedPass'), blocked = sum('verifiedBlocked'), astra = sum('requiresAstraReview'), pending = sum('pending');
  return {
    rawSourceConnectionRecords: sum('rawSourceConnectionRecords'), logicalConnectionGroups: sum('logicalConnectionGroups'), physicalInterfacesDiscovered: discovered,
    verifiedPass: pass, verifiedBlocked: blocked, requiresAstraReview: astra, pending, verifiedPhysicalInterfaces: pass,
    enabledPhysicalInterfaces: sum('enabledPhysicalInterfaces'), enabledRawConnectionIds: sum('enabledRawConnectionIds'),
    verifiedCoveragePercent: fraction(pass, discovered), processedCoveragePercent: fraction(pass + blocked + astra, discovered),
    fullyAssemblyVerified: values.filter(value => value.fullyAssemblyVerified).length,
    interfaceVerificationComplete: values.filter(value => value.interfaceVerificationComplete).length,
    partiallyGeneratable: values.filter(value => value.partiallyGeneratable).length,
    blockedParts: values.filter(value => value.physicalInterfacesDiscovered > 0 && value.verifiedPass === 0 && value.pending === 0).length,
    unresolvedParts: values.filter(value => value.physicalInterfacesDiscovered === 0 || value.pending > 0 && value.verifiedPass === 0).length,
  };
}
