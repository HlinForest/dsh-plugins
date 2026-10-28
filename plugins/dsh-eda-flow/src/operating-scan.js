// One common return enabled at a time, all fitted branches on: a bounded
// multiplexed load model. Topology comes from the candidate, never a board map.
const active=c=>c&&c.dnp!==true&&c.in_bom!==false;
const driven=p=>['output','open_collector','open_emitter','tri_state','bidirectional'].includes(p.type);
export function branchCurrents(m,r){
 const v=m.values;
 return {nominal:Math.max(0,v.supplyVoltage-v.forwardVoltage-v.driverDrop)/r.value,
  upper:Math.max(0,v.supplyVoltage-(v.minForwardVoltage??0)-(v.minDriverDrop??0))/r.value};
}
export function coupleScanLoads(models,domains,parts){
 const loads=[],errors=new Map();
 const fail=(m,s)=>{const a=errors.get(m.id)||[];a.push(s);errors.set(m.id,a);};
 const refs=new Set();
 for(const m of models.filter(m=>m.row.kind==='resistor-load')){
  const owner=parts.get(m.row.owner),ownerDomains=new Set(domains.ends(owner));
  const far=m.selected.map(c=>domains.pair(c).find(n=>!ownerDomains.has(n)));
  const drivers=[...parts.values()].filter(c=>active(c)&&c.ref!==owner.ref&&far.every(n=>c.pins?.some(p=>driven(p)&&domains.pinDomain(c.ref,p.number)===n)));
  const powered=drivers.filter(c=>domains.reservoirBindings.some(b=>b.owner===c.ref));
  if(!m.row.driver&&!powered.length&&m.values.scanSlots===undefined)continue;
  const driver=drivers.find(c=>c.ref===m.row.driver);
  const bindings=domains.reservoirBindings.filter(b=>b.owner===driver?.ref);
  if(!driver||new Set(bindings.map(b=>JSON.stringify([b.supply,b.ground]))).size!==1){
   fail(m,'扫描负载须声明实际 driver，且每条限流支路直接通向该驱动器输出；驱动器须有唯一已声明供电/返回域。');continue;
  }
  const binding=bindings[0],branchDomains=new Set(m.selected.flatMap(c=>domains.pair(c)).filter(n=>ownerDomains.has(n)));
  for(const [key,input] of [['branch-current','maxPeakCurrent'],['common-current','maxGroupCurrent']]){
   const unknown=m.row.unresolvedLimits?.includes(key);
   if(m.values[input]===undefined&&!unknown)fail(m,`扫描电流限值 ${input} 未评估；请读取当前资料的绝对最大/保证上限，确实缺失才在 unresolvedLimits 中列出 ${key}。`);
   if(m.values[input]!==undefined&&unknown)fail(m,`${input} 已填写，不能同时声明同一限值缺失。`);
   if(unknown)m.missing.push(`${m.row.owner}.${key}: 电流上限未确定，当前计算不能证明负载或驱动器额定满足。`);
  }
  if(errors.has(m.id))continue;
  const commons=owner.pins.filter(p=>!branchDomains.has(domains.pinDomain(owner.ref,p.number)));
  if(!commons.length||commons.some(p=>!driver.pins.some(q=>driven(q)&&domains.pinDomain(owner.ref,p.number)===domains.pinDomain(driver.ref,q.number)))){
   fail(m,'当前扫描模型要求其余负载公共端直接或经零欧桥连接到同一驱动器输出；多级驱动、未连接公共端不能套用。');continue;
  }
  const count=new Set(commons.map(p=>domains.pinDomain(owner.ref,p.number))).size;
  if(!Number.isInteger(m.values.scanSlots)||m.values.scanSlots<count||m.values.duty*m.values.scanSlots>1+1e-10){
   fail(m,'scanSlots 必须为不小于实际公共端数的正整数；单支路 duty 不得大于 1/scanSlots。');continue;
  }
  if(m.selected.some(c=>refs.has(c.ref))){fail(m,'扫描限流支路重复建模，不能重复计入供电负载。');continue;}
  m.selected.forEach(c=>refs.add(c.ref));
  const currents=m.rValues.map(r=>branchCurrents(m,r));
  const nominalOnCurrentA=currents.reduce((s,c)=>s+c.nominal,0),onCurrentBoundA=currents.reduce((s,c)=>s+c.upper,0);
  const assumptions=[...m.missing,
   '扫描电流上界假设电源不超过声明电压、负载及驱动压降非负；缺少压降下界时按 0 V，不能把典型值/单点测试电压作为保证下界。',
   '按一次只使能一个公共端、每个已连接公共端所有限流支路同时点亮的包络；内部矩阵、亮度调制、扫描切换和内部额外电流仍待核实。'];
  if(!m.values.scanFrequency)assumptions.push('扫描频率未知：不使用串行通信时钟替代，不能据此判定纹波频谱或稳态滤波效果。');
  const commonDriverPins=driver.pins.filter(q=>commons.some(p=>domains.pinDomain(owner.ref,p.number)===domains.pinDomain(driver.ref,q.number))).map(p=>p.number);
  const branchDriverPins=Object.fromEntries(m.selected.map((c,i)=>[c.ref,driver.pins.filter(p=>driven(p)&&domains.pinDomain(driver.ref,p.number)===far[i]).map(p=>p.number)]));
  const result={driver:driver.ref,supply:binding.supply,ground:binding.ground,commonDriverPins,branchDriverPins,connectedCommons:count,scanSlots:m.values.scanSlots,
   nominalOnCurrentA,onCurrentBoundA,nominalAverageRailCurrentA:nominalOnCurrentA*m.values.duty*count,
   averageRailCurrentBoundA:onCurrentBoundA*m.values.duty*count,
   ...(m.values.scanFrequency?{scanFrequencyHz:m.values.scanFrequency,slotTimeS:1/(m.values.scanFrequency*m.values.scanSlots)}:{}),
   scenario:'one-common-at-a-time-all-fitted-branches-on',assumptions};
  m.scan=result;loads.push({model:m,...result});
 }
 return {loads,errors};
}

// Propagate a bounded upstream disturbance through the actual single-RC feed.
// The first window is explicit: no claim of periodic steady state or recovery.
export function propagateSupplyDisturbance(results,models,domains,errors){
 const supplies=results.filter(r=>r.kind==='supply-transient'&&r.calculations?.length);
 for(const local of supplies){
  const filter=results.find(r=>r.kind==='rc-filter'&&r.coupling?.rail===local.coupling?.rail&&r.calculations?.length);
  if(!filter)continue;
  const upstream=supplies.find(r=>r.coupling?.rail===filter.coupling.upstream&&r.coupling?.ground===local.coupling?.ground);
  if(!upstream)continue;
  const c=local.calculations[0],f=filter.calculations[0],u=upstream.calculations[0];
  const windowS=Math.min(upstream.inputs.supportTime.value,local.inputs.supportTime.value),tau=f.resistanceOhm*c.effectiveCapacitanceF;
  // ESR feedthrough is included: tau = (R + ESR) C, transfer starts at ESR/(R+ESR).
  const esr=local.inputs.equivalentEsr.value,ratio=1-f.resistanceOhm/(f.resistanceOhm+esr)*Math.exp(-windowS/((f.resistanceOhm+esr)*c.effectiveCapacitanceF));
  const droop=u.transientDroopV*ratio,combined=c.transientDroopV+droop,floor=f.deviceVoltageV-combined;
  c.upstreamDisturbance={operatingPoint:upstream.id,windowS,effectiveRcTimeConstantS:tau,
   upstreamDroopBoundV:u.transientDroopV,firstWindowDroopBoundV:droop,combinedDroopBoundV:combined,combinedVoltageFloorV:floor};
  const assumptions=[...upstream.assumptions,'联合压降仅覆盖声明的首个供电响应窗口；上游在此期间不超过计算跌落包络。恢复时间、周期扫描累积、频谱与稳压环路未确定，不能作为全时间波形保证。'];
  local.assumptions=[...new Set([...local.assumptions,...assumptions])];
  local.coupling.relatedOperatingPoints=[...new Set([...local.coupling.relatedOperatingPoints,upstream.id,...upstream.coupling.relatedOperatingPoints])].sort();
  if(upstream.status==='invalid'||floor<filter.inputs.minDeviceVoltage.value||combined>local.inputs.maxDroop.value){
   errors.push({code:'operating-limit-exceeded',id:local.id,message:`${local.id}: 上游供电与本地负载联合首窗口压降 ${combined} V，电压下界 ${floor} V；上游必须有效且满足本地压降/最低电压约束。`});local.status='invalid';
  }else local.status='needs-review';
 }
}
