import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {extractFacts,sourceEvidence,resolveDesignFacts} from '../src/specification-facts.js';
import {Flow} from '../src/service.js';
import {validateSourceInventory} from '../src/source-inventory.js';

const text='U7 IR-TEST 引脚1=OUT(output)，2=GND(power_in)，3=VCC(power_in)。电源5V。';
const inputs={evidence:[{id:'page-1',document:'parts.pdf',page:3,content:text,simulated:false}]};
const fact={reference:'U7',value:'IR-TEST',componentKind:'infrared-receiver',objectRole:'electrical',
  pins:[{number:'1',name:'OUT',type:'output'},{number:'2',name:'GND',type:'power_in'},{number:'3',name:'VCC',type:'power_in'}],
  citations:[{sourceId:'page-1',quote:text}]};

test('assigned reference inherits uniquely selected source-symbol metadata',()=>{
  const row={...extractFacts({componentFacts:[fact]},inputs)[0],reference:'',originalFootprint:'VENDOR-PACKAGE',assemblyType:'THT'};
  const p={inputs:{evidence:[]},stages:[{id:2,status:'done',result:{evidenceFacts:[row]}}]};
  const design=resolveDesignFacts({components:[{ref:'RX1',librarySymbol:row.symbolId,value:row.value}]},p);
  assert.equal(design.components[0].originalFootprint,'VENDOR-PACKAGE');
  assert.equal(design.components[0].assemblyType,'THT');
  assert.equal(design.components[0].objectRole,'electrical');
  design.components.push({ref:'R1',librarySymbol:'Device:R',value:'10k',pins:[{number:'1',name:'1',type:'passive'},{number:'2',name:'2',type:'passive'}]});
  assert.deepEqual(validateSourceInventory(design,[row]),[], 'a specified key part can coexist with a standard library part');
  design.components[0].originalFootprint='wrong';
  assert(validateSourceInventory(design,[row]).some(e=>e.includes('originalFootprint')));
});
test('fact extraction rejects drawing geometry, missing citations and invented pins',()=>{
  const rows=extractFacts({componentFacts:[fact]},inputs);
  assert.equal(rows[0].page,3);assert.equal(rows[0].simulated,false);
  assert(!('appearance' in rows[0]));
  assert.throws(()=>extractFacts({componentFacts:[{...fact,offsetMm:2.54}]},inputs),/绘图/);
  assert.throws(()=>extractFacts({componentFacts:[{...fact,citations:[{sourceId:'page-1',quote:'This was never in the document'}]}]},inputs),/原文/);
  assert.throws(()=>extractFacts({componentFacts:[{...fact,pins:[{number:'99',name:'BOGUS',type:'output'}]}]},inputs),/不存在/);
  assert.equal(sourceEvidence({inputs,stages:[{id:2,status:'invalid',result:{evidenceFacts:rows}}]}).length,1);
});
test('confirmed facts expand into design records without hiding conflicting model overrides',()=>{
 const evidenceFacts=extractFacts({componentFacts:[fact]},inputs);
 const project={inputs,stages:[{id:2,status:'done',result:{evidenceFacts}}]};
 const design=resolveDesignFacts({components:[{sourceFactId:evidenceFacts[0].id}]},project);
 assert.equal(design.components[0].ref,'U7');assert.equal(design.components[0].pins[2].pad,'3');
 assert.equal(design.components[0].value,'IR-TEST');assert(!('sourceFactId' in design.components[0]));
 assert.equal(resolveDesignFacts({components:[{sourceFactId:evidenceFacts[0].id,value:'WRONG'}]},project).components[0].value,'WRONG');
 assert.throws(()=>resolveDesignFacts({components:[{sourceFactId:'missing'}]},project),/未知/);
});
test('PDF facts are collected incrementally, remain separate from inputs and invalidate with upstream edits',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'fact-workflow-'));
 const pdf=path.join(root,'receiver.pdf');
 const pdfText='Reference D1, part IRM-3638M3-X. Pin 1 OUT output, pin 2 GND power_in, pin 3 VCC power_in. Supply 5V.';
 execFileSync('D:/anaconda/python.exe',['-c','import pymupdf,sys; d=pymupdf.open(); p=d.new_page(); p.insert_text((40,40),sys.argv[2]); d.save(sys.argv[1])',pdf,pdfText],{windowsHide:true});
 const flow=new Flow({workspaceRoot:root,workDirectory:root,allowModelCalls:true,kicadPython:'D:/anaconda/python.exe'},{
  async generateText(args){
   const finish={action:'finish',summary:'test extraction',gaps:[],assumptions:[],requirements:[{id:'receiver',description:'receiver'}]};
   assert.match(await args.validateFinish(finish),/componentFacts/);
   const page=args.request.inputs.evidence.find(r=>r.content.includes('D1'));
   const item={...fact,reference:'D1',value:'IRM-3638M3-X',citations:[{sourceId:page.id,quote:page.content}]};
   assert.deepEqual(await args.invoke('spec_record_facts',{componentFacts:[item]}),{accepted:['D1'],total:1});
   assert.equal(await args.validateFinish(finish),null);return finish;
  }
 });
 t.after(async()=>{await flow.close();await fs.rm(root,{recursive:true,force:true,maxRetries:5});});
 let p=await flow.create({label:'facts',designMode:'new-design'});
 await flow.update({projectId:p.id,stage:1,inputs:{requirements:'根据接收器规格书整理器件事实。'}});
 await flow.confirm({projectId:p.id,stage:1,allowDraft:true},'human');
 p=await flow.attach({projectId:p.id,stage:2,path:pdf,binding:'receiver'});
 p=await flow.execute(p.id,2);
 assert.equal(p.stages[1].result.evidenceFacts.length,1);
 assert(p.inputs.evidence.every(r=>r.sourceType==='pdf-text-extraction'));
 assert(p.stages[1].result.evidenceFacts.every(r=>r.sourceType==='model-specification-fact'));
 assert(sourceEvidence(p).some(r=>r.sourceType==='model-specification-fact'));
 p=await flow.update({projectId:p.id,stage:2,inputs:{stageNotes:{2:'重新核对接收器'}}});
 assert(!sourceEvidence(p).some(r=>r.sourceType==='model-specification-fact'));
});
test('fact-only source generates grid-aligned symbols without source dimensions or display-board identities',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'fact-symbols-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true,maxRetries:5}));
  const rows=extractFacts({componentFacts:[fact]},inputs);
  await fs.writeFile(path.join(dir,'facts.json'),JSON.stringify(rows));
  const script=`import sys,json\nfrom pathlib import Path\nsys.path.insert(0,'mcp')\nfrom evidence_symbols import build\nfrom native_resources import parse\nfrom design_audit import children,child,symbol_evidence\nr=json.load(open(sys.argv[1],encoding='utf8'))\nassert symbol_evidence(None,r[0]['symbolId'],r)['simulated'] is False\nr[0]['simulated']=True\nassert symbol_evidence(None,r[0]['symbolId'],r)['simulated'] is True\nr[0]['simulated']=False\ns=build(r[0]['symbolId'],r,Path('D:/Kicad/share/kicad'))\na=parse(s['native']);pins=[p for u in children(a,'symbol') for p in children(u,'pin')]\nassert len(pins)==3\nfor p in pins:\n for v in child(p,'at')[1:3]: assert abs(float(v)/2.54-round(float(v)/2.54))<0.00001\nassert {child(p,'number')[1] for p in pins}=={'1','2','3'}\nassert s['drawingRules']['origin']=='functional-symbol-generator'\n# A different type and pin count uses the same pipeline and installed library.\nr[0].update(componentKind='resistor',pins=[{'number':'1','name':'1','type':'passive'},{'number':'2','name':'2','type':'passive'}])\ns=build(r[0]['symbolId'],r,Path('D:/Kicad/share/kicad'))\nassert s['drawingRules']['librarySymbol']=='Device:R_US'\nprint('passed')`;
  assert.match(execFileSync('D:/anaconda/python.exe',['-c',script,path.join(dir,'facts.json')],{encoding:'utf8',windowsHide:true}),/passed/);
});
