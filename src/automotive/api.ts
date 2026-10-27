import { Router } from 'express';
import { InventoryError } from '../inventory/index.js';
import { buildVehicleSteps } from '../speed/steps.js';
import { packCandidateSteps, unpackCandidateSteps } from '../speed/stepCodec.js';
import { getAutomotivePalette, createVirtualPaletteInventory, resolveAutomotiveColor } from './palette.js';
import { analyzeReferenceModel } from './references/analyzer.js';
import { createReferenceLink, importReferenceModel, ReferenceImportError } from './references/importer.js';
import { ReferenceLibraryStore } from './references/store.js';
import { RealVehicleResearchProvider, VehicleResearchError } from './research/provider.js';
import { toVehicleDesignBrief, VehicleBriefError } from './research/brief.js';
import { AutomotiveProfileStore } from './profiles.js';
import { AutomotiveSessionStore, newAutomotiveSessionId } from './sessions.js';
import { buildAutomotiveGrammar, type ClassifiedReferenceSample } from './grammar.js';
import { createDesignPatternLibrary, extractPatternCandidates, getConfirmedPatterns } from './patterns.js';
import { retrieveReferences } from './retrieval.js';
import { AutomotiveDesignValidator, DEFAULT_AUTOMOTIVE_RANKING_WEIGHTS, Ranking, type AutomotiveRankingWeights } from './quality.js';
import { generateAutomotiveCandidates } from './generator/index.js';
import type { ReferenceMetadataInput, ReferenceVehicleModel } from './references/types.js';
import type { AutomotiveCandidateResponse, AutomotiveDesignResponse, AutomotiveReferenceResponse } from './contracts.js';

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const bad = (message: string): never => { throw new InventoryError(message, 'INVALID_AUTOMOTIVE_REQUEST', 400); };
const string = (value: unknown, max = 500): string => typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : bad('请输入有效的文字参数。');
const warnings = ['参考检索、设计模式与几何评分属于规则系统；没有训练神经网络，也没有分析车辆照片。', '真实参考库初始为空；空库时只能使用明确标注的工程先验。', '官方网页在开发环境中受到网络限制，车型尺寸尚待联网核验或手动输入。'];

export function createAutomotiveRouter(options: { dataDir?: string } = {}) {
  const router = Router(), library = new ReferenceLibraryStore(options), sessions = new AutomotiveSessionStore(options), profiles = new AutomotiveProfileStore(options);
  const research = new RealVehicleResearchProvider();
  async function references(): Promise<AutomotiveReferenceResponse> {
    const entries = await library.list();
    const models = entries.filter((entry): entry is ReferenceVehicleModel => entry.kind === 'model');
    return { models, links: entries.filter(entry => entry.kind === 'link'), analyses: models.map(model => analyzeReferenceModel(model, { longitudinalAxis: model.metadata.longitudinalAxis, frontDirection: model.metadata.frontDirection })) };
  }
  router.get('/status', async (_request, response) => {
    const entries = await library.list();
    response.json({ version: '0.3.0', palette: getAutomotivePalette(), profiles: await profiles.list(),
      capabilities: { neuralTraining: false, imageAnalysis: false, pdfParsing: false, ldrawImport: true, semanticSimilarity: true, referenceModels: entries.filter(entry => entry.kind === 'model').length, physicalBuildsVerified: 0, generatableWidths: [8, 10, 12], customWidthPlanning: true },
      rankingWeights: DEFAULT_AUTOMOTIVE_RANKING_WEIGHTS, warnings });
  });
  router.post('/research', async (request, response) => {
    if (!object(request.body) || typeof request.body.live !== 'boolean' && request.body.live !== undefined) bad('车型研究参数无效。');
    response.json(await research.research(string(request.body.query), { mode: request.body.live === false ? 'catalog' : 'live' }));
  });
  router.post('/profiles/manual', async (request, response) => {
    try { response.status(201).json({ profile: await profiles.save(request.body) }); }
    catch (error) { if (error instanceof InventoryError) throw error; bad(error instanceof Error ? error.message : '手动车型资料无效。'); }
  });
  router.get('/references', async (_request, response) => { response.json(await references()); });
  router.get('/patterns', async (_request, response) => {
    const all = await references(), selected = all.models.slice(0, 20);
    const candidates = selected.flatMap(model => extractPatternCandidates(all.analyses.find(analysis => analysis.referenceId === model.id)!, model, { maxCandidates: 10 }));
    response.json({ confirmed: getConfirmedPatterns(createDesignPatternLibrary()), candidates,
      sourceModelsAssessed: selected.length, remainingModels: all.models.length - selected.length,
      warnings: ['自动提取结果是待审查局部拼搭候选，不自动进入生成器，也不代表已经验证实物强度。'] });
  });
  router.get('/references/:referenceId/patterns', async (request, response) => {
    const model = await library.get(request.params.referenceId);
    if (model.kind !== 'model') throw new InventoryError('来源链接尚无可分析的数字模型。', 'REFERENCE_LINK_ONLY', 422);
    const analysis = analyzeReferenceModel(model, { longitudinalAxis: model.metadata.longitudinalAxis, frontDirection: model.metadata.frontDirection });
    response.json({ candidates: extractPatternCandidates(analysis, model), referenceId: model.id });
  });
  router.post('/references/import', async (request, response) => {
    if (!object(request.body) || !object(request.body.metadata)) bad('请提供参考模型及来源信息。');
    const metadata = request.body.metadata as unknown as ReferenceMetadataInput;
    if (metadata.license === 'unknown') {
      if (request.body.content) bad('许可未确认时只能保存来源链接，不能保存模型内容。');
      const link = createReferenceLink(metadata); await library.save(link); response.status(201).json({ link, analysis: null }); return;
    }
    const axis = request.body.longitudinalAxis, front = request.body.frontDirection;
    if (axis !== undefined && axis !== 'x' && axis !== 'y' || front !== undefined && front !== -1 && front !== 1) bad('模型前进方向设置无效。');
    const model = importReferenceModel({ text: string(request.body.content, 8 * 1024 * 1024), filename: request.body.filename === undefined ? undefined : string(request.body.filename, 240), metadata: { ...metadata, ...(axis ? { longitudinalAxis: axis as 'x' | 'y' } : {}), ...(front ? { frontDirection: front as 1 | -1 } : {}) } });
    const analysis = analyzeReferenceModel(model, { longitudinalAxis: model.metadata.longitudinalAxis, frontDirection: model.metadata.frontDirection });
    await library.save(model); response.status(201).json({ model, analysis, patternCandidates: extractPatternCandidates(analysis, model, { maxCandidates: 20 }) });
  });
  router.post('/design', async (request, response) => {
    const body = request.body;
    if (!object(body)) bad('设计参数无效。');
    const width = body.widthStuds ?? 8, candidateCount = body.candidateCount ?? 8;
    if (typeof width !== 'number' || !Number.isInteger(width) || width < 6 || width > 24 || typeof candidateCount !== 'number' || !Number.isInteger(candidateCount) || candidateCount < 5 || candidateCount > 20 || body.allowEstimatedProportions !== undefined && typeof body.allowEstimatedProportions !== 'boolean') bad('车宽须为 6–24 的整数，候选数须为 5–20 的整数。');
    const profile = await profiles.get(string(body.profileId, 200));
    const brief = toVehicleDesignBrief(profile, { widthStuds: width as number, allowEstimatedProportions: body.allowEstimatedProportions === true });
    const all = await references();
    let selected = all.analyses;
    if (body.referenceIds !== undefined) {
      if (!Array.isArray(body.referenceIds) || body.referenceIds.length > 50 || body.referenceIds.some((id: unknown) => typeof id !== 'string' || !all.models.some(model => model.id === id))) bad('参考模型选择无效。');
      if (body.referenceIds.length) selected = all.analyses.filter(analysis => (body.referenceIds as string[]).includes(analysis.referenceId));
    }
    const referenceSet = retrieveReferences(brief, selected), chosenIds = new Set(referenceSet.references.map(entry => entry.referenceId));
    const analyses = selected.filter(analysis => chosenIds.has(analysis.referenceId));
    const samples: ClassifiedReferenceSample[] = all.analyses.filter(analysis => analysis.metadata.vehicleType && analysis.metadata.vehicleType !== 'unknown').map(analysis => ({ analysis, vehicleType: analysis.metadata.vehicleType as ClassifiedReferenceSample['vehicleType'], classificationEvidence: ['Explicit importer classification'], evidenceKind: 'imported-reference' }));
    const grammar = buildAutomotiveGrammar(samples), patterns = getConfirmedPatterns(createDesignPatternLibrary());
    const colorInput = body.bodyColor ?? 72;
    if (typeof colorInput !== 'string' && typeof colorInput !== 'number') bad('车身颜色参数无效。');
    const color = resolveAutomotiveColor(colorInput as string | number);
    let weights: Partial<AutomotiveRankingWeights> | undefined;
    if (body.weights !== undefined) {
      if (!object(body.weights) || Object.keys(body.weights).some(key => !Object.hasOwn(DEFAULT_AUTOMOTIVE_RANKING_WEIGHTS, key)) || Object.values(body.weights).some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) || Object.values(body.weights).length === 0) bad('评分权重无效。');
      weights = body.weights as Partial<AutomotiveRankingWeights>;
      if (Object.values({ ...DEFAULT_AUTOMOTIVE_RANKING_WEIGHTS, ...weights }).reduce((sum, value) => sum + value, 0) <= 0) bad('至少一个评分权重须大于零。');
    }
    const base = { schemaVersion: 1 as const, sessionId: newAutomotiveSessionId(), createdAt: new Date().toISOString(), profile, brief, color, references: referenceSet, referenceAnalyses: analyses, patterns,
      warnings: [...new Set([...warnings, ...brief.warnings, ...getAutomotivePalette().warnings, ...referenceSet.notes])],
    };
    if (![8, 10, 12].includes(width as number)) {
      const result: AutomotiveDesignResponse = { ...base, status: 'unsupported', message: '已生成自定义车宽 Brief；此宽度的轮架与车身布局尚未校准，暂不能生成或导出整车。', candidates: [], debug: { grammar, plans: [], diagnostics: [], rejections: [], candidateAssessments: [], physicalBuildsVerified: 0, imageAnalysis: 'not-configured', realModelCount: all.models.length } };
      await sessions.save(result); response.json(result); return;
    }
    const generated = generateAutomotiveCandidates({ brief, requestedColor: color.actual, references: analyses, patterns, candidateCount: candidateCount as number });
    const inventory = createVirtualPaletteInventory();
    const candidates: AutomotiveCandidateResponse[] = [], instructionErrors: AutomotiveDesignResponse['debug']['rejections'] = [];
    const withInstructions = generated.candidates.filter(candidate => {
      try { candidate.steps = buildVehicleSteps(candidate.model); return true; }
      catch { instructionErrors.push({ candidateId: candidate.model.id, hardErrors: ['无法生成连续的拼搭步骤，已阻止导出。'], designErrors: [] }); return false; }
    });
    const ranked = new Ranking().rank(withInstructions, inventory, brief, analyses[0], { weights });
    for (const candidate of ranked.candidates) {
      try {
        const check = new AutomotiveDesignValidator().validate(candidate.model, inventory, brief, analyses[0], { weights, steps: candidate.steps });
        if (!check.valid) { instructionErrors.push({ candidateId: candidate.model.id, hardErrors: check.hardErrors, designErrors: check.designErrors }); continue; }
        const plan = generated.plans.find(entry => generated.diagnostics.some(diagnostic => diagnostic.planId === entry.id && diagnostic.candidateId === candidate.model.id));
        candidates.push({ id: candidate.model.id, name: candidate.model.name, candidate: packCandidateSteps(candidate), scores: { ...check.scores, overall: check.overallScore, method: 'geometric-heuristic' },
          reasons: [...candidate.model.designNotes, ...(plan?.patternChoices.map(choice => `${choice.moduleId}: ${choice.reason}`) ?? [])], exportable: true, warnings: check.warnings, designValidation: check });
      } catch { instructionErrors.push({ candidateId: candidate.model.id, hardErrors: ['无法生成连续的拼搭步骤，已阻止导出。'], designErrors: [] }); }
    }
    const result: AutomotiveDesignResponse = { ...base, status: candidates.length ? 'accepted' : 'rejected', message: candidates.length ? `${candidates.length} 个候选通过几何设计门槛与物理规则校验；尚未实拼。` : 'No candidate met design quality threshold.', candidates,
      debug: { grammar, plans: generated.plans, diagnostics: generated.diagnostics, candidateAssessments: ranked.assessments, rejections: [...generated.rejections.map(entry => ({ candidateId: entry.planId, hardErrors: entry.errors, designErrors: [] })), ...ranked.rejections.map(entry => ({ candidateId: entry.candidateId, hardErrors: entry.hardErrors, designErrors: entry.designErrors, scores: { ...entry.designValidation.scores, overall: entry.designValidation.overallScore, method: 'geometric-heuristic' as const } })), ...instructionErrors], physicalBuildsVerified: 0, imageAnalysis: 'not-configured', realModelCount: all.models.length },
      warnings: [...new Set([...base.warnings, ...generated.warnings])],
    };
    await sessions.save(result); response.json(result);
  });
  router.get('/sessions/:sessionId', async (request, response) => { response.json(await sessions.get(request.params.sessionId)); });
  router.get('/sessions/:sessionId/candidates/:candidateId/:format', async (request, response) => {
    const session = await sessions.get(request.params.sessionId), selected = session.candidates.find(candidate => candidate.id === request.params.candidateId);
    if (!selected?.exportable || session.status !== 'accepted') throw new InventoryError('候选未通过设计与物理校验，不能导出。', 'AUTOMOTIVE_EXPORT_BLOCKED', 422);
    const candidate = unpackCandidateSteps(selected.candidate), inventory = createVirtualPaletteInventory();
    const check = new AutomotiveDesignValidator().validate(candidate.model, inventory, session.brief, session.referenceAnalyses[0], { weights: selected.designValidation.weights, steps: candidate.steps });
    if (!check.valid || check.instructions.status !== 'passed') throw new InventoryError('导出前复验失败，已阻止导出。', 'AUTOMOTIVE_EXPORT_BLOCKED', 422);
    if (request.params.format === 'instructions') { response.json({ candidate: selected.candidate, inventory }); return; }
    if (request.params.format === 'model.json') {
      response.setHeader('Content-Disposition', 'attachment; filename="automotive-model.json"'); response.json({ ...session, candidates: [selected] }); return;
    }
    if (request.params.format !== 'bom') throw new InventoryError('未找到此导出格式。', 'API_NOT_FOUND', 404);
    const groups = new Map<string, { partId: string; name: string; colorId: number; color: string; quantity: number }>();
    for (const part of candidate.model.parts) {
      const key = `${part.partId}:${part.color.id}`, row = groups.get(key) ?? { partId: part.partId, name: part.name, colorId: part.color.id, color: part.color.name, quantity: 0 };
      row.quantity++; groups.set(key, row);
    }
    const items = [...groups.values()];
    if (request.query.format === 'csv') {
      const cell = (value: unknown) => `"${String(value).replaceAll('"', '""')}"`;
      response.type('text/csv').setHeader('Content-Disposition', 'attachment; filename="automotive-bom.csv"');
      response.send('\uFEFF' + [['partId', 'name', 'colorId', 'color', 'quantity'], ...items.map(row => [row.partId, row.name, row.colorId, row.color, row.quantity])].map(row => row.map(cell).join(',')).join('\r\n'));
    } else if (request.query.format === undefined || request.query.format === 'json') response.json({ sessionId: session.sessionId, candidateId: selected.id, quantitySource: 'virtual-unlimited-not-owned', partColorAvailability: 'not-verified', physicalBuildsVerified: 0, items });
    else bad('BOM 格式须为 csv 或 json。');
  });
  router.use((error: unknown, _request: unknown, _response: unknown, next: (error: unknown) => void) => {
    if (error instanceof ReferenceImportError) next(new InventoryError(error.message, error.code, error.status));
    else if (error instanceof VehicleBriefError || error instanceof VehicleResearchError) next(new InventoryError(error.message, error.code, 422));
    else next(error);
  });
  return router;
}
