import {build} from 'esbuild';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const output=process.argv[2];if(!output)throw Error('Usage: node scripts/export-vehicle-review.mjs NEW-output-directory');
await mkdir(output,{recursive:false});
const root=process.cwd(),payloads={},covers={};
for(const id of ['charger','golf']){
 const p=JSON.parse(await readFile(`public/vehicle-demos/${id}.json`,'utf8'));
 const saved=JSON.parse(await readFile(`artifacts/vehicle-presentation-2026-11-07/round-2/${id}/model.json`,'utf8'));
 if(p.preview.model.contentSha256!==saved.contentSha256)throw Error('OFFLINE_SAVED_MODEL_BINDING');payloads[id]=p;
 covers[id]='data:image/png;base64,'+(await readFile(`public/vehicle-demos/${id}.png`)).toString('base64');
}
const contents=`import{createRoot}from'react-dom/client';import Review from './src/pages/VehicleOfflineReview.tsx';const examples=JSON.parse(document.getElementById('models').textContent),covers=JSON.parse(document.getElementById('covers').textContent);createRoot(document.getElementById('root')).render(<Review examples={examples} covers={covers}/>);`;
const result=await build({stdin:{contents,resolveDir:root,loader:'tsx'},outfile:path.resolve(output,'review.js'),bundle:true,write:false,format:'iife',platform:'browser',minify:true,jsx:'automatic',target:'es2022',define:{'process.env.NODE_ENV':'"production"'},legalComments:'inline'});
const js=result.outputFiles.find(f=>f.path.endsWith('.js')).text.replace(/<\/script/gi,'<\\/script'),css=result.outputFiles.filter(f=>f.path.endsWith('.css')).map(f=>f.text).join('\n');
const json=v=>JSON.stringify(v).replace(/</g,'\\u003c');
await writeFile(path.join(output,'bricklab-paint-steps.html'),`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bricklab · 配色与步骤分组演示</title><style>${css}</style></head><body><noscript>请用电脑Chrome或Edge打开，并允许JavaScript。</noscript><div id="root"></div><script type="application/json" id="models">${json(payloads)}</script><script type="application/json" id="covers">${json(covers)}</script><script>${js}</script></body></html>`);
const hashes={};for(const file of ['src/vehicles/appearance-design.ts','src/vehicles/appearance-groups.ts','src/components/VehicleDesignStudio.tsx','src/components/NativeAssemblyViewer.tsx'])hashes[file]=createHash('sha256').update(await readFile(file)).digest('hex');
const manifest={scope:'SELF_CONTAINED_SAVED_EXAMPLES_NOT_NEW_GENERATION',designSchema:'bricklab-vehicle-colour-draft-1',paintVersion:'functional-role-paint-1',groupVersion:'functional-appearance-groups-1',models:Object.fromEntries(Object.entries(payloads).map(([k,v])=>[k,{baseSha256:v.preview.model.contentSha256,parts:v.preview.model.placements.length,kinds:v.preview.model.sources.length}])),logicHashes:hashes,htmlSha256:createHash('sha256').update(await readFile(path.join(output,'bricklab-paint-steps.html'))).digest('hex'),externalRuntimeDependencies:0,assemblyQualification:'UNCHANGED_NOT_VERIFIED',steps:'DRAFT_NOT_BUILD_INSTRUCTIONS'};
await writeFile(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2));
await writeFile(path.join(output,'使用说明.txt'),`Bricklab 配色与步骤分组 · 离线查看版\n\n1. 下载并解压 ZIP，使用电脑 Chrome 或 Edge 打开 bricklab-paint-steps.html。\n2. 选择已保存的 Charger 或 Golf。本文件不执行新车型生成，不需要后端、密钥或网络。\n3. 选择配色区域，点击八色色块或快捷预设；恢复默认可还原原始颜色。\n4. 在模型下方使用下一步、上一步、进度条、播放/暂停及显示全部。当前组发光高亮，后续组隐藏。\n5. 点击“导出配色草稿 JSON”保存完整派生模型；先打开同一车型，再用“导入配色草稿 JSON”重开。BOM 始终包含完整模型与当前设计颜色。\n\n“保存配色草稿”在离线版仅保存到当前浏览器，建议同时导出 JSON 备份。浏览器限制本地存储时仍可导出与导入。\n\n按功能分组展示模型组成，非已验证实拼说明书。APPEARANCE_DRAFT；整车连接 NOT_VERIFIED；DRAFT_NOT_BUILD_INSTRUCTIONS。原始轮组、稳定性与实物状态均保留，颜色供应及库存未验证。\n\n云端 Chromium 管理策略可能阻止 file://。遇到管理员阻止页面，请勿更改组织策略；可换用获允许的个人电脑浏览器。验收记录会分别说明直接文件打开及同一 HTML 的自包含检查范围。\n\n完整应用启动：npm ci（已有依赖可跳过）；npm run preview。云端 localhost 仅属于云端机器，不是自己电脑可访问的公网地址。\n`);
execFileSync('python3',['-c',`import sys,zipfile,pathlib\np=pathlib.Path(sys.argv[1])\nwith zipfile.ZipFile(p/'bricklab-paint-steps.zip','w',zipfile.ZIP_DEFLATED) as z:\n for n in ['bricklab-paint-steps.html','使用说明.txt','manifest.json']:z.write(p/n,n)`,output]);
console.log('saved single HTML + ZIP',output);
