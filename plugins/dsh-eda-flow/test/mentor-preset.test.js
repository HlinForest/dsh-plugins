import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {Flow} from '../src/service.js';import {routes} from '../src/http.js';const mockEvidence=JSON.parse(await fs.readFile(new URL('../cases/display-board/mentor/specifications.json',import.meta.url),'utf8'));
test('mentor defaults use ordinary new-design DOCX extraction and can be replaced',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'mentor-flow-'));
 const flow=new Flow({workspaceRoot:root,workDirectory:root,kicadPython:'D:/anaconda/python.exe'});t.after(async()=>{await flow.close();await fs.rm(root,{recursive:true,force:true,maxRetries:5});});
 let p=await flow.create({label:'demo',designMode:'new-design',demoPreset:'display-board'});
 assert.equal(p.designMode,'new-design');assert.equal(p.caseId,null);assert.equal(p.uploads.length,1);
 const specs=p.inputs.evidence;assert.equal(specs.length,mockEvidence.length);
 assert(specs.every(r=>r.sourceType==='docx-text-extraction'));
 assert(!/bodyWidthMm|offsetMm|pinPresentation|EDA_SPEC_V1_BEGIN|symbolId|appearance/.test(JSON.stringify(p.inputs)));
 assert(specs.some(r=>r.content.includes('IRM-3638M3-X')));
 assert(!/MD50|Evidence:R6_|原位号|已确认/.test(JSON.stringify(p.inputs)));
 assert(!p.electricalFreeze);assert(!p.lastValidLayout);
 assert(p.inputs.evidence.every(r=>r.simulated===true&&r.pageIsPlaceholder===false));
 const endpoint=routes(flow).find(r=>r.name==='attachment');
 const response=await endpoint.run(new Request('http://localhost/attachment?'+new URLSearchParams({projectId:p.id,id:p.uploads[0].id})));
 assert.equal(response.headers.get('content-type'),'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
 assert.deepEqual(Buffer.from(await response.arrayBuffer()),await fs.readFile(p.uploads[0].path));
 await assert.rejects(()=>endpoint.run(new Request('http://localhost/attachment?'+new URLSearchParams({projectId:p.id,id:'missing'}))),/资料/);
 const blank=await flow.create({label:'blank',designMode:'new-design'});
 const copied=path.join(root,'manual.docx');await fs.copyFile(p.uploads[0].path,copied);
 const uploaded=await flow.attach({projectId:blank.id,stage:2,path:copied});
 assert.deepEqual(uploaded.inputs.evidence.map(r=>r.content),p.inputs.evidence.map(r=>r.content));
 p=await flow.update({projectId:p.id,stage:1,inputs:{requirements:'改为三位显示，重新核对器件选择'}});
 assert.match(p.inputs.requirements,/三位/);assert.equal(p.stages[1].confirmed,false);
});

