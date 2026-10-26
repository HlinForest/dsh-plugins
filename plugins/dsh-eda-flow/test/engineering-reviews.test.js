import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Flow} from '../src/service.js';
import {hash,tree} from '../src/io.js';
import {reviewAsset,pcbReviewBaseline,reviewSnapshot} from '../src/engineering-reviews.js';
import {routes} from '../src/http.js';
async function setup(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'engineer-review-'));const flow=new Flow({workspaceRoot:root,workDirectory:root});
 t.after(async()=>{await flow.close();assert(root.startsWith(path.join(os.tmpdir(),'engineer-review-')));await fs.rm(root,{recursive:true,force:true})});
 let p=await flow.create({label:'non-display review fixture'});p.pcbEnabled=true;
 for(const s of p.stages){s.status='done';s.confirmed=true;}
 const output=path.join(flow.dir(p.id),'steps','6',randomUUID());await fs.mkdir(path.join(output,'project'),{recursive:true});await fs.writeFile(path.join(output,'project','PCB-Back.pdf'),'fixture before');
 const files=await tree(output);Object.assign(p.stages[5],{output,files,outputHash:hash(files),result:{summary:'before',drc:{errors:0,unconnected:0,passed:true},tracks:20}});
 await flow.save(p);return {flow,p};
}
async function act(flow,p,args,actor='human'){const current=await flow.load(p.id);return flow.dispatch({projectId:p.id,expectedRevision:current.revision,...args},null,actor);}
test('recording is non-destructive; adoption invalidates only chosen stage and descendants',async t=>{
 const {flow,p}=await setup(t);const before=p.stages[5].outputHash;
 let next=await act(flow,p,{action:'review-add',stage:6,text:'缩短供电路径，保持器件值和接法。',reviewer:'工程师甲'});
 assert(next.stages.every(s=>s.confirmed));const r=next.engineeringReviews[0];assert.equal(r.before.outputHash,before);assert.equal(next.inputs.stageNotes?.[6],undefined);
 next=await act(flow,p,{action:'review-apply',reviewId:r.id});assert(next.stages.slice(0,5).every(s=>s.confirmed));assert.equal(next.stages[5].status,'stale');assert.equal(next.stages[6].status,'stale');assert(next.inputs.stageNotes[6].includes(r.text));
 await assert.rejects(act(flow,p,{action:'review-decide',reviewId:r.id,decision:'resolved'}),/有效结果/);
});
test('stale comments and non-human adoption are rejected; historical files are hash checked',async t=>{
 const {flow,p}=await setup(t);let next=await act(flow,p,{action:'review-add',stage:6,text:'改进走线'});const r=next.engineeringReviews[0];
 await assert.rejects(act(flow,p,{action:'review-apply',reviewId:r.id},'model'),/人在页面/);
 const args={projectId:p.id,reviewId:r.id,side:'before',path:'project/PCB-Back.pdf'};assert.equal((await reviewAsset(flow,args)).data.toString(),'fixture before');
 const response=await routes(flow).find(r=>r.name==='review-asset').run(new Request('http://localhost/api/eda-flow/review-asset?'+new URLSearchParams(args)));
 assert(response.headers.get('content-security-policy').startsWith("sandbox; default-src 'none'"));
 await assert.rejects(reviewAsset(flow,{...args,path:'../../outside.pdf'}),/没有此图纸/);
 await fs.writeFile(path.join(r.before.output,args.path),'tampered');await assert.rejects(reviewAsset(flow,args),/内容已变化/);
 await assert.rejects(act(flow,p,{action:'review-apply',reviewId:r.id}),/已变化/);
});
test('real execution lifecycle links attempts; DRC success does not resolve review; follow-up preserves original',async t=>{
 const {flow,p}=await setup(t);let next=await act(flow,p,{action:'review-add',stage:6,text:'改善布局'});const id=next.engineeringReviews[0].id;
 await act(flow,p,{action:'review-apply',reviewId:id});
 flow.execute=async(projectId,stage)=>{const q=await flow.load(projectId),s=flow.stage(q,stage);const output=path.join(flow.dir(projectId),'steps','6',randomUUID());await fs.mkdir(path.join(output,'project'),{recursive:true});await fs.writeFile(path.join(output,'project','PCB-Back.pdf'),'fixture after');const files=await tree(output);Object.assign(s,{status:'done',output,files,outputHash:hash(files),result:{summary:'after',drc:{passed:true,errors:0,unconnected:0},tracks:12}});await flow.save(q);};
 await act(flow,p,{action:'execute',stage:6});await flow.jobs.get(p.id)?.promise;
 next=await flow.load(p.id);assert.equal(next.engineeringReviews[0].status,'generated');assert.equal(next.engineeringReviews[0].attempts[0].after.tracks,12);assert.equal(next.engineeringReviews[0].before.tracks,20);assert.equal(next.engineeringReviews[0].decisions.length,0);
 next=await act(flow,p,{action:'review-decide',reviewId:id,decision:'needs-revision',note:'仍需缩短回流路径'});assert.equal(next.engineeringReviews.length,2);assert.equal(next.engineeringReviews[0].text,'改善布局');assert.equal(next.engineeringReviews[1].parentId,id);
 await assert.rejects(act(flow,p,{action:'review-decide',reviewId:id,decision:'resolved'}),/已复核/);
});
test('failed execution retains opinion and review-only mode does not start tools',async t=>{
 const {flow,p}=await setup(t);let next=await act(flow,p,{action:'review-add',stage:6,text:'仍需改善'});const id=next.engineeringReviews[0].id;await act(flow,p,{action:'review-apply',reviewId:id});
 flow.config.reviewOnly=true;await assert.rejects(act(flow,p,{action:'execute',stage:6}),/仅查看与评审/);assert.equal(flow.jobs.size,0);
 flow.config.reviewOnly=false;flow.execute=async()=>{throw Error('layout failed')};await act(flow,p,{action:'execute',stage:6});await flow.jobs.get(p.id)?.promise;next=await flow.load(p.id);assert.equal(next.engineeringReviews[0].status,'failed');assert.equal(next.engineeringReviews[0].attempts[0].error,'layout failed');assert.equal(next.engineeringReviews[0].before.tracks,20);
});

test('PCB follow-up reuses the original verified plan intent without generated coordinates',async t=>{
 const {flow,p}=await setup(t);const s=p.stages[5];
 await fs.writeFile(path.join(s.output,'pcb-request.json'),JSON.stringify({plan:{order:['J1','C1'],trackWidthMm:.25,componentGapMm:1,placements:{C1:{xMm:12,yMm:20}},extraGeneratedGeometry:{x:30}}}));
 s.files=await tree(s.output);s.outputHash=hash(s.files);await flow.save(p);
 let q=await act(flow,p,{action:'review-add',stage:6,text:'加宽线，不增加绕行'});const root=q.engineeringReviews[0];
 q.engineeringReviews.push({...structuredClone(root),id:'follow-up',parentId:root.id,status:'running'});
 const baseline=await pcbReviewBaseline(flow,q);
 assert.equal(baseline.reviewId,root.id);assert.deepEqual(baseline.pcbPlan.order,['J1','C1']);
 assert.equal(baseline.pcbPlan.trackWidthMm,.25);assert(!Object.hasOwn(baseline.pcbPlan,'placements'));assert(!Object.hasOwn(baseline.pcbPlan,'extraGeneratedGeometry'));
 await fs.appendFile(path.join(s.output,'pcb-request.json'),' ');
 await assert.rejects(pcbReviewBaseline(flow,q),/原始版本文件已变化/);
});

test('schematic readability metrics cannot masquerade as PCB route metrics in review history',()=>{
 const p={stages:[{id:4,result:{routingQuality:{schema:'routing-quality.v1',metrics:{wire:{totalWireMm:100}}}}},{id:6,result:{routingQuality:{trackLengthMm:25,shortSegmentsUnder05mm:1,degree2Bends:4}}}]};
 assert.equal(reviewSnapshot(p,4).routingQuality,null);
 assert.equal(reviewSnapshot(p,6).routingQuality.trackLengthMm,25);
});
