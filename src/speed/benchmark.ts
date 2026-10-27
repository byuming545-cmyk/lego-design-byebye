import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { InventoryError, normalizeSetNumber, type SetInventoryProvider } from '../inventory/provider.js';
import type { SetInventory, ValidationResult } from '../types/index.js';
import { getSpeedPartDefinition } from './catalog.js';
import { generateVehicleModel } from './generator.js';
import { analyzeSpeedInventories, SPEED_DEMO_SET_NUMBER } from './inventory.js';
import { SpeedCollisionValidator, SpeedConnectionValidator, SpeedInventoryValidator, StructuralValidator, WheelValidator } from './validators.js';
import type { SpeedInventory, SpeedInventoryItem, VehicleDesignOptions, VehicleModel } from './types.js';
import { VERSION_METADATA } from './versions.js';

export interface BenchmarkSet {
  setNumber: string;
  expectedName?: string;
  expectedTheme?: string;
  evidence?: Record<string, unknown>;
}
export type BenchmarkStage = 'inventory' | 'analysis' | 'snapshot' | 'generation' | 'validation';
export interface BenchmarkError { stage: BenchmarkStage; code: string; message: string; trace: string }
export type ValidatorName = 'InventoryValidator' | 'ConnectionValidator' | 'WheelValidator' | 'StructuralValidator' | 'CollisionValidator';
export interface BenchmarkCheck { status: 'unrun' | 'pass' | 'fail'; errors: string[]; warnings: string[]; details?: ValidationResult }
export interface CriticalCarPart {
  present: boolean;
  quantity: number;
  supportedQuantity: number;
  recognizedOnlyQuantity: number;
  unknownQuantity: number;
  partIds: string[];
  evidence: Array<{ partId: string; basis: 'catalog' | 'upstream-name'; generatable: boolean }>;
}
export interface BenchmarkSupport {
  totalQuantity: number;
  supportedQuantity: number;
  recognizedOnlyQuantity: number;
  unknownQuantity: number;
  unsupportedQuantity: number;
  quantityWeightedSupportedPercentage: number;
  supportedUniquePartIds: number;
  recognizedOnlyUniquePartIds: number;
  unknownUniquePartIds: number;
  unsupportedUniquePartIds: number;
  supportedUniquePartColors: number;
  unsupportedUniquePartColors: number;
}
export interface BenchmarkSetReport {
  setNumber: string;
  expectedName: string | null;
  name: string | null;
  expectedTheme: string | null;
  configurationEvidence: Record<string, unknown> | null;
  theme: { id: number | null; runtimeVerification: 'unverified'; note: string };
  source: 'rebrickable' | 'mock' | null;
  sourceLabel: string | null;
  fetchedAt: string | null;
  snapshotId: string | null;
  inventoryRead: boolean;
  executionState: 'pending' | 'succeeded' | 'failed';
  result: 'PASS' | 'PARTIAL' | 'FAIL';
  basic: { totalInventoryQuantity: number; uniquePartColorCount: number; uniquePartIdCount: number; spareQuantity: number | null; quantityIncludingSpares: number | null; sparePolicy: string } | null;
  support: BenchmarkSupport | null;
  criticalCarParts: Record<string, CriticalCarPart> | null;
  canGenerate: boolean | null;
  prerequisiteFailures: string[];
  generation: { status: 'unrun' | 'pass' | 'fail'; modelId: string | null; failureReason: string | null };
  validators: Record<ValidatorName, BenchmarkCheck>;
  errors: BenchmarkError[];
  warnings: string[];
  physicalValidation: 'untested';
}
export interface MissingPartFrequency {
  realSetsRead: number;
  requestedRealSets: number;
  denominatorDefinition: string;
  status: 'available' | 'pending';
  parts: Array<{
    partId: string; name: string; category: string; upstreamCategoryIds: number[];
    support: 'recognizedOnly' | 'unsupported'; quantity: number;
    setsAppearance: number; setsRead: number; appearanceFraction: string; appearanceRate: number;
    sets: Array<{ setNumber: string; quantity: number }>;
  }>;
}
export interface SpeedBenchmarkReport {
  schemaVersion: 1;
  reportId: string;
  createdAt: string;
  mode: 'real' | 'mock';
  versions: typeof VERSION_METADATA;
  validationScope: string;
  onlineValidation: 'Real online validation pending' | 'Real online validation executed' | 'Mock only — no real online validation';
  summary: { requested: number; inventoriesRead: number; pending: number; executionFailed: number; pass: number; partial: number; fail: number; realInventoriesRead: number; realValidated: number; realPassed: number; physicalBuildsValidated: 0 };
  sets: BenchmarkSetReport[];
  missingFrequency: MissingPartFrequency;
}
export interface SpeedBenchmarkOptions {
  sets: Array<string | BenchmarkSet>;
  mode: 'real' | 'mock';
  provider?: SetInventoryProvider;
  /** Explicitly injected failures keep the core independent of process.env. */
  unavailableReason?: Error;
  now?: () => Date;
  reportId?: string;
  generate?: (inventory: SpeedInventory, options: VehicleDesignOptions) => VehicleModel;
  /** Persistence is supplied by the CLI; tests need no disk or network. */
  onInventoryAnalyzed?: (raw: SetInventory, inventory: SpeedInventory) => Promise<void>;
}

const validatorNames: ValidatorName[] = ['InventoryValidator', 'ConnectionValidator', 'WheelValidator', 'StructuralValidator', 'CollisionValidator'];
const pendingCodes = new Set(['MISSING_API_KEY', 'UPSTREAM_AUTH_FAILED', 'UPSTREAM_RATE_LIMIT', 'UPSTREAM_TIMEOUT', 'UPSTREAM_NETWORK_ERROR', 'UPSTREAM_ERROR']);
const defaultOptions: VehicleDesignOptions = { prompt: '原创 Speed 跑车', vehicleType: 'supercar', style: 'modern', minifigure: false, priority: 'structure', maximizeUsage: true };

export function parseBenchmarkConfig(input: unknown): BenchmarkSet[] {
  const values = Array.isArray(input) ? input : input && typeof input === 'object' && 'sets' in input ? input.sets : null;
  if (!Array.isArray(values) || !values.length || values.length > 100) throw new Error('Benchmark config must contain 1–100 sets.');
  const sets = values.map((entry): BenchmarkSet => {
    if (typeof entry === 'string') return { setNumber: entry };
    if (!entry || typeof entry !== 'object' || typeof entry.setNumber !== 'string' ||
      (entry.expectedName !== undefined && typeof entry.expectedName !== 'string') ||
      (entry.expectedTheme !== undefined && typeof entry.expectedTheme !== 'string') ||
      (entry.evidence !== undefined && (!entry.evidence || typeof entry.evidence !== 'object' || Array.isArray(entry.evidence)))) throw new Error('Invalid benchmark set configuration.');
    return { setNumber: entry.setNumber, expectedName: entry.expectedName, expectedTheme: entry.expectedTheme, evidence: entry.evidence };
  });
  return sets;
}

function failure(error: unknown, stage: BenchmarkStage): BenchmarkError {
  const value = error instanceof Error ? error : new Error(String(error));
  const code = 'code' in value && typeof value.code === 'string' ? value.code : 'BENCHMARK_ERROR';
  const redact = (text: string) => text.replace(/(Authorization\s*[:=]\s*(?:key\s*)?)[^\s,;]+/gi, '$1[redacted]').replace(/(REBRICKABLE_API_KEY\s*[:=]\s*)[^\s,;]+/g, '$1[redacted]');
  return { stage, code, message: redact(value.message), trace: redact(value.stack ?? `${value.name}: ${value.message}`).slice(0, 12_000) };
}

function emptyReport(set: BenchmarkSet): BenchmarkSetReport {
  return {
    setNumber: set.setNumber, expectedName: set.expectedName ?? null, name: null, expectedTheme: set.expectedTheme ?? null,
    configurationEvidence: set.evidence ?? null,
    theme: { id: null, runtimeVerification: 'unverified', note: 'The Rebrickable theme name has not been verified. Configuration evidence is separate from live inventory validation.' },
    source: null, sourceLabel: null, fetchedAt: null, snapshotId: null, inventoryRead: false,
    executionState: 'pending', result: 'PARTIAL', basic: null, support: null, criticalCarParts: null,
    canGenerate: null, prerequisiteFailures: [], generation: { status: 'unrun', modelId: null, failureReason: null },
    validators: {
      InventoryValidator: { status: 'unrun', errors: [], warnings: [] }, ConnectionValidator: { status: 'unrun', errors: [], warnings: [] },
      WheelValidator: { status: 'unrun', errors: [], warnings: [] }, StructuralValidator: { status: 'unrun', errors: [], warnings: [] },
      CollisionValidator: { status: 'unrun', errors: [], warnings: [] },
    },
    errors: [], warnings: [], physicalValidation: 'untested',
  };
}

function supportStats(inventory: SpeedInventory): BenchmarkSupport {
  const rows = inventory.items;
  const ids = (items: SpeedInventoryItem[]) => new Set(items.map(item => item.partId)).size;
  const supported = rows.filter(item => item.supported), partial = rows.filter(item => item.support === 'partiallySupported');
  const unknown = rows.filter(item => item.support === 'unsupported'), unusable = rows.filter(item => !item.supported);
  return {
    totalQuantity: inventory.analysis.totalQuantity, supportedQuantity: inventory.analysis.supportedQuantity,
    recognizedOnlyQuantity: inventory.analysis.partiallySupportedQuantity, unknownQuantity: inventory.analysis.unsupportedQuantity,
    unsupportedQuantity: inventory.analysis.partiallySupportedQuantity + inventory.analysis.unsupportedQuantity,
    quantityWeightedSupportedPercentage: inventory.analysis.supportRate * 100,
    supportedUniquePartIds: ids(supported), recognizedOnlyUniquePartIds: ids(partial), unknownUniquePartIds: ids(unknown), unsupportedUniquePartIds: ids(unusable),
    supportedUniquePartColors: supported.length, unsupportedUniquePartColors: unusable.length,
  };
}

const criticalDefinitions = [
  { key: 'wheels', categories: ['Wheel'], name: /\bwheel\b(?!.*(?:holder|arch|pins?|axle|tyre|tire))/i },
  { key: 'tyres', categories: ['Tyre'], name: /\b(?:tyre|tire)\b/i },
  { key: 'wheelHoldersAndAxleConnections', categories: ['WheelHolder'], name: /wheel\s*holder|\baxle\b|technic pin/i },
  { key: 'windscreen', categories: ['Windscreen'], name: /windscreen|windshield/i },
  { key: 'mudguardOrWheelArch', categories: ['Mudguard', 'WheelArch'], name: /mudguard|wheel\s*arch/i },
  { key: 'brackets', categories: ['Bracket'], name: /\bbracket\b/i },
  { key: 'curvedSlopes', categories: ['CurvedSlope'], name: /(?:slope.*curved|curved.*slope)/i },
  { key: 'wedges', categories: ['Wedge', 'Wing'], name: /\b(?:wedge|wing)\b/i },
  { key: 'sideStudPieces', categories: [] as string[], name: /(?:studs?.*(?:side|sides)|(?:side|sides).*studs?)/i },
];

/** Name fallback establishes presence only; support always comes from exact catalog geometry. */
export function criticalCarParts(raw: SetInventory, inventory: SpeedInventory): Record<string, CriticalCarPart> {
  return Object.fromEntries(criticalDefinitions.map(rule => {
    const result: CriticalCarPart = { present: false, quantity: 0, supportedQuantity: 0, recognizedOnlyQuantity: 0, unknownQuantity: 0, partIds: [], evidence: [] };
    for (const row of inventory.items) {
      const definition = getSpeedPartDefinition(row.partId);
      const catalogMatch = Boolean(definition && (rule.categories.includes(definition.category) ||
        (rule.key === 'sideStudPieces' && (definition.connectionPoints.some(point => point.type === 'sideStud') || ['4070', '52107', '47905', '99206'].includes(definition.partId))) ||
        (rule.key === 'wheelHoldersAndAxleConnections' && definition.category !== 'Wheel' && definition.connectionPoints.some(point => point.type === 'wheelPin' || point.type === 'wheelSocket'))));
      const upstreamName = raw.items.find(item => item.partId === row.partId)?.name ?? row.name;
      if (!catalogMatch && !rule.name.test(upstreamName)) continue;
      result.quantity += row.quantityAvailable;
      if (catalogMatch && row.supported) result.supportedQuantity += row.quantityAvailable;
      else if (catalogMatch && row.support === 'partiallySupported') result.recognizedOnlyQuantity += row.quantityAvailable;
      else result.unknownQuantity += row.quantityAvailable;
      if (!result.partIds.includes(row.partId)) {
        result.partIds.push(row.partId);
        result.evidence.push({ partId: row.partId, basis: catalogMatch ? 'catalog' : 'upstream-name', generatable: catalogMatch && row.supported });
      }
    }
    result.present = result.quantity > 0;
    return [rule.key, result];
  }));
}

export async function runSpeedBenchmark(options: SpeedBenchmarkOptions): Promise<SpeedBenchmarkReport> {
  const config = parseBenchmarkConfig(options.sets);
  const seen = new Set<string>();
  for (const set of config) {
    set.setNumber = set.setNumber.trim().toUpperCase() === SPEED_DEMO_SET_NUMBER ? SPEED_DEMO_SET_NUMBER : normalizeSetNumber(set.setNumber);
    if (options.mode === 'real' && set.setNumber === SPEED_DEMO_SET_NUMBER) throw new Error('DEMO-SPEED requires explicit mock mode.');
    if (options.mode === 'mock' && set.setNumber !== SPEED_DEMO_SET_NUMBER) throw new Error('Mock mode accepts only DEMO-SPEED; synthetic inventory cannot represent a real set.');
    if (seen.has(set.setNumber)) throw new Error(`Duplicate benchmark set: ${set.setNumber}`);
    seen.add(set.setNumber);
  }
  const reports: BenchmarkSetReport[] = [];
  const frequency = new Map<string, MissingPartFrequency['parts'][number]>();
  let realSetsRead = 0;
  // Deliberately serial: one complete inventory (including pagination) before the next.
  for (const set of config) {
    const report = emptyReport(set); reports.push(report);
    let raw: SetInventory;
    try {
      if (!options.provider) throw options.unavailableReason ?? new InventoryError('Rebrickable API Key 未配置。', 'MISSING_API_KEY', 503);
      if (options.provider.source !== (options.mode === 'real' ? 'rebrickable' : 'mock')) throw new Error('Provider source does not match the requested benchmark mode.');
      raw = await options.provider.getSetInventory(set.setNumber);
      if (raw.source !== options.provider.source || raw.setNumber !== set.setNumber) throw new Error('Inventory source or set number does not match the requested set.');
      report.source = raw.source; report.sourceLabel = raw.sourceLabel; report.name = raw.name;
      report.snapshotId = raw.snapshotId ?? null; report.fetchedAt = raw.fetchedAt ?? null;
      report.theme.id = raw.themeId ?? null;
      report.inventoryRead = true;
      if (options.mode === 'real') realSetsRead++;
    } catch (error) {
      const detail = failure(error, 'inventory'); report.errors.push(detail);
      const pending = pendingCodes.has(detail.code);
      report.executionState = pending ? 'pending' : 'failed'; report.result = pending ? 'PARTIAL' : 'FAIL';
      continue;
    }
    let inventory: SpeedInventory;
    try {
      inventory = analyzeSpeedInventories([raw]);
      report.basic = {
        totalInventoryQuantity: inventory.analysis.totalQuantity, uniquePartColorCount: inventory.items.length,
        uniquePartIdCount: new Set(inventory.items.map(item => item.partId)).size,
        spareQuantity: raw.quantitySummary?.spareQuantity ?? null,
        quantityIncludingSpares: raw.quantitySummary?.totalQuantity ?? null,
        sparePolicy: raw.sparePolicy ?? 'not supplied by provider',
      };
      report.support = supportStats(inventory); report.criticalCarParts = criticalCarParts(raw, inventory);
      report.canGenerate = inventory.analysis.canGenerate; report.prerequisiteFailures = [...inventory.analysis.missingRequirements];
      report.warnings = [...inventory.warnings]; report.executionState = 'succeeded';
      if (options.mode === 'real') for (const item of inventory.items.filter(item => !item.supported)) {
        let entry = frequency.get(item.partId);
        const upstream = raw.items.find(row => row.partId === item.partId);
        if (!entry) {
          entry = { partId: item.partId, name: upstream?.name ?? item.name, category: item.category, upstreamCategoryIds: [], support: item.support === 'partiallySupported' ? 'recognizedOnly' : 'unsupported', quantity: 0, setsAppearance: 0, setsRead: 0, appearanceFraction: '', appearanceRate: 0, sets: [] };
          frequency.set(item.partId, entry);
        }
        const categoryId = upstream?.partCategoryId;
        if (typeof categoryId === 'number' && !entry.upstreamCategoryIds.includes(categoryId)) entry.upstreamCategoryIds.push(categoryId);
        entry.quantity += item.quantityAvailable;
        const previous = entry.sets.find(row => row.setNumber === set.setNumber);
        if (previous) previous.quantity += item.quantityAvailable;
        else entry.sets.push({ setNumber: set.setNumber, quantity: item.quantityAvailable });
      }
    } catch (error) {
      report.errors.push(failure(error, 'analysis')); report.executionState = 'failed'; report.result = 'FAIL'; continue;
    }
    if (options.onInventoryAnalyzed) try { await options.onInventoryAnalyzed(raw, inventory); }
    catch (error) { report.errors.push(failure(error, 'snapshot')); report.executionState = 'failed'; }
    let model: VehicleModel;
    try {
      // Run the real generator even if prerequisite analysis already predicts a failure.
      model = (options.generate ?? generateVehicleModel)(inventory, { ...defaultOptions });
      report.generation = { status: 'pass', modelId: model.id, failureReason: null };
    } catch (error) {
      const detail = failure(error, 'generation'); report.errors.push(detail);
      report.generation = { status: 'fail', modelId: null, failureReason: detail.message };
      report.executionState = 'failed'; report.result = 'FAIL'; continue;
    }
    const checks: Array<[ValidatorName, () => ValidationResult]> = [
      ['InventoryValidator', () => new SpeedInventoryValidator().validate(model, inventory)],
      ['ConnectionValidator', () => new SpeedConnectionValidator().validate(model)],
      ['WheelValidator', () => new WheelValidator().validate(model)],
      ['StructuralValidator', () => new StructuralValidator().validate(model)],
      ['CollisionValidator', () => new SpeedCollisionValidator().validate(model)],
    ];
    for (const [name, check] of checks) try {
      const result = check(); report.validators[name] = { status: result.valid ? 'pass' : 'fail', errors: result.errors, warnings: result.warnings, details: result };
      if (!result.valid) report.errors.push(failure(new Error(`${name}: ${result.errors.join('; ')}`), 'validation'));
    } catch (error) {
      const detail = failure(error, 'validation'); report.errors.push(detail); report.executionState = 'failed';
      report.validators[name] = { status: 'fail', errors: [detail.message], warnings: [] };
    }
    report.result = report.errors.length || validatorNames.some(name => report.validators[name].status !== 'pass') ? 'FAIL' : report.support.unsupportedQuantity ? 'PARTIAL' : 'PASS';
  }
  const parts = [...frequency.values()].map(entry => ({ ...entry, setsAppearance: entry.sets.length, setsRead: realSetsRead, appearanceFraction: `${entry.sets.length}/${realSetsRead}`, appearanceRate: realSetsRead ? entry.sets.length / realSetsRead : 0 })).sort((a, b) => b.setsAppearance - a.setsAppearance || b.quantity - a.quantity || a.partId.localeCompare(b.partId));
  const pending = reports.filter(report => report.executionState === 'pending').length;
  return {
    schemaVersion: 1, reportId: options.reportId ?? randomUUID(), createdAt: (options.now ?? (() => new Date()))().toISOString(), mode: options.mode,
    versions: VERSION_METADATA, validationScope: 'Automated validation checks current software rules only. Physical validation remains untested.',
    onlineValidation: options.mode === 'mock' ? 'Mock only — no real online validation' : pending ? 'Real online validation pending' : 'Real online validation executed',
    summary: {
      requested: reports.length, inventoriesRead: reports.filter(report => report.inventoryRead).length, pending,
      executionFailed: reports.filter(report => report.executionState === 'failed').length,
      pass: reports.filter(report => report.result === 'PASS').length, partial: reports.filter(report => report.result === 'PARTIAL').length, fail: reports.filter(report => report.result === 'FAIL').length,
      realInventoriesRead: realSetsRead,
      realValidated: options.mode === 'real' ? reports.filter(report => report.inventoryRead && validatorNames.every(name => report.validators[name].status !== 'unrun')).length : 0,
      realPassed: options.mode === 'real' ? reports.filter(report => report.result === 'PASS').length : 0, physicalBuildsValidated: 0,
    },
    sets: reports,
    missingFrequency: { realSetsRead, requestedRealSets: options.mode === 'real' ? reports.length : 0, denominatorDefinition: 'Only complete, successfully read Rebrickable inventories in this real run; pending and mock sets are excluded. Quantities exclude spare parts.', status: realSetsRead ? 'available' : 'pending', parts },
  };
}

export function benchmarkExitCode(report: SpeedBenchmarkReport): 0 | 1 | 2 {
  if (report.summary.pending) return 2;
  return report.sets.every(set => set.result === 'PASS' && set.executionState === 'succeeded') ? 0 : 1;
}

function csv(rows: unknown[][]): string {
  return rows.map(row => row.map(value => {
    let text = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  }).join(',')).join('\r\n') + '\r\n';
}
export function benchmarkCsv(report: SpeedBenchmarkReport): string {
  return csv([
    ['setNumber', 'name', 'mode', 'source', 'executionState', 'result', 'totalInventoryQuantity', 'uniquePartColorCount', 'uniquePartIdCount', 'supportedQuantity', 'recognizedOnlyQuantity', 'unknownQuantity', 'unsupportedQuantity', 'quantityWeightedSupportedPercentage', 'canGenerate', 'generation', ...validatorNames, 'snapshotId', 'fetchedAt', 'themeId', 'runtimeThemeVerification', 'physicalValidation', 'criticalCarParts', 'errors'],
    ...report.sets.map(set => [set.setNumber, set.name, report.mode, set.source, set.executionState, set.result, set.basic?.totalInventoryQuantity, set.basic?.uniquePartColorCount, set.basic?.uniquePartIdCount, set.support?.supportedQuantity, set.support?.recognizedOnlyQuantity, set.support?.unknownQuantity, set.support?.unsupportedQuantity, set.support?.quantityWeightedSupportedPercentage, set.canGenerate, set.generation.status, ...validatorNames.map(name => set.validators[name].status), set.snapshotId, set.fetchedAt, set.theme.id, set.theme.runtimeVerification, set.physicalValidation, set.criticalCarParts, set.errors]),
  ]);
}
export function missingFrequencyCsv(report: SpeedBenchmarkReport): string {
  return csv([['partId', 'name', 'category', 'upstreamCategoryIds', 'support', 'quantity', 'setsAppearance', 'realSetsRead', 'appearanceFraction', 'appearanceRate', 'sets'], ...report.missingFrequency.parts.map(part => [part.partId, part.name, part.category, part.upstreamCategoryIds, part.support, part.quantity, part.setsAppearance, part.setsRead, part.appearanceFraction, part.appearanceRate, part.sets])]);
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, content, { flag: 'wx', mode: 0o600 }); await rename(temporary, path); }
  catch (error) {
    try { await unlink(temporary); } catch (cleanup) { if (!(cleanup && typeof cleanup === 'object' && 'code' in cleanup && cleanup.code === 'ENOENT')) throw new AggregateError([error, cleanup], `Report write and cleanup failed: ${path}`); }
    throw error;
  }
}

/** --output accepts a directory or a JSON filename; each artifact is committed atomically. */
export async function writeBenchmarkReport(report: SpeedBenchmarkReport, output?: string, dataDir = process.env.BRICKLAB_DATA_DIR || 'data'): Promise<{ json: string; csv: string; missingJson: string; missingCsv: string }> {
  const defaultStem = `speed-${report.createdAt.replaceAll(/[:.]/g, '-')}-${report.reportId}`;
  const base = resolve(output?.toLowerCase().endsWith('.json') ? output.slice(0, -5) : join(output || join(dataDir, 'benchmarks'), defaultStem));
  const paths = { json: `${base}.json`, csv: `${base}.csv`, missingJson: `${base}.missing-frequency.json`, missingCsv: `${base}.missing-frequency.csv` };
  await atomicWrite(paths.json, `${JSON.stringify(report, null, 2)}\n`);
  await atomicWrite(paths.csv, benchmarkCsv(report));
  await atomicWrite(paths.missingJson, `${JSON.stringify({ reportId: report.reportId, createdAt: report.createdAt, mode: report.mode, versions: report.versions, ...report.missingFrequency }, null, 2)}\n`);
  await atomicWrite(paths.missingCsv, missingFrequencyCsv(report));
  return paths;
}
