import { beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { NativePartRepository } from '../src/parts/assembly/source.js';
import type { NativeAssemblyPart, NativePlacement, RigidTransform } from '../src/parts/assembly/types.js';
import { GrammarAssemblyService } from '../src/parts/grammar/service.js';
import { buildNativeCollisionProxy } from '../src/parts/assembly/proxy.js';
import { checkNativePairCollision, COLLISION_VERSION } from '../src/parts/assembly/collision.js';
import { solveAttachment } from '../src/parts/assembly/solver.js';
import { exportNativeAssemblyJson } from '../src/parts/assembly/documents.js';

const repository = new NativePartRepository();
const service = new GrammarAssemblyService({ repository, dataDir: '/tmp/exterior-shell-test-data' });
const identity: RigidTransform = { rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1], translation: [0, 0, 0] };
const placement = (partId: string, transform: RigidTransform = identity, collisionClass?: 'exterior-shell'): NativePlacement => ({ instanceId: partId, partId, transform: { rotation: [...transform.rotation], translation: [...transform.translation] }, ...(collisionClass ? { collisionClass } : {}) });
let brick: NativeAssemblyPart, plate: NativeAssemblyPart, tile: NativeAssemblyPart, panel: NativeAssemblyPart, windscreen: NativeAssemblyPart;
beforeAll(async () => {
  await service.ready();
  [brick, plate, tile, panel, windscreen] = await Promise.all([
    repository.getPart('3001').then(part => part!),
    repository.getPart('3024').then(part => part!),
    repository.getPart('3070b').then(part => part!),
    repository.getPart('11477').then(part => part!),
    repository.getPart('18973').then(part => part!),
  ]);
}, 90_000);

describe('exterior shell collision contract', () => {
  it('keeps the structural contract blocked while admitting the same panel only when exterior is explicitly selected', async () => {
    const structural = await service.attach({ partA: '3001', connectionA: 'p/stud.dat:8:0', partB: '11477', connectionB: 'parts/s/11477s01.dat:8:0', twistDegrees: 0 });
    expect(structural.accepted).toBe(false);
    expect(structural.rejections.some(issue => issue.code === 'part-or-interface-blocked')).toBe(true);
    const exterior = await service.attach({ partA: '3001', connectionA: 'p/stud.dat:8:0', partB: '11477', connectionB: 'parts/s/11477s01.dat:8:0', twistDegrees: 0, collisionClass: 'exterior-shell' });
    expect(exterior.accepted).toBe(true);
    expect(exterior.graph?.placements.find(item => item.partId === '11477')?.collisionClass).toBe('exterior-shell');
    expect((await service.engine.validateGraph(exterior.graph!)).valid).toBe(true);
  });

  it('builds source triangles with no caps, volume or containment and certifies only surface clearance', async () => {
    const structural = buildNativeCollisionProxy(panel, placement('11477'));
    const exterior = buildNativeCollisionProxy(panel, placement('11477', identity, 'exterior-shell'));
    expect(structural.status).toBe('blocked');
    expect(exterior.status).toBe('ready');
    expect(exterior.proxy?.topology).toMatchObject({ status: 'exterior-source-surface', signedVolume: null, internalCaps: 0, sourceCoveredCapArea: 0 });
    expect(exterior.proxy?.topology.boundarySegments).toBeGreaterThan(0);

    const fixedPoint = brick.connections.points.find(point => point.id === 'p/stud.dat:8:0')!;
    const movingPoint = panel.connections.points.find(point => point.gender === 'F' && point.dimensionsResolved)!;
    const solved = solveAttachment({ fixedPart: brick, fixedPlacement: placement('3001'), fixedConnectionId: fixedPoint.id, movingPart: panel, movingConnectionId: movingPoint.id });
    expect(solved.status).toBe('solved');
    const candidate = solved.candidates[0];
    const result = checkNativePairCollision(brick, placement('3001'), panel, placement('11477', candidate.transform, 'exterior-shell'), candidate.penetrationZone);
    expect(result.status).toBe('clear');
    expect(result.classification).toBe('EXTERIOR_SURFACE_CLEAR');
    expect(result.collisionVersion).toBe(COLLISION_VERSION);
    expect(result.proof).toMatchObject({ closedSourceProxies: false, exteriorSourceSurfaces: true, openSurface: true, surfaceCrossingChecked: true, structuralSupport: false, containmentChecked: false, wholePairExempted: false });
    expect(result.proof.topology[1]).toMatchObject({ status: 'exterior-source-surface', signedVolume: null, internalCaps: 0 });
  });

  it('confirms the real 18973 exterior pose remains a collision, not a fake clearance', () => {
    const fixedPoint = brick.connections.points.find(point => point.id === 'p/stud.dat:8:0')!;
    const movingPoint = windscreen.connections.points.find(point => point.gender === 'F' && point.dimensionsResolved)!;
    const solved = solveAttachment({ fixedPart: brick, fixedPlacement: placement('3001'), fixedConnectionId: fixedPoint.id, movingPart: windscreen, movingConnectionId: movingPoint.id });
    expect(solved.status).toBe('solved');
    const result = checkNativePairCollision(brick, placement('3001'), windscreen, placement('18973', solved.candidates[0].transform, 'exterior-shell'), solved.candidates[0].penetrationZone);
    expect(result.status).toBe('collision');
    expect(result.classification).toBe('EXTERIOR_SURFACE_COLLISION');
    expect(result.witness).toBeDefined();
    expect(result.proof.surfaceCrossingChecked).toBe(true);
  });

  it('retains a genuine panel-through-brick collision and an exterior shell-shell crossing', () => {
    const fixedPoint = brick.connections.points.find(point => point.id === 'p/stud.dat:8:4')!;
    const movingPoint = panel.connections.points.find(point => point.gender === 'F' && point.dimensionsResolved)!;
    const solved = solveAttachment({ fixedPart: brick, fixedPlacement: placement('3001'), fixedConnectionId: fixedPoint.id, movingPart: panel, movingConnectionId: movingPoint.id });
    expect(solved.status).toBe('solved');
    const candidate = solved.candidates[0];
    const through = checkNativePairCollision(brick, placement('3001'), panel, placement('11477', candidate.transform, 'exterior-shell'), candidate.penetrationZone);
    expect(through.status).toBe('collision');
    expect(through.classification).toBe('EXTERIOR_SURFACE_COLLISION');
    expect(through.witness).toBeDefined();
    expect(through.proof.coplanarContacts).toBeGreaterThan(0);

    const overlapping = placement('11477', { rotation: identity.rotation, translation: [0, 2, 0] }, 'exterior-shell');
    const shellShell = checkNativePairCollision(panel, placement('11477', identity, 'exterior-shell'), panel, overlapping);
    expect(shellShell.status).toBe('collision');
    expect(shellShell.classification).toBe('EXTERIOR_SURFACE_COLLISION');
    expect(shellShell.proof.closedSourceProxies).toBe(false);

    const far = checkNativePairCollision(panel, placement('11477', identity, 'exterior-shell'), panel, placement('11477', { rotation: identity.rotation, translation: [200, 0, 0] }, 'exterior-shell'));
    expect(far).toMatchObject({ status: 'clear', reasonCode: 'exterior-surface-broadphase', classification: 'EXTERIOR_SURFACE_CLEAR', triangleTests: 0 });
    expect(far.proof.broadPhaseOnly).toBe(true);
  });

  it('uses the surface contract for generation, export and reimport without upgrading the structural certificate', async () => {
    const result = await service.generate({ module: 'exterior-shell', requiredPartIds: ['3001', '11477'] });
    expect(result.status).toBe('generated');
    const model = result.model!;
    expect(model.placements.find(item => item.partId === '11477')?.collisionClass).toBe('exterior-shell');
    expect(model.warnings.some(warning => warning.includes('exterior-shell'))).toBe(true);
    const json = exportNativeAssemblyJson(model);
    const reimported = await service.importModel(JSON.parse(json));
    expect(reimported.status).toBe('VALID');
    expect(reimported.model?.placements.find(item => item.partId === '11477')?.collisionClass).toBe('exterior-shell');
    expect(json.length).toBeGreaterThan(10_000);

    const downgraded = JSON.parse(json);
    delete downgraded.placements.find((item: any) => item.partId === '11477').collisionClass;
    const { contentSha256: _oldHash, ...content } = downgraded;
    downgraded.contentSha256 = createHash('sha256').update(JSON.stringify(content)).digest('hex');
    const rejected = await service.importModel(downgraded);
    expect(rejected.status).not.toBe('VALID');
    expect(rejected.reasons.some(reason => /part|interface|collision|structural/i.test(reason))).toBe(true);
  });

  it('does not use exterior availability to grant C01 to a Bar with no stud or antistud', async () => {
    const bar = (await repository.getPart('30374'))!;
    const admission = await service.getGrammarAdmission('30374');
    expect(bar.partId).toBe('30374');
    expect(admission?.exteriorGeneratable).toBe(false);
    expect(admission?.capability.exteriorRuleIds).not.toContain('ldcad-standard-stud-to-capped-underside-v1');
    expect(admission?.capability.exteriorAllowedConnectionIds ?? []).toHaveLength(0);
    const windscreenAdmission = await service.getGrammarAdmission('18973');
    expect(windscreenAdmission?.generationEligible).toBe(false);
    expect(windscreenAdmission?.exteriorGeneratable).toBe(true);
    const closedAdmission = await service.getGrammarAdmission('3001');
    expect(closedAdmission?.generationEligible).toBe(true);
    expect(closedAdmission?.exteriorGeneratable).toBe(false);
    expect(closedAdmission?.capability.exteriorAllowedConnectionIds ?? []).toEqual([]);
  });
});
