// Local UI fixture: actual Harness runtime, controlled model stream and tool result; no network model/CAD claims.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import { LlmAdapter, LlmRuntime } from '@deepseek-ai/dsh-llm';
import { harnessAI } from '../src/ai.js';
import { Flow } from '../src/service.js';
import { routes, json } from '../src/http.js';
import { preciseSchemas } from '../src/precise-tools.js';

const root = path.resolve(process.argv[2]), port = Number(process.argv[3] || 18542);
await fs.mkdir(root, { recursive: true });
const context = new Context(), llm = new LlmRuntime(context), queue = [];
let setup = true, waiter, toolGate;
const take = signal => new Promise((resolve, reject) => {
  const abort = () => { waiter = null; reject(new Error('cancelled fixture')); };
  const deliver = value => { signal?.removeEventListener('abort', abort); waiter = null; resolve(value); };
  if (signal?.aborted) return abort();
  if (queue.length) return deliver(queue.shift());
  waiter = deliver; signal?.addEventListener('abort', abort, { once: true });
});
class LocalAdapter extends LlmAdapter {
  async *stream(request) {
    if (setup) {
      yield { type: 'text-delta', index: 0, text: JSON.stringify({ action: 'finish', summary: 'UI fixture only', assumptions: [], gaps: [] }) };
      yield { type: 'finish', reason: { kind: 'stop' } }; return;
    }
    for (;;) {
      const item = await take(request.signal);
      if (item.type === 'finish') { yield { type: 'finish', reason: { kind: item.kind || 'stop' } }; return; }
      yield { type: item.type, index: item.type === 'reasoning-delta' ? 0 : 1, text: item.text };
    }
  }
}
llm.registerAdapter(['test-double'], new LocalAdapter());
const ai = harnessAI({ get: n => n === 'llm' ? llm : n === 'agentDefaultModel' ? { currentSelection: () => ({ provider: 'test-double', model: 'TEST-DOUBLE' }) } : undefined });
const fakeMcp = { open: (_root, signal) => ({ tools: preciseSchemas, close() {}, invoke: async () => {
  await new Promise((resolve, reject) => { const abort = () => reject(new Error('cancelled fixture tool')); signal.addEventListener('abort', abort, { once: true }); toolGate = () => { signal.removeEventListener('abort', abort); resolve(); }; });
  return { testFixture: true, ok: true };
} }) };
const flow = new Flow({ workspaceRoot: root, workDirectory: root, allowModelCalls: true }, ai, fakeMcp);
const p = await flow.create({ label: '进度验证 · 本地模拟' });
await flow.update({ projectId: p.id, stage: 1, inputs: { requirements: '只验证进度界面，不生成真实电路。' } });
await flow.confirm({ projectId: p.id, stage: 1 }, 'human');
for (const stage of [2, 3]) { await flow.execute(p.id, stage); await flow.confirm({ projectId: p.id, stage }, 'human'); }
setup = false;
const handlers = routes(flow);
const server = http.createServer(async (req, res) => {
  let response;
  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`), chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    if (url.pathname === '/test-control') {
      const command = body.length ? JSON.parse(body) : {};
      if (command.op === 'chunk') { if (waiter) waiter(command.chunk); else queue.push(command.chunk); }
      if (command.op === 'release-tool') { toolGate?.(); toolGate = null; }
      if (command.op === 'silence') { const job = flow.jobs.get(p.id); if (job?.activity) job.activity.lastActivityAt = new Date(Date.now() - 65000).toISOString(); }
      response = json({ projectId: p.id, realModelCalls: 0, fixture: true });
    } else {
      const route = handlers.find(r => '/api/eda-flow/' + r.name === url.pathname && r.methods.includes(req.method));
      response = route ? await route.run(new Request(url, { method: req.method, headers: req.headers, ...(req.method === 'GET' ? {} : { body }) })) : new Response('Not found', { status: 404 });
    }
  } catch (error) { response = json({ ok: false, error: error.message }, 400); }
  res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
});
server.listen(port, '127.0.0.1', () => console.log(`Progress UI fixture ready on ${port}; local adapter only`));
async function close() { await flow.close(); await context.fiber.dispose(); server.close(); }
process.on('SIGINT', close); process.on('SIGTERM', close);
