import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Flow } from '../src/service.js';
import { writeJSON } from '../src/io.js';
import { harnessAI } from '../src/ai.js';
import { DesignWindow } from '../src/window.js';
import { classify, finishError } from '../src/errors.js';

class TestTools extends Flow {
  async runProcess(args, out) {
    if (args[0].endsWith('intake.py')) await writeJSON(path.join(out, 'prepared/intake.json'), { gaps: [] });
    else await writeJSON(path.join(out, 'result.json'), { summary: 'Simulated tools', gaps: [] });
  }
}
async function setup(t, model) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'eda-three-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const flow = new TestTools({ workspaceRoot: dir, workDirectory: dir, allowModelCalls: Boolean(model) }, model);
  t.after(() => flow.close());
  return { flow, dir };
}
const fixture = { selection: () => ({ provider: 'test-double', model: 'OFFLINE' }), async generate({ record, conversation }) { await record({ event: 'request', provider: 'test-double', model: 'OFFLINE' }); return conversation ? { text: '请确认供电范围。', provider: 'test-double', model: 'OFFLINE' } : { executor: 'local', summary: 'test', gaps: [], assumptions: [], provider: 'test-double', model: 'OFFLINE' }; } };

test('manual confirmation works without model or tool binaries and later stages use its frozen input', async t => {
  const { flow } = await setup(t);
  const p = await flow.create({ label: '人工项目' });
  await assert.rejects(flow.confirm({ projectId: p.id, stage: 1 }, 'human'), /需求/);
  await flow.update({ projectId: p.id, stage: 1, inputs: { requirements: '3.3V sensor' } });
  const confirmed = await flow.confirm({ projectId: p.id, stage: 1 }, 'human');
  assert.equal(confirmed.stages[0].source, 'human'); assert.equal(confirmed.modelRequests, 0);
  assert(confirmed.stages[0].outputHash); assert(confirmed.events.some(e => e.kind === '确认'));
  flow.ai = fixture; flow.config.allowModelCalls = true;
  await flow.execute(p.id, 2);
  const saved = await flow.update({ projectId: p.id, stage: 2, inputs: {} });
  assert.equal(saved.stages[1].status, 'done');
});
test('retries and rename preserve project IDs; old duplicate names remain distinguishable', async t => {
  const { flow } = await setup(t, fixture);
  const p = await flow.create({ label: '唯一项目' });
  await assert.rejects(flow.create({ label: '唯一项目' }), /同名/);
  await flow.update({ projectId: p.id, stage: 1, inputs: { requirements: 'display' } });
  await flow.confirm({ projectId: p.id, stage: 1 }, 'human');
  await flow.execute(p.id, 2); await flow.execute(p.id, 2);
  assert.equal((await flow.list()).length, 1);
  assert.equal((await flow.open(p.id)).stages[1].attempts, 2);
  await flow.rename({ projectId: p.id, label: '显示板一' });
  assert.equal((await flow.list())[0].id, p.id);
  await flow.create({ label: 'internal replay', replayOf: p.id });
  assert.equal((await flow.list()).length, 1);
});
test('chat is isolated from generation and adoption invalidates downstream results', async t => {
  const { flow } = await setup(t, fixture); const p = await flow.create({ label: '对话项目' });
  await flow.update({ projectId: p.id, stage: 1, inputs: { requirements: 'display' } });
  await flow.confirm({ projectId: p.id, stage: 1 }, 'human'); await flow.execute(p.id, 2);
  await flow.startChat({ projectId: p.id, stage: 1, context: '1', text: '检查需求' });
  await flow.jobs.get(p.id).promise;
  const after = await flow.open(p.id); assert.equal(after.stages[1].status, 'done');
  assert.equal(after.messages[1].length, 2); assert.equal(after.messages[2], undefined);
  assert.equal(after.inputs.stageNotes[1], undefined);
  const adopted = await flow.adopt({ projectId: p.id, stage: 1, messageId: after.messages[1][1].id });
  assert.equal(adopted.inputs.stageNotes[1], '请确认供电范围。'); assert.equal(adopted.stages[1].status, 'stale');
  const again = await flow.adopt({ projectId: p.id, stage: 1, messageId: after.messages[1][1].id });
  assert.equal(again.inputs.stageNotes[1], '请确认供电范围。');
});
test('all model finish/error categories preserve evidence and never invent a quota diagnosis', async () => {
  for (const [input, code] of [[{ status: 401, message: 'invalid key' }, 'auth'], [{ status: 402, message: 'balance' }, 'quota'], [{ status: 429, message: 'rate limit' }, 'rate'], [{ message: 'request timed out' }, 'timeout'], [{ message: 'connection reset' }, 'model']]) assert.equal(classify(input).code, code);
  assert.equal(finishError({ kind: 'max-tokens' }).code, 'truncated');
  assert.equal(finishError({ kind: 'aborted' }).code, 'cancelled');
  assert.equal(finishError({ kind: 'error', failure: { status: 429, message: 'Too many requests' } }).code, 'rate');
  assert(!finishError({ kind: 'error', failure: { message: 'upstream error' } }).message.includes('额度'));
  for (const [raw, finish, expected] of [['{', { kind: 'stop' }, 'format'], ['', { kind: 'max-tokens' }, 'truncated'], ['', { kind: 'error', failure: { status: 401, message: 'bad auth' } }, 'auth']]) {
    const ctx = { get: name => name === 'agentDefaultModel' ? { currentSelection: () => ({ provider: 'test', model: 'fixture' }) } : { prepareCall: async () => ({ config: {}, async *stream() { yield { type: 'text-delta', index: 0, text: raw }; yield { type: 'finish', reason: finish }; } }) } };
    await assert.rejects(harnessAI(ctx).generate({ project: {}, stage: {}, request: {}, record: async () => {} }), e => e.code === expected);
  }
});
test('independent window is authenticated, single server, and exposes no Harness chat API', async t => {
  const { flow } = await setup(t); const launches = [];
  const window = new DesignWindow(flow, async x => launches.push(x)); t.after(() => window.close());
  await window.open(); await window.open(); assert.equal(launches.length, 2); assert.equal(launches[0].url, launches[1].url);
  const origin = window.origin;
  assert.equal((await fetch(origin + '/api/eda-flow/bootstrap')).status, 401);
  const session = await fetch(origin + '/api/eda-flow/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: window.key }) });
  const cookie = session.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(origin + '/api/eda-flow/bootstrap', { headers: { cookie } })).status, 200);
  assert.equal((await fetch(origin + '/api/chat', { headers: { cookie } })).status, 404);
  assert.equal((await fetch(origin + '/api/eda-flow/action', { method: 'POST', headers: { cookie, origin: 'http://evil.test', 'content-type': 'application/json' }, body: '{}' })).status, 403);
});
