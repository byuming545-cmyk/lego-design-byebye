import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createBundledLDrawResolver, loadBundledLDrawManifest } from '../src/parts/ldraw/index.js';
import { createBundledConnectionImporter } from '../src/parts/connections/index.js';
import { buildConnectionParseAudit, type ParseAuditInput } from '../src/parts/connections/audit.js';

let reportPromise: ReturnType<typeof loadAudit> | undefined;
async function loadAudit() {
  const importer = createBundledConnectionImporter(await createBundledLDrawResolver());
  const inputs: ParseAuditInput[] = [];
  for (const root of (await loadBundledLDrawManifest()).roots) inputs.push({ partId: root.partId, name: root.name, result: await importer.importPart(root.partId) });
  return buildConnectionParseAudit(inputs);
}
const report = () => reportPromise ??= loadAudit();

describe('complete pinned Connection Parse Audit', () => {
  it('accounts for all roots and every remaining issue with literal source evidence or an explicit missing-evidence outcome', async () => {
    const audit = await report();
    expect(audit.counts).toMatchObject({ roots: 253, ready: 206, partial: 43, missing: 4, retainedRawConnectionRecords: 5085, activeFailureInstances: 113, discardedDimensionWarnings: 3 });
    expect(audit.failures).toHaveLength(113);
    expect(new Set(audit.parts.map(part => part.partId)).size).toBe(253);
    for (const failure of audit.failures) {
      expect(failure.expectedInterpretation.status).toBe('EXPECTED_UNKNOWN');
      expect(failure.sourceClosureSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(failure.reproductionCommand).toContain(`--part ${failure.partId}`);
      expect(failure.whySolStopped.length).toBeGreaterThan(20);
      if (failure.disposition === 'EVIDENCE_MISSING') {
        expect(failure.instruction).toBeNull();
        expect(failure.sourceLine).toBeNull();
        expect(failure.source).toBeNull();
      } else {
        expect(failure.sourceLine).toBeGreaterThan(0);
        expect(failure.source?.sha256).toMatch(/^[a-f0-9]{64}$/);
        expect(failure.instruction).toMatch(/^0 !LDCAD SNAP_/);
      }
    }
    expect(audit.categories).toEqual({ CONNECTION_EVIDENCE_MISSING: 4, FINGER_JOINT_GRAMMAR: 9, GRID_GRAMMAR: 2, INCLUDE_OVERRIDE: 4, INHERITED_SCALING: 94 });
  });
  it('preserves every pre-fix point/source record except the documented 3673 PIN reclassification, and retires only the three explicit CLEAR warnings', async () => {
    const audit = await report();
    const before = JSON.parse(await readFile(new URL('../artifacts/connection-parse-audit/before.json', import.meta.url), 'utf8')) as { parts: { partId: string; pointSha256: string; sourceClosureSha256: string }[] };
    const currentById = new Map(audit.parts.map(part => [part.partId, part]));
    for (const previous of before.parts) {
      const part = currentById.get(previous.partId)!;
      expect(part, previous.partId).toBeDefined();
      if (previous.partId === '3673') {
        // The source bytes did not change; the canonical point now records the
        // newly supported L_ pin sections and PIN family.
        expect(part.pointSha256, part.partId).not.toBe(previous.pointSha256);
        expect(part.sourceClosureSha256, part.partId).toBe(previous.sourceClosureSha256);
        continue;
      }
      expect(part.pointSha256, part.partId).toBe(previous.pointSha256);
      expect(part.sourceClosureSha256, part.partId).toBe(previous.sourceClosureSha256);
    }
    const oldIds = new Set(before.parts.map(part => part.partId));
    const added = audit.parts.filter(part => !oldIds.has(part.partId));
    expect(new Set(added.map(part => part.partId))).toEqual(new Set(['32000', '3623', '60479', '78329', '3456', '69729', '6934', '41539']));
    for (const part of added) {
      expect(part.status).toBe('ready');
      expect(part.pointCount).toBeGreaterThan(0);
      expect(part.pointSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(part.sourceClosureSha256).toMatch(/^[a-f0-9]{64}$/);
    }
    expect(new Set(audit.discarded.map(issue => issue.partId))).toEqual(new Set(['30209', '29115']));
    expect(audit.discarded.every(issue => issue.code === 'unsupported-scaling' && issue.discardedBy.directive.startsWith('0 !LDCAD SNAP_CLEAR') && issue.affectedConnectionIds.length > 0)).toBe(true);
    expect(audit.parts.every(part => !('generatable' in part) && !('assemblyVerified' in part))).toBe(true);
    expect(audit.failures.find(failure => failure.partId === '3673')).toBeUndefined();
  });
});
