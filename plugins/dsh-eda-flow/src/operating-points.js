import {electricalQuantities} from './evidence-quantities.js';
import {coupleOperatingPoints,switchingAssumption,switchingCurrent} from './operating-coupling.js';
import {coupleTransientLoads} from './operating-transients.js';
import {compareBiasRails} from './bias-rail-choices.js';
import {constrainBiasRailChoices} from './bias-rail-policy.js';
import {branchCurrents,coupleScanLoads,propagateSupplyDisturbance} from './operating-scan.js';
import {internalBiasLoads} from './internal-bias-loads.js';

// Nominal arithmetic from explicit inputs, not an analogue simulator or a
// reference-design value table. The host derives every output from fitted
// component values; a model-authored answer is never accepted as a result.
const schemas={
  'resistor-load':{required:{supplyVoltage:'V',forwardVoltage:'V',driverDrop:'V',duty:'ratio'},
    optional:{targetAverageCurrent:'A',minAverageCurrent:'A',maxAverageCurrent:'A',maxPeakCurrent:'A',maxGroupCurrent:'A',minForwardVoltage:'V',minDriverDrop:'V',scanSlots:'count',scanFrequency:'Hz'}},
  'rc-filter':{required:{supplyVoltage:'V',deviceCurrent:'A',minDeviceVoltage:'V'},optional:{frequency:'Hz'}},
  'pull-up':{required:{supplyVoltage:'V',lowVoltage:'V',maxSinkCurrent:'A'},optional:{inputCapacitance:'F',maxRiseTime:'s'}},
  'supply-transient':{required:{loadStepCurrent:'A',supportTime:'s',maxDroop:'V',effectiveCapacitanceRatio:'ratio',equivalentEsr:'ohm'},optional:{supplyVoltage:'V'}},
};
const units={V:['V',1],mV:['V',1e-3],A:['A',1],mA:['A',1e-3],uA:['A',1e-6],'µA':['A',1e-6],
  F:['F',1],uF:['F',1e-6],'µF':['F',1e-6],nF:['F',1e-9],pF:['F',1e-12],Hz:['Hz',1],kHz:['Hz',1e3],
  s:['s',1],ms:['s',1e-3],us:['s',1e-6],ns:['s',1e-9],ohm:['ohm',1],'Ω':['ohm',1],mohm:['ohm',1e-3],ratio:['ratio',1],'%':['ratio',.01],count:['count',1]};
const arr=v=>Array.isArray(v)?v:[];
const text=v=>typeof v==='string'?v.trim():'';
const compact=v=>text(v).normalize('NFKC').replace(/\s+/g,'');
const close=(a,b)=>Math.abs(a-b)<=1e-10*Math.max(Math.abs(a),Math.abs(b),1e-12);
const active=c=>c&&c.dnp!==true&&c.in_bom!==false;
const ratedInputs=new Set(['deviceCurrent','minDeviceVoltage','maxSinkCurrent','lowVoltage','forwardVoltage','driverDrop','maxPeakCurrent','minAverageCurrent','maxAverageCurrent']);

function resistance(value){
  const raw=text(value).replace(/(?:ohms?|[ΩΩ])/gi,'R').replace(/\s+/g,'');
  const embedded=raw.match(/^(\d+)([RrKkMm])(\d+)$/);
  if(embedded)return Number(`${embedded[1]}.${embedded[3]}`)*({R:1,r:1,K:1e3,k:1e3,M:1e6,m:1e-3}[embedded[2]]);
  const match=raw.match(/^(\d+(?:\.\d+)?)([RrKkMm]?)(?:[Rr])?$/);
  return match?Number(match[1])*({'':1,R:1,r:1,K:1e3,k:1e3,M:1e6,m:1e-3}[match[2]]):NaN;
}
function capacitance(value){
  const raw=text(value);
  const found=electricalQuantities(/[Ff]$/.test(raw)?raw:raw+'F').filter(q=>q.unit==='F');
  return found.length===1?found[0].value:NaN;
}
function ratioIn(quote,value){
  const normalized=text(quote).normalize('NFKC');
  const candidates=[...normalized.matchAll(/(?<![\d.])(\d+(?:\.\d+)?)\s*%/g)].map(m=>Number(m[1])/100);
  for(const m of normalized.matchAll(/(?<![\d.])(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/g))if(Number(m[2])>0)candidates.push(Number(m[1])/Number(m[2]));
  for(const m of normalized.matchAll(/(?:duty(?:\s+cycle)?|占空比)\s*[=:：]?\s*(0(?:\.\d+)?|1(?:\.0+)?)(?![\d.%])/gi))candidates.push(Number(m[1]));
  return candidates.some(v=>close(v,value));
}

// Deliberately bounded circuit models. Verify electrical domains before
// applying lumped arithmetic; a model-authored component list is not proof
// that capacitors or resistors are physically parallel.
function circuitDomains(design,parts,sources){
  const netof=new Map(arr(design.nets).flatMap(n=>arr(n.nodes).map(p=>[p,n.name])));
  const roots=new Map([...netof.values()].map(n=>[n,n]));
  const root=n=>{while(roots.has(n)&&roots.get(n)!==n)n=roots.get(n);return n;};
  const kind=c=>c?.componentKind||sources.find(s=>(s.reference===c?.ref||s.ref===c?.ref||s.symbolId===c?.librarySymbol)&&s.componentKind)?.componentKind;
  const isR=c=>/^Device:R(?:_|$)/.test(c?.librarySymbol||'')||kind(c)==='resistor';
  const isC=c=>/^Device:C(?:_|$)/.test(c?.librarySymbol||'')||kind(c)==='capacitor';
  const ends=c=>arr(c?.pins).map(p=>root(netof.get(`${c.ref}.${p.number}`)));
  for(const c of parts.values())if(active(c)&&isR(c)&&c.electricalRole==='routing-bridge'&&resistance(c.value)===0){
    const ns=ends(c);if(ns.length===2&&ns.every(n=>n!==undefined))roots.set(root(ns[0]),root(ns[1]));
  }
  const pair=c=>{const ns=ends(c);return ns.length===2&&ns.every(n=>n!==undefined)&&ns[0]!==ns[1]?ns:null;};
  const same=(ns,a,b)=>ns&&a!==undefined&&b!==undefined&&a!==b&&ns.includes(a)&&ns.includes(b);
  const key=ns=>JSON.stringify([...ns].sort());
  const pinDomain=(ref,pin)=>root(netof.get(`${ref}.${pin}`));
  const reservoirBindings=arr(design.functions).flatMap(f=>arr(f.layout)).filter(r=>r?.kind==='decoupling').map(r=>{
    const [owner,a]=text(r.anchor).split('.'),[returnOwner,b]=text(r.return).split('.');
    const c=parts.get(owner),pa=arr(c?.pins).find(p=>String(p.number)===a),pb=arr(c?.pins).find(p=>String(p.number)===b);
    return owner===returnOwner&&active(c)&&['power_in','power_out'].includes(pa?.type)&&['power_in','power_out'].includes(pb?.type)?
      {owner,supply:pinDomain(owner,a),ground:pinDomain(owner,b),members:r.members}:null;
  }).filter(r=>r&&r.supply!==undefined&&r.ground!==undefined&&r.supply!==r.ground);
  const reservoirKey=r=>JSON.stringify([r.owner,r.supply,r.ground]);
  const reservoirFor=(row,selected)=>reservoirBindings.find(r=>r.owner===row.owner&&selected.every(c=>same(pair(c),r.supply,r.ground)));
  return {isR,isC,pair,ends,pinDomain,reservoirBindings,reservoirFor,reservoirKey,check(row,assessment,selected){
    if(selected.some(c=>!pair(c)))return '计算仅支持完整连接在两个不同电气域之间的阻容。';
    if(row.kind==='supply-transient'){
      const binding=reservoirFor(row,selected);
      if(!binding)return '储能电容必须实际并联于本负载已声明的供电/返回端，不能借用其他电源的电容。';
      if([...parts.values()].some(c=>active(c)&&isC(c)&&same(pair(c),binding.supply,binding.ground)&&!row.components.includes(c.ref)))return '储能计算必须包含该电源域实际并联的全部电容。';
      return null;
    }
    if(row.kind==='resistor-load'){
      const ownerNets=new Set(ends(parts.get(row.owner)));
      for(const c of selected){
        const ns=pair(c);
        if(ns.filter(n=>ownerNets.has(n)).length!==1)return `${c.ref} 未直接串接到该负载；此名义模型不支持多级串联路径。`;
        if([...parts.values()].some(p=>active(p)&&p.ref!==c.ref&&isR(p)&&pair(p)&&key(pair(p))===key(ns)))return `${c.ref} 存在并联电阻，不能按独立限流支路计算。`;
      }
      return null;
    }
    const p=assessment?.pins||{},supply=root(netof.get(`${row.owner}.${p.supply}`)),ground=root(netof.get(`${row.owner}.${p.return}`)),output=root(netof.get(`${row.owner}.${p.output}`));
    if([supply,ground,output].some(n=>n===undefined)||new Set([supply,ground,output]).size!==3)return '外围供电、返回和输出必须对应不同的实际电气域。';
    const filters=[...parts.values()].filter(c=>active(c)&&isR(c)&&c.electricalRole==='supply-filter'&&pair(c)?.includes(supply));
    if(row.kind==='rc-filter'){
      const resistor=selected.find(isR),caps=selected.filter(isC),ns=pair(resistor);
      if(!ns?.includes(supply)||ns.includes(ground))return '滤波电阻未串接本器件供电。';
      if(filters.length!==1||filters[0].ref!==resistor.ref)return '多路供电滤波不适用单电阻 RC 模型。';
      if(caps.some(c=>!same(pair(c),supply,ground)))return '滤波电容必须实际并联在本器件供电和返回之间。';
      const allCaps=[...parts.values()].filter(c=>active(c)&&isC(c)&&same(pair(c),supply,ground));
      if(allCaps.some(c=>!row.components.includes(c.ref)))return '计算遗漏实际并联电容，不能低估总电容量。';
      return null;
    }
    const rails=new Set([supply,...filters.flatMap(c=>pair(c).filter(n=>n!==supply&&n!==ground))]);
    const destinations=selected.map(c=>pair(c).find(n=>n!==output));
    if(selected.some(c=>!pair(c).includes(output))||destinations.some(n=>!rails.has(n))||new Set(destinations).size!==1)return '上拉必须连接同一实际输出和同一供电域；不同电源不能视作并联。';
    if([...parts.values()].some(c=>active(c)&&isR(c)&&c.electricalRole==='pull-up'&&pair(c)?.includes(output)&&!row.components.includes(c.ref)))return '计算遗漏同一输出的其他上拉电阻。';
    return null;
  }};
}

export const operatingPointInstructions=`设计阶段同时提交 design.operatingPoints，由宿主复算关键阻容选值；不要把结果藏在 basis 的算式文字里。每条 {id,kind,owner,components:[位号],inputs:{参数名:{value:数值,unit:单位,basis:{sourceId,quote}或{assumption:明确的工程假设}}}}。不提交计算结果、脚本、坐标或表达式。
扫描工作点不能默默缺少电流限值。资料确实没有分支或公共端限值时，在该resistor-load顶层unresolvedLimits中分别列出"branch-current"、"common-current"，宿主明确标为未确定；不要凭空创造限值或把已有额定值说成未知。同一限值已填输入时不要同时列为缺失。
扫描负载必须在 resistor-load 顶层声明 driver:"实际驱动器位号"，inputs 加 scanSlots:{value:扫描槽数,unit:"count",basis:引用或假设}。宿主从实际限流支路及公共端连接核对驱动器，按一次一个公共端、所有段同时亮的包络计算峰值合计，再按实际公共端数和 duty 计算电源平均电流。duty 是单段总占空比，包含扫描与亮度调制，不能大于1/scanSlots；它不能折减电源阶跃峰值。scanFrequency(Hz)为可选的完整扫描帧频率，未知则不填，禁止拿串行通信时钟替代。
必须重新查看当前驱动器资料的单输出及公共端电流上限。已有明确绝对最大/保证上限时，分别写入maxPeakCurrent、maxGroupCurrent并引用完整额定语义；有负号的源电流绝对最大值按正的幅值填写，引用保留负号及绝对最大说明。不能遗漏已给出的限值，也不能使用Ioh/Iol测试点的典型电流当保证上限。未给出工作额定和负载额定时继续保留未确定项，即使未越过芯片绝对上限也不能宣称安全。
当前带引用的 applicationGuidance 中，明确引脚组/阻值/方向的内部上拉下拉也由宿主计入供电。它们无需外加同值电阻，但不能在供电预算中忽略。宿主按实际器件型号和引脚名称对应来源，逐组计算轨到轨偏置电流；已核验逐公共端扫描时，公共端上拉只按一个低电平有效，其余按组内全部引脚与偏置相反的包络。内部阻值容差、摆幅和切换重叠仍待定。loadStepScope使用excluding-derived-loads，残余loadStepCurrent不得再次包含已自动计入的内部偏置；也不能拿无来源的小电流余量替代已知偏置。无扫描/外部工作点提供电压时，在supply-transient.inputs补supplyVoltage。明确来源解析不了会阻止忽略，而不是默认为0。
forwardVoltage、driverDrop只用于名义估算，driverDrop是整个通路的驱动压降。可另给有依据的minForwardVoltage、minDriverDrop作为下界；缺少下界时按非负0V计算条件电流上界。此上界约束maxPeakCurrent及maxAverageCurrent，也进入电源储能计算。maxGroupCurrent(A)可约束一个公共端所有支路合计电流；按当前规格书区分推荐/保证/绝对最大，绝对最大只能作不可越过的边界，不能证明正常工作或用来倒推目标亮度。测试条件中的Vo、典型导通压降不可直接冒充全工作区间固定压降或下界；尚无I–V曲线时明确名义假设及包络假设。缺少目标亮度/Vf/实际调光、返回端额定条件时保留未定，不追求参考工程阻值。
有扫描负载的 supply-transient 顶层必须用 loadStepScope:"excluding-derived-loads"。loadStepCurrent只填写扫描支路与独立外部上拉以外的残余增量；宿主自动按真实网络加入扫描电流上界和外部上拉切换，不能复制先前手算段电流，否则重复计算。内部偏置、器件自身、下游电源未建模增量须明确列入残余值/假设；假定残余为0也须写清理由及未知。supportTime是上游供电响应窗口，不是扫描周期；未知需保留假设，不得为让小电容通过任意缩短。改段电阻后储能下限自动重算，修改真实电容或负载后再核验。
本地RC滤波若接在已评估的上游储能域，宿主还按实际R、有效C和ESR估算上游跌落在首个响应窗口内的传递，与本地负载跌落联合检查电压余量。该窗口不能代替周期稳态、恢复波形、频谱和环路验证。缺少干扰指标/扫描频率时，不能仅因更低截止频率就宣布某个串阻或电容组合更好；总容量约束也不能唯一确定只数和高频旁路值。
kind=resistor-load：owner 为负载，components 为该负载声明的限流电阻；必填 supplyVoltage(V)、forwardVoltage(V)、driverDrop(V)、duty(ratio或%)，可填 targetAverageCurrent、minAverageCurrent、maxAverageCurrent、maxPeakCurrent(A/mA)。占空比由实际扫描方式决定，不能默认100%。宿主输出各电阻的峰值/平均电流、平均功耗及达到目标电流所需的理想阻值。
kind=rc-filter：owner 为使用滤波电源的器件，components 为 supply-filter 电阻和本地 decoupling 电容；必填 supplyVoltage(V)、deviceCurrent(A/mA)、minDeviceVoltage(V)，可填 frequency(Hz/kHz)。deviceCurrent 只填该器件自身消耗，不包含外部上拉。共用滤波电源的每个负载各提交一条，宿主按实际电源域合计。宿主复算压降、负载端电压、时间常数和截止频率；这些是名义集总RC估算，不是完整EMC证明。磁珠不能用该电阻模型冒充。
kind=pull-up：owner 为输出器件，components 为该器件上拉电阻；必填 supplyVoltage(V)、lowVoltage(V)、maxSinkCurrent(A/mA)，可填 inputCapacitance(F/pF)、maxRiseTime(s/ns)。宿主计算低电平电流及RC的10%–90%上升时间。切换灌电流另按 supplyVoltage/R 估算条件上界：假定上拉电源不超过声明源电压、输出不低于返回端0V；不能用 lowVoltage 最大值扣减上界。过冲/预充/负向尖峰不在此模型内，假设必须核实。
kind=supply-transient：对每个 functions.layout 去耦负载的供电/返回域必须评估一次储能（多个成员同域只需一条），owner 为实际负载，components 为该域所有实际并联的电容，包括本地旁路和储能。必填 loadStepCurrent(A/mA，本域合计增量负载，仅排除由本域直接供电且独立建模的外部上拉)、supportTime(s/us，电容独自支撑该增量的时间)、maxDroop(V，允许的压降预算)、effectiveCapacitanceRatio(ratio或%，考虑偏压/容差后的有效容量比例，0到1之间)、equivalentEsr(ohm，整个并联电容组的等效串联电阻)。本电源有上拉时必须在该工作点顶层补 loadStepScope:"excluding-pull-ups"，明确基础增量不含上述外部上拉；宿主根据真实网络另加这些上拉由高到低切换的电流条件上界，不采用降压后的稳态电流代替初始增量。具有扫描模型的电源域使用 excluding-derived-loads：已提取的内部偏置、扫描支路和外部上拉由宿主另加，不得重复计入；未独立建模的内部负载、下游电源及其他负载仍须计入剩余增量，不能漏算；其他电源直接供电的上拉不计入此电容域。基础增量可为0，但合计增量必须大于0。同一电源多个负载的储能行必须使用一致的合计负载、支撑时间、容量折减和ESR。宿主按 ΔV=ΔI×ESR+ΔI×Δt/C有效 校验真实装配容量，给出最小名义容量，并核对滤波负载的最低工作电压。无法从资料核实的电流变化、上游响应时间、压降预算、容量折减或 ESR 必须写清工程假设与待核实项；不得反推任意宽松条件只为通过。已有一只高频旁路不代表储能足够，储能计算也不能代替高频去耦/滤波、稳压环路稳定性或布局核验。按实际计算选择容量与数量，不预设三只或任何参考工程取值。
若上拉接在滤波后，supplyVoltage 与 rc-filter 一样填写该滤波器上游源电压，不能把滤波后电压另行假定为理想电源。宿主按实际连接联立计算：所有输出低电平时检查最低供电，本输出低电平而其他输出高电平时检查最大灌电流。滤波后上拉的动态上升时间不使用独立 R×C 公式；有时序要求时需另行核实两电容网络的动态响应。同一电源条件必须一致，未建模负载或级联滤波会明确阻止套用单级公式。
每个输入都保留当前资料逐字引用，或显式工程假设；引用中的单位数值必须匹配。资料没有给出工作条件时允许提出假设候选，保留待核实项，不伪称厂家参数。当前器件实际值与明确电流/供电/时序限值冲突时必须修改候选。此机制不指定型号、AD阻值或完整连线。`;

export function reviewOperatingPoints(design,{inputs={},evidence=[],guidance=[]}={}){
  const errors=[],warnings=[],unresolved=[],results=[];
  const issue=(code,message,id)=>({code,message,id});
  const parts=new Map(arr(design.components).map(c=>[c.ref,c]));
  const sources=[...arr(inputs.evidence),...arr(evidence),...arr(evidence?.components)];
  const domains=circuitDomains(design,parts,sources);
  const covered=new Set(),ids=new Set(),models=[];
  if(design.operatingPoints!==undefined&&!Array.isArray(design.operatingPoints))
    errors.push(issue('operating-points-invalid','operatingPoints 必须是数组。'));
  for(const row of arr(design.operatingPoints)){
    const id=text(row?.id),schema=schemas[row?.kind],start=errors.length,missing=[];
    const fail=message=>errors.push(issue('operating-point-invalid',`${id||'工作点'}: ${message}`,id));
    if(!id||ids.has(id)||!schema||!active(parts.get(row?.owner))||!Array.isArray(row?.components)||!row.components.length||new Set(row.components).size!==row.components.length||Object.keys(row||{}).some(k=>!['id','kind','owner','components','inputs','loadStepScope','driver','unresolvedLimits'].includes(k))){fail('需要唯一 id、支持的 kind、实际 owner 和无重复器件列表。');continue;}
    if(row.unresolvedLimits!==undefined&&(row.kind!=='resistor-load'||!Array.isArray(row.unresolvedLimits)||row.unresolvedLimits.some(k=>!['branch-current','common-current'].includes(k)))){fail('unresolvedLimits 只允许限流负载显式列出 branch-current 或 common-current。');continue;}
    if(row.loadStepScope!==undefined&&(row.kind!=='supply-transient'||!['excluding-pull-ups','excluding-derived-loads'].includes(row.loadStepScope))){fail('loadStepScope 仅用于 supply-transient，声明 excluding-pull-ups 或 excluding-derived-loads。');continue;}
    if(row.driver!==undefined&&(row.kind!=='resistor-load'||!text(row.driver))){fail('driver 仅用于限流负载，填写实际驱动器位号。');continue;}
    ids.add(id);
    const selected=row.components.map(ref=>parts.get(ref));
    if(selected.some(c=>!c||c.dnp===true||c.in_bom===false)){fail('计算引用不存在或未装配器件。');continue;}
    const supplied=row.inputs;
    if(!supplied||typeof supplied!=='object'||Array.isArray(supplied)||Object.keys(supplied).some(k=>!Object.hasOwn(schema.required,k)&&!Object.hasOwn(schema.optional,k))){fail('inputs 含未知参数或格式错误。');continue;}
    const values={},provenance={};
    for(const [name,dimension] of Object.entries({...schema.required,...schema.optional})){
      const raw=supplied[name];
      if(raw===undefined){if(Object.hasOwn(schema.required,name))fail(`缺少 ${name}。`);continue;}
      const unit=units[raw?.unit];
      if(!raw||Object.keys(raw).some(k=>!['value','unit','basis'].includes(k))||typeof raw.value!=='number'||!Number.isFinite(raw.value)||!unit||unit[0]!==dimension){fail(`${name} 的数值或单位无效。`);continue;}
      const value=raw.value*unit[1],basis=raw.basis;
      if(value<0||(['supplyVoltage','maxSinkCurrent','frequency','inputCapacitance','maxRiseTime','targetAverageCurrent','maxPeakCurrent','supportTime','maxDroop'].includes(name)&&value<=0)||(['duty','effectiveCapacitanceRatio'].includes(name)&&(value<=0||value>1))){fail(`${name} 超出物理取值范围。`);continue;}
      if(basis&&Object.keys(basis).length===1&&text(basis.assumption)){
        provenance[name]={kind:'assumption',...basis,value,unit:dimension};
        missing.push(`${row.owner}.${name}: ${basis.assumption}`);
      }else{
        const source=sources.find(s=>s?.id===basis?.sourceId),quote=text(basis?.quote);
        const absoluteCurrent=['maxPeakCurrent','maxGroupCurrent'].includes(name)&&/绝对最大|极限|absolute\s*max/i.test(quote);
        const numeric=dimension==='ratio'?ratioIn(quote,value):dimension==='count'?new RegExp(`(^|[^0-9.])${value}(?![0-9.])`).test(quote):electricalQuantities(quote).some(q=>q.unit===dimension&&close(absoluteCurrent?Math.abs(q.value):q.value,value));
        if(!basis||Object.keys(basis).some(k=>!['sourceId','quote'].includes(k))||!source||compact(quote).length<8||!compact(source.content).includes(compact(quote))||!numeric){fail(`${name} 的数值未由当前逐字引用支持；应补引用或明确标为工程假设。`);continue;}
        provenance[name]={kind:'quoted',...basis,document:source.document??null,page:source.page??null,value,unit:dimension};
        if(['driverDrop','minDriverDrop','minForwardVoltage'].includes(name)&&/(测试|test|Vo\s*[=＝]|条件)/i.test(quote)){
          fail(`${name} 引用了单点测试条件，不能直接当作全工作区间的固定压降或保证下界；使用明确的名义假设，并保留未给出下界的电流包络。`);continue;
        }
        if(ratedInputs.has(name)||['maxGroupCurrent','minForwardVoltage','minDriverDrop','scanSlots','scanFrequency'].includes(name)){
          // A matching scalar is not a semantic validation of a datasheet
          // column, its typical/max rating, temperature or test condition.
          // Keep the exact quote usable for nominal calculations, but never
          // silently promote a catalogue string into a verified limit.
          provenance[name].qualification='quantity-only';
          missing.push(`${row.owner}.${name}: 引文数值已匹配，额定类型（典型/保证范围/绝对最大值）及适用工作条件仍须核实。`);
        }
      }
      values[name]=value;
    }
    if(errors.length>start){results.push({id,kind:row.kind,owner:row.owner,status:'invalid',inputs:provenance});continue;}
    if(row.kind==='supply-transient'){
      if(selected.some(c=>!domains.isC(c)||!['decoupling','other'].includes(c.electricalRole))){fail('储能计算只接受实际装配的旁路/储能电容。');continue;}
      const topologyError=domains.check(row,null,selected);
      if(topologyError){fail(topologyError);continue;}
      models.push({row,id,values,provenance,selected,caps:selected,rValues:[],missing});continue;
    }
    if(values.minAverageCurrent!==undefined&&values.maxAverageCurrent!==undefined&&values.minAverageCurrent>values.maxAverageCurrent){fail('最小平均电流不能高于最大平均电流。');continue;}
    const resistors=selected.filter(c=>['current-limit','supply-filter','pull-up'].includes(c.electricalRole));
    const caps=selected.filter(c=>c.electricalRole==='decoupling'||(row.kind==='rc-filter'&&c.electricalRole==='other'&&domains.isC(c)));
    const rValues=resistors.map(c=>({ref:c.ref,value:resistance(c.value)}));
    const role={'resistor-load':'current-limit','rc-filter':'supply-filter','pull-up':'pull-up'}[row.kind];
    if(!resistors.length||resistors.some(c=>c.electricalRole!==role||!domains.isR(c))||caps.some(c=>!domains.isC(c))||rValues.some(r=>!Number.isFinite(r.value)||r.value<=0)||selected.length!==resistors.length+caps.length||(row.kind!=='rc-filter'&&caps.length)||(row.kind==='rc-filter'&&(resistors.length!==1||!caps.length))){fail('实际器件类型、用途或阻容值不适用于该计算模型。');continue;}
    const assessment=row.kind==='resistor-load'?arr(design.loadAssessments).find(a=>a.ref===row.owner):arr(design.peripheralAssessments).find(a=>a.ref===row.owner);
    const binding=row.kind==='resistor-load'?assessment?.components:row.kind==='pull-up'?assessment?.output?.components:assessment?.supply?.components;
    if(!binding||!row.components.every(ref=>binding.includes(ref))){fail('计算器件未绑定到该负载/外围评审，不能借用其他支路。');continue;}
    const topologyError=domains.check(row,assessment,selected);
    if(topologyError){fail(topologyError);continue;}
    models.push({row,id,values,provenance,selected,assessment,rValues,caps,missing});
  }
  const reservoirs=new Map();
  for(const m of models.filter(m=>m.row.kind==='supply-transient')){
    const key=domains.reservoirKey(domains.reservoirFor(m.row,m.selected));
    if(reservoirs.has(key))errors.push(issue('operating-point-invalid',`${m.id}: 同一负载电源的储能评估重复。`,m.id));
    reservoirs.set(key,m);
  }
  for(const binding of new Map(domains.reservoirBindings.map(r=>[domains.reservoirKey(r),r])).values())
    if(!reservoirs.has(domains.reservoirKey(binding)))errors.push(issue('supply-transient-missing',`${binding.owner}: 缺少供电域 ${binding.supply} 的 supply-transient 储能评估；已有去耦不代表容量满足负载变化。`,binding.owner));
  const coupled=coupleOperatingPoints(models,domains,parts);
  const scan=coupleScanLoads(models,domains,parts);
  const internalBias=internalBiasLoads(guidance,sources,parts,domains,scan.loads);
  errors.push(...internalBias.errors.map(message=>issue('internal-bias-invalid',message)));
  for(const load of scan.loads){
    const biasAt=pin=>internalBias.loads.filter(b=>b.owner===load.driver&&b.pins.includes(pin)).reduce((sum,b)=>sum+load.model.values.supplyVoltage/b.resistanceOhm,0);
    load.model.scan.branchBiasCurrentA=Object.fromEntries(Object.entries(load.branchDriverPins).map(([ref,pins])=>[ref,pins.reduce((sum,p)=>sum+biasAt(p),0)]));
    load.model.scan.commonBiasCurrentA=Math.max(0,...load.commonDriverPins.map(biasAt));
  }
  for(const [id,value] of scan.errors)coupled.errors.set(id,value);
  const transients=coupleTransientLoads(models,domains,parts,coupled,arr(design.peripheralAssessments),scan,internalBias.loads);
  for(const [id,value] of transients.corrections)coupled.corrections.set(id,value);
  for(const [id,value] of transients.errors)coupled.errors.set(id,value);
  for(const model of models){
    const {row,id,values,provenance,rValues,caps}=model;
    const start=errors.length,correction=coupled.corrections.get(id);
    const missing=[...new Set([...model.missing,...(model.scan?.assumptions||[]),...(correction?.coupling.assumptions||[])])];
    const fail=message=>errors.push(issue('operating-point-invalid',`${id}: ${message}`,id));
    if(coupled.errors.has(id)){
      coupled.errors.get(id).forEach(fail);
      results.push({id,kind:row.kind,owner:row.owner,components:row.components,status:'invalid',inputs:provenance});continue;
    }
    const calculations=[];
    const limit=(ok,message)=>{if(!ok)errors.push(issue('operating-limit-exceeded',`${id}: ${message}`,id));};
    if(row.kind==='supply-transient'){
      const capValues=caps.map(c=>capacitance(c.value));
      if(capValues.some(c=>!Number.isFinite(c)||c<=0)){fail('电容值无法解析。');continue;}
      const capacitanceF=capValues.reduce((a,b)=>a+b,0),effectiveCapacitanceF=capacitanceF*values.effectiveCapacitanceRatio;
      const totalStep=correction.totalLoadStepCurrentA;
      if(totalStep<=0){fail('储能评估的合计增量负载必须大于零。');continue;}
      const esrDroopV=totalStep*values.equivalentEsr,capacitiveDroopV=totalStep*values.supportTime/effectiveCapacitanceF;
      const transientDroopV=esrDroopV+capacitiveDroopV,budget=values.maxDroop-esrDroopV;
      const {coupling,...loadStep}=correction;
      calculations.push({...loadStep,capacitanceF,effectiveCapacitanceF,esrDroopV,capacitiveDroopV,transientDroopV,
        ...(correction.initialVoltageV!==undefined?{transientVoltageFloorV:correction.initialVoltageV-transientDroopV}:{}),
        requiredNominalCapacitanceF:budget>0?totalStep*values.supportTime/budget/values.effectiveCapacitanceRatio:null});
      limit(budget>0,'电容组 ESR 的瞬时压降已耗尽电压预算，单纯增加容量不足以满足要求。');
      limit(transientDroopV<=values.maxDroop,`储能压降 ${transientDroopV} V 超过 ${values.maxDroop} V；需修改真实容量或有依据的负载/供电方案。`);
      if(correction.initialVoltageV!==undefined)limit(correction.initialVoltageV-transientDroopV>=correction.minimumDeviceVoltageV,
        `储能电压下界 ${correction.initialVoltageV-transientDroopV} V 低于本电源负载最低工作电压 ${correction.minimumDeviceVoltageV} V。`);
    }else if(row.kind==='resistor-load'){
      const headroom=values.supplyVoltage-values.forwardVoltage-values.driverDrop;
      if(!model.scan&&(values.minForwardVoltage===undefined||values.minDriverDrop===undefined))missing.push('电流上界使用未给出压降下界时的非负0V包络，假设电源不超过声明电压；不代表全温区、浪涌或反向驱动条件已验证。');
      limit(headroom>0,'供电不足以覆盖负载与驱动压降。');
      if(values.minForwardVoltage>values.forwardVoltage||values.minDriverDrop>values.driverDrop)fail('压降下界不能大于名义压降。');
      if(model.scan&&values.maxGroupCurrent!==undefined){
        const groupCurrent=model.scan.onCurrentBoundA+(model.scan.commonBiasCurrentA||0);
        limit(groupCurrent<=values.maxGroupCurrent,`公共端合计电流条件上界（含该输出内部偏置）${groupCurrent} A 超过 ${values.maxGroupCurrent} A。`);
      }
      for(const r of rValues){
        const peak=Math.max(0,headroom)/r.value,average=peak*values.duty;
        const upper=branchCurrents(model,r).upper;
        const driverUpper=upper+(model.scan?.branchBiasCurrentA?.[r.ref]||0);
        calculations.push({ref:r.ref,resistanceOhm:r.value,peakCurrentA:peak,peakCurrentBoundA:upper,driverPinCurrentBoundA:driverUpper,averageCurrentA:average,averageCurrentBoundA:upper*values.duty,averagePowerW:peak*peak*r.value*values.duty,
          ...(values.targetAverageCurrent!==undefined?{targetResistanceOhm:Math.max(0,headroom)*values.duty/values.targetAverageCurrent}:{})});
        if(values.maxPeakCurrent!==undefined)limit(driverUpper<=values.maxPeakCurrent,`${r.ref} 驱动输出峰值电流条件上界（含内部偏置）${driverUpper} A 超过 ${values.maxPeakCurrent} A。`);
        if(values.maxAverageCurrent!==undefined)limit(upper*values.duty<=values.maxAverageCurrent,`${r.ref} 平均电流条件上界 ${upper*values.duty} A 超过 ${values.maxAverageCurrent} A。`);
        if(values.minAverageCurrent!==undefined)limit(average>=values.minAverageCurrent,`${r.ref} 平均电流 ${average} A 低于 ${values.minAverageCurrent} A。`);
      }
    }else if(row.kind==='rc-filter'){
      const capValues=caps.map(c=>capacitance(c.value));
      if(capValues.some(c=>!Number.isFinite(c)||c<=0)){fail('电容值无法解析。');continue;}
      const resistanceOhm=rValues[0].value,capacitanceF=capValues.reduce((a,b)=>a+b,0),tau=resistanceOhm*capacitanceF;
      const voltageDropV=correction.voltageDropV,deviceVoltageV=correction.deviceVoltageV;
      const {coupling,...dc}=correction;
      calculations.push({resistanceOhm,capacitanceF,...dc,timeConstantS:tau,cutoffHz:1/(2*Math.PI*tau),
        ...(values.frequency!==undefined?{idealAmplitudeRatio:1/Math.sqrt(1+(2*Math.PI*values.frequency*tau)**2)}:{})});
      limit(deviceVoltageV>=values.minDeviceVoltage,`滤波后电压 ${deviceVoltageV} V 低于 ${values.minDeviceVoltage} V。`);
    }else{
      limit(values.lowVoltage<=values.supplyVoltage,'低电平电压高于供电电压。');
      if(values.maxRiseTime!==undefined&&values.inputCapacitance===undefined)fail('检查上升时间必须提供输入电容。');
      // Parallel pull-ups share one output sink; assess their total current.
      const equivalentResistanceOhm=1/rValues.reduce((sum,r)=>sum+1/r.value,0);
      const sinkCurrentA=correction?.sinkCurrentA??Math.max(0,values.supplyVoltage-values.lowVoltage)/equivalentResistanceOhm;
      const switchingSinkCurrentBoundA=switchingCurrent(values.supplyVoltage,equivalentResistanceOhm);
      missing.push(`${row.owner}: ${switchingAssumption}`);
      const riseTimeS=!correction&&values.inputCapacitance!==undefined?Math.log(9)*equivalentResistanceOhm*values.inputCapacitance:undefined;
      if(correction&&values.inputCapacitance!==undefined){
        missing.push(`${row.owner}: 滤波电源上的上拉需联合动态响应核验，未采用独立 R×C 上升时间。`);
        if(values.maxRiseTime!==undefined)fail('当前联合模型仅覆盖直流；滤波后上拉的上升时间约束尚未核验。');
      }
      const {coupling,...dc}=correction||{};
      calculations.push({equivalentResistanceOhm,sinkCurrentA,...dc,switchingSinkCurrentBoundA,...(riseTimeS!==undefined?{riseTime10To90S:riseTimeS}:{})});
      limit(sinkCurrentA<=values.maxSinkCurrent,`输出灌电流 ${sinkCurrentA} A 超过 ${values.maxSinkCurrent} A。`);
      limit(switchingSinkCurrentBoundA<=values.maxSinkCurrent,
        `输出切换灌电流条件上界 ${switchingSinkCurrentBoundA} A 超过 ${values.maxSinkCurrent} A；不能仅按稳态电流或低电平最大电压选上拉。`);
      if(values.maxRiseTime!==undefined&&riseTimeS!==undefined)limit(riseTimeS<=values.maxRiseTime,`上升时间 ${riseTimeS} s 超过 ${values.maxRiseTime} s。`);
    }
    row.components.forEach(ref=>covered.add(ref));
    unresolved.push(...missing);
    results.push({id,kind:row.kind,owner:row.owner,components:row.components,inputs:provenance,calculations,assumptions:missing,
      ...(model.scan?{scan:model.scan}:{}),
      ...(correction?{coupling:correction.coupling}:{}),
      status:errors.length>start||errors.some(e=>e.id===id)?'invalid':missing.length?'needs-review':'nominal-checks-passed'});
  }
  propagateSupplyDisturbance(results,models,domains,errors);
  unresolved.push(...results.flatMap(r=>r.assumptions||[]));
  const missing=arr(design.components).filter(c=>c.dnp!==true&&c.in_bom!==false&&['current-limit','supply-filter','pull-up'].includes(c.electricalRole)&&!covered.has(c.ref)).map(c=>c.ref);
  if(missing.length)warnings.push(issue('operating-point-missing',`以下器件缺少可复算工作点：${missing.join(', ')}。文字 basis 不代表已核查电流、压降或时间常数。`));
  const netOf=new Map(arr(design.nets).flatMap(n=>arr(n.nodes).map(node=>[node,n.name])));
  const alternatives=compareBiasRails(models,domains,parts,results).map(comparison=>({...comparison,cases:comparison.cases.map(c=>({...c,
    pinMoves:c.connection===comparison.selected?[]:comparison.pullUpComponents.flatMap(ref=>arr(parts.get(ref)?.pins)
      .filter(p=>domains.pinDomain(ref,p.number)===(comparison.selected==='local'?comparison.localSupply:comparison.upstreamSupply))
      .map(p=>({node:`${ref}.${p.number}`,from:netOf.get(`${ref}.${p.number}`),to:c.rail})))
  }))}));
  const biasRailComparisons=constrainBiasRailChoices(design,alternatives,{inputs,evidence});
  return {errors,warnings,unresolved:[...new Set(unresolved)],results,biasRailComparisons,scope:'Nominal lumped DC coupling and explicit charge-budget estimates; no regulator dynamics, high-frequency impedance, stability, thermal or hardware validation.'};
}
