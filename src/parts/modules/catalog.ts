import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { composeTransforms, inverseTransform, isRigidTransform } from '../assembly/math.js';
import type { CollisionClass, RigidTransform } from '../assembly/types.js';
import { modulePolicy } from './policy.js';
import type { ModuleComposition } from './assembly.js';
import type { NativeAssembly } from '../assembly/types.js';
import { moduleSupport } from './support.js';

export const MODULE_LIBRARY_DIGEST = '030b7bf93dc10733d2799b8daeb000c2b1c7be4e17917426f6ab21c84d73e2b7';
export const MODULE_DIRECTORY = fileURLToPath(new URL('../../../data/parts-foundation/modules/', import.meta.url));
export const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export interface ModuleSource {
  kind: string; setNumber: string; author: string; license: string; repository: string; revision: string;
  upstreamPath: string; sourceUrl: string; originalSha256: string; note: string; file: string; sha256: string; section: string;
}
export interface ModuleRecipe {
  id: string; version: string; name: string; role: string; source: ModuleSource;
  selectedOrdinals: number[]; entryOrdinal: number; replacements: Record<string, string>; exteriorOrdinals: number[]; adaptation: string;
}
export interface ModuleMember {
  localId: string; ordinal: number; sourcePartId: string; sourceColor: string; partId: string;
  transform: RigidTransform; collisionClass: CollisionClass;
}
export interface ModuleDefinition { recipe: ModuleRecipe; recipeDigest: string; members: ModuleMember[]; }

/** A reviewed local catalogue, never a client-supplied module or URL whitelist.
 * Re-reading the small pinned files makes cached/old declarations fail closed. */
export class ModuleCatalog {
  constructor(readonly directory = MODULE_DIRECTORY) {}
  list(): ModuleRecipe[] {
    const bytes = readFileSync(path.join(this.directory, 'library.json'));
    if (digest(bytes) !== MODULE_LIBRARY_DIGEST) throw new Error('MODULE_SOURCE_CHANGED: reviewed module catalogue changed; review and restart are required.');
    const value = JSON.parse(bytes.toString('utf8'));
    if (value.schema !== 'native-module-library-1' || !Array.isArray(value.modules)) throw new Error('Unsupported module catalogue.');
    return value.modules;
  }
  get(id: string): ModuleDefinition {
    const recipe = this.list().find(recipe => recipe.id === id);
    if (!recipe) throw new Error(`Unknown reviewed module: ${id}`);
    const raw = readFileSync(path.join(this.directory, recipe.source.file));
    if (digest(raw) !== recipe.source.sha256) throw new Error('MODULE_SOURCE_CHANGED: source section hash differs.');
    const text = raw.toString('utf8');
    if (!text.startsWith(`0 FILE ${recipe.source.section}\r\n`) && !text.startsWith(`0 FILE ${recipe.source.section}\n`)) throw new Error('Module source section identity differs.');
    if (!text.includes(`0 Author: ${recipe.source.author}`) || !text.includes('0 !LICENSE Redistributable under CCAL version 2.0 : see CAreadme.txt')) throw new Error('Module author or licence evidence missing.');
    const rows = text.split(/\r?\n/).filter(line => line.startsWith('1 ')).map(line => {
      const t = line.trim().split(/\s+/);
      const transform = { translation: t.slice(2, 5).map(Number), rotation: t.slice(5, 14).map(Number) };
      if (!/^[a-z0-9_-]+\.dat$/i.test(t[14] ?? '') || t.length !== 15 || !isRigidTransform(transform)) throw new Error('Unsupported, nested or non-rigid module source placement.');
      return { partId: t[14].slice(0, -4).toLowerCase(), sourceColor: t[1], transform };
    });
    const entry = rows[recipe.entryOrdinal];
    if (!entry || !recipe.selectedOrdinals.includes(recipe.entryOrdinal) || recipe.selectedOrdinals.length < 2 || recipe.selectedOrdinals.length > 24 || new Set(recipe.selectedOrdinals).size !== recipe.selectedOrdinals.length) throw new Error('Invalid module selection.');
    const inverse = inverseTransform(entry.transform);
    const members = recipe.selectedOrdinals.map(ordinal => {
      const row = rows[ordinal];
      if (!row) throw new Error('Module references a missing source placement.');
      return { localId: `source-${ordinal}`, ordinal, sourcePartId: row.partId, sourceColor: row.sourceColor,
        partId: recipe.replacements[String(ordinal)] ?? row.partId, transform: composeTransforms(inverse, row.transform),
        collisionClass: recipe.exteriorOrdinals.includes(ordinal) ? 'exterior-shell' as const : 'structural' as const };
    });
    // Internal order starts at the reviewed canonical entry; no source coordinates are guessed.
    members.sort((a, b) => Number(b.ordinal === recipe.entryOrdinal) - Number(a.ordinal === recipe.entryOrdinal) || a.ordinal - b.ordinal);
    return { recipe, recipeDigest: digest(JSON.stringify(recipe)), members };
  }
}

/** Synchronous source/provenance gate shared by export and full reimport.
 * Part eligibility, graph edges and collisions are checked separately by the engine. */
export function checkModuleEnvelope(model: NativeAssembly & { module?: string; moduleComposition?: ModuleComposition }, catalog = new ModuleCatalog()): ModuleComposition | undefined {
  const composition = model.moduleComposition;
  if (!composition) { if (model.module === 'module-assembly') throw new Error('Module provenance is missing.'); return undefined; }
  if (composition.schema !== 'native-module-composition-1' || composition.libraryDigest !== MODULE_LIBRARY_DIGEST || JSON.stringify(composition.policy) !== JSON.stringify(modulePolicy()) || !Array.isArray(composition.instances) || composition.instances.length < 1 || composition.instances.length > 3) throw new Error('Module source/validation versions are missing, unsupported or stale.');
  const used = new Set<string>(), instanceIds = new Set<string>();
  const instances: ModuleComposition['instances'] = [];
  for (const instance of composition.instances) {
    const definition = catalog.get(instance.moduleId), recipe = definition.recipe;
    if (!instance.id || instanceIds.has(instance.id) || instance.version !== recipe.version || instance.recipeDigest !== definition.recipeDigest || JSON.stringify(instance.source) !== JSON.stringify(recipe.source) || instance.adaptation !== recipe.adaptation || !isRigidTransform(instance.transform) || !Array.isArray(instance.members) || instance.members.length !== definition.members.length) throw new Error('Module identity, source, recipe, pose or member count differs.');
    instanceIds.add(instance.id);
    const ids = new Set<string>();
    for (const member of definition.members) {
      const matches = instance.members.filter(m => m.localId === member.localId), record = matches[0];
      const placement = record && model.placements.find(p => p.instanceId === record.instanceId);
      const expected = composeTransforms(instance.transform, member.transform);
      if (matches.length !== 1 || !placement || used.has(record.instanceId) || record.sourcePartId !== member.sourcePartId || record.actualPartId !== member.partId || record.sourceColor !== member.sourceColor || placement.partId !== member.partId || (placement.collisionClass ?? 'structural') !== member.collisionClass || !isRigidTransform(placement.transform) || !placement.transform.rotation.every((v, i) => Math.abs(v - expected.rotation[i]) <= 1e-6) || !placement.transform.translation.every((v, i) => Math.abs(v - expected.translation[i]) <= 1e-5)) throw new Error('Module member identity, unique instance, contract or rigid closure differs.');
      used.add(record.instanceId); ids.add(record.instanceId);
    }
    if (!model.edges.some(e => ids.has(e.fixedInstanceId) !== ids.has(e.movingInstanceId))) throw new Error('Module has no installation connection to the rest of the model.');
    instances.push({ id: instance.id, moduleId: recipe.id, version: recipe.version, recipeDigest: definition.recipeDigest,
      source: structuredClone(recipe.source), adaptation: recipe.adaptation, transform: structuredClone(instance.transform),
      installationSupport: moduleSupport(model, ids),
      members: definition.members.map(member => ({ localId: member.localId,
        instanceId: instance.members.find(m => m.localId === member.localId)!.instanceId,
        sourcePartId: member.sourcePartId, actualPartId: member.partId, sourceColor: member.sourceColor })) });
  }
  return { schema: 'native-module-composition-1', libraryDigest: MODULE_LIBRARY_DIGEST, policy: modulePolicy(), instances };
}
