import test from 'node:test';
import assert from 'node:assert/strict';
import {extractFacts,sourceEvidence,resolveDesignFacts} from '../src/specification-facts.js';
import {validateSourceInventory} from '../src/source-inventory.js';

const inputs={evidence:[{id:'spec',content:'Reference *; module X with pin 1 A passive and pin 2 K passive.'}]};
const fact={reference:'*',value:'X',componentKind:'display',objectRole:'electrical',
  pins:[{number:'1',name:'A',type:'passive'},{number:'2',name:'K',type:'passive'}],
  citations:[{sourceId:'spec',quote:inputs.evidence[0].content}]};

test('a source placeholder is retained as provenance, not a mandatory circuit reference',()=>{
  const f=extractFacts({componentFacts:[fact]},inputs)[0];
  assert.equal(f.reference,'');assert.equal(f.sourceReference,'*');
  const p={inputs,stages:[{id:2,status:'done',result:{evidenceFacts:[f]}}]};
  const d=resolveDesignFacts({components:[{sourceFactId:f.id,ref:'DS9'}]},p);
  assert.equal(d.components[0].ref,'DS9');
  assert.deepEqual(validateSourceInventory(d,sourceEvidence(p)),[]);
});

test('persisted older placeholder facts can be selected without rewriting saved evidence',()=>{
  const f={...extractFacts({componentFacts:[fact]},inputs)[0],reference:'*'};
  const p={inputs,stages:[{id:2,status:'done',result:{evidenceFacts:[f]}}]};
  const d=resolveDesignFacts({components:[{sourceFactId:f.id,ref:'DS7'}]},p);
  assert.deepEqual(validateSourceInventory(d,sourceEvidence(p)),[]);
  assert.equal(p.stages[0].result.evidenceFacts[0].reference,'*');
  assert.throws(()=>resolveDesignFacts({components:[{sourceFactId:f.id}]},p),/分配位号/);
});

test('real assigned references remain mandatory; multiple placeholders do not collide',()=>{
  const assigned=extractFacts({componentFacts:[{...fact,reference:'DISP'}]},inputs)[0];
  assert(validateSourceInventory({components:[]},[assigned]).some(e=>e.includes('DISP')));
  const fs=extractFacts({componentFacts:[fact,{...fact,value:'Y',reference:'?'}]},inputs);
  assert(fs.every(f=>f.reference===''));assert.equal(fs.length,2);
  assert.throws(()=>extractFacts({componentFacts:[{...fact,reference:'J1'},{...fact,reference:'J1'}]},inputs),/重复/);
});
