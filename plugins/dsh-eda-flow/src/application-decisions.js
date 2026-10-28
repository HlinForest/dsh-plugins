import {electricalQuantities} from './evidence-quantities.js';
import {compilePassiveObligations,reviewPassiveCoverage,passiveComponentValue} from './passive-coverage.js';

const actions=new Set(['adopt','adapt','not-applicable','unresolved']);
const keys=new Set(['guidanceId','action','components','reason','operatingPoints','unresolved']);
const nonempty=s=>typeof s==='string'&&s.trim().length>0;
const strings=a=>Array.isArray(a)&&a.every(nonempty)&&new Set(a).size===a.length;
const internal=/内置|片内|内部(?:上拉|下拉|电阻|电容)|built[- ]?in|internal\b/iu;
const passive=/电容|电阻|capacitor|capacitance|resistor|resistance/iu;

export const applicationDecisionInstructions=`第三步必须为每条已确认 applicationGuidance 提供一条 design.applicationDecisions：{guidanceId,action:"adopt"|"adapt"|"not-applicable"|"unresolved",components:[实际位号],reason:"采用、调整或不适用的具体依据",operatingPoints:[本方案工作点id],unresolved:[未定条件]}。每个guidanceId恰好一次，不能只在摘要提及后丢弃。adopt须列出实际落实器件；外部阻容示例会核对所选器件的值及明确数量，不能用不同数值冒充已采用。器件内部参数不要求外加同值阻容。adapt允许本项目选其他组合，但必须说明原因和未核实条件；涉及外部阻容数值的调整须关联覆盖所选器件的实际operatingPoints，其计算仍由宿主核验。not-applicable须说明不适用条件且不得列器件/计算；unresolved必须写尚不能决定的条件。没有亮度、扫描、噪声等条件时保持未定，不为贴近示例或参考工程编造指标。此记录不等于引脚、额定条件或实物性能已验证。`;

export function applicationDecisionRequirements(guidance=[]){
  return guidance.map(g=>{
    const text=g.statement||'';
    const internalFeature=internal.test(text);
    const externalPassives=!internalFeature&&passive.test(text);
    return {guidanceId:g.id,subject:g.subject,category:g.category,statement:text,
      externalPassives,internalFeature,
      values:externalPassives?[...new Map(electricalQuantities(text).filter(q=>q.unit==='F'||q.unit==='ohm').map(q=>[q.key,q])).values()]:[],
      quantities:externalPassives?compilePassiveObligations({guidance:[g]}):[]};
  });
}

export function reviewApplicationDecisions(design,context={}){
  const requirements=applicationDecisionRequirements(context.guidance||[]),expected=new Map(requirements.map(r=>[r.guidanceId,r]));
  const rows=design.applicationDecisions??[],errors=[],warnings=[],decisions=[];
  if(!Array.isArray(rows)||rows.length>200)return {requirements,decisions,errors:['应用决策 applicationDecisions 必须为最多200条记录。'],warnings};
  const components=new Map((design.components||[]).map(c=>[c.ref,c])),points=new Map((design.operatingPoints||[]).map(p=>[p.id,p]));
  const seen=new Set();
  for(const row of rows){
    if(!row||Object.keys(row).some(k=>!keys.has(k))||!nonempty(row.guidanceId)||!actions.has(row.action)||!nonempty(row.reason)||
      !strings(row.components)||!strings(row.operatingPoints)||!strings(row.unresolved)){
      errors.push('应用决策需要有效guidanceId/action/components/reason/operatingPoints/unresolved，不能含坐标或未知字段。');continue;
    }
    const label=`应用决策 ${row.guidanceId}`;
    if(seen.has(row.guidanceId)){errors.push(`${label}重复。`);continue;}seen.add(row.guidanceId);
    const requirement=expected.get(row.guidanceId);
    if(!requirement){errors.push(`${label}不属于本轮已确认资料。`);continue;}
    const selected=row.components.map(ref=>components.get(ref));
    const missing=row.components.filter((ref,i)=>!selected[i]||selected[i].dnp===true||selected[i].in_bom===false);
    if(missing.length)errors.push(`${label}器件不存在或未装配：${missing.join('、')}。`);
    const missingPoints=row.operatingPoints.filter(id=>!points.has(id));
    if(missingPoints.length)errors.push(`${label}关联的工作点不存在：${missingPoints.join('、')}。`);
    if(row.action==='not-applicable'){
      if(row.components.length||row.operatingPoints.length)errors.push(`${label}声明不适用时不能同时声称已落实器件或计算。`);
      warnings.push(`${label}：不适用条件仍需人工复核：${row.reason}`);
    }else if(row.action==='unresolved'){
      if(!row.unresolved.length)errors.push(`${label}未决方案必须列明未定条件。`);
    }else{
      if(!row.components.length)errors.push(`${label}采用或调整方案必须绑定实际器件。`);
      if(row.action==='adopt'&&requirement.externalPassives&&!missing.length){
        for(const q of requirement.values){
          const hint=q.unit==='F'?'capacitor':'resistor';
          if(!selected.some(c=>{const v=passiveComponentValue(c);return v&&v.kind===hint&&Math.abs(v.siValue-q.value)<=Math.max(Math.abs(q.value),1e-18)*1e-9;}))
            errors.push(`${label}声称采用 ${q.text}，但绑定器件没有该参数；不同组合须记录adapt及依据。`);
        }
        const coverage=reviewPassiveCoverage({components:selected},{obligations:requirement.quantities});
        for(const c of coverage.coverage)if(!['satisfied','ambiguous'].includes(c.status))errors.push(`${label}绑定器件未按资料明确数量采用${c.value}：${c.status}。`);
      }
      if(row.action==='adapt'&&requirement.values.length){
        if(!row.operatingPoints.length)errors.push(`${label}调整阻容数值必须关联实际工作点评估。`);
        const evaluated=new Set(row.operatingPoints.flatMap(id=>points.get(id)?.components||[]));
        if(row.components.some(ref=>!evaluated.has(ref)))errors.push(`${label}所选器件没有全部纳入关联工作点。`);
        if(!row.unresolved.length)errors.push(`${label}调整参考阻容必须保留适用条件及未验证项。`);
      }
    }
    for(const unknown of row.unresolved)warnings.push(`${label}：${unknown}`);
    decisions.push({...structuredClone(row),source:{subject:requirement.subject,statement:requirement.statement},
      actualComponents:selected.filter(Boolean).map(c=>({ref:c.ref,value:c.value,electricalRole:c.electricalRole})),
      validationScope:'Source-to-design trace and explicit passive values/counts only; topology, ratings and hardware equivalence are not certified.'});
  }
  for(const r of requirements)if(!seen.has(r.guidanceId))errors.push(`缺少应用决策：${r.guidanceId}（${r.subject}）。须记录采用、调整、不适用或未决及依据，不能静默跳过已提取资料。`);
  return {requirements,decisions,errors,warnings};
}
