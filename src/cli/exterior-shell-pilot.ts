import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { GrammarAssemblyService } from '../parts/grammar/service.js';
import { exportNativeAssemblyBomCsv, exportNativeAssemblyJson, exportNativeAssemblyLDraw } from '../parts/assembly/documents.js';
import { checkNativePairCollision, COLLISION_VERSION } from '../parts/assembly/collision.js';
import { solveAttachment } from '../parts/assembly/solver.js';
import { nativePartSourceHash } from '../parts/assembly/source.js';
import { placementCollisionClass, type NativePlacement, type RigidTransform } from '../parts/assembly/types.js';

const out = 'artifacts/exterior-shell';
const identity: RigidTransform = { rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1], translation: [0, 0, 0] };
const placement = (instanceId: string, partId: string, transform: RigidTransform, collisionClass?: 'exterior-shell'): NativePlacement => ({ instanceId, partId, transform, ...(collisionClass ? { collisionClass } : {}) });

async function main() {
  const service = new GrammarAssemblyService();
  await service.ready();
  const fixed = (await service.getPart('3001'))!, moving = (await service.getPart('11477'))!;
  const fixedPoint = fixed.connections.points.find(point => point.id === 'p/stud.dat:8:0')!;
  const movingPoint = moving.connections.points.find(point => point.id === 'parts/s/11477s01.dat:8:0')!;
  const structuralAttach = await service.attach({ partA: '3001', connectionA: fixedPoint.id, partB: '11477', connectionB: movingPoint.id, twistDegrees: 0 });
  const exteriorAttach = await service.attach({ partA: '3001', connectionA: fixedPoint.id, partB: '11477', connectionB: movingPoint.id, twistDegrees: 0, collisionClass: 'exterior-shell' });
  const solved = solveAttachment({ fixedPart: fixed, fixedPlacement: placement('root', '3001', identity), fixedConnectionId: fixedPoint.id, movingPart: moving, movingConnectionId: movingPoint.id });
  if (solved.status !== 'solved') throw new Error(`Solver failed: ${solved.reason}`);
  const candidate = solved.candidates[0];
  const exteriorCollision = checkNativePairCollision(fixed, placement('root', '3001', identity), moving, placement('p-1', '11477', candidate.transform, 'exterior-shell'), candidate.penetrationZone);
  const generated = await service.generate({ module: 'exterior-shell', requiredPartIds: ['3001', '11477'] });
  if (generated.status !== 'generated' || !generated.model) throw new Error(`Generation failed: ${generated.reasons.join(' | ')}`);
  const json = exportNativeAssemblyJson(generated.model);
  const imported = await service.importModel(JSON.parse(json));
  if (imported.status !== 'VALID') throw new Error(`Reimport failed: ${imported.reasons.join(' | ')}`);
  await mkdir(out, { recursive: true });
  await writeFile(path.join(out, 'model.json'), json);
  await writeFile(path.join(out, 'model.ldr'), exportNativeAssemblyLDraw(generated.model));
  await writeFile(path.join(out, 'bom.csv'), exportNativeAssemblyBomCsv(generated.model));
  const movingPlacement = generated.model.placements.find(item => item.partId === '11477')!;
  const verification = {
    schemaVersion: 'exterior-shell-pilot-1', generatedAt: new Date().toISOString(), collisionVersion: COLLISION_VERSION,
    structural: { accepted: structuralAttach.accepted, rejectionCodes: structuralAttach.rejections.map(issue => issue.code) },
    exterior: { accepted: exteriorAttach.accepted, placementClass: placementCollisionClass(movingPlacement), graphValid: (await service.engine.validateGraph(exteriorAttach.graph!)).valid },
    collision: { status: exteriorCollision.status, reasonCode: exteriorCollision.reasonCode, classification: exteriorCollision.classification, triangleTests: exteriorCollision.triangleTests, proof: exteriorCollision.proof },
    model: { module: generated.model.module, placements: generated.model.placements.length, edges: generated.model.edges.length, jsonBytes: Buffer.byteLength(json), jsonSha256: createHash('sha256').update(json).digest('hex'), warnings: generated.model.warnings, sourceHashes: Object.fromEntries(generated.model.placements.map(item => [item.partId, nativePartSourceHash(item.partId === '3001' ? fixed : moving)])) },
    reimport: { status: imported.status, reasons: imported.reasons, collisionClass: imported.model?.placements.find(item => item.partId === '11477')?.collisionClass },
    limitations: ['只验证最终姿态的真实表面交叉/穿透和来源 seat 接触；不认证闭合实体、厚度、结构支撑、保持力、材料或实物承重。', '安装路径未检查；终点无交叉不等于整个安装过程可行。', '18973 仍被 seat 外表面/接触策略阻塞，本轮不作为通过样例。'],
  };
  await writeFile(path.join(out, 'verification.json'), JSON.stringify(verification, null, 2));
  console.log(JSON.stringify({ generated: generated.status, placements: generated.model.placements.length, edges: generated.model.edges.length, bytes: Buffer.byteLength(json), reimport: imported.status, structuralAccepted: structuralAttach.accepted, exteriorAccepted: exteriorAttach.accepted, exteriorCollision: exteriorCollision.classification }, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
