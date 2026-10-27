import { SPEED_PART_CATALOG } from '../../speed/catalog.js';
import type { SpeedPartDefinition, VehicleModuleId } from '../../speed/types.js';
import type { PartColor } from '../../types/index.js';
import { instantiatePattern, type LegoDesignPattern } from '../patterns.js';
import type { VehicleDesignBrief } from '../research/types.js';
import { AutomotivePartBuilder } from './chassis.js';
import type { AutomotiveCoarsePlan } from './types.js';

const dark: PartColor = { id: 0, name: 'Black', hex: '#05131D' };
const gray: PartColor = { id: 71, name: 'Light Bluish Gray', hex: '#A0A5A9' };
const clear: PartColor = { id: 40, name: 'Trans-Clear', hex: '#FCFCFC' };
const rearLamp: PartColor = { id: 4, name: 'Red', hex: '#C91A09' };
type CourseCategory = 'Plate' | 'Brick' | 'Tile';
const standard = Object.values(SPEED_PART_CATALOG).filter(part => part.support === 'supported' && part.dimensions && part.shape && ['Plate', 'Brick', 'Tile'].includes(part.category));

/** Exact rectangular courses reuse ordinary parts at unchanged catalogue sizes. */
function rectangle(builder: AutomotivePartBuilder, moduleId: VehicleModuleId, x: number, y: number, width: number, depth: number, z: number, category: CourseCategory, color: PartColor): void {
  if (width <= 0 || depth <= 0) return;
  const remaining = new Set<string>();
  for (let dy = 0; dy < depth; dy++) for (let dx = 0; dx < width; dx++) remaining.add(`${x + dx}:${y + dy}`);
  const choices = standard.filter(part => part.category === category && (part.dimensions!.x !== 3 || part.dimensions!.y !== 3));
  while (remaining.size) {
    const [px, py] = [...remaining].map(cell => cell.split(':').map(Number)).sort((a, b) => a[1] - b[1] || a[0] - b[0])[0];
    const fits: { part: SpeedPartDefinition; rotation: 0 | 90; w: number; d: number; cells: string[] }[] = [];
    for (const part of choices) for (const rotation of (part.dimensions!.x === part.dimensions!.y ? [0] : [0, 90]) as (0 | 90)[]) {
      const w = rotation ? part.dimensions!.y : part.dimensions!.x, d = rotation ? part.dimensions!.x : part.dimensions!.y;
      if (px + w > x + width || py + d > y + depth) continue;
      if (width === 1 && category !== 'Tile' && depth > 1 && y + depth - py - d === 1) continue;
      const cells = Array.from({ length: w * d }, (_, i) => `${px + i % w}:${py + Math.floor(i / w)}`);
      if (cells.every(cell => remaining.has(cell))) fits.push({ part, rotation, w, d, cells });
    }
    fits.sort((a, b) => b.cells.length - a.cells.length || b.w - a.w || a.part.partId.localeCompare(b.part.partId));
    const choice = fits[0];
    if (!choice) throw new Error(`No verified ${category} course covers ${moduleId} at ${px},${py}.`);
    builder.add(choice.part.partId, moduleId, px + (choice.rotation ? choice.w : 0), py, z, color, { x: 0, y: 0, z: choice.rotation });
    choice.cells.forEach(cell => remaining.delete(cell));
  }
}
function solidHeight(builder: AutomotivePartBuilder, moduleId: VehicleModuleId, x: number, y: number, width: number, depth: number, bottom: number, top: number, color: PartColor): void {
  for (let z = bottom; z < top;) {
    const height = top - z >= 3 ? 3 : 1;
    rectangle(builder, moduleId, x, y, width, depth, z, height === 3 ? 'Brick' : 'Plate', color);
    z += height;
  }
}
/** Local front/rear face assemblies sit on a genuine supported bumper course. */
function face(builder: AutomotivePartBuilder, plan: AutomotiveCoarsePlan, patterns: readonly LegoDesignPattern[], top: number, paint: PartColor, rear = false): void {
  const width = plan.layout.widthStuds, length = plan.lengthStuds, y = rear ? length : 0, moduleId = rear ? 'rear' : 'front';
  const bottom = top - 3;
  solidHeight(builder, moduleId, 1, rear ? length - 1 : 0, width - 2, 1, 8, bottom, paint);
  const grille = patterns.find(pattern => pattern.id === 'snot-grille-strips' && pattern.status === 'confirmed');
  const lamp = patterns.find(pattern => pattern.id === 'snot-headlight-offset' && pattern.status === 'confirmed');
  if (!grille || !lamp) throw new Error('The confirmed local grille and lamp patterns are unavailable.');
  const place = (pattern: LegoDesignPattern, x: number, label: string, detailColor: PartColor): void => {
    const parts = instantiatePattern(pattern, { origin: { x, y, z: bottom }, orientation: { x: 0, y: 0, z: rear ? 180 : 0 }, idPrefix: `${builder.prefix}-${label}`, moduleId, color: paint });
    for (const part of parts) if (part.category === 'Tile') part.color = { ...detailColor };
    builder.append(parts, { moduleId: rear ? 'rear' : 'front', patternId: pattern.id, reason: `Instantiated a confirmed local ${pattern.category} assembly at the ${rear ? 'rear' : 'front'} face; every listed instance is present in the model.`, sourceReferences: [...pattern.sourceReferences] });
  };
  const grilleWidth = plan.layout.grilleWidthStuds, grilleX = (width - grilleWidth) / 2;
  for (let x = grilleX; x < grilleX + grilleWidth; x += 2) place(grille, rear ? x + 2 : x, `${rear ? 'rear' : 'front'}-grille-${x}`, rear ? dark : gray);
  for (const x of [1, width - 2]) place(lamp, rear ? x + 1 : x, `${rear ? 'rear' : 'front'}-lamp-${x}`, rear ? rearLamp : clear);
}

/** A raised curved finish has its real rear anti-stud offset supported by a riser. */
function curvedFinish(builder: AutomotivePartBuilder, moduleId: VehicleModuleId, x: number, y: number, width: number, depth: number, z: number, paint: PartColor, rear = false): void {
  if (depth < 2) { rectangle(builder, moduleId, x, y, width, depth, z, 'Tile', paint); return; }
  for (let px = x; px < x + width; px += 2) {
    const w = Math.min(2, x + width - px), partId = w === 2 ? '15068' : '11477';
    if (rear) {
      rectangle(builder, moduleId, px, y, w, 1, z, 'Plate', paint);
      builder.add(partId, moduleId, px + w, y + 2, z, paint, { x: 0, y: 0, z: 180 });
    } else {
      rectangle(builder, moduleId, px, y + 1, w, 1, z, 'Plate', paint);
      builder.add(partId, moduleId, px, y, z, paint);
    }
  }
  rectangle(builder, moduleId, x, y + 2, width, depth - 2, z, 'Tile', paint);
}

/** Generic cabin construction: sloped glass, shaped pillars and a separately anchored roof. */
function cabin(builder: AutomotivePartBuilder, plan: AutomotiveCoarsePlan, brief: VehicleDesignBrief, paint: PartColor): void {
  const width = plan.layout.widthStuds, cabinWidth = plan.layout.cabinWidthStuds, x = (width - cabinWidth) / 2;
  const roofHeight = plan.roofHeightPlates, layers = roofHeight >= 17 ? 2 : 1, roofBase = roofHeight - 1, windowBase = roofBase - layers * 3;
  const roofLength = Math.max(3, Math.min(plan.roofLengthStuds, plan.cabinLengthStuds - layers * 2));
  const front = plan.cabinStartStuds, roofStart = front + layers, roofEnd = roofStart + roofLength, rearEnd = roofEnd + layers;
  // A hollow cabin uses perimeter sills and real front/rear cowl supports.
  // Filling the whole passenger volume with bricks would waste parts and
  // connector budget without adding a useful load path.
  solidHeight(builder, 'cockpit', x, front, cabinWidth, 2, 9, windowBase, paint);
  solidHeight(builder, 'cockpit', x, rearEnd - 2, cabinWidth, 2, 9, windowBase, paint);
  for (const sideX of [x, x + cabinWidth - 1]) solidHeight(builder, 'cockpit', sideX, front + 2, 1, rearEnd - front - 4, 9, windowBase, paint);
  const slopeRow = (startY: number, z: number, rear: boolean): void => {
    for (let px = x; px < x + cabinWidth;) {
      const pillar = px === x || px === x + cabinWidth - 1;
      const w = pillar ? 1 : 2;
      builder.add(pillar ? '3040b' : '3039', 'cockpit', rear ? px + w : px, rear ? startY + 2 : startY, z, pillar ? paint : clear, { x: 0, y: 0, z: rear ? 180 : 0 });
      px += w;
    }
  };
  for (let layer = 0; layer < layers; layer++) {
    slopeRow(front + layer, windowBase + layer * 3, false);
    slopeRow(roofEnd + layers - 2 - layer, windowBase + layer * 3, true);
  }
  const sideStart = front + layers + 1, sideEnd = roofEnd - 1, sideDepth = Math.max(0, sideEnd - sideStart);
  const sideThickness = layers === 2 && plan.layout.roofWidthStuds < cabinWidth ? 2 : 1;
  for (const sideX of [x, x + cabinWidth - sideThickness]) {
    for (let z = windowBase; z < roofBase; z += 3) {
      if (brief.featureTags.includes('four-door') && sideDepth >= 3) {
        const pillarY = sideStart + Math.floor(sideDepth / 2);
        rectangle(builder, 'cockpit', sideX, sideStart, sideThickness, pillarY - sideStart, z, 'Brick', clear);
        rectangle(builder, 'cockpit', sideX, pillarY, sideThickness, 1, z, 'Brick', paint);
        rectangle(builder, 'cockpit', sideX, pillarY + 1, sideThickness, sideEnd - pillarY - 1, z, 'Brick', clear);
      } else rectangle(builder, 'cockpit', sideX, sideStart, sideThickness, sideDepth, z, 'Brick', clear);
    }
  }
  // Full-width end caps support the shaped outer pillars. Overlapping finish
  // tiles join those caps to the narrower middle roof course.
  const roofX = (width - plan.layout.roofWidthStuds) / 2;
  rectangle(builder, 'roof', x, roofStart, cabinWidth, 1, roofBase, 'Plate', paint);
  rectangle(builder, 'roof', x, roofEnd - 1, cabinWidth, 1, roofBase, 'Plate', paint);
  rectangle(builder, 'roof', roofX, roofStart + 1, plan.layout.roofWidthStuds, roofLength - 2, roofBase, 'Plate', paint);
  rectangle(builder, 'roof', roofX, roofStart, plan.layout.roofWidthStuds, roofLength, roofHeight, 'Tile', paint);
  const eave = (cabinWidth - plan.layout.roofWidthStuds) / 2;
  for (const capY of [roofStart, roofEnd - 1]) {
    rectangle(builder, 'roof', x, capY, eave, 1, roofHeight, 'Tile', paint);
    rectangle(builder, 'roof', roofX + plan.layout.roofWidthStuds, capY, eave, 1, roofHeight, 'Tile', paint);
  }
}

/** Compose local construction rules around a new, independently sized plan. */
export function addAutomotiveBody(builder: AutomotivePartBuilder, plan: AutomotiveCoarsePlan, brief: VehicleDesignBrief, paint: PartColor, patterns: readonly LegoDesignPattern[]): void {
  const width = plan.layout.widthStuds, length = plan.lengthStuds, frontEnd = plan.cabinStartStuds, cabinEnd = plan.cabinStartStuds + plan.cabinLengthStuds;
  const layers = plan.roofHeightPlates >= 17 ? 2 : 1, windowBase = plan.roofHeightPlates - 1 - layers * 3;
  const hoodTop = windowBase + 1, hoodFinishBase = hoodTop - 2;
  // Core courses transfer the wide body loads to the calibrated upper chassis.
  rectangle(builder, 'front', 1, 0, width - 2, 1, 7, 'Plate', paint);
  const core = (moduleId: VehicleModuleId, y: number, depth: number): void => {
    if (width === 8) rectangle(builder, moduleId, 2, y, 4, depth, 7, 'Plate', paint);
    else for (const railX of [2, width - 4]) rectangle(builder, moduleId, railX, y, 2, depth, 7, 'Plate', paint);
  };
  core('front', 1, frontEnd - 1);
  core('cockpit', frontEnd, plan.cabinLengthStuds);
  core('rear', cabinEnd, length - cabinEnd - 1);
  rectangle(builder, 'rear', 1, length - 1, width - 2, 1, 7, 'Plate', paint);
  for (let y = 1; y < length - 1; y += 2) {
    const inset = y < 2 || y + 2 > length - 2 ? 1 : 0;
    const moduleId = y < frontEnd ? 'front' : y < cabinEnd ? 'cockpit' : 'rear';
    rectangle(builder, moduleId, inset, y, width - inset * 2, 2, 8, 'Plate', paint);
  }
  // Lower side skirts occur only between tyre keep-outs; fenders sit above
  // the 7.5-plate tyre envelope rather than overlapping a spinning tyre.
  const skirtStart = plan.frontAxleStuds + 2, skirtEnd = plan.rearAxleStuds - 2;
  for (const sideX of [0, width - 2]) rectangle(builder, 'bodyShell', sideX, skirtStart, 2, skirtEnd - skirtStart, 7, 'Plate', dark);
  solidHeight(builder, 'front', 1, 1, width - 2, frontEnd - 1, 9, hoodFinishBase, paint);
  curvedFinish(builder, 'front', 1, 1, width - 2, frontEnd - 1, hoodFinishBase, paint);
  solidHeight(builder, 'rear', 1, cabinEnd, width - 2, length - cabinEnd - 1, 9, hoodFinishBase, paint);
  curvedFinish(builder, 'rear', 1, cabinEnd, width - 2, length - cabinEnd - 1, hoodFinishBase, paint, true);
  face(builder, plan, patterns, hoodTop, paint);
  face(builder, plan, patterns, hoodTop, paint, true);
  cabin(builder, plan, brief, paint);
  // Smooth body-coloured shoulder strips make the fender line continuous.
  // Upper side windows and the narrower roof remain distinct modules.
  for (const sideX of [0, width - 1]) rectangle(builder, 'bodyShell', sideX, 2, 1, length - 4, 9, 'Tile', paint);
}
