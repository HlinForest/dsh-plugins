import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {zstdDecompressSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import yaml from '../../node_modules/js-yaml/index.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const rel=process.argv[2]??JSON.parse(await fs.readFile(path.join(root,'records/latest.json'),'utf8')).directory;
const dir=path.resolve(root,rel),experiment=JSON.parse(await fs.readFile(path.join(dir,'experiment.json'),'utf8'));
const jsType=new yaml.Type('tag:yaml.org,2002:js',{kind:'scalar',construct:value=>({expression:value})}),schema=yaml.DEFAULT_SCHEMA.extend([jsType]);
const configs={};for(const arm of ['a','b','c','d'])configs[arm]=yaml.load(await fs.readFile(path.join(dir,`${arm}.config.yml`),'utf8'),{schema});
const differences=[];
for(const arm of ['b','c','d']){const ids=new Set([...configs.a,...configs[arm]].map(r=>r.id));for(const id of ids){const before=configs.a.find(r=>r.id===id),after=configs[arm].find(r=>r.id===id);if(JSON.stringify(before)!==JSON.stringify(after))differences.push({arm,id,before:before??null,after:after??null});}}
const allowed=new Set(['skill-filesystem','tool-skill','megmeet-product-assistant']);if(differences.some(d=>!allowed.has(d.id)))throw Error('Unexpected configuration difference');
await fs.writeFile(path.join(dir,'config-difference.json'),JSON.stringify(differences,null,2)+'\n');
const home=process.env.DSH_HOME??path.join(process.env.USERPROFILE,'.dsh'),sessionRoot=path.join(home,'sessions'),projects=await fs.readdir(sessionRoot);
const hash=value=>createHash('sha256').update(value).digest('hex');
for(const w of experiment.workflows){
 let folder;for(const p of projects){const f=path.join(sessionRoot,p,w.sessionId);if(await fs.stat(f).then(s=>s.isDirectory(),()=>false)){folder=f;break;}}
 if(!folder){w.evidenceError='Persisted session missing';continue;}
 const records=[];for(const file of (await fs.readdir(folder)).filter(f=>/\.jsonl(?:\.zstd)?$/.test(f))){let bytes=await fs.readFile(path.join(folder,file));if(file.endsWith('.zstd')){let offset=0,chunks=[];while(offset<bytes.length){const d=zstdDecompressSync(bytes.subarray(offset),{info:true});if(d.engine.bytesWritten<=0)throw Error('Zstd frame stalled');offset+=d.engine.bytesWritten;chunks.push(d.buffer);}bytes=Buffer.concat(chunks);}for(const line of bytes.toString('utf8').split('\n').filter(Boolean))records.push(JSON.parse(line));}
 // Explicit allowlist excludes credentials, provider request headers, and arbitrary settings.
 const events=records.map(r=>r.event??r).filter(r=>['tool/call','tool/result'].includes(r.type));
 await fs.writeFile(path.join(dir,w.id,'session-evidence.json'),JSON.stringify(events,null,2)+'\n');
 let stageIndex=-1;const chats=w.stages.map(()=>[]);
 for(const r of records){const event=r.event??r;if(event.type==='turn/start')stageIndex++;if(event.type==='assistant/message'&&stageIndex>=0&&stageIndex<chats.length){const content=(event.data.message??event.data).content;const text=Array.isArray(content)?content.filter(b=>b.type==='text').map(b=>b.text).join(''):'';if(text.trim())chats[stageIndex].push(text);}}
 for(let i=0;i<w.stages.length;i++){await fs.writeFile(path.join(dir,w.id,`${w.stages[i].id}.chat.md`),chats[i].join('\n\n---\n\n')+'\n');await fs.writeFile(path.join(dir,w.id,`${w.stages[i].id}.assistant-messages.json`),JSON.stringify(chats[i],null,2)+'\n');}
 const models=records.filter(r=>r.type==='request/context').map(r=>({provider:r.data.provider,model:r.data.model,contextWindow:r.data.contextWindow}));
 const prompts=records.filter(r=>r.type==='user/message').map(r=>{const content=(r.data.message??r.data).content;if(!Array.isArray(content))return null;const text=content.filter(b=>b.type==='text').map(b=>b.text).join('');return {sha256:hash(text),matchesSavedPrompt:w.stages.some(s=>s.promptSHA256===hash(text))};});
 const evidence={runtime:'DSH v0.2.0-rc.2',models:[...new Map(models.map(m=>[JSON.stringify(m),m])).values()],persistedUserMessages:prompts,toolCalls:events.filter(r=>r.type==='tool/call').length,toolResults:events.filter(r=>r.type==='tool/result').length,originalEventFilesRetained:true};
 if(models.some(m=>m.provider!=='deepseek-account'||m.model!=='deepseek-flash'))throw Error('Actual model mismatch');
 if(w.stages.some(s=>!prompts.some(p=>p?.sha256===s.promptSHA256)))throw Error('Persisted user prompt mismatch: '+w.id);
 await fs.writeFile(path.join(dir,w.id,'runtime-evidence.json'),JSON.stringify(evidence,null,2)+'\n');
}
const sources=JSON.parse(await fs.readFile(path.join(root,'materials/download-manifest.json'),'utf8')).sources;
for(const s of sources)if(hash(await fs.readFile(path.join(root,s.pdfPath)))!==s.sha256)throw Error('Source hash changed');
const engine=[];for(const f of await fs.readdir(path.join(root,'../lib'))){if(!f.endsWith('.js'))continue;engine.push({file:`lib/${f}`,sha256:hash(await fs.readFile(path.join(root,'../lib',f)))});}
const controls={samePromptsPerStage:true,sameSnapshotsPerStage:true,modelVerified:true,sourcesVerified:true,allowedConfigDifferences:allowed.size,engineFiles:engine,engineHashTiming:'Captured during evidence collection, not pinned per turn. Historical shared business-engine code is unchanged; the CLI candidate-limit option was added before the aligned D rerun.'};
for(const stage of ['initial','changed','expanded']){const steps=experiment.workflows.flatMap(w=>w.stages.filter(s=>s.id===stage));if(new Set(steps.map(s=>s.promptSHA256)).size!==1||new Set(steps.map(s=>s.catalogSHA256)).size!==1)throw Error('Unequal inputs');}
await fs.writeFile(path.join(dir,'controls-verification.json'),JSON.stringify(controls,null,2)+'\n');
// Preserve interrupted setup attempts as failures. Never count them as formal benchmark repeats.
const pilots=[];for(const name of (await fs.readdir(path.join(root,'records'))).filter(n=>n.startsWith('experiment-')&&path.join(root,'records',n)!==dir)){const p=path.join(root,'records',name);if(await fs.stat(path.join(p,'experiment.json')).then(()=>true,()=>false))continue;let eventFiles=[];for(const w of await fs.readdir(p,{withFileTypes:true})){if(!w.isDirectory())continue;for(const f of await fs.readdir(path.join(p,w.name)))if(f.endsWith('.events.jsonl'))eventFiles.push(`${w.name}/${f}`);}pilots.push({directory:`records/${name}`,status:'interrupted_setup_attempt',reason:'DSH Windows workspace/temp permissions or incomplete plugin overlay configuration. Preserved before formal runs.',eventFiles});}
await fs.writeFile(path.join(root,'records/setup-failures.json'),JSON.stringify(pilots,null,2)+'\n');
await fs.writeFile(path.join(root,'materials/procurement-meta.json'),JSON.stringify({url:'https://cg.ccteg.cn/cms/channel/ywgg2hw/50378.htm',file:'materials/procurement-50378.html',downloadDate:'2026-10-09',sha256:hash(await fs.readFile(path.join(root,'materials/procurement-50378.html'))),backgroundOnly:true,engineeringConditions:'Demonstration requirements, not terms of the procurement notice.'},null,2)+'\n');
console.log(JSON.stringify({directory:rel,workflows:experiment.workflows.length,sources:sources.length,configDifferences:differences.map(d=>`${d.arm}:${d.id}`),preservedSetupAttempts:pilots.length}));
