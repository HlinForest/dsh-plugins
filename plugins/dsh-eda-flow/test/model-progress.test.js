import test from 'node:test';
import assert from 'node:assert/strict';
import { generateText } from '../src/text-ai.js';
import { streamProgress } from '../src/progress.js';
import { Context } from '@deepseek-ai/cordis';
import { LlmAdapter, LlmRuntime } from '@deepseek-ai/dsh-llm';
import { harnessAI } from '../src/ai.js';
import { Flow } from '../src/service.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

test('model activity is observable while the response is still streaming', async () => {
  const events = [];
  const ctx = { get(name) {
    if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'test-double', model: 'TEST-DOUBLE' }) };
    if (name === 'llm') return { async prepareCall() { return { config: {}, async *stream() {
      yield { type: 'reasoning-delta', index: 0, text: 'private reasoning fixture' };
      assert(events.some(e => e.event === 'stream-progress' && e.activity === 'reasoning'), 'UI must receive activity before the model finishes');
      yield { type: 'text-delta', index: 1, text: '{"action":"question",' };
      assert(events.some(e => e.event === 'stream-progress' && e.activity === 'responding' && e.replyChars > 0));
      yield { type: 'text-delta', index: 1, text: '"questions":["请补充规格书"]}' };
      yield { type: 'finish', reason: { kind: 'stop' } };
    } }; } };
  } };
  const result = await generateText(ctx, { project: {}, stage: { id: 3 }, request: {}, record: async e => events.push(e) });
  assert.equal(result.action, 'question');
  assert(!JSON.stringify(events.filter(e => e.event === 'stream-progress')).includes('private reasoning fixture'));
});

test('stream updates are bounded while counts remain accurate and phase changes arrive immediately', async () => {
  let now = 0; const events = [], push = streamProgress(async e => events.push(e), 0, () => now);
  for (let i = 0; i < 1000; i++) await push({ type: 'text-delta', index: 0, text: 'x' });
  assert.equal(events.length, 1);
  now = 800; await push({ type: 'text-delta', index: 0, text: 'y' });
  assert.equal(events.at(-1).replyChars, 1001);
  await push({ type: 'reasoning-delta', index: 1, text: 'private' });
  assert.equal(events.at(-1).activity, 'reasoning');
  await push({ type: 'finish' });
  assert.equal(events.at(-1).chunks, 1002);
});

test('live project API exposes real Harness stream activity before completion and clears it on completion', async t => {
  const root = await fs.mkdtemp(path.join(process.env.EDA_TEST_ROOT || os.tmpdir(), 'eda-progress-'));
  const context = new Context(), llm = new LlmRuntime(context);
  const seenReason = Promise.withResolvers(), next = Promise.withResolvers(), seenText = Promise.withResolvers(), end = Promise.withResolvers();
  t.after(async () => { next.resolve(); end.resolve(); await context.fiber.dispose(); await fs.rm(root, { recursive: true, force: true }); });
  class LocalAdapter extends LlmAdapter {
    async *stream() {
      yield { type: 'reasoning-delta', index: 0, text: 'private test reasoning' };
      seenReason.resolve(); await next.promise;
      yield { type: 'text-delta', index: 1, text: '{"action":"question",' };
      seenText.resolve(); await end.promise;
      yield { type: 'text-delta', index: 1, text: '"questions":["请补规格书"]}' };
      yield { type: 'finish', reason: { kind: 'stop' } };
    }
  }
  llm.registerAdapter(['test-double'], new LocalAdapter());
  const ai = harnessAI({ get: n => n === 'llm' ? llm : n === 'agentDefaultModel' ? { currentSelection: () => ({ provider: 'test-double', model: 'TEST-DOUBLE' }) } : undefined });
  const flow = new Flow({ workspaceRoot: root, workDirectory: root, allowModelCalls: true }, ai);
  let p = await flow.create({ label: 'progress fixture' });
  await flow.update({ projectId: p.id, stage: 1, inputs: { requirements: '仅测试状态。' } });
  await flow.confirm({ projectId: p.id, stage: 1 }, 'human');
  await flow.start({ projectId: p.id, stage: 2 });
  const running = flow.jobs.get(p.id).promise;
  await seenReason.promise;
  p = await flow.open(p.id);
  assert.equal(p.busy, true); assert.equal(p.liveProgress.stage, 2);
  assert.match(p.liveProgress.label, /正在思考/); assert.equal(p.liveProgress.round, 1);
  assert(!JSON.stringify(p.liveProgress).includes('private test reasoning'));
  next.resolve(); await seenText.promise;
  p = await flow.open(p.id);
  assert.match(p.liveProgress.label, /接收模型回复/); assert(p.liveProgress.replyChars > 0);
  end.resolve(); await running;
  p = await flow.open(p.id);
  assert.equal(p.busy, false); assert.equal(p.liveProgress, null); assert.equal(p.stages[1].status, 'waiting-input');
});
