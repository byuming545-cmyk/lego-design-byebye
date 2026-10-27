import { NativePartRepository, PART_LIBRARY_VERSION } from './source.js';
import type { NativeAssemblyPart } from './types.js';

export type StandardFixtureRole = 'brick-1x1' | 'brick-1x2' | 'brick-2x2' | 'plate-1x1' | 'plate-1x2' | 'tile-1x1' | 'side-stud' | 'bar' | 'clip' | 'clip-plate' | 'axle' | 'axle-hole' | 'pin' | 'pin-hole' | 'wheel-holder' | 'wheel' | 'tyre' | 'representative-pair';
export interface StandardFixtureDefinition {
  role: StandardFixtureRole;
  partId: string | null;
  purpose: string;
}

/** IDs name existing pinned sources; all actual interfaces are read from those sources. */
export const STANDARD_ASSEMBLY_FIXTURES: readonly StandardFixtureDefinition[] = [
  { role: 'brick-1x1', partId: '3005', purpose: 'Standard brick stud and underside receiver.' },
  { role: 'brick-1x2', partId: '3004', purpose: 'Multi-stud brick; unresolved inherited source scaling remains blocked.' },
  { role: 'brick-2x2', partId: '3003', purpose: 'Multi-stud brick and round-profile underside receivers.' },
  { role: 'plate-1x1', partId: '3024', purpose: 'Shallow underside receiver and ordinary stud.' },
  { role: 'plate-1x2', partId: '3023b', purpose: 'Two-stud plate and underside receivers.' },
  { role: 'tile-1x1', partId: '3070b', purpose: 'Studless upper surface and source underside receiver.' },
  { role: 'side-stud', partId: '87087', purpose: 'Source side-facing stud; auxiliary small bore is a separate capability.' },
  { role: 'bar', partId: '30374', purpose: 'Source round bar; unknown slide / retention rules remain blocked.' },
  { role: 'clip', partId: '48729b', purpose: 'Source clip and attached bar, not an inferred generic cylinder fit.' },
  { role: 'clip-plate', partId: '60470b', purpose: 'Plate with actual clips; stud and clip capabilities are evaluated separately.' },
  { role: 'axle', partId: null, purpose: 'No standalone axle is included in the current pinned root set; do not invent a reference axle.' },
  { role: 'axle-hole', partId: '65635', purpose: 'Actual automotive axle-hole source; inherited scaling must be resolved before mechanical use.' },
  { role: 'pin', partId: '3673', purpose: 'Actual Technic pin; unparsed profiles remain blocked.' },
  { role: 'pin-hole', partId: '3700', purpose: 'Actual Technic brick with pin hole.' },
  { role: 'wheel-holder', partId: '4600', purpose: 'Actual plate wheel pins; ordinary stud qualification does not qualify its wheel-pin interfaces.' },
  { role: 'wheel', partId: '4624', purpose: 'Actual wheel rim; cylinder and generic rim interfaces require their own rules.' },
  { role: 'tyre', partId: '3641', purpose: 'Actual tyre with a source rim group; group metadata alone is not assembly proof.' },
] as const;

export const AUTOMOTIVE_ASSEMBLY_PAIR_FIXTURES = [
  { id: 'bracket-plate', fixedPartId: '99207', movingPartId: '3024', label: 'Bracket + standard plate', requiredInterface: 'standard-stud' },
  { id: 'side-stud-tile', fixedPartId: '87087', movingPartId: '3070b', label: 'Side stud brick + tile', requiredInterface: 'side-stud' },
  { id: 'mudguard-body', fixedPartId: '18974', movingPartId: '3024', label: 'Mudguard + standard body plate', requiredInterface: 'standard-stud' },
  { id: 'windscreen-base', fixedPartId: '18973', movingPartId: '3024', label: 'Windscreen + base plate', requiredInterface: 'standard-stud' },
  { id: 'wheel-tyre', fixedPartId: '4624', movingPartId: '3641', label: 'Wheel + tyre', requiredInterface: 'wheel-rim' },
  { id: 'wheel-holder', fixedPartId: '4600', movingPartId: '4624', label: 'Wheel holder + wheel', requiredInterface: 'wheel-pin' },
  { id: 'axle-compatible-hole', fixedPartId: '65635', movingPartId: null, label: 'Axle hole + standalone axle', requiredInterface: 'axle' },
  { id: 'curved-slope-body', fixedPartId: '11477', movingPartId: '3024', label: 'Curved slope + standard body plate', requiredInterface: 'standard-stud' },
  { id: 'jumper-offset', fixedPartId: '15573', movingPartId: '3024', label: 'Jumper offset + standard plate', requiredInterface: 'standard-stud' },
  { id: 'bar-clip', fixedPartId: '48729b', movingPartId: '30374', label: 'Real clip + real bar', requiredInterface: 'bar-clip' },
  { id: 'pin-hole', fixedPartId: '3700', movingPartId: '3673', label: 'Technic hole + real pin', requiredInterface: 'pin' },
] as const;

export interface AssemblySourceRoot {
  partId: string;
  path: string;
  name: string;
  selectionBasis: string;
}
export interface AssemblySourceLoader {
  roots: readonly AssemblySourceRoot[];
  partLibraryVersion: string;
  geometryRevision: string;
  loadPart(partId: string): Promise<NativeAssemblyPart>;
}

/** Reuse the immutable native repository shared by verification, generation and rendering. */
export async function createAssemblySourceLoader(repository = new NativePartRepository()): Promise<AssemblySourceLoader> {
  const manifest = await repository.getManifest();
  return {
    roots: manifest.roots.map(root => ({ ...root })),
    partLibraryVersion: PART_LIBRARY_VERSION,
    geometryRevision: manifest.revision,
    async loadPart(partId) {
      const value = await repository.getPart(partId);
      if (!value) throw new Error('Assembly fixtures and candidates must exist in the pinned native root set.');
      return value;
    },
  };
}

export interface LoadedAssemblyFixture {
  definition: StandardFixtureDefinition;
  part: NativeAssemblyPart | null;
  status: 'source-ready' | 'source-partial' | 'missing';
  reason: string;
}
export async function loadStandardAssemblyFixtures(loader: AssemblySourceLoader): Promise<LoadedAssemblyFixture[]> {
  const fixtures: LoadedAssemblyFixture[] = [];
  for (const definition of STANDARD_ASSEMBLY_FIXTURES) {
    if (definition.partId === null || !loader.roots.some(root => root.partId === definition.partId)) {
      fixtures.push({ definition, part: null, status: 'missing', reason: definition.purpose });
      continue;
    }
    try {
      const part = await loader.loadPart(definition.partId);
      const geometryReady = part.geometry.status === 'geometryReady' && part.geometry.source.integrity === 'verified';
      fixtures.push({ definition, part, status: !geometryReady ? 'missing' : part.connections.status === 'ready' ? 'source-ready' : 'source-partial', reason: geometryReady ? `Imported source connections: ${part.connections.status}; assembly tests have not yet promoted any interface.` : 'Pinned native geometry did not load with verified source integrity.' });
    } catch {
      fixtures.push({ definition, part: null, status: 'missing', reason: 'Pinned fixture source could not be loaded or failed integrity checks.' });
    }
  }
  return fixtures;
}
