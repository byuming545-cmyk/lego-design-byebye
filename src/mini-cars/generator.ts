import { axisRotation, IDENTITY_ROTATION, isRigidTransform, rotate, transformPoint } from '../parts/assembly/math.js';
import type { NativeAssemblyPart, Matrix3, Vector3 } from '../parts/assembly/types.js';
import { MiniCarError, MiniCatalog, miniDigest } from './catalog.js';
import { MINI_SCHEMA, MINI_GENERATOR_VERSION, MINI_COLORS, MINI_MAX_PARTS, type MiniModel, type MiniOptions, type MiniPlacement, type MiniRole, type MiniColor, type MiniBomRow, type MiniWheel } from './types.js';

export function parseMiniOptions(value: unknown): MiniOptions {
  const v = value as Partial<MiniOptions>;
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !['style', 'color', 'seed', 'spoiler'].includes(k)) ||
      !['sprint', 'gt'].includes(v.style ?? '') || !['red', 'blue', 'white', 'yellow'].includes(v.color ?? '') || typeof v.seed !== 'string' || !/^[a-zA-Z0-9_-]{1,32}$/.test(v.seed) || typeof v.spoiler !== 'boolean') throw new MiniCarError('请选择造型、车身色和尾翼，并输入 1–32 位字母、数字或短横线种子。');
  return { style: v.style!, color: v.color!, seed: v.seed, spoiler: v.spoiler };
}
export function placementBounds(part: NativeAssemblyPart, placement: MiniPlacement) {
  const b = part.geometry.bounds!, corners: Vector3[] = [];
  for (let i = 0; i < 8; i++) corners.push(transformPoint(placement.transform, b.min.map((v, a) => i & (1 << a) ? b.max[a] : v) as Vector3));
  return { min: [0,1,2].map(a => Math.min(...corners.map(c => c[a]))) as Vector3, max: [0,1,2].map(a => Math.max(...corners.map(c => c[a]))) as Vector3 };
}

/** Bounded, seeded layout of existing source meshes. The layout is a project
 * appearance design, not a reconstructed tutorial or a mechanical fit rule. */
export async function generateMiniCar(catalog: MiniCatalog, input: unknown): Promise<MiniModel> {
  const options = parseMiniOptions(input);
  const placements: MiniPlacement[] = [], wheels: MiniWheel[] = [];
  const halfAxle = options.style === 'sprint' ? 80 : 100, roofHalf = options.style === 'sprint' ? 20 : 40;
  const cover = parseInt(miniDigest(options.seed).slice(0, 2), 16) % 2 ? 'rounded' : 'angular';
  const parts = await catalog.load(['3020', '3022', '3032', '3623', '3004', '3001', '3039', '18974', '3068b', '3069b', '18977', '66727',
    ...(cover === 'rounded' ? ['15068'] : []), ...(options.spoiler ? ['3710', '3005'] : [])]);
  const put = (partId: string, role: MiniRole, color: MiniColor, x: number, y: number, z: number, degrees = 0, centerY = false) => {
    const part = parts.get(partId); if (!part) throw new MiniCarError('设计需要的真实零件缺失。', 'MINI_SOURCE_UNAVAILABLE', 409);
    const b = part.geometry.bounds!, rotation = degrees ? axisRotation([0, 1, 0], degrees) : [...IDENTITY_ROTATION] as Matrix3;
    const middle = b.min.map((v, a) => a === 1 && !centerY ? 0 : (v + b.max[a]) / 2) as Vector3, offset = rotate(rotation, middle);
    const p: MiniPlacement = { instanceId: `mini-part-${placements.length + 1}`, partId, role, color,
      transform: { rotation, translation: [x - offset[0], y - offset[1], z - offset[2]] }, assemblyStatus: 'NOT_VERIFIED' };
    if (placements.length >= MINI_MAX_PARTS || !isRigidTransform(p.transform)) throw new MiniCarError('外观布局超出规模或刚体边界。');
    placements.push(p); return p;
  };
  // A narrow continuous spine leaves real space beside the wheels. The central
  // six-wide deck and the two pairs of original arches establish body width.
  for (let z = -halfAxle - 20; z <= halfAxle + 20; z += 40) put('3022', 'chassis', 'black', 0, 16, z);
  put('3032', 'chassis', 'black', 0, 8, 0);
  for (const axle of [-halfAxle, halfAxle]) for (const side of [-1, 1]) {
    put('18974', 'body', options.color, side * 30, -42, axle, side < 0 ? 90 : -90);
    put('3068b', 'body', options.color, side * 30, -50, axle);
    // Centre/radius placement uses original mesh bounds for visual layout only.
    // No tyre-rim or axle mounting compatibility is asserted.
    const id = `${axle < 0 ? 'front' : 'rear'}-${side < 0 ? 'left' : 'right'}`;
    const center: Vector3 = [side * 55, 0, axle];
    const tyre = put('18977', 'wheel', 'black', ...center, side * 90, true);
    const rim = put('66727', 'wheel', 'graphite', ...center, side * 90, true);
    wheels.push({ id, center, axis: [side, 0, 0], tyreInstanceId: tyre.instanceId, rimInstanceId: rim.instanceId, fit: 'UNKNOWN', chassisMount: 'UNKNOWN' });
  }
  for (const end of [-1, 1]) {
    const nose = end * (halfAxle + 50);
    for (const x of [-30, 30]) put('3623', 'trim', 'black', x, 16, nose);
    for (const x of [-40, 0, 40]) {
      put('3004', 'body', options.color, x, -8, nose);
      put(cover === 'rounded' ? '15068' : '3039', 'body', options.color, x, cover === 'rounded' ? -8 : -32, nose, end < 0 ? 0 : 180);
    }
    put('3069b', 'body', options.color, 0, -26, end * (halfAxle + 10), 90);
  }
  for (let z = -roofHalf + 20; z <= roofHalf - 20; z += 40) {
    put('3020', 'chassis', 'black', 0, -24, z);
    put('3001', 'window', 'black', 0, -48, z);
    for (const x of [-20, 20]) put('3068b', 'roof', options.color, x, -56, z);
  }
  // Full side panels bridge the space between the original arch ends, including
  // the area below both sloping window pieces. A roof-only span leaves holes.
  for (let z = -halfAxle + 60; z <= halfAxle - 60; z += 40) for (const side of [-1, 1]) {
    put('3022', 'trim', 'black', side * 40, 0, z);
    put('3004', 'body', options.color, side * 50, -24, z, 90);
    put('3069b', 'body', options.color, side * 50, -32, z, 90);
  }
  for (const end of [-1, 1]) for (const x of [-20, 20]) {
    put('3039', 'window', 'black', x, -48, end * (roofHalf + 20), end < 0 ? 0 : 180);
    put('3069b', 'roof', options.color, x, -56, end * (roofHalf + 10));
  }
  if (options.spoiler) {
    for (const x of [-30, 30]) put('3005', 'spoiler', 'black', x, -48, halfAxle + 45);
    put('3710', 'spoiler', options.color, 0, -56, halfAxle + 45);
  }
  const body = placements.filter(p => p.role !== 'wheel').map(p => ({ p, bounds: placementBounds(parts.get(p.partId)!, p) }));
  const bodyBounds = { min: [0,1,2].map(a => Math.min(...body.map(p => p.bounds.min[a]))) as Vector3, max: [0,1,2].map(a => Math.max(...body.map(p => p.bounds.max[a]))) as Vector3 };
  const same = (a: number, b: number) => Math.abs(a - b) < 1e-5;
  for (const { p, bounds: b } of body) {
    if (Math.abs(b.min[0] + b.max[0]) < 1e-5) continue;
    if (!body.some(q => q.p.partId === p.partId && q.p.color === p.color && q.p.role === p.role && same(q.bounds.min[0], -b.max[0]) && same(q.bounds.max[0], -b.min[0]) && [1,2].every(a => same(q.bounds.min[a], b.min[a]) && same(q.bounds.max[a], b.max[a])))) throw new MiniCarError('外观左右布局不对称。');
  }
  const width = bodyBounds.max[0] - bodyBounds.min[0];
  if (!same(width, 120) || wheels.length !== 4) throw new MiniCarError('外观宽度或四轮布局未满足设计目标。');
  const sources = [...new Set(placements.map(p => p.partId))].sort().map(id => catalog.source(parts.get(id)!));
  const bom = new Map<string, MiniBomRow>();
  for (const p of placements) {
    const key = `${p.partId}:${p.color}`, row = bom.get(key);
    if (row) row.quantity++; else bom.set(key, { partId: p.partId, name: parts.get(p.partId)!.geometry.name ?? p.partId, color: p.color, ldrawColor: MINI_COLORS[p.color].ldraw,
      quantity: 1, colorAvailability: 'NOT_VERIFIED', assemblyStatus: 'NOT_VERIFIED' });
  }
  const content: Omit<MiniModel, 'id' | 'contentSha256'> = { schema: MINI_SCHEMA, generatorVersion: MINI_GENERATOR_VERSION, state: 'APPEARANCE_DRAFT' as const, units: 'LDU' as const,
    sourceSnapshot: catalog.snapshot, options, placements, sources, bom: [...bom.values()].sort((a,b) => a.partId.localeCompare(b.partId) || a.color.localeCompare(b.color)), wheels,
    layout: { bodyWidthStuds: 6 as const, lengthLdu: bodyBounds.max[2] - bodyBounds.min[2], wheelbaseLdu: halfAxle * 2, roofLengthLdu: roofHalf * 2, cover },
    checks: { version: 'mini-appearance-checks-1' as const, rigidTransforms: true as const, sourceIntegrity: true as const, wheelCount: 4 as const, bilateralBounds: true as const,
      bodyWidthLdu: width, bodyBounds, scope: 'layout-and-source-only' as const, collision: 'UNKNOWN' as const, connections: 'NOT_VERIFIED' as const, wheelFit: 'UNKNOWN' as const, physicalBuildVerified: false as const } };
  const withId = { ...content, id: 'mini-' + miniDigest(content).slice(0,24) };
  return { ...withId, contentSha256: miniDigest(withId) };
}
