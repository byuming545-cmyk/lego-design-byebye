import { Router } from 'express';
import { LEGACY_GENERATION_BLOCK } from './legacyStatus.js';
export { LEGACY_GENERATION_BLOCK, LEGACY_PART_AUTHENTICITY } from './legacyStatus.js';

/** The legacy engines are retained only as reproducible algorithm fixtures.
 * This option is a server construction argument, never a request or env flag. */
export type LegacyGenerationPolicy = 'blocked' | 'test-fixture';

/** Do not derive production trust from a historical catalog's `supported` flag.
 * A pinned header URL is an identity reference, not an imported geometry proof. */
export function isLegacyPartGeneratable(_partId: string): false { return false; }

/** Mount before the old routers. Express matches the same route syntax and
 * case/trailing-slash rules here as it does in their handlers. Reading saved
 * archives and research stays available, without upgrading any trust status. */
export function createLegacyAuthenticityGate(policy: LegacyGenerationPolicy = 'blocked') {
  if (policy !== 'blocked' && policy !== 'test-fixture') throw new Error('Invalid legacy generation policy.');
  const gate = Router();
  gate.use((request, response, next) => {
    if (/^\/api\/(?:generate(?:\/|$)|sets(?:\/|$)|speed(?:\/|$)|automotive(?:\/|$))/i.test(request.path)) {
      response.setHeader('X-Bricklab-Part-Authenticity', 'legacy-parametric-unverified');
      response.setHeader('X-Bricklab-Legacy-Status', 'LEGACY_QUARANTINED');
      if (policy === 'test-fixture') response.setHeader('X-Bricklab-Legacy-Fixture', 'true');
    }
    next();
  });
  if (policy === 'test-fixture') return gate;
  const deny = (_request: unknown, response: { status: (status: number) => { json: (body: unknown) => unknown } }) => {
    response.status(409).json(LEGACY_GENERATION_BLOCK);
  };
  gate.post(['/api/generate', '/api/speed/generate', '/api/automotive/design', '/api/speed/models/import', '/api/speed/models/:modelId/open'], deny);
  gate.patch('/api/speed/designs/:sessionId/modules/:moduleId', deny);
  gate.post(['/api/speed/designs/:sessionId/redesign', '/api/speed/designs/:sessionId/undo'], deny);
  gate.get('/api/speed/models/:modelId/export', deny);
  gate.get('/api/automotive/sessions/:sessionId/candidates/:candidateId/:format', deny);
  return gate;
}
