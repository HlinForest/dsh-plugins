import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('constraint placement is independent of process hash and array order',()=>{
  const python=process.env.EDA_TEST_PYTHON||process.env.KICAD_PYTHON||'D:/anaconda/python.exe';
  execFileSync(python,[fileURLToPath(new URL('./constraint-placement.test.py',import.meta.url))],{
    env:{...process.env,PYTHONUTF8:'1'},encoding:'utf8',stdio:'pipe',timeout:60000,
  });
});
