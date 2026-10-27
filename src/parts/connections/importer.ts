import { createHash } from 'node:crypto';
import type {
  ConnectionImportIssue, ConnectionImportOptions, ConnectionImportResult,
  ConnectionLibrary, ConnectionMatrix, ConnectionSourceFile,
  ConnectionTransformEvidence, ConnectionVector, DiscardedConnectionIssue, ImportedConnectionPoint,
  PartDescriptionEvidence,
} from './types.js';

export const SHADOW_REVISION = '9b1131fb1991f8c0bfc072325e4e12f6271aba35';
export const SHADOW_SOURCE_ROOT = `https://raw.githubusercontent.com/RolandMelkert/LDCadShadowLibrary/${SHADOW_REVISION}/`;
export const CONNECTION_PARSER_VERSION = 'ldcad-shadow-parser-2-clear-scope';
/** Additive root-description context; it does not alter serialized point records. */
export const PART_DESCRIPTION_VERSION = 'ldraw-root-description-1';
const IDENTITY: ConnectionMatrix = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const ZERO: ConnectionVector = [0, 0, 0];
/**
 * Root part-description context is provenance, not a connector field. Keeping it
 * out of the point record preserves the historical point digest while binding it
 * to the exact immutable point instance produced by this importer.
 */
const partDescriptions = new WeakMap<ImportedConnectionPoint, PartDescriptionEvidence>();
const connectionDescriptions = new WeakMap<ImportedConnectionPoint, PartDescriptionEvidence>();
export function partDescriptionFor(point: ImportedConnectionPoint): PartDescriptionEvidence | null {
  return partDescriptions.get(point) ?? null;
}
/** The declaring Shadow/primitive file's own title, bound to this point only. */
export function connectionDescriptionFor(point: ImportedConnectionPoint): PartDescriptionEvidence | null {
  return connectionDescriptions.get(point) ?? null;
}
function titleLine(lines: string[], source: ConnectionSourceFile): PartDescriptionEvidence | undefined {
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw.startsWith('0 ')) continue;
    const text = raw.slice(2).trim();
    if (!text || /^(!|\/\/|Name:|Author:|BFC|STEP|END\b)/i.test(text)) continue;
    const quoted = /^LDCad shadow info for "([^"]+)"$/i.exec(text);
    return { text: quoted ? quoted[1].trim() : text, line: i + 1, raw, source: { ...source } };
  }
  return undefined;
}

export function canonicalConnectionPath(input: string): string | undefined {
  const path = input.trim().toLowerCase().replaceAll('\\', '/');
  if (!path || path.startsWith('/') || /[:\x00-\x1f]/.test(path) || path.split('/').some((p) => !p || p === '.' || p === '..')) return undefined;
  return path;
}

function vector(matrix: ConnectionMatrix, point: ConnectionVector): ConnectionVector {
  return [matrix[0] * point[0] + matrix[1] * point[1] + matrix[2] * point[2], matrix[3] * point[0] + matrix[4] * point[1] + matrix[5] * point[2], matrix[6] * point[0] + matrix[7] * point[1] + matrix[8] * point[2]];
}
function add(a: ConnectionVector, b: ConnectionVector): ConnectionVector { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function finite(values: number[]) { return values.every(Number.isFinite); }
function multiply(a: ConnectionMatrix, b: ConnectionMatrix): ConnectionMatrix {
  const c = new Array<number>(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) c[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return c as ConnectionMatrix;
}
function rigid(matrix: ConnectionMatrix): boolean {
  const c = [[matrix[0], matrix[3], matrix[6]], [matrix[1], matrix[4], matrix[7]], [matrix[2], matrix[5], matrix[8]]];
  return c.every((v) => Math.abs(Math.hypot(...v) - 1) < 1e-5) && c.every((v, i) => c.every((w, j) => i === j || Math.abs(v.reduce((s, n, k) => s + n * w[k], 0)) < 1e-5));
}
function numbers(input: string | undefined, count: number, fallback?: number[]): number[] | undefined {
  if (input === undefined) return fallback?.slice();
  const tokens = input.trim().split(/\s+/);
  if (tokens.length !== count) return undefined;
  const values = tokens.map(Number);
  return values.every(Number.isFinite) ? values : undefined;
}

function properties(input: string): Record<string, string> | undefined {
  const result: Record<string, string> = {};
  const re = /\[([a-zA-Z][a-zA-Z0-9]*)=([^\]]*)\]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(input))) {
    const key = match[1].toLowerCase();
    if (Object.hasOwn(result, key)) return undefined;
    result[key] = match[2].trim();
  }
  return input.replace(re, '').trim() ? undefined : result;
}

/** Standard X/Z grids. Unsupported three-dimensional grids remain explicit issues. */
function gridOffsets(input: string | undefined): ConnectionVector[] | undefined {
  if (input === undefined) return [[0, 0, 0]];
  const tokens = input.trim().split(/\s+/);
  const counts: { count: number; centered: boolean }[] = [];
  let index = 0;
  for (let dimension = 0; dimension < 2; dimension++) {
    const centered = tokens[index]?.toUpperCase() === 'C';
    if (centered) index++;
    const count = Number(tokens[index++]);
    if (!Number.isInteger(count) || count < 1 || count > 256) return undefined;
    counts.push({ count, centered });
  }
  if (tokens.length - index !== 2) return undefined;
  const dx = Number(tokens[index++]), dz = Number(tokens[index]);
  if (![dx, dz].every(Number.isFinite) || counts[0].count * counts[1].count > 4096) return undefined;
  const result: ConnectionVector[] = [];
  for (let x = 0; x < counts[0].count; x++) for (let z = 0; z < counts[1].count; z++) result.push([
    (x - (counts[0].centered ? (counts[0].count - 1) / 2 : 0)) * dx,
    0,
    (z - (counts[1].centered ? (counts[1].count - 1) / 2 : 0)) * dz,
  ]);
  return result;
}

function family(kind: ImportedConnectionPoint['kind'], id: string | null, group: string | null, sections: ImportedConnectionPoint['sections'], gender: ImportedConnectionPoint['gender']): ImportedConnectionPoint['family'] {
  if (kind === 'clip') return 'clip';
  if (kind === 'generic') return group?.startsWith('rim') ? 'wheelMount' : 'generic';
  if (sections.some((s) => s.profile === 'A')) return gender === 'M' ? 'axle' : 'axleHole';
  if (id && /^stud(C|O|2|3)$/.test(id)) return gender === 'M' ? 'stud' : 'cylinder';
  if (id === 'aStud') return 'antiStud';
  if (id && /^(axle|axleHole)/.test(id)) return gender === 'M' ? 'axle' : 'axleHole';
  if (id && /^(connhole|connhol3)$/.test(id)) return 'pinHole';
  if (id && /^(conn4|fpin10|fpin11|pin8)$/.test(id)) return 'pin';
  // Unnamed round cylinders are kept generic: a radius alone is not a connector identity.
  return 'cylinder';
}

export async function importLdcadShadow(partId: string, library: ConnectionLibrary, options: ConnectionImportOptions = {}): Promise<ConnectionImportResult> {
  const issues: ConnectionImportIssue[] = [];
  const discardedIssues: DiscardedConnectionIssue[] = [];
  // Only dimension warnings tied to emitted points can be retired by a source CLEAR.
  // Syntax, integrity, missing-source and resource failures are never discarded.
  const pointScopedIssues = new Map<ConnectionImportIssue, Set<ImportedConnectionPoint>>();
  const sources = new Map<string, ConnectionSourceFile>();
  const cache = new Map<string, Promise<string | undefined>>();
  const maxDepth = options.maxDepth ?? 48, maxPoints = options.maxPoints ?? 20000, maxFiles = options.maxFiles ?? 4000, maxVisits = options.maxVisits ?? 30000;
  let visits = 0, serial = 0, issueBudgetExceeded = false;
  const report = (issue: ConnectionImportIssue) => { if (issues.length < 300) issues.push(issue); else issueBudgetExceeded = true; return issue; };
  function sourceClear(removed: ImportedConnectionPoint[], file: string, line: number, directive: string) {
    const removedSet = new Set(removed);
    for (const [issue, affected] of pointScopedIssues) {
      if (!affected.size || ![...affected].every(point => removedSet.has(point))) continue;
      const index = issues.indexOf(issue);
      if (index >= 0) {
        issues.splice(index, 1);
        discardedIssues.push({ ...issue, affectedConnectionIds: [...affected].map(point => point.id), discardedBy: { file, line, directive }, reason: 'source-clear-removed-all-affected-points' });
      }
      pointScopedIssues.delete(issue);
    }
  }
  async function read(path: string, layer: 'geometry' | 'shadow') {
    const key = `${layer}:${path}`;
    if (!cache.has(key)) {
      if (cache.size >= maxFiles * 2) { report({ code: 'resource-limit', file: path, message: 'File budget exceeded.' }); return undefined; }
      cache.set(key, (async () => {
        let value: string | undefined;
        try { value = await (layer === 'geometry' ? library.getGeometryFile(path) : library.getShadowFile(path)); }
        catch (error) { report({ code: 'integrity-failure', file: path, message: error instanceof Error ? error.message : 'Source failed integrity validation.' }); return undefined; }
        if (value === undefined) return undefined;
        const revision = layer === 'geometry' ? (library.geometryRevision ?? 'not-specified') : (library.shadowRevision ?? SHADOW_REVISION);
        const root = layer === 'geometry' ? (library.geometrySourceRoot ?? '') : (library.shadowSourceRoot ?? SHADOW_SOURCE_ROOT);
        sources.set(key, { library: layer === 'geometry' ? 'LDraw' : 'LDCadShadowLibrary', path, revision, sha256: createHash('sha256').update(value).digest('hex'), license: layer === 'shadow' ? 'CC-BY-SA-4.0' : (/^0 !LICENSE (.+)$/m.exec(value)?.[1]?.trim() ?? 'not-specified'), sourceUrl: `${root}${path}` });
        return value;
      })());
    }
    return cache.get(key)!;
  }
  async function resolve(ref: string, current: string, layer: 'geometry' | 'shadow'): Promise<string | undefined> {
    const safe = canonicalConnectionPath(ref);
    if (!safe) { report({ code: 'invalid-path', file: current, message: `Unsafe source reference: ${ref}` }); return undefined; }
    const parent = current.slice(0, current.lastIndexOf('/') + 1);
    const candidates = [...new Set([safe, `${parent}${safe}`, `parts/${safe}`, `p/${safe}`])];
    for (const path of candidates) if (await read(path, layer) !== undefined) return path;
    return undefined;
  }
  async function walk(path: string, transform: ConnectionMatrix, position: ConnectionVector, evidence: ConnectionTransformEvidence[], stack: string[], shadowOnly = false, description?: PartDescriptionEvidence): Promise<ImportedConnectionPoint[]> {
    const key = `${shadowOnly ? 'shadow' : 'geometry'}:${path}`;
    if (stack.includes(key)) { report({ code: 'cycle', file: path, message: 'Recursive source reference.' }); return []; }
    if (stack.length >= maxDepth || ++visits > maxVisits) { report({ code: 'resource-limit', file: path, message: 'Recursion/instance budget exceeded.' }); return []; }
    const nextStack = [...stack, key];
    let points: ImportedConnectionPoint[] = [];
    if (!shadowOnly) {
      const geometry = await read(path, 'geometry');
      if (geometry === undefined) { report({ code: 'missing-geometry', file: path, message: 'Native geometry source is unavailable; inherited connections cannot be established.' }); return []; }
      const lines = geometry.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const raw = lines[i].trim();
        if (!/^1\s/.test(raw)) continue;
        const tokens = raw.split(/\s+/), values = tokens.slice(2, 14).map(Number);
        if (tokens.length < 15 || values.length !== 12 || !values.every(Number.isFinite)) { report({ code: 'invalid-directive', file: path, line: i + 1, message: 'Invalid native type-1 transform.' }); continue; }
        const ref = tokens.slice(14).join(' '), child = await resolve(ref, path, 'geometry');
        if (!child) { report({ code: 'missing-geometry', file: path, line: i + 1, message: `Missing native reference: ${ref}` }); continue; }
        const shift = values.slice(0, 3) as ConnectionVector, matrix = values.slice(3) as ConnectionMatrix;
        const childEvidence = [...evidence, { file: path, line: i + 1, directive: raw, position: shift, matrix }];
        const childMatrix = multiply(transform, matrix), childPosition = add(position, vector(transform, shift));
        if (!finite(childMatrix) || !finite(childPosition)) { report({ code: 'invalid-directive', file: path, line: i + 1, message: 'Native transform overflows finite coordinates.' }); continue; }
        points.push(...await walk(child, childMatrix, childPosition, childEvidence, nextStack, false, description));
        if (points.length > maxPoints) { report({ code: 'resource-limit', file: path, message: 'Connection point budget exceeded.' }); return []; }
      }
    }
    const shadow = await read(path, 'shadow');
    if (shadow === undefined) return points;
    const source = sources.get(`shadow:${path}`)!;
    const lines = shadow.split(/\r?\n/);
    const connectionDescription = titleLine(lines, source);
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i].trim(), match = /^0\s+!LDCAD\s+(SNAP_[A-Z_]+)(?:\s+(.*))?$/i.exec(raw);
      if (!match) continue;
      const command = match[1].toUpperCase(), props = properties(match[2] ?? '');
      const invalid = (message: string, code: ConnectionImportIssue['code'] = 'invalid-directive') => report({ code, file: path, line: i + 1, message, directive: raw, source: { ...source }, transforms: evidence.map(e => ({ ...e, position: [...e.position] as ConnectionVector, matrix: [...e.matrix] as ConnectionMatrix })) });
      if (!props) { invalid('Malformed or duplicate bracket properties.'); continue; }
      if (command === 'SNAP_CLEAR') {
        if (Object.keys(props).some((key) => !['id'].includes(key))) { invalid('Unsupported SNAP_CLEAR filter.', 'unsupported-directive'); points = []; continue; }
        const removed = props.id ? points.filter((point) => point.sourceId === props.id) : points;
        sourceClear(removed, path, i + 1, raw);
        points = props.id ? points.filter((point) => point.sourceId !== props.id) : [];
        continue;
      }
      if (!['SNAP_CYL', 'SNAP_CLP', 'SNAP_GEN', 'SNAP_INCL'].includes(command)) { invalid(`Unsupported ${command}; no synthetic connection emitted.`, 'unsupported-directive'); continue; }
      const pos = numbers(props.pos, 3, ZERO) as ConnectionVector | undefined, ori = numbers(props.ori, 9, IDENTITY) as ConnectionMatrix | undefined, offsets = gridOffsets(props.grid);
      if (!pos || !ori || !offsets) { invalid('Invalid position/orientation or unsupported grid dimensions.'); continue; }
      const common = ['id', 'pos', 'ori', 'grid'];
      const allowed = new Set([...common, ...(command === 'SNAP_INCL' ? ['ref'] : command === 'SNAP_CYL' ? ['gender', 'caps', 'secs', 'center', 'slide', 'scale', 'group'] : command === 'SNAP_CLP' ? ['radius', 'length', 'center', 'slide', 'scale', 'group'] : ['gender', 'group', 'bounding', 'placement', 'match', 'scale'])]);
      if (Object.keys(props).some((key) => !allowed.has(key))) invalid('Unimplemented source property; source remains unverified.', 'unsupported-directive');
      if (command === 'SNAP_INCL') {
        if (!props.ref) { invalid('SNAP_INCL requires a reference.'); continue; }
        const child = await resolve(props.ref, path, 'shadow');
        if (!child) { invalid(`Missing shadow include: ${props.ref}`, 'missing-shadow-include'); continue; }
        for (const offset of offsets) {
          const shift = add(pos, offset);
          const childMatrix = multiply(transform, ori), childPosition = add(position, vector(transform, shift));
          if (!finite(childMatrix) || !finite(childPosition)) { invalid('Shadow include overflows finite coordinates.'); continue; }
          points.push(...await walk(child, childMatrix, childPosition, [...evidence, { file: path, line: i + 1, directive: raw, position: shift, matrix: ori }], nextStack, true, description));
          if (points.length > maxPoints) { invalid('Connection point budget exceeded.', 'resource-limit'); return []; }
        }
        continue;
      }
      const kind = command === 'SNAP_CYL' ? 'cylinder' : command === 'SNAP_CLP' ? 'clip' : 'generic';
      const gender = props.gender === 'M' || props.gender === 'F' ? props.gender : kind === 'clip' ? 'F' : null;
      if (kind !== 'clip' && !gender) { invalid('A cylinder/generic connection requires an explicit source gender.'); continue; }
      const sections: ImportedConnectionPoint['sections'] = [];
      if (kind === 'cylinder') {
        const tokens = props.secs?.split(/\s+/) ?? [];
        if (tokens.length < 3 || tokens.length % 3 !== 0) { invalid('Malformed cylinder sections.'); continue; }
        for (let s = 0; s < tokens.length; s += 3) sections.push({ profile: tokens[s], radius: Number(tokens[s + 1]), length: Number(tokens[s + 2]) });
        if (sections.some((s) => !/^(R|A|S|_L|L_)$/.test(s.profile) || !Number.isFinite(s.radius) || !Number.isFinite(s.length) || s.radius <= 0 || s.length <= 0)) { invalid('Unsupported or invalid cylinder section profile.'); continue; }
      }
      const radius = kind === 'clip' ? Number(props.radius) : null, length = kind === 'clip' ? Number(props.length) : null;
      if (kind === 'clip' && (!radius || !length || !Number.isFinite(radius) || !Number.isFinite(length) || radius <= 0 || length <= 0)) { invalid('Invalid source clip radius/length.'); continue; }
      if (kind === 'generic') {
        const bounding = props.bounding?.split(/\s+/) ?? [], dimensions = bounding.slice(1).map(Number);
        const count = bounding[0] === 'sph' ? 1 : bounding[0] === 'cyl' ? 2 : bounding[0] === 'box' ? 3 : 0;
        if (!count || dimensions.length !== count || dimensions.some((value) => !Number.isFinite(value) || value <= 0)) { invalid('Unsupported generic bounding declaration.'); continue; }
      }
      const orientation = multiply(transform, ori), directionRaw = vector(orientation, [0, -1, 0]), norm = Math.hypot(...directionRaw);
      if (!finite(orientation) || !Number.isFinite(norm) || norm < 1e-10) { invalid('Singular/non-finite connection orientation.'); continue; }
      const dimensionsResolved = rigid(orientation);
      const dimensionIssues: ConnectionImportIssue[] = [];
      if (!dimensionsResolved) dimensionIssues.push(invalid('Inherited non-rigid scaling retained in the source frame; physical dimensions are unresolved.', 'unsupported-scaling'));
      if (props.scale && !['none', 'yonly'].includes(props.scale.toLowerCase())) dimensionIssues.push(invalid('Unsupported scaling mode; source remains unverified.', 'unsupported-scaling'));
      for (const issue of dimensionIssues) pointScopedIssues.set(issue, new Set());
      for (const offset of offsets) {
        const pointPosition = add(position, vector(transform, add(pos, offset)));
        if (!finite(pointPosition)) { invalid('Connection position overflows finite coordinates.'); continue; }
        const point: ImportedConnectionPoint = { id: `${path}:${i + 1}:${serial++}`, sourceId: props.id ?? null, kind, family: family(kind, props.id ?? null, props.group ?? null, sections, gender), gender, position: pointPosition, direction: directionRaw.map((v) => v / norm) as ConnectionVector, orientation, units: 'LDU', sections: sections.map((s) => ({ ...s })), dimensionsFrame: 'source-local', dimensionsResolved, radius, length, group: props.group ?? null, properties: { ...props }, source: { ...source, line: i + 1, raw, transforms: evidence.map((e) => ({ ...e, position: [...e.position] as ConnectionVector, matrix: [...e.matrix] as ConnectionMatrix })) }, physicalVerified: false };
        if (description) partDescriptions.set(point, description);
        if (connectionDescription) connectionDescriptions.set(point, connectionDescription);
        points.push(point);
        for (const issue of dimensionIssues) pointScopedIssues.get(issue)!.add(point);
        if (points.length > maxPoints) { invalid('Connection point budget exceeded.', 'resource-limit'); return []; }
      }
    }
    return points;
  }
  const safe = canonicalConnectionPath(partId.endsWith('.dat') ? partId : `${partId}.dat`);
  let points: ImportedConnectionPoint[] = [];
  if (!safe) report({ code: 'invalid-path', file: partId, message: 'Unsafe requested part identifier.' });
  else {
    const root = await resolve(safe, '', 'geometry');
    if (root) {
      const geometry = await read(root, 'geometry');
      const rootSource = sources.get(`geometry:${root}`);
      let description: PartDescriptionEvidence | undefined;
      if (geometry && rootSource) {
        const lines = geometry.split(/\r?\n/);
        for (let i = 0; i < Math.min(lines.length, 16); i++) {
          const raw = lines[i].trim();
          if (!/^0\s+/.test(raw)) continue;
          const text = raw.replace(/^0\s+/, '').trim();
          if (!text || /^(name|author|!|bfc|step|end|\/\/)/i.test(text)) continue;
          description = { text, line: i + 1, raw, source: { ...rootSource } };
          break;
        }
      }
      points = await walk(root, IDENTITY, ZERO, [], [], false, description);
    }
    else report({ code: 'missing-geometry', file: safe, message: 'Native root part is not in this source library.' });
  }
  if (points.length === 0) report({ code: 'no-connections', file: partId, message: 'No imported supported source connections are available.' });
  if (issueBudgetExceeded && issues.length < 300) issues.push({ code: 'resource-limit', file: partId, message: 'Issue budget was exceeded; unrecorded diagnostics cannot be treated as successful parsing.' });
  return { partId, status: points.length ? (issues.length || issueBudgetExceeded ? 'partial' : 'ready') : 'missing', units: 'LDU', coordinateSystem: 'LDraw-native', physicalVerified: false, points, issues, discardedIssues, parserVersion: CONNECTION_PARSER_VERSION, sourceFiles: [...sources.values()], license: 'CC-BY-SA-4.0' };
}
