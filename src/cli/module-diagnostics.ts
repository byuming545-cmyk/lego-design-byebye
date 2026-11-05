import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { Triangle, Vector3 as ThreeVector } from 'three';
import { ModuleCatalog } from '../parts/modules/catalog.js';
import { sameModulePose } from '../parts/modules/assembly.js';
import { checkNativePairCollision } from '../parts/assembly/collision.js';
import { buildNativeCollisionProxy } from '../parts/assembly/proxy.js';
import { checkMultiPointConnection } from '../parts/assembly/multipoint.js';
import { solveAttachment } from '../parts/assembly/solver.js';
import { composeTransforms, inverseTransform, isRigidTransform, transformPoint, dot, cross, subtract, length } from '../parts/assembly/math.js';
import type { GrammarAssemblyService } from '../parts/grammar/service.js';
import type { NativeAssemblyPart, NativePlacement, RigidTransform, Vector3 } from '../parts/assembly/types.js';

/** Independent numerical observation of the original parsed triangles. It does
 * not repair geometry, create a certificate, or participate in production. */
function rawMeshObservation(part: NativeAssemblyPart, placement: NativePlacement, witness: Vector3) {
  const mesh = part.geometry.mesh!;
  let angle = 0, closestDistance = Infinity;
  let closest: { triangleIndex: number; localVertices: Vector3[]; worldVertices: Vector3[]; nearestWorldPoint: Vector3; distanceLdu: number } | undefined;
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    const local = mesh.indices.slice(offset, offset + 3).map(index => mesh.positions[index]);
    const world = local.map(vertex => transformPoint(placement.transform, vertex));
    const [a, b, c] = world.map(vertex => subtract(vertex, witness)), la = length(a), lb = length(b), lc = length(c);
    angle += 2 * Math.atan2(dot(a, cross(b, c)), la * lb * lc + dot(a, b) * lc + dot(b, c) * la + dot(c, a) * lb);
    const target = new ThreeVector();
    new Triangle(...world.map(vertex => new ThreeVector(...vertex)) as [ThreeVector, ThreeVector, ThreeVector]).closestPointToPoint(new ThreeVector(...witness), target);
    const distance = target.distanceTo(new ThreeVector(...witness));
    if (distance < closestDistance) { closestDistance = distance; closest = { triangleIndex: offset / 3, localVertices: local, worldVertices: world, nearestWorldPoint: target.toArray() as Vector3, distanceLdu: distance }; }
  }
  return { partId: part.partId, rawTriangleCount: mesh.indices.length / 3, orientedWindingNumber: angle / (4 * Math.PI), closest,
    source: part.geometry.source, scope: 'independent-numerical-observation-not-production-authority' };
}

export async function acquireReviewedModel(sourceFile?: string) {
  const source = new ModuleCatalog().get('76897-spoiler-blade').recipe.source;
  let bytes: Buffer, http: number | null = null;
  if (sourceFile) bytes = await readFile(sourceFile);
  else {
    const response = execFileSync('curl', ['--silent', '--show-error', '--max-time', '30', '--max-redirs', '0', '--max-filesize', '4000000', '--write-out', '\n%{http_code}', source.sourceUrl], { maxBuffer: 4_100_000 });
    const separator = response.lastIndexOf(10); bytes = response.subarray(0, separator); http = Number(response.subarray(separator + 1).toString());
    if (http !== 200) throw new Error(`Fixed reviewed model download returned HTTP ${http}; no alternate source or guessed data used.`);
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== source.originalSha256) throw new Error('Original MPD does not match the reviewed source hash.');
  return { bytes, acquisition: { url: source.sourceUrl, http, method: sourceFile ? 'explicit-local-copy' : 'normal-HTTPS', sha256, size: bytes.length } };
}

export async function diagnoseSpoiler(service: GrammarAssemblyService, output: string, sourceFile?: string) {
  const acquired = await acquireReviewedModel(sourceFile), definition = new ModuleCatalog().get('76897-spoiler-blade');
  const source = definition.recipe.source;
  const start = acquired.bytes.indexOf(Buffer.from(`0 FILE ${source.section}`));
  if (start < 0) throw new Error('Original MPD source section missing.');
  const nextSection = acquired.bytes.indexOf(Buffer.from('\n0 FILE '), start + 7);
  const exact = acquired.bytes.subarray(start, nextSection < 0 ? acquired.bytes.length : nextSection + 1);
  const preserved = await readFile(path.join('data/parts-foundation/modules', source.file));
  if (!exact.equals(preserved)) throw new Error('Extracted spoiler differs from original MPD bytes.');
  const rows = preserved.toString().split(/\r?\n/).filter(line => line.startsWith('1 ')).map(line => {
    const tokens = line.trim().split(/\s+/);
    return { partId: tokens[14].replace(/\.dat$/i, ''), transform: { translation: tokens.slice(2, 5).map(Number), rotation: tokens.slice(5, 14).map(Number) } as RigidTransform };
  });
  const parentLine = acquired.bytes.toString().split(/\r?\n/).find(line => line.startsWith('1 ') && line.endsWith(' ' + source.section))!;
  if (!parentLine) throw new Error('Parent model placement is missing.');
  const parentTokens = parentLine.split(/\s+/), parent = { translation: parentTokens.slice(2, 5).map(Number), rotation: parentTokens.slice(5, 14).map(Number) } as RigidTransform;
  if (!isRigidTransform(parent)) throw new Error('The parent source placement is not a proper rigid transform.');
  const normalized = rows.slice(0, 2).map(row => composeTransforms(inverseTransform(rows[0].transform), row.transform));
  if (!normalized.every((transform, index) => sameModulePose(transform, definition.members[index].transform))) throw new Error('Source canonicalization does not preserve original relative poses.');
  const graph = await service.engine.createAssembly(rows[0].partId), fixed = graph.placements[0], target: NativePlacement = { instanceId: 'source-1', partId: rows[1].partId, transform: normalized[1] };
  const a = (await service.engine.getPart(fixed.partId))!, b = (await service.engine.getPart(target.partId))!;
  const capA = (await service.engine.getCapability(a.partId))!, capB = (await service.engine.getCapability(b.partId))!;
  const matches = checkMultiPointConnection({ fixedPart: a, fixedPlacement: fixed, movingPart: b, movingPlacement: target,
    allowedFixedConnectionIds: new Set(capA.allowedConnectionIds), allowedMovingConnectionIds: new Set(capB.allowedConnectionIds) });
  const match = matches.matches[0];
  if (!match || matches.status !== 'consistent') throw new Error('Source mating pose cannot be reproduced.');
  const solved = solveAttachment({ fixedPart: a, fixedPlacement: fixed, fixedConnectionId: match.fixedConnectionId, movingPart: b, movingConnectionId: match.movingConnectionId });
  const candidate = solved.candidates.find(pose => sameModulePose(pose.transform, target.transform));
  if (!candidate) throw new Error('The interface solver differs from the source pose.');
  const collision = checkNativePairCollision(a, fixed, b, target, candidate.penetrationZone);
  if (collision.status !== 'collision' || !collision.witness) throw new Error('Spoiler rejection changed; inspect rather than replaying an old conclusion.');
  const worldFromCanonical = composeTransforms(parent, rows[0].transform);
  const worldFixed = { ...fixed, transform: composeTransforms(parent, rows[0].transform) }, worldMoving = { ...target, transform: composeTransforms(parent, rows[1].transform) };
  const worldSolved = solveAttachment({ fixedPart: a, fixedPlacement: worldFixed, fixedConnectionId: match.fixedConnectionId, movingPart: b, movingConnectionId: match.movingConnectionId });
  const worldCandidate = worldSolved.candidates.find(pose => sameModulePose(pose.transform, worldMoving.transform));
  if (!worldCandidate) throw new Error('Parent placement does not preserve the solved relative pose.');
  const worldCollision = checkNativePairCollision(a, worldFixed, b, worldMoving, worldCandidate.penetrationZone);
  const delta = subtract(collision.witness, candidate.penetrationZone.center), axial = dot(delta, candidate.penetrationZone.axis);
  const radial = length(subtract(delta, candidate.penetrationZone.axis.map(value => value * axial) as Vector3));
  const raw = [rawMeshObservation(a, fixed, collision.witness), rawMeshObservation(b, target, collision.witness)];
  const planes = raw.map(observation => {
    const [p, q, r] = observation.closest!.worldVertices;
    const n = cross(subtract(q, p), subtract(r, p)), size = length(n), normal = n.map(value => value / size) as Vector3;
    return { normal, signedWitnessDistanceLdu: dot(normal, subtract(collision.witness!, p)) };
  });
  const precisionSources = [];
  for (const file of ['p/4-4cyli.dat', 'parts/s/85984s01.dat']) {
    if (![a, b].some(part => part.geometry.source.files.some(entry => entry.path === file))) throw new Error('Precision excerpt is outside the actual source dependency closure.');
    const native = await readFile(path.join('data/parts-foundation/ldraw/files', file), 'utf8');
    const rows = native.split(/\r?\n/).map((directive, index) => ({ line: index + 1, directive }));
    precisionSources.push({ file, sha256: createHash('sha256').update(await readFile(path.join('data/parts-foundation/ldraw/files', file))).digest('hex'),
      excerpts: rows.filter(row => /^[34] /.test(row.directive) && (file.startsWith('p/') ? /0\.9239|0\.3827/.test(row.directive) : /-12\.296 -3\.674 -5\.543|-13\.109 -4 -5/.test(row.directive))).slice(0, 4) });
  }
  const proxies = [buildNativeCollisionProxy(a, fixed), buildNativeCollisionProxy(b, target)].map(result => ({ status: result.status, reason: result.reason, topology: result.proxy?.topology, evidence: result.proxy?.evidence }));
  const report = { sourceSnapshot: service.repository.snapshotDigest, versions: service.engine.versions, acquisition: acquired.acquisition,
    source, extractionByteIdentical: true, parentLine, parent, normalized, originalPlacements: rows.slice(0, 2), currentPlacements: [fixed, target],
    sourceIdentity: { sourcePartIds: rows.slice(0, 2).map(row => row.partId), actualPartIds: [a.partId, b.partId], replacements: [] },
    matches, candidate, collision, proxies, rawMeshObservations: raw,
    nearbySurfaceEvidence: { planes, unorientedAngleDegrees: Math.acos(Math.min(1, Math.abs(dot(planes[0].normal, planes[1].normal)))) * 180 / Math.PI,
      precisionSources, observation: 'The measured native faces are nearly parallel but not exactly coincident. The raw vertices and source excerpts retain their differing decimal precision. Precision mismatch is a supported hypothesis, not permission to alter tolerance.',
      limitation: 'Raw generalized winding numbers are noninteger near this seam. They are numerical observations, not an independent proof of a watertight physical solid.' },
    witnessRelativeToSeat: { axialLdu: axial, radialLdu: radial, insideDeclaredCylindricalSeat: Math.abs(axial) <= candidate.penetrationZone.depth / 2 && radial <= candidate.penetrationZone.radius,
      note: 'Inside the alignment seat does not authorize overlap of two native plastic solids.' },
    parentPlacement: { placements: [worldFixed, worldMoving], status: worldCollision.status, reasonCode: worldCollision.reasonCode,
      transformedCanonicalWitness: transformPoint(worldFromCanonical, collision.witness), recomputedWitness: worldCollision.witness },
    conclusion: 'The current production proxies report overlap at nearly coincident source surfaces inside the mating cavity. Exact extraction, identities and rigid canonical/parent transforms reproduce the rejection. Authored coordinate precision differs at the nearby stud/receiver faces. This evidence cannot establish intended rounding tolerance, historical mould variants or physical interference. No collision rule or source geometry is relaxed.',
    unresolved: ['Whether the reconstruction matches the retail set at these exact mould variants', 'Whether real plastic clearance, material or deformation differs from the digital surfaces', 'The missing native 3665b support identity/connectivity remains separate'],
    physicalBuildVerified: false, productionAdmitted: false };
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'spoiler-diagnosis.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ spoiler: collision.status, rawWindingNumbers: raw.map(item => item.orientedWindingNumber), closestDistancesLdu: raw.map(item => item.closest?.distanceLdu), insideSeat: report.witnessRelativeToSeat.insideDeclaredCylindricalSeat }));
  return report;
}
