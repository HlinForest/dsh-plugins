import {resolvedAnswers} from './review-items.js';
import { requestMetrics } from './input-metrics.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { hash,readJSON,writeJSON,tree,sameFiles } from './io.js';
import { checkFreeze,layoutTools,genericLayoutTools,validateLayoutArgs,runLayoutPython } from './controlled-layout.js';
import { hasSimulatedInputs, isMockDemo } from './mock-datasheets.js';
import {reviewRoutingQuality} from './routing-quality.js';
import {reconcileCalculationNotes,engineeringSummary} from './calculation-notes.js';

export async function executeControlled(flow,p,s,signal){
  flow.prerequisites(p,s.id);
  if(!flow.config.allowModelCalls||!flow.ai?.generateText)throw new Error('需要 Harness 当前模型。');
  const frozen=await checkFreeze(flow,p),oldValid=p.lastValidLayout;
  const tools=frozen.engine==='native-kicad'?genericLayoutTools:layoutTools;
  flow.invalidate(p,s.id);
  const output=path.join(flow.dir(p.id),'steps',String(s.id),randomUUID());await fs.mkdir(output,{recursive:true});
  Object.assign(s,{status:'running',output,result:null,previousValidLayout:oldValid||null,files:[],gaps:[],assumptions:[],questions:[],startedAt:new Date().toISOString(),attempts:(s.attempts||0)+1});delete s.outputHash;
  await flow.save(p);
  const records=[],calls=[];let accepted=null,verified=false;
  const record=async value=>{
    flow.modelProgress(p.id,value);if(value.event==='stream-progress')return;
    if(value.event==='request'){p.modelRequests++;await flow.save(p);}
    records.push({at:new Date().toISOString(),...requestMetrics(value)});await writeJSON(path.join(output,'model-log.json'),records);
  };
  const verifyCandidate=async candidate=>{
    await checkFreeze(flow,p);
    const result=await runLayoutPython(flow,{operation:'verify',engine:frozen.engine,layout:candidate.layout,library:frozen.library,design:frozen.designFile,output:candidate.project},path.join(output,'checks',randomUUID()),signal);
    if(result.status!=='passed')throw new Error('独立验证失败：'+result.errors.slice(0,12).join('; '));
    const routingQuality=await checkRouting(candidate.project,result,candidate.layout);
    return {...candidate,audit:{...result,...(routingQuality?{routingQuality}:{})}};
  };
  const checkRouting=async(project,audit,layout)=>{
    if(frozen.engine!=='native-kicad')return null;
    const quality=await reviewRoutingQuality({project,audit,layout});
    if(quality.status!=='passed')throw new Error('绕线检查未通过：'+quality.findings.filter(f=>f.severity==='error').map(f=>f.message).join('；')+'；实际线长指标：'+JSON.stringify(quality.metrics?.wire||{}));
    return quality;
  };
  try{
    await writeJSON(path.join(output,'input-provenance.json'),{simulated:hasSimulatedInputs(p),scope:isMockDemo(p)?'PDF extraction only; controlled CAD and checks are real':'Natural language and extracted PDF pages',inputs:p.inputs,clarifications:p.clarifications||[],electricalHash:frozen.hash});
    if(s.id>4){
      if(!oldValid)throw new Error('尚无已通过的受控原理图。');
      if(!sameFiles(oldValid.files,await tree(oldValid.project))||oldValid.electricalHash!==frozen.hash)throw new Error('上游原理图已变化。');
      const project=path.join(output,'project');await fs.cp(oldValid.project,project,{recursive:true,errorOnExist:true,force:false});
      accepted={project,layout:oldValid.layout,paperSelection:oldValid.paperSelection,audit:await readJSON(path.join(project,'audit.json'))};
    }
    const invoke=async(name,args)=>{
      try{
        await checkFreeze(flow,p);let result;
        if(!tools.some(t=>t.name===name)||s.id>4&&name==='layout_generate')throw new Error('本阶段禁止该工具。');
        if(name!=='layout_generate'&&(!args||Array.isArray(args)||Object.keys(args).length))throw new Error('只读工具不接受参数。');
        if(name==='layout_inspect')result={electricalHash:frozen.hash,design:frozen.design,template:frozen.template,current:accepted?.audit||null,...(frozen.engine==='native-kicad'?{firstCandidate:{template:'generic-v1',paper:'A4-landscape',gapMm:5.08,allowPaperPromotion:true},groupingGuidance:'先评估不含groups/rotations的自动分组候选。宿主已根据共享接口、局部支路和去耦归属推导分组；不要仅凭器件名称把共享接口重新并入单个功能模块。用户明确指定纸张、方向或分组时遵循用户约束。后续分组调整应说明相对首个候选改善了哪些实际检查或图面问题。'}:{}),scope:frozen.engine==='native-kicad'?'Single-sheet native schematic verification; PCB has a separate stage':'Fixed-symbol schematic verification; PCB has a separate stage'};
        if(name==='layout_generate'){
          validateLayoutArgs(args,frozen.engine);
          const candidate=path.join(output,'candidates',randomUUID()),project=path.join(candidate,'project');
          const audit=await runLayoutPython(flow,{operation:'generate',engine:frozen.engine,layout:args,library:frozen.library,design:frozen.designFile,output:project,gap:args.gapMm},candidate,signal);
          if(audit.status!=='passed')throw new Error('候选未通过，保留上次成功结果：'+audit.errors.slice(0,12).join('; '));
          const effectiveLayout=frozen.engine==='native-kicad'?audit.effectiveLayout:args;
          validateLayoutArgs(effectiveLayout,frozen.engine);
          if(args.allowPaperPromotion===false&&effectiveLayout.paper!==args.paper)throw new Error('编译器改变了已固定的纸张。');
          const routingQuality=await checkRouting(project,audit,effectiveLayout);
          if(routingQuality)audit.routingQuality=routingQuality;
          accepted={project,layout:effectiveLayout,paperSelection:audit.paperSelection,audit};verified=false;result={...audit,electricalHash:frozen.hash,candidateId:path.basename(candidate)};
        }
        if(name==='layout_verify'){
          if(!accepted)throw new Error('先生成原理图。');accepted=await verifyCandidate(accepted);verified=true;result={...accepted.audit,electricalHash:frozen.hash};
        }
        calls.push({name,arguments:args,result,ok:true});await writeJSON(path.join(output,'tool-log.json'),calls);return result;
      }catch(e){calls.push({name,arguments:args,error:e.message,ok:false});await writeJSON(path.join(output,'tool-log.json'),calls);throw e;}
    };
    s.plan=await flow.ai.generateText({project:{mode:p.mode,designMode:p.designMode,controlledLayout:true,layoutEngine:frozen.engine,label:p.label},stage:{id:s.id,title:s.title},
      request:{inputs:{...p.inputs,clarifications:resolvedAnswers(p)},scope:'controlled-schematic',instruction:s.id===4?`先inspect，再以${frozen.template}、合适纸张和间距生成，verify后完成。没有固定纸张要求时先从A4横向和适度间距尝试，宿主可按实际范围扩纸；避免内容只占大纸张的一角。没有特殊功能边界要求时先采用宿主自动分组，结合实际检查结果再调整groups。优先落实inputs.stageNotes[4]里的工程师图面要求；它比早期资料中的排版建议更新。根据冻结functions中的布局归属、器件功能和实际信号通路主动选择功能分组，可传groups完整覆盖所有器件，也可采用宿主拓扑分组；不要求用户列出分组成员或坐标。驱动器和局部串联/滤波器件保留短实线，远端负载或显示模块可独立成组使用同名网络标签，避免为了连接一切而形成横贯页面的长绕线。保留去耦与负载的归属，不通过逐器件拆组掩盖布线失败。用户明确限制纸张时设置allowPaperPromotion=false；未限制时允许按实测图面自动扩纸，并在结果中说明实际纸张。未指定精确旋转时省略rotations。若放不下、绕线检查或核验不通过，结合工具返回调整分组、方向与间距，不能只扩大纸张，也不能改变冻结连接。`:'只读核验本轮已生成原理图。',electricalHash:frozen.hash},
      tools:tools.filter(t=>s.id===4||t.name!=='layout_generate'),invoke,record,
      validateFinish:()=>accepted&&verified?null:'必须实际生成并调用 layout_verify，通过后才可完成。'},signal);
    if(s.plan.action==='question'){s.status='waiting-input';s.questions=s.plan.questions;s.gaps=[...s.plan.questions];s.finishedAt=new Date().toISOString();await flow.save(p);return flow.open(p.id);}
    accepted=await verifyCandidate(accepted);
    for(const prior of p.stages.filter(x=>x.id<s.id&&x.output&&x.status==='done'))if(!sameFiles(prior.files,await tree(prior.output)))throw new Error('执行期间上游文件变化。');
    const project=path.join(output,'project');
    if(accepted.project!==project)await fs.cp(accepted.project,project,{recursive:true,errorOnExist:true,force:false});
    const result=accepted.audit,relative=f=>path.relative(output,f).replaceAll('\\','/');
    const files=await tree(project);const pdf=files.find(f=>f.path.endsWith('.pdf')),svg=files.find(f=>f.path.endsWith('.svg'));
    const readback=await readJSON(path.join(project,'readback.json'));
    const components=readback.components.filter(c=>!c.reference.startsWith('#')).map((c,id)=>{
      const parameters=Object.fromEntries(c.properties.map(p=>[p.name,p.value]));
      return {id,ref:c.reference,value:c.value,footprint:parameters.OriginalFootprint||c.footprint||'',code:parameters.MaterialCode||'',description:parameters.MaterialDescription||'',mount:parameters.AssemblyType||'',parameters,in_bom:c.in_bom,on_board:c.on_board,dnp:c.dnp,pins:Object.keys(readback.pins).filter(k=>k.startsWith(c.reference+'.')).length,source:'实际 KiCad 原理图回读'};
    });
    const nets=[...readback.nets.map((n,id)=>({id,...n,nc:false})),...readback.nc.map((k,i)=>({id:readback.nets.length+i,name:'NC',nodes:[k],nc:true}))];
    const pins=Object.entries(readback.pins).filter(([k])=>!k.startsWith('#')).map(([k,point],id)=>{
      const pos=k.lastIndexOf('.');return {id,ref:k.slice(0,pos),pin:k.slice(pos+1),...readback.pinDetails?.[k],point,net:nets.find(n=>n.nodes.includes(k))?.name||''};
    });
    await writeJSON(path.join(output,'generated-review.json'),{components,pins,nets,counts:{components:components.length,pins:pins.length,nets:nets.length},source:'generated-cad'});
    s.planOrigin=s.plan.provider==='test-double'||/test[-_ ]?double/i.test(s.plan.model||'')?'test-double':'live-ai';
    s.gaps=[...(s.plan.gaps||[]),...(frozen.design.unresolved||[]),...(result.erc.warnings?[`ERC：0 个错误、${result.erc.warnings} 个警告，详见实际报告，需人工审阅。`]:[]),...(result.routingQuality?.findings||[]).filter(f=>f.severity==='warning').map(f=>f.message)];s.assumptions=s.plan.assumptions||[];
    const engineeringReview=p.stages.find(stage=>stage.id===3)?.result?.engineeringReview;
    const reconciledGaps=reconcileCalculationNotes(s.gaps,engineeringReview?.operatingPoints),reconciledAssumptions=reconcileCalculationNotes(s.assumptions,engineeringReview?.operatingPoints);
    s.gaps=reconciledGaps.notes;s.assumptions=reconciledAssumptions.notes;
    s.result={...(engineeringReview?{engineeringReview}:{}),summary:engineeringSummary(s.id,frozen.design,engineeringReview)??s.plan.summary,gaps:s.gaps,assumptions:s.assumptions,origin:'text-mcp',components,
      calculationNotes:reconciledGaps.current,calculationHistory:[...(engineeringReview?.calculationHistory||[]),...reconciledGaps.archived,...reconciledAssumptions.archived],
      schematicPdf:relative(path.join(project,pdf.path)),previews:svg?[relative(path.join(project,svg.path))]:[],bom:'project/bom.csv',
      erc:{by_severity:{error:result.erc.errors,warning:result.erc.warnings},violation_count:result.erc.errors+result.erc.warnings},
      electricalHash:frozen.hash,paperSelection:accepted.paperSelection||result.paperSelection,routingQuality:result.routingQuality,checks:[{name:'冻结符号 / 连接 / NC / 图面碰撞',status:'passed',detail:`${result.symbols}对象、${result.pins}引脚、${result.nets}网络；${accepted.layout.paper}；文字重叠及穿线均为0。`,source:'tool'},...(result.routingQuality?[{name:'长绕线检查',status:'passed',detail:`总线长 ${result.routingQuality.metrics.wire.totalWireMm} mm，最长线段 ${result.routingQuality.metrics.wire.maxSegmentMm} mm；未触发长线簇门槛。`,source:'tool'},{name:'图面阅读与参考图比对',status:'not-run',detail:'自动检查未执行参考图视觉比对，请查看本次图纸。',source:'scope'}]:[]),{name:'模型实际调用',status:s.planOrigin==='live-ai'?'passed':'test-double',detail:`${s.plan.provider} / ${s.plan.model}；本步${calls.length}次工具调用。`,source:'model'},{name:'生产签核',status:'not-run',detail:'原理图静态核验通过，实物性能和生产条件仍待工程师确认。PCB状态单独记录。',source:'scope'}],
      files:files.map(f=>({...f,path:'project/'+f.path,format:path.extname(f.path).slice(1)}))};
    if(engineeringReview)s.result.checks.push({name:'设计用途 / 来源覆盖 / 未决参数',status:engineeringReview.readiness.status==='static-checks-passed'?'passed':'findings',detail:`冻结设计保留${engineeringReview.unresolved.length}项待复核；ERC和图面检查不消除电气选型、封装或资料缺项。`,source:'tool'});
    await writeJSON(path.join(output,'ai-output.json'),s.plan);await writeJSON(path.join(output,'result.json'),s.result);
    await writeJSON(path.join(output,'generation-evidence.json'),{electricalHash:frozen.hash,layout:accepted.layout,source:'host-controlled-compiler',planOrigin:s.planOrigin,provider:s.plan.provider,model:s.plan.model});
    if(s.id===7){
      if(p.engineeringReviews?.length)await writeJSON(path.join(project,'engineering-review-history.json'),{projectId:p.id,exportedAt:new Date().toISOString(),reviews:p.engineeringReviews,scope:'工程师评审记录快照；不替代工程签核。'});
      if(p.pcbEnabled){const pcb=p.stages[5];if(!pcb.confirmed||!pcb.result?.drc?.passed)throw new Error('PCB必须通过DRC并经工程师确认。');await fs.cp(path.join(pcb.output,'project'),path.join(project,'PCB'),{recursive:true,errorOnExist:true,force:false});s.result.checks.push({name:'PCB布局布线与DRC',status:'passed',detail:`${pcb.result.drc.errors}错误 / ${pcb.result.drc.unconnected}未连接；已人工确认`});}

      s.result.files=(await tree(project)).map(f=>({...f,path:'project/'+f.path,format:path.extname(f.path).slice(1)}));await writeJSON(path.join(output,'result.json'),s.result);
      const req=path.join(output,'archive-request.json');await writeJSON(req,{output,stage:s.id,dependencies:Object.fromEntries(p.stages.filter(x=>x.id<s.id&&x.output&&x.status==='done').map(x=>[x.id,x.output]))});
      const script=fileURLToPath(new URL('../python/archive.py',import.meta.url));
      await flow.runProcess([script,req],output,signal);s.result.archive='frozen-evidence.zip';await writeJSON(path.join(output,'result.json'),s.result);
    }
    s.status='done';s.files=await tree(output);s.outputHash=hash(s.files);s.executedPlan=structuredClone(s.plan);s.finishedAt=new Date().toISOString();delete s.invalidation;
    if(s.id!==7||!p.pcbEnabled)p.lastValidLayout={project,files:await tree(project),electricalHash:frozen.hash,layout:accepted.layout,paperSelection:accepted.paperSelection||result.paperSelection};
    flow.recordEvent(p,s.id,'完成','受控排版及独立核验完成',{output,electricalHash:frozen.hash});await flow.save(p);return flow.open(p.id);
  }catch(e){
    s.status=signal?.aborted?'cancelled':'failed';s.error=e.message;s.finishedAt=new Date().toISOString();p.lastValidLayout=oldValid;
    await flow.save(p);throw e;
  }
}
