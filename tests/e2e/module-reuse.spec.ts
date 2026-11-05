import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';

test('normal assembly UI generates a credited source module and reimports its complete model',async({page})=>{
  await page.goto('/part-lab?mode=assembly');
  await expect(page.getByLabel('生成时包含的零件',{exact:true})).toBeVisible();
  await page.getByLabel('生成时包含的零件',{exact:true}).selectOption('3001');
  const generatedResponse=page.waitForResponse(r=>r.url().endsWith('/api/parts-foundation/assembly/generate')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'复用车头模块',exact:true}).click();
  const response=await generatedResponse;expect(response.ok()).toBe(true);
  const result=await response.json();expect(result.status,result.reasons.join(' ')).toBe('generated');
  expect(result.model.placements).toHaveLength(6);expect(result.model.moduleComposition.instances[0].moduleId).toBe('76897-hood-core');
  const credit=page.getByLabel('复用模块来源',{exact:true});await expect(credit).toContainText('76897');
  await expect(credit).toContainText('Adrien Pennamen');
  await expect(page.locator('.assembly-native-stage canvas')).toBeVisible();
  const exported=await page.request.get(`/api/parts-foundation/assembly/models/${result.model.id}/export?format=json`);expect(exported.ok()).toBe(true);
  const bytes=await exported.body();
  await page.getByLabel('选择真实装配模型 JSON',{exact:true}).setInputFiles({name:'source-module.json',mimeType:'application/json',buffer:bytes});
  const importedResponse=page.waitForResponse(r=>r.url().endsWith('/api/parts-foundation/assembly/models/import')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'验证导入模型',exact:true}).click();
  const imported=await(await importedResponse).json();expect(imported.status).toBe('VALID');expect(imported.model.moduleComposition).toEqual(result.model.moduleComposition);
  await expect(credit).toContainText('76897');
  await mkdir('artifacts/module-composition/screenshots',{recursive:true});
  await page.locator('.assembly-native-stage').screenshot({path:'artifacts/module-composition/screenshots/source-hood-reimport.png'});
});

test('production HTTP preserves explicit adaptations and rejects resigned module provenance',async({request})=>{
  const list=await request.get('/api/parts-foundation/assembly/modules');expect(list.ok()).toBe(true);
  const catalogue=await list.json();expect(catalogue.modules.find((m:{id:string})=>m.id==='76897-spoiler-blade').status).toBe('BLOCKED');
  const generated=await request.post('/api/parts-foundation/assembly/generate',{data:{kind:'module-assembly',requiredPartIds:['3020'],requiredModuleIds:['76897-hood-adapted']}});
  expect(generated.ok()).toBe(true);const result=await generated.json();expect(result.status).toBe('generated');expect(result.model.bom.find((r:{partId:string})=>r.partId==='3069b').quantity).toBe(2);
  result.model.moduleComposition.policy.validationSuite='old-or-forged-suite';
  const {contentSha256:_old,...content}=result.model;result.model.contentSha256=createHash('sha256').update(JSON.stringify(content)).digest('hex');
  const imported=await request.post('/api/parts-foundation/assembly/models/import',{data:{content:JSON.stringify(result.model)}});
  expect(imported.ok()).toBe(true);expect(await imported.json()).toMatchObject({status:'NEEDS_REVALIDATION',model:null});
});

test('normal UI composes two different source functions with multi-point mounts and reimports both credits',async({page})=>{
  await page.goto('/part-lab?mode=assembly');
  const base=page.getByLabel('生成时包含的零件',{exact:true});await expect(base).toBeVisible();await base.selectOption('3035');
  const generated=page.waitForResponse(r=>r.url().endsWith('/api/parts-foundation/assembly/generate')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'组合车头与后部面板',exact:true}).click();
  const result=await(await generated).json();expect(result.status,result.reasons.join(' ')).toBe('generated');
  expect(result.model.placements).toHaveLength(9);
  expect(result.model.moduleComposition.instances.map((instance:{installationSupport:{independentPoints:number}})=>instance.installationSupport.independentPoints)).toEqual([8,6]);
  const credits=page.getByLabel('复用模块来源',{exact:true});await expect(credits).toContainText('76897-hood-core');await expect(credits).toContainText('76897-rear-panel-core');
  await expect(credits).toContainText('对外连接位置 8 处');await expect(credits).toContainText('对外连接位置 6 处');
  await expect(page.locator('.assembly-native-stage canvas')).toBeVisible();
  const exported=await page.request.get(`/api/parts-foundation/assembly/models/${result.model.id}/export?format=json`);expect(exported.ok()).toBe(true);
  await page.getByLabel('选择真实装配模型 JSON',{exact:true}).setInputFiles({name:'two-source-modules.json',mimeType:'application/json',buffer:await exported.body()});
  const reimport=page.waitForResponse(r=>r.url().endsWith('/api/parts-foundation/assembly/models/import')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'验证导入模型',exact:true}).click();
  const checked=await(await reimport).json();expect(checked.status).toBe('VALID');expect(checked.model.moduleComposition).toEqual(result.model.moduleComposition);
  await expect(credits).toContainText('76897-rear-panel-core');
  await mkdir('artifacts/module-composition/screenshots',{recursive:true});
  await page.locator('.assembly-native-stage').screenshot({path:'artifacts/module-composition/screenshots/hood-rear-3035.png'});
});

test('existing surface parts can be selected and generated without granting structural eligibility',async({page})=>{
  await page.goto('/part-lab?mode=assembly');
  await page.getByLabel('生成时包含的零件',{exact:true}).selectOption('3001');
  const surfaces=page.getByLabel('表面覆盖零件',{exact:true});await expect(surfaces).toBeVisible();
  // Fixed two-part goals must not inherit a previous larger target count.
  await page.getByLabel('生成零件数量',{exact:true}).fill('9');
  let lastModel;
  for(const partId of ['11477','18973']){
    await surfaces.selectOption(partId);
    const pending=page.waitForResponse(r=>r.url().endsWith('/api/parts-foundation/assembly/generate')&&r.request().method()==='POST');
    await page.getByRole('button',{name:'表面合同模块',exact:true}).click();
    const response=await pending, result=await response.json();expect(result.status,result.reasons.join(' ')).toBe('generated');
    expect(response.request().postDataJSON()).toMatchObject({partCount:2,requiredPartIds:['3001',partId]});
    expect(result.model.placements).toHaveLength(2);
    expect(result.model.placements.find((p:{partId:string})=>p.partId===partId).collisionClass).toBe('exterior-shell');lastModel=result.model;
    await expect(page.getByLabel('生成零件数量',{exact:true})).toHaveValue('2');
    await expect(page.locator('.assembly-native-stage canvas')).toBeVisible();
  }
  const exported=await page.request.get(`/api/parts-foundation/assembly/models/${lastModel.id}/export?format=json`);expect(exported.ok()).toBe(true);
  const imported=await page.request.post('/api/parts-foundation/assembly/models/import',{data:{content:await exported.text()}});expect((await imported.json()).status).toBe('VALID');
  await mkdir('artifacts/collision-method-review/screenshots',{recursive:true});
  await page.locator('.assembly-native-stage').screenshot({path:'artifacts/collision-method-review/screenshots/windscreen-18973.png'});
});
