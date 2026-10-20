import { Router } from 'express';
import compression from 'compression';
import { InventoryError, type SetInventoryProvider } from '../inventory/index.js';
import { SPEED_CATALOG_STATS } from './catalog.js';
import { SpeedGenerationError } from './errors.js';
import { generateVehicleCandidates } from './generator.js';
import { addSpeedExtraParts, analyzeSpeedInventories, createSpeedDemoInventory, parseSpeedExtraParts, parseSpeedSetNumbers } from './inventory.js';
import { localRedesign } from './redesign.js';
import { candidateId, parseVehicleOptions, requestObject, SPEED_MODULE_IDS } from './requests.js';
import { SpeedDesignStore } from './sessions.js';
import { validateVehicle } from './validators.js';
import type { SpeedInventory, VehicleCandidate, VehicleModuleId } from './types.js';

function physicalParts(parts: VehicleCandidate['model']['parts']) {
  return parts.map(({ activeConnections: _connections, buildStep: _step, ...part }) => part).sort((a, b) => a.instanceId.localeCompare(b.instanceId));
}

export function createSpeedRouter(provider: SetInventoryProvider) {
  const router = Router();
  router.use(compression({ threshold: 1024 }));
  const store = new SpeedDesignStore();

  async function loadInventory(input: unknown, extraInput?: unknown): Promise<SpeedInventory> {
    const extras = parseSpeedExtraParts(extraInput);
    if (typeof input !== 'string' && (!Array.isArray(input) || !input.every(item => typeof item === 'string'))) {
      throw new InventoryError('请输入套装编号列表，或使用 DEMO-SPEED 独立演示库存。', 'INVALID_SPEED_SET_NUMBERS', 400);
    }
    const inputs = parseSpeedSetNumbers(input);
    const inventories = await Promise.all(inputs.map(async setNumber => {
      if (setNumber === 'DEMO-SPEED') return createSpeedDemoInventory();
      if (provider.source !== 'rebrickable') throw new InventoryError('读取真实 Speed 套装需要在服务端配置 Rebrickable API Key。可先使用 DEMO-SPEED 合成演示库存；演示数据不代表任何真实套装。', 'SPEED_REAL_PROVIDER_REQUIRED', 503);
      return provider.getSetInventory(setNumber);
    }));
    return addSpeedExtraParts(analyzeSpeedInventories(inventories), extras);
  }

  function checkedCandidate(candidate: VehicleCandidate, inventory: SpeedInventory): VehicleCandidate {
    const validation = validateVehicle(candidate.model, inventory);
    if (!validation.valid) throw new SpeedGenerationError(`模型未通过独立校验，未向用户输出：${validation.errors.join('；')}`, 'SPEED_VALIDATION_FAILED');
    return { ...candidate, validation };
  }

  function knownGenerationFailure(error: unknown): never {
    if (error instanceof SpeedGenerationError) throw new InventoryError(error.message, error.code, 422);
    throw error;
  }

  router.get('/catalog', (_request, response) => response.json(SPEED_CATALOG_STATS));
  router.get('/inventory', async (request, response) => response.json(await loadInventory(request.query.sets)));
  router.post('/inventory', async (request, response) => {
    const body = requestObject(request.body, ['setNumbers', 'extraParts']);
    response.json(await loadInventory(body.setNumbers, body.extraParts));
  });

  router.post('/generate', async (request, response) => {
    const body = requestObject(request.body, ['setNumbers', 'options', 'extraParts']);
    const options = parseVehicleOptions(body.options);
    const inventory = await loadInventory(body.setNumbers, body.extraParts);
    if (!inventory.analysis.canGenerate) throw new InventoryError(`当前库存缺少生成 Speed 车辆所需的关键零件：${inventory.analysis.missingRequirements.join('；')}`, 'SPEED_REQUIRED_PARTS_MISSING', 422);
    try {
      const candidates = generateVehicleCandidates(inventory, options).map(candidate => checkedCandidate(candidate, inventory));
      if (!candidates.length) throw new SpeedGenerationError('当前库存无法组成通过校验的完整汽车。', 'SPEED_NO_VALID_CANDIDATE');
      const warnings = [...inventory.warnings];
      if (candidates.length < 3) warnings.push(`当前库存和设计参数下返回 ${candidates.length} 个通过全部校验、结构不同的候选；其余方向未输出。`);
      const result = { inventory, candidates, warnings };
      const sessionId = store.create(result);
      response.json({ ...result, sessionId });
    } catch (error) { knownGenerationFailure(error); }
  });

  router.patch('/designs/:sessionId/modules/:moduleId', (request, response) => {
    const body = requestObject(request.body, ['candidateId', 'locked']);
    if (typeof body.locked !== 'boolean' || !SPEED_MODULE_IDS.includes(request.params.moduleId as VehicleModuleId)) throw new InventoryError('请输入有效模块和布尔锁定状态。', 'SPEED_INVALID_MODULE', 400);
    const session = store.get(request.params.sessionId);
    const candidate = structuredClone(store.candidate(session, candidateId(body.candidateId)));
    const module = candidate.model.modules.find(module => module.id === request.params.moduleId);
    if (!module) throw new InventoryError('当前方案中没有此模块。', 'SPEED_MODULE_NOT_FOUND', 404);
    module.locked = body.locked;
    const undoDepth = store.replace(session, candidate, false);
    response.json({ candidate, undoDepth });
  });

  router.post('/designs/:sessionId/redesign', (request, response) => {
    const body = requestObject(request.body, ['candidateId', 'prompt']);
    if (typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 500) throw new InventoryError('请输入 1–500 字的修改描述。', 'SPEED_INVALID_REDESIGN_PROMPT', 400);
    const session = store.get(request.params.sessionId);
    const candidate = store.candidate(session, candidateId(body.candidateId));
    // The engine receives copies; failed changes cannot mutate the active server state.
    try {
      const result = localRedesign(structuredClone(candidate), structuredClone(session.result.inventory), body.prompt.trim());
      let undoDepth = session.history.get(candidate.model.id)?.length ?? 0;
      if (result.success) {
        if (result.candidate.model.id !== candidate.model.id) throw new SpeedGenerationError('候选方案标识发生变化，修改已拒绝。', 'SPEED_CANDIDATE_ID_CHANGED');
        result.candidate = checkedCandidate(result.candidate, session.result.inventory);
        // Locks are a hard constraint even if a future generator forgets to enforce them.
        for (const module of candidate.model.modules.filter(module => module.locked)) {
          const before = candidate.model.parts.filter(part => part.moduleId === module.id);
          const after = result.candidate.model.parts.filter(part => part.moduleId === module.id);
          if (JSON.stringify(physicalParts(before)) !== JSON.stringify(physicalParts(after))) throw new SpeedGenerationError(`锁定模块 ${module.name} 发生变化。请先单独解锁，再重新修改；本次方案已保留。`, 'SPEED_LOCK_VIOLATION');
        }
        const actualChangedModules = SPEED_MODULE_IDS.filter(id => JSON.stringify(physicalParts(candidate.model.parts.filter(part => part.moduleId === id))) !== JSON.stringify(physicalParts(result.candidate.model.parts.filter(part => part.moduleId === id))));
        if (JSON.stringify([...actualChangedModules].sort()) !== JSON.stringify([...result.changedModules].sort())) throw new SpeedGenerationError('修改范围记录与实际结构变化不一致，已保留原方案。', 'SPEED_EDIT_SCOPE_MISMATCH');
        undoDepth = store.replace(session, result.candidate, actualChangedModules.length > 0);
      } else {
        result.candidate = structuredClone(candidate);
        result.rolledBack = true;
      }
      response.json({ ...result, undoDepth });
    } catch (error) {
      if (error instanceof SpeedGenerationError) {
        response.json({ success: false, candidate: structuredClone(candidate), changedModules: [], message: error.message, rolledBack: true, undoDepth: session.history.get(candidate.model.id)?.length ?? 0 });
      } else throw error;
    }
  });

  router.post('/designs/:sessionId/undo', (request, response) => {
    const body = requestObject(request.body, ['candidateId']);
    const session = store.get(request.params.sessionId);
    response.json(store.undo(session, candidateId(body.candidateId)));
  });
  return router;
}
