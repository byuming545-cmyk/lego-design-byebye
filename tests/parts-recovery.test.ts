import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { adaptPdfInventories } from '../src/parts/inventory/index.js';
import { buildFailedPartRecoveryQueue, buildInstructionCoverage, createBundledElementDesignMapper, ElementDesignMapper, parseElementMappingSnapshot, parseLDrawMappingReviewSnapshot, type ElementMappingSource, type LDrawCrossReference, type LDrawMappingReview } from '../src/parts/recovery/index.js';

const bundleRoot = fileURLToPath(new URL('../data/parts-foundation/mappings/', import.meta.url));
const readJson = async (file: string) => JSON.parse(await readFile(file, 'utf8'));
const snapshot = () => readJson(path.join(bundleRoot, 'element-rows.json'));
const source: ElementMappingSource = { id: 'synthetic-test-source', url: 'https://example.invalid/test-fixture', revision: 'b'.repeat(40), sha256: 'a'.repeat(64), trust: 'user-reported', dataLicense: 'test-only', independentlyVerifiedOfficial: false };
const observedFixtureSource: ElementMappingSource = { ...source, trust: 'source-observed' };
const reference = (changes: Partial<LDrawCrossReference> = {}): LDrawCrossReference => ({ partId: '3024', partIdSystem: 'rebrickable', ldrawPartId: '3024', method: 'explicit-cross-reference-table', source: { url: 'https://example.invalid/synthetic-cross-reference', revision: 'c'.repeat(40), sha256: 'd'.repeat(64), rawText: 'Synthetic test-only exact identity declaration; not a production mapping.' }, ...changes });
const exactReview = (elementIds = ['302401']): NonNullable<LDrawCrossReference['identityReview']> => ({
  status: 'VERIFIED', scope: 'exact-part-and-variant', elementIds, reasons: [],
  checks: {
    printedDecoration: { result: 'not-applicable', evidence: 'Synthetic fixture declares the undecorated variant explicitly.' },
    moldRevision: { result: 'matched', evidence: 'Synthetic fixture source names this exact mold; no replacement inference.' },
    assemblyComponent: { result: 'matched', evidence: 'Synthetic fixture declares one rigid component.' },
    materialVariant: { result: 'matched', evidence: 'Synthetic fixture explicitly declares its material variant.' },
    colorSpecificElement: { result: 'matched', evidence: 'Synthetic fixture explicitly binds the observed element variant.' },
    alternateDesignOrReplacement: { result: 'not-applicable', evidence: 'Synthetic fixture source declares identity, not replacement equivalence.' },
  },
});
const reviewSnapshot = async () => readJson(path.join(bundleRoot, 'ldraw-mapping-review.json'));

describe('source-backed ElementDesignMapper', () => {
  it('resolves all 531 documentary elements without inferring LDraw identities or official verification', async () => {
    const mapper = await createBundledElementDesignMapper();
    expect(mapper.summary()).toMatchObject({ observedElements: 531, mappedBySource: 531, conflicts: 0, resolvedLDraw: 0, independentlyVerifiedOfficial: 0, sourceTrust: 'source-observed' });
    expect(mapper.summary().mappingStatusCounts).toEqual({ VERIFIED: 0, PROBABLE_BUT_UNVERIFIED: 14, CONFLICT: 88, UNRESOLVED: 429 });
    expect(mapper.resolve('302401')).toMatchObject({ status: 'mapped', partId: '3024', designId: '3024', color: { system: 'rebrickable', id: '15', name: 'White' }, ldrawPartId: null, independentlyVerifiedOfficial: false });
    // The real raw table explicitly distinguishes the two cataloguing identities.
    expect(mapper.resolve('4666579')).toMatchObject({ partId: '3749', designId: '6562', color: { name: 'Tan' } });
    expect(mapper.resolve('6585400')).toMatchObject({ partId: '3383pr0003', designId: '115809', color: { name: 'Trans-Black' } });
  });
  it('does not guess a mapping from identifier formatting or repeated lookup', async () => {
    const mapper = await createBundledElementDesignMapper();
    expect(mapper.resolve('302400')).toMatchObject({ status: 'unresolved', partId: null, designId: null, color: null });
    expect(mapper.resolve('element:302401')).toMatchObject({ status: 'unresolved', partId: null });
    const result = mapper.resolve('302401');
    result.color!.name = 'changed by caller';
    result.rawElementRow!.part_num = 'changed by caller';
    expect(mapper.resolve('302401').color!.name).toBe('White');
    expect(mapper.resolve('302401').rawElementRow!.part_num).toBe('3024');
    result.evidence[0].source.rawText = 'changed by caller';
    expect(mapper.resolve('302401').evidence[0].source.rawText).not.toBe('changed by caller');
  });
  it('keeps conflicting source declarations unresolved and never chooses the convenient one', async () => {
    const records = parseElementMappingSnapshot(await snapshot());
    const row = records.find(record => record.elementId === '302401')!;
    // Deliberately contradictory assertions are test-only and never enter the source bundle.
    const mapper = new ElementDesignMapper([row, { ...row, partId: '3001', designId: '3001' }], source);
    expect(mapper.resolve('302401')).toMatchObject({ status: 'conflict', mappingStatus: 'CONFLICT', geometryPipelineAllowed: false, partId: null, designId: null, color: null });
  });
  it('rejects missing table foreign keys and a tampered source snapshot', async () => {
    const data = await snapshot();
    data.tables.colors = [];
    expect(() => parseElementMappingSnapshot(data)).toThrow(/foreign key/);
    const directory = await mkdtemp(path.join(tmpdir(), 'bricklab-element-integrity-'));
    try {
      const manifest = await readFile(path.join(bundleRoot, 'manifest.json'));
      const rows = await readFile(path.join(bundleRoot, 'element-rows.json'), 'utf8');
      await writeFile(path.join(directory, 'manifest.json'), manifest);
      await writeFile(path.join(directory, 'element-rows.json'), rows.replace('302401', '302400'));
      await expect(createBundledElementDesignMapper({ bundleRoot: directory })).rejects.toThrow(/integrity/);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});

describe('failed-part recovery and instruction coverage', () => {
  it('accounts for every observed element, separates mapping recovery from assembly, and retains special reasons', async () => {
    const mapper = await createBundledElementDesignMapper();
    const inventories = adaptPdfInventories(await readJson(fileURLToPath(new URL('../data/parts-foundation/instructions/inventories.json', import.meta.url))));
    let geometryLookups = 0;
    const queue = buildFailedPartRecoveryQueue(inventories, mapper, () => { geometryLookups += 1; return { geometryReady: true, connectionReady: true, collisionReady: true, assemblyVerified: true, generatable: true }; });
    expect(queue.counts).toMatchObject({ total: 531, mappedBySource: 531, mappingUnresolved: 0, recoveredToMapping: 531, resolvedLDraw: 0, assemblyVerified: 0, generatable: 0, blocked: 531 });
    expect(queue.mappingStatusCounts).toEqual({ VERIFIED: 0, PROBABLE_BUT_UNVERIFIED: 14, CONFLICT: 88, UNRESOLVED: 429 });
    expect(queue.mappingStatusDenominator).toBe(531);
    expect(geometryLookups).toBe(0);
    expect(queue.entries.every(entry => entry.reasonCodes.includes('ldraw-cross-reference-not-verified'))).toBe(true);
    expect(queue.entries.find(entry => entry.elementId === '6575731')!.specialCategories).toContain('wheel-system-special-case');
    expect(queue.entries.find(entry => entry.elementId === '6508995')!.specialCategories).toContain('composite-part');
  });
  it('keeps unread documents and absent appendices unknown while reporting all eight files and six reference sets', async () => {
    const mapper = await createBundledElementDesignMapper();
    const manifest = await readJson(fileURLToPath(new URL('../data/parts-foundation/instructions/manifest.json', import.meta.url)));
    const inventories = adaptPdfInventories(await readJson(fileURLToPath(new URL('../data/parts-foundation/instructions/inventories.json', import.meta.url))));
    const report = buildInstructionCoverage(manifest.documents, inventories, mapper);
    expect(report.documents).toHaveLength(8);
    expect(report.sets).toHaveLength(6);
    expect(report.overall.counts).toMatchObject({ uniqueObservedElements: 531, mapped: 531, geometryReady: 0, assemblyVerified: 0, generatable: 0, mappingUnresolved: 0, unresolved: 531 });
    expect(report.overall.percentages).toMatchObject({ mapped: 100, assemblyVerified: 0, generatable: 0, unresolved: 100 });
    for (const row of [report.overall, ...report.documents, ...report.sets]) expect(Object.values(row.mappingStatusCounts).reduce((sum, count) => sum + count, 0)).toBe(row.denominator);
    expect(report.documents.find(row => row.documentId === '6572269')).toMatchObject({ sourceStatus: 'transfer-limit', denominator: 0, percentages: { mapped: null, generatable: null } });
    expect(report.documents.find(row => row.documentId === '6522905')).toMatchObject({ coverageStatus: 'no-inventory-appendix', denominator: 0, percentages: { mapped: null, generatable: null } });
    expect(report.sets.find(row => row.setNumber === '77238')!.documentIds).toEqual(['6592556', '6592612']);
    expect(report.sets.find(row => row.setNumber === '77239')).toMatchObject({ denominator: 0, percentages: { mapped: null } });
  });
  it('requires an explicit source-backed cross-reference and all assembly prerequisites before counting generator coverage', async () => {
    const records = parseElementMappingSnapshot(await snapshot());
    const row = records.find(record => record.elementId === '302401')!;
    const mapper = new ElementDesignMapper([row], observedFixtureSource, [reference({ identityReview: exactReview() })]);
    const inventory = [{ documentId: 'test-doc', setNumber: '77263', rows: [{ elementId: '302401', quantity: 1 }] }];
    const valid = buildFailedPartRecoveryQueue(inventory, mapper, () => ({ geometryReady: true, connectionReady: true, collisionReady: true, assemblyVerified: true, generatable: true }));
    expect(valid.counts.generatable).toBe(1);
    const invalid = buildFailedPartRecoveryQueue(inventory, mapper, () => ({ geometryReady: false, connectionReady: true, collisionReady: true, assemblyVerified: true, generatable: true }));
    expect(invalid.counts.generatable).toBe(0);
    expect(invalid.entries[0].blockedCategory).toBe('geometry');
  });
});

describe('exact LDraw identity review and namespace boundaries', () => {
  it('retains the unique 35380 candidate as probable after inspecting its source section and neighboring transform', async () => {
    const mapper = await createBundledElementDesignMapper();
    const result = mapper.resolve('6514193');
    expect(result).toMatchObject({ status: 'mapped', partId: '98138', designId: '35380', mappingStatus: 'PROBABLE_BUT_UNVERIFIED', geometryPipelineAllowed: false, ldrawPartId: null, ldrawCandidatePartIds: ['98138'], independentlyVerifiedOfficial: false });
    expect(result.reasons).toEqual(expect.arrayContaining(['custom-part-not-in-ldraw-section', 'transparent-material-variant-not-proven', 'adjacent-transform-target-disagrees']));
    expect(result.evidence.find(item => item.stage === 'external-catalogue-to-ldraw')).toMatchObject({ identitySystem: 'lego-design', identityId: '35380', candidateLDrawPartId: '98138', source: { line: 31612 } });
  });
  it('does not resolve multiple mold targets by deleting all but one from the current local library', async () => {
    const records = parseElementMappingSnapshot(await snapshot()).filter(row => row.elementId === '300523');
    const review = parseLDrawMappingReviewSnapshot(await reviewSnapshot()).find(row => row.elementId === '300523')!;
    for (const candidate of review.candidates) candidate.inPinnedLibrary = candidate.ldrawPartId === '3005';
    const mapper = new ElementDesignMapper(records, observedFixtureSource, [], [review]);
    expect(mapper.resolve('300523')).toMatchObject({ status: 'mapped', mappingStatus: 'CONFLICT', geometryPipelineAllowed: false, ldrawPartId: null, ldrawCandidatePartIds: ['3005', '30071', '35382'] });
  });
  it('never indexes a LEGO Design declaration as a Rebrickable part declaration', async () => {
    const row = parseElementMappingSnapshot(await snapshot()).find(row => row.elementId === '4666579')!;
    expect(row).toMatchObject({ partId: '3749', designId: '6562' });
    const mislabelled = new ElementDesignMapper([row], observedFixtureSource, [reference({ partId: '6562', partIdSystem: 'rebrickable', identityReview: exactReview() })]);
    expect(mislabelled.resolve(row.elementId)).toMatchObject({ mappingStatus: 'UNRESOLVED', ldrawPartId: null, geometryPipelineAllowed: false });
    // This is an explicitly synthetic reviewed declaration, not an assertion about real 6562 geometry.
    const explicitDesign = new ElementDesignMapper([row], observedFixtureSource, [reference({ partId: '6562', partIdSystem: 'lego-design', identityReview: exactReview([row.elementId]) })]);
    expect(explicitDesign.resolve(row.elementId)).toMatchObject({ mappingStatus: 'VERIFIED', ldrawPartId: '3024', geometryPipelineAllowed: true, independentlyVerifiedOfficial: false });
  });
  it('does not strip a printed-part suffix before matching an explicit unprinted declaration', async () => {
    const row = parseElementMappingSnapshot(await snapshot()).find(row => row.elementId === '6585400')!;
    const mapper = new ElementDesignMapper([row], observedFixtureSource, [reference({ partId: '3383', ldrawPartId: '3383', identityReview: exactReview() })]);
    expect(mapper.resolve(row.elementId)).toMatchObject({ partId: '3383pr0003', designId: '115809', mappingStatus: 'UNRESOLVED', ldrawPartId: null, geometryPipelineAllowed: false });
  });
  it('requires an exact-variant review even for a unique explicit same-number declaration', async () => {
    const row = parseElementMappingSnapshot(await snapshot()).find(row => row.elementId === '302401')!;
    const mapper = new ElementDesignMapper([row], observedFixtureSource, [reference()]);
    expect(mapper.resolve(row.elementId)).toMatchObject({ mappingStatus: 'PROBABLE_BUT_UNVERIFIED', geometryPipelineAllowed: false, ldrawPartId: null, ldrawCandidatePartIds: ['3024'] });
  });
  it('blocks missing mold evidence and user-reported verification claims', async () => {
    const row = parseElementMappingSnapshot(await snapshot()).find(row => row.elementId === '302401')!;
    const incomplete = exactReview(); incomplete.checks.moldRevision = { result: 'unresolved', evidence: 'The fixture deliberately omits exact mold evidence.' };
    const missingMold = new ElementDesignMapper([row], observedFixtureSource, [reference({ identityReview: incomplete })]);
    expect(missingMold.resolve(row.elementId)).toMatchObject({ mappingStatus: 'PROBABLE_BUT_UNVERIFIED', geometryPipelineAllowed: false });
    const userClaim = new ElementDesignMapper([row], source, [reference({ identityReview: exactReview() })]);
    expect(userClaim.resolve(row.elementId)).toMatchObject({ mappingStatus: 'PROBABLE_BUT_UNVERIFIED', geometryPipelineAllowed: false });
  });
  it('does not spread one reviewed colour/material element permission across a shared catalogue part', async () => {
    const rows = parseElementMappingSnapshot(await snapshot());
    const reviewed = rows.find(row => row.elementId === '302401')!;
    const anotherColor = rows.find(row => row.partId === reviewed.partId && row.color.id !== reviewed.color.id)!;
    expect(anotherColor).toBeDefined();
    const mapper = new ElementDesignMapper([reviewed, anotherColor], observedFixtureSource, [reference({ identityReview: exactReview([reviewed.elementId]) })]);
    expect(mapper.resolve(reviewed.elementId)).toMatchObject({ mappingStatus: 'VERIFIED', geometryPipelineAllowed: true });
    expect(mapper.resolve(anotherColor.elementId)).toMatchObject({ status: 'mapped', mappingStatus: 'PROBABLE_BUT_UNVERIFIED', geometryPipelineAllowed: false, ldrawPartId: null });
  });
  it('keeps conflicting LDraw declarations blocked even if one has a complete review', async () => {
    const row = parseElementMappingSnapshot(await snapshot()).find(row => row.elementId === '302401')!;
    const mapper = new ElementDesignMapper([row], observedFixtureSource, [reference({ identityReview: exactReview() }), reference({ ldrawPartId: '3001' })]);
    expect(mapper.resolve(row.elementId)).toMatchObject({ status: 'mapped', mappingStatus: 'CONFLICT', geometryPipelineAllowed: false, ldrawPartId: null });
  });
  it('fails closed when an element review belongs to a different design identity chain', async () => {
    const row = parseElementMappingSnapshot(await snapshot()).find(row => row.elementId === '6514193')!;
    const review = parseLDrawMappingReviewSnapshot(await reviewSnapshot()).find(item => item.elementId === row.elementId)!;
    review.designId = '98138';
    const mapper = new ElementDesignMapper([row], observedFixtureSource, [], [review]);
    expect(mapper.resolve(row.elementId)).toMatchObject({ mappingStatus: 'CONFLICT', geometryPipelineAllowed: false, ldrawPartId: null, reasons: expect.arrayContaining(['mapping-review-identity-chain-mismatch']) });
  });
  it('does not call geometry lookup for a probable mapping even if an adapter supplies an LDraw id and permission flag', async () => {
    const row = parseElementMappingSnapshot(await snapshot()).find(row => row.elementId === '302401')!;
    const mapper = new ElementDesignMapper([row], observedFixtureSource);
    const result = mapper.resolve(row.elementId);
    mapper.resolve = () => ({ ...result, mappingStatus: 'PROBABLE_BUT_UNVERIFIED', ldrawPartId: '3024', geometryPipelineAllowed: true });
    let queries = 0;
    const queue = buildFailedPartRecoveryQueue([{ setNumber: 'test-only', rows: [{ elementId: row.elementId, quantity: 1 }] }], mapper, () => { queries++; return { geometryReady: true, connectionReady: true, collisionReady: true, assemblyVerified: true, generatable: true }; });
    expect(queries).toBe(0);
    expect(queue.counts.generatable).toBe(0);
    expect(queue.entries[0].blockedCategory).toBe('mapping');
  });
  it('rejects a review-only file attempting to grant VERIFIED and a tampered reviewed snapshot', async () => {
    const data = await reviewSnapshot();
    data.entries[0].mappingStatus = 'VERIFIED';
    expect(() => parseLDrawMappingReviewSnapshot(data)).toThrow(/decision/);
    const directory = await mkdtemp(path.join(tmpdir(), 'bricklab-mapping-review-integrity-'));
    try {
      for (const file of ['manifest.json', 'element-rows.json']) await writeFile(path.join(directory, file), await readFile(path.join(bundleRoot, file)));
      const bytes = await readFile(path.join(bundleRoot, 'ldraw-mapping-review.json'), 'utf8');
      await writeFile(path.join(directory, 'ldraw-mapping-review.json'), bytes.replace('PROBABLE_BUT_UNVERIFIED', 'VERIFIED'));
      await expect(createBundledElementDesignMapper({ bundleRoot: directory })).rejects.toThrow(/review snapshot integrity/);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('captures all bundled mapping inputs for replay invalidation, including review-only and manifest-only changes', async () => {
    const mapper = await createBundledElementDesignMapper();
    const actual = mapper.getSourceFingerprint()!;
    const sha = async (file: string) => createHash('sha256').update(await readFile(path.join(bundleRoot, file))).digest('hex');
    expect(actual).toEqual({ mappingPolicyVersion: 'exact-identity-chain-1', manifestSha256: await sha('manifest.json'), elementSnapshotSha256: await sha('element-rows.json'), reviewSnapshotSha256: await sha('ldraw-mapping-review.json') });
    actual.elementSnapshotSha256 = '0'.repeat(64);
    expect(mapper.getSourceFingerprint()!.elementSnapshotSha256).toBe(await sha('element-rows.json'));
    const directory = await mkdtemp(path.join(tmpdir(), 'bricklab-mapping-fingerprint-'));
    try {
      const manifest = await readJson(path.join(bundleRoot, 'manifest.json'));
      const review = await reviewSnapshot();
      review.entries[0].reasons.push('Synthetic test-only review-note change; mapping status is intentionally unchanged.');
      const bytes = JSON.stringify(review, null, 2) + '\n';
      manifest.ldrawMappingReviewSnapshot.sha256 = createHash('sha256').update(bytes).digest('hex');
      manifest.ldrawMappingReviewSnapshot.bytes = Buffer.byteLength(bytes);
      await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
      await writeFile(path.join(directory, 'element-rows.json'), await readFile(path.join(bundleRoot, 'element-rows.json')));
      await writeFile(path.join(directory, 'ldraw-mapping-review.json'), bytes);
      const changed = await createBundledElementDesignMapper({ bundleRoot: directory });
      expect(changed.summary().mappingStatusCounts).toEqual(mapper.summary().mappingStatusCounts);
      expect(changed.getSourceFingerprint()!.elementSnapshotSha256).toBe(mapper.getSourceFingerprint()!.elementSnapshotSha256);
      expect(changed.getSourceFingerprint()!.reviewSnapshotSha256).not.toBe(mapper.getSourceFingerprint()!.reviewSnapshotSha256);
      expect(changed.getSourceFingerprint()!.manifestSha256).not.toBe(mapper.getSourceFingerprint()!.manifestSha256);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
