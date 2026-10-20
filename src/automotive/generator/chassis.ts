import { getSpeedPartDefinition } from '../../speed/catalog.js';
import { generatableWheelAssemblies } from '../../speed/wheelAssemblies.js';
import type { SpeedOrientation, SpeedPlacedPart, VehicleModuleId } from '../../speed/types.js';
import type { PartColor } from '../../types/index.js';
import type { AutomotiveCoarsePlan, AutomotivePatternChoice } from './types.js';

const black: PartColor = { id: 0, name: 'Black', hex: '#05131D' };
const gray: PartColor = { id: 72, name: 'Dark Bluish Gray', hex: '#6C6E68' };
const upright: SpeedOrientation = { x: 0, y: 0, z: 0 };

/** Internal construction helper: only supported catalogue geometry is emitted. */
export class AutomotivePartBuilder {
  readonly parts: SpeedPlacedPart[] = [];
  readonly patternUses: AutomotivePatternChoice[] = [];
  constructor(readonly prefix: string) {}
  add(partId: string, moduleId: VehicleModuleId, x: number, y: number, z: number, color: PartColor = black, orientation: SpeedOrientation = upright): SpeedPlacedPart {
    const definition = getSpeedPartDefinition(partId);
    if (definition?.support !== 'supported' || !definition.dimensions || !definition.shape || !definition.connectionPoints.length) throw new Error(`Automotive placement requires verified geometry: ${partId}`);
    if (this.parts.length >= 300) throw new Error('Automotive candidate exceeds the 300-part complexity budget.');
    const placed: SpeedPlacedPart = { instanceId: `${this.prefix}-${String(this.parts.length + 1).padStart(3, '0')}`, partId, name: definition.name, category: definition.category, color: { ...color }, dimensions: { ...definition.dimensions }, position: { x, y, z }, orientation: { ...orientation }, moduleId, connectionPoints: structuredClone(definition.connectionPoints), activeConnections: [], buildStep: 1 };
    this.parts.push(placed);
    return placed;
  }
  append(parts: readonly SpeedPlacedPart[], use?: Omit<AutomotivePatternChoice, 'status' | 'instanceIds'>): void {
    if (this.parts.length + parts.length > 300) throw new Error('Automotive candidate exceeds the 300-part complexity budget.');
    this.parts.push(...structuredClone(parts));
    if (use) this.patternUses.push({ ...structuredClone(use), status: 'instantiated', instanceIds: parts.map(part => part.instanceId) });
  }
}

/** Two wide transverse courses bridge seams in longitudinal lower rails. */
export function addAutomotiveChassis(builder: AutomotivePartBuilder, plan: AutomotiveCoarsePlan): void {
  const assembly = generatableWheelAssemblies().find(row => row.id === plan.wheelAssemblyId);
  if (!assembly || assembly.holderPart !== '3700' || !assembly.supportedVehicleWidths.includes(plan.layout.widthStuds)) throw new Error('The independently mounted automotive chassis needs the calibrated 3700 wheel assembly.');
  const width = plan.layout.widthStuds, length = plan.lengthStuds, chassisWidth = width - 4;
  for (const station of [plan.frontAxleStuds, plan.rearAxleStuds]) {
    for (const left of [true, false]) {
      const holderX = left ? 2 : width - 3;
      builder.add('3023', 'chassis', holderX, station - 1, 1);
      builder.add('3700', 'chassis', holderX, station - 1, 2);
      const side = left ? 'left' : 'right', moduleId = left ? 'leftWheelModule' : 'rightWheelModule';
      for (const pose of assembly.poses[side]) {
        // Keep each wheel chain and its pin unchanged. Independent holders
        // translate outwards as width grows; no part or axle is stretched.
        const shift = left ? 4 : width - 4;
        builder.add(pose.partId, moduleId, shift + pose.offset.x, station + pose.offset.y, pose.offset.z, pose.role === 'tyre' ? black : gray, pose.orientation);
      }
    }
  }
  const lowerPlates: Record<number, string> = { 2: '3022', 4: '3020', 6: '3795', 8: '3034', 10: '3832', 12: '2445', 14: '91988', 16: '4282' };
  // Two longitudinal rails carry the four independent holders. Transverse
  // upper courses join the rails and bridge each actual longitudinal seam.
  for (const x of plan.layout.reinforcementRailOffsets) {
    for (let y = 0; y < length;) {
      const depth = Math.min(16, length - y);
      if (depth % 2) throw new Error('Automotive chassis length must be an even stud count.');
      builder.add(lowerPlates[depth], 'chassis', x, y, 5);
      y += depth;
    }
  }
  const crossPlate: Record<number, string> = { 4: '3020', 6: '3795', 8: '3034' };
  const crossCap: Record<number, string> = { 4: '3710', 6: '3666', 8: '3460' };
  for (let y = 0; y < length;) {
    const depth = y === 0 || y === length - 1 ? 1 : 2;
    builder.add(depth === 1 ? crossCap[chassisWidth] : crossPlate[chassisWidth], 'chassis', width - 2, y, 6, black, { x: 0, y: 0, z: 90 });
    y += depth;
  }
}
