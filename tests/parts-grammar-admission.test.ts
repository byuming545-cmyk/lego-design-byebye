import { beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { NativePartRepository } from '../src/parts/assembly/source.js';
import type { NativeAssemblyPart } from '../src/parts/assembly/types.js';
import { AttachmentEngine } from '../src/parts/assembly/engine.js';
import { assessGrammarAdmission } from '../src/parts/grammar/admission.js';
import { GrammarAssemblyService } from '../src/parts/grammar/service.js';

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

  it('keeps 32000 pin holes disabled when its ordinary endpoints inherit C01', async () => {
    const part = (await repository.getPart('32000'))!, admission = assessGrammarAdmission(part);
    expect(admission.generationEligible).toBe(true);
    expect(admission.capability.allowedConnectionIds).toHaveLength(4);
    const holes = part.connections.points.filter(point => point.family === 'pinHole');
    expect(holes.length).toBeGreaterThan(0);
    expect(holes.every(point => !admission.capability.allowedConnectionIds.includes(point.id))).toBe(true);
    expect(admission.featureSupport.filter(feature => feature.family === 'PIN_HOLE').every(feature => !feature.supported)).toBe(true);
  });

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
