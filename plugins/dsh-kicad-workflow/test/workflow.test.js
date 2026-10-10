import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Workflow, resolveInside, summarizeChecks, runProcess } from '../src/workflow.js';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-kicad-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const original = path.join(root, 'original'); await fs.mkdir(original);
  for (const ext of ['kicad_pro', 'kicad_sch', 'kicad_pcb']) await fs.writeFile(path.join(original, 'Board.' + ext), '(fixture)');
  await fs.mkdir(path.join(original, 'Local.pretty')); await fs.writeFile(path.join(original, 'Local.pretty', 'R.kicad_mod'), '(footprint)');
  await fs.mkdir(path.join(original, 'node_modules')); await fs.writeFile(path.join(original, 'node_modules', 'secret'), 'not copied');
  return { root, original, workflow: new Workflow({ workspaceRoot: root, kicadCli: process.execPath, toolTimeoutMs: 1000 }) };
}

test('fresh design does not silently reuse an existing board', async t => {
  const { workflow } = await fixture(t);
  const created = await workflow.begin({ name: 'NewBoard', mode: 'design' });
  assert.equal(created.reusedExistingProject, false);
  assert.equal(created.reusedFileCount, 0);
  assert.deepEqual((await fs.readdir(created.projectDirectory)).sort(), ['.kicad-workflow.json']);
});
test('explicit baseline is copied independently with hashes and local libraries', async t => {
  const { workflow, original } = await fixture(t);
  const created = await workflow.begin({ name: 'Replica', baselineProject: path.join(original, 'Board.kicad_pro') });
  assert.equal(created.reusedFileCount, 4);
  await fs.writeFile(path.join(created.projectDirectory, 'Board.kicad_pcb'), 'changed');
  assert.equal(await fs.readFile(path.join(original, 'Board.kicad_pcb'), 'utf8'), '(fixture)');
  const status = await workflow.status(created.projectDirectory);
  assert.equal(status.mode, 'replica'); assert.equal(status.productionRelease, false);
  assert.equal(status.checkpointCurrent, false);
});
test('traversal, external source and junction escape rejected', async t => {
  const { workflow, root } = await fixture(t);
  await assert.rejects(workflow.begin({ name: '../escape' }), /name/);
  await assert.rejects(resolveInside(root, '../external'), /outside/);
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'outside-kicad-'));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  await fs.writeFile(path.join(outside, 'secret.txt'), 'private');
  await fs.symlink(outside, path.join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(resolveInside(root, 'escape/secret.txt'), /escapes/);
});
test('unknowns stay unresolved, invalidate revision and cannot be overwritten', async t => {
  const { workflow } = await fixture(t);
  const { projectDirectory } = await workflow.begin({ name: 'Replica' });
  const before = await workflow.status(projectDirectory);
  const args = { projectDirectory, id: 'U1.12', description: 'Obscured trace', references: ['photo.jpg'] };
  await workflow.unknown(args);
  const after = await workflow.status(projectDirectory);
  assert.notEqual(after.revision, before.revision);
  assert.equal(after.unknowns[0].status, 'unresolved');
  await assert.rejects(workflow.unknown(args), /already exists/);
});
test('check summaries retain open connections, parity and reported exclusions', () => {
  assert.deepEqual(summarizeChecks({ sheets: [{ violations: [{}, {}] }] }, { violations: [{ excluded: true }], unconnected_items: [{}, {}, {}], schematic_parity: [{}] }),
    { erc: 2, drc: 1, unrouted: 3, parity: 1, excludedReportedItems: 1 });
  assert.throws(() => summarizeChecks({}, {}), /cannot claim a pass/);
});
test('failed CLI cannot become a successful checkpoint; missing reports also fail', async t => {
  const { workflow, original } = await fixture(t);
  const { projectDirectory } = await workflow.begin({ name: 'Replica', baselineProject: path.join(original, 'Board.kicad_pro') });
  workflow.run = async () => ({ code: 2, stdout: '', stderr: 'bad input' });
  await assert.rejects(workflow.checkpoint({ projectDirectory }), /exited 2/);
  workflow.run = async () => ({ code: 0, stdout: '', stderr: '' });
  await assert.rejects(workflow.checkpoint({ projectDirectory }), /ENOENT/);
  assert.equal((await workflow.status(projectDirectory)).checkpointCurrent, false);
});
test('stale delivery revision rejected before exporting', async t => {
  const { workflow } = await fixture(t); workflow.config.kicadPython = process.execPath;
  const { projectDirectory } = await workflow.begin({ name: 'New' });
  await assert.rejects(workflow.deliver({ projectDirectory, expectedRevision: 'stale' }), /revision changed/);
});
test('subprocess cancellation is propagated and awaited', async () => {
  const controller = new AbortController();
  const pending = runProcess(process.execPath, ['-e', 'setTimeout(()=>{},30000)'], { signal: controller.signal });
  controller.abort(new Error('cancel test'));
  await assert.rejects(pending, /cancel test/);
});
test('review output junction cannot redirect CLI writes outside the project', async t => {
  const { workflow, original, root } = await fixture(t);
  const { projectDirectory } = await workflow.begin({ name: 'Replica', baselineProject: path.join(original, 'Board.kicad_pro') });
  const elsewhere = path.join(root, 'elsewhere'); await fs.mkdir(elsewhere);
  await fs.symlink(elsewhere, path.join(projectDirectory, 'review'), process.platform === 'win32' ? 'junction' : 'dir');
  let called = false; workflow.run = async () => { called = true; return { code: 0 }; };
  await assert.rejects(workflow.checkpoint({ projectDirectory }), /symlink/);
  assert.equal(called, false);
});
test('inherited unknowns are not lost when a workflow is used as a baseline', async t => {
  const { workflow, original } = await fixture(t);
  const first = await workflow.begin({ name: 'First', baselineProject: path.join(original, 'Board.kicad_pro') });
  await workflow.unknown({ projectDirectory: first.projectDirectory, id: 'R1', description: 'unmeasured' });
  const second = await workflow.begin({ name: 'Second', baselineProject: first.projectPath });
  const status = await workflow.status(second.projectDirectory);
  assert.ok(status.unknowns.some(x => x.id === 'inherited:R1'));
  assert.ok((await fs.stat(path.join(second.projectDirectory, 'reference/inherited-workflow.json'))).isFile());
});
