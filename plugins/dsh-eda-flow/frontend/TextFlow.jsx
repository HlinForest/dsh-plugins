import {SchematicSelection} from './SchematicSelection.jsx';
import React, { useState } from 'react';
import { Download, Document, Add, ChevronRight } from '@carbon/icons-react';
import { Badge, Btn, Empty, Field, Notice, Table } from './ui.jsx';
import { assetURL, attachmentURL } from './api.js';
import { checkRows, checkStatus, textInputRecord } from './textFlow.js';
import {OperatingPoints} from './OperatingPoints.jsx';

const HELP = {
  1: ['核对完整任务书中的功能、器件、连接和装配要求。', '保存输入后人工确认并继续；本步不请求模型。'],
  2: ['模型以任务书和已粘贴规格书建立设计依据。', '整理输入后核对来源和缺项，再确认继续。'],
  3: ['核对准确型号、引脚功能、电气类型及封装标识。', '在规格书页粘贴带来源和页码的正文，再读取并核对。'],
  4: ['根据已确认的电路与真实库资源生成原理图。', '生成后查看实际图纸和 ERC；需要补充时先保存回答，再重新执行。'],
  5: ['从本次生成原理图导出物料和引脚映射。', '核对参数、物料标识和装配状态；PCB 封装几何留到下一阶段。'],
  6: ['填写板框、层数、接口位置和制造要求。', '生成可编辑PCB，自动布局布线，运行DRC后确认。'],
  7: ['检查本次原理图、BOM、工程依赖和真实 ERC。', '运行核验后复核结果并确认交付；模型执行记录与工程检查结果分别查看。'],
};

export function TextInputGuide({ project, stage, onFiles, onLocate }) {
  const inputs = project.inputs || {};
  const sources=[...(inputs.evidence||[]),...(project.stages?.find(s=>s.id===2&&s.status==='done')?.result?.evidenceFacts||[])];
  const visibleEvidence=sources.filter(r=>(r.stages?.includes(stage)||(stage===1&&r.sourceType==='pdf-text-extraction'))&&(r.sourceType!=='pdf-text-extraction'||!(project.inputs?.evidence||[]).some(s=>s.document===r.document&&s.sourceType==='pdf-specification-appendix')));
  const evidenceGroups=Object.groupBy(visibleEvidence,r=>r.objectRole?'器件规格与装配':r.symbolId?'器件外形与引脚':'功能、接口与图纸规范');

  if (['datasheet-demo','new-design'].includes(project.designMode)) return <details className="input-guide" aria-label="本步输入来源"><summary>输入与资料</summary>
    {(project.uploads||[]).filter(f=>f.extraction).map(f=><p key={f.id}><a href={attachmentURL(project.id,f.id)}><Download size={16}/> 查看已上传规格资料：{f.name}</a></p>)}
    {!(project.uploads||[]).length && <p className="page-help">规格书 PDF：待上传。上传后将按页读取并显示来源。</p>}
    <details><summary>当前文字输入</summary><p>{project.fields?.requirements || inputs.requirements || '尚未填写任务书。'}</p><p>{project.notes?.[stage] || inputs.stageNotes?.[stage] || '本步暂无补充文字。'}</p></details>
    {Object.keys(evidenceGroups).length > 0 ? <details><summary>已读取的资料</summary>{Object.entries(evidenceGroups).map(([title,rows])=><details key={title}><summary>{title} · {rows.length} 条</summary>{rows.map(r=><details key={r.id}><summary>{r.binding} · {r.section || `第${r.page}页`}{r.pageIsPlaceholder?'（页码待核对）':''}</summary><p>{r.content||'本页没有可提取文字，请补充该页内容。'}</p><small>{r.document}</small></details>)}</details>)}</details> : <p className="page-help">上传 PDF 后，在第三步绑定型号或位号，并在页面中核对来源页码。</p>}
    <div className="input-guide-actions"><button className="text-link" onClick={onFiles}>查看完整文字输入与资料来源</button><Btn onClick={() => onLocate?.({ stage, tab: 0, field: 'stageNotes' })}>补充本步自然语言要求</Btn></div>
  </details>;


  return <details className="input-guide" aria-label="本步输入来源"><summary>输入与资料</summary>
    <strong>{project.controlledLayout?'冻结电路与受控排版':project.designMode==='fixed-redesign'?'固定原器件 · 重新布局连线':project.designMode==='new-design'?'从零设计 · 功能需求':project.template ? '原图复原 · 显示板任务书' : '工程师文字输入'}</strong>
    {project.controlledLayout&&<p>第三步确认后锁定符号、器件、网络和 NC；第四步只调整排版。从零设计使用真实库符号与 A4/A3 单页排版；固定显示板保留专用模板。复杂符号能力在选型时检查。</p>}{!project.controlledLayout&&project.designMode==='fixed-redesign'&&<p>已固定41个原对象的符号、引脚几何和物料属性；模型自行安排页面及连线，文字位置可以调整。器件资料通过库查询读取。</p>}
    <p>{project.controlledLayout ? ({3:'核对下方完整连接与NC清单；确认后冻结。更改连接必须返回本步。',4:'可补充纸张、功能分组和间距；符号和连接不可在本步修改。排版失败时保留上次成功文件。'}[stage]||'使用已冻结真实符号生成并核验原理图。') : project.designMode==='fixed-redesign' ? '使用短需求与冻结器件库；按功能分组自动布局连线，核对功能、BOM、封装标识、原符号和图面可读性。' : project.designMode==='new-design' ? ({1:'描述功能、供电、接口和约束即可，无需填写坐标与逐针连线。',2:'模型整理功能方案与需求覆盖，关键缺项会在这里追问。',3:'模型查询本机器件库并形成设计清单，确认后供原理图和BOM共用。',4:'按已确认设计清单生成，自行布局；实际网表反向核对连接意图。',5:'核对设计身份、物料、装配状态及本机库的实际焊盘编号。',7:'静态一致性通过不等于实物或生产验证；未完成项只允许草稿交付。'}[stage]||HELP[stage][0]) : HELP[stage][0]}</p><p><b>本步操作</b>{HELP[stage][1]}</p>
    <div className="input-guide-actions"><button className="text-link" onClick={onFiles}>查看完整文字输入</button><span className="muted">保存与模型执行分开</span></div>
    <div className="input-guide-actions"><Btn onClick={() => onLocate?.({ stage, tab: 0, field: 'stageNotes' })}>补充本步文字</Btn><Btn onClick={() => onLocate?.({ stage: 3, tab: 1, field: 'datasheetText' })}>补充规格书正文</Btn></div>
  </details>;
}

export function TextInputModal({ project, download, notify, onEdit, onClose, returnLabel = '返回当前步骤' }) {
  const text = textInputRecord(project);
  const copy = async () => { try { await navigator.clipboard.writeText(text); notify('完整文字输入已复制'); } catch { notify('无法访问剪贴板，可下载正文或选择下方文字复制'); } };
  return <><p className="page-help">这是当前完整输入正文。修改在第一步保存；规格书正文在第三步保存。</p>
    <div className="buttons"><Btn onClick={copy}>复制完整正文</Btn><Btn icon={Download} onClick={() => download(`${project.name}-文字输入.txt`, text, 'text/plain;charset=utf-8')}>下载文字</Btn><Btn onClick={onEdit}>编辑任务书</Btn></div>
    <pre className="text-task-preview">{text || '尚未填写文字要求。'}</pre><div className="modal-actions"><Btn primary onClick={onClose}>{returnLabel}</Btn></div></>;
}

export function ModelReply({ state, onView }) {
  const details = state.errorInfo?.details;
  if (!['format', 'truncated'].includes(state.errorInfo?.code) || typeof details?.rawResponse !== 'string') return null;
  return <div className="notice-actions"><button className="text-link" onClick={() => onView(details.rawResponse)}>查看模型原始回复</button></div>;
}

export function Questions({ state, busy, onAnswer }) {
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState('');
  if (state.status !== 'waiting-input' || !state.questions?.length) return null;
  const save = async () => { setError(''); try { await onAnswer(answer); setAnswer(''); } catch (e) { setError(e.message); } };
  return <section className="text-questions" aria-label="模型待补问题"><Notice tone="warning"><strong>需要补充文字要求</strong><ol>{state.questions.map((q, i) => <li key={i}>{q}</li>)}</ol><p>回答保存为本步文字输入；点击执行按钮后模型才继续处理。</p></Notice>
    <Field label="对待补问题的回答" area value={answer} onChange={setAnswer} placeholder="按问题逐项说明；保留准确型号、数值和来源" />
    {error && <p className="form-error" role="alert">{error}</p>}<Btn disabled={busy || !answer.trim()} onClick={save}>保存回答到本步输入</Btn></section>;
}

export function TextChecks({ state, detail, resultFiles }) {
  if (state.status !== 'done') return <Empty title="检查尚未完成">执行后查看本次文件的结构、连接和 ERC 记录。</Empty>;
  const rows = checkRows(state.result?.checks);
  return <>
    {state.result?.calculationNotes?.length>0&&<details><summary>当前电路计算</summary>{state.result.calculationNotes.map((text,i)=><p key={i}>{text}</p>)}</details>}
    {state.result?.calculationHistory?.length>0&&<details><summary>已替换的计算说明 · {state.result.calculationHistory.length} 条</summary><p>这些文字已退出当前结论；其中的资料缺项并未因此得到确认。</p>{state.result.calculationHistory.map((r,i)=><details key={i}><summary>{r.reason}</summary><p>{r.text}</p></details>)}</details>}
    {rows.length ? <Table label="实际检查结果" columns={[{ key: 'name', title: '检查', render: r => r.name || r.title || r.kind || '检查记录' }, { key: 'status', title: '结果', render: r => <Badge status={r.status}>{checkStatus(r)}</Badge> }, { key: 'summary', title: '说明', render: r => r.summary || r.detail || (r.result == null ? '查看完整记录' : String(r.result)) }]} rows={rows} onView={r => detail('实际检查记录', r)} /> : <Notice>本步未返回结构化检查摘要，可在执行记录中查看工具返回结果。</Notice>}
    <details className="execution-files"><summary>本次生成文件与执行记录</summary>{resultFiles()}</details></>;
}


export function TextFlowContent({ p, data, stage, tab, state, field, notes, ct, nets, preview, imageFile, detail, resultFiles, download, go, openUpload, onReviewAction, busy }) {
  const f = (label, key, props = {}) => <Field label={label} value={p.fields?.[key] || ''} onChange={value => field(key, value)} data-input={key} {...props} />;
  const components = data.components || [];
  const fresh = ['new-design', 'datasheet-demo'].includes(p.designMode);
  const checks = () => <TextChecks state={state} detail={detail} resultFiles={resultFiles} />;
  const stepNotes = () => notes?.();
  const uploads = p.uploads || [];
  const evidenceChars = (p.inputs?.evidence || []).reduce((total, item) => total + String(item?.content || item?.text || '').length, 0);
  const datasheetChars = String(p.fields?.datasheetText || '').length + evidenceChars;
  const uploadStatus = uploads.length
    ? uploads.map(file => `${file.name || '资料'}：${file.status || '已上传，待读取核验'}`).join('；')
    : (datasheetChars ? '文字补充（未上传 PDF）' : '待上传 PDF / DOCX 或文字补充');

  if (stage === 1) {
    const page = tab === 0
      ? <><div className="section-heading small"><h3>{fresh ? '功能需求与约束' : '完整纯文字任务书'}</h3><span className="muted">{(p.fields?.requirements || '').length.toLocaleString()} 字符</span></div>{f('完整任务书', 'requirements', { area: true, className: 'text-task-editor', placeholder: fresh ? '要实现什么功能？供电、主控接口、尺寸、成本与装配有什么限制？' : '功能、供电、器件、逐引脚连接、装配状态、页面坐标和验收要求', help: fresh ? '模型负责方案、选型、连接和布局；影响方案的缺项会追问。' : '正文直接进入模型上下文。精确连接与坐标需在这里明确给出。' })}<div className="field-grid">{f('供电要求', 'power')}{f('信号与接口', 'interfaces')}</div></>
      : tab === 1
        ? <>{f('封装与装配要求', 'mount', { area: true })}{f('原理图设计约束', 'rules', { area: true })}</>
        : <>{f('验收要求', 'acceptance', { area: true })}<div className="review-list">{['逐引脚连接与 NC', '型号、参数、封装标识与装配状态', fresh ? '功能需求覆盖与连接条件' : '页面对象坐标与文字要求', '本次工程依赖、真实 ERC 和交付记录'].map(x => <div key={x}><Document size={20} />{x}</div>)}</div></>;
    return <>{page}{stepNotes()}</>;
  }

  if (stage === 2) {
    const page = tab === 0
      ? <><div className="section-heading small"><h3>自然语言与规格资料</h3><Btn icon={Add} onClick={openUpload}>添加 PDF / DOCX 资料</Btn></div><p className="page-help">上传 PDF 按页提取、DOCX 按章节提取正文，也可直接补充文字资料。规格书不会随项目自动载入；上传后在第三步核对来源页码。</p><Table label="文字输入" columns={[{key:'name',title:'输入'},{key:'size',title:'正文长度'},{key:'source',title:'来源'}]} rows={[{id:'requirements',name:'完整任务书',size:(p.fields?.requirements || '').length + ' 字符',source:'第一步可编辑文字'},{id:'datasheet',name:'规格书正文与已读取资料',size:datasheetChars + ' 字符',source:uploadStatus}]} /></>
      : tab === 1
        ? <><h3>本次设计数据</h3>{fresh && <><p className="page-help">{state.result?.summary}</p><Table label="需求覆盖" columns={[{key:'id',title:'需求'},{key:'description',title:'功能与约束'}]} rows={state.result?.requirements || []}/><Table label="规格资料中的器件" columns={[{key:'reference',title:'位号',render:r=>r.reference || '待分配'},{key:'value',title:'型号 / 参数'},{key:'pins',title:'引脚数',render:r=>r.pins?.length ?? 0}]} rows={state.result?.evidenceFacts || []}/>
<Table label="已提取的物理尺寸" columns={[{key:"reference",title:"器件"},{key:"property",title:"尺寸含义"},{key:"measure",title:"数值"},{key:"source",title:"来源"}]} rows={(state.result?.evidenceFacts||[]).flatMap(f=>(f.mechanicalFacts||[]).map((m,i)=>({id:f.id+"-"+i,reference:f.reference||f.value,property:m.description||m.property,measure:m.value+" "+m.unit,source:m.citations.map(c=>c.document+" · 第"+c.page+"页").join("；"),citations:m.citations})))} onView={r=>detail("尺寸来源",{器件:r.reference,尺寸:r.property,数值:r.measure,原文:r.citations.map(c=>c.quote).join("\n")})}/><Table label="供电、接口与推荐外围" columns={[{key:'subject',title:'器件 / 对象'},{key:'statement',title:'资料说明'},{key:'citations',title:'来源',render:r=>r.citations.map(c=>[c.document,c.page ? '第'+c.page+'页' : c.section].filter(Boolean).join(' · ')).join('；')}]} rows={state.result?.guidance || []} onView={r=>detail('应用依据',{'器件 / 对象':r.subject,'资料说明':r.statement,...Object.fromEntries(r.citations.map((c,i)=>['引用 '+(i+1),[c.document,c.page?'第'+c.page+'页':c.section,c.quote].filter(Boolean).join('\n')]))})}/></>}<p className="page-help">以下器件和连接来自本次生成结果；尚未生成时保持为空。</p>{ct(10, true)}{nets()}</>
        : <>{f('设计依据与来源补充', 'basis', { area: true, placeholder: '说明需求、器件资料、版本、页码和尚未确认的事项' })}{state.result?.citations?.length > 0 && <Table label="设计依据" columns={[{key:'ref',title:'对象'},{key:'source',title:'来源'},{key:'page',title:'页码'}]} rows={state.result.citations.map((r, id) => ({ id, ...r }))}/>}</>;
    return <>{page}{tab === 0 && stepNotes()}</>;
  }

  if (stage === 3) {
    const page = tab === 0
      ? <>{fresh && <DesignRegister state={state}/>} {p.controlledLayout && state.plan?.design && <><h3>待确认的电气清单</h3><Table label="网络连接" columns={[{key:'name',title:'网络'},{key:'nodes',title:'引脚',render:r=>r.nodes.join('、')}]} rows={state.plan.design.nets.map((n, id) => ({...n, id}))}/><p>NC：{state.plan.design.nc.join('、')}</p><Notice>确认后冻结这些连接。第四步只能改变排版。</Notice></>}{ct(10, true)}</>
      : tab === 1
        ? <><div className="section-heading small"><h3>规格书正文与来源</h3><Btn icon={Add} onClick={openUpload}>添加附件</Btn></div><Notice tone="warning"><strong>器件规格书 PDF：{uploads.length ? uploadStatus : '待上传'}</strong><p>上传后请绑定型号或位号，再核对页码和引脚表。</p></Notice>{f('粘贴规格书正文', 'datasheetText', { area: true, className: 'text-task-editor', placeholder: '器件准确型号 / 文档版本 / 来源 / 页码\n引脚表、供电范围、电气类型和相关应用说明', help: '上传 PDF 后仍可补充；扫描页或图形中的信息可在此补充，保留来源及页码。' })}{uploads.length > 0 && <Table label="规格书附件" columns={[{key:'name',title:'附件'},{key:'binding',title:'型号 / 位号'},{key:'status',title:'读取状态',render:r=>r.status || '已上传，待读取核验'}]} rows={uploads} onView={r => detail('附件信息', r)}/>}</>
        : <><Table label="参数来源" columns={[{key:'ref',title:'位号'},{key:'name',title:'参数'},{key:'value',title:'值'},{key:'source',title:'来源'},{key:'page',title:'页码'}]} rows={(state.result?.parameters || []).map((r, id) => ({id, ...r}))}/><OperatingPoints review={state.result?.engineeringReview} detail={detail}/>{checks()}</>;
    return <>{page}{tab === 0 && stepNotes()}</>;
  }

  if (stage === 4) {
    return <>{tab === 0 ? <><DrawingResult project={p} stage={stage} onAction={onReviewAction} go={go} busy={busy}/>{stepNotes()}</> : tab === 1 ? <>{nets()}{stepNotes()}</> : checks()}</>;
  }

  if (stage === 5) {
    const page = tab === 0
      ? <><h3>本次生成物料</h3><p className="page-help">保留制造图形对象和装配属性；物料导出文件以工具实际结果为准。</p><Table label="生成物料" searchable columns={[{key:'ref',title:'位号'},{key:'value',title:'名称与参数'},{key:'code',title:'物料编码'},{key:'footprint',title:'封装标识'},{key:'dnp',title:'不装配',render:r=>r.dnp == null ? '见记录' : r.dnp ? '是' : '否'},{key:'on_board',title:'在板上',render:r=>r.on_board == null ? '见记录' : r.on_board ? '是' : '否'}]} rows={components} onView={r => detail('本次物料属性', r)}/></>
      : tab === 1
        ? <><h3>封装标识与引脚映射</h3><p className="page-help">读取本机封装库的实际焊盘编号，与设计清单和符号逐针核对；机械适配仍需审定。</p>{ct(10, true)}<Table label="本次引脚映射" columns={[{key:'ref',title:'位号'},{key:'pin',title:'引脚'},{key:'name',title:'名称'},{key:'net',title:'网络'}]} rows={data.pins || []} searchable onView={r => detail('本次引脚', r)}/></>
        : checks();
    return <>{page}{tab === 0 && stepNotes()}</>;
  }

  if (stage === 6) {
    if (tab === 2) return checks();
    if (tab === 1) return <><div className="section-heading small"><h3>装配与布线工艺</h3><Badge>可编辑</Badge></div><div className="field-grid">
      {f('贴片器件装配面','pcbSmdSide',{options:['不限定','底面','顶面']})}
      {f('插装器件装配面','pcbThtSide',{options:['不限定','顶面','底面']})}
      {f('允许布线层','pcbRoutingLayers',{options:['沿用布线要求','仅底层','仅顶层','双层']})}
      {f('过孔','pcbVias',{options:['沿用布线要求','禁止','允许']})}
      {f('零欧跨线','pcbJumpers',{options:['仅保留原理图已有跨线','不使用跨线']})}
      {f('铜区使用','pcbCopper',{options:['不铺铜','回流铜区','电源与回流铜区']})}
      {f('局部去耦最大距离 / mm','pcbDecouplingMm',{placeholder:'电容电源焊盘至负载电源焊盘'})}
      {f('负载储能最大距离 / mm','pcbStorageMm',{placeholder:'按已核对的储能负载归属'})}
      </div><p className="page-help">装配类型按实际焊盘判断；距离取自已确认电路中的供电归属。距离是工程放置目标，不代表厂家规定或瞬态性能通过。铜区只用于已核对的供电与返回网，填充后检查间距及孤岛；采用实心焊盘连接，生产焊接工艺仍需复核。零欧跨线保留原理图网络边界，不在 PCB 阶段增删器件。</p><PcbOutput project={p} state={state} resultFiles={resultFiles}/>{stepNotes()}</>;
    return <><div className="section-heading small"><h3>封装与机械资料</h3><Btn icon={Add} onClick={openUpload}>添加封装 PDF / DOCX</Btn></div><p className="page-help">补充当前器件的焊盘表、编号方向和局部外形；本步资料用于 PCB，来源保留在输入记录中。</p>{uploads.filter(r=>r.stage===6).map(r=><p key={r.id}><a href={attachmentURL(p.id,r.id)}>{r.name}</a> · {r.status}</p>)}<div className="section-heading small"><h3>PCB 要求与机械制造输入</h3><Badge>{p.fields?.outline || p.fields?.cadLayers || p.fields?.routing || p.fields?.manufacture || p.fields?.pcbRulePolicy || p.notes?.[6]?.trim() ? '已预填，可编辑' : '待填写'}</Badge></div><div className="field-grid">{f('板框与尺寸', 'outline', {placeholder:'长宽、圆角与孔位'})}{f('工程中的铜层设置', 'cadLayers', {placeholder:'KiCad 工程表示方式'})}{f('实际布线面', 'routing', {placeholder:'布线所在的铜面'})}{f('制造铜层数', 'manufacture', {options:['单面铜','双面铜','多层','待工程师确认']})}</div>{f('孔金属化要求', 'plating', {options:['金属化孔','非金属化孔','混合','待工程师确认']})}{f('制造与布线规则', 'pcbRulePolicy', {area:true})}{stepNotes()}<PcbOutput project={p} state={state} resultFiles={resultFiles}/></>;
  }

  const page = tab === 0
    ? <><div className="section-heading small"><h3>本次工程核验</h3><Badge status={state.status}>{state.status === 'done' ? '核验已执行' : '核验待执行'}</Badge></div>{checks()}</>
    : tab === 1
      ? f('工程师评审意见', 'review', {area:true, placeholder:'记录确认内容、未关闭问题及下一阶段处理事项'})
      : <><div className="section-heading small"><h3>交付文件</h3><Btn icon={Download} onClick={() => download(p.name + '-输入确认记录.json', JSON.stringify({project:p.name, clarifications:p.clarifications || [], origin:'text-mcp', evidence:p.inputs?.evidence || [], fields:p.fields, notes:p.notes, events:p.events}, null, 2))}>导出输入记录</Btn></div><DrawingResult project={p} stage={stage} onAction={onReviewAction} go={go} busy={busy}/><details><summary>全部文件与记录</summary>{resultFiles()}</details></>;
  return <>{page}{tab === 0 && stepNotes()}</>;
}

function PcbOutput({ project, state, resultFiles }) {
  if (state.status !== 'done') return <><p className="page-help">根据当前原理图与实际封装生成布局，自动布线后运行 DRC。</p><details><summary>本步文件与记录</summary>{resultFiles()}</details></>;
  const result = state.result || {};
  return <><div className="drawing-actions"><a className="btn primary" href={'/api/eda-flow/project-download?projectId=' + encodeURIComponent(project.id) + '&stage=6'} download>下载完整 PCB 工程</a>{result.pcbPdf && <a className="btn" href={assetURL(project.id, 6, result.pcbPdf, true)} download>下载 PCB 图纸</a>}</div>{(result.previews || []).map(file=>{const name=typeof file==='string'?file:file.path;return <figure key={name}><figcaption>{name.includes('Back')?'PCB 背面（镜像）':name.includes('Front')?'PCB 正面':'PCB 布局布线'}</figcaption><img className="pcb-sheet" src={assetURL(project.id,6,name)} alt="实际生成的PCB布局布线图"/></figure>;})}<p>{result.summary}</p></>;
}

function DesignRegister({state}) { const design=state.result?.design; if(!design)return <Notice>执行后查看可确认的设计清单。</Notice>;return <><h3>统一设计清单</h3><p className="page-help">确认后作为原理图、BOM和封装核验的共同依据。修改选型需重新执行本步及下游。</p><Table label="设计清单" searchable columns={[{key:'id',title:'身份'},{key:'ref',title:'位号'},{key:'mpn',title:'采购型号',render:r=>r.mpn||'待确认'},{key:'footprint',title:'封装',render:r=>r.footprint||'待确认'}]} rows={design.components}/>{design.supplied_nets?.length>0&&<><h3>供电声明</h3><p className="page-help">以下网络按设计声明添加供电检查标记。当前检查不验证真实供电路径、电压或负载能力，确认前需核对实际电源入口和连接。</p><Table label="供电声明" columns={[{key:'name',title:'网络'}]} rows={design.supplied_nets.map((name,id)=>({id,name}))}/></>}<>{design.functions.some(f=>f.layout?.length)&&<><h3>局部器件归属</h3><p className="page-help">由本次电路方案提出，排版时用于让去耦靠近对应负载。连接仍以已确认网络为准。</p><Table label="局部器件归属" columns={[{key:"anchor",title:"负载供电脚"},{key:"return",title:"返回脚"},{key:"members",title:"局部器件",render:r=>r.members.join("、")}]} rows={design.functions.flatMap(f=>(f.layout||[]).map((r,i)=>({...r,id:f.requirementId+"-"+i})))}/></>}</><Table label="功能验证范围" columns={[{key:'description',title:'功能'},{key:'limitations',title:'仍需验证',render:r=>r.limitations.join('；')}]} rows={design.functions.map((r,id)=>({...r,id}))}/></>;}

export function DrawingResult({project,stage,onAction,go,busy}) {
  const source=[...(project.stages||[])].reverse().find(s=>s.id<=stage&&s.status==='done'&&(s.files||s.result?.files||[]).some(f=>/\.kicad_sch$/i.test(f.path)));
  if(!source)return <Empty title="尚未生成原理图"/>;
  const files=source.files||source.result?.files||[];
  const pdf=source.result?.schematicPdf||files.find(f=>/\.pdf$/i.test(f.path))?.path;
  const image=source.result?.previews?.[0];
  const picture=(typeof image==='string'?image:image?.path)||files.find(f=>/\.(svg|png)$/i.test(f.path))?.path;
  const url='/api/eda-flow/project-download?'+new URLSearchParams({projectId:project.id,stage:source.id});
  return <section className="drawing-result" aria-label="生成结果">
    <div className="drawing-actions"><a className="btn primary" href={url}>下载完整工程 <Download size={18}/></a>{pdf&&<a className="btn" href={assetURL(project.id,source.id,pdf,true)}>下载图纸 PDF <Download size={18}/></a>}{picture&&<a className="text-link" href={assetURL(project.id,source.id,picture)} target="_blank" rel="noreferrer">展开图纸</a>}</div>
    {picture&&onAction&&[4,5].includes(source.id)&&picture.endsWith(".svg")?<SchematicSelection project={project} source={source} picture={picture} onAction={onAction} go={go} busy={busy}/>:picture?<a className="drawing-sheet" href={assetURL(project.id,source.id,picture)} target="_blank" rel="noreferrer" aria-label="展开原理图"><img src={assetURL(project.id,source.id,picture)} alt="生成的原理图"/></a>:pdf?<iframe className="drawing-pdf" title="原理图 PDF" src={assetURL(project.id,source.id,pdf)}/>:<Empty title="图纸预览尚未生成"/>}
  </section>;
}
