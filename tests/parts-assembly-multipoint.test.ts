import { beforeAll, describe, expect, it } from 'vitest';
import { NativePartRepository } from '../src/parts/assembly/source.js';
import { AttachmentEngine } from '../src/parts/assembly/engine.js';
import { checkMultiPointConnection, physicalConnectionGroups, physicalConnectionKey, validateConnectionOccupancy } from '../src/parts/assembly/multipoint.js';
import { axisRotation, distance, IDENTITY_TRANSFORM, inverseTransform, transformPoint } from '../src/parts/assembly/math.js';
import { STANDARD_STUD_RULE_ID } from '../src/parts/assembly/compatibility.js';
import type { AssemblyInterfaceCapability, NativeAssemblyPart, NativePlacement, RigidTransform } from '../src/parts/assembly/types.js';

const repository = new NativePartRepository();
const parts = new Map<string, NativeAssemblyPart>();
beforeAll(async () => { for (const id of ['3001', '3020', '3023b', '3005', '3024', '87087']) parts.set(id, (await repository.getPart(id))!); });
const part = (id: string) => parts.get(id)!;
const placement = (id: string, instanceId = 'root', transform: RigidTransform = IDENTITY_TRANSFORM): NativePlacement => ({ partId: id, instanceId, transform });
const engine = () => new AttachmentEngine({ mode: 'verification', loadPart: (id) => repository.getPart(id) });
const sourcePoint = (id: string, gender: 'M' | 'F', x: number, z = 0) => part(id).connections.points.find((point) => point.gender === gender && point.sections[0]?.radius === 6 && point.position[0] === x && point.position[2] === z)!;

describe('native multi-point consistency', () => {
  it('uses one shared rigid transform for all real 2x4 stud/underside pairs at four discrete rotations', () => {
    for (const [degrees, expected] of [[0, 8], [90, 4], [180, 8], [270, 4]]) {
      const transform: RigidTransform = { rotation: axisRotation([0, -1, 0], degrees), translation: [0, -8, 0] };
      const result = checkMultiPointConnection({ fixedPart: part('3001'), fixedPlacement: placement('3001'), movingPart: part('3020'), movingPlacement: placement('3020', 'plate', transform) });
      expect(result.status).toBe('consistent'); expect(result.matches).toHaveLength(expected);
      for (const match of result.matches) {
        expect(distance(match.candidate.transform.translation, transform.translation)).toBeLessThan(1e-5);
        match.candidate.transform.rotation.forEach((value, index) => expect(value).toBeCloseTo(transform.rotation[index], 6));
      }
    }
  });

  it('rejects half-stud displacement of the selected mate and coincident anchors with a non-quarter-turn frame disagreement', () => {
    const fixedPart = part('3023b'), movingPart = part('3023b'), fixed = sourcePoint('3023b', 'M', -10), moving = sourcePoint('3023b', 'F', -10);
    const half = checkMultiPointConnection({ fixedPart, fixedPlacement: placement('3023b'), movingPart, movingPlacement: placement('3023b', 'half-stud', { rotation: IDENTITY_TRANSFORM.rotation, translation: [10, -8, 0] }), preferredFixedConnectionId: fixed.id, preferredMovingConnectionId: moving.id, requirePreferredPair: true });
    expect(half.status).toBe('blocked'); expect(half.issues.some((issue) => issue.code === 'missing-requested-mate')).toBe(true);
    const rotated = axisRotation([0, -1, 0], 45), rotatedAnchor = transformPoint({ rotation: rotated, translation: [0, 0, 0] }, moving.position);
    const translation = fixed.position.map((value, axis) => value - rotatedAnchor[axis]) as [number, number, number];
    const disagreement = checkMultiPointConnection({ fixedPart, fixedPlacement: placement('3023b'), movingPart, movingPlacement: placement('3023b', 'wrong-angle', { rotation: rotated, translation }), preferredFixedConnectionId: fixed.id, preferredMovingConnectionId: moving.id, requirePreferredPair: true });
    expect(disagreement.status).toBe('blocked'); expect(disagreement.issues.some((issue) => issue.code === 'rotation-disagreement')).toBe(true);
  });

  it('certifies the formerly partition-limited native pair with all eight mates and full solid proof', async () => {
    const geometryCheck = checkMultiPointConnection({ fixedPart: part('3001'), fixedPlacement: placement('3001'), movingPart: part('3020'), movingPlacement: placement('3020', 'plate', { rotation: IDENTITY_TRANSFORM.rotation, translation: [0, -8, 0] }) });
    expect(geometryCheck.matches).toHaveLength(8);
    const first = geometryCheck.matches[0], assemblyEngine = engine(), seed = await assemblyEngine.createAssembly('3001');
    const result = await assemblyEngine.attachPart(seed, { anchorInstanceId: 'root', anchorConnectionId: first.fixedConnectionId, partId: '3020', candidateConnectionId: first.movingConnectionId, twistDegrees: first.candidate.twistDeg });
    expect(result.accepted).toBe(true); expect(result.graph.placements).toHaveLength(2); expect(result.graph.edges).toHaveLength(8);
    expect(result.collision?.proof.completeSurfacePartition).toBe(true);
    expect(result.collision?.proof.wholePairExempted).toBe(false);
    expect((await assemblyEngine.validateGraph(result.graph)).valid).toBe(true);
    const omitted = structuredClone(result.graph); omitted.edges.pop();
    expect((await assemblyEngine.validateGraph(omitted)).valid).toBe(false);
  });

  it('records two actual physical mating edges in a clear native two-stud attachment, rejects omission and duplicate aliases', async () => {
    const assemblyEngine = engine(), seed = await assemblyEngine.createAssembly('3023b'), fixed = sourcePoint('3023b', 'M', -10), moving = sourcePoint('3023b', 'F', -10);
    const result = await assemblyEngine.attachPart(seed, { anchorInstanceId: 'root', anchorConnectionId: fixed.id, partId: '3023b', candidateConnectionId: moving.id, twistDegrees: 0 });
    expect(result.accepted).toBe(true); expect(result.graph.placements).toHaveLength(2); expect(result.graph.edges).toHaveLength(2);
    expect((await assemblyEngine.validateGraph(result.graph)).valid).toBe(true);
    const omitted = structuredClone(result.graph); omitted.edges.pop();
    expect(await assemblyEngine.validateGraph(omitted)).toMatchObject({ valid: false, issues: expect.arrayContaining(['Graph omits a real supported coincident multi-point connection.']) });
    const duplicated = structuredClone(result.graph); duplicated.edges.push({ ...duplicated.edges[0], id: 'duplicate-source-edge' });
    expect((await assemblyEngine.validateGraph(duplicated)).valid).toBe(false);
    expect(validateConnectionOccupancy(duplicated.edges, new Map([['root', part('3023b')], [duplicated.placements[1].instanceId, part('3023b')]])).valid).toBe(false);
  });

  it('finds the equivalent inverse physical mating set when fixed and moving parts are swapped', () => {
    const source = part('3023b'), forwardPose: RigidTransform = { rotation: axisRotation([0, -1, 0], 180), translation: [0, -8, 0] };
    const forward = checkMultiPointConnection({ fixedPart: source, fixedPlacement: placement('3023b', 'a'), movingPart: source, movingPlacement: placement('3023b', 'b', forwardPose) });
    const reverse = checkMultiPointConnection({ fixedPart: source, fixedPlacement: placement('3023b', 'b'), movingPart: source, movingPlacement: placement('3023b', 'a', inverseTransform(forwardPose)) });
    expect(forward.matches).toHaveLength(2); expect(reverse.matches).toHaveLength(2);
    expect(new Set(forward.matches.map((match) => `${match.fixedPhysicalKey}/${match.movingPhysicalKey}`))).toEqual(new Set(reverse.matches.map((match) => `${match.movingPhysicalKey}/${match.fixedPhysicalKey}`)));
  });

  it('records a new bridge joining two existing brick neighbors in one solver-derived attachment', async () => {
    const assemblyEngine = engine(); let graph = await assemblyEngine.createAssembly('3023b');
    for (const x of [-10, 10]) {
      const attached = await assemblyEngine.attachPart(graph, { anchorInstanceId: 'root', anchorConnectionId: sourcePoint('3023b', 'M', x).id, partId: '3005', candidateConnectionId: sourcePoint('3005', 'F', 0).id, twistDegrees: 0 });
      expect(attached.accepted).toBe(true); graph = attached.graph;
    }
    const brick = graph.placements[1], result = await assemblyEngine.attachPart(graph, { anchorInstanceId: brick.instanceId, anchorConnectionId: sourcePoint('3005', 'M', 0).id, partId: '3023b', candidateConnectionId: sourcePoint('3023b', 'F', -10).id, twistDegrees: 90 });
    expect(result.accepted).toBe(true); expect(result.graph.placements).toHaveLength(4); expect(result.graph.edges).toHaveLength(4);
    const addedId = result.graph.placements.at(-1)!.instanceId, addedEdges = result.graph.edges.filter((edge) => edge.movingInstanceId === addedId);
    expect(addedEdges).toHaveLength(2); expect(new Set(addedEdges.map((edge) => edge.fixedInstanceId)).size).toBe(2);
    expect((await assemblyEngine.validateGraph(result.graph)).valid).toBe(true);
  });

  it('fails closed when a second engaged ordinary source interface is outside the production allowlist', async () => {
    const source = part('3023b'), physical = physicalConnectionGroups(source);
    expect(physical.filter((group) => group.points[0].gender === 'F' && group.points[0].sections[0]?.radius === 6)).toHaveLength(2);
    // TEST-ONLY admission provider for exercising the gate. It is not a saved
    // production verification claim and never replaces the real source geometry.
    const capability: AssemblyInterfaceCapability = { partId: '3023b', assemblyVerified: true, generatable: true, allowedConnectionIds: source.connections.points.map((point) => point.id), ruleIds: [STANDARD_STUD_RULE_ID], reasonCodes: [], reasons: ['TEST-ONLY admission boundary fixture.'] };
    const denied = sourcePoint('3023b', 'F', 10);
    capability.allowedConnectionIds = capability.allowedConnectionIds.filter((id) => physicalConnectionKey(source.connections.points.find((point) => point.id === id)!) !== physicalConnectionKey(denied));
    const assemblyEngine = new AttachmentEngine({ mode: 'production', loadPart: (id) => repository.getPart(id), getCapability: () => capability });
    const seed = await assemblyEngine.createAssembly('3023b'), result = await assemblyEngine.attachPart(seed, { anchorInstanceId: 'root', anchorConnectionId: sourcePoint('3023b', 'M', -10).id, partId: '3023b', candidateConnectionId: sourcePoint('3023b', 'F', -10).id, twistDegrees: 0 });
    expect(result.accepted).toBe(false); expect(result.graph.placements).toHaveLength(1);
    expect(result.rejections.some((rejection) => rejection.code === 'multi-point-interface-blocked')).toBe(true);
  });
});
