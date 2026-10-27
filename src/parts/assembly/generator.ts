import { createHash } from 'node:crypto';
import { loadBundledLDrawManifest } from '../ldraw/index.js';
import { physicalConnectionKey, physicalEndpointKey } from './multipoint.js';
import { solveAttachment } from './solver.js';
import { assessWheelAssemblySources } from './wheelAssessment.js';
import { hasIsolatedUnknownDimensions, isGeneratableCapability } from './types.js';
import type { AttachmentEngine } from './engine.js';
import { ConnectorRegistry } from '../grammar/library.js';
import { adaptImportedConnection, isSourceDeclaredBarEndpoint, isSourceDeclaredClipEndpoint } from '../grammar/sources.js';
import { describeValidatedNativeModel } from '../grammar/modelAssessment.js';
import type { ImportedConnectionPoint } from '../connections/types.js';
import type {
  AssemblyAttachRequest, AssemblyInterfaceCapability, NativeAssembly, NativeAssemblyPart,
  NativePlacement, RigidTransform, Vector3,
} from './types.js';

export const NATIVE_MODULE_TYPES = ['wall', 'platform', 'simple-chassis', 'simple-box', 'simple-roof', 'basic-snot', 'wheel-module', 'bar-clip'] as const;
export type NativeModuleType = typeof NATIVE_MODULE_TYPES[number];
export interface NativeModuleRequest {
  module: NativeModuleType;
  partCount?: number;
  /** Generic structural goal; never a permission, placement or source override. */
  requiredPartIds?: string[];
}

/** A structural port keeps generation independent of filesystem/registry initialization.
 * The production AttachmentEngine enforces its own source/capability checks as well. */
export interface NativeGeneratorEngine {
  createAssembly(partId: string): Promise<NativeAssembly>;
  attachPart(assembly: NativeAssembly, request: AssemblyAttachRequest): Promise<{
    accepted: boolean;
    graph: NativeAssembly;
    rejections: { code: string; reason: string }[];
  }>;
  getPart(partId: string): Promise<NativeAssemblyPart | undefined>;
  getCapability(partId: string): Promise<AssemblyInterfaceCapability | undefined>;
  validateGraph(assembly: NativeAssembly): Promise<{ valid: boolean; issues: string[] }>;
}

export interface NativeAssemblyBomRow { partId: string; name: string; quantity: number; ldrawColor: 16; colorAvailability: 'not-verified' }
export interface NativeAssemblyStep { step: number; addedInstanceId: string; partId: string; connectionEdgeIds: string[] }
export interface NativeSourceReference { library: string; path: string; revision: string; sha256: string; license: string | null; sourceUrl: string }
export interface NativeGeneratedAssembly extends NativeAssembly {
  module: NativeModuleType;
  name: string;
  bom: NativeAssemblyBomRow[];
  steps: NativeAssemblyStep[];
  sources: NativeSourceReference[];
  contentSha256: string;
  ownership: 'virtual-design-not-owned';
  colorAvailability: 'not-verified';
  warnings: string[];
  assemblyValidation: { checked: true; valid: true; issues: [] };
  connectorAssessment?: ReturnType<typeof describeValidatedNativeModel>;
}
export interface NativeGeneratorSearch {
  /** Candidate endpoint / quarter-turn attempts, including source-solver prechecks. */
  attempts: number;
  attachmentApiCalls: number;
  /** Accepted and rejected branch placements; backtracked placements remain counted. */
  acceptedAttachments: number;
  rejectedAttachments: number;
  transformFailures: number;
  compatibilityFailures: number;
  collisionFailures: number;
  occupancyFailures: number;
  designGoalFailures: number;
  backtracks: number;
  testedRoots: number;
  exhausted: boolean;
  timeBudgetExceeded: boolean;
  catalogTimeMs: number;
  searchTimeMs: number;
  budget: { maxAttempts: number; maxBacktracks: number; maxSearchTimeMs: number };
  finalPlacements: number;
  finalConnectionEdges: number;
  rejectionCounts: Record<string, number>;
  rejectionReasons: { code: string; reason: string; count: number }[];
}
export interface NativeGenerationResult {
  status: 'generated' | 'blocked';
  module: NativeModuleType;
  model: NativeGeneratedAssembly | null;
  reasons: string[];
  search: NativeGeneratorSearch;
}
interface CatalogPart {
  native: NativeAssemblyPart;
  capability: AssemblyInterfaceCapability;
  name: string;
  x: number;
  y: number;
  z: number;
  area: number;
  points: ImportedConnectionPoint[];
}
interface Anchor { placement: NativePlacement; part: CatalogPart; point: ImportedConnectionPoint; position: Vector3; direction: Vector3 }

const MODULE_NAMES: Record<NativeModuleType, string> = {
  wall: '真实零件基础墙体', platform: '真实零件基础平台', 'simple-chassis': '真实零件无动力车架',
  'simple-box': '真实零件开口盒体', 'simple-roof': '真实零件斜面屋顶', 'basic-snot': '真实零件侧向拼搭模块', 'wheel-module': '真实零件轮组模块',
  'bar-clip': '真实零件杆夹连接模块',
};
const DEFAULT_COUNTS: Record<NativeModuleType, number> = { wall: 5, platform: 5, 'simple-chassis': 5, 'simple-box': 13, 'simple-roof': 5, 'basic-snot': 3, 'wheel-module': 4, 'bar-clip': 2 };
const finite = (v: number[]) => v.every(Number.isFinite);
function rotate(rotation: RigidTransform['rotation'], [x, y, z]: Vector3): Vector3 {
  return [rotation[0] * x + rotation[1] * y + rotation[2] * z, rotation[3] * x + rotation[4] * y + rotation[5] * z, rotation[6] * x + rotation[7] * y + rotation[8] * z];
}
function world(transform: RigidTransform, position: Vector3): Vector3 {
  return rotate(transform.rotation, position).map((value, axis) => value + transform.translation[axis]) as Vector3;
}
function up(direction: Vector3) { return direction[1] < -0.99 && Math.abs(direction[0]) < 1e-5 && Math.abs(direction[2]) < 1e-5; }
function horizontal(direction: Vector3) { return Math.abs(direction[1]) < 1e-5 && Math.hypot(direction[0], direction[2]) > 0.99; }
function stud(point: ImportedConnectionPoint) { return point.gender === 'M' && point.family === 'stud'; }
function receiving(point: ImportedConnectionPoint) { return point.gender === 'F'; }
// These thresholds describe module design goals in native LDU. They do not
// reconstruct a part from its title, infer a connector or grant permission.
function flat(part: CatalogPart) { return part.y <= 12.00001; }
function plate(part: CatalogPart) { return flat(part) && topStudPoints(part).length > 0; }
function upright(part: CatalogPart) { return part.y > 12.00001 && topStudPoints(part).length > 0; }
function unitSupport(part: CatalogPart) { return upright(part) && part.x <= 20.00001 && part.z <= 20.00001; }
function tile(part: CatalogPart) { return flat(part) && !part.points.some(stud); }
function structuralOverlay(part: CatalogPart) { return part.y <= Math.max(part.x, part.z) + 1e-5; }
const inclineCache = new WeakMap<NativeAssemblyPart, boolean>();
function slope(part: CatalogPart) {
  const cached = inclineCache.get(part.native);
  if (cached !== undefined) return cached;
  const mesh = part.native.geometry.mesh!;
  let projectedInclineArea = 0;
  for (let index = 0; index < mesh.indices.length; index += 3) {
    const a = mesh.positions[mesh.indices[index]], b = mesh.positions[mesh.indices[index + 1]], c = mesh.positions[mesh.indices[index + 2]];
    const ab = b.map((value, axis) => value - a[axis]), ac = c.map((value, axis) => value - a[axis]);
    const normal = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    const length = Math.hypot(...normal), verticalRatio = length ? Math.abs(normal[1]) / length : 0;
    if (verticalRatio > 0.15 && verticalRatio < 0.97) projectedInclineArea += Math.abs(normal[1]) / 2;
  }
  const result = projectedInclineArea >= part.area * 0.2;
  inclineCache.set(part.native, result);
  return result;
}
function sideStud(part: CatalogPart) { return part.points.some(point => stud(point) && horizontal(point.direction)); }
function sortedNumbers(input: number[]) { return [...new Set(input.map(value => Math.round(value * 1e6) / 1e6))].sort((a, b) => a - b); }
function distinctPhysicalPoints(points: readonly ImportedConnectionPoint[]) {
  const seen = new Set<string>();
  return points.filter(point => { const key = physicalConnectionKey(point); if (seen.has(key)) return false; seen.add(key); return true; });
}
function topStudPoints(part: CatalogPart) { return part.points.filter(point => stud(point) && up(point.direction)); }
function hasTwoDimensionalStudGrid(part: CatalogPart) {
  const points = topStudPoints(part);
  return sortedNumbers(points.map(point => point.position[0])).length >= 2 && sortedNumbers(points.map(point => point.position[2])).length >= 2;
}
function borderPoints(part: CatalogPart) {
  const points = part.points.filter(point => stud(point) && up(point.direction));
  const xs = sortedNumbers(points.map(point => point.position[0])), zs = sortedNumbers(points.map(point => point.position[2]));
  if (xs.length < 3 || zs.length < 3) return [];
  return points.filter(point => point.position[0] === xs[0] || point.position[0] === xs.at(-1) || point.position[2] === zs[0] || point.position[2] === zs.at(-1));
}
function wallRootPoints(part: CatalogPart, requestedAttachments: number) {
  const points = part.points.filter(point => stud(point) && up(point.direction));
  const xs = sortedNumbers(points.map(point => point.position[0])), zs = sortedNumbers(points.map(point => point.position[2]));
  const rowAxis = xs.length >= zs.length ? 0 : 2, crossAxis = rowAxis === 0 ? 2 : 0;
  const edge = Math.min(...points.map(point => point.position[crossAxis]));
  const seen = new Set<string>();
  const row = points.filter(point => point.position[crossAxis] === edge).sort((a, b) => a.position[rowAxis] - b.position[rowAxis]).filter(point => {
    const key = point.position.join(','); if (seen.has(key)) return false; seen.add(key); return true;
  });
  return row.slice(0, Math.min(row.length, Math.max(2, Math.ceil(Math.sqrt(requestedAttachments)))));
}

function transformedBounds(part: CatalogPart, transform: RigidTransform) {
  const bounds = part.native.geometry.bounds!;
  const corners: Vector3[] = [];
  for (const x of [bounds.min[0], bounds.max[0]]) for (const y of [bounds.min[1], bounds.max[1]]) for (const z of [bounds.min[2], bounds.max[2]]) corners.push(world(transform, [x, y, z]));
  return { min: [0, 1, 2].map(axis => Math.min(...corners.map(point => point[axis]))) as Vector3,
    max: [0, 1, 2].map(axis => Math.max(...corners.map(point => point[axis]))) as Vector3 };
}
function peakFacesInward(candidate: CatalogPart, placement: NativePlacement, root: CatalogPart, rootPlacement: NativePlacement) {
  const source = candidate.native.geometry;
  const minY = source.bounds!.min[1];
  const peak = source.mesh!.positions.filter(point => Math.abs(point[1] - minY) < 1e-5);
  if (!peak.length) return false;
  const centroid = [0, 1, 2].map(axis => peak.reduce((sum, point) => sum + point[axis], 0) / peak.length) as Vector3;
  const peakWorld = world(placement.transform, centroid);
  const body = transformedBounds(candidate, placement.transform), base = transformedBounds(root, rootPlacement.transform);
  const center = body.min.map((value, axis) => (value + body.max[axis]) / 2), rootCenter = base.min.map((value, axis) => (value + base.max[axis]) / 2);
  const pitchAxis = root.x <= root.z ? 0 : 2, ridgeAxis = pitchAxis === 0 ? 2 : 0;
  const towardRidge = (rootCenter[pitchAxis] - center[pitchAxis]) * (peakWorld[pitchAxis] - center[pitchAxis]);
  return towardRidge > 1e-5 && Math.abs(peakWorld[ridgeAxis] - center[ridgeAxis]) < 1e-4;
}
function footprintContained(candidate: CatalogPart, placement: NativePlacement, root: CatalogPart, rootPlacement: NativePlacement) {
  const a = transformedBounds(candidate, placement.transform), b = transformedBounds(root, rootPlacement.transform);
  return [0, 2].every(axis => a.min[axis] >= b.min[axis] - 1e-5 && a.max[axis] <= b.max[axis] + 1e-5);
}
export function validateNativeModuleRequest(request: NativeModuleRequest) {
  const minimum = request?.module === 'bar-clip' ? 2 : 3;
  if (!request || !NATIVE_MODULE_TYPES.includes(request.module) || request.partCount !== undefined && (!Number.isSafeInteger(request.partCount) || request.partCount < minimum || request.partCount > 32)) {
    throw new Error(`请选择支持的基础结构；零件目标数量应为 ${minimum}–32 的整数。`);
  }
  if (request.module === 'basic-snot' && request.partCount !== undefined && request.partCount !== 3) throw new Error('当前基础侧向模块固定由 3 个真实零件组成。');
  if (request.module === 'bar-clip' && request.partCount !== undefined && request.partCount !== 2) throw new Error('当前杆夹连接模块固定由 2 个真实零件组成。');
  if (request.requiredPartIds !== undefined && (!Array.isArray(request.requiredPartIds) || request.requiredPartIds.length > 8 ||
      request.requiredPartIds.length > (request.partCount ?? DEFAULT_COUNTS[request.module]) || new Set(request.requiredPartIds).size !== request.requiredPartIds.length ||
      request.requiredPartIds.some(id => typeof id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(id)))) {
    throw new Error('所需零件应为不重复的原生编号，最多 8 种且不能超过模型零件数量。');
  }
}

/** Scores express a design goal only. They never write a part position or modify geometry. */
export class NativeAssemblyGenerator {
  private readonly connectorIndex = new ConnectorRegistry();
  private catalogPromise?: Promise<CatalogPart[]>;
  private readonly maxAttempts: number;
  private readonly maxBacktracks: number;
  private readonly maxSearchTimeMs: number;
  constructor(readonly engine: NativeGeneratorEngine, readonly options: { partIds?: readonly string[]; maxAttempts?: number; maxBacktracks?: number; maxSearchTimeMs?: number } = {}) {
    this.maxAttempts = options.maxAttempts ?? 1800;
    this.maxBacktracks = options.maxBacktracks ?? 120;
    this.maxSearchTimeMs = options.maxSearchTimeMs ?? 10_000;
    if (!Number.isSafeInteger(this.maxAttempts) || this.maxAttempts < 1 || this.maxAttempts > 30_000 || !Number.isSafeInteger(this.maxBacktracks) || this.maxBacktracks < 0 || this.maxBacktracks > 5000 || !Number.isSafeInteger(this.maxSearchTimeMs) || this.maxSearchTimeMs < 1 || this.maxSearchTimeMs > 120_000) throw new Error('生成搜索预算无效。');
  }
  private catalog(): Promise<CatalogPart[]> {
    this.catalogPromise ??= (async () => {
      const ids = [...new Set(this.options.partIds ?? (await loadBundledLDrawManifest()).roots.map(root => root.partId))];
      const catalog: CatalogPart[] = [];
      for (const id of ids) {
        const capability = await this.engine.getCapability(id);
        if (!capability || !isGeneratableCapability(capability)) continue;
        const native = await this.engine.getPart(id), geometry = native?.geometry;
        if (!native || geometry?.status !== 'geometryReady' || !geometry.bounds || !geometry.mesh || geometry.source.integrity !== 'verified' || geometry.source.licenseStatus !== 'complete' || (native.connections.status !== 'ready' && !(capability?.admissionBasis === 'interface-grammar' && hasIsolatedUnknownDimensions(native)))) continue;
        const points = distinctPhysicalPoints(native.connections.points.filter(point => capability!.allowedConnectionIds.includes(point.id) && point.dimensionsResolved));
        if (!points.length) continue;
        this.connectorIndex.register(id, points.map(adaptImportedConnection));
        const [x, y, z] = geometry.bounds.max.map((value, axis) => value - geometry.bounds!.min[axis]);
        if (!finite([x, y, z]) || [x, y, z].some(value => value <= 0)) continue;
        catalog.push({ native, capability, name: geometry.name ?? native.partId, x, y, z, area: x * z, points });
      }
      return catalog.sort((a, b) => a.native.partId.localeCompare(b.native.partId));
    })();
    return this.catalogPromise;
  }
  async generate(request: NativeModuleRequest): Promise<NativeGenerationResult> {
    validateNativeModuleRequest(request);
    const started = performance.now();
    const search: NativeGeneratorSearch = { attempts: 0, attachmentApiCalls: 0, acceptedAttachments: 0, rejectedAttachments: 0, transformFailures: 0, compatibilityFailures: 0, collisionFailures: 0, occupancyFailures: 0, designGoalFailures: 0, backtracks: 0, testedRoots: 0, exhausted: false, timeBudgetExceeded: false, catalogTimeMs: 0, searchTimeMs: 0, budget: { maxAttempts: this.maxAttempts, maxBacktracks: this.maxBacktracks, maxSearchTimeMs: this.maxSearchTimeMs }, finalPlacements: 0, finalConnectionEdges: 0, rejectionCounts: {}, rejectionReasons: [] };
    const reasons = new Set<string>();
    const recordRejection = (code: string, reason: string) => {
      search.rejectionCounts[code] = (search.rejectionCounts[code] ?? 0) + 1;
      const boundedReason = reason.slice(0, 1000);
      const existing = search.rejectionReasons.find(row => row.code === code && row.reason === boundedReason);
      if (existing) existing.count++;
      else if (search.rejectionReasons.length < 32) search.rejectionReasons.push({ code, reason: boundedReason, count: 1 });
      if (reasons.size < 12) reasons.add(`${code}: ${reason}`);
    };
    const rejectCandidate = (rejections: { code: string; reason: string }[]) => {
      search.rejectedAttachments++;
      const codes = rejections.map(row => row.code);
      if (codes.some(code => /collision|overlap|penetration/.test(code))) search.collisionFailures++;
      if (codes.some(code => !/collision/.test(code) && /transform|solver|rotation|pose/.test(code))) search.transformFailures++;
      if (codes.some(code => /compat|rule|connection-unknown/.test(code))) search.compatibilityFailures++;
      if (codes.some(code => /occup|duplicate-endpoint/.test(code))) search.occupancyFailures++;
      if (codes.includes('design-goal')) search.designGoalFailures++;
      for (const rejection of rejections) recordRejection(rejection.code, rejection.reason);
    };
    let searchStarted = started;
    const finish = () => { search.searchTimeMs = Math.round((performance.now() - searchStarted) * 1000) / 1000; };
    const catalog = await this.catalog(), byId = new Map(catalog.map(part => [part.native.partId, part]));
    searchStarted = performance.now();
    search.catalogTimeMs = Math.round((searchStarted - started) * 1000) / 1000;
    const budgetReached = () => {
      search.timeBudgetExceeded ||= performance.now() - searchStarted >= this.maxSearchTimeMs;
      return search.attempts >= this.maxAttempts || search.backtracks >= this.maxBacktracks || search.timeBudgetExceeded;
    };
    const target = request.partCount ?? DEFAULT_COUNTS[request.module];
    const required = new Set(request.requiredPartIds ?? []);
    const block = (reason: string): NativeGenerationResult => { finish(); return { status: 'blocked', module: request.module, model: null, reasons: [...new Set([reason, ...reasons])].slice(0, 20), search }; };
    if (!catalog.length) return block('当前没有同时通过装配验证、批次准入和来源校验的真实零件。');
    if (request.module === 'bar-clip') {
      const bars = catalog.filter(part => part.points.some(isSourceDeclaredBarEndpoint));
      const clips = catalog.filter(part => part.points.some(isSourceDeclaredClipEndpoint));
      for (const root of bars) {
        if (required.size && !required.has(root.native.partId)) continue;
        search.testedRoots++;
        let base: NativeAssembly;
        try { base = await this.engine.createAssembly(root.native.partId); }
        catch (error) { recordRejection('root-admission', error instanceof Error ? error.message : 'Bar root was not admitted.'); continue; }
        for (const candidate of clips) {
          if (required.size && !required.has(candidate.native.partId)) continue;
          if (candidate.native.partId === root.native.partId) continue;
          const connections = candidate.points.filter(isSourceDeclaredClipEndpoint);
          for (const connection of connections) for (const twistDegrees of [0, 90, 180, 270]) {
            if (budgetReached()) return block('合法杆夹搜索已达到预算，未移动或改造真实零件强行完成。');
            search.attempts++; search.attachmentApiCalls++;
            const result = await this.engine.attachPart(base, { anchorInstanceId: base.placements[0].instanceId, anchorConnectionId: root.points.find(isSourceDeclaredBarEndpoint)!.id, partId: candidate.native.partId, candidateConnectionId: connection.id, twistDegrees });
            if (!result.accepted) { rejectCandidate(result.rejections); continue; }
            search.acceptedAttachments++;
            const validation = await this.engine.validateGraph(result.graph);
            if (!validation.valid) { recordRejection('final-graph-verification', validation.issues.join(' ')); continue; }
            search.finalPlacements = result.graph.placements.length; search.finalConnectionEdges = result.graph.edges.length;
            const model = createNativeAssemblyDocument(result.graph, 'bar-clip', catalog);
            finish();
            return { status: 'generated', module: 'bar-clip', model, reasons: [], search };
          }
        }
      }
      return block('当前没有通过来源接口、杆夹求解、碰撞与图验证的真实杆夹组合。');
    }
    const unavailableRequired = [...required].filter(id => !byId.has(id));
    if (unavailableRequired.length) return block(`required-source-unavailable: 所需零件没有当前来源与接口生成资格：${unavailableRequired.join(', ')}。`);
    if (request.module === 'wheel-module') {
      const assessment = await assessWheelAssemblySources(id => this.engine.getPart(id));
      for (const code of assessment.reasonCodes) {
        const partReasons = assessment.parts.flatMap(part => {
          if (code === `wheel-connections-${part.connectionStatus}`) return [`${part.partId}: source connections are ${part.connectionStatus}.`];
          if (code === `wheel-proxy-${part.collisionProxy.reasonCode}`) return [`${part.partId}: ${part.collisionProxy.reason}`];
          return [];
        });
        const stageReason = assessment.stages.find(stage => stage.reasonCodes.includes(code))?.reason;
        recordRejection(code, partReasons.join('; ') || stageReason || `The source review has not established prerequisite ${code}.`);
      }
      return block('轮毂／轮胎／轮架的原生来源、机械规则或实体证据尚不完整；当前来源审查结果保留具体阻塞原因，未生成轮组。');
    }
    const roots = catalog.filter(part => plate(part) && part.points.filter(point => stud(point) && up(point.direction)).length >= 2)
      .filter(part => request.module !== 'wall' || wallRootPoints(part, target - 1).length >= 2)
      .filter(part => request.module !== 'platform' || topStudPoints(part).length >= target - 1)
      .filter(part => request.module !== 'simple-chassis' || hasTwoDimensionalStudGrid(part) && topStudPoints(part).length >= target - 1 && Math.max(part.x, part.z) / Math.min(part.x, part.z) >= 2)
      .filter(part => request.module !== 'simple-box' || borderPoints(part).length + 1 === target)
      .filter(part => request.module !== 'simple-roof' || catalog.some(piece => slope(piece) && piece.points.some(receiving) && Math.abs(piece.area * (target - 1) - part.area) < 1e-5))
      .filter(part => request.module === 'basic-snot' || [...required].every(id => {
        const piece = byId.get(id)!;
        return id === part.native.partId || piece.x <= part.x + 1e-5 && piece.z <= part.z + 1e-5 || piece.z <= part.x + 1e-5 && piece.x <= part.z + 1e-5;
      }))
      .sort((a, b) => Number(!required.has(a.native.partId)) - Number(!required.has(b.native.partId)) || a.area - b.area || Math.abs(a.x - a.z) - Math.abs(b.x - b.z)).slice(0, 12);
    if (!roots.length) return block(request.module === 'simple-box' ? '当前可生成底板中，没有边界凸点数量与所需闭合盒体一致的真实底板。' : '当前没有满足该结构目标的已验证真实底板。');

    const choicesAt = (depth: number, root?: CatalogPart, preferred: ReadonlySet<string> = required) => catalog.filter(part => {
      if (!part.points.some(receiving)) return false;
      if (request.module === 'wall') return upright(part);
      if (request.module === 'platform' || request.module === 'simple-chassis') {
        // Default filler search prefers bounded pieces. An explicit, still
        // missing source-part goal may use a larger mixed-size overlay; its
        // solved footprint, collisions and free ports are still fully checked.
        const areaBudget = !root ? Infinity : preferred.has(part.native.partId) ? root.area : root.area / (target - 1);
        return (request.module === 'platform' ? flat(part) : structuralOverlay(part)) && part.area <= areaBudget + 1e-5;
      }
      if (request.module === 'simple-box') return unitSupport(part);
      if (request.module === 'simple-roof') return slope(part) && (!root || Math.abs(part.area * (target - 1) - root.area) < 1e-5);
      if (request.module === 'basic-snot') return depth === 1 ? sideStud(part) : tile(part);
      return false;
    }).sort((a, b) => {
      const requiredOrder = Number(!preferred.has(a.native.partId)) - Number(!preferred.has(b.native.partId));
      if (requiredOrder) return requiredOrder;
      if (request.module === 'wall') return a.area - b.area || a.y - b.y || a.native.partId.localeCompare(b.native.partId);
      if (request.module === 'simple-chassis') return Number(!plate(a)) - Number(!plate(b)) || a.y - b.y || a.area - b.area || a.native.partId.localeCompare(b.native.partId);
      return a.area - b.area || a.native.partId.localeCompare(b.native.partId);
    }).slice(0, 12);
    if (!choicesAt(1).length || request.module === 'basic-snot' && !choicesAt(2).length) return block('该结构所需类别没有通过当前装配与接口准入的真实零件。');

    const anchorsAt = (graph: NativeAssembly, root: CatalogPart) => {
      const placements = new Map(graph.placements.map(placement => [placement.instanceId, placement]));
      const keyFor = (instanceId: string, connectionId: string) => {
        const placement = placements.get(instanceId), part = placement && byId.get(placement.partId);
        const point = part?.native.connections.points.find(candidate => candidate.id === connectionId);
        return point ? physicalEndpointKey(instanceId, point) : `${instanceId}:unavailable:${connectionId}`;
      };
      const occupied = new Set(graph.edges.flatMap(edge => [keyFor(edge.fixedInstanceId, edge.fixedConnectionId), keyFor(edge.movingInstanceId, edge.movingConnectionId)]));
      const anchors: Anchor[] = [];
      for (const placement of graph.placements) {
        const part = byId.get(placement.partId)!;
        if (!part) continue;
        for (const point of part.points) {
          if (!stud(point) || occupied.has(physicalEndpointKey(placement.instanceId, point))) continue;
          const direction = rotate(placement.transform.rotation, point.direction), position = world(placement.transform, point.position);
          if (request.module === 'basic-snot' && graph.placements.length === 2) {
            if (placement.instanceId === graph.placements[0].instanceId || !horizontal(direction)) continue;
          } else if (!up(direction)) continue;
          if (request.module === 'platform' || request.module === 'simple-chassis' || request.module === 'simple-roof' || request.module === 'simple-box') {
            if (placement.instanceId !== graph.placements[0].instanceId) continue;
          }
          if (request.module === 'simple-box' && !borderPoints(root).some(border => border.id === point.id)) continue;
          if (request.module === 'wall') {
            const columns = wallRootPoints(root, target - 1);
            if (placement.instanceId === graph.placements[0].instanceId && !columns.some(column => column.id === point.id)) continue;
            if (!columns.some(column => {
              const base = world(graph.placements[0].transform, column.position);
              return Math.abs(base[0] - position[0]) < 1e-5 && Math.abs(base[2] - position[2]) < 1e-5;
            })) continue;
          }
          anchors.push({ placement, part, point, direction, position });
        }
      }
      const supportPositions = graph.edges.filter(edge => edge.fixedInstanceId === graph.placements[0].instanceId).map(edge => edge.anchor);
      const separation = (anchor: Anchor) => supportPositions.length ? Math.min(...supportPositions.map(position => Math.hypot(anchor.position[0] - position[0], anchor.position[2] - position[2]))) : 0;
      return anchors.sort((a, b) => request.module === 'wall' ? b.position[1] - a.position[1] || a.position[0] - b.position[0] || a.position[2] - b.position[2]
        : (request.module === 'simple-chassis' ? separation(b) - separation(a) : 0) || a.position[0] - b.position[0] || a.position[2] - b.position[2]).slice(0, 128);
    };

    const placementGoal = (placed: NativePlacement, placementCount: number, candidate: CatalogPart, root: CatalogPart, rootPlacement: NativePlacement) => {
      const localUp = rotate(placed.transform.rotation, [0, -1, 0]);
      if (request.module === 'basic-snot' && placementCount === 3) return horizontal(localUp);
      if (!up(localUp)) return false;
      return footprintContained(candidate, placed, root, rootPlacement) &&
        (request.module !== 'simple-roof' || peakFacesInward(candidate, placed, root, rootPlacement));
    };
    const usedRootPoints = (graph: NativeAssembly, root: CatalogPart) => {
      const rootId = graph.placements[0].instanceId;
      const occupied = new Set(graph.edges.flatMap(edge => edge.fixedInstanceId === rootId ? [edge.fixedConnectionId] : edge.movingInstanceId === rootId ? [edge.movingConnectionId] : []).map(id => root.native.connections.points.find(point => point.id === id)).filter((point): point is ImportedConnectionPoint => !!point).map(physicalConnectionKey));
      return topStudPoints(root).filter(point => occupied.has(physicalConnectionKey(point)));
    };
    const goalComplete = (graph: NativeAssembly, root: CatalogPart) => {
      if (graph.placements.length !== target || graph.edges.length < target - 1) return false;
      if ([...required].some(id => !graph.placements.some(placement => placement.partId === id))) return false;
      if (request.module === 'basic-snot') return graph.placements.some(placement => horizontal(rotate(placement.transform.rotation, [0, -1, 0])));
      if (request.module === 'wall') {
        const usedRoot = new Set(usedRootPoints(graph, root).map(physicalConnectionKey));
        return wallRootPoints(root, target - 1).every(point => usedRoot.has(physicalConnectionKey(point)));
      }
      if (request.module === 'simple-box') {
        const usedRoot = new Set(usedRootPoints(graph, root).map(physicalConnectionKey));
        return borderPoints(root).every(point => usedRoot.has(physicalConnectionKey(point)));
      }
      if (request.module === 'simple-chassis') {
        const usedRoot = usedRootPoints(graph, root);
        const points = topStudPoints(root);
        return [0, 2].every(axis => Math.min(...usedRoot.map(point => point.position[axis])) === Math.min(...points.map(point => point.position[axis])) && Math.max(...usedRoot.map(point => point.position[axis])) === Math.max(...points.map(point => point.position[axis])));
      }
      return true;
    };

    const visit = async (graph: NativeAssembly, root: CatalogPart): Promise<NativeAssembly | null> => {
      if (goalComplete(graph, root)) return graph;
      if (graph.placements.length >= target || budgetReached()) return null;
      const missingRequired = new Set([...required].filter(id => !graph.placements.some(placement => placement.partId === id)));
      const remaining = target - graph.placements.length;
      if (missingRequired.size > remaining) return null;
      const choices = choicesAt(graph.placements.length, root, missingRequired).filter(part => missingRequired.size < remaining || missingRequired.has(part.native.partId))
        .sort((a, b) => Number(!missingRequired.has(a.native.partId)) - Number(!missingRequired.has(b.native.partId)));
      const anchors = anchorsAt(graph, root);
      for (const anchor of anchors) {
        const familyCandidates = this.connectorIndex.findCompatible(adaptImportedConnection(anchor.point), new Set(choices.map(part => part.native.partId)));
        const compatibleEndpoints = new Set(familyCandidates.map(entry => JSON.stringify([entry.partId, entry.connector.sourceConnectionId])));
        for (const candidate of choices) {
        const connections = candidate.points.filter(point => receiving(point) && up(point.direction) && compatibleEndpoints.has(JSON.stringify([candidate.native.partId, point.id]))).slice(0, 32);
        for (const connection of connections) for (const twistDegrees of [0, 90, 180, 270]) {
          if (budgetReached()) return null;
          search.attempts++;
          const solved = solveAttachment({ fixedPart: anchor.part.native, fixedPlacement: anchor.placement, fixedConnectionId: anchor.point.id, movingPart: candidate.native, movingConnectionId: connection.id, twistsDeg: [twistDegrees] });
          if (solved.status !== 'solved') {
            rejectCandidate([{ code: solved.status === 'incompatible' || solved.status === 'unknown' ? 'compatibility-precheck' : 'transform-precheck', reason: solved.reason }]);
            continue;
          }
          // Only a source-solver pose is inspected here. It never enters the
          // graph; every accepted placement still goes through attachPart.
          if (!solved.candidates.some(pose => placementGoal({ instanceId: 'solver-preview', partId: candidate.native.partId, transform: pose.transform }, graph.placements.length + 1, candidate, root, graph.placements[0]))) {
            rejectCandidate([{ code: 'design-goal', reason: 'The source-solved pose does not satisfy the requested module footprint/orientation.' }]);
            continue;
          }
          search.attachmentApiCalls++;
          const result = await this.engine.attachPart(graph, { anchorInstanceId: anchor.placement.instanceId, anchorConnectionId: anchor.point.id, partId: candidate.native.partId, candidateConnectionId: connection.id, twistDegrees });
          if (!result.accepted) {
            rejectCandidate(result.rejections);
            continue;
          }
          if (!placementGoal(result.graph.placements.at(-1)!, result.graph.placements.length, candidate, root, result.graph.placements[0])) { rejectCandidate([{ code: 'design-goal', reason: 'The accepted attachment did not retain the requested design orientation or footprint.' }]); continue; }
          search.acceptedAttachments++;
          const complete = await visit(result.graph, root);
          if (complete) return complete;
          search.backtracks++;
        }
      }
      }
      return null;
    };

    for (const root of roots) {
      if (budgetReached()) break;
      search.testedRoots++;
      let base: NativeAssembly;
      try { base = await this.engine.createAssembly(root.native.partId); }
      catch (error) { reasons.add(error instanceof Error ? error.message : '真实根零件未通过准入。'); continue; }
      const graph = await visit(base, root);
      if (graph) {
        const validation = await this.engine.validateGraph(graph);
        if (!validation.valid) { reasons.add(`final-graph-verification: ${validation.issues.join(' ')}`); continue; }
        search.finalPlacements = graph.placements.length;
        search.finalConnectionEdges = graph.edges.length;
        const model = createNativeAssemblyDocument(graph, request.module, catalog);
        finish();
        return { status: 'generated', module: request.module, model, reasons: [], search };
      }
    }
    search.exhausted = budgetReached();
    return block(search.exhausted ? '合法装配搜索已达到预算，未移动或改造真实零件强行完成。' : '已尝试当前可用零件、接口和离散旋转，未找到满足结构目标的合法装配。');
  }
}

function createNativeAssemblyDocument(graph: NativeAssembly, module: NativeModuleType, catalog: readonly CatalogPart[]): NativeGeneratedAssembly {
  const lookup = new Map(catalog.map(part => [part.native.partId, part])), bom = new Map<string, NativeAssemblyBomRow>(), sources = new Map<string, NativeSourceReference>();
  for (const placement of graph.placements) {
    const part = lookup.get(placement.partId);
    if (!part || !isGeneratableCapability(part.capability)) throw new Error('生成结果包含未通过准入的零件，拒绝导出。');
    const previous = bom.get(placement.partId);
    if (previous) previous.quantity++;
    else bom.set(placement.partId, { partId: placement.partId, name: part.name, quantity: 1, ldrawColor: 16, colorAvailability: 'not-verified' });
    for (const file of part.native.geometry.source.files) sources.set(`LDraw:${file.path}`, { library: 'LDraw', revision: part.native.geometry.source.revision, ...file });
    for (const file of part.native.connections.sourceFiles) sources.set(`${file.library}:${file.path}`, { ...file });
  }
  const model = {
    ...structuredClone(graph), module, name: MODULE_NAMES[module], bom: [...bom.values()].sort((a, b) => a.partId.localeCompare(b.partId)),
    steps: graph.placements.map((placement, index) => ({ step: index + 1, addedInstanceId: placement.instanceId, partId: placement.partId, connectionEdgeIds: graph.edges.filter(edge => edge.movingInstanceId === placement.instanceId).map(edge => edge.id) })),
    sources: [...sources.values()].sort((a, b) => `${a.library}:${a.path}`.localeCompare(`${b.library}:${b.path}`)),
    ownership: 'virtual-design-not-owned' as const, colorAvailability: 'not-verified' as const,
    assemblyValidation: { checked: true as const, valid: true as const, issues: [] as [] },
    connectorAssessment: describeValidatedNativeModel(graph, new Map(catalog.map(part => [part.native.partId, part.native]))),
    warnings: ['布局已通过当前真实源接口、刚体闭合和实体碰撞检查；材料应力、制造公差及实物承重仍未认证。', '零件颜色使用 LDraw 当前色 16；具体零件颜色供应与个人库存尚未核实。'],
  };
  return { ...model, contentSha256: createHash('sha256').update(JSON.stringify(model)).digest('hex') };
}

export async function runNativeGeneratorSmokeTests(generator: NativeAssemblyGenerator) {
  const results: NativeGenerationResult[] = [];
  for (const module of NATIVE_MODULE_TYPES) results.push(await generator.generate({ module }));
  return results;
}
