import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { sourceSnapshotDigest } from '../sourceSnapshot.js';
import { PartImportError } from './bundle.js';

export interface PromoteFile { path: string; source: string; target: string }
export interface TransactionalPromoteInput {
  ldrawRoot: string;
  shadowRoot: string;
  partId: string;
  expectedSourceSnapshot?: string;
  ldrawFiles: PromoteFile[];
  shadowFiles: PromoteFile[];
  ldrawManifest: string;
  shadowManifest: string;
  ledger: Record<string, unknown>;
  verify?: () => Promise<void>;
  publications?: () => Promise<{ target: string; content: string }[]>;
}
export interface TransactionalPromoteResult {
  journalId: string;
  files: string[];
  ledgerPath: string;
  bundleHash: string;
  validationDigest: string;
}

const journalRoot = (ldrawRoot: string) => path.join(ldrawRoot, '.import-journal');
const importsRoot = (ldrawRoot: string) => path.join(ldrawRoot, 'imports');
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

async function atomicWrite(target: string, content: string | Buffer): Promise<void> {
  const temporary = `${target}.tmp-${randomUUID()}`;
  const handle = await open(temporary, 'w');
  try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, target);
}

async function acquireLock(ldrawRoot: string): Promise<() => Promise<void>> {
  await mkdir(ldrawRoot, { recursive: true });
  const lock = path.join(ldrawRoot, '.import.lock');
  let handle;
  try { handle = await open(lock, 'wx'); } catch {
    const pid = Number(await readFile(lock, 'utf8').catch(() => ''));
    let alive = false;
    if (Number.isSafeInteger(pid) && pid > 0) { try { process.kill(pid, 0); alive = true; } catch { alive = false; } }
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new PartImportError('import-lock-held', 'Import lock ownership is unresolved; refusing to steal a newly created lock.');
    if (alive) throw new PartImportError('import-lock-held', `Another promote (pid ${pid}) holds ${lock}.`);
    await rm(lock, { force: true });
    try { handle = await open(lock, 'wx'); } catch { throw new PartImportError('import-lock-held', `Another promote holds ${lock}.`); }
  }
  await handle.writeFile(String(process.pid));
  await handle.sync().catch(() => undefined);
  return async () => { await handle!.close().catch(() => undefined); await rm(lock, { force: true }).catch(() => undefined); };
}

interface PublicationBackup { target: string; backup: string; existed: boolean }
async function restorePublications(records: PublicationBackup[] = []) {
  for (const record of [...records].reverse()) {
    if (record.existed) await atomicWrite(record.target, await readFile(record.backup));
    else await rm(record.target, { force: true });
  }
}

async function restoreBackup(backup: string, target: string): Promise<void> {
  let bytes: Buffer;
  try { bytes = await readFile(backup); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  await atomicWrite(target, bytes);
}

/** Recover every journal not marked committed. Must be called while holding the import lock. */
export async function recoverImportJournals(ldrawRoot: string): Promise<number> {
  const root = journalRoot(ldrawRoot);
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  let recovered = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(root, entry.name);
    let journal: Record<string, unknown>;
    try { journal = JSON.parse(await readFile(path.join(directory, 'journal.json'), 'utf8')) as Record<string, unknown>; } catch { await rm(directory, { recursive: true, force: true }); continue; }
    if (journal.state === 'committed') { await rm(directory, { recursive: true, force: true }); continue; }
    await restorePublications(journal.publications as PublicationBackup[] | undefined);
    await restoreBackup(path.join(directory, 'ldraw-manifest.bak'), path.join(ldrawRoot, 'manifest.json'));
    await restoreBackup(path.join(directory, 'shadow-manifest.bak'), path.join((journal.shadowRoot as string) ?? '', 'manifest.json'));
    for (const target of (journal.copied as string[] | undefined) ?? []) await rm(target, { force: true });
    if (typeof journal.ledgerPath === 'string') await rm(journal.ledgerPath, { force: true });
    await rm(directory, { recursive: true, force: true });
    recovered += 1;
  }
  return recovered;
}

export async function transactionalPromote(input: TransactionalPromoteInput): Promise<TransactionalPromoteResult> {
  const release = await acquireLock(input.ldrawRoot);
  let journalDirectory: string | undefined;
  let copied: string[] = [];
  const publicationBackups: PublicationBackup[] = [];
  try {
    await recoverImportJournals(input.ldrawRoot);
    if (input.expectedSourceSnapshot && sourceSnapshotDigest(input) !== input.expectedSourceSnapshot) throw new PartImportError('promotion-source-snapshot-changed', 'The source catalogue changed after staging; revalidate the bundle before promotion.');
    const ldrawManifestPath = path.join(input.ldrawRoot, 'manifest.json');
    const shadowManifestPath = path.join(input.shadowRoot, 'manifest.json');
    const ldrawBackup = await readFile(ldrawManifestPath);
    const shadowBackup = await readFile(shadowManifestPath);
    const allFiles = [...input.ldrawFiles, ...input.shadowFiles];
    for (const file of allFiles) {
      const existing = await lstat(file.target).catch(() => undefined);
      if (existing) throw new PartImportError('promotion-target-exists', `Refusing to overwrite existing source: ${file.target}`);
    }
    const journalId = randomUUID();
    journalDirectory = path.join(journalRoot(input.ldrawRoot), journalId);
    await mkdir(journalDirectory, { recursive: true });
    await writeFile(path.join(journalDirectory, 'ldraw-manifest.bak'), ldrawBackup);
    await writeFile(path.join(journalDirectory, 'shadow-manifest.bak'), shadowBackup);
    const journal = { journalId, partId: input.partId, state: 'prepared', ldrawRoot: input.ldrawRoot, shadowRoot: input.shadowRoot, ledgerPath: path.join(importsRoot(input.ldrawRoot), `${input.partId}.json`), copied, publications: publicationBackups, createdAt: new Date().toISOString() };
    await atomicWrite(path.join(journalDirectory, 'journal.json'), JSON.stringify(journal, null, 2));
    journal.state = 'copying';
    journal.copied = allFiles.map(file => file.target);
    await atomicWrite(path.join(journalDirectory, 'journal.json'), JSON.stringify(journal, null, 2));
    for (const file of allFiles) {
      await mkdir(path.dirname(file.target), { recursive: true });
      const sourceBytes = await readFile(file.source);
      const target = await open(file.target, 'wx');
      copied.push(file.target);
      try { await target.writeFile(sourceBytes); await target.sync(); } finally { await target.close(); }
    }
    await atomicWrite(ldrawManifestPath, input.ldrawManifest);
    await atomicWrite(shadowManifestPath, input.shadowManifest);
    const ledgerPath = journal.ledgerPath;
    const readbackLdraw = JSON.parse(await readFile(ldrawManifestPath, 'utf8')) as { roots?: { partId?: string }[] };
    const readbackShadow = JSON.parse(await readFile(shadowManifestPath, 'utf8')) as { files?: { path?: string }[] };
    if (!readbackLdraw.roots?.some(root => root.partId === input.partId)) throw new PartImportError('promotion-readback-failed', 'LDraw manifest readback did not contain the promoted root.');
    if (!readbackShadow.files?.some(file => file.path === `parts/${input.partId}.dat`)) throw new PartImportError('promotion-readback-failed', 'Shadow manifest readback did not contain the promoted root.');
    await input.verify?.();
    for (const [index, publication] of (await input.publications?.() ?? []).entries()) {
      await mkdir(path.dirname(publication.target), { recursive: true });
      const backup = path.join(journalDirectory, `publication-${index}.bak`);
      let existed = true;
      try { await writeFile(backup, await readFile(publication.target)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; existed = false; }
      publicationBackups.push({ target: publication.target, backup, existed });
      await atomicWrite(path.join(journalDirectory, 'journal.json'), JSON.stringify(journal, null, 2));
      await atomicWrite(publication.target, publication.content);
      if (await readFile(publication.target, 'utf8') !== publication.content) throw new PartImportError('publication-readback-failed', 'Derived catalogue publication readback differs.');
    }
    await mkdir(path.dirname(ledgerPath), { recursive: true });
    await atomicWrite(ledgerPath, JSON.stringify(input.ledger, null, 2));
    journal.state = 'committed';
    await atomicWrite(path.join(journalDirectory, 'journal.json'), JSON.stringify(journal, null, 2));
    await rm(journalDirectory, { recursive: true, force: true });
    return { journalId, files: copied, ledgerPath, bundleHash: sha256(JSON.stringify(input.ledger)), validationDigest: sha256(JSON.stringify(input.ledger.validation ?? {})) };
  } catch (error) {
    if (journalDirectory) {
      await restorePublications(publicationBackups);
      await restoreBackup(path.join(journalDirectory, 'ldraw-manifest.bak'), path.join(input.ldrawRoot, 'manifest.json'));
      await restoreBackup(path.join(journalDirectory, 'shadow-manifest.bak'), path.join(input.shadowRoot, 'manifest.json'));
      for (const target of copied) await rm(target, { force: true }).catch(() => undefined);
      await rm(path.join(importsRoot(input.ldrawRoot), `${input.partId}.json`), { force: true }).catch(() => undefined);
      await rm(journalDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
    throw error;
  } finally {
    await release();
  }
}

/** Explicit operator recovery; uses the same lock as promotion. Never a public API. */
export async function recoverPartImports(ldrawRoot: string): Promise<number> {
  const release = await acquireLock(ldrawRoot);
  try { return await recoverImportJournals(ldrawRoot); } finally { await release(); }
}
