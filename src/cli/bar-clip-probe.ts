import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NativePartRepository } from '../parts/assembly/source.js';
import type { NativeAssemblyPart } from '../parts/assembly/types.js';
import { checkConnectionCompatibility } from '../parts/assembly/compatibility.js';
import { solveAttachment } from '../parts/assembly/solver.js';
import { checkNativePairCollision } from '../parts/assembly/collision.js';
import { add, scale } from '../parts/assembly/math.js';
import { assessGrammarAdmission } from '../parts/grammar/admission.js';
import { adaptImportedConnection, isSourceDeclaredBarEndpoint, isSourceDeclaredClipEndpoint } from '../parts/grammar/sources.js';
import { partDescriptionFor } from '../parts/connections/importer.js';
import type { ImportedConnectionPoint } from '../parts/connections/types.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const repository = new NativePartRepository();
const ids = ['30374', '48729b', '60470b', '2412b'] as const;
const parts = new Map<string, NativeAssemblyPart>();
for (const id of ids) {
  const part = await repository.getPart(id);
  if (!part) throw new Error(`Pinned source part ${id} is unavailable.`);
  parts.set(id, part);
}
const part = (id: string) => parts.get(id)!;
const clipOf = (id: string) => part(id).connections.points.find(isSourceDeclaredClipEndpoint)!;
const barOf = (id: string) => part(id).connections.points.find(isSourceDeclaredBarEndpoint)!;
const point = (p: ImportedConnectionPoint) => {
  const connector = adaptImportedConnection(p), description = partDescriptionFor(p);
  return {
    id: p.id, family: connector.family, role: connector.role, profile: connector.profile,
    gender: p.gender, radiusLdu: connector.dimensions.radiusLdu, lengthLdu: connector.dimensions.lengthLdu,
    insertionRangeLdu: connector.insertionRangeLdu, slideAllowed: connector.slideAllowed,
    rotationAllowed: connector.rotationAllowed, angleLimitsDeg: connector.angleLimitsDeg,
    coverage: connector.coverage, policy: connector.matchingPolicy,
    sourceIds: connector.sources.map(source => source.id),
    description: description ? { text: description.text, line: description.line, path: description.source.path, sha256: description.source.sha256 } : null,
  };
};
const admission = (id: string) => {
  const result = assessGrammarAdmission(part(id));
  return {
    partId: id, generationEligible: result.generationEligible, connectable: result.connectable,
    collisionGeometryReady: result.collisionGeometryReady, reasonCodes: result.reasonCodes,
    ruleIds: result.capability?.ruleIds ?? [], allowedConnectionIds: result.capability?.allowedConnectionIds ?? [],
  };
};
const pair = (fixedId: string, movingId: string, fixedPoint: ImportedConnectionPoint, movingPoint: ImportedConnectionPoint) => {
  const compatibility = checkConnectionCompatibility(fixedPoint, movingPoint);
  const fixedPlacement = { instanceId: 'fixed', partId: fixedId, transform: { rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1] as [number, number, number, number, number, number, number, number, number], translation: [0, 0, 0] as [number, number, number] } };
  const solved = solveAttachment({ fixedPart: part(fixedId), fixedPlacement, fixedConnectionId: fixedPoint.id, movingPart: part(movingId), movingConnectionId: movingPoint.id });
  const collisionResults = solved.candidates.map(candidate => ({ twistDeg: candidate.twistDeg, result: checkNativePairCollision(part(fixedId), fixedPlacement, part(movingId), { instanceId: 'moving', partId: movingId, transform: candidate.transform }, candidate.penetrationZone) }));
  const slideTests = solved.candidates[0] ? [-36, -32, -28, -24, -20, -16, -12, -8, -4, 0, 4, 8, 12, 16, 20, 24, 28, 32, 36].map(offset => {
    const base = solved.candidates[0]!;
    const transform = { ...base.transform, translation: add(base.transform.translation, scale(base.axis, offset)) };
    const zone = { ...base.penetrationZone, center: add(base.penetrationZone.center, scale(base.axis, offset)) };
    const result = checkNativePairCollision(part(fixedId), fixedPlacement, part(movingId), { instanceId: 'moving', partId: movingId, transform }, zone);
    return { offsetLdu: offset, status: result.status, reasonCode: result.reasonCode };
  }) : [];
  const collision = collisionResults[0]?.result ?? null;
  return {
    fixedPartId: fixedId, movingPartId: movingId,
    fixedConnectionId: fixedPoint.id, movingConnectionId: movingPoint.id,
    compatibility: { status: compatibility.status, ruleId: compatibility.ruleId, connectionType: compatibility.connectionType,
      insertionDepthLdu: compatibility.insertionDepthLdu, allowedTwistsDeg: compatibility.allowedTwistsDeg,
      permittedTranslation: compatibility.permittedTranslation, reasonCode: compatibility.reasonCode, reason: compatibility.reason },
    solver: { status: solved.status, reason: solved.reason, candidateCount: solved.candidates.length,
      candidateTwistsDeg: solved.candidates.map(value => value.twistDeg) },
    collision: collision ? { status: collision.status, reasonCode: collision.reasonCode, reason: collision.reason,
      classification: collision.classification, triangleTests: collision.triangleTests,
      closedSourceProxies: collision.proof.closedSourceProxies, openSourceSurfaces: collision.proof.openSourceSurfaces,
      openSurfaceSeatChecked: collision.proof.openSurfaceSeatChecked, containmentChecked: collision.proof.containmentChecked,
      completeSurfacePartition: collision.proof.completeSurfacePartition, witness: collision.witness ?? null,
      zone: solved.candidates[0] ? { center: solved.candidates[0].penetrationZone.center, axis: solved.candidates[0].penetrationZone.axis, radius: solved.candidates[0].penetrationZone.radius, depth: solved.candidates[0].penetrationZone.depth, anchor: solved.candidates[0].anchor } : null,
      allTwists: collisionResults.map(({ twistDeg, result }) => ({ twistDeg, status: result.status, reasonCode: result.reasonCode, witness: result.witness ?? null, triangleTests: result.triangleTests })),
      slideTests } : null,
  };
};

const bar = barOf('30374'), clip48729 = clipOf('48729b'), clip60470 = clipOf('60470b');
const ambiguous = part('2412b').connections.points.find(p => p.kind === 'cylinder' && p.gender === 'M' && p.sections.some(section => section.radius === 4))!;
const output = {
  schemaVersion: 'bar-clip-probe-1',
  generatedAt: new Date().toISOString(),
  purpose: 'Source-backed Bar/Clip evidence probe. Model generation/export/reimport is recorded separately in generation-report.json.',
  features: {
    '30374': part('30374').connections.points.map(point),
    '48729b': part('48729b').connections.points.map(point),
    '60470b': part('60470b').connections.points.filter(p => p.family === 'clip').map(point),
    '2412b': part('2412b').connections.points.filter(p => p.kind === 'cylinder' && p.gender === 'M' && p.sections.some(section => section.radius === 4)).map(point),
  },
  admissions: { '30374': admission('30374'), '48729b': admission('48729b'), '60470b': admission('60470b'), '2412b': admission('2412b') },
  pairs: [
    pair('30374', '48729b', bar, clip48729),
    pair('30374', '60470b', bar, clip60470),
    pair('2412b', '48729b', ambiguous, clip48729),
  ],
};
const directory = path.join(ROOT, 'artifacts', 'bar-clip');
await mkdir(directory, { recursive: true });
const file = path.join(directory, 'probe.json');
await writeFile(file, JSON.stringify(output, null, 2));
process.stdout.write(`${file}\n${JSON.stringify({ admissions: output.admissions, pairs: output.pairs.map(value => ({ fixedPartId: value.fixedPartId, movingPartId: value.movingPartId, compatibility: value.compatibility.status, ruleId: value.compatibility.ruleId, solver: value.solver.status, candidates: value.solver.candidateCount })) }, null, 2)}\n`);
