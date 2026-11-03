import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sourceSnapshotDigest } from '../src/parts/sourceSnapshot.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { recoverImportJournals, transactionalPromote, type TransactionalPromoteInput } from '../src/parts/import/transaction.js';

let root: string, ldrawRoot: string, shadowRoot: string;
const exists = (target: string) => access(target).then(() => true, () => false);
const originalLdraw = JSON.stringify({ roots: [], files: [] });
const originalShadow = JSON.stringify({ files: [] });

async function input(overrides: Partial<TransactionalPromoteInput> = {}): Promise<TransactionalPromoteInput> {
  const sourceL = path.join(root, 'source-ldraw.dat'); const sourceS = path.join(root, 'source-shadow.dat');
  await writeFile(sourceL, 'ldraw'); await writeFile(sourceS, 'shadow');
  return {
    ldrawRoot, shadowRoot, partId: 'testonly1',
    ldrawFiles: [{ path: 'parts/testonly1.dat', source: sourceL, target: path.join(ldrawRoot, 'files/parts/testonly1.dat') }],
    shadowFiles: [{ path: 'parts/testonly1.dat', source: sourceS, target: path.join(shadowRoot, 'files/parts/testonly1.dat') }],
    ldrawManifest: JSON.stringify({ roots: [{ partId: 'testonly1', path: 'parts/testonly1.dat' }], files: [] }),
    shadowManifest: JSON.stringify({ files: [{ path: 'parts/testonly1.dat' }] }),
    ledger: { partId: 'testonly1', validation: { status: 'validated' } },
    ...overrides,
  };
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'bricklab-import-transaction-'));
  ldrawRoot = path.join(root, 'ldraw'); shadowRoot = path.join(root, 'shadow');
  await mkdir(ldrawRoot, { recursive: true }); await mkdir(shadowRoot, { recursive: true });
  await writeFile(path.join(ldrawRoot, 'manifest.json'), originalLdraw);
  await writeFile(path.join(shadowRoot, 'manifest.json'), originalShadow);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('transactional part promotion', () => {
  it('commits declared files, manifests and ledger together', async () => {
    const value = await input();
    const result = await transactionalPromote(value);
    expect(await readFile(path.join(ldrawRoot, 'files/parts/testonly1.dat'), 'utf8')).toBe('ldraw');
    expect(JSON.parse(await readFile(path.join(ldrawRoot, 'manifest.json'), 'utf8')).roots[0].partId).toBe('testonly1');
    expect(await exists(result.ledgerPath)).toBe(true);
    expect(result.files).toHaveLength(2);
  });

  it('writes the ledger only after verification and persists post-promote audit data', async () => {
    const value = await input({
      verify: async () => { (value.ledger as Record<string, unknown>).postPromoteAudit = { totalRoots: 2 }; },
    });
    const result = await transactionalPromote(value);
    const ledger = JSON.parse(await readFile(result.ledgerPath, 'utf8'));
    expect(ledger.postPromoteAudit).toEqual({ totalRoots: 2 });
  });

  it('refuses an existing target before changing manifests', async () => {
    const value = await input();
    await mkdir(path.dirname(value.ldrawFiles[0].target), { recursive: true });
    await writeFile(value.ldrawFiles[0].target, 'existing');
    await expect(transactionalPromote(value)).rejects.toMatchObject({ code: 'promotion-target-exists' });
    expect(await readFile(path.join(ldrawRoot, 'manifest.json'), 'utf8')).toBe(originalLdraw);
  });

  it('rolls back files, manifests and ledger when post-promote verification fails', async () => {
    const value = await input({ verify: async () => { throw new Error('post-promote failed'); } });
    await expect(transactionalPromote(value)).rejects.toThrow('post-promote failed');
    expect(await exists(value.ldrawFiles[0].target)).toBe(false);
    expect(await exists(value.shadowFiles[0].target)).toBe(false);
    expect(await readFile(path.join(ldrawRoot, 'manifest.json'), 'utf8')).toBe(originalLdraw);
    expect(await readFile(path.join(shadowRoot, 'manifest.json'), 'utf8')).toBe(originalShadow);
    expect(await exists(path.join(ldrawRoot, 'imports/testonly1.json'))).toBe(false);
  });

  it('recovers an uncommitted journal by restoring backups and removing copied files', async () => {
    const target = path.join(ldrawRoot, 'files/parts/testonly1.dat');
    await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, 'partial');
    const journal = path.join(ldrawRoot, '.import-journal/crashed');
    await mkdir(journal, { recursive: true });
    await writeFile(path.join(journal, 'ldraw-manifest.bak'), originalLdraw);
    await writeFile(path.join(journal, 'shadow-manifest.bak'), originalShadow);
    await writeFile(path.join(journal, 'journal.json'), JSON.stringify({ state: 'copying', shadowRoot, copied: [target], ledgerPath: path.join(ldrawRoot, 'imports/testonly1.json') }));
    await writeFile(path.join(ldrawRoot, 'manifest.json'), '{"roots":[{"partId":"testonly1"}]}');
    expect(await recoverImportJournals(ldrawRoot)).toBe(1);
    expect(await readFile(path.join(ldrawRoot, 'manifest.json'), 'utf8')).toBe(originalLdraw);
    expect(await exists(target)).toBe(false);
    expect(await exists(journal)).toBe(false);
  });
});

describe('source and derived catalogue publication transaction', () => {
  it('rejects a stale staged catalogue under the promotion lock without losing a newer manifest', async () => {
    const digest = sourceSnapshotDigest({ ldrawRoot, shadowRoot });
    await writeFile(path.join(ldrawRoot, 'manifest.json'), originalLdraw + '\n');
    await expect(transactionalPromote(await input({ expectedSourceSnapshot: digest }))).rejects.toMatchObject({ code: 'promotion-source-snapshot-changed' });
    expect(await readFile(path.join(ldrawRoot, 'manifest.json'), 'utf8')).toBe(originalLdraw + '\n');
  });
  it('publishes reports and the active pointer with the source transaction', async () => {
    const pointer = path.join(root, 'reports/current.json');
    await transactionalPromote(await input({ publications: async () => [{ target: pointer, content: '{"snapshot":"new"}' }] }));
    expect(await readFile(pointer, 'utf8')).toBe('{"snapshot":"new"}');
  });
  it('restores existing reports and source files if a later publication fails', async () => {
    const pointer = path.join(root, 'current.json'), notDirectory = path.join(root, 'not-a-directory');
    await writeFile(pointer, 'old pointer'); await writeFile(notDirectory, 'file');
    const value = await input({ publications: async () => [{ target: pointer, content: 'new pointer' }, { target: path.join(notDirectory, 'report.json'), content: 'fail' }] });
    await expect(transactionalPromote(value)).rejects.toBeDefined();
    expect(await readFile(pointer, 'utf8')).toBe('old pointer');
    expect(await readFile(path.join(ldrawRoot, 'manifest.json'), 'utf8')).toBe(originalLdraw);
    expect(await exists(value.ldrawFiles[0].target)).toBe(false);
    expect(await exists(path.join(ldrawRoot, 'imports/testonly1.json'))).toBe(false);
  });
});
