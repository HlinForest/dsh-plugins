import React from 'react';
import {Table} from './ui.jsx';
import {ApplicationDecisions} from './ApplicationDecisions.jsx';

const labels={supplyVoltage:'供电电压',forwardVoltage:'负载正向压降',driverDrop:'驱动压降',duty:'占空比',targetAverageCurrent:'目标平均电流',minAverageCurrent:'最小平均电流',maxAverageCurrent:'最大平均电流',maxPeakCurrent:'最大峰值电流',deviceCurrent:'器件工作电流',minDeviceVoltage:'最低工作电压',frequency:'评估频率',lowVoltage:'输出低电平电压',maxSinkCurrent:'最大灌电流',inputCapacitance:'输入电容',maxRiseTime:'最大上升时间'};
const measures={resistanceOhm:['阻值','Ω',1],peakCurrentA:['峰值电流','mA',1e3],averageCurrentA:['平均电流','mA',1e3],averagePowerW:['平均功耗','mW',1e3],targetResistanceOhm:['目标理想阻值','Ω',1],capacitanceF:['总电容','nF',1e9],voltageDropV:['滤波压降','V',1],deviceVoltageV:['负载端电压','V',1],timeConstantS:['时间常数','µs',1e6],cutoffHz:['截止频率','kHz',1e-3],resistorPowerW:['电阻功耗','mW',1e3],idealAmplitudeRatio:['理想幅度比','',1],equivalentResistanceOhm:['并联等效阻值','Ω',1],sinkCurrentA:['输出灌电流','mA',1e3],riseTime10To90S:['10%–90%上升时间','ns',1e9]};
Object.assign(labels,{loadStepCurrent:'电源域增量负载',supportTime:'电容支撑时间',maxDroop:'允许压降',effectiveCapacitanceRatio:'有效容量比例',equivalentEsr:'电容组等效串联电阻'});
Object.assign(measures,{baseLoadStepCurrentA:['基础增量负载','mA',1e3],pullUpStepCurrentA:['上拉切换增量条件上界','mA',1e3],totalLoadStepCurrentA:['储能计算合计增量','mA',1e3],initialVoltageV:['起始电压','V',1],minimumDeviceVoltageV:['负载最低工作电压','V',1],transientVoltageFloorV:['储能电压下界','V',1],switchingSinkCurrentBoundA:['切换灌电流条件上界','mA',1e3]});
Object.assign(measures,{highStateDeviceVoltageV:['输出均为高电平时的供电','V',1],deviceLoadCurrentA:['器件自身电流合计','mA',1e3],totalSupplyCurrentA:['供电总电流','mA',1e3],downstreamPullUpCurrentA:['滤波后上拉电流合计','mA',1e3],simultaneousLowSinkCurrentA:['所有输出低电平时的灌电流','mA',1e3],pullUpRailVoltageV:['本输出低电平时的上拉电源','V',1],effectiveCapacitanceF:['有效电容量','µF',1e6],esrDroopV:['ESR 压降','V',1],capacitiveDroopV:['放电压降','V',1],transientDroopV:['增量负载压降','V',1],requiredNominalCapacitanceF:['所需最小名义容量','µF',1e6]});
Object.assign(labels,{scanSlots:'扫描槽数',scanFrequency:'扫描频率',minForwardVoltage:'负载压降下界',minDriverDrop:'驱动压降下界',maxGroupCurrent:'公共端电流限值'});
Object.assign(measures,{scanLoadStepCurrentA:['扫描负载条件上界','mA',1e3],internalBiasCurrentA:['内部偏置条件上界','mA',1e3],peakCurrentBoundA:['支路电流条件上界','mA',1e3],driverPinCurrentBoundA:['驱动输出电流条件上界','mA',1e3],averageCurrentBoundA:['平均电流条件上界','mA',1e3]});
const number=v=>Number.isFinite(v)?Number(v.toPrecision(4)).toString():'未计算';
const calculated=row=>(row.calculations||[]).map(c=>[c.ref,...Object.entries(c).filter(([k])=>measures[k]).map(([k,v])=>{
  const [label,unit,scale]=measures[k];return `${label} ${number(Number.isFinite(v)?v*scale:NaN)}${unit?' '+unit:''}`;
})].filter(Boolean).join('；')).join('\n');
const conditions=row=>Object.entries(row.inputs||{}).map(([key,p])=>`${key==='loadStepCurrent'&&row.calculations?.some(c=>c.baseLoadStepCurrentA!==undefined)?'剩余增量负载（已推导的扫描、偏置和外部上拉另列）':labels[key]||key}：${number(p.value)} ${p.unit==='ratio'?'':p.unit}\n${p.kind==='assumption'?'工程假设：'+p.assumption:[p.document,p.page?'第 '+p.page+' 页':null,p.quote,p.qualification==='quantity-only'?'已核对引文数值；额定类型和适用工作条件待核实。':null].filter(Boolean).join('\n')}`).join('\n\n');
const coupling=row=>row.coupling?[
  `上游电源：${row.coupling.upstream}；评估电源：${row.coupling.rail}；返回：${row.coupling.ground}`,
  `联合工作点：${row.coupling.relatedOperatingPoints.join('、')}`,
  row.kind==='supply-transient'?'合计增量由当前模型列明的剩余负载、实际扫描支路、已提取的内部偏置和外部上拉组成。条件上界假定电源不超声明值、输出不低于返回端。支撑窗口内不计上游补充电荷；未能提取或建模的其他负载仍须核实。':row.kind==='rc-filter'?'最低供电按所有已建模输出同时为低电平计算。':'稳态灌电流按本输出低电平、其他输出高电平计算；切换上界另按声明源电压核对。',
  ...row.coupling.assumptions,
].join('\n'):'';

export function OperatingPoints({review,detail}){
  if(!review)return null;
  const rows=(review.operatingPoints||[]).map(r=>({...r,
    title:({'resistor-load':'限流','rc-filter':'供电滤波','pull-up':'输出上拉','supply-transient':'供电储能'})[r.kind]||r.kind,
    state:({'invalid':'需修改','needs-review':'假设待核实','nominal-checks-passed':'名义计算符合输入条件'})[r.status]||'待核对',
    calculated:calculated(r),conditions:conditions(r),coupling:coupling(r)}));
  return <><ApplicationDecisions review={review} detail={detail}/><h3>阻容选值计算</h3>
    <p className="page-help">按本次实际阻容值和工作条件复算。查看每项可核对数值、资料原文与工程假设。</p>
    {rows.length?<Table label="阻容选值计算" columns={[{key:'owner',title:'负载'},{key:'title',title:'用途'},{key:'components',title:'器件',render:r=>r.components?.join('、')},{key:'state',title:'结论'}]} rows={rows}
      onView={r=>detail('阻容选值计算',{'负载':r.owner,'用途':r.title,'器件':r.components?.join('、'),'结论':r.state,'计算结果':r.calculated,'条件与依据':r.conditions,...(r.assumptions?.length?{'待核实条件':r.assumptions.join('\n')}:{}),...(r.coupling?{'联合供电条件':r.coupling}:{}),'核对范围':'集总直流与显式电荷预算估算；动态响应、高频阻抗、环路稳定性、温升和实物性能另行验证。'})}/>
      :<p className="page-help">本次方案尚未提供可复算工作条件，文字说明中的算式未核验。</p>}
  </>;
}
