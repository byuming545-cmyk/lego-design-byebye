import { describe, expect, it } from 'vitest';
import { createBundledLDrawResolver } from '../src/parts/ldraw/index.js';
import { CONNECTION_PARSER_VERSION, createBundledConnectionImporter, importLdcadShadow } from '../src/parts/connections/index.js';
import type { ConnectionLibrary } from '../src/parts/connections/index.js';

// Synthetic syntax fixtures are never part definitions or production compatibility evidence.
const dimensionSource = '0 !LDCAD SNAP_CYL [id=retired] [gender=M] [caps=one] [secs=R 6 4]';
const goodSource = '0 !LDCAD SNAP_CYL [id=retained] [gender=F] [caps=one] [secs=S 6 4]';
function fixture(clear: string, inherited = dimensionSource, instances = 1): ConnectionLibrary {
  return {
    async getGeometryFile(name) {
      if (name === 'parts/test.dat') return Array(instances).fill('1 16 0 0 0 2 0 0 0 1 0 0 0 1 sub.dat').join('\n');
      return name === 'p/sub.dat' ? '0 Synthetic source child' : undefined;
    },
    async getShadowFile(name) {
      return name === 'p/sub.dat' ? inherited : name === 'parts/test.dat' ? `${clear}\n${goodSource}` : undefined;
    },
  };
}

describe('source SNAP_CLEAR diagnostic scope', () => {
  it('retires only dimension warnings whose emitted points were explicitly removed by CLEAR', async () => {
    const result = await importLdcadShadow('test', fixture('0 !LDCAD SNAP_CLEAR'));
    expect(result.status).toBe('ready');
    expect(result.parserVersion).toBe(CONNECTION_PARSER_VERSION);
    expect(result.points).toHaveLength(1);
    expect(result.points[0]).toMatchObject({ sourceId: 'retained', dimensionsResolved: true, sections: [{ profile: 'S', radius: 6, length: 4 }], physicalVerified: false });
    expect(result.discardedIssues).toHaveLength(1);
    expect(result.discardedIssues![0]).toMatchObject({ code: 'unsupported-scaling', file: 'p/sub.dat', line: 1, reason: 'source-clear-removed-all-affected-points', discardedBy: { file: 'parts/test.dat', line: 1, directive: '0 !LDCAD SNAP_CLEAR' } });
    expect(result.discardedIssues![0].affectedConnectionIds).toHaveLength(1);
    expect(result.physicalVerified).toBe(false);
  });
  it('keeps un-cleared scaled points partial and never derives their physical dimensions', async () => {
    const inherited = `${dimensionSource}\n${dimensionSource.replace('id=retired', 'id=still-unresolved')}`;
    const result = await importLdcadShadow('test', fixture('0 !LDCAD SNAP_CLEAR [id=retired]', inherited));
    expect(result.status).toBe('partial');
    expect(result.points.find(point => point.sourceId === 'still-unresolved')).toMatchObject({ dimensionsResolved: false, sections: [{ profile: 'R', radius: 6, length: 4 }] });
    expect(result.issues.some(issue => issue.code === 'unsupported-scaling')).toBe(true);
    expect(result.discardedIssues).toHaveLength(1);
  });
  it('does not erase unsupported grammar or evidence failures just because another point was cleared', async () => {
    const result = await importLdcadShadow('test', fixture('0 !LDCAD SNAP_CLEAR', `${dimensionSource}\n0 !LDCAD SNAP_FGR [seq=4 8 4]`));
    expect(result.status).toBe('partial');
    expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'unsupported-directive', directive: '0 !LDCAD SNAP_FGR [seq=4 8 4]' })]));
    expect(result.discardedIssues).toHaveLength(1);
    expect(result.discardedIssues!.every(issue => issue.code === 'unsupported-scaling')).toBe(true);
  });
  it('does not use an unknown CLEAR filter as evidence to suppress diagnostics', async () => {
    const result = await importLdcadShadow('test', fixture('0 !LDCAD SNAP_CLEAR [gender=M]'));
    expect(result.status).toBe('partial');
    expect(result.discardedIssues).toHaveLength(0);
    expect(result.issues.map(issue => issue.code)).toEqual(expect.arrayContaining(['unsupported-scaling', 'unsupported-directive']));
  });
  it('cannot become ready by clearing a truncated diagnostic batch', async () => {
    const result = await importLdcadShadow('test', fixture('0 !LDCAD SNAP_CLEAR', dimensionSource, 301));
    expect(result.points).toHaveLength(1);
    expect(result.status).toBe('partial');
    expect(result.issues.some(issue => issue.code === 'resource-limit')).toBe(true);
  });
  it('reparses the two real CLEAR sources without adding points or granting physical verification', async () => {
    const importer = createBundledConnectionImporter(await createBundledLDrawResolver());
    for (const [id, count] of [['30209', 18], ['29115', 61]] as const) {
      const result = await importer.importPart(id);
      expect(result.status).toBe('ready');
      expect(result.points).toHaveLength(count);
      expect(result.points.every(point => point.dimensionsResolved && !point.physicalVerified)).toBe(true);
      expect(result.discardedIssues!.length).toBeGreaterThan(0);
      expect(result.discardedIssues!.every(issue => issue.discardedBy.directive.startsWith('0 !LDCAD SNAP_CLEAR'))).toBe(true);
      expect(result.physicalVerified).toBe(false);
    }
  });
});
