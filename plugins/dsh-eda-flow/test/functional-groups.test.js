import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('functional grouping handles source symbols and standard-library passive chains',()=>{
  const python=process.env.EDA_TEST_PYTHON||process.env.KICAD_PYTHON||'D:/anaconda/python.exe';
  execFileSync(python,[fileURLToPath(new URL('./functional-groups.test.py',import.meta.url)),'-v'],{
    env:{...process.env,PYTHONUTF8:'1'},encoding:'utf8',stdio:'pipe',timeout:30000,
  });
});
