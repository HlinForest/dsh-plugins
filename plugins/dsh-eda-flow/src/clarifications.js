import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {writeJSON} from './io.js';
import {pendingIssues, reviewRecord, resolvedAnswers} from './review-items.js';

export const clarificationInstructions = `你正在核对工程师对单个待确认项的回答，不进行电路生成。根据全部需求、资料、当前结果及已解决的回答判断是否充分、有冲突。
仅返回 {"action":"finish","summary":"简洁具体的反馈","gaps":[],"assumptions":[],"resolution":{"status":"resolved或needs-input","regenerateFrom":null或1到7的步骤号}}。
resolved只代表此项输入已解决，不代表ERC、BOM或实物检查通过。需要新资料、实际工具检查或图纸审阅的事项不能仅因用户说已通过就解决；说明还缺什么。明确的人工作业范围/参数选择可以采纳。不要反复提出资料已经明确或已回答的问题。
若回答改变生成结果所依赖的需求、参数、连接、封装或布局，regenerateFrom必须是最早受影响的步骤；电气/器件改变不得晚于3，布局改变为4，BOM标注改变为5，PCB布局或布线要求改变为6。仅补充不改变结果的说明可为null。未解决则为null。禁止调用工具、改写CAD或替用户确认图纸。`;

export function validateResolution(result) {
  const r=result?.resolution;
  if(result?.action!=='finish'||!result.summary?.trim()||!r||!['resolved','needs-input'].includes(r.status)) return '需要 finish、summary 和 resolution.status。';
  if(r.regenerateFrom!==null&&(!Number.isInteger(r.regenerateFrom)||![1,2,3,4,5,6,7].includes(r.regenerateFrom))) return 'regenerateFrom应为null或1至7。';
  if(r.status==='needs-input'&&r.regenerateFrom!==null) return '待补答案不能作为修改设计的依据。';
  return null;
}

export async function answerIssue(flow,a) {
  flow.guard(a.projectId);
  const p=await flow.load(a.projectId), s=flow.stage(p,a.stage);
  if(p.mode!=='text-mcp') throw new Error('历史转换工程请使用原补充入口。');
  const question=String(a.question||'').trim(), answer=String(a.answer||'').trim();
  if(!question||!answer||answer.length>32000) throw new Error('请输入本项回答（最多32000字）。');
  const previous=reviewRecord(p,question);
  if(!pendingIssues(p,s).includes(question)&&!(previous?.stage===s.id&&previous.question===question)) throw new Error('该待确认项已变化，请刷新后重试。');
  p.clarifications ||= [];
  const entry={id:previous?.id||randomUUID(),question,answer,stage:s.id,status:'reviewing',feedback:'正在核对回答…',contextRevision:p.clarificationRevision||0,at:new Date().toISOString(),history:[...(previous?.history||[]),...(previous?[{answer:previous.answer,status:previous.status,feedback:previous.feedback,at:previous.at}]:[])]};
  p.clarifications=p.clarifications.filter(x=>x.id!==entry.id);p.clarifications.push(entry);
  const controller=new AbortController(), task={controller,type:'clarification',stage:s.id,startedAt:entry.at};
  flow.jobs.set(p.id,task);
  try { await flow.save(p); } catch(e) {flow.jobs.delete(p.id);throw e;}
  flow.phase(p.id,'model','正在核对本项回答');
  task.promise=(async()=>{
    const records=[], folder=path.join(flow.dir(p.id),'clarifications',randomUUID());
    const record=async value=>{flow.modelProgress(p.id,value);if(value.event==='stream-progress')return;if(value.event==='request')p.modelRequests++;records.push(value);await writeJSON(path.join(folder,'model-log.json'),records);};
    try {
      if(!flow.config.allowModelCalls||!flow.ai?.generateText) throw new Error('回答已保存，请选择 Harness 模型后重试核对。');
      let result=await flow.ai.generateText({project:{mode:p.mode,designMode:p.designMode},stage:{id:s.id,title:s.title},request:{clarification:true,inputs:p.inputs,resolvedAnswers:resolvedAnswers(p),question,answer,result:s.result},record,validateFinish:validateResolution},controller.signal);
      if(controller.signal.aborted) throw new Error('核对已取消，回答已保存。');
      if(result.action==='question'&&Array.isArray(result.questions)&&result.questions.length)result={...result,action:'finish',summary:result.questions.join('；'),resolution:{status:'needs-input',regenerateFrom:null}};
      const invalid=validateResolution(result);if(invalid)throw new Error(invalid);
      entry.status=result.resolution.status;entry.feedback=result.summary;
      entry.provider=result.provider;entry.model=result.model;
      entry.regenerateFrom=result.resolution.regenerateFrom;
      if(entry.status==='resolved'&&previous?.status==='resolved'&&previous.answer!==answer&&entry.regenerateFrom===null)entry.regenerateFrom=Math.min(s.id,3);
      if(entry.status==='resolved'&&entry.regenerateFrom!==null) {
        flow.invalidate(p,entry.regenerateFrom,{kind:'clarification',from:entry.regenerateFrom,message:`回答已采纳：${question}。请从第${entry.regenerateFrom}步更新结果。`});
      }
      flow.recordEvent(p,s.id,'逐项核对',entry.status==='resolved'?'本项已解决':'本项仍需补充',{question,answer,feedback:entry.feedback,regenerateFrom:entry.regenerateFrom});
    } catch(e) {
      entry.status='error';entry.feedback=e.message;flow.recordEvent(p,s.id,'逐项核对','回答已保存，核对未完成',{question,error:e.message});
    }
    p.revision++;await flow.save(p);
  })().finally(()=>flow.jobs.delete(p.id));
  // The background job owns failures; expose them through the saved record.
  task.promise.catch(()=>{});
  return {started:true,projectId:p.id};
}
