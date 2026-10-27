/** Reviewed source policy, not a downloader or a licence inferred from an ID label.
 * Actual import still verifies the immutable source bytes and per-file headers.
 * New upstream revisions/sources require another review, never a wider URL prefix.
 */
export const PILOT_LDRAW_REVISION = 'c43ed06a128a10ed65675166bf42eb6fd608b9b0';
export const PILOT_SHADOW_REVISION = '9b1131fb1991f8c0bfc072325e4e12f6271aba35';
export const PILOT_LDRAW_SOURCE_ROOT = `https://raw.githubusercontent.com/pybricks/ldraw/${PILOT_LDRAW_REVISION}/`;
export const PILOT_SHADOW_SOURCE_ROOT = `https://raw.githubusercontent.com/RolandMelkert/LDCadShadowLibrary/${PILOT_SHADOW_REVISION}/`;

/** Reviewed after selecting unchanged files from the checksum-verified archives.
 * A source URL and a self-declared manifest are not upstream authentication. New
 * files/revisions require a new review and new pins, never a request parameter. */
export const APPROVED_PILOT_MANIFEST_SHA256 = Object.freeze({
  ldraw: '656ba37bfcd8c7a948787aba3a49398a95bcd49658a28d11e0e1f85d2c62bd87',
  shadow: '8f26baf015751c6864e47f36c10fb194fd73965fc4889b5db758dad003ce8521',
});

export function assertReviewedPilotManifestDigests(digests: { ldraw: string; shadow: string }): void {
  if (digests.ldraw !== APPROVED_PILOT_MANIFEST_SHA256.ldraw || digests.shadow !== APPROVED_PILOT_MANIFEST_SHA256.shadow) {
    throw new Error('Pilot source manifests are not reviewed: prepare the exact pinned source closure; self-declared hashes or source URLs cannot authorize a different bundle.');
  }
}

export type DigitalSourceRole = 'geometry' | 'connections' | 'inventory' | 'identity' | 'color' | 'reference';
export interface DigitalSourcePolicy {
  id: string;
  name: string;
  roles: readonly DigitalSourceRole[];
  publicDigitalImport: boolean;
  licenseStatus: 'reviewed-per-file' | 'reviewed-CC-BY-SA-4.0' | 'permission-not-established' | 'reference-only';
  allowedOperations: readonly string[];
  forbiddenOperations: readonly string[];
  evidencePaths: readonly string[];
  access: {
    state: 'local-snapshot-available' | 'not-attempted-network-policy' | 'not-attempted-permission' | 'reference-only';
    reason: string;
  };
}

/** Availability below is the policy review observation of 2026-10-25, not a claim
 * that an upstream HTTP request succeeded. Acquisition attempts are logged separately.
 */
export const DIGITAL_SOURCE_POLICIES: readonly DigitalSourcePolicy[] = [
  {
    id: 'ldraw-pinned', name: 'LDraw Parts Library — pinned Pybricks mirror', roles: ['geometry'], publicDigitalImport: true,
    licenseStatus: 'reviewed-per-file',
    allowedOperations: ['Import unchanged source geometry and recursive dependencies under each file licence', 'Retain authors, history, attribution and the applicable licence texts'],
    forbiddenOperations: ['Assume unreviewed third-party resources share this licence', 'Replace missing or mismatched geometry with an approximate model', 'Treat import as assembly or physical-build certification'],
    evidencePaths: ['data/parts-foundation/ldraw/manifest.json', 'data/parts-foundation/ldraw/CAreadme.txt', 'data/parts-foundation/ldraw/CAlicense.txt', 'data/parts-foundation/ldraw/CAlicense4.txt'],
    access: { state: 'local-snapshot-available', reason: 'Existing pinned files and licence texts are locally readable. Official ldraw.org hosts are absent from the configured network allowlist; no official website request was attempted.' },
  },
  {
    id: 'ldcad-shadow-pinned', name: 'LDCad Shadow Library — pinned contributor repository', roles: ['connections'], publicDigitalImport: true,
    licenseStatus: 'reviewed-CC-BY-SA-4.0',
    allowedOperations: ['Import unchanged licensed Shadow source records', 'Preserve attribution and CC-BY-SA-4.0 terms for source and derived connection data'],
    forbiddenOperations: ['Apply data licence automatically to unrelated application code or third-party data', 'Invent connectors for unsupported syntax', 'Use parsed connection records as assembly qualification'],
    evidencePaths: ['data/parts-foundation/shadow/manifest.json', 'data/parts-foundation/shadow/LICENSE.md', 'data/parts-foundation/shadow/IMPORT_NOTES.md'],
    access: { state: 'local-snapshot-available', reason: 'Existing pinned Shadow source bytes and licence are locally readable; this policy review did not request upstream files.' },
  },
  {
    id: 'rebrickable-official-api', name: 'Rebrickable official API', roles: ['inventory', 'identity', 'color'], publicDigitalImport: false,
    licenseStatus: 'permission-not-established',
    allowedOperations: ['After authorisation and terms review, use the official API with the configured key and documented rate limits'],
    forbiddenOperations: ['Bypass denied access', 'Publish upstream data before its permitted use and redistribution are established', 'Use an inventory observation as geometry identity proof'],
    evidencePaths: ['src/inventory/rebrickable.ts'],
    access: { state: 'not-attempted-network-policy', reason: 'No configured API key was observed; official host is absent from the configured network allowlist. No unauthorised API request was sent.' },
  },
  {
    id: 'rebrickable-official-downloads', name: 'Rebrickable official bulk downloads', roles: ['inventory', 'identity', 'color'], publicDigitalImport: false,
    licenseStatus: 'permission-not-established',
    allowedOperations: ['Prefer official bulk tables for large data needs after checking current download and redistribution terms'],
    forbiddenOperations: ['Substitute an unreviewed mirror for an inaccessible official source and call it officially verified', 'Infer data rights from downloader code licence'],
    evidencePaths: ['data/parts-foundation/mappings/manifest.json'],
    access: { state: 'not-attempted-network-policy', reason: 'rebrickable.com and cdn.rebrickable.com are absent from the configured network allowlist. No official download request was attempted in this review.' },
  },
  {
    id: 'rebrickable-historical-mirror', name: 'Historical Rebrickable table mirror observations', roles: ['reference'], publicDigitalImport: false,
    licenseStatus: 'permission-not-established',
    allowedOperations: ['Retain existing historical source and conflict records for local review', 'Use unverified identifiers only as explicitly labelled research leads'],
    forbiddenOperations: ['Fetch or copy more unreviewed mirror data into a public deployment', 'Promote source-observed records to exact official identity', 'Treat the mirror builder MIT licence as a licence for its data'],
    evidencePaths: ['data/parts-foundation/mappings/manifest.json', 'data/parts-foundation/mappings/ldraw-mapping-review.json'],
    access: { state: 'reference-only', reason: 'Previously stored observations exist, but independent data permission and exact Element-to-LDraw mappings remain unresolved. No new mirror download is authorised by this policy.' },
  },
  {
    id: 'bricklink-web', name: 'BrickLink public webpages', roles: ['reference'], publicDigitalImport: false,
    licenseStatus: 'permission-not-established', allowedOperations: ['Record permission requirements and seek explicit authorisation outside this importer'],
    forbiddenOperations: ['Automated webpage copying or monitoring without written permission', 'Circumvent robots policy, access controls, CAPTCHA or network restrictions', 'Reverse engineer internal interfaces'],
    evidencePaths: ['docs/digital-import/SOURCES.md'],
    access: { state: 'not-attempted-permission', reason: 'The user requires prior written permission for webpage monitoring/copying. No permission was supplied and no BrickLink webpage request was attempted.' },
  },
  {
    id: 'bricklink-authorized-api', name: 'BrickLink authorised public API', roles: ['inventory', 'identity', 'color'], publicDigitalImport: false,
    licenseStatus: 'permission-not-established', allowedOperations: ['Implement only after API authorisation, scopes and permitted data use are verified'],
    forbiddenOperations: ['Use website or internal interfaces as a replacement for unavailable API authorisation', 'Assume API access permits redistribution'],
    evidencePaths: ['docs/digital-import/SOURCES.md'],
    access: { state: 'not-attempted-permission', reason: 'No API authorisation or permitted redistribution evidence supplied; no request attempted.' },
  },
  {
    id: 'studio-unreviewed', name: 'BrickLink Studio bundled resources and .conn data', roles: ['reference'], publicDigitalImport: false,
    licenseStatus: 'permission-not-established', allowedOperations: ['Investigate official format documentation and supported workflows when access permits'],
    forbiddenOperations: ['Automatically copy Studio installation files into this project', 'Redistribute geometry or .conn files without verified resource-specific permission', 'Assume software availability implies data reuse rights'],
    evidencePaths: ['docs/digital-import/SOURCES.md'],
    access: { state: 'not-attempted-permission', reason: 'No reviewed resource licence or approved source package; no Studio installation resources were accessed or copied.' },
  },
  {
    id: 'uploaded-instructions', name: 'User supplied instruction references and appendix observations', roles: ['reference'], publicDigitalImport: false,
    licenseStatus: 'reference-only', allowedOperations: ['Identify demand, source page and observed Element quantities', 'Keep source identity and completeness limitations'],
    forbiddenOperations: ['Reconstruct existing digital geometry from pictures', 'Treat appendix membership as geometry or connection proof', 'Automatically republish original PDFs without establishing permission'],
    evidencePaths: ['data/parts-foundation/instructions/manifest.json', 'data/parts-foundation/instructions/inventories.json'],
    access: { state: 'reference-only', reason: 'Six uploaded originals are locally preserved and two remain unread; reference observations do not authorise digital geometry or PDF redistribution.' },
  },
] as const;

export interface DigitalSourceAdmissionRequest {
  sourceId: string;
  role: DigitalSourceRole;
  sourceUrl: string;
  revision: string;
  license: string | null;
  sha256: string;
  attributionPresent: boolean;
  licenseCopyPresent: boolean;
}
export interface DigitalSourceAdmissionDecision {
  allowed: boolean;
  sourceId: string;
  role: DigitalSourceRole;
  reasonCodes: string[];
  licenseObligations: string[];
}

/** Admission of public digital source files. This gate grants neither an ID mapping
 * nor an assembly qualification and does not perform network acquisition.
 */
export function checkDigitalSourceAdmission(input: DigitalSourceAdmissionRequest): DigitalSourceAdmissionDecision {
  const policy = DIGITAL_SOURCE_POLICIES.find(source => source.id === input.sourceId);
  const reasonCodes: string[] = [];
  const licenseObligations: string[] = [];
  if (!policy) reasonCodes.push('UNKNOWN_SOURCE');
  else {
    if (!policy.publicDigitalImport) reasonCodes.push('SOURCE_PERMISSION_NOT_ESTABLISHED');
    if (!policy.roles.includes(input.role)) reasonCodes.push('SOURCE_ROLE_NOT_ALLOWED');
  }
  const ldraw = input.sourceId === 'ldraw-pinned', shadow = input.sourceId === 'ldcad-shadow-pinned';
  if (ldraw || shadow) {
    const root = ldraw ? PILOT_LDRAW_SOURCE_ROOT : PILOT_SHADOW_SOURCE_ROOT;
    const revision = ldraw ? PILOT_LDRAW_REVISION : PILOT_SHADOW_REVISION;
    const relative = input.sourceUrl.startsWith(root) ? input.sourceUrl.slice(root.length) : '';
    if (input.revision !== revision) reasonCodes.push('SOURCE_REVISION_NOT_REVIEWED');
    if (!/^(?:parts|p)\/[a-z0-9_./-]+\.dat$/.test(relative) || relative.split('/').some(segment => !segment || segment === '.' || segment === '..')) reasonCodes.push('SOURCE_URL_NOT_REVIEWED');
    if (ldraw ? !['Licensed under CC BY 4.0 : see CAreadme.txt', 'Licensed under CC BY 2.0 and CC BY 4.0 : see CAreadme.txt'].includes(input.license ?? '') : input.license !== 'CC-BY-SA-4.0') reasonCodes.push('FILE_LICENSE_NOT_REVIEWED');
    licenseObligations.push('Preserve original source bytes, author/history headers, source URL, revision, checksum and attribution', 'Distribute the applicable licence texts with approved source files');
    if (shadow) licenseObligations.push('Retain CC-BY-SA-4.0 licensing and attribution for source and derived connection records');
  }
  if (!/^[a-f0-9]{64}$/.test(input.sha256)) reasonCodes.push('SOURCE_DIGEST_REQUIRED');
  if (!input.attributionPresent) reasonCodes.push('ATTRIBUTION_REQUIRED');
  if (!input.licenseCopyPresent) reasonCodes.push('LICENSE_COPY_REQUIRED');
  return { allowed: reasonCodes.length === 0, sourceId: input.sourceId, role: input.role, reasonCodes, licenseObligations };
}
