import http from 'node:http';
import fs from 'node:fs/promises';
import { Flow } from '../src/service.js';
import { routes, json } from '../src/http.js';
const config = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
// Local preview never has an AI provider, even if a copied config enables it.
config.allowModelCalls = false;
const flow = new Flow(config); const handlers = routes(flow);
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === '/') { res.writeHead(302, { location: '/api/eda-flow/page' }); res.end(); return; }
    const item = handlers.find(r => '/api/eda-flow/' + r.name === url.pathname && r.methods.includes(req.method));
    if (!item) { res.writeHead(404); res.end(); return; }
    const bytes = []; let size = 0;
    for await (const data of req) { size += data.length; if (size > 3 * 1024 * 1024) throw new Error('请求过大'); bytes.push(data); }
    const request = new Request(url, { method: req.method, headers: req.headers, ...(req.method === 'POST' ? { body: Buffer.concat(bytes) } : {}) });
    let response;
    try { response = await item.run(request); } catch (e) { response = json({ ok: false, error: e.message }, 400); }
    res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
  } catch (e) { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: e.message })); }
});
server.listen(config.port || 18476, '127.0.0.1', () => process.stdout.write(`Local EDA flow: http://127.0.0.1:${config.port || 18476}\nModel calls disabled\n`));
process.on('SIGINT', async () => { await flow.close(); server.close(); });
