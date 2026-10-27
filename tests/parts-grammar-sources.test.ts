import { describe, expect, it } from 'vitest';
import { NativePartRepository } from '../src/parts/assembly/source.js';
import { importLdcadShadow } from '../src/parts/connections/importer.js';
import {
  adaptImportedConnection, adaptNativePartConnectors, adaptStudioConnectivity,
  mergeConnectorSources, supportsStandardStudEndpoint,
} from '../src/parts/grammar/sources.js';
import type { ConnectorProvenance } from '../src/parts/grammar/schema.js';

const repository = new NativePartRepository();
const native = async (id: string) => (await repository.getPart(id))!;

describe('source-backed canonical connector ingestion', () => {
  it('adapts actual pinned native C01 endpoints without converting metadata into physical build claims', async () => {
    const part = await native('3001'), ingestion = adaptNativePartConnectors(part);
    expect(ingestion.coverage).toBe('COMPLETE');
    expect(ingestion.connectors).toHaveLength(part.connections.points.length);
    expect(new Set(ingestion.connectors.map(connector => connector.family))).toEqual(new Set(['STUD', 'ANTISTUD']));
    for (const connector of ingestion.connectors) {
      expect(connector.confidence).toBe('SOURCE_BACKED');
      expect(connector.matchingPolicy).toMatchObject({ ruleId: 'C01', kind: 'STANDARD_STUD' });
      expect(connector.sources[0]).toMatchObject({ kind: 'LDCAD_SHADOW', verification: 'SOURCE_DECLARED', license: 'CC-BY-SA-4.0' });
      expect(connector.sources.every(source => source.kind !== 'REAL_BUILD_VERIFIED')).toBe(true);
      expect(connector.sourceConnectionId).toBe(connector.featureId);
    }
    expect(ingestion.sourceSummary.STUDIO_CONNECTIVITY.features).toBe(0);
    expect(ingestion.sourceSummary.LDRAW_PRIMITIVE.features).toBe(0);
  });

  it('retains recursive source transformations and isolates unresolved inherited dimensions from supported endpoints', async () => {
    const part = await native('3004'), ingestion = adaptNativePartConnectors(part);
    expect(ingestion.coverage).toBe('PARTIAL');
    const unresolved = part.connections.points.find(point => !point.dimensionsResolved)!;
    expect(unresolved).toBeDefined();
    const feature = ingestion.connectors.find(feature => feature.featureId === unresolved.id)!;
    expect(feature.coverage).toBe('PARTIAL');
    expect(feature.matchingPolicy).toBeNull();
    expect(ingestion.rawEvidence[feature.featureId]).toMatchObject({ originalSourceId: unresolved.sourceId, source: { transforms: unresolved.source.transforms } });
    expect(ingestion.connectors.some(feature => feature.coverage === 'COMPLETE' && feature.matchingPolicy?.ruleId === 'C01')).toBe(true);
    expect(ingestion.unknownInterfaces.some(issue => issue.code === 'unsupported-scaling')).toBe(true);
  });

  it('never turns a pin hole or an equally sized unnamed cylinder into a standard-stud endpoint, while sourcing a declared Bar from its root description', async () => {
    const part = await native('32000'), result = adaptNativePartConnectors(part);
    const holes = result.connectors.filter(feature => feature.family === 'PIN_HOLE');
    expect(holes.length).toBeGreaterThan(0);
    expect(holes.every(feature => feature.matchingPolicy === null && feature.coverage === 'PARTIAL')).toBe(true);
    expect(result.connectors.some(feature => feature.matchingPolicy?.ruleId === 'C01')).toBe(true);
    const bar = await native('30374');
    expect(bar.connections.points).toHaveLength(1);
    const cylinder = adaptImportedConnection(bar.connections.points[0]);
    expect(cylinder.family).toBe('BAR');
    expect(cylinder.coverage).toBe('COMPLETE');
    expect(cylinder.unknownFields).toContain('retention');
    expect(cylinder.slideAllowed).toBe(true);
    expect(cylinder.axialSpanLdu).toEqual([-40, 40]);
    expect(cylinder.matchingPolicy).toMatchObject({ ruleId: 'BAR_CLIP', kind: 'SOURCE_DECLARED_FIT' });
  });

  it('preserves explicitly colocated independent features and never fabricates a hollow stud centre hole', async () => {
    // Synthetic parser-only source, deliberately absent from the production library.
    const parsed = await importLdcadShadow('fixture', {
      getGeometryFile: async name => name === 'parts/fixture.dat' ? '0 Test-only synthetic connector parser fixture' : undefined,
      getShadowFile: async name => name === 'parts/fixture.dat' ? [
        '0 !LDCAD SNAP_CYL [id=studO] [gender=M] [caps=one] [secs=R 6 4]',
        '0 !LDCAD SNAP_CYL [gender=F] [caps=none] [secs=R 4 8]',
      ].join('\n') : undefined,
    });
    const features = parsed.points.map(adaptImportedConnection);
    expect(features).toHaveLength(2);
    expect(features[0].localPositionLdu).toEqual(features[1].localPositionLdu);
    expect(new Set(features.map(feature => feature.featureId)).size).toBe(2);
    expect(features.map(feature => feature.family)).toEqual(['HOLLOW_STUD', 'GENERIC_SPECIAL']);
    expect(adaptImportedConnection(parsed.points[0]).family).toBe('HOLLOW_STUD');
    expect(features.every(feature => feature.family !== 'BAR_HOLE' && feature.matchingPolicy === null)).toBe(true);
  });

  it('does not silently grant scope to altered source sections or provenance', async () => {
    const point = structuredClone((await native('3001')).connections.points.find(point => point.gender === 'M')!);
    expect(supportsStandardStudEndpoint(point)).toBe(true);
    point.sections[0].length = 5;
    expect(supportsStandardStudEndpoint(point)).toBe(false);
    point.sections[0].length = 4; point.source.revision = 'not-the-pinned-revision';
    expect(adaptImportedConnection(point)).toMatchObject({ confidence: 'UNKNOWN', coverage: 'PARTIAL', matchingPolicy: null });
    const scale = structuredClone((await native('3001')).connections.points.find(point => point.gender === 'M')!);
    scale.source.raw += ' [scale=unreviewed-mode]'; scale.properties.scale = 'unreviewed-mode';
    expect(scale.dimensionsResolved).toBe(true);
    expect(supportsStandardStudEndpoint(scale)).toBe(false);
    expect(adaptImportedConnection(scale).matchingPolicy).toBeNull();
  });

  it('preserves unsupported finger/grid/section diagnostics without invented replacement endpoints', async () => {
    const pin = adaptNativePartConnectors(await native('3673'));
    expect(pin.unknownInterfaces.some(issue => issue.raw?.includes('L_ 6.25'))).toBe(true);
    expect(pin.connectors.every(feature => feature.family !== 'PIN')).toBe(true);
    expect(pin.connectors.every(feature => feature.friction === 'UNKNOWN')).toBe(true);
    const tyre = adaptNativePartConnectors(await native('18977'));
    expect(tyre.coverage).toBe('NONE'); expect(tyre.connectors).toEqual([]);
    const hinge = adaptNativePartConnectors(await native('2418a'));
    const finger = hinge.unknownInterfaces.find(issue => issue.familyHint === 'HINGE_FINGER')!;
    expect(finger).toBeDefined();
    expect(finger.raw).toContain('SNAP_FGR');
    expect(finger.literalProperties).toContainEqual({ key: 'seq', value: '18 4 18' });
    expect(finger.inheritedTransforms!.length).toBeGreaterThan(0);
    expect(finger.source?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.values(hinge.rawEvidence).some(evidence => 'unparsed' in evidence && evidence.familyHint === 'HINGE_FINGER')).toBe(true);
    expect(hinge.connectors.every(feature => feature.family !== 'HINGE_FINGER')).toBe(true);
  });

  it('accounts for every source point in the complete real 253-root library without any part-ID mapping list', async () => {
    let points = 0, features = 0;
    const ids = await repository.listIds(); expect(ids).toHaveLength(253);
    for (const id of ids) {
      const part = await native(id), ingestion = adaptNativePartConnectors(part);
      expect(ingestion.connectors.map(feature => feature.sourceConnectionId)).toEqual(part.connections.points.map(point => point.id));
      expect(ingestion.sourceSummary.LDCAD_SHADOW.features).toBe(part.connections.points.length);
      points += part.connections.points.length; features += ingestion.connectors.length;
      expect(ingestion.connectors.every(feature => feature.sources.some(source => source.kind === 'LDCAD_SHADOW'))).toBe(true);
      // Changing a display/part identifier cannot confer or remove interface knowledge.
      if (id === '3001') expect(adaptNativePartConnectors({ ...part, partId: 'test-only-unseen-id' }).connectors).toEqual(ingestion.connectors);
    }
    expect(points).toBe(5084); expect(features).toBe(points);
  }, 30000);
});

describe('source conflict and permitted Studio metadata adapters', () => {
  it('quarantines conflicting source claims rather than choosing the last or highest-looking source', async () => {
    const base = adaptNativePartConnectors(await native('3001')).connectors[0];
    const changed = structuredClone(base); changed.localPositionLdu[0] += 1;
    const merged = mergeConnectorSources([base], [changed]);
    expect(merged.connectors[0]).toMatchObject({ coverage: 'PARTIAL', matchingPolicy: null });
    expect(merged.conflicts[0].resolution).toBe('QUARANTINED');
    expect(merged.conflicts[0].candidate.localPositionLdu).not.toEqual(merged.conflicts[0].retained.localPositionLdu);
  });

  it('requires an explicit trusted reviewed override and retains both assertions in the conflict ledger', async () => {
    const base = adaptNativePartConnectors(await native('3001')).connectors[0], changed = structuredClone(base);
    changed.localPositionLdu[0] += 1;
    const evidence: ConnectorProvenance = { id: 'test-only-review-record', kind: 'VERIFIED_MANUAL', reference: 'test-only://review', revision: 'fixture', sha256: 'a'.repeat(64), license: 'test-fixture-only', line: null, raw: null, verification: 'VERIFIED', scope: 'PRODUCTION', notes: ['Synthetic conflict-handling fixture only; not a LEGO source.'] };
    changed.sources = [evidence];
    expect(mergeConnectorSources([base], [changed]).conflicts[0].resolution).toBe('QUARANTINED');
    const approved = mergeConnectorSources([base], [changed], { approvedOverrideSourceIds: new Set([evidence.id]) });
    expect(approved.conflicts[0].resolution).toBe('EXPLICIT_VERIFIED_OVERRIDE');
    expect(approved.connectors[0].localPositionLdu).toEqual(changed.localPositionLdu);
    expect(approved.conflicts[0].retained).toEqual(base);
    expect(approved.diagnostics[0].code).toBe('EXPLICIT_SOURCE_OVERRIDE');
  });

  it('preserves coincident feature IDs and merges identical source assertions without changing geometry', async () => {
    const base = adaptNativePartConnectors(await native('3001')).connectors[0];
    const coincident = { ...structuredClone(base), featureId: 'independent-feature-at-same-position', matchingPolicy: null };
    const merged = mergeConnectorSources([base], [structuredClone(base), coincident]);
    expect(merged.connectors).toHaveLength(2); expect(merged.conflicts).toEqual([]);
  });

  it('does not consume or redistribute unlicensed Studio data and retains original type IDs for diagnosis', () => {
    const records = [{ featureId: 'studio-fixture', originalTypeId: 9999, localPositionLdu: [0, 0, 0] as [number, number, number], localOrientation: [1, 0, 0, 0, 1, 0, 0, 0, 1] as [number, number, number, number, number, number, number, number, number], axis: [0, -1, 0] as [number, number, number], raw: 'Synthetic normalized Studio test record; no proprietary .conn file' }];
    const grant = { permissionConfirmed: false, redistributionAllowed: false, license: null, reference: 'test-fixture-only', revision: null, artifactSha256: 'a'.repeat(64) };
    const result = adaptStudioConnectivity(records, grant);
    expect(result.coverage).toBe('NONE'); expect(result.connectors).toEqual([]);
    expect(result.unknownInterfaces[0]).toMatchObject({ code: 'STUDIO_PERMISSION_UNCONFIRMED', originalTypeId: '9999' });
    expect(result.rawEvidence['studio-fixture']).toMatchObject({ originalTypeId: '9999' });
    expect(result.rawEvidence['studio-fixture']).toMatchObject({ raw: '' });
    expect(result.unknownInterfaces[0].raw).toBeNull();
    const permitted = adaptStudioConnectivity(records, { ...grant, permissionConfirmed: true, redistributionAllowed: true, license: 'Synthetic test fixture permission' });
    expect(permitted.connectors[0]).toMatchObject({ family: 'GENERIC_SPECIAL', confidence: 'UNKNOWN', matchingPolicy: null });
    expect(permitted.unknownInterfaces[0].code).toBe('STUDIO_TYPE_MAPPING_UNRESOLVED');
  });
});
