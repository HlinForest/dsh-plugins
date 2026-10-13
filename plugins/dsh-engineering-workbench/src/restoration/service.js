import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { within, json, readLimited } from '../engineering/io.js';
import { prepareNative } from './intake.js';

const exec = promisify(execFile);
const digest = data => createHash('sha256').update(data).digest('hex');
const read = async file => JSON.parse((await readLimited(file)).toString('utf8').replace(/^\uFEFF/, ''));
const uuid = /^[a-f0-9-]{36}$/;
const prefix = '02_extracted/native_schematic/';
const allowed = /^(00_native\/|02_extracted\/native_(schematic|pcb)\/|04_assets\/native_(models|fonts)\/|05_datasheets\/)/;
const unsupported = /\.(?:py|ps1|js|mjs|cmd|bat|exe|kicad_sch|kicad_pcb|kicad_sym|kicad_mod)$/i;
const requirements = [
  ['identity', '确认原始工程版本和装配变体', '工程负责人填写源版本、有效变体和归档日期，绑定原始文件哈希。'],
  ['native-netlist', '原 Altium 编译网表与 NC 报告', '在原 Altium 版本中打开原工程，编译后导出逐引脚网表及未连接引脚清单。'],
  ['native-pages', '原始原理图与 PCB 分层 PDF', '从原工程输出全部原理图页和各 PCB 层 PDF，保留页框、文字与显示设置。'],
  ['native-bom', '原始 BOM 与物料身份', '导出逐位号 BOM，包含型号、封装、装配状态和有效变体；不能用名称猜采购型号。'],
  ['native-libraries', '企业库及版本', '从原软件打包使用的符号、封装及模型，提供库版本和来源。'],
  ['native-board-report', '原板框、层叠、规则及 DRC 报告', '在原 Altium 工程导出层叠、规则、板框与图元统计和原始 DRC。'],
];

export async function projectFiles(project) {
  const root = path.dirname(project), rows = [];
  async function walk(dir) {
    for (const item of await fs.readdir(dir, { withFileTypes: true })) {
      if (item.isSymbolicLink()) throw new Error('工程依赖不能使用符号链接。');
      const file = path.join(dir, item.name);
      if (item.isDirectory()) { if (!['.git', '__pycache__', 'reference', 'reports', 'checks', 'exports', 'deliveries'].includes(item.name) && !item.name.startsWith('.')) await walk(file); }
      else if (/\.(?:kicad_(?:pro|sch|pcb|sym|mod|dru|wks)|step|stp|wrl|ttf|otf|ttc|csv|py|mjs|js)$/i.test(item.name) || ['sym-lib-table', 'fp-lib-table', 'design_rule_mapping.json'].includes(item.name) || /^fonts?(?:[_-].*)?\.json$/i.test(item.name)) rows.push({ path: path.relative(root, file).replaceAll('\\', '/'), sha256: digest(await readLimited(file)) });
    }
  }
  await walk(root); return rows.sort((a, b) => a.path.localeCompare(b.path));
}
export async function replayCodeFiles(entry) {
  return (await projectFiles(entry)).filter(f => /\.(?:py|js|mjs)$/i.test(f.path));
}

export class RestorationRuns {
  constructor(config, engineering) { this.config = config; this.engineering = engineering; this.locks = new Set(); }
  get root() { return path.join(this.config.workDirectory, 'restoration'); }
  dir(id) { if (!uuid.test(id || '')) throw new Error('复原任务 ID 无效。'); return path.join(this.root, id); }
  async load(id) { return read(path.join(this.dir(id), 'run.json')); }
  async save(run) { run.updatedAt = new Date().toISOString(); await json(path.join(this.dir(run.id), 'run.json'), run); }
  async inputIntegrity(run) {
    const input = path.join(this.dir(run.id), 'input');
    if (digest(await readLimited(path.join(input, 'manifest.json'))) !== run.manifestHash) throw new Error('输入清单已变化，请重新创建任务。');
    for (const item of run.files) {
      const file = await within(input, path.join(input, item.path)), bytes = await readLimited(file);
      if (bytes.length !== item.bytes || digest(bytes) !== item.sha256) throw new Error('输入快照变化：' + item.path);
    }
    return input;
  }
  async present(run) {
    const view = structuredClone(run); delete view.files;
    try { await this.inputIntegrity(run); view.inputFresh = true; } catch (e) { view.inputFresh = false; view.inputError = e.message; }
    view.validationFresh = false;
    if (run.validation && view.inputFresh) {
      try { view.validationFresh = digest(JSON.stringify(await projectFiles(run.validation.project))) === run.validation.projectHash && digest(await readLimited(run.validation.report)) === run.validation.reportHash; } catch {}
    }
    if (view.validation && !view.validationFresh) view.validation.status = 'STALE';
    if (view.review) view.review.stale = !view.validationFresh || view.review.reportHash !== run.validation?.reportHash;
    view.completeOneToOneVerified = false;
    view.stages = [
      { name: '冻结输入', status: view.inputFresh ? 'PASS' : 'FAIL', input: '原工程、直接提取记录、来源和哈希' },
      { name: '原理图', status: view.validationFresh ? run.validation.schematicStatus : 'PENDING', input: '符号、所有引脚端点、连接、NC、参数与图形记录' },
      { name: 'BOM', status: 'DRAFT', input: '逐位号原始属性、封装、装配状态；采购信息不足保留草稿' },
      { name: 'PCB 与依赖', status: view.validationFresh && run.validation.stage === 'full' ? run.validation.status : 'PENDING', input: '板框、层叠、规则、全部图元、封装和模型' },
      { name: '空目录重放', status: run.replay?.match && view.validationFresh ? 'PASS' : run.replay ? 'FAIL' : 'PENDING', input: '本轮脚本、同一输入、工具版本与新目录' },
      { name: '公司评审', status: view.review && !view.review.stale ? view.review.decision : 'PENDING', input: '当前哈希对应的检查报告、差异与工程师意见' },
    ];
    return view;
  }
  async dispatch(a, signal, actor = 'model') {
    if (!a || typeof a !== 'object') throw new Error('需要复原操作参数。');
    if (!this.config.workspaceRoot || !this.config.workDirectory) throw new Error('请配置工作区和任务目录。');
    if (a.action === 'review' && actor !== 'human') throw new Error('公司评审只能在工作台由工程师记录。');
    if (a.action === 'list') {
      await fs.mkdir(this.root, { recursive: true }); const result = [];
      for (const id of await fs.readdir(this.root)) if (uuid.test(id)) { try { const r = await this.load(id); result.push({ id, label: r.label, updatedAt: r.updatedAt }); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
      return result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }
    if (a.action === 'create') return this.present(await this.create(a));
    if (a.action === 'prepare-native') return prepareNative(this, a, signal);
    if (a.action === 'preflight') return this.preflight(signal);
    const run = await this.load(a.runId);
    if (a.action === 'open') return this.present(run);
    if (this.locks.has(run.id)) throw new Error('此复原任务正在执行。');
    this.locks.add(run.id);
    try {
      const input = await this.inputIntegrity(run);
      if (a.action === 'inspect') return this.inspect(run, input, a);
      if (a.action === 'verify') await this.verify(run, input, a, signal);
      else if (a.action === 'replay') await this.replay(run, input, a, signal);
      else if (a.action === 'bind-datasheet') await this.bindDatasheet(run, input, a, signal);
      else if (a.action === 'review') {
        const current = await this.present(run);
        if (!current.validationFresh || a.reportHash !== run.validation.reportHash) throw new Error('报告已失效，请重新检查并查看当前报告。');
        if (!['needs-work', 'demo-reviewed'].includes(a.decision) || !String(a.note || '').trim()) throw new Error('需要评审结论和具体意见。');
        run.review = { decision: a.decision, note: String(a.note).slice(0, 4000), actor: 'human', at: new Date().toISOString(), reportHash: run.validation.reportHash };
      } else throw new Error('未知复原操作。');
      await this.save(run); return this.present(run);
    } finally { this.locks.delete(run.id); }
  }
  async create(a) {
    const manifestFile = await within(this.config.workspaceRoot, a.manifest), source = path.dirname(manifestFile), raw = await readLimited(manifestFile), manifest = JSON.parse(raw.toString('utf8').replace(/^\uFEFF/, ''));
    if (manifest.format !== 'harness-native-input/1' || !Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > 10000) throw new Error('需要 harness-native-input/1 冻结清单。');
    const seen = new Set(), files = [];
    for (const item of manifest.files) {
      if (typeof item.path !== 'string' || item.path.includes('\\') || item.path.split('/').some(s => !s || s === '.' || s === '..' || s.includes(':')) || !allowed.test(item.path) || unsupported.test(item.path) || !/^[a-f0-9]{64}$/i.test(item.sha256) || !Number.isSafeInteger(item.bytes) || item.bytes < 0 || seen.has(item.path.toLowerCase())) throw new Error('输入不符合原始资料白名单：' + item.path);
      seen.add(item.path.toLowerCase()); const file = await within(source, path.join(source, item.path)), data = await readLimited(file);
      if (data.length !== item.bytes || digest(data) !== item.sha256.toLowerCase()) throw new Error('输入哈希或大小不匹配：' + item.path);
      files.push({ ...item, sha256: item.sha256.toLowerCase() });
    }
    for (const name of ['components.json', 'pins.json', 'FileHeader.records.json', 'recomputed_connectivity.json']) if (!seen.has(prefix + name.toLowerCase())) throw new Error('缺少必要的直接提取证据：' + name);
    if (files.filter(f => /^00_native\/.*\.SchDoc$/i.test(f.path)).length !== 1 || files.filter(f => /^00_native\/.*\.PcbDoc$/i.test(f.path)).length !== 1) throw new Error('本适配器需要恰好一个原始 SchDoc 和一个 PcbDoc；多页或多板需要对应适配器。');
    const run = { schemaVersion: 1, id: randomUUID(), label: String(manifest.project || '原生工程复原'), createdAt: new Date().toISOString(), sourceManifest: manifestFile, manifestHash: digest(raw), files, fileCount: files.length, policy: 'native-source-only; preserve source defects; no inferred replacements', gaps: requirements.map(([id, title, obtain]) => ({ id, title, obtain, status: 'UNCONFIRMED' })), datasheets: [] };
    const input = path.join(this.dir(run.id), 'input'); await fs.mkdir(input, { recursive: true });
    for (const item of files) { const target = path.join(input, item.path); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.copyFile(await within(source, path.join(source, item.path)), target, fs.constants.COPYFILE_EXCL); }
    await fs.writeFile(path.join(input, 'manifest.json'), raw, { flag: 'wx' });
    await this.inputIntegrity(run); await this.save(run); return run;
  }
  async inspect(run, input, a) {
    const components = await read(path.join(input, prefix, 'components.json')), pins = await read(path.join(input, prefix, 'pins.json')), connectivity = await read(path.join(input, prefix, 'recomputed_connectivity.json'));
    const records = (await read(path.join(input, prefix, 'FileHeader.records.json'))).records;
    if (!a.reference) return { input, manifestHash: run.manifestHash, files: run.fileCount, components: components.map(c => ({ reference: c.reference, recordIndex: c.source_locator?.record_index, sourceId: c.raw_fields.UniqueID, ownedRecordCount: c.owned_record_indices?.length })), pinCount: pins.length, netGroups: connectivity.nets.length, recordTypes: Object.fromEntries([...new Set(records.map(r => r.fields.RECORD))].map(t => [t, records.filter(r => r.fields.RECORD === t).length])), coordinates: { schematicUnitMm: 0.254, sourceY: 'up', targetY: 'down', pinLocation: 'symbol-side anchor; use recomputed_connectivity.pins[].endpoint for the electrical connection point', geometryCoverage: 'Keep all owned graphic records, including auxiliary symbols and display internals. Do not replace bodies with boxes.' }, gaps: run.gaps };
    const c = components.find(c => c.reference === a.reference); if (!c) throw new Error('位号不存在。');
    if (!Array.isArray(c.owned_record_indices)) throw new Error('组件缺少 owned_record_indices，无法可靠关联原始图元。请补提取所属记录索引。');
    const ids = new Set(c.owned_record_indices), owned = records.filter(r => ids.has(r.index));
    if (owned.length !== ids.size) throw new Error('组件所属图元记录不齐全。');
    return { component: c, pins: pins.filter(p => p.reference === a.reference).map(p => ({ ...p, electricalEndpoint: connectivity.pins.find(x => x.ref === p.reference && String(x.pin) === String(p.pin))?.endpoint })), nets: connectivity.nets.filter(n => n.nodes.some(x => x[0] === a.reference)), ownedRecords: owned, completeness: 'Includes source records, not a claim of successful conversion' };
  }
  async command(command, args, log, signal) {
    const started = Date.now(); let record;
    try { const r = await exec(command, args, { windowsHide: true, timeout: 600000, maxBuffer: 32 * 1024 * 1024, signal, env: { ...process.env, PYTHONUTF8: '1' } }); record = { command, args, exitCode: 0, stdout: r.stdout, stderr: r.stderr }; }
    catch (e) { record = { command, args, exitCode: e.code ?? -1, stdout: e.stdout || '', stderr: e.stderr || e.message }; }
    record.elapsedMs = Date.now() - started; await json(log, record);
    if (record.exitCode !== 0) throw new Error('命令执行失败，不能把已有文件当作本次成功：' + log);
    return record;
  }
  async preflight(signal) {
    await fs.mkdir(this.root, { recursive: true }); const token = randomUUID(), dir = path.join(this.root, 'pre-' + token.slice(0, 8)); await fs.mkdir(dir);
    const version = await this.command(this.config.kicadCli, ['--version'], path.join(dir, 'cli.json'), signal);
    const python = await this.command(this.config.kicadPython, ['-c', 'import sys,pcbnew,sexpdata,wx; print(sys.version); print(pcbnew.GetBuildVersion())'], path.join(dir, 'python.json'), signal);
    return { status: 'PASS', kicad: version.stdout.trim(), python: python.stdout.trim(), records: dir, shellProbe: 'Harness must separately execute a simple pwsh write/read in its own sandbox; host process readiness does not prove shell ACL readiness.' };
  }
  async verify(run, input, a, signal) {
    const project = await within(this.config.workspaceRoot, a.project);
    if (!project.endsWith('.kicad_pro') || !['schematic', 'full'].includes(a.stage || 'full')) throw new Error('请选择 KiCad 工程和检查阶段。');
    delete run.validation; delete run.review; delete run.replay; await this.save(run);
    const before = await projectFiles(project), dir = path.join(this.dir(run.id), 'a-' + randomUUID().slice(0, 8)); await fs.mkdir(dir);
    await this.command(this.config.kicadPython, [fileURLToPath(new URL('./audit.py', import.meta.url)), '--input', input, '--project', project, '--out', dir, '--cli', this.config.kicadCli, '--stage', a.stage || 'full'], path.join(dir, 'execution.json'), signal);
    await this.inputIntegrity(run);
    const after = await projectFiles(project); if (digest(JSON.stringify(before)) !== digest(JSON.stringify(after))) throw new Error('检查期间工程变化，请重新执行检查。');
    const report = path.join(dir, 'independent-verification.json'), data = await read(report);
    const schematicFailures = data.failedChecks.filter(k => !['pcb', 'pcbImportedGeometry', 'pcbBoardGraphics', 'modelDependencies'].includes(k));
    run.validation = { project, stage: a.stage || 'full', status: data.status, schematicStatus: schematicFailures.length ? 'FAIL' : 'PARTIAL', failedChecks: data.failedChecks, checks: Object.fromEntries(Object.entries(data.checks).filter(([k]) => !['placement', 'parameters', 'modelDependencies'].includes(k))), report, reportHash: digest(await readLimited(report)), projectHash: digest(JSON.stringify(after)), files: after, at: new Date().toISOString() };
    delete run.review;
  }
  async replay(run, input, a, signal) {
    if (!(await this.present(run)).validationFresh) throw new Error('先对当前工程执行独立检查，再重放。');
    const entry = await within(this.config.workspaceRoot, a.entry);
    if (!entry.endsWith('.py')) throw new Error('本版重放入口须为接受 --input/--output 的 Python 脚本。');
    const codeBefore = await replayCodeFiles(entry), output = path.join(this.dir(run.id), 'r-' + randomUUID().slice(0, 8)); await fs.mkdir(output);
    const command = await this.command(this.config.kicadPython, [entry, '--input', input, '--output', output], path.join(this.dir(run.id), path.basename(output) + '.command.json'), signal);
    await this.inputIntegrity(run);
    if (digest(JSON.stringify(codeBefore)) !== digest(JSON.stringify(await replayCodeFiles(entry)))) throw new Error('重放期间入口代码变化。');
    const expected = run.validation.files.filter(f => !/\.(py|mjs|js)$/.test(f.path));
    if (!expected.some(f => f.path.endsWith('.kicad_sch')) || !expected.some(f => f.path.endsWith('.kicad_pcb'))) throw new Error('缺少完整工程基准。');
    const differences = [];
    for (const item of expected) { const file = path.join(output, item.path); let actual = null; try { actual = digest(await readLimited(await within(output, file))); } catch {} if (actual !== item.sha256) differences.push({ path: item.path, expected: item.sha256, actual }); }
    run.replay = { output, entry, codeBefore, elapsedMs: command.elapsedMs, match: !differences.length, differences, compared: expected.length, reportHash: run.validation.reportHash, at: new Date().toISOString(), scope: 'Byte comparison of engineering files, libraries, models and CSV; logs and timestamps excluded' };
  }
  async bindDatasheet(run, input, a, signal) {
    if (!this.engineering) throw new Error('请在工程工作台的读手册功能中读取 PDF，再绑定到复原任务。');
    if (!String(a.mpn || '').trim() || !String(a.package || '').trim() || !Array.isArray(a.references) || !a.references.length) throw new Error('需要准确型号、封装和至少一个位号。');
    const components = await read(path.join(input, prefix, 'components.json'));
    if (a.references.some(ref => !components.some(c => c.reference === ref))) throw new Error('绑定位号不在原工程中。');
    const task = await this.engineering.load(a.taskId); if (task.kind !== 'datasheet') throw new Error('需要已经读取的 PDF 手册任务。');
    const index = await this.engineering.manuals.document(task, signal), status = await this.engineering.manuals.status(task);
    run.datasheets.push({ taskId: task.id, title: task.label, mpn: String(a.mpn).trim(), package: String(a.package).trim(), references: [...new Set(a.references)], sourceHash: index.sourceHash, pages: index.pages.length, reading: status, reviewed: false, bindingStatus: 'needs-engineer-review', note: '型号和封装绑定由提交者指定；参数仅来自手册阅读结果中的页码与原文，尚未替换原工程属性。' });
  }
}
