import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateDesign, validateRequirements } from '../src/design-intent.js';
import { Flow } from '../src/service.js';
import { invokePrecise } from '../src/precise-tools.js';
const requirements=[{id:'supply',description:'隔离供电接口与负载两端'}];
const pins=[{number:'1',name:'',type:'passive',pad:'1'},{number:'2',name:'',type:'passive',pad:'2'}];
const component=(id,ref)=>({id,ref,value:'1k',mpn:'',footprint:'Resistor_SMD:R_0603_1608Metric',librarySymbol:'Device:R',in_bom:true,on_board:true,dnp:false,pins:structuredClone(pins)});
const design={components:[component('source','R1'),component('load','R2')],nets:[{name:'A',nodes:['R1.1','R2.1']},{name:'B',nodes:['R1.2','R2.2']}],nc:[],functions:[{requirementId:'supply',description:'两端隔离及连接',checks:[{kind:'connected',nodes:['R1.1','R2.1']},{kind:'isolated',nodes:['R1.1','R1.2']}],limitations:['电流能力未验证']}],unresolved:[]};
test('design contract rejects missing coverage, duplicate nodes and implicit pin swaps',()=>{
 assert.equal(validateRequirements({requirements}),null);assert.deepEqual(validateDesign(design,requirements),[]);
 const deferred=structuredClone(design);deferred.functions[0].checks=[];assert.deepEqual(validateDesign(deferred,requirements),[]);deferred.functions[0].limitations=[];assert(validateDesign(deferred,requirements).length);
 for(const mutate of [d=>d.components.push(d.components[0]),d=>d.nc.push('R1.1'),d=>d.functions=[],d=>d.components[0].pins[0].pad='2',d=>d.nets[0].nodes.pop()]) {
  const d=structuredClone(design);mutate(d);assert(validateDesign(d,requirements).length);
 }
});
test('new design does not load reconstruction task; changes invalidate downstream and release remains draft',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'new-design-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const flow=new Flow({workspaceRoot:root,workDirectory:root});
 let p=await flow.create({designMode:'new-design',caseId:'display-board'});
 assert(p.inputs.requirements.length<500);assert(!p.inputsBundle);assert.equal(p.designMode,'new-design');
 const old=await flow.create({label:'reconstruction',caseId:'display-board',designMode:'reconstruction'});assert(old.inputs.requirements.length>40000);
 p.stages[6].status='done';p.stages[6].result={consistency:{releaseReady:false}};await flow.save(p);
 await assert.rejects(flow.confirm({projectId:p.id,stage:7},'human'),/不能确认生产交付/);
 await flow.update({projectId:p.id,stage:1,inputs:{requirements:'改成3.3V'}});
 assert.notEqual((await flow.load(p.id)).stages[6].status,'done');
});
test('actual KiCad CAD/XML/BOM audit catches value, assembly, net and footprint mismatches',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'new-design-cad-'));t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:5}));
 const config={workspaceRoot:root,kicadPython:'D:/anaconda/python.exe',kicadCli:'D:/Kicad/bin/kicad-cli.exe'};
 const call=(name,args)=>invokePrecise(config,root,name,args);
 await call('precise_create',{request_key:'create',name:'Fixture'});
 const items=design.components.map((c,i)=>({id:c.id,kind:'component',symbol:'R',reference:c.ref,value:c.value,footprint:c.footprint,at:[25.4+i*25.4,25.4],properties:[{name:'DesignId',value:c.id,at:[25.4,20.32],visible:false},{name:'MPN',value:c.mpn,at:[25.4,20.32],visible:false}]}));
 await call('precise_apply',{request_key:'apply',symbols:[{name:'R',pins:pins.map((p,i)=>({...p,pad:undefined,at:[0,i* -5.08,0],length:2.54}))}],items:[...items,{id:'a',kind:'wire',points:[[25.4,25.4],[50.8,25.4]]},{id:'b',kind:'wire',points:[[25.4,30.48],[50.8,30.48]]}]});
 await call('precise_check_export',{request_key:'export',formats:['netlist','bom']});
 const script=fileURLToPath(new URL('../mcp/design_audit.py',import.meta.url));
 const audit=async d=>{await fs.writeFile(path.join(root,'audit.json'),JSON.stringify({operation:'audit',libraryRoot:'D:/Kicad/share/kicad',project:root,design:d}));execFileSync(config.kicadPython,[script,path.join(root,'audit.json'),path.join(root,'report.json')],{env:{...process.env,PYTHONUTF8:'1'}});return JSON.parse(await fs.readFile(path.join(root,'report.json'),'utf8'));};
 const result=await audit(design);assert.deepEqual(result.errors,[]);assert.equal(result.purchaseRows,2);assert.equal(result.releaseReady,false);assert.equal(result.functions[0].status,'pending');assert.equal(result.functions[0].connectionStatus,'passed');
 for(const [category,mutate] of [['attributes',d=>d.components[0].value='2k'],['assembly',d=>d.components[0].dnp=true],['nets',d=>{d.nets[0].nodes[1]='R2.2';d.nets[1].nodes[1]='R2.1';}],['footprint',d=>d.components[0].footprint='Package_DIP:DIP-8_W7.62mm']]) {
  const d=structuredClone(design);mutate(d);assert((await audit(d)).errors.some(e=>e.category===category),category);
 }
});

test('legacy new-design export remains compatible with immutable tool results',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'new-design-frozen-'));t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:5}));
 const config={workspaceRoot:root,workDirectory:root,allowModelCalls:true,kicadPython:'D:/anaconda/python.exe',kicadCli:'D:/Kicad/bin/kicad-cli.exe'};
 const mcp={open:project=>({tools:[],close(){},invoke:async(name,args)=>Object.freeze(await invokePrecise(config,project,name,args))})};
 const finish={action:'finish',summary:'test fixture',gaps:[],assumptions:[]};
 const ai={async generateText({stage,invoke,validateFinish}){
   if(stage.id===2)return {...finish,requirements};
   if(stage.id===3)return {...finish,design};
   await invoke('precise_create',{request_key:'create',name:'Frozen'});
   await invoke('precise_apply',{request_key:'apply',symbols:[{name:'R',pins:pins.map((p,i)=>({number:p.number,name:p.name,type:p.type,at:[0,-i*5.08,0],length:2.54}))}],items:[...design.components.map((c,i)=>({id:c.id,kind:'component',symbol:'R',reference:c.ref,value:c.value,footprint:c.footprint,at:[25.4+i*25.4,25.4],properties:[{name:'DesignId',value:c.id,at:[25.4,20.32],visible:false},{name:'MPN',value:c.mpn,at:[25.4,20.32],visible:false}]})),{id:'a',kind:'wire',points:[[25.4,25.4],[50.8,25.4]]},{id:'b',kind:'wire',points:[[25.4,30.48],[50.8,30.48]]}]});
   await invoke('precise_read',{include_objects:true});
   const result=await invoke('precise_check_export',{request_key:'check',formats:['netlist','bom','erc','pdf','svg']});
   assert.deepEqual(result.designConsistency.errors,[]);assert.equal(await validateFinish(finish),null);return finish;
 }};
 const flow=new Flow(config,ai,mcp);let p=await flow.create({designMode:'new-design',caseId:'display-board'});
 // Existing projects retain their saved legacy execution mode.
 p.controlledLayout=false;delete p.layoutEngine;await flow.save(p);
 await flow.confirm({projectId:p.id,stage:1},'human');
 for(const stage of [2,3]) {await flow.execute(p.id,stage);await flow.confirm({projectId:p.id,stage,allowDraft:true},'human');}
 p=await flow.execute(p.id,4);assert.equal(p.stages[3].status,'done');assert.deepEqual(p.stages[3].result.consistency.errors,[]);
});
