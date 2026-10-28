import {parameterChanges} from './reviewDiff.js';
import React,{useState} from 'react';
import {Btn,Field,Notice,Badge,Empty} from './ui.jsx';
const names={3:'器件、参数与接法',4:'原理图排版',6:'PCB布局布线'};
const statuses={recorded:'已记录，尚未采用',applied:'已采用，待执行',running:'修改执行中',generated:'已生成，待工程师复核',resolved:'工程师确认已解决','needs-revision':'仍需修改',failed:'修改失败',cancelled:'修改已取消',interrupted:'修改已中断','waiting-input':'需补充依据'};
const snapshotLabel=s=>s?.output?.split(/[\\/]/).at(-1)?.slice(0,8)||'未生成';
const asset=(p,r,snapshot,side,attempt)=>{
 const file=snapshot?.files?.find(f=>f.path==='project/PCB-Back.pdf')||snapshot?.files?.find(f=>f.path.endsWith('.pdf'))||snapshot?.files?.find(f=>f.path.endsWith('.svg'));
 return file?'/api/eda-flow/review-asset?'+new URLSearchParams({projectId:p.id,reviewId:r.id,side,path:file.path,...(attempt?{attemptId:attempt.id}:{})}):null;
};
function Result({value}){
 if(!value)return <p>尚无修改结果。</p>;
 if(value.routingQuality&&!Number.isFinite(value.routingQuality.trackLengthMm))value={...value,routingQuality:null};
 return <><p>版本 {snapshotLabel(value)} · {value.summary}</p>{value.drc&&<p>DRC：{value.drc.errors} 错误 / {value.drc.unconnected} 未连接</p>}{value.routingQuality&&<p>走线总长：{value.routingQuality.trackLengthMm.toFixed(2)} mm；小于0.5 mm的线段：{value.routingQuality.shortSegmentsUnder05mm}；拐点：{value.routingQuality.degree2Bends}。线长只计走线段，不计铜区；仍需结合图面复核。</p>}{value.copperRouteCleanup?.removedSegments>0&&<p>去除同网铜区或焊盘完整覆盖的重复走线：{value.copperRouteCleanup.removedLengthMm.toFixed(2)} mm；已按实际铜形状核对覆盖范围，并需通过最终连通检查。</p>}{value.powerPlacement?.relations?.map(r=><p key={r.ref}>{r.ref} → {r.anchor.ref}.{r.anchor.pad}：{r.distanceMm.toFixed(3)} mm</p>)}</>;
}
function Review({p,r,busy,act,go}){
 const [note,N]=useState(''),latest=r.attempts.at(-1),changes=parameterChanges(r.before,latest?.after);
 const before=asset(p,r,r.before,'before'),after=asset(p,r,latest?.after,'after',latest);
 const fresh=latest?.after?.outputHash&&latest.after.outputHash===p.stages.find(s=>s.id===r.stage)?.outputHash&&p.stages.find(s=>s.id===r.stage)?.status==='done';
 return <article className="engineer-review-item"><div className="section-heading small"><strong>{names[r.stage]}</strong><Badge>{statuses[r.status]||r.status}</Badge></div>
 <small>{r.reviewer} · {new Date(r.createdAt).toLocaleString('zh-CN')} · 版本 {snapshotLabel(r.before)}</small><p className="review-original">{r.text}</p>
 <div className="buttons">{before&&<a href={before} target="_blank" rel="noreferrer">修改前图纸</a>}{after&&<a href={after} target="_blank" rel="noreferrer">本次修改后图纸</a>}
 {r.status==='recorded'&&<Btn disabled={busy} onClick={()=>act({action:'review-apply',reviewId:r.id})}>采用意见，准备修改</Btn>}
 {['applied','failed','cancelled','interrupted','waiting-input'].includes(r.status)&&<><Btn disabled={busy} onClick={()=>go(r.stage)}>查看修改输入</Btn><Btn disabled={busy} onClick={()=>act({action:'execute',stage:r.stage})}>按评审重新生成</Btn></>}</div>
 {changes&&<div className="review-parameter-diff"><strong>器件方案参数差异</strong>{changes.length?<table><thead><tr><th>器件</th><th>项目</th><th>修改前</th><th>修改后</th></tr></thead><tbody>{changes.map((c,i)=><tr key={i}><td>{c.ref}</td><td>{c.field}</td><td>{c.before||'未指定'}</td><td>{c.after||'未指定'}</td></tr>)}</tbody></table>:<p>本次器件参数未变化，请核对意见是否已落实。</p>}{r.stage===3&&<p className="page-help">确认器件方案后，需要重新生成原理图、BOM 和 PCB。</p>}</div>}
 {latest&&<details><summary>修改前后结果与执行记录 · {r.attempts.length} 次</summary><div className="field-grid"><div><strong>评审针对的版本</strong><Result value={r.before}/></div><div><strong>最新修改结果</strong><Result value={latest.after}/></div></div><p>生成检查用于辅助复核；是否解决这条意见由工程师判断。</p>{r.attempts.map(a=><details key={a.id}><summary>{new Date(a.startedAt).toLocaleString('zh-CN')} · {statuses[a.status]||a.status}</summary><p>{a.error||'执行记录已保存。'}</p><pre>{JSON.stringify(a,null,2)}</pre></details>)}</details>}
 {r.status==='generated'&&fresh&&<><Field label="复核说明" area value={note} onChange={N} placeholder="说明实际改善了什么，或还需要怎样调整"/><div className="buttons"><Btn disabled={busy} onClick={()=>act({action:'review-decide',reviewId:r.id,decision:'resolved',note})}>确认这条意见已解决</Btn><Btn disabled={busy||!note.trim()} onClick={()=>act({action:'review-decide',reviewId:r.id,decision:'needs-revision',note})}>仍需修改，追加意见</Btn></div></>}
 {r.status==='generated'&&!fresh&&<p>当前工程已更新，请针对当前版本追加评审；这份修改记录保留。</p>}
 {r.decisions.map((d,i)=><p key={i}>{new Date(d.at).toLocaleString('zh-CN')} · {d.reviewer} · {statuses[d.status]}：{d.note||'已人工复核'}</p>)}</article>;
}
export function EngineeringReviews({p,stage=6,busy,onAction,go,download}){
 const [target,T]=useState(names[stage]?String(stage):'6'),[text,X]=useState(''),[reviewer,R]=useState(''),[error,E]=useState(''),[pending,P]=useState(false);
 const locked=busy||p.dirty||pending;
 const act=async args=>{E('');P(true);try{const result=await onAction({...args,expectedRevision:p.revision});if(args.action==='review-add')X('');return result;}catch(e){E(e.message);}finally{P(false)}};
 const ready=p.stages.find(s=>s.id===Number(target))?.status==='done';
 return <section aria-label="工程师文字评审"><div className="section-heading small"><h3>工程师文字评审</h3><Btn onClick={()=>download(`${p.name}-工程师评审记录.json`,JSON.stringify({project:p.name,exportedAt:new Date().toISOString(),reviews:p.engineeringReviews||[]},null,2))}>导出评审记录</Btn></div>
 <p className="page-help">写明问题、希望达到的效果和需要保留的部分。保存意见不会改图；采用后执行对应步骤，新结果仍需工程师复核。原图、意见、每次执行及复核结论都保留。</p>
 {p.dirty&&<Notice>当前表单还有未保存内容，请先保存，再填写或采用评审。</Notice>}
 <div className="field-grid"><label className="field"><span>修改步骤</span><select aria-label="修改步骤" value={target} onChange={e=>T(e.target.value)}>{Object.entries(names).map(([n,label])=><option key={n} value={n}>{label}</option>)}</select></label><Field label="评审人（可选）" value={reviewer} onChange={R}/></div>
 <Field label="工程师评审意见" area value={text} onChange={X} placeholder="例如：去耦电容还应靠近芯片供电脚，保持已确认的接法和器件值；请说明修改后实际距离。"/>
 {!ready&&<p>所选步骤尚无当前有效结果，请先生成或切换步骤。</p>}{error&&<p role="alert" className="form-error">{error}</p>}
 <Btn disabled={locked||!ready||!text.trim()} onClick={()=>act({action:'review-add',stage:Number(target),text,reviewer})}>保存评审意见</Btn>
 {(p.engineeringReviews||[]).length?[...(p.engineeringReviews||[])].reverse().map(r=><Review key={r.id} p={p} r={r} busy={locked} act={act} go={go}/>):<p className="page-help">暂无工程师评审记录。</p>}</section>;
}
