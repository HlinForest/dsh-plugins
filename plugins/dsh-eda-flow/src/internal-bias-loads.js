import {electricalQuantities} from './evidence-quantities.js';
const compact=s=>String(s||'').normalize('NFKC').replace(/\s+/g,'');
const escaped=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const internal=/内部|内置|internal|built[- ]?in/i;
const direction=s=>/下拉|pull[- ]?down/i.test(s)?'down':/上拉|pull[- ]?up/i.test(s)?'up':null;
const mentioned=(s,name)=>new RegExp(`(?<![A-Za-z0-9_])${escaped(name)}(?![A-Za-z0-9_])`).test(s);
function expandRanges(s){
 return s.replace(/([A-Za-z_]+)(\d+)\s*[-–~至]\s*([A-Za-z_]+)?(\d+)/g,(raw,p,a,q,b)=>{
  if(q&&q!==p||Number(b)<Number(a)||Number(b)-Number(a)>256)return raw;
  return Array.from({length:Number(b)-Number(a)+1},(_,i)=>p+(Number(a)+i)).join(' ');
 });
}
// A deliberately narrow source parser: one resistance and one direction per
// clause, explicitly named pins only. Ambiguous clauses stop the budget rather
// than disappearing into a model-authored residual-current assumption.
export function internalBiasLoads(guidance,sources,parts,domains,scans){
 const loads=[],errors=[],seen=new Map();
 for(const g of guidance){
  if(!internal.test(g.statement)||!direction(g.statement))continue;
  let clauses=0;
  const owners=[...parts.values()].filter(c=>c.dnp!==true&&c.in_bom!==false&&[c.value,c.mpn].some(v=>v&&compact(v).length>=3&&compact(g.subject).includes(compact(v))));
  if(!owners.length){errors.push(`内部偏置资料 ${g.id} 无法唯一关联实际器件型号，不能忽略其供电影响。`);continue;}
  for(const owner of owners)for(const citation of g.citations||[]){
   const source=sources.find(s=>s.id===citation.sourceId);
   if(!source||!compact(source.content).includes(compact(citation.quote))){errors.push(`内部偏置引用 ${g.id} 未匹配当前资料。`);continue;}
   for(const raw of String(citation.quote).split(/[；;。\n](?!\s*\d)/)){
    if(!internal.test(raw)||!direction(raw))continue;
    clauses++;
    const quantities=electricalQuantities(raw).filter(q=>q.unit==='ohm'&&q.value>0),clause=expandRanges(raw);
    const pins=(owner.pins||[]).filter(p=>!['power_in','power_out'].includes(p.type)&&!/^\d+$/.test(p.name)&&mentioned(clause,p.name));
    const dirs=[/下拉|pull[- ]?down/i.test(raw),/上拉|pull[- ]?up/i.test(raw)].filter(Boolean).length;
    if(quantities.length!==1||!pins.length||dirs!==1){errors.push(`${owner.ref}: 内部偏置引文含不明确阻值、方向或引脚组，须先澄清资料条目。`);continue;}
    const resistanceOhm=quantities[0].value,bias=direction(raw);
    const fresh=pins.filter(p=>!seen.has(owner.ref+'.'+p.number));
    for(const pin of pins){
     const key=owner.ref+'.'+pin.number,prior=seen.get(key),identity=JSON.stringify([resistanceOhm,bias]);
     if(prior&&prior!==identity)errors.push(`${key}: 内部偏置资料互相冲突。`);
     seen.set(key,identity);
    }
    if(!fresh.length)continue;
    if(fresh.length!==pins.length){errors.push(`${owner.ref}: 内部偏置分组部分重叠，请合并来源条目以免重复预算。`);continue;}
    const key=JSON.stringify([owner.ref,pins.map(p=>p.number).sort(),resistanceOhm,bias]);
    if(loads.some(l=>l.key===key))continue;
    const bindings=domains.reservoirBindings.filter(b=>b.owner===owner.ref);
    if(new Set(bindings.map(b=>JSON.stringify([b.supply,b.ground]))).size!==1){errors.push(`${owner.ref}: 内部偏置需要唯一实际供电域。`);continue;}
    const scan=scans.find(s=>s.driver===owner.ref),common=scan?.commonDriverPins||[];
    const oneCommon=scan&&common.every(n=>pins.some(p=>p.number===n))&&pins.every(p=>common.includes(p.number)||domains.pinDomain(owner.ref,p.number)===undefined);
    loads.push({key,owner:owner.ref,...bindings[0],pins:pins.map(p=>p.number),resistanceOhm,bias,
     activeCount:oneCommon?1:pins.length,scenario:oneCommon?'one-scan-common-opposite-bias':'all-pins-opposite-bias',sourceId:citation.sourceId,quote:raw.trim(),guidanceId:g.id,
     assumptions:['内部偏置按引用阻值及轨到轨最不利状态估算；阻值容差、实际输出摆幅与切换重叠尚未核实，不能视作保证最大电流。']});
   }
  }
  if(!clauses)errors.push(`内部偏置资料 ${g.id} 的引文未形成可计算条目，不能忽略其供电影响。`);
 }
 return {loads,errors};
}
