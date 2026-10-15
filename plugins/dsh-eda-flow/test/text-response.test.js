import test from 'node:test';
import assert from 'node:assert/strict';
import { generateText } from '../src/text-ai.js';

function fixture(replies) {
  const requests = [], records = [], tools = [];
  const ctx = { get(name) {
    if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'test-double', model: 'TEST-DOUBLE' }) };
    if (name === 'llm') return { async prepareCall() { return { config: {}, async *stream(request) {
      requests.push(structuredClone({ messages: request.messages, system: request.system }));
      assert(replies.length, 'Unexpected extra model request');
      yield { type: 'text-delta', index: 0, text: replies.shift() };
      yield { type: 'finish', reason: { kind: 'stop' } };
    } }; } };
  } };
  return { requests, records, tools, run: () => generateText(ctx, {
    project: { mode: 'text-mcp' }, stage: { id: 3, title: '器件与规格书' },
    request: { inputs: { requirements: '已确认任务书，保留缺少的规格书为待补事项。' } },
    record: async record => records.push(record), tools: [{ name: 'forbidden-during-format-repair' }],
    invoke: async (...args) => tools.push(args),
  }) };
}

test('third-stage malformed JSON is returned to the model for bounded repair without losing input', async () => {
  const malformed = '{action:"question",questions:["请补充准确规格书正文。"]}';
  const valid = JSON.stringify({ action: 'question', questions: ['请补充准确规格书正文。'] });
  const f = fixture([malformed, valid]);
  const result = await f.run();
  assert.equal(result.action, 'question');
  assert.equal(f.requests.length, 2);
  assert.match(f.requests[1].messages[0].content[0].text, /已确认任务书/);
  assert(f.requests[1].messages.some(m => m.role === 'assistant' && m.content[0].text === malformed));
  assert.equal(f.records.filter(r => r.event === 'response')[0].raw, malformed);
  assert.equal(f.records.filter(r => r.event === 'format-retry').length, 1);
  assert.equal(f.tools.length, 0);
});

test('a single JSON code block with surrounding explanation is accepted', async () => {
  const body = '还需要资料，具体问题如下：\n```json\n' + JSON.stringify({ action: 'question', questions: ['请提供引脚表。'] }) + '\n```\n补充后继续。';
  const f = fixture([body]);
  assert.deepEqual((await f.run()).questions, ['请提供引脚表。']);
  assert.equal(f.requests.length, 1);
});

test('malformed output stops after two repair attempts and exposes readable raw replies', async () => {
  const f = fixture(['资料缺失，暂不能给出结果。', '{"action":', '仍需要规格书。']);
  await assert.rejects(f.run(), error => {
    assert.equal(error.code, 'format');
    assert.equal(error.details.formatRetries, 2);
    assert.equal(error.details.rawResponse, '仍需要规格书。');
    return true;
  });
  assert.equal(f.requests.length, 3);
  assert.equal(f.tools.length, 0);
});

test('ambiguous multiple JSON actions must be repaired before any tool runs', async () => {
  const f = fixture(['{"action":"tool","name":"forbidden-during-format-repair","arguments":{}}\n{"action":"question","questions":["缺资料"]}', '{"action":"question","questions":["缺资料"]}']);
  const answer = await f.run();
  assert.equal(answer.action, 'question');
  assert.equal(f.requests.length, 2);
  assert.equal(f.tools.length, 0);
});

test('a complete single action with unfenced leading and trailing prose needs no repair request', async () => {
  const f = fixture(['已整理资料。\n' + JSON.stringify({ action: 'question', questions: ['请核对 "引脚" 与 {供电}、[NC]。'] }) + '\n补充后继续。']);
  assert.equal((await f.run()).action, 'question');
  assert.equal(f.requests.length, 1);
});

test('prose cannot conceal extra actions, malformed payloads or array envelopes', async () => {
  const tool = JSON.stringify({ action: 'tool', name: 'forbidden-during-format-repair', arguments: {} });
  const recovered = JSON.stringify({ action: 'question', questions: ['请明确动作。'] });
  for (const raw of [
    '处理如下：' + tool + '\n然后：' + recovered,
    '处理如下：[' + tool + ']',
    '处理如下：' + tool + '\n{"action":',
    '处理如下：{"action":"tool","name":"forbidden-during-format-repair","arguments":{',
    '处理如下：{"action":"tool","name":"forbidden-during-format-repair","arguments":{"note":"bad\\q"}}',
    '处理如下：' + tool + '\n```json\n' + recovered + '\n```',
  ]) {
    const f = fixture([raw, recovered]);
    assert.equal((await f.run()).action, 'question');
    assert.equal(f.tools.length, 0, raw);
    assert.equal(f.requests.length, 2, raw);
  }
});
