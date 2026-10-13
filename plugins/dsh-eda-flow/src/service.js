import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { stages, inputGroups, version } from './contracts.js';
import { hash, readJSON, writeJSON, within, inside, tree } from './io.js';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const uuid = /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

export class Flow {
  constructor(config, ai = null) {
    this.config = config; this.ai = ai; this.jobs = new Map();
    this.root = path.join(config.workDirectory || path.join(config.workspaceRoot || '.', 'eda-flow'), 'projects');
    if (!config.workspaceRoot || !inside(config.workspaceRoot, this.root)) throw new Error('任务目录必须在工程工作区内。');
  }
  dir(id) { if (!uuid.test(id || '')) throw new Error('无效项目 ID。'); return path.join(this.root, id); }
  save(project) { project.updatedAt = new Date().toISOString(); return writeJSON(path.join(this.dir(project.id), 'project.json'), project); }
  async load(id) {
    const p = await readJSON(path.join(this.dir(id), 'project.json'));
    if (!this.jobs.has(id)) for (const s of p.stages) if (s.status === 'running') { s.status = 'interrupted'; s.error = '上次进程已退出，请重新执行本步。'; }
    return p;
  }
  async open(id) {
    const p = await this.load(id);
    let changed = false;
    if (p.inputsBundle && p.bundleHash !== hash(await tree(p.inputsBundle))) { this.invalidate(p, 1); changed = true; }
    if (p.inputFiles?.length) {
      for (const f of p.inputFiles) {
        const current = await fs.readFile(f.original).then(hash).catch(() => null);
        if (current !== f.sha256) { this.invalidate(p, f.stage); changed = true; break; }
      }
    }
    for (const s of p.stages) {
      if (!s.output) continue;
      if (s.status === 'done' && s.files) {
        const current = await tree(s.output).catch(() => []);
        if (hash(current) !== s.outputHash) { this.invalidate(p, s.id); s.error = '本步生成文件已变化，请重新执行和确认。'; changed = true; break; }
      }
    }
    p.aiEnabled = this.config.allowModelCalls === true && Boolean(this.ai);
    p.busy = this.jobs.has(id); p.modelRequests = p.modelRequests || 0;
    p.progress = this.jobs.get(id)?.progress || '';
    p.inputCatalog = await this.inputIndex(p, 1);
    if (changed && !p.busy) await this.save(p);
    return p;
  }
  async list() {
    await fs.mkdir(this.root, { recursive: true });
    const rows = [];
    for (const id of await fs.readdir(this.root)) if (uuid.test(id)) {
      const p = await this.load(id).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
      if (p) rows.push({ id, label: p.label, mode: p.mode, updatedAt: p.updatedAt });
    }
    return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async create(args) {
    const caseId = args.caseId || null;
    if (caseId && caseId !== 'display-board') throw new Error('未知默认输入。');
    const p = { schemaVersion: 2, id: randomUUID(), label: String(args.label || (caseId ? '显示板' : '新设计项目')),
      mode: 'design', caseId, createdAt: new Date().toISOString(), revision: 1,
      modelRequests: 0, inputs: caseId ? await readJSON(path.join(packageRoot, 'cases/display-board/defaults.json')) : { requirements: '', constraints: {}, datasheets: [], stageNotes: {} },
      stages: stages.map(s => ({ ...s, status: 'pending', source: 'ai', plan: null, confirmed: false, gaps: [], assumptions: [] })), events: [] };
    await fs.mkdir(this.dir(p.id), { recursive: true });
    if (caseId) {
      const source = path.join(packageRoot, 'cases/display-board/inputs');
      p.inputsBundle = path.join(this.dir(p.id), 'default-inputs');
      await fs.cp(source, p.inputsBundle, { recursive: true });
      p.bundleHash = hash(await tree(p.inputsBundle));
      p.caseInputSignature = this.designSignature(p.inputs);
    }
    await this.save(p); return this.open(p.id);
  }
  invalidate(p, from) {
    for (const s of p.stages) if (s.id >= from) {
      s.status = s.output ? 'stale' : 'pending'; s.confirmed = false; delete s.confirmation; delete s.error;
    }
    delete p.replay;
  }
  guard(id) { if (this.jobs.has(id)) throw new Error('当前项目正在执行，请先等待或取消。'); }
  stage(p, number) { const s = p.stages.find(s => s.id === Number(number)); if (!s) throw new Error('请选择有效步骤。'); return s; }
  async update(a) {
    this.guard(a.projectId); const p = await this.load(a.projectId); const s = this.stage(p, a.stage);
    if (a.inputs !== undefined) {
      if (!a.inputs || typeof a.inputs !== 'object' || Array.isArray(a.inputs)) throw new Error('输入应为对象。');
      if (a.inputs.stageNotes && (Object.keys(a.inputs.stageNotes).some(k => Number(k) !== s.id) || Object.values(a.inputs.stageNotes).some(v => typeof v !== 'string'))) throw new Error('一次只能修改当前步骤的补充输入。');
      p.inputs = { ...p.inputs, ...a.inputs, ...(a.inputs.stageNotes ? { stageNotes: { ...p.inputs.stageNotes, ...a.inputs.stageNotes } } : {}) };
      const first = Math.min(...Object.keys(a.inputs).map(key => key === 'stageNotes' ? s.id : key === 'datasheets' ? 3 : ['schematic', 'pcb', 'nativeProject', 'basis'].includes(key) ? 2 : 1));
      this.invalidate(p, Number.isFinite(first) ? first : s.id);
      p.inputFiles = (p.inputFiles || []).filter(f => f.stage < first);
    } else this.invalidate(p, s.id);
    if (a.plan !== undefined) {
      if (!a.plan || typeof a.plan !== 'object' || Array.isArray(a.plan)) throw new Error('处理输出必须是对象。');
      s.plan = a.plan;
    }
    if (a.source && a.source !== 'ai') throw new Error('每个新执行阶段均由 Harness 当前模型处理。');
    p.revision++; await this.save(p); return this.open(p.id);
  }
  async confirm(a, actor) {
    if (actor !== 'human') throw new Error('阶段确认必须由工程师在页面完成。');
    this.guard(a.projectId); const p = await this.open(a.projectId); const s = this.stage(p, a.stage);
    if (s.status !== 'done') throw new Error('本步没有有效的执行结果。');
    if ((s.gaps.length || s.assumptions.length) && !a.allowDraft) throw new Error('本步仍有缺项或假设，请明确选择“带缺项继续草稿”。');
    s.confirmed = true; s.confirmation = { at: new Date().toISOString(), actor: 'human', draft: Boolean(a.allowDraft), note: String(a.note || ''), outputHash: s.outputHash };
    await this.save(p); return this.open(p.id);
  }
  async checkedInputs(p) {
    const inputs = structuredClone(p.inputs);
    for (const key of ['schematic', 'pcb', 'nativeProject']) if (inputs[key]) inputs[key] = await within(this.config.workspaceRoot, inputs[key]);
    for (const pdf of inputs.datasheets || []) pdf.path = await within(this.config.workspaceRoot, pdf.path);
    return inputs;
  }
  async structuredEligible(p) {
    return Boolean(p.inputsBundle && p.caseInputSignature === this.designSignature(p.inputs) && p.bundleHash === hash(await tree(p.inputsBundle)));
  }
  designSignature(inputs) { const { datasheets, stageNotes, ...design } = inputs; return hash({ ...Object.fromEntries(Object.entries(design).filter(([,v]) => v !== '' && v != null)), stageNotes: Object.fromEntries(Object.entries(stageNotes || {}).filter(([,v]) => v.trim())) }); }
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
    for (const prior of p.stages.filter(x => x.id < s.id)) if (prior.status !== 'done' || !prior.confirmed) throw new Error(`请先执行并确认“${prior.title}”；有缺项时可选择继续草稿。`);
    if (!replay && (!this.config.allowModelCalls || !this.ai)) throw new Error('本步需要 Harness 当前模型。请配置模型后执行；离线页面仅用于查看输入。');
    const inputs = await this.checkedInputs(p);
    this.invalidate(p, s.id);
    const output = path.join(this.dir(id), 'steps', String(s.id), randomUUID()); await fs.mkdir(output, { recursive: true });
    s.status = 'running'; s.startedAt = new Date().toISOString(); s.output = output; s.files = []; s.gaps = []; s.assumptions = [];
    delete s.outputHash; await this.save(p);
    const dependencies = Object.fromEntries(p.stages.filter(x => x.id < s.id).map(x => [x.id, x.output]));
    const request = { stage: s.id, output, mode: p.mode, inputs, dependencies, cli: this.config.kicadCli, plan: s.plan,
      inputsBundle: p.inputsBundle, structuredEligible: await this.structuredEligible(p), skip3d: this.config.skip3d === true };
    try {
      const snapshot = await this.snapshotInputs(inputs, output); request.inputs = snapshot.inputs;
      p.inputFiles = snapshot.files; s.inputFiles = snapshot.files;
      if (p.inputsBundle) await writeJSON(path.join(output, 'default-input-catalog.json'), { bundleHash: p.bundleHash, files: await tree(p.inputsBundle) });
      const runtime = { node: process.version, platform: process.platform, plugin: version,
        implementation: [...await tree(path.join(packageRoot, 'python')), ...await tree(path.join(packageRoot, 'src'))] };
      await writeJSON(path.join(output, 'environment.json'), runtime);
      await writeJSON(path.join(output, 'request.json'), request);
      await this.runProcess([path.join(packageRoot, 'python/intake.py'), path.join(output, 'request.json')], output, signal);
      if (!replay) {
        const evidence = [{ scope: 'inputs', files: await this.inputIndex(p, s.id) }, { scope: 'prepared', files: await tree(path.join(output, 'prepared')) }];
        for (const dir of Object.values(dependencies)) {
          const index = Object.entries(dependencies).find(([,v]) => v === dir)[0];
          evidence.push({ scope: 'stage:' + index, result: await readJSON(path.join(dir, 'result.json')), files: (await tree(dir)).filter(f => !/input-snapshot|model-log/.test(f.path)) });
        }
        const records = []; const record = async value => {
          if (value.event === 'request') { p.modelRequests++; await this.save(p); }
          records.push({ at: new Date().toISOString(), ...value }); await writeJSON(path.join(output, 'model-log.json'), records);
        };
        s.plan = await this.ai.generate({ project: { mode: p.mode }, stage: { id: s.id, title: s.title, input: s.input, gaps: p.stages.slice(0, s.id - 1).flatMap(x => x.gaps) }, request, evidence,
          read: item => this.readEvidence(p, s.id, item, path.join(output, 'prepared')), record }, signal);
        request.plan = s.plan; s.planOrigin = 'live-ai'; await writeJSON(path.join(output, 'ai-output.json'), s.plan);
      }
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
      const result = await readJSON(path.join(output, 'result.json'));
      if (!result.summary || !Array.isArray(result.gaps)) throw new Error('阶段输出缺少 summary/gaps，不能记为成功。');
      for (const f of snapshot.files) if (hash(await fs.readFile(f.original)) !== f.sha256) throw new Error('执行期间原始输入文件发生变化，请重新确认资料。');
      if (p.inputsBundle && hash(await tree(p.inputsBundle)) !== p.bundleHash) throw new Error('执行期间默认输入发生变化，请重新载入资料。');
      for (const prior of p.stages.filter(x => x.id < s.id)) if (hash(await tree(prior.output)) !== prior.outputHash) throw new Error('执行期间上游文件发生变化，当前结果不能确认。');
      const intake = await readJSON(path.join(output, 'prepared/intake.json'));
      const inheritedGaps = p.stages.filter(x => x.id < s.id).flatMap(x => x.gaps).filter(g => !(result.erc && g.startsWith('ERC：')) && !(result.drc && g.startsWith('DRC：')));
      s.result = result; s.gaps = [...new Set([...inheritedGaps, ...intake.gaps, ...(s.plan.gaps || []), ...result.gaps])];
      s.assumptions = [...new Set([...p.stages.filter(x => x.id < s.id).flatMap(x => x.assumptions || []), ...(s.plan.assumptions || [])])];
      if (s.id === 7) {
        await writeJSON(path.join(output, 'frozen-evidence.json'), { schemaVersion: 1, projectId: p.id, inputs: p.inputs, modelRequests: p.modelRequests,
          sourceFiles: p.inputFiles, defaultInputsHash: p.bundleHash, stages: p.stages.map(x => ({ id: x.id, source: x.source, plan: x.executedPlan || x.plan, inputFiles: x.inputFiles, confirmation: x.confirmation, output: x.output, outputHash: x.outputHash, gaps: x.gaps, assumptions: x.assumptions })), environment: runtime });
        await this.runProcess([path.join(packageRoot, 'python/archive.py'), path.join(output, 'request.json')], output, signal);
      }
      s.files = await tree(output); s.outputHash = hash(s.files); s.status = 'done';
      s.finishedAt = new Date().toISOString(); s.executedPlan = structuredClone(s.plan);
      if (replay) { s.confirmed = true; s.confirmation = { actor: 'replay', draft: true, inherited: true, outputHash: s.outputHash }; }
      p.events.push({ stage: s.id, source: s.source, at: s.finishedAt, outcome: 'done' });
    } catch (error) {
      s.status = signal?.aborted ? 'cancelled' : 'failed'; s.error = String(error.message).slice(-4500);
      s.finishedAt = new Date().toISOString(); p.events.push({ stage: s.id, at: s.finishedAt, outcome: s.status });
      await this.save(p); throw error;
    }
    await this.save(p); return this.open(id);
  }
  async start(a) {
    this.guard(a.projectId); const controller = new AbortController();
    const task = { controller, promise: null }; this.jobs.set(a.projectId, task);
    task.promise = this.execute(a.projectId, a.stage, controller.signal).catch(async error => {
      const p = await this.load(a.projectId); const s = this.stage(p, a.stage); s.error = error.message; await this.save(p);
    }).finally(() => this.jobs.delete(a.projectId));
    return { started: true, projectId: a.projectId };
  }
  async replay(id) {
    this.guard(id); const original = await this.open(id);
    if (original.stages.some(s => s.status !== 'done' || !s.confirmed)) throw new Error('重放需要全部步骤有效且经工程师确认。');
    const p = await this.create({ caseId: original.caseId, label: original.label + ' · 空目录重放' });
    const snapshot = await this.snapshotInputs(await this.checkedInputs(original), this.dir(p.id));
    p.inputs = snapshot.inputs;
    for (const s of p.stages) {
      s.source = 'replay'; s.plan = structuredClone(original.stages[s.id - 1].executedPlan);
      if (JSON.stringify(s.plan).includes(this.dir(original.id)) || JSON.stringify(s.plan).includes(this.dir(original.id).replaceAll('\\', '/'))) throw new Error('本轮脚本硬编码了旧运行目录，无法独立重放。请改为读取 request.inputs/dependencies。');
    }
    await this.save(p);
    const control = new AbortController(); this.jobs.set(id, { controller: control }); this.jobs.set(p.id, { controller: control });
    try {
      for (let stage = 1; stage <= 7; stage++) await this.execute(p.id, stage, control.signal, { replay: true });
      const repeated = await this.load(p.id);
      const a = await readJSON(path.join(original.stages[6].output, 'project-content.json'));
      const b = await readJSON(path.join(repeated.stages[6].output, 'project-content.json'));
      const differences = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
      original.replay = { projectId: p.id, at: new Date().toISOString(), match: !differences.length, compared: Object.keys(a).length, differences, modelRequests: repeated.modelRequests, method: 'Recorded model decisions; deterministic replay' };
      await this.save(original); return original.replay;
    } finally { this.jobs.delete(id); this.jobs.delete(p.id); }
  }
  async files(directory) {
    const dir = await within(this.config.workspaceRoot, directory || this.config.workspaceRoot);
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return { directory: dir, parent: dir === await fs.realpath(this.config.workspaceRoot) ? null : path.dirname(dir),
      entries: entries.filter(e => !e.isSymbolicLink() && !e.name.startsWith('.')).slice(0, 500).map(e => ({ name: e.name, directory: e.isDirectory(), path: path.join(dir, e.name) })) };
  }
  async dispatch(a, signal, actor = 'model') {
    if (a.action === 'list') return this.list();
    if (a.action === 'create') return this.create(a);
    if (a.action === 'files') return this.files(a.directory);
    if (a.action === 'open') return this.open(a.projectId);
    if (a.action === 'read') { const p = await this.open(a.projectId); return this.readEvidence(p, Number(a.stage || 1), a, this.stage(p, a.stage || 1).output ? path.join(this.stage(p, a.stage || 1).output, 'prepared') : undefined); }
    if (a.action === 'update') return this.update(a);
    if (a.action === 'confirm') return this.confirm(a, actor);
    if (a.action === 'cancel') { this.jobs.get(a.projectId)?.controller.abort(); return { cancelled: true }; }
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
