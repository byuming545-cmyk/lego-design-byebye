import { jsPDF } from 'jspdf';
import type { BuildStep, GenerationResult, PlacedPart } from '../types/index.js';
import { renderIsometric } from '../lego/renderIsometric.js';

const PAGE_WIDTH = 1240;
const PAGE_HEIGHT = 1754;
const MARGIN = 86;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const FOOTER_Y = PAGE_HEIGHT - 74;
const CONTENT_END = FOOTER_Y - 54;
const FONT = '"Noto Sans SC", sans-serif';
const INK = '#24332b';
const MUTED = '#6c766d';

interface Page { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; y: number }
interface PartGroup { part: PlacedPart; quantity: number }

/** Optional adapters let specialized builders reuse pagination without changing V0.1. */
export interface InstructionsPdfOptions {
  renderModel?: (canvas: HTMLCanvasElement, parts: PlacedPart[], context: {
    step: BuildStep | null;
    highlightIds: string[];
    background: string;
  }) => void;
  editionLabel?: string;
  creator?: string;
  footerLabel?: string;
  readingGuide?: string;
  stepSummary?: (step: BuildStep) => string;
  stepPartsHeading?: (step: BuildStep) => string;
  emptyPartsText?: (step: BuildStep) => string;
}

function canvas(width: number, height: number): HTMLCanvasElement {
  const element = document.createElement('canvas');
  element.width = width; element.height = height;
  return element;
}

function font(ctx: CanvasRenderingContext2D, size: number): void {
  // The shipped regular font keeps CJK output consistent across operating systems.
  ctx.font = `400 ${size}px ${FONT}`;
  ctx.textBaseline = 'top';
}

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of String(text).split('\n')) {
    let line = '';
    for (const character of Array.from(paragraph)) {
      if (line && ctx.measureText(line + character).width > width) {
        lines.push(line); line = character;
      } else line += character;
    }
    lines.push(line);
  }
  return lines;
}

function addPage(pages: Page[], label: string): Page {
  const element = canvas(PAGE_WIDTH, PAGE_HEIGHT);
  const ctx = element.getContext('2d');
  if (!ctx) throw new Error('浏览器不支持 Canvas，无法生成拼搭说明书。');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
  ctx.fillStyle = '#dc4f39'; ctx.fillRect(MARGIN, 65, 32, 32);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(MARGIN + 11, 76, 3, 0, Math.PI * 2); ctx.arc(MARGIN + 22, 76, 3, 0, Math.PI * 2); ctx.fill();
  font(ctx, 24); ctx.fillStyle = INK; ctx.fillText('BRICKLAB', MARGIN + 46, 68);
  font(ctx, 19); ctx.fillStyle = MUTED; ctx.textAlign = 'right'; ctx.fillText(label, PAGE_WIDTH - MARGIN, 73); ctx.textAlign = 'left';
  ctx.strokeStyle = '#e5e9e2'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(MARGIN, 119); ctx.lineTo(PAGE_WIDTH - MARGIN, 119); ctx.stroke();
  const page = { canvas: element, ctx, y: 155 };
  pages.push(page);
  return page;
}

function text(page: Page, value: string, size: number, color = INK, lineHeight = size * 1.6, width = CONTENT_WIDTH): number {
  font(page.ctx, size); page.ctx.fillStyle = color;
  const lines = wrap(page.ctx, value, width);
  for (const line of lines) { page.ctx.fillText(line, MARGIN, page.y); page.y += lineHeight; }
  return lines.length;
}

function flowText(pages: Page[], initial: Page, value: string, size: number, label: string, color = MUTED): Page {
  let page = initial;
  font(page.ctx, size);
  const lines = wrap(page.ctx, value, CONTENT_WIDTH);
  for (const line of lines) {
    if (page.y + size * 1.6 > CONTENT_END) page = addPage(pages, label);
    text(page, line, size, color);
  }
  return page;
}

function groupParts(parts: PlacedPart[]): PartGroup[] {
  const groups = new Map<string, PartGroup>();
  for (const part of parts) {
    const key = `${part.partId}:${part.color.id}`;
    const existing = groups.get(key);
    if (existing) existing.quantity++;
    else groups.set(key, { part, quantity: 1 });
  }
  return [...groups.values()];
}

function modelImage(page: Page, parts: PlacedPart[], y: number, height: number, highlights: string[] = [], options: InstructionsPdfOptions = {}, step: BuildStep | null = null): void {
  const image = canvas(CONTENT_WIDTH, height);
  if (options.renderModel) options.renderModel(image, parts, { step, highlightIds: highlights, background: '#f6f7f1' });
  else renderIsometric(image, parts, { highlightIds: highlights, background: '#f6f7f1' });
  page.ctx.drawImage(image, MARGIN, y);
  page.y = y + height;
}

function tableHeader(page: Page, heading = '本步所需零件'): void {
  const { ctx } = page;
  ctx.fillStyle = '#eef2ea'; ctx.fillRect(MARGIN, page.y, CONTENT_WIDTH, 48);
  font(ctx, 19); ctx.fillStyle = MUTED;
  ctx.fillText(heading, MARGIN + 18, page.y + 12);
  ctx.fillText('编号 / 颜色', MARGIN + 620, page.y + 12);
  ctx.textAlign = 'right'; ctx.fillText('数量', PAGE_WIDTH - MARGIN - 18, page.y + 12); ctx.textAlign = 'left';
  page.y += 48;
}

function partTable(pages: Page[], initial: Page, parts: PlacedPart[], label: string, heading = '本步所需零件'): Page {
  let page = initial;
  if (page.y + 120 > CONTENT_END) page = addPage(pages, label);
  tableHeader(page, heading);
  for (const group of groupParts(parts)) {
    const { part, quantity } = group;
    font(page.ctx, 20);
    const names = wrap(page.ctx, part.name, 510);
    const details = wrap(page.ctx, `${part.partId} / ${part.color.name}`, 290);
    const rowHeight = Math.max(72, Math.max(names.length, details.length) * 30 + 28);
    // Extremely long user/API labels are split over rows so no text leaves a page.
    const maxLines = Math.max(1, Math.floor((CONTENT_END - 155 - 48 - 28) / 30));
    const rowSlices = Math.ceil(Math.max(names.length, details.length) / maxLines);
    for (let slice = 0; slice < rowSlices; slice++) {
      const nameSlice = names.slice(slice * maxLines, (slice + 1) * maxLines);
      const detailSlice = details.slice(slice * maxLines, (slice + 1) * maxLines);
      const height = rowSlices === 1 ? rowHeight : Math.max(72, Math.max(nameSlice.length, detailSlice.length) * 30 + 28);
      if (page.y + height > CONTENT_END) { page = addPage(pages, label); tableHeader(page, heading); }
      const { ctx } = page;
      const y = page.y;
      font(ctx, 20); ctx.fillStyle = INK;
      nameSlice.forEach((line, index) => ctx.fillText(line, MARGIN + 61, y + 19 + index * 30));
      ctx.fillStyle = MUTED;
      detailSlice.forEach((line, index) => ctx.fillText(line, MARGIN + 620, y + 19 + index * 30));
      ctx.fillStyle = part.color.hex; ctx.fillRect(MARGIN + 18, y + 20, 25, 25);
      ctx.strokeStyle = '#b7bcb5'; ctx.strokeRect(MARGIN + 18, y + 20, 25, 25);
      if (slice === 0) { ctx.fillStyle = INK; ctx.textAlign = 'right'; ctx.fillText(`× ${quantity}`, PAGE_WIDTH - MARGIN - 18, y + 19); ctx.textAlign = 'left'; }
      ctx.strokeStyle = '#e5e9e2'; ctx.beginPath(); ctx.moveTo(MARGIN, y + height); ctx.lineTo(PAGE_WIDTH - MARGIN, y + height); ctx.stroke();
      page.y += height;
    }
  }
  return page;
}

async function loadFonts(result: GenerationResult, options: InstructionsPdfOptions): Promise<void> {
  if (!document.fonts) return;
  const content = [...new Set(Array.from([
    '创意拼搭说明书把灵感，一块块搭出来。完成模型模型信息尺寸：格，高板单位来源套装数据来源拼搭提示步骤本步所需新增零件数量颜色编号验证未通过',
    '阅读方式：按步骤从下往上拼搭。绿色描边表示本步新增零件；颜色方块与零件编号用于核对库存。纵向板单位薄板，普通砖高板单位。种零件与颜色个步骤完成后共零件清单续页',
    result.model.name, result.model.description, result.inventory.name, result.inventory.sourceLabel, ...result.model.notes, ...result.inventory.warnings,
    ...result.validation.warnings, ...result.validation.errors,
    ...result.steps.flatMap(step => [step.title, step.description]),
    options.editionLabel ?? '', options.footerLabel ?? '', options.readingGuide ?? '',
    ...result.steps.flatMap(step => [options.stepSummary?.(step) ?? '', options.stepPartsHeading?.(step) ?? '', options.emptyPartsText?.(step) ?? '']),
    ...result.model.parts.flatMap(part => [part.name, part.color.name]),
  ].join('')))].join('');
  // Fontsource uses unicode-range subsets: load the actual glyphs before rasterizing.
  await document.fonts.load(`400 24px ${FONT}`, content);
  await document.fonts.ready;
}

/** Build a complete PDF locally. All Chinese copy is rasterized with the bundled CJK font. */
export async function buildInstructionsPdf(result: GenerationResult, options: InstructionsPdfOptions = {}): Promise<jsPDF> {
  await loadFonts(result, options);
  const pages: Page[] = [];
  let page = addPage(pages, options.editionLabel ?? '创意拼搭 · V0.1');
  text(page, '把灵感，一块块搭出来。', 21, MUTED);
  page.y += 15;
  page = flowText(pages, page, result.model.name, 48, '拼搭说明书', INK);
  page.y += 12;
  page = flowText(pages, page, result.model.description, 22, '拼搭说明书');
  page.y += 24;
  // Always reserve enough room for a useful, uncropped view of the final model.
  if (page.y + 650 > CONTENT_END) page = addPage(pages, '完成模型');
  modelImage(page, result.model.parts, page.y, 610, [], options);
  page.y += 30;
  const typeCount = groupParts(result.model.parts).length;
  page = flowText(pages, page, `${result.model.parts.length} 块零件    /    ${typeCount} 种零件与颜色    /    ${result.steps.length} 个步骤`, 25, '模型信息', INK);
  page = flowText(pages, page, `尺寸：${result.model.dimensions.x} × ${result.model.dimensions.y} 格，高 ${result.model.dimensions.z} 板单位`, 20, '模型信息');
  page = flowText(pages, page, `来源套装：${result.inventory.setNumber} · ${result.inventory.name}`, 20, '模型信息');
  page = flowText(pages, page, `数据来源：${result.inventory.sourceLabel}`, 20, '模型信息');
  page.y += 15;
  page = flowText(pages, page, options.readingGuide ?? '阅读方式：按步骤从下往上拼搭。绿色描边表示本步新增零件；颜色方块与零件编号用于核对库存。纵向 1 板单位 = 1 块薄板，普通砖高 3 板单位。', 20, '拼搭提示');
  const notes = [...new Set([...result.model.notes, ...result.inventory.warnings, ...result.validation.warnings])];
  if (!result.validation.valid) notes.unshift(`模型验证未通过：${result.validation.errors.join('；')}`);
  if (notes.length) {
    page.y += 15;
    page = flowText(pages, page, '拼搭提示', 24, '拼搭提示', INK);
    for (const note of notes) page = flowText(pages, page, `· ${note}`, 19, '拼搭提示');
  }
  for (const step of result.steps) {
    const label = `步骤 ${step.stepNumber} / ${result.steps.length}`;
    page = addPage(pages, label);
    text(page, `STEP ${String(step.stepNumber).padStart(2, '0')}`, 22, '#da513b');
    page.y += 8;
    page = flowText(pages, page, step.title, 36, label, INK);
    page = flowText(pages, page, step.description, 21, label);
    page.y += 23;
    if (page.y + 615 > CONTENT_END) page = addPage(pages, label);
    modelImage(page, step.totalModelState, page.y, 570, step.addedParts.map(part => part.instanceId), options, step);
    page.y += 15;
    page = flowText(pages, page, options.stepSummary?.(step) ?? `绿色描边：本步新增 ${step.addedParts.length} 块  ·  完成后共 ${step.totalModelState.length} 块`, 19, label, '#2d704c');
    page.y += 20;
    const emptyText = !step.addedParts.length && options.emptyPartsText?.(step);
    if (emptyText) flowText(pages, page, emptyText, 20, label);
    else partTable(pages, page, step.addedParts, `${label} · 零件清单续页`, options.stepPartsHeading?.(step));
  }
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  pdf.setProperties({ title: `${result.model.name} · BRICKLAB 拼搭说明书`, subject: '逐步拼搭图与零件清单', author: 'BRICKLAB', creator: options.creator ?? 'BRICKLAB V0.1' });
  pages.forEach((item, index) => {
    const { ctx } = item;
    ctx.strokeStyle = '#e5e9e2'; ctx.beginPath(); ctx.moveTo(MARGIN, FOOTER_Y - 20); ctx.lineTo(PAGE_WIDTH - MARGIN, FOOTER_Y - 20); ctx.stroke();
    font(ctx, 17); ctx.fillStyle = MUTED;
    ctx.fillText(options.footerLabel ?? 'BRICKLAB  /  创意拼搭说明书', MARGIN, FOOTER_Y);
    ctx.textAlign = 'right'; ctx.fillText(`${index + 1} / ${pages.length}`, PAGE_WIDTH - MARGIN, FOOTER_Y); ctx.textAlign = 'left';
    if (index) pdf.addPage();
    pdf.addImage(item.canvas, 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
  });
  return pdf;
}

export async function downloadInstructionsPdf(result: GenerationResult): Promise<void> {
  const pdf = await buildInstructionsPdf(result);
  pdf.save(`bricklab-${result.model.template}.pdf`);
}
