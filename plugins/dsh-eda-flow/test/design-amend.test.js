import test from 'node:test';
import assert from 'node:assert/strict';
import {amendDesign} from '../src/design-amend.js';
const base=()=>({components:[{id:'r',ref:'RB8',value:'10k',librarySymbol:'Device:R',pins:[{number:'1'},{number:'2'}]}],
  nets:[{name:'A',nodes:['RB8.1','RX8.1']},{name:'B',nodes:['RX8.2']},{name:'SIG',nodes:['RB8.2']}],
  peripheralAssessments:[{ref:'RX8',output:{components:['RB8']}}],operatingPoints:[{id:'bias',components:['RB8']}],
  functions:[],nc:['RX8.3'],unresolved:['old assumption','keep this']});

test('atomic endpoint and related record edits preserve unrelated parts, nets and NC',()=>{
  const before=base(),original=structuredClone(before),output={ref:'RX8',output:{components:['RB8'],railDecision:{connection:'upstream',reason:'explicit tradeoff',unresolved:[]}}};
  const d=amendDesign(before,{candidateId:'current',movePins:[{node:'RB8.1',from:'A',to:'B'}],replaceRecords:[{section:'peripheralAssessments',key:'RX8',record:output}],unresolved:{remove:['old assumption'],add:['new assumption']}});
  assert.deepEqual(before,original);assert.deepEqual(d.components,before.components);assert.deepEqual(d.nc,before.nc);
  assert.deepEqual(d.nets[0].nodes,['RX8.1']);assert.deepEqual(d.nets[1].nodes,['RX8.2','RB8.1']);
  assert.deepEqual(d.peripheralAssessments,[output]);assert.deepEqual(d.unresolved,['keep this','new assumption']);
});

test('stale source nets, duplicate moves, unknown/NC pins and unknown targets cannot modify a candidate',()=>{
  for(const moves of [[{node:'RB8.1',from:'SIG',to:'B'}],[{node:'RB8.1',from:'A',to:'missing'}],
    [{node:'RX8.3',from:'A',to:'B'}],[{node:'RB8.2',from:'SIG',to:'B'}],
    [{node:'RB8.1',from:'A',to:'B'},{node:'RB8.1',from:'A',to:'SIG'}]]){
    const d=base(),original=structuredClone(d);assert.throws(()=>amendDesign(d,{candidateId:'current',movePins:moves}));assert.deepEqual(d,original);
  }
});

test('record identity, component pins and supported edit surface remain bounded',()=>{
  const d=base();
  for(const replaceRecords of [[{section:'components',key:'RB8',record:{...d.components[0],ref:'RB9'}}],
    [{section:'components',key:'RB8',record:{...d.components[0],pins:[{number:'9'}]}}],
    [{section:'components',key:'RB8',record:{...d.components[0],x:100}}],
    [{section:'nets',key:'A',record:{name:'A',nodes:[]}}],
    [{section:'operatingPoints',key:'foreign',record:{id:'foreign'}}],
    [{section:'operatingPoints',key:'bias',record:{id:'bias'}},{section:'operatingPoints',key:'bias',record:{id:'bias'}}]])assert.throws(()=>amendDesign(d,{candidateId:'current',replaceRecords}));
  assert.throws(()=>amendDesign(d,{candidateId:'current',unresolved:{remove:['not present']}}));
  assert.throws(()=>amendDesign(d,{candidateId:'current'}));
  const updated=amendDesign(d,{candidateId:'current',replaceRecords:[{section:'components',key:'RB8',record:{...d.components[0],value:'22k'}}]});
  assert.equal(updated.components[0].value,'22k');
});
