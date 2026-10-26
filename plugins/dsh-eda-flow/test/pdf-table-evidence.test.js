import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {Flow} from '../src/service.js';
import {electricalQuantities} from '../src/evidence-quantities.js';

test('uploaded datasheet table retains citable limits, units and conditions through the real process boundary',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'table-evidence-'));
  const flow=new Flow({workspaceRoot:root,workDirectory:root,kicadPython:'D:/anaconda/python.exe'});
  t.after(async()=>{await flow.close();await fs.rm(root,{recursive:true,force:true,maxRetries:5});});
  const file=path.join(root,'part.pdf');
  execFileSync('D:/anaconda/python.exe',['-X','utf8','-c',`import runpy,sys
from pathlib import Path
m=runpy.run_path('test/pdf-tables.test.py')
m['table_pdf'](Path(sys.argv[1]),[['Parameter','Min','Typ','Max','Unit','Test conditions'],['Output current','10','18','29','mA','VO=2V']])`,file],{windowsHide:true});
  const project=await flow.create({designMode:'new-design'});
  const attached=await flow.attach({projectId:project.id,stage:2,path:file,binding:'driver'});
  assert.equal(attached.uploads[0].tableCount,1);
  const row=attached.inputs.evidence.find(r=>r.sourceType==='pdf-table-extraction');
  assert(row);assert.equal(row.document,'part.pdf');assert.equal(row.page,1);
  const quantities=electricalQuantities(row.content).filter(q=>q.unit==='A').map(q=>q.value);
  for(const v of [.01,.018,.029])assert(quantities.some(q=>Math.abs(q-v)<1e-12),`Lost a table current ${v}`);
  assert.match(row.content,/Min=10 mA; Typ=18 mA; Max=29 mA/);
  assert.match(row.content,/Test conditions=VO=2V/);
  assert.equal(row.table.semanticRatingVerified,false);
  assert(attached.inputs.evidence.some(r=>r.sourceType==='pdf-text-extraction'&&r.content.includes('Absolute maximum ratings')));
});
