import {reviewSelection} from './schematic-targets.js';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import {hash,within,tree,readJSON} from './io.js';

export const reviewStages={3:'器件、参数与接法',4:'原理图排版',6:'PCB布局布线'};
export async function pcbReviewBaseline(flow,p){
 const active=[...(p.engineeringReviews||[])].reverse().find(r=>r.stage===6&&['applied','running','failed','interrupted','cancelled','waiting-input'].includes(r.status));
 if(!active)return null;
 let origin=active;const seen=new Set();
 while(origin.parentId){
  if(seen.has(origin.id))throw Error('评审版本关联存在循环');seen.add(origin.id);
  const parent=p.engineeringReviews.find(r=>r.id===origin.parentId);
  if(!parent||parent.stage!==6)throw Error('评审原始版本关联不存在');origin=parent;
 }
 const snapshot=origin.before;if(!snapshot?.output||!snapshot.outputHash)return null;
 const base=await within(path.join(flow.dir(p.id),'steps','6'),snapshot.output);
 if(hash(await tree(base))!==snapshot.outputHash)throw Error('评审原始版本文件已变化，不能据此沿用排布意图');
 const request=await readJSON(await within(base,'pcb-request.json'));
 const plan=request.plan||{},keys=['widthMm','heightMm','clearanceMm','trackWidthMm','componentGapMm','cornerRadiusMm','thicknessMm','activeLayers','allowVias','order','assemblySides'];
 return {reviewId:origin.id,outputHash:snapshot.outputHash,pcbPlan:Object.fromEntries(keys.filter(k=>Object.hasOwn(plan,k)).map(k=>[k,structuredClone(plan[k])])),
  summary:snapshot.summary,tracks:snapshot.tracks,powerPlacement:snapshot.powerPlacement,scope:'Prior generated plan intent only; no generated coordinates, copper shapes or routed traces'};
}
const now=()=>new Date().toISOString();
export function reviewSnapshot(p,stage){
 const s=p.stages.find(s=>s.id===stage),r=s?.result||{};
 return {stage,status:s?.status,output:s?.output||null,outputHash:s?.outputHash||null,
  electricalHash:p.electricalFreeze?.sha256||p.electricalFreeze?.hash||r.electricalHash||null,
  partParameters:Array.isArray(r.design?.components)?r.design.components.map(c=>({ref:c.ref,value:c.value||'',mpn:c.mpn||'',footprint:c.footprint||'',dnp:Boolean(c.dnp)})):null,
  summary:r.summary||'',checks:structuredClone(r.checks||[]),drc:r.drc||null,erc:r.erc||null,
  powerPlacement:r.process?.powerPlacement||null,tracks:r.tracks??null,routingQuality:stage===6?r.routingQuality||null:null,copperRouteCleanup:stage===6?r.copperRouteCleanup||null:null,
  components:Array.isArray(r.components)?r.components.length:r.components??null,
  files:(s?.files||[]).filter(f=>/^project\//.test(f.path)&&/\.(pdf|svg|kicad_sch|kicad_pcb)$/.test(f.path)).map(f=>({...f}))};
}
function checkRevision(p,a){if(a.expectedRevision!==p.revision)throw Error('工程已更新，请刷新后再提交评审操作。');}
export async function changeReview(flow,a){
 flow.guard(a.projectId);const p=await flow.open(a.projectId);checkRevision(p,a);
 p.engineeringReviews||=[];
 if(a.action==='review-add'){
  const stage=Number(a.stage),text=String(a.text||'').trim(),reviewer=String(a.reviewer||'').trim();
  if(!reviewStages[stage]||!text||text.length>12000||reviewer.length>120)throw Error('请选择修改步骤，评审意见需为1–12000字，署名不超过120字。');
  const s=flow.stage(p,stage);if(!s.output||s.status!=='done')throw Error('请先生成本步有效结果，再对这版结果填写评审。');
  if(stage===6&&!p.pcbEnabled)throw Error('本项目尚未启用PCB。');
  const selection=await reviewSelection(flow,p,a.selection);
  const selectedText=selection?'【图纸所选器件】'+selection.components.map(c=>c.ref+'（当前 '+c.value+'）').join('、')+'\n'+text:text;
  if(selectedText.length>16000)throw Error('所选器件信息与评审过长，请减少本次选择的器件。');
  p.engineeringReviews.push({id:randomUUID(),stage,text:selectedText,selection,reviewer:reviewer||'工程师（未署名）',createdAt:now(),
   inputHash:hash(p.inputs),before:reviewSnapshot(p,stage),status:'recorded',attempts:[],decisions:[]});
  flow.recordEvent(p,stage,'工程师评审','保存评审意见；尚未修改工程',{reviewId:p.engineeringReviews.at(-1).id,text,reviewer});
 }else{
  const r=p.engineeringReviews.find(r=>r.id===a.reviewId);if(!r)throw Error('评审记录不存在。');
  const s=flow.stage(p,r.stage);
  if(a.action==='review-apply'){
   if(r.status!=='recorded')throw Error('该意见已采用，原记录保留；请追加新的评审意见。');
   if(s.status!=='done'||s.outputHash!==r.before.outputHash||hash(p.inputs)!==r.inputHash)throw Error('评审所针对的工程或输入已变化，请针对当前版本重新评审。');
   if(r.selection){const viewed=flow.stage(p,r.selection.sourceStage);if(viewed.status!=='done'||viewed.outputHash!==r.selection.sourceOutputHash||hash(await tree(viewed.output))!==r.selection.sourceOutputHash)throw Error('所选器件对应的图纸已变化，请重新选择并评审。');}
   const prefix=`【工程师评审 ${r.id}】\n`;
   p.inputs.stageNotes||={};p.inputs.stageNotes[r.stage]=[p.inputs.stageNotes[r.stage],prefix+r.text+'\n【评审结束】'].filter(Boolean).join('\n\n');
   r.status='applied';r.appliedAt=now();
   p.clarificationRevision=(p.clarificationRevision||0)+1;
   flow.invalidate(p,r.stage,{kind:'engineering-review',from:r.stage,reviewId:r.id,message:'已采用工程师评审意见，请执行本步并复核修改结果。'});
   flow.recordEvent(p,r.stage,'采用评审','意见已写入本步输入；等待执行',{reviewId:r.id,text:r.text});
  }else if(a.action==='review-decide'){
   const attempt=r.attempts.at(-1);
   if(r.status!=='generated'||!attempt||attempt.status!=='generated'||s.status!=='done'||attempt.after?.outputHash!==s.outputHash)throw Error('请在本次修改生成有效结果后复核；结果已变化或已复核时须重新评审。');
   if(!['resolved','needs-revision'].includes(a.decision))throw Error('请选择已解决或仍需修改。');
   const note=String(a.note||'').trim();if(note.length>12000||a.decision==='needs-revision'&&!note)throw Error('请填写仍需修改的原因，最多12000字。');
   const decision={at:now(),status:a.decision,note,reviewer:String(a.reviewer||r.reviewer).slice(0,120),outputHash:s.outputHash,attemptId:attempt.id};
   r.decisions.push(decision);r.status=a.decision;
   flow.recordEvent(p,r.stage,'评审复核',a.decision==='resolved'?'工程师确认本条意见已解决':'工程师指出仍需修改',{reviewId:r.id,...decision});
   // A follow-up is an independent, immutable comment against this actual result.
   if(a.decision==='needs-revision')p.engineeringReviews.push({id:randomUUID(),parentId:r.id,stage:r.stage,text:note,reviewer:decision.reviewer,createdAt:now(),inputHash:hash(p.inputs),before:reviewSnapshot(p,r.stage),status:'recorded',attempts:[],decisions:[]});
  }else throw Error('未知评审操作。');
 }
 p.revision++;await flow.save(p);return flow.open(p.id);
}
export function beginReviewRun(p,stage){
 const runId=randomUUID();let any=false;
 for(const r of p.engineeringReviews||[])if(r.stage===stage&&['applied','generated','failed','interrupted','waiting-input','cancelled'].includes(r.status)){
  // Do not claim an adopted instruction was executed if somebody removed it.
  if(!p.inputs.stageNotes?.[stage]?.includes(`【工程师评审 ${r.id}】\n${r.text}\n【评审结束】`))continue;
  r.attempts.push({id:runId,startedAt:now(),status:'running',inputHash:hash(p.inputs),before:reviewSnapshot(p,stage)});r.status='running';any=true;
 }
 return any?runId:null;
}
export async function finishReviewRun(flow,id,stage,runId){
 if(!runId)return;const p=await flow.load(id),s=flow.stage(p,stage);
 for(const r of p.engineeringReviews||[]){const attempt=r.attempts.find(a=>a.id===runId);if(!attempt)continue;
  attempt.after=s.output!==attempt.before.output?reviewSnapshot(p,stage):null;attempt.finishedAt=now();attempt.status=s.status==='done'?'generated':s.status;attempt.error=s.error||null;
  attempt.filesChanged=Boolean(attempt.after)&&r.before.outputHash!==attempt.after.outputHash;r.status=attempt.status;
  flow.recordEvent(p,stage,'评审修改结果',s.status==='done'?'已生成修改结果，等待工程师复核':'修改尚未完成，评审意见已保留',{reviewId:r.id,attemptId:runId,status:attempt.status,before:r.before.outputHash,after:attempt.after?.outputHash});
 }
 p.revision++;await flow.save(p);
}
export function interruptedReviews(p){for(const r of p.engineeringReviews||[])if(r.status==='running'){
 r.status='interrupted';const a=r.attempts.at(-1);if(a?.status==='running'){a.status='interrupted';a.error='执行进程已退出；意见与修改前版本已保留。';}
}}
export async function reviewAsset(flow,args){
 const p=await flow.load(args.projectId),r=p.engineeringReviews?.find(r=>r.id===args.reviewId);
 if(!r)throw Error('评审记录不存在。');
 const snapshot=args.side==='before'?r.before:args.side==='after'?r.attempts.find(a=>a.id===args.attemptId)?.after:null;
 const f=snapshot?.files?.find(f=>f.path===args.path);if(!f||!snapshot.output)throw Error('该版本没有此图纸。');
 const base=await within(path.join(flow.dir(p.id),'steps',String(r.stage)),snapshot.output);
 const data=await fs.readFile(await within(base,f.path));if(hash(data)!==f.sha256)throw Error('历史文件内容已变化，不能作为原评审版本显示。');
 return {data,extension:path.extname(f.path),name:path.basename(f.path)};
}
