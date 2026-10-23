import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { canonicalLDrawPath, createBundledLDrawImporter, createBundledLDrawResolver, LDrawPartImporter, loadBundledLDrawManifest } from '../src/parts/ldraw/index.js';
import type { LDrawResolver } from '../src/parts/ldraw/index.js';

const header = '0 Fixture\n0 !LICENSE Licensed under CC BY 4.0 : see CAreadme.txt\n0 BFC CERTIFY CCW\n';
function resolver(files: Record<string, string>): LDrawResolver {
  return { revision: 'test-fixture', sourceRoot: 'https://example.invalid/ldraw/', async readText(path) { return files[path]; } };
}

describe('native LDraw importer', () => {
  it('composes nested translations, rotation and nonuniform scale from native type 1 references', async () => {
    const importer = new LDrawPartImporter(resolver({
      'parts/root.dat': `${header}1 4 10 20 30 0 -2 0 2 0 0 0 0 1 child.dat`,
      'parts/child.dat': `${header}1 16 1 0 0 2 0 0 0 1 0 0 0 1 primitive.dat`,
      'p/primitive.dat': `${header}3 16 0 0 0 1 0 0 0 1 0`,
    }));
    const imported = await importer.importPart('root');
    expect(imported.status).toBe('geometryReady');
    expect(imported.mesh?.positions).toEqual([[10, 22, 30], [10, 26, 30], [8, 22, 30]]);
    expect(imported.mesh?.triangleColors).toEqual([4]);
    expect(imported.bounds).toEqual({ min: [8, 22, 30], max: [10, 26, 30] });
    expect(imported.source.files.map(file => file.path)).toEqual(['p/primitive.dat', 'parts/child.dat', 'parts/root.dat']);
    expect(imported.source.integrity).toBe('not-manifested');
  });

  it('triangulates quads, keeps real edges and excludes conditional control points from bounds', async () => {
    const imported = await new LDrawPartImporter(resolver({
      'parts/root.dat': `${header}4 0x2FF0000 0 0 0 2 0 0 2 2 0 0 2 0\n2 24 0 0 0 2 0 0\n5 24 0 0 0 2 2 0 -999 -999 1000 999 999 1000`,
    })).importPart('root');
    expect(imported.mesh?.indices).toEqual([0, 1, 2, 0, 2, 3]);
    expect(imported.mesh?.triangleColors).toEqual([0x2ff0000, 0x2ff0000]);
    expect(imported.mesh?.edges).toHaveLength(1);
    expect(imported.mesh?.conditionalEdges).toHaveLength(1);
    expect(imported.bounds).toEqual({ min: [0, 0, 0], max: [2, 2, 0] });
    expect(imported.collision).toMatchObject({ kind: 'aabb', derivedFrom: 'native-mesh', cavitiesResolved: false });
  });

  it('preserves outward face winding for mirrored instances and BFC INVERTNEXT', async () => {
    const library = resolver({
      'parts/mirror.dat': `${header}1 16 0 0 0 -1 0 0 0 1 0 0 0 1 leaf.dat`,
      'parts/inverted.dat': `${header}0 BFC INVERTNEXT\n1 16 0 0 0 -1 0 0 0 1 0 0 0 1 leaf.dat`,
      'parts/leaf.dat': `${header}3 16 0 0 0 1 0 0 0 1 0`,
    });
    const importer = new LDrawPartImporter(library);
    const mirror = await importer.importPart('mirror');
    const inverted = await importer.importPart('inverted');
    expect(mirror.mesh?.positions).toEqual([[0, 0, 0], [-1, 0, 0], [0, 1, 0]]);
    expect(mirror.mesh?.indices).toEqual([0, 2, 1]);
    expect(inverted.mesh?.indices).toEqual([0, 1, 2]);
    expect(mirror.mesh?.doubleSided).toEqual([false]);
  });

  it('honours BFC CW and NOCLIP without upgrading uncertified faces', async () => {
    const importer = new LDrawPartImporter(resolver({
      'parts/root.dat': '0 Fixture\n0 BFC CERTIFY CW\n3 16 0 0 0 1 0 0 0 1 0\n0 BFC NOCLIP\n3 16 0 0 0 1 0 0 0 1 0',
      'parts/uncertified.dat': '0 Fixture\n3 16 0 0 0 1 0 0 0 1 0',
    }));
    const imported = await importer.importPart('root');
    expect(imported.mesh?.indices).toEqual([0, 2, 1, 3, 5, 4]);
    expect(imported.mesh?.doubleSided).toEqual([false, true]);
    expect((await importer.importPart('uncertified')).mesh?.doubleSided).toEqual([true]);
    expect(imported.source.licenseStatus).toBe('unknown');
  });

  it('resolves case-insensitive backslash subparts and the primitive namespace', async () => {
    const imported = await new LDrawPartImporter(resolver({
      'parts/root.dat': `${header}1 16 0 0 0 1 0 0 0 1 0 0 0 1 S\\Sub.DAT`,
      'parts/s/sub.dat': `${header}1 16 0 0 0 1 0 0 0 1 0 0 0 1 48\\Facet.DAT`,
      'p/48/facet.dat': `${header}3 16 0 0 0 1 0 0 0 1 0`,
    })).importPart('ROOT.DAT');
    expect(imported.status).toBe('geometryReady');
    expect(imported.source.files).toHaveLength(3);
  });

  it.each([
    ['missing-reference', { 'parts/root.dat': `${header}1 16 0 0 0 1 0 0 0 1 0 0 0 1 absent.dat` }],
    ['cyclic-reference', { 'parts/root.dat': `${header}1 16 0 0 0 1 0 0 0 1 0 0 0 1 root.dat` }],
    ['unsafe-reference', { 'parts/root.dat': `${header}1 16 0 0 0 1 0 0 0 1 0 0 0 1 ../outside.dat` }],
    ['singular-transform', { 'parts/root.dat': `${header}1 16 0 0 0 0 0 0 0 1 0 0 0 1 leaf.dat`, 'parts/leaf.dat': `${header}3 16 0 0 0 1 0 0 0 1 0` }],
    ['invalid-coordinate', { 'parts/root.dat': `${header}3 16 NaN 0 0 1 0 0 0 1 0` }],
    ['empty-mesh', { 'parts/root.dat': `${header}2 24 0 0 0 1 0 0` }],
    ['unsupported-texmap', { 'parts/root.dat': `${header}0 !TEXMAP START PLANAR 0 0 0 1 0 0 0 1 0 image.png\n3 16 0 0 0 1 0 0 0 1 0` }],
  ] as const)('fails closed for %s, without a placeholder mesh or collision box', async (code, files) => {
    const imported = await new LDrawPartImporter(resolver(files)).importPart('root');
    expect(imported.status).toBe('failed');
    expect(imported.issues.some(issue => issue.code === code && issue.severity === 'error')).toBe(true);
    expect(imported.mesh).toBeUndefined();
    expect(imported.bounds).toBeUndefined();
    expect(imported.collision).toBeUndefined();
  });

  it('rejects sources whose SHA-256 differs from the selected snapshot', async () => {
    const body = `${header}3 16 0 0 0 1 0 0 0 1 0`;
    const library = resolver({ 'parts/root.dat': body });
    library.expectedHashes = { 'parts/root.dat': createHash('sha256').update(`${body}\nchanged`).digest('hex') };
    const imported = await new LDrawPartImporter(library).importPart('root');
    expect(imported.status).toBe('failed');
    expect(imported.issues[0].code).toBe('source-integrity');
  });

  it('applies face and recursion limits before returning an oversized mesh', async () => {
    const library = resolver({
      'parts/root.dat': `${header}1 16 0 0 0 1 0 0 0 1 0 0 0 1 leaf.dat`,
      'parts/leaf.dat': `${header}4 16 0 0 0 1 0 0 1 1 0 0 1 0`,
    });
    const byFaces = await new LDrawPartImporter(library, { maxTriangles: 1 }).importPart('root');
    const byDepth = await new LDrawPartImporter(library, { maxDepth: 1 }).importPart('root');
    expect(byFaces.issues[0].code).toBe('triangle-limit');
    expect(byDepth.issues[0].code).toBe('depth-limit');
    expect(byFaces.mesh).toBeUndefined();
    expect(byDepth.mesh).toBeUndefined();
  });

  it.each(['/etc/passwd.dat', '../private.dat', 'C:\\private.dat', 'https://example.com/mesh.dat', 'parts//root.dat', 'parts/root.png'])('rejects an unsafe root path %s', async (path) => {
    expect(() => canonicalLDrawPath(path)).toThrow();
  });
});

describe('pinned native source snapshot', () => {
  it('imports every catalogued root and its complete hash-checked recursive closure', async () => {
    const manifest = await loadBundledLDrawManifest();
    const importer = await createBundledLDrawImporter();
    expect(manifest.roots.length).toBeGreaterThanOrEqual(200);
    const failures: string[] = [];
    for (const root of manifest.roots) {
      const imported = await importer.importPart(root.partId);
      if (imported.status !== 'geometryReady') failures.push(`${root.partId}: ${JSON.stringify(imported.issues)}`);
      expect(imported.source.integrity).toBe('verified');
      expect(imported.source.licenseStatus).toBe('complete');
      expect(imported.source.files.length).toBeGreaterThan(0);
      expect(imported.mesh?.units).toBe('LDU');
      expect(imported.mesh?.positions.every(point => point.every(Number.isFinite))).toBe(true);
    }
    expect(failures).toEqual([]);
    const brick = await importer.importPart('3001');
    expect(brick.bounds).toEqual({ min: [-40, -4, -20], max: [40, 24, 20] });
    expect(brick.source.files.some(file => file.path === 'p/stud.dat')).toBe(true);
  }, 30_000);

  it('only exposes manifest files, never a neighbouring filesystem path', async () => {
    const library = await createBundledLDrawResolver();
    expect(await library.readText('parts/not-a-real-part.dat')).toBeUndefined();
    await expect(library.readText('../private.dat')).rejects.toThrow();
    expect((await library.readText('p/stud.dat'))?.startsWith('0 Stud')).toBe(true);
  });

  it('detects a modified bundled source before emitting any geometry', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'bricklab-native-integrity-'));
    const original = `${header}3 16 0 0 0 1 0 0 0 1 0`;
    try {
      await mkdir(path.join(directory, 'files', 'parts'), { recursive: true });
      await writeFile(path.join(directory, 'manifest.json'), JSON.stringify({
        schemaVersion: 1, library: 'LDraw', revision: 'a'.repeat(40), sourceRoot: 'https://example.invalid/pinned/',
        roots: [{ partId: 'root', path: 'parts/root.dat', name: 'Fixture', selectionBasis: 'test' }],
        files: [{ path: 'parts/root.dat', sha256: createHash('sha256').update(original).digest('hex') }],
      }));
      await writeFile(path.join(directory, 'files', 'parts', 'root.dat'), original.replace('1 0 0', '2 0 0'));
      const imported = await (await createBundledLDrawImporter(directory)).importPart('root');
      expect(imported.status).toBe('failed');
      expect(imported.issues[0].message).toContain('integrity failed');
      expect(imported.mesh).toBeUndefined();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
