import test from 'node:test';
import assert from 'node:assert/strict';
import {passiveSelections} from '../src/passive-selections.js';
const d={components:[{ref:'BIAS',librarySymbol:'Device:R',value:'12k',electricalRole:'pull-up'},
 {ref:'BYPASS',librarySymbol:'Device:C',value:'100nF',electricalRole:'decoupling'},
 {ref:'RESERVOIR',librarySymbol:'Device:C',value:'10uF',electricalRole:'other'}]};
const operating={results:[{id:'bias',kind:'pull-up',components:['BIAS'],status:'needs-review',inputs:{maxSinkCurrent:{kind:'assumption',assumption:'unknown output capability'}},assumptions:['unknown output capability']},
 {id:'bulk',kind:'supply-transient',components:['BYPASS','RESERVOIR'],status:'needs-review',inputs:{supportTime:{kind:'assumption',assumption:'unknown regulator response'}},assumptions:['unknown regulator response']} ]};
test('source-recommended bypass is separate from a bank sized only under assumptions',()=>{
 const context={guidance:[{id:'g',statement:'Use a 100nF capacitor.',category:'supply',subject:'Bypass',citations:[{sourceId:'s',quote:'Use a 100nF capacitor.'}]}]};
 const design={...d,operatingPoints:[{id:'bulk'}],applicationDecisions:[{guidanceId:'g',action:'adopt',components:['BYPASS'],reason:'Use documented bypass',operatingPoints:['bulk'],unresolved:['effective capacitance unknown']}]};
 const r=passiveSelections(design,operating,context);
 assert.equal(r.find(x=>x.ref==='BYPASS').status,'source-recommended');
 assert.equal(r.find(x=>x.ref==='RESERVOIR').status,'provisional');
 assert.equal(r.find(x=>x.ref==='BIAS').status,'provisional');
 assert(r.every(x=>x.performanceVerified===false));
 assert(r.find(x=>x.ref==='BIAS').missing.some(x=>x.includes('上升时间')));
 assert(r.find(x=>x.ref==='RESERVOIR').missing.some(x=>x.includes('只数')));
});
test('stale or fabricated component selection metadata cannot certify the value',()=>{
 const design=structuredClone(d);design.components[0].valueSelection={status:'approved'};
 assert.equal(passiveSelections(design,operating)[0].status,'provisional');
 assert.equal(passiveSelections(design,{results:[]})[0].status,'unresolved');
});
