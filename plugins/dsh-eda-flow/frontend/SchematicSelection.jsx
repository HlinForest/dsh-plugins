import React,{useEffect,useState,useRef} from 'react';
import {Btn,Field,Notice} from './ui.jsx';
import {assetURL} from './api.js';
export function SchematicSelection({project,source,picture,onAction,go,busy}){
 const editor=useRef(null),previousCount=useRef(0);
 const [map,M]=useState(null),[selected,S]=useState([]),[text,T]=useState(''),[target,G]=useState('3'),[error,E]=useState(''),[pending,P]=useState(false),[retry,R]=useState(0),[zoom,Z]=useState(1),[saved,V]=useState(null);
 useEffect(()=>{
  const controller=new AbortController();M(null);S([]);E('');V(null);
  fetch('/api/eda-flow/schematic-targets?'+new URLSearchParams({projectId:project.id,stage:source.id,path:picture}),{signal:controller.signal,cache:'no-store'})
   .then(async response=>{const data=await response.json();if(!response.ok||!data.ok)throw Error(data.error||'无法读取器件位置');return data.value;})
   .then(M).catch(e=>{if(e.name!=='AbortError')E(e.message)});
  return ()=>controller.abort();
 },[project.id,source.id,source.outputHash,picture,retry]);
 useEffect(()=>{if(selected.length>0&&previousCount.current===0){const frame=requestAnimationFrame(()=>{editor.current?.scrollIntoView({block:'nearest'});editor.current?.querySelector('textarea')?.focus({preventScroll:true});});previousCount.current=selected.length;return()=>cancelAnimationFrame(frame);}previousCount.current=selected.length;},[selected.length]);
 const toggle=ref=>{if(busy||pending||project.dirty||saved)return;S(items=>items.includes(ref)?items.filter(x=>x!==ref):[...items,ref]);};
 const refs=[...new Set(map?.targets.map(t=>t.ref)||[])];
 const chosen=map?.targets.filter(t=>selected.includes(t.ref))||[];
 const locked=busy||pending||project.dirty||Boolean(saved);
 const submit=async execute=>{
  E('');P(true);
  try{
   const result=await onAction({action:'review-add',stage:Number(target),text,reviewer:'',expectedRevision:project.revision,selection:{sourceStage:map.sourceStage,sourceOutputHash:map.sourceOutputHash,imagePath:map.imagePath,refs:selected}});
   const review=result.engineeringReviews.at(-1);V(review.id);
   if(execute){const applied=await onAction({action:'review-apply',reviewId:review.id,expectedRevision:result.revision});await onAction({action:'execute',stage:Number(target),expectedRevision:applied.revision});go(Number(target));}
  }catch(e){E(e.message)}finally{P(false)}
 };
 return <section className="schematic-selection" aria-label="点选器件并提出修改">
  <div className="drawing-select-tools"><p>点击图中器件或位号，填写你希望怎样修改。</p><div className="buttons">{selected.length>0&&<Btn onClick={()=>editor.current?.scrollIntoView({block:'nearest'})}>修改已选 {selected.length} 个器件</Btn>}<Btn aria-label="缩小原理图" disabled={zoom<=1} onClick={()=>Z(n=>Math.max(1,n-.5))}>−</Btn><span>{Math.round(zoom*100)}%</span><Btn aria-label="放大原理图" disabled={zoom>=3} onClick={()=>Z(n=>Math.min(3,n+.5))}>＋</Btn></div></div>
  {!map&&!error&&<p role="status">正在读取本张图纸的器件…</p>}
  <div className="schematic-select-scroll"><div className="schematic-select-canvas" style={{width:zoom*100+'%'}}>
   <img src={assetURL(project.id,source.id,picture)} alt="点选器件以填写修改要求的原理图"/>
   {map&&<svg viewBox={map.viewBox.join(' ')} preserveAspectRatio="none" aria-label="图纸器件选择层">{map.targets.flatMap(t=>t.regions.map((b,i)=><rect key={t.id+':'+i} x={b[0]} y={b[1]} width={b[2]-b[0]} height={b[3]-b[1]} className={selected.includes(t.ref)?'selected':''} role="button" tabIndex={i===0?0:-1} aria-label={t.ref+'，当前 '+t.value} aria-pressed={selected.includes(t.ref)} aria-disabled={locked} onClick={()=>toggle(t.ref)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();toggle(t.ref)}}}><title>{t.ref} · {t.value}</title></rect>))}</svg>}
  </div></div>
  {error&&<Notice tone="error"><p role="alert">{error}</p>{!saved&&<Btn onClick={()=>R(n=>n+1)}>重新读取器件</Btn>}</Notice>}
  {map&&<details className="schematic-select-list"><summary>按位号选择 · {refs.length} 个器件</summary><div>{refs.map(ref=><label key={ref}><input type="checkbox" disabled={locked} checked={selected.includes(ref)} onChange={()=>toggle(ref)}/>{ref} · {map.targets.find(t=>t.ref===ref).value}</label>)}</div></details>}
  {selected.length>0&&<div ref={editor} className="schematic-selection-editor">
   <div className="section-heading small"><h3>修改 {selected.join('、')}</h3><span className="muted">图纸版本 {source.outputHash?.slice(0,8)}</span></div>
   <p>{[...new Set(chosen.map(t=>t.ref+'：'+t.value))].join('；')}</p>
   <label className="field"><span>修改范围</span><select aria-label="器件修改范围" value={target} disabled={locked} onChange={e=>G(e.target.value)}><option value="3">参数、型号或接法</option><option value="4">图纸位置或导线形状</option></select></label>
   <Field label="希望怎样修改" area disabled={locked} value={text} onChange={T} placeholder="例如：将所选电阻改为 10 kΩ，并核对接收端要求；其余器件保持。也可以写工作条件，让模型根据规格书重新推导。"/>
   <p className="page-help">{target==='3'?'先生成器件方案；确认后更新原理图、BOM 与 PCB。参数缺少依据时保留待确认项。':'重新排版当前原理图，保持已确认的器件参数和接法。'} 所选位置只用于识别器件，不会固定后续布局。</p>
   {project.dirty&&<Notice>请先保存当前页面的输入，再提交修改。</Notice>}
   {saved?<Notice>评审意见已记录。<Btn onClick={()=>go('reviews')}>查看评审与执行记录</Btn></Notice>:<div className="buttons"><Btn disabled={locked||!text.trim()} onClick={()=>submit(false)}>只保存意见</Btn><Btn primary disabled={locked||!text.trim()} onClick={()=>submit(true)}>{pending?'正在提交…':'按要求生成修改'}</Btn></div>}
  </div>}
 </section>;
}
