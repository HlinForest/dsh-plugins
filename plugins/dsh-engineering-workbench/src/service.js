import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const require = createRequire(import.meta.url);
const packageRoot = name => path.dirname(path.dirname(require.resolve(name)));
// Legacy routes resolve their optional provider only when invoked.
async function optional(name, suffix) {
  try { return await import(suffix ? pathToFileURL(path.join(packageRoot(name), suffix)) : name); }
  catch (error) { if (error.code === 'ERR_MODULE_NOT_FOUND' || error.code === 'MODULE_NOT_FOUND') throw new Error(`此功能需要安装 ${name}；其他任务仍可使用。`); throw error; }
}
const loadCatalog = async (...args) => (await optional('dsh-megmeet/domain')).loadCatalog(...args);
const parseRequirements = async (...args) => (await optional('dsh-megmeet/domain')).parseRequirements(...args);
const searchProducts = async (...args) => (await optional('dsh-megmeet/domain')).searchProducts(...args);
const buildSolutionReport = async (...args) => (await optional('dsh-megmeet/reporting')).buildSolutionReport(...args);
const exportReport = async (...args) => (await optional('dsh-megmeet/reporting')).exportReport(...args);
const loadProject = async (...args) => (await optional('dsh-pcb-review', 'src/service.js')).loadProject(...args);
const exec = promisify(execFile);
const digest = b => createHash('sha256').update(b).digest('hex');
const exact = (value, keys) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) throw new Error('不支持的参数。');
};
export function selectionInput(input) {
  exact(input, ['load', 'temperature', 'width', 'catalog', 'revision']);
  for (const [key, min, max] of [['load', 1, 1000], ['temperature', -20, 85], ['width', 1, 300]]) {
    if (typeof input[key] !== 'number' || !Number.isFinite(input[key]) || input[key] < min || input[key] > max) throw new Error(`${key} 超出允许范围。`);
  }
  if (!['v1', 'v2'].includes(input.catalog)) throw new Error('资料库必须为 v1 或 v2。');
  return input;
}
export function requirementText(p) {
  return `输出电压：24VDC；输入电压：176–264VAC；输入频率：50–60Hz；安装方式：导轨；本体宽度≤${p.width}mm；DC OK继电器：有；持续负载：${p.load}W；设计裕量：20%；环境温度：${p.temperature}℃；安装姿态：垂直且输入端子朝下；海拔：1000m；上方间距：50mm；下方间距：40mm；侧面间距：15mm。`;
}

export class Workbench {
  constructor(config) {
    this.config = config;
    for (const [key, value] of Object.entries(config)) if (value && !path.isAbsolute(value)) throw new Error(`${key} 需要绝对路径。`);
    this.events = []; this.assets = new Map(); this.busy = new Set(); this.board = null;
  }
  async init() {
    if (!this.config.workDirectory) throw new Error('请配置工作目录。');
    await fs.mkdir(this.config.workDirectory, { recursive: true });
  }
  status() {
    return { now: Date.now(), tasks: this.events.map(t => ({ ...t, steps: t.steps.map(s => ({ ...s })) })), configured: !!this.config.workDirectory, capabilities: { selection: !!this.config.catalogPath, engineering: !!this.config.workspaceRoot, kicad: !!this.config.kicadCli, pdfAndAltium: !!this.config.engineeringPython } };
  }
  record(label, origin = 'workbench', steps = []) {
    const t = { id: randomUUID(), label, origin, startedAt: Date.now(), state: 'running', steps: steps.map(label => ({ label, state: 'pending' })) };
    this.events.unshift(t);
    const running = this.events.filter(x => x.state === 'running');
    this.events = [...running, ...this.events.filter(x => x.state !== 'running').slice(0, 30)].sort((a, b) => b.startedAt - a.startedAt);
    return t;
  }
  finish(task, error) {
    task.finishedAt = Date.now(); task.state = error ? 'failed' : 'done';
    if (error) task.error = String(error.message ?? error).slice(0, 350);
  }
  async job(key, title, steps, run) {
    if (this.busy.has(key)) { const e = new Error('同类任务仍在执行，请稍候。'); e.status = 409; throw e; }
    this.busy.add(key);
    const task = this.record(title, 'workbench', steps);
    const stage = async (index, fn) => {
      task.steps[index].state = 'running';
      try { const value = await fn(); task.steps[index].state = 'done'; return value; }
      catch (error) { task.steps[index].state = 'failed'; throw error; }
    };
    try { const value = await run(stage); this.finish(task); return value; }
    catch (error) { this.finish(task, error); throw error; }
    finally { this.busy.delete(key); }
  }
  async asset(file, type) {
    const actual = await fs.realpath(file); const stat = await fs.stat(actual);
    if (!stat.isFile() || stat.size > 32 * 1024 * 1024) throw new Error('文件不可预览或超过 32 MiB。');
    const id = randomUUID();
    this.assets.set(id, { path: actual, type, hash: digest(await fs.readFile(actual)) });
    if (this.assets.size > 1500) this.assets.delete(this.assets.keys().next().value);
    return `/api/engineering-workbench/file?id=${id}`;
  }
  async readAsset(id) {
    const asset = this.assets.get(id);
    if (!asset) { const e = new Error('预览已过期，请重新运行。'); e.status = 404; throw e; }
    const buffer = await fs.readFile(asset.path);
    if (digest(buffer) !== asset.hash) { const e = new Error('文件已变化，请重新生成预览。'); e.status = 409; throw e; }
    return { buffer: asset.presentation || buffer, type: asset.type, name: path.basename(asset.path), policy: asset.policy };
  }
  async analyze(input) {
    const p = selectionInput(input);
    const file = p.catalog === 'v1' ? this.config.catalogV1Path : this.config.catalogPath;
    if (!file) throw new Error('请配置对应资料库路径。');
    const catalog = await loadCatalog(file);
    const text = requirementText(p);
    const analysis = await searchProducts(catalog, await parseRequirements(text), { limit: 50, includeIncompatible: true });
    return { p, file, catalog, text, analysis };
  }
  async select(input) {
    return this.job(`selection-${randomUUID()}`, '校验产品与连续功率', ['核对资料并校验工况', '整理候选与证据'], async step => {
      const { p, file, catalog, text, analysis } = await step(0, () => this.analyze(input));
      return step(1, async () => {
        const sources = [];
        for (const source of catalog.sources) sources.push({ id: source.id, title: source.title, version: source.version, url: await this.asset(path.resolve(path.dirname(file), source.file), 'application/pdf') });
        return { parameters: p, text, requiredW: p.load * 1.2, ...analysis, sources, generatedAt: new Date().toISOString() };
      });
    });
  }
  async selectionReport(input) {
    return this.job('selection-report', '生成可追溯选型报告', ['复核资料版本', '保存报告'], async step => {
      const { catalog, text, analysis } = await step(0, () => this.analyze(input));
      if (!input.revision || input.revision !== catalog.revision) throw new Error('资料库版本已变，请重新校验后导出。');
      return step(1, async () => {
        const report = await buildSolutionReport(catalog, analysis, text);
        const out = await exportReport(report, path.join(this.config.workDirectory, 'selection-reports'));
        return { html: await this.asset(out.htmlPath, 'text/html; charset=utf-8'), json: await this.asset(out.jsonPath, 'application/json'), createdAt: new Date().toISOString() };
      });
    });
  }
  async command(args, signal) {
    if (!this.config.kicadCli) throw new Error('请配置 KiCad CLI。');
    await exec(this.config.kicadCli, args, { windowsHide: true, timeout: 120000, maxBuffer: 4 * 1024 * 1024, signal });
  }
  async schematicView(file, directory, signal) {
    await fs.mkdir(directory, { recursive: true });
    await this.command(['sch', 'export', 'svg', '--exclude-drawing-sheet', '-o', directory, file], signal);
    const names = (await fs.readdir(directory)).filter(x => x.endsWith('.svg')).sort();
    if (!names.length) throw new Error('KiCad 未生成原理图预览。');
    const name = names.find(x => x === path.basename(file, '.kicad_sch') + '.svg') ?? names[0];
    const target = path.join(directory, name); const source = await fs.readFile(target, 'utf8');
    const width = Number(source.match(/\bwidth="([\d.]+)mm"/)?.[1]) || 297;
    const height = Number(source.match(/\bheight="([\d.]+)mm"/)?.[1]) || 210;
    return { url: await this.asset(target, 'image/svg+xml'), width, height, pages: names.length };
  }
  async review(signal) {
    return this.job('board', '读取工程并检查电路', ['导出最新网表与位置', '执行项目规则', '生成工程预览'], async step => {
      await this.init();
      const original = await fs.readFile(this.config.currentSchematic);
      const pcbOriginal = await fs.readFile(this.config.pcbPath);
      const directory = await fs.mkdtemp(path.join(this.config.workDirectory, 'review-'));
      const { board, report } = await step(0, async () => {
        const configured = JSON.parse(await fs.readFile(this.config.projectFile, 'utf8'));
        await this.command(['sch', 'export', 'netlist', '--format', 'kicadxml', '-o', path.join(directory, 'netlist.xml'), this.config.currentSchematic], signal);
        await this.command(['pcb', 'export', 'pos', '--format', 'csv', '--units', 'mm', '--side', 'both', '-o', path.join(directory, 'positions.csv'), this.config.pcbPath], signal);
        await fs.writeFile(path.join(directory, 'project.json'), JSON.stringify({ schemaVersion: 1, project: path.basename(this.config.currentSchematic, '.kicad_sch'), format: 'kicad-xml', netlistPath: 'netlist.xml', positionsPath: 'positions.csv', context: configured.context ?? {} }));
        return loadProject(path.join(directory, 'project.json'), signal);
      });
      await step(1, async () => {
        if (digest(original) !== digest(await fs.readFile(this.config.currentSchematic)) || digest(pcbOriginal) !== digest(await fs.readFile(this.config.pcbPath))) throw new Error('工程在导出时发生变化，请保存后重新检查。');
      });
      return step(2, async () => {
        const schematic = await this.schematicView(this.config.currentSchematic, path.join(directory, 'schematic'), signal);
        const pcb = path.join(directory, 'board.svg');
        await this.command(['pcb', 'export', 'svg', '--layers', 'F.Cu,B.Cu,F.SilkS,B.SilkS,Edge.Cuts', '--mode-single', '--page-size-mode', '2', '--exclude-drawing-sheet', '-o', pcb, this.config.pcbPath], signal);
        if (digest(original) !== digest(await fs.readFile(this.config.currentSchematic)) || digest(pcbOriginal) !== digest(await fs.readFile(this.config.pcbPath))) throw new Error('工程在渲染时发生变化，请重试。');
        const { placements } = await optional('dsh-schematic-sync', 'src/sexpr.js');
        this.board = { project: board.project, components: board.components, placements: placements(original.toString('utf8')), report, schematic, pcb: await this.asset(pcb, 'image/svg+xml'), generatedAt: new Date().toISOString(), originalHash: digest(original) };
        this.snapshotProject = path.join(directory, 'project.json');
        return this.board;
      });
    });
  }
  async refreshProject(signal) {
    const configuredBefore = await fs.readFile(this.config.projectFile);
    const board = await this.review(signal);
    if (!configuredBefore.equals(await fs.readFile(this.config.projectFile))) throw new Error('项目配置已变化，请重新读取。');
    const snapshot = JSON.parse(await fs.readFile(this.snapshotProject, 'utf8'));
    snapshot.netlistPath = path.resolve(path.dirname(this.snapshotProject), snapshot.netlistPath);
    snapshot.positionsPath = path.resolve(path.dirname(this.snapshotProject), snapshot.positionsPath);
    await fs.writeFile(path.join(this.config.workDirectory, `project-config-before-${randomUUID()}.json`), configuredBefore, { flag: 'wx' });
    const temp = this.config.projectFile + '.' + randomUUID() + '.tmp';
    await fs.writeFile(temp, JSON.stringify(snapshot, null, 2), { flag: 'wx' });
    signal?.throwIfAborted();
    await fs.rename(temp, this.config.projectFile);
    return board;
  }
  async compare(input, signal) {
    exact(input, ['ref', 'value']);
    if (typeof input.ref !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,30}$/.test(input.ref)) throw new Error('请输入准确位号。');
    if (typeof input.value !== 'string' || !/^[A-Za-z0-9 .µμΩ%+\/-]{1,40}$/.test(input.value)) throw new Error('请输入简单元件值，例如 10k 或 100nF。');
    return this.job('board', `验证 ${input.ref} 的候选修改`, ['保存独立快照', '检查修改前差异', '修改候选并验证', '渲染前后对比'], async step => {
      await this.init();
      const original = await fs.readFile(this.config.currentSchematic);
      const beforeParts = placements(original.toString('utf8'));
      const item = beforeParts.find(x => x.ref === input.ref);
      if (!item) throw new Error(`工程中没有 ${input.ref}。`);
      const { SyncService } = await optional('dsh-schematic-sync/engine');
      const service = new SyncService({ workspaceRoot: this.config.workspaceRoot, workDirectory: path.join(this.config.workDirectory, 'schematic-tasks'), kicadCli: this.config.kicadCli, allowApply: false });
      const text = `${input.ref} 改为 ${input.value}`;
      const task = await step(0, async () => {
        const task = await service.begin({ currentPath: this.config.currentSchematic, targetText: text }, signal);
        await service.define(task.taskId, task.target.revision, { schemaVersion: 1, scope: 'partial', requirements: [{ id: 'selected-component', kind: 'component', ref: input.ref, properties: { value: input.value }, certain: true, evidence: { quote: text } }], unresolved: [] });
        return task;
      });
      const before = await step(1, () => service.compare(task.taskId, 'current', signal));
      const verified = await step(2, async () => {
        const candidate = await fs.readFile(task.candidate);
        await service.prepare(task.taskId, digest(candidate), undefined, signal);
        return service.verify(task.taskId, signal);
      });
      return step(3, async () => {
        const directory = path.join(this.config.workDirectory, 'schematic-tasks', task.taskId, 'preview');
        const baseline = path.join(this.config.workDirectory, 'schematic-tasks', task.taskId, 'baseline', path.relative(this.config.workspaceRoot, this.config.currentSchematic));
        const beforeView = await this.schematicView(baseline, path.join(directory, 'before'), signal);
        const afterView = await this.schematicView(task.candidate, path.join(directory, 'after'), signal);
        if (digest(original) !== digest(await fs.readFile(this.config.currentSchematic))) throw new Error('原工程已变化，请重新比较。');
        return { taskId: task.taskId, ref: input.ref, oldValue: item.value, newValue: input.value, placement: item, before, after: verified.comparison, erc: verified.erc, canApply: verified.canApply, originalUnchanged: true, beforeView, afterView, pdf: await this.asset(verified.pdf, 'application/pdf'), report: await this.asset(verified.report, 'application/json'), candidatePath: task.candidate, generatedAt: new Date().toISOString() };
      });
    });
  }
}
