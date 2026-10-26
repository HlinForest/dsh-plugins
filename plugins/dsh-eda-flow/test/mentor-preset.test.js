import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Flow} from '../src/service.js';

async function setup(t, ai) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'visible-preset-'));
  const flow = new Flow({workspaceRoot:root,workDirectory:root,allowModelCalls:true},ai);
  t.after(async()=>{await flow.close();await fs.rm(root,{recursive:true,force:true,maxRetries:5});});
  return flow;
}

test('display example only prefills ordinary editable text; creation and reopen never load documents or CAD',async t=>{
  const flow = await setup(t);
  let p = await flow.create({label:'example',designMode:'new-design',demoPreset:'display-board'});
  assert.equal(p.caseId,null);assert.equal(p.designMode,'new-design');assert.equal(p.layoutEngine,'native-kicad');
  assert.deepEqual(p.uploads,[]);assert.equal(p.inputs.datasheetText,'');assert.equal(p.inputs.evidence,undefined);
  for(const key of ['inputsBundle','fixedLibrary','fixedParts','electricalFreeze','lastValidLayout'])assert.equal(p[key],undefined,key);
  assert.deepEqual(Object.keys(p.inputs.stageNotes),['1','2','3','4','5','6','7']);
  assert(Object.values(p.inputs.stageNotes).every(text=>typeof text==='string'&&text.length>0));
  assert(!/29个电气|85个逻辑|12个工艺|101个物理|40个有名|10脚整体|全部默认装配|QR Code仅/.test(JSON.stringify(p.inputs)), 'datasheet-derived inventory, pin counts and assembly facts must wait for upload');
  assert.equal(p.modelRequests,0);
  assert(!(await fs.readdir(flow.dir(p.id),{recursive:true})).some(file=>/\.(pdf|docx|kicad_sch|kicad_pcb|kicad_mod|json)$/i.test(file)));
  const saved=structuredClone(p.inputs);p=await flow.open(p.id);assert.deepEqual(p.inputs,saved);assert.deepEqual(p.uploads,[]);
  await flow.update({projectId:p.id,stage:3,inputs:{stageNotes:{3:'只保留我的新连接要求'}}});
  await flow.update({projectId:p.id,stage:1,inputs:{requirements:'改成另一种显示方案'}});
  p=await flow.open(p.id);assert.equal(p.inputs.stageNotes[3],'只保留我的新连接要求');assert.equal(p.inputs.requirements,'改成另一种显示方案');
  const alias=await flow.create({label:'old entry',caseId:'display-board'});
  assert.equal(alias.designMode,'new-design');assert.equal(alias.caseId,null);assert.deepEqual(alias.uploads,[]);assert.equal(alias.inputs.evidence,undefined);
  for(const args of [{designMode:'datasheet-demo',caseId:'display-board'},{legacy:true,caseId:'display-board'},{designMode:'reconstruction'},{designMode:'fixed-redesign',caseId:'display-board'}])await assert.rejects(flow.create(args),/通用|固定器件/);
});

test('same visible inputs produce identical generic model requests; missing PDFs supply no facts',async t=>{
  const calls=[];
  const flow=await setup(t,{async generateText(args){calls.push(structuredClone(args.request));return {action:'question',questions:['请上传器件规格书。'],gaps:[],assumptions:[]};}});
  const example=await flow.create({label:'example',designMode:'new-design',demoPreset:'display-board'});
  const blank=await flow.create({label:'blank',designMode:'new-design'});
  const {stageNotes,datasheets,resources,...fields}=example.inputs;
  await flow.update({projectId:blank.id,stage:1,inputs:fields});
  for(const [stage,text] of Object.entries(stageNotes))await flow.update({projectId:blank.id,stage:Number(stage),inputs:{stageNotes:{[stage]:text}}});
  for(const p of [example,blank]){await flow.confirm({projectId:p.id,stage:1},'human');await flow.execute(p.id,2);}
  assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1]);
  assert.deepEqual(calls[0].attachments,[]);assert.equal(calls[0].inputs.evidence,undefined);assert.equal(calls[0].sourceLibrary,undefined);assert.equal(calls[0].fixedLibrary,undefined);
  assert.equal((await flow.open(example.id)).stages[1].status,'waiting-input');
  assert.equal((await flow.open(blank.id)).stages[1].status,'waiting-input');
  await flow.update({projectId:example.id,stage:1,inputs:{requirements:'Only use my replacement task.',power:'',interfaces:'',acceptance:'',constraints:{}}});
  for(let stage=1;stage<=7;stage++)await flow.update({projectId:example.id,stage,inputs:{stageNotes:{[stage]:''}}});
  await flow.confirm({projectId:example.id,stage:1},'human');await flow.execute(example.id,2);
  assert(!/TM1616|IRM-3638|82\.47|47Ω|85个/.test(JSON.stringify(calls[2])));
});

test('PCB-only inputs preserve confirmed schematic stages and the frozen circuit',async t=>{
  const flow=await setup(t);
  let p=await flow.create({label:'PCB inputs',demoPreset:'display-board'});
  p.pcbEnabled=true;
  p.electricalFreeze={sha256:'existing-frozen-circuit'};
  p.stages.forEach(s=>{s.status='done';s.confirmed=true;});
  await flow.save(p);
  const schematicRule=p.inputs.constraints.rulePolicy;
  p=await flow.update({projectId:p.id,stage:6,inputs:{constraints:{...p.inputs.constraints,outlinePolicy:'100 × 60 mm',cadLayers:'2',routing:'B.Cu',manufacture:'单面铜',plating:'非金属化孔',pcbRulePolicy:'最小间距0.3mm'},stageNotes:{6:'机械基准由我在此填写'}}});
  assert(p.stages.slice(0,5).every(s=>s.status==='done'&&s.confirmed));
  assert(p.stages.slice(5).every(s=>s.status==='stale'&&!s.confirmed));
  assert.deepEqual(p.electricalFreeze,{sha256:'existing-frozen-circuit'});
  assert.equal(p.inputs.constraints.rulePolicy,schematicRule);
  assert.equal(p.inputs.constraints.pcbRulePolicy,'最小间距0.3mm');
  p=await flow.update({projectId:p.id,stage:1,inputs:{constraints:{...p.inputs.constraints,rulePolicy:'新的原理图规则'}}});
  assert.equal(p.stages[0].status,'stale');
  assert.equal(p.electricalFreeze,undefined);
});
