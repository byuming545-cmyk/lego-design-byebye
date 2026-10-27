import { describe, expect, it } from 'vitest';
import { buildAutomotiveGrammar, createPriorAutomotiveGrammar, ratioRangeStatus, referenceAutomotiveRatios } from '../src/automotive/grammar.js';
import { confirmDesignPattern, createDesignPatternLibrary, extractPatternCandidates, getConfirmedPatterns, instantiatePattern, patternAttachmentPoints, retrievePatterns, substitutePatternPart, validatePatternGeometry } from '../src/automotive/patterns.js';
import { retrieveReferences } from '../src/automotive/retrieval.js';
import { analyzeReferenceModel } from '../src/automotive/references/analyzer.js';
import { importReferenceModel } from '../src/automotive/references/importer.js';
import type { ReferenceMetadataInput } from '../src/automotive/references/types.js';
import { getCatalogVehicleProfile } from '../src/automotive/research/profiles.js';
import { toVehicleDesignBrief } from '../src/automotive/research/brief.js';
import { deriveConnections, graphComponents } from '../src/speed/connections.js';
import { vehicleDimensions } from '../src/speed/geometry.js';
import { speedPartsCollide } from '../src/speed/validators.js';

/** These original local geometry fixtures are never seeded as real training references. */
const fixtureMetadata: ReferenceMetadataInput = { source: 'original-pattern-unit-fixture', modelName: 'Unit-test assembly', author: 'Bricklab test authors', license: 'CC0-1.0', attribution: 'Original minimal unit-test geometry, not an official vehicle reference.', importedAt: '2026-10-20T00:00:00Z', vehicleType: 'luxury-sedan' };
const native = (x = 0, y = 0, z = 0, file = '3001.dat', matrix = '1 0 0 0 1 0 0 0 1') => `1 0 ${x} ${y} ${z} ${matrix} ${file}`;
const parse = (text: string, name = 'Unit-test assembly') => importReferenceModel({ text, metadata: { ...fixtureMetadata, modelName: name } });

describe('Automotive engineering grammar and verified local patterns', () => {
  it('keeps five class distributions as explicit zero-sample priors', () => {
    const grammar = createPriorAutomotiveGrammar();
    expect(Object.keys(grammar.classes)).toHaveLength(5);
    expect(grammar.referenceCount).toBe(0);
    expect(grammar.fallbackPrior).toBe(true);
    for (const vehicleClass of Object.values(grammar.classes)) for (const distribution of Object.values(vehicleClass.ratios)) {
      expect(distribution.source).toBe('engineer-prior');
      expect(distribution.sampleCount).toBe(0);
      expect(distribution.sourceReferences).toEqual([]);
      expect(distribution.normalRange[0]).toBeLessThanOrEqual(distribution.preferredRange[0]);
      expect(distribution.unusualRange[1]).toBeGreaterThanOrEqual(distribution.normalRange[1]);
    }
    const sedan = grammar.classes['luxury-sedan'].ratios.lengthWidth;
    expect(ratioRangeStatus(sedan, 3)).toBe('preferred');
    expect(ratioRangeStatus(sedan, 4)).toBe('unusual');
    expect(ratioRangeStatus(sedan, 8)).toBe('outside');
  });

  it('builds actual connected local assemblies with no overlaps and real side-stud edges', () => {
    const patterns = getConfirmedPatterns();
    expect(patterns.length).toBeGreaterThanOrEqual(5);
    for (const pattern of patterns) {
      expect(pattern.parts.length).toBeLessThanOrEqual(6);
      expect(pattern.validation.valid).toBe(true);
      expect(pattern.sourceReferences).toEqual([]);
      expect(pattern.provenance.kind).toBe('engineer-prior');
      expect(pattern.strengthAssessment).toBe('connector-heuristic');
      expect(graphComponents(pattern.parts)).toHaveLength(1);
      for (let a = 0; a < pattern.parts.length; a++) for (let b = a + 1; b < pattern.parts.length; b++) expect(speedPartsCollide(pattern.parts[a], pattern.parts[b])).toBe(false);
      expect(patternAttachmentPoints(pattern).some(point => point.type === 'antiStud')).toBe(true);
    }
    expect(patterns.filter(pattern => pattern.styleTags.includes('snot')).every(pattern => pattern.connectionGraph.some(edge => edge.connectionType === 'side-stud'))).toBe(true);
  });

  it('requires a real graph and catches detached and overlapping parts before confirmation', () => {
    const pattern = createDesignPatternLibrary()[0];
    const forged = structuredClone(pattern);
    forged.connectionGraph[0].connectionPointA = 'invented';
    expect(validatePatternGeometry(forged).valid).toBe(false);
    expect(getConfirmedPatterns([forged])).toEqual([]);
    const detached = structuredClone(pattern);
    detached.parts[0].position.x += 10;
    detached.connectionGraph = deriveConnections(detached.parts);
    detached.dimensions = vehicleDimensions(detached.parts);
    expect(confirmDesignPattern(detached).status).toBe('candidate');
    const overlap = structuredClone(pattern);
    overlap.parts[0].position = { ...overlap.parts[1].position };
    overlap.connectionGraph = deriveConnections(overlap.parts);
    overlap.dimensions = vehicleDimensions(overlap.parts);
    expect(validatePatternGeometry(overlap).errors.join(' ')).toMatch(/overlap/);
  });

  it('preserves side connectors when placing a module with composed physical rotations', () => {
    const pattern = createDesignPatternLibrary().find(pattern => pattern.id === 'snot-grille-strips')!;
    const placed = instantiatePattern(pattern, { idPrefix: 'front-a', origin: { x: 7, y: 5, z: 6 }, orientation: { x: 0, y: 0, z: 90 }, moduleId: 'front' });
    expect(deriveConnections(placed)).toHaveLength(pattern.connectionGraph.length);
    expect(graphComponents(placed)).toHaveLength(1);
    expect(placed.every(part => part.instanceId.startsWith('front-a:') && part.moduleId === 'front')).toBe(true);
    expect(deriveConnections(placed).every(edge => edge.connectionType === 'side-stud')).toBe(true);
  });

  it('matches both module space and mounting interfaces and filters unconfirmed descriptions', () => {
    expect(retrievePatterns({ category: 'reinforcement', maxDimensions: { x: 2, y: 8, z: 2 } })).toEqual([]);
    expect(retrievePatterns({ category: 'front', availableConnectionTypes: ['wheelPin'] })).toEqual([]);
    expect(retrievePatterns({ category: 'front', styleTags: ['large-grille'], availableConnectionTypes: ['stud'] })[0].pattern.id).toBe('snot-grille-strips');
    const candidate = createDesignPatternLibrary()[0];
    candidate.status = 'candidate'; candidate.parts = []; candidate.connectionGraph = [];
    expect(getConfirmedPatterns([candidate])).toEqual([]);
    expect(() => instantiatePattern(candidate)).toThrow(/not confirmed/);
  });

  it('rechecks a safe ID substitution and rejects an apparently similar incompatible part', () => {
    const roof = createDesignPatternLibrary().find(pattern => pattern.id === 'curved-roof-transition')!;
    const substituted = substitutePatternPart(roof, 'rear-riser', '3023b');
    expect(substituted.parts.find(part => part.instanceId === 'rear-riser')?.partId).toBe('3023b');
    expect(validatePatternGeometry(substituted).valid).toBe(true);
    expect(roof.parts.find(part => part.instanceId === 'rear-riser')?.partId).toBe('3023');
    expect(() => substitutePatternPart(roof, 'rear-riser', '3069b')).toThrow(/dimensions and catalog interfaces/);
  });

  it('extracts only proven known-geometry clusters and leaves them unconfirmed and unassessed', () => {
    const model = parse([native(), native(0, -24), native(200, 0, 0, 'unknown.dat'), native(400, 0, 0, '3001.dat', '0.70710678 0 -0.70710678 0 1 0 0.70710678 0 0.70710678')].join('\n'));
    const analysis = analyzeReferenceModel(model), candidates = extractPatternCandidates(analysis, model);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].parts).toHaveLength(2);
    expect(candidates[0].validation.valid).toBe(true);
    expect(candidates[0].connectionGraph).toHaveLength(8);
    expect(candidates[0].status).toBe('candidate');
    expect(candidates[0].strengthScore).toBeNull();
    expect(candidates[0].sourceReferences).toEqual([model.id]);
    expect(getConfirmedPatterns(candidates)).toEqual([]);
    expect(confirmDesignPattern(candidates[0]).status).toBe('confirmed');
    const forgedAnalysis = structuredClone(analysis); forgedAnalysis.connections.edges = [];
    expect(extractPatternCandidates(forgedAnalysis, model)).toEqual([]);
    expect(() => extractPatternCandidates({ ...analysis, referenceId: 'other' }, model)).toThrow(/does not belong/);
  });

  it('does not learn from fixtures, duplicates, missing semantics or too few references', () => {
    const model = parse(`${native()}\n${native(0, -24)}`), analysis = analyzeReferenceModel(model);
    const excluded = buildAutomotiveGrammar([{ analysis, vehicleType: 'luxury-sedan', classificationEvidence: ['Test annotation only'], evidenceKind: 'synthetic-fixture' }]);
    expect(excluded.referenceCount).toBe(0);
    expect(excluded.classes['luxury-sedan'].ratios.lengthWidth.observations.sampleCount).toBe(0);
    const one = buildAutomotiveGrammar([analysis, analysis]);
    expect(one.referenceCount).toBe(1);
    expect(one.classes['luxury-sedan'].ratios.lengthWidth.source).toBe('engineer-prior');
    expect(one.classes['luxury-sedan'].ratios.lengthWidth.sampleCount).toBe(0);
    expect(one.classes['luxury-sedan'].ratios.lengthWidth.observations.sampleCount).toBe(1);
    expect(referenceAutomotiveRatios(analysis).hoodProportion).toBeUndefined();
    expect(referenceAutomotiveRatios(analysis).roofProportion).toBeUndefined();
    expect(one.classes['luxury-sedan'].ratios.sideSymmetry.source).toBe('engineer-prior');
    const unknown = structuredClone(analysis); unknown.metadata.vehicleType = 'unknown';
    expect(buildAutomotiveGrammar([unknown]).referenceCount).toBe(0);
  });

  it('keeps derived distributions separate by class and records the samples behind each statistic', () => {
    // Deliberately constructed inputs exercise aggregation; nothing is persisted or bundled as learning data.
    const analyses = [0, 1, 2].map(index => analyzeReferenceModel(parse(`${native()}\n${native(0, -24, index * 20)}`, `Statistical input ${index}`)));
    const result = buildAutomotiveGrammar(analyses), sedan = result.classes['luxury-sedan'].ratios.lengthWidth;
    expect(sedan.source).toBe('reference-derived');
    expect(sedan.sampleCount).toBe(3);
    expect(sedan.sourceReferences).toHaveLength(3);
    expect(sedan.normalRange[0]).toBeLessThan(sedan.normalRange[1]);
    expect(result.classes.supercar.ratios.lengthWidth.source).toBe('engineer-prior');
    expect(result.classes['luxury-sedan'].ratios.hoodProportion.sampleCount).toBe(0);
  });

  it('retrieves a different-brand shape ahead of a matching-brand unsuitable shape', () => {
    const brief = toVehicleDesignBrief(getCatalogVehicleProfile('Mercedes-AMG S 63')!, { widthStuds: 10, allowEstimatedProportions: true });
    const rectangle = (rows: number) => [-40, 40].flatMap(x => Array.from({ length: rows }, (_, row) => native(x, 0, row * 40))).join('\n');
    const differentBrand = analyzeReferenceModel(parse(rectangle(12), 'BMW long-wheelbase original fixture'));
    const matchingBrand = analyzeReferenceModel(parse(rectangle(4), 'Mercedes compact-square original fixture'));
    const references = retrieveReferences(brief, [matchingBrand, differentBrand]);
    expect(references.references[0].referenceId).toBe(differentBrand.referenceId);
    expect(references.references[0].rank).toBe(1);
    expect(references.references[0].reasons.join(' ')).toContain('lengthWidth');
    expect(references.references[0].uses).toContain('chassis');
    expect(references.references[0].reasons.join(' ')).not.toMatch(/manufacturer|brand match/i);
  });

  it('retrieves complementary front-design annotations and reports empty-library prior fallback honestly', () => {
    const brief = toVehicleDesignBrief(getCatalogVehicleProfile('Mercedes-AMG S 63')!, { widthStuds: 10, allowEstimatedProportions: true });
    const analysis = analyzeReferenceModel(parse(native(), 'Original grille-study fixture'));
    const result = retrieveReferences(brief, [{ analysis, vehicleType: 'gt', featureTags: ['large grille'], structuralUses: ['chassis', 'cabin attachment', 'roof attachment'] }]);
    expect(result.references).toHaveLength(1);
    expect(result.references[0].uses).toContain('front');
    expect(result.references[0].uses).toContain('cockpit');
    expect(result.references[0].uses).toContain('roof');
    expect(result.references[0].reasons.join(' ')).toContain('explicit reference annotation');
    expect(retrieveReferences(brief, [])).toMatchObject({ references: [], fallbackPrior: true });
    expect(retrieveReferences(brief, []).notes.join(' ')).toContain('No official reference was selected');
  });
});
