import { describe, expect, it } from 'vitest';
import { NativePartRepository } from '../src/parts/assembly/source.js';
import { adaptNativePartConnectors } from '../src/parts/grammar/sources.js';
import { IDENTITY_ROTATION, IDENTITY_TRANSFORM } from '../src/parts/assembly/math.js';
import type { Matrix3, Vector3 } from '../src/parts/assembly/types.js';
import type { Connector, GrammarRuleId, JointModel } from '../src/parts/grammar/schema.js';
import {
  classifyAssemblyBuildingPatterns, classifyBuildingPatterns, type PatternJointEvidence,
} from '../src/parts/grammar/patterns.js';
import {
  LEGO_LDU, addLdu, equalLdu, exactLdu, formatLdu, isMultipleLdu,
  multiplyLdu, subtractLdu, validateExactClosure,
} from '../src/parts/grammar/exact.js';

// These are mathematical classifier fixtures, NOT imported LEGO parts, fit
// certificates, production overrides or candidate-specific assembly rules.
const RIGHT: Matrix3 = [0, -1, 0, 1, 0, 0, 0, 0, 1];
const DOWN: Matrix3 = [-1, 0, 0, 0, -1, 0, 0, 0, 1];
function feature(id: string, role: 'MALE' | 'FEMALE', position: Vector3, axis: Vector3 = [0, -1, 0]): Connector {
  return {
    featureId: id, sourceConnectionId: null, family: role === 'MALE' ? 'STUD' : 'ANTISTUD', role, units: 'LDU',
    localPositionLdu: position, localOrientation: axis[0] === 1 ? RIGHT : axis[1] === 1 ? DOWN : IDENTITY_ROTATION, axis,
    profile: role === 'MALE' ? 'ROUND' : 'SQUARE',
    dimensions: { radiusLdu: 6, lengthLdu: 4, widthLdu: null, heightLdu: null, sections: [{ profile: role === 'MALE' ? 'R' : 'S', radiusLdu: 6, lengthLdu: 4 }] },
    axialSpanLdu: [0, 4], capStart: true, capEnd: false, insertionRangeLdu: [4, 4],
    slideAllowed: false, rotationAllowed: false, symmetryOrder: 4, friction: 'UNKNOWN', angleLimitsDeg: null, detentsDeg: null,
    compatibilityGroup: null, occupied: false, contactSurface: null, entryFace: null,
    matchingPolicy: { ruleId: 'C01', kind: 'STANDARD_STUD', profileId: 'algorithm-fixture-stud-shape', evidenceSourceIds: ['math-fixture-source'], axisRelation: 'SAME', seatingOffsetLdu: 0 },
    sources: [{ id: 'math-fixture-source', kind: 'VERIFIED_MANUAL', reference: 'tests/parts-grammar-patterns.test.ts', revision: 'algorithm-fixture-1', sha256: null, license: null, line: null, raw: null, verification: 'VERIFIED', scope: 'ALGORITHM_FIXTURE', notes: ['Pure mathematical pattern fixture; not LEGO source data.'] }],
    confidence: 'SOURCE_BACKED', coverage: 'COMPLETE', unknownFields: [], diagnostics: [], notes: ['Algorithm fixture only.'],
  };
}
function kinds(connectors: Connector[]) { return classifyBuildingPatterns(connectors).patterns.map(pattern => pattern.kind); }
function algorithmJointEvidence(ids: string[], ruleId: GrammarRuleId = 'C01', type: JointModel['type'] = 'RIGID', translationDof: 0 | 1 = 0, rotationDof: 0 | 1 | 3 = 0): PatternJointEvidence {
  const joint: JointModel = { type, translationDof, rotationDof, axis: [0, -1, 0], pivotLdu: [0, 0, 0], translationRangeLdu: translationDof ? [0, 20] : null,
    angleLimitsDeg: rotationDof ? [-45, 45] : null, detentsDeg: null, collisionEnvelope: { sourceIds: ['math-fixture-source'], status: 'UNKNOWN' }, physicalBuildVerified: false };
  const compatibility: PatternJointEvidence['compatibility'] = { status: 'COMPATIBLE', ruleId, reasonCodes: [], reasons: ['Math classifier fixture, not a source/fit certificate.'],
    joint, axisRelation: 'SAME', insertionRangeLdu: [4, 4], allowedAnglesDeg: [0], sourceIds: ['math-fixture-source'], physicalBuildVerified: false };
  return { featureIds: ids, compatibility, placement: { status: 'SOLVED', compatibility, poseFamily: joint, candidates: [{ transform: IDENTITY_TRANSFORM, twistDeg: 0, insertionLdu: 4, joint, fixedFeatureId: ids[0], movingFeatureId: ids[1] }], reasons: [] } };
}

describe('exact native LDU arithmetic and closure', () => {
  it('proves 5 plates equal 2 stud pitches using integers, not millimetres', () => {
    expect(LEGO_LDU).toEqual({ studPitch: 20, halfStud: 10, plateHeight: 8, brickHeight: 24, studDiameter: 12, studHeight: 4 });
    expect(equalLdu(multiplyLdu(5, LEGO_LDU.plateHeight), multiplyLdu(2, LEGO_LDU.studPitch))).toBe(true);
    expect(formatLdu(multiplyLdu(5, 8))).toBe('40');
    expect(isMultipleLdu(24, 8)).toBe(true);
  });
  it('preserves explicit decimal/rational values without snapping approximations', () => {
    expect(equalLdu(addLdu('0.1', '0.2'), '0.3')).toBe(true);
    expect(equalLdu(multiplyLdu('1/3', 3), 1)).toBe(true);
    expect(formatLdu(subtractLdu('4e1', '0.125'))).toBe('319/8');
    expect(equalLdu(39.99999999999999, 40)).toBe(false);
    expect(equalLdu('40.001', '39.999')).toBe(false);
    expect(isMultipleLdu('9.999999999999999', 10)).toBe(false);
  });
  it('refuses nonfinite, ambiguous or unbounded exact coordinates', () => {
    for (const value of [Infinity, NaN, 'maybe 10', '1/0', '1e99999', '0x10']) expect(() => exactLdu(value)).toThrow();
  });
  it('checks every endpoint and rejects one 1-LDU discrepancy rather than averaging', () => {
    const pair = { fixedFeatureId: 'fixed-1', movingFeatureId: 'moving-1', fixedPosition: [0, 0, 0] as const, movingPosition: [0, 0, 0] as const };
    expect(validateExactClosure([pair, { ...pair, fixedFeatureId: 'fixed-2', movingFeatureId: 'moving-2', fixedPosition: [40, 0, 0], movingPosition: [multiplyLdu(5, 8), 0, 0] }]).status).toBe('EXACT');
    const rejected = validateExactClosure([pair, { ...pair, fixedFeatureId: 'fixed-2', movingFeatureId: 'moving-2', fixedPosition: [40, 0, 0], movingPosition: [41, 0, 0] }]);
    expect(rejected.status).toBe('MISALIGNED');
    expect(rejected.residuals[1].position).toEqual(['-1', '0', '0']);
    expect(rejected.scope).toBe('mathematical-world-endpoint-closure-only');
  });
  it('refuses to call near-coincidence, axis disagreement or absent constraints exact closure', () => {
    expect(validateExactClosure([]).status).toBe('UNKNOWN');
    expect(validateExactClosure([{ fixedFeatureId: 'a', movingFeatureId: 'b', fixedPosition: [0, 40, 0], movingPosition: [0, 39.99999999999999, 0] }]).status).toBe('MISALIGNED');
    expect(validateExactClosure([{ fixedFeatureId: 'a', movingFeatureId: 'b', fixedPosition: [0, 0, 0], movingPosition: [0, 0, 0], fixedAxis: [0, -1, 0], movingAxis: [0, 1, 0] }]).status).toBe('MISALIGNED');
  });
});

describe('connector topology building patterns', () => {
  it('uses equal native snap axes for stacking, without false stud reversal', () => {
    const result = classifyBuildingPatterns([feature('in', 'FEMALE', [0, 24, 0]), feature('out', 'MALE', [0, 0, 0])]);
    expect(result.patterns.map(pattern => pattern.kind)).toEqual(expect.arrayContaining(['NORMAL_STACK', 'PLATE_HEIGHT_OFFSET']));
    expect(result.patterns.some(pattern => pattern.kind === 'SNOT_180')).toBe(false);
    expect(result.legalAssemblyEstablished).toBe(false);
    expect(result.patterns.every(pattern => pattern.state === 'TOPOLOGY_POTENTIAL')).toBe(true);
  });
  it('derives SNOT90 and positional offsets from feature transforms', () => {
    const result = kinds([feature('in', 'FEMALE', [0, 24, 0]), feature('out', 'MALE', [10, 10, 0], [1, 0, 0])]);
    expect(result).toEqual(expect.arrayContaining(['SNOT_90', 'BRACKET_OFFSET', 'STUD_OUT_SNOT']));
    expect(result).not.toContain('SNOT_180');
    expect(kinds([feature('side-in', 'FEMALE', [0, 10, 0], [1, 0, 0]), feature('top-out', 'MALE', [0, 0, 0])])).toContain('STUD_IN_SNOT');
  });
  it('recognizes a genuine opposing snap direction as SNOT180', () => {
    expect(kinds([feature('in', 'FEMALE', [0, 24, 0]), feature('out', 'MALE', [0, 32, 0], [0, 1, 0])])).toContain('SNOT_180');
  });
  it('finds exact half-stud and 8/16/24-LDU height offsets without part names', () => {
    for (const height of [8, 16, 24]) {
      const result = classifyBuildingPatterns([feature('in', 'FEMALE', [10, height, 0]), feature('out', 'MALE', [0, 0, 0])]);
      expect(result.patterns.map(pattern => pattern.kind)).toEqual(expect.arrayContaining(['HALF_STUD_OFFSET', 'PLATE_HEIGHT_OFFSET']));
      expect(result.patterns.find(pattern => pattern.kind === 'HALF_STUD_OFFSET')?.offsetLdu).toEqual(['-10', String(-height), '0']);
    }
    expect(kinds([feature('in', 'FEMALE', [9.999999999999998, 8, 0]), feature('out', 'MALE', [0, 0, 0])])).not.toContain('HALF_STUD_OFFSET');
  });
  it('does not classify heuristics, unknown frames or an unrecognized internal tube as System topology', () => {
    const a = feature('in', 'FEMALE', [0, 24, 0]), b = feature('out', 'MALE', [0, 0, 0], [0, 1, 0]);
    b.matchingPolicy = null; b.coverage = 'PARTIAL';
    expect(kinds([a, b])).not.toContain('SNOT_180');
    b.matchingPolicy = a.matchingPolicy; b.coverage = 'COMPLETE'; b.confidence = 'HEURISTIC';
    expect(kinds([a, b])).not.toContain('SNOT_180');
  });
  it('does not infer motion or multi-point success just from family labels and connector count', () => {
    const result = classifyBuildingPatterns([feature('a', 'MALE', [0, 0, 0]), feature('b', 'FEMALE', [0, 8, 0]), feature('c', 'MALE', [20, 0, 0])]);
    for (const kind of ['AXIAL_SLIDE', 'AXIAL_ROTATION', 'HINGE_ANGLE', 'CLIP_BAR_ANGLE', 'BALL_JOINT_ANGLE', 'WHEEL_MOUNT', 'MULTI_POINT_CONNECTION', 'EXACT_CLOSED_ANGLE']) expect(result.patterns.map(pattern => pattern.kind)).not.toContain(kind);
  });
  it.each([
    ['BAR_CLIP', 'CYLINDRICAL', 1, 1, ['CLIP_BAR_ANGLE', 'AXIAL_SLIDE', 'AXIAL_ROTATION']],
    ['AXLE_KEYED', 'PRISMATIC', 1, 0, ['AXIAL_SLIDE']],
    ['HINGE', 'REVOLUTE', 0, 1, ['HINGE_ANGLE', 'AXIAL_ROTATION']],
    ['WHEEL_MOUNT', 'REVOLUTE', 0, 1, ['WHEEL_MOUNT', 'AXIAL_ROTATION']],
    ['BALL_SOCKET', 'SPHERICAL', 0, 3, ['BALL_JOINT_ANGLE']],
  ] as const)('classifies %s kinematics only from a supplied solved-joint algorithm fixture', (rule, type, translation, rotation, expected) => {
    const features = [feature('a', 'MALE', [0, 0, 0]), feature('b', 'FEMALE', [0, 8, 0])];
    const joint = algorithmJointEvidence(['a', 'b'], rule, type, translation, rotation);
    const result = classifyBuildingPatterns(features, { joints: [joint] });
    expect(result.patterns.map(pattern => pattern.kind)).toEqual(expect.arrayContaining([...expected]));
    expect(result.patterns.filter(pattern => expected.includes(pattern.kind as never)).every(pattern => pattern.state === 'SOLVED_JOINT')).toBe(true);
    joint.compatibility.status = 'UNKNOWN';
    expect(classifyBuildingPatterns(features, { joints: [joint] }).patterns.map(pattern => pattern.kind)).not.toEqual(expect.arrayContaining([...expected]));
  });
  it('requires declared multi-point consistency and exact endpoint closure for a closed-angle pattern', () => {
    const features = [feature('a', 'MALE', [0, 0, 0]), feature('b', 'FEMALE', [0, 8, 0])], joint = algorithmJointEvidence(['a', 'b']);
    joint.validatedMateCount = 2;
    const closure = validateExactClosure([
      { fixedFeatureId: 'a1', movingFeatureId: 'b1', fixedPosition: [0, 0, 0], movingPosition: [0, 0, 0] },
      { fixedFeatureId: 'a2', movingFeatureId: 'b2', fixedPosition: [40, 0, 0], movingPosition: [40, 0, 0] },
    ]);
    expect(classifyBuildingPatterns(features, { joints: [joint], closure }).patterns.map(pattern => pattern.kind)).toEqual(expect.arrayContaining(['MULTI_POINT_CONNECTION', 'EXACT_CLOSED_ANGLE']));
    closure.residuals[1].position[0] = '1';
    expect(classifyBuildingPatterns(features, { joints: [joint], closure }).patterns.map(pattern => pattern.kind)).not.toContain('EXACT_CLOSED_ANGLE');
  });
  it('composes two 90-degree topology changes in an already solved connected assembly into 180 degrees', () => {
    const parts = [
      { instanceId: 'first', transform: IDENTITY_TRANSFORM, connectors: [feature('in', 'FEMALE', [0, 0, 0]), feature('side', 'MALE', [0, 0, 0], [1, 0, 0])] },
      { instanceId: 'second', transform: { rotation: RIGHT, translation: [0, 0, 0] as Vector3 }, connectors: [feature('in', 'FEMALE', [0, 0, 0]), feature('side', 'MALE', [0, 0, 0], [1, 0, 0])] },
    ];
    const context = { joints: [algorithmJointEvidence(['first/side', 'second/in'])] };
    expect(classifyAssemblyBuildingPatterns(parts, context).patterns.map(pattern => pattern.kind)).toContain('SNOT_180');
    expect(classifyAssemblyBuildingPatterns(parts).patterns.map(pattern => pattern.kind)).not.toContain('SNOT_180');
  });
  it('records off-grid poses only with solved joint evidence and rejects nonrigid poses', () => {
    const features = [feature('a', 'MALE', [0, 0, 0]), feature('b', 'FEMALE', [0, 8, 0])];
    const offGrid = { rotation: [0.6, -0.8, 0, 0.8, 0.6, 0, 0, 0, 1] as Matrix3, translation: [0, 0, 0] as Vector3 };
    expect(classifyBuildingPatterns(features, { joints: [algorithmJointEvidence(['a', 'b'], 'HINGE', 'REVOLUTE', 0, 1)], subassemblyTransforms: [offGrid] }).patterns.map(pattern => pattern.kind)).toContain('OFF_GRID_ROTATED_SUBASSEMBLY');
    expect(classifyBuildingPatterns(features, { subassemblyTransforms: [offGrid] }).patterns.map(pattern => pattern.kind)).not.toContain('OFF_GRID_ROTATED_SUBASSEMBLY');
    expect(classifyAssemblyBuildingPatterns([{ instanceId: 'bad', connectors: features, transform: { ...offGrid, rotation: [2, 0, 0, 0, 1, 0, 0, 0, 1] } }]).diagnostics[0].code).toBe('invalid-topology-placement');
  });
  it('derives actual headlight/side-stud and jumper capabilities, with no ID or name in the classifier', async () => {
    const repository = new NativePartRepository();
    for (const id of ['4070', '87087']) {
      const part = (await repository.getPart(id))!;
      const result = classifyBuildingPatterns(adaptNativePartConnectors(part).connectors);
      expect(result.patterns.map(pattern => pattern.kind)).toContain('SNOT_90');
      expect(result.patterns.find(pattern => pattern.kind === 'SNOT_90')!.sourceIds.length).toBeGreaterThan(0);
    }
    for (const id of ['3794b', '15573']) {
      const part = (await repository.getPart(id))!;
      const result = classifyBuildingPatterns(adaptNativePartConnectors(part).connectors);
      expect(result.patterns.map(pattern => pattern.kind)).toContain('HALF_STUD_OFFSET');
      expect(result.patterns.map(pattern => pattern.kind)).not.toContain('SNOT_180');
    }
    const brick = (await repository.getPart('3001'))!;
    expect(classifyBuildingPatterns(adaptNativePartConnectors(brick).connectors).patterns.map(pattern => pattern.kind)).not.toContain('SNOT_180');
  });
});
