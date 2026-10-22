import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import { LlmAdapter, LlmRuntime } from '@deepseek-ai/dsh-llm';
import { pathToFileURL } from 'node:url';
const { harnessAI } = await import(process.env.EDA_PACKAGED_AI ? pathToFileURL(process.env.EDA_PACKAGED_AI).href : new URL('../src/ai.js', import.meta.url));

const finish = { action: 'finish', summary: '测试处理完成', gaps: [], assumptions: [] };
function host(t, replies) {
  const runtimeContext = new Context();
  t.after(() => runtimeContext.fiber.dispose());
  const llm = new LlmRuntime(runtimeContext), requests = [];
  class LocalAdapter extends LlmAdapter {
    async *stream(options) {
      requests.push(structuredClone(options.messages));
      assert(replies.length, 'Unexpected model adapter dispatch');
      const response = replies.shift();
      yield { type: 'reasoning-delta', index: 0, text: 'fixture reasoning context' };
      yield { type: 'text-delta', index: 1, text: typeof response === 'string' ? response : JSON.stringify(response) };
      yield { type: 'finish', reason: { kind: 'stop' }, replayState: { response: { fixture: requests.length }, blocks: ['reasoning-state', 'text-state'] } };
    }
  }
  llm.registerAdapter(['test-double'], new LocalAdapter());
  const ai = harnessAI({ get: name => name === 'llm' ? llm : name === 'agentDefaultModel' ? { currentSelection: () => ({ provider: 'test-double', model: 'TEST-DOUBLE' }) } : undefined });
  return { ai, requests };
}
function checkHistory(requests) {
  assert(requests.length >= 2);
  const assistant = requests[1].find(m => m.role === 'assistant');
  assert.deepEqual(assistant.source, { kind: 'model', provider: 'test-double', model: 'TEST-DOUBLE', replayState: { response: { fixture: 1 }, blocks: ['reasoning-state', 'text-state'] } });
  assert.equal(assistant.content[0].type, 'reasoning');
  assert.equal(assistant.content[0].text, 'fixture reasoning context');
  assert.equal(assistant.content[1].type, 'text');
  assert(requests[1].every(m => m.source && m.id));
}

test('real Harness runtime accepts the next request after a schematic MCP result', async t => {
  const { ai, requests } = host(t, [{ action: 'tool', name: 'precise_read', arguments: {} }, finish]);
  const invoked = [];
  const result = await ai.generateText({ project: { mode: 'text-mcp' }, stage: { id: 4 }, request: { inputs: {} },
    tools: [{ name: 'precise_read' }], invoke: async (name, args) => { invoked.push([name, args]); return { file_matches_model: true }; }, record: async () => {} });
  assert.equal(result.action, 'finish');
  assert.equal(invoked.length, 1);
  checkHistory(requests);
});

test('schematic action with the screenshot-style prose prefix executes unchanged without format retries', async t => {
  const args = { request_key: 'fixture-capacitors', symbols: [{ name: 'FixtureCap', description: 'A complete symbol with {braces}, [brackets] and "quotes" in a string', pins: [
    { number: '1', name: '1', at: [0, 0, 90], length: 2.54, type: 'passive' },
    { number: '2', name: '2', at: [0, 7.62, 270], length: 2.54, type: 'passive' },
  ] }] };
  const raw = 'U1 defined (revision 2). Now batch the vertical decoupling capacitors (pin names/numbers hidden).\n\n'
    + JSON.stringify({ action: 'tool', name: 'precise_apply', arguments: args });
  const { ai, requests } = host(t, [raw, finish]);
  const invoked = [], records = [];
  const result = await ai.generateText({ project: { mode: 'text-mcp' }, stage: { id: 4 }, request: { inputs: {} }, tools: [{ name: 'precise_apply' }],
    invoke: async (name, value) => { invoked.push([name, value]); return { ok: true }; }, record: async e => records.push(e) });
  assert.equal(result.action, 'finish');
  assert.deepEqual(invoked, [['precise_apply', args]]);
  assert.equal(records.filter(e => e.event === 'format-retry').length, 0);
  assert.equal(records.find(e => e.event === 'response').raw, raw);
  assert.equal(requests[1].find(m => m.role === 'assistant').content[1].text, raw);
  checkHistory(requests);
});

test('format repair retains valid Harness assistant attribution and replay metadata', async t => {
  const { ai, requests } = host(t, ['{action:"question"}', { action: 'question', questions: ['需要规格书正文'] }]);
  const result = await ai.generateText({ project: {}, stage: { id: 3 }, request: { inputs: {} }, record: async () => {} });
  assert.equal(result.action, 'question');
  checkHistory(requests);
});

test('rejected finish continues through the actual Harness runtime with preserved history', async t => {
  const { ai, requests } = host(t, [finish, { action: 'question', questions: ['尚未完成工具核验'] }]);
  const result = await ai.generateText({ project: {}, stage: { id: 4 }, request: { inputs: {} }, record: async () => {}, validateFinish: () => '先执行工具检查' });
  assert.equal(result.action, 'question');
  checkHistory(requests);
});

test('legacy evidence reads also retain Harness assistant source and replay metadata', async t => {
  const { ai, requests } = host(t, [{ action: 'read', files: [{ scope: 'inputs', path: 'requirements.txt' }] }, { executor: 'local', summary: '测试资料核对', gaps: [], assumptions: [] }]);
  const result = await ai.generate({ project: { mode: 'design' }, stage: { id: 2 }, request: { inputs: {} }, read: async () => ({ text: 'fixture only' }), record: async () => {} });
  assert.equal(result.executor, 'local');
  checkHistory(requests);
});

test('inline review uses actual Harness parser with a structured read-only resolution',async t=>{
 const resolution={status:'resolved',regenerateFrom:null};
 const {ai,requests}=host(t,[{...finish,resolution}]);
 const result=await ai.generateText({project:{mode:'text-mcp'},stage:{id:2},request:{clarification:true,inputs:{},question:'电压？',answer:'5V'},record:async()=>{},validateFinish: r=>r.resolution?.status==='resolved'?null:'missing resolution'});
 assert.deepEqual(result.resolution,resolution);assert.equal(requests.length,1);
});

test('a repeated answered question is fed back to the model without asking the user again',async t=>{
 const {ai,requests}=host(t,[{action:'question',questions:['输入电压？']},finish]);
 const r=await ai.generateText({project:{mode:'text-mcp'},stage:{id:3},request:{inputs:{},resolvedAnswers:[{question:'输入电压?',answer:'5V'}]},record:async()=>{}});
 assert.equal(r.action,'finish');assert.equal(requests.length,2);
 assert.match(JSON.stringify(requests[1]),/5V/);
});
