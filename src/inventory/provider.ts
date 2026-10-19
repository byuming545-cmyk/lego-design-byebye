import type { SetInventory } from '../types/index.js';

/** Providers always return a fresh, complete inventory; callers may update usage. */
export interface SetInventoryProvider {
  readonly source: 'mock' | 'rebrickable';
  getSetInventory(setNumber: string): Promise<SetInventory>;
}

export class InventoryError extends Error {
  constructor(message: string, public readonly code: string, public readonly status: number) {
    super(message);
    this.name = 'InventoryError';
  }
}

export function normalizeSetNumber(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9]\d{2,6}(?:-[1-9]\d{0,2})?$/.test(value.trim())) {
    throw new InventoryError('请输入有效套装编号，例如 10696 或 10696-1。', 'INVALID_SET_NUMBER', 400);
  }
  const number = value.trim();
  return number.includes('-') ? number : `${number}-1`;
}
