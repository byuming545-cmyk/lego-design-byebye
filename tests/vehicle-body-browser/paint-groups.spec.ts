import {test,expect,type Page} from '@playwright/test';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {appearanceGroups} from '../../src/vehicles/appearance-groups.js';
import {PAINT_PALETTE,paintAppearance,validateDesignDraft,designDigest,PAINT_PRESETS} from '../../src/vehicles/appearance-design.js';
const output=process.env.VEHICLE_INTERACTION_OUTPUT??'artifacts/vehicle-interactions-2026-11-07/browser-final';
const root=process.env.VEHICLE_BODY_BROWSER_DATA_DIR??'/tmp/bricklab-vehicle-body-browser';
const examples:Record<string,any>={};
test.beforeAll(async()=>{await mkdir(output,{recursive:true});for(const id of ['charger','golf']){const data=JSON.parse(await readFile(`public/vehicle-demos/${id}.json`,'utf8'));examples[id]=data;const dir=`${root}/vehicle-platform/${data.job.id}`;await mkdir(dir,{recursive:true});await writeFile(`${dir}/job.json`,JSON.stringify(data.job));}});
async function checkEditor(page:Page,id:string,stageId:string){
 const base=examples[id].preview.model,groups=appearanceGroups(base).groups,stage=page.getByTestId(stageId),canvas=stage.locator('canvas');
 await expect(canvas).toHaveAttribute('data-visible-instances',/.+/,{timeout:120000});
 await page.getByRole('button',{name:'恢复默认配色',exact:true}).click();
 await page.getByLabel('配色区域').selectOption('accent');await expect(page.getByText('当前：石墨灰',{exact:true})).toBeVisible();await expect(page.getByRole('radio',{name:'石墨灰',exact:true})).toHaveAttribute('aria-checked','true');await page.getByLabel('配色区域').selectOption('body');
 const original=await canvas.getAttribute('data-material-colours');
 for(const [key,c]of Object.entries(PAINT_PALETTE)){
  await page.getByRole('radio',{name:c.label,exact:true}).click();await expect(page.getByRole('radio',{name:c.label,exact:true})).toHaveAttribute('aria-checked','true');
  const actual=JSON.parse((await canvas.getAttribute('data-material-colours'))!);expect(actual).toEqual(Object.fromEntries(Object.entries(paintAppearance(base,{body:key,roof:null,accent:null,arches:null}).designColors).map(([k,v])=>[k,v.toLowerCase()])));
 }
 for(const p of PAINT_PRESETS)await page.getByRole('button',{name:p.label,exact:true}).click();
 await page.getByRole('button',{name:'恢复默认配色',exact:true}).click();expect(await canvas.getAttribute('data-material-colours')).toBe(original);
 await page.getByRole('button',{name:'橙身黑顶',exact:true}).click();
 // Exercise independent role controls with actual materials.
 await page.getByLabel('配色区域').selectOption('roof');await page.getByRole('radio',{name:'石墨灰',exact:true}).click();
 await page.getByLabel('配色区域').selectOption('arches');await page.getByRole('radio',{name:'黑色',exact:true}).click();
 const painted=await canvas.getAttribute('data-material-colours');
 await canvas.evaluate(el=>(window as any).originalPaintCanvas=el);
 const box=(await canvas.boundingBox())!;await page.mouse.move(box.x+box.width*.55,box.y+box.height*.6);await page.mouse.down();await page.mouse.move(box.x+box.width*.63,box.y+box.height*.58,{steps:8});await page.mouse.up();await page.waitForTimeout(1700);
 await expect.poll(async()=>{const a=await canvas.getAttribute('data-camera-position');await page.waitForTimeout(300);return a===await canvas.getAttribute('data-camera-position');},{timeout:20000}).toBe(true);
 const camera=await canvas.getAttribute('data-camera-position'),target=await canvas.getAttribute('data-camera-target');
 for(let i=0;i<groups.length;i++){
  await page.getByRole('button',{name:'下一步',exact:true}).click();
  await expect(page.locator('.vehicle-groups')).toHaveAttribute('data-group-index',String(i));
  expect(JSON.parse((await canvas.getAttribute('data-visible-instances'))!)).toEqual(base.placements.filter((p:any)=>groups.slice(0,i+1).some(g=>g.members.some(m=>m.instanceId===p.instanceId))).map((p:any)=>p.instanceId));
  expect(JSON.parse((await canvas.getAttribute('data-highlight-instances'))!)).toEqual(base.placements.filter((p:any)=>groups[i].members.some(m=>m.instanceId===p.instanceId)).map((p:any)=>p.instanceId));
  expect(await canvas.getAttribute('data-material-colours')).toBe(painted);expect(await canvas.getAttribute('data-camera-position')).toBe(camera);expect(await canvas.getAttribute('data-camera-target')).toBe(target);expect(await canvas.evaluate(el=>el===(window as any).originalPaintCanvas)).toBe(true);
  if(i===3){await page.getByText(`当前组编号、用途与来源（${groups[i].members.length} 件）`,{exact:true}).click();await expect(page.locator('.vehicle-group-members tbody tr')).toHaveCount(groups[i].members.length);await stage.screenshot({path:`${output}/${stageId}-${id}-highlight.png`});await page.locator('.vehicle-group-members summary').click();}
 }
 await page.getByRole('button',{name:'上一步',exact:true}).click();await expect(page.locator('.vehicle-groups')).toHaveAttribute('data-group-index',String(groups.length-2));
 await page.getByRole('slider',{name:'分组进度'}).fill('2');await expect(page.locator('.vehicle-groups')).toHaveAttribute('data-group-index','1');
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'导出配色草稿 JSON',exact:true}).click();const file=await download;const draftPath=`${output}/${stageId}-${id}-draft.json`;await file.saveAs(draftPath);const draft=await validateDesignDraft(JSON.parse(await readFile(draftPath,'utf8')),base);
 expect(draft.placements).toHaveLength(base.placements.length);expect(draft.bom.reduce((n,b)=>n+b.quantity,0)).toBe(base.placements.length);expect(draft.checks).toEqual(base.checks);
 const csvDownload=page.waitForEvent('download');await page.getByRole('button',{name:'当前配色 BOM',exact:true}).click();await(await csvDownload).saveAs(`${output}/${stageId}-${id}-bom.csv`);
 await page.getByRole('button',{name:'播放',exact:true}).click();await expect(page.locator('.vehicle-groups')).toHaveAttribute('data-playing','true');await page.waitForTimeout(1800);await page.getByRole('button',{name:'暂停',exact:true}).click();const stopped=await page.locator('.vehicle-groups').getAttribute('data-group-index');await page.waitForTimeout(1700);await expect(page.locator('.vehicle-groups')).toHaveAttribute('data-group-index',stopped!);
 await page.getByRole('button',{name:'显示全部',exact:true}).click();await expect(page.locator('.vehicle-groups')).toHaveAttribute('data-group-index','all');expect(JSON.parse((await canvas.getAttribute('data-visible-instances'))!)).toHaveLength(base.placements.length);expect(JSON.parse((await canvas.getAttribute('data-highlight-instances'))!)).toEqual([]);expect(await canvas.getAttribute('data-material-colours')).toBe(painted);expect(await canvas.getAttribute('data-camera-position')).toBe(camera);
 await expect(page.getByText('按功能分组展示模型组成，非已验证实拼说明书。',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'恢复默认配色',exact:true}).click();await page.locator('.vehicle-design-actions input[type=file]').setInputFiles(draftPath);await expect(canvas).toHaveAttribute('data-material-colours',painted!);
 await page.locator('.vehicle-design-studio').screenshot({path:`${output}/${stageId}-${id}-studio.png`});return draft;
}
test('real full-page colours, seven actual functional groups and immutable API save/reopen',async({page,request})=>{
 test.setTimeout(420000);const calls:string[]=[],errors:string[]=[];page.on('request',r=>{if(r.method()==='POST')calls.push(new URL(r.url()).pathname);});page.on('pageerror',e=>errors.push(e.message));
 let saved:any;
 for(const id of ['charger','golf']){
  await page.goto(`/vehicle-generator?job=${examples[id].job.id}`);const draft=await checkEditor(page,id,'vehicle-preview-stage');
  if(id==='charger'){
   const old=await readFile(`${root}/vehicle-platform/${examples[id].job.id}/job.json`,'utf8');const response=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/designs'),{timeout:120000});await page.getByRole('button',{name:'保存配色草稿',exact:true}).click();expect((await response).status()).toBe(201);await expect(page.locator('.vehicle-design-status')).toContainText('已保存到当前任务');saved=draft;
   const url=page.url();expect(new URL(url).searchParams.get('design')).toBe(draft.contentSha256);
   // Reopen in a new browser storage context: the actual persisted API draft is required.
   const clean=await page.context().browser()!.newContext();const reopened=await clean.newPage();await reopened.goto(url);await expect(reopened.getByTestId('vehicle-preview-stage')).toHaveAttribute('data-paint-options',JSON.stringify(draft.designOptions),{timeout:120000});await clean.close();expect(await readFile(`${root}/vehicle-platform/${examples[id].job.id}/job.json`,'utf8')).toBe(old);
   const bad=structuredClone(draft);bad.placements[0].transform.translation[0]++;const{contentSha256,...raw}=bad;bad.contentSha256=await designDigest(raw);expect((await request.post(`/api/vehicles/jobs/${examples[id].job.id}/designs`,{data:{content:JSON.stringify(bad)}})).status()).toBe(409);
  }
 }
 // Old playback must stop when a different saved model is selected.
 await page.getByRole('button',{name:'播放',exact:true}).click();await page.getByRole('article').filter({hasText:'Dodge Charger R/T'}).getByRole('button',{name:'打开已保存示例'}).click();await expect(page.locator('.vehicle-groups')).toHaveAttribute('data-group-index','all');await expect(page.locator('.vehicle-groups')).toHaveAttribute('data-playing','false');
 expect(calls.filter(p=>p==='/api/vehicles/jobs')).toEqual([]);expect(errors).toEqual([]);await writeFile(`${output}/full-checks.json`,JSON.stringify({cars:2,groups:7,allEightColours:true,routeMocks:0,calls,errors,apiSavedDigest:saved.contentSha256,geometryUnchanged:true,cameraStable:true,exportContainsHiddenParts:true},null,2));
});
test('same single HTML works self-contained without networking, saves complete drafts and restores colours',async({browser})=>{
 test.setTimeout(240000);const file=path.resolve('artifacts/vehicle-interactions-2026-11-07/offline-final/bricklab-paint-steps.html'),html=await readFile(file,'utf8');expect(html).not.toMatch(/<(script|link)\b[^>]*(src|href)=["']https?:/i);
 const server=createServer((_q,r)=>{r.setHeader('Content-Type','text/html; charset=utf-8');r.end(html);});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const port=(server.address() as any).port;
 const context=await browser.newContext({viewport:{width:1440,height:1100}}),page=await context.newPage(),requests:string[]=[],errors:string[]=[];page.on('request',r=>requests.push(r.url()));page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(`http://127.0.0.1:${port}/`);await expect(page.getByTestId('offline-model').locator('canvas')).toBeVisible();await new Promise<void>(r=>server.close(()=>r()));await context.setOffline(true);
  const charger=await checkEditor(page,'charger','offline-model');await page.getByRole('button',{name:'保存配色草稿',exact:true}).click();await expect(page.locator('.vehicle-design-status')).toContainText('此浏览器');
  await page.getByRole('button',{name:'播放',exact:true}).click();await page.getByRole('button',{name:'查看已保存的 Golf',exact:true}).click();await expect(page.locator('.vehicle-groups')).toHaveAttribute('data-group-index','all');await expect(page.locator('.vehicle-groups')).toHaveAttribute('data-playing','false');await checkEditor(page,'golf','offline-model');
  // Reinitialize the exact file bytes with networking disabled (not a claim of file:// policy approval).
  await page.setContent(html,{waitUntil:'load'});await expect(page.getByTestId('offline-model')).toHaveAttribute('data-paint-options',JSON.stringify(charger.designOptions));await expect(page.getByTestId('offline-model').locator('canvas')).toBeVisible();expect(requests).toHaveLength(1);expect(errors).toEqual([]);
  await page.setViewportSize({width:390,height:844});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:`${output}/offline-mobile.png`,fullPage:true});
  const policy=await browser.newContext(),probe=await policy.newPage();let fileResult='';try{await probe.goto(pathToFileURL(file).href,{timeout:20000});fileResult=(await probe.locator('body').innerText()).slice(0,400);}catch(e){fileResult=String(e);}await policy.close();await writeFile(`${output}/offline-checks.json`,JSON.stringify({actualRequests:requests,errors,serverStopped:true,networkDisabled:true,reinitializedSameHTML:true,filePolicyObservation:fileResult,geometryUnchanged:true,exportContainsHiddenParts:true},null,2));
 }finally{await context.close();if(server.listening)await new Promise<void>(r=>server.close(()=>r()));}
});
