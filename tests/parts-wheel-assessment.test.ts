import { beforeAll, describe, expect, it } from 'vitest';
import { NativePartRepository } from '../src/parts/assembly/source.js';
import { assessWheelAssemblySources, inspectWheelMatingCandidate } from '../src/parts/assembly/wheelAssessment.js';
import { checkConnectionCompatibility } from '../src/parts/assembly/compatibility.js';

const repository = new NativePartRepository();
let assessment: Awaited<ReturnType<typeof assessWheelAssemblySources>>;
beforeAll(async () => { assessment = await assessWheelAssemblySources(id => repository.getPart(id)); });

describe('wheel source evidence and strict mechanical boundary', () => {
  it('loads four genuine sources but does not claim a complete wheel assembly or any output artifacts', () => {
    expect(assessment.parts.map(part => part.partId)).toEqual(['18975', '3673', '66727', '18977']);
    expect(assessment.parts.every(part => part.sourcePresent && part.sourceVerified && part.geometryStatus === 'geometryReady')).toBe(true);
    expect(assessment.parts.every(part => part.geometryFiles.length > 0 && part.nativeSourceHash?.length === 64)).toBe(true);
    expect(assessment).toMatchObject({ status: 'blocked', assessmentOnly: true, productionGeneratorEnabled: false,
      artifacts: { modelProduced: false, bomProduced: false, stepsProduced: false, exportReimportVerified: false },
      claims: { finalPoseVerified: false, rotationClearanceVerified: false, installationPathVerified: false, physicalBuildVerified: false } });
  });

  it('reports missing tyre endpoints and unsupported pin/grid interpretation with original source lines', () => {
    const tyre = assessment.parts.find(part => part.partId === '18977')!;
    expect(tyre.connectionStatus).toBe('missing'); expect(tyre.connectionPoints).toEqual([]);
    const holder = assessment.parts.find(part => part.partId === '18975')!;
    expect(holder.connectionIssues.some(issue => issue.file === 'parts/18975.dat' && issue.line === 10 && issue.directive?.includes('grid=1 C 2 1 0 60 0'))).toBe(true);
    const pin = assessment.parts.find(part => part.partId === '3673')!;
    expect(pin.connectionIssues.some(issue => issue.file === 'parts/3673.dat' && issue.directive?.includes('L_ 6.25 2'))).toBe(true);
    expect(assessment.pairs.find(pair => pair.fixedPartId === '66727')!.reasonCodes).toContain('wheel-mating-endpoint-missing');
  });

  it('does not treat an actual ordinary stud attachment as a certified wheel fit', async () => {
    const brick = (await repository.getPart('3005'))!, plate = (await repository.getPart('3024'))!;
    const male = brick.connections.points.find(point => point.sourceId === 'studC')!;
    const female = plate.connections.points.find(point => point.gender === 'F')!;
    expect(checkConnectionCompatibility(male, female).status).toBe('compatible');
    expect(inspectWheelMatingCandidate(male, female)).toMatchObject({ mechanicalRuleAccepted: false, reasonCode: 'ordinary-stud-rule-does-not-prove-wheel-fit' });
  });

  it('cannot promote a matching group or the same nominal section radius to wheel compatibility', async () => {
    const brick = (await repository.getPart('3005'))!, rim = (await repository.getPart('66727'))!;
    const male = brick.connections.points.find(point => point.sourceId === 'studC')!;
    const female = rim.connections.points.find(point => point.gender === 'F')!;
    expect(female.sections.some(section => section.radius === male.sections[0].radius)).toBe(true);
    expect(inspectWheelMatingCandidate(male, female).mechanicalRuleAccepted).toBe(false);
    // Actual pinned rim/tyre metadata demonstrates that even a source-backed
    // equal group remains insufficient without clearance and a seating rule.
    const smallRim = (await repository.getPart('4624'))!, smallTyre = (await repository.getPart('3641'))!;
    const groupedMale = smallRim.connections.points.find(point => point.gender === 'M' && point.group === 'rim8_6')!;
    const groupedFemale = smallTyre.connections.points.find(point => point.gender === 'F' && point.group === 'rim8_6')!;
    expect(groupedMale.group).toBe(groupedFemale.group);
    expect(inspectWheelMatingCandidate(groupedMale, groupedFemale)).toMatchObject({ mechanicalRuleAccepted: false, reasonCode: 'grouped-interface-seating-unresolved' });
  });

  it('keeps final pose, rotation, insertion trajectory and physical build as separate unperformed checks', () => {
    for (const stage of ['final-pose-and-chassis-attachment', 'rotation-clearance', 'installation-trajectory', 'physical-construction']) {
      expect(assessment.stages.find(item => item.stage === stage)?.status).toBe('not-run');
    }
    expect(assessment.reasonCodes).toContain('wheel-retention-tolerance-not-evidenced');
  });

  it('fails closed for a missing requested source without substituting a different source part', async () => {
    const missing = await assessWheelAssemblySources(async id => id === '18977' ? undefined : repository.getPart(id));
    expect(missing.parts.find(part => part.partId === '18977')).toMatchObject({ sourcePresent: false, connectionPoints: [], geometryFiles: [] });
    expect(missing.reasonCodes).toContain('wheel-source-missing');
    expect(missing.productionGeneratorEnabled).toBe(false);
  });

  it('does not accept a different genuine source under a requested wheel identity', async () => {
    const mismatched = await assessWheelAssemblySources(id => repository.getPart(id === '18975' ? '3673' : id));
    expect(mismatched.parts.find(part => part.partId === '18975')?.sourceVerified).toBe(false);
    expect(mismatched.stages.find(stage => stage.stage === 'native-source-import')?.status).toBe('blocked');
    expect(mismatched.productionGeneratorEnabled).toBe(false);
  });

  it('records a source integrity failure without falling back to a different source', async () => {
    const failed = await assessWheelAssemblySources(async id => {
      if (id === '18977') throw new Error('Pinned source hash mismatch.');
      return repository.getPart(id);
    });
    expect(failed.reasonCodes).toContain('wheel-source-load-failed');
    expect(failed.reasons.join(' ')).toContain('Pinned source hash mismatch.');
    expect(failed.parts.find(part => part.partId === '18977')).toMatchObject({ sourcePresent: false, sourceVerified: false, connectionPoints: [] });
  });
});
