import { describe, it, expect } from 'vitest';
import { NativePartRepository } from '../src/parts/assembly/source.js';
import { checkNativePairCollision } from '../src/parts/assembly/collision.js';
import { solveAttachment } from '../src/parts/assembly/solver.js';
import { IDENTITY_TRANSFORM, axisRotation, composeTransforms } from '../src/parts/assembly/math.js';
import { checkMultiPointConnection } from '../src/parts/assembly/multipoint.js';

describe('spatially local native surface partitions', () => {
  const repository = new NativePartRepository();
  it('handles another large native plate pair at all source quarter turns', async () => {
    const a = (await repository.getPart('3020'))!;
    const male = a.connections.points.find(point => point.gender === 'M')!;
    const female = a.connections.points.find(point => point.gender === 'F' && point.position[0] === male.position[0] && point.position[2] === male.position[2])!;
    const fixed = { partId: a.partId, instanceId: 'a', transform: IDENTITY_TRANSFORM };
    const solved = solveAttachment({ fixedPart: a, fixedPlacement: fixed, fixedConnectionId: male.id, movingPart: a, movingConnectionId: female.id });
    expect(solved.candidates).toHaveLength(4);
    for (const candidate of solved.candidates) {
      const result = checkNativePairCollision(a, fixed, a, { partId: a.partId, instanceId: 'b', transform: candidate.transform }, candidate.penetrationZone);
      expect(result.status, result.reason).toBe('clear');
      expect(result.proof.wholePairExempted).toBe(false);
    }
  });
  it('certifies a complete multi-stud pair and the reverse query without a part exception', async () => {
    const a = (await repository.getPart('3020'))!, b = (await repository.getPart('3710'))!;
    const fixed = { partId: a.partId, instanceId: 'a', transform: IDENTITY_TRANSFORM };
    const candidate = solveAttachment({ fixedPart: a, fixedPlacement: fixed, fixedConnectionId: 'p/stud.dat:8:0', movingPart: b, movingConnectionId: 'parts/3710.dat:8:7', twistsDeg: [180] }).candidates[0];
    const moving = { partId: b.partId, instanceId: 'b', transform: candidate.transform };
    const result = checkNativePairCollision(a, fixed, b, moving, candidate.penetrationZone);
    expect(result.status).toBe('clear');
    expect(result.spatialPartitionFallbacks).toBeGreaterThan(0);
    expect(result.proof.completeSurfacePartition).toBe(true);
    expect(result.proof.wholePairExempted).toBe(false);
    expect(checkMultiPointConnection({ fixedPart: a, fixedPlacement: fixed, movingPart: b, movingPlacement: moving }).matches.length).toBeGreaterThan(1);
    expect(checkNativePairCollision(b, moving, a, fixed).status).toBe('clear');
    const world = { rotation: axisRotation([0, 1, 0], 90), translation: [80, 24, -40] as [number, number, number] };
    expect(checkNativePairCollision(a, { ...fixed, transform: composeTransforms(world, fixed.transform) }, b, { ...moving, transform: composeTransforms(world, moving.transform) }).status).toBe('clear');
  });
  it.each([0, 1])('rejects actual plastic intrusion on axis %s despite the seating envelope', async axis => {
    const a = (await repository.getPart('3020'))!, b = (await repository.getPart('3710'))!;
    const fixed = { partId: a.partId, instanceId: 'a', transform: IDENTITY_TRANSFORM };
    const candidate = solveAttachment({ fixedPart: a, fixedPlacement: fixed, fixedConnectionId: 'p/stud.dat:8:0', movingPart: b, movingConnectionId: 'parts/3710.dat:8:7', twistsDeg: [180] }).candidates[0];
    const transform = structuredClone(candidate.transform); transform.translation[axis] += 0.5;
    const result = checkNativePairCollision(a, fixed, b, { partId: b.partId, instanceId: 'b', transform }, candidate.penetrationZone);
    expect(result.status).toBe('collision');
    expect(result.classification).toBe('SOLID_SOLID_OVERLAP');
  });
});
