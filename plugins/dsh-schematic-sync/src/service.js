import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { inside, within, readLimited, hash, run, json, writeJson, collect, assertFresh, assertUnlocked, atomicReplace, withProjectLock } from './io.js';
import { schematic, nodes, placements, patch, synchronize } from './sexpr.js';
import { parseNetlist, compareNative, compareContract, validateContract, objectInventory, unexpectedChanges } from './compare.js';
import { renderReference, interpretReference } from './reference.js';

const manifest = files => files.map(({ path, hash }) => ({ path, hash }));
const recordHash = data => hash(JSON.stringify(data));
const stem = p => path.basename(p, '.kicad_sch');
export class SyncService {
  constructor(config, { nativeVision } = {}) {
    this.config = { kicadCli: 'kicad-cli', python: 'python', allowApply: false, visionBaseUrl: '', visionModel: '', visionKeyEnv: 'SCHEMATIC_VISION_API_KEY', ...config };
    this.queue = Promise.resolve();
    this.nativeVision = nativeVision;
  }
  serial(fn) { const next = this.queue.then(fn); this.queue = next.catch(() => {}); return next; }
  async init() {
    const c = this.config;
    if (!c.workspaceRoot || !path.isAbsolute(c.workspaceRoot) || !c.workDirectory || !path.isAbsolute(c.workDirectory)) throw new Error('Configure absolute workspaceRoot and workDirectory');
    c.workspaceRoot = await fs.realpath(c.workspaceRoot);
    await fs.mkdir(c.workDirectory, { recursive: true });
    c.workDirectory = await fs.realpath(c.workDirectory);
  }
  async bundle(file, root = this.config.workspaceRoot) {
    const files = await collect(root, file), seen = new Set(files.map(f => f.path));
    for (const dir of new Set(files.map(f => path.dirname(f.path)))) {
      for (const name of await fs.readdir(dir)) {
        if (!(name.endsWith('.kicad_sym') || name === 'sym-lib-table' || name === `${stem(file)}.kicad_pro`)) continue;
        const p = await inside(root, path.join(dir, name));
        if (!seen.has(p)) { const bytes = await readLimited(p); files.push({ path: p, hash: hash(bytes), bytes }); seen.add(p); }
      }
    }
    if (files.reduce((n, f) => n + f.bytes.length, 0) > 128 * 1024 * 1024) throw new Error('Project snapshot exceeds 128 MiB');
    return files;
  }
  async copyBundle(files, dir) {
    for (const f of files) { const to = path.join(dir, path.relative(this.config.workspaceRoot, f.path)); await fs.mkdir(path.dirname(to), { recursive: true }); await fs.writeFile(to, f.bytes, { flag: 'wx' }); }
  }
  async begin({ currentPath, targetPath, targetText }, signal) {
    await this.init(); signal?.throwIfAborted();
    if (!!targetPath === !!targetText) throw new Error('Provide exactly one of targetPath or targetText');
    const current = await inside(this.config.workspaceRoot, currentPath);
    if (path.extname(current).toLowerCase() !== '.kicad_sch') throw new Error('currentPath must be .kicad_sch');
    if (within(this.config.workDirectory, current)) throw new Error('Current project must be outside the plugin workDirectory');
    const files = await this.bundle(current);
    const id = randomUUID(), dir = path.join(this.config.workDirectory, id); await fs.mkdir(dir);
    const relative = path.relative(this.config.workspaceRoot, current);
    const baselineDir = path.join(dir, 'baseline'); await this.copyBundle(files, baselineDir);
    const task = { id, createdAt: new Date().toISOString(), current, relative, currentManifest: manifest(files), target: null, contract: null, contractHash: null };
    if (targetText) {
      if (typeof targetText !== 'string' || targetText.length > 100000 || !targetText.trim()) throw new Error('Target text must be 1..100000 characters');
      task.target = { kind: 'text', text: targetText, hash: hash(targetText), manifest: [] };
    } else {
      const file = await inside(this.config.workspaceRoot, targetPath), ext = path.extname(file).toLowerCase();
      const kind = ext === '.kicad_sch' ? 'schematic' : ext === '.pdf' ? 'pdf' : ['.png', '.jpg', '.jpeg', '.webp'].includes(ext) ? 'image' : ['.txt', '.md'].includes(ext) ? 'text' : null;
      if (!kind) throw new Error('Target must be KiCad schematic, PDF, PNG/JPEG/WebP, TXT or Markdown');
      const bytes = await readLimited(file);
      if (kind === 'schematic') {
        const targetFiles = await this.bundle(file); await this.copyBundle(targetFiles, path.join(dir, 'target'));
        task.target = { kind, path: file, snapshot: path.join(dir, 'target', path.relative(this.config.workspaceRoot, file)), hash: hash(bytes), manifest: manifest(targetFiles) };
      } else {
        const snapshot = path.join(dir, `target${ext}`); await fs.writeFile(snapshot, bytes, { flag: 'wx' });
        task.target = { kind, path: file, snapshot, hash: hash(bytes), manifest: [{ path: file, hash: hash(bytes) }], ...(kind === 'text' ? { text: bytes.toString('utf8') } : {}) };
      }
    }
    await fs.cp(baselineDir, path.join(dir, 'candidate'), { recursive: true, errorOnExist: true, force: false });
    await assertFresh(task.currentManifest); await assertFresh(task.target.manifest);
    await writeJson(path.join(dir, 'task.json'), task);
    return { taskId: id, current, target: { kind: task.target.kind, revision: task.target.hash }, candidate: this.candidate(dir, task),
      next: task.target.kind === 'schematic' ? 'schematic_compare' : 'Read target, submit evidence-backed requirements with schematic_define_target, then compare',
      notes: ['The current input is the saved file on disk, not unsaved editor state.', 'Every task owns independent snapshots and candidates; no shared selected project.'] };
  }
  candidate(dir, task) { return path.join(dir, 'candidate', task.relative); }
  async load(id, fresh = true) {
    await this.init();
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid taskId');
    const dir = await inside(this.config.workDirectory, id), task = await json(path.join(dir, 'task.json'));
    if (task.id !== id) throw new Error('Task identity mismatch');
    if (fresh) { await assertFresh(task.currentManifest); await assertFresh(task.target.manifest); }
    return { dir, task };
  }
  async netlist(file, dir, signal) {
    const output = path.join(dir, `netlist-${randomUUID()}.xml`);
    await run(this.config.kicadCli, ['sch', 'export', 'netlist', '--format', 'kicadxml', '-o', output, file], signal);
    return parseNetlist((await readLimited(output)).toString('utf8'));
  }
  async inspect(id, which = 'current', signal) {
    const { task, dir } = await this.load(id);
    const file = which === 'candidate' ? this.candidate(dir, task) : which === 'target' ? task.target.snapshot : path.join(dir, 'baseline', task.relative);
    if (!['current', 'candidate', 'target'].includes(which) || !file || (which === 'target' && task.target.kind !== 'schematic')) throw new Error('inspect expects current/candidate/native target');
    const source = (await readLimited(file)).toString('utf8'), board = await this.netlist(file, dir, signal);
    return { file, revision: hash(source), board, placements: placements(source), objects: objectInventory(source), note: 'Source objects include library symbols; use UUID patches to preserve untouched drawing objects.' };
  }
  async reference(id, page = 1, interpret = false, signal) {
    const { task, dir } = await this.load(id);
    if (task.target.kind === 'text') return { kind: 'text', text: task.target.text, targetRevision: task.target.hash };
    if (task.target.kind === 'schematic') return this.inspect(id, 'target', signal);
    const preview = await renderReference(this.config, task.target.snapshot, dir, page, signal);
    return { targetRevision: task.target.hash, ...(interpret ? await interpretReference(this.config, preview, signal, this.nativeVision) : { preview }) };
  }
  async define(id, expectedTargetRevision, data) {
    const { task, dir } = await this.load(id);
    if (task.target.kind === 'schematic') throw new Error('Native target is already machine-readable');
    if (expectedTargetRevision !== task.target.hash) throw new Error('Target revision mismatch');
    task.contract = validateContract(data, task.target.kind, task.target.text); task.contractHash = recordHash(task.contract);
    if (['pdf', 'image'].includes(task.target.kind)) {
      for (const r of task.contract.requirements) {
        if (task.target.kind === 'image' && r.evidence.page !== 1) throw new Error('Image has one page');
        const page = path.join(dir, `reference-${r.evidence.page}.png`);
        await fs.access(page); // Require actual source pages to have been rendered/read first.
      }
    }
    await atomicReplace(path.join(dir, 'task.json'), JSON.stringify(task, null, 2));
    return { targetRevision: task.target.hash, contractRevision: task.contractHash, requirements: task.contract.requirements.length, unresolved: task.contract.unresolved,
      canApplyAfterVerification: !task.contract.unresolved.length && task.contract.requirements.every(r => r.certain), scope: 'declared_requirements_only' };
  }
  async compare(id, which = 'current', signal) {
    const { task, dir } = await this.load(id);
    if (!['current', 'candidate'].includes(which)) throw new Error('Compare expects current or candidate');
    const file = which === 'candidate' ? this.candidate(dir, task) : path.join(dir, 'baseline', task.relative);
    const source = (await readLimited(file)).toString('utf8'), board = await this.netlist(file, dir, signal);
    let report;
    if (task.target.kind === 'schematic') {
      const targetSource = (await readLimited(task.target.snapshot)).toString('utf8');
      report = compareNative(board, await this.netlist(task.target.snapshot, dir, signal), source, targetSource);
      if (nodes(schematic(source), 'sheet').length || nodes(schematic(targetSource), 'sheet').length) {
        report.matches = false; report.layoutMatches = null;
        report.notes.push('Hierarchy netlist compared; complete drawing equality and automatic modification of hierarchical projects are not supported in v0.1.');
      }
    } else {
      if (!task.contract) throw new Error('Interpret the target and call schematic_define_target first');
      // ERC-only / excluded placements can be absent from the physical netlist.
      // They still exist when checking an explicit component/absence requirement.
      const enrich = (board, text) => {
        const refs = new Map(board.components.map(c => [c.ref, c]));
        for (const p of placements(text)) {
          if (!refs.has(p.ref)) { board.components.push(p); refs.set(p.ref, p); }
          else { const c = refs.get(p.ref); c.inBom = p.inBom; c.onBoard = p.onBoard; }
        }
      };
      enrich(board, source);
      report = compareContract(board, task.contract);
      if (which === 'candidate') {
        const originalFile = path.join(dir, 'baseline', task.relative), originalSource = (await readLimited(originalFile)).toString('utf8');
        const original = await this.netlist(originalFile, dir, signal); enrich(original, originalSource);
        report.unexpectedChanges = unexpectedChanges(original, board, task.contract);
        if (report.unexpectedChanges.length) report.matches = false;
      }
    }
    await assertFresh(task.currentManifest); await assertFresh(task.target.manifest);
    return { ...report, taskId: id, compared: which, revision: hash(source), targetRevision: task.target.hash, contractRevision: task.contractHash };
  }
  async prepare(id, expectedRevision, operations, signal) {
    const { task, dir } = await this.load(id), file = this.candidate(dir, task);
    const source = (await readLimited(file)).toString('utf8');
    if (hash(source) !== expectedRevision) throw new Error('Candidate changed; inspect candidate again');
    if (nodes(schematic(source), 'sheet').length) throw new Error('Automatic editing currently requires a single-sheet source');
    let next;
    if (operations) next = patch(source, operations);
    else if (task.target.kind === 'schematic') next = synchronize(source, (await readLimited(task.target.snapshot)).toString('utf8'), stem(file));
    else {
      if (!task.contract) throw new Error('Define target requirements first');
      const patches = task.contract.requirements.filter(r => r.kind === 'component' && r.certain).map(r => ({ op: 'set_properties', ref: r.ref,
        properties: Object.fromEntries(Object.entries(r.properties).filter(([k]) => k !== 'libId').map(([k, v]) => [{ value: 'Value', footprint: 'Footprint' }[k] ?? k, v])) })).filter(o => Object.keys(o.properties).length);
      if (!patches.length) throw new Error('No automatic property edits. Use explicit insert/replace/delete/upsert_library_symbol operations for topology or new components.');
      next = patch(source, patches);
    }
    schematic(next);
    if (nodes(schematic(next), 'sheet').length) throw new Error('Candidate hierarchy is not supported for modification');
    signal?.throwIfAborted();
    await fs.writeFile(path.join(dir, `candidate-before-${randomUUID()}.kicad_sch`), source, { flag: 'wx' });
    await atomicReplace(file, next);
    return { candidate: file, revision: hash(next), changed: next !== source, next: 'schematic_verify; apply is blocked until comparison and ERC pass' };
  }
  async erc(file, dir, signal) {
    const output = path.join(dir, `erc-${randomUUID()}.json`);
    await run(this.config.kicadCli, ['sch', 'erc', '--format', 'json', '--severity-error', '--severity-warning', '-o', output, file], signal);
    const report = await json(output);
    if (!Array.isArray(report.sheets)) throw new Error('Invalid ERC output');
    return { path: output, errors: report.sheets.flatMap(s => s.violations ?? []).filter(v => v.severity === 'error'), warnings: report.sheets.flatMap(s => s.violations ?? []).filter(v => v.severity === 'warning'), report };
  }
  async verify(id, signal) {
    const { task, dir } = await this.load(id), file = this.candidate(dir, task);
    const before = hash(await readLimited(file)), comparison = await this.compare(id, 'candidate', signal);
    const erc = await this.erc(file, dir, signal);
    const pdf = path.join(dir, `candidate-${randomUUID()}.pdf`);
    await run(this.config.kicadCli, ['sch', 'export', 'pdf', '-o', pdf, file], signal);
    const after = hash(await readLimited(file));
    if (before !== after || after !== comparison.revision) throw new Error('Candidate changed during verification');
    await assertFresh(task.currentManifest); await assertFresh(task.target.manifest);
    const token = randomUUID(), ok = comparison.matches && erc.errors.length === 0;
    const candidateFiles = await this.bundle(file, path.join(dir, 'candidate'));
    const record = { token, taskId: id, checkedAt: new Date().toISOString(), candidateHash: after, candidateManifest: manifest(candidateFiles), targetHash: task.target.hash, contractHash: task.contractHash, comparison, erc: { path: erc.path, errors: erc.errors.length, warnings: erc.warnings.length }, pdf, canApply: ok };
    await writeJson(path.join(dir, `verified-${token}.json`), record);
    await writeJson(path.join(dir, `report-${token}.json`), record);
    return { ...record, report: path.join(dir, `report-${token}.json`), note: 'canApply requires target requirements to match and zero ERC errors; warnings are reported separately. PDF export does not certify visual readability.' };
  }
  async apply(id, token, signal) {
    const { task } = await this.load(id);
    return withProjectLock(task.current, () => this.applyLocked(id, token, signal));
  }
  async applyLocked(id, token, signal) {
    if (!this.config.allowApply) throw new Error('Writing current project is disabled: administrator must configure allowApply:true. Verified candidate remains available.');
    const { task, dir } = await this.load(id);
    if (!/^[0-9a-f-]{36}$/.test(token)) throw new Error('Invalid verification token');
    const verified = await json(path.join(dir, `verified-${token}.json`));
    if (!verified.canApply || verified.targetHash !== task.target.hash || verified.contractHash !== task.contractHash) throw new Error('Verification failed or target requirements changed; verify again');
    if (await fs.stat(path.join(dir, 'applied.json')).then(() => true, () => false)) throw new Error('Task already applied');
    const file = this.candidate(dir, task), bytes = await readLimited(file);
    await assertFresh(verified.candidateManifest);
    if (hash(bytes) !== verified.candidateHash) throw new Error('Candidate changed after verification');
    if (nodes(schematic(bytes.toString('utf8')), 'sheet').length || task.currentManifest.filter(f => f.path.endsWith('.kicad_sch')).length !== 1) throw new Error('Applying multi-sheet modifications is not supported');
    await assertUnlocked(task.current);
    const backup = path.join(dir, 'original.kicad_sch'), original = await readLimited(task.current);
    await fs.writeFile(backup, original, { flag: 'wx' });
    // The pending journal is written before replacement so interrupted writes remain recoverable.
    const applied = { current: task.current, backup, before: hash(original), after: hash(bytes), token, appliedAt: new Date().toISOString() };
    await writeJson(path.join(dir, 'pending-apply.json'), applied);
    signal?.throwIfAborted(); await assertFresh(task.currentManifest); await assertFresh(task.target.manifest); await assertUnlocked(task.current);
    const latest = await json(path.join(dir, 'task.json'));
    if (latest.contractHash !== task.contractHash || hash(await readLimited(file)) !== verified.candidateHash) throw new Error('Candidate or target changed while applying');
    await atomicReplace(task.current, bytes);
    await writeJson(path.join(dir, 'applied.json'), applied);
    return { ...applied, status: 'applied', note: 'Reopen/reload the saved schematic in KiCad. PCB is not modified; review Update PCB from Schematic separately.' };
  }
  async rollback(id, signal) {
    const { task } = await this.load(id, false);
    return withProjectLock(task.current, () => this.rollbackLocked(id, signal));
  }
  async rollbackLocked(id, signal) {
    const { task, dir } = await this.load(id, false);
    const applied = await json(path.join(dir, 'applied.json')).catch(() => json(path.join(dir, 'pending-apply.json')));
    await assertUnlocked(task.current);
    if (hash(await readLimited(task.current)) !== applied.after) throw new Error('Current schematic changed since apply; refusing to overwrite subsequent work');
    const backup = await readLimited(path.join(dir, 'original.kicad_sch'));
    if (hash(backup) !== applied.before) throw new Error('Backup integrity check failed');
    signal?.throwIfAborted(); await assertUnlocked(task.current);
    if (hash(await readLimited(task.current)) !== applied.after) throw new Error('Current schematic changed while rolling back');
    await atomicReplace(task.current, backup);
    await writeJson(path.join(dir, `rollback-${randomUUID()}.json`), { at: new Date().toISOString(), restored: applied.before });
    return { status: 'restored', current: task.current, revision: applied.before };
  }
}
