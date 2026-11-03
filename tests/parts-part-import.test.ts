import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PART_IMPORT_SCHEMA, readPartImportBundle, stagePartImport, validatePartImportMetadata } from '../src/parts/import/bundle.js';

const LDRAW_REVISION = 'c43ed06a128a10ed65675166bf42eb6fd608b9b0';
const SHADOW_REVISION = '9b1131fb1991f8c0bfc072325e4e12f6271aba35';
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const tempDirs: string[] = [];
afterEach(async () => { await Promise.all(tempDirs.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });

function bundle(partId = '9999') {
  return {
    schemaVersion: PART_IMPORT_SCHEMA, partId, name: 'Synthetic metadata fixture', author: 'fixture',
    geometry: { library: 'LDraw', revision: LDRAW_REVISION, license: 'Licensed under CC BY 4.0 : see CAreadme.txt', sourceUrl: `https://example.invalid/ldraw/${LDRAW_REVISION}/`, root: `parts/${partId}.dat`, files: [{ path: `parts/${partId}.dat`, sha256: sha('geometry'), bytes: 8 }] },
    connections: { library: 'LDCadShadowLibrary', revision: SHADOW_REVISION, license: 'CC-BY-SA-4.0', sourceUrl: `https://example.invalid/shadow/${SHADOW_REVISION}/`, root: `parts/${partId}.dat`, files: [{ path: `parts/${partId}.dat`, sha256: sha('connections'), bytes: 11 }] },
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

  it('rejects an existing native part ID before reading staged bytes', async () => {
    const directory = await writeBundle(bundle('3001'));
    await expect(readPartImportBundle(directory)).rejects.toMatchObject({ code: 'part-already-exists' });
  });

  it('reports a missing source file instead of inventing geometry', async () => {
    const directory = await writeBundle(bundle());
    await expect(readPartImportBundle(directory)).rejects.toMatchObject({ code: 'missing-source-file' });
  });

  it('stages a verified overlay and cleans it without writing the pinned source', async () => {
    const value = bundle(); value.geometry.files[0].sha256 = sha('geometry'); value.connections.files[0].sha256 = sha('connections');
    const directory = await writeBundle(value);
    await mkdir(path.join(directory, 'ldraw', 'parts'), { recursive: true });
    await mkdir(path.join(directory, 'shadow', 'parts'), { recursive: true });
    await writeFile(path.join(directory, 'ldraw', 'parts', '9999.dat'), 'geometry');
    await writeFile(path.join(directory, 'shadow', 'parts', '9999.dat'), 'connections');
    const parsed = await readPartImportBundle(directory);
    const staged = await stagePartImport(directory, parsed);
    await expect(access(path.join(staged.ldrawDirectory, 'files', 'parts', '9999.dat'))).resolves.toBeUndefined();
    await staged.cleanup();
  });

  it('reports a source hash mismatch', async () => {
    const directory = await writeBundle(bundle());
    await mkdir(path.join(directory, 'ldraw', 'parts'), { recursive: true });
    await mkdir(path.join(directory, 'shadow', 'parts'), { recursive: true });
    await writeFile(path.join(directory, 'ldraw', 'parts', '9999.dat'), 'tampered');
    await writeFile(path.join(directory, 'shadow', 'parts', '9999.dat'), 'connections');
    await expect(readPartImportBundle(directory)).rejects.toMatchObject({ code: 'source-integrity' });
  });
});
