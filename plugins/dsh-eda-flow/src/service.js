import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { FlowError, classify } from './errors.js';
import { presentation } from './presentation.js';
import { stages, inputGroups, version } from './contracts.js';
import { hash, readJSON, writeJSON, within, inside, tree, fileChanges, sameFiles } from './io.js';
import { byteEvidence, inspectDefaultBundle, compareReaders } from './input-integrity.js';
import { PreciseTools } from './precise-tools.js';
import { executeText, textDefaults } from './text-flow.js';
import { updateProgress, modelProgress } from './progress.js';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const uuid = /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

export class Flow {
  constructor(config, ai = null, mcp = null) {
    this.config = config; this.ai = ai; this.jobs = new Map(); this.mutations = new Map(); this.createQueue = Promise.resolve();
    this.mcp = mcp || new PreciseTools(config);
    this.root = path.join(config.workDirectory || path.join(config.workspaceRoot || '.', 'eda-flow'), 'projects');
    if (!config.workspaceRoot || !inside(config.workspaceRoot, this.root)) throw new Error('任务目录必须在工程工作区内。');
  }
  dir(id) { if (!uuid.test(id || '')) throw new Error('无效项目 ID。'); return path.join(this.root, id); }
  save(project) { project.updatedAt = new Date().toISOString(); return writeJSON(path.join(this.dir(project.id), 'project.json'), project); }
  async load(id) {
    const p = await readJSON(path.join(this.dir(id), 'project.json'));
    if (!this.jobs.has(id)) for (const s of p.stages) if (s.status === 'running') { s.status = 'interrupted'; s.error = '上次进程已退出，请重新执行本步。'; }
    p.messages ||= {}; p.events ||= []; p.uploads ||= [];
    p.origin ||= p.mode === 'text-mcp' ? 'text-mcp' : 'legacy-conversion';
    if (p.mode === 'text-mcp') { p.scope = 'schematic'; p.liveHarnessValidation = 'pending'; }
    return p;
  }
  async open(id) {
    const p = await this.load(id);
    let changed = false;
    if (p.inputsBundle) {
      const current = await tree(p.inputsBundle);
      const issue = await this.inspectBundle(p, current);
      if (issue) {
        p.bundleIssue = issue;
        this.invalidate(p, issue.from, issue); changed = true;
      } else if (!p.bundleFiles) {
        // Upgrade only after the previous digest has verified the actual files.
        p.bundleFiles = current; changed = true;
      }
      if (!issue && p.bundleIssue) { delete p.bundleIssue; changed = true; }
    }
    if (p.inputFiles?.length) {
      for (const f of p.inputFiles) {
        const current = await fs.readFile(f.original).then(hash).catch(() => null);
        if (current !== f.sha256) { this.invalidate(p, f.stage, { kind: 'source-file', from: f.stage,
          files: [{ path: path.basename(f.original), kind: current === null ? 'missing' : 'changed' }],
          message: `提供的资料文件已变化或无法读取：${path.basename(f.original)}。请重新核对资料。` }); changed = true; break; }
      }
    }
    for (const s of p.stages) {
      if (!s.output) continue;
      if (s.status === 'done' && s.files) {
        const current = await tree(s.output).catch(() => []);
        const recordValid = Boolean(s.outputHash) && hash(s.files) === s.outputHash;
        if (!recordValid || !sameFiles(s.files, current)) {
          const files = fileChanges(s.files, current);
          this.invalidate(p, s.id, { kind: recordValid ? 'output-files' : 'output-record', from: s.id, files,
            message: recordValid ? `“${s.title}”的${s.id === 1 && s.source === 'human' ? '确认' : '生成'}文件已变化${this.changedNames(files)}。请返回该步重新核对并确认。` : `“${s.title}”的文件校验记录不完整或已变化，请重新确认该步。` });
          changed = true; break;
        }
      }
    }
    p.aiEnabled = this.config.allowModelCalls === true && Boolean(this.ai);
    p.busy = this.jobs.has(id); p.modelRequests = p.modelRequests || 0;
    p.progress = this.jobs.get(id)?.progress || '';
    p.phase = this.jobs.get(id)?.phase || null; p.jobType = this.jobs.get(id)?.type || null;
    const job = this.jobs.get(id);
    p.liveProgress = job ? { ...job.activity, startedAt: job.startedAt, stage: job.stage, type: job.type, cancelling: Boolean(job.cancelling), recent: job.recentActivity || [] } : null;
    p.model = this.ai?.selection?.() || null;
    p.inputCatalog = await this.inputIndex(p, 1);
    if (changed && !p.busy) await this.save(p);
    return p;
  }
  async list() {
    await fs.mkdir(this.root, { recursive: true });
    const rows = [];
    for (const id of await fs.readdir(this.root)) if (uuid.test(id)) {
      const p = await this.load(id).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
      if (p && !p.replayOf) rows.push({ id, label: p.label, mode: p.mode, caseId: p.caseId, createdAt: p.createdAt, updatedAt: p.updatedAt });
    }
    return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  create(args) { const next = this.createQueue.then(() => this.createProject(args)); this.createQueue = next.catch(() => {}); return next; }
  async createProject(args) {
    const label = String(args.label || (args.caseId ? '显示板' : '新设计项目')).trim();
    if (!label || label.length > 120) throw new Error('项目名称需要 1–120 个字符。');
    if (!args.replayOf && (await this.list()).some(p => p.label === label)) throw new Error('已有同名项目，请使用可区分的名称。');
    const caseId = args.caseId || null;
    if (caseId && caseId !== 'display-board') throw new Error('未知默认输入。');
    const legacy = args.legacy === true;
    const p = { schemaVersion: legacy ? 2 : 3, id: randomUUID(), label, replayOf: args.replayOf || undefined,
      mode: legacy ? 'design' : 'text-mcp', scope: legacy ? 'full-project' : 'schematic', origin: legacy ? 'legacy-conversion' : 'text-mcp', caseId, createdAt: new Date().toISOString(), revision: 1,
      modelRequests: 0, inputs: legacy ? (caseId ? await readJSON(path.join(packageRoot, 'cases/display-board/defaults.json')) : { requirements: '', constraints: {}, datasheets: [], stageNotes: {} }) : await textDefaults(caseId),
      stages: stages.map(s => ({ ...s, ...(!legacy && s.id === 6 ? { title: 'PCB（本轮未执行）', automatic: '下一阶段再开展布局布线' } : {}), status: !legacy && s.id === 6 ? 'skipped' : 'pending', source: 'ai', plan: null, confirmed: false, gaps: [], assumptions: [], questions: [] })), events: [], messages: {}, uploads: [] };
    await fs.mkdir(this.dir(p.id), { recursive: true });
    if (caseId && legacy) {
      const source = path.join(packageRoot, 'cases/display-board/inputs');
      p.inputsBundle = path.join(this.dir(p.id), 'default-inputs');
      await fs.cp(source, p.inputsBundle, { recursive: true });
      p.bundleFiles = await tree(p.inputsBundle); p.bundleHash = hash(p.bundleFiles);
      p.caseInputSignature = this.designSignature(p.inputs);
    }
    this.recordEvent(p, 1, '项目', caseId ? (legacy ? '载入旧版工程资料（历史流程）' : '载入显示板纯文字任务书') : '创建空白项目');
    await this.save(p); return this.open(p.id);
  }
  changedNames(files) { return files.length ? `：${files.slice(0, 3).map(f => f.path).join('、')}${files.length > 3 ? `等 ${files.length} 个文件` : ''}` : ''; }
  bundleMatches(p, current) { return p.bundleFiles ? hash(p.bundleFiles) === p.bundleHash && sameFiles(p.bundleFiles, current) : p.bundleHash === hash(current); }
  async inspectBundle(p, current) {
    return inspectDefaultBundle(p, current, await readJSON(path.join(packageRoot, 'cases/display-board/inputs/manifest.json')));
  }
  requireReadable(p, number) {
    if (p.bundleIssue && p.bundleIssue.from <= Number(number)) throw new FlowError(p.bundleIssue.code, p.bundleIssue.message, p.bundleIssue);
  }
  async pythonInputReadings(p, files, signal) {
    return new Promise((resolve, reject) => {
      const child = spawn(this.config.kicadPython, [path.join(packageRoot, 'python/input_probe.py')],
        { windowsHide: true, env: { ...process.env, PYTHONUTF8: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '', size = 0;
      const stop = () => child.kill();
      const timer = setTimeout(stop, 30000);
      signal?.addEventListener('abort', stop, { once: true });
      if (signal?.aborted) stop();
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', stop); };
      child.stdout.on('data', data => { size += data.length; if (size > 4 * 1024 * 1024) stop(); else stdout += data; });
      child.stderr.resume();
      child.stdin.on('error', () => {});
      child.on('error', error => { cleanup(); reject(new Error(`Python 读取检查无法启动（${error.code || '启动失败'}）。请检查配置的 KiCad Python 路径。`)); });
      child.on('close', code => {
        cleanup();
        if (signal?.aborted || code !== 0) return reject(new Error('Python 读取检查未完成，请检查工具路径与内网执行授权。'));
        try { const rows = JSON.parse(stdout); if (!Array.isArray(rows)) throw new Error(); resolve(rows); }
        catch { reject(new Error('Python 读取检查未返回有效记录。')); }
      });
      child.stdin.end(JSON.stringify({ root: p.inputsBundle, files }));
    });
  }
  async diagnoseInputs(a, supplied, signal) {
    const p = supplied || await this.load(a.projectId);
    if (!p.inputsBundle) throw new FlowError('input', '当前项目没有显示板默认资料；请在资料列表核对已上传文件的读取结果。');
    const manifest = await readJSON(path.join(packageRoot, 'cases/display-board/inputs/manifest.json'));
    const current = await tree(p.inputsBundle);
    const paths = [...new Set([...current.map(f => f.path), ...Object.keys(manifest.files)])];
    const expected = paths.map(name => ({ path: name, sha256: manifest.files[name] || p.bundleFiles?.find(f => f.path === name)?.sha256 }));
    const node = [];
    for (const file of expected) {
      try { node.push({ path: file.path, ...byteEvidence(await fs.readFile(await within(p.inputsBundle, file.path))) }); }
      catch { node.push({ path: file.path, unavailable: true }); }
    }
    let python = [], pythonError;
    try { python = await this.pythonInputReadings(p, expected, signal); } catch (error) { pythonError = error.message; }
    const files = compareReaders(expected, node, python);
    const problems = files.filter(f => f.status !== 'verified');
    const protectedCount = files.filter(f => f.status === 'tsd-protected').length;
    const differentReaders = files.filter(f => f.status === 'reader-mismatch').length;
    const summary = protectedCount ? `${protectedCount} 个文件读取到 TSD-Header 保护格式。请由内网 IT 核对 Harness/Node 与 KiCad Python 的读取授权，或在获准环境导出可读副本后重新检查。`
      : pythonError || (differentReaders ? `${differentReaders} 个文件在 Node 与 Python 中读到的字节不同；这可能与进程授权或检查期间文件变化有关，请核对诊断记录。`
        : problems.length ? `${problems.length} 个文件与原始默认资料不同或不可读；未检测到 TSD-Header，暂不能判定为加密。`
          : 'Node 与 KiCad Python 均能读取默认资料，内容与发布包一致。');
    return { version, projectId: p.id, checkedAt: new Date().toISOString(), allValid: !problems.length,
      code: !problems.length ? null : protectedCount ? 'encrypted' : pythonError ? 'tool' : 'integrity', summary,
      readers: { node: process.execPath, python: this.config.kicadPython || '未配置' }, pythonError,
      files, realModelCalls: 0, contentIncluded: false };
  }
  invalidate(p, from, reason = { kind: 'inputs', from, message: `“${p.stages.find(s => s.id === from)?.title || '前序步骤'}”的输入或处理方案已修改，请重新核对本步结果。` }) {
    let record = false;
    for (const s of p.stages) if (s.id >= from) {
      if (p.mode === 'text-mcp' && s.id === 6) { s.status = 'skipped'; s.confirmed = false; continue; }
      if ((s.output || s.confirmed) && hash(s.invalidation || null) !== hash(reason)) record = true;
      s.status = s.output || s.confirmed ? 'stale' : 'pending'; s.confirmed = false; delete s.confirmation; delete s.error; delete s.errorInfo;
      s.invalidation = reason;
    }
    if (record) this.recordEvent(p, from, '校验', '结果需要重新确认', reason);
    delete p.replay;
  }
  prerequisites(p, number) {
    this.requireReadable(p, number);
    for (const prior of p.stages.filter(s => s.id < Number(number) && !(p.mode === 'text-mcp' && s.id === 6 && s.status === 'skipped'))) if (prior.status !== 'done' || !prior.confirmed)
      throw new FlowError('input', `请先执行并确认“${prior.title}”。${prior.invalidation?.message || '确认成功后再执行本步。'}`);
  }
  async confirmedProject(id, number) {
    const current = await this.open(id), stage = this.stage(current, number);
    if (stage.status !== 'done' || !stage.confirmed) throw new FlowError('integrity', stage.invalidation?.message || stage.error || '确认后的文件校验未通过，本步尚未确认。', { stage: stage.id, ...stage.invalidation });
    return current;
  }
  guard(id) { if (this.jobs.has(id)) throw new Error('当前项目正在执行，请先等待或取消。'); }
  stage(p, number) { const s = p.stages.find(s => s.id === Number(number)); if (!s) throw new Error('请选择有效步骤。'); return s; }
  async update(a) {
    this.guard(a.projectId); const p = await this.load(a.projectId); const s = this.stage(p, a.stage);
    if (a.expectedRevision != null && a.expectedRevision !== p.revision) throw new FlowError('conflict', '输入已被其他窗口修改，请刷新项目后重新保存。');
    if (a.inputs !== undefined) {
      if (!a.inputs || typeof a.inputs !== 'object' || Array.isArray(a.inputs)) throw new Error('输入应为对象。');
      if (p.mode === 'text-mcp') {
        if (Object.keys(a.inputs).some(key => !['requirements','datasheetText','constraints','stageNotes','basis','acceptance','power','interfaces','review'].includes(key))) throw new Error('文字流程仅接受需求、规格书正文、约束和本步文字补充；不能加载工程对象包。');
        for (const key of ['requirements','datasheetText','basis','acceptance','power','interfaces','review']) if (a.inputs[key] !== undefined && (typeof a.inputs[key] !== 'string' || a.inputs[key].length > 1500000)) throw new Error('正文必须为不超过 150 万字符的文字。');
      }
      if (a.inputs.stageNotes && (Object.keys(a.inputs.stageNotes).some(k => Number(k) !== s.id) || Object.values(a.inputs.stageNotes).some(v => typeof v !== 'string'))) throw new Error('一次只能修改当前步骤的补充输入。');
      const changedKeys = Object.keys(a.inputs).filter(key => key === 'stageNotes' ? Object.entries(a.inputs.stageNotes).some(([k,v]) => (p.inputs.stageNotes?.[k] || '') !== v) : JSON.stringify(p.inputs[key]) !== JSON.stringify(a.inputs[key]));
      p.inputs = { ...p.inputs, ...a.inputs, ...(a.inputs.stageNotes ? { stageNotes: { ...p.inputs.stageNotes, ...a.inputs.stageNotes } } : {}) };
      const first = Math.min(...changedKeys.map(key => key === 'stageNotes' ? s.id : key === 'review' && p.mode === 'text-mcp' ? 7 : key === 'datasheets' || key === 'datasheetText' ? 3 : key === 'ui' || key === 'resources' ? s.id : ['schematic', 'pcb', 'nativeProject', 'basis'].includes(key) ? 2 : 1));
      if (changedKeys.length) { this.invalidate(p, Number.isFinite(first) ? first : s.id); p.inputFiles = (p.inputFiles || []).filter(f => f.stage < first); }
      if (p.mode === 'text-mcp' && changedKeys.length) this.recordEvent(p, s.id, '文字输入', '保存可追溯的文字补充', { fields: changedKeys, inputs: a.inputs });
    } else if (a.plan !== undefined) this.invalidate(p, s.id);
    if (a.plan !== undefined) {
      if (!a.plan || typeof a.plan !== 'object' || Array.isArray(a.plan)) throw new Error('处理输出必须是对象。');
      s.plan = a.plan;
    }
    if (a.source && a.source !== 'ai') throw new Error('每个新执行阶段均由 Harness 当前模型处理。');
    p.revision++; this.recordEvent(p, s.id, '保存', '保存本步输入'); await this.save(p); return this.open(p.id);
  }
  async confirm(a, actor) {
    if (actor !== 'human') throw new Error('阶段确认必须由工程师在页面完成。');
    this.guard(a.projectId); const p = await this.open(a.projectId); const s = this.stage(p, a.stage);
    this.requireReadable(p, s.id);
    if (s.id === 1 && s.status !== 'done') return this.manualConfirm(p, a);
    if (s.status !== 'done') throw new Error('本步没有有效的执行结果。');
    if ((s.gaps.length || s.assumptions.length) && !a.allowDraft) throw new FlowError('review', '本步仍有待确认项，请查看当前页面的“本步待确认项”。可按入口补充，或在底部选择“带待确认项继续草稿”。', { stage: s.id, gaps: s.gaps, assumptions: s.assumptions });
    s.confirmed = true; s.confirmation = { at: new Date().toISOString(), actor: 'human', draft: Boolean(a.allowDraft), note: String(a.note || ''), outputHash: s.outputHash };
    this.recordEvent(p, s.id, '确认', '确认' + s.title, s.confirmation);
    await this.save(p); return this.confirmedProject(p.id, s.id);
  }
  async checkedInputs(p) {
    const inputs = structuredClone(p.inputs);
    for (const key of ['schematic', 'pcb', 'nativeProject']) if (inputs[key]) inputs[key] = await within(this.config.workspaceRoot, inputs[key]);
    for (const resource of inputs.resources || []) resource.path = await within(this.config.workspaceRoot, resource.path);
    for (const pdf of inputs.datasheets || []) pdf.path = await within(this.config.workspaceRoot, pdf.path);
    return inputs;
  }
  async structuredEligible(p) {
    return Boolean(p.inputsBundle && p.caseInputSignature === this.designSignature(p.inputs) && !(await this.inspectBundle(p, await tree(p.inputsBundle))));
  }
  designSignature(inputs) { const { datasheets, resources, stageNotes, ...design } = inputs; return hash({ ...Object.fromEntries(Object.entries(design).filter(([,v]) => v !== '' && v != null)), stageNotes: Object.fromEntries(Object.entries(stageNotes || {}).filter(([,v]) => v.trim())) }); }
  async inputIndex(p, number) {
    return p.inputsBundle ? (await tree(p.inputsBundle)).map(f => ({ ...f, scope: 'inputs', relevant: inputGroups[number].some(g => f.path.startsWith(g + '/')) })) : [];
  }
  async readEvidence(p, number, item, prepared) {
    const scope = item.scope || 'inputs'; let root;
    if (scope === 'inputs') root = p.inputsBundle;
    else if (scope === 'prepared') root = prepared;
    else if (/^stage:[1-7]$/.test(scope) && Number(scope.slice(6)) < number) root = this.stage(p, Number(scope.slice(6))).output;
    if (!root) throw new Error('资料范围不存在。');
    const file = await within(root, item.path);
    if (!/\.(json|csv|txt|md|xml|py|kicad_sch|kicad_pcb|kicad_sym|kicad_mod)$/i.test(file)) throw new Error('请读取提取后的文本或数据文件。');
    const data = await fs.readFile(file); if (data.length > 32 * 1024 * 1024) throw new Error('资料文件过大。');
    if (byteEvidence(data).tsdHeader) throw new FlowError('encrypted', '资料含 TSD-Header 保护头，当前进程无法读取原始数据。请检查内网读取授权。', { path: item.path });
    const text = data.toString('utf8'); const offset = Math.max(0, Math.floor(Number(item.offset) || 0));
    const length = Math.max(1, Math.min(24000, Math.floor(Number(item.length) || 16000)));
    return { scope, path: item.path, sha256: hash(data), offset, totalChars: text.length, text: text.slice(offset, offset + length), nextOffset: offset + length < text.length ? offset + length : null };
  }
  async snapshotInputs(inputs, output) {
    const copy = structuredClone(inputs); const files = [];
    const snapshot = async (original, stage) => {
      const data = await fs.readFile(original); const sha256 = hash(data);
      const target = path.join(output, 'input-snapshot', sha256.slice(0, 12), path.basename(original));
      await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, data);
      files.push({ original, path: path.relative(output, target).replaceAll('\\', '/'), sha256, bytes: data.length, stage });
      return target;
    };
    for (const key of ['schematic', 'pcb', 'nativeProject']) if (copy[key]) copy[key] = await snapshot(copy[key], 2);
    for (const item of copy.resources || []) item.path = await snapshot(item.path, item.stage || 2);
    for (const item of copy.datasheets || []) item.path = await snapshot(item.path, 3);
    return { inputs: copy, files };
  }
  async runProcess(args, output, signal, event) {
    const log = { command: this.config.kicadPython, args, stdout: '', stderr: '' };
    const logPath = path.join(output, 'execution-' + path.basename(args[0], '.py') + '.json');
    await new Promise((resolve, reject) => {
      const child = spawn(this.config.kicadPython, args, { cwd: output, windowsHide: true, env: { ...process.env, PYTHONUTF8: '1' } });
      const stop = () => {
        if (process.platform === 'win32' && child.pid) { const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); killer.on('error', () => child.kill()); }
        else child.kill();
      };
      if (signal?.aborted) stop(); else signal?.addEventListener('abort', stop, { once: true });
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', stop); };
      const timer = setTimeout(stop, 15 * 60 * 1000);
      child.stdout.on('data', data => {
        log.stdout = (log.stdout + data).slice(-400000); event?.(String(data).slice(-1500));
        for (const [id, job] of this.jobs) if (output.startsWith(this.dir(id) + path.sep)) {
          const last = String(data).trim().split('\n').at(-1);
          try { const item = JSON.parse(last); if (item.event === 'command') job.progress = [item.name, ...(item.args || []).slice(0, 3)].join(' '); } catch { /* Raw logs remain in the execution record. */ }
        }
      });
      child.stderr.on('data', data => { log.stderr = (log.stderr + data).slice(-400000); });
      child.on('error', e => { cleanup(); reject(e); });
      child.on('close', code => { cleanup(); log.exitCode = code; code === 0 && !signal?.aborted ? resolve() : reject(new Error(signal?.aborted ? '本步已取消。' : (log.stderr || log.stdout || `执行退出码 ${code}`).slice(-4000))); });
    }).catch(async error => { log.error = error.message; await writeJSON(logPath, log); throw error; });
    await writeJSON(logPath, log);
  }
  async execute(id, number, signal, { replay = false } = {}) {
    const p = await this.open(id); const s = this.stage(p, number);
    if (p.mode === 'text-mcp') return executeText(this, p, s, signal);
    this.prerequisites(p, s.id);
    if (!replay && (!this.config.allowModelCalls || !this.ai)) throw new Error('本步需要 Harness 当前模型。请配置模型后执行；离线页面仅用于查看输入。');
    const inputs = await this.checkedInputs(p);
    this.invalidate(p, s.id);
    const output = path.join(this.dir(id), 'steps', String(s.id), randomUUID()); await fs.mkdir(output, { recursive: true });
    s.attempts = (s.attempts || 0) + 1;
    this.recordEvent(p, s.id, '执行', `${s.title} · 第 ${s.attempts} 次执行`, { output });
    s.status = 'running'; s.startedAt = new Date().toISOString(); s.output = output; s.files = []; s.gaps = []; s.assumptions = [];
    delete s.outputHash; await this.save(p);
    const dependencies = Object.fromEntries(p.stages.filter(x => x.id < s.id).map(x => [x.id, x.output]));
    const request = { stage: s.id, output, mode: p.mode, inputs, dependencies, cli: this.config.kicadCli, plan: s.plan,
      inputsBundle: p.inputsBundle, structuredEligible: await this.structuredEligible(p), skip3d: this.config.skip3d === true };
    let phase = 'input'; this.phase(id, phase, '读取资料');
    try {
      const snapshot = await this.snapshotInputs(inputs, output); request.inputs = snapshot.inputs;
      p.inputFiles = snapshot.files; s.inputFiles = snapshot.files;
      if (p.inputsBundle) await writeJSON(path.join(output, 'default-input-catalog.json'), { bundleHash: p.bundleHash, files: await tree(p.inputsBundle) });
      const runtime = { node: process.version, platform: process.platform, plugin: version,
        implementation: [...await tree(path.join(packageRoot, 'python')), ...await tree(path.join(packageRoot, 'src'))] };
      await writeJSON(path.join(output, 'environment.json'), runtime);
      await writeJSON(path.join(output, 'request.json'), request);
      await this.runProcess([path.join(packageRoot, 'python/intake.py'), path.join(output, 'request.json')], output, signal);
      if (p.inputsBundle) {
        const reading = await this.diagnoseInputs({ projectId: id }, p, signal);
        await writeJSON(path.join(output, 'input-reading-check.json'), reading);
        this.recordEvent(p, s.id, '资料检查', reading.summary, { output, allValid: reading.allValid, code: reading.code });
        if (!reading.allValid) throw new FlowError(reading.code, reading.summary, reading);
      }
      if (!replay) {
        phase = 'model'; this.phase(id, phase, 'AI 处理');
        const evidence = [{ scope: 'inputs', files: await this.inputIndex(p, s.id) }, { scope: 'prepared', files: await tree(path.join(output, 'prepared')) }];
        for (const dir of Object.values(dependencies)) {
          const index = Object.entries(dependencies).find(([,v]) => v === dir)[0];
          evidence.push({ scope: 'stage:' + index, result: await readJSON(path.join(dir, 'result.json')), files: (await tree(dir)).filter(f => !/input-snapshot|model-log/.test(f.path)) });
        }
        const records = []; const record = async value => {
          this.modelProgress(id, value); if (value.event === 'stream-progress') return;
          if (value.event === 'request') { p.modelRequests++; this.recordEvent(p, s.id, 'AI 请求', `模型处理 · 第 ${p.modelRequests} 次请求`, { provider: value.provider, model: value.model, phase }); await this.save(p); }
          records.push({ at: new Date().toISOString(), ...value }); await writeJSON(path.join(output, 'model-log.json'), records);
        };
        s.plan = await this.ai.generate({ project: { mode: p.mode }, stage: { id: s.id, title: s.title, input: s.input, gaps: p.stages.slice(0, s.id - 1).flatMap(x => x.gaps) }, request, evidence,
          read: item => this.readEvidence(p, s.id, item, path.join(output, 'prepared')), record }, signal);
        request.plan = s.plan; s.planOrigin = s.plan.provider === 'test-double' ? 'test-double' : 'live-ai'; await writeJSON(path.join(output, 'ai-output.json'), s.plan);
      }
      phase = 'tool'; this.phase(id, phase, '工具执行');
      if (request.plan?.executor === 'structured' && !request.structuredEligible) throw new Error('输入已改变，显示板结构化生成工具不适用；请让模型根据新输入生成方案。');
      if (request.plan?.executor === 'local' && s.id > 3) throw new Error('本阶段需要生成工程，不能只整理资料。');
      if (!['local', 'structured', 'python'].includes(request.plan?.executor)) throw new Error('缺少可执行的模型方案。');
      await writeJSON(path.join(output, 'request.json'), request);
      if (request.plan.executor === 'python') {
        if (typeof request.plan.script !== 'string' || !request.plan.script.trim()) throw new Error('缺少本步可执行脚本。');
        // Human-selected stage output executes under the configured local account. Originals are copied below.
        const script = path.join(output, 'stage.py'); await fs.writeFile(script, request.plan.script);
        await this.runProcess([script, '--request', path.join(output, 'request.json')], output, signal);
      } else await this.runProcess([path.join(packageRoot, 'python/stage.py'), path.join(output, 'request.json')], output, signal);
      if (request.plan.executor === 'python' && s.id >= 4) {
        await this.runProcess([path.join(packageRoot, 'python/check_generated.py'), path.join(output, 'request.json')], output, signal);
      }
      this.phase(id, 'check', '检查结果');
      const result = await readJSON(path.join(output, 'result.json'));
      if (!result.summary || !Array.isArray(result.gaps)) throw new Error('阶段输出缺少 summary/gaps，不能记为成功。');
      for (const f of snapshot.files) if (hash(await fs.readFile(f.original)) !== f.sha256) throw new Error('执行期间原始输入文件发生变化，请重新确认资料。');
      if (p.inputsBundle) {
        const issue = await this.inspectBundle(p, await tree(p.inputsBundle));
        if (issue) throw new FlowError(issue.code, issue.message, issue);
      }
      for (const prior of p.stages.filter(x => x.id < s.id)) if (!sameFiles(prior.files, await tree(prior.output))) throw new Error('执行期间上游文件发生变化，当前结果不能确认。');
      const intake = await readJSON(path.join(output, 'prepared/intake.json'));
      const inheritedGaps = p.stages.filter(x => x.id < s.id).flatMap(x => x.gaps).filter(g => !(result.erc && g.startsWith('ERC：')) && !(result.drc && g.startsWith('DRC：')));
      s.result = result; s.gaps = [...new Set([...inheritedGaps, ...intake.gaps, ...(s.plan.gaps || []), ...result.gaps])];
      s.assumptions = [...new Set([...p.stages.filter(x => x.id < s.id).flatMap(x => x.assumptions || []), ...(s.plan.assumptions || [])])];
      if (s.id === 7) {
        await writeJSON(path.join(output, 'frozen-evidence.json'), { schemaVersion: 1, projectId: p.id, inputs: p.inputs, modelRequests: p.modelRequests,
          sourceFiles: p.inputFiles, defaultInputsHash: p.bundleHash, stages: p.stages.map(x => ({ id: x.id, source: x.source, plan: x.executedPlan || x.plan, inputFiles: x.inputFiles, confirmation: x.confirmation, output: x.output, outputHash: x.outputHash, gaps: x.gaps, assumptions: x.assumptions })), environment: runtime });
        await this.runProcess([path.join(packageRoot, 'python/archive.py'), path.join(output, 'request.json')], output, signal);
      }
      s.files = await tree(output); s.outputHash = hash(s.files); s.status = 'done'; delete s.invalidation;
      s.finishedAt = new Date().toISOString(); s.executedPlan = structuredClone(s.plan);
      if (replay) { s.confirmed = true; s.confirmation = { actor: 'replay', draft: true, inherited: true, outputHash: s.outputHash }; }
      this.recordEvent(p, s.id, '完成', s.title + '处理完成', { output, summary: result.summary, source: s.planOrigin });
    } catch (error) {
      s.status = signal?.aborted ? 'cancelled' : 'failed'; s.errorInfo = classify(error, phase, signal); s.error = s.errorInfo.message;
      s.finishedAt = new Date().toISOString(); this.recordEvent(p, s.id, '失败', s.errorInfo.title, { ...s.errorInfo, output });
      await this.save(p); throw error;
    }
    await this.save(p); return this.open(id);
  }
  async start(a) {
    this.guard(a.projectId);
    const current = await this.open(a.projectId); this.stage(current, a.stage); this.prerequisites(current, a.stage);
    this.guard(a.projectId); const controller = new AbortController();
    const task = { controller, type: 'stage', stage: a.stage, startedAt: new Date().toISOString(), promise: null }; this.jobs.set(a.projectId, task);
    this.phase(a.projectId, 'input', '正在检查本步输入');
    task.promise = this.execute(a.projectId, a.stage, controller.signal).catch(async error => {
      const p = await this.load(a.projectId); const s = this.stage(p, a.stage); if (s.status !== 'failed' && s.status !== 'cancelled') { s.errorInfo = classify(error, 'input', controller.signal); s.error = s.errorInfo.message; s.status = controller.signal.aborted ? 'cancelled' : 'failed'; this.recordEvent(p, s.id, '失败', s.errorInfo.title, s.errorInfo); } await this.save(p);
    }).finally(() => this.jobs.delete(a.projectId));
    return { started: true, projectId: a.projectId };
  }
  async replay(id) {
    this.guard(id); const original = await this.open(id);
    if (original.mode === 'text-mcp') throw new Error('文字 MCP 流程不支持固定调用重放。独立验证请新建空白项目，将同一文字输入交给模型重新执行。');
    if (original.stages.some(s => s.status !== 'done' || !s.confirmed)) throw new Error('重放需要全部步骤有效且经工程师确认。');
    const p = await this.create({ legacy: true, caseId: original.caseId, label: original.label + ' · 空目录重放', replayOf: original.id });
    const snapshot = await this.snapshotInputs(await this.checkedInputs(original), this.dir(p.id));
    p.inputs = snapshot.inputs;
    for (const s of p.stages) {
      s.source = 'replay'; s.plan = structuredClone(original.stages[s.id - 1].executedPlan);
      if (s.plan && (JSON.stringify(s.plan).includes(this.dir(original.id)) || JSON.stringify(s.plan).includes(this.dir(original.id).replaceAll('\\', '/')))) throw new Error('本轮脚本硬编码了旧运行目录，无法独立重放。请改为读取 request.inputs/dependencies。');
    }
    await this.save(p);
    const control = new AbortController(); this.jobs.set(id, { controller: control }); this.jobs.set(p.id, { controller: control });
    try {
      for (let stage = 1; stage <= 7; stage++) { if (stage === 1 && original.stages[0].source === 'human') await this.manualConfirm(await this.load(p.id), { allowDraft: true }); else await this.execute(p.id, stage, control.signal, { replay: true }); }
      const repeated = await this.load(p.id);
      const a = await readJSON(path.join(original.stages[6].output, 'project-content.json'));
      const b = await readJSON(path.join(repeated.stages[6].output, 'project-content.json'));
      const differences = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
      original.replay = { projectId: p.id, at: new Date().toISOString(), match: !differences.length, compared: Object.keys(a).length, differences, modelRequests: repeated.modelRequests, method: 'Recorded model decisions; deterministic replay' };
      this.recordEvent(original, 7, '重放', !differences.length ? '空目录重放一致' : '空目录重放存在差异', original.replay); await this.save(original); return original.replay;
    } finally { this.jobs.delete(id); this.jobs.delete(p.id); }
  }
  recordEvent(p, stage, kind, title, detail = '') {
    p.events.push({ id: randomUUID(), stage, kind, title, detail, at: new Date().toISOString() });
  }
  phase(id, phase, progress, details) { updateProgress(this.jobs.get(id), phase, progress, details); }
  modelProgress(id, value) { modelProgress(this.jobs.get(id), value); }
  async manualConfirm(p, a = {}) {
    if (!String(p.inputs.requirements || '').trim()) throw new FlowError('input', '请先填写需求与目标。');
    const s = p.stages[0]; this.invalidate(p, 1);
    const output = path.join(this.dir(p.id), 'steps', '1', randomUUID());
    const result = { summary: '工程师确认任务与约束', gaps: [] };
    await writeJSON(path.join(output, 'design-inputs.json'), { engineer: p.inputs, confirmation: 'human', at: new Date().toISOString() });
    await writeJSON(path.join(output, 'result.json'), result);
    Object.assign(s, { status: 'done', source: 'human', plan: null, output, result, confirmed: true, gaps: [], assumptions: [], finishedAt: new Date().toISOString() });
    delete s.invalidation;
    s.files = await tree(output); s.outputHash = hash(s.files);
    s.confirmation = { at: s.finishedAt, actor: 'human', draft: Boolean(a.allowDraft), note: String(a.note || ''), outputHash: s.outputHash };
    this.recordEvent(p, 1, '确认', '工程师确认任务与约束', '人工确认输入；未调用模型。');
    await this.save(p); return this.confirmedProject(p.id, 1);
  }
  async rename(a) {
    this.guard(a.projectId); const p = await this.load(a.projectId), label = String(a.label || '').trim();
    if (!label || label.length > 120) throw new Error('项目名称需要 1–120 个字符。');
    if ((await this.list()).some(x => x.id !== p.id && x.label === label)) throw new Error('已有同名项目，请使用可区分的名称。');
    const before = p.label; p.label = label; this.recordEvent(p, 1, '项目', '修改项目名称', { before, after: label });
    await this.save(p); return this.open(p.id);
  }
  async attach(a) {
    this.guard(a.projectId); const p = await this.load(a.projectId), stage = Number(a.stage || 2);
    if (p.mode === 'text-mcp') {
      this.stage(p, stage); const file = await within(this.config.workspaceRoot, a.path); const stat = await fs.stat(file);
      if (!stat.isFile() || path.extname(file).toLowerCase() !== '.pdf') throw new Error('文字流程只接受规格书 PDF 附件；工程资料请整理为公开文字需求。');
      p.uploads.push({ id: randomUUID(), name: path.basename(file), path: file, size: stat.size, stage, binding: String(a.binding || ''), type: '规格书 PDF', status: '附件未读取；请粘贴带来源页码的正文', readable: false });
      this.invalidate(p, stage); p.revision++; this.recordEvent(p, stage, '资料', '附件仅登记，正文待粘贴', { name: path.basename(file), readable: false }); await this.save(p); return this.open(p.id);
    }
    this.stage(p, stage); const file = await within(this.config.workspaceRoot, a.path);
    const stat = await fs.stat(file); if (!stat.isFile()) throw new Error('请选择文件。');
    const ext = path.extname(file).toLowerCase(), entry = { id: randomUUID(), name: path.basename(file), path: file, size: stat.size, sha256: hash(await fs.readFile(file)), stage, binding: String(a.binding || ''), status: '待读取', type: ext === '.pdf' ? '规格书 PDF' : '补充资料' };
    p.uploads ||= [];
    if (!p.uploads.some(f => f.path === file && f.binding === entry.binding)) p.uploads.push(entry);
    if (ext === '.pdf' && stage === 3) {
      p.inputs.datasheets ||= []; p.inputs.datasheets.push({ path: file, binding: entry.binding, mpn: String(a.mpn || '') });
    } else if (['.schdoc', '.pcbdoc', '.prjpcb'].includes(ext)) p.inputs[{ '.schdoc': 'schematic', '.pcbdoc': 'pcb', '.prjpcb': 'nativeProject' }[ext]] = file;
    else { p.inputs.resources ||= []; p.inputs.resources.push({ path: file, binding: entry.binding, stage }); }
    this.invalidate(p, ['.schdoc', '.pcbdoc', '.prjpcb'].includes(ext) ? 2 : stage);
    p.revision++; this.recordEvent(p, stage, '资料', '添加资料：' + entry.name, entry);
    await this.save(p); return this.open(p.id);
  }
  async upload(a, files) {
    this.guard(a.projectId); this.dir(a.projectId);
    for (const file of files) {
      if (file.size > 50 * 1024 * 1024) throw new Error('单个文件不能超过 50 MB。');
      const name = path.basename(file.name.replaceAll('\\', '/')).replace(/[<>:"|?*\x00-\x1f]/g, '_');
      if (!name || name === '.' || name === '..') throw new Error('无效文件名。');
      const bytes = Buffer.from(await file.arrayBuffer());
      const target = path.join(this.dir(a.projectId), 'uploads', hash(bytes).slice(0, 16), name);
      await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, bytes);
      await this.attach({ ...a, path: target });
    }
    return this.open(a.projectId);
  }
  async startChat(a) {
    this.guard(a.projectId);
    if (!this.config.allowModelCalls || !this.ai) throw new FlowError('unselected', '请先配置 Harness 当前模型。');
    if (!String(a.text || '').trim()) throw new Error('请输入补充问题。');
    const context = String(a.context || a.stage || 1);
    if (!/^[1-7]$|^files$|^activity$/.test(context)) throw new Error('无效对话范围。');
    const controller = new AbortController(), task = { controller, type: 'chat', stage: Number(a.stage || 1), startedAt: new Date().toISOString() };
    this.jobs.set(a.projectId, task);
    this.phase(a.projectId, 'model', '正在准备助手对话');
    task.promise = (async () => {
      const p = await this.load(a.projectId), number = /^[1-7]$/.test(context) ? Number(context) : Number(a.stage || 1);
      const stage = this.stage(p, number); p.messages[context] ||= [];
      p.messages[context].push({ id: randomUUID(), role: 'user', text: String(a.text).slice(0, 32000), at: new Date().toISOString() });
      this.recordEvent(p, number, '对话', '补充本步要求', a.text);
      const folder = path.join(this.dir(p.id), 'conversations', randomUUID()), records = [];
      const record = async value => { this.modelProgress(p.id, value); if (value.event === 'stream-progress') return; if (value.event === 'request') p.modelRequests++; records.push({ at: new Date().toISOString(), ...value }); await writeJSON(path.join(folder, 'model-log.json'), records); };
      await this.save(p);
      try {
        const conversation = { messages: p.messages[context].slice(-20), selectedRecord: a.selectedRecord };
        const result = p.mode === 'text-mcp'
          ? await this.ai.generateText({ project: { mode: p.mode, scope: p.scope }, stage: { id: stage.id, title: stage.title }, request: { inputs: p.inputs, result: stage.result }, conversation, record }, controller.signal)
          : await this.ai.generate({ project: p, stage, request: { inputs: p.inputs }, evidence: [{ scope: 'inputs', files: await this.inputIndex(p, number) }, ...p.stages.filter(s => s.output && s.id <= number).map(s => ({ scope: 'stage:' + s.id, files: s.files }))],
            conversation, read: item => this.readEvidence(p, Math.min(number + 1, 8), item, stage.output && path.join(stage.output, 'prepared')), record }, controller.signal);
        result.text ||= result.summary || result.questions?.join('\n');
        p.messages[context].push({ id: randomUUID(), role: 'assistant', text: result.text, proposal: /^[1-7]$/.test(context), provider: result.provider, model: result.model, at: new Date().toISOString() });
        this.recordEvent(p, number, 'AI 建议', '助手已回复', { context, provider: result.provider, model: result.model, log: path.relative(this.dir(p.id), folder) });
      } catch (error) {
        const info = classify(error, 'model', controller.signal);
        p.messages[context].push({ id: randomUUID(), role: 'error', text: info.message, error: info });
        this.recordEvent(p, number, '失败', info.title, info);
      }
      await this.save(p);
    })().catch(() => {}).finally(() => this.jobs.delete(a.projectId));
    return { started: true, projectId: a.projectId };
  }
  async adopt(a) {
    this.guard(a.projectId); const p = await this.load(a.projectId), stage = this.stage(p, a.stage);
    const suggestion = p.messages[String(stage.id)]?.find(m => m.id === a.messageId && m.role === 'assistant' && m.proposal);
    if (!suggestion) throw new Error('建议不存在。');
    if (!suggestion.applied) {
      p.inputs.stageNotes ||= {}; p.inputs.stageNotes[stage.id] = [p.inputs.stageNotes[stage.id], suggestion.text].filter(Boolean).join('\n'); suggestion.applied = true;
      this.invalidate(p, stage.id); p.revision++; this.recordEvent(p, stage.id, '输入', '采用 AI 建议', suggestion.text); await this.save(p);
    }
    return this.open(p.id);
  }
  async files(directory) {
    const dir = await within(this.config.workspaceRoot, directory || this.config.workspaceRoot);
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return { directory: dir, parent: dir === await fs.realpath(this.config.workspaceRoot) ? null : path.dirname(dir),
      entries: entries.filter(e => !e.isSymbolicLink() && !e.name.startsWith('.')).slice(0, 500).map(e => ({ name: e.name, directory: e.isDirectory(), path: path.join(dir, e.name) })) };
  }
  async dispatch(a, signal, actor = 'model') {
    if (a.action === 'list') return this.list();
    if (a.action === 'create') return this.create({ ...a, legacy: false });
    if (a.action === 'files') return this.files(a.directory);
    if (a.action === 'open') return this.open(a.projectId);
    if (a.action === 'read') { const p = await this.open(a.projectId); return this.readEvidence(p, Number(a.stage || 1), a, this.stage(p, a.stage || 1).output ? path.join(this.stage(p, a.stage || 1).output, 'prepared') : undefined); }
    if (a.action === 'data') return presentation(await this.open(a.projectId));
    if (a.action === 'records') return (await this.load(a.projectId)).events;
    if (a.action === 'diagnose-inputs') {
      if (actor !== 'human') throw new Error('资料读取检查请由工程师在页面发起。');
      this.guard(a.projectId); return this.diagnoseInputs(a, undefined, signal);
    }
    if (a.action === 'rename') return this.rename(a);
    if (a.action === 'chat') { if (actor !== 'human') throw new Error('请由工程师发起助手对话。'); return this.startChat(a); }
    if (a.action === 'adopt') { if (actor !== 'human') throw new Error('请由工程师采用建议。'); return this.adopt(a); }
    if (a.action === 'attach') return this.attach(a);
    if (a.action === 'update') return this.update(a);
    if (a.action === 'confirm') return this.confirm(a, actor);
    if (a.action === 'cancel') { const job = this.jobs.get(a.projectId); if (job) { this.phase(a.projectId, job.phase, '正在取消，请等待当前操作结束'); job.cancelling = true; job.controller.abort(); } return { cancelled: true }; }
    if (a.action === 'execute') {
      if (actor === 'human') return this.start(a);
      throw new Error('请在页面执行或提交自定义处理输出；模型不能递归启动 AI 阶段。');
    }
    if (a.action === 'replay') {
      if (actor !== 'human') throw new Error('重放由工程师发起。');
      return this.replay(a.projectId);
    }
    throw new Error('未知流程操作。');
  }
  async close() { for (const job of this.jobs.values()) job.controller.abort(); await Promise.allSettled([...this.jobs.values()].map(j => j.promise)); }
}
