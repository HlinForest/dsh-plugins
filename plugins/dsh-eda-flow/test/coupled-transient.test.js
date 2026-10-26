import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewOperatingPoints} from '../src/operating-points.js';
const input=(value,unit)=>({value,unit,basis:{assumption:'Declared operating scenario'}});
const pin=(number,name,type='passive')=>({number:String(number),name,type});
const passive=(ref,value,kind,role)=>({ref,value,librarySymbol:'Device:'+kind,electricalRole:role,pins:[pin(1,'1'),pin(2,'2')]});
function circuit(){
  return {components:[{ref:'RX',librarySymbol:'Receiver:Generic',pins:[pin(1,'OUT','output'),pin(2,'GND','power_in'),pin(3,'VCC','power_in')]},
      passive('FEED','100R','R','supply-filter'),passive('BIAS','1k','R','pull-up'),passive('STORE','1uF','C','decoupling')],
    nets:[{name:'P',nodes:['FEED.1']},{name:'L',nodes:['FEED.2','RX.3','BIAS.1','STORE.1']},
      {name:'G',nodes:['RX.2','STORE.2']},{name:'S',nodes:['RX.1','BIAS.2']}],
    functions:[{layout:[{kind:'decoupling',anchor:'RX.3',return:'RX.2',members:['STORE']}]}],
    peripheralAssessments:[{ref:'RX',pins:{supply:'3',return:'2',output:'1'},supply:{components:['FEED','STORE']},output:{components:['BIAS']}}],
    operatingPoints:[{id:'filter',kind:'rc-filter',owner:'RX',components:['FEED','STORE'],inputs:{supplyVoltage:input(5,'V'),deviceCurrent:input(.5,'mA'),minDeviceVoltage:input(3,'V')}},
      {id:'bias',kind:'pull-up',owner:'RX',components:['BIAS'],inputs:{supplyVoltage:input(5,'V'),lowVoltage:input(.4,'V'),maxSinkCurrent:input(10,'mA')}},
      {id:'storage',kind:'supply-transient',owner:'RX',components:['STORE'],loadStepScope:'excluding-pull-ups',inputs:{
        loadStepCurrent:input(1,'mA'),supportTime:input(10,'us'),maxDroop:input(.03,'V'),effectiveCapacitanceRatio:input(1,'ratio'),equivalentEsr:input(.1,'ohm')}}]};
}
const storage=r=>r.results.find(row=>row.id==='storage');
const near=(a,b)=>assert(Math.abs(a-b)<Math.max(1e-14,Math.abs(b)*1e-10),`${a} != ${b}`);
test('legacy whole-domain input cannot silently omit or double-count physical pull-ups',()=>{
  const d=circuit();delete d.operatingPoints[2].loadStepScope;
  const r=reviewOperatingPoints(d);
  assert(r.errors.some(e=>e.id==='storage'&&e.message.includes('loadStepScope')));
  assert.equal(storage(r).status,'invalid');
});
test('switching load uses source-voltage bound, not the lower DC equilibrium',()=>{
  const r=reviewOperatingPoints(circuit()),s=storage(r);
  near(s.calculations[0].pullUpStepCurrentA,.005);
  near(s.calculations[0].totalLoadStepCurrentA,.006);
  near(s.calculations[0].transientDroopV,.0606);
  assert(r.errors.some(e=>e.id==='storage'&&e.code==='operating-limit-exceeded'));
  assert.deepEqual(s.coupling.relatedOperatingPoints,['bias','filter','storage']);
  assert(s.coupling.assumptions.length);
});
test('raising actual capacitance fixes a rejected budget; zero base step can represent pull-only switching',()=>{
  const d=circuit();d.components.find(c=>c.ref==='STORE').value='10uF';
  const r=reviewOperatingPoints(d);assert.deepEqual(r.errors,[]);
  near(storage(r).calculations[0].transientDroopV,.0066);
  d.operatingPoints[2].inputs.loadStepCurrent.value=0;
  const pullOnly=reviewOperatingPoints(d);assert.deepEqual(pullOnly.errors,[]);
  near(storage(pullOnly).calculations[0].totalLoadStepCurrentA,.005);
});
test('upstream pull-ups are not charged to the filtered capacitor domain',()=>{
  const d=circuit();d.nets[1].nodes=d.nets[1].nodes.filter(p=>p!=='BIAS.1');d.nets[0].nodes.push('BIAS.1');
  const r=reviewOperatingPoints(d);assert.deepEqual(r.errors,[]);
  near(storage(r).calculations[0].pullUpStepCurrentA,0);
  near(storage(r).calculations[0].transientDroopV,.0101);
});
test('missing or repeated pull models invalidate storage instead of falling back to base current',()=>{
  for(const edit of [d=>d.operatingPoints.splice(1,1),d=>d.operatingPoints.push({...structuredClone(d.operatingPoints[1]),id:'second-bias'})]){
    const d=circuit();edit(d);const r=reviewOperatingPoints(d);
    assert(r.errors.some(e=>e.id==='storage'));assert.equal(storage(r).status,'invalid');
  }
});
test('effective zero-ohm domains and row order preserve the load sum',()=>{
  const d=circuit();d.components.push(passive('LINK','0R','R','routing-bridge'));
  d.nets[1].nodes=d.nets[1].nodes.filter(p=>p!=='BIAS.1');d.nets[1].nodes.push('LINK.1');d.nets.push({name:'BIAS_PWR',nodes:['BIAS.1','LINK.2']});
  d.operatingPoints.reverse();near(storage(reviewOperatingPoints(d)).calculations[0].pullUpStepCurrentA,.005);
});
test('parallel pulls are included once and same-domain storage conditions must agree',()=>{
  const d=circuit();d.components.push(passive('BIAS2','1k','R','pull-up'));d.nets[1].nodes.push('BIAS2.1');d.nets[3].nodes.push('BIAS2.2');
  d.peripheralAssessments[0].output.components.push('BIAS2');d.operatingPoints[1].components.push('BIAS2');
  d.components.find(c=>c.ref==='STORE').value='10uF';
  const parallel=reviewOperatingPoints(d);assert.deepEqual(parallel.errors,[]);
  near(storage(parallel).calculations[0].pullUpStepCurrentA,.01);
  // Use an ideal source domain to isolate shared-capacitor consistency from RC load modelling.
  d.components=d.components.filter(c=>c.ref!=='FEED');d.nets=d.nets.filter(n=>n.name!=='P');
  d.nets[0].nodes=d.nets[0].nodes.filter(k=>k!=='FEED.2');d.operatingPoints.shift();
  d.peripheralAssessments[0].supply.components=['STORE'];
  d.components.push({ref:'PEER',librarySymbol:'Logic:Peer',pins:[pin(1,'VDD','power_in'),pin(2,'GND','power_in')]},passive('PEER_CAP','100nF','C','decoupling'));
  d.nets[0].nodes.push('PEER.1','PEER_CAP.1');d.nets[1].nodes.push('PEER.2','PEER_CAP.2');
  d.functions.push({layout:[{kind:'decoupling',anchor:'PEER.1',return:'PEER.2',members:['PEER_CAP']}]});
  const base=d.operatingPoints.find(p=>p.id==='storage');base.components.push('PEER_CAP');
  d.operatingPoints.push({...structuredClone(base),owner:'PEER',id:'peer'});
  assert.deepEqual(reviewOperatingPoints(d).errors,[]);
  d.operatingPoints.at(-1).inputs.loadStepCurrent.value=2;
  const r=reviewOperatingPoints(d);
  for(const id of ['storage','peer'])assert(r.errors.some(e=>e.id===id&&e.message.includes('必须一致')));
});
test('source-connected capacitors also include real pull-up switching and reject a zero total step',()=>{
  const d=circuit();d.components=d.components.filter(c=>c.ref!=='FEED');
  d.nets=d.nets.filter(n=>n.name!=='P');d.nets[0].nodes=d.nets[0].nodes.filter(k=>k!=='FEED.2');
  d.peripheralAssessments[0].supply.components=['STORE'];d.operatingPoints.shift();
  const r=reviewOperatingPoints(d);near(storage(r).calculations[0].pullUpStepCurrentA,.005);
  d.operatingPoints=d.operatingPoints.filter(p=>p.id!=='bias');d.components=d.components.filter(c=>c.ref!=='BIAS');
  for(const n of d.nets)n.nodes=n.nodes.filter(k=>!k.startsWith('BIAS.'));
  d.operatingPoints[0].inputs.loadStepCurrent.value=0;
  assert(reviewOperatingPoints(d).errors.some(e=>e.id==='storage'&&e.message.includes('必须大于零')));
});
test('a loose droop budget cannot bypass the actual minimum device voltage',()=>{
  const d=circuit();d.components.find(c=>c.ref==='BIAS').value='100k';
  d.operatingPoints[0].inputs.minDeviceVoltage.value=4.9;
  d.operatingPoints[2].inputs.maxDroop.value=1;d.operatingPoints[2].inputs.loadStepCurrent.value=10;
  const r=reviewOperatingPoints(d);assert(r.errors.some(e=>e.id==='storage'&&e.message.includes('电压下界')));
});
test('filtered pull-up sink limit covers switching before the supply settles',()=>{
  const d=circuit();d.components.find(c=>c.ref==='FEED').value='1k';
  d.operatingPoints[0].inputs.minDeviceVoltage.value=2;d.operatingPoints[1].inputs.maxSinkCurrent.value=3;
  const r=reviewOperatingPoints(d),p=r.results.find(row=>row.id==='bias');
  assert(p.calculations[0].sinkCurrentA<.003);
  near(p.calculations[0].switchingSinkCurrentBoundA,.005);
  assert(r.errors.some(e=>e.id==='bias'&&e.message.includes('切换灌电流')));
});

test('maximum low-voltage rating cannot reduce the switching current envelope',()=>{
  const d=circuit();d.operatingPoints[1].inputs.lowVoltage.value=1;
  const r=reviewOperatingPoints(d);
  near(storage(r).calculations[0].pullUpStepCurrentA,.005);
  assert.equal(storage(r).coupling.contributions[0].assumedMinimumLowVoltageV,0);
  assert(r.unresolved.some(s=>s.includes('输出不低于返回端 0 V')));
});
