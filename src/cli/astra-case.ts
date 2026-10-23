import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadAstraCase, reproduceAstraCase } from '../parts/handoff/cases.js';
import { NativePartRepository } from '../parts/assembly/source.js';
import { buildNativeCollisionProxy } from '../parts/assembly/proxy.js';
import { IDENTITY_TRANSFORM } from '../parts/assembly/math.js';

const args = process.argv.slice(2);
if (args.length < 1 || args.length > 2 || args[1] !== undefined && args[1] !== '--debug') throw new Error('Usage: npm run astra:case -- CASE_ID [--debug]');
const record = await loadAstraCase(args[0]);
const repository = new NativePartRepository();
const result = await reproduceAstraCase(record, repository);
if (args[1] === '--debug') {
  const native = await Promise.all(record.affectedParts.filter(part => part.identitySystem === 'ldraw').map(part => repository.getPart(part.partId)));
  const directory = path.resolve('artifacts/astra-debug'); await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, `${record.caseId}.json`), JSON.stringify({ diagnosticOnly: true, coordinateSystem: 'LDraw-native', record, replay: result,
    placementFrames: [{ instanceId: 'case-fixed', partId: record.replay.partId ?? null, transform: record.replay.partId ? IDENTITY_TRANSFORM : null }, ...(record.replay.fixturePartId ? [{ instanceId: 'case-moving', partId: record.replay.fixturePartId, transform: record.currentTransform }] : [])],
    nativeSourceAssets: native.map(part => {
      const proxy = buildNativeCollisionProxy(part!, { instanceId: 'debug-local-source', partId: part!.partId, transform: IDENTITY_TRANSFORM });
      return { partId: part!.partId, mesh: part!.geometry.mesh, bounds: part!.geometry.bounds, connections: part!.connections.points,
        collisionProxy: { status: proxy.status, reason: proxy.reason, topology: proxy.proxy?.topology, triangles: proxy.proxy?.triangles.map(triangle => triangle.vertices) } };
    }) }, null, 2) + '\n');
}
console.info(JSON.stringify(result, null, 2));
if (!result.reproduced) process.exitCode = 2;
