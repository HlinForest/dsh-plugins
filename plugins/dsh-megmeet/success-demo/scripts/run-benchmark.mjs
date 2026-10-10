import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const project=path.dirname(root), cli=path.join(project,'.verification/dsh-host/node_modules/@deepseek-ai/dsh/lib/bin.js');
const environment={...process.env,DSH_TELEMETRY_DISABLED:'1',TEMP:path.join(process.env.LOCALAPPDATA,'Temp'),TMP:path.join(process.env.LOCALAPPDATA,'Temp')};
const experimentDir=process.argv[2]?path.resolve(process.argv[2]):path.join(root,'records',`experiment-${new Date().toISOString().replace(/[:.]/g,'-')}`);
await fs.mkdir(experimentDir,{recursive:true});
const selectedArms=(process.env.DSH_DEMO_ARMS??'a,b,c,d').split(',');if(selectedArms.some(a=>!['a','b','c','d'].includes(a)))throw Error('Unsupported demo arm');
const workflows=Array.from({length:3},(_,i)=>selectedArms.map(arm=>({arm,repeat:i+1,id:`${arm}-${i+1}`,stages:[]}))).flat();
for(const w of workflows){w.directory=path.join(experimentDir,w.id);w.workspace=path.join(root,'workspaces',path.basename(experimentDir),w.id);await fs.mkdir(w.directory,{recursive:true});await fs.mkdir(w.workspace,{recursive:true});}
if(process.env.DSH_DEMO_REPAIR==='1'){
  // User-approved repair is limited to these freshly created demo directories. Preserve each official backup.
  const repair=path.join(project,'.verification/dsh-host/node_modules/@deepseek-ai/dsh-sandbox-windows-acl/assets/diagnose-windows-sandbox-acl/scripts/diagnose-windows-sandbox-acl.ps1');
  for(const w of workflows){
    const pwsh=process.env.DSH_DEMO_PWSH??path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe');
    const child=spawn(pwsh,['-NoProfile','-File',repair,'-Path',w.workspace,'-AllowRoot',path.join(root,'workspaces'),'-Out',path.join(root,'permission-recovery',path.basename(experimentDir),w.id)],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let out='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>out+=b);
    const code=await new Promise(resolve=>child.once('close',resolve));await fs.writeFile(path.join(w.directory,'permission-verification.txt'),out);
    if(code!==0||!out.includes('verify_original_confined_operation'))throw Error('Official directory repair did not verify; stop: '+w.id);
    console.log('Demo directory permission verified: '+w.id);
  }
}
const command=(args,cwd)=>new Promise(resolve=>{const child=spawn(process.execPath,args,{cwd,windowsHide:true,env:environment,stdio:['pipe','pipe','pipe']});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.stdin.end();child.on('close',code=>resolve({code,out,err}));child.on('error',error=>resolve({code:-1,out,err:String(error)}));});
for(const arm of ['a','b','c','d']){
  const exists=await fs.stat(path.join(process.env.DSH_HOME??path.join(process.env.USERPROFILE,'.dsh'),'profiles',`selection-success-${arm}`,'package.json')).then(()=>true,()=>false);
  const args=[cli,'--profile',`selection-success-${arm}`,...(exists?[]:['--from-default-profile','headless']),'--patch',path.join(root,`configs/${arm}.patch.yml`),'--dump-config'];
  const result=await command(args,path.join(root,'workspace'));
  await fs.writeFile(path.join(experimentDir,`${arm}.config.yml`),result.out);
  if(result.code!==0)throw Error(`Config ${arm} failed: ${result.err}`);
}
async function runStage(w,id){
  const prompt=await fs.readFile(path.join(root,`prompts/${id}.txt`));
  const args=[cli,'--profile',`selection-success-${w.arm}`,'--patch',path.join(root,`configs/${w.arm}.patch.yml`),'--json',...(w.sessionId?['--session-id',w.sessionId]:[]),'-'];
  const startedAt=new Date().toISOString(),started=Date.now();
  const child=spawn(process.execPath,args,{cwd:w.workspace,windowsHide:true,env:environment,stdio:['pipe','pipe','pipe']});
  const out=await fs.open(path.join(w.directory,`${id}.events.jsonl`),'wx'),err=await fs.open(path.join(w.directory,`${id}.stderr.txt`),'wx');
  let pending='',events=[],writeOut=Promise.resolve(),writeErr=Promise.resolve(),timedOut=false;
  child.stdout.on('data',chunk=>{writeOut=writeOut.then(()=>out.write(chunk));pending+=chunk.toString('utf8');let n;while((n=pending.indexOf('\n'))>=0){const line=pending.slice(0,n);pending=pending.slice(n+1);try{const e=JSON.parse(line);events.push(e);if(e.type==='session'){w.sessionId=e.sessionId;console.log(`${w.id} ${id}: session ready`);}if(e.type==='tool_call')console.log(`${w.id} ${id}: ${e.tool}`);if(e.type==='error')console.log(`${w.id} ${id}: ERROR ${e.message}`);}catch{}}});
  child.stderr.on('data',chunk=>{writeErr=writeErr.then(()=>err.write(chunk));});
  child.stdin.end(prompt);
  const timer=setTimeout(()=>{timedOut=true;child.kill();},9*60*1000);
  const exitCode=await new Promise(resolve=>{child.on('close',resolve);child.on('error',()=>resolve(-1));});clearTimeout(timer);
  await Promise.all([writeOut,writeErr]);await out.close();await err.close();
  const final=events.findLast(e=>e.type==='final'),usage=events.filter(e=>e.type==='status'&&e.phase==='step_end'&&e.usage).map(e=>e.usage);
  const stage={id,startedAt,finishedAt:new Date().toISOString(),elapsedMs:Date.now()-started,exitCode,timedOut,success:exitCode===0&&!!final?.text,sessionId:w.sessionId,promptSHA256:createHash('sha256').update(prompt).digest('hex'),catalogSHA256:createHash('sha256').update(await fs.readFile(path.join(root,'snapshots/catalog.active.json'))).digest('hex'),materialsSHA256:JSON.parse(await fs.readFile(path.join(root,'materials/download-manifest.json'),'utf8')).sources.map(s=>({id:s.sourceId,sha256:s.sha256})),usage,toolCalls:events.filter(e=>e.type==='tool_call').map(e=>({name:e.tool,input:e.input,callId:e.callId})),errors:events.filter(e=>e.type==='error')};
  if(final?.text)await fs.writeFile(path.join(w.directory,`${id}.md`),final.text+'\n');
  await fs.writeFile(path.join(w.directory,`${id}.metadata.json`),JSON.stringify(stage,null,2)+'\n');w.stages.push(stage);
  console.log(`${w.id} ${id}: ${stage.success?'complete':'FAILED'} ${Math.round(stage.elapsedMs/1000)}s, ${stage.toolCalls.length} calls`);
  await fs.writeFile(path.join(experimentDir,'progress.json'),JSON.stringify(workflows.map(({directory,workspace,...w})=>w),null,2)+'\n');
}
for(const id of ['initial','changed','expanded']){
  const snapshot=id==='expanded'?'v2':'v1';
  await fs.copyFile(path.join(root,`snapshots/catalog.${snapshot}.json`),path.join(root,'snapshots/catalog.active.json'));
  await fs.copyFile(path.join(root,`snapshots/summary.${snapshot}.json`),path.join(root,'snapshots/summary.active.json'));
  console.log(`Stage ${id}: fixed ${snapshot.toUpperCase()}`);
  for(let repeat=1;repeat<=3;repeat++){
    const group=workflows.filter(w=>w.repeat===repeat);
    const results=await Promise.allSettled(group.map(w=>runStage(w,id)));
    results.forEach((r,i)=>{if(r.status==='rejected')console.log(`${group[i].id}: ${r.reason}`);});
  }
}
const data={schemaVersion:1,runtime:'DSH v0.2.0-rc.2',plugin:'dsh-megmeet@0.2.0',model:'deepseek-flash',reasoningEffort:'high',maxTokens:16000,arms:{a:'直接Prompt与通用文件/PowerShell工具',b:'DSH Skill与同样通用工具',c:'DSH原生插件与同样通用工具',d:'DSH Skill与同一引擎CLI及同样通用工具'},method:'每组3次完整流程。每次初次选型创建新会话，随后两步续接该会话。每个步骤全部完成后才更新共享资料快照。同一重复四组并行，下一重复等待全部完成。',limitations:['每组3次为演示观察，不能推断总体准确率或稳定成本优势。','计时包含进程启动。缓存与账户服务器负载不受控。未设置随机种子。','使用公开资料索引，不代表完整工程批准。','金额未知，展示provider上报的Token用量，不估算费用。'],workflows:workflows.map(({directory,workspace,...w})=>w)};
await fs.writeFile(path.join(experimentDir,'experiment.json'),JSON.stringify(data,null,2)+'\n');
await fs.writeFile(path.join(root,'records/latest.json'),JSON.stringify({directory:path.relative(root,experimentDir).replaceAll('\\','/'),completedAt:new Date().toISOString()},null,2)+'\n');
console.log(`Benchmark saved: ${experimentDir}`);
