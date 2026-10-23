import { Router } from 'express';
import { InventoryError } from '../inventory/index.js';
import { FoundationInventoryError, importFoundationInventoryCsv, importFoundationInventoryJson, type LocalInventoryOptions } from './inventory/index.js';
import { RealPartRegistry } from './registry.js';
import { storeLocalInventory } from './inventoryStore.js';

const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
function bad(message: string): never { throw new InventoryError(message, 'INVALID_FOUNDATION_REQUEST', 400); }

export function createPartsFoundationRouter(options: { dataDir?: string; registry?: RealPartRegistry } = {}) {
  const router = Router();
  const registry = options.registry ?? new RealPartRegistry(options);
  router.get('/status', async (_request, response) => { response.json(await registry.status()); });
  router.get('/parts', async (request, response) => {
    const query = request.query.query ?? '';
    if (typeof query !== 'string' || query.length > 120) bad('搜索文字最长为 120 个字符。');
    const parts = await registry.list(query as string);
    response.json({ parts, total: parts.length, identityNotice: 'LDraw part IDs and LEGO Element IDs are separate namespaces.' });
  });
  router.get('/parts/:partId', async (request, response) => {
    const id = request.params.partId;
    if (!/^(?:[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}|element:[1-9]\d{0,11})$/.test(id)) bad('零件编号格式无效。');
    const detail = await registry.get(id);
    if (!detail) throw new InventoryError('没有该编号的真实来源记录。不会创建占位几何。', 'FOUNDATION_PART_NOT_FOUND', 404);
    response.json(detail);
  });
  router.get('/inventories', async (_request, response) => { response.json({ inventories: await registry.inventories() }); });
  router.post('/inventories/import', async (request, response) => {
    const body = request.body;
    if (!object(body) || !['json', 'csv'].includes(String(body.format)) || typeof body.content !== 'string' || Object.keys(body).some(key => !['format', 'content', 'options'].includes(key))) bad('请选择 JSON 或 CSV，并提供原始清单及来源。');
    try {
      let inventory;
      if (body.format === 'json') inventory = importFoundationInventoryJson(body.content as string);
      else {
        if (!object(body.options)) bad('CSV 导入需要套装编号、清单编号和来源标识。');
        inventory = importFoundationInventoryCsv(body.content as string, body.options as unknown as LocalInventoryOptions);
      }
      const saved = await storeLocalInventory(registry.localInventoryDir, inventory, await registry.localInventoryCapacity());
      response.status(saved.alreadyPresent ? 200 : 201).json({ ...saved, note: '本地导入保留为用户提供的清单，不会自动验证映射或提升零件生成资格。' });
    } catch (error) {
      if (error instanceof FoundationInventoryError) throw new InventoryError(`清单未通过校验：${error.message}`, error.code, 400);
      throw error;
    }
  });
  return router;
}
