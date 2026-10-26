import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Flow} from '../src/service.js';
import {checkFreeze,runLayoutPython,reviewElectrical} from '../src/controlled-layout.js';
import {designBlocks} from '../src/design-blocks.js';
import {readJSON} from '../src/io.js';
const config={javaPath:'D:/VisualBoard/tools/vendor/temurin21-jre/jdk-21.0.12.1+1-jre/bin/java.exe',kicadPython:'D:/anaconda/python.exe',kicadCli:'D:/Kicad/bin/kicad-cli.exe',kicadLibraryRoot:'D:/Kicad/share/kicad',allowModelCalls:true};
const fixture=JSON.parse(await fs.readFile(new URL('../libraries/blocks/power-decoupling.json',import.meta.url),'utf8'));
const requirements=[{id:'power',description:'保留并联去耦和电源接口'}];
const design={...fixture.design,functions:[{requirementId:'power',description:'去耦的两个网络分别连接且互相隔离',checks:[{kind:'connected',nodes:['J1.1','C1.1','C2.1']},{kind:'isolated',nodes:['J1.1','J1.2']}],limitations:['额定值与实物性能待验证']}]};
const finish={action:'finish',summary:'protocol test double',provider:'test-double',model:'fixture',gaps:[],assumptions:[]};


test('engineer review changes real PCB track width, retains versions and exports human review',async t=>{
 const dir=path.resolve('../pcb-validation');await fs.mkdir(dir,{recursive:true});
 const ai={async generateText(a){
  if(a.stage.id===2)return {...finish,requirements};
  if(a.stage.id===3)return {...finish,design};
  if(a.stage.id===6)return {...finish,pcb:{widthMm:40,heightMm:30,clearanceMm:0.25,trackWidthMm:a.request.stageNotes.includes('线宽改为0.4 mm')?0.4:0.3,componentGapMm:3,cornerRadiusMm:3,activeLayers:['B.Cu'],allowVias:false,assemblySides:{C1:'B.Cu',C2:'B.Cu'},order:['J1','C1','C2']}};
  await a.invoke('layout_inspect',{});
  if(a.stage.id===4)await a.invoke('layout_generate',{template:'generic-v1',paper:'A4-landscape',gapMm:7.62});
  await a.invoke('layout_verify',{});return finish;
 }};
 const flow=new Flow({...config,workspaceRoot:dir,workDirectory:dir},ai);t.after(()=>flow.close());
 const originalRun=flow.runProcess;flow.runProcess=async function(args,output,...rest){if(args[0].endsWith("pcb_flow.py"))await fs.writeFile(args[1],"%TSD-Header protected test export");return originalRun.call(this,args,output,...rest);};
 let p=await flow.create({label:'Engineer review integration '+Date.now(),designMode:'new-design'});
 await flow.update({projectId:p.id,stage:1,inputs:{requirements:'供电接口与两颗并联去耦电容，PCB矩形40x30mm、双层、线宽0.3mm、间距0.25mm。'}});
 await flow.confirm({projectId:p.id,stage:1},'human');
 for(const stage of [2,3,4,5]){await flow.execute(p.id,stage);await flow.confirm({projectId:p.id,stage,allowDraft:true},'human');}
 await flow.dispatch({action:'enable-pcb',projectId:p.id},null,'human');
 await flow.execute(p.id,6);p=await flow.load(p.id);
 assert.equal(p.stages[5].status,'done');assert.equal(p.stages[5].confirmed,false);
 assert.equal(p.stages[5].result.components,3);assert(p.stages[5].result.tracks>0);assert.equal(p.stages[5].result.drc.passed,true);
 assert.equal(p.stages[5].result.drc.parity,0);
 const nativeBoard=await fs.readFile(path.join(p.stages[5].output,p.stages[5].result.board),'utf8');assert(!nativeBoard.includes('(via\n'));assert(nativeBoard.includes('(gr_arc'));
 const beforeOutput=p.stages[5].output;
 const act=async args=>{const current=await flow.load(p.id);return flow.dispatch({projectId:p.id,expectedRevision:current.revision,...args},null,'human')};
 let q=await act({action:'review-add',stage:6,text:'线宽改为0.4 mm，保持器件参数和接法。',reviewer:'自动化测试用工程师'});
 const reviewId=q.engineeringReviews[0].id;await act({action:'review-apply',reviewId});
 await act({action:'execute',stage:6});await flow.jobs.get(p.id)?.promise;p=await flow.load(p.id);
 const reviewed=p.engineeringReviews[0];assert.equal(reviewed.status,'generated');assert.equal(p.stages[5].result.drc.passed,true);
 assert.equal(p.stages[5].plan.pcb.trackWidthMm,0.4);assert.notEqual(p.stages[5].output,beforeOutput);
 const afterBoard=await fs.readFile(path.join(p.stages[5].output,p.stages[5].result.board),'utf8');assert.match(afterBoard,/\(width 0\.4\)/);
 assert.equal(await fs.readFile(path.join(beforeOutput,'project/Circuit.kicad_pcb'),'utf8'),nativeBoard);
 await act({action:'review-decide',reviewId,decision:'resolved',note:'已核对新PCB线宽和DRC；仅确认本条测试意见。'});
 await flow.confirm({projectId:p.id,stage:6,allowDraft:true},'human');await flow.execute(p.id,7);
 p=await flow.load(p.id);const exported=await readJSON(path.join(p.stages[6].output,'project/engineering-review-history.json'));
 assert.equal(exported.reviews[0].status,'resolved');assert.equal(exported.reviews[0].attempts.length,1);
 await fs.mkdir(path.resolve('validation/round-0123'),{recursive:true});
 await fs.writeFile(path.resolve('validation/round-0123/integration-evidence.json'),JSON.stringify({test:'three-component non-display circuit',model:'test-double',cad:'actual KiCad and Freerouting',review:exported.reviews[0],drc:p.stages[5].result.drc,trackWidthMm:p.stages[5].plan.pcb.trackWidthMm,sourcePCBPreserved:true,reviewIncludedInDelivery:true},null,2));
 await fs.writeFile(path.join(dir,'latest.txt'),p.id+'\n'+p.stages[5].output+'\n'+p.stages[6].output);
});
