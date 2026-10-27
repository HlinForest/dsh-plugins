import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {writeJSON,readJSON,tree,hash} from './io.js';
import {resolvedAnswers} from './review-items.js';
import {sourceEvidence} from './specification-facts.js';
import {snapshotPdfs} from './pdf-evidence.js';
import {footprintTool,compileFootprint} from './pcb-footprints.js';
import {pcbProcess,applyPcbProcess} from './pcb-process.js';
import {pcbReviewBaseline} from './engineering-reviews.js';
const root=fileURLToPath(new URL('../',import.meta.url));
export const pcbInstructions=`你负责当前原理图的PCB布局方案。本次工程师已请求PCB，覆盖早期任务书中的“不做PCB”。仅使用当前器件、封装、网络与自然语言板框/制造要求，不读取历史PCB。不允许用猜测封装替换缺失型号。缺少板框尺寸、层数或制造约束时用question提出具体问题；已回答的问题必须继承。
当前编译器支持矩形或圆角矩形，两个KiCad铜层，可指定仅底层布线。完成回复为 {action:"finish",summary:"方案摘要",gaps:[],assumptions:[],pcb:{widthMm:数值,heightMm:数值,clearanceMm:数值,trackWidthMm:数值,componentGapMm:非负数,order:[所有在板器件位号]}}。order按功能及走线关系排序，编译器使用真实封装外形自动放置。需要明确定位时可额外给placements:{位号:{xMm,yMm,rotation:0/90/180/270}}，可仅固定具有机械约束的器件，其余自动布局；必须满足接口/安装孔/显示窗机械约束；不能用order声称满足指定位置要求。支持 cornerRadiusMm、thicknessMm、activeLayers:["B.Cu"]、allowVias:false；assemblySides:{位号:"B.Cu"}给出每个器件的安装面；side取F.Cu或B.Cu；placements是局部固定位置。未支持的板形、层数或约束用question说明，不自行忽略。实际布线与DRC由KiCad和Freerouting执行，模型不能声称它们已经通过。`;
export const footprintInstructions=`缺少封装时先调用 pcb_import_footprint，一次一个器件，只选择 footprintEvidence 中当前 PDF 的表格与引用，不填写尺寸或坐标。工具会读取全部表行并核对所有引脚包括NC。columns五个字段 number/typeShape/center/sizeDrill/rotationLayer 是表列的零基索引；polygons.row是含表头的零基行号。conventions与envelope都只填sourceId，程序读取该页完整原文，禁止再抄长quote；多边形标题逐字引用。不能以SOP/DIP等近似标准封装替代。工程测量资料用 sourceKind=engineering-measurement，保留厂家公差/采购验证未确定。调用格式 {action:"tool",name:"pcb_import_footprint",arguments:{...}}，工具结构在 request.tools。几何缺项用 question，不能 finish 绕过。现有冻结封装不替换。整板 placements 只允许输入明确给出的机械基准；没有坐标约束时完全省略。根据当前安装面、网络和去耦归属选择 order，自动排布。无需重做电路或索要逐脚连线。`;
export function validatePcbPlan(r){
 const p=r.pcb;if(!p)return '缺少 pcb 方案。';
 for(const k of ['widthMm','heightMm','clearanceMm','trackWidthMm','componentGapMm'])if(!Number.isFinite(p[k])||(k==='componentGapMm'?p[k]<0:p[k]<=0))return k+'必须是正数。';
 if(p.widthMm>500||p.heightMm>500||p.componentGapMm<0)return '板框最大500mm，器件间隔不得为负。';
 if(!Array.isArray(p.order)||p.order.some(x=>typeof x!=='string'))return 'order须为位号列表。';
 return null;
}
export function validatePcbContents(plan,components){
 const refs=components.filter(c=>c.on_board!==false).map(c=>c.ref),order=plan.pcb?.order||[];
 const missing=refs.filter(r=>!order.includes(r)),extra=order.filter(r=>!refs.includes(r));
 if(missing.length||extra.length||new Set(order).size!==order.length)return `布局顺序必须逐个覆盖当前在板器件；缺少：${missing.join(', ')}；多出：${extra.join(', ')}。保留位号原拼写，不缩写。`;
 const unknown=Object.keys(plan.pcb?.placements||{}).filter(r=>!refs.includes(r));
 return unknown.length?'未知定位位号：'+unknown.join(', '):null;
}
const coordinateNumber='[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)';

function mechanicalDatums(text){
 const source=String(text||''),datums=[],labeledRefs=[];
 // Keep accepting the concise notation used by existing projects.
 const concise=new RegExp(`(?:^|[^\\w-])([A-Za-z][A-Za-z0-9_-]*|\\*)\\s*=\\s*[（(]\\s*(${coordinateNumber})\\s*[,，]\\s*(${coordinateNumber})\\s*[)）]\\s*mm`,'gi');
 for(const m of source.matchAll(concise))datums.push({ref:m[1],x:Number(m[2]),y:Number(m[3]),labeled:false});
 // New editable presets spell out the datum as “位号…；…X=… mm、Y=… mm”.
 // Keep the reference capture separate from the coordinate grammar so names
 // such as “QR Code1” and “*” remain intact.
 const labeled=new RegExp(`位号\\s*([^；;\\r\\n]+?)\\s*[；;][^\\r\\n]*?\\bX\\s*=\\s*(${coordinateNumber})\\s*(?:mm)?\\s*[、,，;；]\\s*Y\\s*=\\s*(${coordinateNumber})\\s*mm`,'gi');
 for(const m of source.matchAll(labeled)){
  const ref=m[1].trim();
  labeledRefs.push(ref);
  datums.push({ref,x:Number(m[2]),y:Number(m[3]),labeled:true});
 }
 return {datums,labeledRefs};
}

export function validateMechanicalDatums(plan,text,refs){
 const knownRefs=new Set((refs||[]).map(String)),placements=plan?.pcb?.placements||{};
 const {datums,labeledRefs}=mechanicalDatums(text);
 // A labeled datum is an explicit, user-facing constraint. Do not silently
 // ignore a typo or a datum that is absent from the current component list.
 const unknown=labeledRefs.find(ref=>!knownRefs.has(ref));
 if(unknown)return `未知机械基准位号：${unknown}。请让位号与当前在板器件保持一致。`;
 const unsupported=Object.keys(placements).find(ref=>!datums.some(d=>d.ref===ref));
 if(unsupported)return `固定位置没有输入机械基准依据：${unsupported}。请省略该 placements 项，使用自动布局。`;
 for(const datum of datums){
  // Concise prose can contain illustrative coordinates for unrelated objects;
  // retain the historical behavior for those unless they name a known ref.
  if(!knownRefs.has(datum.ref))continue;
  const {ref,x,y}=datum,a=placements[ref];
  if(!a||Math.abs(a.xMm-x)>0.00001||Math.abs(a.yMm-y)>0.00001)return `未落实输入的固定机械基准：${ref}=(${x},${y})mm。请在placements保留这项坐标，不改为自动布局。`;
 }
 return null;
}
export async function executePcb(flow,p,s,signal){
 flow.prerequisites(p,6);
 if(!flow.ai?.generateText||!flow.config.allowModelCalls)throw new Error('请先选择 Harness 模型。');
 const source=p.stages[4],file=(source.files||[]).find(x=>x.path.endsWith('.kicad_sch'));
 if(!file)throw new Error('第五步没有可用的原理图工程。');
 flow.invalidate(p,6);
 const output=path.join(flow.dir(p.id),'steps','6',randomUUID());await fs.mkdir(output,{recursive:true});
 Object.assign(s,{status:'running',output,result:null,files:[],questions:[],gaps:[],assumptions:[],startedAt:new Date().toISOString()});delete s.outputHash;await flow.save(p);
 const records=[];const record=async v=>{flow.modelProgress(p.id,v);if(v.event==='stream-progress')return;if(v.event==='request')p.modelRequests++;records.push(v);await writeJSON(path.join(output,'model-log.json'),records);};
 const imports=new Map(),evidence=[...sourceEvidence(p),...(p.inputs.pcbEvidence||[])];
 const request={pcbDesign:true,inputs:p.inputs,resolvedAnswers:resolvedAnswers(p),stageNotes:p.inputs.stageNotes?.[6]||'',components:p.stages[2].plan?.design?.components||source.result?.components||[],designNets:p.stages[2].plan?.design?.nets||[],previousPlan:s.plan?.pcb||null,footprintEvidence:evidence,tools:[footprintTool],instruction:pcbInstructions+'\n'+footprintInstructions+'\npreviousPlan仅为上次模型方案。核对仍符合当前输入时可沿用其板框、装配面和顺序；所有未绑定封装仍须从当前资料重新导入。不要读取或复用上次生成的器件坐标。'};
 try{
  request.reviewBaseline=await pcbReviewBaseline(flow,p);
  if(request.reviewBaseline)request.instruction+='\nreviewBaseline 是这组评审最初针对的已生成版本，只提供模型的排布意图与检查摘要，不含生成坐标、走线和铜形。器件与接法不变的局部微调，优先保留其order与间距，减少无必要全局重排；若布线或机械约束要求调整，再说明调整原因。线宽及其他要求须采用当前最新评审，不要把基线中的旧参数抄回。所有器件仍须自动放置；固定坐标仍只能来自明确机械输入。';
  const processPolicy=pcbProcess(p.stages[2].plan?.design||{},p.inputs.constraints||{});
  request.process=processPolicy;
  request.instruction+='\nprocess 是工程师可见的工艺选择，宿主据此强制装配面、布线层、过孔、去耦/储能距离、既有零欧跨线与铜区；不能覆盖。距离是可编辑的工程目标，不是厂家给定。gaps 只记录尚缺依据的采购、制造与性能条件；不要在 gaps 填器件数量、装配面或尚待实跑的布局可行性预测。原理图早期“不启用PCB”和“封装留空”已由本步授权和资料导入更新，勿当作本轮未完成结论。';
  await snapshotPdfs(flow,p,output);
  const invoke=async(name,args)=>{
   if(name!==footprintTool.name)throw Error('未知PCB工具：'+name);
   const spec=compileFootprint(args,evidence,request.components);imports.set(spec.ref,spec);
   await writeJSON(path.join(output,'footprint-imports.json'),[...imports.values()]);
   return {ref:spec.ref,id:spec.id,physicalPads:spec.physicalPads,auxiliaryPads:spec.auxiliaryPads,pinMap:spec.pinMap,sourceKind:spec.sourceKind,limitations:spec.limitations};
  };
  s.plan=await flow.ai.generateText({project:{mode:p.mode},stage:{id:6,title:'PCB'},request,record,tools:[footprintTool],invoke,validateFinish:r=>validatePcbPlan(r)||validatePcbContents(r,request.components)||validateMechanicalDatums(r,request.stageNotes,request.components.map(c=>c.ref))||(()=>{const missing=request.components.filter(c=>c.on_board!==false&&!c.footprint&&!imports.has(c.ref));return missing.length?'尚未依据当前资料建立准确封装：'+missing.map(c=>c.ref).join(', '):null;})()},signal);
  if(s.plan.action==='question'){s.status='waiting-input';s.questions=s.plan.questions;s.gaps=[...s.plan.questions];s.files=await tree(output);await flow.save(p);return flow.open(p.id);}
  const invalid=validatePcbPlan(s.plan)||validatePcbContents(s.plan,request.components)||validateMechanicalDatums(s.plan,request.stageNotes,request.components.map(c=>c.ref));if(invalid)throw new Error(invalid);
  const missing=request.components.filter(c=>c.on_board!==false&&!c.footprint&&!imports.has(c.ref));if(missing.length)throw Error('缺少可读取的 KiCad 封装：'+missing.map(c=>c.ref).join(', '));
  const cli=flow.config.kicadCli,python=flow.config.pcbPython||(process.platform==='win32'?path.join(path.dirname(cli),'python.exe'):flow.config.kicadPython);
  const args={solverPython:flow.config.kicadPython,source:path.dirname(path.join(source.output,file.path)),schematic:path.basename(file.path),output,cli,plan:applyPcbProcess(s.plan.pcb,processPolicy),process:processPolicy,
   footprints:flow.config.kicadFootprintRoot||path.resolve(path.dirname(cli),'../share/kicad/footprints'),java:flow.config.javaPath||'java',jar:flow.config.freeroutingJar||path.join(root,'vendor/freerouting-2.1.0.jar'),footprintImports:[...imports.values()],components:request.components,nc:p.stages[2].plan?.design?.nc||[]};
  await writeJSON(path.join(output,'pcb-request.json'),args);
  const runner=Object.create(flow);runner.config={...flow.config,kicadPython:python,processTimeoutMs:30*60*1000};
  flow.phase(p.id,'tool','正在生成布局、自动布线并运行 DRC');
  await runner.runProcess([path.join(root,'python/pcb_flow.py'),path.join(output,'pcb-request.json')],output,signal);
  const result=await readJSON(path.join(output,'pcb-result.json'));
  s.gaps=[...(s.plan.gaps||[]),...([...imports.values()].some(x=>x.sourceKind==='engineering-measurement')?['封装依据外部工程测量资料；厂家尺寸公差、采购料号和实物装配尚未验证。']:[]),...(result.drc.passed?[]:[`PCB DRC：${result.drc.errors} 个错误，${result.drc.unconnected} 个未连接项；请修正后重新生成。`])];
  s.assumptions=s.plan.assumptions||[];
  s.result={...result,summary:`PCB已生成：${result.components}个器件、${result.tracks}条走线/过孔。`,pcbPdf:result.pdf,gaps:s.gaps,checks:[{name:'PCB焊盘网络映射',status:'passed',detail:`已核对${result.netMappingVerified}个焊盘`},{name:'自动布线与DRC',status:result.drc.passed?'passed':'failed',detail:`${result.drc.errors}错误 / ${result.drc.warnings}警告 / ${result.drc.unconnected}未连接`} ]};
  if(result.process){
   s.result.checks.push({name:'供电器件距离',status:result.process.powerPlacement.passed?'passed':'failed',detail:result.process.powerPlacement.relations.map(r=>`${r.ref} → ${r.anchor.ref}.${r.anchor.pad}：${r.distanceMm.toFixed(2)} mm${r.maxDistanceMm==null?'':` / 上限 ${r.maxDistanceMm} mm`}`).join('；')});
   s.result.checks.push({name:'工艺与铜区',status:'passed',detail:`${result.process.assembly.length} 个器件按实际焊盘类型核对安装面；${result.process.jumpers.length} 个原理图已有零欧跨线；${result.process.copper.zones.length} 个铜区已生成并填充`});
  }
  await writeJSON(path.join(output,'result.json'),s.result);await writeJSON(path.join(output,'input-provenance.json'),{inputs:p.inputs,clarifications:p.clarifications||[],sourceOutputHash:source.outputHash});
  s.status='done';s.files=await tree(output);s.outputHash=hash(s.files);s.finishedAt=new Date().toISOString();delete s.invalidation;
  flow.recordEvent(p,6,'完成','PCB布局、布线和DRC已执行',{drc:result.drc});await flow.save(p);return flow.open(p.id);
 }catch(e){if(!signal?.aborted&&/缺少可读取的 KiCad 封装|找不到封装|没有对应焊盘/.test(e.message)){const detail=e.message.split('ValueError:').at(-1).trim();s.status='waiting-input';s.questions=[detail+'。请补充封装规格或指定可用的精确封装型号，并更新器件与规格书。'];s.gaps=[...s.questions];await flow.save(p);return flow.open(p.id);}s.status=signal?.aborted?'cancelled':'failed';s.error=e.message;s.finishedAt=new Date().toISOString();await flow.save(p);throw e;}
}
