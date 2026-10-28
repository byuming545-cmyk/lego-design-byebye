import type { NativeMesh } from '../components/NativePartViewer.js';

const SIZE = 128;
const PAD = 8;
const cache = new Map<string, string>();
const LIMIT = 400;

function project(point: readonly number[]): [number, number, number] {
  const [x, y, z] = [Number(point[0] ?? 0), Number(point[1] ?? 0), Number(point[2] ?? 0)];
  const a = -Math.PI / 5, b = Math.PI / 6;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
  return [x * cb + z * sb, y * ca - (-x * sb + z * cb) * sa, y * sa + (-x * sb + z * cb) * ca];
}

/** A deterministic, real-geometry SVG preview. It is a projection of the source mesh only. */
export function thumbnailSvg(partId: string, mesh: NativeMesh): string {
  const cached = cache.get(partId);
  if (cached) return cached;
  const positions = mesh.positions;
  const indices = mesh.indices;
  if (!positions.length || !indices.length) throw new Error('Part has no native triangles.');
  const projected = positions.map(project);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of projected) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  const scale = (SIZE - PAD * 2) / Math.max(maxX - minX, maxY - minY, 1);
  const ox = SIZE / 2 - ((minX + maxX) / 2) * scale, oy = SIZE / 2 + ((minY + maxY) / 2) * scale;
  const triangles: { points: string; depth: number; shade: number }[] = [];
  const stride = Math.max(3, Math.floor(indices.length / 3 / 6000) * 3);
  for (let i = 0; i + 2 < indices.length; i += stride) {
    const ia = indices[i] ?? 0, ib = indices[i + 1] ?? 0, ic = indices[i + 2] ?? 0;
    const a = projected[ia], b = projected[ib], c = projected[ic];
    if (!a || !b || !c) continue;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz) || 1;
    const light = Math.abs((nx * .35 + ny * .55 + nz * .75) / length);
    triangles.push({
      points: `${(a[0] * scale + ox).toFixed(1)},${(SIZE - (a[1] * scale + oy)).toFixed(1)} ${(b[0] * scale + ox).toFixed(1)},${(SIZE - (b[1] * scale + oy)).toFixed(1)} ${(c[0] * scale + ox).toFixed(1)},${(SIZE - (c[1] * scale + oy)).toFixed(1)}`,
      depth: (a[2] + b[2] + c[2]) / 3,
      shade: Math.max(.28, Math.min(1, light)),
    });
  }
  triangles.sort((a, b) => a.depth - b.depth);
  const body = triangles.slice(0, 6000).map(triangle => {
    const value = Math.round(70 + 105 * triangle.shade);
    return `<polygon points="${triangle.points}" fill="rgb(${Math.round(value * .72)},${value},${Math.round(value * .82)})" stroke="rgba(20,55,42,.22)" stroke-width=".35"/>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" role="img" aria-label="真实零件 ${partId} 的几何缩略图"><rect width="${SIZE}" height="${SIZE}" rx="10" fill="#f4f0e5"/>${body}</svg>`;
  if (cache.size >= LIMIT) cache.clear();
  cache.set(partId, svg);
  return svg;
}
