import type { NativeAssemblyPart } from '../assembly/types.js';
import type { Connector, ConnectorFamily } from './schema.js';
import { ConnectorGrammar, evaluateConnectorCompatibility } from './rules.js';
import { adaptNativePartConnectors } from './sources.js';
import { classifyBuildingPatterns } from './patterns.js';
import { buildNativeCollisionProxy } from '../assembly/proxy.js';
import { IDENTITY_TRANSFORM } from '../assembly/math.js';
import { nativePartSourceHash } from '../assembly/source.js';

export interface IndexedConnector { partId: string; connector: Connector }

/** A feature-family index. Registration never tries a new part against the old
 * library, creates a part-pair permission table, or runs collision detection. */
export class ConnectorRegistry {
  private readonly families = new Map<ConnectorFamily, IndexedConnector[]>();
  private readonly keys = new Set<string>();
  private readonly grammar = new ConnectorGrammar();
  register(partId: string, connectors: readonly Connector[]) {
    const staged = new Set<string>();
    for (const connector of connectors) {
      const key = JSON.stringify([partId, connector.featureId]);
      if (this.keys.has(key) || staged.has(key)) throw new Error('Duplicate canonical connector identity.');
      staged.add(key);
    }
    for (const connector of connectors) {
      const key = JSON.stringify([partId, connector.featureId]);
      this.keys.add(key);
      const features = this.families.get(connector.family) ?? [];
      features.push({ partId, connector }); this.families.set(connector.family, features);
    }
  }
  findCompatible(fixed: Connector, partIds?: ReadonlySet<string>): IndexedConnector[] {
    return this.grammar.compatibleFamilies(fixed.family).flatMap(family => this.families.get(family) ?? [])
      .filter(entry => (!partIds || partIds.has(entry.partId)) && evaluateConnectorCompatibility(fixed, entry.connector).status === 'COMPATIBLE');
  }
  get featureCount() { return this.keys.size; }
}

/** Source geometry remains authoritative; no can_connect_to part list is stored. */
export function describeGrammarPart(part: NativeAssemblyPart) {
  const ingestion = adaptNativePartConnectors(part);
  const collision = buildNativeCollisionProxy(part, { instanceId: 'descriptor', partId: part.partId, transform: IDENTITY_TRANSFORM });
  return {
    partId: part.partId, units: 'LDU' as const,
    geometry: part.geometry,
    collisionGeometry: { status: collision.status, reasonCode: collision.reasonCode, reason: collision.reason },
    connectors: ingestion.connectors,
    dimensions: part.geometry.bounds ? part.geometry.bounds.max.map((value, axis) => value - part.geometry.bounds!.min[axis]) : null,
    boundingVolume: part.geometry.bounds ?? null,
    // These cannot be inferred from a part name or bounding box.
    symmetry: null, surfaces: null,
    metadata: { name: part.geometry.name, connectorCoverage: ingestion.coverage },
    provenance: { sourceDigest: nativePartSourceHash(part), geometry: part.geometry.source, connectors: part.connections.sourceFiles },
    topology: classifyBuildingPatterns(ingestion.connectors),
    diagnostics: ingestion.diagnostics,
  };
}
