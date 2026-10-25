import { Router } from 'express';
import { InventoryError } from '../inventory/provider.js';
import { FoundationInventoryError, importFoundationInventoryCsv, importFoundationInventoryJson, type LocalInventoryOptions } from './inventory/index.js';
import { RealPartRegistry } from './registry.js';
import { storeLocalInventory } from './inventoryStore.js';
import { NATIVE_MODULE_TYPES, type NativeModuleType } from './assembly/generator.js';
import { exportNativeAssemblyBomCsv, exportNativeAssemblyJson, exportNativeAssemblyLDraw } from './assembly/documents.js';
import { buildNativeCollisionProxy } from './assembly/proxy.js';
import { IDENTITY_TRANSFORM } from './assembly/math.js';
import { NativeModelImportError } from './assembly/modelImport.js';

const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
function bad(message: string): never { throw new InventoryError(message, 'INVALID_FOUNDATION_REQUEST', 400); }

export function createPartsFoundationRouter(options: { dataDir?: string; registry?: RealPartRegistry } = {}) {
  const router = Router();
  const registry = options.registry ?? new RealPartRegistry(options);
  const assembly = registry.assemblyService;
  router.get('/assembly/status', async (_request, response) => { response.json(await assembly.status()); });
  router.post('/assembly/models/import', async (request, response) => {
    const body = request.body;
    if (!object(body) || Object.keys(body).some(key => key !== 'content') || typeof body.content !== 'string' || body.content.length > 5 * 1024 * 1024) bad('请提供不超过 5 MiB 的真实装配 JSON 文件内容。');
    try {
      const value: unknown = JSON.parse(body.content as string);
      response.json(await assembly.importModel(value));
    } catch (error) {
      if (error instanceof NativeModelImportError || error instanceof SyntaxError) bad(error instanceof NativeModelImportError ? error.message : '模型 JSON 格式无效。');
      throw error;
    }
  });
  router.post('/assembly/attach', async (request, response) => {
    const body = request.body;
    const keys = ['partA', 'connectionA', 'partB', 'connectionB', 'twistDegrees'];
    if (!object(body) || Object.keys(body).some(key => !keys.includes(key)) ||
        ['partA', 'partB'].some(key => typeof body[key] !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(body[key] as string)) ||
        ['connectionA', 'connectionB'].some(key => typeof body[key] !== 'string' || !(body[key] as string).length || (body[key] as string).length > 1000) ||
        body.twistDegrees !== undefined && (typeof body.twistDegrees !== 'number' || ![0, 90, 180, 270].includes(body.twistDegrees))) bad('请选择真实零件、来源连接口和有效离散旋转。');
    const capability = await assembly.getCapability(body.partA as string);
    if (!capability) throw new InventoryError('没有该原生零件来源。', 'FOUNDATION_PART_NOT_FOUND', 404);
    if (!await assembly.getCapability(body.partB as string)) throw new InventoryError('没有该候选原生零件来源。', 'FOUNDATION_PART_NOT_FOUND', 404);
    if (!capability.assemblyVerified || !capability.generatable) throw new InventoryError(`该起始件尚未获得装配准入：${capability.reasons.join(' ')}`, 'ASSEMBLY_PART_BLOCKED', 409);
    response.json(await assembly.attach({ partA: body.partA as string, connectionA: body.connectionA as string, partB: body.partB as string, connectionB: body.connectionB as string, ...(body.twistDegrees === undefined ? {} : { twistDegrees: body.twistDegrees as number }) }));
  });
  router.post('/assembly/generate', async (request, response) => {
    const body = request.body;
    if (!object(body) || Object.keys(body).some(key => !['kind', 'module', 'partCount'].includes(key)) ||
        body.kind !== undefined && body.module !== undefined ||
        !NATIVE_MODULE_TYPES.includes((body.kind ?? body.module) as NativeModuleType) ||
        body.partCount !== undefined && (!Number.isInteger(body.partCount) || (body.partCount as number) < 3 || (body.partCount as number) > 32)) bad('请选择受支持的基础结构，零件数量应为 3–32。');
    if ((body.kind ?? body.module) === 'basic-snot' && body.partCount !== undefined && body.partCount !== 3) bad('当前基础侧向模块固定由 3 个真实零件组成。');
    response.json(await assembly.generate({ module: (body.kind ?? body.module) as NativeModuleType, ...(body.partCount === undefined ? {} : { partCount: body.partCount as number }) }));
  });
  router.get('/assembly/models/:modelId/export', async (request, response) => {
    const format = request.query.format ?? 'json';
    if (typeof format !== 'string' || !['json', 'ldr', 'csv'].includes(format) || !/^[a-zA-Z0-9_-]{1,100}$/.test(request.params.modelId)) bad('导出格式或模型编号无效。');
    const model = assembly.getModel(request.params.modelId);
    if (!model) throw new InventoryError('模型不存在或已从当前服务缓存释放，请重新生成。', 'ASSEMBLY_MODEL_NOT_FOUND', 404);
    const validation = await assembly.engine.validateGraph(model);
    if (!validation.valid) throw new InventoryError('模型的来源或装配规则已不再有效，请重新生成。', 'ASSEMBLY_MODEL_REVOKED', 409);
    const exporters = { json: exportNativeAssemblyJson, ldr: exportNativeAssemblyLDraw, csv: exportNativeAssemblyBomCsv };
    response.type(format === 'json' ? 'application/json' : format === 'csv' ? 'text/csv' : 'text/plain');
    response.setHeader('Content-Disposition', `attachment; filename="bricklab-${model.module}.${format}"`);
    response.send(exporters[format as keyof typeof exporters](model));
  });
  router.get('/recovery', async (_request, response) => { response.json(await registry.recovery()); });
  router.get('/instructions/coverage', async (_request, response) => { response.json(await registry.instructionCoverage()); });
  router.get('/elements/:elementId/mapping', async (request, response) => {
    if (!/^[1-9]\d{0,11}$/.test(request.params.elementId)) bad('Element ID 格式无效。');
    response.json(await registry.elementMapping(request.params.elementId));
  });
  router.get('/status', async (_request, response) => { response.json(await registry.status()); });
  router.get('/parts', async (request, response) => {
    const query = request.query.query ?? '';
    if (typeof query !== 'string' || query.length > 120) bad('搜索文字最长为 120 个字符。');
    const parts = await registry.list(query as string);
    response.json({ parts, total: parts.length, identityNotice: 'LDraw part IDs and LEGO Element IDs are separate namespaces.' });
  });
  router.get('/parts/:partId/collision-proxy', async (request, response) => {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(request.params.partId)) bad('零件编号格式无效。');
    const part = await assembly.getPart(request.params.partId);
    if (!part) throw new InventoryError('没有该编号的原生零件。', 'FOUNDATION_PART_NOT_FOUND', 404);
    const result = buildNativeCollisionProxy(part, { instanceId: `debug-${part.partId}`, partId: part.partId, transform: IDENTITY_TRANSFORM });
    if (!result.proxy) { response.json({ status: result.status, reason: result.reason, reasonCode: result.reasonCode }); return; }
    const positions = result.proxy.triangles.flatMap(triangle => triangle.vertices);
    response.json({ status: result.status, reason: result.reason, reasonCode: result.reasonCode, coordinateSystem: 'ldraw-native', mesh: { positions, indices: positions.map((_point, index) => index) }, bounds: result.proxy.bounds, topology: result.proxy.topology, evidence: result.proxy.evidence });
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
