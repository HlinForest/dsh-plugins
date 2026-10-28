import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const {Flow}=await import(process.env.EDA_TEST_SERVICE||'../src/service.js');

test('stage 2 cannot finish while an explicit source capacitor combination is omitted',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'application-coverage-'));
  const quote='The application circuit uses a 22 uF reservoir capacitor and a 100 nF bypass capacitor.';
  let attempts=0;
  const flow=new Flow({workspaceRoot:root,workDirectory:root,kicadPython:'D:/anaconda/python.exe',allowModelCalls:true},{
    async generateText(a){
      const source=a.request.inputs.evidence.find(r=>r.content===quote);
      const bad={action:'finish',summary:'Extracted application',requirements:[{id:'filter',description:'Design a supply filter.'}],
        gaps:[],assumptions:['Capacitance is not specified.']};
      attempts++;
      assert.match(await a.validateFinish(bad),/22 uF/);
      const good={...bad,assumptions:[],guidance:[{subject:'Driver supply',category:'peripheral',statement:quote,citations:[{sourceId:source.id,quote}]}]};
      attempts++;
      assert.equal(await a.validateFinish(good),null);
      return good;
    }
  });
  t.after(async()=>{await flow.close();await fs.rm(root,{recursive:true,force:true,maxRetries:5});});
  const p=await flow.create({designMode:'new-design'});
  await flow.update({projectId:p.id,stage:1,inputs:{requirements:'Design a supply filter.',datasheetText:quote}});
  await flow.confirm({projectId:p.id,stage:1},'human');
  const result=await flow.execute(p.id,2);
  assert.equal(result.stages[1].status,'done');
  assert.equal(attempts,2,'The real finish gate accepted the omitted capacitor combination');
  assert(result.stages[1].result.applicationCoverage.every(row=>row.covered));
});
