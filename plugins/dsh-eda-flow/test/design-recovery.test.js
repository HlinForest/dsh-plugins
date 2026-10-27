import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {hash,writeJSON,tree} from '../src/io.js';
import {designContext,recoverReviewedCandidate,recoverReviewBaseline} from '../src/design-recovery.js';

test('candidate recovery is bound to this project and the complete current source context',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'design-recovery-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const project=path.join(root,'project'),previous=path.join(project,'steps','3','attempt');
  const request={inputs:{requirements:'build a receiver',evidence:[{id:'page-1',content:'5 V'}]},requirements:[{id:'r1'}],attachments:[{sha256:'pdf-v1'}],applicationGuidance:[],resolvedAnswers:[]};
  const design={components:[{ref:'RX9'}],nets:[]};
  await writeJSON(path.join(previous,'text-input.json'),request);
  await writeJSON(path.join(previous,'tool-log.json'),[
    {name:'design_review',arguments:{design},ok:true,result:{valid:true}},
    {name:'design_review',arguments:{design:{components:[]}},ok:true,result:{valid:false}},
  ]);
  assert.deepEqual((await recoverReviewedCandidate(project,previous,request)).design,design);
  for(const key of ['inputs','requirements','attachments','applicationGuidance','resolvedAnswers']){
    const changed=structuredClone(request);changed[key]=key==='inputs'?{requirements:'different task'}:[{changed:true}];
    assert.equal(await recoverReviewedCandidate(project,previous,changed),null,key+' changes invalidate recovery');
  }
  assert.equal(await recoverReviewedCandidate(path.join(root,'other'),previous,request),null);
  await writeJSON(path.join(previous,'last-reviewed-candidate.json'),{context:designContext(request),sha256:hash(design),design});
  assert.deepEqual((await recoverReviewedCandidate(project,previous,{...request,plan:{old:true},recoverableDesign:{}})).design,design);
  await writeJSON(path.join(previous,'last-reviewed-candidate.json'),{context:designContext(request),sha256:'corrupt',design});
  assert.equal(await recoverReviewedCandidate(project,previous,request),null,'corrupt checkpoint must not fall back to an older proposal');
});

test('failed current-context drafts can resume only as unapproved proposals and cannot fall back past corruption',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'design-draft-recovery-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const previous=path.join(root,'steps','3','attempt'),request={inputs:{requirements:'derive bias from specifications'}};
  const design={components:[{ref:'RX9'}],nets:[]};
  await writeJSON(path.join(previous,'text-input.json'),request);
  await writeJSON(path.join(previous,'last-reviewed-candidate.json'),{context:designContext(request),sha256:hash({older:true}),design:{older:true}});
  await writeJSON(path.join(previous,'last-candidate-draft.json'),{context:designContext(request),sha256:hash(design),design,reviewed:false});
  const recovered=await recoverReviewedCandidate(root,previous,request);assert.deepEqual(recovered.design,design);assert.equal(recovered.previouslyReviewed,false);
  assert.equal(await recoverReviewedCandidate(root,previous,{inputs:{requirements:'changed'}}),null);
  await writeJSON(path.join(previous,'last-candidate-draft.json'),{context:designContext(request),sha256:'invalid',design,reviewed:false});
  assert.equal(await recoverReviewedCandidate(root,previous,request),null);
});

test('a pre-checkpoint failed resume retains its own model candidate without claiming review success',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'legacy-draft-recovery-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const previous=path.join(root,'steps','3','attempt'),request={inputs:{requirements:'derive receiver'}};
  const design={components:[{ref:'RX9'}],nets:[]};
  await writeJSON(path.join(previous,'text-input.json'),request);
  await writeJSON(path.join(previous,'tool-log.json'),[{name:'design_resume',ok:true,result:{valid:false,design}}]);
  const recovered=await recoverReviewedCandidate(root,previous,request);assert.deepEqual(recovered.design,design);assert.equal(recovered.previouslyReviewed,false);
});


test('adopted parameter review restores the hashed generated version as an unapproved draft after input changes',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'review-baseline-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const previous=path.join(root,'steps','3','version');
 const design={components:[{ref:'RX9',footprint:''}],nets:[],operatingPoints:[]};
 await writeJSON(path.join(previous,'electrical-review/electrical.json'),design);
 const r={id:'review-7',stage:3,status:'running',text:'Recalculate supply using updated response time',before:{output:previous,outputHash:hash(await tree(previous))}};
 const project={inputs:{requirements:'New conditions',stageNotes:{3:'【工程师评审 '+r.id+'】\n'+r.text+'\n【评审结束】'}},engineeringReviews:[r]};
 const result=await recoverReviewBaseline(root,project);
 assert.deepEqual(result.design,design);assert.equal(result.previouslyReviewed,false);assert.equal(result.contextChanged,true);assert.equal(result.reviewId,r.id);
 const removed=structuredClone(project);removed.inputs.stageNotes={};assert.equal(await recoverReviewBaseline(root,removed),null);
 const recorded=structuredClone(project);recorded.engineeringReviews[0].status='recorded';assert.equal(await recoverReviewBaseline(root,recorded),null);
 await assert.rejects(()=>recoverReviewBaseline(path.join(root,'other'),project),/当前项目/);
 await writeJSON(path.join(previous,'electrical-review/electrical.json'),{...design,nets:[{name:'changed'}]});
 await assert.rejects(()=>recoverReviewBaseline(root,project),/文件已变化/);
});
