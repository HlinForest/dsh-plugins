import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Flow } from '../src/service.js';
import { readJSON, writeJSON, tree, hash, within } from '../src/io.js';
import { harnessAI } from '../src/ai.js';
import { routes } from '../src/http.js';

class LocalFake extends Flow {
  async runProcess(args, output) {
    await writeJSON(path.join(output, 'result.json'), { summary: '本地测试执行', gaps: ['测试缺项'] });
  }
}
async function setup(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'eda-flow-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const flow = new LocalFake({ workspaceRoot: root, workDirectory: root, ...options });
  return { root, flow, p: await flow.create({ mode: 'new' }) };
}
test('empty project stays unexecuted; prerequisites and engineer confirmation are enforced', async t => {
  const { flow, p } = await setup(t);
  assert(p.stages.every(s => s.status === 'pending' && !s.output));
  await assert.rejects(flow.execute(p.id, 2), /请先执行并确认/);
  await flow.execute(p.id, 1);
  await assert.rejects(flow.confirm({ projectId: p.id, stage: 1, allowDraft: true }, 'model'), /工程师/);
  await assert.rejects(flow.confirm({ projectId: p.id, stage: 1 }, 'human'), /缺项/);
  await flow.confirm({ projectId: p.id, stage: 1, allowDraft: true }, 'human');
  const next = await flow.execute(p.id, 2); assert.deepEqual(next.stages[1].gaps, ['测试缺项']);
});
test('upstream inputs invalidate dependent results and output tampering invalidates confirmation', async t => {
  const { flow, p } = await setup(t);
  await flow.execute(p.id, 1); await flow.confirm({ projectId: p.id, stage: 1, allowDraft: true }, 'human');
  await flow.execute(p.id, 2); await flow.confirm({ projectId: p.id, stage: 2, allowDraft: true }, 'human');
  let changed = await flow.update({ projectId: p.id, stage: 3, inputs: { datasheets: [] } });
  assert(changed.stages[0].confirmed && changed.stages[1].confirmed);
  await fs.writeFile(path.join(changed.stages[0].output, 'result.json'), '{}');
  changed = await flow.open(p.id); assert.equal(changed.stages[0].status, 'stale'); assert(!changed.stages[1].confirmed);
  assert.equal((await flow.load(p.id)).stages[0].status, 'stale');
});
test('file snapshots preserve content and detect later source changes', async t => {
  const { flow, root, p } = await setup(t); const source = path.join(root, 'source.SchDoc');
  await fs.writeFile(source, 'source-v1'); await flow.update({ projectId: p.id, stage: 2, inputs: { schematic: source } });
  const executed = await flow.execute(p.id, 1); const input = executed.stages[0].inputFiles[0];
  assert.equal(await fs.readFile(path.join(executed.stages[0].output, input.path), 'utf8'), 'source-v1');
  await flow.confirm({ projectId: p.id, stage: 1, allowDraft: true }, 'human'); await flow.execute(p.id, 2);
  await fs.writeFile(source, 'source-v2'); assert.equal((await flow.open(p.id)).stages[1].status, 'stale');
});
test('disabled AI makes zero model calls and records an actionable error', async t => {
  const { flow, p } = await setup(t); let called = 0;
  flow.ai = { generate() { called++; throw new Error('must not run'); } };
  await flow.update({ projectId: p.id, stage: 1, source: 'ai' });
  await assert.rejects(flow.execute(p.id, 1), /AI 调用已禁用/);
  assert.equal(called, 0); assert.equal((await flow.open(p.id)).modelRequests, 0);
});
test('R6 edited design or preset output is rejected, supplemental PDFs do not change design signature', async t => {
  const { flow, p } = await setup(t);
  const recipe = await readJSON(new URL('../cases/r6/case.json', import.meta.url));
  p.caseId = 'r6'; p.recipeDigest = hash(recipe); p.caseInputSignature = flow.designSignature(p.inputs);
  const { defaultPlan } = await import('../src/contracts.js'); p.stages[0].plan = defaultPlan(1, recipe);
  p.inputs.datasheets = [{ path: 'example.pdf' }]; await flow.assertPreset(p, p.stages[0]);
  p.inputs.constraints.layerPolicy = 'changed'; await assert.rejects(flow.assertPreset(p, p.stages[0]), /偏离/);
});
test('directory escape and cross-site mutation are refused; partial creates do not break list', async t => {
  const { flow, root, p } = await setup(t);
  await assert.rejects(within(root, path.dirname(root)), /工作区/);
  await fs.mkdir(path.join(flow.root, '11111111-1111-1111-1111-111111111111'));
  assert.equal((await flow.list()).length, 1);
  const action = routes(flow).find(r => r.name === 'action');
  await assert.rejects(action.run(new Request('http://localhost/api/eda-flow/action', { method: 'POST', headers: { origin: 'http://wrong-host', 'content-type': 'application/json' }, body: JSON.stringify({ action: 'create' }) })), /跨站/);
  const step = (await flow.execute(p.id, 1)).stages[0]; await fs.writeFile(path.join(step.output, 'unsafe.html'), '<script>alert(1)</script>');
  const asset = routes(flow).find(r => r.name === 'asset');
  const response = await asset.run(new Request(`http://localhost/api/eda-flow/asset?projectId=${p.id}&stage=1&path=unsafe.html`));
  assert.match(response.headers.get('content-security-policy'), /sandbox/);
});
test('Harness adapter uses the selected model only when called; fake response is executable plan', async () => {
  let prepared = 0;
  const ctx = { get(name) { return name === 'agentDefaultModel' ? { currentSelection: () => ({ provider: 'fake', model: 'fake-stage-model' }) } : { async prepareCall() { prepared++; return { config: {}, async *stream() { yield { type: 'text-delta', index: 0, text: JSON.stringify({ version: 1, executor: 'python', summary: 'fake', assumptions: [], script: 'print(1)' }) }; yield { type: 'finish', reason: { kind: 'stop' } }; } }; } }; } };
  const ai = harnessAI(ctx); assert.equal(prepared, 0);
  const plan = await ai.generate({ project: { mode: 'new' }, stage: { id: 1, title: '任务' }, request: {} });
  assert.equal(plan.model, 'fake-stage-model'); assert.equal(prepared, 1);
});
test('start exposes preflight failures instead of silently swallowing them', async t => {
  const { flow, p } = await setup(t); await flow.start({ projectId: p.id, stage: 3 });
  await flow.jobs.get(p.id).promise; assert.match((await flow.open(p.id)).stages[2].error, /请先执行并确认/);
});
