import {chromium} from 'playwright';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {appearanceSequence} from '../src/vehicles/appearance-sequence.ts';
const output=process.argv[2],htmlFile=process.argv[3],origin=process.env.STRUCTURE_BROWSER_ORIGIN??'http://127.0.0.1:3100';
if(!output||!htmlFile)throw Error('Usage: node --import tsx scripts/verify-vehicle-structure.mjs NEW-output-dir HTML');
await mkdir(output,{recursive:false});
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--enable-unsafe-swiftshader']});
const examples=Object.fromEntries(await Promise.all(['charger','golf'].map(async id=>[id,JSON.parse(await readFile(`public/vehicle-structures/${id}.json`,'utf8'))])));
const errors=[],network=[],checks=[];
async function exercise(page,id,stageId,prefix){
 const {model,assets}=examples[id].preview,plan=appearanceSequence(model,assets),stage=page.getByTestId(stageId),canvas=stage.locator('canvas');
 await canvas.waitFor({timeout:180000});await page.getByRole('button',{name:'橙身黑顶',exact:true}).click();await page.waitForTimeout(500);
 for(const view of ['斜侧','正面','背面','侧面','俯视','底视']){await page.getByRole('button',{name:view,exact:true}).click();await page.waitForTimeout(350);await stage.screenshot({path:`${output}/${prefix}-${id}-${view}.png`});}
 await page.getByRole('button',{name:'查看内部结构',exact:true}).click();await page.getByRole('button',{name:'斜侧',exact:true}).click();await page.waitForTimeout(300);await stage.screenshot({path:`${output}/${prefix}-${id}-internal.png`});
 for(const [value,name]of [['floor','floor'],['axles','wheel-zone'],['cabin','cabin-support']]){await page.getByLabel('结构查看区域',{exact:true}).selectOption(value);await page.waitForTimeout(200);await stage.screenshot({path:`${output}/${prefix}-${id}-${name}.png`});}
 await page.getByRole('button',{name:'俯视',exact:true}).click();await page.getByLabel('结构查看区域',{exact:true}).selectOption('floor');await page.waitForTimeout(250);await stage.screenshot({path:`${output}/${prefix}-${id}-floor-top.png`});
 await page.getByRole('button',{name:'底视',exact:true}).click();await page.waitForTimeout(250);await stage.screenshot({path:`${output}/${prefix}-${id}-floor-bottom.png`});
 await page.getByRole('button',{name:'拼搭顺序演示（草稿）',exact:true}).click();await page.getByRole('button',{name:'斜侧',exact:true}).click();await page.waitForTimeout(400);
 const camera=await canvas.getAttribute('data-camera-position');
 for(const step of [1,Math.ceil(plan.steps.length*.25),Math.ceil(plan.steps.length*.5),Math.ceil(plan.steps.length*.9),plan.steps.length]){
  await page.getByLabel('拼搭演示进度',{exact:true}).fill(String(step));
  await page.waitForFunction(n=>JSON.parse(document.querySelector('.vehicle-render-stage canvas')?.dataset.visibleInstances??'[]').length===n,step,{timeout:30000});
  const visible=JSON.parse(await canvas.getAttribute('data-visible-instances'));assert.equal(visible.length,step);assert.equal(await canvas.getAttribute('data-camera-position'),camera);
  await stage.screenshot({path:`${output}/${prefix}-${id}-step-${String(step).padStart(3,'0')}.png`});
 }
 await page.getByLabel('拼搭演示进度',{exact:true}).fill('1');await page.getByLabel('顺序播放速度',{exact:true}).selectOption('4');await page.getByRole('button',{name:'播放',exact:true}).click();
 const samples=[];for(let i=0;i<3;i++){await page.waitForTimeout(800);const n=await page.locator('.vehicle-sequence').getAttribute('data-step-index');await stage.screenshot({path:`${output}/${prefix}-${id}-autoplay-${i}.png`});samples.push(n);}
 await page.getByRole('button',{name:'暂停',exact:true}).click();assert.ok(Number(samples[2])>Number(samples[0]));
 const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'导出演示顺序 JSON',exact:true}).click();const download=await downloaded,file=await download.path(),document=JSON.parse(await readFile(file,'utf8'));
 assert.equal(document.designDraft.placements.length,model.placements.length);assert.equal(document.designDraft.bom.reduce((n,b)=>n+b.quantity,0),model.placements.length);
 assert.equal(document.sequence.version,plan.version);
 await download.saveAs(`${output}/${prefix}-${id}-export.json`);
 await page.getByText('导入演示顺序 JSON',{exact:false}).locator('input').setInputFiles(file);
 await page.waitForFunction(()=>{const s=document.querySelector('.vehicle-sequence-status')?.textContent??'';return s.includes('已重开')||s.includes('无法导入');},{},{timeout:120000});
 assert.ok((await page.locator('.vehicle-sequence-status').textContent()).includes('已重开'));
 await page.waitForFunction(n=>JSON.parse(document.querySelector('.vehicle-render-stage canvas').dataset.visibleInstances).length===n,model.placements.length,{timeout:120000});
 assert.equal(JSON.parse(await canvas.getAttribute('data-visible-instances')).length,model.placements.length);
 await page.getByRole('button',{name:'保存配色草稿',exact:true}).click();await page.screenshot({path:`${output}/${prefix}-${id}-page.png`,fullPage:true});
 checks.push({prefix,id,model:model.contentSha256,parts:model.placements.length,steps:plan.steps.length,cameraStable:true,fullExport:true,importReopened:true,playbackSamples:samples});
}
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
 page.on('pageerror',e=>errors.push(String(e)));page.on('request',r=>network.push(r.url()));
 for(const id of ['charger','golf']){
  await page.goto(`${origin}/vehicle-generator?example=${id}`);const stage=page.getByTestId('vehicle-preview-stage');await stage.locator('canvas').waitFor({timeout:180000});await page.getByRole('button',{name:'橙身黑顶',exact:true}).click();
  for(const view of ['斜侧','正面','背面','侧面','俯视']){await page.getByRole('button',{name:view,exact:true}).click();await page.waitForTimeout(250);await stage.screenshot({path:`${output}/before-${id}-${view}.png`});}
  await page.goto(`${origin}/vehicle-generator?example=${id}&structure=1`);await exercise(page,id,'vehicle-preview-stage','full');
 }
 await context.close();
 const offline=await browser.newContext({viewport:{width:1440,height:1000}}),op=await offline.newPage();op.on('pageerror',e=>errors.push(String(e)));
 let fileOpen='';try{await op.goto(pathToFileURL(htmlFile).href,{timeout:10000});await op.getByTestId('offline-model').locator('canvas').waitFor({timeout:10000});fileOpen='DIRECT_FILE_OPEN_PASSED';}catch(e){fileOpen=String(e);}
 const html=await readFile(htmlFile),server=createServer((_req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const offlineRequests=[];op.on('request',r=>offlineRequests.push(r.url()));await op.goto(`http://127.0.0.1:${server.address().port}/`);await op.getByTestId('offline-model').locator('canvas').waitFor({timeout:180000});await new Promise(resolve=>server.close(resolve));await offline.setOffline(true);
 await exercise(op,'charger','offline-model','offline');await op.getByRole('button',{name:'查看已保存的 Golf',exact:true}).click();await exercise(op,'golf','offline-model','offline');
 // Re-initialize the identical HTML bytes with the server stopped and network
 // disabled; this is not misreported as a policy-blocked file:// test.
 await op.setContent(html.toString(),{waitUntil:'load'});await op.getByTestId('offline-model').locator('canvas').waitFor({timeout:180000});await op.setViewportSize({width:390,height:844});assert.equal(await op.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await op.screenshot({path:`${output}/offline-mobile.png`,fullPage:true});
 assert.equal(offlineRequests.filter(u=>/^https?:/.test(u)).length,1);assert.deepEqual(errors,[]);
 await writeFile(`${output}/checks.json`,JSON.stringify({checks,errors,fileOpen,offlineRequests,serverStopped:true,networkDisabled:true,identicalHtmlReinitialized:true,routeMocks:0,network},null,2));await offline.close();
}finally{await browser.close();}
