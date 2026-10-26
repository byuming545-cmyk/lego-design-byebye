import { beforeAll, describe, expect, it, vi } from 'vitest';
import { NativePartRepository } from '../src/parts/assembly/source.js';
import { ConnectorRegistry, describeGrammarPart } from '../src/parts/grammar/library.js';
import { adaptNativePartConnectors } from '../src/parts/grammar/sources.js';
import type { NativeAssemblyPart } from '../src/parts/assembly/types.js';
import * as rules from '../src/parts/grammar/rules.js';
import * as collision from '../src/parts/assembly/proxy.js';
import { connectorAuditMain } from '../src/cli/connector-audit.js';

const repository = new NativePartRepository();
const parts = new Map<string, NativeAssemblyPart>();
beforeAll(async () => {
  for (const id of ['3001', '3024', '3623', '32000']) parts.set(id, (await repository.getPart(id))!);
}, 30_000);
const features = (id: string) => adaptNativePartConnectors(parts.get(id)!).connectors;

describe('interface family index and source part descriptors', () => {
  it('registers real source features without a part-pair trial or a collision query', () => {
    const sets = ['3001', '32000', '3024'].map(id => ({ id, connectors: features(id) }));
    const matcher = vi.spyOn(rules, 'evaluateConnectorCompatibility');
    const proxy = vi.spyOn(collision, 'buildNativeCollisionProxy');
    try {
      const registry = new ConnectorRegistry();
      for (const set of sets) registry.register(set.id, set.connectors);
      expect(registry.featureCount).toBe(sets.reduce((sum, set) => sum + set.connectors.length, 0));
      expect(matcher).not.toHaveBeenCalled(); expect(proxy).not.toHaveBeenCalled();
    } finally { matcher.mockRestore(); proxy.mockRestore(); }
  });

  it('looks up only compatible families and optional target IDs instead of scanning arbitrary library pairs', () => {
    const registry = new ConnectorRegistry();
    for (const id of ['3001', '32000', '3024']) registry.register(id, features(id));
    const fixed = features('3001').find(connector => connector.family === 'STUD' && connector.matchingPolicy)!;
    const matcher = vi.spyOn(rules, 'evaluateConnectorCompatibility');
    try {
      const found = registry.findCompatible(fixed, new Set(['3024']));
      // Both literal 3024 receiving-source aliases remain indexed; physical
      // endpoint occupancy is handled later by the native multi-point stage.
      expect(found).toHaveLength(2); expect(found.every(entry => entry.partId === '3024' && entry.connector.family === 'ANTISTUD')).toBe(true);
      expect(matcher).toHaveBeenCalledTimes(2);
      expect(matcher.mock.calls.every(([, target]) => target.family === 'ANTISTUD')).toBe(true);
    } finally { matcher.mockRestore(); }
  });

  it('lets a newly registered source descriptor inherit C01 without adding part-specific permissions', () => {
    const registry = new ConnectorRegistry(), fixed = features('3001').find(connector => connector.family === 'STUD' && connector.matchingPolicy)!;
    registry.register('3001', features('3001'));
    expect(registry.findCompatible(fixed, new Set(['3623']))).toEqual([]);
    registry.register('3623', features('3623'));
    const matches = registry.findCompatible(fixed, new Set(['3623']));
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.every(match => rules.evaluateConnectorCompatibility(fixed, match.connector).ruleId === 'C01')).toBe(true);
  });

  it('retains distinct co-located source feature IDs and rejects only duplicate identities', () => {
    const connectors = features('3623'), byPosition = new Map<string, string[]>();
    for (const connector of connectors) {
      const key = JSON.stringify(connector.localPositionLdu), ids = byPosition.get(key) ?? [];
      ids.push(connector.featureId); byPosition.set(key, ids);
    }
    expect([...byPosition.values()].some(ids => ids.length > 1 && new Set(ids).size === ids.length)).toBe(true);
    const registry = new ConnectorRegistry(); registry.register('3623', connectors);
    expect(registry.featureCount).toBe(connectors.length);
    expect(() => registry.register('3623', [connectors[0]])).toThrow('Duplicate canonical connector identity');
    const empty = new ConnectorRegistry();
    expect(() => empty.register('3623', [connectors[0], connectors[1], connectors[0]])).toThrow('Duplicate canonical connector identity');
    expect(empty.featureCount).toBe(0);
  });

  it('keeps real geometry, source digest and topology separate from connect-to-part lists', () => {
    const native = parts.get('3001')!, descriptor = describeGrammarPart(native);
    expect(descriptor.geometry).toBe(native.geometry); expect(descriptor.provenance.sourceDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(descriptor.metadata.connectorCoverage).toBe('COMPLETE');
    expect(descriptor.topology.legalAssemblyEstablished).toBe(false);
    expect(descriptor.collisionGeometry.status).toBe('ready');
    expect(descriptor).not.toHaveProperty('can_connect_to');
    expect(descriptor.symmetry).toBeNull(); expect(descriptor.surfaces).toBeNull();
  });

  it('rejects invalid audit CLI arguments before reading or modifying data', async () => {
    await expect(connectorAuditMain(['--unknown'])).rejects.toThrow('Usage:');
  });
});
