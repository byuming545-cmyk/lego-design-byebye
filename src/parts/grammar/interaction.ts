import type { Vector3 } from '../assembly/types.js';
import type { ConnectorProvenance } from './schema.js';

/** Transmission/contact is not an attachment and never occupies a Connector. */
export const MECHANICAL_INTERACTION_KINDS = ['GEAR_MESH', 'RACK_AND_PINION', 'CHAIN_SPROCKET', 'BELT_PULLEY', 'CAM_CONTACT', 'TYRE_GROUND_CONTACT'] as const;
export type MechanicalInteractionKind = typeof MECHANICAL_INTERACTION_KINDS[number];

export interface MechanicalInteraction {
  interactionId: string;
  kind: MechanicalInteractionKind;
  participants: [string, string];
  axisA: Vector3 | null;
  axisB: Vector3 | null;
  /** Missing values remain null. A ratio alone is not a mesh/fit certificate. */
  circularPitchLdu: number | null;
  toothCounts: [number, number] | null;
  gearFamily: string | null;
  centreDistanceLdu: number | null;
  rotationRatio: { numerator: number; denominator: number } | null;
  engagement: 'EXTERNAL' | 'INTERNAL' | 'UNKNOWN';
  contactEnvelope: { sourceIds: string[]; description: string } | null;
  sources: ConnectorProvenance[];
  diagnostics: string[];
}

export interface MechanicalInteractionGraph {
  schemaVersion: 1;
  interactions: MechanicalInteraction[];
  /** Deliberately separate from the structural Connector/Assembly graph. */
  scope: 'mechanical-transmission-and-contact-only';
}

export interface MechanicalInteractionAssessment {
  status: 'UNKNOWN' | 'INVALID';
  kinematicRatio: { numerator: number; denominator: number } | null;
  reasons: string[];
  createsStructuralConnection: false;
  physicalBuildVerified: false;
}

/** An algebraic consequence of supplied counts, not a new LEGO pairing rule. */
export function gearRotationRatio(teethA: number, teethB: number, engagement: 'EXTERNAL' | 'INTERNAL'): { numerator: number; denominator: number } | null {
  if (![teethA, teethB].every(count => Number.isSafeInteger(count) && count > 0)) return null;
  let a = teethA, b = teethB;
  while (b) { const next = a % b; a = b; b = next; }
  return { numerator: (engagement === 'EXTERNAL' ? -1 : 1) * teethA / a, denominator: teethB / a };
}

/** P2 source storage/algebra only. No source-backed mesh, belt or contact solver
 * is registered yet, so positive physical compatibility stays UNKNOWN. */
export function assessMechanicalInteraction(interaction: MechanicalInteraction): MechanicalInteractionAssessment {
  const base = { createsStructuralConnection: false as const, physicalBuildVerified: false as const };
  const invalid: string[] = [];
  if (!interaction.interactionId || !MECHANICAL_INTERACTION_KINDS.includes(interaction.kind)) invalid.push('Unknown interaction identity or kind.');
  if (interaction.participants.length !== 2 || interaction.participants.some(id => !id) || interaction.participants[0] === interaction.participants[1]) invalid.push('Two distinct participant instances are required.');
  if (interaction.circularPitchLdu !== null && (!Number.isFinite(interaction.circularPitchLdu) || interaction.circularPitchLdu <= 0)) invalid.push('Circular pitch must be a finite positive source value.');
  if (interaction.centreDistanceLdu !== null && (!Number.isFinite(interaction.centreDistanceLdu) || interaction.centreDistanceLdu < 0)) invalid.push('Centre distance must be a finite nonnegative source value.');
  if (interaction.toothCounts !== null && !interaction.toothCounts.every(count => Number.isSafeInteger(count) && count > 0)) invalid.push('Tooth counts must be positive exact integers.');
  if (interaction.rotationRatio !== null && (!Number.isSafeInteger(interaction.rotationRatio.numerator) || !Number.isSafeInteger(interaction.rotationRatio.denominator) || interaction.rotationRatio.denominator === 0)) invalid.push('A supplied rotation ratio must have exact integer terms and a nonzero denominator.');
  if ([interaction.axisA, interaction.axisB].some(axis => axis !== null && (axis.length !== 3 || !axis.every(Number.isFinite) || Math.hypot(...axis) === 0))) invalid.push('A supplied interaction axis must be finite and nonsingular.');
  if (invalid.length) return { ...base, status: 'INVALID', kinematicRatio: null, reasons: invalid };
  const ratio = interaction.kind === 'GEAR_MESH' && interaction.toothCounts && interaction.engagement !== 'UNKNOWN'
    ? gearRotationRatio(...interaction.toothCounts, interaction.engagement) : null;
  const reasons = ['No source-backed mechanical contact/engagement validator is registered for this interaction family.'];
  if (!interaction.sources.length) reasons.push('Mechanical source evidence is missing.');
  if (ratio) reasons.push('The supplied tooth counts determine only a kinematic ratio; axes, profile, centre distance and contact still require independent verification.');
  if (ratio && interaction.rotationRatio && BigInt(ratio.numerator) * BigInt(interaction.rotationRatio.denominator) !== BigInt(interaction.rotationRatio.numerator) * BigInt(ratio.denominator)) reasons.push('The supplied rotation ratio conflicts with the supplied tooth counts/engagement; neither is silently promoted into verified transmission evidence.');
  return { ...base, status: 'UNKNOWN', kinematicRatio: ratio, reasons };
}
