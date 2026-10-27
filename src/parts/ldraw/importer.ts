import { createHash } from 'node:crypto';
import type {
  LDrawBounds, LDrawImportLimits, LDrawIssue, LDrawMesh, LDrawPartResult,
  LDrawResolver, LDrawSourceFile, LDrawVector,
} from './types.js';

/** Bump when native parsing/transform semantics change; qualifications bind it. */
export const LDRAW_GEOMETRY_PARSER_VERSION = 'ldraw-native-parser-1';

type Matrix = [number, number, number, number, number, number, number, number, number];
type Affine = { matrix: Matrix; translation: LDrawVector };
type ParsedFile = { text: string; lines: string[]; source: LDrawSourceFile; name: string | null };
const IDENTITY: Affine = { matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1], translation: [0, 0, 0] };
const DEFAULT_LIMITS: LDrawImportLimits = {
  maxDepth: 48, maxFiles: 1500, maxFileBytes: 4_000_000, maxTotalBytes: 20_000_000,
  maxReferences: 100_000, maxTriangles: 300_000, maxEdges: 300_000,
};

/** No filesystem/network paths from a .dat file can escape the selected library. */
export function canonicalLDrawPath(value: string): string {
  const normalized = value.trim().replaceAll('\\', '/').toLowerCase();
  if (!normalized || normalized.startsWith('/') || normalized.includes(':') || /[\u0000-\u001f]/.test(normalized)) {
    throw new Error('Invalid absolute or empty LDraw path');
  }
  const pieces = normalized.split('/');
  if (pieces.some(piece => piece === '..' || piece === '')) throw new Error('LDraw path traversal is forbidden');
  const path = pieces.filter(piece => piece !== '.').join('/');
  if (!path || !path.endsWith('.dat')) throw new Error('Only native .dat files are accepted');
  return path;
}

function transformed(point: LDrawVector, affine: Affine): LDrawVector {
  const m = affine.matrix;
  return [
    m[0] * point[0] + m[1] * point[1] + m[2] * point[2] + affine.translation[0],
    m[3] * point[0] + m[4] * point[1] + m[5] * point[2] + affine.translation[1],
    m[6] * point[0] + m[7] * point[1] + m[8] * point[2] + affine.translation[2],
  ];
}

function composed(parent: Affine, child: Affine): Affine {
  const a = parent.matrix; const b = child.matrix;
  const matrix = new Array<number>(9).fill(0) as Matrix;
  for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
    for (let index = 0; index < 3; index++) matrix[row * 3 + col] += a[row * 3 + index] * b[index * 3 + col];
  }
  return { matrix, translation: transformed(child.translation, parent) };
}

function determinant(m: Matrix): number {
  return m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
}

function parseColor(token: string): number | undefined {
  if (!/^(?:\d+|0x[0-9a-f]+)$/i.test(token)) return undefined;
  const number = Number(token);
  return Number.isSafeInteger(number) && number >= 0 ? number : undefined;
}

function parseCoordinates(tokens: string[]): number[] | undefined {
  if (tokens.some(token => !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(token))) return undefined;
  const numbers = tokens.map(Number);
  return numbers.every(n => Number.isFinite(n) && Math.abs(n) <= 1e9) ? numbers : undefined;
}

class ImportFailure extends Error {
  constructor(readonly issue: LDrawIssue) { super(issue.message); }
}

/**
 * Import native geometry; geometryReady deliberately confers no connector,
 * collision-fit, manufacturing or generation approval.
 */
export class LDrawPartImporter {
  private readonly limits: LDrawImportLimits;
  private readonly cache = new Map<string, Promise<ParsedFile | undefined>>();

  constructor(readonly resolver: LDrawResolver, limits: Partial<LDrawImportLimits> = {}) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
    for (const [key, value] of Object.entries(this.limits)) {
      if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid LDraw resource limit: ${key}`);
    }
  }

  private load(path: string): Promise<ParsedFile | undefined> {
    let pending = this.cache.get(path);
    if (!pending) {
      pending = (async () => {
        const text = await this.resolver.readText(path);
        if (text === undefined) return undefined;
        const bytes = Buffer.byteLength(text, 'utf8');
        if (bytes > this.limits.maxFileBytes) throw new ImportFailure({ code: 'file-limit', message: 'Native file exceeds the byte limit', severity: 'error', file: path });
        const sha256 = createHash('sha256').update(text, 'utf8').digest('hex');
        const expected = this.resolver.expectedHashes?.[path];
        if (expected !== undefined && expected !== sha256) throw new ImportFailure({ code: 'source-integrity', message: 'Native file SHA-256 differs from the pinned manifest', severity: 'error', file: path });
        const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
        const license = lines.find(line => /^0\s+!LICENSE\s/.test(line))?.replace(/^0\s+!LICENSE\s+/, '').trim() ?? null;
        const author = lines.find(line => /^0\s+Author:\s/.test(line))?.replace(/^0\s+Author:\s+/, '').trim() ?? null;
        const name = /^0\s+(.+)$/.exec(lines[0])?.[1].trim() ?? null;
        return { text, lines, name, source: { path, sha256, bytes, license, author, sourceUrl: `${this.resolver.sourceRoot.replace(/\/?$/, '/')}${path}` } };
      })();
      this.cache.set(path, pending);
    }
    return pending;
  }

  async importPart(input: string): Promise<LDrawPartResult> {
    const issues: LDrawIssue[] = [];
    const sources = new Map<string, LDrawSourceFile>();
    let rootFile = ''; let partId = input; let name: string | null = null;
    const result = (): LDrawPartResult => ({
      status: 'failed', partId, name,
      source: {
        library: 'LDraw', revision: this.resolver.revision, rootFile,
        files: [...sources.values()].sort((a, b) => a.path.localeCompare(b.path)),
        licenseStatus: sources.size > 0 && [...sources.values()].every(file => file.license !== null) ? 'complete' : 'unknown',
        integrity: sources.size > 0 && [...sources.keys()].every(path => this.resolver.expectedHashes?.[path] !== undefined) ? 'verified' : 'not-manifested',
      }, issues,
    });
    try {
      const requested = input.trim().toLowerCase().replaceAll('\\', '/');
      rootFile = canonicalLDrawPath(requested.includes('/') ? requested : `parts/${requested.replace(/\.dat$/, '')}.dat`);
      partId = rootFile.slice(rootFile.lastIndexOf('/') + 1).replace(/\.dat$/, '');
      const root = await this.load(rootFile);
      if (!root) throw new ImportFailure({ code: 'missing-root', message: 'The requested part has no native file in this library snapshot', severity: 'error', file: rootFile });
      name = root.name;
      const mesh: LDrawMesh = { units: 'LDU', coordinateSystem: 'ldraw-native', positions: [], indices: [], triangleColors: [], doubleSided: [], edges: [], conditionalEdges: [] };
      let totalBytes = 0; let references = 0;
      const bound: LDrawBounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
      const included = (point: LDrawVector) => {
        if (point.some(n => !Number.isFinite(n) || Math.abs(n) > 1e12)) throw new ImportFailure({ code: 'coordinate-limit', message: 'Transformed geometry is outside the supported numeric range', severity: 'error' });
        for (let i = 0; i < 3; i++) { bound.min[i] = Math.min(bound.min[i], point[i]); bound.max[i] = Math.max(bound.max[i], point[i]); }
      };
      const resolve = async (reference: string, current: string): Promise<string | undefined> => {
        let target: string;
        try { target = canonicalLDrawPath(reference); } catch { throw new ImportFailure({ code: 'unsafe-reference', message: 'A native reference contains an unsafe path', severity: 'error', file: current }); }
        const directory = current.slice(0, current.lastIndexOf('/') + 1);
        const candidates = [...new Set([`${directory}${target}`, target, `parts/${target}`, `p/${target}`])];
        for (const candidate of candidates) if (await this.load(candidate)) return candidate;
        return undefined;
      };
      const visit = async (path: string, affine: Affine, inheritedColor: number, invertParity: boolean, inheritedNoClip: boolean, stack: string[]): Promise<void> => {
        if (stack.includes(path)) throw new ImportFailure({ code: 'cyclic-reference', message: `Native reference cycle: ${[...stack, path].join(' → ')}`, severity: 'error', file: path });
        if (stack.length >= this.limits.maxDepth) throw new ImportFailure({ code: 'depth-limit', message: 'Native reference depth limit reached', severity: 'error', file: path });
        const loaded = await this.load(path);
        if (!loaded) throw new ImportFailure({ code: 'missing-reference', message: 'A required native subpart or primitive is missing', severity: 'error', file: path });
        if (!sources.has(path)) {
          sources.set(path, loaded.source); totalBytes += loaded.source.bytes;
          if (sources.size > this.limits.maxFiles || totalBytes > this.limits.maxTotalBytes) throw new ImportFailure({ code: 'library-limit', message: 'Native import exceeds the file or byte limit', severity: 'error', file: path });
        }
        let certified = false; let ccw = true; let clip = true; let invertNext = false;
        const det = determinant(affine.matrix);
        if (!Number.isFinite(det) || det === 0) throw new ImportFailure({ code: 'singular-transform', message: 'Native reference transform is singular or not finite', severity: 'error', file: path });
        for (let lineIndex = 0; lineIndex < loaded.lines.length; lineIndex++) {
          const tokens = loaded.lines[lineIndex].trim().split(/\s+/);
          if (tokens.length === 1 && tokens[0] === '') continue;
          const line = lineIndex + 1;
          const fail = (code: string, message: string): never => { throw new ImportFailure({ code, message, severity: 'error', file: path, line }); };
          if (tokens[0] === '0') {
            if (tokens[1] === 'BFC') {
              const args = tokens.slice(2);
              if (args.includes('INVERTNEXT')) invertNext = !invertNext;
              if (args.includes('CERTIFY')) certified = true;
              if (args.includes('NOCERTIFY')) certified = false;
              if (args.includes('NOCLIP')) clip = false;
              if (args.includes('CLIP')) clip = true;
              if (args.includes('CW')) ccw = false;
              if (args.includes('CCW')) ccw = true;
            }
            if (tokens[1] === '!TEXMAP') fail('unsupported-texmap', 'Textured native geometry is not supported; no untextured substitute is emitted');
            continue;
          }
          const kind = Number(tokens[0]);
          if (!Number.isInteger(kind) || kind < 1 || kind > 5) fail('unsupported-line', 'Unsupported or malformed native line type');
          const color = parseColor(tokens[1] ?? '');
          if (color === undefined) fail('invalid-color', 'Native geometry has an invalid colour token');
          const actualColor = color === 16 ? inheritedColor : color;
          if (kind === 1) {
            if (tokens.length < 15) fail('invalid-reference', 'A type 1 native reference needs 12 transform values and a filename');
            const values = parseCoordinates(tokens.slice(2, 14));
            if (!values) fail('invalid-transform', 'A type 1 native reference has invalid transform values');
            const target = await resolve(tokens.slice(14).join(' '), path);
            if (!target) fail('missing-reference', `Required native subpart or primitive is missing: ${tokens.slice(14).join(' ')}`);
            references++;
            if (references > this.limits.maxReferences) fail('reference-limit', 'Native instance count exceeds the limit');
            const child: Affine = { translation: values!.slice(0, 3) as LDrawVector, matrix: values!.slice(3, 12) as Matrix };
            await visit(target!, composed(affine, child), actualColor!, invertParity !== invertNext, inheritedNoClip || !certified || !clip, [...stack, path]);
            invertNext = false;
            continue;
          }
          if (invertNext) { issues.push({ code: 'unused-bfc-invert', message: 'BFC INVERTNEXT was followed by a non-reference line', severity: 'warning', file: path, line }); invertNext = false; }
          const vertexCount = kind === 2 ? 2 : kind === 3 ? 3 : 4;
          if (tokens.length !== 2 + vertexCount * 3) fail('invalid-geometry', `Type ${kind} native geometry has the wrong number of coordinates`);
          const values = parseCoordinates(tokens.slice(2));
          if (!values) fail('invalid-coordinate', 'Native geometry contains an invalid numeric coordinate');
          const vertices: LDrawVector[] = [];
          for (let index = 0; index < vertexCount; index++) vertices.push(transformed(values!.slice(index * 3, index * 3 + 3) as LDrawVector, affine));
          if (kind === 2 || kind === 5) {
            if (mesh.edges.length + mesh.conditionalEdges.length >= this.limits.maxEdges) fail('edge-limit', 'Native edge count exceeds the limit');
            included(vertices[0]); included(vertices[1]);
            if (kind === 2) mesh.edges.push({ vertices: [vertices[0], vertices[1]], color: actualColor! });
            else mesh.conditionalEdges.push({ vertices: [vertices[0], vertices[1]], controls: [vertices[2], vertices[3]], color: actualColor! });
            continue;
          }
          if (mesh.triangleColors.length + (kind === 4 ? 2 : 1) > this.limits.maxTriangles) fail('triangle-limit', 'Native face count exceeds the limit');
          vertices.forEach(included);
          const base = mesh.positions.length;
          mesh.positions.push(...vertices);
          const flip = (!ccw) !== (invertParity !== (det < 0));
          const triangles = kind === 4 ? [[0, 1, 2], [0, 2, 3]] : [[0, 1, 2]];
          for (const triangle of triangles) {
            mesh.indices.push(base + triangle[0], base + triangle[flip ? 2 : 1], base + triangle[flip ? 1 : 2]);
            mesh.triangleColors.push(actualColor!);
            mesh.doubleSided.push(inheritedNoClip || !certified || !clip);
          }
        }
      };
      await visit(rootFile, IDENTITY, 16, false, false, []);
      if (mesh.indices.length === 0) throw new ImportFailure({ code: 'empty-mesh', message: 'Native file has no solid faces; a display placeholder is not a part mesh', severity: 'error', file: rootFile });
      if ([...sources.values()].some(file => file.license === null)) issues.push({ code: 'unknown-license', message: 'At least one native dependency has no license declaration', severity: 'warning' });
      return { ...result(), status: 'geometryReady', mesh, bounds: bound, collision: { kind: 'aabb', bounds: bound, derivedFrom: 'native-mesh', cavitiesResolved: false } };
    } catch (error) {
      if (error instanceof ImportFailure) issues.push(error.issue);
      else issues.push({ code: 'import-error', message: error instanceof Error ? error.message : 'Native geometry import failed', severity: 'error', file: rootFile || undefined });
      return result();
    }
  }
}
