import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Flow} from '../src/service.js';
import {checkFreeze,runLayoutPython,reviewElectrical} from '../src/controlled-layout.js';
import {designBlocks} from '../src/design-blocks.js';
import {requestMetrics} from '../src/input-metrics.js';
const config={kicadPython:'D:/anaconda/python.exe',kicadCli:'D:/Kicad/bin/kicad-cli.exe',kicadLibraryRoot:'D:/Kicad/share/kicad',allowModelCalls:true};
const fixture=JSON.parse(await fs.readFile(new URL('../libraries/blocks/power-decoupling.json',import.meta.url),'utf8'));
const requirements=[{id:'power',description:'保留并联去耦和电源接口'}];
const design={...fixture.design,functions:[{requirementId:'power',description:'去耦的两个网络分别连接且互相隔离',checks:[{kind:'connected',nodes:['J1.1','C1.1','C2.1']},{kind:'isolated',nodes:['J1.1','J1.2']}],limitations:['额定值与实物性能待验证']}]};
const finish={action:'finish',summary:'protocol test double',provider:'test-double',model:'fixture',gaps:[],assumptions:[]};

test('both entries use native freeze; real CLI validates layout; raw mutations and missing confirmation are blocked',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'generic-flow-'));t.after(()=>fs.rm(dir,{recursive:true,force:true,maxRetries:5}));
 const ai={async generateText(a){
  if(a.stage.id===2)return {...finish,requirements};
  if(a.stage.id===3){assert.equal(await a.validateFinish({...finish,design}),null);return {...finish,design};}
  assert(a.tools.every(t=>!t.name.startsWith('precise_')));
  await assert.rejects(()=>a.invoke('precise_apply',{nets:[]}),/禁止/);
  const frozen=await a.invoke('layout_inspect',{});assert.equal(frozen.template,'generic-v1');
  if(a.stage.id>4){
   assert(!a.tools.some(t=>t.name==='layout_generate'));
   await assert.rejects(()=>a.invoke('layout_generate',{template:'generic-v1',paper:'A4-landscape',gapMm:7.62}),/禁止/);
   await a.invoke('layout_verify',{});assert.equal(await a.validateFinish(finish),null);return finish;
  }
  await assert.rejects(()=>a.invoke('layout_generate',{template:'generic-v1',paper:'A4-landscape',gapMm:7.62,nc:[]}),/不接受/);
  const report=await a.invoke('layout_generate',{template:'generic-v1',paper:'A4-landscape',gapMm:7.62});assert.equal(report.status,'passed');
  await a.invoke('layout_verify',{});assert.equal(await a.validateFinish(finish),null);return finish;
 }};
 const flow=new Flow({...config,workspaceRoot:dir,workDirectory:dir},ai);t.after(()=>flow.close());
 let p=await flow.create({label:'ordinary requirements',designMode:'new-design'});assert.equal(p.layoutEngine,'native-kicad');assert(!p.fixedLibrary);assert.equal(p.inputs.requirements,'');
 await flow.update({projectId:p.id,stage:1,inputs:{requirements:'设计一个供电接口，带两颗并联去耦电容。'}});await flow.confirm({projectId:p.id,stage:1},'human');
 await flow.execute(p.id,2);await flow.confirm({projectId:p.id,stage:2},'human');await flow.execute(p.id,3);
 p=await flow.load(p.id);await assert.rejects(()=>checkFreeze(flow,p),/尚未确认/);
 p=await flow.confirm({projectId:p.id,stage:3,allowDraft:true},'human');const before=await checkFreeze(flow,p);
 p=await flow.execute(p.id,4);assert.equal(p.stages[3].status,'done');assert.equal(p.lastValidLayout.electricalHash,before.hash);assert.equal(p.stages[3].planOrigin,'test-double');
 for(const stage of [5,7]){
  await flow.confirm({projectId:p.id,stage:stage===5?4:5,allowDraft:true},'human');
  p=await flow.execute(p.id,stage);assert.equal(p.stages[stage-1].status,'done');assert.equal(p.lastValidLayout.electricalHash,before.hash);
 }
 assert.equal(p.stages[6].confirmed,false);assert(p.stages[6].result.archive);
 const fixed=await flow.create({label:'fixed generic',designMode:'fixed-redesign',fixedParts:design.components.map(({ref,librarySymbol,value,footprint,mpn})=>({ref,librarySymbol,value,footprint,mpn}))});
 assert.equal(fixed.layoutEngine,'native-kicad');assert(!fixed.fixedLibrary);assert.equal(fixed.inputs.requirements,'');fixed.stages[1].plan={requirements};
 await reviewElectrical(flow,fixed,design,path.join(dir,'fixed-review'));
 const changed=structuredClone(design);changed.components[0].value='changed';await assert.rejects(()=>reviewElectrical(flow,fixed,changed,path.join(dir,'fixed-invalid')),/固定器件/);
 const invalid=structuredClone(p);invalid.stages[2].plan.design.nc.push('J1.1');await assert.rejects(()=>checkFreeze(flow,invalid),/变化/);
 await fs.appendFile(path.join(before.dir,'symbols.json'),' ');await assert.rejects(()=>checkFreeze(flow,p),/变化/);
});

test('catalog allowlist applies to both discovery and exact lookup; missing catalog fails closed',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'generic-catalog-'));t.after(()=>fs.rm(dir,{recursive:true,force:true,maxRetries:5}));
 const catalog=path.join(dir,'allowed.json');await fs.writeFile(catalog,JSON.stringify({schema:1,symbols:['Device:C'],footprints:[]}));
 const flow=new Flow({...config,workspaceRoot:dir,workDirectory:dir});let i=0;
 const lookup=(kind,query,file=catalog)=>runLayoutPython(flow,{engine:'native-kicad',operation:'lookup',libraryRoot:config.kicadLibraryRoot,catalogFile:file,kind,query},path.join(dir,'q'+i++));
 assert.deepEqual((await lookup('search','Device')).matches,[{kind:'symbol',id:'Device:C'}]);
 await assert.rejects(()=>lookup('symbol','Device:R'),/Outside approved catalog/);
 await assert.rejects(()=>lookup('search','Device',path.join(dir,'missing.json')),/No such file/);
 await assert.rejects(()=>lookup('symbol','Device:..\/x'),/Outside approved catalog/);
});

test('design blocks use distinct internal names and forbid implicit net merging',async()=>{
 const a=await designBlocks({action:'instantiate',id:'power-decoupling',prefix:'A'}),b=await designBlocks({action:'instantiate',id:'power-decoupling',prefix:'B'});
 assert(!a.components.some(c=>b.components.some(x=>x.ref===c.ref)));assert(!a.nets.some(n=>b.nets.some(x=>x.name===n.name)));
 await assert.rejects(()=>designBlocks({action:'instantiate',id:'power-decoupling',prefix:'A',externalNets:{VCC:'X',GND:'X'}}),/不同网络/);
 assert.equal((await designBlocks({action:'read',id:'power-decoupling'})).validation.hardwareTest,'not-run');
});

test('input metrics distinguish UTF-8 material bytes from characters and tokens',()=>{
 const r=requestMetrics({event:'request',system:'中文',messages:[{content:[{type:'text',text:JSON.stringify({request:{inputs:{requirements:'电源'}}})}]}]});
 assert.equal(r.inputMetrics.system,6);assert.match(r.inputMetrics.unit,/not tokens/);
});
