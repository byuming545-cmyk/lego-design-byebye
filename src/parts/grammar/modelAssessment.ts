import type { NativeAssembly, NativeAssemblyPart } from '../assembly/types.js';
import { adaptNativePartConnectors, adaptImportedConnection } from './sources.js';
import { evaluateConnectorCompatibility } from './rules.js';
import { solveConnectorPlacement } from './solver.js';
import { classifyAssemblyBuildingPatterns, type PatternJointEvidence } from './patterns.js';
import { evaluateGrammarLegality, scoreGrammarStability } from './validation.js';
import { CONNECTOR_GRAMMAR_VERSION } from './schema.js';

/** Called only AFTER the authoritative engine validates the complete graph.
 * It describes that result; it is not a replacement for graph validation. */
export function describeValidatedNativeModel(graph: NativeAssembly, parts: ReadonlyMap<string, NativeAssemblyPart>) {
  const placements = new Map(graph.placements.map(node => [node.instanceId, node]));
  const joints: PatternJointEvidence[] = [];
  const constraints = graph.edges.map(edge => {
    const fixedPlacement = placements.get(edge.fixedInstanceId)!, movingPlacement = placements.get(edge.movingInstanceId)!;
    const fixed = adaptImportedConnection(parts.get(fixedPlacement.partId)!.connections.points.find(point => point.id === edge.fixedConnectionId)!);
    const moving = adaptImportedConnection(parts.get(movingPlacement.partId)!.connections.points.find(point => point.id === edge.movingConnectionId)!);
    const compatibility = evaluateConnectorCompatibility(fixed, moving);
    const placement = solveConnectorPlacement({ fixed, moving, fixedTransform: fixedPlacement.transform, anglesDeg: [edge.twistDeg] });
    const pairCount = graph.edges.filter(other => [other.fixedInstanceId, other.movingInstanceId].sort().join('/') === [edge.fixedInstanceId, edge.movingInstanceId].sort().join('/')).length;
    joints.push({ featureIds: [edge.fixedInstanceId + '/' + fixed.featureId, edge.movingInstanceId + '/' + moving.featureId], compatibility, placement, validatedMateCount: pairCount });
    return { edgeId: edge.id, ruleId: compatibility.ruleId, joint: compatibility.joint,
      ...evaluateGrammarLegality({ compatibility, placement, collision: { status: 'CLEAR', reason: 'The complete native graph passed current solid/contact validation.', sourceBoundedContactChecked: true } }) };
  });
  return {
    grammarVersion: CONNECTOR_GRAMMAR_VERSION,
    scope: 'current-source-final-rigid-pose-and-connector-graph' as const,
    constraints,
    topology: classifyAssemblyBuildingPatterns(graph.placements.map(node => ({
      instanceId: node.instanceId, transform: node.transform, connectors: adaptNativePartConnectors(parts.get(node.partId)!).connectors,
    })), { joints }),
    stability: scoreGrammarStability({ connections: graph.edges.map(edge => ({
      fixedInstanceId: edge.fixedInstanceId, fixedFeatureId: edge.fixedConnectionId,
      movingInstanceId: edge.movingInstanceId, movingFeatureId: edge.movingConnectionId,
      family: 'STUD', jointType: 'RIGID', friction: 'UNKNOWN', contactAreaLdu2: null, leverArmLdu: null,
    })) }),
    materialStress: 'UNKNOWN' as const,
    physicalBuildVerified: false as const,
  };
}
