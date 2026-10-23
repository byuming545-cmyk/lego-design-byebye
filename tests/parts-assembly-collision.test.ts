import { beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createBundledLDrawImporter, createBundledLDrawResolver, LDrawPartImporter } from '../src/parts/ldraw/index.js';
import { createBundledConnectionImporter } from '../src/parts/connections/index.js';
import { buildNativeCollisionProxy } from '../src/parts/assembly/proxy.js';
import { checkNativePairCollision, COLLISION_VERSION } from '../src/parts/assembly/collision.js';
import { solveAttachment } from '../src/parts/assembly/solver.js';
import { IDENTITY_TRANSFORM, axisRotation, composeTransforms } from '../src/parts/assembly/math.js';
import type { NativeAssemblyPart, NativePlacement, RigidTransform, Vector3 } from '../src/parts/assembly/types.js';

const parts = new Map<string, NativeAssemblyPart>();
const fixed = (part: NativeAssemblyPart, instanceId = 'fixed', transform = IDENTITY_TRANSFORM): NativePlacement => ({ instanceId, partId: part.partId, transform });
beforeAll(async () => {
  const geometry = await createBundledLDrawImporter(), connections = createBundledConnectionImporter(await createBundledLDrawResolver());
  for (const partId of ['3005', '3001', '3024', '87087', '99780', '11477']) parts.set(partId, { partId, geometry: await geometry.importPart(partId), connections: await connections.importPart(partId) });
});
function attached(partId: string, side = false) {
  const a = parts.get(partId)!, b = parts.get('3024')!;
  const male = a.connections.points.find(point => point.gender === 'M' && point.sections[0]?.radius === 6 && (!side || point.direction[2] < -0.5))!;
  const female = b.connections.points.find(point => point.gender === 'F')!;
  const placement = fixed(a);
  const solved = solveAttachment({ fixedPart: a, fixedPlacement: placement, fixedConnectionId: male.id, movingPart: b, movingConnectionId: female.id });
  expect(solved.status).toBe('solved');
  return { a, b, placement, solved };
}

describe('source-derived collision proxy', () => {
  it('closes only internal native seams fully covered by source faces', () => {
    const part = parts.get('3005')!, proxy = buildNativeCollisionProxy(part, fixed(part));
    expect(proxy.status).toBe('ready');
    expect(proxy.proxy?.topology.status).toBe('closed-oriented-chain');
    expect(proxy.proxy?.topology.sourceTriangles).toBe(part.geometry.mesh!.indices.length / 3);
    expect(proxy.proxy?.topology.internalCaps).toBeGreaterThan(0);
    expect(proxy.proxy?.topology.sourceCoveredCapArea).toBeGreaterThan(0);
    expect(proxy.proxy?.evidence.sourceFiles).toEqual(part.geometry.source.files.map(file => ({ path: file.path, sha256: file.sha256 })));
  });

  it('blocks an unresolved real curved shell instead of filling an external hole', () => {
    const part = parts.get('11477')!, proxy = buildNativeCollisionProxy(part, fixed(part));
    expect(proxy.status).toBe('blocked');
    expect(proxy.reasonCode).toBe('open-external-shell');
    expect(proxy.proxy).toBeUndefined();
  });

  it('blocks mirrored/scaled placements and unverifiable geometry source records', () => {
    const original = parts.get('3005')!, changed = structuredClone(original);
    changed.geometry.source.integrity = 'not-manifested';
    expect(buildNativeCollisionProxy(changed, fixed(changed)).reasonCode).toBe('unverified-geometry-source');
    const reflected: RigidTransform = { rotation: [-1, 0, 0, 0, 1, 0, 0, 0, 1], translation: [0, 0, 0] };
    expect(buildNativeCollisionProxy(original, fixed(original, 'reflection', reflected)).reasonCode).toBe('non-rigid-transform');
    expect(buildNativeCollisionProxy(original, { ...fixed(original), partId: '3024' }).reasonCode).toBe('identity-mismatch');
  });

  it('invalidates the native proxy cache when source trust changes', () => {
    const part = structuredClone(parts.get('3005')!);
    expect(buildNativeCollisionProxy(part, fixed(part)).status).toBe('ready');
    part.geometry.source.integrity = 'not-manifested';
    expect(buildNativeCollisionProxy(part, fixed(part)).status).toBe('blocked');
  });
});

describe('connection-aware native solid collision', () => {
  it.each(['3005', '3001'])('accepts source stud/underside insertion for %s at all four solved quarter turns', (partId) => {
    const { a, b, placement, solved } = attached(partId);
    expect(solved.candidates.map(candidate => candidate.twistDeg)).toEqual([0, 90, 180, 270]);
    for (const candidate of solved.candidates) {
      const result = checkNativePairCollision(a, placement, b, fixed(b, 'moving', candidate.transform), candidate.penetrationZone);
      expect(result.status, result.reason).toBe('clear');
      expect(result.proof.closedSourceProxies).toBe(true);
      expect(result.proof.completeSurfacePartition).toBe(true);
      expect(result.proof.containmentChecked).toBe(true);
      expect(result.checkedSurfacePatches).toBeGreaterThan(0);
      expect(result.proof.wholePairExempted).toBe(false);
      expect(result.proof.penetrationZoneValidated).toBe(true);
      expect(result.collisionVersion).toBe(COLLISION_VERSION);
    }
  });

  it.each(['87087', '99780'])('accepts true SNOT/bracket side studs for %s without exempting its whole body', (partId) => {
    const { a, b, placement, solved } = attached(partId, true);
    for (const candidate of solved.candidates) {
      const result = checkNativePairCollision(a, placement, b, fixed(b, 'moving', candidate.transform), candidate.penetrationZone);
      expect(result.status, result.reason).toBe('clear');
      expect(result.proof.wholePairExempted).toBe(false);
    }
  });

  it('rejects lateral stud/wall intrusion even though the selected source connection zone exists', () => {
    const { a, b, placement, solved } = attached('3005'), candidate = solved.candidates[0];
    const wrong = structuredClone(candidate.transform); wrong.translation[0] += 0.5;
    const result = checkNativePairCollision(a, placement, b, fixed(b, 'moving', wrong), candidate.penetrationZone);
    expect(result.status).toBe('collision');
    expect(result.reasonCode).toBe('solid-volume-intersection');
    expect(result.witness).toBeDefined();
  });

  it('rejects excessive insertion through the receiving plate roof', () => {
    const { a, b, placement, solved } = attached('3005'), candidate = solved.candidates[0];
    const wrong = structuredClone(candidate.transform); wrong.translation[1] += 0.5;
    expect(checkNativePairCollision(a, placement, b, fixed(b, 'moving', wrong), candidate.penetrationZone).status).toBe('collision');
  });

  it('rejects coincident copies, including a non-target neighbour with no connection-zone exemption', () => {
    const part = parts.get('3005')!;
    const result = checkNativePairCollision(part, fixed(part), part, fixed(part, 'unrelated-neighbour'));
    expect(result.status).toBe('collision');
    expect(result.reasonCode).toBe('identical-positive-volume-solids');
    expect(result.triangleTests).toBe(0);
    expect(result.proof.closedSourceProxies).toBe(true);
    expect(result.proof.wholePairExempted).toBe(false);
  });

  it('uses exact closed-solid content rather than a part-ID special case for coincidence', async () => {
    const part = parts.get('3024')!, sameMeshDifferentIdentity = structuredClone(part);
    // Explicit test-only alias: no such part is added to the production library.
    sameMeshDifferentIdentity.partId = 'test-only-content-alias';
    sameMeshDifferentIdentity.geometry.partId = sameMeshDifferentIdentity.partId;
    sameMeshDifferentIdentity.connections.partId = sameMeshDifferentIdentity.partId;
    const result = checkNativePairCollision(part, fixed(part), sameMeshDifferentIdentity, fixed(sameMeshDifferentIdentity, 'alias'));
    expect(result.status).toBe('collision');
    expect(result.reasonCode).toBe('identical-positive-volume-solids');
    expect(result.triangleTests).toBe(0);
  });

  it('does not accept an enlarged/fabricated penetration zone to hide a collision', () => {
    const { a, b, placement, solved } = attached('3005'), candidate = solved.candidates[0];
    const result = checkNativePairCollision(a, placement, b, fixed(b, 'moving', candidate.transform), { ...candidate.penetrationZone, radius: 600 });
    expect(result.status).toBe('blocked');
    expect(result.reasonCode).toBe('unverified-penetration-zone');
  });

  it('reuses only identical content certificates and protects cached proofs from mutation', () => {
    const { a, b, placement, solved } = attached('3005'), candidate = solved.candidates[0];
    const moving = fixed(b, 'moving-cache', candidate.transform);
    const first = checkNativePairCollision(a, placement, b, moving, candidate.penetrationZone);
    const again = checkNativePairCollision(a, placement, b, { ...moving, instanceId: 'same-physical-placement' }, candidate.penetrationZone);
    expect(again.status).toBe('clear');
    expect(again.proof.reusedCertificate).toBe(true);
    expect(again.proof.certificateKey).toBe(first.proof.certificateKey);
    again.proof.sourceEvidence.length = 0;
    expect(checkNativePairCollision(a, placement, b, moving, candidate.penetrationZone).proof.sourceEvidence).toHaveLength(2);
    const changed = structuredClone(a); changed.geometry.source.integrity = 'not-manifested';
    expect(checkNativePairCollision(changed, placement, b, moving, candidate.penetrationZone).status).toBe('blocked');
  });

  it('does not certify a zone moved away from otherwise correctly placed source endpoints', () => {
    const { a, b, placement, solved } = attached('3005'), candidate = solved.candidates[0];
    const forged = structuredClone(candidate.penetrationZone); forged.center[0] += 100;
    const result = checkNativePairCollision(a, placement, b, fixed(b, 'moving', candidate.transform), forged);
    expect(result.status).toBe('blocked');
    expect(result.reasonCode).toBe('penetration-zone-transform-mismatch');
    expect(result.proof.penetrationZoneValidated).toBe(false);
  });

  it('preserves clearance under a common proper world rotation and translation without changing source geometry', () => {
    const { a, b, placement, solved } = attached('3005'), candidate = solved.candidates[0];
    const before = JSON.stringify([a.geometry.mesh, b.geometry.mesh]);
    const world: RigidTransform = { rotation: axisRotation([0.2, 0.7, 0.3], 37), translation: [127, -53, 18] };
    const result = checkNativePairCollision(a, { ...placement, transform: composeTransforms(world, placement.transform) }, b,
      fixed(b, 'moving', composeTransforms(world, candidate.transform)));
    expect(result.status, result.reason).toBe('clear');
    expect(JSON.stringify([a.geometry.mesh, b.geometry.mesh])).toBe(before);
  });
});

/** Synthetic closed cubes exist only in tests to isolate complete containment. */
async function testOnlyCube(partId: string, half: number): Promise<NativeAssemblyPart> {
  const p = (x: number, y: number, z: number) => `${x * half} ${y * half} ${z * half}`;
  const quads: Vector3[][] = [
    [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]],
    [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]],
    [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]],
    [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]],
    [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]],
    [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]],
  ];
  const body = '0 Test-only closed solid\n0 !LICENSE Licensed under CC BY 4.0 : see CAreadme.txt\n0 BFC CERTIFY CCW\n' + quads.map(quad => `4 16 ${quad.map(vertex => p(...vertex)).join(' ')}`).join('\n');
  const file = `parts/${partId}.dat`, importer = new LDrawPartImporter({ revision: 'test-only', sourceRoot: 'https://example.invalid/test-only/',
    expectedHashes: { [file]: createHash('sha256').update(body).digest('hex') }, async readText(path) { return path === file ? body : undefined; } });
  return { partId, geometry: await importer.importPart(partId), connections: { partId, status: 'missing', units: 'LDU', coordinateSystem: 'LDraw-native', physicalVerified: false, points: [], issues: [], sourceFiles: [], license: 'CC-BY-SA-4.0' } };
}

describe('closed-volume containment proof', () => {
  it('detects full containment with zero surface intersections in both argument orders', async () => {
    const outer = await testOnlyCube('test-only-outer', 30), inner = parts.get('3024')!;
    for (const [a, b] of [[outer, inner], [inner, outer]]) {
      const result = checkNativePairCollision(a, fixed(a), b, fixed(b, 'contained'));
      expect(result.status, result.reason).toBe('collision');
      expect(result.triangleTests).toBe(0);
    }
  });

  it('detects a thin partial solid overlap and allows exact surface contact', async () => {
    const a = await testOnlyCube('test-only-box-a', 10), b = await testOnlyCube('test-only-box-b', 10);
    const placement = (x: number) => fixed(b, 'moving', { ...IDENTITY_TRANSFORM, translation: [x, 0, 0] });
    expect(checkNativePairCollision(a, fixed(a), b, placement(19.99)).status).toBe('collision');
    expect(checkNativePairCollision(a, fixed(a), b, placement(19.99989)).status).toBe('collision');
    expect(checkNativePairCollision(a, fixed(a), b, placement(20)).status).toBe('clear');
    expect(checkNativePairCollision(a, fixed(a), b, placement(21)).status).toBe('clear');
  });
});
