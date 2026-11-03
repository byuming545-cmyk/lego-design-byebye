import type { RequestHandler } from 'express';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { BUNDLED_LDRAW_DIRECTORY } from './ldraw/bundled.js';
import { fileURLToPath } from 'node:url';

const SHADOW = fileURLToPath(new URL('../../data/parts-foundation/shadow/', import.meta.url));
export interface SnapshotRoots { ldrawRoot?: string; shadowRoot?: string }
export function sourceSnapshotDigest(roots: SnapshotRoots = {}): string {
  return createHash('sha256').update(readFileSync(path.join(roots.ldrawRoot ?? BUNDLED_LDRAW_DIRECTORY, 'manifest.json')))
    .update('\0').update(readFileSync(path.join(roots.shadowRoot ?? SHADOW, 'manifest.json'))).digest('hex');
}
export class SourceSnapshotChanged extends Error {
  readonly code = 'SOURCE_SNAPSHOT_RESTART_REQUIRED';
  constructor() { super('真实零件库已变化；请重启服务并刷新页面，再重新验证或生成模型。'); }
}
/** Immutable process snapshot. Promotions never mutate existing source files.
 * A changed catalogue stops new requests rather than mixing old/new caches. */
export class SourceSnapshotGuard {
  readonly digest: string;
  private signature: string;
  private statSignature() {
    return [this.roots.ldrawRoot ?? BUNDLED_LDRAW_DIRECTORY, this.roots.shadowRoot ?? SHADOW].map(root => {
      const s = statSync(path.join(root, 'manifest.json'), { bigint: true });
      return [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs].join(':');
    }).join('|');
  }
  constructor(private readonly roots: SnapshotRoots = {}) {
    this.signature = this.statSignature();
    this.digest = sourceSnapshotDigest(roots);
    if (this.signature !== this.statSignature()) throw new SourceSnapshotChanged();
  }
  assertNoPendingPromotion() {
    const root = this.roots.ldrawRoot ?? BUNDLED_LDRAW_DIRECTORY;
    if (existsSync(path.join(root, '.import.lock'))) throw new SourceSnapshotChanged();
    const journal = path.join(root, '.import-journal');
    if (existsSync(journal) && readdirSync(journal, { withFileTypes: true }).some(entry => entry.isDirectory())) throw new SourceSnapshotChanged();
  }
  assertCurrent() {
    try {
      const signature = this.statSignature();
      if (signature === this.signature) return;
      if (sourceSnapshotDigest(this.roots) === this.digest && signature === this.statSignature()) { this.signature = signature; return; }
    } catch { /* fail closed on incomplete catalogue writes */ }
    throw new SourceSnapshotChanged();
  }
}

export function sourceSnapshotMiddleware(guard: SourceSnapshotGuard): RequestHandler {
  return (_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Part-Catalogue-Snapshot', guard.digest);
    try { guard.assertNoPendingPromotion(); guard.assertCurrent(); next(); }
    catch { response.status(503).json({ code: 'SOURCE_SNAPSHOT_RESTART_REQUIRED', error: '真实零件库已更新，请重启服务并刷新页面。旧模型需要当前版本复核。', restartRequired: true }); }
  };
}
