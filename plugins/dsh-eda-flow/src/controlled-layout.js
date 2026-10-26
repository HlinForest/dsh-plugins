import {sourceEvidence} from './specification-facts.js';
import {validateSourceInventory} from './source-inventory.js';
import {projectGuidance} from './application-basis.js';
import {reviewCircuit} from './circuit-review.js';
import {reviewPassiveCoverage} from './passive-coverage.js';
import {reviewOperatingPoints} from './operating-points.js';
import {reviewApplicationDecisions} from './application-decisions.js';
import {reviewBiasRailChoices} from './bias-rail-choices.js';
import {reconcileCalculationNotes,currentCalculationNotes,reconcileDesignCalculationNotes} from './calculation-notes.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { hash, readJSON, writeJSON, tree, sameFiles } from './io.js';
import { validateDesign } from './design-intent.js';
import { hasSourceSpecs, isMockDemo } from './mock-datasheets.js';
const root=fileURLToPath(new URL('../',import.meta.url));
export const controlledInstructions=`受控原理图设计：步骤2先区分原始用户约束、资料事实和模型方案；requirements只记录用户或当前资料明确的内容，不把数量/BOM要求改写成具体连线。需要自行选型或决定连接时放在assumptions和第三步design中并写明依据。步骤3必须在finish.design输出完整电气清单 {nets:[{name,nodes:["reference.pin"]}],nc:["reference.pin"],supplied_nets:[],functions:[],unresolved:[]}。固定库提供真实器件/针脚，逐脚恰好进入一个net或nc。0欧及其他无源器件两端的同网/分网关系只能沿用已知连接或明确的工程选择；没有依据时不默认合并或拆分。supplied_nets是工程师/模型根据资料和实际供电路径作出的外部供电显式声明，只能声明已有依据且确有外部供电或完整串联供电路径的网络；它不是任意消除ERC的开关。含power_in且同网没有真实power_out的网络必须显式列入supplied_nets，无真实供电通路时不得声明。查询库核对针脚，不能伪造资料。宿主在工程师确认第三步后冻结电路及真实符号。步骤4只能使用layout_inspect、layout_generate、layout_verify，生成参数只含template,paper,gapMm，不能传nets/nc/器件/坐标/脚本。固定符号路径按符号、器件值、引脚连接及NC自动匹配已验证局部模板；display-board-v1是兼容旧工程的接口名称，不按位号分派。未匹配时报告缺项，禁止修改电路迎合模板。生成后必须verify，finish说明真实检查结果与待确认项。步骤5/7仅inspect和verify，不修改CAD。PCB跳过，采购型号与实物封装仍需人工核验。只返回单个JSON动作：{action:"tool",name:"...",arguments:{}}或{action:"finish",summary:"...",gaps:[],assumptions:[],design?:...}或{action:"question",questions:["..."]}。所有完成声明以工具结果为准。`;
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
  if(sourceErrors.length)throw new Error('资料对照失败：'+sourceErrors.join('；'));
  const errors=validateDesign(design,p.stages[1]?.plan?.requirements||[],hasSourceSpecs(p)?sourceEvidence(p):[]);
  if(errors.length)throw new Error(errors.slice(0,20).join('\n'));
  const allowed=['components','nets','nc','supplied_nets','functions','unresolved','blockInstances','loadAssessments','peripheralAssessments','operatingPoints','applicationDecisions','calculationHistory'];
  if(Object.keys(design).some(k=>!allowed.includes(k)))throw new Error('设计清单含未知字段。');
  if(p.fixedParts){
    if(p.fixedParts.length!==design.components.length)throw new Error('固定器件数量不符。');
    for(const fixed of p.fixedParts){const c=design.components.find(x=>x.ref===fixed.ref);if(!c||Object.entries(fixed).some(([k,v])=>c[k]!==v))throw new Error('固定器件被改变：'+fixed.ref);}
  }
  const d={...structuredClone(design),supplied_nets:design.supplied_nets||[]};
  await fs.mkdir(directory,{recursive:true});
  // Source-backed/new-design projects receive engineering checks before a
  // symbol snapshot can make a structurally complete circuit look accepted.
  // No reference-project data is available to either review module.
  if (['new-design','datasheet-demo'].includes(p.designMode)) {
    const context={inputs:p.inputs||{},evidence:sourceEvidence(p),requirements:p.stages[1]?.plan?.requirements||[],guidance:projectGuidance(p)};
    const circuit=reviewCircuit(d,context),coverage=reviewPassiveCoverage(d,context),operating=reviewOperatingPoints(d,context);
    const application=reviewApplicationDecisions(d,context);
    const bias=reviewBiasRailChoices(d,operating.biasRailComparisons);
    const message=value=>typeof value==='string'?value:value.message;
    const errors=[...circuit.errors,...coverage.errors,...operating.errors,...application.errors,...bias.errors].map(message);
    const warnings=[...circuit.warnings,...coverage.warnings,...operating.warnings,...application.warnings,...bias.warnings].map(message);
    const sourceGaps=p.stages[1]?.status==='done'&&p.stages[1]?.confirmed ? p.stages[1].gaps||[] : [];
    const narrative=reconcileCalculationNotes(d.unresolved,operating.results);
    // History is audit-only. Neither its text nor any claimed prior status is
    // used to satisfy a requirement or remove a current structured unknown.
    const history=[...(Array.isArray(d.calculationHistory)?d.calculationHistory:[]),...narrative.archived,...reconcileDesignCalculationNotes(d,operating.results)];
    if(history.length)d.calculationHistory=[...new Map(history.filter(r=>typeof r?.text==='string'&&typeof r?.reason==='string').map(r=>[r.text,{...r,status:'superseded',uncertaintiesResolved:false}])).values()];
    d.unresolved=[...new Set([...narrative.notes,...sourceGaps,...circuit.unresolved,...operating.unresolved,...warnings].filter(Boolean))];
    const review={schema:1,scope:'static-engineering-review',errors,warnings,unresolved:d.unresolved,
      passiveRoles:circuit.passiveRoles,loadAssessments:circuit.loadAssessments,peripheralAssessments:circuit.peripheralAssessments,decouplingOwners:circuit.decouplingOwners,obligations:coverage.obligations,coverage:coverage.coverage,
      operatingPoints:operating.results,operatingPointScope:operating.scope,calculationNotes:currentCalculationNotes(operating.results),calculationHistory:d.calculationHistory||[],
      biasRailComparisons:operating.biasRailComparisons,biasRailDecisions:bias.decisions,
      applicationDecisions:application.decisions,applicationRequirements:application.requirements,
      readiness:{status:errors.length?'invalid':d.unresolved.length?'needs-review':'static-checks-passed',hardwareVerified:false,
        boundary:'检查资料引用、器件用途、数量参数、候选网络和已提供工作点的名义阻容计算；工程假设保持待核实，不覆盖容差、温升、开关瞬态、EMC、采购或实物性能。'}};
    await writeJSON(path.join(directory,'engineering-review.json'),review);
    if(errors.length)throw new Error('设计用途与资料覆盖检查未通过：'+errors.slice(0,20).join('；'));
  }
  const file=path.join(directory,'electrical.json');await writeJSON(file,d);
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
    await writeJSON(path.join(dir,'symbols.json'),await readJSON(path.join(reviewed,'symbols.json')));
    await writeJSON(path.join(dir,'electrical.json'),d);
    await writeJSON(path.join(dir,'basis.json'),{requirements:p.stages[1]?.plan?.requirements||[],inputs:p.inputs,citations:s.plan.citations||[],assumptions:s.plan.assumptions||[],scope:'User-confirmed design; no claim of manufacturer or physical validation'});
  }else{
    d=await reviewElectrical(flow,p,s.plan?.design,dir);
    await writeJSON(path.join(dir,'symbols.json'),await readJSON(path.join(flow.dir(p.id),p.fixedLibrary.file)));
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
    if(!a||typeof a!=='object'||Array.isArray(a)||Object.keys(a).some(k=>!['template','paper','gapMm','groups','rotations','allowPaperPromotion'].includes(k)))throw new Error('排版工具不接受电路或脚本字段。');
    if(a.template!=='generic-v1'||!['A4-landscape','A3-landscape','A2-landscape','A1-landscape','A0-landscape'].includes(a.paper))throw new Error('请选择 generic-v1 与 A4–A0 横向。');
    if(a.allowPaperPromotion!==undefined&&typeof a.allowPaperPromotion!=='boolean')throw new Error('allowPaperPromotion 必须为布尔值；固定纸张时设为 false。');
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
export const genericLayoutTools=layoutTools.map(t=>t.name!=='layout_generate'?t:{...t,description:t.description+' paper 为起始纸张，默认按实测图面扩纸至可容纳的 A4–A0，并返回 effectiveLayout；用户要求固定纸张时 allowPaperPromotion=false。',parameters:{type:'object',properties:{template:{enum:['generic-v1']},paper:{enum:['A4-landscape','A3-landscape','A2-landscape','A1-landscape','A0-landscape']},allowPaperPromotion:{type:'boolean'},gapMm:{type:'number',minimum:3.81,maximum:25.4},groups:{type:'array',items:{type:'object',properties:{id:{type:'string'},title:{type:'string'},references:{type:'array',items:{type:'string'}}},required:['id','title','references'],additionalProperties:false}},rotations:{type:'object',additionalProperties:{enum:[0,90,180,270]}}},required:['template','paper','gapMm'],additionalProperties:false}});
export const genericInstructions=`你是受控原理图设计助手。用户只给普通需求，不要求用户提供完整网表。步骤2先区分原始用户约束、资料事实和模型方案，输出requirements:[{id,description}]时只保留用户或资料明确的内容；单纯数量/BOM要求不等于串联路径或网络分割。关键缺项用question询问，需要自主选型或连接选择时写入assumptions和第三步design，并说明依据。步骤3必须使用design_library读取真实元件和封装；design_blocks可读取和实例化可复用子电路及依据。采用实例时将返回的blockInstance收入design.blockInstances数组；components/nets/nc合并进设计，不合并不同内部网络。冻结后只有完整实例独占一个视觉组时才能复用其原生局部布局，不改变块内器件旋转。资料无证据不得编造；附件元数据不等于已读取正文。finish.design格式：{components:[{id,ref,value,mpn,footprint,librarySymbol,dnp:false,in_bom:true,on_board:true,pins:[{number,name,type,pad}]}],nets:[{name,nodes:["U1.1"]}],nc:[],supplied_nets:[],functions:[{requirementId,description,checks:[{kind:"connected"或"isolated",nodes:["U1.1","J1.1"]}],limitations:[]}],unresolved:[]}。逐脚只进入一个net或nc，函数覆盖全部需求；没有静态检查的要求须写limitations。0欧及其他无源器件两端是否同网、拆网或作为串联支路，只能沿用已知连接或明确的工程选择；没有依据时不默认合并或拆分，并把选择和依据写入assumptions。supplied_nets是工程师/模型根据资料和实际供电路径作出的外部供电显式声明，可声明有资料依据的外部供电及经串联电阻/磁珠滤波后实际供电的网络；后者须核对从供电源到负载的完整通路。它不是任意消除ERC的开关；含power_in且同网没有真实power_out的网络必须显式列入supplied_nets，无真实供电通路时不得声明。声明只生成不进入BOM的ERC辅助符号，不改变器件或连接。库引脚number/name/type/pad逐项一致，实际在板器件需绑定可读取封装。当前支持单页、单单元、显式正交引脚，拒绝隐藏引脚和隐式电源符号。采购型号未知留空且写待办。第三步确认由工程师完成，宿主冻结真实符号、连接、NC和资料。步骤4只能layout_inspect/generate/verify：template=generic-v1，paper为A4/A3/A2/A1/A0-landscape，默认从指定纸张按图面尺寸扩纸并返回effectiveLayout；用户明确固定纸张时必须allowPaperPromotion=false，放不下则报告而不是扩纸。gapMm=3.81至25.4，可选groups:[{id,title,references}]完整覆盖所有器件及rotations:{位号:0|90|180|270}。模型可根据冻结功能与布局归属主动提出groups，不要求用户列出成员；未指定分组时宿主按器件功能与拓扑自动分区，标准符号按实际引脚自动定向。远端功能模块可独立分组并通过同名标签连接；串联支路、滤波和去耦保留与所属负载的局部阅读关系。对每组电源去耦优先在functions.layout中明确负载anchor、return和members，不能要求用户先提供这些归属。没有工程师或资料的明确旋转要求时省略rotations；宿主会对支持的普通输入滤波与去耦电容组联合试算朝向、位置和完整布线，并逐候选通过原生网表、PDF及走线检查后择优。不要把上次effectiveLayout中的自动旋转回填成固定约束，否则会关闭这部分搜索。历史模式可复用已验证局部拓扑，新资料路径不读取历史CAD；其他拓扑使用通用ELK。显式分组与旋转限制优先，不能强行套模板。组内连接必须实线，组间可标签，不用逐器件分组掩盖布线失败。先inspect，再generate，再verify，不得写坐标、符号或修改电路。失败时更改分组/纸张/间距或question，禁止改电路迁就排版。步骤5/7只读核验，不改CAD。只返回一个JSON动作：{action:"tool",name,arguments}、{action:"question",questions:[...]}、{action:"finish",summary,gaps:[],assumptions:[],design?:...,requirements?:...}。静态检查不等于实物功能通过。`;
