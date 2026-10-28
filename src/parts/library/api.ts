import { Router, type NextFunction, type Request, type Response } from 'express';
import { FeedbackError } from './feedback.js';
import type { InterfaceLibrary } from './interfaceLibrary.js';
import { StudioError, type AssemblyStudioService } from './studio.js';
import type { FeedbackInput, FeedbackPatch } from './types.js';

const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const partPattern = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/;
const casePattern = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/;
const rulePattern = /^[A-Z][A-Z0-9_]{0,63}$/;
function text(value: unknown, max = 500): string | null { return typeof value === 'string' && value.trim().length > 0 && value.length <= max ? value.trim() : null; }
function feedbackFailure(response: Response, error: unknown): boolean {
  if (!(error instanceof FeedbackError)) return false;
  response.status(error.status).json({ error: error.message, code: error.code });
  return true;
}

/** Server-only API for the reviewable interface and assembly library. */
export function createInterfaceLibraryRouter(options: { library: InterfaceLibrary; studio?: AssemblyStudioService }) {
  const router = Router();
  const library = options.library;
  const studio = options.studio;
  const handle = (work: (request: Request, response: Response) => Promise<void>) => async (request: Request, response: Response, next: NextFunction) => {
    try { await work(request, response); } catch (error) {
      if (feedbackFailure(response, error)) return;
      if (error instanceof StudioError) { response.status(error.status).json({ error: error.message, code: error.code }); return; }
      next(error);
    }
  };

  router.get('/overview', handle(async (_request, response) => { response.json(await library.overview()); }));
  router.get('/interfaces', handle(async (request, response) => {
    const query = request.query;
    const family = text(query.family, 40) ?? undefined, status = text(query.status, 30) ?? undefined, coverage = text(query.coverage, 20) ?? undefined, partId = text(query.partId, 80) ?? undefined;
    response.json(await library.interfaces({ family, status, coverage, partId, query: text(query.q, 200) ?? undefined, supported: text(query.supported, 10) ?? undefined, limit: Number(query.limit ?? 60), offset: Number(query.offset ?? 0) }));
  }));
  router.get('/interface', handle(async (request, response) => {
    const partId = text(request.query.partId, 80), featureId = text(request.query.featureId, 1200);
    if (!partId || !partPattern.test(partId) || !featureId) { response.status(400).json({ error: '请提供有效 partId 与 featureId。', code: 'INVALID_INTERFACE_QUERY' }); return; }
    const value = await library.instance(partId, featureId);
    if (!value) { response.status(404).json({ error: '没有该真实接口实例。', code: 'INTERFACE_NOT_FOUND' }); return; }
    response.json(value);
  }));
  router.get('/case', handle(async (request, response) => {
    const id = text(request.query.id, 80); if (!id || !casePattern.test(id)) { response.status(400).json({ error: '请提供有效案例编号。', code: 'INVALID_CASE_QUERY' }); return; }
    const value = (await library.cases()).find(item => item.id === id) ?? null;
    if (!value) { response.status(404).json({ error: '没有该装配案例。', code: 'CASE_NOT_FOUND' }); return; }
    response.json(value);
  }));
  router.get('/rules', handle(async (_request, response) => { response.json(await library.rules()); }));
  router.get('/rule', handle(async (request, response) => {
    const id = text(request.query.id, 64); if (!id || !rulePattern.test(id)) { response.status(400).json({ error: '请提供有效规则编号。', code: 'INVALID_RULE_QUERY' }); return; }
    const value = await library.rule(id); if (!value) { response.status(404).json({ error: '没有该规则。', code: 'RULE_NOT_FOUND' }); return; }
    response.json(value);
  }));
  router.get('/cases', handle(async (_request, response) => { response.json(await library.cases()); }));
  router.get('/queue', handle(async (_request, response) => { response.json(await library.queue()); }));
  router.post('/compare', handle(async (request, response) => {
    const body = request.body;
    if (!object(body) || typeof body.partId !== 'string' || !partPattern.test(body.partId) || (body.targetPartId !== undefined && (typeof body.targetPartId !== 'string' || !partPattern.test(body.targetPartId)))) {
      response.status(400).json({ error: '比较请求需要有效 partId，targetPartId 可选。', code: 'INVALID_COMPARE_REQUEST' }); return;
    }
    const value = await library.compare(body.partId, typeof body.targetPartId === 'string' ? body.targetPartId : null);
    if (!value) { response.status(404).json({ error: '没有该真实零件。', code: 'COMPARE_PART_NOT_FOUND' }); return; }
    response.json(value);
  }));
  router.get('/feedback', handle(async (request, response) => {
    response.json(await library.listFeedback({ targetId: text(request.query.targetId, 1200) ?? undefined, status: text(request.query.status, 40) as never }));
  }));
  router.post('/feedback', handle(async (request, response) => { response.status(201).json(await library.addFeedback(request.body as FeedbackInput)); }));
  router.patch('/feedback/:id', handle(async (request, response) => { response.json(await library.patchFeedback(String(request.params.id), request.body as FeedbackPatch)); }));
  router.post('/studio/validate', handle(async (request, response) => {
    if (!studio) { response.status(503).json({ error: '拼搭工作台服务未启用。', code: 'STUDIO_UNAVAILABLE' }); return; }
    response.json(await studio.validate(request.body));
  }));
  router.post('/studio/examples', handle(async (request, response) => {
    if (!studio) { response.status(503).json({ error: '拼搭工作台服务未启用。', code: 'STUDIO_UNAVAILABLE' }); return; }
    response.status(201).json(await studio.save(request.body));
  }));
  router.get('/studio/examples', handle(async (_request, response) => {
    if (!studio) { response.status(503).json({ error: '拼搭工作台服务未启用。', code: 'STUDIO_UNAVAILABLE' }); return; }
    response.json(await studio.list());
  }));
  router.get('/studio/examples/:id', handle(async (request, response) => {
    if (!studio) { response.status(503).json({ error: '拼搭工作台服务未启用。', code: 'STUDIO_UNAVAILABLE' }); return; }
    const value = await studio.get(String(request.params.id));
    if (!value) { response.status(404).json({ error: '没有该拼搭示例。', code: 'STUDIO_NOT_FOUND' }); return; }
    response.json(value);
  }));
  router.post('/studio/examples/:id/revalidate', handle(async (request, response) => {
    if (!studio) { response.status(503).json({ error: '拼搭工作台服务未启用。', code: 'STUDIO_UNAVAILABLE' }); return; }
    response.json(await studio.revalidate(String(request.params.id)));
  }));
  return router;
}
