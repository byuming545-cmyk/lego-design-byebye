import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ElementMappingRecord, ElementMappingResult, ElementMappingSource, LDrawCrossReference } from './types.js';

const MAPPING_BUNDLE_ROOT = fileURLToPath(new URL('../../../data/parts-foundation/mappings/', import.meta.url));
const text = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || !value.length || value.length > 2000) throw new Error(`Invalid mapping ${name}`);
  return value;
};
const integer = (value: unknown, name: string): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`Invalid mapping ${name}`);
  return Number(value);
};
const object = (value: unknown): Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Mapping record must be an object');
  return value as Record<string, unknown>;
};
function indexed(values: unknown, key: string): Map<unknown, Record<string, unknown>> {
  if (!Array.isArray(values) || values.length > 10_000) throw new Error('Mapping table is invalid');
  const result = new Map<unknown, Record<string, unknown>>();
  for (const value of values) {
    const row = object(value);
    if (result.has(row[key])) throw new Error(`Conflicting mapping table key: ${key}`);
    result.set(row[key], row);
  }
  return result;
}

/** Normalize explicit table joins, preserving external part and LEGO design identities. */
export function parseElementMappingSnapshot(payload: unknown): ElementMappingRecord[] {
  const root = object(payload);
  if (root.schemaVersion !== 1) throw new Error('Mapping snapshot version unsupported');
  const tables = object(root.tables);
  const elements = indexed(tables.elements, 'element_id');
  const parts = indexed(tables.parts, 'part_num');
  const colors = indexed(tables.colors, 'id');
  const categories = indexed(tables.part_categories, 'id');
  const records: ElementMappingRecord[] = [];
  for (const row of elements.values()) {
    const elementId = String(integer(row.element_id, 'element_id'));
    const partId = text(row.part_num, 'part_num');
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(partId)) throw new Error('Invalid external part identifier');
    const colorId = integer(row.color_id, 'color_id');
    const designId = row.design_id === null ? null : String(integer(row.design_id, 'design_id'));
    const part = parts.get(partId), color = colors.get(colorId);
    if (!part || !color) throw new Error('Mapping table foreign key is missing');
    const category = categories.get(part.part_cat_id);
    if (!category) throw new Error('Mapping category foreign key is missing');
    const rgb = text(color.rgb, 'color.rgb');
    if (!/^[A-Fa-f0-9]{6}$/.test(rgb)) throw new Error('Invalid source color RGB');
    records.push({
      elementId, partId, designId,
      color: { system: 'rebrickable', id: String(colorId), name: text(color.name, 'color.name'), rgb: rgb.toUpperCase() },
      partName: text(part.name, 'part.name'), category: text(category.name, 'category.name'), material: text(part.part_material, 'part.material'),
      rawElementRow: { element_id: Number(elementId), part_num: partId, color_id: colorId, design_id: designId === null ? null : Number(designId) },
    });
  }
  return records;
}

/** Mapping evidence never certifies geometry, assembly, colours in the PDF, or spare flags. */
export class ElementDesignMapper {
  private readonly records = new Map<string, ElementMappingRecord[]>();
  private readonly crossReferences = new Map<string, LDrawCrossReference[]>();
  readonly source: ElementMappingSource;
  constructor(records: readonly ElementMappingRecord[], source: ElementMappingSource, crossReferences: readonly LDrawCrossReference[] = []) {
    if (!/^[a-f0-9]{64}$/.test(source.sha256) || !/^[a-f0-9]{40}$/.test(source.revision) || !['source-observed', 'user-reported'].includes(source.trust)) throw new Error('Mapping source integrity metadata is invalid');
    this.source = structuredClone({ ...source, independentlyVerifiedOfficial: false });
    for (const record of records) this.records.set(record.elementId, [...(this.records.get(record.elementId) ?? []), structuredClone(record)]);
    for (const reference of crossReferences) {
      if (!['explicit-rebrickable-keyword', 'explicit-cross-reference-table'].includes(reference.method) || !/^[a-f0-9]{64}$/.test(reference.source.sha256) || !reference.source.rawText || !reference.source.url || !reference.source.revision) throw new Error('LDraw cross-reference requires explicit source evidence');
      this.crossReferences.set(reference.partId, [...(this.crossReferences.get(reference.partId) ?? []), structuredClone(reference)]);
    }
  }
  resolve(elementId: string): ElementMappingResult {
    const base: ElementMappingResult = {
      elementId, status: 'unresolved', verificationStatus: 'unresolved', independentlyVerifiedOfficial: false,
      partId: null, partIdSystem: null, designId: null, color: null, partName: null, category: null, material: null,
      ldrawPartId: null, ldrawCrossReference: null, source: null, rawElementRow: null, reasons: [],
    };
    if (!/^\d{1,12}$/.test(elementId)) return { ...base, reasons: ['invalid-element-id'] };
    const rows = this.records.get(elementId);
    if (!rows?.length) return { ...base, reasons: ['element-not-in-reviewed-mapping-source'] };
    const distinct = new Map(rows.map(row => [JSON.stringify([row.partId, row.designId, row.color]), row]));
    if (distinct.size !== 1) return { ...base, status: 'conflict', verificationStatus: 'conflict', source: structuredClone(this.source), reasons: ['conflicting-source-element-mappings'] };
    const row = distinct.values().next().value!;
    const references = this.crossReferences.get(row.partId) ?? [];
    const targets = new Set(references.map(reference => reference.ldrawPartId));
    const crossReference = targets.size === 1 ? references[0] : null;
    return {
      ...base, ...structuredClone(row), status: 'mapped', verificationStatus: this.source.trust,
      partIdSystem: 'rebrickable', source: structuredClone(this.source),
      ldrawPartId: crossReference?.ldrawPartId ?? null, ldrawCrossReference: crossReference ? structuredClone(crossReference) : null,
      reasons: crossReference ? [] : [targets.size > 1 ? 'conflicting-ldraw-cross-references' : 'ldraw-cross-reference-not-verified'],
    };
  }
  summary() {
    const mappings = [...this.records.keys()].map(id => this.resolve(id));
    return {
      observedElements: mappings.length, mappedBySource: mappings.filter(row => row.status === 'mapped').length,
      conflicts: mappings.filter(row => row.status === 'conflict').length,
      independentlyVerifiedOfficial: 0,
      resolvedLDraw: mappings.filter(row => row.ldrawPartId !== null).length,
      sourceTrust: this.source.trust,
    };
  }
}

export async function createBundledElementDesignMapper(options: { bundleRoot?: string } = {}): Promise<ElementDesignMapper> {
  const bundleRoot = path.resolve(options.bundleRoot ?? MAPPING_BUNDLE_ROOT);
  const manifest = object(JSON.parse(await readFile(path.join(bundleRoot, 'manifest.json'), 'utf8')));
  if (manifest.schemaVersion !== 1) throw new Error('Mapping manifest version unsupported');
  const raw = object(manifest.rawSnapshot), source = object(manifest.source);
  const filePath = path.resolve(bundleRoot, text(raw.path, 'snapshot.path'));
  if (!filePath.startsWith(bundleRoot + path.sep)) throw new Error('Mapping source path escapes its bundle');
  const bytes = await readFile(filePath);
  if (bytes.length > 6 * 1024 * 1024 || bytes.length !== raw.bytes || createHash('sha256').update(bytes).digest('hex') !== raw.sha256) throw new Error('Mapping source snapshot integrity failed');
  const records = parseElementMappingSnapshot(JSON.parse(bytes.toString('utf8')));
  const references = manifest.ldrawCrossReferences;
  if (!Array.isArray(references)) throw new Error('Mapping cross-reference manifest invalid');
  return new ElementDesignMapper(records, {
    id: text(source.id, 'source.id'), url: text(source.url, 'source.url'), revision: text(source.revision, 'source.revision'),
    sha256: String(raw.sha256), trust: 'source-observed', dataLicense: text(source.dataLicense, 'source.dataLicense'), independentlyVerifiedOfficial: false,
  }, references as LDrawCrossReference[]);
}
