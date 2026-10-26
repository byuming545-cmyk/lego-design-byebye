import type { AssemblyInterfaceCapability, NativeAssemblyPart } from '../assembly/types.js';
import { hasIsolatedUnknownDimensions } from '../assembly/types.js';
import { nativePartSourceHash } from '../assembly/source.js';
import { STANDARD_STUD_RULE_ID } from '../assembly/compatibility.js';
import { buildNativeCollisionProxy, type ProxyBuildResult } from '../assembly/proxy.js';
import { IDENTITY_TRANSFORM } from '../assembly/math.js';
import { CONNECTOR_GRAMMAR_VERSION, type Connector } from './schema.js';
import { inspectConnectorSupport } from './rules.js';
import { adaptNativePartConnectors, supportsStandardStudEndpoint, type ConnectorIngestion } from './sources.js';

export const GRAMMAR_ADMISSION_VERSION = 'source-connector-admission-1';

export interface GrammarFeatureSupport {
  featureId: string;
  sourceConnectionId: string | null;
  family: Connector['family'];
  supported: boolean;
  ruleIds: string[];
  reasonCodes: string[];
}
export interface GrammarPartAdmission {
  partId: string;
  admissionBasis: 'interface-grammar';
  grammarVersion: string;
  sourceDigest: string;
  sourceReady: boolean;
  collisionGeometryReady: boolean;
  connectable: boolean;
  generationEligible: boolean;
  /** A reusable connector rule is not an actually executed part assembly. */
  assemblyVerified: false;
  generatorSmokePassed: false;
  physicalBuildVerified: false;
  ingestion: ConnectorIngestion;
  featureSupport: GrammarFeatureSupport[];
  proxy: Pick<ProxyBuildResult, 'status' | 'reasonCode' | 'reason'>;
  capability: AssemblyInterfaceCapability;
  reasonCodes: string[];
  reasons: string[];
}

/**
 * Admission is a linear source/connector inspection. No mate-part catalog, pair
 * fixture, retained success flag or trial placement is an input to this function.
 * Actual placement, multipoint closure and collision remain the engine's job.
 */
export function assessGrammarAdmission(part: NativeAssemblyPart): GrammarPartAdmission {
  const ingestion = adaptNativePartConnectors(part);
  const sourceDigest = nativePartSourceHash(part);
  const geometry = part.geometry;
  const identityReady = geometry.partId === part.partId && part.connections.partId === part.partId;
  const geometryReady = geometry.status === 'geometryReady' && !!geometry.mesh && !!geometry.bounds &&
    geometry.source.integrity === 'verified' && geometry.source.licenseStatus === 'complete' &&
    geometry.source.files.length > 0 && geometry.source.files.every(file => /^[a-f0-9]{64}$/.test(file.sha256) && !!file.license);
  // A dimension issue applies to its own emitted source point. Unsupported
  // inheritance/clear/include syntax cannot silently bless other points.
  const connectionSourceReady = part.connections.status === 'ready' || hasIsolatedUnknownDimensions(part);
  const sourceReady = identityReady && geometryReady && connectionSourceReady && part.connections.sourceFiles.length > 0 &&
    part.connections.sourceFiles.every(file => /^[a-f0-9]{64}$/.test(file.sha256) && !!file.license);
  const featureSupport: GrammarFeatureSupport[] = ingestion.connectors.map(feature => {
    const support = inspectConnectorSupport(feature);
    const original = part.connections.points.find(point => point.id === feature.sourceConnectionId);
    const supported = sourceReady && support.supported && support.ruleIds.includes('C01') &&
      !!original && supportsStandardStudEndpoint(original);
    return {
      featureId: feature.featureId, sourceConnectionId: feature.sourceConnectionId, family: feature.family,
      supported, ruleIds: supported ? ['C01'] : [], reasonCodes: supported ? [] :
        !sourceReady ? ['source-not-ready'] : support.supported && !support.ruleIds.includes('C01') ? ['native-joint-adapter-not-enabled'] : support.reasonCodes.length ? support.reasonCodes : ['unsupported-native-endpoint'],
    };
  });
  const supportedIds = [...new Set(featureSupport.filter(feature => feature.supported && feature.sourceConnectionId).map(feature => feature.sourceConnectionId!))];
  const connectable = supportedIds.length > 0;
  const proxy = buildNativeCollisionProxy(part, { instanceId: 'grammar-source', partId: part.partId, transform: IDENTITY_TRANSFORM });
  const collisionGeometryReady = proxy.status === 'ready';
  const generationEligible = sourceReady && connectable && collisionGeometryReady;
  const reasonCodes: string[] = [], reasons: string[] = [];
  if (!identityReady) { reasonCodes.push('grammar-source-identity-mismatch'); reasons.push('Part, geometry and connector source identities do not agree.'); }
  if (!geometryReady) { reasonCodes.push('grammar-native-geometry-unverified'); reasons.push('Complete hash-verified licensed native geometry is required.'); }
  if (!connectionSourceReady) { reasonCodes.push('grammar-source-interpretation-incomplete'); reasons.push('Connector source interpretation contains unresolved structural syntax or missing evidence.'); }
  if (!connectable) { reasonCodes.push('grammar-no-supported-connector'); reasons.push('No source feature satisfies an enabled native connector rule.'); }
  if (!collisionGeometryReady) { reasonCodes.push('grammar-collision-' + proxy.reasonCode); reasons.push(proxy.reason); }
  const capability: AssemblyInterfaceCapability = {
    partId: part.partId, admissionBasis: 'interface-grammar', grammarVersion: CONNECTOR_GRAMMAR_VERSION,
    sourceReady, collisionGeometryReady, connectable,
    assemblyVerified: false, generatable: generationEligible,
    allowedConnectionIds: generationEligible ? supportedIds : [],
    ruleIds: generationEligible ? [STANDARD_STUD_RULE_ID] : [],
    reasonCodes, reasons,
  };
  return {
    partId: part.partId, admissionBasis: 'interface-grammar', grammarVersion: CONNECTOR_GRAMMAR_VERSION,
    sourceDigest, sourceReady, collisionGeometryReady, connectable, generationEligible,
    assemblyVerified: false, generatorSmokePassed: false, physicalBuildVerified: false,
    ingestion, featureSupport, proxy: { status: proxy.status, reasonCode: proxy.reasonCode, reason: proxy.reason },
    capability, reasonCodes, reasons,
  };
}
