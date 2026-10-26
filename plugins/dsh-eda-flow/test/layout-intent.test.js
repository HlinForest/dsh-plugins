import test from 'node:test';
import assert from 'node:assert/strict';
import {validateDesign} from '../src/design-intent.js';
import {resolveConnectionIntent} from '../src/connection-intent.js';

const requirements = [{id:'supply',description:'Local supply bypass'}];
function candidate() {
  const part = (ref, names, types) => ({id:ref,ref,value:ref,mpn:'',footprint:'',librarySymbol:'Test:'+ref,dnp:false,in_bom:true,on_board:true,pins:names.map((name,i)=>({number:String(i+1),pad:String(i+1),name,type:types?.[i]||'passive'}))});
  return {components:[part('U7',['VDD','GND','DATA'],['power_in','power_in','input']),part('C31',['1','2']),part('C32',['1','2']),part('J8',['VCC','GND'])],
    nets:[{name:'SUPPLY',nodes:['U7.1','C31.1','C32.1','J8.1']},{name:'RETURN',nodes:['U7.2','C31.2','C32.2','J8.2']}],nc:['U7.3'],supplied_nets:['SUPPLY','RETURN'],
    functions:[{requirementId:'supply',description:'Supply bypass',checks:[{kind:'connected',nodes:['U7.1','C31.1']}],limitations:[],layout:[{kind:'decoupling',anchor:'U7.1',return:'U7.2',members:['C31','C32']}]}],unresolved:[]};
}

test('decoupling ownership resolves named pins and leaves electrical connectivity unchanged',()=>{
  const d=candidate(), before=structuredClone(d);
  d.functions[0].layout[0].anchor={ref:'U7',pinName:'VDD'};
  d.functions[0].layout[0].return={ref:'U7',pinName:'GND'};
  const resolved=resolveConnectionIntent(d);
  assert.deepEqual(resolved.functions[0].layout,before.functions[0].layout);
  assert.deepEqual(resolved.nets,before.nets);
  assert.deepEqual(validateDesign(resolved,requirements),[]);
  assert.equal(typeof d.functions[0].layout[0].anchor,'object');
});

test('layout ownership rejects nonexistent pins, cross-device anchors, NC and wrong supply pairs',()=>{
  for(const mutate of [
    d=>{d.functions[0].layout[0].anchor='U7.99';},
    d=>{d.functions[0].layout[0].return='J8.2';},
    d=>{d.functions[0].layout[0].return='U7.3';},
    d=>{d.functions[0].layout[0].return='U7.1';},
    d=>{d.nets[1].nodes=d.nets[1].nodes.filter(x=>x!=='C31.2');d.nets.push({name:'OTHER',nodes:['C31.2']});},
  ]) {const d=candidate();mutate(d);assert.ok(validateDesign(d,requirements).some(x=>/布局归属/.test(x)));}
});

test('layout ownership is a semantic contract, never coordinates or an unchecked duplicate member',()=>{
  for(const mutate of [
    d=>{d.functions[0].layout[0].x=10;},
    d=>{d.functions[0].layout[0].kind='absolute';},
    d=>{d.functions[0].layout[0].members=['UNKNOWN'];},
    d=>{d.functions[0].layout[0].members=['C31','C31'];},
    d=>{d.functions[0].layout.push(structuredClone(d.functions[0].layout[0]));},
    d=>{d.functions[0].layout[0].members=['U7'];},
    d=>{d.components[1].pins[0].type='output';},
    d=>{d.functions[0].layout={};},
  ]) {const d=candidate();mutate(d);assert.ok(validateDesign(d,requirements).some(x=>/布局归属/.test(x)));}
});

test('older designs without ownership metadata remain valid',()=>{
  const d=candidate();delete d.functions[0].layout;
  assert.deepEqual(validateDesign(d,requirements),[]);
});
