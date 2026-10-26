import { describe, expect, it, vi } from 'vitest';
import type { Connector, ConnectorProvenance } from '../src/parts/grammar/schema.js';
import type { ConnectorPairConstraint, StabilityConnectionObservation } from '../src/parts/grammar/validation.js';
import { validateGrammarMultiPoint, evaluateGrammarLegality, assessGrammarAssemblyCandidate, scoreGrammarStability } from '../src/parts/grammar/validation.js';
import { solveConnectorPlacement } from '../src/parts/grammar/solver.js';
import { assessMechanicalInteraction, gearRotationRatio, type MechanicalInteraction } from '../src/parts/grammar/interaction.js';
import { IDENTITY_TRANSFORM, axisRotation } from '../src/parts/assembly/math.js';
import type { RigidTransform, Vector3 } from '../src/parts/assembly/types.js';

// Explicit mathematical algorithm fixtures. No part number, real connector
// dimensions or LEGO fit evidence is created or admitted to production.
const options = { allowAlgorithmFixtures: true };
const source: ConnectorProvenance = { id: 'test-only-verified-fit', kind: 'VERIFIED_MANUAL', reference: 'urn:algorithm-fixture:validation', revision: null, sha256: '1'.repeat(64), license: 'Test-only synthetic algorithm fixture', line: null, raw: null, verification: 'VERIFIED', scope: 'ALGORITHM_FIXTURE', notes: ['Not a real LEGO part or physical-build proof.'] };
function feature(featureId: string, role: Connector['role'], position: Vector3): Connector {
  return { featureId, sourceConnectionId: null, family: 'GENERIC_SPECIAL', role, units: 'LDU', localPositionLdu: position,
    localOrientation: [...IDENTITY_TRANSFORM.rotation], axis: [0, -1, 0], profile: 'GENERIC',
    dimensions: { radiusLdu: 1, lengthLdu: 1, widthLdu: null, heightLdu: null, sections: [] }, axialSpanLdu: [0, 1], capStart: true, capEnd: false,
    boundingShape: { kind: 'BOX', dimensionsLdu: [2, 1, 2] },
    insertionRangeLdu: [1, 1], slideAllowed: false, rotationAllowed: false, symmetryOrder: 4, friction: 'UNKNOWN', angleLimitsDeg: null, detentsDeg: null,
    compatibilityGroup: 'TEST_ONLY', occupied: false, contactSurface: null, entryFace: null,
    matchingPolicy: { ruleId: 'GENERIC_GROUP', kind: 'VERIFIED_FIT', profileId: 'TEST_ONLY', evidenceSourceIds: [source.id], axisRelation: 'SAME', seatingOffsetLdu: 0 },
    sources: [structuredClone(source)], confidence: 'VERIFIED', coverage: 'COMPLETE', unknownFields: [], diagnostics: [], notes: ['Synthetic mathematical fixture only.'] };
}
function constraint(x = 0, z = 0, index = 0): ConnectorPairConstraint {
  return { fixedInstanceId: 'fixture-fixed', movingInstanceId: 'fixture-moving', fixed: feature(`fixed-${index}`, 'MALE', [x, 0, z]), moving: feature(`moving-${index}`, 'FEMALE', [x, 8, z]), fixedTransform: structuredClone(IDENTITY_TRANSFORM) };
}
const pose: RigidTransform = { rotation: [...IDENTITY_TRANSFORM.rotation], translation: [0, -8, 0] };
const placementFor = (pair = constraint()) => solveConnectorPlacement({ fixed: pair.fixed, moving: pair.moving, fixedTransform: pair.fixedTransform, options });

describe('explicit interface multi-point closure', () => {
  it('checks all eight declared connectors under one exactly shared rigid pose', () => {
    const pairs = [-30, -10, 10, 30].flatMap((x, column) => [-10, 10].map((z, row) => constraint(x, z, column * 2 + row)));
    const result = validateGrammarMultiPoint({ pairs, movingTransform: pose, options });
    expect(result.status).toBe('CONSISTENT'); expect(result.pairCount).toBe(8); expect(result.checks).toHaveLength(8);
    expect(result.closure.status).toBe('EXACT'); expect(result.physicalBuildVerified).toBe(false);
  });

  it('rejects a second connector displaced by one LDU instead of ignoring or averaging it', () => {
    const pairs = [constraint(0, 0, 0), constraint(20, 0, 1)]; pairs[1].moving.localPositionLdu[0] += 1;
    const result = validateGrammarMultiPoint({ pairs, movingTransform: pose, options });
    expect(result.status).toBe('INCONSISTENT'); expect(result.checks).toHaveLength(2);
    expect(result.issues.some(issue => issue.code === 'shared-pose-mismatch')).toBe(true);
  });

  it('does not promote even a small decimal closure residual into an exact connection', () => {
    const near = structuredClone(pose); near.translation[1] += 1e-10;
    const result = validateGrammarMultiPoint({ pairs: [constraint()], movingTransform: near, options });
    expect(result.status).toBe('INCONSISTENT'); expect(result.closure.status).toBe('MISALIGNED');
    expect(result.issues.some(issue => issue.code === 'exact-closure-mismatch')).toBe(true);
  });

  it('rejects duplicate occupied features, while retaining independent co-located features', () => {
    const pair = constraint();
    const duplicate = validateGrammarMultiPoint({ pairs: [pair, structuredClone(pair)], movingTransform: pose, options });
    expect(duplicate.status).toBe('INCONSISTENT'); expect(duplicate.issues.some(issue => issue.code === 'endpoint-occupied-twice')).toBe(true);
    const distinct = constraint(0, 0, 1);
    const coLocated = validateGrammarMultiPoint({ pairs: [pair, distinct], movingTransform: pose, options });
    expect(coLocated.status).toBe('CONSISTENT'); expect(coLocated.pairCount).toBe(2);
  });

  it('rejects non-rigid placement rather than deforming a rigid part for closure', () => {
    const changed = structuredClone(pose); changed.rotation[0] = 1.1;
    const result = validateGrammarMultiPoint({ pairs: [constraint()], movingTransform: changed, options });
    expect(result.status).toBe('INCONSISTENT'); expect(result.issues[0].code).toBe('non-rigid-placement');
  });

  it('rejects a wrong keyed orientation even when the anchor itself coincides', () => {
    const pair = constraint();
    for (const connector of [pair.fixed, pair.moving]) {
      connector.family = connector.role === 'MALE' ? 'AXLE' : 'AXLE_HOLE'; connector.profile = 'CROSS';
      connector.matchingPolicy!.ruleId = 'AXLE_KEYED';
    }
    const rotated = axisRotation([0, -1, 0], 45);
    const result = validateGrammarMultiPoint({ pairs: [pair], movingTransform: { rotation: rotated, translation: pose.translation }, options });
    expect(result.status).toBe('INCONSISTENT'); expect(result.issues.some(issue => issue.code === 'shared-pose-mismatch')).toBe(true);
  });

  it('keeps unverified fit metadata UNKNOWN and rejects fixtures in production scope', () => {
    const pair = constraint(); pair.fixed.matchingPolicy = null;
    expect(validateGrammarMultiPoint({ pairs: [pair], movingTransform: pose, options }).status).toBe('UNKNOWN');
    expect(validateGrammarMultiPoint({ pairs: [constraint()], movingTransform: pose }).status).toBe('UNKNOWN');
  });

  it('checks explicit axial span and roll parameters without inventing a point attachment for a shaft', () => {
    const pair = constraint();
    for (const connector of [pair.fixed, pair.moving]) {
      connector.family = connector.role === 'MALE' ? 'BAR' : 'CLIP';
      connector.profile = 'ROUND'; connector.slideAllowed = true; connector.rotationAllowed = true;
      connector.angleLimitsDeg = [-90, 90]; connector.matchingPolicy!.ruleId = 'BAR_CLIP';
      connector.axialSpanLdu = connector.role === 'MALE' ? [-5, 5] : [-1, 1];
      connector.dimensions.lengthLdu = connector.role === 'MALE' ? 10 : 2;
      connector.insertionRangeLdu = [2, 2];
    }
    pair.axialPositionLdu = 2; pair.angleDeg = 0;
    const shifted: RigidTransform = { rotation: [...IDENTITY_TRANSFORM.rotation], translation: [0, -10, 0] };
    expect(validateGrammarMultiPoint({ pairs: [pair], movingTransform: shifted, options }).status).toBe('CONSISTENT');
    pair.axialPositionLdu = 5;
    expect(validateGrammarMultiPoint({ pairs: [pair], movingTransform: shifted, options }).status).toBe('INCONSISTENT');
    pair.axialPositionLdu = 2; pair.angleDeg = 100;
    expect(validateGrammarMultiPoint({ pairs: [pair], movingTransform: shifted, options }).status).toBe('INCONSISTENT');
  });
});

describe('connectability, placement, collision, stressing and stability are separate', () => {
  it('rejects an otherwise compatible/solved pose when the actual solid checker reports collision', async () => {
    const check = vi.fn(() => ({ status: 'COLLISION' as const, reason: 'Test-only actual solid intersection.', sourceBoundedContactChecked: true }));
    const result = await assessGrammarAssemblyCandidate({ placement: placementFor(), pairs: [constraint()], movingTransform: pose, collisionCheck: check, options });
    expect(check).toHaveBeenCalledOnce(); expect(result.connectability).toBe('COMPATIBLE'); expect(result.placement).toBe('SOLVED');
    expect(result.collision.status).toBe('COLLISION'); expect(result.legal).toBe('ILLEGAL'); expect(result.stable).toBe('UNKNOWN');
  });

  it('does not call collision discovery to repair a mathematically inconsistent shared pose', async () => {
    const pairs = [constraint(), constraint(20, 0, 1)]; pairs[1].moving.localPositionLdu[0] += 1;
    const check = vi.fn(() => ({ status: 'CLEAR' as const, reason: 'Should never run.', sourceBoundedContactChecked: true }));
    const result = await assessGrammarAssemblyCandidate({ placement: placementFor(), pairs, movingTransform: pose, collisionCheck: check, options });
    expect(check).not.toHaveBeenCalled(); expect(result.legal).toBe('ILLEGAL'); expect(result.multiPoint.status).toBe('INCONSISTENT');
  });

  it('does not mistake insertion-envelope alignment and a clear pose for stress/fit evidence', () => {
    const placement = placementFor();
    const result = evaluateGrammarLegality({ compatibility: placement.compatibility, placement,
      collision: { status: 'CLEAR', reason: 'Static checker passed.', sourceBoundedContactChecked: true }, options });
    expect(result.connectability).toBe('COMPATIBLE'); expect(result.placement).toBe('SOLVED'); expect(result.collision.status).toBe('CLEAR');
    expect(result.stress.status).toBe('UNKNOWN'); expect(result.legal).toBe('UNKNOWN'); expect(result.stable).toBe('UNKNOWN');
  });

  it('requires independently verified stress/fit evidence and retains physical-build false', () => {
    const placement = placementFor();
    const result = evaluateGrammarLegality({ compatibility: placement.compatibility, placement,
      collision: { status: 'CLEAR', reason: 'Test-only clear pose.', sourceBoundedContactChecked: true },
      stress: { status: 'CLEAR', scope: 'verified-assembly-stress-and-fit', sources: [source], reasons: ['ALGORITHM FIXTURE ONLY: not LEGO fit data.'] }, options });
    expect(result.legal).toBe('LEGAL'); expect(result.physicalBuildVerified).toBe(false); expect(result.stable).toBe('UNKNOWN');
    const defaultScope = evaluateGrammarLegality({ compatibility: placement.compatibility, placement,
      collision: result.collision, stress: result.stress });
    expect(defaultScope.legal).toBe('UNKNOWN');
  });

  it('forbids Stud into Technic pin hole before any solid-contact assumption', () => {
    const pair = constraint(); pair.fixed.family = 'STUD'; pair.moving.family = 'PIN_HOLE';
    const placement = placementFor(pair);
    const result = evaluateGrammarLegality({ compatibility: placement.compatibility, placement });
    expect(result.connectability).toBe('ILLEGAL'); expect(result.legal).toBe('ILLEGAL');
  });

  it('keeps a collision-checker failure UNKNOWN rather than treating it as a clear pose', async () => {
    const result = await assessGrammarAssemblyCandidate({ placement: placementFor(), pairs: [constraint()], movingTransform: pose,
      collisionCheck: () => { throw new Error('Test-only proxy unavailable.'); }, options });
    expect(result.collision.status).toBe('UNKNOWN'); expect(result.legal).toBe('UNKNOWN');
  });

  it('does not combine contradictory stage claims or malformed stress provenance into LEGAL', () => {
    const placement = placementFor(), compatibility = { ...placement.compatibility, ruleId: 'C01' as const };
    const result = evaluateGrammarLegality({ compatibility, placement, options });
    expect(result.legal).toBe('UNKNOWN'); expect(result.reasons[0]).toContain('stages disagree');
    const malformed = { ...source, sha256: null };
    const unknown = evaluateGrammarLegality({ compatibility: placement.compatibility, placement,
      collision: { status: 'CLEAR', reason: 'Test-only clear pose.', sourceBoundedContactChecked: true },
      stress: { status: 'CLEAR', scope: 'verified-assembly-stress-and-fit', sources: [malformed], reasons: [] }, options });
    expect(unknown.legal).toBe('UNKNOWN');
  });
});

describe('stability is an observable ranking, not invented connections or forces', () => {
  const observation = (index = 0): StabilityConnectionObservation => ({ fixedInstanceId: 'a', fixedFeatureId: `a${index}`, movingInstanceId: 'b', movingFeatureId: `b${index}`, family: 'STUD', jointType: 'RIGID', friction: 'UNKNOWN', contactAreaLdu2: null, leverArmLdu: null });
  it('scores actual support counts without changing edges or inventing mass and friction', () => {
    const edges = [observation(), observation(1)], before = structuredClone(edges);
    const result = scoreGrammarStability({ connections: edges });
    expect(edges).toEqual(before); expect(result.createsConnections).toBe(false); expect(result.status).toBe('HEURISTIC');
    expect(result.physicalStability).toBe('UNKNOWN'); expect(result.missingFactors).toContain('Measured weight/load');
    expect(result.missingFactors).toContain('Connector friction/retention evidence');
    expect(result.heuristicScore).toBeGreaterThan(scoreGrammarStability({ connections: [observation()] }).heuristicScore!);
  });
  it('rejects duplicate edges and invalid measured quantities instead of boosting stability', () => {
    expect(scoreGrammarStability({ connections: [observation(), observation()] }).status).toBe('INVALID');
    expect(scoreGrammarStability({ connections: [observation()], measuredWeightNewtons: -1 }).status).toBe('INVALID');
    expect(scoreGrammarStability({ connections: [] }).status).toBe('INSUFFICIENT_EVIDENCE');
  });
  it('uses supplied contact, lever and load observations while retaining unknown physical capacity', () => {
    const connector = observation(); connector.contactAreaLdu2 = 400; connector.leverArmLdu = 20;
    const baseline = scoreGrammarStability({ connections: [connector], measuredWeightNewtons: 0 });
    const broadContact = structuredClone(connector); broadContact.contactAreaLdu2 = 800;
    expect(scoreGrammarStability({ connections: [broadContact], measuredWeightNewtons: 0 }).heuristicScore).toBeGreaterThan(baseline.heuristicScore!);
    const longLever = structuredClone(connector); longLever.leverArmLdu = 60;
    expect(scoreGrammarStability({ connections: [longLever], measuredWeightNewtons: 0 }).heuristicScore).toBeLessThan(baseline.heuristicScore!);
    expect(scoreGrammarStability({ connections: [connector], measuredWeightNewtons: 1 }).heuristicScore).toBeLessThan(baseline.heuristicScore!);
    expect(baseline.physicalStability).toBe('UNKNOWN');
  });
});

describe('mechanical interactions do not become structural connector edges', () => {
  const interaction = (): MechanicalInteraction => ({ interactionId: 'test-only-contact', kind: 'GEAR_MESH', participants: ['gear-a', 'gear-b'], axisA: null, axisB: null, circularPitchLdu: null,
    toothCounts: [8, 24], gearFamily: null, centreDistanceLdu: null, rotationRatio: null, engagement: 'EXTERNAL', contactEnvelope: null, sources: [], diagnostics: [] });
  it('can compute a supplied count ratio while preserving unknown mesh legality and centre geometry', () => {
    const record = interaction(), before = structuredClone(record), result = assessMechanicalInteraction(record);
    expect(record).toEqual(before); expect(result.kinematicRatio).toEqual({ numerator: -1, denominator: 3 });
    expect(result.status).toBe('UNKNOWN'); expect(result.createsStructuralConnection).toBe(false); expect(record.centreDistanceLdu).toBeNull();
  });
  it('separates external/internal ratio and rejects invalid counts or self-contact records', () => {
    expect(gearRotationRatio(8, 24, 'INTERNAL')).toEqual({ numerator: 1, denominator: 3 });
    expect(gearRotationRatio(0, 24, 'EXTERNAL')).toBeNull();
    const record = interaction(); record.participants = ['same', 'same'];
    expect(assessMechanicalInteraction(record).status).toBe('INVALID');
  });
  it('reports contradictory ratio metadata instead of silently accepting a pairing', () => {
    const record = interaction(); record.rotationRatio = { numerator: 1, denominator: 3 };
    const result = assessMechanicalInteraction(record);
    expect(result.status).toBe('UNKNOWN'); expect(result.reasons.some(reason => reason.includes('conflicts'))).toBe(true);
    expect(record.rotationRatio).toEqual({ numerator: 1, denominator: 3 });
    record.rotationRatio.denominator = 0;
    expect(assessMechanicalInteraction(record).status).toBe('INVALID');
  });
});
