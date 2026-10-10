import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const original='records/experiment-2026-10-09T06-39-47-881Z';
const aligned=process.argv[2]??JSON.parse(await fs.readFile(path.join(root,'records/latest.json'),'utf8')).directory;
const old=JSON.parse(await fs.readFile(path.join(root,original,'experiment.json'),'utf8'));
const rerun=JSON.parse(await fs.readFile(path.join(root,aligned,'experiment.json'),'utf8'));
if(rerun.workflows.length!==3||rerun.workflows.some(w=>w.arm!=='d'))throw Error('Expected three candidate-aligned D workflows');
const target='records/primary-comparison';await fs.mkdir(path.join(root,target),{recursive:true});
const workflows=[...old.workflows.filter(w=>w.arm!=='d'),...rerun.workflows];
for(const w of workflows){const origin=w.arm==='d'?aligned:original;await fs.cp(path.join(root,origin,w.id),path.join(root,target,w.id),{recursive:true,errorOnExist:true,force:false});w.originDirectory=origin;}
for(const arm of ['a','b','c','d'])await fs.copyFile(path.join(root,arm==='d'?aligned:original,`${arm}.config.yml`),path.join(root,target,`${arm}.config.yml`));
const skills=[];for(const arm of ['b','d']){const file=`skills/${arm}/power-selection/SKILL.md`,bytes=await fs.readFile(path.join(root,file));skills.push({arm,file,sha256:createHash('sha256').update(bytes).digest('hex'),content:bytes.toString('utf8')});}
const result={...old,workflows,provenance:{original,aligned,priorDRecordsRetained:true,candidateReturnLimit:{c:3,d:3},skillDefinitions:skills},method:'四组各3个新会话，每会话三步。A/B/C来自原正式实验。D在CLI候选返回上限对齐插件为3后，使用相同Prompt、快照与业务引擎重新运行。原D上限50记录保留。',limitations:[...old.limitations,'D补跑发生在A/B/C之后。候选数量已对齐，但缓存、账户负载与运行时间不同，成本数据仅为本次观察。']};
await fs.writeFile(path.join(root,target,'experiment.json'),JSON.stringify(result,null,2)+'\n');
await fs.writeFile(path.join(root,'records/latest.json'),JSON.stringify({directory:target,completedAt:new Date().toISOString()},null,2)+'\n');
console.log(JSON.stringify({directory:target,workflows:workflows.length,stages:workflows.reduce((n,w)=>n+w.stages.length,0),priorDRecords:original+'/d-*'}));
