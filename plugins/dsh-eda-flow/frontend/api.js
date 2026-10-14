import { useEffect, useRef, useState } from 'react';
const BASE = '/api/eda-flow/';
export async function api(body) {
  const response = await fetch(BASE + (body ? 'action' : 'bootstrap'), body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' });
  const value = await response.json();
  if (!response.ok || !value.ok) throw Object.assign(new Error(value.error || `请求失败：${response.status}`), { info: value.errorInfo });
  return value.value;
}
export const assetURL = (id, stage, file, download = false) => BASE + 'asset?' + new URLSearchParams({ projectId: id, stage, path: file, ...(download ? { download: '1' } : {}) });
const EMPTY_DATA = { components: [], pins: [], nets: [], tracks: [], footprints: [], files: [], models: [], materials: { source_native: [] }, counts: {} };
export function fieldsOf(raw) {
  const i = raw.inputs || {}, c = i.constraints || {}, example = raw.caseId === 'display-board';
  return { requirements: i.requirements || '', outline: c.outlinePolicy || '', mount: c.packagePolicy || '', rules: c.rulePolicy || '', basis: i.basis || '', acceptance: i.acceptance || '', power: i.power || '', interfaces: i.interfaces || '', manufacture: '', routing: '', cadLayers: '', plating: '', review: i.review || '',
    ...(example ? { power: '按原工程供电与网络定义', interfaces: 'DISP 接口；DIN、CLK、STB、RCV', manufacture: '待工程师确认', routing: '背面 B.Cu', cadLayers: '2 个铜层（工程表示）', acceptance: '连接、参数、符号与页面布局一致；PCB 位置与铜图元一致；工程依赖可解析。' } : {}), ...i.ui };
}
function viewProject(raw) {
  if (!raw) return { id: '', name: '选择项目', template: false, fields: {}, notes: {}, statuses: Array(7).fill('pending'), confirmed: Array(7).fill(false), errors: {}, uploads: [], events: [], messages: {}, stages: [], dirty: false };
  return { ...raw, name: /^(R6|显示板默认流程)$/.test(raw.label) ? '显示板' : raw.label, template: raw.caseId === 'display-board', fields: fieldsOf(raw), notes: raw.inputs.stageNotes || {}, statuses: raw.stages.map(s => s.status), confirmed: raw.stages.map(s => s.confirmed), errors: Object.fromEntries(raw.stages.map(s => [s.id, s.errorInfo?.code || (s.error ? 'model' : undefined)])), uploads: raw.uploads || [], messages: raw.messages || {}, events: [...(raw.events || [])].reverse().map((e,i) => ({ ...e, id: e.id || i, title: e.title || `${e.stage} · ${e.outcome || '记录'}`, kind: e.kind || e.source || '执行' })) };
}
export function useFlow() {
  const [raw, R] = useState(null), [projects, PS] = useState([]), [data, D] = useState(EMPTY_DATA), [model, MD] = useState(null), [error, E] = useState(''), [pending, P] = useState(false), [drafts, DF] = useState({});
  const active = useRef(null), rawRef = useRef(null), dataRevision = useRef(''), lock = useRef(false);
  const accept = value => { if (active.current !== value.id) return; rawRef.current = value; R(value); MD(value.model || null); };
  const refreshList = async () => { const boot = await api(); PS(boot.projects.map(x => ({ ...x, name: /^(R6|显示板默认流程)$/.test(x.label) ? '显示板' : x.label, template: x.caseId === 'display-board', created: new Date(x.createdAt || x.updatedAt).toLocaleString('zh-CN') }))); MD(boot.model); return boot; };
  const refresh = async (id = active.current) => {
    if (!id) return;
    const next = await api({ action: 'open', projectId: id }); accept(next);
    const signature = `${id}:${next.revision}:${next.stages.map(s => s.outputHash || s.status).join()}`;
    if (signature !== dataRevision.current) { const value = await api({ action: 'data', projectId: id }); if (active.current === id) { D(value); dataRevision.current = signature; } }
  };
  const select = async id => { active.current = id; localStorage.setItem('eda-flow-active-project', id); D(EMPTY_DATA); dataRevision.current = ''; R(null); await refresh(id); };
  useEffect(() => {
    let disposed = false;
    (async () => {
      const fragment = new URLSearchParams(location.hash.slice(1)), key = fragment.get('session');
      if (key) { const response = await fetch(BASE + 'session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key }) }); if (!response.ok) throw new Error('窗口连接已失效，请从 Harness 重新打开。'); history.replaceState(null, '', location.pathname + location.search); }
      const boot = await refreshList(); if (disposed) return;
      const saved = localStorage.getItem('eda-flow-active-project'), id = boot.projects.find(p => p.id === saved)?.id || boot.projects[0]?.id;
      if (id) await select(id);
    })().catch(e => E(e.message));
    let polling = false;
    const interval = setInterval(async () => { if (polling || disposed || lock.current) return; polling = true; try { await refresh(); if (!active.current) await refreshList(); } catch (e) { E(e.message); } finally { polling = false; } }, 1800);
    return () => { disposed = true; clearInterval(interval); };
  }, []);
  const perform = async fn => { if (lock.current) return; lock.current = true; P(true); E(''); try { return await fn(); } catch (e) { E(e.message); throw e; } finally { lock.current = false; P(false); } };
  const update = (id, fn) => DF(all => { const old = all[id] || { fields: {}, notes: {} }; const base = viewProject(rawRef.current); base.fields = { ...base.fields, ...old.fields }; base.notes = { ...base.notes, ...old.notes }; const modified = fn(structuredClone(base)); return { ...all, [id]: { fields: modified.fields, notes: modified.notes, dirty: true } }; });
  const save = async stage => {
    const current = rawRef.current, d = drafts[current?.id]; if (!current) throw new Error('请先新建或选择项目。');
    const changes = {}, previous = fieldsOf(current);
    for (const [key,value] of Object.entries(d?.fields || {})) if (value !== previous[key]) {
      const constraint = { outline: 'outlinePolicy', mount: 'packagePolicy', rules: 'rulePolicy' }[key];
      if (constraint) changes.constraints = { ...current.inputs.constraints, ...changes.constraints, [constraint]: value };
      else if (['requirements','basis','acceptance','power','interfaces','review'].includes(key)) changes[key] = value;
      else changes.ui = { ...current.inputs.ui, ...changes.ui, [key]: value };
    }
    if (d?.notes[stage] !== undefined && d.notes[stage] !== current.inputs.stageNotes?.[stage]) changes.stageNotes = { [stage]: d.notes[stage] };
    const next = await api({ action: 'update', projectId: current.id, stage, inputs: changes, expectedRevision: current.revision });
    accept(next); DF(all => { const copy = { ...all }; delete copy[current.id]; return copy; }); return next;
  };
  const action = async (body, saveFirst) => perform(async () => { const id = active.current; if (saveFirst) await save(body.stage); const result = await api({ ...body, projectId: id }); if (result?.stages) accept(result); else await refresh(id); return result; });
  const create = (name, template) => perform(async () => { const result = await api({ action: 'create', label: name, caseId: template ? 'display-board' : null }); await refreshList(); await select(result.id); return result; });
  const rename = name => perform(async () => { const value = await api({ action: 'rename', projectId: active.current, label: name }); accept(value); await refreshList(); });
  const upload = (files, stage, binding) => perform(async () => { await save(stage); const form = new FormData(); form.set('projectId', active.current); form.set('stage', stage); form.set('binding', binding); for (const file of files) form.append('files', file); const response = await fetch(BASE + 'upload', { method: 'POST', body: form }); const value = await response.json(); if (!value.ok) throw new Error(value.error); accept(value.value); });
  const base = viewProject(raw), d = drafts[base.id];
  const p = d ? { ...base, fields: { ...base.fields, ...d.fields }, notes: { ...base.notes, ...d.notes }, dirty: d.dirty } : base;
  return { p, data, projects, model, error, pending, update, action, select: id => perform(() => select(id)), create, rename, upload, save: stage => perform(() => save(stage)), clearError: () => E('') };
}
