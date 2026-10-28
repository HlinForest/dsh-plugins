import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('page planning fits measured groups and their signal relationships without saved coordinates',()=>{
  const python=process.env.EDA_TEST_PYTHON||process.env.KICAD_PYTHON||'D:/anaconda/python.exe';
  execFileSync(python,[fileURLToPath(new URL('./page-planning.test.py',import.meta.url))],{
    env:{...process.env,PYTHONUTF8:'1'},encoding:'utf8',stdio:'pipe',timeout:60000,
  });
});
