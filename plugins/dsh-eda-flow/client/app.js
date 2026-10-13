const app = document.querySelector('#app');
const embedded = window.parent !== window && new URLSearchParams(location.search).has('embedded');
const closeFlow = () => { if (embedded) window.parent.postMessage({ type: 'eda-flow:close' }, '*'); };
let bootstrap, project, current = 1, error = '', working = false, poll = null, renderedKey = '', renderedPageKey = '';
const labels = { pending: '尚未执行', running: '正在执行', done: '已生成', failed: '执行失败', stale: '需要重新执行', cancelled: '已取消', interrupted: '上次中断' };
const escape = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pretty = x => escape(JSON.stringify(x, null, 2));
const button = (text, action, attr = '') => `<button data-action="${action}" ${attr}>${text}</button>`;
const assetURL = (file, stage = current, download = false) => '/api/eda-flow/asset?' + new URLSearchParams({ projectId: project.id, stage, path: file, ...(download ? { download: '1' } : {}) });
async function api(body) {
  const r = await fetch('/api/eda-flow/' + (body ? 'action' : 'bootstrap'), body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' });
  let data; try { data = await r.json(); } catch { throw new Error('插件接口未返回有效数据，请确认独立插件后端已加载。'); }
  if (!r.ok || !data.ok) throw new Error(data.error || `请求失败：${r.status}`);
  return data.value;
}
function nav() {
  return `<aside><div class="project-info">当前工程</div><select id="projects" aria-label="选择工程"><option value="">选择工程</option>${bootstrap.projects.map(p => `<option value="${p.id}" ${project?.id === p.id ? 'selected' : ''}>${escape(p.label)}</option>`).join('')}<optgroup label="创建工程"><option value="__new">新建设计</option><option value="__display">载入显示板输入</option></optgroup></select>
    <nav class="step-nav" aria-label="工程步骤">${bootstrap.stages.map(s => { const state = project?.stages[s.id - 1]; return `<button class="step ${current === s.id && project ? 'active' : ''}" data-step="${s.id}" ${current === s.id && project ? 'aria-current="step"' : ''} ${!project ? 'disabled' : ''}><span class="number">${state?.confirmed ? '✓' : s.id}</span><span>${s.title}<small>${labels[state?.status] || '等待创建项目'}${state?.confirmed ? ' · 已确认' : ''}</small></span></button>`; }).join('')}</nav>
    <div class="new-actions">${button('载入显示板输入', 'display-board')}${button('新建设计', 'new')}</div><p class="hint">按步骤填写输入，查看生成结果，再确认下一步。</p></aside>`;
}
function section(title, content, right = '') { return `<section class="section"><div class="section-head"><h3>${title}</h3>${right}</div><div class="section-body">${content}</div></section>`; }
function pathField(label, key, value) { return `<label for="${key}">${label}</label><div class="file-row"><input id="${key}" data-input="${key}" value="${escape(value)}" placeholder="运行 Harness 的电脑上的文件路径">${button('选择文件', 'browse', `data-key="${key}"`)}</div>`; }
function inputsUI(s) {
  let form = `<p>${escape(s.input)}</p>`;
  if (s.id === 1) form += `<label for="requirements">需求与目标</label><textarea id="requirements">${escape(project.inputs.requirements)}</textarea><div class="two">${[['layerPolicy', '板层与实际布线面'], ['packagePolicy', '贴片 / 插件与封装要求'], ['outlinePolicy', '板框与机械要求'], ['rulePolicy', '规则与制造要求']].map(([key, label]) => `<div><label for="${key}">${label}</label><textarea id="${key}" data-constraint="${key}" placeholder="填写已确定要求，未定项可留空">${escape(project.inputs.constraints?.[key] || '')}</textarea></div>`).join('')}</div>`;
  if (s.id === 2) form += `<label for="basis">功能分块、接口和设计依据</label><textarea id="basis" data-input="basis" placeholder="新设计可从功能和接口开始，参考电路可选">${escape(project.inputs.basis || '')}</textarea><details><summary>添加已有工程资料（可选）</summary>${pathField('原始原理图', 'schematic', project.inputs.schematic)}${pathField('原始 PCB', 'pcb', project.inputs.pcb)}${pathField('原始工程文件', 'nativeProject', project.inputs.nativeProject)}</details>`;
  if (s.id === 3) form += `<div class="two"><div><label for="mpn">准确型号</label><input id="mpn" placeholder="按器件资料填写"></div><div><label for="binding">位号与封装</label><input id="binding" placeholder="如 U1 / LQFP-48"></div></div>` + pathField('PDF 规格书', 'pdf', '') + `<div class="buttons">${button('添加规格书', 'pdf')}</div>` + (project.inputs.datasheets?.length ? `<ul>${project.inputs.datasheets.map(x => `<li>${escape(x.mpn)} · ${escape(x.binding)} · ${escape(x.path)}</li>`).join('')}</ul>` : '<p class="help">添加后由 AI 读取引脚、电气参数和应用要求，并保留页码。</p>');
  const groups = {1:['01_task','07_adjustments'],2:['02_materials','04_schematic'],3:['03_components','08_dependencies'],4:['03_components','04_schematic'],5:['05_footprints','03_components'],6:['06_pcb','05_footprints','08_dependencies'],7:['01_task','07_adjustments']}[s.id];
  const files = (project.inputCatalog || []).filter(f => groups.some(g => f.path.startsWith(g + '/')));
  if (files.length) form += `<details><summary>本步默认输入 · ${files.length} 个文件</summary><div class="input-files">${files.map(f=>`<button data-read="${escape(f.path)}"><span>${escape(f.path)}</span><small>${(f.bytes/1024).toFixed(1)} KB</small></button>`).join('')}</div></details>`;
  form += `<label for="stage-note">本步补充与调整</label><textarea id="stage-note" placeholder="填写连接、参数、位置等具体要求，AI 将结合上游结果处理">${escape(project.inputs.stageNotes?.[s.id] || '')}</textarea><div class="buttons">${button('保存本步输入', 'save-input', project.busy ? 'disabled' : '')}</div><details><summary>缺少资料时怎么获取</summary><p>${escape(s.obtain)}</p></details>`;
  return form;
}
function resultUI(s) {
  if (s.status === 'running') return `<div class="stage-progress"></div><p>AI 与本机工具正在处理 ${escape(s.title)}。完成后将显示本次产生的文件。</p><p class="help">${escape(project.progress)}<br>切换页面不会重新发起执行。${button('取消本步', 'cancel')}</p>`;
  if (!s.result || s.status !== 'done') return `<div class="empty"><strong>${labels[s.status]}</strong><span>${s.status === 'pending' ? '点击“执行本步”，从当前输入生成结果。' : '原结果仍留档；当前阶段需要重新执行。'}</span></div>`;
  const images = s.files.filter(f => /previews\/[^/]+\.(svg|png)$/.test(f.path) && !/raw|true-width/.test(f.path));
  const imageNames = f => /3d/i.test(f.path) ? '3D 预览' : /pcb-top|PCB_front/.test(f.path) ? 'PCB 正面阅读图' : /bottom|PCB_back/.test(f.path) ? 'PCB 背面' : '原理图';
  const keyfiles = s.files.filter(f => /\.(html|zip|kicad_pro|kicad_sch|kicad_pcb|csv|pdf|svg)$/.test(f.path) || /(?:result|comparison|layer-review|verification|model-log|project-content|delivery-manifest)\.json$/.test(f.path));
  return `<p>${escape(s.result.summary)}</p><p class="help">输出来源：${s.plan?.provider === 'test-double' ? '离线测试替身' : s.source === 'replay' ? '已记录方案重放' : 'Harness 当前模型'}；结果来自本次执行。</p>
    ${s.result.table ? `<details open><summary>查看本步数据（${s.result.table.rows.length} 行）</summary><div style="overflow:auto;max-height:360px"><table><thead><tr>${s.result.table.columns.map(x => `<th>${escape(x)}</th>`).join('')}</tr></thead><tbody>${s.result.table.rows.map(row => `<tr>${row.map(x => `<td>${escape(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>` : ''}
    ${images.length ? `<div class="previews">${images.map(f => `<figure class="preview"><button data-image="${escape(f.path)}" aria-label="全屏查看${imageNames(f)}"><img src="${assetURL(f.path)}" alt="${imageNames(f)}"></button><figcaption><span>${imageNames(f)}</span><a href="${assetURL(f.path, current, true)}">下载</a></figcaption></figure>`).join('')}</div>` : ''}
    ${s.gaps.length ? `<h4>仍需补充或确认</h4><ul class="gap-list">${s.gaps.map(g => `<li>${escape(g)}</li>`).join('')}</ul>` : ''}
    ${s.assumptions?.length ? `<h4>沿用的假设</h4><ul>${s.assumptions.map(x => `<li>${escape(x)}</li>`).join('')}</ul>` : ''}
    <details ${images.length ? '' : 'open'}><summary>本次生成文件（${s.files.length}）</summary><div class="artifacts">${keyfiles.map(f => `<a class="artifact" href="${assetURL(f.path, current, true)}"><span>${escape(f.path)}</span><small>${(f.bytes / 1024).toFixed(1)} KB</small></a>`).join('')}</div></details>
    <details><summary>查看本次检查数据</summary><pre>${pretty(s.result)}</pre></details>
    ${!s.confirmed ? `<label class="inline-check"><input type="checkbox" id="allow-draft"><span>已记录以上待确认项，继续下一步草稿。</span></label><label for="review-note">工程师意见（可选）</label><input id="review-note" placeholder="记录已确认内容或后续需要补充的资料">` : `<p class="notice">已记录工程师确认${s.confirmation?.draft ? '，后续保持草稿状态' : ''}。</p>`}`;
}
function render() {
  const s = project?.stages[current - 1];
  const key = [project?.id, current, project?.revision, s?.status].join(':');
  const pageKey = [project?.id, current].join(':');
  const samePage = pageKey === renderedPageKey;
  const scroll = { main: app.querySelector('main')?.scrollTop || 0, side: app.querySelector('aside')?.scrollTop || 0 };
  const focused = app.contains(document.activeElement) ? document.activeElement : null;
  const focus = focused?.id ? { id: focused.id, start: focused.selectionStart, end: focused.selectionEnd } : null;
  const expanded = new Map(samePage ? [...app.querySelectorAll('details')].map(el => [el.querySelector('summary')?.textContent, el.open]) : []);
  const draft = key === renderedKey ? [...app.querySelectorAll('input[id],textarea[id]')].map(el => ({ id: el.id, value: el.value, checked: el.checked })) : [];
  const head = `<header class="top"><div class="brand"><h1>原理图与 PCB 流程</h1><small>设计输入 → AI 处理 → 工程师确认</small></div><div class="top-actions"><span class="local">${bootstrap.aiEnabled ? 'Harness 当前模型' : '模型待连接'}</span>${embedded ? button('返回 Harness', 'close-flow', 'class="close-flow"') : ''}</div></header>`;
  const welcome = `<div class="welcome"><span class="eyebrow">开始一个工程</span><h2>从输入开始，一步步完成设计</h2><p class="sub">补充设计依据，交给 AI 整理与生成。每一步都可以查看资料、调整要求和确认结果。</p><div class="entry-grid"><article class="entry"><small>默认输入 · 流程示例</small><h3>显示板</h3><p>器件、连接、封装与 PCB 数据已备好。逐步查看这些输入，再生成本次工程。</p>${button('载入显示板输入', 'display-board', 'class="primary"')}</article><article class="entry"><small>自定义输入 · 新项目</small><h3>新建设计</h3><p>从功能需求、接口和指定器件开始，添加规格书，由 AI 协助补齐每一步输入。</p>${button('创建新设计', 'new')}</article></div></div>`;
  let main = welcome;
  if (s) main = `<div class="headline"><div><span class="eyebrow">步骤 ${current} / 7</span><h2>${s.title}</h2><p class="sub">${escape(project.label)} / ${project.caseId ? '显示板默认输入' : '新建设计'} / KiCad</p></div><span class="badge ${s.status}">${labels[s.status]}</span></div>
    <div class="stage-grid"><div>${section('设计输入', inputsUI(s))}</div><div>
    ${section('AI 处理方案', s.plan ? `<p>${escape(s.plan.summary)}</p><details><summary>查看与调整方案</summary><textarea id="plan" class="code" aria-label="处理方案">${pretty(s.plan)}</textarea><div class="buttons">${button('保存调整', 'save-plan', project.busy ? 'disabled' : '')}</div></details>` : '<p class="help">执行本步后，AI 将读取资料并生成处理方案。</p>')}
    ${s.error ? `<div class="error"><strong>本步未完成</strong><br>${escape(s.error)}<br><br>${escape(s.obtain)}</div>` : ''}
    ${section('本次执行结果', resultUI(s), s.output ? `<span class="help">${s.files?.length || 0} 个文件</span>` : '')}
    ${current === 7 ? section('空目录重放', `<p>使用相同输入与已记录的 AI 方案，在新目录重新执行工具并比较工程内容。</p>${button('执行空目录重放', 'replay', project.busy || project.stages.some(x => !x.confirmed || x.status !== 'done') ? 'disabled' : '')}${project.replay ? `<p class="notice">${project.replay.match ? '重放工程内容一致' : '重放存在差异'}，比较 ${project.replay.compared} 个文件。</p><pre>${pretty(project.replay)}</pre>` : ''}`) : ''}</div></div>`;
  app.innerHTML = head + `<div class="layout">${nav()}<div class="workspace"><main>${error ? `<div role="alert" class="error">${escape(error)}</div>` : ''}${main}</main>` + (s ? `<footer class="footer"><small>${project.modelRequests === 0 ? '等待首次 AI 处理' : `模型请求 ${project.modelRequests} 次`}</small><div class="buttons">${current > 1 ? button('上一步', 'previous') : ''}${button(s.status === 'done' ? '重新执行本步' : '执行本步', 'execute', `class="primary" ${project.busy || working || !project.aiEnabled ? 'disabled' : ''}`)}${button(current === 7 ? '确认本步结果' : '确认并进入下一步', 'next', s.status !== 'done' || project.busy || working || !project.aiEnabled ? 'disabled' : '')}</div></footer>` : '') + '</div></div>';
  for (const saved of draft) { const field = document.getElementById(saved.id); if (field) { field.value = saved.value; field.checked = saved.checked; } }
  if (samePage) {
    for (const el of app.querySelectorAll('details')) { const key = el.querySelector('summary')?.textContent; if (expanded.has(key)) el.open = expanded.get(key); }
    app.querySelector('main').scrollTop = scroll.main;
    app.querySelector('aside').scrollTop = scroll.side;
    const field = focus && document.getElementById(focus.id);
    if (field) { field.focus({ preventScroll: true }); if (focus.start != null) field.setSelectionRange?.(focus.start, focus.end); }
  }
  if (!samePage) app.querySelector('.step.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  renderedKey = key; renderedPageKey = pageKey;
}
async function refresh() { bootstrap = await api(); if (project) project = await api({ action: 'open', projectId: project.id }); render(); }
async function perform(fn) { error = ''; working = true; try { await fn(); } catch (e) { error = e.message; } finally { working = false; await refresh().catch(e => { error = e.message; render(); }); schedule(); } }
function schedule() {
  clearTimeout(poll);
  if (project?.busy || project?.stages.some(s => s.status === 'running')) poll = setTimeout(async () => { await refresh().catch(e => { error = e.message; render(); }); schedule(); }, 900);
}
async function browse(key, dir) {
  try {
    const data = await api({ action: 'files', directory: dir }); const dialog = document.querySelector('#picker');
    dialog.innerHTML = `<div class="dialog-head"><strong>选择运行 Harness 的电脑上的文件</strong><button data-close="picker">关闭</button></div><p><code>${escape(data.directory)}</code></p><div class="file-list">${data.parent ? `<button data-dir="${escape(data.parent)}">上一级目录</button>` : ''}${data.entries.map(e => `<button ${e.directory ? `data-dir="${escape(e.path)}"` : `data-file="${escape(e.path)}"`}>${e.directory ? '▸ ' : ''}${escape(e.name)}</button>`).join('')}</div>`;
    dialog.dataset.key = key; if (!dialog.open) dialog.showModal();
  } catch (e) { error = e.message; render(); }
}
function stageInputs() {
  const values = current === 1 ? { requirements: document.querySelector('#requirements').value, constraints: { ...project.inputs.constraints, ...Object.fromEntries([...document.querySelectorAll('[data-constraint]')].map(e=>[e.dataset.constraint,e.value])) } } : current === 2 ? Object.fromEntries([...document.querySelectorAll('[data-input]')].map(e=>[e.dataset.input,e.value.trim()])) : {};
  values.stageNotes = { [current]: document.querySelector('#stage-note').value };
  return values;
}
async function saveCurrentInputs() {
  const inputs=stageInputs();
  const changed=Object.entries(inputs).some(([k,v])=>k==='stageNotes' ? (project.inputs.stageNotes?.[current]||'')!==v[current] : JSON.stringify(project.inputs[k]??'')!==JSON.stringify(v));
  if(changed) project=await api({action:'update',projectId:project.id,stage:current,inputs});
}
async function viewInput(file, offset = 0) {
  try {
    if (!/\.(json|csv|txt|md|xml)$/i.test(file)) { window.location.href = '/api/eda-flow/input-asset?' + new URLSearchParams({projectId:project.id,path:file}); return; }
    const row = await api({action:'read',projectId:project.id,stage:current,scope:'inputs',path:file,offset,length:24000});
    const dialog = document.querySelector('#viewer');
    dialog.innerHTML = `<div class="dialog-head"><strong>${escape(file)}</strong><button data-close="viewer">关闭</button></div><p class="help">${row.offset + 1}–${Math.min(row.offset + row.text.length,row.totalChars)} / ${row.totalChars} 字符</p><pre>${escape(row.text)}</pre>${row.nextOffset ? `<button data-more="${escape(file)}" data-offset="${row.nextOffset}">下一段</button>` : ''}`;
    if (!dialog.open) dialog.showModal();
  } catch(e) { error=e.message;render(); }
}
document.addEventListener('click', event => {
  const el = event.target.closest('button'); if (!el) return;
  if (el.dataset.action === 'close-flow') { closeFlow(); return; }
  if (el.dataset.close) { document.getElementById(el.dataset.close).close(); return; }
  if (working) return;
  if (el.dataset.dir) { browse(document.querySelector('#picker').dataset.key, el.dataset.dir); return; }
  if (el.dataset.file) { document.getElementById(document.querySelector('#picker').dataset.key).value = el.dataset.file; document.querySelector('#picker').close(); return; }
  if (el.dataset.read) { viewInput(el.dataset.read); return; }
  if (el.dataset.more) { viewInput(el.dataset.more, Number(el.dataset.offset)); return; }
  if (el.dataset.step) { current = Number(el.dataset.step); error = ''; render(); return; }
  if (el.dataset.image) {
    const dialog = document.querySelector('#viewer'); dialog.innerHTML = `<div class="dialog-head"><strong>本次生成图纸</strong><button data-close="viewer">关闭</button></div><img alt="本次生成图纸" src="${assetURL(el.dataset.image)}">`; dialog.showModal(); return;
  }
  const action = el.dataset.action; if (!action) return;
  if (action === 'browse') { browse(el.dataset.key); return; }
  if (action === 'previous') { current--; render(); return; }
  const draft = document.querySelector('#allow-draft')?.checked; const note = document.querySelector('#review-note')?.value || '';
  perform(async () => {
    if (['display-board', 'new'].includes(action)) { project = await api({ action: 'create', ...(action === 'display-board' ? { caseId: 'display-board' } : { label: '新设计项目' }) }); current = 1; localStorage.setItem('eda-flow-project', project.id); }
    if (action === 'save-input') {
      await saveCurrentInputs();
    }
    if (action === 'pdf') {
      const path = document.querySelector('#pdf').value.trim(); if (!path) throw new Error('请选择规格书 PDF。');
      const datasheets = [...(project.inputs.datasheets || []), { path, mpn: document.querySelector('#mpn').value, binding: document.querySelector('#binding').value }];
      project = await api({ action: 'update', projectId: project.id, stage: current, inputs: { datasheets } });
    }
    if (action === 'save-plan') project = await api({ action: 'update', projectId: project.id, stage: current, plan: JSON.parse(document.querySelector('#plan').value), source: 'ai' });
    if (action === 'execute') { await saveCurrentInputs(); await api({ action: 'execute', projectId: project.id, stage: current }); }
    if (action === 'cancel') await api({ action: 'cancel', projectId: project.id });
    if (action === 'next') { if (!project.stages[current - 1].confirmed) project = await api({ action: 'confirm', projectId: project.id, stage: current, allowDraft: draft, note }); if (current < 7) current++; }
    if (action === 'replay') { project.busy = true; render(); const data = await api({ action: 'replay', projectId: project.id }); project.replay = data; }
  });
});
let resizeFrame;
window.addEventListener('resize', () => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => app.querySelector('.step.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && embedded && !document.querySelector('dialog[open]')) { event.preventDefault(); closeFlow(); }
});
document.addEventListener('change', event => {
  if (event.target.id === 'projects' && event.target.value) {
    const value = event.target.value;
    perform(async () => {
      project = await api(value === '__new' ? { action: 'create', label: '新设计项目' } : value === '__display' ? { action: 'create', caseId: 'display-board' } : { action: 'open', projectId: value });
      current = 1; localStorage.setItem('eda-flow-project', project.id);
    });
  }
  if (event.target.name === 'source') perform(async () => { project = await api({ action: 'update', projectId: project.id, stage: current, source: event.target.value }); });
});
try {
  bootstrap = await api();
  const saved = localStorage.getItem('eda-flow-project'); if (bootstrap.projects.some(p => p.id === saved)) project = await api({ action: 'open', projectId: saved });
  render(); schedule();
} catch (e) { app.innerHTML = `<div class="loading error">${escape(e.message)}</div>`; }
