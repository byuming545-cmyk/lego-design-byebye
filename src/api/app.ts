import express, { type ErrorRequestHandler } from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { generateModel, GenerationError } from '../generators/index.js';
import { createBuildSteps } from '../instructions/steps.js';
import { createInventoryProvider, InventoryError, MissingRebrickableInventoryProvider, normalizeSetNumber, type SetInventoryProvider } from '../inventory/index.js';
import type { GenerationOptions, GenerationResult, SetInventory } from '../types/index.js';
import { validateModel } from '../validators/index.js';
import { createSpeedRouter } from '../speed/api.js';
import { createAutomotiveRouter } from '../automotive/api.js';
import { createPartsFoundationRouter } from '../parts/api.js';
import { createLegacyAuthenticityGate, type LegacyGenerationPolicy } from '../parts/legacyPolicy.js';
import { LEGACY_QUARANTINE } from '../parts/legacyStatus.js';

interface AppOptions {
  provider?: SetInventoryProvider;
  /** Historical algorithm regression fixtures only. Runtime always defaults to blocked. */
  legacyGenerationPolicy?: LegacyGenerationPolicy;
  /** Set false in tests; production defaults to the Vite dist directory. */
  staticDir?: string | false;
  partsDataDir?: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseOptions(value: unknown): GenerationOptions {
  if (!isObject(value) || Object.keys(value).some(key => !['prompt', 'size', 'colorStrategy', 'maximizeUsage'].includes(key)) ||
      typeof value.prompt !== 'string' || value.prompt.trim().length < 1 || value.prompt.length > 500 ||
      !['small', 'balanced', 'large'].includes(value.size as string) ||
      !['preserve', 'substitute', 'missing-parts'].includes(value.colorStrategy as string) ||
      typeof value.maximizeUsage !== 'boolean') {
    throw new InventoryError('生成参数无效：请输入 1–500 字描述，并选择有效的大小、颜色策略和零件利用选项。', 'INVALID_GENERATION_OPTIONS', 400);
  }
  if (value.colorStrategy === 'missing-parts') {
    throw new InventoryError('缺件清单模式计划在后续版本开放；V0.1 请使用保持配色或允许换色。', 'MISSING_PARTS_NOT_IMPLEMENTED', 400);
  }
  return { prompt: value.prompt.trim(), size: value.size as GenerationOptions['size'], colorStrategy: value.colorStrategy as GenerationOptions['colorStrategy'], maximizeUsage: value.maximizeUsage };
}

function applyUsage(inventory: SetInventory, result: GenerationResult): SetInventory {
  const counts = new Map<string, number>();
  for (const part of result.model.parts) {
    const key = `${part.partId}:${part.color.id}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return {
    ...inventory,
    items: inventory.items.map(item => ({ ...item, quantityUsed: counts.get(`${item.partId}:${item.color.id}`) ?? 0 })),
  };
}

export function createApp(options: AppOptions = {}) {
  const app = express();
  const provider = options.provider ?? createInventoryProvider();
  app.disable('x-powered-by');
  const defaultJson = express.json({ limit: '32kb', strict: true });
  const modelJson = express.json({ limit: '40mb', strict: true });
  const feedbackJson = express.json({ limit: '1mb', strict: true });
  const referenceJson = express.json({ limit: '10mb', strict: true });
  app.use((request, response, next) => (request.path === '/api/speed/models/import' ? modelJson : request.path === '/api/automotive/references/import' || request.path === '/api/parts-foundation/inventories/import' || request.path === '/api/parts-foundation/assembly/models/import' ? referenceJson : /^\/api\/speed\/models\/[^/]+\/feedback$/.test(request.path) ? feedbackJson : defaultJson)(request, response, next));
  app.use('/api/parts-foundation', createPartsFoundationRouter({ dataDir: options.partsDataDir }));
  app.use(createLegacyAuthenticityGate(options.legacyGenerationPolicy));
  app.use('/api/speed', createSpeedRouter(provider));
  app.use('/api/automotive', createAutomotiveRouter());

  app.get('/api/health', (_request, response) => {
    response.json({ status: 'ok', version: '0.6.0', provider: provider.source, demo: provider.source === 'mock', dataMode: provider instanceof MissingRebrickableInventoryProvider ? 'unconfigured' : provider.source === 'mock' ? 'mock' : 'real', primaryArea: '/part-lab', nativeAssemblyArea: '/part-lab?mode=assembly', legacyGenerationEnabled: options.legacyGenerationPolicy === 'test-fixture', legacyData: LEGACY_QUARANTINE });
  });

  app.get('/api/sets/:setNumber', async (request, response) => {
    const setNumber = normalizeSetNumber(request.params.setNumber);
    response.json(await provider.getSetInventory(setNumber));
  });

  app.post('/api/generate', async (request, response) => {
    if (!isObject(request.body) || Object.keys(request.body).some(key => !['setNumber', 'options'].includes(key))) {
      throw new InventoryError('请求应包含套装编号 setNumber 和生成选项 options。', 'INVALID_REQUEST', 400);
    }
    const setNumber = normalizeSetNumber(request.body.setNumber);
    const generationOptions = parseOptions(request.body.options);
    // Never accept a client-supplied inventory or previous usage. Re-read trusted data.
    const inventory = structuredClone(await provider.getSetInventory(setNumber));
    inventory.items.forEach(item => { item.quantityUsed = 0; });
    let model;
    try { model = generateModel(inventory, generationOptions); }
    catch (error) {
      if (error instanceof GenerationError) throw new InventoryError(error.message, error.code, 422);
      throw error;
    }
    const validation = validateModel(model, inventory);
    if (!validation.valid) {
      throw new InventoryError('生成的模型未通过库存及结构校验，已停止导出。请调整尺寸或描述后重试。', 'INVALID_GENERATED_MODEL', 422);
    }
    const result: GenerationResult = { model, validation, steps: createBuildSteps(model), inventory };
    result.inventory = applyUsage(inventory, result);
    response.json(result);
  });

  app.use('/api', (_request, response) => { response.status(404).json({ error: '未找到此 API。', code: 'API_NOT_FOUND' }); });

  const staticDir = options.staticDir === false ? undefined : path.resolve(options.staticDir ?? 'dist');
  if (staticDir && existsSync(path.join(staticDir, 'index.html'))) {
    app.use(express.static(staticDir, { dotfiles: 'deny', index: false }));
    app.use((request, response, next) => {
      if (request.method === 'GET' && request.accepts('html')) response.sendFile(path.join(staticDir, 'index.html'));
      else next();
    });
  }
  app.use((_request, response) => { response.status(404).json({ error: '未找到此资源。', code: 'NOT_FOUND' }); });

  const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
    if (error instanceof InventoryError) {
      response.status(error.status).json({ error: error.message, code: error.code });
      return;
    }
    const bodyError = error as { type?: string; status?: number };
    if (bodyError?.type === 'entity.too.large') {
      response.status(413).json({ error: '请求内容过大。', code: 'REQUEST_TOO_LARGE' });
    } else if (bodyError?.type === 'charset.unsupported' || bodyError?.type === 'encoding.unsupported') {
      response.status(415).json({ error: '请使用 UTF-8 编码的 JSON 请求。', code: 'UNSUPPORTED_ENCODING' });
    } else if (bodyError?.type === 'entity.parse.failed' || (bodyError instanceof SyntaxError && bodyError.status === 400)) {
      response.status(400).json({ error: '请求 JSON 格式无效。', code: 'INVALID_JSON' });
    } else {
      // No upstream body, stack, request headers, or environment values reach clients.
      response.status(500).json({ error: '服务器暂时无法完成请求，请稍后重试。', code: 'INTERNAL_ERROR' });
    }
  };
  app.use(errorHandler);
  return app;
}
