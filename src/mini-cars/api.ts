import { Router } from 'express';
import compression from 'compression';
import { MiniCarService } from './service.js';
import { MiniCarError } from './catalog.js';

export function createMiniCarsRouter(service = new MiniCarService()) {
  const router = Router();
  router.use(compression());
  router.use((_request, response, next) => { response.setHeader('Cache-Control', 'no-store'); next(); });
  router.post('/generate', async (request, response) => { response.json(await service.payload(await service.generate(request.body))); });
  router.get('/models', async (_request, response) => { response.json({ models: await service.list() }); });
  router.post('/models', async (request, response) => {
    if (!request.body || Object.keys(request.body).length !== 1 || !request.body.model) throw new MiniCarError('请提供完整的外观模型。');
    response.json(await service.save(request.body.model));
  });
  router.post('/models/import', async (request, response) => {
    if (!request.body || Object.keys(request.body).length !== 1 || typeof request.body.content !== 'string' || request.body.content.length > 2 * 1024 * 1024) throw new MiniCarError('请选择大小合适的迷你跑车 JSON。');
    let value: unknown; try { value = JSON.parse(request.body.content); } catch { throw new MiniCarError('模型 JSON 格式无效。'); }
    response.json(await service.payload(await service.validate(value)));
  });
  router.get('/models/:id', async (request, response) => { response.json(await service.payload(await service.open(request.params.id))); });
  router.get('/models/:id/export', async (request, response) => {
    const model = await service.open(request.params.id);
    if (request.query.format !== undefined && !['json','bom'].includes(String(request.query.format))) throw new MiniCarError('请选择 JSON 或 BOM 格式。');
    const bom = request.query.format === 'bom';
    response.setHeader('Content-Disposition', `attachment; filename="${model.id}.${bom ? 'csv' : 'mini-car.json'}"`);
    response.type(bom ? 'text/csv' : 'application/json').send(bom ? '\uFEFF' + service.bomCsv(model) : JSON.stringify(model, null, 2));
  });
  router.use((error: unknown, _request: import('express').Request, response: import('express').Response, next: import('express').NextFunction) => {
    if (error instanceof MiniCarError) response.status(error.status).json({ error: error.message, code: error.code }); else next(error);
  });
  return router;
}
