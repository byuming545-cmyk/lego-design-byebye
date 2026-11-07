import type { BodyPreview, BodyPlacement } from "./body-preview.js";
import { MINI_COLORS, type MiniColor } from "../mini-cars/types.js";

export const DESIGN_SCHEMA = "bricklab-vehicle-colour-draft-1";
export const PAINT_VERSION = "functional-role-paint-1";
/** Existing six colours keep their project appearance. The two extra identities
 * and RGB values are read from the pinned library's actual LDConfig.ldr. */
export const PAINT_PALETTE = {
  white: { ...MINI_COLORS.white, label: "白色" },
  red: { ...MINI_COLORS.red, label: "赛车红" },
  orange: { ldraw: 25, label: "橙色", hex: "#D67923" },
  blue: { ...MINI_COLORS.blue, label: "竞速蓝" },
  darkgreen: { ldraw: 288, label: "深绿", hex: "#00451A" },
  yellow: { ...MINI_COLORS.yellow, label: "明黄" },
  black: MINI_COLORS.black,
  graphite: { ...MINI_COLORS.graphite, label: "石墨灰" },
} as const;
export const PALETTE_REFERENCE = {
  url: "https://raw.githubusercontent.com/pybricks/ldraw/c43ed06a128a10ed65675166bf42eb6fd608b9b0/LDConfig.ldr",
  sha256: "56689f411f9cd49da8fc13a1e1892f77a7cdd6ee28225b46acb43cb078ea6599",
  orange: "0 !COLOUR Orange CODE 25 VALUE #D67923 EDGE #333333",
  darkgreen: "0 !COLOUR Dark_Green CODE 288 VALUE #00451A EDGE #808080",
  scope: "colour identities only; part-colour availability and inventory NOT_VERIFIED",
} as const;
export type PaintColor = keyof typeof PAINT_PALETTE;
export type PaintChannel = "body" | "roof" | "accent" | "arches";
export type PaintOptions = Record<PaintChannel, PaintColor | null>;
export const PAINT_CHANNELS: { id: PaintChannel; label: string }[] = [
  { id: "body", label: "车身" }, { id: "roof", label: "车顶" },
  { id: "accent", label: "饰条与保险杠" }, { id: "arches", label: "轮拱覆盖件" },
];
export const PAINT_PRESETS: { id: string; label: string; options: PaintOptions }[] = [
  { id: "orange-hardtop", label: "橙身黑顶", options: { body: "orange", roof: "black", accent: "graphite", arches: null } },
  { id: "black-grey", label: "黑身灰饰", options: { body: "black", roof: "black", accent: "graphite", arches: null } },
  { id: "red-black", label: "红身黑饰", options: { body: "red", roof: "red", accent: "black", arches: null } },
  { id: "white-black-arches", label: "白身黑轮拱", options: { body: "white", roof: "white", accent: "black", arches: "black" } },
];
export function parsePaintOptions(value?: unknown): PaintOptions {
  if (value === undefined) return { body: null, roof: null, accent: null, arches: null };
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("DESIGN_OPTIONS_INVALID");
  const v = value as Record<string, unknown>, keys = PAINT_CHANNELS.map(c => c.id);
  if (Object.keys(v).length !== 4 || Object.keys(v).some(k => !keys.includes(k as PaintChannel)) || keys.some(k => v[k] !== null && (typeof v[k] !== "string" || !Object.hasOwn(PAINT_PALETTE, v[k] as string)))) throw Error("DESIGN_OPTIONS_INVALID");
  return Object.fromEntries(keys.map(k => [k, v[k]])) as PaintOptions;
}
/** Classify the immutable source model, never its subsequently chosen colour.
 * Mixed glass/frame roles use their outer lateral frame and original white
 * frame tag only within that role; lamps and all black glazing stay protected. */
export function paintChannel(base: BodyPreview, p: BodyPlacement): PaintChannel | null {
  if (p.role === "roof") return "roof";
  if (p.role === "wheel-arch") return "arches";
  if (["hood", "tail", "side", "shoulder", "belt", "front-apron"].includes(p.role)) return "body";
  if (["front-bumper", "rear-bumper", "side-skirt", "grille-divider"].includes(p.role)) return "accent";
  if (p.role === "window-pillar") return p.color === "white" ? "body" : null;
  if (["windshield", "rear-window"].includes(p.role) && p.color === "white") {
    const outer = Math.max(...base.placements.filter(q => q.role === p.role).map(q => Math.abs(q.transform.translation[0])));
    if (Math.abs(Math.abs(p.transform.translation[0]) - outer) < 1e-8) return "body";
  }
  return null;
}
export type PaintedPlacement = Omit<BodyPlacement, "color"> & { color: PaintColor };
export type PaintBomRow = Omit<BodyPreview["bom"][number], "color"> & { color: PaintColor };
export function paintAppearance(base: BodyPreview, input?: unknown) {
  const options = parsePaintOptions(input);
  const assignments = base.placements.map(p => {
    const channel = paintChannel(base, p), chosen = channel === "arches" ? options.arches ?? options.body : channel ? options[channel] : null;
    return { instanceId: p.instanceId, channel, originalDesignColor: p.color, designColor: chosen ?? p.color, originalSourceColor: p.craft?.sourceColor ?? null };
  });
  const placements: PaintedPlacement[] = base.placements.map((p, i) => ({ ...p, color: assignments[i].designColor }));
  const rows = new Map<string, PaintBomRow>();
  for (const p of placements) {
    const key = p.partId + ":" + p.color, old = rows.get(key);
    if (old) old.quantity++;
    else rows.set(key, { partId: p.partId, name: base.sources.find(s => s.partId === p.partId)!.name, color: p.color, ldrawColor: PAINT_PALETTE[p.color].ldraw, quantity: 1, colorAvailability: "NOT_VERIFIED" });
  }
  return { options, placements, assignments, bom: [...rows.values()].sort((a, b) => a.partId.localeCompare(b.partId) || a.color.localeCompare(b.color)),
    designColors: Object.fromEntries(placements.map(p => [p.instanceId, PAINT_PALETTE[p.color].hex])) };
}
export const canonicalJson = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
export async function designDigest(value: unknown) {
  const data = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(value)));
  return [...new Uint8Array(data)].map(v => v.toString(16).padStart(2, "0")).join("");
}
export async function createDesignDraft(base: BodyPreview, input?: unknown) {
  const { contentSha256, ...raw } = base;
  if (base.schema !== "bricklab-vehicle-envelope-appearance-4" || base.state !== "APPEARANCE_DRAFT" || base.checks.formalConnections !== "NOT_VERIFIED" || base.checks.physicalBuildVerified !== false || base.steps.status !== "DRAFT_NOT_BUILD_INSTRUCTIONS" || await designDigest(raw) !== contentSha256) throw Error("DESIGN_BASE_INTEGRITY");
  const painted = paintAppearance(base, input);
  const content = { schema: DESIGN_SCHEMA, paintVersion: PAINT_VERSION, palette: PALETTE_REFERENCE,
    scope: "COLOUR_ONLY_DERIVATIVE_NOT_ASSEMBLY" as const,
    parentContentSha256: base.contentSha256, base: structuredClone(base), designOptions: painted.options,
    placements: painted.placements, bom: painted.bom, assignments: painted.assignments,
    steps: base.steps, checks: base.checks, sourceSnapshot: base.sourceSnapshot,
    colourAvailability: "NOT_VERIFIED" as const };
  const withId = { ...content, id: "vehicle-design-" + (await designDigest(content)).slice(0, 24) };
  return { ...withId, contentSha256: await designDigest(withId) };
}
export type DesignDraft = Awaited<ReturnType<typeof createDesignDraft>>;
export async function validateDesignDraft(value: unknown, base: BodyPreview): Promise<DesignDraft> {
  const v = value as DesignDraft;
  if (!v || v.schema !== DESIGN_SCHEMA || v.paintVersion !== PAINT_VERSION || v.parentContentSha256 !== base.contentSha256) throw Error("DESIGN_SCHEMA_OR_PARENT");
  const expected = await createDesignDraft(base, v.designOptions);
  if (canonicalJson(value) !== canonicalJson(expected)) throw Error("DESIGN_CONTENT_OR_GEOMETRY_CHANGED");
  return expected;
}
export function paintBomCsv(rows: PaintBomRow[]) {
  return "part_id,name,design_colour,ldraw_colour,quantity,colour_availability\r\n" + rows.map(b => [b.partId, b.name, PAINT_PALETTE[b.color].label, b.ldrawColor, b.quantity, b.colorAvailability].map(v => '"' + String(v).replaceAll('"', '""') + '"').join(",")).join("\r\n");
}
