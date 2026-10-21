import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {Flow} from '../src/service.js';
import {validateLayoutArgs,normalizeDesign,checkFreeze,reviewElectrical} from '../src/controlled-layout.js';
import {writeJSON,tree,hash} from '../src/io.js';
const fixture=process.env.EDA_CONTROLLED_FIXTURE;
test('layout contract rejects topology/NC/material injection and invalid dimensions',()=>{
  const a={template:'display-board-v1',paper:'A4-landscape',gapMm:5.08};assert.deepEqual(validateLayoutArgs(a),a);
  for(const k of ['nets','nc','components','symbols','rotations','script'])assert.throws(()=>validateLayoutArgs({...a,[k]:[]}));
  for(const gapMm of [0,100,NaN,'5.08'])assert.throws(()=>validateLayoutArgs({...a,gapMm}));
  assert.throws(()=>normalizeDesign({nets:[],nc:[],components:[]}));
});
test('controlled stage freezes approved electrical data, rejects changed plans/files and blocks raw tools', {skip:!fixture},async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'eda-controlled-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const design=JSON.parse(await fs.readFile(fixture,'utf8'));
  let rawRejected=false;
  const ai={generateText:async args=>{
    assert(args.tools.every(x=>!x.name.startsWith('precise_')));
    try{await args.invoke('precise_apply',{nets:[]});}catch{rawRejected=true;}
    throw new Error('intentional acceptance stop');
  }};
  const flow=new Flow({workspaceRoot:dir,workDirectory:dir,kicadPython:'D:/anaconda/python.exe',kicadCli:'D:/Kicad/bin/kicad-cli.exe',allowModelCalls:true},ai);
  let p=await flow.create({label:'freeze test',caseId:'display-board',designMode:'fixed-redesign'});
  assert.equal(p.controlledLayout,true);await flow.confirm({projectId:p.id,stage:1},'human');p=await flow.load(p.id);
  for(const n of [2,3]){const s=p.stages[n-1];s.output=path.join(dir,'fixture'+n);await writeJSON(path.join(s.output,'evidence.json'),{stage:n});s.files=await tree(s.output);s.outputHash=hash(s.files);s.status='done';s.plan={design};s.confirmed=n===2;}
  await flow.save(p);p=await flow.confirm({projectId:p.id,stage:3,allowDraft:true},'human');
  const frozen=await checkFreeze(flow,p);assert.equal(frozen.hash,hash(normalizeDesign(design)));
  await assert.rejects(()=>flow.execute(p.id,4),/intentional acceptance stop/);assert(rawRejected);
  const changed=structuredClone(p);changed.stages[2].plan.design.nc=[];await assert.rejects(()=>checkFreeze(flow,changed),/变化/);
  const invalid=structuredClone(design);invalid.nets[0].nodes.push(invalid.nc[0]);
  await assert.rejects(()=>reviewElectrical(flow,p,invalid,path.join(dir,'bad')),/more than one/);
  await fs.appendFile(path.join(frozen.dir,'electrical.json'),' ');await assert.rejects(()=>checkFreeze(flow,p),/变化/);
});
