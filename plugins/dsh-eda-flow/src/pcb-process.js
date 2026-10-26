import {validateLayoutIntent} from './layout-intent.js';

export const processKeys=['pcbSmdSide','pcbThtSide','pcbRoutingLayers','pcbVias','pcbJumpers','pcbCopper','pcbDecouplingMm','pcbStorageMm'];
const options={pcbSmdSide:['不限定','底面','顶面'],pcbThtSide:['不限定','顶面','底面'],pcbRoutingLayers:['沿用布线要求','仅底层','仅顶层','双层'],pcbVias:['沿用布线要求','禁止','允许'],pcbJumpers:['仅保留原理图已有跨线','不使用跨线'],pcbCopper:['不铺铜','回流铜区','电源与回流铜区']};
const capacitor=c=>/^Device:C(?:_|$)/.test(c.librarySymbol||'')||c.componentKind==='capacitor';
export function pcbProcess(design,constraints={}){
 const process={};
 for(const [key,values] of Object.entries(options)){
  const value=constraints[key];if(value!=null&&value!==''&&!values.includes(value))throw Error(key+' 工艺选项无效');
  process[key]=value||values[0];
 }
 for(const key of ['pcbDecouplingMm','pcbStorageMm']){
  const value=constraints[key];process[key]=value==null||value===''?null:Number(value);
  if(process[key]!=null&&(!Number.isFinite(process[key])||process[key]<=0||process[key]>100))throw Error(key+' 距离必须大于0且不超过100 mm');
 }
 const errors=validateLayoutIntent(design);if(errors.length)throw Error(errors.join('；'));
 const comps=new Map((design.components||[]).map(c=>[c.ref,c])),netof=new Map();
 for(const net of design.nets||[])for(const node of net.nodes)netof.set(node,net.name);
 const relations=[];
 const bind=(ref,relation,kind)=>{
  const c=comps.get(ref);if(!c||c.on_board===false||c.dnp)return;
  if(!capacitor(c))throw Error(ref+' 供电布局归属必须为电容');
  const supply=netof.get(relation.anchor),ret=netof.get(relation.return);
  const supplyPin=c.pins.find(p=>netof.get(ref+'.'+p.number)===supply),returnPin=c.pins.find(p=>netof.get(ref+'.'+p.number)===ret);
  if(!supply||!ret||supply===ret||!supplyPin||!returnPin)throw Error(ref+' 供电归属与实际网络不符');
  const endpoint=value=>{const i=value.lastIndexOf('.'),owner=comps.get(value.slice(0,i)),pin=owner?.pins.find(p=>String(p.number)===value.slice(i+1));if(!pin)throw Error('无效供电端点 '+value);return {ref:owner.ref,pad:String(pin.pad??pin.number)};};
  relations.push({ref,kind,anchor:endpoint(relation.anchor),return:endpoint(relation.return),supplyPad:String(supplyPin.pad??supplyPin.number),returnPad:String(returnPin.pad??returnPin.number),supplyNet:supply,returnNet:ret,maxDistanceMm:process[kind==='decoupling'?'pcbDecouplingMm':'pcbStorageMm'],basis:kind==='decoupling'?'reviewed functions.layout':'reviewed supply-transient operating point'});
 };
 const owners=[];
 for(const fn of design.functions||[])for(const relation of fn.layout||[])if(relation.kind==='decoupling'){
  owners.push(relation);for(const ref of relation.members)bind(ref,relation,'decoupling');
 }
 for(const op of design.operatingPoints||[])if(op.kind==='supply-transient'){
  const candidates=owners.filter(o=>o.anchor.slice(0,o.anchor.lastIndexOf('.'))===op.owner);
  for(const ref of op.components||[]){
   const existing=relations.find(r=>r.ref===ref);
   if(existing?.kind==='storage'&&existing.anchor.ref!==op.owner)throw Error(ref+' 为多负载共享储能，需要明确布置归属，不能任取一个负载');
   if(existing)continue;
   const c=comps.get(ref);if(!c||!capacitor(c))continue;
   const nets=new Set(c.pins.map(p=>netof.get(ref+'.'+p.number)));
   const matching=candidates.filter(o=>nets.has(netof.get(o.anchor))&&nets.has(netof.get(o.return)));
   const unique=[...new Map(matching.map(o=>[o.anchor+'|'+o.return,o])).values()];
   if(unique.length!==1)throw Error(ref+' 储能放置缺少唯一且已核对的负载供电归属');
   bind(ref,unique[0],'storage');
  }
 }
 const jumpers=(design.components||[]).filter(c=>c.on_board!==false&&!c.dnp&&(c.electricalRole==='routing-bridge'||/^0(?:[.][0]+)?\s*(?:Ω|Ω|ohm|R)$/i.test(c.value))).map(c=>c.ref);
 if(process.pcbJumpers==='不使用跨线'&&jumpers.length)throw Error('当前原理图包含零欧跨线，请先在电路阶段处理，PCB 阶段不会删器件或合并网络');
 const copperNets=process.pcbCopper==='不铺铜'?[]:[...new Map(relations.flatMap(r=>[{name:r.returnNet,kind:'return'},...(process.pcbCopper==='电源与回流铜区'?[{name:r.supplyNet,kind:'supply'}]:[])]).map(n=>[n.name,n])).values()];
 if(process.pcbCopper!=='不铺铜'&&!copperNets.length)throw Error('没有已核对的供电/返回域，不能猜测铺铜网络');
 return {...process,relations,jumpers,copperNets,geometrySource:'current netlist and footprints; no reference PCB coordinates'};
}

export function applyPcbProcess(plan,process){
 const result=structuredClone(plan);
 if(process.pcbRoutingLayers!=='沿用布线要求')result.activeLayers=process.pcbRoutingLayers==='仅底层'?['B.Cu']:process.pcbRoutingLayers==='仅顶层'?['F.Cu']:['F.Cu','B.Cu'];
 if(process.pcbVias!=='沿用布线要求')result.allowVias=process.pcbVias==='允许';
 if(process.copperNets.length&&(result.activeLayers||['F.Cu','B.Cu']).length!==1)throw Error('当前铜区生成仅支持明确的单一布线层，请选择仅顶层或仅底层');
 return result;
}
