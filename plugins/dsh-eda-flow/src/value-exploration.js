import {reviewOperatingPoints} from './operating-points.js';
import {reviewApplicationDecisions} from './application-decisions.js';
import {reviewPassiveCoverage} from './passive-coverage.js';

const only=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>keys.includes(k));
export const valueExplorationTool={name:'design_explore_values',description:'在同一候选、相同连接、相同工作条件和来源约束下，批量复算电阻取值及已装配并联电容组合。只接受已有无源器件的值，不接受工作点输入、连线或坐标，不修改候选。返回名义结果、限值冲突和资料冲突；不是完成凭证。采纳须再用design_amend或design_review完整核验；增加/删除器件需design_review。',
  inputSchema:{type:'object',properties:{candidateId:{type:'string'},variants:{type:'array',minItems:1,maxItems:8,items:{type:'object',properties:{id:{type:'string'},values:{type:'array',minItems:1,maxItems:12,items:{type:'object',properties:{ref:{type:'string'},value:{type:'string'}},required:['ref','value'],additionalProperties:false}}},required:['id','values'],additionalProperties:false}}},required:['candidateId','variants'],additionalProperties:false}};

// These are conditional bounds under the submitted, explicitly qualified
// operating inputs. No target board, preferred BOM, or invented performance
// objective enters the selection. An open bound is null, never infinity/zero.
export function valueConstraints(results){
  return results.filter(r=>r.calculations?.length).map(r=>{
    const v=Object.fromEntries(Object.entries(r.inputs).map(([k,x])=>[k,x.value])),c=r.calculations[0];
    const base={id:r.id,kind:r.kind,components:r.components,qualification:r.status,missing:[]};
    if(r.kind==='supply-transient')return {...base,minimumNominalCapacitanceF:c.requiredNominalCapacitanceF,
      missing:['该总容量下限不能确定电容只数、各值、高频阻抗或封装；替代组合仍使用原来的容量折减与等效ESR假设。']};
    if(r.kind==='pull-up')return {...base,minimumEquivalentResistanceOhm:v.supplyVoltage/v.maxSinkCurrent,
      maximumEquivalentResistanceOhm:!r.coupling&&v.inputCapacitance&&v.maxRiseTime?v.maxRiseTime/(Math.log(9)*v.inputCapacitance):null,
      missing:!v.inputCapacitance||!v.maxRiseTime?['缺少输入电容/上升时间约束，不能确定上拉阻值上界或唯一值。']:r.coupling?['滤波电源动态模型尚未覆盖上升时间上界。']:[]};
    if(r.kind==='resistor-load'){
      const h=Math.max(0,v.supplyVoltage-v.forwardVoltage-v.driverDrop),bound=Math.max(0,v.supplyVoltage-(v.minForwardVoltage??0)-(v.minDriverDrop??0)),lower=[];
      if(v.maxPeakCurrent){
        const bias=Math.max(0,...Object.values(r.scan?.branchBiasCurrentA||{})),available=v.maxPeakCurrent-bias;
        if(available>0)lower.push(bound/available);
      }
      if(v.maxAverageCurrent)lower.push(bound*v.duty/v.maxAverageCurrent);
      return {...base,minimumResistanceOhm:lower.length?Math.max(...lower):null,
        maximumResistanceOhm:v.minAverageCurrent>0?h*v.duty/v.minAverageCurrent:null,
        targetResistanceOhm:v.targetAverageCurrent?h*v.duty/v.targetAverageCurrent:null,
        missing:[...(!v.targetAverageCurrent&&!v.minAverageCurrent?['缺少目标亮度/平均电流，安全电流上限不能推出唯一阻值。']:[]),
          '阻值下限按压降下界推导的电流上界计算；名义恒定压降不能代替保证的输出特性。公共端合计上限及储能须随实际支路重新联算。']};
    }
    return {...base,missing:['供电电阻须联立复算当前负载；没有衰减指标及频率时，截止频率较低不代表选型更优。']};
  });
}

export function exploreValues(design,args,context={}){
  if(!only(args,['candidateId','variants'])||typeof args.candidateId!=='string'||!args.candidateId||!Array.isArray(args.variants)||!args.variants.length||args.variants.length>8)throw Error('需要当前candidateId及1至8组阻容备选。');
  const baseline=reviewOperatingPoints(design,context),ids=new Set();
  const variants=args.variants.map(variant=>{
    if(!only(variant,['id','values'])||typeof variant.id!=='string'||!variant.id.trim()||ids.has(variant.id)||!Array.isArray(variant.values)||!variant.values.length||variant.values.length>12)throw Error('备选需要唯一id及1至12个已有器件值。');
    ids.add(variant.id);const next=structuredClone(design),refs=new Set();
    for(const row of variant.values){
      if(!only(row,['ref','value'])||typeof row.ref!=='string'||typeof row.value!=='string'||!row.value.trim()||row.value.length>32||refs.has(row.ref))throw Error('器件值格式无效或重复。');
      refs.add(row.ref);const c=next.components.find(c=>c.ref===row.ref);
      if(!c||c.dnp||c.in_bom===false||!/^Device:[RC](?:_|$)/.test(c.librarySymbol||'')||!baseline.results.some(r=>r.components?.includes(c.ref)))throw Error('仅支持已有工作点覆盖的已装配通用阻容：'+row.ref);
      c.value=row.value;
    }
    const operating=reviewOperatingPoints(next,context),application=reviewApplicationDecisions(next,context),coverage=reviewPassiveCoverage(next,context);
    return {id:variant.id,values:variant.values,operatingErrors:operating.errors,sourceErrors:[...application.errors,...coverage.errors],sourceWarnings:[...application.warnings,...coverage.warnings],
      calculations:operating.results.filter(r=>r.components?.some(ref=>refs.has(ref))||JSON.stringify(r.calculations)!==JSON.stringify(baseline.results.find(b=>b.id===r.id)?.calculations))
        .map(r=>({id:r.id,kind:r.kind,status:r.status,calculations:r.calculations||[]})),
      limitations:['同条件名义计算，不构成厂家推荐或硬件通过；原有假设与来源适用性待定项全部保留。','改动并联组合可能改变ESR、偏压折减和高频阻抗，这些必须另行核实。']};
  });
  const refs=new Set(args.variants.flatMap(v=>v.values.map(r=>r.ref)));
  return {candidateChanged:false,conditionsChanged:false,constraints:valueConstraints(baseline.results),
    currentRecords:{components:design.components.filter(c=>refs.has(c.ref)),
      peripheralAssessments:(design.peripheralAssessments||[]).filter(r=>[...(r.supply?.components||[]),...(r.output?.components||[])].some(ref=>refs.has(ref))),
      applicationDecisions:(design.applicationDecisions||[]).filter(r=>r.components?.some(ref=>refs.has(ref)))},
    assumptions:baseline.unresolved,variants,instruction:'按实际冲突和明确目标选择；多个候选均满足名义条件但缺少性能目标时保留未确定项，不以参考图取值或较小差异作为选型依据。采纳后仍须完整design_amend/design_review。'};
}
