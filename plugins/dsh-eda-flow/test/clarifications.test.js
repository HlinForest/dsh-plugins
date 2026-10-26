import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Flow} from '../src/service.js';
import {pendingIssues,resolvedAnswers,isResolved} from '../src/review-items.js';
import {validateResolution} from '../src/clarifications.js';
const q='请确认供电电压。';
const result=(status='resolved',from=null)=>({action:'finish',summary:status==='resolved'?'供电要求已明确。':'还需给出电压范围。',gaps:[],assumptions:[],resolution:{status,regenerateFrom:from},provider:'test-double',model:'TEST-DOUBLE'});
async function setup(t,generateText=async()=>result()) {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'eda-answer-'));
 const flow=new Flow({workspaceRoot:root,workDirectory:root,allowModelCalls:true},{generateText});
 t.after(async()=>{await flow.close();await fs.rm(root,{recursive:true,force:true});});
 const p=await flow.create({label:'test',designMode:'new-design'});p.stages[1].questions=[q];p.stages[1].gaps=[q];p.stages[1].status='waiting-input';await flow.save(p);
 return {flow,p};
}
async function answer(flow,p,text='5V') {
 await flow.dispatch({action:'answer-issue',projectId:p.id,stage:2,question:q,answer:text},null,'human');
 await flow.jobs.get(p.id)?.promise;return flow.load(p.id);
}
test('answer receives immediate persisted feedback and deduplicates across stages and restart',async t=>{
 const {flow,p}=await setup(t);const next=await answer(flow,p);
 assert.equal(next.clarifications[0].status,'resolved');assert.equal(pendingIssues(next,next.stages[1]).length,0);
 next.stages[4].gaps=['请确认供电电压！'];assert.equal(pendingIssues(next,next.stages[4]).length,0);
 assert.equal(resolvedAnswers(next)[0].answer,'5V');assert.equal(next.stages[3].confirmed,false);
 const reopened=new Flow(flow.config);assert(isResolved(await reopened.load(p.id),q));
});
test('incomplete answer stays editable and records the follow-up without losing answer history',async t=>{
 let n=0;const {flow,p}=await setup(t,async()=>result(++n===1?'needs-input':'resolved'));
 let next=await answer(flow,p,'用正常电压');assert.equal(pendingIssues(next,next.stages[1]).length,1);assert.match(next.clarifications[0].feedback,/范围/);
 next=await answer(flow,p);assert.equal(next.clarifications[0].history[0].answer,'用正常电压');assert(isResolved(next,q));
});
test('changed requirements reopen answered items, unchanged saves do not',async t=>{
 const {flow,p}=await setup(t);await answer(flow,p);
 await flow.update({projectId:p.id,stage:1,inputs:{requirements:p.inputs.requirements}});assert(isResolved(await flow.load(p.id),q));
 await flow.update({projectId:p.id,stage:1,inputs:{requirements:'改成12V'}});assert(!isResolved(await flow.load(p.id),q));
});
test('design-changing answer invalidates dependent results and clears drawing confirmation',async t=>{
 const {flow,p}=await setup(t,async()=>result('resolved',3));p.stages[3].status='done';p.stages[3].confirmed=true;await flow.save(p);
 const next=await answer(flow,p);assert.equal(next.stages[3].status,'stale');assert.equal(next.stages[3].confirmed,false);assert.equal(next.stages[1].status,'waiting-input');assert.equal(next.clarifications[0].regenerateFrom,3);
});
test('model error preserves answer and supports retry; no fake resolution',async t=>{
 let fail=true;const {flow,p}=await setup(t,async()=>{if(fail)throw new Error('模型断线');return result();});
 let next=await answer(flow,p);assert.equal(next.clarifications[0].status,'error');assert.equal(next.clarifications[0].answer,'5V');assert.equal(pendingIssues(next,next.stages[1]).length,1);
 fail=false;next=await answer(flow,p);assert(isResolved(next,q));
});
test('question response becomes concrete follow-up rather than successful resolution',async t=>{
 const {flow,p}=await setup(t,async()=>({action:'question',questions:['电压容差是多少？']}));const next=await answer(flow,p);assert.equal(next.clarifications[0].status,'needs-input');assert.match(next.clarifications[0].feedback,/容差/);
});
test('concurrent mutations and model impersonation cannot approve answers',async t=>{
 let release;const {flow,p}=await setup(t,()=>new Promise(r=>{release=r;}));
 await assert.rejects(flow.dispatch({action:'answer-issue',projectId:p.id,stage:2,question:q,answer:'5V'},null,'model'),/工程师/);
 await flow.dispatch({action:'answer-issue',projectId:p.id,stage:2,question:q,answer:'5V'},null,'human');
 await assert.rejects(flow.update({projectId:p.id,stage:1,inputs:{requirements:'changed'}}));
 release(result());await flow.jobs.get(p.id).promise;
});
test('invalid resolution cannot close a question; cancelled job preserves input',async t=>{
 const {flow,p}=await setup(t,async()=>({action:'finish',summary:'ok',resolution:{status:'resolved'}}));
 assert.equal((await answer(flow,p)).clarifications[0].status,'error');
 assert(validateResolution(result('resolved',8)));
 let release;flow.ai.generateText=()=>new Promise(r=>{release=r;});
 await flow.dispatch({action:'answer-issue',projectId:p.id,stage:2,question:q,answer:'5V'},null,'human');
 await flow.dispatch({action:'cancel',projectId:p.id},null,'human');release(result());await flow.jobs.get(p.id).promise;
 const next=await flow.load(p.id);assert.equal(next.clarifications[0].status,'error');assert.match(next.clarifications[0].feedback,/取消/);
});
test('missing model still saves typed answer; unknown issue and empty answer rejected',async t=>{
 const {flow,p}=await setup(t);flow.ai=null;
 const next=await answer(flow,p);assert.equal(next.clarifications[0].answer,'5V');assert.equal(next.clarifications[0].status,'error');
 await assert.rejects(answer(flow,p,''),/请输入/);
 await assert.rejects(flow.dispatch({action:'answer-issue',projectId:p.id,stage:2,question:'不存在',answer:'yes'},null,'human'),/已变化/);
});
