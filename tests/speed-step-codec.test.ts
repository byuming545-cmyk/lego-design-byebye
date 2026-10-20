import { beforeAll, describe, expect, it } from 'vitest';
import { deriveConnections } from '../src/speed/connections.js';
import { generateVehicleCandidates } from '../src/speed/generator.js';
import { analyzeSpeedInventories, createSpeedDemoInventory } from '../src/speed/inventory.js';
import { compactVehicleCandidate, packCandidateSteps, unpackCandidateSteps } from '../src/speed/stepCodec.js';
import type { SpeedPlacedPart, VehicleCandidate } from '../src/speed/types.js';

let candidate: VehicleCandidate;
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const ids = (parts: SpeedPlacedPart[]): string[] => parts.map(part => part.instanceId).sort();

beforeAll(() => {
  const inventory = analyzeSpeedInventories([createSpeedDemoInventory()]);
  candidate = generateVehicleCandidates(inventory, {
    prompt: '低矮原创跑车', vehicleType: 'supercar', style: 'futuristic',
    minifigure: false, priority: 'structure', maximizeUsage: true,
  })[0];
}, 30000);

describe('Speed compact instruction snapshots', () => {
  it('keeps the full public JSON shape while returning independent snapshots on every access', () => {
    const source = json(candidate), compact = compactVehicleCandidate(source);
    const expected = json(source);
    expect(json(compact)).toEqual(expected);
    const step = compact.steps.find(entry => entry.addedParts.length > 0)!;
    expect(Object.getOwnPropertyDescriptor(step, 'addedParts')?.get).toBeTypeOf('function');
    expect(Object.getOwnPropertyDescriptor(step, 'totalModelState')?.get).toBeTypeOf('function');
    const snapshot = step.totalModelState, first = snapshot[0];
    const original = json(first);
    first.position.x += 42;
    first.color.hex = '#abcdef';
    first.connectionPoints[0].localPosition.x += 99;
    first.activeConnections.push('invented-connection');
    snapshot.pop();
    expect(step.totalModelState[0]).toEqual(original);
    expect(step.totalModelState).not.toBe(step.totalModelState);
    expect(step.addedParts).not.toBe(step.addedParts);
    const added = step.addedParts;
    added[0].position.y += 100;
    expect(json(compact)).toEqual(expected);
    source.model.parts[0].position.x += 10;
    source.model.parts[0].color.hex = '#000000';
    expect(json(compact)).toEqual(expected);
  });

  it('retains each snapshot’s internal connections and assigns every picked part its final build step', () => {
    const compact = compactVehicleCandidate(candidate);
    const graph = deriveConnections(compact.model.parts), picked = new Set<string>();
    for (const step of compact.steps) {
      for (const parts of [step.addedParts, step.totalModelState]) {
        const present = new Set(parts.map(part => part.instanceId));
        for (const part of parts) {
          const internal = graph.filter(edge => present.has(edge.partA) && present.has(edge.partB) && (edge.partA === part.instanceId || edge.partB === part.instanceId));
          expect([...part.activeConnections].sort()).toEqual(internal.map(edge => edge.id).sort());
          expect(part.buildStep).toBe(compact.model.parts.find(original => original.instanceId === part.instanceId)!.buildStep);
        }
      }
      if (step.type !== 'build' && step.type !== 'subassembly') continue;
      for (const part of step.addedParts) {
        expect(picked.has(part.instanceId)).toBe(false);
        picked.add(part.instanceId);
        expect(part.buildStep).toBe(step.stepNumber);
      }
    }
    expect([...picked].sort()).toEqual(ids(compact.model.parts));
    expect(ids(compact.steps.at(-1)!.totalModelState)).toEqual(ids(compact.model.parts));
  });

  it('clones and packs an already compact candidate without materializing its snapshots', () => {
    const compact = compactVehicleCandidate(candidate), expected = json(compact);
    for (const step of compact.steps) {
      for (const key of ['addedParts', 'totalModelState'] as const) {
        Object.defineProperty(step, key, { enumerable: true, get: () => { throw new Error('snapshot unexpectedly materialized'); } });
      }
    }
    expect(json(compactVehicleCandidate(compact))).toEqual(expected);
    expect(json(unpackCandidateSteps(packCandidateSteps(compact)))).toEqual(expected);
  });
});

describe('Speed part-ID instruction storage codec', () => {
  it('round-trips compact disk JSON and legacy complete snapshots without changing exports', () => {
    const legacy = json(candidate), packed = packCandidateSteps(candidate);
    expect(packed.stepEncoding).toBe('part-ids-v1');
    expect(packed.steps.every(step => !('addedParts' in step) && !('totalModelState' in step))).toBe(true);
    expect(packed.steps.every(step => Array.isArray(step.addedPartIds) && Array.isArray(step.statePartIds))).toBe(true);
    const restored = unpackCandidateSteps(json(packed));
    expect(json(restored)).toEqual(legacy);
    expect(json(unpackCandidateSteps(legacy))).toEqual(legacy);
    expect('stepEncoding' in json(restored)).toBe(false);
    expect(JSON.stringify(packed).length).toBeLessThan(JSON.stringify(legacy).length * 0.2);
  });

  it.each(['addedPartIds', 'statePartIds'] as const)('rejects unknown and duplicate IDs in %s', key => {
    const unknown = packCandidateSteps(candidate);
    unknown.steps[0][key] = ['missing-part'];
    expect(() => unpackCandidateSteps(unknown)).toThrow();
    const duplicate = packCandidateSteps(candidate), id = duplicate.model.parts[0].instanceId;
    duplicate.steps[0][key] = [id, id];
    expect(() => unpackCandidateSteps(duplicate)).toThrow();
  });

  it('rejects duplicate model IDs, invalid orientations and unreasonable part/step counts', () => {
    const duplicate = packCandidateSteps(candidate);
    duplicate.model.parts[1].instanceId = duplicate.model.parts[0].instanceId;
    expect(() => unpackCandidateSteps(duplicate)).toThrow();
    const invalidStep = packCandidateSteps(candidate);
    invalidStep.steps[0].orientation.x = 45 as 0;
    expect(() => unpackCandidateSteps(invalidStep)).toThrow();
    const invalidPart = packCandidateSteps(candidate);
    invalidPart.model.parts[0].orientation.y = Number.POSITIVE_INFINITY as 0;
    expect(() => unpackCandidateSteps(invalidPart)).toThrow();
    const tooManyParts = packCandidateSteps(candidate);
    tooManyParts.model.parts = Array.from({ length: 1001 }, (_, index) => ({ ...tooManyParts.model.parts[0], instanceId: `oversized-${index}` }));
    expect(() => unpackCandidateSteps(tooManyParts)).toThrow();
    const tooManySteps = packCandidateSteps(candidate);
    tooManySteps.steps = Array.from({ length: 10001 }, (_, index) => ({ ...tooManySteps.steps[0], stepNumber: index + 1 }));
    expect(() => unpackCandidateSteps(tooManySteps)).toThrow();
  });

  it('rejects unknown encodings and invalid references in legacy snapshots', () => {
    const unsupported = { ...packCandidateSteps(candidate), stepEncoding: 'part-ids-v99' };
    expect(() => unpackCandidateSteps(unsupported)).toThrow();
    const unknown = json(candidate);
    unknown.steps[0].addedParts[0].instanceId = 'missing-part';
    expect(() => unpackCandidateSteps(unknown)).toThrow();
    const duplicate = json(candidate);
    duplicate.steps[0].totalModelState.push(json(duplicate.steps[0].totalModelState[0]));
    expect(() => unpackCandidateSteps(duplicate)).toThrow();
  });

  it('rejects repeated picking, unbuilt attachments, incomplete states and inconsistent build steps', () => {
    const repeated = packCandidateSteps(candidate);
    const firstPick = repeated.steps.find(step => step.type === 'build')!;
    const laterPick = repeated.steps.find(step => step.type === 'build' && step.stepNumber > firstPick.stepNumber)!;
    laterPick.addedPartIds[0] = firstPick.addedPartIds[0];
    expect(() => unpackCandidateSteps(repeated)).toThrow();
    const unbuilt = packCandidateSteps(candidate);
    unbuilt.steps.find(step => step.type === 'attach')!.subAssemblyId = 'never-built-subassembly';
    expect(() => unpackCandidateSteps(unbuilt)).toThrow();
    const incomplete = packCandidateSteps(candidate);
    incomplete.steps.at(-1)!.statePartIds.shift();
    expect(() => unpackCandidateSteps(incomplete)).toThrow();
    const wrongBuildStep = packCandidateSteps(candidate);
    wrongBuildStep.model.parts[0].buildStep = wrongBuildStep.model.parts[0].buildStep === 1 ? 2 : 1;
    expect(() => unpackCandidateSteps(wrongBuildStep)).toThrow();
  });
});
