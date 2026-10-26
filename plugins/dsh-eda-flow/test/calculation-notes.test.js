import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileCalculationNotes,currentCalculationNotes,reconcileDesignCalculationNotes,engineeringSummary} from '../src/calculation-notes.js';
const row={id:'filter',owner:'SENSOR',kind:'rc-filter',components:['FEED','LOCAL'],inputs:{deviceCurrent:{value:.002}},
 assumptions:['SENSOR.deviceCurrent: new current remains unverified'],calculations:[{voltageDropV:.04,deviceVoltageV:3.26,timeConstantS:2e-5}]};
test('obsolete input assumptions and wrong scalar conclusions leave current results but stay auditable',()=>{
 const old=['SENSOR.deviceCurrent: old current is 4mA','SENSOR 滤波压降≈0.08 V，τ≈20 us。','SENSOR 的输出耐压未知'];
 const r=reconcileCalculationNotes(old,[row]);assert.deepEqual(r.notes,[old[2]]);assert.equal(r.archived.length,2);
 assert(r.archived.every(x=>x.uncertaintiesResolved===false));assert(r.current[0].includes('0.04 V'));
 assert.deepEqual(reconcileCalculationNotes(r.notes,[row]).notes,r.notes);
});
test('rounded correct values, unrelated owners, and ambiguous prose are not silently removed',()=>{
 const notes=['SENSOR 压降≈40 mV，τ≈20 µs。','OTHER 压降≈0.08 V。','缺少噪声目标，不能确定电容数量。','SENSOR 输出上拉取 22kΩ 是否可用尚未确定。'];
 assert.deepEqual(reconcileCalculationNotes(notes,[row]).notes,notes);
 const ambiguous=[row,{...row,id:'other-filter',components:['OTHER'],calculations:[{voltageDropV:.08}]}];
 assert.deepEqual(reconcileCalculationNotes(['SENSOR 压降≈0.08 V。'],ambiguous).notes,['SENSOR 压降≈0.08 V。']);
});
test('current unverified input remains pending, and output text changes with the actual calculation',()=>{
 assert.equal(reconcileCalculationNotes(row.assumptions,[row]).archived.length,0);
 const next=structuredClone(row);next.calculations[0].voltageDropV=.07;
 assert(currentCalculationNotes([next])[0].includes('0.07 V'));assert(!currentCalculationNotes([next])[0].includes('0.04 V'));
});
test('obsolete basis arithmetic is corrected without dropping its unresolved conditions or touching source quotes',()=>{
 const text='SENSOR 供电压降约 0.08V，τ≈20us。资料未给推荐参数。';
 const d={peripheralAssessments:[{supply:{basis:text}}],operatingPoints:[{inputs:{quote:text}}]};
 const history=reconcileDesignCalculationNotes(d,[row]);assert.equal(history.length,1);assert.equal(history[0].text,text);
 assert(d.peripheralAssessments[0].supply.basis.includes('0.04 V'));assert(d.peripheralAssessments[0].supply.basis.includes('资料未给推荐参数'));
 assert.equal(d.operatingPoints[0].inputs.quote,text);assert.deepEqual(reconcileDesignCalculationNotes(d,[row]),[]);
});
test('published summary derives its inventory and limits from structured results without rephrasing arithmetic',()=>{
 const d={components:[{pins:[{},{}]}],nets:[{}]},review={operatingPoints:[row],unresolved:['unknown']};
 const summary=engineeringSummary(3,d,review);
 assert(summary.includes('1 个器件、2 个引脚、1 个原始网络'));assert(summary.includes('1 项工作点'));
 assert(summary.includes('1 项设计待核实'));assert(!summary.includes('0.105'));
});
