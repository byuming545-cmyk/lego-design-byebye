import {build} from 'esbuild';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createSequenceDocument,SEQUENCE_SCHEMA,SEQUENCE_VERSION} from '../src/vehicles/appearance-sequence.ts';
import {DESIGN_SCHEMA,PAINT_VERSION,parsePaintOptions} from '../src/vehicles/appearance-design.ts';
const output=process.argv[2];if(!output)throw Error('Usage: npm run export:vehicle-review -- NEW-output-directory');
await mkdir(output,{recursive:false});
const root=process.cwd(),payloads={},covers={},sequences={};
for(const id of ['charger','golf']){
 const p=JSON.parse(await readFile(`public/vehicle-demos/${id}.json`,'utf8'));
 const saved=JSON.parse(await readFile(`artifacts/vehicle-presentation-2026-11-07/round-2/${id}/model.json`,'utf8'));
 if(p.preview.model.contentSha256!==saved.contentSha256)throw Error('OFFLINE_SAVED_MODEL_BINDING');payloads[id]=p;
 covers[id]='data:image/png;base64,'+(await readFile(`public/vehicle-demos/${id}.png`)).toString('base64');
 sequences[id]=await createSequenceDocument(p.preview.model,p.preview.assets,parsePaintOptions());
 await writeFile(path.join(output,id+'-sequence.json'),JSON.stringify(sequences[id],null,2));
}
const contents=`import{createRoot}from'react-dom/client';import Review from './src/pages/VehicleOfflineReview.tsx';const examples=JSON.parse(document.getElementById('models').textContent),covers=JSON.parse(document.getElementById('covers').textContent);createRoot(document.getElementById('root')).render(<Review examples={examples} covers={covers}/>);`;
const result=await build({stdin:{contents,resolveDir:root,loader:'tsx'},outfile:path.resolve(output,'review.js'),bundle:true,write:false,format:'iife',platform:'browser',minify:true,jsx:'automatic',target:'es2022',define:{'process.env.NODE_ENV':'"production"'},legalComments:'inline'});
const js=result.outputFiles.find(f=>f.path.endsWith('.js')).text.replace(/<\/script/gi,'<\\/script'),css=result.outputFiles.filter(f=>f.path.endsWith('.css')).map(f=>f.text).join('\n');
const json=v=>JSON.stringify(v).replace(/</g,'\\u003c');
await writeFile(path.join(output,'bricklab-sequence-demo.html'),`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bricklab · 拼搭顺序演示（草稿）</title><style>${css}</style></head><body><noscript>请用电脑Chrome或Edge打开，并允许JavaScript。</noscript><div id="root"></div><script type="application/json" id="models">${json(payloads)}</script><script type="application/json" id="covers">${json(covers)}</script><script>${js}</script></body></html>`);
const hashes={};for(const file of ['src/vehicles/appearance-design.ts','src/vehicles/appearance-groups.ts','src/vehicles/appearance-sequence.ts','src/components/VehicleSequencePanel.tsx','src/components/VehicleDesignStudio.tsx','src/components/NativeAssemblyViewer.tsx'])hashes[file]=createHash('sha256').update(await readFile(file)).digest('hex');
const manifest={scope:'SELF_CONTAINED_SAVED_EXAMPLES_NOT_NEW_GENERATION',designSchema:DESIGN_SCHEMA,paintVersion:PAINT_VERSION,groupVersion:'functional-appearance-groups-1',sequenceSchema:SEQUENCE_SCHEMA,sequenceVersion:SEQUENCE_VERSION,models:Object.fromEntries(Object.entries(payloads).map(([k,v])=>[k,{baseSha256:v.preview.model.contentSha256,parts:v.preview.model.placements.length,kinds:v.preview.model.sources.length,steps:sequences[k].sequence.steps.length,sequenceDocumentSha256:sequences[k].contentSha256}])),logicHashes:hashes,htmlSha256:createHash('sha256').update(await readFile(path.join(output,'bricklab-sequence-demo.html'))).digest('hex'),externalRuntimeDependencies:0,assemblyQualification:'UNCHANGED_NOT_VERIFIED',steps:'DRAFT_NOT_BUILD_INSTRUCTIONS'};
await writeFile(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2));
await writeFile(path.join(output,'使用说明.txt'),`Bricklab 拼搭顺序演示（草稿）· 离线查看版\n\n1. 解压后用电脑 Chrome 或 Edge 打开 bricklab-sequence-demo.html，无需后端、密钥、CDN或网络。\n2. 选择已保存的 Charger 或 Golf。离线版不执行新车型生成。\n3. 保留八色、四预设及车身/车顶/饰件/轮拱独立配色。\n4. 模型下方切换“拼搭顺序演示（草稿）”，点击开始演示或播放。支持上/下一步、进度、0.5–4倍速、阶段跳转及退出。\n5. 每步新增1–2件。当前零件发光，之前零件正常显示，后续隐藏；相机始终按完整模型取景。没有插入轨迹动画。\n6. “导出演示顺序 JSON”保存完整模型、当前配色、全部顺序、来源及未知状态。先选择相同车型，再导入重开。包内两份 sequence.json 为完整默认配色演示草稿，可导入。原配色草稿和BOM导出仍保留全部零件。\n7. 浏览器保存仅保存配色，建议导出 JSON 备份。重开顺序草稿后停止播放并显示完整模型。\n\n建议顺序演示，连接、安装路径与实物拼搭尚未完整验证。排序依据功能用途和原生几何位置，属于启发式，不是原说明书步骤。轮胎与轮毂最后逐件展示，不代表配合、底盘安装或安装时机已通过。\n\nAPPEARANCE_DRAFT；整车连接 NOT_VERIFIED；DRAFT_NOT_BUILD_INSTRUCTIONS。原始轮组、稳定性、实物及颜色供应结论均保持。原模型、零件和姿态未修改。\n\n云端浏览器可能按管理员策略阻止 file://，请勿修改组织策略。允许的个人电脑浏览器可尝试直接打开；交付报告会分别记录文件直开限制与同一HTML的自包含检查。\n\n开发者复现：Node24.5+，已有依赖与Python3；npm run build；npm run preview。离线重新导出：npm run export:vehicle-review -- 新目录。云端 localhost 不是用户电脑的公网地址。\n`);
execFileSync('python3',['-c',`import sys,zipfile,pathlib\np=pathlib.Path(sys.argv[1])\nwith zipfile.ZipFile(p/'bricklab-sequence-demo.zip','w',zipfile.ZIP_DEFLATED) as z:\n for n in ['bricklab-sequence-demo.html','使用说明.txt','manifest.json','charger-sequence.json','golf-sequence.json']:z.write(p/n,n)`,output]);
console.log('saved single HTML + ZIP',output);
