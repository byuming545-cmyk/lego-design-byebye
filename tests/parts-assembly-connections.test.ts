import { beforeAll, describe, expect, it } from 'vitest';
import { createBundledLDrawResolver, LDrawPartImporter } from '../src/parts/ldraw/index.js';
import { createBundledConnectionImporter } from '../src/parts/connections/index.js';
import type { ImportedConnectionPoint } from '../src/parts/connections/types.js';
import type { NativeAssemblyPart, NativePlacement, RigidTransform, Vector3 } from '../src/parts/assembly/types.js';
import { BAR_CLIP_RULE_ID, checkConnectionCompatibility, CONNECTION_RULE_VERSION, STANDARD_STUD_RULE_ID } from '../src/parts/assembly/compatibility.js';
import { solveAttachment, worldConnection } from '../src/parts/assembly/solver.js';
import { checkNativePairCollision } from '../src/parts/assembly/collision.js';
import { isSourceDeclaredBarEndpoint, isSourceDeclaredClipEndpoint } from '../src/parts/grammar/sources.js';
import { axisRotation, composeTransforms, determinant, distance, IDENTITY_TRANSFORM, inverseTransform, isRotation, rotate, transformPoint } from '../src/parts/assembly/math.js';

const parts = new Map<string, NativeAssemblyPart>();
beforeAll(async () => {
  const resolver = await createBundledLDrawResolver(), geometry = new LDrawPartImporter(resolver), connections = createBundledConnectionImporter(resolver);
  for (const partId of ['3001', '3005', '3024', '87087', '99207', '48729b', '30374', '60470b', '2412b', '4624', '3641', '3673', '3700']) parts.set(partId, { partId, geometry: await geometry.importPart(partId), connections: await connections.importPart(partId) });
});
const part = (id: string) => parts.get(id)!;
function endpoint(id: string, gender: 'M' | 'F', predicate: (point: ImportedConnectionPoint) => boolean = () => true) {
  const value = part(id).connections.points.find((point) => point.gender === gender && predicate(point));
  if (!value) throw new Error(`Missing actual source fixture ${id} ${gender}`);
  return value;
}
function place(id: string, transform: RigidTransform = IDENTITY_TRANSFORM): NativePlacement { return { instanceId: `fixture-${id}`, partId: id, transform }; }
function standardMale(id: string) { return endpoint(id, 'M', (point) => point.sourceId === 'studC'); }
function underside(id: string) { return endpoint(id, 'F', (point) => point.sections[0]?.radius === 6); }
function expectCloseVector(actual: Vector3, expected: Vector3) { actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index], 6)); }

describe('source-backed compatibility rule', () => {
  it('uses the actual closed stud and capped underside sections, caps, depth and evidence', () => {
    const checked = checkConnectionCompatibility(standardMale('3001'), underside('3024'));
    expect(checked).toMatchObject({ status: 'compatible', ruleId: STANDARD_STUD_RULE_ID, ruleVersion: CONNECTION_RULE_VERSION, connectionType: 'standard-stud-underside', axisRelation: 'same', insertionDepthLdu: 4, permittedTranslation: 'fully-seated', allowedTwistsDeg: [0, 90, 180, 270] });
    expect(checked.sourceEvidence.filter((source) => source.kind === 'source-directive')).toHaveLength(2);
    expect(checked.sourceEvidence[0].sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(checked.sourceEvidence[1].note).toContain('secs=S 6 4');
  });

  it('supports the sourced round underside of a real 3001 and ignores guessed display family labels', () => {
    const female = underside('3001'), male = standardMale('3005');
    expect(female.sections).toEqual([{ profile: 'R', radius: 6, length: 20 }]);
    expect(checkConnectionCompatibility(male, female).status).toBe('compatible');
    expect(checkConnectionCompatibility({ ...male, family: 'generic' }, { ...female, family: 'generic' }).status).toBe('compatible');
    expect(checkConnectionCompatibility({ ...male, sourceId: null }, female)).toMatchObject({ status: 'unknown', reasonCode: 'standard-stud-identity-unresolved' });
  });

  it('rejects same-gender and source size mismatches without stretching the physical part', () => {
    expect(checkConnectionCompatibility(standardMale('3001'), standardMale('3024'))).toMatchObject({ status: 'incompatible', reasonCode: 'same-mating-gender' });
    const smallHole = endpoint('87087', 'F', (point) => point.sections[0]?.radius === 4);
    expect(checkConnectionCompatibility(standardMale('3001'), smallHole)).toMatchObject({ status: 'incompatible', reasonCode: 'receiver-size-mismatch' });
  });

  it('enables only the source-declared bar/clip family and leaves unrelated pin, wheel/tyre groups closed', () => {
    const clip = endpoint('48729b', 'F'), bar = endpoint('30374', 'M');
    const checked = checkConnectionCompatibility(bar, clip);
    expect(checked).toMatchObject({ status: 'compatible', ruleId: BAR_CLIP_RULE_ID, connectionType: 'bar-clip', axisRelation: 'same', insertionDepthLdu: 8, permittedTranslation: 'sliding', allowedTwistsDeg: [0, 90, 180, 270] });
    expect(checked.sourceEvidence.some((source) => source.kind === 'source-document' && source.note.includes('Bar  4L'))).toBe(true);
    expect(checkConnectionCompatibility(bar, endpoint('60470b', 'F', (point) => point.family === 'clip'))).toMatchObject({ status: 'compatible', ruleId: BAR_CLIP_RULE_ID });
    const unnamedR4 = endpoint('2412b', 'M');
    expect(checkConnectionCompatibility(unnamedR4, clip)).toMatchObject({ status: 'unknown', reasonCode: 'clip-bar-seating-unresolved' });
    const rim = endpoint('4624', 'M', (point) => point.kind === 'generic'), tyre = endpoint('3641', 'F', (point) => point.kind === 'generic');
    expect(rim.group).toBe(tyre.group);
    expect(checkConnectionCompatibility(rim, tyre)).toMatchObject({ status: 'unknown', reasonCode: 'grouped-interface-seating-unresolved' });
    const hole = endpoint('3700', 'F', (point) => point.sourceId === 'connhole');
    expect(checkConnectionCompatibility(standardMale('3001'), hole)).toMatchObject({ status: 'incompatible', reasonCode: 'stud-to-technic-pin-hole-forbidden' });
    expect(checkConnectionCompatibility(hole, standardMale('3001'))).toMatchObject({ status: 'incompatible', reasonCode: 'stud-to-technic-pin-hole-forbidden' });
    // This source pin's L_ shoulder is not parsed; no imaginary male endpoint is added.
    expect(part('3673').connections.points.some((point) => point.gender === 'M')).toBe(false);
    expect(part('3673').connections.issues.some((issue) => issue.code === 'invalid-directive')).toBe(true);
  });

  it('blocks altered source sections, missing provenance, unknown seating and source scaling', () => {
    const male = standardMale('3001'), female = underside('3024');
    expect(checkConnectionCompatibility({ ...male, source: { ...male.source, sha256: '' } }, female).status).toBe('unknown');
    expect(checkConnectionCompatibility(male, { ...female, sections: [{ profile: 'S', radius: 6, length: 2 }] })).toMatchObject({ status: 'unknown', reasonCode: 'source-sections-unresolved' });
    expect(checkConnectionCompatibility(male, { ...female, properties: { ...female.properties, center: 'true' } })).toMatchObject({ status: 'unknown', reasonCode: 'receiver-seating-unresolved' });
    expect(checkConnectionCompatibility({ ...male, dimensionsResolved: false }, female)).toMatchObject({ status: 'unknown', reasonCode: 'unresolved-connection-frame' });
  });
});

describe('open-surface Bar/Clip collision proof', () => {
  const bar = () => part('30374').connections.points.find(isSourceDeclaredBarEndpoint)!;
  const clip = () => part('48729b').connections.points.find(isSourceDeclaredClipEndpoint)!;
  const solve = (fixedId: string, fixedPoint: ImportedConnectionPoint, movingId: string, movingPoint: ImportedConnectionPoint) => {
    const solved = solveAttachment({ fixedPart: part(fixedId), fixedPlacement: place(fixedId), fixedConnectionId: fixedPoint.id, movingPart: part(movingId), movingConnectionId: movingPoint.id });
    expect(solved.status).toBe('solved');
    return solved.candidates[0];
  };

  it('clears the source seat only and records that no closed-solid certificate exists', () => {
    const candidate = solve('30374', bar(), '48729b', clip());
    const result = checkNativePairCollision(part('30374'), place('30374'), part('48729b'), { ...place('48729b'), transform: candidate.transform }, candidate.penetrationZone);
    expect(result).toMatchObject({ status: 'clear', reasonCode: 'open-surface-seat-clearance', classification: 'OPEN_SURFACE_SEAT_CLEARANCE' });
    expect(result.proof).toMatchObject({ openSourceSurfaces: true, openSurfaceSeatChecked: true, closedSourceProxies: false, completeSurfacePartition: false, containmentChecked: false, wholePairExempted: false });
  });

  it('rejects the real 60470b plate/bar overlap instead of exempting the whole open pair', () => {
    const candidate = solve('30374', bar(), '60470b', endpoint('60470b', 'F', (point) => point.family === 'clip'));
    const result = checkNativePairCollision(part('30374'), place('30374'), part('60470b'), { ...place('60470b'), transform: candidate.transform }, candidate.penetrationZone);
    expect(result).toMatchObject({ status: 'collision', reasonCode: 'open-surface-contact-outside-seat', classification: 'OPEN_SURFACE_SEAT_OVERLAP' });
  });

  it('refuses two open shells because no closed counterpart exists', () => {
    const result = checkNativePairCollision(part('48729b'), place('48729b'), part('60470b'), place('60470b'));
    expect(result).toMatchObject({ status: 'blocked', reasonCode: 'open-surface-pair-unresolved', proof: { openSourceSurfaces: true, closedSourceProxies: false } });
  });
});

describe('native attachment transform solver', () => {
  it('seats an actual 3024 over a 3001 stud, aligning both source directions rather than flipping genders', () => {
    const male = standardMale('3001'), female = underside('3024');
    const solved = solveAttachment({ fixedPart: part('3001'), fixedPlacement: place('3001'), fixedConnectionId: male.id, movingPart: part('3024'), movingConnectionId: female.id, twistsDeg: [0] });
    expect(solved.status).toBe('solved');
    expect(solved.candidates).toHaveLength(1);
    const candidate = solved.candidates[0];
    expect(candidate.transform.rotation).toEqual(IDENTITY_TRANSFORM.rotation);
    expectCloseVector(candidate.transform.translation, [male.position[0], -8, male.position[2]]);
    expectCloseVector(worldConnection(female, candidate.transform).position, male.position);
    expectCloseVector(worldConnection(female, candidate.transform).direction, male.direction);
    expectCloseVector(candidate.insertionDirection, [0, 1, 0]);
    expectCloseVector(candidate.insertionPath[0], [male.position[0], -4, male.position[2]]);
    expectCloseVector(candidate.penetrationZone.center, [male.position[0], -2, male.position[2]]);
    expect(candidate.penetrationZone).toMatchObject({ radius: 6, depth: 4, toleranceLdu: 0.0001, ruleId: STANDARD_STUD_RULE_ID });
  });

  it('seats the source-declared 30374 Bar in the source-declared 48729b Clip with four discrete candidates', () => {
    const bar = part('30374').connections.points.find(isSourceDeclaredBarEndpoint)!, clip = part('48729b').connections.points.find(isSourceDeclaredClipEndpoint)!;
    const solved = solveAttachment({ fixedPart: part('30374'), fixedPlacement: place('30374'), fixedConnectionId: bar.id, movingPart: part('48729b'), movingConnectionId: clip.id });
    expect(solved.status).toBe('solved');
    expect(solved.candidates.map((candidate) => candidate.twistDeg)).toEqual([0, 90, 180, 270]);
    for (const candidate of solved.candidates) {
      expectCloseVector(worldConnection(clip, candidate.transform).position, bar.position);
      expectCloseVector(worldConnection(clip, candidate.transform).direction, bar.direction);
    }
  });

  it('returns only four proper grid-preserving rotations with unchanged native geometry', () => {
    const fixed = part('3001'), moving = part('3024'), before = JSON.stringify(moving.geometry.mesh);
    const result = solveAttachment({ fixedPart: fixed, fixedPlacement: place('3001'), fixedConnectionId: standardMale('3001').id, movingPart: moving, movingConnectionId: underside('3024').id });
    expect(result.candidates.map((candidate) => candidate.twistDeg)).toEqual([0, 90, 180, 270]);
    for (const candidate of result.candidates) {
      expect(isRotation(candidate.transform.rotation)).toBe(true);
      expect(determinant(candidate.transform.rotation)).toBeCloseTo(1, 8);
      expectCloseVector(transformPoint(candidate.transform, underside('3024').position), candidate.anchor);
    }
    expect(JSON.stringify(moving.geometry.mesh)).toBe(before);
  });

  it('handles real side-stud and mirrored bracket source frames with proper placement rotations', () => {
    for (const id of ['87087', '99207']) {
      const fixed = part(id), side = endpoint(id, 'M', (point) => point.sourceId === 'studO' && point.direction[2] < -0.9), moving = part('3024'), female = underside('3024');
      const solved = solveAttachment({ fixedPart: fixed, fixedPlacement: place(id), fixedConnectionId: side.id, movingPart: moving, movingConnectionId: female.id });
      expect(solved.status).toBe('solved');
      expect(solved.candidates).toHaveLength(4);
      for (const candidate of solved.candidates) {
        expect(determinant(candidate.transform.rotation)).toBeCloseTo(1, 8);
        expectCloseVector(worldConnection(female, candidate.transform).position, side.position);
        expectCloseVector(worldConnection(female, candidate.transform).direction, side.direction);
      }
    }
  });

  it('preserves attachments under arbitrary proper world rotations and translations', () => {
    const rotation = axisRotation([1, 2, -3], 37), fixedTransform: RigidTransform = { rotation, translation: [111, -27, 59] }, male = standardMale('3001'), female = underside('3024');
    const solved = solveAttachment({ fixedPart: part('3001'), fixedPlacement: place('3001', fixedTransform), fixedConnectionId: male.id, movingPart: part('3024'), movingConnectionId: female.id });
    expect(solved.candidates).toHaveLength(4);
    for (const candidate of solved.candidates) {
      expectCloseVector(worldConnection(female, candidate.transform).position, transformPoint(fixedTransform, male.position));
      expectCloseVector(worldConnection(female, candidate.transform).direction, rotate(rotation, male.direction));
    }
  });

  it('produces the inverse relation when the same real attachment is solved in reverse', () => {
    const male = standardMale('3001'), female = underside('3024');
    const forward = solveAttachment({ fixedPart: part('3001'), fixedPlacement: place('3001'), fixedConnectionId: male.id, movingPart: part('3024'), movingConnectionId: female.id });
    const reverse = solveAttachment({ fixedPart: part('3024'), fixedPlacement: place('3024'), fixedConnectionId: female.id, movingPart: part('3001'), movingConnectionId: male.id });
    expect(forward.candidates).toHaveLength(4);
    for (const candidate of forward.candidates) {
      const inverse = inverseTransform(candidate.transform);
      const counterpart = reverse.candidates.find((other) => other.transform.rotation.every((value, index) => Math.abs(value - inverse.rotation[index]) < 1e-6) && distance(other.transform.translation, inverse.translation) < 1e-6);
      expect(counterpart).toBeDefined();
      const identity = composeTransforms(candidate.transform, counterpart!.transform);
      expectCloseVector(identity.translation, [0, 0, 0]);
      identity.rotation.forEach((value, index) => expect(value).toBeCloseTo(IDENTITY_TRANSFORM.rotation[index], 7));
    }
  });

  it('rejects continuous twists, reflections, mismatched IDs and missing endpoints', () => {
    const request = { fixedPart: part('3001'), fixedPlacement: place('3001'), fixedConnectionId: standardMale('3001').id, movingPart: part('3024'), movingConnectionId: underside('3024').id };
    expect(solveAttachment({ ...request, twistsDeg: [45] }).status).toBe('blocked');
    expect(solveAttachment({ ...request, twistsDeg: [Number.NaN] }).status).toBe('blocked');
    expect(solveAttachment({ ...request, twistsDeg: [] }).status).toBe('blocked');
    expect(solveAttachment({ ...request, movingConnectionId: 'made-up-connection' }).status).toBe('unknown');
    expect(solveAttachment({ ...request, fixedPlacement: { ...request.fixedPlacement, partId: 'wrong' } }).status).toBe('blocked');
    expect(solveAttachment({ ...request, fixedPlacement: place('3001', { rotation: [-1, 0, 0, 0, 1, 0, 0, 0, 1], translation: [0, 0, 0] }) }).status).toBe('blocked');
  });
});
