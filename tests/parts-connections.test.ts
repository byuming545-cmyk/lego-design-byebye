import { describe, expect, it } from 'vitest';
import { createBundledConnectionImporter, importLdcadShadow } from '../src/parts/connections/index.js';
import type { ConnectionLibrary } from '../src/parts/connections/index.js';
import { readFile } from 'node:fs/promises';

/** Deliberately synthetic parser fixtures, never published as real part definitions. */
function fixture(geometry: Record<string, string>, shadow: Record<string, string>): ConnectionLibrary {
  return { getGeometryFile: async (path) => geometry[path], getShadowFile: async (path) => shadow[path] };
}

function realBundledImporter() {
  return createBundledConnectionImporter({
    revision: 'c43ed06a128a10ed65675166bf42eb6fd608b9b0',
    sourceRoot: 'https://raw.githubusercontent.com/pybricks/ldraw/c43ed06a128a10ed65675166bf42eb6fd608b9b0/',
    async readText(path) { try { return await readFile(new URL(`../data/parts-foundation/ldraw/files/${path}`, import.meta.url), 'utf8'); } catch { return undefined; } },
  });
}

describe('source-backed LDCad Shadow connection importer', () => {
  it('inherits real source directives through native nested matrices and records each transform', async () => {
    const result = await importLdcadShadow('test', fixture({
      'parts/test.dat': '1 16 10 20 30 0 0 1 0 1 0 -1 0 0 sub.dat',
      'p/sub.dat': '0 Synthetic parser fixture',
    }, { 'p/sub.dat': '0 !LDCAD SNAP_CYL [ID=studC] [gender=M] [caps=one] [secs=R 6 4] [pos=1 2 3]' }));
    expect(result.status).toBe('ready');
    expect(result.points).toHaveLength(1);
    expect(result.points[0]).toMatchObject({ family: 'stud', position: [13, 22, 29], direction: [0, -1, 0], units: 'LDU', physicalVerified: false, source: { path: 'p/sub.dat', line: 1, raw: expect.stringContaining('secs=R 6 4') } });
    expect(result.points[0].source.transforms).toHaveLength(1);
    expect(result.points[0].source.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('expands centered grids and respects higher-level SNAP_CLEAR filters', async () => {
    const library = fixture({ 'parts/test.dat': '1 16 0 0 0 1 0 0 0 1 0 0 0 1 sub.dat', 'p/sub.dat': '0 Fixture' }, {
      'p/sub.dat': '0 !LDCAD SNAP_CYL [id=studC] [gender=M] [secs=R 6 4] [grid=C 2 C 2 20 20]\n0 !LDCAD SNAP_CYL [id=remove] [gender=F] [secs=R 4 4]',
      'parts/test.dat': '0 !LDCAD SNAP_CLEAR [id=remove]',
    });
    const result = await importLdcadShadow('test', library);
    expect(result.status).toBe('ready');
    expect(result.points.map((p) => p.position)).toEqual([[-10, 0, -10], [-10, 0, 10], [10, 0, -10], [10, 0, 10]]);
    expect(result.points.every((p) => p.sourceId === 'studC')).toBe(true);
  });

  it('resolves SNAP_INCL from shadow source without duplicating included native studs', async () => {
    const result = await importLdcadShadow('test', fixture({ 'parts/test.dat': '0 Fixture', 'parts/included.dat': '1 16 0 0 0 1 0 0 0 1 0 0 0 1 unused.dat' }, {
      'parts/test.dat': '0 !LDCAD SNAP_INCL [ref=included.dat] [pos=0 4 0]',
      'parts/included.dat': '0 !LDCAD SNAP_CYL [gender=F] [secs=S 6 20] [pos=0 24 0]',
    }));
    expect(result.points).toHaveLength(1);
    expect(result.points[0].position).toEqual([0, 28, 0]);
    expect(result.points[0].source.transforms[0].directive).toContain('SNAP_INCL');
  });

  it('retains clip, axle and wheel-group data from explicit source values', async () => {
    const result = await importLdcadShadow('test', fixture({ 'parts/test.dat': '0 Fixture' }, { 'parts/test.dat': [
      '0 !LDCAD SNAP_CLP [radius=4] [length=8] [center=true]',
      '0 !LDCAD SNAP_CYL [gender=M] [secs=A 6 20]',
      '0 !LDCAD SNAP_GEN [group=rim8_6] [gender=F] [bounding=cyl 8 3]',
    ].join('\n') }));
    expect(result.points.map((p) => p.family)).toEqual(['clip', 'axle', 'wheelMount']);
    expect(result.points[0]).toMatchObject({ gender: 'F', radius: 4, length: 8 });
    expect(result.points[2].properties.bounding).toBe('cyl 8 3');
  });

  it('fails closed for missing geometry, unsafe references, include cycles and unknown syntax', async () => {
    const missing = await importLdcadShadow('unknown', fixture({}, {}));
    expect(missing.status).toBe('missing');
    expect(missing.points).toEqual([]);
    const unsafe = await importLdcadShadow('../secret', fixture({}, {}));
    expect(unsafe.issues.some((p) => p.code === 'invalid-path')).toBe(true);
    const cycle = await importLdcadShadow('test', fixture({ 'parts/test.dat': '0 Fixture' }, {
      'parts/test.dat': '0 !LDCAD SNAP_INCL [ref=test.dat]\n0 !LDCAD SNAP_FGR [seq=1 2 3]\n0 !LDCAD SNAP_CYL [gender=M] [secs=UNKNOWN 6 4]',
    }));
    expect(cycle.points).toEqual([]);
    expect(cycle.issues.map((p) => p.code)).toEqual(expect.arrayContaining(['cycle', 'unsupported-directive', 'invalid-directive']));
  });

  it('keeps non-rigidly transformed data unverified, rather than guessing physical dimensions', async () => {
    const result = await importLdcadShadow('test', fixture({ 'parts/test.dat': '1 16 0 0 0 2 0 0 0 5 0 0 0 2 primitive.dat', 'p/primitive.dat': '0 Fixture' }, {
      'p/primitive.dat': '0 !LDCAD SNAP_CYL [gender=M] [secs=A 6 1] [pos=0 1 0] [scale=YOnly]',
    }));
    expect(result.status).toBe('partial');
    expect(result.points[0]).toMatchObject({ position: [0, 5, 0], dimensionsFrame: 'source-local', dimensionsResolved: false, sections: [{ profile: 'A', radius: 6, length: 1 }], physicalVerified: false });
    expect(result.issues.some((p) => p.code === 'unsupported-scaling')).toBe(true);
  });

  it('imports the unchanged pinned 3001 source: 8 stud directives and 8 underside cylinders', async () => {
    const importer = realBundledImporter();
    const result = await importer.importPart('3001');
    expect(result.status).toBe('ready');
    expect(result.points.filter((p) => p.gender === 'M')).toHaveLength(8);
    expect(result.points.filter((p) => p.gender === 'F')).toHaveLength(8);
    expect(result.points.filter((p) => p.gender === 'M').every((p) => p.source.path === 'p/stud.dat')).toBe(true);
    expect(result.points.filter((p) => p.gender === 'F').every((p) => p.source.path === 'parts/s/3001s01.dat')).toBe(true);
    expect(result.sourceFiles.filter((p) => p.library === 'LDCadShadowLibrary').every((p) => p.license === 'CC-BY-SA-4.0' && p.revision === '9b1131fb1991f8c0bfc072325e4e12f6271aba35')).toBe(true);
    expect(result.physicalVerified).toBe(false);
  });

  it('imports actual clip and bar records without adding a guessed physical compatibility rule', async () => {
    const importer = realBundledImporter();
    const clipBar = await importer.importPart('48729b');
    expect(clipBar.status).toBe('ready');
    expect(clipBar.points.find((p) => p.kind === 'clip')).toMatchObject({
      radius: 4, length: 8, direction: [0, 0, 1],
      source: { path: 'parts/48729b.dat', line: 8, raw: expect.stringContaining('SNAP_CLP') }, physicalVerified: false,
    });
    const bar = await importer.importPart('30374');
    expect(bar.status).toBe('ready');
    expect(bar.points).toHaveLength(1);
    expect(bar.points[0]).toMatchObject({ kind: 'cylinder', family: 'cylinder', sections: [{ profile: 'R', radius: 4, length: 80 }], physicalVerified: false });
    expect(bar.points[0].source.raw).toContain('secs=R 4 80');
  });
});
