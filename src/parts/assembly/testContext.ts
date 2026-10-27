import { createHash } from 'node:crypto';
import type { NativeAssemblyPart } from './types.js';
import type { LoadedAssemblyFixture } from './fixtures.js';
import { nativePartSourceHash, PART_LIBRARY_VERSION } from './source.js';
import { ASSEMBLY_ENGINE_VERSION } from './engine.js';
import { CONNECTION_RULE_VERSION } from './compatibility.js';
import { COLLISION_VERSION } from './collision.js';
import { INTERFACE_TEST_VERSION, type InterfaceTestContext } from './deferredTypes.js';

export function contentHash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
export function geometryDataHash(part: NativeAssemblyPart): string { return contentHash([part.geometry.source, part.geometry.mesh, part.geometry.bounds]); }
export function connectionMetadataHash(part: NativeAssemblyPart): string { return contentHash(part.connections); }
const fixtureBindingCache = new WeakMap<LoadedAssemblyFixture[], InterfaceTestContext['fixtures']>();
export function createInterfaceTestContext(part: NativeAssemblyPart, fixtures: LoadedAssemblyFixture[]): InterfaceTestContext {
  let bindings = fixtureBindingCache.get(fixtures);
  if (!bindings) {
    bindings = fixtures.map(fixture => ({ role: fixture.definition.role, partId: fixture.definition.partId, sourceHash: fixture.part ? nativePartSourceHash(fixture.part) : null, geometryHash: fixture.part ? geometryDataHash(fixture.part) : null, connectionMetadataHash: fixture.part ? connectionMetadataHash(fixture.part) : null }));
    fixtureBindingCache.set(fixtures, bindings);
  }
  const body = {
    testVersion: INTERFACE_TEST_VERSION, partId: part.partId, partSourceHash: nativePartSourceHash(part), geometryHash: geometryDataHash(part), connectionMetadataHash: connectionMetadataHash(part),
    fixtures: bindings, fixtureSetHash: contentHash(bindings), partLibraryVersion: PART_LIBRARY_VERSION, assemblyEngineVersion: ASSEMBLY_ENGINE_VERSION, connectionRuleVersion: CONNECTION_RULE_VERSION, collisionVersion: COLLISION_VERSION,
  };
  return { ...body, contextId: contentHash(body) };
}
