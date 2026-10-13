const app = document.querySelector('#app');
let bootstrap, project, current = 1, error = '', working = false, poll = null, renderedKey = '';
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
  return `<aside><div class="project-info">当前工程</div><select id="projects" aria-label="选择工程"><option value="">选择工程</option>${bootstrap.projects.map(p => `<option value="${p.id}" ${project?.id === p.id ? 'selected' : ''}>${escape(p.label)}</option>`).join('')}</select>
    <nav class="step-nav" aria-label="工程步骤">${bootstrap.stages.map(s => { const state = project?.stages[s.id - 1]; return `<button class="step ${current === s.id && project ? 'active' : ''}" data-step="${s.id}" ${!project ? 'disabled' : ''}><span class="number">${state?.confirmed ? '✓' : s.id}</span><span>${s.title}<small>${labels[state?.status] || '等待创建项目'}${state?.confirmed ? ' · 已确认' : ''}</small></span></button>`; }).join('')}</nav>
    <div class="new-actions">${button('加载 R6 默认方案', 'r6')}${button('复原已有工程', 'restore')}${button('新建设计', 'new')}</div><p class="hint">资料逐步补充。每一步的处理输出交给本机工具执行，文件与检查结果留在本次项目中。</p></aside>`;
}
function section(title, content, right = '') { return `<section class="section"><div class="section-head"><h3>${title}</h3>${right}</div><div class="section-body">${content}</div></section>`; }
function pathField(label, key, value) { return `<label for="${key}">${label}</label><div class="file-row"><input id="${key}" data-input="${key}" value="${escape(value)}" placeholder="运行 Harness 的电脑上的文件路径">${button('选择文件', 'browse', `data-key="${key}"`)}</div>`; }
function inputsUI(s) {
  let form = `<p>${escape(s.input)}</p>`;
  if (s.id === 1) form += `<label for="requirements">需求与目标</label><textarea id="requirements">${escape(project.inputs.requirements)}</textarea><div class="two">${[['layerPolicy', '板层要求'], ['packagePolicy', '贴片 / 插件与封装要求'], ['outlinePolicy', '板框与机械要求'], ['rulePolicy', '规则与制造要求']].map(([key, label]) => `<div><label for="${key}">${label}</label><textarea id="${key}" data-constraint="${key}" placeholder="未定义时留空，不采用默认设计偏好">${escape(project.inputs.constraints?.[key] || '')}</textarea></div>`).join('')}</div>`;
  if (s.id === 2) form += pathField('原始原理图', 'schematic', project.inputs.schematic) + pathField('原始 PCB', 'pcb', project.inputs.pcb) + pathField('原始工程文件（可选）', 'nativeProject', project.inputs.nativeProject) + `<p class="help">新设计可不提供原始工程。当前直接提取器支持单页、无层级 Altium 源文件；其他格式保留缺项。</p>`;
  if (s.id === 3) form += `<div class="two"><div><label>准确型号</label><input id="mpn" placeholder="按器件资料填写"></div><div><label>位号与封装</label><input id="binding" placeholder="如 U1 / LQFP-48"></div></div>` + pathField('补充 PDF 规格书', 'pdf', '') + `<div class="buttons">${button('添加此规格书', 'pdf')}</div>` + (project.inputs.datasheets?.length ? `<ul>${project.inputs.datasheets.map(x => `<li>${escape(x.mpn)} · ${escape(x.binding)} · ${escape(x.path)}</li>`).join('')}</ul>` : '<p class="help">尚未提供规格书。可以先使用原工程参数，保留资料缺项。</p>');
  if (s.id > 3) form += `<table><thead><tr><th>上游步骤</th><th>状态</th><th>资料</th></tr></thead><tbody>${project.stages.filter(x => x.id < s.id).map(x => `<tr><td>${x.title}</td><td>${labels[x.status]}${x.confirmed ? '，已确认' : ''}</td><td>${x.files?.length || 0} 个文件</td></tr>`).join('')}</tbody></table>`;
  if (s.id <= 2) form += `<div class="buttons">${button('保存输入', 'save-input', project.busy ? 'disabled' : '')}</div>`;
  form += `<details><summary>缺少资料时怎么获取</summary><p>${escape(s.obtain)}</p></details>`;
  return form;
}
function resultUI(s) {
  if (s.status === 'running') return `<div class="stage-progress"></div><p>本机工具正在执行 ${escape(s.title)}。完成后将显示本次产生的文件。</p><p class="help">${escape(project.progress)}<br>切换页面不会重新发起执行。${button('取消本步', 'cancel')}</p>`;
  if (!s.result || s.status !== 'done') return `<div class="empty"><strong>${labels[s.status]}</strong><span>${s.status === 'pending' ? '点击“执行本步”，从当前输入生成结果。' : '原结果仍留档；当前阶段需要重新执行。'}</span></div>`;
  const images = s.files.filter(f => /previews\/[^/]+\.(svg|png)$/.test(f.path));
  const imageNames = f => f.path.includes('PCB_front') ? '本次 PCB 正面' : f.path.includes('PCB_back') ? '本次 PCB 背面' : f.path.includes('PCB_3D') ? '本次 3D 模型' : '本次原理图';
  const keyfiles = s.files.filter(f => /\.(html|zip|kicad_pro|kicad_sch|kicad_pcb|csv|pdf)$/.test(f.path) || /(?:result|verification|project-content|delivery-manifest)\.json$/.test(f.path));
  return `<p>${escape(s.result.summary)}</p><p class="help">输出来源：${s.source === 'preset' ? 'R6 预置处理方案' : s.source === 'ai' ? '本次 Harness AI 输出' : '本机工具 / 自定义处理输出'}；结果来自本次执行。</p>
    ${s.result.table ? `<details open><summary>查看本步数据（${s.result.table.rows.length} 行）</summary><div style="overflow:auto;max-height:360px"><table><thead><tr>${s.result.table.columns.map(x => `<th>${escape(x)}</th>`).join('')}</tr></thead><tbody>${s.result.table.rows.map(row => `<tr>${row.map(x => `<td>${escape(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>` : ''}
    ${images.length ? `<div class="previews">${images.map(f => `<figure class="preview"><button data-image="${escape(f.path)}" aria-label="全屏查看${imageNames(f)}"><img src="${assetURL(f.path)}" alt="${imageNames(f)}"></button><figcaption><span>${imageNames(f)}</span><a href="${assetURL(f.path, current, true)}">下载</a></figcaption></figure>`).join('')}</div>` : ''}
    ${s.gaps.length ? `<h4>仍需补充或确认</h4><ul class="gap-list">${s.gaps.map(g => `<li>${escape(g)}</li>`).join('')}</ul>` : ''}
    ${s.assumptions?.length ? `<h4>沿用的假设</h4><ul>${s.assumptions.map(x => `<li>${escape(x)}</li>`).join('')}</ul>` : ''}
    <details ${images.length ? '' : 'open'}><summary>本次生成文件（${s.files.length}）</summary><div class="artifacts">${keyfiles.map(f => `<a class="artifact" href="${assetURL(f.path, current, true)}"><span>${escape(f.path)}</span><small>${(f.bytes / 1024).toFixed(1)} KB</small></a>`).join('')}</div></details>
    <details><summary>查看本次检查数据</summary><pre>${pretty(s.result)}</pre></details>
    ${!s.confirmed ? `<label class="inline-check"><input type="checkbox" id="allow-draft"><span>我已查看缺项和假设，允许带缺项进入下一步草稿。此操作不表示通过 1:1 验收或公司签核。</span></label><label for="review-note">工程师意见（可选）</label><input id="review-note" placeholder="记录已确认内容或后续需要补充的资料">` : `<p class="notice">已记录工程师确认${s.confirmation?.draft ? '，后续保持草稿状态' : ''}。</p>`}`;
}
function render() {
  const s = project?.stages[current - 1];
  const key = [project?.id, current, project?.revision, s?.status].join(':');
  const draft = key === renderedKey ? [...app.querySelectorAll('input[id],textarea[id]')].map(el => ({ id: el.id, value: el.value, checked: el.checked })) : [];
  const head = `<header class="top"><div class="brand"><svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 4h24v24H4zM9 10h7v6h7M9 22h7v-6M22 10v-6"/><circle cx="9" cy="10" r="2"/><circle cx="9" cy="22" r="2"/><circle cx="23" cy="16" r="2"/></svg><div><h1>原理图与 PCB 流程</h1><small>资料输入 · 本机执行 · 阶段确认</small></div></div><span class="local">${bootstrap.aiEnabled ? '实时 AI 已启用' : '本机模式 · 不调用模型'}</span></header>`;
  const welcome = `<div class="welcome"><h2>从每一步的输入，走到可编辑工程</h2><p class="sub">选择工程类型，或载入 R6 默认方案。默认方案预填输入和处理输出；图纸、BOM、PCB 与检查报告由本机逐步生成。</p><div class="entry-grid"><article class="entry"><h3>R6 默认复原</h3><p>带着明确的输入走完整个流程。无需模型额度，从原始资料实际生成 R6。</p>${button('加载默认方案', 'r6', 'class="primary"')}</article><article class="entry"><h3>复原已有工程</h3><p>逐步添加原工程与器件资料，检查与原始设计的差异。</p>${button('创建复原项目', 'restore')}</article><article class="entry"><h3>新建设计</h3><p>从需求和指定器件开始，明确层数、封装与机械约束。</p>${button('创建新设计', 'new')}</article></div><p class="help">KiCad 输出。工程工作台无需安装。默认流程的成功不代表 AI 独立复原或原生完整 1:1 通过。</p></div>`;
  let main = welcome;
  if (s) main = `<div class="headline"><div><h2>${current}. ${s.title}</h2><p class="sub">${escape(project.label)} / ${project.mode === 'new' ? '新设计' : '原工程复原'} / KiCad</p></div><span class="badge ${s.status}">${labels[s.status]}</span></div>
    ${project.caseId === 'r6' ? '<div class="notice">R6 默认方案已载入。每步执行后才会产生本次结果；默认方案不消耗模型额度。</div>' : ''}
    ${section('本步需要的输入', inputsUI(s))}
    ${section('本步处理输出', `<div class="source-select">${[['preset', '使用 R6 默认输出'], ['ai', '由 AI 生成输出'], ['manual', '自定义处理输出'], ['local', '本机资料处理']].filter(([v]) => (v !== 'preset' || project.caseId === 'r6') && (v !== 'local' || current < 4)).map(([value, label]) => `<label><input type="radio" name="source" value="${value}" ${s.source === value ? 'checked' : ''} ${project.busy || value === 'ai' && !project.aiEnabled ? 'disabled' : ''}>${label}</label>`).join('')}</div><div class="plan-summary">${escape(s.plan.summary)}</div>${!project.aiEnabled ? '<p class="help">本机实时 AI 已禁用。内网配置模型后可启用，默认流程不受影响。</p>' : ''}<details><summary>展开处理方案与参数</summary><textarea id="plan" class="code" aria-label="处理输出 JSON">${pretty(s.plan)}</textarea><div class="buttons">${button('保存处理输出', 'save-plan', project.busy ? 'disabled' : '')}</div></details>`)}
    ${s.error ? `<div class="error"><strong>本步未完成</strong><br>${escape(s.error)}<br><br>${escape(s.obtain)}</div>` : ''}
    ${section('本次执行结果', resultUI(s), s.output ? `<span class="help">${s.files?.length || 0} 个文件</span>` : '')}
    ${current === 7 ? section('空目录重放', `<p>使用相同原始资料和本轮默认方案，在新目录重新执行全部步骤。不会读取旧 R6 成品作为生成输入。</p>${button('执行空目录重放', 'replay', project.busy || project.stages.some(x => !x.confirmed || x.status !== 'done') ? 'disabled' : '')}${project.replay ? `<p class="notice">${project.replay.match ? '重放工程内容一致' : '重放存在差异'}，比较 ${project.replay.compared} 个文件。</p><pre>${pretty(project.replay)}</pre>` : ''}`) : ''}`;
  app.innerHTML = head + `<div class="layout">${nav()}<main>${error ? `<div role="alert" class="error">${escape(error)}</div>` : ''}${main}</main></div>` + (s ? `<footer class="footer"><small>${project.modelRequests === 0 ? '本项目尚未发起模型调用' : `AI 阶段请求 ${project.modelRequests} 次`}<br>修改上游输入后，相关结果需要重新执行。</small><div class="buttons">${current > 1 ? button('上一步', 'previous') : ''}${button(s.status === 'done' ? '重新执行本步' : '执行本步', 'execute', `class="primary" ${project.busy || working ? 'disabled' : ''}`)}${button(current === 7 ? '确认本步结果' : '确认并进入下一步', 'next', s.status !== 'done' || project.busy || working ? 'disabled' : '')}</div></footer>` : '');
  for (const saved of draft) { const field = document.getElementById(saved.id); if (field) { field.value = saved.value; field.checked = saved.checked; } }
  renderedKey = key;
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
document.addEventListener('click', event => {
  const el = event.target.closest('button'); if (!el) return;
  if (el.dataset.close) { document.getElementById(el.dataset.close).close(); return; }
  if (el.dataset.dir) { browse(document.querySelector('#picker').dataset.key, el.dataset.dir); return; }
  if (el.dataset.file) { document.getElementById(document.querySelector('#picker').dataset.key).value = el.dataset.file; document.querySelector('#picker').close(); return; }
  if (el.dataset.step) { current = Number(el.dataset.step); error = ''; render(); return; }
  if (el.dataset.image) {
    const dialog = document.querySelector('#viewer'); dialog.innerHTML = `<div class="dialog-head"><strong>本次生成图纸</strong><button data-close="viewer">关闭</button></div><img alt="本次生成图纸" src="${assetURL(el.dataset.image)}">`; dialog.showModal(); return;
  }
  const action = el.dataset.action; if (!action) return;
  if (action === 'browse') { browse(el.dataset.key); return; }
  if (action === 'previous') { current--; render(); return; }
  const draft = document.querySelector('#allow-draft')?.checked; const note = document.querySelector('#review-note')?.value || '';
  perform(async () => {
    if (['r6', 'new', 'restore'].includes(action)) { project = await api({ action: 'create', ...(action === 'r6' ? { caseId: 'r6' } : { mode: action, label: action === 'new' ? '新设计项目' : '工程复原项目' }) }); current = 1; localStorage.setItem('eda-flow-project', project.id); }
    if (action === 'save-input') {
      const inputs = current === 1 ? { requirements: document.querySelector('#requirements').value, constraints: { ...project.inputs.constraints, ...Object.fromEntries([...document.querySelectorAll('[data-constraint]')].map(e => [e.dataset.constraint, e.value])) } } : Object.fromEntries([...document.querySelectorAll('[data-input]')].map(e => [e.dataset.input, e.value.trim()]));
      project = await api({ action: 'update', projectId: project.id, stage: current, inputs });
    }
    if (action === 'pdf') {
      const path = document.querySelector('#pdf').value.trim(); if (!path) throw new Error('请选择规格书 PDF。');
      const datasheets = [...(project.inputs.datasheets || []), { path, mpn: document.querySelector('#mpn').value, binding: document.querySelector('#binding').value }];
      project = await api({ action: 'update', projectId: project.id, stage: current, inputs: { datasheets } });
    }
    if (action === 'save-plan') project = await api({ action: 'update', projectId: project.id, stage: current, plan: JSON.parse(document.querySelector('#plan').value), source: document.querySelector('[name=source]:checked').value });
    if (action === 'execute') await api({ action: 'execute', projectId: project.id, stage: current });
    if (action === 'cancel') await api({ action: 'cancel', projectId: project.id });
    if (action === 'next') { if (!project.stages[current - 1].confirmed) project = await api({ action: 'confirm', projectId: project.id, stage: current, allowDraft: draft, note }); if (current < 7) current++; }
    if (action === 'replay') { project.busy = true; render(); const data = await api({ action: 'replay', projectId: project.id }); project.replay = data; }
  });
});
document.addEventListener('change', event => {
  if (event.target.id === 'projects' && event.target.value) perform(async () => { project = await api({ action: 'open', projectId: event.target.value }); current = 1; localStorage.setItem('eda-flow-project', project.id); });
  if (event.target.name === 'source') perform(async () => { project = await api({ action: 'update', projectId: project.id, stage: current, source: event.target.value }); });
});
try {
  bootstrap = await api();
  const saved = localStorage.getItem('eda-flow-project'); if (bootstrap.projects.some(p => p.id === saved)) project = await api({ action: 'open', projectId: saved });
  render(); schedule();
} catch (e) { app.innerHTML = `<div class="loading error">${escape(e.message)}</div>`; }
