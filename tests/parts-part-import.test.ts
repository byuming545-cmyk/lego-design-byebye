import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PART_IMPORT_SCHEMA, readPartImportBundle, stagePartImport, validatePartImportMetadata } from '../src/parts/import/bundle.js';
import { PartImportService, type PartImportReport } from '../src/parts/import/service.js';

const LDRAW_REVISION = 'c43ed06a128a10ed65675166bf42eb6fd608b9b0';
const SHADOW_REVISION = '9b1131fb1991f8c0bfc072325e4e12f6271aba35';
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const GEOMETRY = '0 Synthetic geometry fixture\n0 Name: 9999.dat\n0 Author: fixture\n0 !LICENSE Licensed under CC BY 4.0 : see CAreadme.txt\n';
const CONNECTIONS = '0 Synthetic connector fixture\n0 Author: fixture\n0 !LICENSE CC BY-SA 4.0, see LICENSE.md\n';
const tempDirs: string[] = [];
afterEach(async () => { await Promise.all(tempDirs.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });

function bundle(partId = '9999') {
  return {
    schemaVersion: PART_IMPORT_SCHEMA, partId, name: 'Synthetic geometry fixture', author: 'fixture',
    geometry: { library: 'LDraw', revision: LDRAW_REVISION, license: 'Licensed under CC BY 4.0 : see CAreadme.txt', sourceUrl: `https://raw.githubusercontent.com/pybricks/ldraw/${LDRAW_REVISION}/`, root: `parts/${partId}.dat`, files: [{ path: `parts/${partId}.dat`, sha256: sha(GEOMETRY), bytes: Buffer.byteLength(GEOMETRY) }] },
    connections: { library: 'LDCadShadowLibrary', revision: SHADOW_REVISION, license: 'CC-BY-SA-4.0', sourceUrl: `https://raw.githubusercontent.com/RolandMelkert/LDCadShadowLibrary/${SHADOW_REVISION}/`, root: `parts/${partId}.dat`, files: [{ path: `parts/${partId}.dat`, sha256: sha(CONNECTIONS), bytes: Buffer.byteLength(CONNECTIONS) }] },
    selectionBasis: 'fixture', importBasis: 'fixture', reviewer: 'fixture', allowStagingValidation: true,
  };
}

async function writeBundle(value: unknown) {
  const directory = await mkdtemp(path.join(tmpdir(), 'part-import-test-'));
  tempDirs.push(directory);
  await writeFile(path.join(directory, 'bundle.json'), JSON.stringify(value));
  return directory;
}

describe('part import bundle staging contract', () => {
  it('rejects an unreviewed license and a traversing source path', () => {
    const badLicense = structuredClone(bundle()); badLicense.geometry.license = 'unknown';
    expect(() => validatePartImportMetadata(badLicense)).toThrow(/Unreviewed LDraw license/);
    const badPath = structuredClone(bundle()); badPath.geometry.files[0].path = '../escape.dat';
    expect(() => validatePartImportMetadata(badPath)).toThrow(/traversal|Invalid or duplicate source path/);
  });

  it('accepts the reviewed pinned source and rejects same-commit repository substitution', () => {
    expect(validatePartImportMetadata(bundle()).geometry.sourceUrl).toContain('/pybricks/ldraw/');
    const bad = bundle(); bad.geometry.sourceUrl = `https://raw.githubusercontent.com/ldraw/ldraw/${LDRAW_REVISION}/`;
    expect(() => validatePartImportMetadata(bad)).toThrow(/not approved/);
    bad.geometry.sourceUrl = `https://raw.githubusercontent.com/pybricks/ldraw/extra/${LDRAW_REVISION}/`;
    expect(() => validatePartImportMetadata(bad)).toThrow(/pinned revision/);
  });

  it('rejects an existing native part ID before reading staged bytes', async () => {
    const directory = await writeBundle(bundle('3001'));
    await expect(readPartImportBundle(directory)).rejects.toMatchObject({ code: 'part-already-exists' });
  });

  it('rejects an unapproved source host', () => {
    const badHost = structuredClone(bundle());
    badHost.geometry.sourceUrl = `https://example.invalid/ldraw/${LDRAW_REVISION}/`;
    expect(() => validatePartImportMetadata(badHost)).toThrow(/not approved/);
  });

  it('rejects a bundle file that would overlap the pinned base', async () => {
    const overlap = structuredClone(bundle());
    overlap.geometry.files.push({ path: 'p/stud.dat', sha256: sha('base'), bytes: Buffer.byteLength(GEOMETRY) });
    const directory = await writeBundle(overlap);
    await expect(readPartImportBundle(directory)).rejects.toMatchObject({ code: 'source-path-already-in-base' });
  });

  it('rejects a bundle that does not allow staging validation', async () => {
    const blocked = structuredClone(bundle()); blocked.allowStagingValidation = false;
    const directory = await writeBundle(blocked);
    await expect(readPartImportBundle(directory)).rejects.toMatchObject({ code: 'staging-not-allowed' });
  });

  it('reports a missing source file instead of inventing geometry', async () => {
    const directory = await writeBundle(bundle());
    await expect(readPartImportBundle(directory)).rejects.toMatchObject({ code: 'missing-source-file' });
  });

  it('stages a verified overlay and cleans it without writing the pinned source', async () => {
    const value = bundle(); value.geometry.files[0].sha256 = sha(GEOMETRY); value.connections.files[0].sha256 = sha(CONNECTIONS);
    const directory = await writeBundle(value);
    await mkdir(path.join(directory, 'ldraw', 'parts'), { recursive: true });
    await mkdir(path.join(directory, 'shadow', 'parts'), { recursive: true });
    await writeFile(path.join(directory, 'ldraw', 'parts', '9999.dat'), GEOMETRY);
    await writeFile(path.join(directory, 'shadow', 'parts', '9999.dat'), CONNECTIONS);
    const parsed = await readPartImportBundle(directory);
    await writeFile(path.join(directory, 'ldraw', 'parts', 'undeclared.dat'), 'not-declared');
    const staged = await stagePartImport(directory, parsed);
    await expect(access(path.join(staged.ldrawDirectory, 'files', 'parts', '9999.dat'))).resolves.toBeUndefined();
    await expect(access(path.join(staged.ldrawDirectory, 'files', 'parts', 'undeclared.dat'))).rejects.toMatchObject({ code: 'ENOENT' });
    await staged.cleanup();
  });

  it('reports a source hash mismatch', async () => {
    const directory = await writeBundle(bundle());
    await mkdir(path.join(directory, 'ldraw', 'parts'), { recursive: true });
    await mkdir(path.join(directory, 'shadow', 'parts'), { recursive: true });
    await writeFile(path.join(directory, 'ldraw', 'parts', '9999.dat'), 'tampered');
    await writeFile(path.join(directory, 'shadow', 'parts', '9999.dat'), CONNECTIONS);
    await expect(readPartImportBundle(directory)).rejects.toMatchObject({ code: 'source-integrity' });
  });
});


describe('part import promotion guards', () => {
  const blockedReport = (partId = '9999', status: 'blocked' | 'validated' = 'blocked') => ({ partId, status } as PartImportReport);

  it('refuses to promote a blocked report', async () => {
    const service = new PartImportService();
    await expect(service.promote('/nonexistent', blockedReport(), '9999')).rejects.toMatchObject({ code: 'promotion-blocked' });
  });

  it('refuses a confirmation that does not match the report', async () => {
    const service = new PartImportService();
    await expect(service.promote('/nonexistent', blockedReport('9999', 'validated'), '3001')).rejects.toMatchObject({ code: 'promotion-confirm-mismatch' });
  });
});

describe('per-file attribution and immutable dependency reuse', () => {
  async function fixture() {
    const value = bundle();
    const directory = await writeBundle(value);
    await mkdir(path.join(directory, 'ldraw', 'parts'), { recursive: true });
    await mkdir(path.join(directory, 'shadow', 'parts'), { recursive: true });
    await writeFile(path.join(directory, 'ldraw', 'parts', '9999.dat'), GEOMETRY);
    await writeFile(path.join(directory, 'shadow', 'parts', '9999.dat'), CONNECTIONS);
    return { value, directory };
  }
  it('preserves dependency authors from bytes and reuses only hash-identical base files', async () => {
    const { value, directory } = await fixture();
    const { loadLDrawManifest } = await import('../src/parts/import/bundle.js');
    const base = await loadLDrawManifest();
    const primitive = base.files.find(file => file.path === 'p/stud.dat')!;
    value.geometry.files.push({ path: primitive.path, sha256: primitive.sha256, bytes: primitive.bytes, reuse: true } as any);
    await writeFile(path.join(directory, 'bundle.json'), JSON.stringify(value));
    const checked = await readPartImportBundle(directory);
    expect(checked.geometry.files.find(file => file.path === primitive.path)?.author).toBe(primitive.author);
    const staged = await stagePartImport(directory, checked);
    const manifest = JSON.parse(await (await import('node:fs/promises')).readFile(path.join(staged.ldrawDirectory, 'manifest.json'), 'utf8'));
    expect(manifest.files.filter((file: any) => file.path === primitive.path)).toHaveLength(1);
    expect(manifest.files.find((file: any) => file.path === primitive.path)).toEqual(primitive);
    await staged.cleanup();
  });
  it('rejects a falsely attributed file and an unresolved dependency', async () => {
    const { value, directory } = await fixture();
    (value.geometry.files[0] as any).author = 'incorrect author';
    await writeFile(path.join(directory, 'bundle.json'), JSON.stringify(value));
    await expect(readPartImportBundle(directory)).rejects.toMatchObject({ code: 'source-metadata-mismatch' });
    delete (value.geometry.files[0] as any).author;
    value.geometry.files.push({ path: 'parts/missing.dat', sha256: sha('missing'), bytes: 7 });
    await writeFile(path.join(directory, 'bundle.json'), JSON.stringify(value));
    await expect(readPartImportBundle(directory)).rejects.toMatchObject({ code: 'missing-source-file' });
  });
});
