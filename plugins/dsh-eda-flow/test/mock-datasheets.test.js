import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { Flow } from '../src/service.js';
import { mockEvidence, evidenceForStage } from '../src/mock-datasheets.js';
import { textInputRecord } from '../frontend/textFlow.js';
import { invokePrecise } from '../src/precise-tools.js';

const config = root => ({workspaceRoot:root,workDirectory:root,allowModelCalls:true,kicadPython:'D:/anaconda/python.exe',kicadCli:'D:/Kicad/bin/kicad-cli.exe'});
async function workspace(t) {const root=await fs.mkdtemp(path.join(os.tmpdir(),'pdf-mock-'));t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:5}));return root;}

test('obsolete mock baseline loses acceptance without overwriting engineer edits or historical paths',async t=>{
 const flow=new Flow(config(await workspace(t)));let p=await flow.create({caseId:'display-board'});
 p.inputs.requirements='Engineer edited task';p.inputs.evidence=[{id:'display',symbolId:'Evidence:SKHT564411WAE',content:'Old mock',simulated:true}];
 p.stages[2].status='done';p.stages[2].confirmed=true;p.lastValidLayout={project:'old-output'};await flow.save(p);
 const inputs=structuredClone(p.inputs);p=await flow.open(p.id);
 assert.deepEqual(p.inputs,inputs);assert.equal(p.mockEvidenceIssue.kind,'mock-baseline-upgrade');assert(!p.stages[2].confirmed);assert(!p.lastValidLayout);
 const revision=p.revision;p=await flow.open(p.id);assert.equal(p.revision,revision);
});

test('default demo has complete visible stage inputs, no legacy object bundle, and preserves source markers', async t => {
  const flow=new Flow(config(await workspace(t)));
  let p=await flow.create({caseId:'display-board'});
  assert.equal(p.designMode,'datasheet-demo');assert(!p.inputsBundle);assert(!p.fixedLibrary);
  assert.equal(p.controlledLayout,true);assert.equal(p.layoutEngine,'native-kicad');
  assert(p.inputs.requirements.length<600);
  for(let stage=1;stage<=7;stage++) {assert(p.inputs.stageNotes[stage]);assert(evidenceForStage(p.inputs.evidence,stage).length);}
  for(const r of p.inputs.evidence) {assert(r.simulated);assert(r.pageIsPlaceholder);assert(r.document);assert(r.binding);}
  assert.match(textInputRecord(p),/第\d+页（演示占位）/);
  assert(!JSON.stringify(p.inputs).includes('SourceRecord'));
  await assert.rejects(flow.update({projectId:p.id,stage:2,inputs:{evidence:[]}}),/不能加载工程对象包/);
  p.stages[3].status='done';p.stages[3].confirmed=true;await flow.save(p);
  await flow.update({projectId:p.id,stage:1,inputs:{requirements:p.inputs.requirements+' 修改接口需求，请重新核对。'}});
  p=await flow.open(p.id);assert.notEqual(p.stages[3].status,'done');assert(!p.stages[3].confirmed);assert.equal(p.stages[5].status,'skipped');
  assert.deepEqual(p.inputs.evidence,mockEvidence);
  const old=await flow.create({caseId:'display-board',label:'Historical',designMode:'reconstruction'});
  assert(old.inputs.requirements.length>40000);assert(!old.inputs.evidence);
});

test('beta.2 mock projects upgrade at stage three without discarding original inputs or identity',async t=>{
  const flow=new Flow(config(await workspace(t)));
  let p=await flow.create({caseId:'display-board'});const id=p.id,inputs=structuredClone(p.inputs);
  p.controlledLayout=false;delete p.layoutEngine;p.stages[2].status='done';p.stages[2].confirmed=true;
  p.lastValidLayout={project:'old-cad'};await flow.save(p);
  p=await flow.open(id);assert.equal(p.id,id);assert.deepEqual(p.inputs,inputs);
  assert(p.controlledLayout);assert.equal(p.layoutEngine,'native-kicad');assert(!p.stages[2].confirmed);assert(!p.lastValidLayout);
  assert.equal(p.stages[2].invalidation.kind,'workflow-upgrade');
  const revision=p.revision;p=await flow.open(id);assert.equal(p.revision,revision);
});

test('stage requests contain scoped mock evidence and do not pretend to read PDF', async t => {
  let captured;
  const flow=new Flow(config(await workspace(t)),{async generateText(args){captured=args;assert(!args.tools.some(t=>t.name==='design_blocks'));await assert.rejects(()=>args.invoke('design_blocks',{action:'list'}),/禁止读取历史CAD/);return {action:'finish',summary:'test model only',gaps:[],assumptions:[],requirements:[{id:'display',description:'显示功能'}]};}});
  let p=await flow.create({caseId:'display-board'});await flow.confirm({projectId:p.id,stage:1},'human');
  p=await flow.execute(p.id,2);
  assert.equal(captured.project.designMode,'datasheet-demo');assert(captured.request.inputProvenance.simulated);
  assert.deepEqual(captured.request.inputs.evidence,evidenceForStage(mockEvidence,2));
  assert(!captured.tools.some(t=>t.name==='design_library'), 'stage two organizes requirements; symbol selection starts at stage three');
  assert(!captured.tools.some(t=>t.name==='precise_fixed_library'));
  const snapshot=JSON.parse(await fs.readFile(path.join(p.stages[1].output,'text-input.json'),'utf8'));
  assert(snapshot.inputs.evidence.every(r=>r.simulated&&r.pageIsPlaceholder));
});

test('real CAD audit accepts only evidenced custom pins and keeps parts without PCB footprints in BOM', async t => {
  const root=await workspace(t),cfg=config(root),source=mockEvidence.find(r=>r.id==='display-appearance');
  const component={id:'display',ref:'DS1',value:'LED',mpn:'',librarySymbol:source.symbolId,footprint:'',in_bom:true,on_board:true,dnp:false,pins:source.pins.map(p=>({...p,pad:p.number}))};
  // Isolated audit fixture, intentionally all NC; not a working display-board design.
  const design={components:[component],nets:[],nc:component.pins.map(p=>'DS1.'+p.number),functions:[],unresolved:['测试夹具，非完整显示板']};
  const call=(name,args)=>invokePrecise(cfg,root,name,args);
  await call('precise_create',{request_key:'create',name:'EvidenceFixture'});
  await call('precise_apply',{request_key:'draw',symbols:[{name:'Display',pins:source.pins.map((p,i)=>({...p,at:[0,-i*5.08,0],length:2.54}))}],items:[{id:'display',kind:'component',symbol:'Display',reference:'DS1',value:component.value,at:[50.8,25.4],properties:[{name:'DesignId',value:'display',at:[50.8,15.24],visible:false},{name:'MPN',value:component.mpn,at:[50.8,15.24],visible:false}]},...source.pins.map((p,i)=>({id:'nc'+p.number,kind:'no_connect',at:[50.8,25.4+i*5.08]}))]});
  await call('precise_check_export',{request_key:'check',formats:['netlist','bom','erc','pdf','svg']});
  const audit=async(d,evidence)=>{await fs.writeFile(path.join(root,'request.json'),JSON.stringify({operation:'audit',libraryRoot:'D:/Kicad/share/kicad',design:d,project:root,evidence}));execFileSync(cfg.kicadPython,['mcp/design_audit.py',path.join(root,'request.json'),path.join(root,'audit.json')],{env:{...process.env,PYTHONUTF8:'1'}});return JSON.parse(await fs.readFile(path.join(root,'audit.json'),'utf8'));};
  const result=await audit(design,mockEvidence);assert.deepEqual(result.errors,[]);assert.equal(result.purchaseRows,1);assert.equal(result.releaseReady,false);
  assert((await audit(design,[])).errors.some(e=>e.category==='library-pins'));
  const changed=structuredClone(design);changed.components[0].pins[0].name='incorrect';
  assert((await audit(changed,mockEvidence)).errors.some(e=>e.category==='library-pins'));
  assert((await fs.readFile(path.join(root,'purchase-bom.csv'),'utf8')).includes('DS1'));
});
