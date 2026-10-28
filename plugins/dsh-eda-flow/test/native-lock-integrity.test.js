import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Flow } from '../src/service.js';
import { tree, hash } from '../src/io.js';
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'eda-native-lock-'));
 const flow=new Flow({workspaceRoot:root,workDirectory:root,allowModelCalls:false});
 t.after(async()=>{await flow.close();await fs.rm(root,{recursive:true,force:true});});
 const made=await flow.create({label:'Native project lock'});const project=await flow.load(made.id);const s=project.stages[3];
 s.output=path.join(flow.dir(project.id),'steps','4','fixture');await fs.mkdir(s.output,{recursive:true});
 await fs.writeFile(path.join(s.output,'Circuit.kicad_sch'),'(kicad_sch)');
 s.files=await tree(s.output);s.outputHash=hash(s.files);s.status='done';s.confirmed=true;
 await flow.save(project);return {flow,project,s};
}
test('native CAD session lock cannot invalidate the unchanged design or block review',async t=>{
 const {flow,project,s}=await fixture(t);await fs.writeFile(path.join(s.output,'~Circuit.kicad_pro.lck'),'temporary CAD session');
 let opened=await flow.open(project.id);assert.equal(opened.stages[3].status,'done');assert.equal(opened.stages[3].confirmed,true);
 await fs.appendFile(path.join(s.output,'Circuit.kicad_sch'),'changed');opened=await flow.open(project.id);assert.equal(opened.stages[3].status,'stale');assert.equal(opened.stages[3].confirmed,false);
});
test('a prior lock-only invalidation recovers an exactly matching output but never restores approval',async t=>{
 const {flow,project,s}=await fixture(t);flow.invalidate(project,4,{kind:'output-files',from:4,files:[{path:'~Circuit.kicad_pro.lck',kind:'added'}]});await flow.save(project);
 const opened=await flow.open(project.id);assert.equal(opened.stages[3].status,'done');assert.equal(opened.stages[3].confirmed,false);assert.equal(opened.stages[4].status,'pending');
});
test('recovery still rejects changed design bytes and non-CAD lock-named documents',async t=>{
 const {flow,project,s}=await fixture(t);flow.invalidate(project,4,{kind:'output-files',from:4,files:[{path:'~Circuit.kicad_pro.lck',kind:'added'}]});await flow.save(project);
 await fs.appendFile(path.join(s.output,'Circuit.kicad_sch'),'changed');assert.equal((await flow.open(project.id)).stages[3].status,'stale');
 await fs.writeFile(path.join(s.output,'notes.lck'),'source document');assert((await tree(s.output)).some(r=>r.path==='notes.lck'));
});
