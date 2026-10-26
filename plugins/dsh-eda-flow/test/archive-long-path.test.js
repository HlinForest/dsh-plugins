import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('evidence archive preserves deep Windows inputs, project files and output records',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'eda-archive-long-'));
 t.after(async()=>{const relative=path.relative(os.tmpdir(),dir);assert(!relative.startsWith('..')&&!path.isAbsolute(relative));await fs.rm(dir,{recursive:true,force:true,maxRetries:5});});
 const deep=path.join(dir,'a'.repeat(90),'b'.repeat(90),'c'.repeat(90));
 const project=path.join(deep,'project'),inputs=path.join(deep,'inputs'),output=path.join(deep,'delivery');
 for(const folder of [project,inputs,output])await fs.mkdir(folder,{recursive:true});
 await fs.writeFile(path.join(project,'Circuit.kicad_sch'),'exact schematic bytes');
 await fs.writeFile(path.join(inputs,'模拟提取.json'),'simulated extraction');
 await fs.writeFile(path.join(output,'audit.json'),'actual check result');
 await fs.writeFile(path.join(output,'execution-archive.json'),'excluded recursive record');
 const request=path.join(deep,'request.json');assert(request.length>260);
 await fs.writeFile(request,JSON.stringify({output,inputsBundle:inputs,dependencies:{4:project},stage:7}));
 const python=process.env.KICAD_PYTHON||'D:/anaconda/python.exe';
 execFileSync(python,[fileURLToPath(new URL('../python/archive.py',import.meta.url)),request]);
 const bytes=await fs.readFile(path.join(output,'frozen-evidence.zip'));
 // Feed bytes through stdin so the verifier is independent of path normalization.
 const report=JSON.parse(execFileSync(python,['-c','import io,json,sys,zipfile; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); print(json.dumps({"bad":z.testzip(),"files":{n:z.read(n).decode("utf8") for n in z.namelist()}}))'],{input:bytes,encoding:'utf8'}));
 assert.equal(report.bad,null);
 const {'record-export-manifest.json':manifest,...files}=report.files;
 assert.deepEqual(JSON.parse(manifest),{schema:1,records:[]});
 assert.deepEqual(files,{'default-inputs/模拟提取.json':'simulated extraction','steps/4/Circuit.kicad_sch':'exact schematic bytes','steps/7/audit.json':'actual check result'});
});
