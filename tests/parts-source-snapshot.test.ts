import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import express from 'express';
import { describe, it, expect } from 'vitest';
import { SourceSnapshotGuard, sourceSnapshotDigest, sourceSnapshotMiddleware } from '../src/parts/sourceSnapshot.js';
import { NativePartRepository } from '../src/parts/assembly/source.js';

describe('immutable runtime catalogue snapshot', () => {
  it('rejects old repository caches and HTTP requests after a source change; restart adopts the new snapshot', async () => {
    const root=await mkdtemp(path.join(tmpdir(),'catalogue-snapshot-'));
    const roots={ldrawRoot:path.join(root,'ldraw'),shadowRoot:path.join(root,'shadow')};
    for(const [target,source] of [[roots.ldrawRoot,'ldraw'],[roots.shadowRoot,'shadow']]) {
      await mkdir(target); await writeFile(path.join(target,'manifest.json'),await readFile(new URL(`../data/parts-foundation/${source}/manifest.json`,import.meta.url)));
    }
    const guard=new SourceSnapshotGuard(roots);
    const repo=new NativePartRepository({geometryDirectory:roots.ldrawRoot,shadowDirectory:roots.shadowRoot});
    const count=(await repo.listIds()).length;
    const app=express();app.use(sourceSnapshotMiddleware(guard));app.get('/catalogue',(_q,r)=>r.json({snapshot:guard.digest}));
    const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
    try {
      const address=server.address() as {port:number};const url=`http://127.0.0.1:${address.port}/catalogue`;
      const before=await fetch(url);expect(before.status).toBe(200);expect(before.headers.get('cache-control')).toBe('no-store');
      const lock=path.join(roots.ldrawRoot,'.import.lock');await writeFile(lock,'pending import');
      expect((await fetch(url)).status).toBe(503);await rm(lock);
      const manifest=path.join(roots.ldrawRoot,'manifest.json');await writeFile(manifest,(await readFile(manifest,'utf8'))+'\n');
      const changed=await fetch(url);expect(changed.status).toBe(503);expect((await changed.json()).code).toBe('SOURCE_SNAPSHOT_RESTART_REQUIRED');
      await expect(repo.listIds()).rejects.toMatchObject({code:'SOURCE_SNAPSHOT_RESTART_REQUIRED'});
      const restarted=new NativePartRepository({geometryDirectory:roots.ldrawRoot,shadowDirectory:roots.shadowRoot});
      expect(await restarted.listIds()).toHaveLength(count);
      expect(restarted.snapshotDigest).toBe(sourceSnapshotDigest(roots));expect(restarted.snapshotDigest).not.toBe(guard.digest);
    } finally { await new Promise<void>((r,j)=>server.close(e=>e?j(e):r()));await rm(root,{recursive:true,force:true}); }
  });
});
