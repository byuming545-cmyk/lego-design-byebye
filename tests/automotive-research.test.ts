import { describe, expect, it, vi } from 'vitest';
import { toVehicleDesignBrief, VehicleBriefError } from '../src/automotive/research/brief.js';
import { createManualVehicleProfile, getCatalogVehicleProfile, listCatalogVehicleProfiles, OFFICIAL_SOURCE_REGISTRY } from '../src/automotive/research/profiles.js';
import { parseOfficialVehicleDocument, RealVehicleResearchProvider } from '../src/automotive/research/provider.js';

// Synthetic protocol fixtures, not manufacturer specifications or evidence of a real network fetch.
const syntheticCar = (extra: Record<string, unknown> = {}) => ({ '@context': 'https://schema.org', '@type': 'Car', name: 'BMW M4 Coupe', length: { value: 500, unitCode: 'CMT' }, width: { value: 2, unitCode: 'MTR', description: 'Body width excluding mirrors' }, height: { value: 1500, unitText: 'mm' }, wheelbase: { value: 3000, unitCode: 'MMT' }, ...extra });
const response = (data: unknown, type = 'application/ld+json') => new Response(JSON.stringify(data), { headers: { 'content-type': type } });
const m4 = () => getCatalogVehicleProfile('BMW M4')!;

describe('vehicle research identity and provenance', () => {
  it('keeps five vehicle classes, sources and unknown measurements without invented online evidence', () => {
    const catalog = listCatalogVehicleProfiles();
    expect(new Set(catalog.map(profile => profile.vehicleType)).size).toBe(5);
    expect(getCatalogVehicleProfile('帮我设计一辆现款Mercedes-AMG S63')?.generation).toBe('W223');
    expect(getCatalogVehicleProfile('S63')?.model).toBe('S 63 E PERFORMANCE');
    expect(getCatalogVehicleProfile('imaginary 999')).toBeNull();
    expect(getCatalogVehicleProfile('BMW M40')).toBeNull();
    expect(getCatalogVehicleProfile('Porsche 9110')).toBeNull();
    expect(getCatalogVehicleProfile('BMW M4 and Porsche 911')).toBeNull();
    for (const profile of catalog) {
      expect(profile.researchStatus).toBe('pending');
      expect(Object.values(profile.dimensions).every(fact => fact.value === null && fact.status === 'unknown')).toBe(true);
      expect(profile.referenceImages).toEqual([]);
      expect(profile.signatureFeatures.every(fact => fact.status === 'catalog_seed' && fact.sourceIds.length > 0)).toBe(true);
      expect(profile.sources.some(source => source.kind === 'official' && source.accessStatus === 'blocked')).toBe(true);
    }
    catalog[0].manufacturer = 'mutated';
    expect(listCatalogVehicleProfiles()[0].manufacturer).toBe('Mercedes-AMG');
  });

  it('makes no requests for unknown cars or explicitly selected catalogue mode', async () => {
    const fetcher = vi.fn();
    const provider = new RealVehicleResearchProvider({ fetch: fetcher });
    expect((await provider.research('unknown vehicle')).status).toBe('not_found');
    expect((await provider.research('BMW M4', { mode: 'catalog' })).status).toBe('catalog_seed');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('reports upstream failure explicitly while retaining the unverified catalogue record', async () => {
    const fetcher = vi.fn(async () => new Response('denied', { status: 403 }));
    const result = await new RealVehicleResearchProvider({ fetch: fetcher }).research('S63');
    expect(result.status).toBe('failed');
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts.every(attempt => attempt.errorCode === 'UPSTREAM_ACCESS_DENIED')).toBe(true);
    expect(result.profile!.dimensions.lengthMm.value).toBeNull();
    expect(result.profile!.researchStatus).toBe('pending');
    expect(result.profile!.sources.filter(source => source.kind === 'official').every(source => source.accessStatus === 'blocked')).toBe(true);
  });

  it('supports sourced, explicitly self-reported profiles and multi-angle image metadata', () => {
    const profile = createManualVehicleProfile({ manufacturer: 'Example', model: 'Sedan', vehicleType: 'luxury-sedan', dimensions: { lengthMm: 5300, widthMm: 1950, heightMm: 1500, wheelbaseMm: 3200 }, visualFeatures: { doorCount: 4, roofline: 'Curved roof', hoodLengthRatio: 0.27 }, signatureFeatures: ['Long sedan silhouette'], sourceLabel: 'User measurement sheet', sourceUrl: 'https://example.org/spec', referenceImages: [{ angle: 'side', url: 'https://example.org/side.jpg' }, { angle: 'front', url: 'https://example.org/front.jpg' }] });
    expect(profile.researchStatus).toBe('manual');
    expect(profile.dimensions.widthMm.status).toBe('manual');
    expect(profile.dimensions.widthMm.sourceIds).toEqual([profile.sources[0].id]);
    expect(profile.visualFeatures.headlights.value).toBeNull();
    expect(profile.referenceImages.every(image => image.analysisStatus === 'not_analyzed')).toBe(true);
    expect(toVehicleDesignBrief(profile, 10).dimensionBasis).toBe('source-backed');
  });

  it('rejects fabricated units, invalid structures, unsafe image links and inconsistent manual dimensions', () => {
    const base = { manufacturer: 'Example', model: 'Car' };
    for (const patch of [{ dimensions: { widthMm: '1950' } }, { dimensions: { wheelbaseMm: 6000, lengthMm: 4000 } }, { dimensions: { width: 2 } }, { visualFeatures: { doorCount: 2.5 } }, { referenceImages: [{ angle: 'side', url: 'javascript:alert(1)' }] }, { sourceUrl: 'https://user:pass@example.com/a' }, { model: '<script>bad</script>' }, { sources: [] }]) expect(() => createManualVehicleProfile({ ...base, ...patch })).toThrow();
  });
});

describe('bounded official research provider', () => {
  it('verifies only model-matched, explicitly unit-labelled dimensions in synthetic official responses', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => response(syntheticCar({ image: ['https://www.bmwusa.com/m4.jpg', 'https://untrusted.test/x.jpg'] })));
    const result = await new RealVehicleResearchProvider({ fetch: fetcher, now: () => new Date('2026-01-01T00:00:00Z') }).research('BMW M4');
    expect(result.status).toBe('live_verified');
    expect(result.profile!.dimensions.lengthMm).toMatchObject({ value: 5000, status: 'live_verified', sourceIds: ['official-m4'] });
    expect(result.profile!.dimensions.widthMm.value).toBe(2000);
    expect(result.profile!.referenceImages).toEqual([{ angle: 'unknown', url: 'https://www.bmwusa.com/m4.jpg', source: 'official-m4', analysisStatus: 'not_analyzed' }]);
    expect(String(fetcher.mock.calls[0][0])).toBe(OFFICIAL_SOURCE_REGISTRY['bmw-m4-g82'][0].url);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
    expect(result.profile!.sources.find(source => source.id === 'official-m4')?.accessedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('does not turn arbitrary page prose, an unrelated model or ambiguous variants into dimensions', async () => {
    const documents = [response(syntheticCar({ name: 'Different model' })), response([syntheticCar(), syntheticCar({ name: 'BMW M4 Competition' })]), new Response('<html><h1>BMW M4</h1><p>Length 5000 mm Width 2000 mm</p></html>', { headers: { 'content-type': 'text/html' } })];
    for (const document of documents) {
      const result = await new RealVehicleResearchProvider({ fetch: vi.fn(async () => document) }).research('BMW M4');
      expect(result.status).toBe('failed');
      expect(result.attempts[0].status).toBe('fetched');
      expect(result.profile!.dimensions.lengthMm.value).toBeNull();
    }
  });

  it('leaves unlabeled numbers and mirror-ambiguous widths unknown', async () => {
    const result = await new RealVehicleResearchProvider({ fetch: vi.fn(async () => response(syntheticCar({ width: { value: 2100, unitCode: 'MMT' }, length: 5000 }))) }).research('BMW M4');
    expect(result.status).toBe('partial');
    expect(result.profile!.dimensions.widthMm.value).toBeNull();
    expect(result.profile!.dimensions.lengthMm.value).toBeNull();
    expect(result.profile!.dimensions.heightMm.status).toBe('live_verified');
  });

  it('parses JSON-LD without executing scripts and sanitizes returned title metadata', () => {
    const html = `<title>M4 <img src=x onerror=bad()> page</title><script>throw new Error('do not execute');</script><script type="application/ld+json">${JSON.stringify({ '@graph': [syntheticCar()] })}</script>`;
    const result = parseOfficialVehicleDocument(html, 'text/html', m4(), 'official-m4', OFFICIAL_SOURCE_REGISTRY['bmw-m4-g82'][0].url);
    expect(result.dimensionsFound).toBe(4);
    expect(result.profile.sources.find(source => source.id === 'official-m4')?.title).toBe('M4 page');
  });

  it('refuses redirect SSRF, unsupported bodies, excessive redirects and oversized streamed responses', async () => {
    const cases = [
      { fetcher: vi.fn(async () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } })), code: 'UNSAFE_REDIRECT' },
      { fetcher: vi.fn(async () => new Response('pdf', { headers: { 'content-type': 'application/pdf' } })), code: 'UNSUPPORTED_CONTENT_TYPE' },
      { fetcher: vi.fn(async () => new Response(null, { status: 302, headers: { location: '/again' } })), code: 'REDIRECT_LIMIT' },
      { fetcher: vi.fn(async () => new Response('x'.repeat(1500), { headers: { 'content-type': 'text/html', 'content-length': '1500' } })), code: 'RESPONSE_TOO_LARGE' },
      { fetcher: vi.fn(async () => new Response('x'.repeat(1500), { headers: { 'content-type': 'text/html' } })), code: 'RESPONSE_TOO_LARGE' },
    ];
    for (const { fetcher, code } of cases) {
      const result = await new RealVehicleResearchProvider({ fetch: fetcher, maxBytes: 1024 }).research('BMW M4');
      expect(result.status).toBe('failed');
      expect(result.attempts[0].errorCode).toBe(code);
      expect(fetcher.mock.calls.length).toBeLessThanOrEqual(3);
    }
  });

  it('follows a bounded same-origin redirect while rejecting any caller URL as a source', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: '/vehicles/updated' } })).mockResolvedValueOnce(response(syntheticCar()));
    expect((await new RealVehicleResearchProvider({ fetch: fetcher }).research('BMW M4')).status).toBe('live_verified');
    expect(String(fetcher.mock.calls[1][0])).toBe('https://www.bmwusa.com/vehicles/updated');
    const forbidden = vi.fn();
    expect((await new RealVehicleResearchProvider({ fetch: forbidden }).research('http://127.0.0.1/')).status).toBe('not_found');
    expect(forbidden).not.toHaveBeenCalled();
  });

  it('aborts upstream requests at the configured deadline and never reports live success', async () => {
    const fetcher = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })));
    const result = await new RealVehicleResearchProvider({ fetch: fetcher, timeoutMs: 100 }).research('BMW M4');
    expect(result.status).toBe('failed');
    expect(result.attempts[0].errorCode).toBe('UPSTREAM_TIMEOUT');
  });
});

describe('source-aware discrete vehicle briefs', () => {
  const manual = () => createManualVehicleProfile({ manufacturer: 'Example', model: 'Measured sedan', vehicleType: 'luxury-sedan', dimensions: { lengthMm: 5300, widthMm: 1950, heightMm: 1500, wheelbaseMm: 3200 }, visualFeatures: { hoodLengthRatio: 0.27, cabinPositionRatio: 0.32 }, signatureFeatures: ['Long sedan body'] });

  it('derives target dimensions from supplied measurements and replans modules at each width', () => {
    const profile = manual();
    const briefs = [8, 10, 12].map(widthStuds => toVehicleDesignBrief(profile, { widthStuds }));
    for (const brief of briefs) {
      expect(brief.proportions.lengthStuds).toBe(Math.round(brief.targetWidthStuds * 5300 / 1950));
      expect(brief.proportions.wheelbaseStuds).toBe(Math.round(brief.proportions.lengthStuds * 3200 / 5300));
      expect(brief.proportions.heightPlates).toBe(Math.round(brief.targetWidthStuds * 1500 / 1950 * 2.5));
      expect(brief.proportions.frontOverhangStuds + brief.proportions.wheelbaseStuds + brief.proportions.rearOverhangStuds).toBe(brief.proportions.lengthStuds);
      expect(brief.modules.cockpit.startStuds + brief.modules.cockpit.lengthStuds).toBeLessThan(brief.proportions.lengthStuds);
      expect(brief.planningMethod).toBe('discrete-module-replanning');
      expect(brief.modules.leftSide).toEqual(brief.modules.rightSide);
    }
    expect(briefs[0].modules.chassis.heightPlates).toBe(briefs[2].modules.chassis.heightPlates);
    expect(briefs[2].modules.chassis.lengthStuds).not.toBe(briefs[0].modules.chassis.lengthStuds * 1.5);
    expect(briefs[2].proportions.wheelDiameterStuds).toBeGreaterThan(briefs[0].proportions.wheelDiameterStuds);
  });

  it('refuses silent fallback and labels every explicitly enabled class estimate', () => {
    const profile = getCatalogVehicleProfile('S63')!;
    expect(() => toVehicleDesignBrief(profile, 10)).toThrow(VehicleBriefError);
    const brief = toVehicleDesignBrief(profile, { widthStuds: 10, allowEstimatedProportions: true });
    expect(brief.dimensionBasis).toBe('estimated');
    expect(brief.assumptions.some(assumption => assumption.field === 'lengthStuds' && assumption.sourceIds.length === 0)).toBe(true);
    expect(brief.warnings.join(' ')).toMatch(/not measured specifications/);
    expect(profile.dimensions.lengthMm.value).toBeNull();
  });

  it('accepts custom integer widths, labels the recommendation, and rejects invalid scales', () => {
    expect(toVehicleDesignBrief(manual(), 14).targetWidthStuds).toBe(14);
    const recommendation = toVehicleDesignBrief(manual());
    expect(recommendation.targetWidthStuds).toBe(10);
    expect(recommendation.widthSelection).toBe('recommended');
    expect(recommendation.assumptions.some(assumption => assumption.field === 'targetWidthStuds')).toBe(true);
    for (const width of [0, 5, 25, 8.5, Infinity, NaN]) expect(() => toVehicleDesignBrief(manual(), width)).toThrow(/integer LEGO width/);
  });
});
