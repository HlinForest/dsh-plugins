import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {hash,tree} from '../src/io.js';
import {schematicTargets,reviewSelection} from '../src/schematic-targets.js';
const run=promisify(execFile);
test('selection is from the native drawing version; stale files and invented refs are rejected',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'select-test-'));
 try{
  const sch='(kicad_sch (lib_symbols (symbol "Any:R" (symbol "R_1_1" (rectangle (start -1 2) (end 1 -2))))) (symbol (lib_id "Any:R") (at 20 30 0) (unit 1) (uuid "part-id") (property "Reference" "R-any" (at 20 25 0)) (property "Value" "12k" (at 20 35 0))))';
  await fs.writeFile(path.join(dir,'Circuit.kicad_sch'),sch);await fs.writeFile(path.join(dir,'Circuit.svg'),'<svg viewBox="0 0 297 210"/>');await fs.writeFile(path.join(dir,'Other.svg'),'<svg viewBox="0 0 297 210"/>');
  const stage={id:4,status:'done',output:dir,files:await tree(dir)};stage.outputHash=hash(stage.files);const p={stages:[stage]};
  const flow={stage(p,n){assert.equal(n,4);return p.stages[0]},async runProcess(args,cwd){await run('D:/anaconda/python.exe',args,{cwd,windowsHide:true});}};
  const map=await schematicTargets(flow,p,4,'Circuit.svg');assert.equal(map.targets[0].ref,'R-any');assert.equal(hash(await tree(dir)),stage.outputHash);
  const selection={sourceStage:4,sourceOutputHash:stage.outputHash,imagePath:'Circuit.svg',refs:['R-any']};
  const bound=await reviewSelection(flow,p,selection);assert.equal(bound.components[0].value,'12k');assert(!JSON.stringify(bound).includes('regions'));assert(!JSON.stringify(bound).includes('placements'));
  await assert.rejects(reviewSelection(flow,p,{...selection,refs:['invented']}),/不在当前/);
  await assert.rejects(reviewSelection(flow,p,{...selection,sourceOutputHash:'stale'}),/已变化/);
  await assert.rejects(schematicTargets(flow,p,4,'../Circuit.svg'),/不支持/);
  await assert.rejects(schematicTargets(flow,p,4,'Other.svg'),/不支持/);
  await assert.rejects(schematicTargets(flow,p,6,'Circuit.svg'),/只有/);
  await fs.appendFile(path.join(dir,'Circuit.kicad_sch'),'\n; changed');await assert.rejects(schematicTargets(flow,p,4,'Circuit.svg'),/已变化/);
 }finally{await fs.rm(dir,{recursive:true,force:true})}
});

import {Flow} from '../src/service.js';
test('component prompt is recorded against the drawing; adopting it invalidates design and descendants',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'select-review-'));const flow=new Flow({workspaceRoot:root,workDirectory:root,kicadPython:'D:/anaconda/python.exe'});
 try{
  let p=await flow.create({label:'Arbitrary component selection'});for(const s of p.stages){s.status='done';s.confirmed=true;}
  const schematic='(kicad_sch (lib_symbols (symbol "Any:R" (symbol "R_1_1" (rectangle (start -1 2) (end 1 -2))))) (symbol (lib_id "Any:R") (at 20 30 0) (unit 1) (uuid "part-id") (property "Reference" "RBias" (at 20 25 0)) (property "Value" "12k" (at 20 35 0))))';
  for(const n of [3,4]){const out=path.join(flow.dir(p.id),'steps',String(n),'selected');await fs.mkdir(out,{recursive:true});await fs.writeFile(path.join(out,n===4?'Circuit.kicad_sch':'design.txt'),n===4?schematic:'design');if(n===4)await fs.writeFile(path.join(out,'Circuit.svg'),'<svg viewBox="0 0 297 210"/>');const files=await tree(out);Object.assign(p.stages[n-1],{output:out,files,outputHash:hash(files)});}
  await flow.save(p);const source=p.stages[3];
  const selection={sourceStage:4,sourceOutputHash:source.outputHash,imagePath:'Circuit.svg',refs:['RBias']};
  p=await flow.dispatch({action:'review-add',projectId:p.id,expectedRevision:p.revision,stage:3,text:'按输入条件重新核对阻值，保留缺项。',selection},null,'human');
  const r=p.engineeringReviews.at(-1);assert(r.text.includes('RBias（当前 12k）'));assert.equal(r.selection.sourceOutputHash,source.outputHash);assert(p.stages.every(s=>s.confirmed));assert(!JSON.stringify(r.selection).includes('regions'));
  await fs.appendFile(path.join(source.output,'Circuit.kicad_sch'),'\n; external edit');
  await assert.rejects(flow.dispatch({action:'review-apply',projectId:p.id,expectedRevision:p.revision,reviewId:r.id},null,'human'),/已变化/);
  await fs.writeFile(path.join(source.output,'Circuit.kicad_sch'),schematic);await flow.save(p);
  p=await flow.dispatch({action:'review-apply',projectId:p.id,expectedRevision:p.revision,reviewId:r.id},null,'human');
  assert(p.stages.slice(0,2).every(s=>s.confirmed));assert(p.stages.slice(2).every(s=>!s.confirmed));assert(p.inputs.stageNotes[3].includes('RBias（当前 12k）'));
 }finally{await flow.close();assert(path.resolve(path.dirname(root))===path.resolve(os.tmpdir()));await fs.rm(root,{recursive:true,force:true})}
});
