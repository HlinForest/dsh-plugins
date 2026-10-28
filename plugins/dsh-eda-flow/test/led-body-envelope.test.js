import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('LED outward leads clear optical arrows in every rotation; body intrusions stay rejected',()=>{
  execFileSync('D:/anaconda/python.exe',[fileURLToPath(new URL('./led-body-envelope.py',import.meta.url))],{windowsHide:true,env:{...process.env,PYTHONUTF8:'1'}});
});
