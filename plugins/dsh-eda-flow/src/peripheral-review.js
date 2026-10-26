import {validateLayoutIntent} from './layout-intent.js';

const arr=x=>Array.isArray(x)?x:[];
const text=x=>typeof x==='string'?x.trim():'';
const clean=x=>text(x).replace(/\s+/g,'').toLowerCase();
const resistance=x=>{
  const m=text(x).replace(/[ΩΩ]/g,'ohm').replace(/\s/g,'').match(/^(\d+(?:\.\d+)?)([kKmM]?)(?:ohm|[rR])?$/);
  return m?Number(m[1])*({'':1,k:1e3,K:1e3,m:1e-3,M:1e6}[m[2]]):null;
};

export const peripheralInstructions=`对红外接收器等需要评估输出偏置和供电噪声的模块，design.peripheralAssessments 每个器件一条：
{ref,pins:{supply:"本器件数字脚号",return:"数字脚号",output:"数字脚号"},supply:{strategy:"filtered"|"direct"|"unresolved",components:["供电串联滤波器件","本地去耦器件"],basis:"工程选择和选值计算假设"或{sourceId,quote},unresolved:[]},output:{strategy:"external-pull-up"|"internal-bias"|"push-pull"|"unresolved",components:["实际上拉电阻"],basis:"依据",unresolved:[]}}。
filtered 必须包含实际串在本器件电源与上游电源之间的正阻值 supply-filter 电阻或磁珠，以及跨本器件电源/地的本地 decoupling 电容。external-pull-up 必须有实际从输出（可经零欧）到供电网的正阻值 pull-up 电阻。计算供电压降、滤波时间常数和输出低电平负载；无法核实的工作参数继续写 unresolved，不把工程值说成资料值。direct/internal-bias/push-pull 省略外围的结论必须有本器件当前资料中的明确引用；仅有 OUT/VCC 引脚名不够。资料不全且任务授权自行设计时，优先形成有计算假设的可评审外围候选，保留待核实项，不因资料未给数值就悄悄省略全部外围；确实无法选择时用 unresolved 说明具体阻碍。此规则不指定厂商、型号、阻值或 AD 网络。
当 design_review 返回 biasRailComparisons 时，按其 policy 选择接法：先服从当前资料明确且可识别的接法/上拉电压限制，再满足同一组工作条件的直流限值，最后优先减少本输出切换对滤波电源的名义电压变化。此项是公开的工程选择目标，不是厂家规定，也不推断其他电源噪声或EMC。资料要求本地接法或上游接法超出适用电压限制时，结果可以选择本地；资料条款不能可靠解析、相互冲突或没有可行方案时须先处理具体缺项。
output.railDecision 仅接受 {connection:"local"|"upstream",basis:{kind:"calculated-policy",policyId:"本次返回的policyId"},unresolved:["电平兼容等未核实条件"]}，不接受自由文字 reason 作为选型依据。connection 必须属于 policy.acceptedConnections 且与实际网络一致；如需改接，使用候选身份及对应案例的 pinMoves 调用 design_amend，同时更新已过时的外围说明和供电/储能工作点后重新完整审查。未验证的动态、噪声、上电或时序推断只能放入 unresolved，不能用其推翻资料与计算。不得修改工作条件只为保留原接法或凑审查通过；改变条件须有真实资料或用户需求依据。输出耐压、断电容限、接收端电平和额定适用性未知时仍明确保留候选状态，不声称硬件验证通过。
所有 electricalRole=decoupling 的电容必须在 functions[].layout 声明 {kind:"decoupling",anchor:"本器件供电脚",return:"同器件地脚",members:["电容位号"]}；同网不代表同一负载。由你根据设计用途决定归属，不向用户索要坐标或逐脚表。`;

export function reviewPeripherals(design,{evidence=[],inputs={}}={}){
  const errors=[],unresolved=[],assessments=[],owners=[];
  const fail=(code,message,ref)=>errors.push({code,message,ref});
  const comps=new Map(arr(design.components).map(c=>[c.ref,c]));
  const netof=new Map(arr(design.nets).flatMap(n=>arr(n.nodes).map(p=>[p,n.name])));
  const pin=(r,n)=>comps.get(r)?.pins?.find(p=>String(p.number)===n);
  const cnets=r=>new Set(arr(comps.get(r)?.pins).map(p=>netof.get(`${r}.${p.number}`)));
  const rows=[...arr(evidence),...arr(evidence?.components),...arr(inputs.evidence)];
  const sourceFor=c=>rows.find(r=>r.sourceType==='model-specification-fact'&&(r.reference===c?.ref||r.symbolId===c?.librarySymbol))
    ||rows.find(r=>r.componentKind&&(r.reference===c?.ref||r.ref===c?.ref||r.symbolId===c?.librarySymbol));
  const active=c=>c&&c.dnp!==true&&c.in_bom!==false;
  const isCap=c=>/^(?:Device:C(?:_|$)|Device:C_Polarized)/i.test(c?.librarySymbol||'')||(sourceFor(c)?.componentKind||c?.componentKind)==='capacitor';
  const claimed=new Set();
  for(const fn of arr(design.functions))for(const relation of arr(fn.layout))if(relation?.kind==='decoupling'){
    for(const ref of arr(relation.members)){
      claimed.add(ref);owners.push({ref,anchor:relation.anchor,return:relation.return});
      const owner=comps.get(text(relation.anchor).split('.')[0]);
      const a=pin(owner?.ref,text(relation.anchor).split('.')[1]);
      const b=pin(owner?.ref,text(relation.return).split('.')[1]);
      if(!isCap(comps.get(ref))||!owner||/connector/i.test(sourceFor(owner)?.componentKind||owner.componentKind||owner.librarySymbol)||!['power_in','power_out'].includes(a?.type)||!['power_in','power_out'].includes(b?.type))
        fail('decoupling-owner-invalid',`${ref} 去耦必须归属实际负载的两个供电引脚，成员必须是电容。`,ref);
    }
  }
  for(const c of comps.values())if(active(c)&&c.electricalRole==='decoupling'&&!claimed.has(c.ref))
    fail('decoupling-owner-missing',`${c.ref} 缺少负载归属：在 functions[].layout 给出 decoupling 的 anchor、return、members（由设计者决定，不需用户坐标）。`,c.ref);
  for(const message of validateLayoutIntent(design))fail('decoupling-topology-invalid',message);

  const roots=new Map([...netof.values()].map(n=>[n,n]));
  const root=n=>{while(roots.has(n)&&roots.get(n)!==n)n=roots.get(n);return n;};
  for(const c of comps.values())if(active(c)&&c.electricalRole==='routing-bridge'&&resistance(c.value)===0){
    const ns=[...cnets(c.ref)].filter(Boolean);if(ns.length===2)roots.set(root(ns[0]),root(ns[1]));
  }
  const eq=(a,b)=>a!==undefined&&b!==undefined&&root(a)===root(b);
  const supplied=n=>arr(design.supplied_nets).some(s=>eq(n,s))||[...comps.values()].some(c=>arr(c.pins).some(p=>p.type==='power_out'&&eq(n,netof.get(`${c.ref}.${p.number}`))));
  const receivers=[...comps.values()].filter(c=>active(c)&&/infrared.receiver/i.test(sourceFor(c)?.componentKind||c.componentKind||c.librarySymbol));
  const declared=arr(design.peripheralAssessments);
  for(const a of declared)if(!comps.has(a?.ref)||declared.filter(v=>v?.ref===a.ref).length!==1)fail('peripheral-assessment-invalid','外围评审位号未知或重复。',a?.ref);
  for(const c of receivers){
    const assessment=declared.find(a=>a?.ref===c.ref);
    if(!assessment){fail('peripheral-assessment-missing',`${c.ref} 缺少 peripheralAssessments：需明确供电滤波和输出偏置方案。`,c.ref);continue;}
    const startErrors=errors.length,startUnresolved=unresolved.length;
    const pins=assessment.pins||{};
    const supply=netof.get(`${c.ref}.${pins.supply}`),ground=netof.get(`${c.ref}.${pins.return}`),output=netof.get(`${c.ref}.${pins.output}`);
    if(pin(c.ref,pins.supply)?.type!=='power_in'||/^(?:[ASDP]?GND|VSS|RETURN)$/i.test(pin(c.ref,pins.supply)?.name)||pin(c.ref,pins.return)?.type!=='power_in'||!['output','open_collector','open_emitter','tri_state'].includes(pin(c.ref,pins.output)?.type)||supply===ground||[supply,ground,output].some(n=>n===undefined)){
      fail('peripheral-pins-invalid',`${c.ref} 外围评审必须指向真实电源、返回与输出脚。`,c.ref);continue;
    }
    const source=sourceFor(c),sourceIds=new Set(arr(source?.citations).map(q=>q.sourceId));
    const sourceDocuments=new Set(rows.filter(r=>sourceIds.has(r.id)&&r.document).map(r=>r.document));
    const citation=decision=>{
      const b=decision?.basis,s=rows.find(r=>r.id===b?.sourceId);
      return s&&(sourceIds.has(b?.sourceId)||sourceDocuments.has(s.document))&&text(b?.quote).length>=8&&clean(s.content).includes(clean(b.quote))?b.quote:'';
    };
    const localCaps=[...comps.values()].filter(p=>active(p)&&isCap(p)&&p.electricalRole==='decoupling'&&cnets(p.ref).has(supply)&&cnets(p.ref).has(ground)&&owners.some(o=>o.ref===p.ref&&o.anchor===`${c.ref}.${pins.supply}`&&o.return===`${c.ref}.${pins.return}`));
    const upstream=[];
    for(const field of ['supply','output']){
      const d=assessment[field],choices=field==='supply'?['filtered','direct','unresolved']:['external-pull-up','internal-bias','push-pull','unresolved'];
      if(!d||!choices.includes(d.strategy)||!Array.isArray(d.components)||!Array.isArray(d.unresolved)||!d.basis){fail('peripheral-decision-invalid',`${c.ref}.${field} 缺少 strategy/components/basis/unresolved。`,c.ref);continue;}
      for(const item of d.unresolved)if(text(item))unresolved.push(`${c.ref}.${field}: ${item}`);
      if(d.strategy==='unresolved'){
        if(!d.unresolved.some(text))fail('peripheral-unresolved-empty',`${c.ref}.${field} 待定方案必须说明缺项。`,c.ref);
        continue;
      }
      const selected=d.components.map(r=>comps.get(r));
      if(selected.some(p=>!active(p)))fail('peripheral-component-invalid',`${c.ref}.${field} 引用不存在或未装配器件。`,c.ref);
      if(d.strategy==='filtered'){
        const filters=selected.filter(p=>p?.electricalRole==='supply-filter'&&((resistance(p.value)>0&&/resistor|Device:R/i.test(p.componentKind||p.librarySymbol))||/ferrite|bead/i.test(p.librarySymbol))&&cnets(p.ref).size===2&&cnets(p.ref).has(supply));
        for(const p of filters)for(const n of cnets(p.ref))if(n!==supply&&!eq(n,ground)&&supplied(n))upstream.push(n);
        if(!upstream.length||!localCaps.some(p=>d.components.includes(p.ref)))fail('peripheral-filter-path-missing',`${c.ref} filtered 需要真实上游供电串阻/磁珠和归属本器件的本地去耦。`,c.ref);
      }
      if(d.strategy==='external-pull-up'){
        const rails=[supply,...upstream];
        const valid=selected.some(p=>p?.electricalRole==='pull-up'&&resistance(p.value)>0&&/resistor|Device:R/i.test(p.componentKind||p.librarySymbol)&&cnets(p.ref).size===2&&[...cnets(p.ref)].some(n=>eq(n,output))&&[...cnets(p.ref)].some(n=>!eq(n,output)&&!eq(n,ground)&&rails.some(r=>eq(r,n))));
        if(!valid)fail('peripheral-pull-up-path-missing',`${c.ref} external-pull-up 必须有正阻值上拉连接输出与供电，不能借用串联电阻或下拉。`,c.ref);
      }
      if(['direct','internal-bias','push-pull'].includes(d.strategy)){
        const q=citation(d),patterns={direct:/direct|without.{0,20}filter|无需.{0,12}滤波|不需要.{0,12}滤波/i,'internal-bias':/internal.{0,30}pull.?up|内置.{0,12}上拉|无需.{0,12}外部上拉/i,'push-pull':/push.?pull|推挽/i};
        if(!q||!patterns[d.strategy].test(q)||/not.{0,10}push.?pull|非推挽|无内置上拉|no internal pull/i.test(q))fail('peripheral-omission-source-missing',`${c.ref}.${field} 省略外围需要本器件明确引用，不能以 OUT/VCC 引脚名证明。`,c.ref);
      }else if(!citation(d)&&!d.unresolved.some(text)){
        fail('peripheral-engineering-assumption-missing',`${c.ref}.${field} 为工程选择时须列出选值/工作条件待核实项。`,c.ref);
      }
    }
    assessments.push({...assessment,status:errors.length>startErrors?'invalid':unresolved.length>startUnresolved?'needs-review':'reviewed'});
  }
  return {errors,unresolved,peripheralAssessments:assessments,decouplingOwners:owners};
}
