import test from 'node:test';
import assert from 'node:assert/strict';
import {solvePassives} from '../src/passive-solver.js';
import {reviewOperatingPoints} from '../src/operating-points.js';

const input=(value,unit)=>({value,unit,basis:{assumption:'Explicit test scenario, not a verified part rating'}});
const pin=(number,type='passive')=>({number:String(number),name:String(number),type});
function circuit(){
 const part=(ref,value,role,kind)=>({ref,value,electricalRole:role,librarySymbol:'Device:'+kind,pins:[pin(1),pin(2)]});
 return {components:[{ref:'SOURCE',pins:[pin(1,'power_in'),pin(2,'power_in'),...['3','4','5','6'].map(n=>pin(n,'output'))]},
  {ref:'LOAD',pins:[pin(1),pin(2),pin(3),pin(4)]},part('RA','1k','current-limit','R'),part('RB','1k','current-limit','R'),part('HF','100nF','decoupling','C'),part('STORE','1uF','decoupling','C')],
  nets:[{name:'P',nodes:['SOURCE.1','HF.1','STORE.1']},{name:'G',nodes:['SOURCE.2','HF.2','STORE.2']},
   {name:'A',nodes:['SOURCE.3','RA.1']},{name:'B',nodes:['SOURCE.4','RB.1']},{name:'LA',nodes:['RA.2','LOAD.1']},{name:'LB',nodes:['RB.2','LOAD.2']},
   {name:'K1',nodes:['SOURCE.5','LOAD.3']},{name:'K2',nodes:['SOURCE.6','LOAD.4']}],
  functions:[{layout:[{kind:'decoupling',anchor:'SOURCE.1',return:'SOURCE.2',members:['HF','STORE']}]}],
  loadAssessments:[{ref:'LOAD',components:['RA','RB'],currentControl:'resistor'}],
  operatingPoints:[{id:'light',kind:'resistor-load',owner:'LOAD',driver:'SOURCE',components:['RA','RB'],inputs:{supplyVoltage:input(5,'V'),forwardVoltage:input(2,'V'),driverDrop:input(.3,'V'),duty:input(.25,'ratio'),scanSlots:input(4,'count'),maxPeakCurrent:input(50,'mA'),maxGroupCurrent:input(200,'mA'),targetAverageCurrent:input(2,'mA')}},
   {id:'rail',kind:'supply-transient',owner:'SOURCE',components:['HF','STORE'],loadStepScope:'excluding-derived-loads',inputs:{loadStepCurrent:input(0,'A'),supportTime:input(10,'us'),maxDroop:input(.25,'V'),effectiveCapacitanceRatio:input(.5,'ratio'),equivalentEsr:input(.05,'ohm')}}]};
}
test('a current target changes real resistors and jointly resizes storage instead of only listing target arithmetic',()=>{
 const d=circuit(),original=structuredClone(d),r=solvePassives(d);
 assert.deepEqual(reviewOperatingPoints(d).errors,[]);
 assert.equal(r.design.components.find(c=>c.ref==='RA').value,'330ohm');
 assert.equal(r.design.components.find(c=>c.ref==='RB').value,'330ohm');
 assert.equal(r.design.components.find(c=>c.ref==='HF').value,'100nF');
 assert.notEqual(r.design.components.find(c=>c.ref==='STORE').value,'1uF');
 assert.deepEqual(reviewOperatingPoints(r.design).errors,[]);
 assert.deepEqual(r.design.operatingPoints,d.operatingPoints);
 assert.deepEqual(r.design.nets,d.nets);assert.deepEqual(d,original);
 assert(r.targets[0].afterRelativeError<r.targets[0].beforeRelativeError);
 assert.equal(r.targets[0].qualification,'conditional');
});
test('without a performance target no resistor or capacitor combination is invented',()=>{
 const d=circuit();delete d.operatingPoints[0].inputs.targetAverageCurrent;
 const r=solvePassives(d);assert.deepEqual(r.changes,[]);assert.deepEqual(r.targets,[]);
 assert.equal(r.bankRequirements[0].componentCountDetermined,false);
});
test('source-adopted bypass and resistor values constrain target selection',()=>{
 const d=circuit();d.applicationDecisions=[{guidanceId:'g',action:'adopt',components:['RA','RB'],reason:'Use documented resistors',operatingPoints:[],unresolved:[]}];
 const context={guidance:[{id:'g',statement:'Use two 1 kohm resistors.',subject:'Circuit example',category:'application'}]};
 const r=solvePassives(d,context);assert.equal(r.design.components.find(c=>c.ref==='RA').value,'1k');
 assert.equal(r.design.components.find(c=>c.ref==='STORE').value,'1uF');
 assert(r.targets[0].blockedReasons.length>0);
});
