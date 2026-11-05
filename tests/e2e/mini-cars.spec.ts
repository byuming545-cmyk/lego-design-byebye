import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const prefix='/api/mini-cars';
test('independent mini car page generates, colours, saves and reopens a complete source-backed car',async({page})=>{
  await page.goto('/mini-cars');
  await expect(page.getByRole('heading',{name:'小比例，也有跑车的轮廓。'})).toBeVisible();
  await expect(page.getByText('历史版本 · 参数化零件尚未验证',{exact:true})).toHaveCount(0);
  const generated=page.waitForResponse(r=>r.url().endsWith(prefix+'/generate')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'生成迷你跑车',exact:true}).click();
  const response=await generated;expect(response.ok()).toBe(true);const result=await response.json();
  expect(result.model.state).toBe('APPEARANCE_DRAFT');expect(result.model.wheels).toHaveLength(4);
  expect(result.model.checks.bodyWidthLdu).toBeCloseTo(120);expect(result.model.placements.length).toBeGreaterThan(32);
  await expect(page.getByRole('img',{name:'迷你跑车三维预览'})).toBeVisible();
  await expect(page.locator('.mini-preview-bar')).toContainText('车身 6 格宽');
  await mkdir('artifacts/mini-cars/screenshots',{recursive:true});
  for(const [label,file]of [['斜侧','sprint-perspective'],['侧面','sprint-side'],['俯视','sprint-top']] as const){
    await page.getByRole('button',{name:label,exact:true}).click();
    await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
    await page.locator('.mini-preview .assembly-native-stage').screenshot({path:`artifacts/mini-cars/screenshots/${file}.png`});
  }
  await page.getByRole('button',{name:'保存方案',exact:true}).click();await expect(page.getByText('已保存，可从本页重新打开。',{exact:true})).toBeVisible();
  const exported=await page.request.get(`${prefix}/models/${result.model.id}/export?format=json`);expect(exported.ok()).toBe(true);
  const bytes=await exported.body();
  const bom=await page.request.get(`${prefix}/models/${result.model.id}/export?format=bom`);expect(await bom.text()).toContain('NOT_VERIFIED');
  await page.getByLabel('迷你跑车模型文件',{exact:true}).setInputFiles({name:'sprint.json',mimeType:'application/json',buffer:bytes});
  const opened=page.waitForResponse(r=>r.url().endsWith(prefix+'/models/import'));
  await page.getByRole('button',{name:'打开模型文件',exact:true}).click();
  expect((await(await opened).json()).model).toEqual(result.model);
  await page.reload();await page.getByRole('button',{name:/打开方案/}).first().click();
  await expect(page.getByRole('img',{name:'迷你跑车三维预览'})).toBeVisible();
  await writeFile('artifacts/mini-cars/screenshots/sprint-http-model.json',bytes);
  const different=page.waitForResponse(r=>r.url().endsWith(prefix+'/generate'));
  await page.getByRole('button',{name:'切换车身方案',exact:true}).click();
  const next=(await(await different).json()).model;expect(next.layout.wheelbaseLdu).not.toBe(result.model.layout.wheelbaseLdu);
  await page.getByRole('button',{name:'Speed Creative',exact:true}).click();
  await expect(page.getByText('历史版本 · 参数化零件尚未验证',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'迷你跑车',exact:true}).click();
  await expect(page.getByRole('heading',{name:'小比例，也有跑车的轮廓。'})).toBeVisible();
  await page.getByRole('button',{name:/打开方案/}).first().click();await expect(page.getByRole('img',{name:'迷你跑车三维预览'})).toBeVisible();
  const old=await page.request.post('/api/speed/generate',{data:{}});expect(old.status()).toBe(409);
});

test('mobile GT variant keeps the full car and controls within its own workspace',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/mini-cars');
  await page.getByLabel('车身造型',{exact:true}).selectOption('gt');await page.getByRole('button',{name:'竞速蓝',exact:true}).click();
  const result=page.waitForResponse(r=>r.url().endsWith(prefix+'/generate'));
  await page.getByRole('button',{name:'生成迷你跑车',exact:true}).click();
  const model=(await(await result).json()).model;expect(model.layout.wheelbaseLdu).toBe(200);expect(model.options.color).toBe('blue');
  await expect(page.getByRole('img',{name:'迷你跑车三维预览'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.locator('.mini-preview').scrollIntoViewIfNeeded();
  await mkdir('artifacts/mini-cars/screenshots',{recursive:true});
  await page.locator('.mini-preview').screenshot({path:'artifacts/mini-cars/screenshots/gt-mobile.png'});
  const old=await page.request.post('/api/automotive/design',{data:{}});expect(old.status()).toBe(409);
});
