import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { Flow } from '../src/service.js';
import { textInputRecord } from '../frontend/textFlow.js';
const python = 'D:/anaconda/python.exe';
function makePDF(file, text, blank = false) {
  execFileSync(python, ['-c', 'import pymupdf,sys; d=pymupdf.open(); p=d.new_page(); p.insert_text((40,40),sys.argv[2]); d.new_page() if sys.argv[3]=="1" else None; d.save(sys.argv[1])', file, text, blank ? '1' : '0'], {windowsHide:true});
}
test('real PDF pages reach the model; replacement invalidates requirements and preserves snapshots', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pdf-flow-'));
  const calls = [];
  const flow = new Flow({workspaceRoot:root, workDirectory:root,kicadPython:python,allowModelCalls:true}, {
    async generateText(a) { calls.push(a.request); return {action:'finish',summary:'read sources',requirements:[{id:'R1',description:'RC filter'}],gaps:[],assumptions:[]}; },
  });
  t.after(async()=>{await flow.close();await fs.rm(root,{recursive:true,force:true,maxRetries:5});});
  let p = await flow.create({designMode:'new-design'});
  await flow.update({projectId:p.id,stage:1,inputs:{requirements:'Design an RC input filter.'}});
  await flow.confirm({projectId:p.id,stage:1},'human');
  const file=path.join(root,'filter.pdf');makePDF(file,'Input 3.3V. R = 10 kohm. C = 100 nF.');
  p=await flow.attach({projectId:p.id,stage:2,path:file,binding:'filter'});
  const old=p.uploads[0].path, oldBytes=await fs.readFile(old);
  assert.equal(p.uploads[0].readable,true);
  assert.equal(p.inputs.evidence[0].page,1);assert.equal(p.inputs.evidence[0].simulated,false);
  await flow.execute(p.id,2);await flow.confirm({projectId:p.id,stage:2},'human');
  const stage2 = (await flow.load(p.id)).stages[1];
  const sources = JSON.parse(await fs.readFile(path.join(stage2.output,'pdf-sources.json'),'utf8'));
  assert.deepEqual(await fs.readFile(path.join(stage2.output,sources[0].snapshot)),oldBytes);
  assert.match(calls[0].inputs.evidence[0].content,/100 nF/);
  assert(!calls[0].inputs.evidence.some(r=>/TM1616|MD50PG/.test(r.content)));
  assert.match(textInputRecord(await flow.open(p.id)),/PDF 提取正文/);
  makePDF(file,'Input 3.3V. R = 22 kohm. C = 47 nF.');
  p=await flow.attach({projectId:p.id,stage:3,path:file,binding:'filter'});
  assert.equal(p.uploads.length,1);assert.equal(p.inputs.evidence.length,1);
  assert.equal(p.stages[1].confirmed,false);assert.equal(p.stages[1].status,'stale');
  assert.deepEqual(await fs.readFile(old),oldBytes);
  assert.match(p.inputs.evidence[0].content,/47 nF/);
  await flow.execute(p.id,2);await flow.confirm({projectId:p.id,stage:2},'human');
  p=await flow.update({projectId:p.id,stage:3,inputs:{datasheetText:'Use 1% resistor.'}});
  assert.equal(p.stages[1].status,'stale');
  await fs.appendFile(p.uploads[0].path,'changed after extraction');
  const count=calls.length;
  await assert.rejects(flow.execute(p.id,2),/资料已变化/);
  p=await flow.load(p.id);
  assert.equal(p.stages[1].status,'failed');assert.equal(calls.length,count);
  assert.match(p.stages[1].error,/资料已变化/);
});
test('mixed text and scanned pages remain individually traceable, with unreadable pages explicit', async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'pdf-mixed-'));const flow=new Flow({workspaceRoot:root,workDirectory:root,kicadPython:python});
  t.after(async()=>{await flow.close();await fs.rm(root,{recursive:true,force:true,maxRetries:5});});
  const p=await flow.create({designMode:'new-design'}),file=path.join(root,'mixed.pdf');
  makePDF(file,'Supply 5V.',true);
  const q=await flow.attach({projectId:p.id,stage:2,path:file});
  assert.equal(q.uploads[0].readable,false);assert.deepEqual(q.uploads[0].unreadablePages,[2]);
  assert.equal(q.inputs.evidence.length,2);assert.equal(q.inputs.evidence[1].content,'');
  assert.match(textInputRecord(q),/第2页.*\n本页没有可提取文字/);
});

for (const acrossPages of [false, true]) test(`ordinary application text surrounding a specification appendix reaches project evidence (${acrossPages ? 'split pages' : 'one page'})`, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pdf-application-'));
  const flow = new Flow({workspaceRoot:root,workDirectory:root,kicadPython:python});
  t.after(async()=>{await flow.close();await fs.rm(root,{recursive:true,force:true,maxRetries:5});});
  const p = await flow.create({designMode:'new-design'}), file=path.join(root,'source.pdf');
  const before='Supply filtering: place one 47 nF capacitor near the receiver.';
  const after='Output bias: use an external 22 kohm pull-up when required.';
  const appendix='EDA_SPEC_V1_BEGIN\n{"content":"Receiver interface specification."}\nEDA_SPEC_V1_END';
  const pages=acrossPages ? [before+'\nEDA_SPEC_V1_BEGIN\n{"content":', '"Receiver interface specification."}\nEDA_SPEC_V1_END\n'+after] : [before+'\n'+appendix+'\n'+after];
  execFileSync(python,['-c','import json,pymupdf,sys; d=pymupdf.open(); [(lambda p,s:p.insert_text((40,40),s))(d.new_page(),s) for s in json.loads(sys.argv[2])]; d.save(sys.argv[1])',file,JSON.stringify(pages)],{windowsHide:true});
  const q=await flow.attach({projectId:p.id,stage:2,path:file});
  const textPages=q.inputs.evidence.filter(r=>r.sourceType==='pdf-text-extraction');
  assert(textPages[0].content.includes(before), 'Application requirement before appendix was dropped');
  assert(textPages.at(-1).content.includes(after), 'Application requirement after appendix was dropped');
  assert(!textPages.some(r=>r.content.includes('EDA_SPEC_V1_BEGIN')));
  assert.equal(q.inputs.evidence.filter(r=>r.sourceType==='pdf-specification-appendix').length,1);
  assert.equal(q.inputs.evidence.find(r=>r.sourceType==='pdf-specification-appendix').page,1);
});

test('an unmatched appendix marker cannot erase ordinary PDF application text', async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'pdf-incomplete-'));
  const flow=new Flow({workspaceRoot:root,workDirectory:root,kicadPython:python});
  t.after(async()=>{await flow.close();await fs.rm(root,{recursive:true,force:true,maxRetries:5});});
  const p=await flow.create({designMode:'new-design'}),file=path.join(root,'incomplete.pdf');
  makePDF(file,'EDA_SPEC_V1_BEGIN\nSupply filtering: keep the local bypass near its load.');
  const q=await flow.attach({projectId:p.id,stage:2,path:file});
  assert.match(q.inputs.evidence[0].content,/keep the local bypass near its load/);
  assert.match(q.inputs.evidence[0].content,/EDA_SPEC_V1_BEGIN/);
});
