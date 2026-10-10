import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EngineeringTasks } from '../src/engineering/tasks.js';
import { Workbench } from '../src/service.js';
import { inventory } from '../src/engineering/kicad.js';
import { readDesign, python } from '../src/engineering/adapters.js';
import { modifyKiCad } from '../src/engineering/kicad.js';
import { randomUUID } from 'node:crypto';
import { run } from '../src/engineering/io.js';
const cli = process.env.ENGINEERING_KICAD_CLI || 'D:/Kicad/bin/kicad-cli.exe';
const py = process.env.ENGINEERING_PYTHON || 'D:/VisualBoard/dsh-engineering-tools/.venv/Scripts/python.exe';
const sample = process.env.ENGINEERING_KICAD_FIXTURE || 'D:/VisualBoard/DisplayBoard.kicad_sch';
const adSample = process.env.ENGINEERING_AD_FIXTURE || 'D:/VisualBoard/dsh-engineering-tools/altium-monkey/examples/assets/projects/simple_hierchical/parent.SchDoc';
const exists = async file => !!(await fs.stat(file).catch(() => null));
test('原生 KiCad 独立任务：实际网表、编辑、撤销重做、版本失效、原生重开和回退', { skip: !(await exists(cli)) || !(await exists(sample)) }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'engineering-native-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'input.kicad_sch'); await fs.copyFile(sample, source); const original = await fs.readFile(source);
  const service = new EngineeringTasks(new Workbench({ workspaceRoot: root, workDirectory: path.join(root, 'records'), kicadCli: cli }));
  let review = await service.dispatch({ action: 'create', kind: 'schematic-review', left: source });
  review = await service.dispatch({ action: 'review', taskId: review.id, extended: false });
  assert.ok(['pass', 'warning', 'fail'].includes(review.review.native.status)); assert.equal(review.review.extension.status, 'not_performed');
  let task = await service.dispatch({ action: 'create', kind: 'align', left: source, right: source });
  assert.notEqual(task.id, review.id); assert.equal(task.left.design.coverage.connectivity, 'complete');
  const mappings = task.mappings.map(m => ({ ...m, confirmed: true }));
  task = await service.dispatch({ action: 'mapping', taskId: task.id, mappings });
  const component = task.left.design.components.find(c => c.ref === 'R1') || task.left.design.components[0];
  const oldRevision = task.revision;
  task = await service.dispatch({ action: 'edit', taskId: task.id, revision: task.revision, operations: [{ op: 'properties', id: component.id, properties: { Value: '22k' } }] });
  assert.equal(task.candidate.design.components.find(c => c.id === component.id).value, '22k'); assert.ok((await fs.readFile(source)).equals(original));
  await assert.rejects(service.dispatch({ action: 'edit', taskId: task.id, revision: oldRevision, operations: [{ op: 'delete', id: component.id }] }), /版本/);
  task = await service.dispatch({ action: 'undo', taskId: task.id }); assert.equal(task.candidate.design.components.find(c => c.id === component.id).value, component.value);
  task = await service.dispatch({ action: 'redo', taskId: task.id }); assert.equal(task.candidate.design.components.find(c => c.id === component.id).value, '22k');
  task = await service.dispatch({ action: 'edit', taskId: task.id, revision: task.revision, operations: [{ op: 'move', id: component.id, at: [component.at[0] + 2.54, component.at[1]] }] });
  assert.equal(task.candidate.design.components.find(c => c.id === component.id).at[0], component.at[0] + 2.54);
  task = await service.dispatch({ action: 'undo', taskId: task.id });
  task = await service.dispatch({ action: 'edit', taskId: task.id, revision: task.revision, operations: [{ op: 'add-from-component', side: 'source', template: component.id, ref: 'R999', value: '10k', at: [250.19, 150.495], pinsConfirmed: true }] });
  assert.equal(task.candidate.design.components.find(c => c.ref === 'R999').value, '10k');
  task = await service.dispatch({ action: 'undo', taskId: task.id });
  task = await service.dispatch({ action: 'verify', taskId: task.id }); assert.equal(task.validation.preservedConnections, true); assert.equal(task.validation.undeclared.length, 0);
  assert.ok(task.exports.json); assert.ok(task.validation.native.engine.version);
  // Saving is exercised only on this test-owned temporary copy.
  assert.equal(task.validation.canOverwrite, true, JSON.stringify({ native: task.validation.native, unknown: task.validation.unknown, undeclared: task.validation.undeclared }));
  {
    task = await service.dispatch({ action: 'confirmation', taskId: task.id, operation: 'apply' }); const confirmation = task.confirmation;
    task = await service.dispatch({ action: 'apply', taskId: task.id, confirmation }); assert.equal(task.state, 'applied');
    await assert.rejects(service.dispatch({ action: 'apply', taskId: task.id, confirmation }), /确认/);
    task = await service.dispatch({ action: 'confirmation', taskId: task.id, operation: 'rollback' });
    task = await service.dispatch({ action: 'rollback', taskId: task.id, confirmation: task.confirmation }); assert.ok((await fs.readFile(source)).equals(original));
  }
  await fs.appendFile(task.candidate.file, '\n');
  await assert.rejects(service.dispatch({ action: 'verify', taskId: task.id }), /之外/);
  const other = await service.dispatch({ action: 'open', taskId: review.id }); assert.equal(other.review.inputVersion, review.left.version);
});

test('跨页修改：原生重读、完整候选 ZIP、双页保存、逐字节回退', { skip: !(await exists(cli)) }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'engineering-pages-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sampleText = await fs.readFile(new URL('../examples/independent/divider.kicad_sch', import.meta.url), 'utf8');
  const uuids = new Map([...sampleText.matchAll(/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/g)].map(m => [m[0], randomUUID()]));
  const child = sampleText.replace(/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/g, s => uuids.get(s)).replaceAll('"R1"', '"R11"').replaceAll('"R2"', '"R12"').replaceAll('"C1"', '"C11"');
  const sheetId = randomUUID();
  const main = sampleText.slice(0, sampleText.lastIndexOf(')')) + `(sheet (at 150 100) (size 25.4 20.32) (stroke (width 0.1524) (type default)) (fill (color 0 0 0 0)) (uuid "${sheetId}") (property "Sheetname" "Child" (at 150 99.3 0) (effects (font (size 1.27 1.27)) (justify left bottom))) (property "Sheetfile" "child.kicad_sch" (at 150 121 0) (effects (font (size 1.27 1.27)) (justify left top)))) )`;
  const file = path.join(root, 'main.kicad_sch'), childFile = path.join(root, 'child.kicad_sch'); await fs.writeFile(file, main); await fs.writeFile(childFile, child);
  const service = new EngineeringTasks(new Workbench({ workspaceRoot: root, workDirectory: path.join(root, 'tasks'), kicadCli: cli }));
  let task = await service.dispatch({ action: 'create', kind: 'align', left: file, right: file });
  assert.equal(task.left.design.documents.length, 2); assert.equal(task.left.design.coverage.connectivity, 'complete');
  task = await service.dispatch({ action: 'mapping', taskId: task.id, mappings: task.mappings.map(m => ({ ...m, confirmed: true })) });
  const components = ['R1','R11'].map(ref => task.left.design.components.find(c => c.ref === ref)); assert.ok(components.every(Boolean));
  task = await service.dispatch({ action: 'edit', taskId: task.id, revision: task.revision, operations: components.map(c => ({ op: 'properties', id: c.id, properties: { Value: '22k' } })) });
  task = await service.dispatch({ action: 'verify', taskId: task.id });
  assert.equal(task.validation.canOverwrite, true, JSON.stringify(task.validation.native));
  if (await exists(py)) {
    const code = 'import sys,zipfile,json; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; m=json.loads(z.read("engineering-manifest.json")); assert set(["main.kicad_sch","child.kicad_sch"]).issubset(z.namelist()); assert len(m["files"]) == 2';
    await run(py, ['-c', code, task.exports.candidatePackage]);
  }
  task = await service.dispatch({ action: 'confirmation', taskId: task.id, operation: 'apply' }); task = await service.dispatch({ action: 'apply', taskId: task.id, confirmation: task.confirmation });
  assert.equal(task.applied.files.length, 2);
  task = await service.dispatch({ action: 'confirmation', taskId: task.id, operation: 'rollback' }); await service.dispatch({ action: 'rollback', taskId: task.id, confirmation: task.confirmation });
  assert.equal(await fs.readFile(file, 'utf8'), main); assert.equal(await fs.readFile(childFile, 'utf8'), child);
});

test('新增器件不能暗中替换其他实例共用的符号定义', async () => {
  const text = await fs.readFile(new URL('../examples/independent/divider.kicad_sch', import.meta.url), 'utf8');
  assert.throws(() => modifyKiCad(text, 'divider.kicad_sch', [{ op: 'add-component', symbol: '(symbol "Demo:R" (symbol "R_1_1" (pin passive line (at 0 0 0) (length 1) (name "X") (number "1"))))', instance: '(symbol (lib_id "Demo:R") (uuid "new") (property "Reference" "R99"))' }]), /替换/);
});
test('AD 离线读取、原生对象移动、未知记录保存与重读；不冒充原生验收', { skip: !(await exists(py)) || !(await exists(adSample)) }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'engineering-ad-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'board.SchDoc'); await fs.copyFile(adSample, source);
  const config = { engineeringPython: py };
  const before = await readDesign(source, path.join(root, 'before'), config);
  const c = before.components[0]; assert.ok(c.uuid); assert.ok(before.nets.length);
  const dest = path.join(root, 'candidate.SchDoc');
  const result = await python(config, 'altium.py', { action: 'edit', file: source, output: root, destination: dest, operations: [{ op: 'move', id: c.id, at: [c.at[0] + 5.08, c.at[1] + 5.08] }] }, root);
  assert.equal(result.reread, true); assert.equal(result.nativeValidation, 'not_performed');
  const after = await readDesign(dest, path.join(root, 'after'), config);
  assert.equal(after.components.length, before.components.length);
  assert.equal(after.components.find(p => p.uuid === c.uuid).at[0], c.at[0] + 5.08);
  const topology = d => d.nets.map(n => n.nodes.map(p => `${p.ref}.${p.pin}`).sort().join('|')).sort();
  assert.deepEqual(topology(after), topology(before));
  assert.ok((await fs.readFile(source)).equals(await fs.readFile(adSample)));
});
test('原生对象身份包含页面；同名跨页位号不共享写入目标', () => {
  const text = '(kicad_sch (uuid "root") (lib_symbols) (symbol (lib_id "Device:R") (at 10 10 0) (uuid "part") (property "Reference" "R1") (property "Value" "10k")))';
  assert.notEqual(inventory(text, 'page-a').components[0].id, inventory(text, 'page-b').components[0].id);
});

test('AD 独立对齐候选：移动、旋转、连线、删件、撤销重做与导出，原生验收保持未执行', { skip: !(await exists(py)) || !(await exists(adSample)) }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'engineering-ad-task-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'input.SchDoc'); await fs.copyFile(adSample, source); const original = await fs.readFile(source);
  const service = new EngineeringTasks(new Workbench({ workspaceRoot: root, workDirectory: path.join(root, 'tasks'), engineeringPython: py }));
  let task = await service.dispatch({ action: 'create', kind: 'align', left: source, right: source });
  task = await service.dispatch({ action: 'mapping', taskId: task.id, mappings: task.mappings.map(m => ({ ...m, confirmed: true })) });
  const c = task.left.design.components[0];
  for (const operation of [{ op: 'properties', id: c.id, properties: { Value: 'TEST_ONLY' } }, { op: 'move', id: c.id, at: [c.at[0]+5.08,c.at[1]+5.08] }, { op: 'rotate', id: c.id, disconnect: true }, { op: 'wire', document: c.document, from: [10.16,10.16], to: [20.32,10.16] }, { op: 'delete', id: c.id }]) {
    task = await service.dispatch({ action: 'edit', taskId: task.id, revision: task.revision, operations: [operation] });
    assert.ok(task.actualChanges.length); const modified = task.candidate.version;
    task = await service.dispatch({ action: 'undo', taskId: task.id }); assert.equal(task.actualChanges.length, 0);
    task = await service.dispatch({ action: 'redo', taskId: task.id }); assert.equal(task.candidate.version, modified);
    task = await service.dispatch({ action: 'undo', taskId: task.id });
  }
  task = await service.dispatch({ action: 'verify', taskId: task.id });
  assert.equal(task.validation.native.status, 'not_performed'); assert.equal(task.validation.canOverwrite, false); assert.ok(task.exports.candidatePackage);
  await assert.rejects(service.dispatch({ action: 'confirmation', taskId: task.id, operation: 'apply' }), /覆盖/);
  assert.ok((await fs.readFile(source)).equals(original));
});
