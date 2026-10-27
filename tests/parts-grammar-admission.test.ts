import { beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { NativePartRepository } from '../src/parts/assembly/source.js';
import type { NativeAssemblyPart } from '../src/parts/assembly/types.js';
import { AttachmentEngine } from '../src/parts/assembly/engine.js';
import { assessGrammarAdmission } from '../src/parts/grammar/admission.js';
import { GrammarAssemblyService } from '../src/parts/grammar/service.js';
import { BAR_CLIP_RULE_ID, PIN_HOLE_RULE_ID } from '../src/parts/assembly/compatibility.js';
import { exportNativeAssemblyJson } from '../src/parts/assembly/documents.js';

const repository = new NativePartRepository();
const service = new GrammarAssemblyService({ repository, dataDir: '/tmp/grammar-test-no-historical-report' });
let brick: NativeAssemblyPart;
beforeAll(async () => { brick = (await repository.getPart('3001'))!; }, 30_000);

describe('source-derived interface grammar admission', () => {
  it('derives ordinary stud scope from one new source record without any mate catalog or remembered fixture', () => {
    const admission = assessGrammarAdmission(brick);
    expect(admission).toMatchObject({ sourceReady: true, connectable: true, collisionGeometryReady: true,
      generationEligible: true, assemblyVerified: false, generatorSmokePassed: false, physicalBuildVerified: false });
    expect(admission.featureSupport.filter(feature => feature.supported)).toHaveLength(16);
    expect(admission.capability).toMatchObject({ admissionBasis: 'interface-grammar', generatable: true, assemblyVerified: false });
    expect(admission.capability.allowedConnectionIds).toHaveLength(16);
    expect('fixturePartId' in admission).toBe(false);
  });

  it('isolates unresolved inherited dimensions without inventing their physical sizes or blocking resolved ordinary endpoints', async () => {
    const part = (await repository.getPart('3004'))!;
    expect(part.connections.status).toBe('partial');
    const admission = assessGrammarAdmission(part);
    expect(admission.sourceReady).toBe(true);
    expect(admission.generationEligible).toBe(true);
    const unresolved = part.connections.points.filter(point => !point.dimensionsResolved);
    expect(unresolved.length).toBeGreaterThan(0);
    expect(unresolved.some(point => point.sourceId === 'stud3')).toBe(true);
    expect(unresolved.every(point => !admission.capability.allowedConnectionIds.includes(point.id))).toBe(true);
    expect(admission.ingestion.coverage).toBe('PARTIAL');
    expect(admission.capability.allowedConnectionIds.length).toBeGreaterThan(0);
  });

  it('does not isolate unknown include/clear/structural syntax as if all remaining points were trustworthy', () => {
    const part = structuredClone(brick);
    part.connections.status = 'partial';
    part.connections.issues.push({ code: 'unsupported-directive', file: 'parts/test-only.dat', line: 1,
      message: 'Synthetic negative parser condition, not a real LEGO part definition.' });
    const admission = assessGrammarAdmission(part);
    expect(admission.sourceReady).toBe(false);
    expect(admission.generationEligible).toBe(false);
    expect(admission.capability.allowedConnectionIds).toEqual([]);
    expect(admission.reasonCodes).toContain('grammar-source-interpretation-incomplete');
  });

  it('admits 32000 pin holes only through the source-declared PIN_HOLE policy', async () => {
    const part = (await repository.getPart('32000'))!, admission = assessGrammarAdmission(part);
    expect(admission.generationEligible).toBe(true);
    expect(admission.capability.allowedConnectionIds).toHaveLength(6);
    const holes = part.connections.points.filter(point => point.family === 'pinHole');
    expect(holes.length).toBeGreaterThan(0);
    expect(holes.every(point => admission.capability.allowedConnectionIds.includes(point.id))).toBe(true);
    expect(admission.featureSupport.filter(feature => feature.family === 'PIN_HOLE').every(feature => feature.supported && feature.ruleIds.includes(PIN_HOLE_RULE_ID))).toBe(true);
  });

  it('admits the source-declared BAR and source-open CLIP seat surfaces without promoting unrelated R4 cylinders', async () => {
    const bar = assessGrammarAdmission((await repository.getPart('30374'))!);
    expect(bar).toMatchObject({ connectable: true, collisionGeometryReady: true, generationEligible: true });
    expect(bar.featureSupport.find(feature => feature.family === 'BAR')).toMatchObject({ supported: true, ruleIds: [BAR_CLIP_RULE_ID] });
    expect(bar.capability?.ruleIds).toContain(BAR_CLIP_RULE_ID);

    for (const partId of ['48729b', '60470b'] as const) {
      const clip = assessGrammarAdmission((await repository.getPart(partId))!);
      expect(clip.connectable, partId).toBe(true);
      expect(clip.collisionGeometryReady, partId).toBe(true);
      expect(clip.generationEligible, partId).toBe(true);
      expect(clip.proxy, partId).toMatchObject({ status: 'ready', reasonCode: 'source-open-surface-clip' });
      expect(clip.capability?.allowedConnectionIds.length, partId).toBeGreaterThan(0);
      expect(clip.featureSupport.filter(feature => feature.family === 'CLIP').every(feature => feature.supported), partId).toBe(true);
      expect(clip.featureSupport.filter(feature => feature.family === 'BAR').length, partId).toBe(partId === '48729b' ? 1 : 0);
    }

    const ambiguous = (await repository.getPart('2412b'))!;
    expect(ambiguous.connections.points.filter(point => point.family === 'bar')).toHaveLength(0);
    expect(assessGrammarAdmission(ambiguous).featureSupport.filter(feature => feature.family === 'BAR')).toHaveLength(0);
  }, 30_000);

  it('requires actual source identity and integrity instead of reported geometry or fixture success flags', () => {
    const wrongIdentity = structuredClone(brick); wrongIdentity.partId = 'test-only-identity-mismatch';
    expect(assessGrammarAdmission(wrongIdentity).generationEligible).toBe(false);
    const noIntegrity = structuredClone(brick); noIntegrity.geometry.source.integrity = 'not-manifested';
    expect(assessGrammarAdmission(noIntegrity).generationEligible).toBe(false);
    const noLicense = structuredClone(brick); noLicense.geometry.source.licenseStatus = 'unknown';
    expect(assessGrammarAdmission(noLicense).generationEligible).toBe(false);
  });

  it('keeps unknown external shells and missing wheel connectivity blocked', async () => {
    const curved = assessGrammarAdmission((await repository.getPart('11477'))!);
    expect(curved.collisionGeometryReady).toBe(false);
    expect(curved.generationEligible).toBe(false);
    expect(curved.reasonCodes.some(reason => reason.startsWith('grammar-collision-'))).toBe(true);
    const tyre = assessGrammarAdmission((await repository.getPart('18977'))!);
    expect(tyre.connectable).toBe(false);
    expect(tyre.generationEligible).toBe(false);
  });

  it('does not promote an endpoint whose reported dimensions contradict its retained original directive', () => {
    const modified = structuredClone(brick), point = modified.connections.points[0];
    point.sections[0].radius = 5;
    const admission = assessGrammarAdmission(modified);
    expect(admission.capability.allowedConnectionIds).not.toContain(point.id);
    expect(admission.featureSupport.find(feature => feature.sourceConnectionId === point.id)?.supported).toBe(false);
  });

  it('the production service works without migration.json and does not relabel grammar admission as executed assembly PASS', async () => {
    const status = await service.status();
    expect(status.admissionBasis).toBe('interface-grammar');
    expect(status.runtimeValidation).toMatchObject({ status: 'ready', reportLoaded: false });
    expect(status.counts.total).toBe(253);
    expect(status.counts.generatable).toBeGreaterThan(0);
    expect(status.counts.assemblyVerified).toBe(0);
    expect(status.counts.verifiedInterfaces).toBe(0);
    expect(status.grammar.counts).toMatchObject({ historicalFixtureProofsRequired: 0, executedPartFixtureTests: 0, physicalBuildsVerified: 0 });
    expect(status.fixtures).toEqual([]);
    const entry = (await service.getEntry('3004'))!;
    expect(entry).toMatchObject({ status: 'grammarEligible', generatable: true, assemblyVerified: false,
      scope: 'source-backed-grammar-interfaces-only', generatorSmokePassed: false, fixtureTestsPassed: 0 });
    expect(entry.fixtures).toEqual([]);
    expect(entry.verifiedConnectionIds).toEqual([]);
    expect(entry.interfaceCoverage?.verifiedPass).toBe(0);
    expect(entry.interfaceCoverage?.pending).toBe(entry.physicalInterfaceCount);
  }, 60_000);

  it('returns capability copies rather than allowing a caller to activate unknown endpoints', async () => {
    const first = (await service.getCapability('32000'))!;
    first.allowedConnectionIds.push('test-only-forged-hole');
    first.generatable = false;
    const current = (await service.getCapability('32000'))!;
    expect(current.allowedConnectionIds).not.toContain('test-only-forged-hole');
    expect(current.generatable).toBe(true);
  }, 30_000);

  it('retains grammar readiness for every historically eligible source without inheriting its fixture success flags', async () => {
    // This baseline is a regression oracle only, never an admission input.
    const historical = JSON.parse(await readFile(new URL('../data/parts-foundation/assembly/migration.json', import.meta.url), 'utf8')) as {
      entries: { partId: string; generatable: boolean }[];
    };
    const previous = historical.entries.filter(entry => entry.generatable);
    expect(previous).toHaveLength(87);
    for (const record of previous) {
      const capability = (await service.getCapability(record.partId))!;
      expect(capability.generatable, record.partId).toBe(true);
      expect(capability.assemblyVerified, record.partId).toBe(false);
    }
  }, 30_000);

  it('revokes a stale grammar capability even if its old generatable flag and endpoint list remain set', async () => {
    const stale = (await service.getCapability('3001'))!;
    expect(stale.generatable).toBe(true);
    stale.grammarVersion = 'obsolete-connector-grammar';
    const engine = new AttachmentEngine({ mode: 'production', loadPart: id => repository.getPart(id), getCapability: () => stale });
    await expect(engine.createAssembly('3001')).rejects.toThrow();
  }, 30_000);

  it('generates a source-backed Pin-PinHole model and reimports its exported JSON', async () => {
    const generated = await service.generate({ module: 'pin-hole' });
    expect(generated.status, generated.reasons.join('; ')).toBe('generated');
    const model = generated.model!;
    expect(model.placements.map(placement => placement.partId).sort()).toEqual(['32000', '3673']);
    expect(model.edges).toHaveLength(1);
    expect(model.edges[0].ruleId).toBe(PIN_HOLE_RULE_ID);
    expect(model.steps).toHaveLength(2);
    expect(model.assemblyValidation.valid).toBe(true);
    const adopted = await service.importModel(JSON.parse(exportNativeAssemblyJson(model)));
    expect(adopted.status, adopted.reasons.join('; ')).toBe('VALID');
    expect(adopted.model?.bom.map(row => row.partId).sort()).toEqual(['32000', '3673']);
    await expect(service.generate({ module: 'pin-hole', partCount: 3 })).rejects.toThrow('固定');
  }, 30_000);

  it('generates a source-backed Bar-Clip model and reimports its exported JSON', async () => {
    const generated = await service.generate({ module: 'bar-clip' });
    expect(generated.status, generated.reasons.join('; ')).toBe('generated');
    const model = generated.model!;
    expect(model.placements.map(placement => placement.partId).sort()).toEqual(['30374', '48729b']);
    expect(model.edges).toHaveLength(1);
    expect(model.edges[0].ruleId).toBe(BAR_CLIP_RULE_ID);
    expect(model.steps).toHaveLength(2);
    expect(model.bom.reduce((sum, row) => sum + row.quantity, 0)).toBe(2);
    expect(model.assemblyValidation.valid).toBe(true);
    const exported = exportNativeAssemblyJson(model);
    const adopted = await service.importModel(JSON.parse(exported));
    expect(adopted.status, adopted.reasons.join('; ')).toBe('VALID');
    expect(adopted.model?.bom.map(row => row.partId).sort()).toEqual(['30374', '48729b']);
    await expect(service.generate({ module: 'bar-clip', partCount: 3 })).rejects.toThrow('固定');
  }, 30_000);

  it('allows ordinary production generation and current export reimport without a per-part success cache', async () => {
    const generated = await service.generate({ module: 'platform', partCount: 3, requiredPartIds: ['3623'] });
    expect(generated.status, generated.reasons.join('; ')).toBe('generated');
    expect(generated.model?.placements.some(placement => placement.partId === '3623')).toBe(true);
    expect(generated.model?.assemblyValidation.valid).toBe(true);
    const adopted = await service.importModel(generated.model);
    expect(adopted.status, adopted.reasons.join('; ')).toBe('VALID');
    expect(adopted.model?.bom.some(row => row.partId === '3623')).toBe(true);
    expect((await service.getEntry('3623'))!.assemblyVerified).toBe(false);
  }, 30_000);
});
