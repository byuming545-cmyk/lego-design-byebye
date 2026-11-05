import { composeTransforms, inverseTransform, isRigidTransform } from '../assembly/math.js';
import type { ModuleMember, ModuleRecipe } from './catalog.js';

/** A reviewed extraction is a set of literal type-1 records, not the entire
 * parent model. Unselected records remain in the pinned original source but
 * are neither dependencies nor placements of this module. No nested expansion,
 * transform approximation or identity inference is performed here. */
export function readSelectedModuleMembers(text: string, recipe: ModuleRecipe): ModuleMember[] {
  const ordinals = recipe.selectedOrdinals;
  if (!Array.isArray(ordinals) || ordinals.length < 2 || ordinals.length > 24 || new Set(ordinals).size !== ordinals.length ||
      ordinals.some(i => !Number.isSafeInteger(i) || i < 0) || !ordinals.includes(recipe.entryOrdinal) ||
      recipe.exteriorOrdinals.some(i => !ordinals.includes(i)) || Object.keys(recipe.replacements).some(i => !ordinals.includes(Number(i)))) throw new Error('Invalid module selection.');
  const records = text.split(/\r?\n/).filter(line => /^1\s/.test(line));
  const selected = ordinals.map(ordinal => {
    const tokens = records[ordinal]?.trim().split(/\s+/);
    if (!tokens || tokens.length !== 15 || !/^[a-z0-9_-]+\.dat$/i.test(tokens[14])) throw new Error(`Unsupported or missing selected native source placement: ${ordinal}`);
    const transform = { translation: tokens.slice(2, 5).map(Number), rotation: tokens.slice(5, 14).map(Number) };
    const replacement = recipe.replacements[String(ordinal)];
    if (!isRigidTransform(transform) || replacement !== undefined && !/^[a-z0-9_-]+$/i.test(replacement)) throw new Error(`Non-rigid or invalid selected source placement: ${ordinal}`);
    return { ordinal, partId: tokens[14].slice(0, -4).toLowerCase(), sourceColor: tokens[1], transform };
  });
  const entry = selected.find(row => row.ordinal === recipe.entryOrdinal)!;
  const inverse = inverseTransform(entry.transform);
  return selected.map(row => ({ localId: `source-${row.ordinal}`, ordinal: row.ordinal, sourcePartId: row.partId, sourceColor: row.sourceColor,
    partId: recipe.replacements[String(row.ordinal)] ?? row.partId, transform: composeTransforms(inverse, row.transform),
    collisionClass: recipe.exteriorOrdinals.includes(row.ordinal) ? 'exterior-shell' as const : 'structural' as const,
  })).sort((a, b) => Number(b.ordinal === recipe.entryOrdinal) - Number(a.ordinal === recipe.entryOrdinal) || a.ordinal - b.ordinal);
}
