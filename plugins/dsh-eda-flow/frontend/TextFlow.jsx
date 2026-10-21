import React, { useState } from 'react';
import { Download, Document, Add, ChevronRight } from '@carbon/icons-react';
import { Badge, Btn, Empty, Field, Notice, Table } from './ui.jsx';
import { assetURL, attachmentURL } from './api.js';
import { checkRows, checkStatus, textInputRecord } from './textFlow.js';

const HELP = {
  1: ['核对完整任务书中的功能、器件、连接和装配要求。', '保存输入后人工确认并继续；本步不请求模型。'],
  2: ['模型以任务书和已粘贴规格书建立设计依据。', '整理输入后核对来源和缺项，再确认继续。'],
  3: ['核对准确型号、引脚功能、电气类型及封装标识。', '在规格书页粘贴带来源和页码的正文，再读取并核对。'],
  4: ['根据已确认的电路与真实库资源生成原理图。', '生成后查看实际图纸和 ERC；需要补充时先保存回答，再重新执行。'],
  5: ['从本次生成原理图导出物料和引脚映射。', '核对参数、物料标识和装配状态；PCB 封装几何留到下一阶段。'],
  6: ['本轮交付范围为原理图、相关物料和核验记录。', 'PCB 布局布线本轮未执行，可直接进入核验与交付。'],
  7: ['检查本次原理图、BOM、工程依赖和真实 ERC。', '运行核验后复核结果并确认交付。Harness 真实模型验收状态单独记录。'],
};

export function TextInputGuide({ project, stage, onFiles, onLocate }) {
  const sources=[...(project.inputs?.evidence||[]),...(project.stages?.find(s=>s.id===2&&s.status==='done')?.result?.evidenceFacts||[])];
  const visibleEvidence=sources.filter(r=>(r.stages?.includes(stage)||(stage===1&&r.sourceType==='pdf-text-extraction'))&&(r.sourceType!=='pdf-text-extraction'||!(project.inputs?.evidence||[]).some(s=>s.document===r.document&&s.sourceType==='pdf-specification-appendix')));
  const evidenceGroups=Object.groupBy(visibleEvidence,r=>r.objectRole?'器件规格与装配':r.symbolId?'器件外形与引脚':'功能、接口与图纸规范');

  if (['datasheet-demo','new-design'].includes(project.designMode)) return <section className="input-guide" aria-label="本步输入来源">
    <strong>{project.designMode === 'datasheet-demo' ? '显示板演示 · 自然语言 + 模拟 PDF 提取' : '自然语言 + PDF · 自动设计'}</strong>
    <p>{project.designMode === 'datasheet-demo' ? '预填资料标注为模拟提取结果，演示页码为占位。' : '描述功能与约束，上传规格书；系统按页提取正文并继承已确认结果。'}</p>
    {(project.uploads||[]).filter(f=>f.extraction).map(f=><p key={f.id}><a href={attachmentURL(project.id,f.id)}><Download size={16}/> 下载规格资料：{f.name}</a></p>)}
    <details><summary>工程师说了什么</summary><p>{project.fields?.requirements || project.inputs.requirements}</p><p>{project.notes?.[stage] || project.inputs.stageNotes?.[stage]}</p></details>
    <details open><summary>资料提供了什么 · 本步摘录</summary>{Object.entries(evidenceGroups).map(([title,rows])=><details key={title}><summary>{title} · {rows.length} 条</summary>{rows.map(r=><details key={r.id}><summary>{r.binding} · 第{r.page}页{r.pageIsPlaceholder?'（演示占位）':''}{r.simulated?' · 模拟资料':''}</summary><p>{r.content||'本页没有可提取文字，请补充该页内容。'}</p><small>{r.document}</small></details>)}</details>)}</details>
    <p><b>系统生成了什么：</b>{project.stages.find(s => s.id === stage)?.status === 'done' ? project.stages.find(s => s.id === stage)?.result?.summary || '已确认输入，查看本步记录。' : stage === 6 ? 'PCB 本轮未执行。' : '尚无本步有效结果，执行后在下方查看并确认。'}</p>
    <div className="input-guide-actions"><button className="text-link" onClick={onFiles}>查看完整输入与资料来源</button>{stage !== 6 && <Btn onClick={() => onLocate?.({ stage, tab: 0, field: 'stageNotes' })}>补充本步自然语言要求</Btn>}</div>
  </section>;


  return <section className="input-guide" aria-label="本步输入来源">
    <strong>{project.controlledLayout?'冻结电路与受控排版':project.designMode==='fixed-redesign'?'固定原器件 · 重新布局连线':project.designMode==='new-design'?'从零设计 · 功能需求':project.template ? '原图复原 · 显示板任务书' : '工程师文字输入'}</strong>
    {project.controlledLayout&&<p>第三步确认后锁定符号、器件、网络和 NC；第四步只调整排版。从零设计使用真实库符号与 A4/A3 单页排版；固定显示板保留专用模板。复杂符号能力在选型时检查。</p>}{!project.controlledLayout&&project.designMode==='fixed-redesign'&&<p>已固定41个原对象的符号、引脚几何和物料属性；模型自行安排页面及连线，文字位置可以调整。器件资料通过库查询读取。</p>}
    <p>{project.controlledLayout ? ({3:'核对下方完整连接与NC清单；确认后冻结。更改连接必须返回本步。',4:'可补充纸张、功能分组和间距；符号和连接不可在本步修改。排版失败时保留上次成功文件。'}[stage]||'使用已冻结真实符号生成并核验原理图。') : project.designMode==='fixed-redesign' ? '使用短需求与冻结器件库；按功能分组自动布局连线，核对功能、BOM、封装标识、原符号和图面可读性。' : project.designMode==='new-design' ? ({1:'描述功能、供电、接口和约束即可，无需填写坐标与逐针连线。',2:'模型整理功能方案与需求覆盖，关键缺项会在这里追问。',3:'模型查询本机器件库并形成设计清单，确认后供原理图和BOM共用。',4:'按已确认设计清单生成，自行布局；实际网表反向核对连接意图。',5:'核对设计身份、物料、装配状态及本机库的实际焊盘编号。',7:'静态一致性通过不等于实物或生产验证；未完成项只允许草稿交付。'}[stage]||HELP[stage][0]) : HELP[stage][0]}</p><p><b>本步操作</b>{HELP[stage][1]}</p>
    <div className="input-guide-actions"><button className="text-link" onClick={onFiles}>查看完整文字输入</button><span className="muted">保存与模型执行分开</span></div>
    {stage !== 6 && <div className="input-guide-actions"><Btn onClick={() => onLocate?.({ stage, tab: 0, field: 'stageNotes' })}>补充本步文字</Btn><Btn onClick={() => onLocate?.({ stage: 3, tab: 1, field: 'datasheetText' })}>补充规格书正文</Btn></div>}
  </section>;
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
  return <><p className="page-help">{state.result?.summary}</p>
    {rows.length ? <Table label="实际检查结果" columns={[{ key: 'name', title: '检查', render: r => r.name || r.title || r.kind || '检查记录' }, { key: 'status', title: '结果', render: r => <Badge status={r.status}>{checkStatus(r)}</Badge> }, { key: 'summary', title: '说明', render: r => r.summary || r.detail || (r.result == null ? '查看完整记录' : String(r.result)) }]} rows={rows} onView={r => detail('实际检查记录', r)} /> : <Notice>本步未返回结构化检查摘要，可在执行记录中查看工具返回结果。</Notice>}
    <Table label="检查待办" columns={[{ key: 'text', title: '待确认项' }]} rows={[...(state.gaps || []), ...(state.assumptions || [])].map((text, id) => ({ id, text }))} />
    <details className="execution-files"><summary>本次生成文件与执行记录</summary>{resultFiles()}</details></>;
}

export function TextFlowContent({ p, data, stage, tab, state, field, notes, ct, nets, preview, imageFile, detail, resultFiles, download, go, openUpload }) {
  const f = (label, key, props = {}) => <Field label={label} value={p.fields[key]} onChange={value => field(key, value)} data-input={key} {...props} />;
  const components = data.components || [];
  const fresh=['new-design','datasheet-demo'].includes(p.designMode);
  const checks = () => <TextChecks state={state} detail={detail} resultFiles={resultFiles} />;
  const generated = p.stages.filter(s => s.status === 'done');
  const pdf = [...generated].reverse().find(s => s.result?.schematicPdf || s.files?.some(f => /\.pdf$/i.test(f.path)));
  const pdfPath = pdf?.result?.schematicPdf || pdf?.files?.find(f => /\.pdf$/i.test(f.path))?.path;
  if (stage === 1) return <>{tab === 0 ? <><div className="section-heading small"><h3>{fresh?'功能需求与约束':'完整纯文字任务书'}</h3><span className="muted">{(p.fields.requirements || '').length.toLocaleString()} 字符</span></div>{f('完整任务书', 'requirements', { area: true, className: 'text-task-editor', placeholder: fresh?'要实现什么功能？供电、主控接口、尺寸、成本与装配有什么限制？':'功能、供电、器件、逐引脚连接、装配状态、页面坐标和验收要求', help: fresh?'模型负责方案、选型、连接和布局；影响方案的缺项会追问。':'正文直接进入模型上下文。精确连接与坐标需在这里明确给出。' })}<div className="field-grid">{f('供电要求', 'power')}{f('信号与接口', 'interfaces')}</div></> : tab === 1 ? <>{f('封装与装配要求', 'mount', { area: true })}{f('原理图设计约束', 'rules', { area: true })}<Notice>PCB 布局布线属于下一阶段，本轮仅生成原理图和物料信息。</Notice></> : <>{f('验收要求', 'acceptance', { area: true })}<div className="review-list">{['逐引脚连接与 NC', '型号、参数、封装标识与装配状态', fresh?'功能需求覆盖与连接条件':'页面对象坐标与文字要求', '本次工程依赖、真实 ERC 和交付记录'].map(x => <div key={x}><Document size={20} />{x}</div>)}</div></>}{notes()}</>;
  if (stage === 2) return <>{tab === 0 ? <><div className="section-heading small"><h3>自然语言与规格资料</h3><Btn icon={Add} onClick={openUpload}>添加 PDF 资料</Btn></div><p className="page-help">上传 PDF 后按页提取正文，也可直接补充文字资料。来源摘录与读取状态见本步输入来源。</p><Table label="文字输入" columns={[{ key: 'name', title: '输入' }, { key: 'size', title: '正文长度' }, { key: 'source', title: '来源' }]} rows={[{ id: 'requirements', name: '完整任务书', size: `${(p.fields.requirements || '').length} 字符`, source: '第一步可编辑文字' }, { id: 'datasheet', name: '规格书正文', size: `${(p.fields.datasheetText || '').length + (p.inputs.evidence || []).reduce((n, r) => n + (r.content || '').length, 0)} 字符`, source: p.designMode==='datasheet-demo' ? '可选补充；模拟摘录见本步输入来源' : 'PDF 提取正文与文字补充' }]} />{notes()}</> : tab === 1 ? <><h3>本次设计数据</h3>{fresh&&<><p className="page-help">{state.result?.summary}</p><Table label="需求覆盖" columns={[{key:'id',title:'需求'},{key:'description',title:'功能与约束'}]} rows={state.result?.requirements||[]}/></>}<p className="page-help">以下器件和连接来自本次生成结果；尚未生成时保持为空。</p>{ct(10, true)}{nets()}</> : <>{f('设计依据与来源补充', 'basis', { area: true, placeholder: '说明需求、器件资料、版本、页码和尚未确认的事项' })}{state.result?.citations?.length > 0 && <Table label="设计依据" columns={[{ key: 'ref', title: '对象' }, { key: 'source', title: '来源' }, { key: 'page', title: '页码' }]} rows={state.result.citations.map((r, id) => ({ id, ...r }))} />}</>}</>;
  if (stage === 3) return <>{tab === 0 ? <>{fresh && <DesignRegister state={state}/>}{p.controlledLayout&&state.plan?.design&&<><h3>待确认的电气清单</h3><Table label="网络连接" columns={[{key:'name',title:'网络'},{key:'nodes',title:'引脚',render:r=>r.nodes.join('、')}]} rows={state.plan.design.nets.map((n,id)=>({...n,id}))}/><p>NC：{state.plan.design.nc.join('、')}</p><Notice>确认后冻结这些连接。第四步只能改变排版。</Notice></>}{ct(10, true)}{notes()}</> : tab === 1 ? <><div className="section-heading small"><h3>规格书正文与来源</h3><Btn icon={Add} onClick={openUpload}>添加附件</Btn></div>{f('粘贴规格书正文', 'datasheetText', { area: true, className: 'text-task-editor', placeholder: '器件准确型号 / 文档版本 / 来源 / 页码\n引脚表、供电范围、电气类型和相关应用说明', help: '上传 PDF 自动按页提取；扫描页或图形中的信息可在此补充，保留来源及页码。' })}{p.uploads.length > 0 && <Table label="规格书附件" columns={[{ key: 'name', title: '附件' }, { key: 'binding', title: '型号 / 位号' }, { key: 'status', title: '读取状态', render: r => r.status || '已保存，待读取核验' }]} rows={p.uploads} onView={r => detail('附件信息', r)} />}</> : <><Table label="参数来源" columns={[{ key: 'ref', title: '位号' }, { key: 'name', title: '参数' }, { key: 'value', title: '值' }, { key: 'source', title: '来源' }, { key: 'page', title: '页码' }]} rows={(state.result?.parameters || []).map((r, id) => ({ id, ...r }))} />{checks()}</>}</>;
  if (stage === 4) return <>{tab === 0 ? <>{nets()}{notes()}</> : tab === 1 ? <>{imageFile('DisplayBoard.svg') ? preview('原理图', 'DisplayBoard.svg') : <Empty title="原理图预览尚未生成">模型通过 KiCad MCP 建立工程后，在此查看本次导出的图纸。</Empty>}{pdfPath && <p className="page-help"><a href={assetURL(p.id, pdf.id, pdfPath, true)}><Download size={16} /> 下载本次原理图 PDF</a></p>}</> : checks()}</>;
  if (stage === 5) return <>{tab === 0 ? <><h3>本次生成物料</h3><p className="page-help">保留制造图形对象和装配属性；物料导出文件以工具实际结果为准。</p><Table label="生成物料" searchable columns={[{ key: 'ref', title: '位号' }, { key: 'value', title: '名称与参数' }, { key: 'code', title: '物料编码' }, { key: 'footprint', title: '封装标识' }, { key: 'dnp', title: '不装配', render: r => r.dnp == null ? '见记录' : r.dnp ? '是' : '否' }, { key: 'on_board', title: '在板上', render: r => r.on_board == null ? '见记录' : r.on_board ? '是' : '否' }]} rows={components} onView={r => detail('本次物料属性', r)} />{notes()}</> : tab === 1 ? <><h3>封装标识与引脚映射</h3><p className="page-help">{fresh?'读取本机封装库的实际焊盘编号，与设计清单和符号逐针核对；机械适配仍需审定。':'本轮核对原理图中的封装标识与引脚编号，不生成 PCB 焊盘几何。'}</p>{ct(10, true)}<Table label="本次引脚映射" columns={[{ key: 'ref', title: '位号' }, { key: 'pin', title: '引脚' }, { key: 'name', title: '名称' }, { key: 'net', title: '网络' }]} rows={data.pins || []} searchable onView={r => detail('本次引脚', r)} /></> : checks()}</>;
  if (stage === 6) return <Empty title="PCB 本轮未执行" action={<Btn onClick={() => go(7)} icon={ChevronRight}>进入核验与交付</Btn>}>本轮仅交付原理图、相关物料与验证记录。PCB 布局布线留到下一阶段。</Empty>;
  return <>{tab === 0 ? <><div className="section-heading small"><h3>本次工程核验</h3><Badge status={state.status}>{state.status === 'done' ? '核验已执行' : '核验待执行'}</Badge></div><Notice tone="warning">Harness 真实模型验收：{state.result?.liveHarnessValidation === 'passed' || p.liveHarnessValidation === 'passed-controlled-display-board' ? '已通过，详见本次验收记录' : '待验证'}。本机模拟响应和 Codex 演示分别保留记录。</Notice><p className="page-help">核对输入规格中的器件、参数、连接和图纸要求，并检查物料、工程依赖与 ERC。</p>{checks()}{notes()}</> : tab === 1 ? <><Table label="待补与假设" columns={[{ key: 'stage', title: '步骤' }, { key: 'text', title: '待处理事项' }]} rows={p.stages.flatMap(s => [...(s.gaps || []), ...(s.assumptions || []), ...(s.questions || [])].map((text, id) => ({ id: `${s.id}-${id}`, stage: s.title, text })))} />{f('工程师评审意见', 'review', { area: true, placeholder: '记录确认内容、未关闭问题及下一阶段处理事项' })}</> : <><div className="section-heading small"><h3>交付内容</h3><Btn icon={Download} onClick={() => download(`${p.name}-输入确认记录.json`, JSON.stringify({ project: p.name, origin: 'text-mcp', evidence: p.inputs.evidence || [], fields: p.fields, notes: p.notes, events: p.events }, null, 2))}>导出输入记录</Btn></div>{resultFiles()}<p className="page-help">独立再生成需要另建空白项目，由模型重新处理同一份文字输入。</p></>}</>;
}

function DesignRegister({state}) { const design=state.result?.design; if(!design)return <Notice>执行后查看可确认的设计清单。</Notice>;return <><h3>统一设计清单</h3><p className="page-help">确认后作为原理图、BOM和封装核验的共同依据。修改选型需重新执行本步及下游。</p><Table label="设计清单" searchable columns={[{key:'id',title:'身份'},{key:'ref',title:'位号'},{key:'mpn',title:'采购型号',render:r=>r.mpn||'待确认'},{key:'footprint',title:'封装',render:r=>r.footprint||'待确认'}]} rows={design.components}/><Table label="功能验证范围" columns={[{key:'description',title:'功能'},{key:'limitations',title:'仍需验证',render:r=>r.limitations.join('；')}]} rows={design.functions.map((r,id)=>({...r,id}))}/></>;}
