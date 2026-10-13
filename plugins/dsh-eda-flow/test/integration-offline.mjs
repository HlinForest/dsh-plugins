// Test double only. This file is excluded from the installable plugin.
// Exercises actual KiCad tools and two empty directories, never a paid model.
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { Flow } = await import(process.argv[5] ? pathToFileURL(process.argv[5]).href : '../src/service.js');
import { readJSON, writeJSON } from '../src/io.js';
const root=path.resolve(process.argv[2]);await fs.mkdir(root,{recursive:true});
const flow=new Flow({workspaceRoot:root,workDirectory:root,kicadPython:process.argv[3],kicadCli:process.argv[4],allowModelCalls:true}, {
  async generate({stage,record}) {
    await record({event:'request',provider:'test-double',model:'OFFLINE-INTEGRATION-FIXTURE'});
    return {version:1,executor:'structured',summary:'离线工具链测试：'+stage.title,assumptions:[],gaps:[],provider:'test-double',model:'OFFLINE-INTEGRATION-FIXTURE'};
  }
});
try {
 const p=await flow.create({caseId:'display-board',label:'显示板 · 离线工具链验证'});
 for(let stage=1;stage<=7;stage++){console.log('STAGE',stage);await flow.execute(p.id,stage);await flow.confirm({projectId:p.id,stage,allowDraft:true},'human');}
 const project=await flow.open(p.id);const result=await readJSON(path.join(project.stages[6].output,'result.json'));
 if(!result.comparison.equal)throw new Error('Reference differences '+JSON.stringify(result.comparison));
 if(project.stages[6].gaps.some(g=>g.startsWith('ERC：82')))throw new Error('Superseded partial ERC result survived final check');
 console.log('REPLAY');const replay=await flow.replay(p.id);if(!replay.match)throw new Error('Replay differs');
 const report={projectId:p.id,stage7:project.stages[6].output,reference:result.comparison,replay,paidModelRequests:0,modelValidation:'test-double only; real provider pending intranet',generatedProject:path.join(project.stages[6].output,'project')};
 await writeJSON(path.join(root,'verification.json'),report);console.log(JSON.stringify(report));
}finally{await flow.close();}
