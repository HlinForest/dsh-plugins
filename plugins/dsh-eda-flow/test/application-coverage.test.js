import test from 'node:test';
import assert from 'node:assert/strict';
import {applicationCandidates,applicationCoverage,assertApplicationCoverage} from '../src/application-coverage.js';

const quote='Application example uses a 22 uF reservoir capacitor and a 100 nF bypass capacitor.';
const inputs={evidence:[{id:'p',document:'device.pdf',page:4,content:quote,sourceType:'pdf-text-extraction',sourceSha256:'source-a'}]};
const guidance=(statement=quote,sourceId='p',citation=quote)=>[{id:'g',statement,citations:[{sourceId,quote:citation}]}];

test('explicit passive values cannot be erased by omission or qualitative-only summaries',()=>{
  for(const g of [[],guidance('Use local bypass capacitors.'),guidance('Use a 100 nF bypass capacitor.')]){
    assert.throws(()=>assertApplicationCoverage(g,inputs),/22 uF/);
  }
  assert.equal(applicationCoverage(guidance(),inputs)[0].covered,true);
});
test('coverage accepts SI-equivalent statement values but requires the same source context',()=>{
  assert.equal(applicationCoverage(guidance('Use 22000 nF reservoir capacitance and 0.1 uF bypass capacitance.'),inputs)[0].covered,true);
  assert.equal(applicationCoverage(guidance(quote,'wrong'),inputs)[0].covered,false);
  const extended={evidence:[...inputs.evidence,{id:'other',content:quote,document:'other.pdf',page:4,sourceSha256:'other'}]};
  assert.equal(applicationCoverage(guidance(quote,'other'),extended)[0].covered,false);
});
test('derived table does not duplicate original page coverage and can cite the same page',()=>{
  const row={id:'table',page:4,sourceSha256:'source-a',sourceType:'pdf-table-extraction',content:'Capacitor=reservoir; value=22 uF; Bypass capacitor=100 nF'};
  const data={evidence:[...inputs.evidence,row]};
  assert.equal(applicationCandidates(data).length,1);
  assert.equal(applicationCoverage(guidance(quote,'table',row.content),data)[0].covered,true);
  row.page=5;
  assert.equal(applicationCoverage(guidance(quote,'table',row.content),data)[0].covered,false);
});
test('numeric mechanical facts and a quantity without passive context do not create obligations',()=>{
  assert.deepEqual(applicationCandidates({evidence:[{id:'x',content:'Body width 5 mm. The maximum supply voltage is 6 V.'}]}),[]);
  const denied='Do not fit a 220 nF bypass capacitor in this mode.';
  const d={evidence:[{id:'x',content:denied}]};
  assert.equal(applicationCoverage(guidance(denied,'x',denied),d)[0].covered,true);
});
test('a quote spanning several clauses covers its overlapping quantity without swallowing a different source clause',()=>{
  const source='Pin table\n1 Input\n2 Output\nInternal pull-up 12 kohm; output pull-down 3 kohm; input pull-up 6 kohm.';
  const citation='Internal pull-up 12 kohm; output pull-down 3 kohm; input pull-up 6 kohm.';
  const data={evidence:[{id:'x',content:source}]};
  assert(applicationCoverage(guidance(citation,'x',citation),data).every(r=>r.covered));
  const repeated={evidence:[{id:'x',content:'Input A bypass capacitor 100 nF; Input B bypass capacitor 100 nF.'}]};
  const rows=applicationCoverage(guidance('Input A bypass capacitor 100 nF','x','Input A bypass capacitor 100 nF'),repeated);
  assert.equal(rows[0].covered,true);assert.equal(rows[1].covered,false);
});
