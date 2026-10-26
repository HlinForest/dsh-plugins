import {reviewOperatingPoints} from './operating-points.js';
import {reviewApplicationDecisions} from './application-decisions.js';
import {reviewPassiveCoverage} from './passive-coverage.js';
import {electricalQuantities} from './evidence-quantities.js';
import {valueConstraints} from './value-exploration.js';

export const passiveSolverTool={name:'design_solve_passives',description:'从当前真实拓扑、实际阻容及不变的工作条件反求联立可行范围，不需要先猜备选值。约束不满足时提出可直接design_amend的实际阻容修改；现有值可行但缺少目标时保持并报告不唯一。来源约束也必须满足。不能指定参考值、坐标或放宽输入。',inputSchema:{type:'object',properties:{candidateId:{type:'string'}},required:['candidateId'],additionalProperties:false}};
const E12=[1,1.2,1.5,1.8,2.2,2.7,3.3,3.9,4.7,5.6,6.8,8.2];
const E24=[1,1.1,1.2,1.3,1.5,1.6,1.8,2,2.2,2.4,2.7,3,3.3,3.6,3.9,4.3,4.7,5.1,5.6,6.2,6.8,7.5,8.2,9.1];
const value=(n,kind)=>`${Number((kind==='C'?n*1e6:n).toPrecision(12))}${kind==='C'?'uF':'ohm'}`;
const cap=c=>electricalQuantities(/f$/i.test(c.value)?c.value:c.value+'F').find(q=>q.unit==='F')?.value;
const sourceErrors=(d,context)=>[...reviewApplicationDecisions(d,context).errors,...reviewPassiveCoverage(d,context).errors];
const changedResults=(a,b)=>new Set(b.results.filter(r=>JSON.stringify(r.calculations)!==JSON.stringify(a.results.find(x=>x.id===r.id)?.calculations)).map(r=>r.id));

function controls(design,review){
 const parts=new Map(design.components.map(c=>[c.ref,c]));
 return review.results.filter(r=>r.calculations?.length).flatMap(r=>{
  if(r.kind==='supply-transient'){
   const caps=r.components.map(ref=>({ref,value:cap(parts.get(ref))})).filter(c=>c.value>0).sort((a,b)=>b.value-a.value);
   // Preserve every other capacitor, including a separate bypass. A repair
   // adjusts one existing storage value, never assumes a capacitor count or
   // high-frequency equivalence between different banks.
   return caps.length?[{id:r.id,kind:'C',members:[caps[0]],fixedMembers:caps.slice(1).map(c=>c.ref)}]:[];
  }
  if(r.kind==='resistor-load')return [{id:r.id,kind:'R',members:r.calculations.map(c=>({ref:c.ref,value:c.resistanceOhm}))}];
  if(r.kind==='rc-filter')return [{id:r.id,kind:'R',members:[{ref:r.components.find(ref=>parts.get(ref).electricalRole==='supply-filter'),value:r.calculations[0].resistanceOhm}]}];
  if(r.kind==='pull-up'&&r.components.length===1)return [{id:r.id,kind:'R',members:[{ref:r.components[0],value:r.calculations[0].equivalentResistanceOhm}]}];
  return [];
 });
}
function scaled(design,control,scale){
 const next=structuredClone(design);
 for(const m of control.members)next.components.find(c=>c.ref===m.ref).value=value(m.value*scale,control.kind);
 return next;
}
function deriveDimension(design,baseline,control,context){
 const sample=reviewOperatingPoints(scaled(design,control,2),context),related=changedResults(baseline,sample);related.add(control.id);
 const evaluate=scale=>{
  const design2=scaled(design,control,scale),review=reviewOperatingPoints(design2,context);
  return {design:design2,review,pass:!review.errors.some(e=>!e.id||related.has(e.id))};
 };
 // This search is restricted to positive, topology-checked lumped models.
 // Report finite search edges as open bounds and verify every proposed value
 // again. A sampled interval is not a proof for an arbitrary analogue model.
 const samples=Array.from({length:33},(_,i)=>2**(i-16)).map(scale=>({scale,...evaluate(scale)}));
 const spans=[];
 for(let i=0;i<samples.length;i++)if(samples[i].pass){let end=i;while(end+1<samples.length&&samples[end+1].pass)end++;spans.push([i,end]);i=end;}
 const base={id:control.id,components:control.members.map(m=>m.ref),referenceValues:control.members,fixedComponents:control.fixedMembers||[],relatedOperatingPoints:[...related],currentFeasible:evaluate(1).pass,
  searchScale:[2**-16,2**16],method:'positive scalar search and bisection of the full coupled calculations; every proposal is rechecked',qualification:'conditional-search'};
 if(spans.length!==1)return {...base,lowerScale:null,upperScale:null,reason:spans.length?'可行区间不连续，不自动选择。':'本次正值搜索范围内没有可行区间。',repairs:[]};
 const [start,end]=spans[0];
 const boundary=(bad,good)=>{for(let i=0;i<38;i++){const mid=Math.sqrt(bad*good);if(evaluate(mid).pass)good=mid;else bad=mid;}return good;};
 const lower=start?boundary(samples[start-1].scale,samples[start].scale):null;
 const upper=end<samples.length-1?boundary(samples[end+1].scale,samples[end].scale):null;
 const result={...base,lowerScale:lower,upperScale:upper,range:control.members.map(m=>({ref:m.ref,unit:control.kind==='C'?'F':'ohm',minimum:lower===null?null:m.value*lower,maximum:upper===null?null:m.value*upper}))};
 if(result.currentFeasible)return {...result,repairs:[]};
 const series=control.kind==='C'?E12:E24;
 const preferred=Array.from({length:25},(_,i)=>i-12).flatMap(e=>series.map(v=>Number((v*10**e).toPrecision(12))/control.members[0].value))
  .filter(s=>s>=samples[0].scale&&s<=samples.at(-1).scale&&(!lower||s>=lower*(1-1e-10))&&(!upper||s<=upper*(1+1e-10)))
  .sort((a,b)=>Math.abs(Math.log(a))-Math.abs(Math.log(b)));
 const repairs=[];
 for(const scale of preferred.slice(0,32)){
  const trial=evaluate(scale);if(!trial.pass)continue;
  repairs.push({scale,design:trial.design,errors:trial.review.errors,sourceErrors:sourceErrors(trial.design,context)});
  if(!repairs.at(-1).sourceErrors.length)break;
 }
 return {...result,repairs};
}

export function solvePassives(design,context={}){
 const baseline=reviewOperatingPoints(design,context);
 const baselineSourceErrors=sourceErrors(design,context);
 const base={conditionsChanged:false,topologyChanged:false,componentCountChanged:false,baselineSourceErrors,
  localConstraints:valueConstraints(baseline.results),localConstraintsScope:'单项公式下限；联合约束以 dimensions 和 bankRequirements 为准。',baselineErrors:baseline.errors,
  unresolved:[...baseline.unresolved,...baseline.warnings.map(w=>w.message),...(!baseline.results.some(r=>r.calculations?.length)?['没有可求解的工作点，不能判定阻容可行。']:[]),'缺少性能目标时，可行范围不能推出唯一阻容值；数量、封装、偏压特性和高频阻抗也不能由总容量单独决定。']};
 if(!baseline.results.some(r=>r.calculations?.length)||baseline.warnings.some(w=>w.code==='operating-point-missing')||baseline.errors.some(e=>e.code!=='operating-limit-exceeded'))return {...base,status:'invalid-input',changes:[],dimensions:[],blocked:[],design:structuredClone(design),bankRequirements:[]};
 let current=structuredClone(design),review=baseline;const dimensions=[],blocked=[];
 // Repair storage before a scan resistor: an insufficient reservoir must not
 // silently reduce brightness in place of satisfying the unchanged load.
 const ordered=controls(current,review).sort((a,b)=>(a.kind==='C'?0:1)-(b.kind==='C'?0:1));
 for(const original of ordered){
  const control=controls(current,review).find(c=>c.id===original.id);if(!control)continue;
  const dimension=deriveDimension(current,review,control,context),{repairs,...publicDimension}=dimension;
  dimensions.push(publicDimension);
  const repair=repairs.find(r=>!r.sourceErrors.length&&r.errors.length<review.errors.length);
  if(repair){current=repair.design;review=reviewOperatingPoints(current,context);}
  else if(!dimension.currentFeasible)blocked.push({id:control.id,reason:dimension.reason||'不能在保持来源约束和其他工作点的同时完成本项修改。',sourceErrors:repairs.flatMap(r=>r.sourceErrors)});
 }
 const changes=current.components.filter(c=>c.value!==design.components.find(x=>x.ref===c.ref)?.value).map(c=>({ref:c.ref,from:design.components.find(x=>x.ref===c.ref).value,to:c.value}));
 const banks=review.results.filter(r=>r.kind==='supply-transient').map(r=>{
  const control=controls(current,review).find(c=>c.id===r.id);
  const dimension=control?(changes.length?deriveDimension(current,review,control,context):dimensions.find(d=>d.id===r.id)):null;
  const fixedTotal=(control?.fixedMembers||[]).reduce((sum,ref)=>sum+cap(current.components.find(c=>c.ref===ref)),0);
  const jointMinimumTotalF=dimension?.range?.[0]?.minimum==null?null:dimension.range[0].minimum+fixedTotal;
  return {id:r.id,components:r.components,chargeBudgetMinimumTotalF:r.calculations?.[0]?.requiredNominalCapacitanceF??null,jointMinimumTotalF,currentTotalF:r.calculations?.[0]?.capacitanceF??null,
   componentCountDetermined:false,unresolved:'电荷预算下限与联合首窗口下限分开记录；并联只数和每只容量仍需封装/有效容量/ESR/频率条件。未按参考图拆分或增加电容。'};
 });
 return {...base,status:review.errors.length||sourceErrors(current,context).length?'needs-design-decision':changes.length?'repair-proposed':'feasible-underdetermined',design:current,changes,dimensions,blocked,bankRequirements:banks,
  resultingErrors:review.errors,amend:{replaceRecords:changes.map(c=>({section:'components',key:c.ref,record:current.components.find(p=>p.ref===c.ref)}))},
  instruction:changes.length?'这是保持当前条件的实际器件修改提案，须更新相关设计依据并design_amend/design_review后才能采纳。E系列取值只是工程候选，仍须核实采购、容差、额定功率/电压、偏压及ESR。':'当前未得到有依据的必要修改；不得为缩小参考差异强行换值。'};
}
