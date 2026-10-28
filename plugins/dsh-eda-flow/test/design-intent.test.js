import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {validateDesign, validateRequirements} from '../src/design-intent.js';
import {designReviewSummary} from '../src/synthesis.js';
import {Flow} from '../src/service.js';

const part=(ref,pins)=>({
  id:ref.toLowerCase(),ref,value:'fixture',mpn:'',footprint:'',librarySymbol:'Fixture:Part',
  dnp:false,in_bom:true,on_board:true,pins:pins.map((pin,number)=>({number:String(number+1),name:pin.name||'PIN',type:pin.type,pad:String(number+1)}))
});
const candidate=(components,nets,supplied_nets=[])=>({components,nets,nc:[],supplied_nets,functions:[],unresolved:[]});

test('keeps a quantity-only jumper requirement from authorizing topology',()=>{
  const inputs={requirements:'保留8个零欧跨线电阻。',stageNotes:{'3':'另一个器件推荐串联电阻，网络不合并。'},datasheetText:'另一个器件的推荐应用包含串联电阻。',constraints:{},evidence:[{content:'另一个器件推荐串联电阻。'}]};
  const expanded={requirements:[{id:'jumpers',description:'保留8个零欧跨线电阻，串联于显示信号路径，两侧网络不合并。'}]};
  assert.match(validateRequirements(expanded,{inputs}),/数量或BOM需求/);
  assert.equal(validateRequirements({requirements:[{id:'jumpers',description:'保留8个零欧跨线电阻。'}]},{inputs}),null);
  assert.equal(validateRequirements(expanded,{inputs:{requirements:'保留8个零欧跨线电阻，明确串联于显示信号路径且两侧网络独立。'}}),null);
  assert.equal(validateRequirements(expanded,{inputs:{...inputs,interfaces:'八个零欧跨线电阻串联于控制接口，两侧网络不合并。'}}),null);
  assert.match(validateRequirements(expanded,{inputs:{...inputs,interfaces:'另一个器件推荐串联电阻，两侧网络不合并。'}}),/数量或BOM需求/);
  // Existing callers using only the legacy protocol remain format-compatible.
  assert.equal(validateRequirements({requirements:[{id:'legacy',description:'保留器件数量'}]}),null);
});

test('does not force either same-net or split-net treatment of a zero-ohm part',()=>{
  const requirements=[{id:'jumpers',description:'保留一个零欧跨线电阻。'}];
  const source=part('U1',[{name:'OUT',type:'output'}]);
  const load=part('U2',[{name:'IN',type:'input'}]);
  const jumper={...part('J1',[{name:'1',type:'passive'},{name:'2',type:'passive'}]),value:'0R'};
  const functions=(checks)=>[{requirementId:'jumpers',description:'保留零欧器件并记录其连接。',checks,limitations:['是否同网或分网由已知连接或工程选择决定。']}];
  const sameNet={components:[source,jumper,load],nets:[{name:'SIGNAL',nodes:['U1.1','J1.1','J1.2','U2.1']}],nc:[],supplied_nets:[],functions:functions([{kind:'connected',nodes:['U1.1','J1.1','J1.2','U2.1']}]),unresolved:[]};
  const splitNet={components:[source,jumper,load],nets:[{name:'DRIVE',nodes:['U1.1','J1.1']},{name:'LOAD',nodes:['J1.2','U2.1']}],nc:[],supplied_nets:[],functions:functions([{kind:'connected',nodes:['U1.1','J1.1']},{kind:'connected',nodes:['J1.2','U2.1']}]),unresolved:[]};
  assert.deepEqual(validateDesign(sameNet,requirements),[]);
  assert.deepEqual(validateDesign(splitNet,requirements),[]);
});

test('stage 2 rejects an inferred jumper topology before it becomes the next-stage contract',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'requirements-boundary-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:5}));
  const raw='只保留8个零欧跨线电阻，其他连接由设计自行决定。';
  const bad={action:'finish',summary:'提取需求',gaps:[],assumptions:[],requirements:[{id:'jumpers',description:'保留8个零欧跨线电阻，串联于显示信号路径，两侧网络不合并。'}]};
  const good={...bad,requirements:[{id:'jumpers',description:'保留8个零欧跨线电阻，其他连接由设计自行决定。'}],assumptions:['0欧两端是否同网或分网在第三步依据连接选择并记录。']};
  const flow=new Flow({workspaceRoot:root,workDirectory:root,allowModelCalls:true},{async generateText(args){
    assert.equal(args.stage.id,2);
    assert.match(await args.validateFinish(bad),/拓扑选择/);
    assert.equal(await args.validateFinish(good),null);
    return good;
  }});
  t.after(()=>flow.close());
  let project=await flow.create({label:'requirements boundary',designMode:'new-design'});
  await flow.update({projectId:project.id,stage:1,inputs:{requirements:raw}});
  await flow.confirm({projectId:project.id,stage:1},'human');
  project=await flow.execute(project.id,2);
  assert.equal(project.stages[1].status,'done');
  assert.deepEqual(project.stages[1].result.requirements,good.requirements);
});

test('requires an explicit supplied_nets declaration for an undriven power input',()=>{
  const components=[part('D1',[{name:'VCC',type:'power_in'}])];
  const nets=[{name:'VCC',nodes:['D1.1']}];
  const missing=validateDesign(candidate(components,nets));
  assert(missing.some(issue=>issue.includes('VCC')&&issue.includes('supplied_nets')));
  const declared=validateDesign(candidate(components,nets,['VCC']));
  assert(declared.some(issue=>issue.includes('没有至少一个其他真实器件端子')));
  const passiveEntry=[part('J1',[{name:'VIN',type:'passive'}]),...components];
  assert.deepEqual(validateDesign(candidate(passiveEntry,[{name:'VCC',nodes:['J1.1','D1.1']}],['VCC'])),[]);
});

test('accepts a real power_out on the same net and does not infer from the net name',()=>{
  const components=[part('J1',[{name:'POWER',type:'power_out'}]),part('D1',[{name:'VCC',type:'power_in'}])];
  const net=[{name:'VCC',nodes:['J1.1','D1.1']}];
  assert.deepEqual(validateDesign(candidate(components,net)),[]);
  const arbitraryName=[{name:'SENSOR_RAIL',nodes:['D1.1']}];
  assert(validateDesign(candidate([part('D1',[{name:'VCC',type:'power_in'}])],arbitraryName)).some(issue=>issue.includes('SENSOR_RAIL')));
  const fakeHelper=[{...part('PWR1',[{name:'~',type:'power_out'}]),librarySymbol:'Host:SupplyDeclaration'},part('D1',[{name:'VCC',type:'power_in'}])];
  const helperRail=[{name:'VCC',nodes:['PWR1.1','D1.1']}];
  assert(validateDesign(candidate(fakeHelper,helperRail,['VCC'])).some(issue=>issue.includes('没有至少一个其他真实器件端子')));
});

test('does not require a supply declaration for a signal output net',()=>{
  const components=[part('D1',[{name:'OUT',type:'output'}])];
  assert.deepEqual(validateDesign(candidate(components,[{name:'IR_OUT',nodes:['D1.1']}])) ,[]);
});

test('accepts a source-backed alias through symbolId and rejects the same alias without evidence',()=>{
  const source={symbolId:'Evidence:Fact_receiver',componentKind:'infrared-receiver',pins:[{number:'17',name:'OUT',type:'output'}]};
  const components=[{id:'receiver',ref:'DISP',value:'SENSOR-X',mpn:'',footprint:'',librarySymbol:source.symbolId,dnp:false,in_bom:true,on_board:true,pins:[{number:'17',name:'OUT',type:'output',pad:'17'}]}];
  const nets=[{name:'OUT',nodes:['DISP.17']}];
  assert.deepEqual(validateDesign(candidate(components,nets),[],[source]),[]);
  const withoutEvidence=validateDesign(candidate(components,nets));
  assert(withoutEvidence.some(issue=>issue.includes('元件必须有稳定id')));
});

test('design review summary exposes declared supplies and its validation boundary',()=>{
  const summary=designReviewSummary(candidate([part('J1',[{name:'VIN',type:'passive'}])],[{name:'VCC',nodes:['J1.1']}],['VCC']));
  assert.deepEqual(summary.suppliedNets,['VCC']);
  assert.match(summary.validationBoundary,/仅验证显式supplied_nets声明和候选网络连接/);
  assert.match(summary.validationBoundary,/不验证电压.*真实供电路径/);
});
