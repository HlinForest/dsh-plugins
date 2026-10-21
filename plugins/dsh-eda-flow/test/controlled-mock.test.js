import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Flow} from '../src/service.js';
import {runLayoutPython,checkFreeze,reviewElectrical,libraryConfig} from '../src/controlled-layout.js';
import {mockEvidence} from '../src/mock-datasheets.js';
import {r6Design,r6Layout} from './r6-fixture.js';

for(const integratedInterface of [false,true])test(`complete mock display uses frozen native resources and only controlled tools; real CAD, BOM, PDF and archive; integrated interface=${integratedInterface}`,async t=>{
 const dir=process.env.MOCK_CONTROLLED_OUTPUT?path.resolve(process.env.MOCK_CONTROLLED_OUTPUT):await fs.mkdtemp(path.join(os.tmpdir(),'controlled-mock-'));
 if(!process.env.MOCK_CONTROLLED_OUTPUT)t.after(()=>fs.rm(dir,{recursive:true,force:true,maxRetries:5}));
 const config={workspaceRoot:dir,workDirectory:dir,kicadPython:'D:/anaconda/python.exe',kicadCli:'D:/Kicad/bin/kicad-cli.exe',allowModelCalls:true};
 const flow=new Flow(config);t.after(()=>flow.close());let p=await flow.create({caseId:'display-board',label:'模拟PDF显示板 · 受控全链路验证'});
 assert(p.controlledLayout);assert.equal(p.layoutEngine,'native-kicad');assert(!p.fixedLibrary);
 const requirements=[{id:'r6',description:'Preserve R6 documented circuit'}];
 const design=r6Design();
 // This fixture is a transparent test-model design from mock prose, never shipped as the demo answer.
 await fs.writeFile(path.join(dir,'fixture-design.json'),JSON.stringify(design,null,2));
 const finish={action:'finish',provider:'test-double',model:'controlled-mock-fixture',summary:'测试模型输入；宿主真实受控出图与核验',gaps:[],assumptions:[]};
 const layout=r6Layout();
 if(integratedInterface){
  layout.groups.find(g=>g.references.includes('D1')).references.push('DISP');
  layout.groups.find(g=>g.references.includes('U1')).references.push('C5','C6','C7');
  layout.groups=layout.groups.filter(g=>g.id!=='input');
  layout.groups=['infrared','driver','jumpers','display','process'].map(id=>layout.groups.find(g=>g.id===id));
 }
 flow.ai={async generateText(a){
  if(a.stage.id===2)return {...finish,requirements};
  if(a.stage.id===3){assert(!a.tools.some(t=>t.name==='design_blocks'));await assert.rejects(()=>a.invoke('design_blocks',{query:''}),/禁止读取历史CAD/);assert.equal(await a.validateFinish({...finish,design}),null);return {...finish,design};}
  assert(a.tools.every(t=>!t.name.startsWith('precise_')));
  await assert.rejects(()=>a.invoke('precise_apply',{}),/禁止/);
  await a.invoke('layout_inspect',{});
  if(a.stage.id===4){
   await assert.rejects(()=>a.invoke('layout_generate',{template:'generic-v1',paper:'A3-landscape',gapMm:12.7,nets:[]}),/不接受/);
   await a.invoke('layout_generate',layout);
  }
  await a.invoke('layout_verify',{});assert.equal(await a.validateFinish(finish),null);return finish;
 }};
 await flow.confirm({projectId:p.id,stage:1},'human');
 for(const stage of [2,3]){await flow.execute(p.id,stage);p=await flow.confirm({projectId:p.id,stage,allowDraft:true},'human');}
 const frozen=await checkFreeze(flow,p);const snapshot=JSON.parse(await fs.readFile(path.join(frozen.dir,'symbols.json'),'utf8'));
 const display=snapshot.symbols['Evidence:R6_Display'];
 assert.equal(display.appearance.digits,2);assert.equal(display.appearance.indicators,4);
 assert.equal((display.native.match(/\(arc /g)||[]).length,4);
 assert.equal((display.native.match(/\(polyline/g)||[]).length,2);
 const badEvidence=structuredClone(p.inputs.evidence);badEvidence.find(r=>r.id==='display-appearance').appearance.topPinOrder[0]='9';
 await assert.rejects(()=>runLayoutPython(flow,{engine:'native-kicad',operation:'lookup',...libraryConfig(flow),mockEvidence:badEvidence,kind:'symbol',query:'Evidence:R6_Display'},path.join(dir,'bad-appearance')),/each specified pin/);
 assert.equal(Object.keys(snapshot.symbols).length,41);assert.equal(display.provenance.simulated,true);
 const invalid=structuredClone(design);invalid.components[0].pins[0].name='BAD';await assert.rejects(()=>reviewElectrical(flow,p,invalid,path.join(dir,'bad-pins')),/pins differ|引脚|pin/);
 for(const stage of [4,5,7]){p=await flow.execute(p.id,stage);assert.equal(p.stages[stage-1].status,'done');await flow.confirm({projectId:p.id,stage,allowDraft:true},'human');}
 execFileSync(config.kicadPython,[fileURLToPath(new URL('./check-r6-straight-branches.py',import.meta.url)),path.join(p.lastValidLayout.project,'Circuit.kicad_sch')]);
 execFileSync(config.kicadPython,[fileURLToPath(new URL('./check-r6-link-stubs.py',import.meta.url)),path.join(p.lastValidLayout.project,'Circuit.kicad_sch')]);
 execFileSync(config.kicadPython,[fileURLToPath(new URL('./check-r6-receiver.py',import.meta.url)),path.join(p.lastValidLayout.project,'Circuit.kicad_sch')]);
  execFileSync(config.kicadPython,[fileURLToPath(new URL(integratedInterface?'./check-r6-receiver-interface.py':'./check-r6-input-filters.py',import.meta.url)),path.join(p.lastValidLayout.project,'Circuit.kicad_sch')]);
  execFileSync(config.kicadPython,[fileURLToPath(new URL('./check-r6-driver-power.py',import.meta.url)),path.join(p.lastValidLayout.project,'Circuit.kicad_sch')]);
  if(integratedInterface)execFileSync(config.kicadPython,[fileURLToPath(new URL('./check-r6-driver-inputs.py',import.meta.url)),path.join(p.lastValidLayout.project,'Circuit.kicad_sch')]);
  if(integratedInterface)execFileSync(config.kicadPython,[fileURLToPath(new URL('./check-r6-ground-label-faults.py',import.meta.url)),path.join(p.lastValidLayout.project,'Circuit.kicad_sch'),config.kicadCli]);
 assert.equal(p.lastValidLayout.electricalHash,frozen.hash);assert.equal(p.stages[3].result.erc.by_severity.error,0);
 assert.equal(p.stages[3].result.components.filter(c=>!String(c.reference||c.ref).startsWith('#PWR')).length,41);assert(p.stages[6].result.archive);
 const manifest=JSON.parse(await fs.readFile(path.join(p.stages[6].output,'input-provenance.json'),'utf8'));assert.equal(manifest.inputs.evidence.length,mockEvidence.length);
 await fs.writeFile(path.join(dir,'acceptance.json'),JSON.stringify({projectId:p.id,project:p.lastValidLayout.project,archive:path.join(p.stages[6].output,p.stages[6].result.archive),electricalHash:frozen.hash,result:p.stages[6].result,model:'test-double',realModelCalls:0},null,2));
 await flow.update({projectId:p.id,stage:1,inputs:{requirements:p.inputs.requirements+' 修改接口要求'}});p=await flow.open(p.id);await assert.rejects(()=>checkFreeze(flow,p),/尚未确认|变化/);
});
