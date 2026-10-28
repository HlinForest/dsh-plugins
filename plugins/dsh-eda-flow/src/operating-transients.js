// Conservative charge-budget load composition, not a waveform simulator.
// Connectivity determines which pull-ups draw from a capacitor domain. Their
// high-to-low step uses the declared source voltage as a rail-voltage bound;
// a new, lower DC equilibrium must not understate the initial switching load.
import {switchingAssumption,switchingCurrent} from './operating-coupling.js';
const active=c=>c&&c.dnp!==true&&c.in_bom!==false;
const close=(a,b)=>Math.abs(a-b)<=1e-10*Math.max(Math.abs(a),Math.abs(b),1e-12);

export function coupleTransientLoads(models,domains,parts,dc,assessments=[],scan={loads:[],errors:new Map()},internalBias=[]){
  const corrections=new Map(),errors=new Map(),byDomain=new Map();
  const fail=(m,message)=>{
    const list=errors.get(m.id)||[];if(!list.includes(message))list.push(message);errors.set(m.id,list);
  };
  const rows=models.filter(m=>m.row.kind==='supply-transient');
  const pulls=models.filter(m=>m.row.kind==='pull-up');
  for(const m of rows){
    const binding=domains.reservoirFor(m.row,m.selected),{supply,ground}=binding;
    const key=JSON.stringify([supply,ground]);
    if(!byDomain.has(key))byDomain.set(key,[]);
    byDomain.get(key).push(m);
    const actual=[...parts.values()].filter(c=>active(c)&&c.electricalRole==='pull-up'&&domains.ends(c).includes(supply));
    const attached=pulls.filter(p=>p.selected.some(c=>actual.some(a=>a.ref===c.ref)));
    const scanned=scan.loads.filter(l=>l.supply===supply&&l.ground===ground);
    const internal=internalBias.filter(l=>l.supply===supply&&l.ground===ground);
    const driverRefs=domains.reservoirBindings.filter(b=>b.supply===supply&&b.ground===ground).map(b=>b.owner);
    const branchResistors=[...parts.values()].filter(c=>active(c)&&c.electricalRole==='current-limit'&&driverRefs.some(ref=>
      parts.get(ref)?.pins?.some(p=>['output','open_collector','open_emitter','tri_state','bidirectional'].includes(p.type)&&domains.ends(c).includes(domains.pinDomain(ref,p.number)))));
    if(branchResistors.some(c=>scanned.filter(l=>l.model.row.components.includes(c.ref)).length!==1))
      fail(m,'本电源驱动的实际限流支路必须被一个有效扫描负载模型覆盖；不能省略工作点后以手填基础电流代替。其他驱动方式需独立模型。');
    const scanFailures=[...scan.errors.keys()].filter(id=>{
      const l=models.find(p=>p.id===id);
      return domains.reservoirBindings.some(b=>b.supply===supply&&b.ground===ground&&
        (b.owner===l?.row.driver||l?.selected.some(c=>domains.ends(parts.get(b.owner)).some(n=>domains.ends(c).includes(n)))));
    });
    if(scanFailures.length)fail(m,'该电源的扫描负载模型无效，不能退回手填电流或忽略该负载。');
    if(scanned.length&&m.row.loadStepScope!=='excluding-derived-loads')fail(m,'本域有扫描负载，必须声明 loadStepScope="excluding-derived-loads"；loadStepCurrent 只填未建模的残余增量，段电流与外部上拉由实际连接自动加入，禁止再次手填合计段电流。');
    if(actual.length&&!['excluding-pull-ups','excluding-derived-loads'].includes(m.row.loadStepScope)){
      fail(m,'该电源有实际上拉；请声明 loadStepScope="excluding-pull-ups"，loadStepCurrent 排除本域直接供电且独立建模的外部上拉，宿主按实际网络另加其切换电流；内部上拉及其他负载仍须计入基础增量。');
    }
    const coverage=new Map();
    for(const p of attached)for(const c of p.selected)coverage.set(c.ref,(coverage.get(c.ref)||0)+1);
    if(actual.some(c=>coverage.get(c.ref)!==1))fail(m,'电源上的每个实际上拉都必须有且只有一个有效 pull-up 工作点，不能遗漏或重复计入储能负载。');
    const filters=models.filter(p=>p.row.kind==='rc-filter'&&domains.pinDomain(p.row.owner,p.assessment.pins.supply)===supply);
    const filtered=assessments.some(a=>domains.pinDomain(a.ref,a.pins?.supply)===supply&&
      [...parts.values()].some(c=>active(c)&&c.electricalRole==='supply-filter'&&a.supply?.components?.includes(c.ref)&&domains.pair(c)?.includes(supply)));
    if(filtered&&!filters.length)fail(m,'本电源的滤波供电模型缺失，不能把储能所在电源当作理想源。');
    const dependencies=[...filters,...attached,...scanned.map(l=>l.model)];
    if(dependencies.some(p=>dc.errors.has(p.id)))fail(m,'相关滤波/上拉条件无效，不能输出独立储能计算作为替代。');
    const voltages=dependencies.map(p=>p.values.supplyVoltage);
    if(m.values.supplyVoltage!==undefined)voltages.push(m.values.supplyVoltage);
    if(internal.length&&(!voltages.length||m.row.loadStepScope!=='excluding-derived-loads'))fail(m,'有来源的内部偏置须关联供电电压，并以 excluding-derived-loads 声明残余不重复计入内部偏置。');
    if(voltages.some(v=>!close(v,voltages[0])))fail(m,'同一储能电源的上游源电压不一致。');
    if(attached.some(p=>domains.pinDomain(p.row.owner,p.assessment.pins.return)!==ground))fail(m,'上拉输出与储能评估使用不同返回域，当前单域模型不适用。');
    const dcRows=filters.map(f=>dc.corrections.get(f.id));
    if(filtered&&dcRows.some(r=>!r))fail(m,'缺少有效的滤波电源联合结果。');
    if(errors.has(m.id))continue;
    const contributions=attached.map(p=>{
      const conductance=p.rValues.reduce((sum,r)=>sum+1/r.value,0);
      return {operatingPoint:p.id,owner:p.row.owner,components:p.row.components,
        sourceVoltageBoundV:p.values.supplyVoltage,assumedMinimumLowVoltageV:0,
        switchingCurrentBoundA:switchingCurrent(p.values.supplyVoltage,1/conductance)};
    });
    const pullUpStepCurrentA=contributions.reduce((sum,p)=>sum+p.switchingCurrentBoundA,0);
    const scanLoadStepCurrentA=scanned.reduce((sum,l)=>sum+l.onCurrentBoundA,0);
    const internalBiasContributions=internal.map(({key,members,...l})=>({...l,supplyVoltageV:voltages[0],currentA:voltages[0]/l.resistanceOhm*l.activeCount}));
    const internalBiasCurrentA=internalBiasContributions.reduce((sum,l)=>sum+l.currentA,0);
    const initialVoltageV=dcRows.length?Math.min(...dcRows.map(r=>r.highStateDeviceVoltageV)):undefined;
    const minimumDeviceVoltageV=filters.length?Math.max(...filters.map(f=>f.values.minDeviceVoltage)):undefined;
    corrections.set(m.id,{baseLoadStepCurrentA:m.values.loadStepCurrent,pullUpStepCurrentA,scanLoadStepCurrentA,internalBiasCurrentA,
      totalLoadStepCurrentA:m.values.loadStepCurrent+pullUpStepCurrentA+scanLoadStepCurrentA+internalBiasCurrentA,
      ...(initialVoltageV!==undefined?{initialVoltageV,minimumDeviceVoltageV}:{}),
      coupling:{kind:'charge-budget',rail:supply,ground,upstream:dcRows[0]?.coupling.upstream||supply,
        relatedOperatingPoints:[m.id,...dependencies.map(p=>p.id)].sort(),
        scenario:'all-direct-pullups-high-to-low-with-nonnegative-output',contributions,
        scanContributions:scanned.map(({model,...l})=>({operatingPoint:model.id,...l})),
        internalBiasContributions,
        assumptions:[...new Set([...dependencies.flatMap(p=>p.missing),...scanned.flatMap(l=>l.assumptions),...internal.flatMap(l=>l.assumptions),...(attached.length?[switchingAssumption]:[])])]}});
  }
  // A row's base step covers the whole domain, not just its named owner.
  // Multiple owners on the same physical capacitor bank cannot independently
  // redefine that physical load or capacitance derating to pass their checks.
  for(const peers of byDomain.values())for(const m of peers.slice(1)){
    if(['loadStepCurrent','supportTime','effectiveCapacitanceRatio','equivalentEsr'].some(k=>!close(m.values[k],peers[0].values[k]))){
      for(const p of peers)fail(p,'同一实际储能电源的负载增量、支撑时间、容量折减和等效 ESR 必须一致；当前不支持把不同场景混为同一次评估。');
    }
  }
  for(const id of errors.keys())corrections.delete(id);
  return {corrections,errors};
}
