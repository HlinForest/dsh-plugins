// Test-only view fixture. Model calls are disabled; no CAD generation is claimed.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Flow } from '../src/service.js';
import { routes, json } from '../src/http.js';

const root = path.resolve(process.argv[2]);
await fs.mkdir(root, { recursive: true });
const flow = new Flow({ workspaceRoot: root, workDirectory: root,
  kicadPython: 'D:/anaconda/python.exe', mcpPython: 'D:/anaconda/python.exe',
  kicadCli: 'D:/Kicad/bin/kicad-cli.exe', allowModelCalls: false }, null);
if (!(await flow.list()).length) {
  const fresh = await flow.create({ label: '显示板 · 文字输入界面检查', caseId: 'display-board' });
  await flow.confirm({ projectId: fresh.id, stage: 1 }, 'human');
  const project = await flow.load(fresh.id);
  project.stages[1].status = 'waiting-input';
  project.stages[1].questions = ['请明确示例的输入电压范围。'];
  project.stages[1].gaps = ['界面测试问题；不是实际模型推断。'];
  await flow.save(project);
}
const handlers = routes(flow), port = Number(process.argv[3] || 18540);
const server = http.createServer(async (req, res) => {
  let response;
  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`), chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    if (url.pathname === '/test-control') response = json({ realModelCalls: 0, modelCallsEnabled: false, fixture: 'UI states only' });
    else {
      const route = handlers.find(r => '/api/eda-flow/' + r.name === url.pathname && r.methods.includes(req.method));
      response = route ? await route.run(new Request(url, { method: req.method, headers: req.headers,
        ...(req.method === 'GET' ? {} : { body: Buffer.concat(chunks) }) })) : new Response('Not found', { status: 404 });
    }
  } catch (e) { response = json({ ok: false, error: e.message }, 400); }
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
});
server.listen(port, '127.0.0.1', () => console.log(`Text UI fixture ready on ${port}; model calls disabled`));
async function close() { await flow.close(); server.close(); }
process.on('SIGINT', close); process.on('SIGTERM', close);
