// Test-only model provider. Never included in the installable package.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Flow } from '../src/service.js';
import { harnessAI } from '../src/ai.js';
import { routes, json } from '../src/http.js';
import { writeJSON } from '../src/io.js';
const root = path.resolve(process.argv[2]); await fs.mkdir(root, { recursive: true });
let failure = null, selected = true, calls = 0, windows = 0;
const ctx = { get: name => name === 'agentDefaultModel' ? { currentSelection: () => selected ? { provider: 'test-double', model: 'OFFLINE-UI-FIXTURE' } : null } : { async prepareCall() { calls++; return { config: {}, async *stream(request) {
  await new Promise(r => setTimeout(r, 250));
  if (failure) { yield { type: 'finish', reason: failure }; return; }
  const first = JSON.parse(request.messages[0].content[0].text);
  const result = first.conversation ? { action: 'advice', text: '建议确认供电范围，并补充对应型号的规格书页码。' } : request.messages.length === 1 ? { action: 'read', files: [{ scope: 'prepared', path: 'engineer-inputs.json' }] } : { action: 'plan', version: 1, executor: first.request.structuredEligible ? 'structured' : 'local', summary: '模拟模型方案；工具使用实际输入执行。', gaps: [], assumptions: [] };
  yield { type: 'text-delta', index: 0, text: JSON.stringify(result) }; yield { type: 'finish', reason: { kind: 'stop' } };
} }; } } };
const flow = new Flow({ workspaceRoot: root, workDirectory: root, kicadPython: 'D:/Kicad/bin/python.exe', kicadCli: 'D:/Kicad/bin/kicad-cli.exe', allowModelCalls: true, skip3d: true }, harnessAI(ctx));
flow.openWindow = async () => { windows++; return { opened: true }; };
let list = await flow.list();
if (!list.length) { const p = await flow.create({ label: '显示板', caseId: 'display-board' }); await flow.confirm({ projectId: p.id, stage: 1 }, 'human'); }
const handlers = routes(flow), port = Number(process.argv[3] || 18515);
const server = http.createServer(async (req, res) => {
  let response;
  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`), chunks = []; for await (const chunk of req) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    if (url.pathname === '/test-control') {
      if (req.method === 'POST') { const value = JSON.parse(bytes); failure = value.failure || null; selected = value.selected !== false; }
      response = json({ calls, windows, realModelCalls: 0 });
    } else {
      const item = handlers.find(r => '/api/eda-flow/' + r.name === url.pathname && r.methods.includes(req.method));
      if (!item) response = new Response('Not found', { status: 404 });
      else response = await item.run(new Request(url, { method: req.method, headers: req.headers, ...(req.method === 'GET' ? {} : { body: bytes }) }));
    }
  } catch (e) { response = json({ ok: false, error: e.message }, 400); }
  res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
});
server.listen(port, '127.0.0.1', () => console.log('Test-only UI server: '+port+'; real model calls: zero'));
async function close() { await writeJSON(path.join(root, 'model-test-record.json'), { calls, realModelCalls: 0 }); await flow.close(); server.close(); }
process.on('SIGINT', close); process.on('SIGTERM', close);
