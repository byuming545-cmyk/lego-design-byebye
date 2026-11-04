import { describe, it, expect } from 'vitest';
import { NativePartRepository } from '../src/parts/assembly/source.js';
import { analyzeConnectionImpact } from '../src/parts/connections/impact.js';
import { hasIsolatedUnknownDimensions } from '../src/parts/assembly/types.js';
import { assessGrammarAdmission } from '../src/parts/grammar/admission.js';
const repository = new NativePartRepository();
describe('source-linked connection issue impact', () => {
  it('isolates only the exact unresolved occurrence in real 3062b, without granting its other features', async () => {
    const part=(await repository.getPart('3062b'))!;
    const report=analyzeConnectionImpact(part.connections);
    expect(report.canIsolateDimensionFailures).toBe(true);
    expect(report.isolatedConnectionIds).toEqual(['p/stud4od.dat:8:1']);
    expect(report.locallyUnaffectedConnectionIds).toContain('p/stud2a.dat:11:0');
    expect(assessGrammarAdmission(part).capability.allowedConnectionIds).toEqual(['p/stud2a.dat:11:0']);
  });
  it('does not infer scope from a scaling error code alone, or from another inherited transform', async () => {
    const part=structuredClone((await repository.getPart('3062b'))!);
    part.connections.issues=part.connections.issues.map(issue=>({...issue,source:undefined}));
    expect(hasIsolatedUnknownDimensions(part)).toBe(false);
    expect(analyzeConnectionImpact(part.connections).wholePartUnknown).toBe(true);
    const changed=structuredClone((await repository.getPart('3062b'))!);
    changed.connections.issues[0].transforms![0].position[0]+=20;
    expect(hasIsolatedUnknownDimensions(changed)).toBe(false);
  });
  it('never isolates missing include, unknown syntax, integrity or resource failure away from valid-looking endpoints', async () => {
    for(const code of ['missing-shadow-include','unsupported-directive','integrity-failure','resource-limit'] as const){
      const part=structuredClone((await repository.getPart('3062b'))!);
      part.connections.issues.push({code,file:'ALGORITHM_FIXTURE',message:'Explicit negative fixture; not a real source record.'});
      const report=analyzeConnectionImpact(part.connections);
      expect(report.wholePartUnknown).toBe(true);expect(report.locallyUnaffectedConnectionIds).toEqual([]);
      expect(hasIsolatedUnknownDimensions(part)).toBe(false);
    }
  });
  it('reports the normal real plate without inventing unknown interfaces', async () => {
    const part=(await repository.getPart('3024'))!;
    const report=analyzeConnectionImpact(part.connections);
    expect(report.issues).toEqual([]);expect(report.wholePartUnknown).toBe(false);
    expect(report.locallyUnaffectedConnectionIds.length).toBeGreaterThan(0);
  });
  it('keeps incomplete diagnostics and missing dimension flags unknown rather than treating absence as proof', async () => {
    // Explicit malformed adapter fixtures, never written to source data.
    const silent=structuredClone((await repository.getPart('3062b'))!);
    silent.connections.issues=[];
    expect(analyzeConnectionImpact(silent.connections)).toMatchObject({wholePartUnknown:true,canIsolateDimensionFailures:false,locallyUnaffectedConnectionIds:[]});
    const absentFlag=structuredClone((await repository.getPart('3062b'))!);
    Reflect.deleteProperty(absentFlag.connections.points.find(p=>p.id==='p/stud4od.dat:8:1')!,'dimensionsResolved');
    expect(hasIsolatedUnknownDimensions(absentFlag)).toBe(false);
  });
});
