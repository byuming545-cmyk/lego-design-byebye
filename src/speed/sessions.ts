import { randomUUID } from 'node:crypto';
import { InventoryError } from '../inventory/index.js';
import type { SpeedGenerationResult, VehicleCandidate } from './types.js';
import { cloneSpeedDocument, createSpeedDocument, updateSpeedDocument, type SpeedModelDocument, type SpeedModelMetadata } from './documents.js';
import { SpeedModelDiskStore } from './storage.js';
import { compactVehicleCandidate } from './stepCodec.js';

export interface SpeedSession {
  result: SpeedGenerationResult;
  history: Map<string, VehicleCandidate[]>;
  updatedAt: number;
  documents: Map<string, SpeedModelDocument>;
}

/** Bounded, process-local design history; the server retains the trusted inventory. */
export class SpeedDesignStore {
  private readonly sessions = new Map<string, SpeedSession>();
  private readonly maxSessions = 30;
  private readonly maxHistory = 12;
  private readonly ttlMs = 60 * 60 * 1000;

  constructor(public readonly storage = new SpeedModelDiskStore()) {}

  async create(result: SpeedGenerationResult, persistedDocuments: SpeedModelDocument[] = []): Promise<string> {
    const now = Date.now();
    const id = randomUUID();
    const documents = new Map(result.candidates.map(candidate => {
      const existing = persistedDocuments.find(document => document.metadata.modelId === candidate.model.id);
      return [candidate.model.id, existing ? cloneSpeedDocument(existing) : createSpeedDocument(candidate, result.inventory)] as const;
    }));
    for (const document of documents.values()) if (!persistedDocuments.some(existing => existing.metadata.modelId === document.metadata.modelId)) await this.storage.save(document);
    for (const [key, session] of this.sessions) if (now - session.updatedAt > this.ttlMs) this.sessions.delete(key);
    while (this.sessions.size >= this.maxSessions) this.sessions.delete(this.sessions.keys().next().value!);
    this.sessions.set(id, { result: { ...result, inventory: structuredClone(result.inventory), candidates: result.candidates.map(compactVehicleCandidate), warnings: [...result.warnings] }, history: new Map(), updatedAt: now, documents });
    return id;
  }

  document(session: SpeedSession, id: string): SpeedModelDocument {
    this.candidate(session, id);
    return cloneSpeedDocument(session.documents.get(id)!);
  }

  metadata(session: SpeedSession, id: string): SpeedModelMetadata {
    return this.document(session, id).metadata;
  }

  get(id: string): SpeedSession {
    const session = this.sessions.get(id);
    if (!session || Date.now() - session.updatedAt > this.ttlMs) {
      this.sessions.delete(id);
      throw new InventoryError('设计会话已过期或不存在，请重新生成方案。', 'SPEED_SESSION_NOT_FOUND', 404);
    }
    session.updatedAt = Date.now();
    return session;
  }

  candidate(session: SpeedSession, id: string): VehicleCandidate {
    const candidate = session.result.candidates.find(candidate => candidate.model.id === id);
    if (!candidate) throw new InventoryError('此候选方案不属于当前设计会话。', 'SPEED_CANDIDATE_NOT_FOUND', 404);
    return candidate;
  }

  async replace(session: SpeedSession, candidate: VehicleCandidate, recordHistory = true): Promise<number> {
    const previous = this.candidate(session, candidate.model.id);
    const previousDocument = session.documents.get(candidate.model.id)!;
    const document = updateSpeedDocument(previousDocument, candidate, session.result.inventory);
    await this.storage.save(document, previousDocument.metadata);
    const stack = session.history.get(candidate.model.id) ?? [];
    if (recordHistory) {
      stack.push(compactVehicleCandidate(previous));
      if (stack.length > this.maxHistory) stack.shift();
      session.history.set(candidate.model.id, stack);
    }
    session.result.candidates = session.result.candidates.map(item => item.model.id === candidate.model.id ? compactVehicleCandidate(candidate) : item);
    session.documents.set(candidate.model.id, document);
    return stack.length;
  }

  async undo(session: SpeedSession, id: string): Promise<{ candidate: VehicleCandidate; undoDepth: number }> {
    const current = this.candidate(session, id);
    const stack = session.history.get(id);
    const previous = stack?.length ? compactVehicleCandidate(stack[stack.length - 1]) : undefined;
    if (!previous) throw new InventoryError('当前方案还没有可以撤销的结构修改。', 'SPEED_NOTHING_TO_UNDO', 409);
    for (const module of previous.model.modules) module.locked = current.model.modules.find(item => item.id === module.id)?.locked ?? module.locked;
    await this.replace(session, previous, false);
    stack!.pop();
    return { candidate: compactVehicleCandidate(previous), undoDepth: stack!.length };
  }
}
