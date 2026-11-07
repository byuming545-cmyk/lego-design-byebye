import {chromium,expect} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const output='artifacts/vehicle-interactions-2026-11-07/colour-stage';
const html=await readFile(`${output}/bricklab-paint-steps.html`);
const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);});
await new Promise(r=>server.listen(3026,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--enable-unsafe-swiftshader']});
const results=[];
try{
 for(const [mode,url,stageId] of [['full','http://127.0.0.1:5173/vehicle-generator?job=c32c0b6e-af05-4a6c-affe-051899a1e2ae','vehicle-preview-stage'],['offline','http://127.0.0.1:3026/','offline-model']]){
  const context=await browser.newContext({viewport:{width:1440,height:1100}}),page=await context.newPage();const calls=[],errors=[];
  page.on('request',r=>{if(r.method()==='POST')calls.push(new URL(r.url()).pathname);});page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);const stage=page.getByTestId(stageId),canvas=stage.locator('canvas');await expect(canvas).toBeVisible({timeout:120000});await expect(canvas).toHaveAttribute('data-material-colours',/.+/);
  if(mode==='offline')await context.setOffline(true);
  await canvas.evaluate(el=>window.originalCanvas=el);
  const original=JSON.parse(await canvas.getAttribute('data-material-colours'));
  const camera=await canvas.getAttribute('data-camera-position');const colours={白色:'#e8e9e5',赛车红:'#b52528',橙色:'#d67923',竞速蓝:'#2357a7',深绿:'#00451a',明黄:'#f0c327',黑色:'#171c24',石墨灰:'#626a70'};
  for(const [label,hex]of Object.entries(colours)){
   await page.getByRole('radio',{name:label,exact:true}).click();await expect(page.getByRole('radio',{name:label,exact:true})).toHaveAttribute('aria-checked','true');
   const shown=JSON.parse(await canvas.getAttribute('data-material-colours'));assert(Object.values(shown).includes(hex));assert.equal(await canvas.evaluate(el=>el===window.originalCanvas),true);assert.equal(await canvas.getAttribute('data-camera-position'),camera);
  }
  for(const name of ['橙身黑顶','黑身灰饰','红身黑饰','白身黑轮拱'])await page.getByRole('button',{name,exact:true}).click();
  await page.getByRole('button',{name:'恢复默认配色',exact:true}).click();assert.deepEqual(JSON.parse(await canvas.getAttribute('data-material-colours')),original);
  await page.getByRole('button',{name:'橙身黑顶',exact:true}).click();
  const dl=page.waitForEvent('download');await page.getByRole('button',{name:'导出配色草稿 JSON',exact:true}).click();const file=await dl;await file.saveAs(`${output}/${mode}-draft.json`);const draft=JSON.parse(await readFile(`${output}/${mode}-draft.json`,'utf8'));
  assert.equal(draft.placements.length,draft.base.placements.length);assert.equal(draft.bom.reduce((n,b)=>n+b.quantity,0),draft.base.placements.length);
  for(const p of draft.placements){const source=draft.base.placements.find(x=>x.instanceId===p.instanceId);assert.equal(p.partId,source.partId);assert.deepEqual(p.transform,source.transform);if(['wheel','headlamp','taillamp','side-window','grille'].includes(p.role)||(['windshield','rear-window'].includes(p.role)&&source.color==='black'))assert.equal(p.color,source.color);}
  const before=await canvas.getAttribute('data-material-colours');await page.getByRole('button',{name:'恢复默认配色',exact:true}).click();await page.locator('.vehicle-design-actions input[type=file]').setInputFiles(`${output}/${mode}-draft.json`);await expect(canvas).toHaveAttribute('data-material-colours',before);
  if(mode==='full'){
   const response=page.waitForResponse(r=>r.url().endsWith('/designs')&&r.request().method()==='POST');await page.getByRole('button',{name:'保存配色草稿',exact:true}).click();const saved=await response;assert.equal(saved.status(),201);await expect(page.locator('.vehicle-design-status')).toContainText('已保存到当前任务');await page.reload();await expect(page.getByTestId(stageId).locator('canvas')).toHaveAttribute('data-material-colours',before,{timeout:120000});
   const bad=structuredClone(draft);bad.placements[0].transform.translation[0]++;const {contentSha256,...raw}=bad;const canonical=v=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);bad.contentSha256=createHash('sha256').update(canonical(raw)).digest('hex');const rejected=await page.request.post('http://127.0.0.1:5173/api/vehicles/jobs/c32c0b6e-af05-4a6c-affe-051899a1e2ae/designs',{data:{content:JSON.stringify(bad)}});assert.equal(rejected.status(),409);
  }else{
   await page.getByRole('button',{name:'查看已保存的 Golf',exact:true}).click();await expect(page.getByTestId(stageId)).toHaveAttribute('data-model-hash',/035cad/);await expect(page.getByTestId(stageId).locator('canvas')).toBeVisible();await page.getByRole('radio',{name:'深绿',exact:true}).click();
  }
  await page.screenshot({path:`${output}/${mode}-paint.png`,fullPage:true});assert.equal(calls.filter(x=>x==='/api/vehicles/jobs').length,0);assert.deepEqual(errors,[]);results.push({mode,calls,errors,allEightColours:true,presets:4,canvasReused:true,cameraStable:true,fullBOM:true,reopen:true});await context.close();
 }
 await writeFile(`${output}/checks.json`,JSON.stringify(results,null,2));
}finally{await browser.close();await new Promise(r=>server.close(r));}
