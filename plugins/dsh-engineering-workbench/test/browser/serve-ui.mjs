// Isolated verification host. All model calls terminate in this in-memory stub.
import { Context } from '@deepseek-ai/cordis';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt';
import * as megmeet from 'dsh-megmeet';
import * as pcb from 'dsh-pcb-review';
import * as sync from 'dsh-schematic-sync';
import * as plugin from '../../src/index.js';
import { WorkbenchWindow } from '../../src/window.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
const root = path.resolve(process.argv[2]);
await fs.mkdir(root, { recursive: true });
const ctx = new Context(), routes = [];
ctx.provide('connection', { fetch: { register: r => routes.push(r) } });
await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime);
let mockCalls = 0, mockFailure = false;
ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'local-mock', model: 'UI mock' }) });
ctx.provide('attachments', { saveImages: async () => [] });
ctx.provide('llm', {
  resolveModelInfo: async () => ({ inputModalities: ['text'] }),
  prepareCall: async () => ({ config: {}, inputModalities: ['text'], stream: async function* () {
    mockCalls++; await new Promise(r => setTimeout(r, 1200));
    if (mockFailure) { yield { type: 'finish', reason: { kind: 'error', failure: { code: 'TEST_TIMEOUT' } } }; return; }
    yield { type: 'text-delta', index: 0, text: JSON.stringify({ notes: [], facts: [], unresolved: ['模拟响应：该页留待人工复核。'] }) };
    yield { type: 'finish', reason: { kind: 'stop' } };
  } }),
});
const fixture = fileURLToPath(new URL('../../examples/independent/', import.meta.url));
const source = path.join(root, 'fixtures'); await fs.cp(fixture, source, { recursive: true });
const config = { workspaceRoot: root, workDirectory: path.join(root, 'work'),
  currentSchematic: path.join(source, 'divider.kicad_sch'),
  kicadCli: process.env.KICAD_CLI || 'D:/Kicad/bin/kicad-cli.exe',
  engineeringPython: process.env.ENGINEERING_PYTHON || 'D:/VisualBoard/dsh-engineering-tools/.venv/Scripts/python.exe' };
await ctx.plugin(megmeet, { catalogPath: fileURLToPath(new URL('../../../dsh-megmeet/examples/catalog.demo.json', import.meta.url)), reportDirectory: path.join(root, 'reports'), maxCandidates: 10 });
await ctx.plugin(pcb, { projectFile: fileURLToPath(new URL('../../../dsh-pcb-review/examples/project.kicad.json', import.meta.url)), reportDirectory: path.join(root, 'reports') });
await ctx.plugin(sync, { workspaceRoot: root, workDirectory: path.join(root, 'sync'), kicadCli: config.kicadCli });
await ctx.plugin(plugin, config);
const standalone = new WorkbenchWindow(config, routes); await standalone.start();
const requests = {};
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://' + req.headers.host);
    if (url.pathname === '/__mock') { if (req.method === 'POST') { const chunks = []; for await (const c of req) chunks.push(c); mockFailure = JSON.parse(Buffer.concat(chunks)).failure; } res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ mockCalls, paidModelCalls: 0, requests })); return; }
    const route = routes.find(r => r.path === url.pathname && r.methods.includes(req.method));
    if (!route) { res.writeHead(404); res.end(); return; }
    requests[url.pathname] = (requests[url.pathname] || 0) + 1;
    const chunks = []; for await (const c of req) chunks.push(c);
    const response = await route.fetch(new Request(url, { method: req.method, headers: req.headers, ...(['GET','HEAD'].includes(req.method) ? {} : { body: Buffer.concat(chunks) }) }));
    res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
  } catch (e) { res.writeHead(500); res.end(String(e.message)); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
await fs.writeFile(path.join(root, 'server.json'), JSON.stringify({ url: `http://127.0.0.1:${server.address().port}/api/engineering-workbench/page`, fixture: source, connectionFile: standalone.connectionFile, pid: process.pid }));
console.log('Isolated UI host ready; all model responses are simulated.');
const close = async () => { await ctx.fiber.dispose(); await standalone.close(); server.closeAllConnections(); server.close(() => process.exit(0)); };
process.on('SIGTERM', close); process.on('SIGINT', close);
