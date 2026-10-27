import { describe, expect, it } from 'vitest';
import { checkDigitalSourceAdmission, DIGITAL_SOURCE_POLICIES, PILOT_LDRAW_REVISION, PILOT_LDRAW_SOURCE_ROOT, PILOT_SHADOW_REVISION, PILOT_SHADOW_SOURCE_ROOT, type DigitalSourceAdmissionRequest } from '../src/parts/digitalImport/sources.js';

const ldraw = (): DigitalSourceAdmissionRequest => ({ sourceId: 'ldraw-pinned', role: 'geometry', sourceUrl: `${PILOT_LDRAW_SOURCE_ROOT}parts/3001.dat`, revision: PILOT_LDRAW_REVISION, license: 'Licensed under CC BY 4.0 : see CAreadme.txt', sha256: 'a'.repeat(64), attributionPresent: true, licenseCopyPresent: true });

describe('reviewed digital source policy', () => {
  it('accepts reviewed pinned LDraw geometry with licence and attribution evidence', () => {
    expect(checkDigitalSourceAdmission(ldraw())).toMatchObject({ allowed: true, reasonCodes: [] });
    const dual = ldraw(); dual.license = 'Licensed under CC BY 2.0 and CC BY 4.0 : see CAreadme.txt';
    expect(checkDigitalSourceAdmission(dual).allowed).toBe(true);
  });
  it('accepts Shadow only for connection data with its own share-alike terms', () => {
    const request = { ...ldraw(), sourceId: 'ldcad-shadow-pinned', role: 'connections' as const, sourceUrl: `${PILOT_SHADOW_SOURCE_ROOT}parts/3001.dat`, revision: PILOT_SHADOW_REVISION, license: 'CC-BY-SA-4.0' };
    expect(checkDigitalSourceAdmission(request)).toMatchObject({ allowed: true, reasonCodes: [] });
    expect(checkDigitalSourceAdmission({ ...request, role: 'geometry' }).reasonCodes).toContain('SOURCE_ROLE_NOT_ALLOWED');
    expect(checkDigitalSourceAdmission(request).licenseObligations.join(' ')).toContain('derived connection records');
  });
  it('fails closed for unreviewed revisions, licence, attribution and redistributed licence text', () => {
    for (const change of [{ revision: 'b'.repeat(40) }, { license: 'MIT' }, { attributionPresent: false }, { licenseCopyPresent: false }, { sha256: 'unknown' }]) expect(checkDigitalSourceAdmission({ ...ldraw(), ...change }).allowed).toBe(false);
  });
  it('does not grant source permission from a similar host, unpinned path or traversal', () => {
    for (const sourceUrl of [ldraw().sourceUrl.replace('raw.githubusercontent.com', 'raw.githubusercontent.com.example.org'), `${PILOT_LDRAW_SOURCE_ROOT}parts/../p/stud.dat`, `${PILOT_LDRAW_SOURCE_ROOT}parts/%2e%2e/p/stud.dat`, `${PILOT_LDRAW_SOURCE_ROOT}parts//3001.dat`, `${PILOT_LDRAW_SOURCE_ROOT}parts/3001.dat?raw=1`]) expect(checkDigitalSourceAdmission({ ...ldraw(), sourceUrl }).reasonCodes).toContain('SOURCE_URL_NOT_REVIEWED');
  });
  it('rejects Studio, mirrors, web scraping and inventory observations as public geometry sources', () => {
    for (const sourceId of ['studio-unreviewed', 'rebrickable-historical-mirror', 'bricklink-web', 'uploaded-instructions', 'rebrickable-official-api', 'unregistered-source']) expect(checkDigitalSourceAdmission({ ...ldraw(), sourceId }).allowed).toBe(false);
    expect(DIGITAL_SOURCE_POLICIES.filter(source => source.publicDigitalImport).map(source => source.id)).toEqual(['ldraw-pinned', 'ldcad-shadow-pinned']);
  });
});
