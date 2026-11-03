import { describe, it, expect } from 'vitest';
import { assessSourceSurfaceCell, checkNativePairCollision } from '../src/parts/assembly/collision.js';
import { NativePartRepository } from '../src/parts/assembly/source.js';
import { IDENTITY_TRANSFORM } from '../src/parts/assembly/math.js';
import type { Vector3 } from '../src/parts/assembly/types.js';
const cell: Vector3[] = [[0,0,0],[2,0,0],[0,2,0]];
describe('complete surface cell legality (algorithm fixtures only)', () => {
  it('propagates unresolved winding without granting a clearance certificate', () => {
    expect(assessSourceSurfaceCell(cell, () => 'unknown', () => true).status).toBe('blocked');
  });
  it('does not issue or reuse a clearance certificate for a real unresolved structural proxy', async () => {
    const repository=new NativePartRepository();
    const a=(await repository.getPart('3001'))!, b=(await repository.getPart('11477'))!;
    const pa={instanceId:'a',partId:'3001',transform:IDENTITY_TRANSFORM},pb={instanceId:'b',partId:'11477',transform:IDENTITY_TRANSFORM};
    for(let n=0;n<2;n++){
      const result=checkNativePairCollision(a,pa,b,pb);
      expect(result.status).toBe('blocked');expect(result.proof.certificateKey).toBeUndefined();expect(result.proof.reusedCertificate).toBe(false);
    }
  });
  it('requires the entire interior cell to fit the convex seat, not only its centroid', () => {
    expect(assessSourceSurfaceCell(cell, () => 'inside', p => p[0] < 1).status).toBe('collision');
    expect(assessSourceSurfaceCell(cell, () => 'inside', () => true).status).toBe('clear');
  });
  it('distinguishes boundary contact, outside surface and actual out-of-seat penetration', () => {
    expect(assessSourceSurfaceCell(cell, () => 'boundary', () => false).status).toBe('clear');
    expect(assessSourceSurfaceCell(cell, () => 'outside', () => false).status).toBe('clear');
    expect(assessSourceSurfaceCell(cell, () => 'inside', () => false).status).toBe('collision');
  });
});
