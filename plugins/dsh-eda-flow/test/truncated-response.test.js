import test from 'node:test';
import assert from 'node:assert/strict';
import { generateText } from '../src/text-ai.js';

const finish = JSON.stringify({ action: 'finish', summary: '本地测试完成', gaps: [], assumptions: [] });
function fixture(responses) {
  const calls = [], records = [], requests = [];
  const ctx = { get(name) {
    if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'test-double', model: 'TEST-DOUBLE' }) };
    if (name === 'llm') return { async prepareCall() { return { config: {}, async *stream(request) {
      requests.push(structuredClone(request.messages));
      assert(responses.length, 'unexpected additional request');
      const [text, kind = 'stop'] = responses.shift();
      yield { type: 'text-delta', index: 0, text };
      yield { type: 'finish', reason: { kind } };
    } }; } };
  } };
  return { calls, records, requests, run: () => generateText(ctx, { project: {}, stage: { id: 4 }, request: {},
    tools: [{ name: 'precise_apply' }], invoke: async (...args) => { calls.push(args); return { ok: true }; }, record: async e => records.push(e) }) };
}
test('truncated fourth-step action is discarded and replaced by a complete smaller action without replaying success', async () => {
  const good = key => JSON.stringify({ action: 'tool', name: 'precise_apply', arguments: { request_key: key, items: [] } });
  const f = fixture([[good('already-done')], ['{"action":"tool","name":"precise_apply","arguments":', 'max-tokens'], [good('smaller-next')], [finish]]);
  assert.equal((await f.run()).action, 'finish');
  assert.deepEqual(f.calls.map(c => c[1].request_key), ['already-done', 'smaller-next']);
  assert(f.records.some(e => e.event === 'truncation-retry'));
  assert.match(f.requests[2].at(-1).content[0].text, /未执行/);
});
test('repeated truncation stops after two recovery attempts and exposes the raw reply', async () => {
  const f = fixture([['{"action":', 'max-tokens'], ['{"action":', 'max-tokens'], ['{"action":"tool"', 'max-tokens']]);
  await assert.rejects(f.run(), e => e.code === 'truncated' && e.details.truncationRetries === 2 && e.details.rawResponse === '{"action":"tool"');
  assert.equal(f.calls.length, 0);
  assert.equal(f.requests.length, 3);
});
test('even syntactically valid JSON is not executed when the provider reports truncation', async () => {
  const f = fixture([[JSON.stringify({ action: 'tool', name: 'precise_apply', arguments: { request_key: 'incomplete-by-provider' } }), 'max-tokens'], [finish]]);
  assert.equal((await f.run()).action, 'finish');
  assert.equal(f.calls.length, 0);
});
