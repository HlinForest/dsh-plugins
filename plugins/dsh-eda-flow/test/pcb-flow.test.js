import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Flow} from '../src/service.js';
import {checkFreeze,runLayoutPython,reviewElectrical} from '../src/controlled-layout.js';
import {designBlocks} from '../src/design-blocks.js';
import {requestMetrics} from '../src/input-metrics.js';
const config={javaPath:'D:/VisualBoard/tools/vendor/temurin21-jre/jdk-21.0.12.1+1-jre/bin/java.exe',kicadPython:'D:/anaconda/python.exe',kicadCli:'D:/Kicad/bin/kicad-cli.exe',kicadLibraryRoot:'D:/Kicad/share/kicad',allowModelCalls:true};
const fixture=JSON.parse(await fs.readFile(new URL('../libraries/blocks/power-decoupling.json',import.meta.url),'utf8'));
const requirements=[{id:'power',description:'保留并联去耦和电源接口'}];
const design={...fixture.design,functions:[{requirementId:'power',description:'去耦的两个网络分别连接且互相隔离',checks:[{kind:'connected',nodes:['J1.1','C1.1','C2.1']},{kind:'isolated',nodes:['J1.1','J1.2']}],limitations:['额定值与实物性能待验证']}]};
const finish={action:'finish',summary:'protocol test double',provider:'test-double',model:'fixture',gaps:[],assumptions:[]};


test('actual schematic to PCB, Freerouting, DRC and complete delivery',async t=>{
 const dir=path.resolve('../pcb-validation');await fs.mkdir(dir,{recursive:true});
 const ai={async generateText(a){
  if(a.stage.id===2)return {...finish,requirements};
  if(a.stage.id===3)return {...finish,design};
  if(a.stage.id===6)return {...finish,pcb:{widthMm:40,heightMm:30,clearanceMm:0.25,trackWidthMm:0.3,componentGapMm:3,cornerRadiusMm:3,activeLayers:['B.Cu'],allowVias:false,assemblySides:{C1:'B.Cu',C2:'B.Cu'},order:['J1','C1','C2']}};
  await a.invoke('layout_inspect',{});
  if(a.stage.id===4)await a.invoke('layout_generate',{template:'generic-v1',paper:'A4-landscape',gapMm:7.62});
  await a.invoke('layout_verify',{});return finish;
 }};
 const flow=new Flow({...config,workspaceRoot:dir,workDirectory:dir},ai);t.after(()=>flow.close());
 const originalRun=flow.runProcess;flow.runProcess=async function(args,output,...rest){if(args[0].endsWith("pcb_flow.py"))await fs.writeFile(args[1],"%TSD-Header protected test export");return originalRun.call(this,args,output,...rest);};
 let p=await flow.create({label:'PCB integration '+Date.now(),designMode:'new-design'});
 await flow.update({projectId:p.id,stage:1,inputs:{requirements:'供电接口与两颗并联去耦电容，PCB矩形40x30mm、双层、线宽0.3mm、间距0.25mm。'}});
 await flow.confirm({projectId:p.id,stage:1},'human');
 for(const stage of [2,3,4,5]){await flow.execute(p.id,stage);await flow.confirm({projectId:p.id,stage,allowDraft:true},'human');}
 await flow.dispatch({action:'enable-pcb',projectId:p.id},null,'human');
 await flow.execute(p.id,6);p=await flow.load(p.id);
 assert.equal(p.stages[5].status,'done');assert.equal(p.stages[5].confirmed,false);
 assert.equal(p.stages[5].result.components,3);assert(p.stages[5].result.tracks>0);assert.equal(p.stages[5].result.drc.passed,true);
 assert.equal(p.stages[5].result.drc.parity,0);
 const nativeBoard=await fs.readFile(path.join(p.stages[5].output,p.stages[5].result.board),'utf8');assert(!nativeBoard.includes('(via\n'));assert(nativeBoard.includes('(gr_arc'));
 const valid=structuredClone(p.stages[5].result);
 p.stages[5].result.drc.passed=false;await flow.save(p);
 await assert.rejects(flow.confirm({projectId:p.id,stage:6,allowDraft:true},'human'),/DRC/);
 p.stages[5].result=valid;await flow.save(p);
 await flow.confirm({projectId:p.id,stage:6},'human');await flow.execute(p.id,7);
 p=await flow.load(p.id);assert(p.stages[6].files.some(f=>f.path.endsWith('.kicad_pcb')));
 await flow.execute(p.id,7);p=await flow.load(p.id);
 assert(p.stages[6].result.files.some(f=>f.path.endsWith('.kicad_pcb')));
 await fs.writeFile(path.join(dir,'latest.txt'),p.id+'\n'+p.stages[5].output+'\n'+p.stages[6].output);
});
