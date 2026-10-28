import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {reviewNative} from '../src/controlled-layout.js';

test('the real native review refuses to silently omit an extracted application example',async t=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'app-decisions-'));
  t.after(()=>fs.rm(folder,{recursive:true,force:true,maxRetries:5}));
  const quote='Application example: a 22uF capacitor on the supply.';
  const guidance=[{id:'guidance-example',subject:'Supply',category:'peripheral',statement:quote,citations:[{sourceId:'page',quote}]}];
  const p={label:'Generic source decision test',designMode:'new-design',inputs:{evidence:[{id:'page',content:quote}]},
    stages:[{id:1},{id:2,status:'done',confirmed:true,plan:{requirements:[]},result:{guidance}}]};
  const d={components:[{id:'cap',ref:'C9',value:'100nF',mpn:'',footprint:'',librarySymbol:'Device:C',in_bom:true,on_board:true,dnp:false,electricalRole:'other',
    pins:['1','2'].map(number=>({number,name:'',type:'passive',pad:number}))}],
    nets:[{name:'PWR',nodes:['C9.1']},{name:'GND',nodes:['C9.2']}],nc:[],functions:[],unresolved:[],supplied_nets:[]};
  let snapshots=0;
  const flow={config:{kicadCli:'D:/Kicad/bin/kicad-cli.exe'},async runProcess(args){snapshots++;await fs.writeFile(args[2],JSON.stringify({status:'passed'}));}};
  await assert.rejects(reviewNative(flow,p,d,folder),/应用.*决策|application.*decision/i);
  assert.equal(snapshots,0);
  d.applicationDecisions=[{guidanceId:'guidance-example',action:'adopt',components:['C9'],reason:'Use the source example capacitor.',operatingPoints:[],unresolved:[]}];
  await assert.rejects(reviewNative(flow,p,d,folder),/22uF/);
  assert.equal(snapshots,0);
  d.components[0].value='22uF';
  const accepted=await reviewNative(flow,p,d,folder);
  assert.equal(snapshots,1);assert.deepEqual(accepted.applicationDecisions,d.applicationDecisions);
  const review=JSON.parse(await fs.readFile(path.join(folder,'engineering-review.json'),'utf8'));
  assert.equal(review.applicationDecisions[0].actualComponents[0].value,'22uF');
  assert.equal(review.readiness.hardwareVerified,false);
});
