import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('native groups preserve topology while aligning their common pin lattice',()=>{
 execFileSync(process.env.EDA_TEST_PYTHON||process.env.KICAD_PYTHON||'D:/anaconda/python.exe',[fileURLToPath(new URL('./connection-grid.test.py',import.meta.url))],{encoding:'utf8',env:{...process.env,PYTHONUTF8:'1'},timeout:30000});
});
