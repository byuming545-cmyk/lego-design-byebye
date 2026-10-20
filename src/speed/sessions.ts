import { randomUUID } from 'node:crypto';
import { InventoryError } from '../inventory/index.js';
import type { SpeedGenerationResult, VehicleCandidate } from './types.js';

export interface SpeedSession {
  result: SpeedGenerationResult;
  history: Map<string, VehicleCandidate[]>;
  updatedAt: number;
}

/** Bounded, process-local design history; the server retains the trusted inventory. */
export class SpeedDesignStore {
  private readonly sessions = new Map<string, SpeedSession>();
  private readonly maxSessions = 30;
  private readonly maxHistory = 12;
  private readonly ttlMs = 60 * 60 * 1000;

  create(result: SpeedGenerationResult): string {
    const now = Date.now();
    for (const [key, session] of this.sessions) if (now - session.updatedAt > this.ttlMs) this.sessions.delete(key);
    while (this.sessions.size >= this.maxSessions) this.sessions.delete(this.sessions.keys().next().value!);
    const id = randomUUID();
    this.sessions.set(id, { result: structuredClone(result), history: new Map(), updatedAt: now });
    return id;
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

  replace(session: SpeedSession, candidate: VehicleCandidate, recordHistory = true): number {
    const previous = this.candidate(session, candidate.model.id);
    const stack = session.history.get(candidate.model.id) ?? [];
    if (recordHistory) {
      stack.push(structuredClone(previous));
      if (stack.length > this.maxHistory) stack.shift();
      session.history.set(candidate.model.id, stack);
    }
    session.result.candidates = session.result.candidates.map(item => item.model.id === candidate.model.id ? structuredClone(candidate) : item);
    return stack.length;
  }

  undo(session: SpeedSession, id: string): { candidate: VehicleCandidate; undoDepth: number } {
    const current = this.candidate(session, id);
    const stack = session.history.get(id);
    const previous = stack?.pop();
    if (!previous) throw new InventoryError('当前方案还没有可以撤销的结构修改。', 'SPEED_NOTHING_TO_UNDO', 409);
    for (const module of previous.model.modules) module.locked = current.model.modules.find(item => item.id === module.id)?.locked ?? module.locked;
    this.replace(session, previous, false);
    return { candidate: structuredClone(previous), undoDepth: stack!.length };
  }
}
