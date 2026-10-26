import test from 'node:test';
import assert from 'node:assert/strict';
import {extractFacts,resolveDesignFacts} from '../src/specification-facts.js';
import {validateSourceInventory} from '../src/source-inventory.js';
import {reviewCircuit} from '../src/circuit-review.js';
import {mechanicalCandidates,mechanicalCoverage,assertMechanicalCoverage} from '../src/mechanical-facts.js';

const quote='Two rows: row spacing 18.6mm; pin pitch 2.54mm; pad diameter 1.6mm; drill diameter 0.8mm. Pin 1 A passive, pin 2 K passive.';
const inputs={evidence:[{id:'source-a',document:'module.pdf',page:2,content:quote}]};
const fact={reference:'DS8',value:'module-x',componentKind:'display',objectRole:'electrical',
  pins:[{number:'1',name:'A',type:'passive'},{number:'2',name:'K',type:'passive'}],
  citations:[{sourceId:'source-a',quote}],
  mechanicalFacts:[['row-spacing',18.6],['pin-pitch',2.54],['pad-diameter',1.6],['drill-diameter',0.8]].map(([property,value])=>({property,value,unit:'mm',citations:[{sourceId:'source-a',quote}]}))};

test('actual fact ingestion retains cited physical dimensions separately from drawing coordinates',()=>{
  const result=extractFacts({componentFacts:[fact]},inputs)[0];
  assert.equal(result.mechanicalFacts.length,4);
  assert.equal(result.mechanicalFacts[0].value,18.6);
  assert.throws(()=>extractFacts({componentFacts:[{...fact,x:20}]},inputs),/绘图/);
});

const part=(ref,pins,librarySymbol='Evidence:Receiver')=>({ref,id:ref,value:ref,librarySymbol,pins:pins.map(([number,name,type])=>({number,name,type,pad:number})),on_board:true,in_bom:true});
const receiver=()=>({components:[
  part('RX8',[['1','OUT','output'],['2','GND','power_in'],['3','VCC','power_in']]),
  {...part('C8',[['1','1','passive'],['2','2','passive']],'Device:C'),value:'100nF',electricalRole:'decoupling'},
  part('U8',[['1','VDD','power_in'],['2','GND','power_in']],'IC:Generic')],
  nets:[{name:'PWR',nodes:['RX8.3','U8.1','C8.1']},{name:'RETURN',nodes:['RX8.2','U8.2','C8.2']},{name:'SIGNAL',nodes:['RX8.1']}],nc:[],functions:[]});
const evidence=[{reference:'RX8',symbolId:'Evidence:Receiver',componentKind:'infrared-receiver',pins:receiver().components[0].pins}];
test('receiver without output-bias and supply-filter decisions is not silently accepted',()=>{
  const r=reviewCircuit(receiver(),{evidence});
  assert(r.errors.some(e=>e.code==='peripheral-assessment-missing'));
});
test('shared-rail decoupling must identify its actual load owner before freezing',()=>{
  const r=reviewCircuit(receiver(),{evidence});
  assert(r.errors.some(e=>e.code==='decoupling-owner-missing'&&e.ref==='C8'));
});

test('omitted dimensions are caught at completion even when ordinary pins were extracted',()=>{
  const {mechanicalFacts,...without}=fact;
  assert.equal(mechanicalCandidates(inputs).length,4);
  assert.throws(()=>assertMechanicalCoverage(extractFacts({componentFacts:[without]},inputs),inputs),/已有物理尺寸/);
  const checked=extractFacts({componentFacts:[fact]},inputs);
  assertMechanicalCoverage(checked,inputs);
  assert.equal(mechanicalCoverage(checked,inputs).filter(r=>r.covered).length,4);
});
test('dimension validation rejects fabricated numbers and accepts equivalent units',()=>{
  const altered=structuredClone(fact);altered.mechanicalFacts[0].value=19;
  assert.throws(()=>extractFacts({componentFacts:[altered]},inputs),/数值未由/);
  altered.mechanicalFacts[0]={...altered.mechanicalFacts[0],value:1.86,unit:'cm'};
  assertMechanicalCoverage(extractFacts({componentFacts:[altered]},inputs),inputs);
});
test('confirmed physical dimensions cannot disappear or change during design expansion',()=>{
  const facts=extractFacts({componentFacts:[fact]},inputs);
  const project={inputs,stages:[{id:2,status:'done',result:{evidenceFacts:facts}}]};
  const d=resolveDesignFacts({components:[{sourceFactId:facts[0].id}]},project);
  assert.deepEqual(validateSourceInventory(d,facts),[]);
  d.components[0].mechanicalFacts=[];
  assert(validateSourceInventory(d,facts).some(e=>e.includes('物理尺寸遗漏')));
});

function reviewedReceiver(){
  const d=receiver();
  d.components.push({...part('R8',[['1','1','passive'],['2','2','passive']],'Device:R'),value:'150',electricalRole:'supply-filter'},
    {...part('R9',[['1','1','passive'],['2','2','passive']],'Device:R'),value:'15k',electricalRole:'pull-up'});
  d.nets=[{name:'PWR',nodes:['U8.1','R8.1','R9.1']},{name:'LOCAL',nodes:['RX8.3','R8.2','C8.1']},
    {name:'RETURN',nodes:['RX8.2','U8.2','C8.2']},{name:'SIGNAL',nodes:['RX8.1','R9.2']}];
  d.supplied_nets=['PWR','RETURN','LOCAL'];
  d.functions=[{layout:[{kind:'decoupling',anchor:'RX8.3',return:'RX8.2',members:['C8']}]}];
  d.peripheralAssessments=[{ref:'RX8',pins:{supply:'3',return:'2',output:'1'},
    supply:{strategy:'filtered',components:['R8','C8'],basis:'Engineering filter candidate',unresolved:['Supply current and transient drop require verification']},
    output:{strategy:'external-pull-up',components:['R9'],basis:'Engineering bias candidate',unresolved:['Output sink current and edge rate require verification']}}];
  return d;
}
test('a real filter and pull-up are retained as a candidate with explicit unknowns',()=>{
  const d=reviewedReceiver(),r=reviewCircuit(d,{evidence});
  assert.deepEqual(r.errors,[]);
  assert.equal(r.peripheralAssessments[0].status,'needs-review');
  assert.equal(r.decouplingOwners[0].anchor,'RX8.3');
  assert.equal(r.readiness.ready,false);
});
test('wrong-net filter and pull-down cannot be borrowed as receiver peripherals',()=>{
  const d=reviewedReceiver();
  d.nets.find(n=>n.name==='PWR').nodes=d.nets.find(n=>n.name==='PWR').nodes.filter(n=>!['R8.1','R9.1'].includes(n));
  d.nets.find(n=>n.name==='RETURN').nodes.push('R8.1','R9.1');
  const r=reviewCircuit(d,{evidence});
  assert(r.errors.some(e=>e.code==='peripheral-filter-path-missing'));
  assert(r.errors.some(e=>e.code==='peripheral-pull-up-path-missing'));
});
test('an unknown output may be deferred but not called push-pull without source evidence',()=>{
  const d=reviewedReceiver();
  d.peripheralAssessments[0].output={strategy:'push-pull',components:[],basis:'OUT output',unresolved:[]};
  assert(reviewCircuit(d,{evidence}).errors.some(e=>e.code==='peripheral-omission-source-missing'));
  d.peripheralAssessments[0].output={strategy:'unresolved',components:[],basis:'Output stage is absent from supplied PDF',unresolved:['Output stage needs the actual manufacturer specification']};
  const r=reviewCircuit(d,{evidence});assert.deepEqual(r.errors,[]);assert.equal(r.readiness.ready,false);
});
test('decoupling ownership cannot move a capacitor onto an unrelated load rail',()=>{
  const d=reviewedReceiver();d.functions[0].layout[0].anchor='U8.1';d.functions[0].layout[0].return='U8.2';
  const r=reviewCircuit(d,{evidence});
  assert(r.errors.some(e=>e.code==='decoupling-topology-invalid'));
  assert(r.errors.some(e=>e.code==='peripheral-filter-path-missing'));
});
