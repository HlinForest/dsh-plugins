import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Flow } from '../src/service.js';
import { byteEvidence, compareReaders } from '../src/input-integrity.js';
import { writeJSON } from '../src/io.js';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'eda-encrypted-'));
  const flow = new Flow({ workspaceRoot: root, workDirectory: root, allowModelCalls: false });
  t.after(async () => { await flow.close(); await fs.rm(root, { recursive: true, force: true }); });
  const project = await flow.create({ legacy: true, caseId: 'display-board' });
  await flow.confirm({ projectId: project.id, stage: 1 }, 'human');
  return { flow, project };
}

test('CSV TSD wrapping blocks stage two with a specific diagnosis and keeps task confirmation', async t => {
  const { flow, project } = await fixture(t);
  const before = await flow.open(project.id);
  const rows = before.bundleFiles.filter(f => f.path.endsWith('.csv'));
  assert.equal(rows.length, 7);
  for (const row of rows) await fs.writeFile(path.join(project.inputsBundle, row.path), Buffer.from('%TSD-Header\0SIMULATED-WRAPPER'));
  const after = await flow.open(project.id);
  assert.equal(after.stages[0].confirmed, true, '資料变化不能冒充任务表单变化');
  assert.equal(after.stages[0].outputHash, before.stages[0].outputHash);
  assert.equal(after.bundleIssue.code, 'encrypted');
  assert.equal(after.bundleIssue.from, 2);
  assert.equal(after.bundleIssue.files.length, 7);
  assert.match(after.bundleIssue.message, /TSD-Header/);
  await assert.rejects(flow.start({ projectId: project.id, stage: 2 }), e => e.code === 'encrypted');
  assert.equal(after.modelRequests, 0);
  assert.equal(flow.jobs.size, 0);
});

test('ordinary CSV changes remain blocked, are not called encryption, and never replace baseline', async t => {
  const { flow, project } = await fixture(t);
  const baseline = await flow.open(project.id), file = baseline.bundleFiles.find(f => f.path.endsWith('.csv'));
  await fs.appendFile(path.join(project.inputsBundle, file.path), '\r\n');
  const after = await flow.open(project.id);
  assert.equal(after.stages[0].confirmed, true);
  assert.equal(after.bundleIssue.code, 'integrity');
  assert.equal(after.bundleHash, baseline.bundleHash);
  assert.deepEqual(after.bundleFiles, baseline.bundleFiles);
  await assert.rejects(flow.confirm({ projectId: project.id, stage: 2, allowDraft: true }, 'human'), /校验/);
  assert.equal(await flow.structuredEligible(after), false);
});

test('TSD-protected text is never returned to the model as CSV data', async t => {
  const { flow, project } = await fixture(t);
  const filename = project.bundleFiles.find(f => f.path.endsWith('.csv')).path;
  await fs.writeFile(path.join(project.inputsBundle, filename), '%TSD-Header\0NOT-CSV');
  await assert.rejects(flow.readEvidence(project, 2, { scope: 'inputs', path: filename }), e => e.code === 'encrypted');
});

test('reader diagnostics separate encryption, process differences, and ordinary content drift', () => {
  const data = byteEvidence(Buffer.from('ref,value\r\nR1,1k\r\n'));
  const changed = byteEvidence(Buffer.from('ref,value\nR1,2k\n'));
  const wrapped = byteEvidence(Buffer.from('%TSD-Header\0secret-payload'));
  const expected = [{ path: 'table.csv', sha256: data.sha256 }];
  const compare = (a, b) => compareReaders(expected, [{ path: 'table.csv', ...a }], [{ path: 'table.csv', ...b }])[0];
  assert.equal(compare(data, data).status, 'verified');
  assert.equal(compare(data, wrapped).status, 'tsd-protected');
  assert.equal(compare(data, changed).status, 'reader-mismatch');
  assert.equal(compare(changed, changed).status, 'content-mismatch');
  assert(!JSON.stringify(compare(data, wrapped)).includes('secret-payload'));
});

test('wrapping triggered during intake is detected before AI and preserves the confirmed first stage', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'eda-intake-protection-'));
  class DuringIntake extends Flow {
    async runProcess(args, output) {
      assert(args[0].endsWith('intake.py'));
      const p = await this.load(this.id);
      for (const row of p.bundleFiles.filter(f => f.path.endsWith('.csv'))) {
        await fs.writeFile(path.join(p.inputsBundle, row.path), '%TSD-Header\0simulated-policy');
      }
      await writeJSON(path.join(output, 'prepared/intake.json'), { gaps: [] });
    }
    async pythonInputReadings(p, files) {
      return Promise.all(files.map(async f => ({ path: f.path, ...byteEvidence(await fs.readFile(path.join(p.inputsBundle, f.path))) })));
    }
  }
  let calls = 0;
  const flow = new DuringIntake({ workspaceRoot: root, workDirectory: root, allowModelCalls: true }, { generate() { calls++; throw new Error('Must not call AI'); } });
  t.after(async () => { await flow.close(); await fs.rm(root, { recursive: true, force: true }); });
  const p = await flow.create({ legacy: true, caseId: 'display-board' }); flow.id = p.id;
  const before = await flow.confirm({ projectId: p.id, stage: 1 }, 'human');
  await assert.rejects(flow.execute(p.id, 2), e => e.code === 'encrypted');
  const after = await flow.open(p.id);
  assert.equal(calls, 0);
  assert.equal(after.stages[0].confirmed, true);
  assert.equal(after.stages[0].outputHash, before.stages[0].outputHash);
  assert.equal(after.bundleIssue.readings.filter(f => f.tsdHeader).length, 7);
});

test('restoring verified source bytes permits retry without accepting the corrupt baseline', async t => {
  const { flow, project } = await fixture(t);
  const name = project.bundleFiles.find(f => f.path.endsWith('.csv')).path;
  const file = path.join(project.inputsBundle, name), original = await fs.readFile(file);
  await fs.writeFile(file, '%TSD-Header\0temporary');
  assert((await flow.open(project.id)).bundleIssue);
  await fs.writeFile(file, original);
  const after = await flow.open(project.id);
  assert.equal(after.bundleIssue, undefined);
  assert.equal(after.stages[0].confirmed, true);
  assert.equal(after.stages[1].confirmed, false);
  assert.equal(await flow.structuredEligible(after), true);
});
