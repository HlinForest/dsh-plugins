import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Flow } from '../src/service.js';
import { tree, hash } from '../src/io.js';

// Reproduce the reported transition with an input file changing between the
// persisted confirmation and its readback. No model, host profile or binary tool.
class ChangedAtConfirmation extends Flow {
  async save(project) {
    await super.save(project);
    if (project.stages[0].confirmed && !this.injected) {
      this.injected = true;
      await fs.appendFile(path.join(project.stages[0].output, 'result.json'), '\n');
    }
  }
}

test('a confirmation invalidated during readback must not report success and advance', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'eda-confirm-integrity-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const flow = new ChangedAtConfirmation({ workspaceRoot: root, workDirectory: root, allowModelCalls: false });
  const project = await flow.create({ legacy: true, caseId: 'display-board' });
  await assert.rejects(flow.confirm({ projectId: project.id, stage: 1 }, 'human'), error => {
    assert.equal(error.code, 'integrity');
    assert.match(error.message, /result\.json/);
    return true;
  });
  const readback = await flow.open(project.id);
  assert.equal(readback.stages[0].confirmed, false);
  assert.equal(readback.modelRequests, 0);
});

test('starting the next stage must return the invalid prerequisite before accepting a job', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'eda-confirm-start-'));
  const flow = new Flow({ workspaceRoot: root, workDirectory: root, allowModelCalls: false });
  t.after(async () => { await flow.close(); await fs.rm(root, { recursive: true, force: true }); });
  const project = await flow.create({ legacy: true, caseId: 'display-board' });
  await assert.rejects(flow.start({ projectId: project.id, stage: 2 }), /任务与约束/);
  assert.equal(flow.jobs.size, 0);
});

test('file evidence uses the bytes actually read, not separate filesystem size metadata', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'eda-evidence-size-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'evidence.json'), content = Buffer.from('{"input":true}');
  await fs.writeFile(file, content);
  const original = fs.stat;
  t.mock.method(fs, 'stat', async function (name, ...args) {
    const result = await original.call(fs, name, ...args);
    if (name === file) result.size += 1024;
    return result;
  });
  const evidence = await tree(root);
  assert.deepEqual(evidence, [{ path: 'evidence.json', bytes: content.length, sha256: hash(content) }]);
});

test('unchanged file content keeps confirmation when only recorded size or listing order differs', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'eda-evidence-order-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const flow = new Flow({ workspaceRoot: root, workDirectory: root, allowModelCalls: false });
  const project = await flow.create({ legacy: true, caseId: 'display-board' });
  await flow.confirm({ projectId: project.id, stage: 1 }, 'human');
  const saved = await flow.load(project.id);
  saved.stages[0].files.reverse();
  saved.stages[0].files[0].bytes += 1024;
  saved.stages[0].outputHash = hash(saved.stages[0].files);
  await flow.save(saved);
  const opened = await flow.open(project.id);
  assert.equal(opened.stages[0].status, 'done');
  assert.equal(opened.stages[0].confirmed, true);
});

test('real default-input changes are still blocked and identify the file without duplicate poll events', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'eda-default-drift-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const flow = new Flow({ workspaceRoot: root, workDirectory: root, allowModelCalls: false });
  const project = await flow.create({ legacy: true, caseId: 'display-board' });
  await flow.confirm({ projectId: project.id, stage: 1 }, 'human');
  const filename = '01_task/requirements.json';
  await fs.appendFile(path.join(project.inputsBundle, filename), '\n');
  const changed = await flow.open(project.id);
  assert.equal(changed.stages[0].status, 'stale');
  assert.equal(changed.stages[0].confirmed, false);
  assert.deepEqual(changed.stages[0].invalidation.files, [{ path: filename, kind: 'changed' }]);
  await assert.rejects(flow.confirm({ projectId: project.id, stage: 1 }, 'human'), /requirements\.json/);
  const count = (await flow.open(project.id)).events.length;
  assert.equal((await flow.open(project.id)).events.length, count);
  assert.equal(await flow.structuredEligible(changed), false);
});

test('default input content is stable across listing metadata and existing manifests migrate only when verified', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'eda-default-manifest-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const flow = new Flow({ workspaceRoot: root, workDirectory: root, allowModelCalls: false });
  const project = await flow.create({ legacy: true, caseId: 'display-board' });
  await flow.confirm({ projectId: project.id, stage: 1 }, 'human');
  const saved = await flow.load(project.id);
  delete saved.bundleFiles; await flow.save(saved);
  const migrated = await flow.open(project.id);
  assert(migrated.bundleFiles.length > 70);
  migrated.bundleFiles.reverse(); migrated.bundleFiles[0].bytes += 1024;
  migrated.bundleHash = hash(migrated.bundleFiles); await flow.save(migrated);
  assert.equal((await flow.open(project.id)).stages[0].confirmed, true);
  assert.equal(await flow.structuredEligible(await flow.open(project.id)), true);
});

test('edited integrity records cannot bypass the saved output digest', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'eda-record-integrity-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const flow = new Flow({ workspaceRoot: root, workDirectory: root, allowModelCalls: false });
  const project = await flow.create({ legacy: true, requirements: 'unused' });
  await flow.update({ projectId: project.id, stage: 1, inputs: { requirements: 'display board' } });
  await flow.confirm({ projectId: project.id, stage: 1 }, 'human');
  const saved = await flow.load(project.id), stage = saved.stages[0];
  await fs.appendFile(path.join(stage.output, 'result.json'), '\n');
  stage.files = await tree(stage.output);
  await flow.save(saved);
  const changed = await flow.open(project.id);
  assert.equal(changed.stages[0].status, 'stale');
  assert.equal(changed.stages[0].invalidation.kind, 'output-record');
});
