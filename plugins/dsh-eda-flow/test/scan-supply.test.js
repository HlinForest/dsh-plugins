import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewOperatingPoints} from '../src/operating-points.js';
const input=(value,unit)=>({value,unit,basis:{assumption:'Declared scenario, awaiting measurement'}});
const pin=(n,type='passive')=>({number:String(n),name:String(n),type});
const part=(ref,value,kind,role)=>({ref,value,librarySymbol:'Device:'+kind,electricalRole:role,pins:[pin(1),pin(2)]});
export function scanned(){
 return {components:[{ref:'DRV',pins:[pin(1,'power_in'),pin(2,'power_in'),pin(3,'output'),pin(4,'output'),pin(5,'output'),pin(6,'output')]},
  {ref:'LED',pins:[pin(1),pin(2),pin(3),pin(4)]},part('A','330R','R','current-limit'),part('B','330R','R','current-limit'),part('C','10uF','C','decoupling')],
  nets:[{name:'P',nodes:['DRV.1','C.1']},{name:'G',nodes:['DRV.2','C.2']},
   {name:'S1',nodes:['DRV.3','A.1']},{name:'S2',nodes:['DRV.4','B.1']},
   {name:'L1',nodes:['A.2','LED.1']},{name:'L2',nodes:['B.2','LED.2']},
   {name:'K1',nodes:['LED.3','DRV.5']},{name:'K2',nodes:['LED.4','DRV.6']}],
  functions:[{layout:[{kind:'decoupling',anchor:'DRV.1',return:'DRV.2',members:['C']}]}],
  loadAssessments:[{ref:'LED',components:['A','B'],currentControl:'resistor'}],
  operatingPoints:[{id:'scan',kind:'resistor-load',owner:'LED',driver:'DRV',components:['A','B'],inputs:{
   supplyVoltage:input(5,'V'),forwardVoltage:input(2,'V'),driverDrop:input(.3,'V'),duty:input(.25,'ratio'),scanSlots:input(4,'count'),maxPeakCurrent:input(50,'mA'),maxGroupCurrent:input(200,'mA')}},
   {id:'supply',kind:'supply-transient',owner:'DRV',components:['C'],loadStepScope:'excluding-derived-loads',inputs:{
    loadStepCurrent:input(0,'A'),supportTime:input(10,'us'),maxDroop:input(.25,'V'),effectiveCapacitanceRatio:input(.5,'ratio'),equivalentEsr:input(.05,'ohm')}}]};
}
const near=(a,b)=>assert(Math.abs(a-b)<1e-12,`${a} != ${b}`);
const row=(r,id)=>r.results.find(x=>x.id===id);
test('actual branch values drive the supply charge budget; digit duty never discounts the peak step',()=>{
 const d=scanned(),a=reviewOperatingPoints(d);assert.deepEqual(a.errors,[]);
 near(row(a,'supply').calculations[0].scanLoadStepCurrentA,10/330);
 near(row(a,'scan').scan.nominalOnCurrentA,5.4/330);
 near(row(a,'scan').scan.nominalAverageRailCurrentA,5.4/330*.5);
 d.components.find(c=>c.ref==='A').value='270R';
 const b=reviewOperatingPoints(d);assert.deepEqual(b.errors,[]);
 assert(row(b,'supply').calculations[0].requiredNominalCapacitanceF>row(a,'supply').calculations[0].requiredNominalCapacitanceF);
 d.operatingPoints[0].inputs.duty.value=.125;
 const c=reviewOperatingPoints(d);near(row(c,'supply').calculations[0].scanLoadStepCurrentA,row(b,'supply').calculations[0].scanLoadStepCurrentA);
 assert(row(c,'scan').scan.nominalAverageRailCurrentA<row(b,'scan').scan.nominalAverageRailCurrentA);
});
test('a previously nominally passing small capacitor is rejected by the linked current bound',()=>{
 const d=scanned();d.components.find(c=>c.ref==='C').value='1.5uF';
 const r=reviewOperatingPoints(d);assert(r.errors.some(e=>e.id==='supply'&&e.code==='operating-limit-exceeded'));
});
test('omitted scan declaration, hand-entered duplicate load and wrong driver cannot bypass coupling',()=>{
 for(const edit of [d=>d.operatingPoints.shift(),d=>delete d.operatingPoints[0].driver,d=>d.operatingPoints[0].driver='LED',
  d=>d.operatingPoints[1].loadStepScope='excluding-pull-ups',d=>d.operatingPoints[0].inputs.scanSlots.value=1,
  d=>d.operatingPoints[0].inputs.duty.value=.5,d=>d.operatingPoints.push({...structuredClone(d.operatingPoints[0]),id:'twice'})]){
  const d=scanned();edit(d);assert(reviewOperatingPoints(d).errors.length);
 }
});
test('zero-ohm return bridge and renamed components remain linked; no board identity or positions required',()=>{
 const d=scanned();d.components.push(part('LINK','0R','R','routing-bridge'));
 d.nets.find(n=>n.name==='K1').nodes=['LED.3','LINK.1'];d.nets.push({name:'K1D',nodes:['LINK.2','DRV.5']});
 d.operatingPoints.reverse();const r=reviewOperatingPoints(d);assert.deepEqual(r.errors,[]);
 near(row(r,'supply').calculations[0].scanLoadStepCurrentA,10/330);
});
test('single test-point output voltage is not a source-backed fixed driver drop',()=>{
 const d=scanned(),quote='测试条件 VDD=5V, Vo=0.3V, IOL=80mA';
 d.operatingPoints[0].inputs.driverDrop={value:.3,unit:'V',basis:{sourceId:'test',quote}};
 const r=reviewOperatingPoints(d,{evidence:[{id:'test',content:quote}]});
 assert(r.errors.some(e=>e.id==='scan'&&e.message.includes('测试')));
});
test('upper current, not nominal voltage subtraction, constrains branch and shared return limits',()=>{
 const d=scanned();d.operatingPoints[0].inputs.maxPeakCurrent=input(10,'mA');
 const r=reviewOperatingPoints(d);assert(row(r,'scan').calculations[0].peakCurrentA<.01);
 assert(r.errors.some(e=>e.id==='scan'&&e.code==='operating-limit-exceeded'));
 delete d.operatingPoints[0].inputs.maxPeakCurrent;d.operatingPoints[0].unresolvedLimits=['branch-current'];d.operatingPoints[0].inputs.maxGroupCurrent=input(25,'mA');
 assert(reviewOperatingPoints(d).errors.some(e=>e.id==='scan'&&e.message.includes('公共')));
});
test('scan current limits must be evaluated or explicitly unresolved, never silently absent',()=>{
 const d=scanned();delete d.operatingPoints[0].inputs.maxPeakCurrent;delete d.operatingPoints[0].inputs.maxGroupCurrent;
 assert(reviewOperatingPoints(d).errors.some(e=>e.id==='scan'));
 d.operatingPoints[0].unresolvedLimits=['branch-current','common-current'];
 const r=reviewOperatingPoints(d);assert.deepEqual(r.errors,[]);assert(r.unresolved.some(s=>s.includes('电流上限未确定')));
});
test('signed absolute maximum sourcing current is a magnitude ceiling, not an operating-current target',()=>{
 const d=scanned(),quote='输出绝对最大电流 IO = -50mA，不作为正常工作保证';
 d.operatingPoints[0].inputs.maxPeakCurrent={value:50,unit:'mA',basis:{sourceId:'rating',quote}};
 const r=reviewOperatingPoints(d,{evidence:[{id:'rating',content:quote}]});assert.deepEqual(r.errors,[]);
 assert.equal(row(r,'scan').inputs.maxPeakCurrent.qualification,'quantity-only');
 d.components.find(c=>c.ref==='A').value='47R';
 assert(reviewOperatingPoints(d,{evidence:[{id:'rating',content:quote}]}).errors.some(e=>e.id==='scan'&&e.code==='operating-limit-exceeded'));
});
test('changing a scan resistor propagates through the actual upstream reservoir into a filtered receiver',()=>{
 const d=scanned();d.components.push({ref:'RX',pins:[pin(1,'output'),pin(2,'power_in'),pin(3,'power_in')]},
  part('F','100R','R','supply-filter'),part('FC','1uF','C','decoupling'));
 d.nets[0].nodes.push('F.1');d.nets[1].nodes.push('RX.2','FC.2');
 d.nets.push({name:'LOCAL',nodes:['F.2','RX.3','FC.1']},{name:'OUT',nodes:['RX.1']});
 d.functions.push({layout:[{kind:'decoupling',anchor:'RX.3',return:'RX.2',members:['FC']}]});
 d.peripheralAssessments=[{ref:'RX',pins:{supply:'3',return:'2',output:'1'},supply:{components:['F','FC']},output:{components:[]}}];
 d.operatingPoints.push({id:'filter',kind:'rc-filter',owner:'RX',components:['F','FC'],inputs:{supplyVoltage:input(5,'V'),deviceCurrent:input(.6,'mA'),minDeviceVoltage:input(4.5,'V')}},
  {id:'local',kind:'supply-transient',owner:'RX',components:['FC'],inputs:{loadStepCurrent:input(.5,'mA'),supportTime:input(10,'us'),maxDroop:input(.2,'V'),effectiveCapacitanceRatio:input(.5,'ratio'),equivalentEsr:input(.05,'ohm')}});
 const a=reviewOperatingPoints(d);assert.deepEqual(a.errors,[]);
 d.components.find(c=>c.ref==='A').value='270R';const b=reviewOperatingPoints(d);assert.deepEqual(b.errors,[]);
 assert(row(b,'local').calculations[0].upstreamDisturbance.firstWindowDroopBoundV>row(a,'local').calculations[0].upstreamDisturbance.firstWindowDroopBoundV);
 assert(row(b,'local').calculations[0].upstreamDisturbance.combinedVoltageFloorV<row(a,'local').calculations[0].upstreamDisturbance.combinedVoltageFloorV);
});
test('quoted internal bias uses real pin groups and one active common, without fitting extra resistors',()=>{
 const d=scanned(),driver=d.components.find(c=>c.ref==='DRV');driver.value='DriverExample';
 for(const [n,name] of [['3','CHAN1'],['4','CHAN2'],['5','MUX1'],['6','MUX2']])driver.pins.find(p=>p.number===n).name=name;
 const quote='CHAN1-CHAN2 内置4kOhm下拉；MUX1-MUX2 内置2.7kOhm上拉。';
 const context={evidence:[{id:'source',content:quote}],guidance:[{id:'g',subject:'DriverExample 内部偏置',statement:quote,citations:[{sourceId:'source',quote}]}]};
 const r=reviewOperatingPoints(d,context);assert.deepEqual(r.errors,[]);
 near(row(r,'supply').calculations[0].internalBiasCurrentA,2*5/4000+5/2700);
 assert.equal(row(r,'supply').coupling.internalBiasContributions.find(x=>x.bias==='up').activeCount,1);
 assert.equal(d.components.length,5);
 const duplicate=structuredClone(context);duplicate.guidance.push({...duplicate.guidance[0],id:'again'});
 near(row(reviewOperatingPoints(d,duplicate),'supply').calculations[0].internalBiasCurrentA,2*5/4000+5/2700);
 const changed=structuredClone(context);changed.guidance[0].citations[0].quote='CHAN1-CHAN2 内置3kOhm下拉';
 assert(reviewOperatingPoints(d,changed).errors.some(e=>e.code==='internal-bias-invalid'));
 d.operatingPoints[0].inputs.maxPeakCurrent=input(16,'mA');
 assert(reviewOperatingPoints(d,context).errors.some(e=>e.id==='scan'&&e.code==='operating-limit-exceeded'),'Internal bias also loads the actual driver output, beyond the LED branch alone.');
});
