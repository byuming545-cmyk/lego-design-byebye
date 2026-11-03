import { beforeAll, describe, expect, it } from 'vitest';
import { GrammarAssemblyService } from '../src/parts/grammar/service.js';

let service: GrammarAssemblyService;
beforeAll(async () => { service = new GrammarAssemblyService(); await service.ready(); }, 120_000);

describe('fixed-side collision class', () => {
  it('creates an exterior fixed root and keeps that class through graph validation', async () => {
    const graph = await service.engine.createAssembly('11477', 'exterior-shell');
    expect(graph.placements[0].collisionClass).toBe('exterior-shell');
    const checked = await service.engine.validateGraph(graph);
    expect(checked.valid).toBe(true);
  });

  it('attaches a structural moving part to an exterior fixed root and preserves both classes', async () => {
    const fixedPart = await service.repository.getPart('11477');
    const movingPart = await service.repository.getPart('3001');
    const female = fixedPart!.connections.points.find(point => point.gender === 'F' && point.sections[0]?.radius === 6)!;
    const male = movingPart!.connections.points.find(point => point.gender === 'M' && point.sourceId === 'studC')!;
    const result = await service.attach({ partA: '11477', connectionA: female.id, partB: '3001', connectionB: male.id, fixedCollisionClass: 'exterior-shell' });
    expect(result.accepted).toBe(true);
    expect(result.graph?.placements.map(placement => placement.collisionClass)).toEqual(['exterior-shell', undefined]);
  });

  it('defaults a fixed root to structural without writing an explicit class', async () => {
    const graph = await service.engine.createAssembly('3001');
    expect(graph.placements[0].collisionClass).toBeUndefined();
    expect((await service.engine.validateGraph(graph)).valid).toBe(true);
  });
});
