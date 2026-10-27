import { createHash } from 'node:crypto';
import type { ColorIdSystem, FoundationInventory, FoundationInventoryItem, InventoryEvidence, LocalInventoryOptions, PartIdSystem } from './types.js';

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_ROWS = 20_000;
const MAX_QUANTITY = 100_000;
const PART_SYSTEMS = ['ldraw', 'rebrickable', 'bricklink'] as const;
const COLOR_SYSTEMS = ['lego', 'ldraw', 'rebrickable', 'bricklink'] as const;
type Obj = Record<string, unknown>;

export class FoundationInventoryError extends Error {
  readonly code = 'INVALID_FOUNDATION_INVENTORY';
  constructor(message: string) { super(message); this.name = 'FoundationInventoryError'; }
}
function fail(message: string): never { throw new FoundationInventoryError(message); }
export function record(value: unknown, label: string): Obj {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  return value as Obj;
}
function text(value: unknown, label: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001F\u007F]/.test(value)) fail(`${label} is invalid`);
  return value.trim();
}
function id(value: unknown, label: string): string {
  const result = text(value, label, 100);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(result)) fail(`${label} is invalid`);
  return result;
}
function nullableId(value: unknown, label: string): string | null { return value === null || value === undefined ? null : id(value, label); }
function numericId(value: unknown, label: string): string | null {
  const result = nullableId(value, label);
  if (result !== null && !/^[1-9]\d{0,11}$/.test(result)) fail(`${label} must be a LEGO numeric identifier`);
  return result;
}
export function canonicalSetNumber(value: unknown): string {
  const result = text(value, 'setNumber', 20);
  if (!/^[1-9]\d{3,6}(?:-[1-9]\d{0,2})?$/.test(result)) fail('setNumber is invalid');
  return result.includes('-') ? result : `${result}-1`;
}
function positive(value: unknown, label: string, max = MAX_QUANTITY): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > max) fail(`${label} must be a positive bounded integer`);
  return Number(value);
}
function bool(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') fail(`${label} must be a boolean`);
  return value;
}
function url(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const result = text(value, 'sourceUrl', 2000);
  let parsed: URL;
  try { parsed = new URL(result); } catch { return fail('sourceUrl must be an HTTPS URL'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash || [...parsed.searchParams.keys()].some(key => /key|token|secret|auth|password/i.test(key))) fail('sourceUrl must be a credential-free HTTPS URL');
  return parsed.href;
}
export function sourceHash(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-fA-F0-9]{64}$/.test(value)) fail('source SHA-256 is required');
  return value.toLowerCase();
}
function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(value) || !Number.isFinite(Date.parse(value))) fail('importedAt must be an ISO timestamp');
  return new Date(value).toISOString();
}
export function parseEvidence(value: unknown, sourceId: string): InventoryEvidence {
  const input = record(value, 'evidence');
  const result: InventoryEvidence = { sourceId: id(input.sourceId ?? input.documentId ?? sourceId, 'evidence sourceId') };
  if (result.sourceId !== sourceId) fail('evidence must refer to the inventory source');
  if (input.page !== undefined || input.pdfPage !== undefined) result.page = positive(input.page ?? input.pdfPage, 'evidence page', 100_000);
  if (input.row !== undefined) result.row = positive(input.row, 'evidence row', MAX_ROWS + 1);
  for (const field of ['bbox', 'quantityBbox', 'elementIdBbox'] as const) {
    const box = input[field];
    if (box !== undefined) {
      if (!Array.isArray(box) || box.length !== 4 || box.some(n => typeof n !== 'number' || !Number.isFinite(n) || n < 0) || box[0] >= box[2] || box[1] >= box[3]) fail(`evidence ${field} is invalid`);
      result[field] = [...box] as InventoryEvidence['bbox'];
    }
  }
  // PDF text can contain newline; retain it as evidence, never as an identifier.
  if (input.rawText !== undefined) {
    if (typeof input.rawText !== 'string' || input.rawText.length > 4000 || /[\u0000]/.test(input.rawText)) fail('evidence rawText is invalid');
    result.rawText = input.rawText;
  }
  if (input.method !== undefined) result.method = text(input.method, 'evidence method', 100);
  if (input.reviewStatus !== undefined) result.reviewStatus = text(input.reviewStatus, 'evidence reviewStatus', 100);
  return result;
}
function parseItem(value: unknown, sourceId: string): FoundationInventoryItem {
  const input = record(value, 'inventory item');
  const partId = nullableId(input.partId, 'partId');
  const partIdSystem = input.partIdSystem === null || input.partIdSystem === undefined ? null : text(input.partIdSystem, 'partIdSystem');
  if ((partId === null) !== (partIdSystem === null) || (partIdSystem !== null && !(PART_SYSTEMS as readonly string[]).includes(partIdSystem))) fail('partId requires an explicit supported partIdSystem');
  const designId = numericId(input.designId, 'designId');
  const elementId = numericId(input.elementId, 'elementId');
  if (!partId && !designId && !elementId) fail('inventory item needs an explicit part, design or element identity');
  let color: FoundationInventoryItem['color'] = null;
  if (input.color !== null && input.color !== undefined) {
    const raw = record(input.color, 'color');
    const system = text(raw.system, 'color system');
    if (!(COLOR_SYSTEMS as readonly string[]).includes(system)) fail('color requires an explicit supported ID system');
    color = { system: system as ColorIdSystem, id: id(raw.id, 'color id') };
    if (raw.name !== undefined) color.name = text(raw.name, 'color name', 200);
  }
  const isSpare = input.isSpare === null || input.isSpare === undefined ? null : bool(input.isSpare, 'isSpare');
  if (!Array.isArray(input.evidence) || !input.evidence.length || input.evidence.length > 20) fail('item source evidence is required');
  return {
    partId, partIdSystem: partIdSystem as PartIdSystem | null, designId, elementId, color,
    quantity: positive(input.quantity, 'quantity'), isSpare,
    category: input.category === null || input.category === undefined ? null : text(input.category, 'category', 100),
    evidence: input.evidence.map(item => parseEvidence(item, sourceId)),
  };
}

/** Validate a trusted server snapshot. Use the local import functions for untrusted uploads. */
export function parseFoundationInventory(value: unknown): FoundationInventory {
  const input = record(value, 'inventory');
  if (input.schemaVersion !== 1) fail('inventory schemaVersion must be 1');
  const provenance = record(input.provenance, 'provenance');
  const sourceId = id(provenance.sourceId, 'sourceId');
  const kind = text(provenance.kind, 'source kind');
  if (!['local-json', 'local-csv', 'official-pdf', 'rebrickable'].includes(kind)) fail('source kind is unsupported');
  const trust = text(provenance.trust, 'source trust');
  if (!['user-reported', 'source-observed', 'verified-export', 'verified-upstream'].includes(trust)) fail('source trust is unsupported');
  if (!Array.isArray(input.items) || input.items.length > MAX_ROWS) fail('inventory items exceed the row limit or are missing');
  const items = input.items.map(item => parseItem(item, sourceId));
  const details: Pick<FoundationInventory['provenance'], 'fileName' | 'officialOriginIndependentlyVerified'> = {};
  if (provenance.fileName !== undefined) {
    const fileName = text(provenance.fileName, 'source fileName', 200);
    if (/[\\/]/.test(fileName)) fail('source fileName must not be a path');
    details.fileName = fileName;
  }
  if (provenance.officialOriginIndependentlyVerified !== undefined) details.officialOriginIndependentlyVerified = bool(provenance.officialOriginIndependentlyVerified, 'officialOriginIndependentlyVerified');
  if (items.reduce((sum, item) => sum + item.quantity, 0) > 1_000_000) fail('inventory total exceeds the quantity limit');
  return {
    schemaVersion: 1, id: id(input.id, 'inventory id'), setNumber: canonicalSetNumber(input.setNumber),
    inventoryComplete: bool(input.inventoryComplete, 'inventoryComplete'),
    provenance: { kind: kind as FoundationInventory['provenance']['kind'], sourceId, sourceUrl: url(provenance.sourceUrl), sha256: sourceHash(provenance.sha256), importedAt: timestamp(provenance.importedAt), trust: trust as FoundationInventory['provenance']['trust'], ...details },
    items,
  };
}

function checkTextSize(input: string): void {
  if (typeof input !== 'string' || Buffer.byteLength(input, 'utf8') > MAX_BYTES) fail('inventory input exceeds the 8 MiB limit');
}
function hash(input: string): string { return createHash('sha256').update(input).digest('hex'); }

/** A user-supplied trust label or SHA never upgrades a local upload to verified. */
export function importFoundationInventoryJson(input: string): FoundationInventory {
  checkTextSize(input);
  let value: unknown;
  try { value = JSON.parse(input); } catch { return fail('inventory JSON is invalid'); }
  const raw = record(value, 'inventory');
  const source = record(raw.provenance, 'provenance');
  return parseFoundationInventory({ ...raw, provenance: { ...source, kind: 'local-json', trust: 'user-reported', officialOriginIndependentlyVerified: false, sha256: hash(input), importedAt: new Date().toISOString() } });
}

/** RFC 4180-style CSV parser: quoted commas, quotes and newlines are retained. */
export function parseInventoryCsv(input: string): string[][] {
  checkTextSize(input);
  const data = input.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false, afterQuote = false;
  for (let i = 0; i < data.length; i++) {
    const char = data[i];
    if (quoted) {
      if (char === '"') {
        if (data[i + 1] === '"') { field += '"'; i++; } else { quoted = false; afterQuote = true; }
      } else field += char;
      continue;
    }
    if (char === '"') {
      if (field || afterQuote) fail('CSV quote occurs inside an unquoted field');
      quoted = true;
    } else if (char === ',') { row.push(field); field = ''; afterQuote = false; }
    else if (char === '\r' || char === '\n') {
      if (char === '\r' && data[i + 1] === '\n') i++;
      row.push(field);
      if (row.some(cell => cell.length > 0)) rows.push(row);
      if (rows.length > MAX_ROWS + 1) fail('CSV row limit exceeded');
      row = []; field = ''; afterQuote = false;
    } else {
      if (afterQuote) fail('CSV contains data after a closing quote');
      field += char;
    }
  }
  if (quoted) fail('CSV has an unterminated quoted field');
  if (field || row.length || afterQuote) { row.push(field); if (row.some(cell => cell.length > 0)) rows.push(row); }
  if (rows.length > MAX_ROWS + 1) fail('CSV row limit exceeded');
  return rows;
}

export function importFoundationInventoryCsv(input: string, options: LocalInventoryOptions): FoundationInventory {
  const rows = parseInventoryCsv(input);
  const headers = rows.shift();
  if (!headers || !headers.length || new Set(headers).size !== headers.length) fail('CSV header is missing or duplicated');
  const accepted = new Set(['partId', 'partIdSystem', 'designId', 'elementId', 'colorSystem', 'colorId', 'colorName', 'quantity', 'isSpare', 'category', 'sourcePage']);
  if (headers.some(header => !accepted.has(header)) || !headers.includes('quantity') || !headers.some(header => ['partId', 'designId', 'elementId'].includes(header))) fail('CSV requires explicit identity and quantity columns; unknown columns are rejected');
  const items = rows.map((row, index) => {
    if (row.length !== headers.length) fail(`CSV row ${index + 2} has the wrong field count`);
    const cells = Object.fromEntries(headers.map((header, i) => [header, row[i].trim()]));
    const empty = (value: string | undefined): string | null => value ? value : null;
    if (!/^\d+$/.test(cells.quantity)) fail(`CSV row ${index + 2} quantity is invalid`);
    if (cells.isSpare && !['true', 'false', 'unknown'].includes(cells.isSpare)) fail(`CSV row ${index + 2} spare flag is invalid`);
    if ((Boolean(cells.colorSystem) !== Boolean(cells.colorId)) || (cells.colorName && !cells.colorId)) fail(`CSV row ${index + 2} color requires a system and ID`);
    if (cells.sourcePage && !/^[1-9]\d*$/.test(cells.sourcePage)) fail(`CSV row ${index + 2} sourcePage is invalid`);
    return {
      partId: empty(cells.partId), partIdSystem: empty(cells.partIdSystem), designId: empty(cells.designId), elementId: empty(cells.elementId),
      color: cells.colorId ? { system: cells.colorSystem, id: cells.colorId, ...(cells.colorName ? { name: cells.colorName } : {}) } : null,
      quantity: Number(cells.quantity), isSpare: cells.isSpare === 'true' ? true : cells.isSpare === 'false' ? false : null, category: empty(cells.category),
      evidence: [{ sourceId: options.sourceId, row: index + 2, ...(cells.sourcePage ? { page: Number(cells.sourcePage) } : {}), method: 'local-csv-explicit-columns' }],
    };
  });
  return parseFoundationInventory({
    schemaVersion: 1, id: options.id, setNumber: options.setNumber, inventoryComplete: options.inventoryComplete ?? false,
    provenance: { kind: 'local-csv', sourceId: options.sourceId, sourceUrl: options.sourceUrl ?? null, sha256: hash(input), importedAt: options.importedAt ?? new Date().toISOString(), trust: 'user-reported' }, items,
  });
}
