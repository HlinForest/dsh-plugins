// DC coupling for a bounded, single-feed RC supply. The inputs have already
// passed source, value and topology checks in reviewOperatingPoints. No part
// identities or design-specific values live here. Unsupported rail loads are
// rejected instead of silently returning an optimistic voltage.
const close=(a,b)=>Math.abs(a-b)<=1e-10*Math.max(Math.abs(a),Math.abs(b),1e-12);
const active=c=>c&&c.dnp!==true&&c.in_bom!==false;

// This is a conditional envelope for nonnegative outputs. A quoted VOL max
// cannot be subtracted when seeking the maximum switching current. Expose the
// envelope assumptions; neither source overshoot nor output undershoot is solved.
export const switchingAssumption='切换估算假设上拉电源不高于声明的源电压、输出不低于返回端 0 V；电源过冲、预充或输出负向尖峰须另行核实。';
export const switchingCurrent=(sourceVoltage,resistance)=>sourceVoltage/resistance;

export function coupleOperatingPoints(models,domains,parts){
  const corrections=new Map(),errors=new Map(),groups=new Map(),rails=new Map();
  const fail=(model,message)=>{
    const list=errors.get(model.row.id)||[];if(!list.includes(message))list.push(message);errors.set(model.row.id,list);
  };
  const groupFail=(g,message)=>g.models.forEach(m=>fail(m,message));
  const pins=m=>{
    const p=m.assessment?.pins||{};
    return {supply:domains.pinDomain(m.row.owner,p.supply),ground:domains.pinDomain(m.row.owner,p.return),output:domains.pinDomain(m.row.owner,p.output)};
  };
  for(const m of models.filter(m=>m.row.kind==='rc-filter')){
    const {supply,ground}=pins(m),r=m.selected.find(domains.isR),upstream=domains.pair(r).find(n=>n!==supply);
    let g=groups.get(supply);
    if(!g){g={supply,ground,upstream,resistor:r.ref,resistance:m.rValues[0].value,models:[],filters:[],pulls:[]};groups.set(supply,g);}
    g.models.push(m);g.filters.push(m);
    if(g.resistor!==r.ref||g.ground!==ground||g.upstream!==upstream)groupFail(g,'同一滤波电源域的供电路径或返回域不一致。');
  }
  const allPulls=models.filter(m=>m.row.kind==='pull-up');
  for(const m of allPulls){
    const {output,ground}=pins(m),rail=domains.pair(m.selected[0]).find(n=>n!==output);
    const g=groups.get(rail);
    if(g){g.models.push(m);g.pulls.push(m);if(g.ground!==ground)groupFail(g,'同一滤波电源上的输出必须使用相同返回域。');}
    else if(rail===pins(m).supply&&[...parts.values()].some(c=>active(c)&&c.electricalRole==='supply-filter'&&domains.pair(c)?.includes(rail)))
      fail(m,'上拉实际接在滤波电源上，但缺少该电源的有效 rc-filter 工作点，不能按理想电源计算。');
  }
  // SupplyVoltage consistently means the upstream source of a filtered rail.
  // A second row may not redefine that source merely to pass a limit check.
  for(const m of models.filter(m=>m.row.kind==='rc-filter'||m.row.kind==='pull-up')){
    const p=pins(m),rail=m.row.kind==='rc-filter'?groups.get(p.supply)?.upstream:domains.pair(m.selected[0]).find(n=>n!==p.output);
    const source=groups.get(rail)?.upstream||rail,key=JSON.stringify([source,p.ground]);
    const prior=rails.get(key);
    if(prior&&!close(prior.values.supplyVoltage,m.values.supplyVoltage)){
      fail(prior,'同一上游电源的 supplyVoltage 不一致。');fail(m,'同一上游电源的 supplyVoltage 不一致。');
    }else if(!prior)rails.set(key,m);
  }
  for(const g of groups.values()){
    if(groups.has(g.upstream))groupFail(g,'级联滤波暂不适用单级 RC 联合模型；不能把中间电源当作理想源。');
    const owners=g.filters.map(m=>m.row.owner);
    if(new Set(owners).size!==owners.length)groupFail(g,'同一器件的滤波负载电流重复声明。');
    const pullRefs=g.pulls.flatMap(m=>m.row.components);
    if(new Set(pullRefs).size!==pullRefs.length)groupFail(g,'同一上拉被重复计入多个工作点。');
    const allowed=new Set([g.resistor,...g.filters.flatMap(m=>m.row.components),...owners,...pullRefs]);
    for(const c of parts.values())if(active(c)&&domains.ends(c).includes(g.supply)&&!allowed.has(c.ref)){
      if(c.electricalRole==='routing-bridge'&&domains.isR(c)&&domains.ends(c).every(n=>n===g.supply))continue;
      groupFail(g,`${c.ref} 连接该滤波电源但未纳入有效负载模型，不能忽略其电流。`);
    }
    if(g.models.some(m=>errors.has(m.row.id))){groupFail(g,'联合供电条件不完整或冲突，本组不输出独立计算作为替代。');continue;}
    const current=g.filters.reduce((sum,m)=>sum+m.values.deviceCurrent,0),vs=g.filters[0].values.supplyVoltage,r=g.resistance;
    const pulls=g.pulls.map(m=>({model:m,low:m.values.lowVoltage,resistance:1/m.rValues.reduce((s,v)=>s+1/v.value,0)}));
    const solve=enabled=>(vs/r-current+enabled.reduce((s,p)=>s+p.low/p.resistance,0))/(1/r+enabled.reduce((s,p)=>s+1/p.resistance,0));
    const high=solve([]),low=solve(pulls);
    if(low<0||pulls.some(p=>p.low>low)){groupFail(g,'声明的恒流负载或输出低电平在联合供电下不可达；此线性模型失效。');continue;}
    const assumptions=[...new Set(g.models.flatMap(m=>m.missing))];
    const ids=g.models.map(m=>m.row.id).sort();
    for(const m of g.filters)corrections.set(m.row.id,{
      voltageDropV:vs-low,deviceVoltageV:low,highStateDeviceVoltageV:high,
      deviceLoadCurrentA:current,totalSupplyCurrentA:(vs-low)/r,
      downstreamPullUpCurrentA:pulls.reduce((s,p)=>s+(low-p.low)/p.resistance,0),
      resistorPowerW:(vs-low)**2/r,
      coupling:{rail:g.supply,upstream:g.upstream,ground:g.ground,relatedOperatingPoints:ids,
        supplyScenario:'all-modelled-outputs-low',assumptions},
    });
    for(const p of pulls){
      const m=p.model,oneLow=solve([p]);
      corrections.set(m.row.id,{sinkCurrentA:(oneLow-p.low)/p.resistance,
        switchingSinkCurrentBoundA:switchingCurrent(vs,p.resistance),
        simultaneousLowSinkCurrentA:(low-p.low)/p.resistance,
        pullUpRailVoltageV:oneLow,
        coupling:{rail:g.supply,upstream:g.upstream,ground:g.ground,relatedOperatingPoints:ids,
          sinkScenario:'this-output-low-others-high',assumptions},
      });
    }
  }
  return {corrections,errors};
}
