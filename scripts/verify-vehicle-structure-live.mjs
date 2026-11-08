import {chromium} from 'playwright';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const out=process.argv[2],data=process.argv[3],origin=process.env.STRUCTURE_BROWSER_ORIGIN??'http://127.0.0.1:3130';
if(!out||!data)throw Error('Usage: node scripts/verify-vehicle-structure-live.mjs NEW-output-dir isolated-data-directory');
await mkdir(out,{recursive:false});const b=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--enable-unsafe-swiftshader']}),context=await b.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
const errors=[],calls=[];page.on('pageerror',e=>errors.push(String(e)));page.on('request',r=>{if(r.url().includes('/api/vehicles'))calls.push({method:r.method(),url:r.url()});});
try{
 await page.goto(`${origin}/vehicle-generator?example=charger`);await page.getByTestId('vehicle-preview-stage').locator('canvas').waitFor({timeout:180000});
 const created=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/vehicles/jobs');await page.getByRole('article').filter({hasText:'Dodge Charger R/T'}).getByRole('button',{name:'生成这款车'}).click();const job=await(await created).json();
 await page.getByText('当前引擎实际生成',{exact:true}).waitFor({timeout:300000});const base=(await(await context.request.get(`${origin}/api/vehicles/jobs/${job.id}`)).json()).preview;
 const originalJob=await readFile(`${data}/vehicle-platform/${job.id}/job.json`,'utf8');
 const wrong=await context.request.post(`${origin}/api/vehicles/jobs/${job.id}/structure-revisions`,{data:{parentContentSha256:'0'.repeat(64)},timeout:300000});assert.equal(wrong.status(),409);
 const revised=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/structure-revisions'),{timeout:900000});await page.getByRole('button',{name:'重建底盘与内部支承',exact:true}).click();
 const blank=await context.newPage();await blank.goto('about:blank');await blank.bringToFront();
 const response=await revised;assert.equal(response.status(),201);const payload=await response.json(),m=payload.model;await blank.close();await page.bringToFront();
 await page.waitForFunction(hash=>document.querySelector('[data-testid="vehicle-preview-stage"]')?.getAttribute('data-model-hash')===hash,m.contentSha256,{timeout:180000});
 await page.getByTestId('vehicle-preview-stage').locator('canvas').waitFor({timeout:180000});assert.equal(await page.getByTestId('vehicle-preview-stage').getAttribute('data-model-hash'),m.contentSha256);
 assert.equal(m.structure.parentContentSha256,base.contentSha256);assert.equal(m.structure.floorValidation.valid,true);assert.deepEqual(m.structure.audit.blockers.filter(p=>p.status!=='UNKNOWN'),[]);assert.deepEqual(m.layout.wheelEnvelope.conflicts,[]);
 assert.equal(await readFile(`${data}/vehicle-platform/${job.id}/job.json`,'utf8'),originalJob);
 await page.getByRole('button',{name:'橙身黑顶',exact:true}).click();await page.getByRole('button',{name:'保存配色草稿',exact:true}).click();await page.getByRole('button',{name:'查看内部结构',exact:true}).click();await page.screenshot({path:`${out}/live-structure.png`,fullPage:true});
 const reopened=page.waitForResponse(r=>r.request().method()==='GET'&&r.url().includes(`/structure-revisions/${m.contentSha256}`),{timeout:900000});await page.reload();const background=await context.newPage();await background.goto('about:blank');await background.bringToFront();assert.equal((await reopened).status(),200);await background.close();await page.bringToFront();await page.getByTestId('vehicle-preview-stage').locator('canvas').waitFor({timeout:180000});
 assert.equal(await page.getByTestId('vehicle-preview-stage').getAttribute('data-model-hash'),m.contentSha256);await page.getByText('已保存结构修订 · 当前来源复核',{exact:true}).waitFor();
 assert.deepEqual(errors,[]);await writeFile(`${out}/checks.json`,JSON.stringify({job:job.id,base:base.contentSha256,revision:m.contentSha256,parts:m.placements.length,floorPassed:true,wholeCar:'NOT_VERIFIED',parentJobUnchanged:true,sourceObservation:'cached-provider',paidCalls:0,routeMocks:0,negativeParent:wrong.status(),post:response.status(),reopen:200,errors,calls},null,2));await writeFile(`${out}/model.json`,JSON.stringify(m,null,2));
}finally{await b.close();}
