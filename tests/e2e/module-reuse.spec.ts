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
  await mkdir('artifacts/module-reuse/screenshots',{recursive:true});
  await page.locator('.assembly-native-stage').screenshot({path:'artifacts/module-reuse/screenshots/source-hood-reimport.png'});
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
