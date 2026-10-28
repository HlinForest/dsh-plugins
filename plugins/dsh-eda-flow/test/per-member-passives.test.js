import test from 'node:test';
import assert from 'node:assert/strict';
import {compilePassiveObligations,reviewPassiveCoverage} from '../src/passive-coverage.js';
const context=quote=>({inputs:{evidence:[{id:'page',content:quote}]},guidance:[{id:'g',category:'peripheral',statement:quote,citations:[{sourceId:'page',quote}]}]});

test('a value per explicitly listed signal counts the complete list',()=>{
  const c=context('通讯口 A_DATA、B_CLOCK、C_LATCH 各有一颗 220pF 电容到 GND。');
  const rows=compilePassiveObligations(c);
  assert.equal(rows.length,1);assert.equal(rows[0].quantity,3);
  const r=reviewPassiveCoverage({components:['CA','CB','CC'].map(ref=>({ref,value:'220pF',librarySymbol:'Device:C'}))},c);
  assert.equal(r.coverage[0].status,'satisfied');assert.deepEqual(r.warnings,[]);
});

test('per-member quantities multiply and unknown group size remains unresolved',()=>{
  assert.equal(compilePassiveObligations(context('SENSOR_A、SENSOR_B 各放置两颗 10nF 电容。'))[0].quantity,4);
  for(const quote of ['每个输入各有一颗 100pF 电容。','Each input has one 100pF capacitor.']){
    const row=compilePassiveObligations(context(quote))[0];
    assert.equal(row.scope,'ambiguous',quote);assert.equal(row.quantity,undefined,quote);
  }
});

test('recommendation surplus is never called a user requirement',()=>{
  const r=reviewPassiveCoverage({components:[{ref:'CA',value:'100pF'},{ref:'CB',value:'100pF'}]},context('推荐一个100pF电容。'));
  assert(r.warnings.length);assert(r.warnings.every(w=>!w.includes('用户要求')));
});

test('a true minimum may be exceeded, while unresolved per-member minima are not treated as a total',()=>{
  const r=reviewPassiveCoverage({components:['C1','C2','C3'].map(ref=>({ref,value:'100pF'}))},context('至少两个100pF电容。'));
  assert.equal(r.coverage[0].status,'satisfied');
  for(const quote of ['A、B 各至少一颗100pF电容。','A、A各有一颗100pF电容。'])assert.equal(compilePassiveObligations(context(quote))[0].scope,'ambiguous');
});
