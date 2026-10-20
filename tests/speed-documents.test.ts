import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSpeedDocument, packSpeedDocument, parseImportedSpeedDocument } from '../src/speed/documents.js';
import { parsePhysicalBuildFeedback, SpeedPhysicalFeedbackDiskStore } from '../src/speed/feedback.js';
import { generateVehicleCandidates } from '../src/speed/generator.js';
import { analyzeSpeedInventories, createSpeedDemoInventory } from '../src/speed/inventory.js';
import { SpeedDesignStore } from '../src/speed/sessions.js';
import { SpeedModelDiskStore } from '../src/speed/storage.js';
import type { SpeedGenerationResult } from '../src/speed/types.js';

let result: SpeedGenerationResult;
const directories: string[] = [];
async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'bricklab-models-'));
  directories.push(directory);
  return directory;
}

beforeAll(() => {
  const inventory = analyzeSpeedInventories([createSpeedDemoInventory()]);
  const candidates = generateVehicleCandidates(inventory, { prompt: '未来感低矮超级跑车', vehicleType: 'supercar', style: 'futuristic', minifigure: false, priority: 'structure', maximizeUsage: false });
  result = { inventory, candidates: [candidates[0]], warnings: [] };
}, 30000);
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });

describe('versioned Speed JSON persistence', () => {
  it('restores an exact model and stable version metadata after a server restart', async () => {
    const dataDir = await temporaryDirectory();
    const store = new SpeedDesignStore(new SpeedModelDiskStore({ dataDir }));
    const sessionId = await store.create(result);
    const document = store.document(store.get(sessionId), result.candidates[0].model.id);
    const restartedDisk = new SpeedModelDiskStore({ dataDir });
    expect(await restartedDisk.load(document.metadata.modelId)).toEqual(document);
    expect(await restartedDisk.list()).toEqual([expect.objectContaining({ id: document.metadata.modelId, physicalValidation: 'untested', partCount: document.candidate.model.parts.length })]);
    const restartedStore = new SpeedDesignStore(restartedDisk);
    const reopened = await restartedStore.create(result, [await restartedDisk.load(document.metadata.modelId)]);
    expect(restartedStore.document(restartedStore.get(reopened), document.metadata.modelId)).toEqual(document);
  });

  it('preserves the exact pre-edit revision for feedback while lock and undo advance server revision', async () => {
    const storage = new SpeedModelDiskStore({ dataDir: await temporaryDirectory() });
    const store = new SpeedDesignStore(storage);
    const session = store.get(await store.create(result));
    const id = result.candidates[0].model.id;
    const original = store.document(session, id);
    const changed = structuredClone(store.candidate(session, id));
    changed.model.modules[0].locked = true;
    expect(await store.replace(session, changed)).toBe(1);
    const locked = store.document(session, id);
    expect(locked.metadata).toMatchObject({ modelId: id, generatedAt: original.metadata.generatedAt, revision: 2, physicalValidation: 'untested' });
    expect(locked.metadata.modelDigest).not.toBe(original.metadata.modelDigest);
    expect(await storage.loadRevision(id, 1, original.metadata.modelDigest)).toEqual(original);
    await store.undo(session, id);
    expect(store.document(session, id).metadata.revision).toBe(3);
    expect(store.candidate(session, id).model.modules[0].locked).toBe(true);
  });

  it('does not change the active model or undo stack when saving fails', async () => {
    const dataDir = await temporaryDirectory();
    const storage = new SpeedModelDiskStore({ dataDir });
    const store = new SpeedDesignStore(storage);
    const session = store.get(await store.create(result));
    const id = result.candidates[0].model.id;
    const original = store.document(session, id);
    await rm(storage.directory, { recursive: true });
    await writeFile(storage.directory, 'This blocks the directory');
    const changed = structuredClone(store.candidate(session, id));
    changed.model.modules[0].locked = true;
    await expect(store.replace(session, changed)).rejects.toMatchObject({ code: 'SPEED_MODEL_STORAGE_UNAVAILABLE' });
    expect(store.document(session, id)).toEqual(original);
    expect(session.history.size).toBe(0);
  });

  it('rejects traversal identifiers and reports corrupted JSON without silently discarding it', async () => {
    const dataDir = await temporaryDirectory();
    const storage = new SpeedModelDiskStore({ dataDir });
    await expect(storage.load('../escape')).rejects.toMatchObject({ code: 'INVALID_SPEED_MODEL_ID' });
    const document = createSpeedDocument(result.candidates[0], result.inventory);
    await storage.save(document);
    const filename = path.join(storage.directory, `${document.metadata.modelId}.json`);
    await writeFile(filename, '{broken');
    await expect(storage.load(document.metadata.modelId)).rejects.toMatchObject({ code: 'SPEED_MODEL_STORAGE_CORRUPT' });
    expect(await readFile(filename, 'utf8')).toBe('{broken');
    await expect(storage.list()).rejects.toMatchObject({ code: 'SPEED_MODEL_STORAGE_CORRUPT' });
  });

  it('serializes concurrent updates and rejects stale tabs without overwriting the latest revision', async () => {
    const dataDir = await temporaryDirectory();
    const first = new SpeedDesignStore(new SpeedModelDiskStore({ dataDir }));
    const session = first.get(await first.create(result));
    const id = result.candidates[0].model.id, original = first.document(session, id);
    const second = new SpeedDesignStore(new SpeedModelDiskStore({ dataDir }));
    const oldTab = second.get(await second.create(result, [original]));
    const a = structuredClone(first.candidate(session, id)), b = structuredClone(second.candidate(oldTab, id));
    a.model.modules[0].locked = true;
    b.model.modules[1].locked = true;
    const updates = await Promise.allSettled([first.replace(session, a), second.replace(oldTab, b)]);
    expect(updates.filter(update => update.status === 'fulfilled')).toHaveLength(1);
    expect(updates.find(update => update.status === 'rejected')).toMatchObject({ reason: { code: 'SPEED_MODEL_REVISION_CONFLICT', status: 409 } });
    const latest = await first.storage.load(id);
    expect(latest.metadata.revision).toBe(2);
    await second.create(result, [original]);
    expect(await first.storage.load(id)).toEqual(latest);
  });
});

describe('untrusted Speed archive import', () => {
  it('round trips packed JSON into a fresh model with rebuilt steps, versions and self-reported inventory', () => {
    const original = createSpeedDocument(result.candidates[0], result.inventory);
    const raw = JSON.parse(JSON.stringify(packSpeedDocument(original)));
    raw.metadata.physicalValidation = 'passed';
    raw.metadata.generatorVersion = 'original-generator-0.2';
    raw.candidate.validation.valid = false;
    raw.candidate.steps = [];
    const imported = parseImportedSpeedDocument(raw);
    expect(imported.metadata).toMatchObject({ origin: 'imported', physicalValidation: 'untested', revision: 1, generatorVersion: '0.2.1', importedFrom: { modelId: original.metadata.modelId, generatorVersion: 'original-generator-0.2' } });
    expect(imported.metadata.modelId).not.toBe(original.metadata.modelId);
    expect(imported.candidate.validation.valid).toBe(true);
    expect(imported.candidate.steps.length).toBeGreaterThan(1);
    expect(imported.inventory.inventorySources.every(source => source.source === 'custom')).toBe(true);
    expect(imported.inventory.sourceLabel).toContain('未核验');
    expect(imported.metadata.snapshotIds).toEqual([]);
  }, 15000);

  it('accepts legacy full steps within schema 1 and reclassifies forged stock support using the local catalog', () => {
    const raw = structuredClone(createSpeedDocument(result.candidates[0], result.inventory));
    const partial = raw.inventory.items.find(item => item.support === 'partiallySupported')!;
    partial.supported = true; partial.support = 'supported'; partial.dimensions = { x: 999, y: 999, z: 999 };
    const imported = parseImportedSpeedDocument(raw);
    expect(imported.inventory.items.find(item => item.partId === partial.partId)).toMatchObject({ supported: false, support: 'partiallySupported', dimensions: null });
    expect(imported.candidate.validation.valid).toBe(true);
  }, 15000);

  it('accepts real-source snapshot metadata without promoting imported stock to verified inventory', () => {
    const inventory = structuredClone(result.inventory);
    const source = inventory.inventorySources[0];
    source.source = 'rebrickable'; source.setNumber = '76922-1'; source.name = 'Real-source schema fixture; not a fetched set';
    source.snapshotId = 'a1bf4226-a988-4ef5-b022-697cafdbb1fb'; source.fetchedAt = '2026-10-20T00:00:00.000Z'; source.themeId = 601; source.sparePolicy = 'excluded';
    for (const item of inventory.items) item.sources[0].setNumber = source.setNumber;
    const document = createSpeedDocument(result.candidates[0], inventory);
    expect(document.metadata.snapshotIds).toEqual([source.snapshotId]);
    const imported = parseImportedSpeedDocument(packSpeedDocument(document));
    expect(imported.metadata.importedFrom?.snapshotIds).toEqual([source.snapshotId]);
    expect(imported.metadata.snapshotIds).toEqual([]);
    expect(imported.inventory.inventorySources[0]).toMatchObject({ source: 'custom', setNumber: '76922-1' });
    expect(imported.inventory.inventorySources[0].snapshotId).toBeUndefined();
  }, 15000);

  it('rejects forged part geometry, duplicate instances, bad stock provenance and coordinate abuse', () => {
    const original = packSpeedDocument(createSpeedDocument(result.candidates[0], result.inventory));
    for (const tamper of [
      (raw: typeof original) => { raw.candidate.model.parts[0].dimensions.x += 1; },
      (raw: typeof original) => { raw.candidate.model.parts[0].connectionPoints[0].localPosition.x += 1; },
      (raw: typeof original) => { raw.candidate.model.parts[1].instanceId = raw.candidate.model.parts[0].instanceId; },
      (raw: typeof original) => { raw.inventory.items[0].sources[0].quantity += 1; },
      (raw: typeof original) => { raw.candidate.model.parts[0].position.x = Infinity; },
    ]) {
      const raw = structuredClone(original); tamper(raw);
      expect(() => parseImportedSpeedDocument(raw)).toThrow(expect.objectContaining({ code: 'INVALID_SPEED_MODEL_DOCUMENT' }));
    }
    const colliding = structuredClone(original);
    colliding.candidate.model.parts[0].position.x = 500;
    colliding.candidate.model.dimensions.x = 500;
    expect(() => parseImportedSpeedDocument(colliding)).toThrow();
  });

  it('rejects an unknown schema and oversized graph before attempting model validation', () => {
    expect(() => parseImportedSpeedDocument({ schemaVersion: 2, metadata: {}, candidate: {}, inventory: {} })).toThrow(expect.objectContaining({ code: 'INVALID_SPEED_MODEL_DOCUMENT' }));
    const raw = packSpeedDocument(createSpeedDocument(result.candidates[0], result.inventory));
    raw.candidate.model.parts = Array.from({ length: 301 }, () => raw.candidate.model.parts[0]);
    expect(() => parseImportedSpeedDocument(raw)).toThrow(expect.objectContaining({ code: 'INVALID_SPEED_MODEL_DOCUMENT' }));
  });
});

describe('physical build reports', () => {
  function input(document: ReturnType<typeof createSpeedDocument>) {
    return { modelId: document.metadata.modelId, revision: document.metadata.revision, modelDigest: document.metadata.modelDigest, actuallyBuilt: true, buildResult: 'success', wheel: 'normal', stability: 'stable', instructions: 'clear', problems: [] };
  }

  it('requires explicit real building and an exact model revision, and validates issue references', () => {
    const document = createSpeedDocument(result.candidates[0], result.inventory);
    expect(() => parsePhysicalBuildFeedback({ ...input(document), actuallyBuilt: false }, document)).toThrow(expect.objectContaining({ code: 'INVALID_PHYSICAL_BUILD_FEEDBACK' }));
    expect(() => parsePhysicalBuildFeedback({ ...input(document), revision: 2 }, document)).toThrow(expect.objectContaining({ code: 'PHYSICAL_FEEDBACK_MODEL_MISMATCH' }));
    for (const problem of [{ stepNumber: 9999, issueType: 'other', text: '' }, { partId: 'nonexistent', issueType: 'collision', text: '' }, { issueType: 'invented-type', text: '' }]) {
      expect(() => parsePhysicalBuildFeedback({ ...input(document), problems: [problem] }, document)).toThrow(expect.objectContaining({ code: 'INVALID_PHYSICAL_BUILD_FEEDBACK' }));
    }
  });

  it('persists successful self-reports separately and never labels partial or problematic builds passed', async () => {
    const dataDir = await temporaryDirectory(), document = createSpeedDocument(result.candidates[0], result.inventory);
    const store = new SpeedPhysicalFeedbackDiskStore({ dataDir });
    const feedback = parsePhysicalBuildFeedback(input(document), document);
    expect(feedback).toMatchObject({ physicalValidation: 'passed', userReported: true, modelVersion: document.candidate.model.version });
    await store.save(feedback);
    expect(await new SpeedPhysicalFeedbackDiskStore({ dataDir }).list(document.metadata.modelId, 1, document.metadata.modelDigest)).toEqual([feedback]);
    expect(await store.list(document.metadata.modelId, 2, document.metadata.modelDigest)).toEqual([]);
    const partial = parsePhysicalBuildFeedback({ ...input(document), buildResult: 'partial' }, document);
    expect(partial.physicalValidation).toBe('untested');
    const friction = parsePhysicalBuildFeedback({ ...input(document), wheel: 'friction' }, document);
    expect(friction.physicalValidation).toBe('untested');
    const problem = parsePhysicalBuildFeedback({ ...input(document), problems: [{ stepNumber: 1, partId: document.candidate.model.parts[0].partId, issueType: 'unclear_instruction', text: '请补充观察方向' }] }, document);
    expect(problem.physicalValidation).toBe('untested');
    expect(document.metadata.physicalValidation).toBe('untested');
  });
});
