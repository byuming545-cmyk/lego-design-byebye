import type { PlacedPart } from '../types/index.js';

export interface IsometricOptions {
  highlightIds?: string[];
  background?: string;
  labels?: boolean;
  showGrid?: boolean;
  exploded?: boolean;
}

type Point = { x: number; y: number };
type Point3 = { x: number; y: number; z: number };
interface Block {
  part: PlacedPart;
  x: number;
  y: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  top: Point3[];
  bottom: Point3[];
  surfaces: Point3[][];
  sides: Point3[][];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

// LEGO coordinates use studs on the floor and plates vertically: one plate is 0.4 studs.
const COS_30 = Math.sqrt(3) / 2;
const PLATE_HEIGHT = 0.4;
const EPSILON = 0.00001;

function project(point: Point3): Point {
  return { x: (point.x - point.y) * COS_30, y: (point.x + point.y) * 0.5 - point.z * PLATE_HEIGHT };
}

function tint(hex: string, amount: number): string {
  const value = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : /^#[0-9a-f]{3}$/i.test(hex) ? hex.slice(1).split('').map(c => c + c).join('') : 'a3a9b3';
  const channels = [0, 2, 4].map(offset => {
    const channel = Number.parseInt(value.slice(offset, offset + 2), 16);
    return Math.round(amount < 0 ? channel * (1 + amount) : channel + (255 - channel) * amount);
  });
  return `rgb(${channels.join(',')})`;
}

function makeBlock(part: PlacedPart, exploded: boolean): Block {
  const quarterTurn = part.rotation === 90 || part.rotation === 270;
  const width = quarterTurn ? part.dimensions.y : part.dimensions.x;
  const depth = quarterTurn ? part.dimensions.x : part.dimensions.y;
  const { x, y } = part.position;
  const z = part.position.z + (exploded ? Math.max(0, part.buildStep - 1) * 0.7 : 0);
  const height = part.dimensions.z;
  const xy = [[x, y], [x + width, y], [x + width, y + depth], [x, y + depth]];
  const bottom = xy.map(([px, py]) => ({ x: px, y: py, z }));
  const world = (u: number, v: number, h: number): Point3 => {
    if (part.rotation === 90) return { x: x + part.dimensions.y - v, y: y + u, z: z + h };
    if (part.rotation === 180) return { x: x + part.dimensions.x - u, y: y + part.dimensions.y - v, z: z + h };
    if (part.rotation === 270) return { x: x + v, y: y + part.dimensions.x - u, z: z + h };
    return { x: x + u, y: y + v, z: z + h };
  };
  let top = xy.map(([px, py]) => ({ x: px, y: py, z: z + height }));
  let surfaces = [top];
  if (part.category === 'Slope') {
    const rawWidth = part.dimensions.x, rawDepth = part.dimensions.y;
    const shoulder = rawDepth - Math.min(1, rawDepth / 2);
    const toe = Math.min(height * 0.25, 0.625);
    top = [world(0, 0, toe), world(rawWidth, 0, toe), world(rawWidth, shoulder, height), world(rawWidth, rawDepth, height), world(0, rawDepth, height), world(0, shoulder, height)];
    surfaces = [
      [world(0, 0, toe), world(rawWidth, 0, toe), world(rawWidth, shoulder, height), world(0, shoulder, height)],
      [world(0, shoulder, height), world(rawWidth, shoulder, height), world(rawWidth, rawDepth, height), world(0, rawDepth, height)],
    ];
  }
  const sides = [
    [bottom[1], bottom[2], ...top.filter(p => Math.abs(p.x - x - width) < EPSILON).sort((a, b) => b.y - a.y)],
    [bottom[2], bottom[3], ...top.filter(p => Math.abs(p.y - y - depth) < EPSILON).sort((a, b) => a.x - b.x)],
  ];
  const projected = [...bottom, ...top].map(project);
  return {
    part, x, y, z, width, depth, height, top, bottom, surfaces, sides,
    bounds: {
      minX: Math.min(...projected.map(p => p.x)), maxX: Math.max(...projected.map(p => p.x)),
      minY: Math.min(...projected.map(p => p.y)) - 0.18, maxY: Math.max(...projected.map(p => p.y)),
    },
  };
}

// Resolve visible, nonintersecting boxes from the back to the front. Explicit
// above/below dependencies keep tall stacks correct even when their footprints differ.
function depthOrder(blocks: Block[]): Block[] {
  const edges = blocks.map(() => new Set<number>());
  const incoming = blocks.map(() => 0);
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      const a = blocks[i], b = blocks[j];
      if (a.bounds.maxX < b.bounds.minX || b.bounds.maxX < a.bounds.minX || a.bounds.maxY < b.bounds.minY || b.bounds.maxY < a.bounds.minY) continue;
      const directions: number[] = [];
      if (a.x + a.width <= b.x + EPSILON) directions.push(1);
      else if (b.x + b.width <= a.x + EPSILON) directions.push(-1);
      if (a.y + a.depth <= b.y + EPSILON) directions.push(1);
      else if (b.y + b.depth <= a.y + EPSILON) directions.push(-1);
      if (a.z + a.height <= b.z + EPSILON) directions.push(1);
      else if (b.z + b.height <= a.z + EPSILON) directions.push(-1);
      if (!directions.length || directions.some(direction => direction !== directions[0])) continue;
      const from = directions[0] === 1 ? i : j;
      const to = directions[0] === 1 ? j : i;
      edges[from].add(to);
      incoming[to]++;
    }
  }
  const priority = (index: number) => {
    const b = blocks[index];
    return b.x + b.y + (b.width + b.depth) * 0.5 + (b.z + b.height * 0.5) * PLATE_HEIGHT;
  };
  const ready = incoming.flatMap((count, index) => count === 0 ? [index] : []);
  const result: Block[] = [];
  const visited = new Set<number>();
  while (ready.length) {
    ready.sort((a, b) => priority(a) - priority(b) || a - b);
    const index = ready.shift()!;
    visited.add(index);
    result.push(blocks[index]);
    for (const next of edges[index]) if (--incoming[next] === 0) ready.push(next);
  }
  // Valid models produce an acyclic order. Retain every piece for arbitrary callers too.
  blocks.forEach((block, index) => { if (!visited.has(index)) result.push(block); });
  return result;
}

/** Render the supplied state without WebGL, network requests, or hidden model mutations. */
export function renderIsometric(canvas: HTMLCanvasElement, parts: PlacedPart[], options: IsometricOptions = {}): void {
  const ctx = canvas.getContext('2d');
  if (!ctx || !canvas.width || !canvas.height) return;
  const width = canvas.width, height = canvas.height;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  if (options.background !== 'transparent') {
    ctx.fillStyle = options.background ?? '#f6f4ee';
    ctx.fillRect(0, 0, width, height);
  }
  const validParts = parts.filter(part => [part.position.x, part.position.y, part.position.z, part.dimensions.x, part.dimensions.y, part.dimensions.z].every(Number.isFinite) && part.dimensions.x > 0 && part.dimensions.y > 0 && part.dimensions.z > 0);
  if (!validParts.length) {
    ctx.fillStyle = '#777a78';
    ctx.font = `${Math.max(14, Math.min(width / 24, 24))}px "Noto Sans SC", sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('等待拼搭灵感', width / 2, height / 2);
    ctx.restore();
    return;
  }
  const blocks = validParts.map(part => makeBlock(part, options.exploded ?? false));
  const minX = Math.min(...blocks.map(b => b.bounds.minX));
  const maxX = Math.max(...blocks.map(b => b.bounds.maxX));
  const minY = Math.min(...blocks.map(b => b.bounds.minY));
  const maxY = Math.max(...blocks.map(b => b.bounds.maxY));
  const padding = Math.min(width, height) * 0.09;
  const scale = Math.min((width - padding * 2) / Math.max(1, maxX - minX), (height - padding * 2) / Math.max(1, maxY - minY));
  const offsetX = (width - (maxX + minX) * scale) / 2;
  const offsetY = (height - (maxY + minY) * scale) / 2;
  const screen = (point: Point3): Point => {
    const p = project(point);
    return { x: offsetX + p.x * scale, y: offsetY + p.y * scale };
  };
  const path = (points: Point3[]) => {
    ctx.beginPath();
    points.forEach((point, index) => {
      const p = screen(point);
      if (index === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    });
    ctx.closePath();
  };
  const footprint = {
    minX: Math.min(...blocks.map(b => b.x)), maxX: Math.max(...blocks.map(b => b.x + b.width)),
    minY: Math.min(...blocks.map(b => b.y)), maxY: Math.max(...blocks.map(b => b.y + b.depth)),
    z: Math.min(...blocks.map(b => b.z)),
  };
  // Ground shadow and optional grid provide orientation without hiding any geometry.
  const floor = [
    { x: footprint.minX - 0.35, y: footprint.minY - 0.35, z: footprint.z - 0.04 },
    { x: footprint.maxX + 0.35, y: footprint.minY - 0.35, z: footprint.z - 0.04 },
    { x: footprint.maxX + 0.35, y: footprint.maxY + 0.35, z: footprint.z - 0.04 },
    { x: footprint.minX - 0.35, y: footprint.maxY + 0.35, z: footprint.z - 0.04 },
  ];
  path(floor);
  ctx.fillStyle = 'rgba(35, 45, 39, 0.055)';
  ctx.fill();
  if (options.showGrid) {
    ctx.strokeStyle = 'rgba(66, 80, 66, 0.11)';
    ctx.lineWidth = Math.max(0.5, scale * 0.009);
    const line = (a: Point3, b: Point3) => {
      const sa = screen(a), sb = screen(b);
      ctx.beginPath(); ctx.moveTo(sa.x, sa.y); ctx.lineTo(sb.x, sb.y); ctx.stroke();
    };
    for (let x = Math.floor(footprint.minX); x <= footprint.maxX && x < footprint.minX + 100; x++) line({ x, y: footprint.minY, z: footprint.z }, { x, y: footprint.maxY, z: footprint.z });
    for (let y = Math.floor(footprint.minY); y <= footprint.maxY && y < footprint.minY + 100; y++) line({ x: footprint.minX, y, z: footprint.z }, { x: footprint.maxX, y, z: footprint.z });
  }
  const highlighted = new Set(options.highlightIds ?? []);
  depthOrder(blocks).forEach(block => {
    const { part } = block;
    const active = highlighted.has(part.instanceId);
    const color = part.color.hex;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = active ? '#2d8756' : tint(color, -0.45);
    ctx.lineWidth = active ? Math.max(1.5, scale * 0.04) : Math.max(0.55, scale * 0.015);
    const face = (points: Point3[], shade: number) => {
      path(points); ctx.fillStyle = tint(color, shade); ctx.fill(); ctx.stroke();
    };
    face(block.sides[0], -0.19);
    face(block.sides[1], -0.32);
    block.surfaces.forEach((surface, index) => face(surface, part.category === 'Slope' && index === 0 ? 0.04 : 0.12));
    // Slopes have studs only on their high, flat rear row; tiles have none.
    if (part.category === 'Brick' || part.category === 'Plate' || part.category === 'Slope') {
      const cols = Math.min(64, Math.floor(part.dimensions.x));
      const rows = Math.min(64, Math.floor(part.dimensions.y));
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          if (part.category === 'Slope' && row !== rows - 1) continue;
          const u = col + 0.5, v = row + 0.5;
          const local = part.rotation === 90 ? { x: part.dimensions.y - v, y: u }
            : part.rotation === 180 ? { x: part.dimensions.x - u, y: part.dimensions.y - v }
            : part.rotation === 270 ? { x: v, y: part.dimensions.x - u }
            : { x: u, y: v };
          const p = screen({ x: block.x + local.x, y: block.y + local.y, z: block.z + block.height });
          const rx = scale * 0.285, ry = scale * 0.145, rise = scale * 0.085;
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, rx, ry, 0, 0, Math.PI);
          ctx.lineTo(p.x - rx, p.y - rise);
          ctx.ellipse(p.x, p.y - rise, rx, ry, 0, Math.PI, Math.PI * 2);
          ctx.closePath();
          ctx.fillStyle = tint(color, -0.13); ctx.fill(); ctx.stroke();
          ctx.beginPath();
          ctx.ellipse(p.x, p.y - rise, rx, ry, 0, 0, Math.PI * 2);
          ctx.fillStyle = tint(color, 0.23); ctx.fill(); ctx.stroke();
        }
      }
    }
    if (options.labels && active) {
      const p = screen({ x: block.x + block.width / 2, y: block.y + block.depth / 2, z: block.z + block.height + 0.7 });
      ctx.font = `${Math.max(10, Math.min(18, scale * 0.4))}px "Noto Sans SC", sans-serif`;
      const text = part.partId;
      const textWidth = ctx.measureText(text).width;
      ctx.fillStyle = '#ffffff'; ctx.fillRect(p.x - textWidth / 2 - 5, p.y - 15, textWidth + 10, 22);
      ctx.fillStyle = '#2d704c'; ctx.textAlign = 'center'; ctx.fillText(text, p.x, p.y + 1);
    }
  });
  ctx.restore();
}
