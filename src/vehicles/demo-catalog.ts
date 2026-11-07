import type { VehicleInput } from "./types.js";
/** These are prepared input dossiers, never precomputed geometry selectors. */
export const DEMO_CARS: { id: string; label: string; tagline: string; input: VehicleInput }[] = [
  { id: "charger", label: "Dodge Charger R/T", tagline: "1969 · 长机盖硬顶", input: { make: "Dodge", model: "Charger", year: 1969, variant: "R/T" } },
  { id: "golf", label: "Volkswagen Golf GTI Mk1", tagline: "1976 · 紧凑两厢", input: { make: "Volkswagen", model: "Golf", year: 1976, variant: "GTI Mk1" } },
];
