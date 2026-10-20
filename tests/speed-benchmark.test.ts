import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InventoryError, type SetInventoryProvider } from '../src/inventory/provider.js';
import type { PartInventoryItem, SetInventory } from '../src/types/index.js';
import { benchmarkCsv, benchmarkExitCode, parseBenchmarkConfig, runSpeedBenchmark, writeBenchmarkReport } from '../src/speed/benchmark.js';
import { createSpeedDemoInventory } from '../src/speed/inventory.js';
import { generateVehicleModel } from '../src/speed/generator.js';
import { getSpeedPartDefinition } from '../src/speed/catalog.js';
import { speedBenchmarkMain } from '../src/cli/speed-benchmark.js';

const temporary: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); vi.restoreAllMocks(); await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const row = (partId: string, quantityAvailable: number, colorId = 0, name = partId): PartInventoryItem => ({ partId, name, category: 'Unsupported', color: { id: colorId, name: 'Fixture black', hex: '#000000' }, quantityAvailable, quantityUsed: 0, supported: false, dimensions: { x: 1, y: 1, z: 1 }, partCategoryId: 37 });
/** Synthetic unit-test fixtures. This label is never evidence of a real online fetch. */
const fixture = (setNumber: string, items: PartInventoryItem[]): SetInventory => ({ setNumber, name: 'SYNTHETIC TEST FIXTURE — not real online inventory', source: 'rebrickable', sourceLabel: 'Injected test fixture, no online request', items, warnings: [], themeId: 601, sparePolicy: 'excluded', quantitySummary: { regularQuantity: items.reduce((sum, part) => sum + part.quantityAvailable, 0), spareQuantity: 2, totalQuantity: items.reduce((sum, part) => sum + part.quantityAvailable, 0) + 2 } });

describe('Speed benchmark evidence and execution states', () => {
  it('keeps all ten configured real sets pending without credentials, with unrun validators and no frequency claims', async () => {
    const config = parseBenchmarkConfig(JSON.parse(await readFile('speed-benchmark.json', 'utf8')));
    expect(config).toHaveLength(10);
    expect(new Set(config.map(set => set.setNumber)).size).toBe(10);
    expect(config.every(set => set.expectedTheme === 'Speed Champions' && set.evidence?.url && set.evidence?.themeUrl)).toBe(true);
    const report = await runSpeedBenchmark({ sets: config, mode: 'real', now: () => new Date('2026-10-20T00:00:00Z'), reportId: 'test-pending' });
    expect(report.onlineValidation).toBe('Real online validation pending');
    expect(report.summary).toMatchObject({ requested: 10, pending: 10, realInventoriesRead: 0, realValidated: 0, realPassed: 0, pass: 0, physicalBuildsValidated: 0 });
    expect(report.sets.every(set => set.executionState === 'pending' && set.result === 'PARTIAL' && set.basic === null && set.canGenerate === null && set.physicalValidation === 'untested')).toBe(true);
    expect(report.sets.every(set => Object.values(set.validators).every(check => check.status === 'unrun'))).toBe(true);
    expect(report.sets[0].errors[0]).toMatchObject({ stage: 'inventory', code: 'MISSING_API_KEY', trace: expect.stringContaining('InventoryError') });
    expect(report.missingFrequency).toMatchObject({ status: 'pending', realSetsRead: 0, requestedRealSets: 10, parts: [] });
    expect(benchmarkExitCode(report)).toBe(2);
  });

  it('reads sequentially, continues after upstream and generation failures, and counts missing IDs per successfully read real set', async () => {
    let active = 0, maxActive = 0;
    const called: string[] = [];
    const provider: SetInventoryProvider = { source: 'rebrickable', getSetInventory: async setNumber => {
      called.push(setNumber); maxActive = Math.max(maxActive, ++active);
      await Promise.resolve(); active--;
      if (setNumber === '76901-1') throw new InventoryError('Network fixture error', 'UPSTREAM_NETWORK_ERROR', 502);
      return fixture(setNumber, [row('3020', 4), row('99780', 2), row('unknown-rim', 3, 0, 'Wheel Rim unknown fixture'), row('unknown-rim', 1, 1, 'Wheel Rim unknown fixture')]);
    } };
    const report = await runSpeedBenchmark({ sets: ['76900', '76901', '76902'], mode: 'real', provider });
    expect(called).toEqual(['76900-1', '76901-1', '76902-1']); expect(maxActive).toBe(1);
    expect(report.summary).toMatchObject({ realInventoriesRead: 2, realValidated: 0, pending: 1, fail: 2 });
    expect(report.sets[0].basic).toMatchObject({ totalInventoryQuantity: 10, uniquePartColorCount: 4, uniquePartIdCount: 3, spareQuantity: 2, quantityIncludingSpares: 12 });
    expect(report.sets[0].support).toMatchObject({ supportedQuantity: 4, recognizedOnlyQuantity: 2, unknownQuantity: 4, unsupportedQuantity: 6, quantityWeightedSupportedPercentage: 40 });
    expect(report.sets[0].generation).toMatchObject({ status: 'fail', failureReason: expect.stringContaining('完整四轮组合') });
    expect(report.sets[0].errors.some(error => error.stage === 'generation' && error.code === 'MISSING_SPEED_PARTS')).toBe(true);
    expect(Object.values(report.sets[0].validators).every(check => check.status === 'unrun')).toBe(true);
    expect(report.sets[0].criticalCarParts?.wheels).toMatchObject({ present: true, quantity: 4, supportedQuantity: 0, unknownQuantity: 4, evidence: [{ partId: 'unknown-rim', basis: 'upstream-name', generatable: false }] });
    expect(report.sets[0].criticalCarParts?.brackets).toMatchObject({ present: true, quantity: 2, recognizedOnlyQuantity: 2, supportedQuantity: 0 });
    expect(report.sets[0].theme).toMatchObject({ id: 601, runtimeVerification: 'unverified' });
    expect(report.missingFrequency.parts.find(part => part.partId === 'unknown-rim')).toMatchObject({ quantity: 8, setsAppearance: 2, setsRead: 2, appearanceFraction: '2/2', appearanceRate: 1, upstreamCategoryIds: [37], support: 'unsupported' });
    expect(report.missingFrequency.parts.find(part => part.partId === '99780')).toMatchObject({ quantity: 4, setsAppearance: 2, support: 'recognizedOnly', category: 'Bracket' });
  });

  it('never lets injected mock inventory stand in for a real set', async () => {
    const provider: SetInventoryProvider = { source: 'rebrickable', getSetInventory: async () => createSpeedDemoInventory() };
    const report = await runSpeedBenchmark({ sets: ['76900'], mode: 'real', provider });
    expect(report.sets[0]).toMatchObject({ executionState: 'failed', result: 'FAIL', inventoryRead: false, source: null });
    expect(report.summary.realInventoriesRead).toBe(0); expect(report.missingFrequency.parts).toEqual([]);
    expect(benchmarkExitCode(report)).toBe(1);
    await expect(runSpeedBenchmark({ sets: ['DEMO-SPEED'], mode: 'real' })).rejects.toThrow('explicit mock');
    await expect(runSpeedBenchmark({ sets: ['76900'], mode: 'mock' })).rejects.toThrow('synthetic inventory');
  });

  it('runs the real generator and all five validators in explicit mock mode without counting a real acceptance', async () => {
    const provider: SetInventoryProvider = { source: 'mock', getSetInventory: async () => createSpeedDemoInventory() };
    const report = await runSpeedBenchmark({ sets: ['DEMO-SPEED'], mode: 'mock', provider });
    expect(report.sets[0].generation.status).toBe('pass');
    expect(Object.values(report.sets[0].validators).map(check => check.status)).toEqual(['pass', 'pass', 'pass', 'pass', 'pass']);
    expect(report.sets[0].result).toBe('PARTIAL');
    expect(report.summary).toMatchObject({ realValidated: 0, realPassed: 0, realInventoriesRead: 0 });
    expect(report.missingFrequency.parts).toEqual([]); expect(report.onlineValidation).toContain('Mock only');
    expect(benchmarkExitCode(report)).toBe(1);
  });

  it('reports PASS only when support and actual validators all pass', async () => {
    const provider: SetInventoryProvider = { source: 'mock', getSetInventory: async () => {
      const inventory = createSpeedDemoInventory(); inventory.items = inventory.items.filter(item => getSpeedPartDefinition(item.partId)?.support === 'supported'); return inventory;
    } };
    const report = await runSpeedBenchmark({ sets: ['DEMO-SPEED'], mode: 'mock', provider });
    expect(report.sets[0]).toMatchObject({ result: 'PASS', executionState: 'succeeded', canGenerate: true });
    expect(benchmarkExitCode(report)).toBe(0); expect(report.summary.realPassed).toBe(0);
  });

  it('records actual validator failures independently when a generated model is invalid', async () => {
    const provider: SetInventoryProvider = { source: 'mock', getSetInventory: async () => createSpeedDemoInventory() };
    const report = await runSpeedBenchmark({ sets: ['DEMO-SPEED'], mode: 'mock', provider, generate: (inventory, options) => {
      const model = generateVehicleModel(inventory, options); model.parts[0].position.x += 100; return model;
    } });
    expect(report.sets[0].generation.status).toBe('pass'); expect(report.sets[0].result).toBe('FAIL');
    expect(report.sets[0].validators.InventoryValidator.status).toBe('fail');
    expect(report.sets[0].validators.ConnectionValidator.status).toBe('fail');
    expect(report.sets[0].validators.CollisionValidator.status).not.toBe('unrun');
    expect(report.sets[0].errors.some(error => error.stage === 'validation' && error.trace)).toBe(true);
  });

  it('records snapshot errors without aborting remaining sets or hiding generation errors', async () => {
    const provider: SetInventoryProvider = { source: 'rebrickable', getSetInventory: async setNumber => fixture(setNumber, [row('3020', 4)]) };
    const report = await runSpeedBenchmark({ sets: ['76900', '76901'], mode: 'real', provider, onInventoryAnalyzed: async () => { throw new Error('Snapshot disk fixture failure'); } });
    expect(report.sets).toHaveLength(2);
    for (const set of report.sets) expect(set.errors.map(error => error.stage)).toEqual(['snapshot', 'generation']);
    expect(report.summary).toMatchObject({ realInventoriesRead: 2, executionFailed: 2 });
  });

  it('exports JSON and CSV plus an explicit pending frequency artifact atomically in nested directories', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bricklab-benchmark-')); temporary.push(directory);
    const report = await runSpeedBenchmark({ sets: ['76900'], mode: 'real' });
    const paths = await writeBenchmarkReport(report, join(directory, 'nested', 'report.json'));
    expect(JSON.parse(await readFile(paths.json, 'utf8'))).toEqual(report);
    expect(await readFile(paths.csv, 'utf8')).toBe(benchmarkCsv(report));
    expect(JSON.parse(await readFile(paths.missingJson, 'utf8'))).toMatchObject({ realSetsRead: 0, status: 'pending', parts: [] });
    expect(await readdir(join(directory, 'nested'))).toHaveLength(4);
    expect(await readFile(paths.missingCsv, 'utf8')).not.toContain('0/10');
    await expect(writeBenchmarkReport(report, join(paths.json, 'impossible.json'))).rejects.toThrow();
  });

  it('runs the CLI without a key, persists ten pending rows, and returns exit 2', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bricklab-cli-')); temporary.push(directory);
    vi.stubEnv('REBRICKABLE_API_KEY', ''); vi.stubEnv('INVENTORY_PROVIDER', 'mock');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const output = join(directory, 'real-pending.json');
    expect(await speedBenchmarkMain(['--config', 'speed-benchmark.json', '--output', output])).toBe(2);
    const report = JSON.parse(await readFile(output, 'utf8'));
    expect(report.summary).toMatchObject({ requested: 10, pending: 10, realPassed: 0 });
    expect(log.mock.calls.flat().join('\n')).toContain('Real online validation pending');
    await expect(speedBenchmarkMain(['--sets', '76900', '--mock'])).rejects.toThrow('only DEMO-SPEED');
    await expect(speedBenchmarkMain(['--sets', '76900', '--config', 'speed-benchmark.json'])).rejects.toThrow('either');
  });
});
