import test from 'node:test';
import assert from 'node:assert/strict';
import {mechanicalCandidates,mechanicalCoverage,validateMechanicalFacts} from '../src/mechanical-facts.js';

const row=['pin pitch','Center spacing 2.54mm.'];
const quote='行1: Item=pin pitch; Detail=Center spacing 2.54mm.';
const page={id:'page',sourceType:'pdf-text-extraction',sourceSha256:'sha-a',page:2,content:row.join('  ')};
const table={id:'table',sourceType:'pdf-table-extraction',sourceSha256:'sha-a',page:2,content:quote,table:{rows:[['Item','Detail'],row]}};
const inputs={evidence:[page,table]};
const fact={property:'pitch',value:2.54,unit:'mm',citations:[{sourceId:'table',quote}]};

test('same-page table row covers original physical fact without duplicate source obligations',()=>{
  const checked=validateMechanicalFacts([fact],inputs);
  assert.equal(mechanicalCandidates(inputs).length,1);
  assert.deepEqual(mechanicalCoverage([{mechanicalFacts:checked}],inputs).map(r=>r.covered),[true]);
});

test('same number from another row, page or document cannot cover the original dimension',()=>{
  for(const change of [
    {page:3},{sourceSha256:'sha-b'},
    {content:'pad diameter 2.54mm.',table:{rows:[['Item','Detail'],['pad diameter','2.54mm.']]}}
  ]){
    const changed={...table,...change};
    const altered={evidence:[page,changed]};
    const f={...fact,citations:[{sourceId:'table',quote:changed.content}]};
    assert.equal(mechanicalCoverage([{mechanicalFacts:[f]}],altered).find(r=>r.sourceId==='page').covered,false);
  }
});

test('table-only or unmatched table dimensions remain coverage candidates',()=>{
  const alone={evidence:[table]};
  assert.equal(mechanicalCandidates(alone).length,1);
  assert.equal(mechanicalCoverage([{mechanicalFacts:[fact]}],alone)[0].covered,true);
  const extra={...table,content:quote+'\n行2: Item=pad diameter; Detail=1.6mm.',
    table:{rows:[...table.table.rows,['pad diameter','1.6mm.']]}};
  const candidates=mechanicalCandidates({evidence:[page,extra]});
  assert.equal(candidates.length,2);
  assert(candidates.some(r=>r.value===1.6));
});
