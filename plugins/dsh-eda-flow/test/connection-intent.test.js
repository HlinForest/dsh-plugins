import test from 'node:test';
import assert from 'node:assert/strict';
import { connectionIntentInstructions, resolveConnectionIntent } from '../src/connection-intent.js';

const parts = [
  {id:'controller', ref:'U9', value:'controller', pins:[
    {number:'42', name:'DIN', type:'input', pad:'42'},
    {number:'7', name:'CLK', type:'input', pad:'7'},
    {number:'8', name:'NC', type:'no_connect', pad:'8'},
  ], extra:{sourceFactId:'fact-controller'}},
  {id:'header', ref:'J4', value:'header', pins:[
    {number:'1', name:'VIN', type:'power_in', pad:'1'},
    {number:'2', name:'GND', type:'power_in', pad:'2'},
  ]},
];

test('named endpoints resolve across nets, NC, and function checks without changing other fields', () => {
  const design = {
    components: parts,
    nets: [
      {name:'DATA', nodes:[{ref:' U9 ', pinName:' DIN '},{ref:'J4',pinNumber:'1'}], note:'keep'},
      {name:'LEGACY', nodes:['U9.7','J4.2'], custom:{owner:'test'}},
    ],
    nc:[{ref:'U9',pinName:'NC'}],
    functions:[{requirementId:'serial',description:'data path',checks:[{kind:'connected',nodes:[{ref:'U9',pinName:'DIN'},{ref:'J4',pinNumber:'1'}],detail:'keep'}],limitations:['timing pending']}],
    unresolved:['timing'], metadata:{board:'any'}
  };
  const before = structuredClone(design);
  const resolved = resolveConnectionIntent(design);
  assert.deepEqual(resolved.nets[0].nodes,['U9.42','J4.1']);
  assert.deepEqual(resolved.nets[1].nodes,['U9.7','J4.2']);
  assert.deepEqual(resolved.nc,['U9.8']);
  assert.deepEqual(resolved.functions[0].checks[0].nodes,['U9.42','J4.1']);
  assert.equal(resolved.nets[0].name,'DATA');
  assert.equal(resolved.nets[0].note,'keep');
  assert.deepEqual(resolved.nets[1].custom,{owner:'test'});
  assert.deepEqual(resolved.metadata,{board:'any'});
  assert.deepEqual(design,before);
});

test('source pin names follow the component pin numbering and do not assume a project reference', () => {
  const design = {components:[{ref:'IC_A',pins:[{number:'17',name:'OUT',type:'output',pad:'17'}]}],nets:[{name:'OUT_NET',nodes:[{ref:'IC_A',pinName:'OUT'}]}],nc:[],functions:[]};
  assert.deepEqual(resolveConnectionIntent(design).nets[0].nodes,['IC_A.17']);
});

test('duplicate names require an explicit pin number and unknown references/pins are actionable', () => {
  const design = {components:[{ref:'U2',pins:[{number:'1',name:'A',type:'input'},{number:'9',name:'A',type:'output'}]}],nets:[],nc:[],functions:[]};
  assert.throws(()=>resolveConnectionIntent({...design,nc:[{ref:'U2',pinName:'A'}]}),/不唯一.*pinNumber/);
  assert.deepEqual(resolveConnectionIntent({...design,nc:[{ref:'U2',pinNumber:'9'}]}).nc,['U2.9']);
  assert.throws(()=>resolveConnectionIntent({...design,nc:[{ref:'U3',pinName:'A'}]}),/未找到器件位号/);
  assert.throws(()=>resolveConnectionIntent({...design,nc:[{ref:'U2',pinName:'MISSING'}]}),/没有名为/);
});

test('endpoint objects reject ambiguous, empty, or unknown selector fields', () => {
  const design = {components:[{ref:'U1',pins:[{number:'1',name:'A',type:'input'}]}],nets:[],nc:[],functions:[]};
  for (const endpoint of [
    {ref:'U1',pinName:'A',pinNumber:'1'},
    {ref:'U1',pinName:''},
    {ref:'U1'},
    {ref:'U1',pinName:'A',extra:true},
    {ref:'U1',pinNumber:1},
  ]) assert.throws(()=>resolveConnectionIntent({...design,nc:[endpoint]}),/引脚端点/);
});

test('literal numeric endpoint strings remain byte-for-byte compatible even when validation will reject them later', () => {
  const design = {components:[{ref:'U1',pins:[{number:'1',name:'A',type:'input'}]}],nets:[{name:'legacy',nodes:['UNKNOWN.99',' U1.1 ']}],nc:[],functions:[]};
  const resolved = resolveConnectionIntent(design);
  assert.deepEqual(resolved.nets[0].nodes,['UNKNOWN.99',' U1.1 ']);
});

test('instructions describe role-level planning and exact named-pin conversion', () => {
  assert.match(connectionIntentInstructions,/功能角色规划/);
  assert.match(connectionIntentInstructions,/pinName/);
  assert.match(connectionIntentInstructions,/不唯一/);
});

