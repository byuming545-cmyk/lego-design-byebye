/** Readiness axes are independent. Imported evidence never implies a physical build. */
export type PartTrustStage = 'catalogOnly' | 'geometryReady' | 'connectionReady' | 'collisionReady' | 'generatable' | 'verified';
export type CheckOutcome = 'passed' | 'failed' | 'not-run' | 'not-applicable';
export interface PartCheck {
  id: string;
  outcome: CheckOutcome;
  description: string;
}
export interface PartReadiness {
  catalogOnly: boolean;
  geometryReady: boolean;
  connectionReady: boolean;
  collisionReady: boolean;
  generatable: boolean;
  verified: boolean;
  status: PartTrustStage;
  checks: PartCheck[];
  physicalBuildVerified: false;
}

/** Only server-computed evidence can reach this function; no HTTP promotion endpoint exists. */
export function assessPartReadiness(input: {
  geometryReady: boolean;
  connectionReady: boolean;
  collisionReady: boolean;
  checks: PartCheck[];
}): PartReadiness {
  const checks = input.checks.map(check => ({ ...check }));
  const passed = (id: string) => checks.some(check => check.id === id && check.outcome === 'passed');
  const applicablePassed = checks.every(check => check.outcome === 'passed' || check.outcome === 'not-applicable');
  // Mesh/connector parsing tests alone cannot establish legal attachment or clearance.
  const generatable = input.geometryReady && input.connectionReady && input.collisionReady && applicablePassed &&
    ['source-integrity', 'mesh-integrity', 'rotation', 'attachment', 'collision-clearance'].every(passed);
  const verified = generatable && passed('part-verification');
  return {
    catalogOnly: !input.geometryReady,
    geometryReady: input.geometryReady,
    connectionReady: input.connectionReady,
    collisionReady: input.collisionReady,
    generatable,
    verified,
    status: verified ? 'verified' : generatable ? 'generatable' : input.collisionReady ? 'collisionReady' : input.connectionReady ? 'connectionReady' : input.geometryReady ? 'geometryReady' : 'catalogOnly',
    checks,
    physicalBuildVerified: false,
  };
}
