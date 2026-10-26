import { beforeAll, describe, expect, it } from 'vitest';
import { NativePartRepository } from '../src/parts/assembly/source.js';
import { add, dot, IDENTITY_ROTATION, IDENTITY_TRANSFORM, isRigidTransform, normalize, rotate, scale, transformPoint } from '../src/parts/assembly/math.js';
import type { RigidTransform } from '../src/parts/assembly/types.js';
import { adaptImportedConnection } from '../src/parts/grammar/sources.js';
import type { Connector, ConnectorFamily, GrammarRuleId } from '../src/parts/grammar/schema.js';
import { CONNECTOR_GRAMMAR_RULES, ConnectorGrammar, evaluateConnectorCompatibility, inspectConnectorSupport } from '../src/parts/grammar/rules.js';
import { solveConnectorPlacement } from '../src/parts/grammar/solver.js';

let stud: Connector, receiver: Connector;
beforeAll(async () => {
  const repository = new NativePartRepository();
  const a = (await repository.getPart('3001'))!, b = (await repository.getPart('3024'))!;
  stud = adaptImportedConnection(a.connections.points.find(point => point.gender === 'M')!);
  receiver = adaptImportedConnection(b.connections.points.find(point => point.gender === 'F')!);
});

// These describe deliberately invented mathematical interfaces exclusively for
// rule-engine tests. They are not LEGO parts, source observations or production
// fit certificates; the default production evaluator rejects their provenance.
function algorithmPair(ruleId: GrammarRuleId, a: ConnectorFamily, b: ConnectorFamily): [Connector, Connector] {
  function feature(family: ConnectorFamily, male: boolean): Connector {
    const sourceId = `test-only-${ruleId}-${male ? 'male' : 'female'}`;
    const profile = family === 'AXLE' || family === 'AXLE_HOLE' ? 'CROSS' : family.includes('BALL') ? 'BALL' : family === 'RAIL' || family === 'GROOVE' ? 'RAIL' : family === 'HINGE_FINGER' ? 'FINGER' : family === 'RIM_SEAT' || family === 'TYRE_SEAT' ? 'SEAT' : 'ROUND';
    const hinge = ['HINGE', 'CLICK_HINGE', 'TURNTABLE'].includes(ruleId);
    const slide = ['BAR_CLIP', 'AXLE_KEYED', 'AXLE_ROUND', 'RAIL_GROOVE'].includes(ruleId);
    const roll = ['BAR_CLIP', 'PIN_HOLE', 'AXLE_ROUND', 'HINGE', 'CLICK_HINGE', 'TURNTABLE', 'BALL_SOCKET', 'TOWBALL_SOCKET', 'WHEEL_MOUNT'].includes(ruleId);
    return {
      featureId: sourceId, sourceConnectionId: null, family, role: male ? 'MALE' : 'FEMALE', units: 'LDU',
      localPositionLdu: [0, 0, 0], localOrientation: [...IDENTITY_ROTATION], axis: [0, -1, 0], profile,
      dimensions: { radiusLdu: 4, lengthLdu: male ? 80 : 8, widthLdu: 8, heightLdu: 8, sections: [{ profile: 'R', radiusLdu: 4, lengthLdu: male ? 80 : 8 }] },
      boundingShape: { kind: 'CYLINDER', dimensionsLdu: [4, male ? 80 : 8] },
      axialSpanLdu: male ? [0, 80] : [0, 8], capStart: true, capEnd: true,
      insertionRangeLdu: [4, 8], slideAllowed: slide, rotationAllowed: roll, symmetryOrder: profile === 'CROSS' ? 4 : null,
      friction: 'LOW', angleLimitsDeg: roll ? (hinge ? [-90, 90] : [-180, 180]) : null,
      detentsDeg: ruleId === 'CLICK_HINGE' ? [-60, -30, 0, 30, 60] : null,
      compatibilityGroup: ruleId === 'GENERIC_GROUP' ? 'synthetic-profile-test' : null,
      occupied: false, contactSurface: null, entryFace: null,
      matchingPolicy: { ruleId, kind: 'VERIFIED_FIT', profileId: 'synthetic-fit-' + ruleId, evidenceSourceIds: [sourceId], axisRelation: 'SAME', seatingOffsetLdu: 0 },
      sources: [{ id: sourceId, kind: 'VERIFIED_MANUAL', reference: 'test-fixture://algorithm-only/' + ruleId, revision: 'algorithm-only-1',
        sha256: 'a'.repeat(64), license: 'test-only-fixture', line: null, raw: 'Invented mathematical test input; not native LEGO evidence.',
        verification: 'VERIFIED', scope: 'ALGORITHM_FIXTURE', notes: ['Not a LEGO fit assertion; production evaluator must reject.'] }],
      confidence: 'VERIFIED', coverage: 'COMPLETE', unknownFields: [], diagnostics: [], notes: ['Synthetic algorithm-only interface.'],
    };
  }
  return [feature(a, true), feature(b, false)];
}
const algorithm = { allowAlgorithmFixtures: true };
/** Independent observation of the final world-space segments, rather than the
 * solver's predicted depth or its local offset-sign formula. */
function actualWorldOverlap(a: Connector, poseA: RigidTransform, b: Connector, poseB: RigidTransform): number {
  const axis = normalize(rotate(poseA.rotation, a.axis))!;
  function worldInterval(feature: Connector, pose: RigidTransform) {
    const values = feature.axialSpanLdu!.map(position => dot(transformPoint(pose, add(feature.localPositionLdu, scale(normalize(feature.axis)!, position))), axis));
    return [Math.min(...values), Math.max(...values)];
  }
  const first = worldInterval(a, poseA), second = worldInterval(b, poseB);
  return Math.max(0, Math.min(first[1], second[1]) - Math.max(first[0], second[0]));
}

describe('interface-first production C01 grammar', () => {
  it('recognises real ordinary stud source without trying any mate or recording a part pairing', () => {
    expect(inspectConnectorSupport(stud)).toEqual({ supported: true, ruleIds: ['C01'], reasonCodes: [] });
    expect(inspectConnectorSupport(receiver).supported).toBe(true);
  });
  it('matches actual source-backed brick/plate connectors as a rigid C01 relation', () => {
    const result = evaluateConnectorCompatibility(stud, receiver);
    expect(result.status).toBe('COMPATIBLE');
    expect(result.ruleId).toBe('C01');
    expect(result.joint).toMatchObject({ type: 'RIGID', translationDof: 0, rotationDof: 0, physicalBuildVerified: false });
    expect(result.allowedAnglesDeg).toEqual([0, 90, 180, 270]);
  });
  it('derives four finite source-frame transforms with exact cardinal quarter turns', () => {
    const solved = solveConnectorPlacement({ fixed: stud, moving: receiver });
    expect(solved.status).toBe('SOLVED');
    expect(solved.candidates).toHaveLength(4);
    for (const candidate of solved.candidates) {
      expect(isRigidTransform(candidate.transform)).toBe(true);
      expect(candidate.transform.rotation.every(Number.isInteger)).toBe(true);
    }
    expect(solved.candidates[0].transform.translation).toEqual([stud.localPositionLdu[0], stud.localPositionLdu[1] - 8, stud.localPositionLdu[2]]);
  });
  it('does not accept 45 degrees as a rigid-stud generation pose or invent a continuous DOF', () => {
    expect(solveConnectorPlacement({ fixed: stud, moving: receiver, anglesDeg: [45] }).status).toBe('BLOCKED');
  });
  it('rejects near-quarter turns without snapping a decimal angular error onto C01', () => {
    for (const angle of [90.0000000001, 89.9999999999, 0.0000000001, 270.0000000001]) expect(solveConnectorPlacement({ fixed: stud, moving: receiver, anglesDeg: [angle] }).status, String(angle)).toBe('BLOCKED');
    expect(solveConnectorPlacement({ fixed: stud, moving: receiver, anglesDeg: [0, 90, 180, 270] }).candidates).toHaveLength(4);
  });
  it('keeps renamed/unseen feature identities independent of mating knowledge', () => {
    const a = structuredClone(stud), b = structuredClone(receiver);
    a.featureId = 'previously-unseen-feature-a'; b.featureId = 'previously-unseen-feature-b';
    expect(evaluateConnectorCompatibility(a, b).status).toBe('COMPATIBLE');
    expect(solveConnectorPlacement({ fixed: a, moving: b }).candidates[0].transform).toEqual(solveConnectorPlacement({ fixed: stud, moving: receiver }).candidates[0].transform);
  });
  it('revokes C01 when raw sections contradict canonical dimensions', () => {
    const changed = structuredClone(stud); changed.dimensions.radiusLdu = 5.9;
    expect(inspectConnectorSupport(changed).supported).toBe(false);
    expect(evaluateConnectorCompatibility(changed, receiver).status).toBe('UNKNOWN');
  });
  it('does not allow scaled source frames to claim normal R6x4 effective dimensions', () => {
    const changed = structuredClone(stud); changed.localOrientation[4] = 5;
    expect(inspectConnectorSupport(changed).supported).toBe(false);
    expect(evaluateConnectorCompatibility(changed, receiver).status).toBe('UNKNOWN');
  });
  it('does not promote unknown source scaling or boolean semantics from a copied policy', () => {
    for (const option of ['[scale=unreviewed-mode]', '[center=unknown]', '[slide=unknown]']) {
      const changed = structuredClone(stud);
      changed.sources.find(source => source.kind === 'LDCAD_SHADOW')!.raw += ' ' + option;
      expect(inspectConnectorSupport(changed).supported, option).toBe(false);
      expect(evaluateConnectorCompatibility(changed, receiver).status, option).toBe('UNKNOWN');
    }
  });
  it('explicitly forbids Stud to Technic Pin Hole even if nominal sizes match', () => {
    const hole = structuredClone(receiver); hole.family = 'PIN_HOLE';
    expect(evaluateConnectorCompatibility(stud, hole)).toMatchObject({ status: 'ILLEGAL', reasonCodes: ['stud-to-technic-pin-hole-forbidden'] });
  });
  it('keeps an unknown cylinder and an ordinary stud incompatible by semantic family', () => {
    const unknown = structuredClone(receiver); unknown.family = 'GENERIC_SPECIAL'; unknown.matchingPolicy = null;
    expect(evaluateConnectorCompatibility(stud, unknown).status).toBe('UNKNOWN');
  });
  it('rejects repeated occupancy and nonrigid placements independently of compatibility', () => {
    const occupied = structuredClone(receiver); occupied.occupied = true;
    expect(evaluateConnectorCompatibility(stud, occupied).reasonCodes).toContain('connector-occupied');
    expect(solveConnectorPlacement({ fixed: stud, moving: receiver, fixedTransform: { rotation: [2, 0, 0, 0, 1, 0, 0, 0, 1], translation: [0, 0, 0] } }).status).toBe('BLOCKED');
  });
});

describe('conditional family rules on algorithm-only explicit metadata', () => {
  const cases: [GrammarRuleId, ConnectorFamily, ConnectorFamily, string][] = [
    ['BAR_CLIP', 'BAR', 'CLIP', 'CYLINDRICAL'],
    ['BAR_RECEPTACLE', 'BAR', 'BAR_HOLE', 'RIGID'],
    ['PIN_HOLE', 'PIN', 'PIN_HOLE', 'REVOLUTE'],
    ['AXLE_KEYED', 'AXLE', 'AXLE_HOLE', 'PRISMATIC'],
    ['AXLE_ROUND', 'AXLE', 'ROUND_HOLE', 'CYLINDRICAL'],
    ['HINGE', 'HINGE_FINGER', 'HINGE_FINGER', 'REVOLUTE'],
    ['CLICK_HINGE', 'CLICK_HINGE', 'CLICK_HINGE', 'REVOLUTE'],
    ['TURNTABLE', 'TURNTABLE', 'TURNTABLE', 'REVOLUTE'],
    ['BALL_SOCKET', 'BALL', 'BALL_SOCKET', 'SPHERICAL'],
    ['TOWBALL_SOCKET', 'TOWBALL', 'TOWBALL_SOCKET', 'SPHERICAL'],
    ['WHEEL_MOUNT', 'WHEEL_PIN', 'WHEEL_HOLE', 'REVOLUTE'],
    ['TYRE_RIM', 'RIM_SEAT', 'TYRE_SEAT', 'RIGID'],
    ['RAIL_GROOVE', 'RAIL', 'GROOVE', 'PRISMATIC'],
    ['GENERIC_GROUP', 'GENERIC_SPECIAL', 'GENERIC_SPECIAL', 'RIGID'],
  ];
  it.each(cases)('%s uses a family-level rule and explicit motion evidence', (rule, a, b, joint) => {
    const pair = algorithmPair(rule, a, b), matched = evaluateConnectorCompatibility(...pair, algorithm);
    expect(matched.status).toBe('COMPATIBLE'); expect(matched.joint?.type).toBe(joint);
    expect(matched.physicalBuildVerified).toBe(false);
    // These positives prove only algorithms under supplied premises. Production
    // must not trust artificial mating dimensions, fit certificates or parts.
    expect(evaluateConnectorCompatibility(...pair).status).toBe('UNKNOWN');
  });
  it('never establishes a fit from equal radius, source group or family alone', () => {
    const pair = algorithmPair('GENERIC_GROUP', 'GENERIC_SPECIAL', 'GENERIC_SPECIAL');
    pair[0].matchingPolicy = pair[1].matchingPolicy = null;
    expect(evaluateConnectorCompatibility(...pair, algorithm).status).toBe('UNKNOWN');
  });
  it('retains unknown pin friction and avoids a guessed rigid/revolute decision', () => {
    const pair = algorithmPair('PIN_HOLE', 'PIN', 'PIN_HOLE'); pair[0].friction = 'UNKNOWN';
    expect(evaluateConnectorCompatibility(...pair, algorithm)).toMatchObject({ status: 'UNKNOWN', reasonCodes: ['joint-semantics-unresolved'] });
  });
  it('retains high-friction rigid and low-friction revolute metadata as distinct', () => {
    const pair = algorithmPair('PIN_HOLE', 'PIN', 'PIN_HOLE'); pair[0].friction = 'HIGH';
    pair.forEach(feature => feature.rotationAllowed = false);
    expect(evaluateConnectorCompatibility(...pair, algorithm).joint?.type).toBe('RIGID');
    pair[0].friction = 'LOW'; pair.forEach(feature => feature.rotationAllowed = true);
    expect(evaluateConnectorCompatibility(...pair, algorithm).joint?.type).toBe('REVOLUTE');
  });
  it('respects bar/clip axial span and source roll range', () => {
    const [fixed, moving] = algorithmPair('BAR_CLIP', 'BAR', 'CLIP');
    const result = solveConnectorPlacement({ fixed, moving, axialPositionLdu: 20, anglesDeg: [37], options: algorithm });
    expect(result.status).toBe('SOLVED'); expect(result.poseFamily?.translationRangeLdu).toEqual([0, 72]);
    expect(solveConnectorPlacement({ fixed, moving, axialPositionLdu: 73, options: algorithm }).status).toBe('BLOCKED');
    expect(solveConnectorPlacement({ fixed, moving, anglesDeg: [181], options: algorithm }).status).toBe('BLOCKED');
  });
  it('rejects insufficient shaft span and insertion outside the evidenced interval', () => {
    const [fixed, moving] = algorithmPair('BAR_CLIP', 'BAR', 'CLIP'); fixed.axialSpanLdu = [0, 7];
    expect(evaluateConnectorCompatibility(fixed, moving, algorithm).status).toBe('UNKNOWN');
    fixed.axialSpanLdu = [0, 80];
    expect(solveConnectorPlacement({ fixed, moving, insertionLdu: 3, options: algorithm }).status).toBe('BLOCKED');
  });
  it('computes insertion from actual spans and refuses a mismatched claimed depth', () => {
    const [fixed, moving] = algorithmPair('BAR_CLIP', 'BAR', 'CLIP');
    const result = solveConnectorPlacement({ fixed, moving, axialPositionLdu: 20, insertionLdu: 8, options: algorithm });
    expect(result.status).toBe('SOLVED'); expect(result.candidates[0].insertionLdu).toBe(8);
    expect(solveConnectorPlacement({ fixed, moving, axialPositionLdu: 20, insertionLdu: 4, options: algorithm }).status).toBe('BLOCKED');
    moving.insertionRangeLdu = [4, 7];
    expect(solveConnectorPlacement({ fixed, moving, axialPositionLdu: 20, options: algorithm }).status).toBe('BLOCKED');
  });
  it('seats OPPOSITE interfaces in both attachment directions with actual world-segment overlap', () => {
    const [male, female] = algorithmPair('GENERIC_GROUP', 'GENERIC_SPECIAL', 'GENERIC_SPECIAL');
    male.axialSpanLdu = [0, 10]; female.axialSpanLdu = [0, 2];
    for (const feature of [male, female]) {
      feature.insertionRangeLdu = [2, 2];
      feature.matchingPolicy!.axisRelation = 'OPPOSITE'; feature.matchingPolicy!.seatingOffsetLdu = 2;
    }
    const forward = solveConnectorPlacement({ fixed: male, moving: female, options: algorithm });
    const reverse = solveConnectorPlacement({ fixed: female, moving: male, options: algorithm });
    expect(forward.status).toBe('SOLVED'); expect(reverse.status).toBe('SOLVED');
    expect(actualWorldOverlap(male, IDENTITY_TRANSFORM, female, forward.candidates[0].transform)).toBe(2);
    expect(actualWorldOverlap(female, IDENTITY_TRANSFORM, male, reverse.candidates[0].transform)).toBe(2);
    expect(reverse.candidates[0].transform.translation).toEqual([0, -2, 0]);
  });
  it.each(['SAME', 'OPPOSITE'] as const)('uses displacement relative to nonzero seating offset for %s sliding bounds in both directions', relation => {
    const [male, female] = algorithmPair('GENERIC_GROUP', 'GENERIC_SPECIAL', 'GENERIC_SPECIAL');
    male.axialSpanLdu = [0, 10]; female.axialSpanLdu = [0, 2];
    for (const feature of [male, female]) {
      feature.slideAllowed = true; feature.insertionRangeLdu = [2, 2];
      feature.matchingPolicy!.axisRelation = relation; feature.matchingPolicy!.seatingOffsetLdu = 2;
    }
    const expected = relation === 'SAME' ? [-2, 6] : [0, 8];
    expect(evaluateConnectorCompatibility(male, female, algorithm).joint?.translationRangeLdu).toEqual(expected);
    for (const [fixed, moving] of [[male, female], [female, male]]) {
      for (const axialPositionLdu of [expected[0], (expected[0] + expected[1]) / 2, expected[1]]) {
        const solved = solveConnectorPlacement({ fixed, moving, axialPositionLdu, options: algorithm });
        expect(solved.status).toBe('SOLVED');
        expect(actualWorldOverlap(fixed, IDENTITY_TRANSFORM, moving, solved.candidates[0].transform)).toBe(2);
      }
      for (const axialPositionLdu of [expected[0] - 1, expected[1] + 1]) expect(solveConnectorPlacement({ fixed, moving, axialPositionLdu, options: algorithm }).status).toBe('BLOCKED');
    }
  });
  it.each([['BAR_CLIP', 'BAR', 'CLIP'], ['AXLE_KEYED', 'AXLE', 'AXLE_HOLE']] as [GrammarRuleId, ConnectorFamily, ConnectorFamily][])('%s rejects inherited scale, shear and inconsistent axis instead of orthonormalising them into a fit', (rule, a, b) => {
    const [fixed, moving] = algorithmPair(rule, a, b);
    for (const orientation of [[2, 0, 0, 0, 1, 0, 0, 0, 1], [1, 0.2, 0, 0, 1, 0, 0, 0, 1]] as Connector['localOrientation'][]) {
      moving.localOrientation = orientation;
      expect(evaluateConnectorCompatibility(fixed, moving, algorithm).status).toBe('UNKNOWN');
      expect(solveConnectorPlacement({ fixed, moving, options: algorithm }).status).toBe('UNKNOWN');
    }
    moving.localOrientation = [...IDENTITY_ROTATION]; moving.axis = [1, 0, 0];
    expect(evaluateConnectorCompatibility(fixed, moving, algorithm).status).toBe('UNKNOWN');
  });
  it('does not allow arbitrary free roll for a keyed axle profile', () => {
    const [fixed, moving] = algorithmPair('AXLE_KEYED', 'AXLE', 'AXLE_HOLE');
    expect(solveConnectorPlacement({ fixed, moving, anglesDeg: [90], options: algorithm }).status).toBe('SOLVED');
    expect(solveConnectorPlacement({ fixed, moving, anglesDeg: [45], options: algorithm }).status).toBe('BLOCKED');
    moving.profile = 'ROUND';
    expect(evaluateConnectorCompatibility(fixed, moving, algorithm).status).toBe('INCOMPATIBLE');
  });
  it('intersects profile symmetries rather than taking the smaller symmetry order', () => {
    const pair = algorithmPair('AXLE_KEYED', 'AXLE', 'AXLE_HOLE'); pair[0].symmetryOrder = 4; pair[1].symmetryOrder = 6;
    expect(evaluateConnectorCompatibility(...pair, algorithm).allowedAnglesDeg).toEqual([0, 180]);
  });
  it('keeps a click-hinge table and rejects an unsupported intermediate angle', () => {
    const [fixed, moving] = algorithmPair('CLICK_HINGE', 'CLICK_HINGE', 'CLICK_HINGE');
    expect(solveConnectorPlacement({ fixed, moving, anglesDeg: [30], options: algorithm }).status).toBe('SOLVED');
    expect(solveConnectorPlacement({ fixed, moving, anglesDeg: [15], options: algorithm }).status).toBe('BLOCKED');
    moving.detentsDeg = null;
    expect(evaluateConnectorCompatibility(fixed, moving, algorithm).status).toBe('UNKNOWN');
  });
  it('rejects near-click detents while preserving explicitly allowed exact detents', () => {
    const [fixed, moving] = algorithmPair('CLICK_HINGE', 'CLICK_HINGE', 'CLICK_HINGE');
    for (const angle of [30.0000000001, 29.9999999999, -60.0000000001]) expect(solveConnectorPlacement({ fixed, moving, anglesDeg: [angle], options: algorithm }).status).toBe('BLOCKED');
    expect(solveConnectorPlacement({ fixed, moving, anglesDeg: [30], options: algorithm }).status).toBe('SOLVED');
  });
  it('does not merge different ball/towball profile sizes into one fit', () => {
    const [fixed, moving] = algorithmPair('BALL_SOCKET', 'BALL', 'BALL_SOCKET');
    moving.matchingPolicy!.profileId = 'another-sourced-ball-size';
    expect(evaluateConnectorCompatibility(fixed, moving, algorithm).status).toBe('INCOMPATIBLE');
  });
  it('keeps contradictory nominal radii unknown even if a copied fit-profile key matches', () => {
    const [fixed, moving] = algorithmPair('BALL_SOCKET', 'BALL', 'BALL_SOCKET'); moving.dimensions.radiusLdu = 4.01;
    expect(evaluateConnectorCompatibility(fixed, moving, algorithm)).toMatchObject({ status: 'UNKNOWN', reasonCodes: ['fit-dimensions-conflict'] });
  });
  it('does not invent a spherical orientation from a single axis angle', () => {
    const [fixed, moving] = algorithmPair('BALL_SOCKET', 'BALL', 'BALL_SOCKET');
    const result = solveConnectorPlacement({ fixed, moving, options: algorithm });
    expect(result.status).toBe('UNKNOWN'); expect(result.poseFamily?.type).toBe('SPHERICAL'); expect(result.candidates).toEqual([]);
  });
  it('keeps generic group mismatch incompatible despite a shared nominal fit key', () => {
    const pair = algorithmPair('GENERIC_GROUP', 'GENERIC_SPECIAL', 'GENERIC_SPECIAL'); pair[1].compatibilityGroup = 'other';
    expect(evaluateConnectorCompatibility(...pair, algorithm).status).toBe('INCOMPATIBLE');
  });
  it('indexes allowed family directions without scanning or memorising library part pairs', () => {
    expect(CONNECTOR_GRAMMAR_RULES).toHaveLength(15);
    const grammar = new ConnectorGrammar();
    expect(grammar.compatibleFamilies('AXLE')).toEqual(['AXLE_HOLE', 'ROUND_HOLE']);
    expect(grammar.compatibleFamilies('STUD')).toEqual(['ANTISTUD']);
    expect(grammar.compatibleFamilies('STUD')).not.toContain('PIN_HOLE');
  });
});
