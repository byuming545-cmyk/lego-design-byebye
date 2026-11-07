import type { BodyPreview } from "./body-preview.js";
import type { Job } from "./types.js";
import type { AssemblyAsset } from "../components/NativeAssemblyViewer.js";
import { isRigidTransform } from "../parts/assembly/math.js";
const canonical = (value: unknown) => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
async function sha(value: unknown) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(value)));
  return [...new Uint8Array(bytes)].map(v => v.toString(16).padStart(2, "0")).join("");
}
/** Offline integrity is deliberately weaker than current native-engine replay.
 * It never promotes a stored draft to a formally validated assembly. */
export async function verifySavedExample(value: unknown) {
  const v = value as { scope: string; preview: { model: BodyPreview; assets: Record<string, AssemblyAsset>; designColors: Record<string, string> }; job: Job };
  if (v?.scope !== "saved-example-not-new-generation" || !v.preview?.model || !v.job) throw Error("EXAMPLE_BINDING");
  const m = v.preview.model, { contentSha256, ...content } = m;
  if (m.state !== "APPEARANCE_DRAFT" || m.checks.formalConnections !== "NOT_VERIFIED" || m.checks.physicalBuildVerified !== false || m.steps.status !== "DRAFT_NOT_BUILD_INSTRUCTIONS" || await sha(content) !== contentSha256 || (v.job.preview as BodyPreview)?.contentSha256 !== contentSha256 || canonical(v.job.input) !== canonical(m.input)) throw Error("EXAMPLE_INTEGRITY");
  for (const source of m.sources) {
    const asset = v.preview.assets[source.partId];
    if (!asset?.mesh || await sha(asset.mesh) !== source.meshSha256) throw Error("EXAMPLE_MESH_INTEGRITY");
  }
  if (m.placements.some(p => !m.sources.some(s => s.partId === p.partId) || !isRigidTransform(p.transform)) || m.bom.reduce((s, b) => s + b.quantity, 0) !== m.placements.length || new Set(m.placements.map(p=>p.instanceId)).size !== m.placements.length) throw Error("EXAMPLE_BOM_INTEGRITY");
  return v;
}
