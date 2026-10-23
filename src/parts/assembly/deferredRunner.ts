import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { NativePartRepository } from './source.js';
import { createAssemblySourceLoader, loadStandardAssemblyFixtures } from './fixtures.js';
import { groupPhysicalInterfaces, type PhysicalConnectionGroup } from './interfaces.js';
import { prioritizePhysicalInterfaceIds, type NativePartAssemblyVerification } from './verification.js';
import { createInterfaceTestContext, contentHash } from './testContext.js';
import { INTERFACE_TEST_VERSION, type DeferredWorkerMessage, type DeferredWorkerRequest, type InterfaceTestContext, type InterfaceTestRecord } from './deferredTypes.js';
import type { DeferredWorkerHarness } from './deferredWorker.js';
import type { NativeAssemblyPart } from './types.js';
import { isRigidTransform } from './math.js';

export interface DeferredRunnerOptions {
  repository?: NativePartRepository;
  checkpointDirectory: string;
  concurrency?: number;
  batchSize?: number;
  timeoutMs?: number;
  startupTimeoutMs?: number;
  partBudgetMs?: number;
  maxRetries?: number;
  retryFailed?: boolean;
  signal?: AbortSignal;
  partIds?: string[];
  /** Diagnostic-only source group filter; publishing still requires all pinned roots/groups. */
  physicalInterfaceIds?: string[];
  onProgress?: (event: { partId: string; completed: number; total: number; status: string; cached: boolean }) => void | Promise<void>;
}
export interface DeferredPartRun {
  partId: string;
  part: NativeAssemblyPart;
  context: InterfaceTestContext;
  base?: NativePartAssemblyVerification;
  records: InterfaceTestRecord[];
}
export interface DeferredRunnerResult { parts: DeferredPartRun[]; interrupted: boolean; checkpointDirectory: string; resumedRecords: number; elapsedMs: number }
const TERMINAL = new Set(['PASS', 'BLOCKED', 'REQUIRES_ASTRA_REVIEW']);
const REQUIRED = ['connection', 'transform', 'reverse-connection', 'collision', 'illegal-collision', 'rotation', 'connection-graph', 'generator-smoke'];

export async function atomicWriteJson(filename: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600 }); await rename(temporary, filename); }
  finally { await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }); }
}
function filename(root: string, context: InterfaceTestContext, physicalId: string): string {
  if (!/^[a-f0-9]{64}$/.test(context.contextId) || !/^[a-f0-9]{64}$/.test(physicalId)) throw new Error('Invalid source-bound checkpoint key.');
  return path.join(root, context.contextId, `${physicalId}.json`);
}
export function validInterfaceCheckpoint(value: unknown, context: InterfaceTestContext, group: PhysicalConnectionGroup): value is InterfaceTestRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as InterfaceTestRecord;
  if (record.schemaVersion !== 1 || record.testVersion !== INTERFACE_TEST_VERSION || record.partId !== context.partId || record.context?.contextId !== context.contextId || contentHash({ ...record.context, contextId: undefined }) !== contentHash({ ...context, contextId: undefined }) || record.physicalInterfaceId !== group.physicalInterfaceId || !TERMINAL.has(record.status) || !Array.isArray(record.rawConnectionIds) || record.rawConnectionIds.length !== group.rawConnectionIds.length || group.rawConnectionIds.some(id => !record.rawConnectionIds.includes(id)) || !Array.isArray(record.reasonCodes) || !record.reasonCodes.every(value => typeof value === 'string') || !Array.isArray(record.reasons) || !record.reasons.every(value => typeof value === 'string') || !Array.isArray(record.sourceChecks) || !record.sourceChecks.every(check => !!check && typeof check.name === 'string' && ['passed', 'blocked'].includes(check.outcome)) || !Number.isInteger(record.attempts) || record.attempts < 1) return false;
  if (record.status !== 'PASS') return record.reasonCodes.length > 0 && record.reasons.length > 0;
  const proof = record.proof, fixture = context.fixtures.find(fixture => fixture.partId === record.fixturePartId);
  const point = proof && group.points.find(point => point.id === proof.connectionId);
  return !!proof && !!point && proof.status === 'verified' && proof.fixturePartId === record.fixturePartId && proof.sourceFile === point.source.path && proof.sourceLine === point.source.line && proof.sourceHash === point.source.sha256 && isRigidTransform(proof.transform) && Number.isFinite(proof.acceptedTwistDeg) && proof.fixtureSourceDigest === fixture?.sourceHash && record.fixtureSourceHash === fixture?.sourceHash && !!fixture?.sourceHash && record.sourceChecks.length > 0 && record.sourceChecks.every(check => check.outcome === 'passed') && Array.isArray(proof.equivalentConnectionIds) && proof.equivalentConnectionIds.length === group.rawConnectionIds.length && Array.isArray(proof.checks) && proof.checks.every(check => !!check && typeof check.name === 'string' && check.outcome === 'passed') && proof.equivalentConnectionIds.every(id => group.rawConnectionIds.includes(id)) && group.rawConnectionIds.every(id => proof.equivalentConnectionIds.includes(id)) && REQUIRED.every(name => proof.checks.some(check => check.name === name && check.outcome === 'passed'));
}
function stratum(group: PhysicalConnectionGroup): string {
  const point = group.points[0];
  return contentHash([point.kind, point.family, point.gender, point.direction, point.sections, point.radius, point.length, point.group]);
}
function routedRecord(context: InterfaceTestContext, group: PhysicalConnectionGroup, reasonCode: string, reason: string, related: string[], execution: InterfaceTestRecord['execution'] = 'review-dependency', status: InterfaceTestRecord['status'] = 'REQUIRES_ASTRA_REVIEW'): InterfaceTestRecord {
  const now = new Date().toISOString();
  return { schemaVersion: 1, testVersion: INTERFACE_TEST_VERSION, context, partId: context.partId, physicalInterfaceId: group.physicalInterfaceId, rawConnectionIds: group.rawConnectionIds, status, reasonCodes: [reasonCode], reasons: [reason], startedAt: now, finishedAt: now, durationMs: 0, attempts: 1, sourceChecks: [], execution, relatedCaseIds: related, caseId: `ASM-${contentHash([context.contextId, group.physicalInterfaceId]).slice(0, 20).toUpperCase()}`, fixturePartId: null, fixtureSourceHash: null };
}

/** External timer terminates a blocked worker even while its collision code is synchronous. */
export async function runDeferredInterfaces(options: DeferredRunnerOptions): Promise<DeferredRunnerResult> {
  const started = Date.now(), repository = options.repository ?? new NativePartRepository(), loader = await createAssemblySourceLoader(repository);
  const fixtures = await loadStandardAssemblyFixtures(loader);
  const checkpointDirectory = path.resolve(options.checkpointDirectory);
  const concurrency = options.concurrency ?? 2, batchSize = options.batchSize ?? 8, timeoutMs = options.timeoutMs ?? 8000, startupTimeoutMs = options.startupTimeoutMs ?? 30000, partBudgetMs = options.partBudgetMs ?? 60000, maxRetries = options.maxRetries ?? 1;
  if (![concurrency, batchSize, timeoutMs, startupTimeoutMs, partBudgetMs, maxRetries].every(Number.isSafeInteger) || concurrency < 1 || concurrency > 4 || batchSize < 1 || batchSize > 32 || timeoutMs < 10 || timeoutMs > 120000 || startupTimeoutMs < 10 || partBudgetMs < 0 || maxRetries < 0 || maxRetries > 3) throw new Error('Invalid bounded deferred runner settings.');
  const roots = loader.roots.filter(root => !options.partIds || options.partIds.includes(root.partId));
  if (options.partIds?.some(id => !loader.roots.some(root => root.partId === id))) throw new Error('Runner part filter contains an unknown native ID.');
  if (options.physicalInterfaceIds && (!options.physicalInterfaceIds.length || options.physicalInterfaceIds.some(id => !/^[a-f0-9]{64}$/.test(id)) || new Set(options.physicalInterfaceIds).size !== options.physicalInterfaceIds.length)) throw new Error('Runner physical interface filter is invalid.');
  const requestedPhysical = options.physicalInterfaceIds ? new Set(options.physicalInterfaceIds) : undefined;
  const foundPhysical = new Set<string>();
  const groupsFor = (part: NativeAssemblyPart) => groupPhysicalInterfaces(part).filter(group => {
    if (!requestedPhysical || requestedPhysical.has(group.physicalInterfaceId)) { foundPhysical.add(group.physicalInterfaceId); return true; }
    return false;
  });
  const parts: DeferredPartRun[] = [];
  let nextRoot = 0, completed = 0, total = 0, resumedRecords = 0;
  for (const root of roots) total += groupsFor((await repository.getPart(root.partId))!).length;
  if (requestedPhysical && [...requestedPhysical].some(id => !foundPhysical.has(id))) throw new Error('Runner physical interface filter contains an unknown source group.');
  async function handlePart(partId: string): Promise<DeferredPartRun> {
    const part = (await repository.getPart(partId))!, context = createInterfaceTestContext(part, fixtures), groups = groupsFor(part);
    const byId = new Map(groups.map(group => [group.physicalInterfaceId, group]));
    const records = new Map<string, InterfaceTestRecord>(), attempts = new Map<string, number>(), timeoutCases = new Map<string, string[]>();
    let base: NativePartAssemblyVerification | undefined, partStarted = Date.now(), stoppedForBudget = false;
    const order = prioritizePhysicalInterfaceIds(part).filter(id => byId.has(id));
    const pending: string[] = [];
    async function persist(record: InterfaceTestRecord, cached = false) {
      records.set(record.physicalInterfaceId, record);
      if (!cached) await atomicWriteJson(filename(checkpointDirectory, context, record.physicalInterfaceId), record);
      completed++; if (cached) resumedRecords++;
      await options.onProgress?.({ partId, completed, total, status: record.status, cached });
    }
    for (const id of order) {
      let cached: unknown;
      try { cached = JSON.parse(await readFile(filename(checkpointDirectory, context, id), 'utf8')); } catch { cached = undefined; }
      if (validInterfaceCheckpoint(cached, context, byId.get(id)!) && (!options.retryFailed || cached.status === 'PASS')) await persist(cached, true);
      else { pending.push(id); if (cached && typeof cached === 'object' && Number.isInteger((cached as InterfaceTestRecord).attempts)) attempts.set(id, Math.max(0, (cached as InterfaceTestRecord).attempts)); }
    }
    while (pending.length && !options.signal?.aborted) {
      const timedStratum = new Set([...timeoutCases].filter(([, cases]) => cases.length >= 2).map(([key]) => key));
      for (let index = pending.length - 1; index >= 0; index--) {
        const group = byId.get(pending[index])!, related = timeoutCases.get(stratum(group)) ?? [];
        if (timedStratum.has(stratum(group))) { pending.splice(index, 1); await persist(routedRecord(context, group, 'same-stratum-complex-timeout-review', 'Two direct tests of this same source profile and axis exceeded their isolated CPU budget. This untested interface is routed for review; no collision failure is asserted.', related)); }
      }
      if (!pending.length) break;
      if (partBudgetMs && Date.now() - partStarted >= partBudgetMs) { stoppedForBudget = true; break; }
      const batch = pending.splice(0, batchSize), recordIds = new Set<string>();
      let failureReason = 'The isolated worker exited unexpectedly.';
      let currentId: string | undefined, timer: ReturnType<typeof setTimeout> | undefined;
      const jsEntry = new URL('./deferredWorker.js', import.meta.url);
      // Source tests/tools may not inherit tsx loader flags. Register it in the
      // isolated worker explicitly; the compiled production worker needs no loader.
      const workerEntry = existsSync(jsEntry) ? jsEntry : new URL(`data:text/javascript,${encodeURIComponent(`import { register } from ${JSON.stringify(pathToFileURL(createRequire(import.meta.url).resolve('tsx/esm/api')).href)}; register(); await import(${JSON.stringify(new URL('./deferredWorker.ts', import.meta.url).href)});`)}`);
      const request: DeferredWorkerHarness = { partId, physicalInterfaceIds: batch, context };
      const worker = new Worker(workerEntry, { workerData: request satisfies DeferredWorkerRequest, resourceLimits: { maxOldGenerationSizeMb: 768 } });
      let messageChain = Promise.resolve(), finished = false;
      const outcome = await new Promise<'complete' | 'timeout' | 'crash' | 'aborted'>((resolve) => {
        const done = (value: 'complete' | 'timeout' | 'crash' | 'aborted') => { if (finished) return; finished = true; if (timer) clearTimeout(timer); options.signal?.removeEventListener('abort', aborted); resolve(value); };
        const arm = (ms: number) => { if (timer) clearTimeout(timer); timer = setTimeout(() => done('timeout'), ms); };
        const aborted = () => done('aborted');
        options.signal?.addEventListener('abort', aborted, { once: true });
        arm(startupTimeoutMs);
        worker.on('message', (message: DeferredWorkerMessage) => {
          if (finished) return;
          if (message.type === 'ready') { base = message.base; if (message.context.contextId !== context.contextId) { done('crash'); return; } arm(timeoutMs); }
          else if (message.type === 'start') { currentId = message.physicalInterfaceId; arm(timeoutMs); }
          else if (message.type === 'record') {
            const group = byId.get(message.record.physicalInterfaceId);
            if (!group || !batch.includes(group.physicalInterfaceId) || recordIds.has(group.physicalInterfaceId) || !validInterfaceCheckpoint(message.record, context, group)) { failureReason = 'Worker returned duplicate or invalid source-bound evidence.'; done('crash'); return; }
            recordIds.add(group.physicalInterfaceId);
            message.record.attempts = (attempts.get(group.physicalInterfaceId) ?? 0) + 1;
            messageChain = messageChain.then(() => persist(message.record));
            arm(timeoutMs);
          } else if (message.type === 'complete') done('complete');
          else if (message.type === 'fatal') { failureReason = message.reason; done('crash'); }
        });
        worker.once('error', error => { failureReason = error.message.slice(0, 500); done('crash'); });
        worker.once('exit', code => { if (!finished) done(code === 0 && batch.every(id => recordIds.has(id)) ? 'complete' : 'crash'); });
      });
      await worker.terminate();
      await messageChain;
      const unfinished = batch.filter(id => !recordIds.has(id));
      const shared = [...records.values()].find(record => record.execution === 'shared-source-precondition');
      if (shared && outcome !== 'aborted') {
        for (const id of [...unfinished, ...pending.splice(0)]) {
          const group = byId.get(id)!;
          const record: InterfaceTestRecord = { ...shared, physicalInterfaceId: id, rawConnectionIds: group.rawConnectionIds, caseId: `ASM-${contentHash([context.contextId, id]).slice(0, 20).toUpperCase()}`, relatedCaseIds: [shared.caseId], durationMs: 0 };
          await persist(record);
        }
        unfinished.length = 0;
      }
      if (outcome === 'aborted') { pending.unshift(...unfinished); break; }
      if (outcome === 'timeout' && currentId && unfinished.includes(currentId)) {
        const group = byId.get(currentId)!, record = routedRecord(context, group, 'isolated-interface-timeout', `The isolated test exceeded ${timeoutMs} ms. The worker was terminated; physical validity remains unknown.`, [], 'direct-test');
        const attempt = (attempts.get(currentId) ?? 0) + 1;
        attempts.set(currentId, attempt); record.attempts = attempt; record.durationMs = timeoutMs;
        // Retain the actual failed attempt even before it becomes a terminal review decision.
        await atomicWriteJson(path.join(checkpointDirectory, context.contextId, 'attempts', `${currentId}-${attempt}.json`), record);
        unfinished.splice(unfinished.indexOf(currentId), 1);
        if (attempt <= maxRetries) pending.unshift(currentId);
        else {
          await persist(record);
          const key = stratum(group), cases = timeoutCases.get(key) ?? []; cases.push(record.caseId); timeoutCases.set(key, cases);
        }
      }
      for (const id of unfinished) {
        const attempt = (attempts.get(id) ?? 0) + 1; attempts.set(id, attempt);
        if (attempt <= maxRetries) pending.push(id);
        else { const record = routedRecord(context, byId.get(id)!, 'isolated-worker-failure', `The bounded worker failed after its permitted retry: ${failureReason} No assembly pass was recorded.`, [], 'review-dependency', 'REQUIRES_ASTRA_REVIEW'); record.attempts = attempt; await persist(record); }
      }
    }
    if (pending.length) for (const id of pending) {
      const group = byId.get(id)!, interrupted = !!options.signal?.aborted;
      const record = routedRecord(context, group, interrupted ? 'explicitly-interrupted' : 'part-scheduling-budget-review', interrupted ? 'The test run was explicitly interrupted before this interface obtained a terminal result.' : `This interface was not directly tested within the ${partBudgetMs} ms part scheduling budget and requires review. No collision failure is asserted.`, timeoutCases.get(stratum(group)) ?? [], 'review-dependency', interrupted ? 'PENDING' : 'REQUIRES_ASTRA_REVIEW');
      if (interrupted) { record.interrupted = true; records.set(id, record); }
      else await persist(record);
    }
    void stoppedForBudget;
    return { partId, part, context, base, records: groups.map(group => records.get(group.physicalInterfaceId)!).filter(Boolean) };
  }
  await Promise.all(Array.from({ length: concurrency }, async () => { while (nextRoot < roots.length) { const root = roots[nextRoot++]; parts.push(await handlePart(root.partId)); } }));
  parts.sort((a, b) => roots.findIndex(root => root.partId === a.partId) - roots.findIndex(root => root.partId === b.partId));
  const interrupted = !!options.signal?.aborted;
  await atomicWriteJson(path.join(checkpointDirectory, 'run-state.json'), { schemaVersion: 1, testVersion: INTERFACE_TEST_VERSION, interrupted, completed, total, finishedAt: new Date().toISOString(), elapsedMs: Date.now() - started });
  return { parts, interrupted, checkpointDirectory, resumedRecords, elapsedMs: Date.now() - started };
}
