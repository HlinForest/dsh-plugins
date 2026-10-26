import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewOperatingPoints} from '../src/operating-points.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {reviewNative} from '../src/controlled-layout.js';
import {readJSON,writeJSON} from '../src/io.js';
const input=(value,unit)=>({value,unit,basis:{assumption:'Explicit load-step design condition'}});
const pin=(number,name,type='passive')=>({number:String(number),name,type});
function circuit(){
  return {components:[{ref:'IC7',librarySymbol:'Logic:Driver',pins:[pin(8,'VDD','power_in'),pin(4,'VSS','power_in')]},
    {ref:'C9',librarySymbol:'Device:C',value:'100nF',electricalRole:'decoupling',pins:[pin(1,'1'),pin(2,'2')]}],
  nets:[{name:'PWR',nodes:['IC7.8','C9.1']},{name:'RETURN',nodes:['IC7.4','C9.2']}],
  functions:[{layout:[{kind:'decoupling',anchor:'IC7.8',return:'IC7.4',members:['C9']}]}],
  operatingPoints:[{id:'supply',kind:'supply-transient',owner:'IC7',components:['C9'],inputs:{
    loadStepCurrent:input(20,'mA'),supportTime:input(10,'us'),maxDroop:input(.1,'V'),
    effectiveCapacitanceRatio:input(.8,'ratio'),equivalentEsr:input(.1,'ohm')}}]};
}
const near=(a,b)=>assert(Math.abs(a-b)<1e-10*Math.abs(b)+1e-15,`${a} != ${b}`);
test('one bypass capacitor does not substitute for a quantitative supply assessment',()=>{
  const d=circuit();delete d.operatingPoints;
  assert(reviewOperatingPoints(d).errors.some(e=>e.code==='supply-transient-missing'));
});
test('actual capacitance, derating and ESR determine whether a load step fits the voltage budget',()=>{
  const d=circuit();const r=reviewOperatingPoints(d);
  assert(r.errors.some(e=>e.code==='operating-limit-exceeded'));
  near(r.results[0].calculations[0].transientDroopV,2.502);
  d.components[1].value='10uF';const ok=reviewOperatingPoints(d);assert.deepEqual(ok.errors,[]);
  near(ok.results[0].calculations[0].transientDroopV,.027);
  near(ok.results[0].calculations[0].requiredNominalCapacitanceF,.02*1e-5/(.1-.002)/.8);
  assert.equal(ok.results[0].status,'needs-review');
});
test('transient assessment rejects disconnected caps, impossible ESR and a fictitious derating factor',()=>{
  for(const edit of [d=>d.nets[1].nodes=['IC7.4'],d=>d.operatingPoints[0].inputs.equivalentEsr.value=10,
    d=>d.operatingPoints[0].inputs.effectiveCapacitanceRatio.value=2,
    d=>d.operatingPoints[0].inputs.supportTime.value=0]){
    const d=circuit();d.components[1].value='10uF';edit(d);assert(reviewOperatingPoints(d).errors.length);
  }
});
test('all same-domain caps are counted and duplicated assessment cannot hide a missing owner',()=>{
  const d=circuit();d.components.push({...structuredClone(d.components[1]),ref:'C10',value:'4.7uF',electricalRole:'other',purpose:'Supply reservoir'});
  d.nets[0].nodes.push('C10.1');d.nets[1].nodes.push('C10.2');
  assert(reviewOperatingPoints(d).errors.length);
  d.operatingPoints[0].components.push('C10');const r=reviewOperatingPoints(d);assert.deepEqual(r.errors,[]);
  near(r.results[0].calculations[0].capacitanceF,4.8e-6);
  d.operatingPoints.push({...structuredClone(d.operatingPoints[0]),id:'again'});
  assert(reviewOperatingPoints(d).errors.some(e=>e.message.includes('重复')));
});

test('native design review rejects undersized storage before resource snapshot and records a corrected candidate',async t=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'supply-budget-review-'));
  t.after(()=>fs.rm(folder,{recursive:true,force:true,maxRetries:5}));
  const d=circuit();Object.assign(d,{nc:[],unresolved:[],supplied_nets:['PWR','RETURN']});
  for(const c of d.components)Object.assign(c,{id:c.ref,mpn:'',footprint:'',value:c.value||'Driver',dnp:false,in_bom:true,on_board:true});
  for(const c of d.components)for(const p of c.pins)p.pad=p.number;
  Object.assign(d.functions[0],{requirementId:'supply',description:'Local supply',checks:[{kind:'connected',nodes:['IC7.8','C9.1']}],limitations:[]});
  const project={label:'Supply review',designMode:'new-design',inputs:{},stages:[{}, {plan:{requirements:[{id:'supply',description:'Local supply'}]}}]};
  let snapshots=0;const flow={config:{kicadCli:'D:/Kicad/bin/kicad-cli.exe'},async runProcess(args){snapshots++;await writeJSON(args[2],{status:'passed'});}};
  await assert.rejects(reviewNative(flow,project,d,path.join(folder,'undersized')),/储能压降/);
  assert.equal(snapshots,0);
  d.components[1].value='10uF';await reviewNative(flow,project,d,path.join(folder,'corrected'));
  assert.equal(snapshots,1);
  const review=await readJSON(path.join(folder,'corrected','engineering-review.json'));
  assert.equal(review.operatingPoints[0].status,'needs-review');assert.equal(review.readiness.hardwareVerified,false);
});
