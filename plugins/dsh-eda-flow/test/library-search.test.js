import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('library search accepts exact symbols and library-qualified queries',()=>{
  execFileSync(process.env.EDA_TEST_PYTHON||'D:/anaconda/python.exe',[fileURLToPath(new URL('./library-search.test.py',import.meta.url))],{env:{...process.env,PYTHONUTF8:'1'},encoding:'utf8',stdio:'pipe',timeout:30000});
});
