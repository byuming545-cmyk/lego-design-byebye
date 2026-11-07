import { axisRotation, IDENTITY_ROTATION, isRigidTransform, multiply, rotate } from "../parts/assembly/math.js";
import type { Matrix3, NativeAssemblyPart, Vector3 } from "../parts/assembly/types.js";
import { assessGrammarAdmission } from "../parts/grammar/admission.js";
import type { MiniColor } from "../mini-cars/types.js";
import type { BodyPlacement } from "./body-preview.js";
import type { BodyPlan } from "./body-plan.js";
import { inspectWheelEnvelope, inspectMountCandidates, inspectBodySurfacePairs } from "./body-inspection.js";
import { applyDesignCases } from "./craft-retrieval.js";
import type { DesignCorpus,CraftOptions } from "./design-cases.js";
/** A surface planner: rectangles are independent cover regions, never filled
 * solid voxels. Source geometry is translated/rotated, never resampled. */
export function regionShell(parts: Map<string, NativeAssemblyPart>, plan: BodyPlan,corpus:DesignCorpus,options:CraftOptions) {
    let placements: BodyPlacement[] = [];
    let nextInstance=0;
    const I = IDENTITY_ROTATION, ry = (angle: number) => axisRotation([0, 1, 0], angle);
    const W = plan.width, L = plan.length, R = plan.wheelRadiusLdu;
    const snap = (n: number) => Math.round(n / 8) * 8;
    const hoodHeight = snap(plan.profile.find(p => p.name === "hood-end")!.height * plan.height);
    const tailHeight = snap(plan.profile.find(p => p.name === "tail")!.height * plan.height);
    const roofHeight = snap(plan.height), glassBase = roofHeight - 32;
    const start = plan.cabinStart * L, end = plan.cabinEnd * L;
    const desiredRoofWidth = plan.profile.find(p => p.name === "roof-start")!.width * W;
    const roofWidth = Math.min(W-20,Math.round(desiredRoofWidth/20)*20);
    const roofBegin=plan.roofStart*L,roofFinish=plan.roofEnd*L;
    const shortDeck=L-end<60;
    const ground = Math.max(8, snap(plan.groundClearance));
    const regions: {
        role: string;
        purpose: string;
        instanceIds: string[];
    }[] = [];
    const put = (id: string, role: string, color: MiniColor, center: Vector3, rotation: Matrix3, purpose: string) => {
        const part = parts.get(id);
        if (!part?.geometry.bounds)
            throw Error("BODY_REGION_SOURCE_MISSING_" + id);
        const b = part.geometry.bounds;
        const mid = b.min.map((v, a) => (v + b.max[a]) / 2) as Vector3;
        const offset = rotate(rotation, mid);
        const transform = { rotation, translation: center.map((v, a) => v - offset[a] - (a === 2 ? L / 2 : 0)) as Vector3 };
        if (!isRigidTransform(transform) || placements.length >= 700)
            throw Error("BODY_NONRIGID_OR_BUDGET");
        const instanceId = "vehicle-part-" + (++nextInstance);
        placements.push({ instanceId, partId: id, role, color, transform, assemblyStatus: "NOT_VERIFIED", decision: {
                constraints: ["native-bounds", "section-profile", "wheel-clearance", "cabinStart/cabinEnd"],
                imageIds: plan.imageIds, purpose,
            } });
        let region = regions.find(r => r.role === role);
        if (!region) {
            region = { role, purpose, instanceIds: [] };
            regions.push(region);
        }
        region.instanceIds.push(instanceId);
    };
    const flat = [...parts.values()].flatMap(p => {
        const b = p.geometry.bounds!, name = p.geometry.name ?? "";
        if (!/^(?:Plate|Tile|Brick)\s+\d+ x\s*\d+(?:$| with Groove$)/.test(name))
            return [];
        const w = (b.max[0] - b.min[0]) / 20, d = (b.max[2] - b.min[2]) / 20;
        if (!Number.isInteger(w) || !Number.isInteger(d))
            return [];
        return [0, 90].map(angle => ({ id: p.partId, w: angle ? d : w, d: angle ? w : d, height: b.max[1], stud: b.min[1], kind: name.split(/\s/)[0], rotation: ry(angle) }));
    }).sort((a, b) => b.w * b.d - a.w * a.d || a.id.localeCompare(b.id));
    const selectionCandidates: {
        region: string;
        target: Vector3;
        candidates: {
            partId: string;
            score: number;
        }[];
        selected: string;
    }[] = [];
    const sourceFit = (region: string, pattern: RegExp, target: Vector3, predicate: (p: NativeAssemblyPart) => boolean = () => true) => {
        const previous = selectionCandidates.find(c => c.region === region && c.target.every((v, a) => v === target[a]));
        if (previous)
            return parts.get(previous.selected)!;
        const candidates = [...parts.values()].filter(p => pattern.test(p.geometry.name ?? "") && predicate(p)).map(p => {
            const b = p.geometry.bounds!, size = b.max.map((v, a) => v - b.min[a]);
            return { partId: p.partId, score: size.reduce((sum, v, a) => sum + Math.abs(v - target[a]), 0) };
        }).sort((a, b) => a.score - b.score || a.partId.localeCompare(b.partId));
        if (!candidates.length || candidates[0].score > 0.01)
            throw Error("BODY_SURFACE_GEOMETRY_FIT_UNAVAILABLE_" + region);
        selectionCandidates.push({ region, target, candidates, selected: candidates[0].partId });
        return parts.get(candidates[0].partId)!;
    };
    const continuousCurve = (p: NativeAssemblyPart) => p.geometry.bounds!.max[1] === 0 &&
        !/Cutout|Inverted|Fin|Steps|Dimples|Double|Plate/i.test(p.geometry.name ?? "");
    // Cover a planar target using only exact native footprints. A failed fit is
    // explicit; an oversized part cannot be shrunk to make it fit.
    const rectangle = (role: string, color: MiniColor, width: number, depth: number, center: Vector3, rotation: Matrix3, kind = "Tile", purpose = "continuous planar cover; mounting unverified") => {
        const nx = Math.round(width / 20), nz = Math.round(depth / 20);
        if (Math.abs(nx * 20 - width) > 0.001 || Math.abs(nz * 20 - depth) > 0.001 || nx < 1 || nz < 1)
            throw Error("BODY_REGION_NON_NATIVE_RECTANGLE");
        const used = new Set<string>();
        for (let z = 0; z < nz; z++)
            for (let x = 0; x < nx; x++) {
                if (used.has(`${x},${z}`))
                    continue;
                const fit = flat.find(c => c.kind === kind && c.w <= nx - x && c.d <= nz - z &&
                    Array.from({ length: c.w }, (_, dx) => Array.from({ length: c.d }, (_, dz) => !used.has(`${x + dx},${z + dz}`))).flat().every(Boolean));
                if (!fit)
                    throw Error("BODY_REGION_NATIVE_FIT_UNAVAILABLE");
                const local: Vector3 = [-width / 2 + (x + fit.w / 2) * 20, 0, -depth / 2 + (z + fit.d / 2) * 20];
                const offset = rotate(rotation, local);
                put(fit.id, role, color, center.map((v, a) => v + offset[a]) as Vector3, multiply(rotation, fit.rotation), purpose);
                for (let dx = 0; dx < fit.w; dx++)
                    for (let dz = 0; dz < fit.d; dz++)
                        used.add(`${x + dx},${z + dz}`);
            }
    };
    // A narrow internal spine leaves wheel bands empty instead of hiding a solid
    // filled body behind new cover parts.
    rectangle("chassis", "black", W - 80, L - 40, [0, -ground - 6, L / 2], I, "Plate", "internal spine; native source, structural mating not yet verified");
    // The native wheel arches replace the corresponding side volume, rather
    // than being added onto a filled fender. Their 80-LDU span is source-derived.
    const tyreBounds = parts.get("18977")!.geometry.bounds!;
    const tyreHalfWidth = (tyreBounds.max[2] - tyreBounds.min[2]) / 2;
    const archTop = (shortDeck ? hoodHeight : Math.min(hoodHeight, tailHeight)) - 8;
    const archCandidates = [...parts.values()].filter(p => /^Car Mudguard/.test(p.geometry.name ?? "")).flatMap(p => {
        const b = p.geometry.bounds!, size = b.max.map((v, a) => v - b.min[a]);
        if (Math.abs(size[0] - (R * 2 + 20)) > 0.001 || size[1] > 60 || size[2] > W / 2)
            return [];
        const rotation = ry(90), middle = rotate(rotation, b.min.map((v, a) => (v + b.max[a]) / 2) as Vector3);
        const center: Vector3 = [-W / 2 + size[2] / 2, -archTop + size[1] / 2, 0];
        const pose = { instanceId: "candidate-arch", partId: p.partId, role: "wheel-arch", transform: { rotation, translation: center.map((v, a) => v - middle[a]) as Vector3 } } as BodyPlacement;
        const tyrePose = { instanceId: "candidate-tyre", partId: "18977", role: "wheel", transform: { rotation: ry(90), translation: [-W / 2 + 18, -R, 0] as Vector3 } } as BodyPlacement;
        const diagnostic = inspectWheelEnvelope([pose, tyrePose], parts, R, tyreHalfWidth);
        return [{ partId: p.partId, score: Math.abs(size[1] - 48) + Math.abs(size[2] - (tyreHalfWidth * 2 + 20)), externalEnvelopeClear: diagnostic.conflicts.length === 0, conflicts: diagnostic.conflicts }];
    }).sort((a, b) => a.score - b.score || a.partId.localeCompare(b.partId));
    const archChoice = archCandidates.find(c => c.externalEnvelopeClear);
    if (!archChoice)
        throw Error("BODY_NO_NATIVE_WHEEL_SURROUND_CLEARANCE");
    const arch = parts.get(archChoice.partId)!, ab = arch.geometry.bounds!;
    const archSpan = ab.max[0] - ab.min[0];
    const archCenterY = -archTop + (ab.max[1] - ab.min[1]) / 2;
    for (const axle of [plan.axleFront, plan.axleRear])
        for (const side of [-1, 1]) {
            put(arch.partId, "wheel-arch", "white", [side * (W / 2 - (ab.max[2] - ab.min[2]) / 2), archCenterY, axle], ry(side < 0 ? 90 : -90), "native curved wheel surround, centered on the actual axle; mechanical clearance UNKNOWN");
        }
    // Hood and deck: flat centre, purposeful curved edges, reserved arch caps.
    const coveredRun = (role: string, z0: number, z1: number, height: number) => {
        if (z1 <= z0)
            return;
        rectangle(role, "white", W - 80, z1 - z0, [0, -height + 4, (z0 + z1) / 2], I);
        for (let z = z0; z < z1; z += 20)
            for (const side of [-1, 1]) {
                const overArch = [plan.axleFront, plan.axleRear].some(a => Math.abs(z + 10 - a) < archSpan / 2);
                if (overArch)
                    rectangle(role, "white", 40, 20, [side * (W / 2 - 20), -height + 4, z + 10], I, "Tile", "flat arch cap adjoining curved fender without filling wheel opening");
                else {
                    const curve = sourceFit("lateral-edge", /^Slope Brick Curved/, [20, 16, 40], continuousCurve);
                    put(curve.partId, role, "white", [side * (W / 2 - 20), -height + 8, z + 10], ry(side < 0 ? 90 : -90), "curved lateral edge: high inward, low outward; no extra cover underneath");
                }
            }
    };
    const frontRun = Math.min(60,Math.max(20,plan.axleFront-archSpan/2));
    coveredRun("hood", frontRun, start, hoodHeight);
    coveredRun("tail", end, L - 60, tailHeight);
    // A shallow curved hood leading edge gives a distinct nose, not a slab of
    // stacked plates. Native curve depth fixes the transition length.
    for (let x = -W / 2; x < W / 2;) {
        const width = Math.min(40, W / 2 - x), id = sourceFit("end-transition", /^Slope Brick Curved/, [width, 16, 40], continuousCurve).partId;
        if(frontRun===60)put(id, "hood", "white", [x + width / 2, -hoodHeight + 8, 40], I, "curved hood leading edge, rising toward the long flat hood");
        if(!shortDeck)put(id, "tail", "white", [x + width / 2, -tailHeight + 8, L - 40], ry(180), "curved deck trailing edge, lowering toward the rear panel");
        x += width;
    }
    if(frontRun===60)rectangle("hood", "white", W, 20, [0, -hoodHeight + 20, 10], I, "Tile", "low leading lip below the rising hood transition");
    else for(let x=-W/2;x<W/2;x+=20){const slope=sourceFit("compact-nose",/^Slope Brick 31/,[20,15.6,20]);put(slope.partId,"hood","white",[x+10,-hoodHeight+7.8,10],I,"short shallow native nose stops before actual wheel-arch span; long curved recipe rejected");}
    if(shortDeck)rectangle("tail","white",W,L-end,[0,-tailHeight+4,(end+L)/2],I,"Tile","short native hatch landing selected from observed cabin end, without a saloon trunk");
    else rectangle("tail", "white", W, 20, [0, -tailHeight + 20, L - 10], I, "Tile", "low rear deck lip");
    // The cabin shoulder is a visible narrow surface in its own right. It
    // bridges the window base to the straight side without adding hidden fill.
    const shoulderWidth = (W - roofWidth) / 2;
    if (shoulderWidth === 20)
        for (const side of [-1, 1])
            for (let z = start; z < end; z += 40) {
                const span = Math.min(40, end - z);
                if ([plan.axleFront, plan.axleRear].some(a => Math.min(z + span, a + archSpan / 2) > Math.max(z, a - archSpan / 2))) {
                    rectangle("shoulder", "white", 20, span, [side * (W / 2 - 10), -hoodHeight + 4, z + span / 2], I, "Tile", "flat shoulder over reserved native arch span; slope rejected to avoid source-surface crossing");
                    continue;
                }
                const shoulder = sourceFit("cabin-shoulder", /^Slope Brick 31/, [span, 15.6, 20]);
                put(shoulder.partId, "shoulder", "white", [side * (W / 2 - 10), -hoodHeight + 7.8, z + span / 2], ry(side < 0 ? 90 : -90), "native shallow shoulder slope joins window base to side belt; 0.4 LDU edge gap retained");
            }
    // Straight lower side panels and skirt. Leave the full native arch span
    // empty, including its corners; do not carve an approximate circular voxel.
    for (const side of [-1, 1])
        for (let z = 20; z < L - 20; z += 20) {
            if ([plan.axleFront, plan.axleRear].some(a => Math.abs(z + 10 - a) < archSpan / 2))
                continue;
            const sideRotation = multiply(axisRotation([0, 0, 1], side * 90), ry(90));
            rectangle("side", "white", 20, 40, [side * (W / 2 - 4), -(Math.min(hoodHeight, tailHeight) - 36), z + 10], sideRotation, "Tile", "flat side skin below belt; exact native tile footprint");
            rectangle("side-skirt", "graphite", 20, 20, [side * (W / 2 - 10), -20, z + 10], I, "Tile", "native plate-height lower sill; no overlap with side skin");
        }
    // The wider one-stud roof inset leaves a ten-LDU shoulder. Thin native
    // belt layers bridge the visible body-to-glass gap; arch spans receive only
    // the upper cap, never hidden fill inside the wheel opening.
    const beltGaps:{z:number;bottom:number;top:number;residual:number}[]=[];
    for(let z=start;z<end-.001;z+=20){
        const overArch=[plan.axleFront,plan.axleRear].some(a=>Math.abs(z+10-a)<archSpan/2);
        const bottom=overArch?archTop:Math.min(hoodHeight,tailHeight)-16;
        for(const side of [-1,1])for(let top=bottom+8;top<=hoodHeight+.001;top+=8)
            rectangle("belt","white",20,20,[side*(W/2-10),-top+4,z+10],I,"Tile","native thin shoulder/belt closes cabin base; actual arch opening reserved");
        beltGaps.push({z,bottom,top:hoodHeight,residual:(hoodHeight-bottom)%8});
    }
    // Short shallow transitions retain the native 45-degree slope. Taller,
    // longer observed glass is expressed by unscaled thin tiles: native length
    // solves the run, endpoint rise error is retained, and no freeform mesh is used.
    const glassFits:{role:string;kind:string;run:number;targetRise:number;actualRise:number;angle:number;partId:string;gapLdu:number}[]=[];
    const slopeWidth = (parts.get("3039")!.geometry.bounds!.max[0] - parts.get("3039")!.geometry.bounds!.min[0]);
    for (const rear of [false, true]) {
        const edge = rear ? end : start, rot = ry(rear ? 180 : 0);
        const run=rear?end-roofFinish:roofBegin-start;
        const targetRise=roofHeight-8-(rear?tailHeight:hoodHeight);
        if(run>20.001||targetRise>32){
            const candidates=flat.filter(p=>p.kind==="Tile"&&p.w===1&&p.d*20>run).map(p=>{
                const length=p.d*20,angle=Math.acos(run/length)*180/Math.PI,rise=Math.sqrt(length*length-run*run);
                return{...p,angle,rise,error:Math.abs(rise-targetRise)};
            }).sort((a,b)=>a.error-b.error||a.id.localeCompare(b.id));
            const fit=candidates[0];
            if(!fit||fit.error>20)throw Error("BODY_NATIVE_GLASS_FACE_UNAVAILABLE");
            const angle=(rear?-1:1)*fit.angle,rotation=multiply(axisRotation([1,0,0],angle),fit.rotation);
            // Anchor the upper, outward face to the actual roof underside. Tile
            // thickness projects inward, away from the exterior hood/roof surfaces.
            const topZ=rear?roofFinish:roofBegin;
            const lowZ=rear?end:start;
            const centerY=-(roofHeight-8-fit.rise/2)+4*Math.cos(fit.angle*Math.PI/180);
            const centerZ=(topZ+lowZ)/2+4*Math.sin(angle*Math.PI/180);
            for(let x=-roofWidth/2;x<roofWidth/2;x+=20){
                const pillar=x===-roofWidth/2||x+20===roofWidth/2;
                put(fit.id,rear?"rear-window":"windshield",pillar?"white":"black",[x+10,centerY,centerZ],rotation,"rigid native tile glass face; observed run, roof underside anchor; endpoint error recorded, external mounting UNKNOWN");
            }
            glassFits.push({role:rear?"rear-window":"windshield",kind:"native-tile-face",run,targetRise,actualRise:fit.rise,angle:fit.angle,partId:fit.id,gapLdu:fit.rise-targetRise});
            continue;
        }
        glassFits.push({role:rear?"rear-window":"windshield",kind:"native-45-slope",run,targetRise,actualRise:20,angle:45,partId:"3039",gapLdu:20-targetRise});
        for (let x = -roofWidth / 2; x < roofWidth / 2;) {
            const pillar = x === -roofWidth / 2 || x + 20 === roofWidth / 2;
            const width = pillar || x + slopeWidth > roofWidth / 2 - 20 ? 20 : slopeWidth;
            const id = width === 20 ? "3040b" : "3039";
            put(id, rear ? "rear-window" : "windshield", pillar && rear ? "white" : "black", [x + width / 2, -glassBase - 14, edge + (rear ? -20 : 20)], rot, "native 45-degree glass/pillar face; black front pillars join side glazing, broad white rear pillars define hardtop; source landing under roof; angle and mounting not verified");
            x += width;
        }
    }
    // Optional belt caps are installation candidates. Reject whole native caps
    // that intersect a tilted screen's real backing; keep the uncovered seam
    // and its rejection record rather than burying either source in the other.
    const beltScreenChecks=inspectBodySurfacePairs(placements.filter(p=>["belt","windshield","rear-window"].includes(p.role)),parts);
    const beltIds=new Set(placements.filter(p=>p.role==="belt").map(p=>p.instanceId));
    const beltRejections=beltScreenChecks.results.filter(r=>r.status!=="clear"&&(beltIds.has(r.a)||beltIds.has(r.b)));
    const rejectedBelts=new Set(beltRejections.flatMap(r=>[r.a,r.b].filter(id=>beltIds.has(id))));
    placements=placements.filter(p=>!rejectedBelts.has(p.instanceId));
    const windowBegin=Math.round((roofBegin+20)/20)*20;
    const windowEnd=Math.round((roofFinish-20)/20)*20;
    const windowLength = windowEnd-windowBegin;
    if (windowLength >= 20)
        for (const side of [-1, 1])
            for(let row=0;row<Math.floor((roofHeight-8-hoodHeight)/20);row++){
                const centerY=-(roofHeight-8-row*20)+10, sideRotation=axisRotation([0,0,1],side*90);
                const hasPillar=windowLength>=80&&plan.features.some(f=>/B[ -]?pillar/i.test(f.description));
                if(hasPillar){
                    const pillar=Math.round((windowBegin+windowEnd)/40)*20;
                    rectangle("side-window","black",20,pillar-windowBegin,[side*(roofWidth/2-4),centerY,(windowBegin+pillar)/2],sideRotation,"Tile","front glazing; native footprint stops at observed B-pillar region");
                    rectangle("window-pillar","graphite",20,20,[side*(roofWidth/2-4),centerY,pillar+10],sideRotation,"Tile","narrow dark B-pillar from photo feature; no invented transparent material");
                    rectangle("side-window","black",20,windowEnd-pillar-20,[side*(roofWidth/2-4),centerY,(pillar+20+windowEnd)/2],sideRotation,"Tile","rear quarter glazing separate from front side window");
                }else rectangle("side-window", "black", 20, windowLength, [side * (roofWidth / 2 - 4), centerY, (windowBegin+windowEnd)/2], sideRotation, "Tile", "continuous vertical native tile glazing; visible height discretized in 20-LDU rows, lower residual retained");
                for(const z of [windowBegin-10,windowEnd+10])rectangle("window-pillar","white",20,20,[side*(W/2-4),centerY,z],sideRotation,"Tile","native outer pillar face joins window edge to belt; two-LDU lateral seam retained");
            }
    rectangle("roof", "white", roofWidth, roofFinish-roofBegin, [0, -roofHeight + 4, (roofBegin+roofFinish)/2], I, "Tile", "flat hardtop sized from independent roof observations; no pyramid fill");
    // Features choose the fascia semantics, never the input model name.
    const grilleEvidence = plan.features.filter(f => /grille/i.test(f.name));
    const twin = grilleEvidence.some(f => /twin|dual|split/i.test(f.description));
    for (const rear of [false, true]) {
        const face = rear ? L - 4 : 4, rot = axisRotation([1, 0, 0], rear ? -90 : 90);
        const panelHeight = rear ? tailHeight : hoodHeight;
        rectangle(rear ? "rear-bumper" : "front-bumper", "graphite", W, 20, [0, -Math.min(ground+18,panelHeight-54), face], rot, "Tile", "full-width bumper from observed bright surround; appearance colour, no chrome material claim");
        const panelY = -panelHeight + 34;
        if (!rear && twin) {
            const insertWidth = Math.floor((W / 2 - 20) / 20) * 20;
            for (const side of [-1, 1])
                rectangle("grille", "black", insertWidth, 20, [side * (insertWidth / 2 + 10), panelY, 12], rot, "Tile", "separate recessed twin dark grille inserts; covered lamp areas stay dark");
            rectangle("grille-divider", "graphite", 20, 20, [0, panelY, 8], rot, "Tile", "central divider in front of recessed grille inserts");
        }
        else
            rectangle(rear ? "rear-panel" : "grille", "black", W - 40, 20, [0, panelY, rear ? L - 12 : 12], rot);
        if (!rear && plan.features.some(f=>/round/i.test(f.description)&&/headlight|lamp/i.test(f.description))){
            const lamp=sourceFit("round-headlamp",/^Tile.*Round/,[20,8,20]);
            for(const side of [-1,1])put(lamp.partId,"headlamp","white",[side*(W/2-20),panelY,4],rot,"two round exposed lamps from photo evidence, source native round tiles; no hidden-light template");
        }
        if (rear)
            for (const side of [-1, 1])
                rectangle("taillamp", "red", 40, 20, [side * (W / 2 - 40), panelY, L - 4], rot, "Tile", "dual horizontal red lenses from rear-image feature evidence; source tile only");
    }
    for (const axle of [plan.axleFront, plan.axleRear])
        for (const side of [-1, 1])
            for (const [id, color] of [["18977", "black"], ["66727", "graphite"]] as const)
                put(id, "wheel", color, [side * (W / 2 - 18), -R, axle], ry(90), "unscaled source wheel geometry; tyre/rim compatibility and chassis mount UNKNOWN");
    const learned=applyDesignCases(placements,parts,plan,corpus,options);
    placements=learned.placements;
    if(placements.length>700||placements.some(p=>!isRigidTransform(p.transform)))throw Error("BODY_NONRIGID_OR_BUDGET");
    // Rebuild region membership after replacement; removed covers never leak
    // into the actual BOM, draft groups or rendered instances.
    regions.splice(0,regions.length,...[...new Set(placements.map(p=>p.role))].map(role=>({role,purpose:placements.find(p=>p.role===role)!.decision.purpose,instanceIds:placements.filter(p=>p.role===role).map(p=>p.instanceId)})));
    const usedIds = [...new Set(placements.map(p => p.partId))];
    const usedParts = new Map(usedIds.map(id => [id, parts.get(id)!]));
    const selection = usedIds.map(id => {
        const part = parts.get(id)!, admission = assessGrammarAdmission(part), b = part.geometry.bounds!;
        return { partId: id, name: part.geometry.name, nativeSize: b.max.map((v, a) => v - b.min[a]),
            instances: placements.filter(p => p.partId === id).map(p => ({ instanceId: p.instanceId, role: p.role, rotation: p.transform.rotation, purpose: p.decision.purpose, evidence: p.decision.imageIds })),
            permission: { structural: admission.generationEligible, surface: admission.exteriorGeneratable, reasonCodes: admission.reasonCodes },
            placementVerification: "NOT_VERIFIED" as const };
    });
    return { placements, layout: { version: "functional-surfaces-2", hoodHeight, tailHeight, roofHeight, glassBase, roofWidth, ground,glassFits,shortDeck,beltGaps,beltRejections,
            wheelArchSpan: archSpan, regions, selection, selectionCandidates, archCandidates,
            wheelEnvelope: inspectWheelEnvelope(placements, usedParts, R, tyreHalfWidth),
            mountCandidates: inspectMountCandidates(placements, usedParts),
            surfacePairs: inspectBodySurfacePairs(placements, usedParts,learned.hints),
            craft:learned.report,
            angularConflicts: plan.constraints.filter(c => /WindowAngle|windshieldAngle/.test(c.name)).map(c => {const angle=glassFits.find(f=>f.role===(c.name==="windshieldAngle"?"windshield":"rear-window"))!.angle;return({ name: c.name, observed: [c.min, c.max], sourceFaceDegrees: angle, errorDegrees: angle - (c.min + c.max) / 2 });}),
            scope: "APPEARANCE_ONLY_NO_NEW_ASSEMBLY_PERMISSION" as const } };
}
