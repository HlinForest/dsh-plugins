import React,{useState} from 'react';
import {pendingIssues,reviewRecord,isResolved,issueKey} from '../src/review-items.js';

function ReviewItem({project,question,stage,onAnswer,busy}) {
  const saved=reviewRecord(project,question),[draft,D]=useState(null),[error,E]=useState(''),[sending,S]=useState(false);
  const answer=draft??saved?.answer??'';
  const resolved=isResolved(project,question);
  const feedback=saved?.contextRevision!==(project.clarificationRevision||0)&&saved ? '输入资料已变化，请重新核对此项。' : saved?.feedback;
  const send=async()=>{S(true);E('');try{await onAnswer(question,answer,stage);D(null)}catch(e){E(e.message)}finally{S(false)}};
  return <li className="inline-review-item"><p>{question}</p>
    <label><span className="sr-only">回答：{question}</span><textarea value={answer} onChange={e=>D(e.target.value)} placeholder="直接填写答案或补充依据" disabled={busy||sending}/></label>
    {feedback&&<p className="review-feedback" role="status">{resolved?'已解决 · ':''}{feedback}</p>}
    {error&&<p role="alert">{error}</p>}
    <button disabled={busy||sending||!answer.trim()||(resolved&&answer===saved?.answer)} onClick={send}>{sending||saved?.status==='reviewing'&&busy?'正在核对…':saved?.status==='error'?'重试核对':'提交并核对'}</button>
  </li>;
}
export function InlineReview({project,stage,onAnswer,onResume,busy,all=false}) {
  const stages=all?project.stages:project.stages.filter(s=>s.id===stage);
  const rows=[...new Map(stages.flatMap(s=>pendingIssues(project,s).map(question=>[issueKey(question),{question,stage:s.id}]))).values()];
  const done=(project.clarifications||[]).filter(r=>(all||r.stage===stage)&&isResolved(project,r.question));
  if(!rows.length&&!done.length)return null;
  const affected=done.filter(r=>r.regenerateFrom&&project.stages.some(s=>s.id>=r.regenerateFrom&&s.status==='stale'));
  const from=affected.length?Math.min(...affected.map(r=>r.regenerateFrom)):null;
  return <section className="inline-review" aria-label="待确认项即时反馈">
    {done.length>0&&<p className="review-feedback" role="status">已解决：{done.at(-1).question} — {done.at(-1).feedback}</p>}
    {rows.length>0&&<details open><summary>待确认项 · {rows.length}</summary><ul>{rows.map(r=><ReviewItem key={issueKey(r.question)} project={project} {...r} busy={busy} onAnswer={onAnswer}/>)}</ul></details>}
    {done.length>0&&<details><summary>已解决 · {done.length}</summary><ul>{done.map(r=><ReviewItem key={r.id} project={project} question={r.question} stage={r.stage} busy={busy} onAnswer={onAnswer}/>)}</ul></details>}
    {from&&<div className="review-impact" role="status">需要更新：{project.stages.filter(s=>s.id>=from&&(s.id!==6||project.pcbEnabled)).map(s=>s.title).join('、')}。<button disabled={busy} onClick={()=>onResume(from)}>{from===1?'更新任务与约束':'重新生成'}</button></div>}
    {!rows.length&&!from&&project.stages.find(s=>s.id===stage)?.status==='waiting-input'&&<button disabled={busy} onClick={()=>onResume(stage)}>继续处理</button>}
  </section>;
}
