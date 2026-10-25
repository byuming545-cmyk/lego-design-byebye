import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { NativePartRepository, nativePartSourceHash } from '../src/parts/assembly/source.js';
import { PILOT_PART_SELECTION } from '../src/parts/digitalImport/demand.js';
import { createHash } from 'node:crypto';
import { assertReviewedPilotManifestDigests } from '../src/parts/digitalImport/sources.js';

const base = new URL('../data/parts-foundation/pilots/speed-26/', import.meta.url);
const staged = new NativePartRepository({ geometryDirectory: fileURLToPath(new URL('ldraw/', base)), shadowDirectory: fileURLToPath(new URL('shadow/', base)) });

describe('independent reviewed pilot source bundle', () => {
  it('requires independently reviewed manifest pins rather than a self-declared upstream URL or checksum', async () => {
    const digest = async (name: string) => createHash('sha256').update(await readFile(new URL(`${name}/manifest.json`, base))).digest('hex');
    const actual = { ldraw: await digest('ldraw'), shadow: await digest('shadow') };
    expect(() => assertReviewedPilotManifestDigests(actual)).not.toThrow();
    expect(() => assertReviewedPilotManifestDigests({ ...actual, ldraw: '0'.repeat(64) })).toThrow('not reviewed');
    expect(() => assertReviewedPilotManifestDigests({ ...actual, shadow: 'f'.repeat(64) })).toThrow('not reviewed');
  });

  it('rejects a repacked manifest even if it retains valid-looking source URLs and licences', async () => {
    const original = await readFile(new URL('ldraw/manifest.json', base), 'utf8');
    const changed = JSON.parse(original); changed.roots[0].name = 'Unreviewed replacement';
    const shadow = createHash('sha256').update(await readFile(new URL('shadow/manifest.json', base))).digest('hex');
    expect(() => assertReviewedPilotManifestDigests({ ldraw: createHash('sha256').update(JSON.stringify(changed)).digest('hex'), shadow })).toThrow('not reviewed');
  });

  it('imports all 26 exact source roots and four genuinely new IDs without old constructors', async () => {
    expect(new Set(await staged.listIds())).toEqual(new Set(PILOT_PART_SELECTION.map(row => row.partId)));
    for (const id of await staged.listIds()) {
      const part = (await staged.getPart(id))!;
      expect(part.geometry.status, id).toBe('geometryReady');
      expect(part.geometry.source.rootFile).toBe(`parts/${id}.dat`);
      expect(part.geometry.source.files.length).toBeGreaterThan(0);
      expect(part.geometry.source.files.every(file => file.license && file.author && /^[a-f0-9]{64}$/.test(file.sha256))).toBe(true);
    }
    for (const id of ['3705', '2780', '32000', '32054']) {
      const bytes = await readFile(new URL(`ldraw/files/parts/${id}.dat`, base), 'utf8');
      expect(bytes).toContain(`0 Name: ${id}.dat`);
    }
  }, 30_000);

  it('leaves the production root set and native source hashes independent of the staging bundle', async () => {
    const production = new NativePartRepository();
    expect(await production.listIds()).toHaveLength(245);
    for (const id of ['3705', '2780', '32000', '32054']) expect(await production.getPart(id)).toBeUndefined();
    for (const id of ['3001', '3024', '87087', '3641']) {
      expect(nativePartSourceHash((await staged.getPart(id))!)).toBe(nativePartSourceHash((await production.getPart(id))!));
    }
  });

  it('keeps upstream licence copies and raw geometry/header bytes in the distributable source closure', async () => {
    for (const name of ['ldraw/CAreadme.txt', 'ldraw/CAlicense.txt', 'ldraw/CAlicense4.txt', 'shadow/LICENSE.md', 'shadow/README.md']) {
      expect((await readFile(new URL(name, base))).length).toBeGreaterThan(100);
    }
    expect(await readFile(new URL('.gitattributes', base), 'utf8')).toContain('ldraw/files/** -text');
    expect(await readFile(new URL('.gitattributes', base), 'utf8')).toContain('ldraw/manifest.json -text');
    expect(await readFile(new URL('.gitattributes', base), 'utf8')).toContain('shadow/manifest.json -text');
  });
});
