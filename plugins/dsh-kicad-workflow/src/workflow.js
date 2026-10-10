import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';

const META = '.kicad-workflow.json';
const LIMIT = 512 * 1024 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8);
const json = async p => JSON.parse(await fs.readFile(p, 'utf8'));
const writeJson = (p, data) => fs.writeFile(p, JSON.stringify(data, null, 2) + '\n', 'utf8');
export const within = (root, p) => { const r = path.relative(root, p); return r === '' || (!r.startsWith('..' + path.sep) && r !== '..' && !path.isAbsolute(r)); };

// Containment is for workflow-owned files, not a sandbox for the upstream MCP server.
export async function resolveInside(root, supplied, { directory = false } = {}) {
  if (!root || !path.isAbsolute(root)) throw new Error('Configure an absolute workspaceRoot first.');
  const base = await fs.realpath(root);
  const target = path.resolve(base, supplied);
  if (!within(base, target)) throw new Error('Path is outside workspaceRoot.');
  const actual = await fs.realpath(target);
  if (!within(base, actual)) throw new Error('Symlink/junction escapes workspaceRoot.');
  const stat = await fs.stat(actual);
  if (directory ? !stat.isDirectory() : !stat.isFile()) throw new Error('Unexpected file type.');
  return actual;
}

async function ensureOwnedDir(root, relative) {
  const target = path.resolve(root, relative);
  if (!within(root, target)) throw new Error('Output directory escapes project.');
  let cursor = root;
  for (const part of path.relative(root, target).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    try { await fs.mkdir(cursor); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    const stat = await fs.lstat(cursor);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Output directory must not be a symlink/junction.');
  }
  return target;
}

export function runProcess(command, args, { signal, timeout = 600000 } = {}) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, { signal, timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' }, (error, stdout, stderr) => {
      const finish = () => {
        if (signal?.aborted) return reject(signal.reason ?? new Error('Cancelled'));
        if (error?.killed || error?.signal || (error && typeof error.code !== 'number')) return reject(error);
        resolve({ code: error?.code ?? 0, stdout, stderr });
      };
      // Abort may invoke execFile's callback before the child has exited.
      if (child.pid && child.exitCode === null && child.signalCode === null) child.once('close', finish);
      else finish();
    });
  });
}

async function walk(root, signal) {
  const files = []; let bytes = 0;
  async function descend(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      signal?.throwIfAborted();
      if (['node_modules', '.git', '.history', '__pycache__', 'viewer_config'].includes(entry.name) || entry.name.endsWith('-backups')) continue;
      if (entry.name.startsWith('~') || /\.(lck|kicad_prl|bak)$/.test(entry.name)) continue;
      const p = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Project contains a symlink/junction: ' + p);
      if (entry.isDirectory()) await descend(p);
      else if (entry.isFile()) {
        bytes += (await fs.stat(p)).size;
        if (bytes > LIMIT || files.length >= 5000) throw new Error('Project exceeds 512 MiB / 5000 files.');
        files.push(p);
      }
    }
  }
  await descend(root); return files;
}

async function projectFiles(dir, signal) {
  const selected = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const keepDir = /\.(pretty|3dshapes)$/.test(entry.name) || ['models', '3dmodels', 'artwork', 'reference', 'lib', 'library', 'libraries', 'footprints', 'symbols'].includes(entry.name);
    const keepFile = /\.(kicad_pro|kicad_pcb|kicad_sch|kicad_sym|kicad_dru|kicad_wks|step|stp|wrl)$/.test(entry.name) || ['fp-lib-table', 'sym-lib-table', 'connection_evidence.json', 'README_使用与核实.txt'].includes(entry.name);
    if (!keepDir && !keepFile) continue;
    const p = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Project dependency is a symlink/junction: ' + p);
    if (entry.isDirectory() && keepDir) selected.push(...await walk(p, signal));
    else if (entry.isFile() && keepFile) selected.push(p);
  }
  let total = 0;
  for (const p of selected) total += (await fs.stat(p)).size;
  if (selected.length > 5000 || total > LIMIT) throw new Error('Project exceeds package size limits.');
  return selected.sort();
}

async function inventory(files, root, signal) {
  const rows = [];
  for (const p of files) {
    signal?.throwIfAborted();
    const bytes = await fs.readFile(p, { signal });
    rows.push({ file: path.relative(root, p).split(path.sep).join('/'), bytes: bytes.length, sha256: hash(bytes) });
  }
  return rows;
}

export function summarizeChecks(erc, drc) {
  if (!Array.isArray(erc?.sheets) || !Array.isArray(drc?.violations) || !Array.isArray(drc?.unconnected_items) || !Array.isArray(drc?.schematic_parity)) throw new Error('Unrecognized KiCad ERC/DRC JSON: cannot claim a pass.');
  const ercItems = erc.sheets.flatMap(sheet => {
    if (!Array.isArray(sheet.violations)) throw new Error('Malformed ERC sheet.');
    return sheet.violations;
  });
  return { erc: ercItems.length, drc: drc.violations.length, unrouted: drc.unconnected_items.length,
    parity: drc.schematic_parity.length, excludedReportedItems: [...ercItems, ...drc.violations, ...drc.unconnected_items, ...drc.schematic_parity].filter(v => v.excluded === true).length };
}

export class Workflow {
  constructor(config, runner = runProcess) { this.config = config; this.run = runner; }
  async begin({ name, mode = 'replica', baselineProject, sourcePaths = [] }, signal) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name)) throw new Error('name must be 1–64 ASCII letters/digits/underscore/hyphen.');
    if (!['replica', 'design'].includes(mode)) throw new Error('mode must be replica or design.');
    if (!Array.isArray(sourcePaths) || sourcePaths.length > 100) throw new Error('At most 100 source files.');
    const root = await resolveInside(this.config.workspaceRoot, '.', { directory: true });
    let baseline, sourceFiles = [], projectName = name;
    if (baselineProject) {
      baseline = await resolveInside(root, baselineProject);
      if (!/\.kicad_(pro|pcb)$/.test(baseline)) throw new Error('Baseline must be a .kicad_pro or .kicad_pcb.');
      projectName = path.basename(baseline).replace(/\.kicad_(pro|pcb)$/, '');
      sourceFiles = await projectFiles(path.dirname(baseline), signal);
    }
    const inputs = [];
    for (const source of sourcePaths) {
      const file = await resolveInside(root, source);
      if ((await fs.stat(file)).size > 64 * 1024 * 1024) throw new Error('Source file exceeds 64 MiB.');
      inputs.push(file);
    }
    const dir = path.join(root, name + '-' + stamp());
    await fs.mkdir(dir); // No overwrite; exclusive new directory.
    const copied = [];
    for (const file of sourceFiles) {
      signal?.throwIfAborted();
      const relative = path.relative(path.dirname(baseline), file);
      const dest = path.join(dir, relative);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      const before = await fs.readFile(file, { signal });
      await fs.writeFile(dest, before, { flag: 'wx' });
      copied.push({ file: relative.split(path.sep).join('/'), sha256: hash(before) });
    }
    const sources = [];
    for (let i = 0; i < inputs.length; i++) {
      signal?.throwIfAborted();
      const bytes = await fs.readFile(inputs[i], { signal });
      const relative = 'reference/workflow-inputs/' + i + '-' + path.basename(inputs[i]);
      await fs.mkdir(path.dirname(path.join(dir, relative)), { recursive: true });
      await fs.writeFile(path.join(dir, relative), bytes, { flag: 'wx' });
      sources.push({ source: inputs[i], file: relative, sha256: hash(bytes), usableText: !bytes.subarray(0, 128).toString().includes('%TSD-Header-') });
    }
    const unknowns = baseline && mode === 'replica' ? [{ id: 'baseline-connectivity-unverified', description: 'Reused baseline connectivity and geometry have not been measured against the physical original.', references: [baseline], status: 'unresolved', recorded: new Date().toISOString() }] : [];
    if (baseline) {
      const previousMeta = path.join(path.dirname(baseline), META);
      try {
        const previousPath = await resolveInside(root, previousMeta);
        const previous = await json(previousPath);
        if (Array.isArray(previous.unknowns)) unknowns.push(...previous.unknowns.map(item => ({ ...item, id: 'inherited:' + item.id })));
        const dest = path.join(dir, 'reference', 'inherited-workflow.json');
        await fs.mkdir(path.dirname(dest), { recursive: true }); await fs.copyFile(previousPath, dest);
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const meta = { schemaVersion: 1, id: path.basename(dir), created: new Date().toISOString(), mode,
      projectName, baselineProject: baseline ?? null, reusedFiles: copied, sources, unknowns, productionRelease: false };
    await writeJson(path.join(dir, META), meta);
    return { projectDirectory: dir, projectPath: path.join(dir, projectName + '.kicad_pro'), mode,
      reusedExistingProject: !!baseline, reusedFileCount: copied.length, sources,
      next: baseline ? 'Open this copied project with mcp__kicad__open_project.' : 'Use mcp__kicad__create_project with the returned directory and projectName.', projectName };
  }
  async load(projectDirectory) {
    const dir = await resolveInside(this.config.workspaceRoot, projectDirectory, { directory: true });
    const file = await resolveInside(this.config.workspaceRoot, path.join(dir, META));
    const meta = await json(file);
    if (meta.schemaVersion !== 1 || typeof meta.projectName !== 'string' || path.basename(meta.projectName) !== meta.projectName || !Array.isArray(meta.unknowns)) throw new Error('Invalid workflow manifest.');
    return { dir, meta };
  }
  async revision(dir, meta, signal) {
    const files = await inventory(await projectFiles(dir, signal), dir, signal);
    return { files, revision: hash(JSON.stringify({ files, mode: meta.mode, unknowns: meta.unknowns })) };
  }
  async status(projectDirectory, signal) {
    const { dir, meta } = await this.load(projectDirectory);
    const { revision, files } = await this.revision(dir, meta, signal);
    return { projectDirectory: dir, mode: meta.mode, baselineProject: meta.baselineProject, reusedFileCount: meta.reusedFiles.length,
      revision, fileCount: files.length, unknowns: meta.unknowns, checkpoint: meta.checkpoint ?? null,
      checkpointCurrent: !!meta.checkpoint && revision === meta.checkpoint.revision, productionRelease: false };
  }
  async unknown({ projectDirectory, id, description, references = [] }, signal) {
    signal?.throwIfAborted();
    if (!id || id.length > 100 || !description || description.length > 10000 || references.length > 100) throw new Error('Invalid unknown connection record.');
    const { dir, meta } = await this.load(projectDirectory);
    if (meta.unknowns.some(item => item.id === id)) throw new Error('Unknown ID already exists; use another ID to append evidence.');
    meta.unknowns.push({ id, description, references, status: 'unresolved', recorded: new Date().toISOString() });
    await writeJson(path.join(dir, META), meta);
    return { unknownCount: meta.unknowns.length, record: meta.unknowns.at(-1), productionRelease: false };
  }
  async cli(args, signal) {
    if (!this.config.kicadCli || !path.isAbsolute(this.config.kicadCli)) throw new Error('Configure absolute kicadCli.');
    const result = await this.run(this.config.kicadCli, args, { signal, timeout: this.config.toolTimeoutMs });
    if (result.code !== 0) throw new Error(`KiCad CLI ${args.slice(0, 3).join(' ')} exited ${result.code}: ${result.stderr || result.stdout}`);
    return { args, ...result };
  }
  async checkpoint({ projectDirectory }, signal) {
    const { dir, meta } = await this.load(projectDirectory);
    const pcb = await resolveInside(this.config.workspaceRoot, path.join(dir, meta.projectName + '.kicad_pcb'));
    const sch = await resolveInside(this.config.workspaceRoot, path.join(dir, meta.projectName + '.kicad_sch'));
    const before = await this.revision(dir, meta, signal);
    const review = await ensureOwnedDir(dir, path.join('review', 'check-' + stamp()));
    const calls = [];
    calls.push(await this.cli(['sch', 'erc', '--format', 'json', '--output', path.join(review, 'erc.json'), sch], signal));
    calls.push(await this.cli(['pcb', 'drc', '--schematic-parity', '--format', 'json', '--output', path.join(review, 'drc.json'), pcb], signal));
    calls.push(await this.cli(['sch', 'export', 'netlist', '--format', 'kicadxml', '--output', path.join(review, 'netlist.xml'), sch], signal));
    const counts = summarizeChecks(await json(path.join(review, 'erc.json')), await json(path.join(review, 'drc.json')));
    if ((await this.revision(dir, meta, signal)).revision !== before.revision) throw new Error('Project changed during checks; results are stale.');
    const result = { revision: before.revision, checkedAt: new Date().toISOString(), counts, unknownCount: meta.unknowns.length,
      staticChecksClean: Object.values(counts).every(v => v === 0), productionRelease: false,
      interpretation: 'Saved-file checks only. Zero violations do not prove electrical correctness or exact physical replication.',
      directory: review, reportFiles: ['erc.json', 'drc.json', 'netlist.xml'] };
    await writeJson(path.join(review, 'commands.json'), calls);
    await writeJson(path.join(review, 'verification.json'), result);
    await writeJson(path.join(review, 'source-hashes.json'), before.files);
    meta.checkpoint = result; await writeJson(path.join(dir, META), meta);
    return result;
  }
  async deliver({ projectDirectory, expectedRevision, layers = ['F.Cu', 'B.Cu', 'F.Mask', 'B.Mask', 'F.SilkS', 'B.SilkS', 'Edge.Cuts'] }, signal) {
    if (!this.config.kicadPython || !path.isAbsolute(this.config.kicadPython)) throw new Error('Configure absolute kicadPython.');
    const allowedLayers = ['F.Cu', 'B.Cu', 'F.Mask', 'B.Mask', 'F.SilkS', 'B.SilkS', 'F.Paste', 'B.Paste', 'Edge.Cuts', ...Array.from({ length: 30 }, (_, i) => `In${i + 1}.Cu`)];
    if (!layers.length || layers.some(x => !allowedLayers.includes(x))) throw new Error('Invalid fabrication layer list.');
    const { dir, meta } = await this.load(projectDirectory);
    const current = await this.revision(dir, meta, signal);
    if (!expectedRevision || current.revision !== expectedRevision) throw new Error('Project revision changed; call status/checkpoint again.');
    const check = await this.checkpoint({ projectDirectory }, signal);
    const deliveryRoot = await ensureOwnedDir(dir, 'deliveries');
    const out = path.join(deliveryRoot, 'reference-' + stamp()); await fs.mkdir(out);
    for (const row of current.files) {
      signal?.throwIfAborted();
      const dest = path.join(out, row.file); await fs.mkdir(path.dirname(dest), { recursive: true });
      const bytes = await fs.readFile(path.join(dir, row.file), { signal });
      if (hash(bytes) !== row.sha256) throw new Error('Source changed while copying delivery.');
      await fs.writeFile(dest, bytes, { flag: 'wx' });
    }
    const freshMeta = await json(path.join(dir, META)); await writeJson(path.join(out, META), freshMeta);
    const checks = path.join(out, 'review'); await fs.mkdir(checks);
    for (const entry of await fs.readdir(check.directory)) await fs.copyFile(path.join(check.directory, entry), path.join(checks, entry));
    const pdf = path.join(out, 'output', 'pdf'); const fab = path.join(out, 'output', 'manufacturing_REFERENCE_ONLY');
    const assembly = path.join(out, 'output', 'assembly'); const views = path.join(out, 'output', '3d');
    for (const folder of [pdf, fab, assembly, views]) await fs.mkdir(folder, { recursive: true });
    const pcb = path.join(out, meta.projectName + '.kicad_pcb'), sch = path.join(out, meta.projectName + '.kicad_sch');
    const commands = [
      ['sch', 'export', 'pdf', '--output', path.join(pdf, 'schematic.pdf'), sch],
      ['pcb', 'export', 'pdf', '--layers', 'B.Cu,B.SilkS,Edge.Cuts', '--mirror', '--mode-single', '--output', path.join(pdf, 'pcb-back.pdf'), pcb],
      ['pcb', 'export', 'gerbers', '--layers', layers.join(','), '--output', fab + path.sep, pcb],
      ['pcb', 'export', 'drill', '--format', 'excellon', '--generate-map', '--map-format', 'svg', '--output', fab + path.sep, pcb],
      ['pcb', 'export', 'pos', '--format', 'csv', '--units', 'mm', '--side', 'both', '--output', path.join(assembly, 'positions_REFERENCE_ONLY.csv'), pcb],
      ['sch', 'export', 'bom', '--output', path.join(assembly, 'BOM.csv'), sch],
      ['pcb', 'export', 'vrml', '--units', 'mm', '--output', path.join(views, 'assembly.wrl'), pcb],
    ];
    const logs = [];
    for (const args of commands) {
      logs.push({ args, state: 'running' });
      await writeJson(path.join(checks, 'export-commands.json'), logs);
      try { logs[logs.length - 1] = { ...await this.cli(args, signal), state: 'completed' }; }
      catch (error) {
        logs[logs.length - 1] = { args, state: 'failed', error: error.message };
        await writeJson(path.join(checks, 'export-commands.json'), logs); throw error;
      }
    }
    await writeJson(path.join(checks, 'export-commands.json'), logs);
    const warning = 'REFERENCE ONLY — NOT FOR FABRICATION\n' + JSON.stringify({ counts: check.counts, unresolved: freshMeta.unknowns, baselineProject: meta.baselineProject, reusedFiles: meta.reusedFiles.length, productionRelease: false }, null, 2);
    await fs.writeFile(path.join(fab, 'DO_NOT_FABRICATE.txt'), warning, 'utf8');
    await fs.writeFile(path.join(out, 'README_DELIVERY.txt'), 'Editable KiCad reference delivery\n' + warning + '\nReused files and input source hashes: .kicad-workflow.json.\n3D rendering and physical/electrical verification remain separate checks.\n', 'utf8');
    if ((await this.revision(dir, freshMeta, signal)).revision !== expectedRevision) throw new Error('Project changed during export; delivery not finalized.');
    const manifest = await inventory(await walk(out, signal), out, signal);
    await writeJson(path.join(out, 'delivery-manifest.json'), { schemaVersion: 1, productionRelease: false, sourceRevision: expectedRevision, files: manifest });
    const archive = out + '.zip';
    const helper = fileURLToPath(new URL('../scripts/package-project.py', import.meta.url));
    const zip = await this.run(this.config.kicadPython, [helper, out, archive], { signal, timeout: this.config.toolTimeoutMs });
    if (zip.code !== 0) throw new Error('Archive verification failed: ' + zip.stderr);
    return { directory: out, archive, archiveSha256: hash(await fs.readFile(archive, { signal })),
      counts: check.counts, unknownCount: freshMeta.unknowns.length, productionRelease: false, sourceRevision: expectedRevision, zipVerification: JSON.parse(zip.stdout) };
  }
}
