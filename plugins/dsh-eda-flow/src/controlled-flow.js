import { requestMetrics } from './input-metrics.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { hash,readJSON,writeJSON,tree,sameFiles } from './io.js';
import { checkFreeze,layoutTools,genericLayoutTools,validateLayoutArgs,runLayoutPython } from './controlled-layout.js';
import { hasSimulatedInputs, isMockDemo } from './mock-datasheets.js';

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
    return {...candidate,audit:result};
  };
  try{
    await writeJSON(path.join(output,'input-provenance.json'),{simulated:hasSimulatedInputs(p),scope:isMockDemo(p)?'PDF extraction only; controlled CAD and checks are real':'Natural language and extracted PDF pages',inputs:p.inputs,electricalHash:frozen.hash});
    if(s.id>4){
      if(!oldValid)throw new Error('尚无已通过的受控原理图。');
      if(!sameFiles(oldValid.files,await tree(oldValid.project))||oldValid.electricalHash!==frozen.hash)throw new Error('上游原理图已变化。');
      const project=path.join(output,'project');await fs.cp(oldValid.project,project,{recursive:true,errorOnExist:true,force:false});
      accepted={project,layout:oldValid.layout,audit:await readJSON(path.join(project,'audit.json'))};
    }
    const invoke=async(name,args)=>{
      try{
        await checkFreeze(flow,p);let result;
        if(!tools.some(t=>t.name===name)||s.id>4&&name==='layout_generate')throw new Error('本阶段禁止该工具。');
        if(name!=='layout_generate'&&(!args||Array.isArray(args)||Object.keys(args).length))throw new Error('只读工具不接受参数。');
        if(name==='layout_inspect')result={electricalHash:frozen.hash,design:frozen.design,template:frozen.template,current:accepted?.audit||null,scope:frozen.engine==='native-kicad'?'Single-sheet native symbols; original connectivity; no PCB':'Fixed display-board regression; no PCB'};
        if(name==='layout_generate'){
          validateLayoutArgs(args,frozen.engine);
          const candidate=path.join(output,'candidates',randomUUID()),project=path.join(candidate,'project');
          const audit=await runLayoutPython(flow,{operation:'generate',engine:frozen.engine,layout:args,library:frozen.library,design:frozen.designFile,output:project,gap:args.gapMm},candidate,signal);
          if(audit.status!=='passed')throw new Error('候选未通过，保留上次成功结果：'+audit.errors.slice(0,12).join('; '));
          accepted={project,layout:args,audit};verified=false;result={...audit,electricalHash:frozen.hash,candidateId:path.basename(candidate)};
        }
        if(name==='layout_verify'){
          if(!accepted)throw new Error('先生成原理图。');accepted=await verifyCandidate(accepted);verified=true;result={...accepted.audit,electricalHash:frozen.hash};
        }
        calls.push({name,arguments:args,result,ok:true});await writeJSON(path.join(output,'tool-log.json'),calls);return result;
      }catch(e){calls.push({name,arguments:args,error:e.message,ok:false});await writeJSON(path.join(output,'tool-log.json'),calls);throw e;}
    };
    s.plan=await flow.ai.generateText({project:{mode:p.mode,designMode:p.designMode,controlledLayout:true,layoutEngine:frozen.engine,label:p.label},stage:{id:s.id,title:s.title},
      request:{inputs:p.inputs,scope:'controlled-schematic',instruction:s.id===4?`先inspect，再以${frozen.template}、合适纸张和间距生成，verify后完成。首轮省略groups和rotations，由宿主按器件功能、连接和真实引脚方向自动推导紧凑分区。不要自行拆开主控、限流电阻及输入/供电滤波；输入未规定精确旋转时不覆盖自动朝向。`:'只读核验本轮已生成原理图。',electricalHash:frozen.hash},
      tools:tools.filter(t=>s.id===4||t.name!=='layout_generate'),invoke,record,
      validateFinish:()=>accepted&&verified?null:'必须实际生成并调用 layout_verify，通过后才可完成。'},signal);
    if(s.plan.action==='question')throw new Error('模型需要补充：'+s.plan.questions.join('; '));
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
    s.gaps=[...(s.plan.gaps||[]),...(frozen.design.unresolved||[]),...(result.erc.warnings?[`ERC：0 个错误、${result.erc.warnings} 个警告，详见实际报告，需人工审阅。`]:[]),'采购信息、器件额定值及实物功能需工程师复核；PCB未执行。'];s.assumptions=s.plan.assumptions||[];
    s.result={summary:s.plan.summary,gaps:s.gaps,assumptions:s.assumptions,origin:'text-mcp',components,
      schematicPdf:relative(path.join(project,pdf.path)),previews:svg?[relative(path.join(project,svg.path))]:[],bom:'project/bom.csv',
      erc:{by_severity:{error:result.erc.errors,warning:result.erc.warnings},violation_count:result.erc.errors+result.erc.warnings},
      electricalHash:frozen.hash,checks:[{name:'冻结符号 / 连接 / NC / 图面',status:'passed',detail:`${result.symbols}对象、${result.pins}引脚、${result.nets}网络；文字重叠及穿线均为0。`,source:'tool'},{name:'模型实际调用',status:s.planOrigin==='live-ai'?'passed':'test-double',detail:`${s.plan.provider} / ${s.plan.model}；本步${calls.length}次工具调用。`,source:'model'},{name:'生产与PCB',status:'not-run',detail:'仅原理图草稿，保留待确认项。',source:'scope'}],
      files:files.map(f=>({...f,path:'project/'+f.path,format:path.extname(f.path).slice(1)}))};
    await writeJSON(path.join(output,'ai-output.json'),s.plan);await writeJSON(path.join(output,'result.json'),s.result);
    await writeJSON(path.join(output,'generation-evidence.json'),{electricalHash:frozen.hash,layout:accepted.layout,source:'host-controlled-compiler',planOrigin:s.planOrigin,provider:s.plan.provider,model:s.plan.model});
    if(s.id===7){
      const req=path.join(output,'archive-request.json');await writeJSON(req,{output,stage:s.id,dependencies:Object.fromEntries(p.stages.filter(x=>x.id<s.id&&x.output&&x.status==='done').map(x=>[x.id,x.output]))});
      const script=fileURLToPath(new URL('../python/archive.py',import.meta.url));
      await flow.runProcess([script,req],output,signal);s.result.archive='frozen-evidence.zip';await writeJSON(path.join(output,'result.json'),s.result);
    }
    s.status='done';s.files=await tree(output);s.outputHash=hash(s.files);s.executedPlan=structuredClone(s.plan);s.finishedAt=new Date().toISOString();delete s.invalidation;
    p.lastValidLayout={project,files:await tree(project),electricalHash:frozen.hash,layout:accepted.layout};
    flow.recordEvent(p,s.id,'完成','受控排版及独立核验完成',{output,electricalHash:frozen.hash});await flow.save(p);return flow.open(p.id);
  }catch(e){
    s.status=signal?.aborted?'cancelled':'failed';s.error=e.message;s.finishedAt=new Date().toISOString();p.lastValidLayout=oldValid;
    await flow.save(p);throw e;
  }
}
