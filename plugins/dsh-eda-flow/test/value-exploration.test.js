import test from 'node:test';
import assert from 'node:assert/strict';
import {exploreValues,valueConstraints} from '../src/value-exploration.js';
const input=(value,unit)=>({value,unit,basis:{assumption:'Explicit test operating condition'}});
function circuit(){
  const pins=[{number:'1',name:'1',type:'passive'},{number:'2',name:'2',type:'passive'}];
  return {components:[{ref:'LOAD',librarySymbol:'Device:LED',pins},
    {ref:'LIMIT',librarySymbol:'Device:R',value:'330R',electricalRole:'current-limit',pins}],
    nets:[{name:'P',nodes:['LIMIT.1']},{name:'S',nodes:['LIMIT.2','LOAD.1']},{name:'G',nodes:['LOAD.2']}],
    loadAssessments:[{ref:'LOAD',currentControl:'resistor',components:['LIMIT']}],
    operatingPoints:[{id:'current',kind:'resistor-load',owner:'LOAD',components:['LIMIT'],inputs:{
      supplyVoltage:input(5,'V'),forwardVoltage:input(2,'V'),driverDrop:input(.3,'V'),duty:input(.25,'ratio'),maxPeakCurrent:input(.02,'A')}}]};
}
const args=values=>({candidateId:'current',variants:[{id:'trial',values}]});
test('same conditions expose an unsafe lower resistance and do not mutate the candidate',()=>{
  const d=circuit(),before=structuredClone(d),r=exploreValues(d,args([{ref:'LIMIT',value:'47R'}]));
  assert.deepEqual(d,before);assert.equal(r.candidateChanged,false);assert.equal(r.conditionsChanged,false);
  assert(r.variants[0].operatingErrors.some(e=>e.code==='operating-limit-exceeded'));
  assert(Math.abs(r.variants[0].calculations[0].calculations[0].peakCurrentA-2.7/47)<1e-10);
  assert.equal(r.constraints[0].minimumResistanceOhm,250);assert.equal(r.constraints[0].maximumResistanceOhm,null);
  assert.equal(r.constraints[0].targetResistanceOhm,null);
});
test('exploration cannot smuggle new pins, coordinates or easier conditions',()=>{
  for(const extra of [{inputs:{}},{nets:[]},{at:[1,2]}])assert.throws(()=>exploreValues(circuit(),{...args([{ref:'LIMIT',value:'1k'}]),...extra}));
  for(const values of [[{ref:'NEW',value:'1k'}],[{ref:'LOAD',value:'1k'}],[{ref:'LIMIT',value:'1k'},{ref:'LIMIT',value:'2k'}]])assert.throws(()=>exploreValues(circuit(),args(values)));
  assert.throws(()=>exploreValues(circuit(),args([{ref:'LIMIT',value:'1k',x:1}])));
});
test('multiple capacitor values use the actual parallel sum and preserve all operating assumptions',()=>{
  const pins=[{number:'1',name:'VDD',type:'power_in'},{number:'2',name:'GND',type:'power_in'}];
  const d={components:[{ref:'LOAD',librarySymbol:'Logic:X',pins},...['A','B'].map(ref=>({ref,librarySymbol:'Device:C',value:'4.7uF',electricalRole:'decoupling',pins:pins.map(p=>({...p,type:'passive'}))}))],
    nets:[{name:'P',nodes:['LOAD.1','A.1','B.1']},{name:'G',nodes:['LOAD.2','A.2','B.2']}],
    functions:[{layout:[{kind:'decoupling',anchor:'LOAD.1',return:'LOAD.2',members:['A','B']}]}],
    operatingPoints:[{id:'storage',kind:'supply-transient',owner:'LOAD',components:['A','B'],inputs:{loadStepCurrent:input(.02,'A'),supportTime:input(10,'us'),maxDroop:input(.1,'V'),effectiveCapacitanceRatio:input(.5,'ratio'),equivalentEsr:input(.1,'ohm')}}]};
  const before=structuredClone(d),r=exploreValues(d,args([{ref:'A',value:'100nF'},{ref:'B',value:'10uF'}]));
  assert.deepEqual(d,before);assert.deepEqual(r.variants[0].operatingErrors,[]);
  const c=r.variants[0].calculations[0].calculations[0];assert(Math.abs(c.capacitanceF-10.1e-6)<1e-12);
  assert(Math.abs(c.transientDroopV-(.002+.02*1e-5/(10.1e-6*.5)))<1e-12);
  assert(r.constraints[0].minimumNominalCapacitanceF>4e-6);
});
test('pull-up upper bound stays unknown without a valid independent timing model',()=>{
  const r={id:'p',kind:'pull-up',components:['R'],status:'needs-review',inputs:{supplyVoltage:{value:5},maxSinkCurrent:{value:.0005}},calculations:[{}]};
  assert.equal(valueConstraints([r])[0].minimumEquivalentResistanceOhm,10000);
  assert.equal(valueConstraints([r])[0].maximumEquivalentResistanceOhm,null);
  r.inputs.inputCapacitance={value:20e-12};r.inputs.maxRiseTime={value:1e-6};
  assert(valueConstraints([r])[0].maximumEquivalentResistanceOhm>20000);
  r.coupling={};assert.equal(valueConstraints([r])[0].maximumEquivalentResistanceOhm,null);
});
test('nominal success cannot hide a conflict with adopted source values',()=>{
  const d=circuit();d.applicationDecisions=[{guidanceId:'g1',action:'adopt',components:['LIMIT'],reason:'Apply source operating example.',operatingPoints:[],unresolved:[]}];
  const context={guidance:[{id:'g1',category:'peripheral',subject:'Example',statement:'Use a 330 ohm series resistor.',citations:[{sourceId:'doc',quote:'Use a 330 ohm series resistor.'}]}]};
  const r=exploreValues(d,args([{ref:'LIMIT',value:'1k'}]),context);
  assert.deepEqual(r.variants[0].operatingErrors,[]);assert(r.variants[0].sourceErrors.length);
});
