import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { schematicChanges } from './schematic-changes.js';

// Only these business operations are reachable from the authenticated UI.
export const ACTIONS = {
  selection: { info: 'megmeet_get_catalog_info', parse: 'megmeet_parse_requirements', search: 'megmeet_search_products', validate: 'megmeet_validate_candidate', report: 'megmeet_generate_solution_report', export: 'megmeet_export_report' },
  pcb: { capabilities: 'pcb_get_capabilities', guide: 'pcb_component_guide', inspect: 'pcb_inspect_project', review: 'pcb_review_project', snapshot: 'pcb_review_snapshot', export: 'pcb_export_report', watch: 'pcb_get_watch_status', setWatch: 'pcb_set_watch' },
  schematic: { capabilities: 'schematic_capabilities', begin: 'schematic_begin', read: 'schematic_read_target', define: 'schematic_define_target', inspect: 'schematic_inspect', compare: 'schematic_compare', prepare: 'schematic_prepare', verify: 'schematic_verify', apply: 'schematic_apply', rollback: 'schematic_rollback' },
};
const types = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.html': 'text/html; charset=utf-8', '.kicad_sch': 'text/plain; charset=utf-8' };
const exact = (v, keys) => { if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !keys.includes(k))) throw new Error('不支持的请求参数。'); };
export const within = (root, file) => { const r = path.relative(root, file); return r === '' || (!r.startsWith('..' + path.sep) && r !== '..' && !path.isAbsolute(r)); };
const readJSON = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const uuid = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);

export class Actions {
  constructor(service, execute) { this.service = service; this.execute = execute; this.confirmations = new Map(); }
  async fileAsset(file) {
    if (typeof file !== 'string' || !path.isAbsolute(file)) return null;
    const type = types[path.extname(file).toLowerCase()];
    if (!type) return null;
    return { name: path.basename(file), url: await this.service.asset(file, type), path: file };
  }
  async reportAsset(htmlPath, jsonPath) {
    const report = await readJSON(jsonPath);
    let html = await fs.readFile(htmlPath, 'utf8');
    for (const source of report.sources ?? []) {
      if (!source.file || !path.isAbsolute(source.file)) continue;
      const link = path.relative(path.dirname(htmlPath), source.file).replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/');
      const asset = await this.fileAsset(source.file);
      if (asset) html = html.split(`href="${link.replace(/&/g, '&amp;').replace(/'/g, '&#39;')}"`).join(`href="${asset.url}"`);
    }
    const result = await this.fileAsset(htmlPath);
    const stored = this.service.assets.get(new URL(result.url, 'http://local').searchParams.get('id'));
    // Only this freshly exported native report gets its local filtering script enabled.
    // It remains an opaque sandbox without access to the DSH document or network APIs.
    const hashes = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => `'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`);
    stored.presentation = Buffer.from(html);
    stored.policy = `sandbox allow-scripts; default-src 'none'; script-src ${hashes.join(' ') || "'none'"}; style-src 'unsafe-inline'; img-src data: 'self'`;
    return result;
  }
  async decorate(group, action, value, signal) {
    value = structuredClone(value);
    const artifacts = [];
    for (const key of ['htmlPath', 'jsonPath', 'markdownPath', 'pdf', 'report']) if (typeof value[key] === 'string') {
      const asset = group === 'selection' && action === 'export' && key === 'htmlPath' ? await this.reportAsset(value.htmlPath, value.jsonPath) : await this.fileAsset(value[key]); if (asset) artifacts.push({ key, ...asset });
    }
    if (group === 'pcb' && action === 'export') for (const key of ['json', 'markdown']) { const asset = await this.fileAsset(value[key]); if (asset) artifacts.push({ key, ...asset }); }
    if (value.preview?.image) artifacts.push({ key: 'preview', ...await this.fileAsset(value.preview.image) });
    if (group === 'selection') {
      for (const s of value.sources ?? []) {
        const local = s.file || s.links?.find(l => path.isAbsolute(l.href?.split('#')[0] || ''))?.href?.split('#')[0];
        if (local) {
          // Sources returned by the installed catalog are trusted host-selected files.
          try { s.previewUrl = (await this.fileAsset(local))?.url; } catch (e) { s.previewError = e.message; }
        }
      }
    }
    let views;
    if (group === 'schematic' && action === 'inspect' && value.file) {
      const directory = await this.previewDir();
      views = { sheet: await this.service.schematicView(value.file, directory, signal) };
    }
    if (group === 'schematic' && action === 'verify') {
      const record = await this.task(value.taskId);
      const directory = await this.previewDir();
      const before = await fs.readFile(record.baseline, 'utf8'), after = await fs.readFile(record.candidate, 'utf8');
      if (createHash('sha256').update(after).digest('hex') !== value.candidateHash) throw new Error('候选在验证后发生变化，请重新验证。');
      value.changeSet = schematicChanges(before, after);
      views = {
        before: await this.service.schematicView(record.baseline, path.join(directory, 'before'), signal),
        after: await this.service.schematicView(record.candidate, path.join(directory, 'after'), signal),
      };
      if (before !== await fs.readFile(record.baseline, 'utf8') || after !== await fs.readFile(record.candidate, 'utf8')) throw new Error('图纸在生成对比期间变化，请重新验证。');
      artifacts.push({ key: 'candidate', ...await this.fileAsset(record.candidate) });
    }
    return { ...value, artifacts, ...(views ? { views } : {}) };
  }
  async previewDir() { await this.service.init(); return fs.mkdtemp(path.join(this.service.config.workDirectory, 'view-')); }
  async call(input, signal) {
    exact(input, ['group', 'action', 'args', 'confirmation']);
    const { group, action, args = {} } = input;
    const name = Object.hasOwn(ACTIONS, group) && Object.hasOwn(ACTIONS[group], action) && ACTIONS[group][action];
    if (!name) throw new Error('不支持的业务操作。');
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('业务参数必须为对象。');
    if (['info', 'capabilities', 'watch'].includes(action)) return this.decorate(group, action, await this.execute(name, args, signal), signal);
    if (group === 'schematic' && ['apply', 'rollback'].includes(action)) {
      const c = this.confirmations.get(input.confirmation); this.confirmations.delete(input.confirmation);
      if (!c || c.expires < Date.now() || c.action !== action || c.taskId !== args.taskId || (action === 'apply' && c.token !== args.verificationToken)) throw new Error('请先核对工程与修改内容，再确认本次操作。');
    }
    const key = group === 'schematic' ? `native-schematic-${args.taskId || 'begin'}` : `${group}-${action}-${randomUUID()}`;
    return this.service.job(key, LABELS[name] || name, ['调用插件处理', '整理结果与文件'], async step => {
      const value = await step(0, () => this.execute(name, args, signal));
      // Clear every old confirmation as soon as the target/candidate changes.
      if (group === 'schematic' && ['define', 'prepare', 'apply', 'rollback'].includes(action)) {
        for (const [id, c] of this.confirmations) if (c.taskId === args.taskId) this.confirmations.delete(id);
      }
      return step(1, () => this.decorate(group, action, value, signal));
    });
  }
  async task(id) {
    if (!uuid(id) || !this.service.config.syncWorkDirectory) throw new Error('需要有效任务 ID 和原理图任务目录配置。');
    const root = await fs.realpath(this.service.config.syncWorkDirectory);
    const directory = await fs.realpath(path.join(root, id));
    if (!within(root, directory)) throw new Error('任务超出配置目录。');
    const t = await readJSON(path.join(directory, 'task.json'));
    if (t.id !== id) throw new Error('任务身份不一致。');
    const candidate = path.resolve(directory, 'candidate', t.relative), baseline = path.resolve(directory, 'baseline', t.relative);
    if (!within(directory, candidate) || !within(directory, baseline)) throw new Error('任务路径无效。');
    const files = await fs.readdir(directory);
    const applied = await readJSON(path.join(directory, 'applied.json')).catch(() => null);
    const rolledBack = files.some(f => f.startsWith('rollback-'));
    const verifications = await Promise.all(files.filter(f => /^verified-[a-f0-9-]+\.json$/.test(f)).map(f => readJSON(path.join(directory, f))));
    verifications.sort((a, b) => String(b.checkedAt).localeCompare(String(a.checkedAt)));
    return { taskId: id, current: t.current, candidate, baseline, createdAt: t.createdAt, target: { kind: t.target.kind, revision: t.target.hash, path: t.target.path, text: t.target.text }, contract: t.contract, contractRevision: t.contractHash, applied, rolledBack, verification: verifications[0] ?? null };
  }
  async tasks() {
    const root = this.service.config.syncWorkDirectory;
    if (!root) return [];
    const names = await fs.readdir(root, { withFileTypes: true }).catch(e => { if (e.code === 'ENOENT') return []; throw e; });
    const rows = [];
    for (const d of names.filter(d => d.isDirectory() && uuid(d.name))) {
      try { const t = await this.task(d.name); rows.push({ taskId: t.taskId, current: t.current, createdAt: t.createdAt, kind: t.target.kind, state: t.rolledBack ? 'restored' : t.applied ? 'applied' : 'candidate' }); } catch { /* Incomplete task directories are not selectable. */ }
    }
    return rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 100);
  }
  async confirmation(input) {
    exact(input, ['action', 'taskId', 'verificationToken']);
    if (!['apply', 'rollback'].includes(input.action)) throw new Error('不支持的确认操作。');
    const task = await this.task(input.taskId);
    if (input.action === 'apply' && (task.applied || !task.verification?.canApply || input.verificationToken !== task.verification.token)) throw new Error('需要最新通过验证的候选，且任务尚未写回。');
    if (input.action === 'rollback' && (!task.applied || task.rolledBack)) throw new Error('该任务当前没有可回退的写回。');
    for (const [id, c] of this.confirmations) if (c.expires < Date.now()) this.confirmations.delete(id);
    const id = randomUUID();
    this.confirmations.set(id, { taskId: input.taskId, action: input.action, token: input.verificationToken, expires: Date.now() + 120000 });
    return { id, action: input.action, current: task.current, candidate: task.candidate, targetKind: task.target.kind, contract: task.contract, verification: task.verification, warning: '请先保存并关闭 KiCad 工程。写回会备份原文件；回退不会覆盖后续人工修改。' };
  }
  async files(directory = '') {
    if (typeof directory !== 'string') throw new Error('目录参数无效。');
    const root = await fs.realpath(this.service.config.workspaceRoot);
    const actual = await fs.realpath(path.resolve(root, directory));
    if (!within(root, actual)) throw new Error('只能浏览已配置的工程目录。');
    const entries = await fs.readdir(actual, { withFileTypes: true });
    const files = [];
    for (const f of entries) {
      if (f.name.startsWith('.') || ['node_modules', 'workspaces', 'dsh-workbench-data'].includes(f.name) || f.isSymbolicLink()) continue;
      if (!f.isDirectory() && !['.kicad_sch', '.kicad_pcb', '.schdoc', '.pcbdoc', '.prjpcb', '.schlib', '.pdf', '.png', '.jpg', '.jpeg', '.webp', '.txt', '.md'].includes(path.extname(f.name).toLowerCase())) continue;
      const resolved = await fs.realpath(path.join(actual, f.name)); if (!within(root, resolved)) continue;
      files.push({ name: f.name, directory: f.isDirectory(), path: resolved, relative: path.relative(root, resolved) });
    }
    files.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
    return { root, directory: path.relative(root, actual), parent: actual === root ? null : path.relative(root, path.dirname(actual)), entries: files.slice(0, 400), truncated: files.length > 400 };
  }
}

export const LABELS = {
  megmeet_get_catalog_info: '读取产品资料库', megmeet_parse_requirements: '解析需求原文', megmeet_search_products: '按需求检索候选', megmeet_validate_candidate: '复核指定候选', megmeet_generate_solution_report: '生成产品方案', megmeet_export_report: '导出方案报告',
  pcb_get_capabilities: '读取评审配置', pcb_component_guide: '查询器件检查清单', pcb_inspect_project: '查询器件与网络', pcb_review_project: '执行工程评审', pcb_review_snapshot: '评审输入快照', pcb_export_report: '导出评审报告', pcb_get_watch_status: '读取监听状态', pcb_set_watch: '更新快照监听',
  schematic_capabilities: '读取原理图配置', schematic_begin: '创建原理图任务', schematic_read_target: '读取目标与证据', schematic_define_target: '保存目标检查条目', schematic_inspect: '读取原理图对象与网络', schematic_compare: '比较原理图与目标', schematic_prepare: '修改候选原理图', schematic_verify: '验证候选与 ERC', schematic_apply: '备份并写回原理图', schematic_rollback: '回退原理图写回',
};
