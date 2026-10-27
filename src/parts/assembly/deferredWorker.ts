import { parentPort, workerData } from 'node:worker_threads';
import { NativePartRepository } from './source.js';
import { AttachmentEngine } from './engine.js';
import { createAssemblySourceLoader, loadStandardAssemblyFixtures } from './fixtures.js';
import { groupPhysicalInterfaces } from './interfaces.js';
import { verifyNativePartAssembly } from './verification.js';
import { createInterfaceTestContext, contentHash } from './testContext.js';
import { INTERFACE_TEST_VERSION, type DeferredWorkerMessage, type DeferredWorkerRequest, type InterfaceTestRecord } from './deferredTypes.js';
import type { PhysicalInterfaceStatus } from './coverage.js';

export type DeferredWorkerHarness = DeferredWorkerRequest;
const send = (message: DeferredWorkerMessage) => parentPort?.postMessage(message);

function classify(codes: string[], reasons: string[]): PhysicalInterfaceStatus {
  const text = `${codes.join(' ')} ${reasons.join(' ')}`;
  if (/collision|winding|hollow|proxy|clip|bar engagement|axle|wheel|tyre|deformation|penetration|insertion depth|mechanical/i.test(text)) return 'REQUIRES_ASTRA_REVIEW';
  return 'BLOCKED';
}

async function main(request: DeferredWorkerRequest) {
  const repository = new NativePartRepository(), loader = await createAssemblySourceLoader(repository);
  const fixtures = await loadStandardAssemblyFixtures(loader), part = await repository.getPart(request.partId);
  if (!part) throw new Error('Requested native part does not exist.');
  const context = createInterfaceTestContext(part, fixtures);
  if (context.contextId !== request.context.contextId) throw new Error('Worker source / fixture / test / engine context changed; old evidence cannot be reused.');
  const engine = new AttachmentEngine({ loadPart: id => repository.getPart(id), mode: 'verification' });
  const base = await verifyNativePartAssembly(part, part.geometry.name ?? part.partId, fixtures, engine, { onlyConnectionIds: [], maxInterfacesPerPart: null });
  const terminalPrecondition = part.connections.status !== 'ready' || base.sourceChecks.some(check => check.outcome !== 'passed');
  send({ type: 'ready', context, base, terminalPrecondition });
  const groups = groupPhysicalInterfaces(part);
  for (const physicalInterfaceId of request.physicalInterfaceIds) {
    const group = groups.find(group => group.physicalInterfaceId === physicalInterfaceId);
    if (!group) throw new Error('Requested physical interface is not in the source-bound part.');
    send({ type: 'start', physicalInterfaceId });
    const started = Date.now();
    const verified = terminalPrecondition ? base : await verifyNativePartAssembly(part, base.name, fixtures, engine, { onlyConnectionIds: [group.rawConnectionIds[0]], maxInterfacesPerPart: null });
    const proof = verified.fixtures.find(fixture => fixture.equivalentConnectionIds.includes(group.rawConnectionIds[0]) && !fixture.reasonCodes.includes('deferred-interface-budget'));
    const status = proof?.status === 'verified' ? 'PASS' : classify(proof?.reasonCodes ?? verified.reasonCodes, proof?.reasons ?? verified.reasons);
    const fixture = context.fixtures.find(fixture => fixture.partId === proof?.fixturePartId);
    if (status === 'PASS' && (!proof?.fixtureSourceDigest || proof.fixtureSourceDigest !== fixture?.sourceHash)) throw new Error('Passing fixture evidence is not bound to the current second part source.');
    const record: InterfaceTestRecord = {
      schemaVersion: 1, testVersion: INTERFACE_TEST_VERSION, partId: part.partId, context, physicalInterfaceId, rawConnectionIds: group.rawConnectionIds, status,
      reasonCodes: proof?.reasonCodes.length ? proof.reasonCodes : status === 'PASS' ? [] : verified.reasonCodes.length ? verified.reasonCodes : ['EVIDENCE_MISSING'],
      reasons: proof?.reasons.length ? proof.reasons : status === 'PASS' ? [] : verified.reasons,
      ...(proof ? { proof } : {}), sourceChecks: verified.sourceChecks,
      startedAt: new Date(started).toISOString(), finishedAt: new Date().toISOString(), durationMs: Date.now() - started, attempts: 1,
      execution: terminalPrecondition ? 'shared-source-precondition' : 'direct-test', relatedCaseIds: [],
      caseId: `ASM-${contentHash([context.contextId, physicalInterfaceId]).slice(0, 20).toUpperCase()}`,
      fixturePartId: proof?.fixturePartId ?? null, fixtureSourceHash: proof?.fixtureSourceDigest ?? null,
    };
    send({ type: 'record', record });
  }
  send({ type: 'complete' });
}

if (parentPort) void main(workerData as DeferredWorkerRequest).catch(error => send({ type: 'fatal', reason: error instanceof Error ? error.message.slice(0, 1000) : 'Worker execution failed.' }));
