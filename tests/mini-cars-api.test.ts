import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/api/app.js';
import { miniDigest } from '../src/mini-cars/catalog.js';

let base:string,dir:string,server:ReturnType<ReturnType<typeof createApp>['listen']>;
const post=(route:string,body:unknown)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
beforeAll(async()=>{dir=await mkdtemp(path.join(tmpdir(),'mini-api-'));server=createApp({staticDir:false,partsDataDir:dir}).listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;});
afterAll(async()=>{server.close();await once(server,'close');await rm(dir,{recursive:true,force:true});});
describe('independent appearance API',()=>{
  it('generates full car, saves, exports and reopens with source-bound colour-aware BOM',async()=>{
    const generated=await post('/api/mini-cars/generate',{style:'gt',color:'blue',seed:'api-car',spoiler:false});expect(generated.status).toBe(200);
    const p=await generated.json();expect(p.model.state).toBe('APPEARANCE_DRAFT');expect(p.model.wheels).toHaveLength(4);expect(p.assets['18977'].mesh.positions.length).toBeGreaterThan(0);
    expect(p.model.placements.length).toBeGreaterThan(32);expect(p.model.checks.collision).toBe('UNKNOWN');
    expect((await post('/api/mini-cars/models',{model:p.model})).status).toBe(200);
    const exported=await fetch(base+`/api/mini-cars/models/${p.model.id}/export`);expect(await exported.json()).toEqual(p.model);
    const bom=await fetch(base+`/api/mini-cars/models/${p.model.id}/export?format=bom`);expect(await bom.text()).toContain('NOT_VERIFIED');
    const reopened=await fetch(base+`/api/mini-cars/models/${p.model.id}`);expect((await reopened.json()).model).toEqual(p.model);
    const imported=await post('/api/mini-cars/models/import',{content:JSON.stringify(p.model)});expect((await imported.json()).model).toEqual(p.model);
    const listing=await fetch(base+'/api/mini-cars/models');expect((await listing.json()).models[0].id).toBe(p.model.id);
    const strict=await post('/api/parts-foundation/assembly/models/import',{content:JSON.stringify(p.model)});expect(strict.status).toBe(400);
    p.model.wheels[0].fit='VERIFIED';const {contentSha256:_old,...content}=p.model;p.model.contentSha256=miniDigest(content);
    expect((await post('/api/mini-cars/models/import',{content:JSON.stringify(p.model)})).status).toBe(409);
  },30000);
  it('rejects fake authority and malformed uploads, while keeping all legacy generation gates blocked',async()=>{
    expect((await post('/api/mini-cars/generate',{style:'sprint',color:'red',seed:'a',spoiler:true,generatable:true})).status).toBe(400);
    expect((await post('/api/mini-cars/models/import',{content:'not-json'})).status).toBe(400);
    for(const route of ['/api/generate','/api/speed/generate','/api/automotive/design'])expect((await post(route,{})).status).toBe(409);
  });
});
