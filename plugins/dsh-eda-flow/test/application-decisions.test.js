import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewApplicationDecisions,applicationDecisionRequirements} from '../src/application-decisions.js';
const g=(id,statement)=>({id,category:'peripheral',subject:'Generic application',statement,citations:[{sourceId:'doc',quote:statement}]});
const c=(ref,value)=>({ref,value,librarySymbol:'Device:C'});
const decision=(guidanceId,overrides={})=>({guidanceId,action:'adopt',components:['CX'],reason:'Apply the cited capacitor example at the selected load.',operatingPoints:[],unresolved:[],...overrides});

test('adoption checks explicit passive values in equivalent units and actual populated refs',()=>{
  const context={guidance:[g('g1','Use a 100nF bypass capacitor.')]};
  const d={components:[c('CX','0.1uF')],applicationDecisions:[decision('g1')]};
  assert.deepEqual(reviewApplicationDecisions(d,context).errors,[]);
  for(const change of [{value:'1uF'},{dnp:true},{in_bom:false},{librarySymbol:'Device:R'}]){
    assert(reviewApplicationDecisions({...d,components:[{...d.components[0],...change}]},context).errors.length);
  }
});

test('a source example for each listed channel must bind all adopted parts',()=>{
  const context={guidance:[g('g2','A_IN、B_IN、C_IN 各有一颗 100pF 电容。')]};
  const d={components:[c('CX','100pF'),c('CY','100pF'),c('CZ','100pF')],applicationDecisions:[decision('g2')]};
  assert(reviewApplicationDecisions(d,context).errors.some(e=>e.includes('数量')));
  d.applicationDecisions[0].components=['CX','CY','CZ'];assert.deepEqual(reviewApplicationDecisions(d,context).errors,[]);
});

test('adaptation must bind a real calculation covering its parts and retain unknown conditions',()=>{
  const context={guidance:[g('g1','Application: 22uF reservoir capacitor.')]};
  const d={components:[c('CX','10uF')],operatingPoints:[{id:'p1',components:['CX']}],
    applicationDecisions:[decision('g1',{action:'adapt',operatingPoints:['p1'],reason:'Different load step; use the recorded charge budget.',unresolved:['Load step and effective capacitance remain assumptions.']})]};
  assert.deepEqual(reviewApplicationDecisions(d,context).errors,[]);
  for(const edit of [x=>x.applicationDecisions[0].operatingPoints=[],x=>x.operatingPoints[0].components=['CY'],x=>x.applicationDecisions[0].unresolved=[]]){
    const bad=structuredClone(d);edit(bad);assert(reviewApplicationDecisions(bad,context).errors.length);
  }
});

test('internal device resistance does not become an external resistor requirement',()=>{
  const context={guidance:[g('g1','The device has an internal 13kOhm pull-up resistor.')]};
  assert.equal(applicationDecisionRequirements(context.guidance)[0].externalPassives,false);
  const r=reviewApplicationDecisions({components:[{ref:'U9',value:'Driver'}],applicationDecisions:[decision('g1',{components:['U9']})]},context);
  assert.deepEqual(r.errors,[]);
});

test('missing, duplicate, unknown and unsupported decisions fail; unresolved choices stay visible',()=>{
  const context={guidance:[g('g1','100nF capacitor.')]};
  assert(reviewApplicationDecisions({components:[]},context).errors.length);
  const row=decision('g1',{action:'unresolved',components:[],reason:'Need applicable load conditions.',unresolved:['Supply transient not specified.']});
  const r=reviewApplicationDecisions({components:[],applicationDecisions:[row]},context);
  assert.deepEqual(r.errors,[]);assert(r.warnings.some(w=>w.includes('Supply transient')));
  for(const rows of [[row,row],[{...row,guidanceId:'foreign'}],[{...row,x:20}],[{...row,unresolved:[]}]])assert(reviewApplicationDecisions({components:[],applicationDecisions:rows},context).errors.length);
});
