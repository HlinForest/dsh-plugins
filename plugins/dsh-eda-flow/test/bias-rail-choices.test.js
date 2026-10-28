import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {reviewOperatingPoints} from '../src/operating-points.js';
import {reviewBiasRailChoices} from '../src/bias-rail-choices.js';
import {reviewNative} from '../src/controlled-layout.js';
import {amendDesign} from '../src/design-amend.js';
import {documentEvidence} from '../src/inline-evidence.js';

const pin=(number,name,type='passive')=>({number:String(number),name,type,pad:String(number)});
const input=(value,unit)=>({value,unit,basis:{assumption:'Explicit test condition'}});
const part=(ref,value,role,symbol='Device:R')=>({id:ref,ref,value,mpn:'',footprint:'',librarySymbol:symbol,electricalRole:role,
  dnp:false,in_bom:true,on_board:true,pins:[pin(1,'1'),pin(2,'2')]});
function fixture(connection='local'){
  return {components:[{...part('RX9','Receiver',undefined,'Interface:Receiver'),pins:[pin(27,'OUT','output'),pin(4,'VCC','power_in'),pin(9,'GND','power_in')]},
    part('RF9','150R','supply-filter'),part('RB9','15k','pull-up'),{...part('CB9','1uF','other','Device:C'),purpose:'Local supply capacitance'}],
    nets:[{name:'SOURCE',nodes:['RF9.1',...(connection==='upstream'?['RB9.1']:[])]},
      {name:'FILTERED',nodes:['RF9.2','RX9.4','CB9.1',...(connection==='local'?['RB9.1']:[])]},
      {name:'RETURN',nodes:['RX9.9','CB9.2']},{name:'OUTPUT',nodes:['RX9.27','RB9.2']}],
    nc:[],supplied_nets:['SOURCE','FILTERED','RETURN'],functions:[],unresolved:[],
    peripheralAssessments:[{ref:'RX9',pins:{supply:'4',return:'9',output:'27'},supply:{components:['RF9','CB9']},output:{components:['RB9']}}],
    operatingPoints:[{id:'filter',kind:'rc-filter',owner:'RX9',components:['RF9','CB9'],inputs:{supplyVoltage:input(5,'V'),deviceCurrent:input(.5,'mA'),minDeviceVoltage:input(2.7,'V')}},
      {id:'bias',kind:'pull-up',owner:'RX9',components:['RB9'],inputs:{supplyVoltage:input(5,'V'),lowVoltage:input(.2,'V'),maxSinkCurrent:input(1,'mA')}}]};
}
const near=(a,b)=>assert(Math.abs(a-b)<1e-12,`${a} != ${b}`);
const choice=(comparison,connection=comparison.policy.acceptedConnections[0])=>({connection,basis:{kind:'calculated-policy',policyId:comparison.policy.policyId},unresolved:['Output voltage compatibility requires applicable data.']});
const sourceContext=content=>({evidence:[{id:'rx-spec',sourceType:'pdf-text-extraction',document:'receiver.pdf',page:2,content},
  {id:'rx-fact',sourceType:'model-specification-fact',reference:'RX9',value:'Receiver',citations:[{sourceId:'rx-spec',quote:content}]}]});

test('each proposed rail reproduces a fresh review of the actually rewired circuit',()=>{
  const d=fixture(),before=structuredClone(d),review=reviewOperatingPoints(d),comparison=review.biasRailComparisons[0];
  assert.deepEqual(review.errors,[]);assert.deepEqual(d,before);assert.equal(comparison.selected,'local');
  for(const connection of ['local','upstream']){
    const actual=reviewOperatingPoints(fixture(connection));assert.deepEqual(actual.errors,[]);
    const expected=comparison.cases.find(c=>c.connection===connection);
    near(expected.minimumDeviceVoltageV,actual.results.find(r=>r.id==='filter').calculations[0].deviceVoltageV);
    near(expected.maxSteadySinkCurrentA,actual.results.find(r=>r.id==='bias').calculations[0].sinkCurrentA);
    assert(expected.nominalDcWithinDeclaredLimits);
  }
  assert(comparison.cases[0].supplyModulationFromThisOutputV>0);
  near(comparison.cases[1].supplyModulationFromThisOutputV,0);
  assert(comparison.assumptions.length);assert(comparison.unverified.length);
});

test('source limits can select either rail, and a textual choice cannot disguise the real network',()=>{
  for(const selected of ['local','upstream']){
    const context=selected==='local'?sourceContext('The output pull-up voltage must not exceed 4.95 V.'):{};
    const d=fixture(selected),r=reviewOperatingPoints(d,context);
    assert.deepEqual(r.biasRailComparisons[0].policy.acceptedConnections,[selected]);
    assert.equal(reviewBiasRailChoices(d,r.biasRailComparisons).errors.length,1);
    d.peripheralAssessments[0].output.railDecision=choice(r.biasRailComparisons[0]);
    assert.deepEqual(reviewBiasRailChoices(d,r.biasRailComparisons).errors,[]);
    d.peripheralAssessments[0].output.railDecision.connection=selected==='local'?'upstream':'local';
    assert(reviewBiasRailChoices(d,r.biasRailComparisons).errors.some(e=>/实际网络/.test(e)));
  }
});

test('unsupported dynamic prose and merely relabelling a rejected circuit cannot authorize selection',()=>{
  const d=fixture(),r=reviewOperatingPoints(d),c=r.biasRailComparisons[0];
  d.peripheralAssessments[0].output.railDecision={connection:'local',reason:'Local bias reduces shared supply noise.',unresolved:[]};
  assert(reviewBiasRailChoices(d,r.biasRailComparisons).errors.some(e=>/自由文字/.test(e)));
  d.peripheralAssessments[0].output.railDecision=choice(c,'local');
  assert(reviewBiasRailChoices(d,r.biasRailComparisons).errors.some(e=>/不满足/.test(e)));
  d.peripheralAssessments[0].output.railDecision=choice(c);
  assert(reviewBiasRailChoices(d,r.biasRailComparisons).errors.some(e=>/实际网络/.test(e)));
});

test('computed pin changes actually alter the circuit and preserve the other operating inputs',()=>{
  const d=fixture(),r=reviewOperatingPoints(d),c=r.biasRailComparisons[0];
  const a=structuredClone(d.peripheralAssessments[0]);a.output.railDecision=choice(c);
  const moves=c.cases.find(x=>x.connection===a.output.railDecision.connection).pinMoves;
  assert.deepEqual(moves,[{node:'RB9.1',from:'FILTERED',to:'SOURCE'}]);
  const changed=amendDesign(d,{candidateId:'proposal',movePins:moves,replaceRecords:[{section:'peripheralAssessments',key:'RX9',record:a}]});
  assert.deepEqual(changed.operatingPoints,d.operatingPoints);
  const fresh=reviewOperatingPoints(changed);
  assert.deepEqual(fresh.errors,[]);assert.deepEqual(reviewBiasRailChoices(changed,fresh.biasRailComparisons).errors,[]);
  near(fresh.biasRailComparisons[0].cases[1].supplyModulationFromThisOutputV,0);
  // A newer input, even if nominally passing, invalidates the previous basis.
  changed.operatingPoints[0].inputs.deviceCurrent.value=.4;
  const newInput=reviewOperatingPoints(changed);
  assert(reviewBiasRailChoices(changed,newInput.biasRailComparisons).errors.some(e=>/policyId/.test(e)));
});

test('explicit applicable source connection requirements take priority over the engineering objective',()=>{
  for(const content of ['The output pull-up must be connected to the local filtered supply.','输出上拉电阻必须接到本地滤波电源。']){
    const d=fixture(),r=reviewOperatingPoints(d,sourceContext(content)),c=r.biasRailComparisons[0];
    assert.deepEqual(c.policy.acceptedConnections,['local']);assert.equal(c.policy.sourceRules[0].kind,'required-connection');
    d.peripheralAssessments[0].output.railDecision=choice(c);assert.deepEqual(reviewBiasRailChoices(d,r.biasRailComparisons).errors,[]);
    assert.equal(c.policy.sourceRules[0].citation.sourceId,'rx-spec');
  }
});

test('actual saved datasheet text constrains the rail through the same device citation path as a PDF',()=>{
  const pages=documentEvidence({datasheetText:'The output pull-up must be connected to the local filtered supply.'});
  const evidence=[...pages,{id:'inline-fact',sourceType:'model-specification-fact',reference:'RX9',value:'Receiver',
    citations:[{sourceId:pages[0].id,quote:pages[0].content}]}];
  const c=reviewOperatingPoints(fixture(),{evidence}).biasRailComparisons[0];
  assert.deepEqual(c.policy.acceptedConnections,['local']);
  assert.equal(c.policy.sourceRules[0].citation.document,'补充规格书正文');
});

test('source recommendations constrain the preference but cannot override electrical limits',()=>{
  const d=fixture(),context=sourceContext('The output pull-up should be connected to the local filtered supply.');
  assert.deepEqual(reviewOperatingPoints(d,context).biasRailComparisons[0].policy.acceptedConnections,['local']);
  d.operatingPoints[0].inputs.minDeviceVoltage=input(4.9,'V');
  const c=reviewOperatingPoints(d,context).biasRailComparisons[0];
  assert.deepEqual(c.policy.acceptedConnections,['upstream']);
  assert(c.cases[0].violations.includes('declared-nominal-dc-limit'));
});

test('conflicting requirements, unsupported conditionals and ambiguous shared documents cannot be waived by prose',()=>{
  for(const content of [
    'The output pull-up must be connected to the local filtered supply.\n\nThe output pull-up must be connected to the upstream unfiltered supply.',
    'The output pull-up must be connected to the local filtered supply when the receiver is disabled.',
    'The output pull-up must not be connected to the local filtered supply.',
    'The output pull-up must be connected to VCC.'
  ]){
    const d=fixture(),r=reviewOperatingPoints(d,sourceContext(content)),c=r.biasRailComparisons[0];
    assert.deepEqual(c.policy.acceptedConnections,[]);assert(c.policy.blockedReasons.length);
    d.peripheralAssessments[0].output.railDecision=choice(c,'local');assert(reviewBiasRailChoices(d,r.biasRailComparisons).errors.length);
  }
  const ctx=sourceContext('The output pull-up must be connected to the local filtered supply.');
  ctx.evidence.push({id:'another-fact',sourceType:'model-specification-fact',reference:'OTHER',value:'Other device',citations:[{sourceId:'rx-spec'}]});
  assert.deepEqual(reviewOperatingPoints(fixture(),ctx).biasRailComparisons[0].policy.acceptedConnections,[]);
});

test('requirements of a different device are not imported and all quantity-only inputs remain conditional',()=>{
  const ctx=sourceContext('The output pull-up must be connected to the local filtered supply.');
  ctx.evidence[1].reference='OTHER';
  const c=reviewOperatingPoints(fixture(),ctx).biasRailComparisons[0];
  assert.deepEqual(c.policy.sourceRules,[]);assert.deepEqual(c.policy.acceptedConnections,['upstream']);
  assert.equal(c.policy.qualification,'conditional-nominal-choice');assert(c.policy.unverified.length);
});

test('renaming parts and nets and reversing storage order does not change the computed alternatives',()=>{
  const d=fixture(),expected=reviewOperatingPoints(d).biasRailComparisons[0];
  const names=new Map(d.components.map((c,i)=>[c.ref,`Q${51+i}`]));
  for(const c of d.components){c.ref=names.get(c.ref);c.id=c.ref;c.pins.reverse();}
  for(const [i,n] of d.nets.entries()){n.name=`rail-${i}`;n.nodes=n.nodes.map(x=>{const [r,p]=x.split('.');return `${names.get(r)}.${p}`;}).reverse();}
  for(const a of d.peripheralAssessments){a.ref=names.get(a.ref);for(const field of ['supply','output'])a[field].components=a[field].components.map(r=>names.get(r));}
  for(const p of d.operatingPoints){p.owner=names.get(p.owner);p.components=p.components.map(r=>names.get(r));}
  d.components.reverse();d.nets.reverse();d.operatingPoints.reverse();
  const got=reviewOperatingPoints(d).biasRailComparisons[0];
  assert.deepEqual(got.conditions,expected.conditions);
  for(const [i,c] of got.cases.entries())for(const k of Object.keys(c).filter(k=>typeof c[k]==='number'))near(c[k],expected.cases[i][k]);
});

test('a rejected, incomplete or unknown-load rail does not yield apparently usable alternatives',()=>{
  for(const edit of [d=>d.operatingPoints.pop(),d=>d.operatingPoints.shift(),d=>d.operatingPoints[1].inputs.supplyVoltage.value=4.8,
    d=>{d.components.push({...part('RL9','10k','other'),purpose:'Unmodelled rail load'});d.nets[1].nodes.push('RL9.1');d.nets[2].nodes.push('RL9.2');}]){
    const d=fixture();edit(d);assert.deepEqual(reviewOperatingPoints(d).biasRailComparisons,[]);
  }
});

test('an alternative that violates the same minimum supply condition is explicitly marked unsuitable',()=>{
  const d=fixture('upstream');d.operatingPoints[0].inputs.minDeviceVoltage=input(4.9,'V');
  const r=reviewOperatingPoints(d);assert.deepEqual(r.errors,[]);
  const c=r.biasRailComparisons[0];assert.equal(c.cases[0].nominalDcWithinDeclaredLimits,false);assert.equal(c.cases[1].nominalDcWithinDeclaredLimits,true);
});

test('a calculated voltage violation still exposes the alternative that can resolve it',()=>{
  const d=fixture('local');d.operatingPoints[0].inputs.minDeviceVoltage=input(4.9,'V');
  const r=reviewOperatingPoints(d);assert(r.errors.some(e=>e.code==='operating-limit-exceeded'));
  const c=r.biasRailComparisons[0];assert.equal(c.cases[0].nominalDcWithinDeclaredLimits,false);assert.equal(c.cases[1].nominalDcWithinDeclaredLimits,true);
});

test('other shared-rail outputs retain their fitted loads when only one bias branch is moved',()=>{
  const d=fixture(),receiver=structuredClone(d.components[0]);receiver.id=receiver.ref='RX8';
  d.components.push(receiver,part('RB8','10k','pull-up'));d.nets[1].nodes.push('RX8.4','RB8.1');d.nets[2].nodes.push('RX8.9');d.nets.push({name:'OUT8',nodes:['RX8.27','RB8.2']});
  const a=structuredClone(d.peripheralAssessments[0]);a.ref='RX8';a.output.components=['RB8'];d.peripheralAssessments.push(a);
  const f=structuredClone(d.operatingPoints[0]);f.id='filter8';f.owner='RX8';f.inputs.deviceCurrent=input(1,'mA');
  const p=structuredClone(d.operatingPoints[1]);p.id='bias8';p.owner='RX8';p.components=['RB8'];d.operatingPoints.push(f,p);
  const r=reviewOperatingPoints(d);assert.deepEqual(r.errors,[]);assert.equal(r.biasRailComparisons.length,2);
  const c=r.biasRailComparisons.find(x=>x.owner==='RX9');
  d.nets[1].nodes=d.nets[1].nodes.filter(x=>x!=='RB9.1');d.nets[0].nodes.push('RB9.1');
  const moved=reviewOperatingPoints(d);assert.deepEqual(moved.errors,[]);
  near(c.cases[1].minimumDeviceVoltageV,moved.results.find(x=>x.id==='filter').calculations[0].deviceVoltageV);
  assert(c.cases[1].minimumDeviceVoltageV<5-150*.0015);
  near(c.cases[1].supplyModulationFromThisOutputV,0);
});

test('zero-ohm analysis domains are used without editing the serialized nets',()=>{
  const d=fixture();d.components.push(part('RJ9','0R','routing-bridge'));
  d.nets[1].nodes=d.nets[1].nodes.filter(x=>x!=='RB9.1');d.nets[1].nodes.push('RJ9.1');d.nets.push({name:'BIAS',nodes:['RJ9.2','RB9.1']});
  const before=structuredClone(d),r=reviewOperatingPoints(d);assert.deepEqual(r.errors,[]);assert.deepEqual(d,before);
  assert.equal(r.biasRailComparisons[0].selected,'local');near(r.biasRailComparisons[0].cases[0].minimumDeviceVoltageV,reviewOperatingPoints(fixture()).biasRailComparisons[0].cases[0].minimumDeviceVoltageV);
});

test('the native review records comparison evidence and requires a real consistent choice before symbol snapshot',async t=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'bias-choice-'));
  t.after(()=>fs.rm(folder,{recursive:true,force:true,maxRetries:5}));
  const d=fixture('upstream'),p={label:'Bias choices',designMode:'new-design',inputs:{},stages:[{id:1},{id:2,status:'done',confirmed:true,plan:{requirements:[]},result:{guidance:[]}}]};
  let snapshots=0;
  const flow={config:{kicadCli:'D:/Kicad/bin/kicad-cli.exe'},async runProcess(args){snapshots++;await fs.writeFile(args[2],JSON.stringify({status:'passed'}));}};
  await assert.rejects(reviewNative(flow,p,d,folder),/railDecision/);assert.equal(snapshots,0);
  const failed=JSON.parse(await fs.readFile(path.join(folder,'engineering-review.json'),'utf8'));
  assert.equal(failed.biasRailComparisons.length,1);
  d.peripheralAssessments[0].output.railDecision=choice(failed.biasRailComparisons[0]);
  await reviewNative(flow,p,d,folder);assert.equal(snapshots,1);
  const accepted=JSON.parse(await fs.readFile(path.join(folder,'engineering-review.json'),'utf8'));
  assert.equal(accepted.biasRailDecisions[0].actualConnection,'upstream');assert.equal(accepted.readiness.hardwareVerified,false);
});
