import type { RealVehicleProfile, ResearchSource, VehicleClass, VehicleFact, VehicleImageAngle } from './types.js';

export const VEHICLE_CLASSES: VehicleClass[] = ['luxury-sedan', 'performance-coupe', 'sports-car', 'gt', 'supercar', 'unknown'];
export function unknownFact<T>(): VehicleFact<T> { return { value: null, status: 'unknown', sourceIds: [] }; }
const seed = <T>(value: T, sourceId: string): VehicleFact<T> => ({ value, status: 'catalog_seed', sourceIds: [sourceId], note: 'Editorial catalogue metadata; not verified by live research or image analysis.' });

/** Fixed server-side registry, never a URL supplied by an API caller. */
export const OFFICIAL_SOURCE_REGISTRY: Readonly<Record<string, readonly { id: string; url: string; title: string }[]>> = {
  'mercedes-amg-s63-w223': [
    { id: 'official-s63-amg', url: 'https://www.mercedes-amg.com/en/home/vehicles/s-class/sedan.html', title: 'Mercedes-AMG S-Class official vehicle page (target URI)' },
    { id: 'official-s63-mbusa', url: 'https://www.mbusa.com/en/vehicles/model/s-class/sedan/s63e', title: 'Mercedes-Benz USA AMG S 63 E PERFORMANCE (target URI)' },
  ],
  'bmw-m4-g82': [{ id: 'official-m4', url: 'https://www.bmwusa.com/vehicles/m-models/m4-coupe/overview.html', title: 'BMW M4 Coupe official page (target URI)' }],
  'porsche-911-992': [{ id: 'official-911', url: 'https://www.porsche.com/usa/models/911/carrera-models/911-carrera/', title: 'Porsche 911 Carrera official page (target URI)' }],
  'ferrari-roma': [{ id: 'official-roma', url: 'https://www.ferrari.com/en-EN/auto/ferrari-roma', title: 'Ferrari Roma official page (target URI)' }],
  'lamborghini-revuelto': [{ id: 'official-revuelto', url: 'https://www.lamborghini.com/en-en/models/revuelto', title: 'Lamborghini Revuelto official page (target URI)' }],
};

function makeProfile(id: string, manufacturer: string, model: string, generation: string | null, vehicleType: VehicleClass, aliases: string[], tags: string[], signatures: string[], doors: number): RealVehicleProfile {
  const sourceId = `catalog-${id}`;
  const sources: ResearchSource[] = [{ id: sourceId, kind: 'catalog_seed', title: 'Curated benchmark identity and semantic design tags', url: null, accessStatus: 'not_fetched', accessedAt: null, attribution: 'BrickLab editorial catalogue', notes: ['Identity and qualitative tags are seed metadata, not source-verified vehicle measurements.'] },
    ...(OFFICIAL_SOURCE_REGISTRY[id] ?? []).map(source => ({ ...source, kind: 'official' as const, accessStatus: 'blocked' as const, accessedAt: '2026-10-20T04:55:57.000Z', attribution: manufacturer, notes: ['Development-time proxy CONNECT returned HTTP 403. Page availability and contents could not be verified. Only the intended official link is stored; no images or PDF are redistributed.'] }))];
  return {
    id, manufacturer, model, generation, vehicleType, identitySourceIds: [sourceId], aliases,
    dimensions: { lengthMm: unknownFact(), widthMm: unknownFact(), heightMm: unknownFact(), wheelbaseMm: unknownFact() },
    visualFeatures: { hoodLengthRatio: unknownFact(), roofline: unknownFact(), cabinPositionRatio: unknownFact(), doorCount: seed(doors, sourceId), frontDesign: unknownFact(), grille: unknownFact(), headlights: unknownFact(), rearDesign: unknownFact(), wheelArchCharacter: unknownFact() },
    signatureFeatures: signatures.map(value => seed(value, sourceId)), featureTags: tags, referenceImages: [], sources, researchStatus: 'pending',
    warnings: ['Official vehicle hosts were blocked by the development network policy. Dimensions remain unknown; catalogue tags have not been confirmed by live research. Image analysis is not configured.'],
  };
}
const CATALOG: RealVehicleProfile[] = [
  makeProfile('mercedes-amg-s63-w223', 'Mercedes-AMG', 'S 63 E PERFORMANCE', 'W223', 'luxury-sedan', ['Mercedes-AMG S 63', 'Mercedes S63', 'AMG S63', 'S63', 'S 63 E PERFORMANCE', '奔驰S63', '梅赛德斯S63'], ['long-wheelbase', 'long-hood', 'four-door', 'large-grille', 'sedan-roofline'], ['Long luxury sedan silhouette', 'Long wheelbase', 'Four-door cabin', 'Large vertical AMG grille'], 4),
  makeProfile('bmw-m4-g82', 'BMW', 'M4 Coupe', 'G82', 'performance-coupe', ['BMW M4', 'M4', '宝马M4'], ['long-hood', 'two-door', 'large-grille', 'coupe-roofline'], ['Two-door performance coupe silhouette', 'Prominent paired front grille'], 2),
  makeProfile('porsche-911-992', 'Porsche', '911 Carrera', '992', 'sports-car', ['Porsche 911', '911', '保时捷911'], ['two-door', 'rear-engine', 'curved-roof', 'round-headlights'], ['Continuous curved roofline', 'Round headlights', 'Rear-engine sports car silhouette'], 2),
  makeProfile('ferrari-roma', 'Ferrari', 'Roma', null, 'gt', ['Ferrari Roma', 'Roma', '法拉利Roma'], ['long-hood', 'two-door', 'gt-roofline', 'low-roof'], ['Long hood GT silhouette', 'Flowing two-door roofline'], 2),
  makeProfile('lamborghini-revuelto', 'Lamborghini', 'Revuelto', null, 'supercar', ['Lamborghini Revuelto', 'Revuelto', '兰博基尼Revuelto'], ['mid-engine', 'two-door', 'low-roof', 'wedge-nose'], ['Low mid-engine wedge silhouette', 'Angular front and rear lighting'], 2),
];
const normalize = (value: string) => value.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '');
export function listCatalogVehicleProfiles(): RealVehicleProfile[] { return structuredClone(CATALOG); }
export function getCatalogVehicleProfile(query: string): RealVehicleProfile | null {
  if (typeof query !== 'string' || !query.trim() || query.length > 500) return null;
  const key = normalize(query), searchable = query.toLowerCase().normalize('NFKC');
  const candidates = CATALOG.filter(profile => [profile.id, `${profile.manufacturer} ${profile.model}`, ...profile.aliases].some(alias => {
    const token = normalize(alias);
    if (key === token) return true;
    if (token.length < 3) return false;
    // Preserve word boundaries while tolerating punctuation and spaces in a model name.
    // Do not turn e.g. BMW M40 or Porsche 9110 into a known model.
    return new RegExp(`(?<![a-z0-9])${[...token].join('[\\s\\p{P}]*')}(?![a-z0-9])`, 'u').test(searchable);
  }));
  // An ambiguous multi-vehicle prompt must not silently select the first car.
  return candidates.length === 1 ? structuredClone(candidates[0]) : null;
}

function record(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function text(value: unknown, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[<>\u0000-\u001F]/u.test(value)) throw new Error('Manual profile contains an invalid text field.');
  return value.trim();
}
function safeLink(value: unknown): string {
  const parsed = new URL(text(value, 2000));
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('Reference links must use HTTPS without credentials.');
  return parsed.href;
}
function numberFact(value: unknown, sourceId: string, min: number, max: number): VehicleFact<number> {
  if (value === undefined || value === null) return unknownFact();
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error('Manual profile contains an invalid measurement.');
  return { value, status: 'manual', sourceIds: [sourceId], note: 'User-supplied; not independently verified.' };
}
function stringFact(value: unknown, sourceId: string): VehicleFact<string> {
  return value === undefined || value === null ? unknownFact() : { value: text(value, 300), status: 'manual', sourceIds: [sourceId], note: 'User-supplied; not independently verified.' };
}
/** Structured manual input is a supported path for unknown vehicles; no dimensions are invented. */
export function createManualVehicleProfile(input: unknown): RealVehicleProfile {
  if (!record(input) || Object.keys(input).some(key => !['manufacturer', 'model', 'generation', 'vehicleType', 'dimensions', 'visualFeatures', 'signatureFeatures', 'featureTags', 'referenceImages', 'sourceLabel', 'sourceUrl'].includes(key))) throw new Error('Invalid manual vehicle profile fields.');
  const manufacturer = text(input.manufacturer), model = text(input.model);
  const vehicleType = input.vehicleType === undefined ? 'unknown' : input.vehicleType;
  if (!VEHICLE_CLASSES.includes(vehicleType as VehicleClass)) throw new Error('Unknown vehicle class.');
  if ((input.dimensions !== undefined && !record(input.dimensions)) || (input.visualFeatures !== undefined && !record(input.visualFeatures))) throw new Error('Invalid manual dimensions or visual features.');
  const dimensions = (input.dimensions ?? {}) as Record<string, unknown>;
  const visual = (input.visualFeatures ?? {}) as Record<string, unknown>;
  if (Object.keys(dimensions).some(key => !['lengthMm', 'widthMm', 'heightMm', 'wheelbaseMm'].includes(key)) || Object.keys(visual).some(key => !['hoodLengthRatio', 'roofline', 'cabinPositionRatio', 'doorCount', 'frontDesign', 'grille', 'headlights', 'rearDesign', 'wheelArchCharacter'].includes(key))) throw new Error('Invalid manual measurement fields.');
  const id = `manual-${normalize(`${manufacturer}-${model}`).slice(0, 100)}`, sourceId = `${id}-source`;
  const list = (value: unknown): string[] => {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > 30) throw new Error('Invalid manual feature list.');
    return value.map(entry => text(entry, 300));
  };
  const angles: VehicleImageAngle[] = ['front', 'front-three-quarter', 'side', 'rear-three-quarter', 'rear', 'unknown'];
  if (input.referenceImages !== undefined && (!Array.isArray(input.referenceImages) || input.referenceImages.length > 10)) throw new Error('Invalid reference image list.');
  const referenceImages = ((input.referenceImages ?? []) as unknown[]).map(image => {
    if (!record(image) || Object.keys(image).some(key => !['url', 'angle'].includes(key)) || !angles.includes(image.angle as VehicleImageAngle)) throw new Error('Invalid reference image metadata.');
    return { angle: image.angle as VehicleImageAngle, url: safeLink(image.url), source: sourceId, analysisStatus: 'not_analyzed' as const };
  });
  const result: RealVehicleProfile = {
    id, manufacturer, model, generation: input.generation === undefined || input.generation === null ? null : text(input.generation), vehicleType: vehicleType as VehicleClass, identitySourceIds: [sourceId], aliases: [],
    dimensions: { lengthMm: numberFact(dimensions.lengthMm, sourceId, 1500, 10000), widthMm: numberFact(dimensions.widthMm, sourceId, 900, 3500), heightMm: numberFact(dimensions.heightMm, sourceId, 600, 3500), wheelbaseMm: numberFact(dimensions.wheelbaseMm, sourceId, 800, 7000) },
    visualFeatures: { hoodLengthRatio: numberFact(visual.hoodLengthRatio, sourceId, 0.05, 0.6), roofline: stringFact(visual.roofline, sourceId), cabinPositionRatio: numberFact(visual.cabinPositionRatio, sourceId, 0.1, 0.8), doorCount: numberFact(visual.doorCount, sourceId, 0, 6), frontDesign: stringFact(visual.frontDesign, sourceId), grille: stringFact(visual.grille, sourceId), headlights: stringFact(visual.headlights, sourceId), rearDesign: stringFact(visual.rearDesign, sourceId), wheelArchCharacter: stringFact(visual.wheelArchCharacter, sourceId) },
    signatureFeatures: list(input.signatureFeatures).map(value => ({ value, status: 'manual', sourceIds: [sourceId] })), featureTags: list(input.featureTags), referenceImages,
    sources: [{ id: sourceId, kind: 'user', title: input.sourceLabel === undefined ? 'User-supplied vehicle profile' : text(input.sourceLabel), url: input.sourceUrl === undefined ? null : safeLink(input.sourceUrl), accessStatus: 'user_supplied', accessedAt: null, attribution: 'User-provided data; not independently verified', notes: ['Links are metadata only. Neither dimensions nor image contents have been independently checked.'] }],
    researchStatus: 'manual', warnings: ['This profile is user-supplied and has not been independently verified. Reference images are not visually analyzed.'],
  };
  const { lengthMm, widthMm, heightMm, wheelbaseMm } = result.dimensions;
  if ((lengthMm.value && wheelbaseMm.value && wheelbaseMm.value >= lengthMm.value) || (lengthMm.value && widthMm.value && widthMm.value >= lengthMm.value) || (heightMm.value && lengthMm.value && heightMm.value >= lengthMm.value) || (result.visualFeatures.doorCount.value !== null && !Number.isInteger(result.visualFeatures.doorCount.value))) throw new Error('Manual vehicle measurements are inconsistent.');
  return result;
}
