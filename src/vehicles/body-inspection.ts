import { distance, transformPoint } from "../parts/assembly/math.js";
import { solveAttachment } from "../parts/assembly/solver.js";
import { assessGrammarAdmission } from "../parts/grammar/admission.js";
import { checkNativePairCollision } from "../parts/assembly/collision.js";
import type { NativeAssemblyPart, Vector3 } from "../parts/assembly/types.js";
import type { BodyPlacement } from "./body-preview.js";
import { sameModulePose } from "../parts/modules/assembly.js";
export interface SourceJointHint {fixedInstanceId:string;fixedConnectionId:string;movingInstanceId:string;movingConnectionId:string;caseId:string}
/** Conservative diagnostic against the tyre's full external cylinder, not a
 * tyre/rim fit certificate. Clips actual source triangles to its axial slab. */
export function inspectWheelEnvelope(placements: BodyPlacement[], parts: Map<string, NativeAssemblyPart>, radius: number, halfWidth: number) {
    const tyres = placements.filter(p => p.partId === "18977" && p.role === "wheel");
    const conflicts: {
        wheel: string;
        instanceId: string;
        partId: string;
        role: string;
        penetrationLdu: number;
    }[] = [];
    const clip = (poly: Vector3[], bound: number, keepGreater: boolean) => {
        const result: Vector3[] = [];
        for (let i = 0; i < poly.length; i++) {
            const a = poly[i], b = poly[(i + 1) % poly.length], ia = keepGreater ? a[0] >= bound : a[0] <= bound, ib = keepGreater ? b[0] >= bound : b[0] <= bound;
            if (ia)
                result.push(a);
            if (ia !== ib) {
                const t = (bound - a[0]) / (b[0] - a[0]);
                result.push(a.map((v, j) => v + t * (b[j] - v)) as Vector3);
            }
        }
        return result;
    };
    const radial = (poly: Vector3[]) => {
        let min = Infinity, positive = false, negative = false;
        for (let i = 0; i < poly.length; i++) {
            const a = poly[i], b = poly[(i + 1) % poly.length], dy = b[1] - a[1], dz = b[2] - a[2], dd = dy * dy + dz * dz;
            const t = dd ? Math.max(0, Math.min(1, -(a[1] * dy + a[2] * dz) / dd)) : 0;
            min = Math.min(min, Math.hypot(a[1] + t * dy, a[2] + t * dz));
            const cross = a[1] * b[2] - a[2] * b[1];
            positive ||= cross > 1e-8;
            negative ||= cross < -1e-8;
        }
        // A non-degenerate polygon containing the projected cylinder axis.
        if (poly.length >= 3 && positive !== negative) {
            const area = Math.abs(poly.reduce((s, a, i) => s + a[1] * poly[(i + 1) % poly.length][2] - a[2] * poly[(i + 1) % poly.length][1], 0));
            if (area > 1e-6)
                min = 0;
        }
        return min;
    };
    for (const p of placements.filter(p => p.role !== "wheel")) {
        const mesh = parts.get(p.partId)!.geometry.mesh!;
        const vertices = mesh.positions.map(v => transformPoint(p.transform, v));
        for (const tyre of tyres) {
            const c = tyre.transform.translation;
            if (vertices.every(v => v[0] < c[0] - halfWidth) || vertices.every(v => v[0] > c[0] + halfWidth))
                continue;
            let nearest = Infinity;
            for (let i = 0; i < mesh.indices.length; i += 3) {
                let poly = mesh.indices.slice(i, i + 3).map(j => vertices[j].map((v, a) => v - c[a]) as Vector3);
                poly = clip(clip(poly, -halfWidth, true), halfWidth, false);
                if (poly.length)
                    nearest = Math.min(nearest, radial(poly));
            }
            if (nearest < radius - 0.0001)
                conflicts.push({ wheel: tyre.instanceId, instanceId: p.instanceId, partId: p.partId, role: p.role, penetrationLdu: radius - nearest });
        }
    }
    return { method: "source-triangles-vs-full-tyre-external-cylinder-1", radiusLdu: radius, halfWidthLdu: halfWidth,
        conflicts, scope: "STATIC_EXTERNAL_ENVELOPE_ONLY", mechanicalClearance: "UNKNOWN", steeringTravel: "UNKNOWN", rimFit: "UNKNOWN" };
}
/** Enumerate source-backed installation poses close to the requested exterior.
 * A matched pose is a mathematical candidate, never a graph edge or approval. */
export function inspectMountCandidates(placements: BodyPlacement[], parts: Map<string, NativeAssemblyPart>) {
    const admission = new Map([...parts].map(([id, p]) => [id, assessGrammarAdmission(p)]));
    const endpoints = placements.map(p => {
        const part = parts.get(p.partId)!, a = admission.get(p.partId)!;
        const allowed = new Set([...a.capability.allowedConnectionIds, ...(a.capability.exteriorAllowedConnectionIds ?? [])]);
        return { p, part, points: part.connections.points.filter(c => allowed.has(c.id)).map(c => ({ c, world: transformPoint(p.transform, c.position) })) };
    });
    return endpoints.filter(e => e.p.role !== "wheel").map(moving => {
        const candidates: {
            fixedInstanceId: string;
            fixedConnectionId: string;
            movingConnectionId: string;
            ruleId: string | null;
            transform: BodyPlacement["transform"];
            poseErrorLdu: number;
            matchesRequestedPose: boolean;
        }[] = [];
        let nearbyEndpointPairs = 0;
        for (const fixed of endpoints) {
            if (fixed.p.instanceId === moving.p.instanceId || fixed.p.role === "wheel")
                continue;
            for (const a of fixed.points)
                for (const b of moving.points) {
                    if (distance(a.world, b.world) > 8.0001)
                        continue;
                    nearbyEndpointPairs++;
                    const result = solveAttachment({ fixedPart: fixed.part, fixedPlacement: fixed.p, fixedConnectionId: a.c.id, movingPart: moving.part, movingConnectionId: b.c.id });
                    for (const c of result.candidates) {
                        const poseErrorLdu = distance(c.transform.translation, moving.p.transform.translation);
                        const rotationMatches = c.transform.rotation.every((v, i) => Math.abs(v - moving.p.transform.rotation[i]) <= 0.0001);
                        if (rotationMatches && poseErrorLdu <= 8.0001 && candidates.length < 8)
                            candidates.push({ fixedInstanceId: fixed.p.instanceId, fixedConnectionId: a.c.id, movingConnectionId: b.c.id, ruleId: result.compatibility.ruleId, transform: c.transform, poseErrorLdu, matchesRequestedPose: poseErrorLdu <= 0.0001 });
                    }
                }
        }
        return { instanceId: moving.p.instanceId, nearbyEndpointPairs, candidates,
            status: candidates.some(c => c.matchesRequestedPose) ? "SOURCE_POSE_CANDIDATE_ONLY" : "NO_MATCHING_INSTALLATION_POSE",
            verifiedGraphEdge: false, insertionPathVerified: false };
    });
}
export function inspectBodySurfacePairs(placements: BodyPlacement[], parts: Map<string, NativeAssemblyPart>, sourceJoints:SourceJointHint[] = []) {
    const admission = new Map([...parts].map(([id, p]) => [id, assessGrammarAdmission(p)]));
    const body = placements.filter(p => p.role !== "wheel").map(p => {
        const b = parts.get(p.partId)!.geometry.bounds!;
        const corners = Array.from({ length: 8 }, (_, i) => transformPoint(p.transform, b.min.map((v, a) => i & (1 << a) ? b.max[a] : v) as Vector3));
        return { p, min: [0, 1, 2].map(a => Math.min(...corners.map(v => v[a]))), max: [0, 1, 2].map(a => Math.max(...corners.map(v => v[a]))) };
    });
    const results = [];
    let broadPhaseDisjoint = 0;
    for (let i = 0; i < body.length; i++)
        for (let j = i + 1; j < body.length; j++) {
            const a = body[i], b = body[j];
            if (!a.min.every((v, k) => Math.min(a.max[k], b.max[k]) - Math.max(v, b.min[k]) > 0.0001)) {
                broadPhaseDisjoint++;
                continue;
            }
            const pose = (p: BodyPlacement) => ({ ...p, collisionClass: admission.get(p.partId)!.exteriorGeneratable ? "exterior-shell" as const : "structural" as const });
            // A source joint is only a hint: solve it again from current native
            // endpoints, permissions and exact world poses. The existing kernel
            // independently validates the returned local penetration zone.
            const hint=sourceJoints.find(h=>(h.fixedInstanceId===a.p.instanceId&&h.movingInstanceId===b.p.instanceId)||(h.fixedInstanceId===b.p.instanceId&&h.movingInstanceId===a.p.instanceId));
            let zone;
            if(hint){
                const fixed=hint.fixedInstanceId===a.p.instanceId?a.p:b.p,moving=hint.movingInstanceId===b.p.instanceId?b.p:a.p;
                const cap=(p:BodyPlacement)=>admission.get(p.partId)!.capability;
                const ids=(p:BodyPlacement)=>new Set([...cap(p).allowedConnectionIds,...(cap(p).exteriorAllowedConnectionIds??[])]);
                if(ids(fixed).has(hint.fixedConnectionId)&&ids(moving).has(hint.movingConnectionId)) {
                    const solved=solveAttachment({fixedPart:parts.get(fixed.partId)!,fixedPlacement:fixed,fixedConnectionId:hint.fixedConnectionId,movingPart:parts.get(moving.partId)!,movingConnectionId:hint.movingConnectionId});
                    zone=solved.candidates.find(c=>sameModulePose(c.transform,moving.transform))?.penetrationZone;
                }
            }
            const result = checkNativePairCollision(parts.get(a.p.partId)!, pose(a.p), parts.get(b.p.partId)!, pose(b.p),zone);
            results.push({ a: a.p.instanceId, b: b.p.instanceId, roleA: a.p.role, roleB: b.p.role, status: result.status, reasonCode: result.reasonCode,sourceJoint:zone?hint?.caseId:undefined });
        }
    return { method: "native-pair-kernel-unchanged", scope: "NON_WHEEL_POSITIVE_AABB_OVERLAPS_ONLY", broadPhaseDisjoint,
        results, matingZonesInvented: 0, wholeVehicleCollisionCertificate: false };
}
