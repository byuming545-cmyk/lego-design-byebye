import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { NativePartRepository, nativePartSourceHash } from '../src/parts/assembly/source.js';
import { loadBundledLDrawManifest, validateBundledLDrawManifest } from '../src/parts/ldraw/bundled.js';
import { validateBundledShadowManifest } from '../src/parts/connections/bundled.js';
import { assertDigitalPartOrigin, inventoryReferenceMetadata } from '../src/parts/provenance.js';

describe('digital source import boundary', () => {
  it('rejects duplicate IDs instead of merging a later legacy root', async () => {
    const manifest = await loadBundledLDrawManifest();
    manifest.roots.push({ ...manifest.roots[0], name: 'Legacy replacement' });
    expect(() => validateBundledLDrawManifest(manifest)).toThrow('CONFLICT');
  });
  it('rejects an ID that resolves to a different source file', async () => {
    const manifest = await loadBundledLDrawManifest();
    manifest.roots[0].path = manifest.roots[1].path;
    expect(() => validateBundledLDrawManifest(manifest)).toThrow('CONFLICT');
  });
  it('rejects duplicate or canonical-equivalent file paths before building a hash table', async () => {
    for (const alias of ['duplicate', 'uppercase', 'traversal']) {
      const manifest = await loadBundledLDrawManifest();
      const duplicate = { ...manifest.files[0] };
      if (alias === 'uppercase') duplicate.path = duplicate.path.toUpperCase();
      if (alias === 'traversal') duplicate.path = '../parts/old.dat';
      manifest.files.push(duplicate);
      expect(() => validateBundledLDrawManifest(manifest)).toThrow();
    }
  });
  it('requires a reviewed source license and actual digest, not a supported flag', async () => {
    for (const field of ['license', 'sha256'] as const) {
      const manifest = await loadBundledLDrawManifest();
      manifest.files[0][field] = field === 'license' ? 'UNKNOWN' : 'manually-verified';
      expect(() => validateBundledLDrawManifest(manifest)).toThrow('Unreviewed');
    }
  });
  it('rejects duplicate Shadow files and unreviewed connection licenses', async () => {
    const original = JSON.parse(await readFile(new URL('../data/parts-foundation/shadow/manifest.json', import.meta.url), 'utf8'));
    const duplicate = structuredClone(original);
    duplicate.files.push({ ...duplicate.files[0] });
    expect(() => validateBundledShadowManifest(duplicate)).toThrow('CONFLICT');
    const unlicensed = structuredClone(original);
    unlicensed.files[0].license = 'UNKNOWN';
    expect(() => validateBundledShadowManifest(unlicensed)).toThrow('Unreviewed');
  });
  it('keeps the authoritative native model immutable and ignores forged legacy claims', async () => {
    const repository = new NativePartRepository();
    const native = (await repository.getPart('3001'))!;
    const originalHash = nativePartSourceHash(native);
    expect(() => assertDigitalPartOrigin(native)).not.toThrow();
    expect(Object.isFrozen(native.geometry.mesh!.positions)).toBe(true);
    const legacy = structuredClone(native);
    Object.assign(legacy, { sourceSystem: 'LDraw', sourceMetadata: { provenance: 'pinned-digital-source' }, supported: true, assemblyVerified: true });
    legacy.geometry.source.library = 'LegacyInstructionDerived' as 'LDraw';
    expect(() => assertDigitalPartOrigin(legacy)).toThrow('Untrusted digital geometry');
    expect(nativePartSourceHash((await repository.getPart('3001'))!)).toBe(originalHash);
    expect(await repository.getPart('legacy:3001')).toBeUndefined();
    expect(await repository.getPart('element:3001')).toBeUndefined();
  });
  it('rejects a handwritten connector even when geometry is genuinely native', async () => {
    const native = structuredClone((await new NativePartRepository().getPart('3001'))!);
    native.connections.points[0].source.sha256 = 'f'.repeat(64);
    expect(() => assertDigitalPartOrigin(native)).toThrow('Untrusted digital connection');
  });
  it('accepts all current pinned native models without promoting partial connectors', async () => {
    const repository = new NativePartRepository();
    const partial: string[] = [];
    for (const id of await repository.listIds()) {
      const native = (await repository.getPart(id))!;
      expect(native.geometry.status).toBe('geometryReady');
      expect(() => assertDigitalPartOrigin(native)).not.toThrow();
      if (native.connections.status === 'partial') partial.push(id);
    }
    expect(partial.length).toBeGreaterThan(0);
  }, 30_000);
  it('keeps inventory identity evidence reference-only, without geometry or assembly promotion', () => {
    expect(inventoryReferenceMetadata('1234567')).toMatchObject({
      sourceSystem: 'InventoryObservation', provenance: 'reference-observation-only', legacyStatus: 'REFERENCE_ONLY',
      geometryStatus: 'unavailable', connectionStatus: 'missing', assemblyStatus: 'not-verified', verificationEvidence: [],
    });
  });
});
