// Reconcile model prose against current structured calculations. Source
// documents and user requirements never pass through this presentation seam.
const unique=a=>[...new Set(a.filter(x=>typeof x==='string'&&x.trim()))];
const escaped=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const metrics=[
  {label:/(?:滤波压降|供电压降|压降|voltage\s*drop)\s*(?:约|为|[≈~=:：])*/ig,key:'voltageDropV',unit:'V',scale:{V:1,mV:.001}},
  {label:/(?:时间常数|τ|time\s*constant)\s*(?:约|为|[≈~=:：])*/ig,key:'timeConstantS',unit:'s',scale:{s:1,ms:.001,us:1e-6,'µs':1e-6,'μs':1e-6}},
  {label:/(?:储能压降|瞬态压降|transient\s*droop)\s*(?:约|为|[≈~=:：])*/ig,key:'transientDroopV',unit:'V',scale:{V:1,mV:.001}},
];
const names={voltageDropV:['滤波压降','V',1],deviceVoltageV:['负载端电压','V',1],timeConstantS:['时间常数','µs',1e6],
  totalLoadStepCurrentA:['储能合计增量','mA',1e3],requiredNominalCapacitanceF:['最小名义容量','µF',1e6],transientDroopV:['储能压降','V',1],
  transientVoltageFloorV:['储能电压下界','V',1],combinedVoltageFloorV:['联合电压下界','V',1],
  equivalentResistanceOhm:['并联等效阻值','Ω',1],switchingSinkCurrentBoundA:['切换灌流上界','mA',1e3]};
export function currentCalculationNotes(rows=[]){
  return rows.filter(r=>r.calculations?.length).map(r=>{
    const values=r.calculations.flatMap(c=>Object.entries({...c,...(c.upstreamDisturbance||{})}).filter(([k,v])=>names[k]&&Number.isFinite(v)).map(([k,v])=>{
      const [label,unit,scale]=names[k];return `${label} ${Number((v*scale).toPrecision(6))} ${unit}`;
    }));
    if(r.kind==='resistor-load')for(const c of r.calculations)values.push(`${c.ref}：名义峰值 ${Number((c.peakCurrentA*1000).toPrecision(6))} mA，输出条件上界 ${Number((c.driverPinCurrentBoundA*1000).toPrecision(6))} mA`);
    return `${r.id}（${r.owner}，${r.components.join('、')}）：${values.join('；')}。按当前输入条件计算，未核实条件见工作点记录。`;
  });
}
export function reconcileCalculationNotes(notes=[],rows=[]){
  const currentInputs=new Map();
  for(const row of rows)for(const name of Object.keys(row.inputs||{})){
    const key=`${row.owner}.${name}:`,valid=rows.filter(r=>r.owner===row.owner).flatMap(r=>r.assumptions||[]).filter(s=>s.startsWith(key));
    if(valid.length)currentInputs.set(key,new Set(valid));
  }
  const kept=[],archived=[],corrections=[];
  for(const text of unique(notes)){
    let reason=null,ids=[],replacement=null;
    for(const [prefix,valid] of currentInputs)if(text.startsWith(prefix)&&!valid.has(text)){
      reason='工作点输入说明已由当前结构化输入重新生成';ids=rows.filter(r=>text.startsWith(r.owner+'.')).map(r=>r.id);break;
    }
    if(!reason)for(const metric of metrics){
      // A statement must identify an actual owner/component and one specific
      // measured quantity. Ambiguous prose is retained, never silently fixed.
      const relevant=rows.filter(r=>r.calculations?.some(c=>Number.isFinite(c[metric.key]))&&[r.owner,...r.components].some(ref=>new RegExp(`(^|[^A-Za-z0-9_])${escaped(ref)}(?=$|[^A-Za-z0-9_])`).test(text)));
      if(relevant.length!==1)continue;
      const row=relevant[0],actual=row.calculations.filter(c=>Number.isFinite(c[metric.key])).map(c=>c[metric.key]);
      if(actual.length!==1)continue;
      for(const match of text.matchAll(metric.label)){
        const quantity=text.slice(match.index+match[0].length).match(/^\s*([+-]?\d+(?:\.\d+)?)\s*(mV|V|ms|us|µs|μs|s)\b/u);
        if(!quantity||metric.scale[quantity[2]]===undefined)continue;
        const stated=Number(quantity[1])*metric.scale[quantity[2]],precision=(quantity[1].split('.')[1]||'').length;
        const rounding=.51*10**(-precision)*metric.scale[quantity[2]];
        if(Math.abs(stated-actual[0])>Math.max(rounding,Math.abs(actual[0])*1e-6)){
          reason=`文字中的${metric.key}与当前计算不一致；当前值 ${Number(actual[0].toPrecision(8))} ${metric.unit}`;ids=[row.id];
          const at=match.index+match[0].length;
          replacement=text.slice(0,at)+text.slice(at).replace(quantity[0],` ${Number((actual[0]/metric.scale[quantity[2]]).toPrecision(6))} ${quantity[2]}`);break;
        }
      }
      if(reason)break;
    }
    if(reason){archived.push({text,reason,operatingPoints:ids,status:'superseded',uncertaintiesResolved:false});if(replacement)corrections.push({from:text,to:replacement});}else kept.push(text);
  }
  return {notes:kept,archived,corrections,current:currentCalculationNotes(rows)};
}

// Basis text is part of the design as well as the UI. Correct only a
// recognized, unambiguous numeric result, preserving surrounding unknowns
// and the original wording in history. Never rewrite citations or inputs.
export function reconcileDesignCalculationNotes(design,rows){
  const archived=[];
  const update=(record,key)=>{
    if(typeof record?.[key]!=='string')return;
    for(let i=0;i<metrics.length;i++){
      const result=reconcileCalculationNotes([record[key]],rows);
      if(!result.corrections.length)break;
      archived.push(...result.archived);record[key]=result.corrections[0].to;
    }
  };
  for(const r of design.loadAssessments||[])update(r,'basis');
  for(const r of design.peripheralAssessments||[])for(const key of ['supply','output'])update(r[key],'basis');
  for(const r of design.applicationDecisions||[])update(r,'reason');
  return archived;
}

export function engineeringSummary(stage,design,review){
  if(!review)return null;
  const parts=(design?.components||[]).length,pins=(design?.components||[]).reduce((sum,c)=>sum+(c.pins?.length||0),0),nets=(design?.nets||[]).length;
  const prefix=stage===3?'当前候选已完成结构与工作点复核':stage===4?'已从冻结方案生成并回读原理图':stage===7?'本轮原理图与相关文件已导出':'本轮工程已回读核验';
  return `${prefix}：${parts} 个器件、${pins} 个引脚、${nets} 个原始网络；${review.operatingPoints?.length||0} 项工作点。阻容数值和联合计算见“当前电路计算”，来源与假设见工作点记录。${review.unresolved?.length||0} 项设计待核实记录仍保留。参考工程对齐与实物性能尚未由这些检查证明。`;
}
