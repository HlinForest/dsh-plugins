import {sourceEvidence} from './specification-facts.js';
import {validateSourceInventory} from './source-inventory.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { hash, readJSON, writeJSON, tree, sameFiles } from './io.js';
import { validateDesign } from './design-intent.js';
import { hasSourceSpecs, isMockDemo } from './mock-datasheets.js';
const root=fileURLToPath(new URL('../',import.meta.url));
export const controlledInstructions=`受控原理图实验版：步骤2整理提供的资料；步骤3必须在finish.design输出完整电气清单 {nets:[{name,nodes:["reference.pin"]}],nc:["reference.pin"],supplied_nets:[],functions:[],unresolved:[]}。固定库提供真实器件/针脚，逐脚恰好进入一个net或nc，0欧电阻两端网络不能擅自合并。supplied_nets只能声明已有依据的供电轨。查询库核对针脚，不能伪造资料。宿主在工程师确认第三步后冻结电路及真实符号。步骤4只能使用layout_inspect、layout_generate、layout_verify，生成参数只含template,paper,gapMm，不能传nets/nc/器件/坐标/脚本。固定符号路径按符号、器件值、引脚连接及NC自动匹配已验证局部模板；display-board-v1是兼容旧工程的接口名称，不按位号分派。未匹配时报告缺项，禁止修改电路迎合模板。生成后必须verify，finish说明真实检查结果与待确认项。步骤5/7仅inspect和verify，不修改CAD。PCB跳过，采购型号与实物封装仍需人工核验。只返回单个JSON动作：{action:"tool",name:"...",arguments:{}}或{action:"finish",summary:"...",gaps:[],assumptions:[],design?:...}或{action:"question",questions:["..."]}。所有完成声明以工具结果为准。`;
export function normalizeDesign(d){
  if(!d||!Array.isArray(d.nets)||!Array.isArray(d.nc))throw new Error('第三步必须提供完整 nets 和 nc。');
  const allowed=['nets','nc','supplied_nets','functions','unresolved'];
  if(Object.keys(d).some(k=>!allowed.includes(k)))throw new Error('固定库电气清单不接受器件/图形覆写。');
  const nets=d.nets.map(n=>{
    if(!n||Object.keys(n).some(k=>!['name','nodes'].includes(k))||typeof n.name!=='string'||!n.name.trim()||!Array.isArray(n.nodes)||!n.nodes.length||n.nodes.some(x=>typeof x!=='string'))throw new Error('网络格式无效。');
    return {name:n.name,nodes:[...n.nodes].sort()};
  }).sort((a,b)=>a.name.localeCompare(b.name));
  for(const k of ['nc','supplied_nets','unresolved'])if((d[k]||[]).some(x=>typeof x!=='string'))throw new Error('清单字段格式无效。');
  return {nets,nc:[...d.nc].sort(),supplied_nets:[...(d.supplied_nets||[])].sort(),functions:d.functions||[],unresolved:d.unresolved||[]};
}
export async function runLayoutPython(flow,req,directory,signal){
  await fs.mkdir(directory,{recursive:true});
  const input=path.join(directory,'request.json'),result=path.join(directory,'response.json');
  await writeJSON(input,{...req,cli:flow.config.kicadCli,node:process.execPath});
  await flow.runProcess([path.join(root,req.engine==='native-kicad'?'mcp/generic_layout.py':'mcp/controlled_layout.py'),input,result],directory,signal);
  const value=await readJSON(result);
  if(req.operation==='snapshot'&&value.status!=='passed')throw new Error(value.errors?.join('; ')||'资源快照失败。');
  return value;
}
export function libraryConfig(flow){
  return {libraryRoot:flow.config.kicadLibraryRoot||path.resolve(path.dirname(flow.config.kicadCli),'../share/kicad'),catalogFile:flow.config.catalogFile||null};
}
export async function reviewNative(flow,p,design,directory,signal){
  const sourceErrors=(isMockDemo(p)||sourceEvidence(p)?.some(r=>r.reference&&r.objectRole))?validateSourceInventory(design,sourceEvidence(p)):[];
  if(sourceErrors.length)throw new Error('模拟资料对照失败：'+sourceErrors.join('；'));
  const errors=validateDesign(design,p.stages[1]?.plan?.requirements||[],hasSourceSpecs(p)?sourceEvidence(p):[]);
  if(errors.length)throw new Error(errors.slice(0,20).join('\n'));
  const allowed=['components','nets','nc','supplied_nets','functions','unresolved','blockInstances'];
  if(Object.keys(design).some(k=>!allowed.includes(k)))throw new Error('设计清单含未知字段。');
  if(p.fixedParts){
    if(p.fixedParts.length!==design.components.length)throw new Error('固定器件数量不符。');
    for(const fixed of p.fixedParts){const c=design.components.find(x=>x.ref===fixed.ref);if(!c||Object.entries(fixed).some(([k,v])=>c[k]!==v))throw new Error('固定器件被改变：'+fixed.ref);}
  }
  const d={...structuredClone(design),supplied_nets:design.supplied_nets||[]};
  await fs.mkdir(directory,{recursive:true});const file=path.join(directory,'electrical.json');await writeJSON(file,d);
  await runLayoutPython(flow,{engine:'native-kicad',operation:'snapshot',title:p.label,...libraryConfig(flow),mockEvidence:hasSourceSpecs(p)?sourceEvidence(p):undefined,design:file,snapshot:path.join(directory,'symbols.json')},path.join(directory,'validation'),signal);
  return d;
}
export async function reviewElectrical(flow,p,design,directory,signal){
  if(p.layoutEngine==='native-kicad')return reviewNative(flow,p,design,directory,signal);
  const d=normalizeDesign(design),lib=path.join(flow.dir(p.id),p.fixedLibrary.file);
  if(hash(await fs.readFile(lib))!==p.fixedLibrary.sha256)throw new Error('元件库指纹变化。');
  const file=path.join(directory,'electrical.json');await writeJSON(file,d);
  await runLayoutPython(flow,{operation:'validate',library:lib,design:file},path.join(directory,'validation'),signal);
  return d;
}
export async function freezeElectrical(flow,p,s){
  const dir=path.join(flow.dir(p.id),'frozen',randomUUID());
  await fs.mkdir(dir,{recursive:true});
  let d;
  if(p.layoutEngine==='native-kicad'){
    // Freeze exactly the reviewed resources. Do not silently re-read a changed live library.
    const reviewed=path.join(s.output,'electrical-review');
    d=await readJSON(path.join(reviewed,'electrical.json'));
    if(hash(d)!==hash({...s.plan.design,supplied_nets:s.plan.design.supplied_nets||[]}))throw new Error('已评审设计与确认清单不同，请重新执行第三步。');
    await fs.copyFile(path.join(reviewed,'symbols.json'),path.join(dir,'symbols.json'));
    await writeJSON(path.join(dir,'electrical.json'),d);
    await writeJSON(path.join(dir,'basis.json'),{requirements:p.stages[1]?.plan?.requirements||[],inputs:p.inputs,citations:s.plan.citations||[],assumptions:s.plan.assumptions||[],scope:'User-confirmed design; no claim of manufacturer or physical validation'});
  }else{
    d=await reviewElectrical(flow,p,s.plan?.design,dir);
    await fs.copyFile(path.join(flow.dir(p.id),p.fixedLibrary.file),path.join(dir,'symbols.json'));
  }
  const contract={schema:2,engine:p.layoutEngine||'display-board',template:p.layoutEngine==='native-kicad'?'generic-v1':'display-board-v1',electricalHash:hash(d),stage3OutputHash:s.outputHash,stage3PlanHash:hash(s.plan),libraryHash:hash(await fs.readFile(path.join(dir,'symbols.json')))};
  await writeJSON(path.join(dir,'contract.json'),contract);
  p.electricalFreeze={directory:path.relative(flow.dir(p.id),dir),files:await tree(dir),contract};
}
export async function checkFreeze(flow,p){
  const f=p.electricalFreeze,s=p.stages.find(x=>x.id===3);
  if(!f||!s?.confirmed||s.status!=='done')throw new Error('第三步尚未确认和冻结。');
  const dir=path.resolve(flow.dir(p.id),f.directory);
  if(!dir.startsWith(path.resolve(flow.dir(p.id),'frozen')+path.sep))throw new Error('冻结目录非法。');
  if(!sameFiles(f.files,await tree(dir))||s.outputHash!==f.contract.stage3OutputHash||hash(s.plan)!==f.contract.stage3PlanHash||!sameFiles(s.files,await tree(s.output)))throw new Error('冻结清单或已确认第三步发生变化；返回第三步重新确认。');
  const d=await readJSON(path.join(dir,'electrical.json'));
  if(hash(d)!==f.contract.electricalHash)throw new Error('电气清单指纹不符。');
  return {dir,design:d,hash:f.contract.electricalHash,engine:f.contract.engine||'display-board',template:f.contract.template,library:path.join(dir,'symbols.json'),designFile:path.join(dir,'electrical.json')};
}
export function validateLayoutArgs(a,engine='display-board'){
  if(engine==='native-kicad'){
    if(!a||typeof a!=='object'||Array.isArray(a)||Object.keys(a).some(k=>!['template','paper','gapMm','groups','rotations'].includes(k)))throw new Error('排版工具不接受电路或脚本字段。');
    if(a.template!=='generic-v1'||!['A4-landscape','A3-landscape'].includes(a.paper))throw new Error('请选择 generic-v1 与 A4/A3 横向。');
    if(typeof a.gapMm!=='number'||!Number.isFinite(a.gapMm)||a.gapMm<3.81||a.gapMm>25.4)throw new Error('gapMm 需为 3.81–25.4 mm。');
    return a;
  }
  if(!a||typeof a!=='object'||Array.isArray(a)||Object.keys(a).some(k=>!['template','paper','gapMm'].includes(k)))throw new Error('排版工具只接受 template、paper、gapMm，禁止修改连接和器件。');
  if(a.template!=='display-board-v1'||a.paper!=='A4-landscape')throw new Error('固定符号路径使用兼容模板入口 display-board-v1 / A4-landscape。');
  if(typeof a.gapMm!=='number'||!Number.isFinite(a.gapMm)||a.gapMm<3.81||a.gapMm>12.7)throw new Error('gapMm 需为 3.81–12.7 mm。');
  return a;
}
const empty={type:'object',properties:{},additionalProperties:false};
export const layoutTools=[
  {name:'layout_inspect',description:'读取第三步冻结清单及当前排版/审计摘要。',parameters:empty},
  {name:'layout_generate',description:'根据冻结电路生成新候选；独立检查通过后才发布。',parameters:{type:'object',properties:{template:{type:'string',enum:['display-board-v1']},paper:{type:'string',enum:['A4-landscape']},gapMm:{type:'number',minimum:3.81,maximum:12.7}},required:['template','paper','gapMm'],additionalProperties:false}},
  {name:'layout_verify',description:'重新解析实际KiCad文件，检查符号、连接、NC、局部实线、PDF碰撞和ERC。',parameters:empty}
];
export const genericLayoutTools=layoutTools.map(t=>t.name!=='layout_generate'?t:{...t,parameters:{type:'object',properties:{template:{enum:['generic-v1']},paper:{enum:['A4-landscape','A3-landscape']},gapMm:{type:'number',minimum:3.81,maximum:25.4},groups:{type:'array',items:{type:'object',properties:{id:{type:'string'},title:{type:'string'},references:{type:'array',items:{type:'string'}}},required:['id','title','references'],additionalProperties:false}},rotations:{type:'object',additionalProperties:{enum:[0,90,180,270]}}},required:['template','paper','gapMm'],additionalProperties:false}});
export const genericInstructions=`你是受控原理图设计助手。用户只给普通需求，不要求用户提供完整网表。步骤2输出requirements:[{id,description}]与功能方案；关键缺项用question询问。步骤3必须使用design_library读取真实元件和封装；design_blocks可读取和实例化可复用子电路及依据。采用实例时将返回的blockInstance收入design.blockInstances数组；components/nets/nc合并进设计，不合并不同内部网络。冻结后只有完整实例独占一个视觉组时才能复用其原生局部布局，不改变块内器件旋转。资料无证据不得编造；附件元数据不等于已读取正文。finish.design格式：{components:[{id,ref,value,mpn,footprint,librarySymbol,dnp:false,in_bom:true,on_board:true,pins:[{number,name,type,pad}]}],nets:[{name,nodes:["U1.1"]}],nc:[],supplied_nets:[],functions:[{requirementId,description,checks:[{kind:"connected"或"isolated",nodes:["U1.1","J1.1"]}],limitations:[]}],unresolved:[]}。逐脚只进入一个net或nc，函数覆盖全部需求；没有静态检查的要求须写limitations。不得擅自合并零欧电阻两侧网络；资料明确同网时保留原连接并注明依据，不强行拆分。supplied_nets可声明有资料依据的外部供电及经串联电阻/磁珠滤波后实际供电的网络；后者须核对从供电源到负载的完整通路。声明只生成不进入BOM的ERC辅助符号，不改变器件或连接；不能声明无供电通路的网络来掩盖电源设计错误。库引脚number/name/type/pad逐项一致，实际在板器件需绑定可读取封装。当前支持单页、单单元、显式正交引脚，拒绝隐藏引脚和隐式电源符号。采购型号未知留空且写待办。第三步确认由工程师完成，宿主冻结真实符号、连接、NC和资料。步骤4只能layout_inspect/generate/verify：template=generic-v1，paper=A4-landscape或A3-landscape，gapMm=3.81至25.4，可选groups:[{id,title,references}]完整覆盖所有器件及rotations:{位号:0|90|180|270}。未指定分组时宿主按器件功能与拓扑自动分区，标准符号按实际引脚自动定向；优先省略groups和rotations。历史模式可复用已验证局部拓扑，新资料路径不读取历史CAD；其他拓扑使用通用ELK。显式分组与旋转限制优先，不能强行套模板。组内连接必须实线，组间可标签，不用逐器件分组掩盖布线失败。先inspect，再generate，再verify，不得写坐标、符号或修改电路。失败时更改分组/纸张/间距或question，禁止改电路迁就排版。步骤5/7只读核验，不改CAD。只返回一个JSON动作：{action:"tool",name,arguments}、{action:"question",questions:[...]}、{action:"finish",summary,gaps:[],assumptions:[],design?:...,requirements?:...}。静态检查不等于实物功能通过。`;
