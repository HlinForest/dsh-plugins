// Compare two placements of an existing pull-up against the SAME fitted RC
// supply and explicit operating inputs. This module neither edits the circuit
// nor supplies missing electrical limits, reference values or board pin maps.
const arr=x=>Array.isArray(x)?x:[];
const text=x=>typeof x==='string'?x.trim():'';
const active=c=>c&&c.dnp!==true&&c.in_bom!==false;
const close=(a,b)=>Math.abs(a-b)<=1e-10*Math.max(Math.abs(a),Math.abs(b),1e-12);

export function compareBiasRails(models,domains,parts,results){
  // A calculated limit violation can be the reason to reconsider the rail.
  // Malformed inputs or unsupported topology have no calculation and stay out.
  const valid=new Set(results.filter(r=>arr(r.calculations).length).map(r=>r.id));
  const filters=models.filter(m=>m.row.kind==='rc-filter');
  const pulls=models.filter(m=>m.row.kind==='pull-up');
  const pins=m=>{
    const p=m.assessment?.pins||{};
    return {supply:domains.pinDomain(m.row.owner,p.supply),ground:domains.pinDomain(m.row.owner,p.return),output:domains.pinDomain(m.row.owner,p.output)};
  };
  const rail=m=>domains.pair(m.selected[0])?.find(n=>n!==pins(m).output);
  const effective=m=>1/m.rValues.reduce((s,r)=>s+1/r.value,0);
  const comparisons=[];
  for(const pull of pulls){
    if(!valid.has(pull.id))continue;
    const own=pins(pull),group=filters.filter(m=>pins(m).supply===own.supply&&pins(m).ground===own.ground);
    if(!group.length||group.some(m=>!valid.has(m.id)))continue;
    const feed=group[0].selected.find(domains.isR),upstream=domains.pair(feed)?.find(n=>n!==own.supply);
    if(!feed||upstream===undefined||group.some(m=>m.selected.find(domains.isR)?.ref!==feed.ref))continue;
    const currentRail=rail(pull),selected=currentRail===own.supply?'local':currentRail===upstream?'upstream':null;
    if(!selected)continue;
    const related=pulls.filter(m=>rail(m)===own.supply&&m.id!==pull.id);
    if(related.some(m=>!valid.has(m.id)||pins(m).ground!==own.ground))continue;
    const sourceVoltage=group[0].values.supplyVoltage;
    if([pull,...group,...related].some(m=>!close(m.values.supplyVoltage,sourceVoltage)))continue;
    // The established joint-supply checker rejects unknown rail loads. Repeat
    // this boundary so incomplete successful-subsets cannot produce alternatives.
    const allowed=new Set([feed.ref,...group.flatMap(m=>[m.row.owner,...m.row.components]),...related.flatMap(m=>m.row.components),...pull.row.components]);
    if([...parts.values()].some(c=>active(c)&&domains.ends(c).includes(own.supply)&&!allowed.has(c.ref)&&
      !(c.electricalRole==='routing-bridge'&&domains.isR(c)&&domains.ends(c).every(n=>n===own.supply))))continue;
    const resistance=group[0].rValues[0].value,deviceCurrent=group.reduce((s,m)=>s+m.values.deviceCurrent,0);
    const minDeviceVoltage=Math.max(...group.map(m=>m.values.minDeviceVoltage));
    const eqResistance=effective(pull),low=pull.values.lowVoltage;
    const solve=enabled=>(sourceVoltage/resistance-deviceCurrent+enabled.reduce((s,m)=>s+m.values.lowVoltage/effective(m),0)) /
      (1/resistance+enabled.reduce((s,m)=>s+1/effective(m),0));
    const cases=['local','upstream'].map(connection=>{
      const local=connection==='local',enabled=local?[...related,pull]:related;
      const high=solve(related),allLow=solve(enabled),onlyThisLow=local?solve([pull]):solve([]);
      const sinkCurrent=(local?onlyThisLow-low:sourceVoltage-low)/eqResistance;
      const switchingBound=sourceVoltage/eqResistance;
      const physicallyDefined=allLow>=0&&enabled.every(m=>allLow>=m.values.lowVoltage)&&sinkCurrent>=0;
      return {connection,rail:local?own.supply:upstream,deviceVoltageWithThisOutputHighV:high,minimumDeviceVoltageV:allLow,
        supplyModulationFromThisOutputV:high-allLow,maxSteadySinkCurrentA:sinkCurrent,switchingSinkCurrentBoundA:switchingBound,
        nominalOpenOutputVoltageV:local?solve([]):sourceVoltage,
        nominalDcWithinDeclaredLimits:physicallyDefined&&allLow>=minDeviceVoltage&&sinkCurrent<=pull.values.maxSinkCurrent&&switchingBound<=pull.values.maxSinkCurrent,
        physicallyDefined};
    });
    comparisons.push({owner:pull.row.owner,pullUpComponents:[...pull.row.components].sort(),feedComponent:feed.ref,selected,
      localSupply:own.supply,upstreamSupply:upstream,returnDomain:own.ground,relatedOperatingPoints:[...new Set([pull,...group,...related].map(m=>m.id))].sort(),
      conditions:{sourceVoltageV:sourceVoltage,deviceCurrentA:deviceCurrent,feedResistanceOhm:resistance,pullUpResistanceOhm:eqResistance,
        lowVoltageV:low,minDeviceVoltageV:minDeviceVoltage,maxSinkCurrentA:pull.values.maxSinkCurrent},cases,
      assumptions:[...new Set([pull,...group,...related].flatMap(m=>m.missing))],
      scenarios:{minimumSupply:'All fitted local pull-up outputs low.',maxSteadySink:'Only the compared output low; other local outputs open.',modulation:'Only the compared output toggles; other local outputs remain low.'},
      unverified:['输出端可承受的上拉电压、断电容限和输入高电平兼容性须由适用规格核实。','高态按开路且上游为理想源；未计输出漏电、源阻抗或钳位。','单级恒流负载直流比较；不证明高频噪声、时序、上电瞬态或实物性能。'],
      scope:'One existing pull-up moved at a time; other fitted branches and all declared inputs held fixed. No netlist mutation.'});
  }
  return comparisons.sort((a,b)=>a.owner.localeCompare(b.owner));
}

export function reviewBiasRailChoices(design,comparisons){
  const errors=[],warnings=[],decisions=[];
  for(const comparison of comparisons){
    const output=arr(design.peripheralAssessments).find(a=>a.ref===comparison.owner)?.output;
    const decision=output?.railDecision;
    const policy=comparison.policy;
    const valid=decision&&typeof decision==='object'&&!Array.isArray(decision)&&
      Object.keys(decision).every(k=>['connection','basis','unresolved'].includes(k))&&
      ['local','upstream'].includes(decision.connection)&&Array.isArray(decision.unresolved)&&decision.unresolved.every(text)&&
      decision.basis&&Object.keys(decision.basis).length===2&&decision.basis.kind==='calculated-policy'&&text(decision.basis.policyId);
    if(!valid){
      errors.push(`${comparison.owner} railDecision 不再接受自由文字 reason 作为选型依据。请核对 biasRailComparisons.policy，在 output.railDecision 记录 {connection:"local"|"upstream",basis:{kind:"calculated-policy",policyId:"本次返回的policyId"},unresolved:[]}。实际连接必须属于 policy.acceptedConnections；请按对应案例 pinMoves 修改候选并更新相关工作点，不能只改说明。未验证的动态/噪声判断只能放入 unresolved。`);
      continue;
    }
    if(!policy||policy.policyId!==decision.basis.policyId)errors.push(`${comparison.owner} railDecision 未引用本次实际器件、工作条件和资料对应的 policyId；必须重新计算，不能复用过期或自编依据。`);
    if(policy?.blockedReasons.length)errors.push(...policy.blockedReasons.map(reason=>`${comparison.owner} 接法选择受阻：${reason}`));
    if(policy&&!policy.acceptedConnections.includes(decision.connection))errors.push(`${comparison.owner} 所选 ${decision.connection} 不满足本次资料及计算选择依据；可接受接法：${policy.acceptedConnections.join(' / ')||'无'}。改变实际接点后重算，文字理由不能覆盖此结果。`);
    if(decision.connection!==comparison.selected)errors.push(`${comparison.owner} railDecision 与实际网络不符：声明 ${decision.connection}，实际 ${comparison.selected}。`);
    for(const item of decision.unresolved)warnings.push(`${comparison.owner}.railDecision: ${item}`);
    for(const item of policy?.unverified||[])warnings.push(`${comparison.owner}.railDecision: ${item}`);
    decisions.push({owner:comparison.owner,...structuredClone(decision),actualConnection:comparison.selected,
      reason:policy?.explanation??'尚无有效选择依据',policy:policy?.policy,qualification:'conditional-nominal-choice'});
  }
  return {errors,warnings,decisions};
}
