import test from 'node:test';
import assert from 'node:assert/strict';
import {solvePassives} from '../src/passive-solver.js';
import {reviewOperatingPoints} from '../src/operating-points.js';
const input=(value,unit)=>({value,unit,basis:{assumption:'Declared operating condition, not measured'}});
function load(){
 const pins=[{number:'1',name:'1',type:'passive'},{number:'2',name:'2',type:'passive'}];
 return {components:[{ref:'LIGHT',pins},{ref:'RS',librarySymbol:'Device:R',value:'47R',electricalRole:'current-limit',pins}],
  nets:[{name:'A',nodes:['RS.1']},{name:'B',nodes:['RS.2','LIGHT.1']},{name:'Z',nodes:['LIGHT.2']}],
  loadAssessments:[{ref:'LIGHT',currentControl:'resistor',components:['RS']}],
  operatingPoints:[{id:'drive',kind:'resistor-load',owner:'LIGHT',components:['RS'],inputs:{supplyVoltage:input(3.3,'V'),forwardVoltage:input(1.8,'V'),driverDrop:input(.2,'V'),duty:input(.5,'ratio'),maxPeakCurrent:input(10,'mA')}}]};
}
test('solver derives a constraint repair and changes a real resistor without changing inputs or wiring',()=>{
 const d=load(),before=structuredClone(d),r=solvePassives(d);
 assert.deepEqual(d,before);assert(r.changes.length);assert.equal(r.design.components[1].value,'330ohm');
 assert.deepEqual(r.design.operatingPoints,d.operatingPoints);assert.deepEqual(r.design.nets,d.nets);
 assert.deepEqual(reviewOperatingPoints(r.design).errors,[]);assert.equal(r.status,'repair-proposed');
 assert(r.dimensions[0].lowerScale>7&&r.dimensions[0].lowerScale<7.03);
});
test('lack of a brightness target never invents a unique lower resistor value for a passing design',()=>{
 const d=load();d.components[1].value='1k';const r=solvePassives(d);
 assert.equal(r.status,'feasible-underdetermined');assert.deepEqual(r.changes,[]);
 assert(r.unresolved.some(s=>s.includes('唯一')));
});
test('capacitor repair sizes actual parallel storage, preserving the separate bypass and all conditions',()=>{
 const pins=[{number:'1',name:'VDD',type:'power_in'},{number:'2',name:'GND',type:'power_in'}];
 const d={components:[{ref:'IC',pins},...['HF','BULK'].map((ref,i)=>({ref,librarySymbol:'Device:C',value:i?'1uF':'100nF',electricalRole:'decoupling',pins:pins.map(p=>({...p,type:'passive'}))}))],
  nets:[{name:'P',nodes:['IC.1','HF.1','BULK.1']},{name:'G',nodes:['IC.2','HF.2','BULK.2']}],
  functions:[{layout:[{kind:'decoupling',anchor:'IC.1',return:'IC.2',members:['HF','BULK']}]}],
  operatingPoints:[{id:'hold',kind:'supply-transient',owner:'IC',components:['HF','BULK'],inputs:{loadStepCurrent:input(.04,'A'),supportTime:input(20,'us'),maxDroop:input(.2,'V'),effectiveCapacitanceRatio:input(.5,'ratio'),equivalentEsr:input(.1,'ohm')}}]};
 const r=solvePassives(d);assert.equal(r.design.components[1].value,'100nF');assert.equal(r.design.components[2].value,'8.2uF');
 assert.deepEqual(r.design.nets,d.nets);assert.deepEqual(r.design.operatingPoints,d.operatingPoints);
 assert.deepEqual(reviewOperatingPoints(r.design).errors,[]);assert.equal(r.bankRequirements[0].componentCountDetermined,false);
});
test('source constraints block an otherwise mathematically passing repair',()=>{
 const d=load();d.applicationDecisions=[{guidanceId:'source',action:'adopt',components:['RS'],reason:'Adopt stated value',operatingPoints:[],unresolved:[]}];
 const context={guidance:[{id:'source',category:'peripheral',subject:'Example',statement:'Use a 47 ohm resistor.',citations:[{sourceId:'doc',quote:'Use a 47 ohm resistor.'}]}]};
 const r=solvePassives(d,context);assert.equal(r.status,'needs-design-decision');assert.deepEqual(r.changes,[]);assert(r.blocked.length);
});
test('a missing required electrical model cannot be replaced with numeric search',()=>{
 const d=load();delete d.operatingPoints[0].inputs.supplyVoltage;
 const r=solvePassives(d);assert.equal(r.status,'invalid-input');assert.deepEqual(r.changes,[]);
});
test('an absent operating model is not reported as a feasible circuit',()=>{
 const d=load();delete d.operatingPoints;
 const r=solvePassives(d);assert.equal(r.status,'invalid-input');assert.deepEqual(r.changes,[]);
 assert(r.unresolved.some(s=>s.includes('工作点')));
});
