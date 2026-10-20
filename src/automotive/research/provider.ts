import { getCatalogVehicleProfile, OFFICIAL_SOURCE_REGISTRY } from './profiles.js';
import type { RealVehicleProfile, VehicleFact, VehicleResearchResult } from './types.js';

const MAX_BYTES = 1_000_000;
const MAX_REDIRECTS = 2;
type JsonObject = Record<string, unknown>;
const object = (value: unknown): value is JsonObject => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const normalized = (value: string) => value.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '');
const plainText = (value: string, max = 300) => value.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]*>/g, ' ').replace(/&(?:nbsp|amp|lt|gt|quot|#39);/gi, ' ').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

export class VehicleResearchError extends Error {
  constructor(message: string, readonly code: string) { super(message); this.name = 'VehicleResearchError'; }
}
export interface VehicleResearchProviderOptions {
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  maxBytes?: number;
  now?: () => Date;
}

function officialURL(value: string, origin: string): URL {
  let url: URL;
  try { url = new URL(value, origin); } catch { throw new VehicleResearchError('The official source returned an invalid URL.', 'UNSAFE_REDIRECT'); }
  if (url.origin !== origin || url.protocol !== 'https:' || url.username || url.password || url.hash) throw new VehicleResearchError('The official source attempted a redirect outside its permitted origin.', 'UNSAFE_REDIRECT');
  return url;
}

async function boundedText(response: Response, maxBytes: number, controller: AbortController): Promise<string> {
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
    try { await response.body?.cancel(); } catch { /* Cancellation cannot replace the resource-limit error. */ }
    controller.abort();
    throw new VehicleResearchError('Official source exceeds the response size limit.', 'RESPONSE_TOO_LARGE');
  }
  if (!response.body) throw new VehicleResearchError('Official source returned an empty response.', 'INVALID_UPSTREAM_DATA');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let bytes = 0, result = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) { try { await reader.cancel(); } catch { /* Preserve the size-limit error. */ } controller.abort(); throw new VehicleResearchError('Official source exceeds the response size limit.', 'RESPONSE_TOO_LARGE'); }
      result += decoder.decode(chunk.value, { stream: true });
    }
    return result + decoder.decode();
  } finally { reader.releaseLock(); }
}

function quantitativeMm(value: unknown): number | null {
  if (!object(value)) return null; // An unlabeled number has an unknown unit.
  const number = typeof value.value === 'number' ? value.value : typeof value.value === 'string' && /^\d+(?:\.\d+)?$/.test(value.value) ? Number(value.value) : NaN;
  const unit = typeof value.unitCode === 'string' ? value.unitCode : value.unitText;
  if (!Number.isFinite(number) || typeof unit !== 'string') return null;
  const factor = ({ MMT: 1, mm: 1, millimeter: 1, millimeters: 1, millimetre: 1, millimetres: 1, CMT: 10, cm: 10, MTR: 1000, m: 1000, INH: 25.4, in: 25.4, inch: 25.4, inches: 25.4 } as Record<string, number>)[unit];
  return factor ? Math.round(number * factor * 10) / 10 : null;
}
function jsonLdNodes(input: unknown, result: JsonObject[], depth = 0): void {
  if (depth > 12 || result.length > 1000) throw new VehicleResearchError('Official source structured data exceeds the parsing limit.', 'INVALID_UPSTREAM_DATA');
  if (Array.isArray(input)) { for (const value of input) jsonLdNodes(value, result, depth + 1); }
  else if (object(input)) {
    result.push(input);
    // Only structured-data graph/items are traversed, never arbitrary untrusted object keys.
    if (input['@graph'] !== undefined) jsonLdNodes(input['@graph'], result, depth + 1);
    if (input.mainEntity !== undefined) jsonLdNodes(input.mainEntity, result, depth + 1);
  }
}
function matchingVehicle(nodes: JsonObject[], profile: RealVehicleProfile): JsonObject | null {
  const names = [profile.model, `${profile.manufacturer} ${profile.model}`, ...profile.aliases].map(normalized).filter(value => value.length >= 3);
  const family = nodes.filter(node => {
    const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
    if (!types.some(type => type === 'Car' || type === 'Vehicle' || type === 'https://schema.org/Car' || type === 'https://schema.org/Vehicle') || typeof node.name !== 'string') return false;
    const name = normalized(node.name);
    return names.some(alias => name === alias || name.startsWith(alias));
  });
  return family.length === 1 && typeof family[0].name === 'string' && names.includes(normalized(family[0].name)) ? family[0] : null;
}
/** Safe, deliberately narrow parser: no script execution, DOM insertion, image fetch, or inferred facts. */
export function parseOfficialVehicleDocument(body: string, contentType: string, profile: RealVehicleProfile, sourceId: string, sourceUrl: string): { dimensionsFound: number; profile: RealVehicleProfile } {
  const result = structuredClone(profile), nodes: JsonObject[] = [];
  try {
    if (/application\/(?:ld\+)?json/i.test(contentType)) jsonLdNodes(JSON.parse(body), nodes);
    else {
      const scripts = [...body.matchAll(/<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)];
      if (scripts.length > 30) throw new VehicleResearchError('Too many structured data blocks.', 'INVALID_UPSTREAM_DATA');
      for (const script of scripts) { try { jsonLdNodes(JSON.parse(script[1]), nodes); } catch (error) { if (error instanceof VehicleResearchError) throw error; /* A malformed block is not evidence. */ } }
    }
  } catch (error) { if (error instanceof VehicleResearchError) throw error; throw new VehicleResearchError('Official source returned malformed structured data.', 'INVALID_UPSTREAM_DATA'); }
  const vehicle = matchingVehicle(nodes, profile);
  let dimensionsFound = 0;
  if (vehicle) {
    const properties = Array.isArray(vehicle.additionalProperty) ? vehicle.additionalProperty.filter(object) : [];
    const measurements: Record<keyof RealVehicleProfile['dimensions'], unknown> = {
      lengthMm: vehicle.length, heightMm: vehicle.height, wheelbaseMm: vehicle.wheelbase,
      widthMm: object(vehicle.width) && typeof vehicle.width.description === 'string' && /(?:without|excluding)\s+(?:exterior\s+)?mirrors|body width/i.test(vehicle.width.description) ? vehicle.width : undefined,
    };
    for (const property of properties) {
      const label = typeof property.name === 'string' ? property.name.toLowerCase().trim() : '';
      const target = /^(?:overall )?length$/.test(label) ? 'lengthMm' : /^(?:overall )?height$/.test(label) ? 'heightMm' : /^wheel\s?base$/.test(label) ? 'wheelbaseMm' : /^(?:body width|width (?:without|excluding) (?:exterior )?mirrors)$/.test(label) ? 'widthMm' : null;
      if (target) measurements[target] = property;
    }
    for (const field of Object.keys(measurements) as (keyof RealVehicleProfile['dimensions'])[]) {
      const value = quantitativeMm(measurements[field]);
      const range = field === 'lengthMm' ? [1500, 10000] : field === 'widthMm' ? [900, 3500] : field === 'heightMm' ? [600, 3500] : [800, 7000];
      if (value !== null && value >= range[0] && value <= range[1]) {
        result.dimensions[field] = { value, status: 'live_verified', sourceIds: [sourceId], note: 'Read from model-matched official structured data with explicit measurement units.' } satisfies VehicleFact<number>;
        dimensionsFound++;
      }
    }
    const dimensions = result.dimensions;
    if ((dimensions.lengthMm.value !== null && dimensions.wheelbaseMm.value !== null && dimensions.wheelbaseMm.value >= dimensions.lengthMm.value) || (dimensions.lengthMm.value !== null && dimensions.widthMm.value !== null && dimensions.widthMm.value >= dimensions.lengthMm.value)) throw new VehicleResearchError('Official source dimensions are inconsistent.', 'INVALID_UPSTREAM_DATA');
    const images = typeof vehicle.image === 'string' ? [vehicle.image] : Array.isArray(vehicle.image) ? vehicle.image : [];
    for (const image of images.slice(0, 10)) {
      if (typeof image !== 'string') continue;
      try {
        const url = officialURL(image, new URL(sourceUrl).origin);
        if (!result.referenceImages.some(entry => entry.url === url.href)) result.referenceImages.push({ angle: 'unknown', url: url.href, source: sourceId, analysisStatus: 'not_analyzed' });
      } catch { /* Do not trust off-origin image URLs embedded by the upstream. */ }
    }
  }
  const source = result.sources.find(source => source.id === sourceId);
  if (source) {
    const title = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(body);
    if (title) { const safeTitle = plainText(title[1]); if (safeTitle) source.title = safeTitle; }
    source.notes.push(vehicle ? `Model-matched structured data yielded ${dimensionsFound} dimension fields. Image metadata has not been visually analyzed.` : 'No unambiguous model-matched Vehicle/Car structured data was found. No dimensions were inferred from page prose or images.');
  }
  return { dimensionsFound, profile: result };
}

/** Official hosts and initial URLs come exclusively from the checked-in registry. */
export class RealVehicleResearchProvider {
  private readonly fetcher: typeof globalThis.fetch;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly now: () => Date;
  constructor(options: VehicleResearchProviderOptions = {}) {
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.timeoutMs = Math.min(15000, Math.max(100, options.timeoutMs ?? 8000));
    this.maxBytes = Math.min(MAX_BYTES, Math.max(1024, options.maxBytes ?? MAX_BYTES));
    this.now = options.now ?? (() => new Date());
  }
  private async request(sourceUrl: string): Promise<{ body: string; contentType: string }> {
    const source = new URL(sourceUrl), controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      let current = officialURL(source.href, source.origin);
      for (let redirects = 0; ; redirects++) {
        const response = await this.fetcher(current, { redirect: 'manual', signal: controller.signal, headers: { Accept: 'text/html, application/ld+json, application/json', 'User-Agent': 'BrickLab-Vehicle-Research/0.3' } });
        if (response.status >= 300 && response.status < 400) {
          await response.body?.cancel();
          const location = response.headers.get('location');
          if (!location || redirects >= MAX_REDIRECTS) throw new VehicleResearchError('Official source exceeded the redirect limit.', 'REDIRECT_LIMIT');
          current = officialURL(new URL(location, current).href, source.origin);
          continue;
        }
        if (!response.ok) { await response.body?.cancel(); throw new VehicleResearchError(`Official source returned HTTP ${response.status}.`, response.status === 403 ? 'UPSTREAM_ACCESS_DENIED' : 'UPSTREAM_HTTP_ERROR'); }
        const contentType = response.headers.get('content-type') ?? '';
        if (!/^(?:text\/html|application\/(?:ld\+)?json)(?:\s*;|$)/i.test(contentType)) { await response.body?.cancel(); throw new VehicleResearchError('Official source returned an unsupported content type.', 'UNSUPPORTED_CONTENT_TYPE'); }
        return { body: await boundedText(response, this.maxBytes, controller), contentType };
      }
    } catch (error) {
      if (error instanceof VehicleResearchError) throw error;
      throw new VehicleResearchError(controller.signal.aborted ? 'Official source request timed out.' : 'Unable to reach the official source. Check the permitted network hosts.', controller.signal.aborted ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_NETWORK_ERROR');
    } finally { clearTimeout(timer); }
  }
  async research(query: string, options: { mode?: 'catalog' | 'live' } = {}): Promise<VehicleResearchResult> {
    let profile = getCatalogVehicleProfile(query);
    if (!profile) return { status: 'not_found', profile: null, attempts: [], warnings: ['No trusted catalogue entry matches this vehicle. Supply a structured manual profile; dimensions are not invented.'] };
    if (options.mode === 'catalog') return { status: 'catalog_seed', profile, attempts: [], warnings: [...profile.warnings, 'Catalogue-only mode did not make a network request.'] };
    const attempts: VehicleResearchResult['attempts'] = [];
    let dimensionsFound = 0;
    for (const source of OFFICIAL_SOURCE_REGISTRY[profile.id] ?? []) {
      try {
        const document = await this.request(source.url);
        const parsed = parseOfficialVehicleDocument(document.body, document.contentType, profile, source.id, source.url);
        profile = parsed.profile;
        dimensionsFound += parsed.dimensionsFound;
        const record = profile.sources.find(entry => entry.id === source.id)!;
        record.accessStatus = 'fetched'; record.accessedAt = this.now().toISOString();
        attempts.push({ sourceId: source.id, url: source.url, status: 'fetched' });
      } catch (error) {
        const failure = error instanceof VehicleResearchError ? error : new VehicleResearchError('Official source could not be processed.', 'INVALID_UPSTREAM_DATA');
        const record = profile.sources.find(entry => entry.id === source.id)!;
        record.accessStatus = failure.code === 'UPSTREAM_ACCESS_DENIED' ? 'blocked' : 'failed'; record.accessedAt = this.now().toISOString(); record.notes.push(failure.message);
        attempts.push({ sourceId: source.id, url: source.url, status: 'failed', errorCode: failure.code, message: failure.message });
      }
    }
    const complete = Object.values(profile.dimensions).every(fact => fact.value !== null && fact.status === 'live_verified');
    profile.researchStatus = complete ? 'verified' : dimensionsFound > 0 ? 'partial' : 'pending';
    const warnings = ['Catalogue qualitative tags remain unverified unless explicitly sourced. Reference images have not been visually analyzed.', ...attempts.filter(attempt => attempt.status === 'failed').map(attempt => `${attempt.sourceId}: ${attempt.message}`)];
    if (!complete) warnings.push('Official dimensions are incomplete. Missing facts remain unknown; a successful HTTP request alone is not verified research.');
    profile.warnings = warnings;
    return { status: complete ? 'live_verified' : dimensionsFound > 0 ? 'partial' : 'failed', profile, attempts, warnings };
  }
}
