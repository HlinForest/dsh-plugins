import {applicationDecisionRequirements,reviewApplicationDecisions} from './application-decisions.js';
import {passiveComponentValue} from './passive-coverage.js';

const unique=a=>[...new Set(a.filter(Boolean))];
const missingGoals={
 'resistor-load':r=>!r.inputs?.targetAverageCurrent&&!r.inputs?.minAverageCurrent?['缺少目标平均电流/亮度，电流上限不能决定唯一阻值。']:[],
 'pull-up':r=>!r.inputs?.inputCapacitance||!r.inputs?.maxRiseTime?['缺少接收端负载电容或允许上升时间，不能确定阻值上界；还需核实漏电及逻辑门限。']:['漏电及接收端逻辑门限仍需核实。'],
 'rc-filter':r=>['缺少已验证的干扰频率与衰减目标，供电压降检查不能决定唯一RC组合。'],
 'supply-transient':r=>['总容量计算不能决定并联只数或各只容量；需每只器件的有效容量、ESR及高频阻抗依据。'],
};

// Recomputed by the host on every review. Model-authored approval labels are
// ignored. Source recommendation is explicitly weaker than design acceptance.
export function passiveSelections(design,operating,context={}){
 const requirements=new Map(applicationDecisionRequirements(context.guidance||[]).map(r=>[r.guidanceId,r]));
 const application=reviewApplicationDecisions(design,context);
 return (design.components||[]).filter(c=>c.dnp!==true&&c.in_bom!==false&&passiveComponentValue(c)).map(c=>{
  const v=passiveComponentValue(c),rows=(operating.results||[]).filter(r=>r.components?.includes(c.ref));
  const adopted=application.errors.length?[]:(design.applicationDecisions||[]).filter(d=>d.action==='adopt'&&d.components.includes(c.ref)&&
   requirements.get(d.guidanceId)?.values.some(q=>q.unit===(v.kind==='capacitor'?'F':'ohm')&&Math.abs(q.value-v.siValue)<=Math.max(Math.abs(q.value),1e-18)*1e-9));
  const missing=unique([...rows.flatMap(r=>r.assumptions||[]),...rows.flatMap(r=>missingGoals[r.kind]?.(r)||[]),
   ...(design.applicationDecisions||[]).filter(d=>d.components?.includes(c.ref)).flatMap(d=>d.unresolved||[])]);
  const status=adopted.length?'source-recommended':c.electricalRole==='routing-bridge'&&v.siValue===0?'routing-choice':rows.length?'provisional':'unresolved';
  if(status==='unresolved')missing.push('缺少可追溯的数值选型依据及工作点评估。');
  return {ref:c.ref,value:c.value,status,performanceVerified:false,
   basis:adopted.length?'当前资料的数值建议已落实；并不证明工作条件或器件额定满足。':status==='routing-choice'?'零欧用于已声明的连接/工艺选择，额定电流仍需物料核实。':'现值为候选；条件计算不能唯一确定选型。',
   guidanceIds:adopted.map(a=>a.guidanceId),operatingPoints:rows.map(r=>r.id),
   conditions:rows.flatMap(r=>Object.entries(r.inputs||{}).map(([input,basis])=>({operatingPoint:r.id,input,...basis}))),missing};
 });
}

export const passiveSelectionInstructions='宿主会逐器件生成valueSelection：source-recommended只表示已采用资料数值，provisional表示候选参数，不等于通过性能验证。没有目标电流、负载电容、干扰衰减、供电响应或物料有效容量时，不用“保守”“满足要求”等未经验证理由确定阻容。已有假设可作为条件算例保留，但必须说明缺项；不得为接近参考图创造目标或拆分电容。不要自行提交批准标签，宿主会重算并写入图纸/BOM。';
