import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {reviewOperatingPoints} from '../src/operating-points.js';
import {reviewNative} from '../src/controlled-layout.js';
import {readJSON,writeJSON} from '../src/io.js';

const pin=(number,name=String(number),type='passive')=>({number:String(number),name,type,pad:String(number)});
const part=(ref,value,role,symbol='Device:R')=>({id:ref,ref,value,mpn:'',footprint:'',librarySymbol:symbol,
  electricalRole:role,dnp:false,in_bom:true,on_board:true,pins:[pin(1),pin(2)]});
const assumed=(value,unit)=>({value,unit,basis:{assumption:'Test operating condition; not a manufacturer claim'}});
function receiver(){
  return {components:[{...part('U1','Receiver',undefined,'Evidence:Receiver'),pins:[pin(1,'OUT','output'),pin(2,'GND','power_in'),pin(3,'VCC','power_in')]},
    part('R1','150R','supply-filter'),part('R2','15k','pull-up'),part('C1','100nF','decoupling','Device:C')],
    nets:[{name:'P',nodes:['R1.1','R2.1']},{name:'LOCAL',nodes:['R1.2','U1.3','C1.1']},
      {name:'G',nodes:['U1.2','C1.2']},{name:'S',nodes:['U1.1','R2.2']}],
    nc:[],supplied_nets:['P','LOCAL','G'],functions:[],unresolved:[],
    peripheralAssessments:[{ref:'U1',pins:{supply:'3',return:'2',output:'1'},
      supply:{components:['R1','C1']},output:{components:['R2']}}],
    operatingPoints:[{id:'filter',kind:'rc-filter',owner:'U1',components:['R1','C1'],
      inputs:{supplyVoltage:assumed(5,'V'),deviceCurrent:assumed(.5,'mA'),minDeviceVoltage:assumed(2.7,'V'),frequency:assumed(38,'kHz')}}]};
}
function load(){
  return {components:[part('D1','LED',undefined,'Device:LED'),part('R1','470Ω','current-limit')],
    nets:[{name:'DRIVE',nodes:['R1.1']},{name:'LED',nodes:['R1.2','D1.1']},{name:'G',nodes:['D1.2']}],
    loadAssessments:[{ref:'D1',currentControl:'resistor',components:['R1']}],
    operatingPoints:[{id:'load',kind:'resistor-load',owner:'D1',components:['R1'],inputs:{
      supplyVoltage:assumed(5,'V'),forwardVoltage:assumed(2,'V'),driverDrop:assumed(.2,'V'),duty:assumed(25,'%'),targetAverageCurrent:assumed(2,'mA')}}]};
}
const near=(a,b)=>assert(Math.abs(a-b)<Math.max(Math.abs(b)*1e-10,1e-14),`${a} != ${b}`);
const invalid=d=>assert(reviewOperatingPoints(d).errors.length>0);
function filteredReceiver(){
  const d=receiver();
  d.nets[0].nodes=d.nets[0].nodes.filter(n=>n!=='R2.1');d.nets[1].nodes.push('R2.1');
  d.operatingPoints.push({id:'bias',kind:'pull-up',owner:'U1',components:['R2'],inputs:{
    supplyVoltage:assumed(5,'V'),lowVoltage:assumed(.2,'V'),maxSinkCurrent:assumed(1,'mA')}});
  return d;
}

test('filtered-rail pull-up current is included in the real supply and sink limits',()=>{
  const d=filteredReceiver();
  const r=reviewOperatingPoints(d);assert.deepEqual(r.errors,[]);
  const rail=(5/150-.0005+.2/15000)/(1/150+1/15000);
  near(r.results.find(r=>r.id==='filter').calculations[0].deviceVoltageV,rail);
  near(r.results.find(r=>r.id==='bias').calculations[0].sinkCurrentA,(rail-.2)/15000);
  d.operatingPoints[0].inputs.minDeviceVoltage=assumed(4.9,'V');
  assert(reviewOperatingPoints(d).errors.some(e=>e.code==='operating-limit-exceeded'));
});

test('joint supply rejects missing loads, conflicting sources and duplicate load declarations',()=>{
  for(const edit of [d=>d.operatingPoints.pop(),d=>d.operatingPoints.shift(),
    d=>d.operatingPoints[1].inputs.supplyVoltage.value=4.9,
    d=>d.operatingPoints.push({...structuredClone(d.operatingPoints[0]),id:'duplicate'}),
    d=>{d.components.push(part('R3','10k','other'));d.nets[1].nodes.push('R3.1');d.nets[2].nodes.push('R3.2');}]){
    const d=filteredReceiver();edit(d);invalid(d);
  }
});

test('shared filtered supply sums device currents and distinguishes worst rail from worst sink',()=>{
  const d=filteredReceiver(),u2=structuredClone(d.components[0]);u2.ref='U2';u2.id='U2';
  d.components.push(u2,part('R3','10k','pull-up'));
  d.nets[1].nodes.push('U2.3','R3.1');d.nets[2].nodes.push('U2.2');
  d.nets.push({name:'S2',nodes:['U2.1','R3.2']});
  const a=structuredClone(d.peripheralAssessments[0]);a.ref='U2';a.output.components=['R3'];d.peripheralAssessments.push(a);
  const f=structuredClone(d.operatingPoints[0]);f.id='filter2';f.owner='U2';f.inputs.deviceCurrent.value=1;
  const p=structuredClone(d.operatingPoints[1]);p.id='bias2';p.owner='U2';p.components=['R3'];p.inputs.lowVoltage.value=.3;
  d.operatingPoints.push(f,p);
  const r=reviewOperatingPoints(d);assert.deepEqual(r.errors,[]);
  const low=(5/150-.0015+.2/15000+.3/10000)/(1/150+1/15000+1/10000);
  near(r.results.find(r=>r.id==='filter').calculations[0].deviceVoltageV,low);
  near(r.results.find(r=>r.id==='filter2').calculations[0].deviceLoadCurrentA,.0015);
  const oneLow=(5/150-.0015+.2/15000)/(1/150+1/15000);
  const bias=r.results.find(r=>r.id==='bias').calculations[0];
  near(bias.sinkCurrentA,(oneLow-.2)/15000);near(bias.simultaneousLowSinkCurrentA,(low-.2)/15000);
  assert(bias.sinkCurrentA>bias.simultaneousLowSinkCurrentA);
  d.operatingPoints.reverse();const reordered=reviewOperatingPoints(d);
  near(reordered.results.find(r=>r.id==='filter').calculations[0].deviceVoltageV,low);
});

test('filtered-rail coupling follows zero-ohm domains and preserves dependencies and dynamic limits',()=>{
  const d=filteredReceiver();d.components.push(part('JUMPER','0R','routing-bridge'));
  d.nets[1].nodes=d.nets[1].nodes.filter(n=>n!=='R2.1');d.nets[1].nodes.push('JUMPER.1');
  d.nets.push({name:'BIAS_RAIL',nodes:['JUMPER.2','R2.1']});
  const r=reviewOperatingPoints(d);assert.deepEqual(r.errors,[]);
  assert.deepEqual(r.results.find(r=>r.id==='bias').coupling.relatedOperatingPoints,['bias','filter']);
  d.operatingPoints[1].inputs.inputCapacitance=assumed(20,'pF');
  const pending=reviewOperatingPoints(d);assert.deepEqual(pending.errors,[]);
  assert(pending.unresolved.some(s=>s.includes('动态响应')));
  assert(!('riseTime10To90S' in pending.results.find(r=>r.id==='bias').calculations[0]));
  d.operatingPoints[1].inputs.maxRiseTime=assumed(500,'ns');invalid(d);
});

test('nominal RC arithmetic uses fitted components and preserves assumptions',()=>{
  const r=reviewOperatingPoints(receiver());assert.deepEqual(r.errors,[]);
  const c=r.results[0].calculations[0];near(c.voltageDropV,.075);near(c.deviceVoltageV,4.925);
  near(c.timeConstantS,15e-6);near(c.cutoffHz,1/(2*Math.PI*15e-6));
  assert.equal(r.results[0].status,'needs-review');assert.equal(r.unresolved.length,4);
  assert(r.warnings.some(w=>w.message.includes('R2')));
});
test('LED duty, current and ideal target resistance are host-derived, not copied from prose',()=>{
  const d=load(),r=reviewOperatingPoints(d);assert.deepEqual(r.errors,[]);
  const c=r.results[0].calculations[0];near(c.peakCurrentA,2.8/470);near(c.averageCurrentA,2.8/470/4);near(c.targetResistanceOhm,350);
  d.components[1].value='1k';near(reviewOperatingPoints(d).results[0].calculations[0].peakCurrentA,.0028);
});
test('actual voltage and current limit violations reject the candidate',()=>{
  const d=receiver();d.operatingPoints[0].inputs.deviceCurrent=assumed(20,'mA');
  assert(reviewOperatingPoints(d).errors.some(e=>e.code==='operating-limit-exceeded'));
  const l=load();l.operatingPoints[0].inputs.maxPeakCurrent=assumed(1,'mA');
  assert(reviewOperatingPoints(l).errors.some(e=>e.code==='operating-limit-exceeded'));
});
test('citations require a current exact quote, matching dimension and converted quantity',()=>{
  const d=load();const quote='Supply voltage 5000 mV; forward voltage 2 V; driver drop 200 mV; duty cycle 1/4.';
  const inputs={evidence:[{id:'p1',content:quote,document:'part.pdf',page:3}]};
  delete d.operatingPoints[0].inputs.targetAverageCurrent;
  for(const x of Object.values(d.operatingPoints[0].inputs))x.basis={sourceId:'p1',quote};
  const r=reviewOperatingPoints(d,{inputs});assert.deepEqual(r.errors,[]);assert.equal(r.results[0].status,'needs-review');
  assert.equal(r.results[0].inputs.forwardVoltage.qualification,'quantity-only');
  assert.equal(r.results[0].inputs.duty.page,3);
  d.operatingPoints[0].inputs.supplyVoltage.value=6;assert(reviewOperatingPoints(d,{inputs}).errors.length);
  d.operatingPoints[0].inputs.supplyVoltage.value=5;assert(reviewOperatingPoints(d).errors.length);
});
test('a catalogue current is not silently promoted to a verified operating rating',()=>{
  const d=receiver(),quote='IR receiver / 38kHz / 5.5V / 0.5mA / -20~80C';
  d.operatingPoints[0].inputs.deviceCurrent.basis={sourceId:'catalogue',quote};
  const r=reviewOperatingPoints(d,{inputs:{evidence:[{id:'catalogue',content:quote}]}});
  assert.deepEqual(r.errors,[]);
  assert.equal(r.results[0].inputs.deviceCurrent.qualification,'quantity-only');
  assert(r.unresolved.some(s=>s.includes('deviceCurrent')&&s.includes('额定类型')));
});
test('unknown model results, units, incomplete inputs and inconsistent limits are rejected',()=>{
  for(const edit of [d=>d.operatingPoints[0].computedCurrent=1,d=>d.operatingPoints[0].inputs.duty.unit='V',
    d=>delete d.operatingPoints[0].inputs.driverDrop,d=>d.operatingPoints[0].inputs.duty.value=0,
    d=>Object.assign(d.operatingPoints[0].inputs,{minAverageCurrent:assumed(5,'mA'),maxAverageCurrent:assumed(2,'mA')})]){
    const d=load();edit(d);invalid(d);
  }
});
test('RC model rejects a series or unrelated capacitor even if listed in the peripheral assessment',()=>{
  const d=receiver();d.nets.find(n=>n.name==='G').nodes=['U1.2'];d.nets.push({name:'OTHER',nodes:['C1.2']});invalid(d);
});
test('RC model includes every actual parallel capacitor instead of understating total capacitance',()=>{
  const d=receiver();d.components.push(part('C2','1uF','decoupling','Device:C'));
  d.nets.find(n=>n.name==='LOCAL').nodes.push('C2.1');d.nets.find(n=>n.name==='G').nodes.push('C2.2');
  invalid(d);
  d.operatingPoints[0].components.push('C2');d.peripheralAssessments[0].supply.components.push('C2');
  const r=reviewOperatingPoints(d);assert.deepEqual(r.errors,[]);near(r.results[0].calculations[0].capacitanceF,1.1e-6);
});
test('pull-ups sum only resistors on the same real rail and output and check rise time',()=>{
  const d=receiver();d.components.push(part('R3','15k','pull-up'));d.nets[0].nodes.push('R3.1');d.nets[3].nodes.push('R3.2');
  d.peripheralAssessments[0].output.components.push('R3');
  d.operatingPoints=[{id:'bias',kind:'pull-up',owner:'U1',components:['R2','R3'],inputs:{supplyVoltage:assumed(5,'V'),lowVoltage:assumed(.2,'V'),maxSinkCurrent:assumed(1,'mA'),inputCapacitance:assumed(20,'pF'),maxRiseTime:assumed(500,'ns')}}];
  const r=reviewOperatingPoints(d);assert.deepEqual(r.errors,[]);const c=r.results[0].calculations[0];near(c.equivalentResistanceOhm,7500);near(c.sinkCurrentA,.00064);near(c.riseTime10To90S,Math.log(9)*7500*20e-12);
  d.nets[0].nodes=d.nets[0].nodes.filter(n=>n!=='R3.1');d.nets[1].nodes.push('R3.1');invalid(d);
});
test('load resistors cannot be borrowed from another channel, or computed as independent when parallel',()=>{
  const d=load();d.nets[1].nodes=['D1.1'];d.nets.push({name:'OTHER',nodes:['R1.2']});invalid(d);
  const p=load();p.components.push(part('R2','470','current-limit'));p.nets[0].nodes.push('R2.1');p.nets[1].nodes.push('R2.2');
  p.loadAssessments[0].components.push('R2');p.operatingPoints[0].components.push('R2');invalid(p);
});
test('unsupported device types and unpopulated parts cannot enter the resistor model',()=>{
  for(const edit of [d=>d.components[1].librarySymbol='Device:Ferrite_Bead',d=>d.components[1].dnp=true]){
    const d=load();edit(d);invalid(d);
  }
});
test('the real design review records nominal results and refuses an exceeded limit before snapshotting',async t=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'operating-review-'));
  t.after(()=>fs.rm(folder,{recursive:true,force:true,maxRetries:5}));
  const d=load();Object.assign(d,{nc:[],functions:[],unresolved:[],supplied_nets:[]});
  d.components.push({...part('U1','Driver',undefined,'Driver:Generic'),pins:[pin(1,'OUT','output'),pin(2,'GND')]});
  d.nets[0].nodes.push('U1.1');d.nets[2].nodes.push('U1.2');
  const project={label:'Review integration',designMode:'new-design',inputs:{},stages:[]};
  let snapshots=0;
  const flow={config:{kicadCli:'D:/Kicad/bin/kicad-cli.exe'},async runProcess(args){
    snapshots++;const req=await readJSON(args[1]);const actual=await readJSON(req.design);
    assert.deepEqual(actual.operatingPoints,d.operatingPoints);
    await writeJSON(args[2],{status:'passed'});
  }};
  const accepted=await reviewNative(flow,project,d,path.join(folder,'accepted'));
  assert.equal(snapshots,1);assert(accepted.unresolved.some(s=>s.includes('supplyVoltage')));
  const report=await readJSON(path.join(folder,'accepted','engineering-review.json'));
  assert.equal(report.operatingPoints[0].status,'needs-review');assert.equal(report.readiness.hardwareVerified,false);
  d.operatingPoints[0].inputs.maxPeakCurrent=assumed(1,'mA');
  await assert.rejects(reviewNative(flow,project,d,path.join(folder,'rejected')),/峰值电流/);
  assert.equal(snapshots,1);
  const rejected=await readJSON(path.join(folder,'rejected','engineering-review.json'));
  assert.equal(rejected.readiness.status,'invalid');
});
