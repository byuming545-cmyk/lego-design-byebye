import { beforeAll, describe, expect, it } from 'vitest';
import { AttachmentEngine } from '../src/parts/assembly/engine.js';
import { NativePartRepository } from '../src/parts/assembly/source.js';
import { STANDARD_STUD_RULE_ID } from '../src/parts/assembly/compatibility.js';
import type { AssemblyInterfaceCapability, NativeAssembly, NativeAssemblyPart } from '../src/parts/assembly/types.js';
import type { ImportedConnectionPoint } from '../src/parts/connections/types.js';

const repository = new NativePartRepository();
const parts = new Map<string, NativeAssemblyPart>();
beforeAll(async () => {
  for (const partId of ['3001', '3005', '3024', '4624', '3641']) parts.set(partId, (await repository.getPart(partId))!);
});
const part = (id: string) => parts.get(id)!;
function endpoint(id: string, gender: 'M' | 'F', predicate: (point: ImportedConnectionPoint) => boolean = () => true) {
  const point = part(id).connections.points.find((point) => point.gender === gender && predicate(point));
  if (!point) throw new Error(`No actual source endpoint ${id}/${gender}`);
  return point;
}
const male = (id: string) => endpoint(id, 'M', (point) => point.sourceId === 'studC');
const female = (id: string) => endpoint(id, 'F', (point) => point.sections[0]?.radius === 6);
const verificationEngine = () => new AttachmentEngine({ loadPart: (id) => repository.getPart(id), mode: 'verification' });

/**
 * TEST-ONLY admission provider: it exercises the production engine's rejection
 * boundary using actual immutable native source parts. These provisional flags
 * are not persisted, presented as actual verification, or consumed by runtime.
 */
function provisionalProduction() {
  const capabilities = new Map<string, AssemblyInterfaceCapability>([...parts.values()].map((source) => [source.partId, {
    partId: source.partId, assemblyVerified: true, generatable: true,
    allowedConnectionIds: source.connections.points.map((point) => point.id),
    ruleIds: [STANDARD_STUD_RULE_ID], reasonCodes: [], reasons: ['TEST-ONLY provisional admission, not an actual source verification report.'],
  }]));
  const engine = new AttachmentEngine({ loadPart: (id) => repository.getPart(id), getCapability: (id) => capabilities.get(id), mode: 'production' });
  return { engine, capabilities };
}
async function stack(engine: AttachmentEngine) {
  const seed = await engine.createAssembly('3001');
  const result = await engine.attachPart(seed, { anchorInstanceId: 'root', anchorConnectionId: male('3001').id, partId: '3024', candidateConnectionId: female('3024').id, twistDegrees: 0 });
  expect(result.accepted).toBe(true);
  return { seed, result, graph: result.graph };
}

describe('native attachment graph and production admission', () => {
  it('loads immutable real source objects and refuses invented root parts', async () => {
    expect(Object.isFrozen(part('3001'))).toBe(true);
    expect(Object.isFrozen(part('3001').geometry.mesh!.positions[0])).toBe(true);
    expect(Object.isFrozen(part('3001').connections.points[0].properties)).toBe(true);
    expect(await repository.getPart('made-up-part')).toBeUndefined();
    await expect(verificationEngine().createAssembly('made-up-part')).rejects.toThrow('Unknown source part');
  });

  it('accepts a genuine solved native attachment without mutating its input graph', async () => {
    const engine = verificationEngine(), { seed, result, graph } = await stack(engine);
    expect(seed.placements).toHaveLength(1);
    expect(seed.edges).toHaveLength(0);
    expect(graph.placements).toHaveLength(2);
    expect(graph.edges).toHaveLength(1);
    expect(graph.sourceHashes['3024']).toMatch(/^[a-f0-9]{64}$/);
    expect(graph.physicalBuildVerified).toBe(false);
    expect(result.debug?.insertionPathVerification).toBe('source-axis-seating-path');
    expect(result.collision?.proof.wholePairExempted).toBe(false);
    expect(await engine.validateGraph(graph)).toEqual({ valid: true, issues: [] });
  });

  it('requires production admission and an explicit port/rule whitelist', async () => {
    expect(() => new AttachmentEngine({ loadPart: (id) => repository.getPart(id) })).toThrow('requires a verified interface');
    for (const flags of [{ assemblyVerified: false, generatable: true }, { assemblyVerified: true, generatable: false }]) {
      const { engine, capabilities } = provisionalProduction();
      Object.assign(capabilities.get('3001')!, flags);
      await expect(engine.createAssembly('3001')).rejects.toThrow('verification');
    }
    const { engine, capabilities } = provisionalProduction(), seed = await engine.createAssembly('3001');
    capabilities.get('3024')!.allowedConnectionIds = [male('3024').id];
    const deniedPort = await engine.attachPart(seed, { anchorInstanceId: 'root', anchorConnectionId: male('3001').id, partId: '3024', candidateConnectionId: female('3024').id });
    expect(deniedPort.accepted).toBe(false);
    expect(deniedPort.rejections.some((rejection) => rejection.code === 'part-or-interface-blocked')).toBe(true);
    capabilities.get('3024')!.allowedConnectionIds = [female('3024').id];
    capabilities.get('3024')!.ruleIds = [];
    const deniedRule = await engine.attachPart(seed, { anchorInstanceId: 'root', anchorConnectionId: male('3001').id, partId: '3024', candidateConnectionId: female('3024').id });
    expect(deniedRule.accepted).toBe(false);
    expect(deniedRule.rejections.some((rejection) => rejection.code === 'rule-scope-blocked')).toBe(true);
    expect(seed.placements).toHaveLength(1);
  });

  it('refuses an admission record belonging to another native part', async () => {
    const { engine, capabilities } = provisionalProduction();
    capabilities.get('3001')!.partId = '3005';
    await expect(engine.createAssembly('3001')).rejects.toThrow();
  });

  it('does not convert a matching wheel/tyre source group into an enabled mechanical rule', async () => {
    const engine = verificationEngine(), seed = await engine.createAssembly('4624');
    const rim = endpoint('4624', 'M', (point) => point.kind === 'generic'), tyre = endpoint('3641', 'F', (point) => point.kind === 'generic');
    expect(rim.group).toBe(tyre.group);
    const result = await engine.attachPart(seed, { anchorInstanceId: 'root', anchorConnectionId: rim.id, partId: '3641', candidateConnectionId: tyre.id });
    expect(result.accepted).toBe(false);
    expect(result.compatibility?.status).toBe('unknown');
    expect(result.rejections.some((rejection) => rejection.code === 'grouped-interface-seating-unresolved')).toBe(true);
    expect(seed.placements).toHaveLength(1);
  });

  it('rejects occupied anchors before trying any second physical placement', async () => {
    const engine = verificationEngine(), { graph } = await stack(engine);
    const denied = await engine.attachPart(graph, { anchorInstanceId: 'root', anchorConnectionId: male('3001').id, partId: '3005', candidateConnectionId: female('3005').id });
    expect(denied.accepted).toBe(false);
    expect(denied.rejections[0].code).toBe('endpoint-occupied');
    expect(denied.graph).toBe(graph);
  });

  it('treats duplicate source records for one physical socket as the same occupied endpoint', async () => {
    const engine = verificationEngine(), seed = await engine.createAssembly('3024');
    const aliases = part('3024').connections.points.filter((point) => point.gender === 'F' && point.sections[0]?.radius === 6);
    expect(aliases.length).toBeGreaterThanOrEqual(2);
    expect(aliases[0].position).toEqual(aliases[1].position);
    expect(aliases[0].id).not.toBe(aliases[1].id);
    const first = await engine.attachPart(seed, { anchorInstanceId: 'root', anchorConnectionId: aliases[0].id, partId: '3005', candidateConnectionId: male('3005').id, twistDegrees: 0 });
    expect(first.accepted).toBe(true);
    const second = await engine.attachPart(first.graph, { anchorInstanceId: 'root', anchorConnectionId: aliases[1].id, partId: '3005', candidateConnectionId: male('3005').id, twistDegrees: 0 });
    expect(second.accepted).toBe(false);
    expect(second.rejections[0].code).toBe('endpoint-occupied');
  });

  it('invalidates altered versions, source hashes, disconnected placements and edge fields', async () => {
    const engine = verificationEngine(), { graph } = await stack(engine);
    const changes: ((graph: NativeAssembly) => void)[] = [
      (changed) => { changed.connectionRuleVersion = 'forged-rule'; },
      (changed) => { changed.sourceHashes['3001'] = '0'.repeat(64); },
      (changed) => { changed.placements[1].transform.translation[0] += 0.25; },
      (changed) => { changed.edges = []; },
    ];
    for (const mutate of changes) {
      const changed = structuredClone(graph); mutate(changed);
      expect((await engine.validateGraph(changed)).valid).toBe(false);
    }
  });

  it('refuses forged physical verification and finite-vector/depth omissions', async () => {
    const engine = verificationEngine(), { graph } = await stack(engine);
    const labels = structuredClone(graph) as unknown as Record<string, unknown>;
    labels.physicalBuildVerified = true;
    expect((await engine.validateGraph(labels as unknown as NativeAssembly)).valid).toBe(false);
    for (const field of ['axis', 'anchor', 'insertionDepthLdu'] as const) {
      const changed = structuredClone(graph);
      delete (changed.edges[0] as unknown as Record<string, unknown>)[field];
      await expect(engine.validateGraph(changed)).resolves.toMatchObject({ valid: false });
    }
    const invalid = structuredClone(graph);
    invalid.edges[0].axis = [] as unknown as [number, number, number];
    await expect(engine.validateGraph(invalid)).resolves.toMatchObject({ valid: false });
  });

  it('rechecks admission for existing non-anchor parts after a capability is revoked', async () => {
    const { engine, capabilities } = provisionalProduction(), { graph } = await stack(engine);
    capabilities.get('3024')!.generatable = false;
    const otherStud = part('3001').connections.points.find((point) => point.sourceId === 'studC' && point.id !== male('3001').id)!;
    const result = await engine.attachPart(graph, { anchorInstanceId: 'root', anchorConnectionId: otherStud.id, partId: '3005', candidateConnectionId: female('3005').id, twistDegrees: 0 });
    expect(result.accepted).toBe(false);
    expect((await engine.validateGraph(graph)).valid).toBe(false);
    expect(graph.placements).toHaveLength(2);
  });

  it('rechecks source binding on a previously accepted graph even when the changed part is not the new anchor', async () => {
    const views = new Map(parts);
    const engine = new AttachmentEngine({ loadPart: async (id) => views.get(id), mode: 'verification' });
    const { graph } = await stack(engine);
    // Corrupt source evidence on a clone of an actual native part. This is a
    // rejection fixture; the corrupt claim is never a source of native geometry.
    const corruptedEvidence = structuredClone(part('3024'));
    corruptedEvidence.geometry.source.files[0].sha256 = '0'.repeat(64);
    views.set('3024', corruptedEvidence);
    const otherStud = part('3001').connections.points.find((point) => point.sourceId === 'studC' && point.id !== male('3001').id)!;
    const result = await engine.attachPart(graph, { anchorInstanceId: 'root', anchorConnectionId: otherStud.id, partId: '3005', candidateConnectionId: female('3005').id, twistDegrees: 0 });
    expect(result.accepted).toBe(false);
    expect(result.rejections.some((rejection) => rejection.code === 'graph-source-changed' || rejection.code === 'invalid-graph')).toBe(true);
    expect(graph.placements).toHaveLength(2);
  });
});
