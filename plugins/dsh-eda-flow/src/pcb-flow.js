import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {writeJSON,readJSON,tree,hash} from './io.js';
import {resolvedAnswers} from './review-items.js';
const root=fileURLToPath(new URL('../',import.meta.url));
export const pcbInstructions=`你负责当前原理图的PCB布局方案。本次工程师已请求PCB，覆盖早期任务书中的“不做PCB”。仅使用当前器件、封装、网络与自然语言板框/制造要求，不读取历史PCB。不允许用猜测封装替换缺失型号。缺少板框尺寸、层数或制造约束时用question提出具体问题；已回答的问题必须继承。
当前编译器支持矩形双层板。完成回复为 {action:"finish",summary:"方案摘要",gaps:[],assumptions:[],pcb:{widthMm:数值,heightMm:数值,clearanceMm:数值,trackWidthMm:数值,componentGapMm:至少1,order:[所有在板器件位号]}}。order按功能及走线关系排序，编译器使用真实封装外形自动放置。需要明确定位时可额外给placements:{位号:{xMm,yMm,rotation:0/90/180/270}}，必须覆盖全部器件，并满足接口/安装孔/显示窗机械约束；不能用order声称满足指定位置要求。未支持的板形、层数或约束用question说明，不自行忽略。实际布线与DRC由KiCad和Freerouting执行，模型不能声称它们已经通过。`;
export function validatePcbPlan(r){
 const p=r.pcb;if(!p)return '缺少 pcb 方案。';
 for(const k of ['widthMm','heightMm','clearanceMm','trackWidthMm','componentGapMm'])if(!Number.isFinite(p[k])||p[k]<=0)return k+'必须是正数。';
 if(p.widthMm>500||p.heightMm>500||p.componentGapMm<1)return '板框最大500mm，器件间隔至少1mm。';
 if(!Array.isArray(p.order)||p.order.some(x=>typeof x!=='string'))return 'order须为位号列表。';
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
 const request={pcbDesign:true,inputs:p.inputs,resolvedAnswers:resolvedAnswers(p),components:source.result?.components||[],instruction:pcbInstructions};
 try{
  s.plan=await flow.ai.generateText({project:{mode:p.mode},stage:{id:6,title:'PCB'},request,record,validateFinish:validatePcbPlan},signal);
  if(s.plan.action==='question'){s.status='waiting-input';s.questions=s.plan.questions;s.gaps=[...s.plan.questions];await flow.save(p);return flow.open(p.id);}
  const invalid=validatePcbPlan(s.plan);if(invalid)throw new Error(invalid);
  const cli=flow.config.kicadCli,python=flow.config.pcbPython||(process.platform==='win32'?path.join(path.dirname(cli),'python.exe'):flow.config.kicadPython);
  const args={source:path.dirname(path.join(source.output,file.path)),schematic:path.basename(file.path),output,cli,plan:s.plan.pcb,
   footprints:flow.config.kicadFootprintRoot||path.resolve(path.dirname(cli),'../share/kicad/footprints'),java:flow.config.javaPath||'java',jar:flow.config.freeroutingJar||path.join(root,'vendor/freerouting-2.1.0.jar')};
  await writeJSON(path.join(output,'pcb-request.json'),args);
  const runner=Object.create(flow);runner.config={...flow.config,kicadPython:python};
  flow.phase(p.id,'tool','正在生成布局、自动布线并运行 DRC');
  await runner.runProcess([path.join(root,'python/pcb_flow.py'),path.join(output,'pcb-request.json')],output,signal);
  const result=await readJSON(path.join(output,'pcb-result.json'));
  s.gaps=result.drc.passed?[]:[`PCB DRC：${result.drc.errors} 个错误，${result.drc.unconnected} 个未连接项；请修正后重新生成。`];
  s.assumptions=s.plan.assumptions||[];
  s.result={...result,summary:`PCB已生成：${result.components}个器件、${result.tracks}条走线/过孔。`,pcbPdf:result.pdf,gaps:s.gaps,checks:[{name:'PCB焊盘网络映射',status:'passed',detail:`已核对${result.netMappingVerified}个焊盘`},{name:'自动布线与DRC',status:result.drc.passed?'passed':'failed',detail:`${result.drc.errors}错误 / ${result.drc.warnings}警告 / ${result.drc.unconnected}未连接`} ]};
  await writeJSON(path.join(output,'result.json'),s.result);await writeJSON(path.join(output,'input-provenance.json'),{inputs:p.inputs,clarifications:p.clarifications||[],sourceOutputHash:source.outputHash});
  s.status='done';s.files=await tree(output);s.outputHash=hash(s.files);s.finishedAt=new Date().toISOString();delete s.invalidation;
  flow.recordEvent(p,6,'完成','PCB布局、布线和DRC已执行',{drc:result.drc});await flow.save(p);return flow.open(p.id);
 }catch(e){if(!signal?.aborted&&/缺少可读取的 KiCad 封装|找不到封装|没有对应焊盘/.test(e.message)){const detail=e.message.split('ValueError:').at(-1).trim();s.status='waiting-input';s.questions=[detail+'。请补充封装规格或指定可用的精确封装型号，并更新器件与规格书。'];s.gaps=[...s.questions];await flow.save(p);return flow.open(p.id);}s.status=signal?.aborted?'cancelled':'failed';s.error=e.message;s.finishedAt=new Date().toISOString();await flow.save(p);throw e;}
}
