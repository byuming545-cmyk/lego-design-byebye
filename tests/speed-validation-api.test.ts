import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../src/api/app.js';
import { MockInventoryProvider } from '../src/inventory/index.js';
import type { SpeedModelDocument } from '../src/speed/documents.js';

let server: Server;
let base: string;
let document: SpeedModelDocument;
const previousDataDir = process.env.BRICKLAB_DATA_DIR;
async function start() {
  server = createApp({ legacyGenerationPolicy: 'test-fixture', provider: new MockInventoryProvider(), staticDir: false }).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing server address');
  base = `http://127.0.0.1:${address.port}/api/speed`;
}
async function stop() { await new Promise<void>(resolve => server.close(() => resolve())); }
async function post(path: string, body: unknown, method = 'POST') {
  return fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
beforeAll(async () => {
  // Other Vitest files also generate archives concurrently; this suite owns its list.
  process.env.BRICKLAB_DATA_DIR = path.join(tmpdir(), `bricklab-validation-api-${randomUUID()}`);
  await start();
  const response = await post('/generate', { setNumbers: ['DEMO-SPEED'], options: { prompt: '低矮跑车', vehicleType: 'supercar', style: 'futuristic', minifigure: false, priority: 'structure', maximizeUsage: false } });
  expect(response.status).toBe(200);
  const result = await response.json();
  const id = result.candidates[0].model.id;
  document = await (await fetch(`${base}/models/${id}/export`)).json();
  expect(result.modelMetadata[id]).toEqual(document.metadata);
}, 20000);
afterAll(async () => {
  await stop();
  if (previousDataDir === undefined) delete process.env.BRICKLAB_DATA_DIR;
  else process.env.BRICKLAB_DATA_DIR = previousDataDir;
});

describe('Validation Edition HTTP persistence boundaries (synthetic fixtures)', () => {
  it('restores saved geometry and instructions through a new application instance', async () => {
    await stop();
    await start();
    const response = await post(`/models/${document.metadata.modelId}/open`, {});
    expect(response.status, await response.clone().text()).toBe(200);
    const restored = await response.json();
    expect(restored.candidates[0]).toEqual(document.candidate);
    expect(restored.modelMetadata[document.metadata.modelId]).toEqual(document.metadata);
    expect(restored.candidates[0].steps.at(-1).totalModelState).toHaveLength(document.candidate.model.parts.length);
  });

  it('allows large model imports only through the import route and reruns validation', async () => {
    expect(Buffer.byteLength(JSON.stringify(document))).toBeGreaterThan(32768);
    const forged = structuredClone(document);
    forged.metadata.physicalValidation = 'passed' as 'untested';
    forged.candidate.validation.valid = false;
    forged.candidate.steps = [];
    const response = await post('/models/import', forged);
    expect(response.status, await response.clone().text()).toBe(200);
    const imported = await response.json();
    const candidate = imported.candidates[0];
    expect(candidate.model.id).not.toBe(document.metadata.modelId);
    expect(candidate.validation.valid).toBe(true);
    expect(candidate.steps.length).toBeGreaterThan(1);
    expect(imported.inventory.sourceLabel).toContain('用户');
    expect(imported.modelMetadata[candidate.model.id].physicalValidation).toBe('untested');
    const injected = await post('/generate', { inventory: document.inventory, candidate: document.candidate });
    expect(injected.status).toBe(413);
  }, 20000);

  it('rejects altered geometry without creating an archive or replacing the original', async () => {
    const before = await (await fetch(`${base}/models`)).json();
    const altered = structuredClone(document);
    altered.candidate.model.parts[0].dimensions.x += 1;
    expect((await post('/models/import', altered)).status).toBe(400);
    const after = await (await fetch(`${base}/models`)).json();
    expect(after.models.map((item: { id: string }) => item.id).sort()).toEqual(before.models.map((item: { id: string }) => item.id).sort());
    expect(await (await fetch(`${base}/models/${document.metadata.modelId}/export`)).json()).toEqual(document);
  });

  it('keeps fixture feedback attached to its exact older revision', async () => {
    const opened = await (await post(`/models/${document.metadata.modelId}/open`, {})).json();
    const locked = await (await post(`/designs/${opened.sessionId}/modules/cockpit`, { candidateId: document.metadata.modelId, locked: true }, 'PATCH')).json();
    expect(locked.metadata.revision).toBe(document.metadata.revision + 1);
    const feedback = { modelId: document.metadata.modelId, revision: document.metadata.revision, modelDigest: document.metadata.modelDigest, actuallyBuilt: true, buildResult: 'partial', wheel: 'friction', stability: 'weak', instructions: 'difficult', problems: [{ stepNumber: 1, issueType: 'unclear_instruction', text: 'AUTOMATED TEST FIXTURE: no physical build performed.' }] };
    expect((await post(`/models/${document.metadata.modelId}/feedback`, { ...feedback, actuallyBuilt: false })).status).toBe(400);
    const response = await post(`/models/${document.metadata.modelId}/feedback`, feedback);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ userReported: true, physicalValidation: 'untested', feedback: { revision: document.metadata.revision, modelDigest: document.metadata.modelDigest } });
    const history = await (await fetch(`${base}/models/${document.metadata.modelId}/feedback`)).json();
    expect(history.feedback).toHaveLength(1);
    expect(history.physicalValidation).toBe('untested');
    const mismatched = await post(`/models/${document.metadata.modelId}/feedback`, { ...feedback, modelDigest: 'a'.repeat(64) });
    expect(mismatched.status).toBe(404);
  });
});
